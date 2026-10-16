"""Benchmark the QC rules against ground truth (the T021 target: Precision >= 0.85, Recall >= 0.80).

- make: copy a clean task and plant known errors in the copy (ID switch, gap, box jump). The planted
  errors ARE the ground truth; issues the rules already raise on the clean data are kept as a
  `baseline`, so they don't count as false alarms later.
- evaluate: scan the task on the server and match its issues to the ground truth the same way
  core/evaluation/metrics.py does (same type, same track, frame within +-tolerance, one-to-one),
  overall and per issue type, with the missed / false issues listed so a reviewer can look at them.
"""
import copy
import random
import time

from backend import projects
from core.models import normalize_boxes
from core.validators.engine import validate

KINDS = {
    'id_switch': 'ID Switch Candidate',
    'gap': 'Gap Frame',
    'jump': 'Box Jump',
}
MAX_PER_KIND = 20

# The team's injection files (`<video>.truth.json`): [{type, a, b, frame}], a = the damaged track,
# b = the new / partner track. -> (T021 issue type, frames after `frame` the rule may report it at).
TEAM_TYPES = {
    'fragment': ('ID Switch Candidate', 6),   # a ends at `frame`, b starts a few frames later
    'switch': ('ID Switch Candidate', 0),
    'gap': ('Gap Frame', 2),                  # `frame` = last frame before the hole
    'jump': ('Box Jump', 0),
    'class_flip': ('Class Change', 0),
    'duplicate': ('Duplicate Object Candidate', 0),
}


def _scan(state):
    meta = state.get('meta') or {}
    return validate(state.get('boxes') or [], meta.get('width'), meta.get('height'), meta.get('mode', 'video'),
                    meta.get('total_frames'), meta.get('frame_base'))['issues']


def _runs(frames):
    """Contiguous runs of a sorted frame list."""
    runs, cur = [], [frames[0]]
    for f in frames[1:]:
        if f == cur[-1] + 1:
            cur.append(f)
        else:
            runs.append(cur)
            cur = [f]
    runs.append(cur)
    return runs


def inject(boxes, counts, seed=0):
    """Plant errors on distinct tracks; returns (new boxes, ground-truth events). Events use the frame /
    track the rules report: gap -> first missing frame; ID switch -> first frame of the new id; jump -> the spiked frame."""
    rng = random.Random(seed)
    out = copy.deepcopy(normalize_boxes(boxes))
    by_track = {}
    for b in out:
        if b['track_id'] >= 0:
            by_track.setdefault(b['track_id'], {})[b['frame_id']] = b
    # tracks with a long contiguous stretch to work in, longest first, shuffled within ties
    cands = []
    for tid, fr in by_track.items():
        run = max(_runs(sorted(fr)), key=len)
        if len(run) >= 12:
            cands.append((tid, run))
    rng.shuffle(cands)
    cands.sort(key=lambda c: -len(c[1]))
    next_id = max([b['track_id'] for b in out] + [0]) + 1
    events, removed = [], set()
    plan = [k for k in ('id_switch', 'gap', 'jump') for _ in range(min(MAX_PER_KIND, int(counts.get(k, 0))))]
    for kind in plan:
        if not cands:
            break
        tid, run = cands.pop(0)
        fr = by_track[tid]
        mid = run[len(run) // 3: 2 * len(run) // 3] or run
        f = rng.choice(mid)
        if kind == 'id_switch':
            for g in run:
                if g >= f:
                    fr[g]['track_id'] = next_id
            events.append({'type': KINDS[kind], 'frame': f, 'track_id': next_id, 'planted': 'id_switch'})
            next_id += 1
        elif kind == 'gap':
            n = rng.choice((2, 3))
            for g in range(f, f + n):
                if g in fr:
                    removed.add(fr[g]['uid'])
            events.append({'type': KINDS[kind], 'frame': f, 'track_id': tid, 'planted': f'gap {n} frame'})
        else:  # jump: one frame pushed sideways by ~3 box sizes, the neighbours untouched
            b = fr[f]
            size = max(12.0, (b['w'] * b['h']) ** 0.5)
            b['x'] = max(0.0, b['x'] + rng.choice((-1, 1)) * 3.2 * size)
            events.append({'type': KINDS[kind], 'frame': f, 'track_id': tid, 'planted': 'box jump'})
    out = [b for b in out if b['uid'] not in removed]
    return out, events


def make(req, actor):
    """Annotator: a copy of task `id` with planted errors + its ground-truth document."""
    from backend.auth import require
    require(actor, 'annotator')
    src = projects.get(req.get('id'))
    state = src.get('state') or {}
    if not state.get('boxes'):
        raise ValueError('Task nguồn chưa có nhãn để cấy lỗi')
    counts = {k: int(req.get(k, 2)) for k in KINDS}
    seed = int(req.get('seed', time.time()))
    baseline = [{k: i[k] for k in ('type', 'frame', 'track_id')} for i in _scan(state)]
    boxes, events = inject(state['boxes'], counts, seed)
    if not events:
        raise ValueError('Không tìm được track đủ dài (>= 12 frame liên tục) để cấy lỗi')
    copy_task = projects.create({'name': f"{src['name'][:80]} · bộ thử", 'group_id': src.get('group_id')}, actor)['project']
    if src.get('cvat'):  # frames still come from the same CVAT job, but this copy must never be pushed
        with projects.LOCK:
            d = projects.get(copy_task['id'])
            d['cvat'] = {**src['cvat'], 'benchmark_copy': True}
            projects._write(d)
    projects.save({'id': copy_task['id'], 'state': {**state, 'boxes': boxes, 'source_name': f"bộ thử từ {src['name'][:60]}"}})
    doc = {'kind': 't021_ground_truth', 'source_task': src['id'], 'benchmark_task': copy_task['id'], 'seed': seed,
           'created_at': projects.now(), 'created_by': actor['username'], 'tolerance': 2,
           'ground_truth': events, 'baseline': baseline}
    return {'task_id': copy_task['id'], 'ground_truth': doc}


def normalize_gt(events):
    """Accept T021 events {type, frame, track_id} and the team's truth.json {type, a, b, frame}."""
    out = []
    for e in events:
        if not isinstance(e, dict):
            raise ValueError('Mỗi dòng GT phải là object')
        if 'a' in e and 'track_id' not in e:
            kind = str(e.get('type', '')).lower()
            if kind not in TEAM_TYPES:
                raise ValueError(f'Loại lỗi GT không biết: {e.get("type")}')
            t, after = TEAM_TYPES[kind]
            tracks = [int(e['a'])] + ([int(e['b'])] if e.get('b') is not None else [])
            ab = f"{e['a']}→{e['b']}" if e.get('b') is not None else f"{e['a']}"
            out.append({'type': t, 'frame': int(e['frame']), 'track_id': tracks[0], 'tracks': tracks,
                        'frame_to': int(e['frame']) + after, 'planted': f'{kind} {ab}'})
        else:
            try:
                out.append({**e, 'frame': int(e['frame']), 'track_id': int(e['track_id'])})
            except (KeyError, TypeError, ValueError) as exc:
                raise ValueError('Mỗi dòng GT cần type, frame, track_id (hoặc a, b, frame)') from exc
    return out


def _hits(p, g, tol):
    if p['type'] != g['type']:
        return False
    tracks = set(g.get('tracks') or [g['track_id']])
    if int(p['track_id']) not in tracks and not tracks & set(p.get('pair') or []):
        return False
    return int(g['frame']) - tol <= int(p['frame']) <= int(g.get('frame_to', g['frame'])) + tol


def _match(pred, gt, tol):
    """Greedy one-to-one like core/evaluation/metrics.py (same type, same track, frame +-tol), also
    accepting the partner track / a report a few frames later for the team's event kinds."""
    used, pairs = set(), []
    for pi, p in enumerate(pred):
        for gi, g in enumerate(gt):
            if gi not in used and _hits(p, g, tol):
                used.add(gi)
                pairs.append((pi, gi))
                break
    return pairs


def _score(pred, gt, tol):
    tp = len(_match(pred, gt, tol))
    fp, fn = len(pred) - tp, len(gt) - tp
    prec = tp / (tp + fp) if tp + fp else 0
    rec = tp / (tp + fn) if tp + fn else 0
    return {'tp': tp, 'fp': fp, 'fn': fn, 'precision': round(prec, 4), 'recall': round(rec, 4),
            'f1': round(2 * prec * rec / (prec + rec), 4) if prec + rec else 0,
            'target_met': prec >= .85 and rec >= .80}


def _absent(g, boxes):
    """A GT error the data can't contain: a class change on a track that has one class only
    (CVAT track XML keeps one label per track, so such an injection never lands)."""
    if g['type'] != 'Class Change':
        return False
    classes = {b['class_name'] for b in boxes if b['track_id'] == g['track_id']}
    return len(classes) <= 1


def evaluate(req, _actor):
    """Scan the stored task and score its issues against `ground_truth` (minus `baseline`)."""
    gt = req.get('ground_truth')
    if not isinstance(gt, list) or not gt:
        raise ValueError('File GT cần mảng "ground_truth": [{type, frame, track_id}, …]')
    gt = normalize_gt(gt)
    tol = max(0, min(10, int(req.get('tolerance', 2))))
    task = projects.get(req.get('id'))
    state = task.get('state') or {}
    issues = _scan(state)
    pred = [{**{k: i[k] for k in ('type', 'frame', 'track_id', 'message', 'severity')},
             'pair': (i.get('fix_data') or {}).get('pair') or []} for i in issues]
    boxes = normalize_boxes(state.get('boxes') or [])
    absent = [g for g in gt if _absent(g, boxes)]
    gt = [g for g in gt if not _absent(g, boxes)]
    if not gt:
        raise ValueError('Không lỗi GT nào có trong dữ liệu của task này')
    baseline = normalize_gt(req.get('baseline') or [])
    if req.get('baseline_boxes'):  # the clean labels of the same video: whatever they already raise is not the tool's fault
        baseline += [{k: i[k] for k in ('type', 'frame', 'track_id')} for i in _scan({**state, 'boxes': req['baseline_boxes']})]
    if baseline:  # issues the clean data already had are not the tool's fault
        keep = set(range(len(pred))) - {pi for pi, _ in _match(pred, baseline, tol)}
        pred = [p for i, p in enumerate(pred) if i in keep]
    if req.get('only_gt_types', True):
        types = {g['type'] for g in gt}
        pred = [p for p in pred if p['type'] in types]
    total = _score(pred, gt, tol)  # = core evaluate_events for plain GT, + partner-track/late-report rules
    pairs = _match(pred, gt, tol)
    hit_p, hit_g = {p for p, _ in pairs}, {g for _, g in pairs}
    by_type = {}
    for t in sorted({g['type'] for g in gt} | {p['type'] for p in pred}):
        r = _score([p for p in pred if p['type'] == t], [g for g in gt if g['type'] == t], tol)
        by_type[t] = {k: r[k] for k in ('tp', 'fp', 'fn', 'precision', 'recall', 'f1')}
    return {**total, 'tolerance': tol, 'by_type': by_type, 'predicted': len(pred), 'ground_truth': len(gt),
            'baseline_ignored': len(baseline), 'absent_in_data': absent,
            'note': 'Khớp 1–1: cùng loại lỗi, cùng track (hoặc track đối ứng), lệch tối đa ±tolerance frame.',
            'missed': [g for i, g in enumerate(gt) if i not in hit_g],
            'false_alarms': [p for i, p in enumerate(pred) if i not in hit_p]}
