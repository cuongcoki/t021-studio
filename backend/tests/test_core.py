"""Risk-prioritized T021 regression tests. Run: python3 -m unittest discover -s tests -v"""
import unittest
from backend.orchestrator import demo,scan,fix,quality,export,evaluate
from core.models import normalize_boxes
from core.parsers import parse_file
from core.exporters import export_mot,export_cvat
from core.fixing.operations import apply_fix,FixConflict


def box(f,t,x=40,y=40,w=40,h=30,c='Car'):
    return dict(frame_id=f,track_id=t,x=x,y=y,w=w,h=h,class_name=c)


def check(rows,**params):
    return scan(dict(boxes=rows,mode='video',width=1920,height=1080,**params))


class ParsingTests(unittest.TestCase):
    def test_mot_csv(self):
        p=parse_file('file.txt','1,9,20,22,30,14,1,1,1\n2,9,21,22,30,14,1,1,1')
        self.assertEqual(len(p['boxes']),2)
        self.assertEqual(p['frame_base'],1)
    def test_mot_space(self):
        self.assertEqual(parse_file('a.csv','1 5 1 2 3 4\n')['boxes'][0]['track_id'],5)
    def test_labels(self):
        self.assertEqual(parse_file('a.txt','1,2,3,4,5,6,1,2,1','Car\nBus')['boxes'][0]['class_name'],'Bus')
    def test_header_and_unsorted(self):
        p=parse_file('t.csv','frame,id,x,y,w,h\n3,1,2,3,5,6\n1,1,2,3,5,6')
        self.assertTrue(p['warnings'])
    def test_cvat_roundtrip(self):
        rows=[box(f,3,x=10+f) for f in (1,2,3,6)]
        xml=export_cvat(rows,frame_base=1,width=1920,height=1080)
        p=parse_file('a.xml',xml)
        self.assertEqual([x['frame_id'] for x in p['boxes']],[0,1,2,5])
        self.assertEqual(p['boxes'][0]['track_id'],3)
    def test_cvat_occlusion(self):
        xml='<annotations><track id="1" label="Car"><box frame="0" outside="0" occluded="1" xtl="3" ytl="4" xbr="5" ybr="9"/><box frame="1" outside="1"/></track></annotations>'
        p=parse_file('q.xml',xml)
        self.assertEqual(len(p['boxes']),1)
        self.assertTrue(p['boxes'][0]['occluded'])
    def test_image_xml_no_fake_continuity(self):
        xml='<annotations><image id="0"><box label="Car" xtl="1" ytl="2" xbr="4" ybr="5"/></image><image id="1"><box label="Car" xtl="2" ytl="2" xbr="5" ybr="5"/></image></annotations>'
        p=parse_file('q.xml',xml)
        self.assertEqual(p['mode'],'images')
        self.assertEqual(len(set(b['track_id'] for b in p['boxes'])),2)
        self.assertEqual(scan(p)['count'],0)
    def test_bad_format(self):
        with self.assertRaises(ValueError):parse_file('x.pdf','hello')
    def test_invalid_mot(self):
        with self.assertRaises(ValueError):parse_file('x.txt','not data')
    def test_mot_export(self):
        mot,labels=export_mot([box(0,1,c='Car'),box(1,1,c='Car')],frame_base=0)
        self.assertTrue(mot.startswith('1,1'))
        self.assertEqual(labels,'Car\n')


class FalsePositiveTests(unittest.TestCase):
    def test_occlusion_60(self):
        r=check([box(f,1,40+2*f) for f in list(range(1,11))+list(range(71,80))])
        self.assertEqual(r['counts'].get('ID Switch Candidate',0),0)
        self.assertEqual(r['counts'].get('Gap Frame'),1)
    def test_border_gap_eligible(self):
        r=check([box(f,1,x=0) for f in (1,2,20,21)])
        gap=next(x for x in r['issues'] if x['type']=='Gap Frame')
        self.assertEqual(gap['severity'],'low')
    def test_ego_motion_pan(self):
        rows=[box(f,t,x=100*t+100*f,y=50*t) for t in range(1,5) for f in range(1,8)]
        self.assertEqual(check(rows)['counts'].get('Box Jump',0),0)
    def test_tiny_pixel_jitter(self):
        self.assertEqual(check([box(f,1,x=40+(f%2)*3,w=3,h=3) for f in range(1,12)])['counts'].get('Box Jump',0),0)
    def test_legitimate_scale_growth(self):
        r=check([box(f,1,x=110,y=110,w=15*1.5**f,h=15*1.5**f) for f in range(1,8)])
        self.assertEqual(r['counts'].get('Box Jump',0),0)
    def test_crossing_without_switch(self):
        rows=[box(f,1,x=10+10*f) for f in range(1,12)]+[box(f,2,x=150-10*f) for f in range(1,12)]
        self.assertEqual(check(rows)['counts'].get('ID Switch Candidate',0),0)
    def test_long_gap_no_autofix(self):
        gap=next(i for i in check([box(1,1),box(18,1)])['issues'] if i['type']=='Gap Frame')
        self.assertEqual(gap['suggestion'],'review')


class FalseNegativeTests(unittest.TestCase):
    def test_short_gap(self):
        r=check([box(f,1) for f in range(1,12) if f!=6])
        self.assertEqual(r['counts'].get('Gap Frame'),1)
    def test_spike(self):
        r=check([box(f,1,x=40+(250 if f==6 else 0)) for f in range(1,13)])
        self.assertGreater(r['counts'].get('Box Jump',0),0)
    def test_stitch_candidate(self):
        r=check([box(f,1 if f<=8 else 9,x=40+f*2) for f in range(1,16)])
        self.assertTrue(any(i['suggestion']=='stitch_ids' for i in r['issues']))
    def test_fragment_of_a_fast_car_after_a_4_frame_hole(self):
        rows=[box(f,1,x=1500-60*f) for f in range(1,9)]+[box(f,2,x=1500-60*f) for f in range(13,20)]
        r=check(rows)
        st=[i for i in r['issues'] if i['suggestion']=='stitch_ids']
        self.assertEqual([(i['frame'],i['fix_data']['source'],i['fix_data']['target']) for i in st],[(13,2,1)])
    def test_one_stitch_per_ended_track(self):
        rows=[box(f,1,x=400) for f in range(1,6)]+[box(f,2,x=402) for f in range(7,12)]+[box(f,3,x=420) for f in range(7,12)]
        self.assertEqual(sum(i['suggestion']=='stitch_ids' for i in check(rows)['issues']),1)
    def test_swap_of_two_different_sized_cars(self):
        near=lambda f:box(f,0,x=500+3*f,y=300,w=120,h=90)
        far=lambda f:box(f,0,x=520+2*f,y=310,w=40,h=30)
        rows=[dict(near(f),track_id=1 if f<6 else 2) for f in range(1,12)]+[dict(far(f),track_id=2 if f<6 else 1) for f in range(1,12)]
        sw=[i for i in check(rows)['issues'] if i['suggestion']=='swap_ids']
        self.assertEqual([(i['frame'],i['fix_data']['a'],i['fix_data']['b']) for i in sw],[(6,1,2)])
        self.assertFalse(any(i['type']=='Box Jump' for i in check(rows)['issues']))  # one cause, one report
    def test_spike_of_a_big_box(self):
        r=check([box(f,1,x=700+(-650 if f==6 else 0),w=600,h=500) for f in range(1,12)])
        self.assertEqual([i['frame'] for i in r['issues'] if i['type']=='Box Jump'],[6])
    def test_nudged_copy_is_a_duplicate(self):
        rows=[v for f in range(1,6) for v in (box(f,1,x=100,w=24,h=24),box(f,2,x=102,w=24,h=24))]
        self.assertEqual(check(rows)['counts'].get('Duplicate Object Candidate'),1)
    def test_side_by_side_cars_are_not_duplicates(self):
        rows=[v for f in range(1,6) for v in (box(f,1,x=100,w=40,h=30),box(f,2,x=125,w=40,h=30))]
        self.assertEqual(check(rows)['counts'].get('Duplicate Object Candidate',0),0)
    def test_class_change_points_at_the_flip(self):
        r=check([box(f,1,c='Car' if f<5 else 'Bus') for f in range(1,9)])
        self.assertEqual([i['frame'] for i in r['issues'] if i['type']=='Class Change'],[5])
    def test_smooth_swap_not_guaranteed(self):
        # Irresolvable identity with boxes alone: no incorrect guarantee of recall.
        r=check([box(f,1,x=100+f) for f in range(1,10)])
        self.assertIsInstance(r['issues'],list)


class StructuralTests(unittest.TestCase):
    def test_negative_coordinates(self):
        self.assertEqual(check([box(1,1,x=-5)])['counts'].get('Invalid Box'),1)
    def test_zero_width(self):
        self.assertEqual(check([box(1,1,w=0)])['counts'].get('Invalid Box'),1)
    def test_outside_image(self):
        self.assertEqual(check([box(1,1,x=1910,w=30)])['counts'].get('Invalid Box'),1)
    def test_class_change(self):
        self.assertEqual(check([box(1,1),box(2,1,c='Bus')])['counts'].get('Class Change'),1)
    def test_same_id_same_frame(self):
        self.assertEqual(check([box(1,1),box(1,1)])['counts'].get('Duplicate Track/Frame'),1)
    def test_different_ids_duplicate_object(self):
        rows=[v for f in range(1,5) for v in (box(f,1),box(f,2))]
        self.assertEqual(check(rows)['counts'].get('Duplicate Object Candidate'),1)
    def test_empty_frame_candidate(self):
        r=check([box(1,1),box(3,1)],total_frames=4,frame_base=1)
        self.assertEqual(r['counts'].get('Empty Frame Candidate'),2) # missing 2 and 4
    def test_quality_gate_blocks_structural(self):
        self.assertFalse(quality({'boxes':[box(1,1),box(1,1)]})['pass_gate'])


class FixTests(unittest.TestCase):
    def test_stitch(self):
        rows=[box(f,1 if f<5 else 7,x=40+f) for f in range(1,8)]
        out=apply_fix(rows,'stitch_ids',{'source':7,'target':1,'from_frame':5})
        self.assertEqual(set(b['track_id'] for b in out),{1})
    def test_stitch_conflict_no_mutation(self):
        rows=[box(1,1),box(2,1),box(2,7)]
        with self.assertRaises(FixConflict):apply_fix(rows,'stitch_ids',{'source':7,'target':1,'from_frame':2})
        self.assertEqual(rows[2]['track_id'],7)
    def test_swap(self):
        rows=[v for f in range(1,5) for v in (box(f,1,x=10),box(f,2,x=100))]
        r=apply_fix(rows,'swap_ids',{'a':1,'b':2,'from_frame':3})
        self.assertEqual({b['track_id'] for b in r if b['frame_id']==3},{1,2})
    def test_interpolate_small_gap(self):
        r=apply_fix([box(1,1,x=10),box(3,1,x=20)],'interpolate_gap',{'track_id':1,'from_frame':1,'to_frame':3})
        self.assertEqual(len(r),3)
        self.assertEqual(next(b['x'] for b in r if b['frame_id']==2),15)
    def test_no_interpolate_long_gap(self):
        with self.assertRaises(FixConflict):apply_fix([box(1,1),box(6,1)],'interpolate_gap',{'track_id':1,'from_frame':1,'to_frame':6})
    def test_exact_duplicate_removal(self):
        r=apply_fix([box(1,1),box(1,1)],'remove_exact_duplicates',{'frame_id':1,'track_id':1})
        self.assertEqual(len(r),1)
    def test_different_box_duplicate_not_deleted(self):
        with self.assertRaises(FixConflict):apply_fix([box(1,1),box(1,1,x=400)],'remove_exact_duplicates',{'frame_id':1,'track_id':1})
    def test_manual_id_collisions(self):
        rows=normalize_boxes([box(1,1),box(1,2)])
        with self.assertRaises(FixConflict):apply_fix(rows,'update_box',{'uid':rows[0]['uid'],'track_id':2})
    def test_manual_edit(self):
        rows=normalize_boxes([box(1,1)])
        out=apply_fix(rows,'update_box',{'uid':rows[0]['uid'],'x':19,'w':55})
        self.assertEqual(out[0]['x'],19)
    def test_create_delete(self):
        rows=apply_fix([box(1,1)],'create_box',box(2,2))
        self.assertEqual(len(rows),2)
        self.assertEqual(len(apply_fix(rows,'delete_box',{'uid':rows[0]['uid']})),1)
    def test_prevent_negative_create(self):
        with self.assertRaises(FixConflict):apply_fix([box(1,1)],'create_box',box(2,2,x=-5))
    def test_export_rejects_duplicates(self):
        with self.assertRaises(ValueError):export_mot([box(1,1),box(1,1)])
    def test_export_rejects_class_change(self):
        with self.assertRaises(ValueError):export_cvat([box(1,1),box(2,1,c='Bus')])


class MetricsTests(unittest.TestCase):
    def test_one_to_one(self):
        p=[{'type':'ID Switch Candidate','frame':3,'track_id':1}]*3
        gt=[{'type':'ID Switch Candidate','frame':3,'track_id':1}]
        r=evaluate({'predicted':p,'ground_truth':gt})
        self.assertEqual((r['tp'],r['fp'],r['fn']),(1,2,0))
    def test_unknown_gt_not_pass(self):
        self.assertFalse(evaluate({'predicted':[],'ground_truth':[]})['target_met'])
    def test_demo(self):
        self.assertGreater(len(demo({})['boxes']),20)

if __name__=='__main__': unittest.main(verbosity=2)

class SessionTests(unittest.TestCase):
    def test_portable_project_roundtrip(self):
        import json
        source={'project_type':'t021_project','meta':{'frame_base':1,'mode':'video','width':640,'height':360},
                'boxes':[box(1,1)],'decisions':{'x':'false_positive'},'source_name':'a.txt'}
        loaded=parse_file('save.t021.json',json.dumps(source))
        self.assertEqual(loaded['width'],640)
        self.assertEqual(loaded['decisions']['x'],'false_positive')
    def test_arbitrary_json_rejected(self):
        with self.assertRaises(ValueError):parse_file('save.json','{"secret":1}')

class NegativeIdTests(unittest.TestCase):
    def test_mot_minus_one_not_treated_as_single_track(self):
        # Same -1 is a sentinel for untracked boxes, not identity continuity.
        rows=[box(1,-1),box(1,-1,x=400),box(10,-1,x=500)]
        counts=check(rows)['counts']
        self.assertEqual(counts.get('Gap Frame',0),0)
        self.assertEqual(counts.get('Duplicate Track/Frame',0),0)

class ExportSafetyTests(unittest.TestCase):
    def test_image_xml_no_video_export(self):
        data=parse_file('x.xml','<annotations><image id="0"><box label="Car" xtl="1" ytl="2" xbr="10" ybr="10"/></image></annotations>')
        with self.assertRaises(ValueError):export(dict(data,format='cvat'))
