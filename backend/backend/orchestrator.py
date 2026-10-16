"""Application services. Stateless scans and edits; browser owns current annotation."""
from core.parsers import parse_file
from core.exporters import export_mot, export_cvat
from core.models import normalize_boxes
from core.validators.engine import validate
from core.fixing.operations import apply_fix
from backend import audit


def parse(body):
    content=body.get('content','')
    if not isinstance(content,str) or len(content)>25_000_000:
        raise ValueError('File nhãn quá lớn (tối đa 25 MB).')
    data=parse_file(str(body.get('filename','annotations.txt')),content,body.get('labels_text',''))
    data['session']=audit.new_session()
    return data


def scan(body):
    return validate(body.get('boxes',[]),body.get('width'),body.get('height'),
                    body.get('mode','video'),body.get('total_frames'),body.get('frame_base'))


def fix(body):
    boxes=apply_fix(body.get('boxes',[]),str(body.get('action','')),body.get('data',{}))
    if body.get('session'):
        audit.record(body['session'],'fix',{'type':body.get('action'),'parameters':body.get('data',{}),
                                          'before':len(body.get('boxes',[])),'after':len(boxes)})
    return {'boxes':boxes,'count':len(boxes)}


def review(body):
    entry=audit.record(body['session'],'review',{'issue_id':body.get('issue_id'),
                'decision':body.get('decision'),'note':str(body.get('note',''))[:400]})
    return {'saved':True,'event':entry}


def history(body):
    return {'events':audit.read(body['session'])}


def export(body):
    fmt=body.get('format','mot')
    boxes=normalize_boxes(body.get('boxes',[]))
    if not boxes:raise ValueError('Không có box để xuất')
    base=int(body.get('frame_base',1))
    if fmt=='mot':
        content,labels=export_mot(boxes,base,body.get('labels'))
        return {'filename':'t021_clean_mot.txt','content':content,'labels':labels,'format':'mot'}
    if fmt=='cvat':
        if body.get('mode')=='images' and any(b['track_id']<0 for b in boxes):
            raise ValueError('CVAT dạng ảnh không có track ID thực. Không thể xuất CVAT for video an toàn.')
        return {'filename':'t021_clean_cvat.xml','content':export_cvat(boxes,base,
                body.get('width') or 1920,body.get('height') or 1080,
                body.get('total_frames'),body.get('labels')),'format':'cvat'}
    if fmt=='json':
        return {'filename':'t021_clean_annotations.json','data':boxes,'format':'json'}
    raise ValueError('Chỉ hỗ trợ MOT, CVAT XML và JSON')


def quality(body):
    # Saved projects use authoritative server data and durable Reviewer decisions.
    if body.get('project_id'):
        from backend.projects import get
        project=get(body['project_id'])
        state=project.get('state') or {}
        values={**(state.get('meta') or {}), 'boxes':state.get('boxes') or []}
        tasks=project.get('tasks',{})
        reviews={issue_id:item.get('status') for issue_id,item in tasks.items()}
    else:
        values=body
        reviews={}  # browser-submitted decisions are never an authority
    result=scan(values)
    blocking=[i for i in result['issues'] if i['type'] in ('Invalid Box','Duplicate Track/Frame','Class Change')]
    open_high=[i for i in result['issues'] if i['severity']=='high' and reviews.get(i['id']) not in ('false_positive','verified')]
    pending=[issue_id for issue_id,status in reviews.items() if status in ('needs_fix','fixed')]
    return dict(pass_gate=not blocking and not open_high and not pending,structural_blockers=blocking,
                unresolved_high=open_high,pending_handoffs=pending,reviewed=len(reviews),total_issues=result['count'],
                disclaimer='Quality Gate dữ liệu; KHÔNG chứng nhận độ chính xác detector trên ground truth.')


def evaluate(body):
    from core.evaluation.metrics import evaluate_events
    return evaluate_events(body.get('predicted',[]),body.get('ground_truth',[]),body.get('tolerance',2))


def video_info(body):
    from backend.video import VIDEO
    return VIDEO.metadata(body.get('token'))


def media_manifest(body):
    from backend.media import STORE, ZIP_ROOT, natural_sort_key
    import zipfile
    token=body.get('token')
    STORE.check_token(token)
    with zipfile.ZipFile(ZIP_ROOT / (token + '.zip')) as z:
        names=[info.filename.replace('\\','/').split('/')[-1] for info in z.infolist()
               if not info.is_dir() and info.filename.lower().endswith(('.jpg','.jpeg','.png','.webp','.gif'))]
    names.sort(key=natural_sort_key)
    return {'token':token,'files':names,'count':len(names)}


def demo(_):
    rows=[]
    for f in range(1,31):
        if f not in (14,15):
            rows.append(dict(frame_id=f,track_id=1 if f<=20 else 7,x=50+f*3,y=100,w=60,h=35,class_name='Car'))
        rows.append(dict(frame_id=f,track_id=2,x=430-f*4,y=210,w=70,h=42,class_name='Car'))
    # demonstrative bbox spike & duplicate data
    for r in rows:
        if r['frame_id']==9 and r['track_id']==2:r['x']+=160
    return dict(boxes=normalize_boxes(rows),format='mot',mode='video',frame_base=1,
                width=640,height=360,total_frames=30,labels=['Car'],warnings=['Dữ liệu DEMO giả lập có gap, jump, và chuyển ID.'],
                session=audit.new_session())

ROUTES={'/api/parse':parse,'/api/validate':scan,'/api/fix':fix,'/api/review':review,
        '/api/audit':history,'/api/export':export,'/api/quality':quality,
        '/api/evaluate':evaluate,'/api/demo':demo,'/api/media/manifest':media_manifest,'/api/video/info':video_info}
