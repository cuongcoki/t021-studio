from collections import defaultdict,Counter
import math
from core.models import issue,iou

DUP_IOU=.75        # a copied track is often nudged a few px, so near-exact IoU is too strict
DUP_SIZE=.15       # ... but its size stays the same (|log w ratio| and |log h ratio| under this)


def _same_size(a,b):
    return (abs(math.log(max(.1,a['w'])/max(.1,b['w'])))<DUP_SIZE and
            abs(math.log(max(.1,a['h'])/max(.1,b['h'])))<DUP_SIZE)


def check(boxes,width=None,height=None,mode='video'):
    issues=[]; by_track=defaultdict(list); by_frame=defaultdict(list); duplicated=defaultdict(list)
    for b in boxes:
        f,t=b['frame_id'],b['track_id'];by_track[t].append(b);by_frame[f].append(b)
        duplicated[(f,t)].append(b)
        problems=[]
        if f<0: problems.append('frame âm')
        if b['w']<=0 or b['h']<=0: problems.append('width/height <= 0')
        if b['x']<0 or b['y']<0: problems.append('tọa độ x/y âm')
        if width and b['x']+b['w']>width+0.01:problems.append('vượt chiều rộng ảnh')
        if height and b['y']+b['h']>height+0.01:problems.append('vượt chiều cao ảnh')
        if problems:
            issues.append(issue('Invalid Box',f,t,'; '.join(problems),'high',data={'uid':b['uid']}))
    for (f,t),group in duplicated.items():
        if t<0:continue  # Untracked boxes in MOT may share ID -1
        if len(group)>1:
            identical=all(iou(group[0],other)>=0.9999 and group[0]['class_name']==other['class_name'] for other in group[1:])
            issues.append(issue('Duplicate Track/Frame',f,t,f'{len(group)} box có cùng frame và track ID','high',
                                'remove_exact_duplicates' if identical else 'review',{'uids':[b['uid'] for b in group],'identical':identical}))
    if mode=='video':
        for tid, group in by_track.items():
            if tid<0:continue
            classes=Counter(b['class_name'] for b in group)
            if len(classes)>1:
                target=classes.most_common(1)[0][0]
                ordered=sorted(group,key=lambda b:b['frame_id'])
                # report where the class first changes, not where the track starts
                first=next(b['frame_id'] for p,b in zip(ordered,ordered[1:]) if b['class_name']!=p['class_name'])
                issues.append(issue('Class Change',first,tid,f'Track đổi class: {dict(classes)}','high','set_class',{'track_id':tid,'class_name':target}))
        # Compare different IDs only if a same-size, heavy overlap persists 3 consecutive frames
        overlaps=defaultdict(list)
        for f,group in by_frame.items():
            if len(group)>120:continue   # bound pairwise work
            for i,a in enumerate(group):
                for b in group[i+1:]:
                    if a['track_id']<0 or b['track_id']<0 or a['track_id']==b['track_id'] or a['class_name']!=b['class_name']:continue
                    if iou(a,b)>DUP_IOU and _same_size(a,b):
                        a_id,b_id=sorted((a['track_id'],b['track_id']))
                        overlaps[(a_id,b_id)].append(f)
        for (a,b),frames in overlaps.items():
            s=sorted(set(frames))
            for k in range(len(s)-2):
                if s[k+2]-s[k]==2:
                    issues.append(issue('Duplicate Object Candidate',s[k],a,
                        f'ID {a} và {b} gần như trùng box liên tục; cần đối chiếu ảnh','medium',data={'pair':[a,b]}))
                    break
    return issues
