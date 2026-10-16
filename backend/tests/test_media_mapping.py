"""Regression suite for sampled-frame ZIP + CVAT XML alignment."""
import io
import unittest
import zipfile
from pathlib import Path
from backend.media import MediaStore
from core.parsers import parse_cvat

ROOT = Path(__file__).resolve().parents[1]
SAMPLE_XML = Path('/mnt/data/annotations_tracks.xml')
SAMPLE_ZIP = Path('/mnt/data/frames.zip')


def make_zip(names):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as z:
        for name in names:
            z.writestr(name, b'\xff\xd8\xff\xe0mock')
    return out.getvalue()


class ArchiveMappingTest(unittest.TestCase):
    def test_natural_sorted_sampled_names(self):
        store=MediaStore()
        result=store.upload_zip(make_zip(['task_000007.jpg','task_000001.jpg','task_000004.jpg']), 'task', 3)
        self.assertEqual(result['files'],['task_000001.jpg','task_000004.jpg','task_000007.jpg'])
        self.assertEqual(result['count'],3)
        self.assertTrue(store.get(result['token'], 0)[0].startswith(b'\xff\xd8'))
        self.assertIsNone(store.get(result['token'], 3))

    def test_mismatch_is_explicit_warning(self):
        result=MediaStore().upload_zip(make_zip(['x_001.jpg','x_002.jpg']), 'other_task', 4)
        self.assertEqual(len(result['warnings']),2)

    def test_reject_path_collision(self):
        with self.assertRaisesRegex(ValueError, 'trùng'):
            MediaStore().upload_zip(make_zip(['a/x.jpg','b/x.jpg']))

    def test_reject_non_images(self):
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:z.writestr('notes.txt','x')
        with self.assertRaisesRegex(ValueError,'không có ảnh'):
            MediaStore().upload_zip(out.getvalue())

    def test_reject_wrong_extension_payload(self):
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:z.writestr('bad.jpg',b'not jpg')
        with self.assertRaisesRegex(ValueError,'không khớp'):
            MediaStore().upload_zip(out.getvalue())

    @unittest.skipUnless(SAMPLE_XML.exists() and SAMPLE_ZIP.exists(),'Uploaded fixture not present')
    def test_actual_user_dataset(self):
        parsed=parse_cvat(SAMPLE_XML.read_text())
        result=MediaStore().upload_zip(SAMPLE_ZIP.read_bytes(),parsed['task_name'],parsed['total_frames'])
        self.assertEqual(parsed['total_frames'],38)
        self.assertEqual(result['count'],38)
        self.assertEqual(parsed['frame_base'],0)
        self.assertEqual(result['files'][0],'000d4f89-3bcbe37a_000001.jpg')
        self.assertEqual(result['files'][1],'000d4f89-3bcbe37a_000004.jpg')
        self.assertEqual(result['files'][37],'000d4f89-3bcbe37a_000201.jpg')
        self.assertEqual(result['warnings'],[])

if __name__=='__main__':unittest.main(verbosity=2)
