"""Projects as shown in the UI: a named group of tasks (e.g. one CVAT project or one data batch).

Note on names: the original T021 code calls one annotated sequence a "project" (backend/projects.py,
/api/projects/*). In this UI that unit is a **Task**; this module holds the **Project** that groups
tasks. Stored in storage/groups.json.
"""
import json
import re
import secrets
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'storage'
LOCK = threading.RLock()
ID_RE = re.compile(r'^[A-Za-z0-9_-]{8,64}$')


def _file():
    return ROOT / 'groups.json'


def _load():
    f = _file()
    return json.loads(f.read_text(encoding='utf-8')) if f.exists() else {}


def _write(groups):
    f = _file()
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix('.tmp')
    tmp.write_text(json.dumps(groups, ensure_ascii=False), encoding='utf-8')
    tmp.replace(f)


def _name(value):
    name = str(value or '').strip()
    if not 1 <= len(name) <= 100:
        raise ValueError('Tên Project dài 1–100 ký tự')
    return name


def get(group_id):
    if not isinstance(group_id, str) or not ID_RE.fullmatch(group_id):
        raise ValueError('Project ID không hợp lệ')
    group = _load().get(group_id)
    if not group:
        raise ValueError('Không tìm thấy Project')
    return group


def list_groups(_req=None, _actor=None):
    from backend import projects  # task counts per project
    tasks = projects.list_projects()['projects']
    rows = []
    for g in _load().values():
        mine = [t for t in tasks if t.get('group_id') == g['id']]
        status = {}
        for t in mine:
            status[t.get('status', 'annotating')] = status.get(t.get('status', 'annotating'), 0) + 1
        rows.append({**g, 'task_count': len(mine), 'status_counts': status})
    rows.sort(key=lambda r: r.get('updated_at') or '', reverse=True)
    return {'groups': rows}


def create(req, actor):
    from backend.projects import now
    with LOCK:
        groups = _load()
        group_id = secrets.token_urlsafe(9)
        date = now()
        groups[group_id] = {'id': group_id, 'name': _name(req.get('name')),
                            'description': str(req.get('description', '')).strip()[:500],
                            'created_by': actor['username'], 'created_at': date, 'updated_at': date}
        _write(groups)
        return {'group': groups[group_id]}


def update(req, _actor):
    from backend.projects import now
    with LOCK:
        groups = _load()
        group = groups.get(get(req.get('id'))['id'])
        if 'name' in req:
            group['name'] = _name(req['name'])
        if 'description' in req:
            group['description'] = str(req['description']).strip()[:500]
        group['updated_at'] = now()
        _write(groups)
        return {'group': group}


def delete(req, _actor):
    """Deletes the Project; its tasks stay but become ungrouped (nothing is lost)."""
    from backend import projects
    with LOCK:
        group = get(req.get('id'))
        groups = _load()
        del groups[group['id']]
        _write(groups)
    moved = projects.ungroup(group['id'])
    return {'deleted': True, 'id': group['id'], 'tasks_ungrouped': moved}
