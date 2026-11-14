import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import cv2
import numpy as np
from analyzer import motion_track, combine_motion

def test_motion_roi_detects_vertical_movement(tmp_path):
    path=tmp_path/'motion.avi'
    writer=cv2.VideoWriter(str(path),cv2.VideoWriter_fourcc(*'MJPG'),30,(320,240))
    assert writer.isOpened()
    for n in range(90):
        frame=np.zeros((240,320,3),dtype=np.uint8)
        y=90 + int(35*np.sin(n*.21))
        cv2.circle(frame,(160,y),14,(240,240,240),-1)
        cv2.rectangle(frame,(140,y-3),(200,y+3),(128,128,128),-1)
        writer.write(frame)
    writer.release()
    times, dirs=motion_track(str(path),{'x':.35,'y':.15,'w':.35,'h':.65},max_seconds=3)
    assert len(times)>40
    assert max(dirs)>0.2
    assert min(dirs)<-0.2
    events=[{'id':'one','time':.5,'duration':.2,'string':'poshte','fret':1,
              'stroke':'unknown','confidence':.4,'source':'auto','review':True,'group':1}]
    result,info=combine_motion(events,times,dirs,ghost=True)
    assert info['motion_samples']>40
    assert any(e['stroke'] in ('down','up','ghost_down','ghost_up') for e in result)
