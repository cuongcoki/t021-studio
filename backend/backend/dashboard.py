"""Numbers for the dashboard: tasks by status, QC handoffs, work assigned to the signed-in user."""
from backend import auth, groups, projects


def summary(_req, actor):
    tasks = projects.list_projects()['projects']
    me = actor['username']
    by_status = {s: 0 for s in projects.STATUSES}
    qc = {'needs_fix': 0, 'fixed': 0, 'verified': 0, 'false_positive': 0}
    for t in tasks:
        by_status[t.get('status') or 'annotating'] = by_status.get(t.get('status') or 'annotating', 0) + 1
        for k, n in (t.get('qc') or {}).items():
            qc[k] = qc.get(k, 0) + n
    mine = [t for t in tasks if me in (t.get('annotator'), t.get('reviewer'))]
    # What the user should do next, by role.
    todo = {
        'annotator': [t for t in mine if t.get('annotator') == me and t.get('status') in ('annotating', 'needs_fix')],
        'reviewer': [t for t in mine if t.get('reviewer') == me and t.get('status') == 'in_review'],
        'admin': [t for t in tasks if not t.get('annotator') or not t.get('reviewer')],
    }.get(actor['role'], [])
    out = {
        'projects': len(groups.list_groups()['groups']),
        'tasks': len(tasks),
        'by_status': by_status,
        'qc': qc,
        'boxes': sum(t.get('box_count') or 0 for t in tasks),
        'frames': sum(t.get('frame_count') or 0 for t in tasks),
        'from_cvat': sum(1 for t in tasks if (t.get('cvat') or {}).get('job_id')),
        'mine': len(mine),
        'todo': todo[:8],
        'todo_count': len(todo),
        'recent': tasks[:6],
    }
    if actor['role'] == 'admin':
        people = auth.list_users({}, actor)['users']
        out['users'] = {r: sum(1 for u in people if u['role'] == r) for r in sorted(auth.ROLES)}
        out['users_inactive'] = sum(1 for u in people if not u['active'])
    return out
