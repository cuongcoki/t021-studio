"""Regression tests for FFmpeg 4.4-compatible decoding and informative failures."""
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import video


class VideoCompatibilityTests(unittest.TestCase):
    def test_decoder_uses_legacy_compatible_vsync(self):
        with patch.object(video.subprocess, 'run') as run:
            run.return_value = subprocess.CompletedProcess([], 0, b'\xff\xd8\xfffakejpeg', b'')
            raw = video.VideoStore._decode_path('/tmp/sample.mp4', 0)
            cmd = run.call_args.args[0]
            self.assertEqual(raw, b'\xff\xd8\xfffakejpeg')
            self.assertNotIn('-fps_mode', cmd)
            self.assertEqual(cmd[cmd.index('-vsync') + 1], '0')
            self.assertIn('-map', cmd)
            self.assertEqual(cmd[cmd.index('-map') + 1], '0:v:0')
            self.assertIn('select=eq(n\\,0)', cmd)

    def test_failure_returns_ffmpeg_detail(self):
        with patch.object(video.subprocess, 'run') as run:
            run.return_value = subprocess.CompletedProcess([], 1, b'', b'Unknown decoder AV1')
            with self.assertRaisesRegex(ValueError, 'Codec video'):
                video.VideoStore._decode_path('/tmp/sample.mp4', 0)

    def test_upload_rejects_undecodable_video_before_persisting(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(video, 'ROOT', Path(folder)):
                store = video.VideoStore()
                with patch.object(store, '_probe', return_value={'frame_count': 10, 'fps': 30}):
                    with patch.object(store, '_decode_path', side_effect=ValueError('Cannot decode frame 0')):
                        with self.assertRaisesRegex(ValueError, 'Cannot decode'):
                            store.add(io.BytesIO(b'dummy'),5,'sample.mp4')
                self.assertFalse(list(Path(folder).iterdir()))


if __name__ == '__main__':
    unittest.main()
