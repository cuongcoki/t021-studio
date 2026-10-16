import math
import statistics
from collections import defaultdict
from core.models import issue,center,distance,iou


def check(boxes, width=None,height=None,mode='video'):
    if mode!='video':return []
    tracks=defaultdict(list)
    for b in boxes:tracks[b['track_id']].append(b)
    issues=[]
    for tid,group in tracks.items():
        if tid<0:continue  # MOT -1 indicates untracked object, not an ID continuity sequence
        group=sorted(group,key=lambda r:r['frame_id'])
        # duplicated track/frame should be handled structurally; ignore in continuity
        dedup={b['frame_id']:b for b in group}
        group=[dedup[f] for f in sorted(dedup)]
        for a,b in zip(group,group[1:]):
            n=b['frame_id']-a['frame_id']-1
            if n<=0:continue
            edge=False
            if width and height:
                for v in (a,b):
                    if (v['x']<=max(6,.04*width) or v['y']<=max(6,.04*height) or
                        v['x']+v['w']>=.96*width or v['y']+v['h']>=.96*height):edge=True
            kind='Possible occlusion' if n>=3 or a.get('occluded') or b.get('occluded') else 'Short gap'
            severity='low' if edge or n>=3 else 'medium'
            suggestion='review' if edge or n>3 else 'interpolate_gap'
            issues.append(issue('Gap Frame',a['frame_id']+1,tid,
                f'Thiếu {n} frame ({a["frame_id"]+1}–{b["frame_id"]-1}); {kind}'+(' ở mép ảnh' if edge else ''),
                severity,suggestion,{'from_frame':a['frame_id'],'to_frame':b['frame_id'],'track_id':tid,'edge':edge}))
    return issues


def check_jumps(boxes,motions):
    tracks=defaultdict(dict)
    for b in boxes: tracks[b['track_id']][b['frame_id']]=b
    issues=[]
    for tid,by_frame in tracks.items():
        if tid<0:continue
        frames=sorted(by_frame)
        if len(frames)<3:continue
        alerted=set()
        for idx in range(1,len(frames)-1):
            f0,f1,f2=frames[idx-1:idx+2]
            if f1-f0!=1 or f2-f1!=1:continue
            a,b,c=by_frame[f0],by_frame[f1],by_frame[f2]
            # Use first-order motion prediction and require both sides to be discontinuous.
            ax,ay=center(a);bx,by=center(b);cx,cy=center(c)
            vm1=motions.get((f0,f1),(0,0))
            vm2=motions.get((f1,f2),(0,0))
            d1=(bx-ax-vm1[0],by-ay-vm1[1]);d2=(cx-bx-vm2[0],cy-by-vm2[1])
            # spike: isolated distant center frame, return to previous trajectory
            deviation=math.hypot(bx-(ax+cx)/2,by-(ay+cy)/2)
            sz=max(12,statistics.median([math.sqrt(max(1,v['w']*v['h'])) for v in (a,b,c)]))
            # If size changes steadily, don't flag based on IoU
            scale1=math.log(max(.1,b['w']*b['h'])/max(.1,a['w']*a['h']))
            scale2=math.log(max(.1,c['w']*c['h'])/max(.1,b['w']*b['h']))
            size_consistent=abs(scale2-scale1)<.35
            reversal=d1[0]*d2[0]+d1[1]*d2[1]<0
            # big boxes (close to the camera) move little in box sizes: also accept a frame that leaves
            # neighbours which still overlap each other well
            mid=dict(a,x=(a['x']+c['x'])/2,y=(a['y']+c['y'])/2,w=(a['w']+c['w'])/2,h=(a['h']+c['h'])/2)
            overlap_spike=iou(a,c)>.7 and iou(b,mid)<.3 and deviation>max(12,.5*sz)
            if (deviation>max(12,1.5*sz) and reversal and math.hypot(*d1)>sz and math.hypot(*d2)>sz or overlap_spike) and size_consistent:
                if f1 not in alerted:
                    issues.append(issue('Box Jump',f1,tid,f'Box tại frame {f1} lệch mạnh so với hai frame kề','high',
                        'review',{'uid':b['uid'],'normalized_deviation':round(deviation/sz,2)}))
                    alerted.add(f1)
        # Single jump followed by a parallel shifted trajectory: candidate, never automatic fix
        for idx in range(2,len(frames)-2):
            f=frames[idx]
            if f in alerted or (f-1) in alerted or frames[idx-1]!=f-1 or frames[idx+1]!=f+1:continue
            a,b,c=by_frame[f-1],by_frame[f],by_frame[f+1]
            d=distance(a,b); follow=distance(b,c)
            size=max(12,math.sqrt(max(1,a['w']*a['h'])))
            common=motions.get((f-1,f),(0,0))
            if d>max(70,3.5*size) and follow<max(10,size*.65) and math.hypot(*common)<d*.5:
                issues.append(issue('Box Jump',f,tid,'Đổi vị trí đột ngột rồi ổn định; cần kiểm tra','medium',
                                    'review',{'uid':b['uid']}));alerted.add(f)
    return issues
