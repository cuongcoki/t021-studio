"""Run manually for crude core performance; not a guarantee on the user's machine."""
from time import perf_counter
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.orchestrator import scan
from tests.test_core import box

rows=[box(f,t,x=20+t*180+f*.2,y=40*t) for f in range(1,10001) for t in range(1,4)]
t=perf_counter();r=scan({'boxes':rows,'width':6400,'height':2000,'frame_base':1,'total_frames':10000});dt=perf_counter()-t
print(f'30,000 boxes / 10,000 frames / 3 tracks: {dt:.3f}s | {r["count"]} issues')
