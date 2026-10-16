"""CVAT JSON/ZIP imports, including reviewer read-only access."""
import io
import json
import tempfile
import threading
import unittest
import zipfile
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from backend import auth
from core.parsers import parse_file,parse_cvat_archive
from server import Handler


def archive(name, content):
    buf=io.BytesIO()
    with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr(name,content)
        z.writestr('images/0000001.jpg',b'fake-jpg-payload')
    return buf.getvalue()


class CVATImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.xml=(Path(__file__).parents[3]/'annotations_tracks.xml')

    def test_xml_tracking_real(self):
        xml='<annotations><meta><task><size>2</size><original_size><width>1280</width><height>720</height></original_size></task></meta><track id="19" label="car"><box frame="0" xtl="1" ytl="2" xbr="5" ybr="8" outside="0" /></track></annotations>'
        x=parse_file('annotations.xml',xml)
        self.assertEqual(x['boxes'][0]['track_id'],19)
        y=parse_cvat_archive('cvat.zip',archive('annotations.xml',xml))
        self.assertEqual(y['boxes'],x['boxes'])
        self.assertEqual(y['total_frames'],2)

    def test_coco_with_and_without_track_id(self):
        content=json.dumps({'images':[{'id':22,'file_name':'img_000004.jpg','width':640,'height':480},
                                      {'id':3,'file_name':'img_000001.jpg','width':640,'height':480}],
                            'categories':[{'id':1,'name':'car'}],
                            'annotations':[{'image_id':3,'bbox':[1,2,20,30],'category_id':1,'track_id':7},
                                           {'image_id':22,'bbox':[2,3,10,20],'category_id':1}]})
        data=parse_file('instances_default.json',content)
        self.assertEqual([b['frame_id'] for b in data['boxes']],[0,1])
        self.assertEqual(data['boxes'][0]['track_id'],7)
        self.assertLess(data['boxes'][1]['track_id'],0)
        self.assertTrue(data['warnings'])
        fromzip=parse_cvat_archive('cvat.zip',archive('annotations/instances_default.json',content))
        self.assertEqual(fromzip['boxes'],data['boxes'])

    def test_datumaro(self):
        content=json.dumps({'categories':{'label':{'labels':[{'name':'car'}]}},
                            'items':[{'id':'001', 'annotations':[{'type':'bbox','label_id':0,'bbox':[1,2,3,4],'attributes':{'track_id':2}}]},
                                     {'id':'002','annotations':[{'type':'bbox','label_id':0,'bbox':[2,2,3,4]}]}]})
        x=parse_file('default.json',content)
        self.assertEqual([b['track_id'] for b in x['boxes']],[2,-2])
        self.assertEqual(x['labels'],['car'])

    def test_reject_unknown_json_and_image_zip(self):
        with self.assertRaisesRegex(ValueError,'JSON chưa được hỗ trợ'):
            parse_file('unknown.json','{"foo": 1}')
        b=io.BytesIO()
        with zipfile.ZipFile(b,'w') as z:z.writestr('frames/0000001.jpg','imagedata')
        with self.assertRaisesRegex(ValueError,'frames.zip'):
            parse_cvat_archive('frames.zip',b.getvalue())

    def test_reviewer_can_import_without_edit_permission(self):
        xml='<annotations><meta><task><size>2</size></task></meta><track id="4" label="car"><box frame="0" xtl="1" ytl="2" xbr="5" ybr="8" outside="0" /></track></annotations>'
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(auth,'USERS_FILE',Path(tmp)/'users.json'):
                auth.SESSIONS.clear()
                auth.setup({'username':'rootadmin','password':'supersecurepassword'})
                admin=auth.login({'username':'rootadmin','password':'supersecurepassword'})
                auth.create_user({'username':'reviewer','password':'reviewer_password','role':'reviewer'},admin['user'])
                token=auth.login({'username':'reviewer','password':'reviewer_password'})['token']
                httpd=ThreadingHTTPServer(('127.0.0.1',0),Handler)
                thread=threading.Thread(target=httpd.serve_forever,daemon=True);thread.start()
                endpoint=f'http://127.0.0.1:{httpd.server_port}'
                def post(route,body,headers):
                    req=Request(endpoint+route,data=body,headers={'Authorization':'Bearer '+token,**headers},method='POST')
                    try:
                        with urlopen(req,timeout=7) as r:return r.status,json.loads(r.read())
                    except HTTPError as e:return e.code,json.loads(e.read())
                try:
                    status,data=post('/api/parse',json.dumps({'filename':'annotations.xml','content':xml}).encode(),{'Content-Type':'application/json'})
                    self.assertEqual(status,200,data)
                    self.assertEqual(data['boxes'][0]['track_id'],4)
                    payload=archive('annotations.xml',xml)
                    status,data=post('/api/annotation/import',payload,{'Content-Type':'application/zip','X-T021-Filename':'annotations.zip'})
                    self.assertEqual(status,200,data)
                    self.assertEqual(data['boxes'][0]['frame_id'],0)
                    status,data=post('/api/fix',json.dumps({'action':'delete_box','boxes':data['boxes'],'data':{'uid':'b1'}}).encode(),{'Content-Type':'application/json'})
                    self.assertEqual(status,403,data)
                finally:
                    httpd.shutdown();httpd.server_close();thread.join(timeout=7)
                    auth.SESSIONS.clear()

if __name__=='__main__':unittest.main()
