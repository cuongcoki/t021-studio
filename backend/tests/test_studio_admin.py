"""React-UI additions: user CRUD, Projects (groups) of tasks, task assignment/status, CVAT conversion."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import audit, auth, cvat, dashboard, groups, projects, workflow


class StudioTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name)
        self.patches = [patch.object(projects, 'ROOT', t / 'projects'), patch.object(auth, 'USERS_FILE', t / 'users.json'),
                        patch.object(audit, 'PATH', t / 'audit.jsonl'), patch.object(groups, 'ROOT', t),
                        patch.object(cvat, 'STORE', t)]
        for p in self.patches:
            p.start()
        auth.SESSIONS.clear()
        auth.setup({'username': 'boss', 'password': 'supersecret1'})
        self.admin = auth.login({'username': 'boss', 'password': 'supersecret1'})['user']
        auth.create_user({'username': 'anno', 'password': 'annotation1', 'role': 'annotator', 'full_name': 'An Nguyễn'}, self.admin)
        auth.create_user({'username': 'rev', 'password': 'reviewer11', 'role': 'reviewer'}, self.admin)
        self.anno = auth.login({'username': 'anno', 'password': 'annotation1'})['user']
        self.rev = auth.login({'username': 'rev', 'password': 'reviewer11'})['user']

    def tearDown(self):
        auth.SESSIONS.clear()
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    # users

    def test_admin_searches_filters_and_edits_users(self):
        rows = auth.list_users({'q': 'nguyễn'}, self.admin)['users']
        self.assertEqual([u['username'] for u in rows], ['anno'])
        self.assertEqual([u['username'] for u in auth.list_users({'role': 'reviewer'}, self.admin)['users']], ['rev'])
        auth.update_user({'username': 'rev', 'active': False}, self.admin)
        with self.assertRaisesRegex(ValueError, 'khoá'):
            auth.login({'username': 'rev', 'password': 'reviewer11'})
        self.assertEqual([u['username'] for u in auth.list_users({'active': False}, self.admin)['users']], ['rev'])
        auth.update_user({'username': 'rev', 'active': True, 'password': 'newpassword1'}, self.admin)
        auth.login({'username': 'rev', 'password': 'newpassword1'})
        with self.assertRaises(PermissionError):
            auth.list_users({}, self.anno)

    def test_the_last_admin_cannot_be_removed_or_demoted(self):
        with self.assertRaisesRegex(ValueError, 'chính tài khoản'):
            auth.delete_user({'username': 'boss'}, self.admin)
        with self.assertRaisesRegex(ValueError, 'ít nhất một Admin'):
            auth.update_user({'username': 'boss', 'role': 'annotator'}, self.admin)
        token = next(t for t, s in auth.SESSIONS.items() if s['username'] == 'anno')
        auth.delete_user({'username': 'anno'}, self.admin)
        with self.assertRaises(PermissionError):  # their open session ended too
            auth.verify(token)

    def test_a_session_survives_a_server_restart_but_not_a_logout(self):
        token = auth.login({'username': 'anno', 'password': 'annotation1'})['token']
        saved = auth._sessions_file().read_text(encoding='utf-8')
        self.assertNotIn(token, saved)  # only a hash is on disk
        auth.SESSIONS.clear()
        auth._SESSIONS_LOADED.clear()  # a fresh process
        self.assertEqual(auth.verify(token)['username'], 'anno')
        auth.logout(token)
        auth.SESSIONS.clear()
        auth._SESSIONS_LOADED.clear()
        with self.assertRaises(PermissionError):
            auth.verify(token)

    # projects (groups) and tasks

    def test_tasks_belong_to_projects_and_follow_the_qc_status(self):
        g = groups.create({'name': 'Dashcam tháng 10'}, self.anno)['group']
        t = projects.create({'name': 'video 01', 'group_id': g['id']}, self.admin)['project']
        with self.assertRaises(PermissionError):
            projects.update_meta({'id': t['id'], 'annotator': 'anno'}, self.anno)  # only admin assigns
        projects.update_meta({'id': t['id'], 'annotator': 'anno', 'reviewer': 'rev'}, self.admin)
        with self.assertRaisesRegex(ValueError, 'không phải tài khoản reviewer'):
            projects.update_meta({'id': t['id'], 'reviewer': 'anno'}, self.admin)
        projects.update_meta({'id': t['id'], 'status': 'in_review'}, self.anno)
        with self.assertRaises(PermissionError):
            projects.update_meta({'id': t['id'], 'status': 'done'}, self.anno)
        workflow.transition({'project_id': t['id'], 'issue_id': 'gap1', 'status': 'needs_fix', 'note': 'Thiếu box'}, self.rev)
        self.assertEqual(projects.get(t['id'])['status'], 'needs_fix')
        with self.assertRaisesRegex(ValueError, 'chưa đóng'):
            projects.update_meta({'id': t['id'], 'status': 'done'}, self.rev)
        listed = groups.list_groups()['groups'][0]
        self.assertEqual((listed['task_count'], listed['status_counts']), (1, {'needs_fix': 1}))
        summary = dashboard.summary({}, self.anno)
        self.assertEqual((summary['tasks'], summary['qc']['needs_fix'], summary['todo_count']), (1, 1, 1))
        groups.delete({'id': g['id']}, self.admin)
        self.assertIsNone(projects.get(t['id'])['group_id'])  # the task survives, ungrouped

    # CVAT conversion

    def test_cvat_tracks_round_trip_through_t021_boxes(self):
        ann = {'tracks': [{'id': 50, 'frame': 2, 'label_id': 7, 'shapes': [
            {'type': 'rectangle', 'frame': 2, 'points': [0, 0, 10, 10], 'outside': False, 'occluded': False},
            {'type': 'rectangle', 'frame': 6, 'points': [40, 0, 50, 10], 'outside': False, 'occluded': True},
            {'type': 'rectangle', 'frame': 8, 'points': [40, 0, 50, 10], 'outside': True, 'occluded': False}]}],
            'shapes': [{'id': 9, 'type': 'rectangle', 'frame': 3, 'label_id': 7, 'points': [5, 5, 9, 9]}]}
        boxes = cvat_boxes = cvat.cvat_to_boxes(ann, {7: 'car'}, 0, 9)
        tracked = [b for b in boxes if b['track_id'] == 1]
        self.assertEqual([b['frame_id'] for b in tracked], [2, 3, 4, 5, 6, 7])  # interpolated, hidden at 8
        self.assertEqual(tracked[2]['x'], 20.0)  # halfway 2 -> 6
        self.assertEqual([b['keyframe'] for b in tracked], [True, False, False, False, True, False])
        self.assertEqual([b['track_id'] for b in boxes if b['track_id'] < 0], [-1])
        payload = cvat.boxes_to_cvat(cvat_boxes, {'car': 7}, 9)
        shapes = payload['tracks'][0]['shapes']
        self.assertEqual([(s['frame'], s['outside']) for s in shapes], [(2, False), (6, False), (7, False), (8, True)])
        self.assertEqual(len(payload['shapes']), 1)
        again = cvat.cvat_to_boxes({'tracks': [{**payload['tracks'][0], 'id': 1}], 'shapes': []}, {7: 'car'}, 0, 9)
        self.assertEqual([(b['frame_id'], b['x']) for b in again], [(b['frame_id'], b['x']) for b in tracked])

    def test_push_refuses_unknown_labels_and_mixed_class_tracks(self):
        box = {'uid': 'a', 'frame_id': 0, 'track_id': 1, 'x': 0, 'y': 0, 'w': 5, 'h': 5, 'class_name': 'truck'}
        with self.assertRaisesRegex(ValueError, 'không có nhãn: truck'):
            cvat.boxes_to_cvat([box], {'car': 1}, 5)
        with self.assertRaisesRegex(ValueError, 'nhiều class'):
            cvat.boxes_to_cvat([{**box, 'class_name': 'car'}, {**box, 'uid': 'b', 'frame_id': 1}], {'car': 1, 'truck': 2}, 5)

    def test_cvat_account_is_per_user_and_token_never_listed(self):
        with self.assertRaisesRegex(ValueError, 'chưa kết nối CVAT'):
            cvat.list_jobs({}, self.anno)
        with patch.object(cvat, '_call', side_effect=lambda url, token, path, *a, **k:
                          {'key': 'tok123'} if path == '/api/auth/login' else {'username': 'cvatuser', 'version': '2.76'}):
            res = cvat.save_account({'url': 'http://localhost:8080/', 'username': 'u', 'password': 'p'}, self.anno)
        self.assertEqual(res['cvat_user'], 'cvatuser')
        status = cvat.account_status({}, self.anno)
        self.assertEqual((status['configured'], status['url']), (True, 'http://localhost:8080'))
        self.assertNotIn('token', status)
        self.assertFalse(cvat.account_status({}, self.rev)['configured'])


class FrameAccountTests(StudioTests):
    def test_a_reviewer_without_cvat_login_sees_frames_through_the_importer_account(self):
        cvat._write({'anno': {'url': 'http://cvat:8080', 'token': 'tok-anno', 'cvat_user': 'a'}})
        t = projects.create({'name': 'from cvat'}, self.anno)['project']
        with projects.LOCK:
            d = projects.get(t['id'])
            d['cvat'] = {'url': 'http://cvat:8080', 'job_id': 7, 'start_frame': 0, 'stop_frame': 9, 'imported_by': 'anno'}
            projects._write(d)
        calls = []
        with patch.object(cvat, '_call', side_effect=lambda url, token, path, *a, **k: calls.append(token) or (b'img', 'image/jpeg')):
            self.assertEqual(cvat.frame(t['id'], 3, self.rev), (b'img', 'image/jpeg'))
        self.assertEqual(calls, ['tok-anno'])
        with self.assertRaisesRegex(ValueError, 'nhập tài khoản|Cài đặt'):  # pushing still needs your own login
            cvat.push({'id': t['id']}, self.anno | {'username': 'someone_else'})


if __name__ == '__main__':
    unittest.main()
