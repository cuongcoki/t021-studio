"""After a server restart, frames of a stored frames.zip are requested concurrently (the React
workspace prefetches the next frames). Restoring must not race."""
import io
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from backend import media

JPEG = b'\xff\xd8\xff\xe0' + b'0' * 64


def frames_zip(n):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        for i in range(n):
            z.writestr(f'frame_{i:04d}.jpg', JPEG)
    return buf.getvalue()


class RestoreTests(unittest.TestCase):
    def test_concurrent_requests_after_restart_all_get_their_frame(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(media, 'ZIP_ROOT', Path(tmp)):
            store = media.MediaStore()
            token = store.upload_zip(frames_zip(6))['token']
            restarted = media.MediaStore()  # empty in-memory cache, ZIP still on disk
            results, errors = {}, []

            def fetch(i):
                try:
                    results[i] = restarted.get(token, i % 6)
                except Exception as exc:  # noqa: BLE001 - the regression raised KeyError here
                    errors.append(repr(exc))

            threads = [threading.Thread(target=fetch, args=(i,)) for i in range(8)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            self.assertEqual(errors, [])
            self.assertTrue(all(results[i] is not None for i in range(8)))
            self.assertEqual(list(restarted.sessions), [token])  # no temporary tokens left behind
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), [token + '.zip'])


if __name__ == '__main__':
    unittest.main()
