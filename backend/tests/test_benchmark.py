"""Planted-error benchmark: the rules must find what was planted, baseline issues don't count."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import audit, auth, benchmark, cvat, groups, projects


def clean_tracks(n_tracks=6, frames=40):
    """Cars moving smoothly, far apart: the rules raise nothing on this."""
    rows = []
    for t in range(1, n_tracks + 1):
        for f in range(frames):
            rows.append({'uid': f't{t}f{f}', 'frame_id': f, 'track_id': t, 'class_name': 'car',
                         'x': 40.0 + 150 * t + 2 * f, 'y': 100.0 + 40 * t, 'w': 60.0, 'h': 35.0})
    return rows


class BenchmarkTests(unittest.TestCase):
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
        admin = auth.login({'username': 'boss', 'password': 'supersecret1'})['user']
        auth.create_user({'username': 'anno', 'password': 'annotation1', 'role': 'annotator'}, admin)
        self.anno = auth.login({'username': 'anno', 'password': 'annotation1'})['user']
        self.src = projects.create({'name': 'clean video'}, self.anno)['project']
        projects.save({'id': self.src['id'], 'state': {'boxes': clean_tracks(), 'meta': {'mode': 'video', 'frame_base': 0,
                                                                                       'width': 1600, 'height': 600, 'total_frames': 40}}})

    def tearDown(self):
        auth.SESSIONS.clear()
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def test_planted_errors_are_all_found(self):
        made = benchmark.make({'id': self.src['id'], 'id_switch': 2, 'gap': 2, 'jump': 2, 'seed': 7}, self.anno)
        doc = made['ground_truth']
        self.assertEqual(sorted(e['type'] for e in doc['ground_truth']),
                         sorted(['ID Switch Candidate'] * 2 + ['Gap Frame'] * 2 + ['Box Jump'] * 2))
        res = benchmark.evaluate({'id': made['task_id'], 'ground_truth': doc['ground_truth'], 'baseline': doc['baseline']}, self.anno)
        self.assertEqual((res['recall'], res['precision']), (1.0, 1.0), (res['missed'], res['false_alarms']))
        self.assertTrue(res['target_met'])
        self.assertEqual(set(res['by_type']), {'ID Switch Candidate', 'Gap Frame', 'Box Jump'})
        # the source task is untouched
        self.assertEqual(len(projects.get(self.src['id'])['state']['boxes']), 6 * 40)

    def test_a_wrong_ground_truth_shows_up_as_missed_and_false(self):
        made = benchmark.make({'id': self.src['id'], 'id_switch': 1, 'gap': 0, 'jump': 0, 'seed': 1}, self.anno)
        real = made['ground_truth']['ground_truth'][0]
        fake = {**real, 'track_id': 999}
        res = benchmark.evaluate({'id': made['task_id'], 'ground_truth': [fake]}, self.anno)
        self.assertEqual((res['tp'], res['fn'], res['fp']), (0, 1, 1))
        self.assertEqual(res['missed'][0]['track_id'], 999)

    def test_the_team_truth_format_scores_and_flags_what_the_data_lacks(self):
        rows = clean_tracks()
        for b in rows:  # track 2 is cut at frame 20, its rest becomes track 9 from frame 23
            if b['track_id'] == 2 and b['frame_id'] >= 20:
                b['track_id'] = 9
        rows = [b for b in rows if not (b['track_id'] == 9 and b['frame_id'] < 23)]
        projects.save({'id': self.src['id'], 'state': {'boxes': rows, 'meta': {'mode': 'video', 'frame_base': 0,
                                                                              'width': 1600, 'height': 600, 'total_frames': 40}}})
        truth = [{'type': 'fragment', 'a': 2, 'b': 9, 'frame': 19},
                 {'type': 'class_flip', 'a': 4, 'b': None, 'frame': 10}]  # never landed: track 4 is all 'car'
        res = benchmark.evaluate({'id': self.src['id'], 'ground_truth': truth}, self.anno)
        self.assertEqual((res['tp'], res['fp'], res['fn']), (1, 0, 0), res['false_alarms'])
        self.assertEqual([g['planted'] for g in res['absent_in_data']], ['class_flip 4'])
        with self.assertRaisesRegex(ValueError, 'không biết'):
            benchmark.evaluate({'id': self.src['id'], 'ground_truth': [{'type': 'teleport', 'a': 1, 'frame': 3}]}, self.anno)

    def test_clean_labels_as_baseline_remove_their_own_warnings(self):
        rows = [b for b in clean_tracks() if not (b['track_id'] == 1 and b['frame_id'] in (5, 6))]  # a real gap
        with_jump = [dict(b, x=b['x'] + 300) if (b['track_id'] == 3 and b['frame_id'] == 20) else b for b in rows]
        projects.save({'id': self.src['id'], 'state': {'boxes': with_jump, 'meta': {'mode': 'video', 'frame_base': 0,
                                                                                   'width': 1600, 'height': 600, 'total_frames': 40}}})
        gt = [{'type': 'jump', 'a': 3, 'b': None, 'frame': 20}, {'type': 'gap', 'a': 5, 'b': None, 'frame': 30}]
        plain = benchmark.evaluate({'id': self.src['id'], 'ground_truth': gt}, self.anno)
        based = benchmark.evaluate({'id': self.src['id'], 'ground_truth': gt, 'baseline_boxes': rows}, self.anno)
        self.assertEqual(plain['fp'], 1)  # the gap of track 1 was in the clean labels already
        self.assertEqual((based['tp'], based['fp'], based['fn']), (1, 0, 1))

    def test_a_benchmark_copy_of_a_cvat_task_can_never_be_pushed(self):
        with projects.LOCK:
            d = projects.get(self.src['id'])
            d['cvat'] = {'url': 'http://cvat:8080', 'job_id': 5, 'start_frame': 0, 'stop_frame': 39, 'imported_by': 'anno'}
            projects._write(d)
        made = benchmark.make({'id': self.src['id'], 'id_switch': 1, 'seed': 3}, self.anno)
        self.assertTrue(projects.get(made['task_id'])['cvat']['benchmark_copy'])
        with self.assertRaisesRegex(ValueError, 'bộ thử'):
            cvat.push({'id': made['task_id']}, self.anno)


if __name__ == '__main__':
    unittest.main()
