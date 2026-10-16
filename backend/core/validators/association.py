"""Track re-association *candidates*; never assert visual identity without image evidence."""
import math
from collections import defaultdict
from core.models import issue,center,distance

MAX_STITCH_GAP=5      # frames between the end of one ID and the start of the next


def _velocity(g,f,span=3):
    """Mean centre motion per frame over the contiguous frames ending at f (0,0 if alone)."""
    k=0
    while k<span and f-k-1 in g:k+=1
    if not k:return 0.0,0.0
    (x0,y0),(x1,y1)=center(g[f-k]),center(g[f])
    return (x1-x0)/k,(y1-y0)/k


def _shifted(b,v,n):
    return dict(b,x=b['x']+v[0]*n,y=b['y']+v[1]*n)


def _unlike(p,q):
    """Dissimilarity of two boxes: centre distance in box sizes + size change (log ratios)."""
    scale=max(12,math.sqrt(max(1,p['w']*p['h'])))
    return (distance(p,q)/scale+abs(math.log(max(.1,q['w'])/max(.1,p['w'])))
            +abs(math.log(max(.1,q['h'])/max(.1,p['h']))))


def check(boxes):
    tracks=defaultdict(dict)
    for b in boxes:tracks[b['track_id']][b['frame_id']]=b
    if len(tracks)>800:return []
    results=[]
    starts=[]; ends=[]
    for tid,g in tracks.items():
        ordered=sorted(g)
        if tid<0 or not ordered: continue
        starts.append((ordered[0],tid,g[ordered[0]]))
        ends.append((ordered[-1],tid,g[ordered[-1]]))
    # Fragment: an ID ends and another starts a few frames later where the first one was heading.
    # Each ended ID / started ID is used once, best match first (no second guess at the same place).
    pairs=[]
    for ef,old,a in ends:
        v=_velocity(tracks[old],ef)
        for sf,new,b in starts:
            n=sf-ef
            if old==new or b['class_name']!=a['class_name'] or not 0<n<=MAX_STITCH_GAP:continue
            scale=max(15,math.sqrt(max(1,a['w']*a['h'])))
            raw=distance(a,b)/scale
            moved=distance(_shifted(a,v,n),b)/scale
            size=abs(math.log(max(1,b['w']*b['h'])/max(1,a['w']*a['h'])))
            score=min(raw,moved)
            # a fast car's speed is only roughly known: allow 25% of the distance it covered
            slack=.25*math.hypot(*v)*n/scale
            if score<.6+.1*(n-1)+slack and size<1.0:
                pairs.append((score,ef,old,sf,new))
    used_old,used_new=set(),set()
    for score,ef,old,sf,new in sorted(pairs):
        if old in used_old or new in used_new:continue
        used_old.add(old);used_new.add(new)
        results.append(issue('ID Switch Candidate',sf,new,
            f'Track {old} kết thúc ở frame {ef} và {new} xuất hiện gần chỗ đó ở frame {sf}; cân nhắc nối ID','medium',
            'stitch_ids',{'source':new,'target':old,'from_frame':sf,'pair':[old,new],'subtype':'Fragment'}))
    # Swap: two IDs present on both sides of frame f trade boxes. Each box is predicted from its own
    # motion; flag only when the crossed assignment explains frame f far better than the same one.
    by_frame=defaultdict(list)
    for tid,g in tracks.items():
        if tid<0:continue
        for f in g:
            if f-1 in g:by_frame[f].append(tid)
    for f,ids in sorted(by_frame.items()):
        if len(ids)>120:continue   # bound pairwise work
        pred={t:_shifted(tracks[t][f-1],_velocity(tracks[t],f-1),1) for t in ids}
        for i,a in enumerate(ids):
            A=tracks[a][f]
            for b in ids[i+1:]:
                B=tracks[b][f]
                if B['class_name']!=A['class_name']:continue
                same=_unlike(pred[a],A)+_unlike(pred[b],B)
                if same<1.2:continue
                cross=_unlike(pred[a],B)+_unlike(pred[b],A)
                if cross<.35*same:
                    lo,hi=sorted((a,b))
                    results.append(issue('ID Switch Candidate',f,lo,
                        f'ID {lo} và {hi} đổi box cho nhau từ frame {f}; xác nhận qua ảnh rồi hoán đổi ID','medium',
                        'swap_ids',{'a':lo,'b':hi,'from_frame':f,'pair':[lo,hi],'subtype':'Swap'}))
    return results
