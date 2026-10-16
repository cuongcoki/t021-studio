"""QC permissions, durable reviewer-to-annotator handoff, direct HTTP 403 regressions."""
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend import audit, auth, projects, workflow
from backend.orchestrator import quality
from server import Handler


class WorkflowPermissionsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t=Path(self.tmp.name)
        self.patches=[patch.object(projects,'ROOT',t/'projects'),
                      patch.object(auth,'USERS_FILE',t/'users.json'),
                      patch.object(audit,'PATH',t/'audit.jsonl')]
        for p in self.patches:p.start()
        auth.SESSIONS.clear()
        auth.setup({'username':'rootadmin','password':'supersecurepassword'})
        admin=auth.login({'username':'rootadmin','password':'supersecurepassword'})
        self.admin=admin['user']
        auth.create_user({'username':'anno','password':'annotation12','role':'annotator'},self.admin)
        auth.create_user({'username':'review','password':'reviewpass12','role':'reviewer'},self.admin)
        self.a=auth.login({'username':'anno','password':'annotation12'})
        self.r=auth.login({'username':'review','password':'reviewpass12'})
        self.project=projects.create({'name':'Video QA'})['project']
        self.pid=self.project['id']
        self.box={'uid':'obj1','frame_id':0,'track_id':1,'class_name':'car','x':0,'y':0,'w':50,'h':20}
        self.state={'boxes':[self.box],'meta':{'frame_base':0,'total_frames':5,'width':1280,'height':720},
                    'media':{'kind':'none'},'decisions':{'forged':'verified'}}
        projects.save({'id':self.pid,'state':self.state})

    def tearDown(self):
        auth.SESSIONS.clear()
        for p in reversed(self.patches):p.stop()
        self.tmp.cleanup()

    def test_reviewer_requests_annotator_edits_reviewer_verifies(self):
        i={'project_id':self.pid,'issue_id':'gap-example','status':'needs_fix','note':'Thiếu box frame 1',
           'issue':{'type':'Gap Frame','frame':1,'track_id':1,'message':'Frame 1 missing'}}
        with self.assertRaises(PermissionError):workflow.transition(i,self.a['user'])
        t=workflow.transition(i,self.r['user'])['task'];self.assertEqual(t['status'],'needs_fix')
        with self.assertRaises(ValueError):workflow.transition({**i,'status':'fixed'},self.a['user'])
        with self.assertRaises(PermissionError):workflow.transition({**i,'status':'fixed'},self.r['user'])
        updated={**self.state, 'boxes':[{**self.box,'x':1}]}
        projects.save({'id':self.pid,'state':updated})
        task=workflow.transition({**i,'status':'fixed','note':'Đã sửa tọa độ và lưu'},self.a['user'])['task']
        self.assertEqual(task['status'],'fixed')
        with self.assertRaises(PermissionError):workflow.transition({**i,'status':'verified'},self.a['user'])
        task=workflow.transition({**i,'status':'verified','note':'Đã kiểm tra lại'},self.r['user'])['task']
        self.assertEqual(task['status'],'verified')
        saved=projects.open_project({'id':self.pid})['project']
        self.assertEqual(saved['tasks']['gap-example']['status'],'verified')
        self.assertEqual(len(saved['tasks']['gap-example']['history']),3)
        self.assertEqual(saved['state']['decisions'],{})

    def test_server_quality_does_not_trust_client_approval(self):
        workflow.transition({'project_id':self.pid,'issue_id':'review001','status':'needs_fix','note':'Sửa lại'},self.r['user'])
        res=quality({'project_id':self.pid,'boxes':[],'decisions':{'review001':'verified'}})
        self.assertFalse(res['pass_gate'])
        self.assertEqual(res['pending_handoffs'],['review001'])

    def test_reviewer_cannot_verify_after_annotation_changed_again(self):
        data={'project_id':self.pid,'issue_id':'jump','status':'needs_fix','note':'Check box jump',
              'issue':{'type':'Box Jump','frame':0,'track_id':1}}
        workflow.transition(data,self.r['user'])
        projects.save({'id':self.pid,'state':{**self.state,'boxes':[{**self.box,'x':5}]}})
        workflow.transition({**data,'status':'fixed','note':'Đã sửa frame 0'},self.a['user'])
        projects.save({'id':self.pid,'state':{**self.state,'boxes':[{**self.box,'x':9}]}})
        with self.assertRaisesRegex(ValueError,'tiếp tục thay đổi'):
            workflow.transition({**data,'status':'verified'},self.r['user'])
        self.assertEqual(projects.get(self.pid)['tasks']['jump']['status'],'fixed')

    def test_reviewer_cannot_write_through_raw_api(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        endpoint=f'http://127.0.0.1:{server.server_port}'
        def post(route,obj,token):
            req=Request(endpoint+route,data=json.dumps(obj).encode(),method='POST',headers={
              'Authorization':'Bearer '+token,'Content-Type':'application/json'})
            try:
                with urlopen(req, timeout=10) as r:
                    return r.status,json.loads(r.read())
            except HTTPError as exc:
                return exc.code,json.loads(exc.read())
        try:
            for route,body in [('/api/fix',{'boxes':[self.box],'action':'delete_box','data':{'uid':'obj1'}}),
                               ('/api/projects/save',{'id':self.pid,'state':{'boxes':[]}}),
                               ('/api/projects/create',{'name':'Reviewer can write?'}),
                               ('/api/export',{'boxes':[self.box],'format':'mot'}),
                               ('/api/workflow/transition',{'project_id':self.pid,'issue_id':'x','status':'fixed','note':'bypass'})]:
                status,result=post(route,body,self.r['token'])
                self.assertEqual(status,403,(route,result))
            status,result=post('/api/workflow/transition',{'project_id':self.pid,'issue_id':'x',
                       'status':'needs_fix','note':'Kiểm tra box frame 0'},self.r['token'])
            self.assertEqual(status,200,result)
            status,result=post('/api/workflow/transition',{'project_id':self.pid,'issue_id':'x',
                       'status':'needs_fix','note':'bypass'},self.a['token'])
            self.assertEqual(status,403,result)
            status,result=post('/api/projects/save',{'id':self.pid,'state':self.state},self.a['token'])
            self.assertEqual(status,200,result)
        finally:
            server.shutdown();server.server_close();thread.join(timeout=5)

if __name__=='__main__':unittest.main()
