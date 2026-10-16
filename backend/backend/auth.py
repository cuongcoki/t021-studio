"""Local accounts for T021. Roles enforced by API, not by a browser dropdown.

First start: set up an admin, then create separate annotator and reviewer accounts.
Sessions survive a server restart: storage/sessions.json keeps only a SHA-256 of each token,
and a session that is used keeps sliding forward (SESSION_SECONDS of inactivity ends it).
"""
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import threading
import time

USERS_FILE = Path(__file__).resolve().parents[1] / 'storage' / 'users.json'
LOCK = threading.RLock()
SESSIONS = {}  # sha256(token) -> {username, role, expiry}; loaded from disk on first use
SESSION_SECONDS = 7 * 24 * 3600
_SESSIONS_LOADED = []
ROLES = {'admin', 'annotator', 'reviewer'}

def _load():
    if not USERS_FILE.exists():
        return {}
    return json.loads(USERS_FILE.read_text(encoding='utf-8'))

def _write(accounts):
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = USERS_FILE.with_suffix('.tmp')
    with tmp.open('w', encoding='utf-8') as f:
        json.dump(accounts, f, ensure_ascii=False)
    os.chmod(tmp, 0o600)
    tmp.replace(USERS_FILE)

def _sessions_file():
    return USERS_FILE.with_name('sessions.json')  # follows USERS_FILE (tests patch it)

def _digest(token):
    return hashlib.sha256(str(token or '').encode('utf-8')).hexdigest()

def _load_sessions():
    """Once per process: read the saved sessions, dropping expired ones."""
    if _SESSIONS_LOADED:
        return
    _SESSIONS_LOADED.append(True)
    try:
        saved = json.loads(_sessions_file().read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return
    now = time.time()
    for key, sess in saved.items():
        if isinstance(sess, dict) and sess.get('expiry', 0) > now:
            SESSIONS.setdefault(key, sess)

def _save_sessions():
    path = _sessions_file()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix('.tmp')
        tmp.write_text(json.dumps(SESSIONS), encoding='utf-8')
        os.chmod(tmp, 0o600)
        tmp.replace(path)
    except OSError:
        pass  # sessions still work in memory

def _key(username):
    name = str(username).strip()
    if not 3 <= len(name) <= 50 or not all(ch.isalnum() or ch in '_-.' for ch in name):
        raise ValueError('Tên tài khoản dài 3–50 ký tự (chữ, số, _, -, .)')
    return name

def _password(value):
    if not isinstance(value, str) or not 8 <= len(value) <= 200:
        raise ValueError('Mật khẩu phải dài ít nhất 8 ký tự')
    return value

def _hash(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), bytes.fromhex(salt), 280_000).hex()

def status():
    return {'needs_setup': not bool(_load()), 'roles': sorted(ROLES)}

def setup(req):
    with LOCK:
        if _load():
            raise ValueError('Đã có tài khoản quản trị, không thể khởi tạo lại')
        name = _key(req.get('username'))
        password = _password(req.get('password'))
        salt = secrets.token_hex(16)
        _write({name: {'username': name, 'role': 'admin', 'salt': salt, 'password_hash': _hash(password, salt),
                       'active': True, 'created_at': _now(), 'updated_at': _now(), **_profile(req)}})
        return {'created': True, 'username': name, 'role': 'admin'}

def login(req):
    with LOCK:
        name = _key(req.get('username'))
        password = str(req.get('password', ''))
        user = _load().get(name)
        if not user or not hmac.compare_digest(_hash(password, user['salt']), user['password_hash']):
            raise ValueError('Tài khoản hoặc mật khẩu không chính xác')
        if user.get('active') is False:
            raise ValueError('Tài khoản đã bị khoá; liên hệ Admin')
        token = secrets.token_urlsafe(32)
        _load_sessions()
        now = time.time()
        for key in [k for k, v in SESSIONS.items() if v['expiry'] < now]:
            SESSIONS.pop(key, None)
        SESSIONS[_digest(token)] = {'username': name, 'role': user['role'], 'expiry': now + SESSION_SECONDS}
        _save_sessions()
        return {'token': token, 'user': {'username': name, 'role': user['role']}}

def verify(token):
    with LOCK:
        _load_sessions()
        key = _digest(token)
        session = SESSIONS.get(key) if token else None
        now = time.time()
        if not session or session['expiry'] < now:
            if SESSIONS.pop(key, None):
                _save_sessions()
            raise PermissionError('Phiên đăng nhập không hợp lệ hoặc hết hạn; hãy đăng nhập lại')
        if session['expiry'] - now < SESSION_SECONDS - 3600:  # slide forward, written at most hourly
            session['expiry'] = now + SESSION_SECONDS
            _save_sessions()
        return {'username': session['username'], 'role': session['role']}


def _drop_sessions(username):
    _load_sessions()
    for key in [k for k, v in SESSIONS.items() if v['username'] == username]:
        SESSIONS.pop(key, None)
    _save_sessions()

def logout(token):
    with LOCK:
        _load_sessions()
        if SESSIONS.pop(_digest(token), None):
            _save_sessions()
    return {'ok': True}

def _now():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def _profile(req, old=None):
    old = old or {}
    full_name = str(req.get('full_name', old.get('full_name', ''))).strip()[:100]
    email = str(req.get('email', old.get('email', ''))).strip()[:120]
    if email and ('@' not in email or ' ' in email):
        raise ValueError('Email không hợp lệ')
    return {'full_name': full_name, 'email': email}


def public(user):
    return {'username': user['username'], 'role': user['role'], 'full_name': user.get('full_name', ''),
            'email': user.get('email', ''), 'active': user.get('active', True),
            'created_at': user.get('created_at'), 'updated_at': user.get('updated_at')}


def create_user(req, actor):
    require(actor, 'admin')
    name = _key(req.get('username'))
    password = _password(req.get('password'))
    role = req.get('role')
    if role not in ROLES:
        raise ValueError('Vai trò phải là admin, annotator hoặc reviewer')
    with LOCK:
        users = _load()
        if name in users:
            raise ValueError('Tài khoản đã tồn tại')
        salt = secrets.token_hex(16)
        users[name] = {'username': name, 'role': role, 'salt': salt, 'password_hash': _hash(password, salt),
                       'active': True, 'created_at': _now(), 'updated_at': _now(), **_profile(req)}
        _write(users)
    return {'created': True, 'username': name, 'role': role, 'user': public(users[name])}


def list_users(req, actor):
    """Admin: every account, optionally filtered by `q` (username/name/email), `role`, `active`."""
    require(actor, 'admin')
    req = req or {}
    q = str(req.get('q', '')).strip().lower()
    role = req.get('role') or None
    active = req.get('active')
    rows = []
    for u in _load().values():
        p = public(u)
        if q and q not in (p['username'] + ' ' + p['full_name'] + ' ' + p['email']).lower():
            continue
        if role and p['role'] != role:
            continue
        if active is not None and p['active'] != bool(active):
            continue
        rows.append(p)
    rows.sort(key=lambda r: r['username'])
    return {'users': rows}


def list_people(_, actor):
    """Any signed-in user: who can be assigned to a task (no admin-only data)."""
    return {'users': [{'username': u['username'], 'role': u['role'], 'full_name': u.get('full_name', '')}
                      for u in _load().values() if u.get('active', True)]}


def _admins_left(users, excluding):
    return sum(1 for u in users.values()
               if u['role'] == 'admin' and u.get('active', True) and u['username'] != excluding)


def update_user(req, actor):
    """Admin: change role, name, email, active flag, or reset the password."""
    require(actor, 'admin')
    name = _key(req.get('username'))
    with LOCK:
        users = _load()
        user = users.get(name)
        if not user:
            raise ValueError('Không tìm thấy tài khoản')
        role = req.get('role', user['role'])
        if role not in ROLES:
            raise ValueError('Vai trò phải là admin, annotator hoặc reviewer')
        active = bool(req.get('active', user.get('active', True)))
        if name == actor['username'] and not active:
            raise ValueError('Không thể tự khoá tài khoản của mình')
        if user['role'] == 'admin' and (role != 'admin' or not active) and not _admins_left(users, name):
            raise ValueError('Phải còn ít nhất một Admin đang hoạt động')
        changed_role = role != user['role']
        user.update(role=role, active=active, updated_at=_now(), **_profile(req, user))
        if req.get('password'):
            user['salt'] = secrets.token_hex(16)
            user['password_hash'] = _hash(_password(req['password']), user['salt'])
        _write(users)
        if req.get('password') or not active or changed_role:
            _drop_sessions(name)  # takes effect at once: the user signs in again
        return {'user': public(user)}


def delete_user(req, actor):
    require(actor, 'admin')
    name = _key(req.get('username'))
    if name == actor['username']:
        raise ValueError('Không thể xoá chính tài khoản đang đăng nhập')
    with LOCK:
        users = _load()
        user = users.get(name)
        if not user:
            raise ValueError('Không tìm thấy tài khoản')
        if user['role'] == 'admin' and not _admins_left(users, name):
            raise ValueError('Phải còn ít nhất một Admin')
        del users[name]
        _write(users)
        _drop_sessions(name)
    return {'deleted': True, 'username': name}


def require(actor, *roles):
    if actor['role'] not in roles:
        raise PermissionError('Không đủ quyền: yêu cầu vai trò ' + '/'.join(roles))
