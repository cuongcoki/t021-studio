"""Robust common camera translation heuristic. Not a substitute for optical flow."""
import statistics
from collections import defaultdict
from core.models import center


def estimate_common_motion(boxes):
    tracks=defaultdict(dict)
    for b in boxes: tracks[b['track_id']][b['frame_id']]=b
    by_pair=defaultdict(list)
    for track in tracks.values():
        for f,b in track.items():
            if f-1 in track:
                p,q=center(track[f-1]),center(b)
                by_pair[(f-1,f)].append((q[0]-p[0],q[1]-p[1]))
    result={}
    for key,vs in by_pair.items():
        if len(vs)<3:continue
        dx,dy=statistics.median(v[0] for v in vs),statistics.median(v[1] for v in vs)
        consistent=sum((x-dx)**2+(y-dy)**2 <= max(9, .12*(dx*dx+dy*dy)) for x,y in vs)
        if consistent>=max(3, .65*len(vs)):
            result[key]=(dx,dy)
    return result
