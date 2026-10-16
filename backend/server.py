"""Zero-dependency local T021 server: python3 server.py --no-browser"""
import argparse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import json
import logging
from http.cookies import SimpleCookie
import threading
import webbrowser
from urllib.parse import urlsplit, unquote
from backend.orchestrator import ROUTES
from core.parsers import parse_cvat_archive
from backend.media import STORE, MAX_ZIP_BYTES
from backend.video import VIDEO, MAX_VIDEO_BYTES
from backend import projects, auth, workflow, groups, cvat, dashboard, benchmark

ROOT=Path(__file__).resolve().parent
# The React app (../frontend, `npm run build`) when built; the original static UI otherwise.
DIST=ROOT.parent/'frontend'/'dist'
STATIC=DIST if (DIST/'index.html').exists() else ROOT/'static'
# own cookie name: the old T021 on another localhost port uses 't021session', and browsers share
# cookies across ports, so the two apps kept signing each other out
COOKIE='t021studio_session'
MAX=60_000_000

# Routes added for the React UI: handler(req, actor) and the roles allowed to call it (None = any user).
ACTOR_ROUTES = {
    '/api/auth/update-user': (auth.update_user, ('admin',)),
    '/api/auth/delete-user': (auth.delete_user, ('admin',)),
    '/api/auth/people': (auth.list_people, None),
    '/api/groups/list': (groups.list_groups, None),
    '/api/groups/create': (groups.create, ('admin', 'annotator')),
    '/api/groups/update': (groups.update, ('admin', 'annotator')),
    '/api/groups/delete': (groups.delete, ('admin', 'annotator')),
    '/api/projects/update': (projects.update_meta, None),  # checks per field / role inside
    '/api/dashboard': (dashboard.summary, None),
    '/api/cvat/account': (cvat.account_status, None),
    '/api/cvat/account/save': (cvat.save_account, None),
    '/api/cvat/account/test': (cvat.test_account, None),
    '/api/cvat/account/delete': (cvat.delete_account, None),
    '/api/cvat/jobs': (cvat.list_jobs, None),
    '/api/cvat/import': (cvat.import_job, ('admin', 'annotator')),
    '/api/cvat/push': (cvat.push, ('annotator',)),
    '/api/benchmark/make': (benchmark.make, ('annotator',)),
    '/api/benchmark/evaluate': (benchmark.evaluate, None),
}
PROJECT_ROUTES = {'/api/projects/list':projects.list_projects,'/api/projects/create':projects.create,
                  '/api/projects/save':projects.save,'/api/projects/open':projects.open_project,
                  '/api/projects/rename':projects.rename,'/api/projects/delete':projects.delete}

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(STATIC),**kwargs)
    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        # style-src needs 'unsafe-inline' for the React UI's toasts / positioned popovers.
        self.send_header('Content-Security-Policy',"default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; object-src 'none'")
        super().end_headers()
    def json(self,obj,code=200,headers=None):
        raw=json.dumps(obj,ensure_ascii=False,allow_nan=False).encode('utf-8')
        self.send_response(code);self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(raw)))
        for name,value in (headers or {}).items():self.send_header(name,value)
        self.end_headers();self.wfile.write(raw)
    def actor(self):
        header = self.headers.get('Authorization', '')
        if header.startswith('Bearer '):return auth.verify(header[7:])
        cookies=SimpleCookie()
        try:cookies.load(self.headers.get('Cookie',''))
        except Exception:pass
        token=cookies[COOKIE].value if COOKIE in cookies else ''
        return auth.verify(token)
    def do_GET(self):
        path=urlsplit(self.path).path
        if path=='/api/auth/status':
            # also says who is signed in (None when not), so the UI needs no failing /me call
            try:user=self.actor()
            except PermissionError:user=None
            return self.json({**auth.status(),'user':user})
        if path=='/api/health':
            return self.json({'ok':True,'name':'T021 Track ID QA','version':'2.5.0-cvat-import'})
        if path.startswith('/api/video/') or path.startswith('/api/media/') or path.startswith('/api/cvat/'):
            try:actor=self.actor()
            except PermissionError as exc:return self.json({'error':str(exc)},403)
        if path.startswith('/api/cvat/frame/'):
            # /api/cvat/frame/{task_id}/{frame}: proxied with the viewer's own CVAT account
            parts=path.split('/')
            if len(parts)!=6 or not parts[5].isdigit():
                return self.json({'error':'Đường dẫn frame CVAT không hợp lệ'},404)
            try:data,mime=cvat.frame(parts[4],int(parts[5]),actor)
            except PermissionError as exc:return self.json({'error':str(exc)},403)
            except ValueError as exc:return self.json({'error':str(exc)},422)
            self.send_response(200);self.send_header('Content-Type',mime)
            self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
            return
        if path=='/api/video/diagnostics':
            return self.json({'ok':True,'version':'2.5.0-cvat-import','ffmpeg':VIDEO.diagnostics()})
        if path.startswith('/api/video/'):
            # /api/video/{token}/frame/{source_frame_index}
            parts=path.split('/')
            if len(parts)!=6 or parts[4]!='frame' or not parts[5].isdigit():
                return self.json({'error':'Đường dẫn frame video không hợp lệ'},404)
            try:
                data=VIDEO.frame(parts[3],int(parts[5]))
            except ValueError as exc:
                return self.json({'error':str(exc)},422)
            self.send_response(200)
            self.send_header('Content-Type','image/jpeg')
            self.send_header('Content-Length',str(len(data)))
            self.end_headers();self.wfile.write(data)
            return
        if path.startswith('/api/media/'):
            parts = path.split('/')
            if len(parts)!=5 or not parts[4].isdigit():
                return self.json({'error':'Đường dẫn ảnh không hợp lệ'},404)
            img = STORE.get(parts[3], int(parts[4]))
            if img is None:
                return self.json({'error':'Ảnh không tồn tại hoặc phiên media hết hạn'},404)
            data, mime = img
            self.send_response(200)
            self.send_header('Content-Type',mime)
            self.send_header('Content-Length',str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if not path.startswith('/api/') and STATIC==DIST and not (STATIC/path.lstrip('/')).is_file():
            self.path='/index.html'  # client-side routes of the React app
        return super().do_GET()
    def do_POST(self):
        route=urlsplit(self.path).path
        auth_routes={'/api/auth/setup','/api/auth/login','/api/auth/logout',
                     '/api/auth/create-user','/api/auth/users','/api/auth/me'}
        workflow_routes={'/api/workflow/list','/api/workflow/transition'}
        if route not in ('/api/media/upload-zip','/api/video/upload','/api/annotation/import') and route not in ROUTES and route not in PROJECT_ROUTES and route not in auth_routes and route not in workflow_routes and route not in ACTOR_ROUTES:
            return self.json({'error':'Không tìm thấy API'},404)
        try:
            actor = None if route in ('/api/auth/setup','/api/auth/login') else self.actor()
            n=int(self.headers.get('Content-Length',0))
            if route == '/api/video/upload':
                if not 0 < n <= MAX_VIDEO_BYTES:
                    raise ValueError('Video rỗng hoặc lớn hơn 300 MB')
                filename=unquote(self.headers.get('X-T021-Filename','video.mp4'))
                return self.json(VIDEO.add(self.rfile,n,filename))
            if route == '/api/annotation/import':
                if not 0 < n <= MAX_ZIP_BYTES:
                    raise ValueError('ZIP annotation rỗng hoặc vượt 100 MB')
                filename=unquote(self.headers.get('X-T021-Filename','annotations.zip'))
                # Import only returns a parsed, transient preview. It never saves project state.
                return self.json(parse_cvat_archive(filename,self.rfile.read(n)))
            if route == '/api/media/upload-zip':
                if not 0 < n <= MAX_ZIP_BYTES:
                    raise ValueError('ZIP rỗng hoặc lớn hơn 100 MB')
                if self.headers.get('Content-Type','').split(';')[0] not in ('application/zip','application/octet-stream'):
                    raise ValueError('Cần gửi dữ liệu ZIP nhị phân')
                result = STORE.upload_zip(self.rfile.read(n),
                    self.headers.get('X-T021-Task',''),
                    self.headers.get('X-T021-Frame-Count','') or None)
                return self.json(result)

            if not 0<n<=MAX:raise ValueError('Request rỗng hoặc vượt 60 MB')
            req=json.loads(self.rfile.read(n))
            if not isinstance(req,dict):raise ValueError('Request body phải là JSON object')
            if route=='/api/auth/setup':return self.json(auth.setup(req))
            if route=='/api/auth/login':
                result=auth.login(req)
                return self.json({'user':result['user']},headers={'Set-Cookie':
                     f'{COOKIE}={result["token"]}; HttpOnly; SameSite=Lax; Path=/; Max-Age={auth.SESSION_SECONDS}'})
            if route=='/api/auth/logout':
                cookies=SimpleCookie();cookies.load(self.headers.get('Cookie',''))
                token=cookies[COOKIE].value if COOKIE in cookies else ''
                result=auth.logout(token)
                return self.json(result,headers={'Set-Cookie':f'{COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'})
            if route=='/api/auth/me':return self.json({'user':actor})
            if route=='/api/auth/create-user':return self.json(auth.create_user(req,actor))
            if route=='/api/auth/users':return self.json(auth.list_users(req,actor))
            if route=='/api/workflow/list':return self.json(workflow.list_tasks(req,actor))
            if route=='/api/workflow/transition':return self.json(workflow.transition(req,actor))
            if route in ACTOR_ROUTES:
                handler,roles=ACTOR_ROUTES[route]
                if roles:auth.require(actor,*roles)
                return self.json(handler(req,actor))
            if route=='/api/fix':auth.require(actor,'annotator')
            if route=='/api/review':raise ValueError('Dùng /api/workflow/transition để QC và chuyển lỗi cho Annotator')
            if route=='/api/projects/save':auth.require(actor,'annotator')
            if route=='/api/projects/create':
                # Admin creates and assigns tasks; annotators create their own.
                auth.require(actor,'annotator','admin')
                if actor['role']!='admin':req={**req,'annotator':req.get('annotator') or actor['username'],'reviewer':None}
                return self.json(projects.create(req,actor))
            if route in ('/api/projects/rename','/api/projects/delete'):auth.require(actor,'annotator','admin')
            if route=='/api/projects/save':
                # Review decisions are stored by server workflows, never trusted from annotator/browser state.
                req['state']=dict(req.get('state') or {},decisions={})
            if route=='/api/export':auth.require(actor,'annotator')
            return self.json((PROJECT_ROUTES if route in PROJECT_ROUTES else ROUTES)[route](req))
        except PermissionError as exc:
            return self.json({'error':str(exc)},403)
        except (ValueError,TypeError,KeyError,IndexError) as exc:
            return self.json({'error':str(exc)},400)
        except Exception:
            logging.exception('T021 server error')
            return self.json({'error':'Lỗi nội bộ máy chủ (xem Terminal)'},500)


def main():
    import sys
    # Windows consoles default to a legacy code page; the Vietnamese messages would crash print().
    for stream in (sys.stdout, sys.stderr):
        try:stream.reconfigure(encoding='utf-8',errors='replace')
        except (AttributeError,ValueError):pass
    ap=argparse.ArgumentParser();ap.add_argument('--port',type=int,default=8765)
    ap.add_argument('--no-browser',action='store_true');args=ap.parse_args()
    try:httpd=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    except OSError as exc:raise SystemExit(f'Không mở được cổng {args.port}: {exc}. Thử --port 8766')
    url=f'http://localhost:{args.port}'
    print(f'\nT021 Track ID QA v2.5 CVAT Import+QC-Workflow | {url}\nDừng bằng Ctrl+C\n',flush=True)
    if not args.no_browser:threading.Timer(.8,lambda:webbrowser.open(url)).start()
    try:httpd.serve_forever()
    except KeyboardInterrupt: pass
    finally:httpd.server_close()

if __name__=='__main__':main()
