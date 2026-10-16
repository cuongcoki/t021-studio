"""CVAT integration, one CVAT account per T021 user (storage/cvat_accounts.json).

- Settings: each user saves their own CVAT URL + login (or token). The password is only used once to
  get a token; only the token is stored, and it never goes back to the browser.
- Pull: a CVAT job becomes a T021 task — track keyframes are interpolated to one box per frame the way
  CVAT shows them; frames are streamed from CVAT on demand (nothing is copied).
- Push: the task's boxes replace the linked job's annotations, after saving a backup of what was there.
Plain urllib, no third-party packages (like the rest of the T021 backend).
"""
import json
import os
import threading
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from backend import projects

STORE = Path(__file__).resolve().parents[1] / 'storage'
LOCK = threading.RLock()
TIMEOUT = 60


# ── per-user accounts ───────────────────────────────────────────────────────


def _accounts_file():
    return STORE / 'cvat_accounts.json'


def _load():
    f = _accounts_file()
    return json.loads(f.read_text(encoding='utf-8')) if f.exists() else {}


def _write(data):
    f = _accounts_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    os.chmod(tmp, 0o600)
    tmp.replace(f)


def _url(value):
    url = str(value or '').strip().rstrip('/')
    parts = urlsplit(url)
    if parts.scheme not in ('http', 'https') or not parts.netloc:
        raise ValueError('URL CVAT phải dạng http://localhost:8080')
    return url


def _call(url, token, path, method='GET', body=None, raw=False):
    # CVAT answers 406 to a plain "application/json" Accept; its own media type works.
    headers = {'Accept': '*/*' if raw else 'application/vnd.cvat+json'}
    if token:
        headers['Authorization'] = f'Token {token}'
    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    try:
        with urlopen(Request(url + path, data=data, method=method, headers=headers), timeout=TIMEOUT) as res:
            payload = res.read()
            if raw:
                return payload, res.headers.get('Content-Type', 'application/octet-stream')
            return json.loads(payload) if payload else {}
    except HTTPError as exc:
        detail = exc.read()[:300].decode('utf-8', 'replace')
        if exc.code in (401, 403):
            raise PermissionError(f'CVAT từ chối ({exc.code}) — kiểm tra tài khoản CVAT trong Cài đặt. {detail}') from exc
        raise ValueError(f'CVAT trả lỗi {exc.code} cho {path}: {detail}') from exc
    except URLError as exc:
        raise ValueError(f'Không kết nối được CVAT tại {url}: {exc.reason}') from exc


def _account(actor):
    acc = _load().get(actor['username'])
    if not acc:
        raise ValueError('Bạn chưa kết nối CVAT — vào Cài đặt → CVAT để nhập tài khoản.')
    return acc


def account_status(_req, actor):
    acc = _load().get(actor['username'])
    if not acc:
        return {'configured': False}
    return {'configured': True, 'url': acc['url'], 'cvat_user': acc.get('cvat_user'), 'saved_at': acc.get('saved_at')}


def save_account(req, actor):
    """Verify the login against CVAT, then store url + token for this user."""
    url = _url(req.get('url'))
    token = str(req.get('token') or '').strip()
    if not token:
        username, password = str(req.get('username') or '').strip(), str(req.get('password') or '')
        if not username or not password:
            raise ValueError('Nhập tài khoản + mật khẩu CVAT, hoặc dán token')
        token = _call(url, None, '/api/auth/login', 'POST', {'username': username, 'password': password}).get('key')
        if not token:
            raise ValueError('CVAT không trả token đăng nhập')
    me = _call(url, token, '/api/users/self')
    with LOCK:
        data = _load()
        data[actor['username']] = {'url': url, 'token': token, 'cvat_user': me.get('username'),
                                   'saved_at': projects.now()}
        _write(data)
    about = _call(url, token, '/api/server/about')
    return {'configured': True, 'url': url, 'cvat_user': me.get('username'), 'cvat_version': about.get('version')}


def test_account(_req, actor):
    acc = _account(actor)
    me = _call(acc['url'], acc['token'], '/api/users/self')
    about = _call(acc['url'], acc['token'], '/api/server/about')
    return {'ok': True, 'url': acc['url'], 'cvat_user': me.get('username'), 'cvat_version': about.get('version')}


def delete_account(_req, actor):
    with LOCK:
        data = _load()
        data.pop(actor['username'], None)
        _write(data)
    return {'configured': False}


# ── browsing ────────────────────────────────────────────────────────────────


def _pages(acc, path):
    out, page = [], 1
    while True:
        sep = '&' if '?' in path else '?'
        res = _call(acc['url'], acc['token'], f'{path}{sep}page_size=100&page={page}')
        out += res.get('results', [])
        if not res.get('next'):
            return out
        page += 1


def list_jobs(_req, actor):
    acc = _account(actor)
    tasks = {t['id']: t for t in _pages(acc, '/api/tasks')}
    linked = {}
    for t in projects.list_projects()['projects']:
        job = (t.get('cvat') or {}).get('job_id')
        if job:
            linked.setdefault(job, []).append({'id': t['id'], 'name': t['name']})
    rows = []
    for j in _pages(acc, '/api/jobs'):
        task = tasks.get(j['task_id'], {})
        rows.append({'job_id': j['id'], 'task_id': j['task_id'], 'task_name': task.get('name', f"Task {j['task_id']}"),
                     'project_id': j.get('project_id'), 'start_frame': j.get('start_frame'),
                     'stop_frame': j.get('stop_frame'), 'frames': (j.get('stop_frame', 0) - j.get('start_frame', 0) + 1),
                     'dimension': j.get('dimension', '2d'), 'mode': task.get('mode'), 'state': j.get('state'),
                     'stage': j.get('stage'), 'assignee': (j.get('assignee') or {}).get('username'),
                     'linked_tasks': linked.get(j['id'], [])})
    rows.sort(key=lambda r: r['job_id'], reverse=True)
    return {'url': acc['url'], 'jobs': rows}


# ── CVAT annotations <-> T021 boxes (pure, unit-tested) ────────────────────


def _lerp(a, b, t):
    return [av + (bv - av) * t for av, bv in zip(a, b)]


def cvat_to_boxes(annotations, label_names, start, stop):
    """Rectangle tracks interpolated to every frame CVAT shows them on (keyframe flag kept), loose
    rectangles as untracked boxes (negative ids). Track ids are renumbered 1..n."""
    boxes = []
    for n, track in enumerate(sorted(annotations.get('tracks', []), key=lambda t: (t['frame'], t['id'])), start=1):
        name = label_names.get(track['label_id'], 'object')
        shapes = sorted((s for s in track['shapes'] if s.get('type') == 'rectangle'), key=lambda s: s['frame'])
        for i, s in enumerate(shapes):
            if s.get('outside'):
                continue
            nxt = shapes[i + 1] if i + 1 < len(shapes) else None
            end = nxt['frame'] - 1 if nxt else stop
            for f in range(max(s['frame'], start), min(end, stop) + 1):
                pts = s['points'] if not nxt or nxt.get('outside') else _lerp(
                    s['points'], nxt['points'], (f - s['frame']) / (nxt['frame'] - s['frame']))
                x1, y1, x2, y2 = pts[:4]
                boxes.append({'uid': f'cvat_t{n}_f{f}', 'frame_id': f, 'track_id': n, 'class_name': name,
                              'x': round(x1, 2), 'y': round(y1, 2), 'w': round(x2 - x1, 2), 'h': round(y2 - y1, 2),
                              'occluded': bool(s.get('occluded')), 'keyframe': f == s['frame']})
    loose = [s for s in annotations.get('shapes', []) if s.get('type') == 'rectangle' and start <= s['frame'] <= stop]
    for k, s in enumerate(sorted(loose, key=lambda s: (s['frame'], s['id'])), start=1):
        x1, y1, x2, y2 = s['points'][:4]
        boxes.append({'uid': f'cvat_s{s["id"]}', 'frame_id': s['frame'], 'track_id': -k,
                      'class_name': label_names.get(s['label_id'], 'object'), 'x': round(x1, 2), 'y': round(y1, 2),
                      'w': round(x2 - x1, 2), 'h': round(y2 - y1, 2), 'occluded': bool(s.get('occluded')),
                      'keyframe': True})
    return boxes


def _keep_keyframes(points, tolerance=0.5):
    """Indexes of boxes that must stay keyframes so CVAT's linear interpolation reproduces every box
    within `tolerance` px (Ramer–Douglas–Peucker over time)."""
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        (fi, bi), (fj, bj) = points[i], points[j]
        worst, worst_k = 0.0, -1
        for k in range(i + 1, j):
            fk, bk = points[k]
            expect = _lerp(bi, bj, (fk - fi) / (fj - fi))
            err = max(abs(e - a) for e, a in zip(expect, bk))
            if err > worst:
                worst, worst_k = err, k
        if worst > tolerance:
            keep.add(worst_k)
            stack += [(i, worst_k), (worst_k, j)]
    return sorted(keep)


def boxes_to_cvat(boxes, label_ids, stop_frame):
    """T021 boxes -> CVAT annotations payload: one track per track id (sparse keyframes, an `outside`
    keyframe after every run of frames), boxes with a negative id as loose shapes."""
    missing = sorted({b['class_name'] for b in boxes} - set(label_ids))
    if missing:
        raise ValueError('Job CVAT không có nhãn: ' + ', '.join(missing) + '. Thêm nhãn trên CVAT hoặc đổi class.')

    def shape(b, outside=False, keyframe=True):
        return {'type': 'rectangle', 'frame': b['frame_id'], 'points': [b['x'], b['y'], b['x'] + b['w'], b['y'] + b['h']],
                'occluded': bool(b.get('occluded')), 'outside': outside, 'keyframe': keyframe, 'z_order': 0,
                'rotation': 0, 'attributes': []}

    tracks, shapes = [], []
    by_track = {}
    for b in boxes:
        if b['track_id'] < 0:
            shapes.append({**shape(b), 'label_id': label_ids[b['class_name']], 'source': 'manual', 'group': 0})
        else:
            by_track.setdefault(b['track_id'], []).append(b)
    for tid, group in sorted(by_track.items()):
        group.sort(key=lambda b: b['frame_id'])
        classes = {b['class_name'] for b in group}
        if len(classes) > 1:
            raise ValueError(f'Track {tid} có nhiều class {sorted(classes)} — sửa Class Change trước khi đẩy lên CVAT.')
        runs, cur = [], [group[0]]
        for b in group[1:]:
            if b['frame_id'] == cur[-1]['frame_id'] + 1:
                cur.append(b)
            else:
                runs.append(cur)
                cur = [b]
        runs.append(cur)
        out = []
        for run in runs:
            pts = [(b['frame_id'], [b['x'], b['y'], b['x'] + b['w'], b['y'] + b['h']]) for b in run]
            for k in _keep_keyframes(pts):
                out.append(shape(run[k]))
            if run[-1]['frame_id'] < stop_frame:
                out.append(shape({**run[-1], 'frame_id': run[-1]['frame_id'] + 1}, outside=True))
        tracks.append({'frame': group[0]['frame_id'], 'label_id': label_ids[group[0]['class_name']], 'group': 0,
                       'source': 'manual', 'attributes': [], 'shapes': out})
    return {'version': 0, 'tags': [], 'shapes': shapes, 'tracks': tracks}


# ── import / frames / push ──────────────────────────────────────────────────


def _job_info(acc, job_id):
    job = _call(acc['url'], acc['token'], f'/api/jobs/{job_id}')
    if job.get('dimension', '2d') != '2d':
        raise ValueError('Job này là dữ liệu 3D — T021 chỉ làm video / ảnh 2D.')
    meta = _call(acc['url'], acc['token'], f'/api/jobs/{job_id}/data/meta')
    labels = _pages(acc, f'/api/labels?job_id={job_id}')
    return job, meta, {l['id']: l['name'] for l in labels}


def import_job(req, actor):
    """Admin / annotator: create a task from a CVAT job (annotations + frames on demand)."""
    from backend.auth import require
    require(actor, 'admin', 'annotator')
    acc = _account(actor)
    job_id = int(req.get('job_id'))
    job, meta, label_names = _job_info(acc, job_id)
    task = _call(acc['url'], acc['token'], f"/api/tasks/{job['task_id']}")
    start, stop = job['start_frame'], job['stop_frame']
    boxes = cvat_to_boxes(_call(acc['url'], acc['token'], f'/api/jobs/{job_id}/annotations'), label_names, start, stop)
    size = meta['frames'][0] if meta.get('frames') else {'width': 1920, 'height': 1080}
    name = str(req.get('name') or f"{task.get('name', 'CVAT')} · job {job_id}").strip()[:100]
    created = projects.create({'name': name, 'group_id': req.get('group_id'),
                               'annotator': req.get('annotator') if actor['role'] == 'admin' else actor['username'],
                               'reviewer': req.get('reviewer') if actor['role'] == 'admin' else None}, actor)['project']
    with projects.LOCK:
        d = projects.get(created['id'])
        d['cvat'] = {'url': acc['url'], 'job_id': job_id, 'task_id': job['task_id'], 'task_name': task.get('name'),
                     'start_frame': start, 'stop_frame': stop, 'imported_at': projects.now(),
                     'imported_by': actor['username'], 'pushed_at': None}
        projects._write(d)
    tracked = any(b['track_id'] >= 0 for b in boxes) or task.get('mode') == 'interpolation'
    state = {'boxes': boxes, 'source_name': f"CVAT job {job_id}", 'frame': start, 'fps': 30,
             'meta': {'format': 'cvat', 'mode': 'video' if tracked else 'images', 'frame_base': start,
                      'width': size['width'], 'height': size['height'], 'total_frames': stop - start + 1,
                      'labels': list(dict.fromkeys(label_names.values()))},
             'media': {'kind': 'cvat'}}
    projects.save({'id': d['id'], 'state': state})
    return {'project': projects.get(d['id']), 'boxes': len(boxes),
            'tracks': len({b['track_id'] for b in boxes if b['track_id'] >= 0})}


def _viewing_account(actor, task, link):
    """CVAT account to *read* frames with: the viewer's own when it points at the task's CVAT, else the
    account of whoever imported the task (or its annotator). Viewing needs no CVAT login of one's own —
    a reviewer only QCs; writing to CVAT (push) still uses the caller's own account."""
    accounts = _load()
    for who in (actor['username'], link.get('imported_by'), task.get('annotator')):
        acc = accounts.get(who or '')
        if acc and acc['url'] == link['url']:
            return acc
    raise ValueError(f"Chưa ai kết nối CVAT {link['url']} — người tạo task (hoặc bạn) vào Cài đặt → CVAT để kết nối.")


def frame(task_id, frame_number, actor):
    """One frame of the task's CVAT job (see _viewing_account for whose CVAT login is used)."""
    d = projects.get(task_id)
    link = d.get('cvat') or {}
    if not link.get('job_id'):
        raise ValueError('Task này không lấy từ CVAT')
    acc = _viewing_account(actor, d, link)
    return _call(acc['url'], acc['token'],
                 f"/api/jobs/{link['job_id']}/data?type=frame&number={int(frame_number)}&quality=compressed", raw=True)


def push(req, actor):
    """Annotator: replace the linked job's annotations with this task's boxes (backup first)."""
    from backend.auth import require
    require(actor, 'annotator')
    d = projects.get(req.get('id'))
    link = d.get('cvat') or {}
    if not link.get('job_id'):
        raise ValueError('Task này không liên kết job CVAT nào — chỉ task tạo từ CVAT mới đẩy về được.')
    if link.get('benchmark_copy'):
        raise ValueError('Đây là bộ thử có lỗi cấy vào — không được đẩy lên CVAT.')
    acc = _account(actor)
    if acc['url'] != link['url']:
        raise ValueError(f"Task thuộc CVAT {link['url']}, tài khoản của bạn trỏ tới {acc['url']}.")
    job_id = link['job_id']
    _, _, label_names = _job_info(acc, job_id)
    boxes = (d.get('state') or {}).get('boxes') or []
    payload = boxes_to_cvat(boxes, {name: lid for lid, name in label_names.items()}, link['stop_frame'])
    current = _call(acc['url'], acc['token'], f'/api/jobs/{job_id}/annotations')
    backups = STORE / 'cvat_backups'
    backups.mkdir(parents=True, exist_ok=True)
    backup = backups / f"{d['id']}_job{job_id}_{time.strftime('%Y%m%d-%H%M%S')}.json"
    backup.write_text(json.dumps(current, ensure_ascii=False), encoding='utf-8')
    _call(acc['url'], acc['token'], f'/api/jobs/{job_id}/annotations', 'PUT', payload)
    with projects.LOCK:
        d = projects.get(d['id'])
        d['cvat'] = {**d['cvat'], 'pushed_at': projects.now(), 'pushed_by': actor['username'],
                     'pushed_revision': d.get('revision', 0)}
        projects._write(d)
    return {'pushed': True, 'job_id': job_id, 'tracks': len(payload['tracks']), 'shapes': len(payload['shapes']),
            'keyframes': sum(len(t['shapes']) for t in payload['tracks']), 'backup': backup.name,
            'replaced': {'tracks': len(current.get('tracks', [])), 'shapes': len(current.get('shapes', []))}}
