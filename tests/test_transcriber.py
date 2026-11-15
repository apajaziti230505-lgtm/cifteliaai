"""Synthetic signals here are unit-test fixtures, never demo transcription results."""
import copy
import numpy as np
import pytest
from transcriber.engine import analyze_pcm,onsets
from transcriber.schema import default_profile,import_notes,legacy_export,merge_manual,validate_profile
from transcriber.calibration import calibrate_pcm
from transcriber.evaluate import metrics,split_sessions

SR=22050

def plucks(rows,seconds=2.4):
    y=np.zeros(round(SR*seconds),dtype=np.float32)
    for time,f,amp in rows:
        a=round(time*SR);n=min(round(.7*SR),len(y)-a);t=np.arange(n)/SR
        env=(1-np.exp(-t*1200))*np.exp(-t/0.16)
        wave=sum(w*np.sin(2*np.pi*f*h*t) for h,w in enumerate([1,.32,.19,.12,.09,.065,.05,.04],1))
        y[a:a+n]+=amp*wave*env
    return y

def test_no_fabricated_upper_frets():
    assert [t['fret'] for t in default_profile()['tones'] if t['string']=='upper']==[14]

def test_silence_never_yields_notes():
    result=analyze_pcm(np.zeros(SR),use_cqt=False)
    assert result['notes']==[] and result['analysis']['onset_candidates']==0

@pytest.mark.parametrize('f,fret',[(293,14),(329,1),(440,4),(660,8),(880,11),(1050,13)])
def test_melodic_reference_without_upper(f,fret):
    result=analyze_pcm(plucks([(.25,f,.6)]),use_cqt=False)
    notes=result['notes']
    assert any(n['string']=='lower' and n['fret']==fret for n in notes),notes
    assert not any(n['string']=='upper' for n in notes),notes
    assert abs(notes[0]['time']-.25)<.025

def test_repeated_same_note_fast():
    times=[.25,.31,.37,.43,.49]
    result=analyze_pcm(plucks([(t,358,.5) for t in times]),use_cqt=False)
    lower=[n for n in result['notes'] if n['string']=='lower' and n['fret']==2]
    assert len(lower)==len(times),[(n['time'],n['fret']) for n in result['notes']]

def test_ringing_upper_is_not_restruck_with_each_lower():
    result=analyze_pcm(plucks([(.25,220,.6),(.25,358,.5),(.48,389,.6),(.72,521,.6)]),use_cqt=False)
    upper=[n for n in result['notes'] if n['string']=='upper']
    assert len(upper)==1,result['notes']
    assert len([n for n in result['notes'] if n['string']=='lower'])==3

def test_upper_only_harmonics_are_not_lower_notes():
    result=analyze_pcm(plucks([(.25,220,.6),(.7,220,.6)]),use_cqt=False)
    assert len(result['notes'])==2,result['notes']
    assert all(n['string']=='upper' and n['fret']==14 for n in result['notes'])

def test_paired_220_440_is_not_automatically_deleted():
    result=analyze_pcm(plucks([(.25,220,.4),(.25,440,.7)]),use_cqt=False)
    assert {(n['string'],n['fret']) for n in result['notes']}=={('upper',14),('lower',4)},result['notes']
    assert len({n['event_id'] for n in result['notes']})==1

def test_staggered_paired_strum_keeps_individual_attack_times():
    result=analyze_pcm(plucks([(.25,358,.6),(.262,220,.55)]),use_cqt=False)
    assert {n['string'] for n in result['notes']}=={'lower','upper'}
    assert len({n['event_id'] for n in result['notes']})==1
    assert len({n['sample_index'] for n in result['notes']})==2
    lower=next(n for n in result['notes'] if n['string']=='lower')
    upper=next(n for n in result['notes'] if n['string']=='upper')
    assert abs(lower['time']-.25)<.02 and abs(upper['time']-.262)<.02

def test_sample_indices_are_canonical():
    result=analyze_pcm(plucks([(.25,389,.6)]),use_cqt=False)
    for n in result['notes']:
        assert n['time']==n['sample_index']/SR
        assert n['end_time']==n['end_sample']/SR
        assert n['duration']>0

def test_legacy_ms_and_paired_flag_roundtrip():
    raw={'notes':[{'time':1250,'string':1,'noteNumber':7,'withF':True,'upperNoteNumber':14}]}
    imported=import_notes(raw)
    assert {n['string'] for n in imported}=={'upper','lower'}
    assert all(abs(n['time']-1.25)<1/SR for n in imported)
    result=legacy_export({'notes':imported})
    roundtrip=import_notes(result)
    assert [(n['string'],n['fret'],n['sample_index']) for n in imported]==[(n['string'],n['fret'],n['sample_index']) for n in roundtrip]

def test_manual_edits_and_deletions_survive_reanalysis():
    auto=import_notes({'notes':[{'time':1.2,'string':'lower','fret':7},{'time':2.1,'string':'upper','fret':14}]})
    edit=copy.deepcopy(auto[0]);edit.update(manual=True,source='manual',fret=6,original_sample_index=edit['sample_index'],sample_index=round(1.5*SR),time=1.5)
    kept=merge_manual([edit],auto,[auto[1]])
    assert len(kept)==1 and kept[0]['fret']==6 and kept[0]['sample_index']==round(1.5*SR)

def test_measured_upper_calibration_and_duplicate_rejected():
    y=plucks([(.2,335,.5)],seconds=1.2)
    p,record=calibrate_pcm(y,SR,'upper',1,target_hz=335)
    tone=next(t for t in p['tones'] if t['string']=='upper' and t['fret']==1)
    assert tone['measured'] and abs(tone['frequency']-335)<4 and tone['harmonics'][0]==1
    with pytest.raises(ValueError):calibrate_pcm(y,SR,'upper',1,p,target_hz=335)

def test_one_to_one_metrics_do_not_double_count():
    a=[{'time':1,'string':'lower','fret':7}]
    b=[{'time':1,'string':'lower','fret':7,'confidence':.8},{'time':1.01,'string':'lower','fret':7,'confidence':.7}]
    score=metrics(a,b)
    assert score['notes']['tp']==1 and score['notes']['fp']==1 and score['notes']['precision']==.5

def test_no_dataset_leakage_between_sessions():
    records=[{'session_id':s,'id':f'{s}-{i}'} for s in ['a','b','c','d'] for i in range(3)]
    split=split_sessions(records)
    sessions=[{r['session_id'] for r in rows} for rows in split.values()]
    assert all(not a&b for i,a in enumerate(sessions) for b in sessions[i+1:])
    with pytest.raises(ValueError):split_sessions(records[:3])

def test_profile_rejects_nonfinite_or_invented_shapes():
    p=default_profile();p['tones'][0]['frequency']=float('nan')
    with pytest.raises(ValueError):validate_profile(p)

def test_existing_catalog_open_lower_15_and_upper_string_2():
    notes=import_notes({'notes':[{'time':1000,'string':1,'noteNumber':15},{'time':1005,'string':2,'noteNumber':14}]})
    assert [(n['string'],n['fret']) for n in notes]==[('lower',14),('upper',14)]
    rows=legacy_export({'notes':notes})['notes']
    assert [(n['string'],n['noteNumber']) for n in rows]==[(1,15),(2,14)]
