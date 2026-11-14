import math
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import numpy as np
from analyzer import detect_audio_events, identify_tones, LOWER_DEFAULT, UPPER_DEFAULT, group_events

def make_clip(events,seconds=3.5,sr=16000):
    y=np.zeros(round(sr*seconds),dtype=np.float32)
    for t,f in events:
        idx=int(t*sr)
        n=int(.36*sr)
        x=np.arange(n)/sr
        # Plucked note with soft harmonics and short bright attack
        env=(1-np.exp(-x*130))*np.exp(-x*8)
        wave=np.sin(2*np.pi*f*x)+.18*np.sin(2*np.pi*f*2*x)+.08*np.sin(2*np.pi*f*3*x)
        y[idx:idx+n]+=wave.astype(np.float32)*env*.65
    return y

def test_pitch_lower_open():
    y=make_clip([(.3,293)],seconds=1)
    tones=identify_tones(y,16000,.3,{'poshte':LOWER_DEFAULT,'lart':UPPER_DEFAULT})
    assert any(t['string']=='poshte' and t['fret']==0 for t in tones),tones

def test_pitch_lower_fret_4():
    y=make_clip([(.3,440)],seconds=1)
    tones=identify_tones(y,16000,.3,{'poshte':LOWER_DEFAULT,'lart':UPPER_DEFAULT})
    assert any(t['string']=='poshte' and t['fret']==4 for t in tones),tones

def test_detect_some_onsets_and_export_shape():
    y=make_clip([(.3,293),(1.1,329),(2.1,389)],seconds=3)
    events,wave=detect_audio_events(y,16000)
    assert len(events)>=2,events
    assert wave and all('id' in event and 'time' in event for event in events)

def test_group_events():
    events=[{'time':0,'string':'poshte'},{'time':.2,'string':'poshte'},{'time':1.7,'string':'poshte'}]
    group_events(events)
    assert [e['group'] for e in events]==[1,1,2]
