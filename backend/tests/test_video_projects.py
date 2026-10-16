"""Regression tests for video frame extraction and persistent workspace projects."""
import io
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend import projects, video


class ProjectPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name) / 'projects'
        self.patch = patch.object(projects, 'ROOT', self.root)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.dir.cleanup()

    def test_create_save_open_rename_delete(self):
        p = projects.create({'name':'QA sequence 01'})['project']
        state = {'boxes':[{'track_id':5,'frame_id':3,'x':1,'y':2,'w':3,'h':4}],
                 'meta':{'total_frames':30,'frame_base':0},'media':{'kind':'none'},
                 'decisions':{'issue1':'false_positive'},'source_name':'annotation.xml','frame':13}
        projects.save({'id':p['id'],'state':state})
        saved = projects.open_project({'id':p['id']})['project']
        self.assertEqual(saved['state']['boxes'],state['boxes'])
        self.assertEqual(saved['state']['decisions'],{})  # client cannot forge QC results
        self.assertEqual(saved['state']['frame'],13)
        self.assertEqual(saved['session'],p['session'])
        self.assertEqual(projects.list_projects()['projects'][0]['box_count'],1)
        projects.rename({'id':p['id'],'name':'Sequence renamed'})
        self.assertEqual(projects.open_project({'id':p['id']})['project']['name'],'Sequence renamed')
        projects.delete({'id':p['id']})
        self.assertFalse(projects.list_projects()['projects'])

    def test_project_names_and_state_validation(self):
        with self.assertRaises(ValueError):projects.create({'name':' '})
        p = projects.create({'name':'P'})['project']
        with self.assertRaises(ValueError):projects.save({'id':p['id'],'state':{'boxes':'invalid'}})
        with self.assertRaises(ValueError):projects.save({'id':p['id'],'state':{'boxes':[],'media':{'kind':'video','token':'../../bad'}}})
        self.assertEqual(projects.open_project({'id':p['id']})['project']['state'],{})

    def test_isolated_projects(self):
        a=projects.create({'name':'A'})['project'];b=projects.create({'name':'B'})['project']
        projects.save({'id':a['id'],'state':{'source_name':'a.xml','meta':{},'boxes':[],'media':{'kind':'none'}}})
        self.assertEqual(projects.open_project({'id':a['id']})['project']['source_name'],'a.xml')
        self.assertEqual(projects.open_project({'id':b['id']})['project']['source_name'],'')


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'FFmpeg/ffprobe required')
class VideoFrameTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root=Path(self.dir.name)
        self.patch = patch.object(video, 'ROOT', self.root)
        self.patch.start()
        self.store=video.VideoStore()
        self.video=self.root/'source.mp4'
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-f','lavfi','-i',
                        'testsrc2=size=120x68:rate=4','-frames:v','8','-c:v','mpeg4','-q:v','5',str(self.video)],
                       check=True,capture_output=True,timeout=15)

    def tearDown(self):
        self.patch.stop()
        self.dir.cleanup()

    def test_upload_probe_extract_and_persist(self):
        raw=self.video.read_bytes()
        meta=self.store.add(io.BytesIO(raw),len(raw),'sample.mp4')
        self.assertEqual(meta['frame_count'],8)
        self.assertEqual((meta['width'],meta['height']),(120,68))
        first=self.store.frame(meta['token'],0)
        last=self.store.frame(meta['token'],7)
        self.assertTrue(first.startswith(b'\xff\xd8\xff'))
        self.assertNotEqual(first,last)
        self.assertEqual(video.VideoStore().metadata(meta['token'])['frame_count'],8)
        self.assertEqual(video.VideoStore().frame(meta['token'],7),last)

    def test_nonexistent_frame_rejected(self):
        raw=self.video.read_bytes()
        meta=self.store.add(io.BytesIO(raw),len(raw),'sample.mp4')
        with self.assertRaises(ValueError):self.store.frame(meta['token'],8)
        with self.assertRaises(ValueError):self.store.frame(meta['token'],-1)
        with self.assertRaises(ValueError):self.store.metadata('../secret')


if __name__=='__main__':unittest.main()
