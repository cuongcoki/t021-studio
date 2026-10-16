from collections import Counter
from core.models import normalize_boxes
from core.validators.structural import check as structural
from core.validators.continuity import check as gaps,check_jumps
from core.validators.association import check as associations
from core.validators.motion import estimate_common_motion


def validate(rows, width=None,height=None,mode='video',total_frames=None,frame_base=None):
    boxes=normalize_boxes(rows)
    if width is not None and (float(width)<=0 or float(width)>100000):raise ValueError('Chiều rộng ảnh không hợp lệ')
    if height is not None and (float(height)<=0 or float(height)>100000):raise ValueError('Chiều cao ảnh không hợp lệ')
    issues=structural(boxes,width,height,mode)
    if mode=='video':
        motions=estimate_common_motion(boxes)
        issues += gaps(boxes,width,height,mode)
        issues += check_jumps(boxes,motions)
        linked = associations(boxes)
        # a swap also looks like a jump on both IDs at that frame: report the cause once
        swapped = {(i['frame'], t) for i in linked if i['fix_data'].get('subtype') == 'Swap' for t in i['fix_data']['pair']}
        issues = [i for i in issues if not (i['type'] == 'Box Jump' and (i['frame'], i['track_id']) in swapped)]
        issues += linked
    # Empty global frames are only *candidates*: blank frames can legitimately have no objects.
    if mode=='video' and total_frames is not None and boxes:
        from core.models import issue
        total=int(total_frames)
        if total<=0 or total>500_000: raise ValueError('total_frames không hợp lệ (1–500000)')
        start=int(frame_base) if frame_base is not None else min(b['frame_id'] for b in boxes)
        present={b['frame_id'] for b in boxes}
        missing=sorted(set(range(start,start+total))-present)
        if missing:
            first=prev=missing[0]
            blocks=[]
            for f in missing[1:]:
                if f==prev+1:prev=f
                else:blocks.append((first,prev));first=prev=f
            blocks.append((first,prev))
            for a,b in blocks[:100]:
                issues.append(issue('Empty Frame Candidate',a,-1,
                    f'Frame {a}–{b} không có annotation; có thể hợp lệ nếu không có vật thể','low'))
    sev={'high':0,'medium':1,'low':2}
    issues.sort(key=lambda i:(sev.get(i['severity'],3),i['frame'],i['type']))
    ct=Counter(x['type'] for x in issues)
    allframes=sorted({b['frame_id'] for b in boxes})
    return dict(issues=issues,counts=dict(ct),count=len(issues),
                stats={'boxes':len(boxes),'tracks':len({b['track_id'] for b in boxes}),
                       'annotated_frames':len(allframes),'first_frame':allframes[0] if allframes else 0,
                       'last_frame':allframes[-1] if allframes else 0,'total_frames':total_frames,
                       'high':sum(i['severity']=='high' for i in issues),
                       'medium':sum(i['severity']=='medium' for i in issues),
                       'low':sum(i['severity']=='low' for i in issues)},
                notes=['ID Switch là nghi vấn hình học, phải xác nhận qua ảnh/video.',
                         'Frame không có annotation có thể hợp lệ; muốn phân biệt cần media hoặc manifest.',
                         'Chưa tích hợp appearance Re-ID, optical-flow hoặc drift detector dựa trên ảnh.'])
