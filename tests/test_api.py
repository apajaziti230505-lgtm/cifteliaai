import io
import json
import time
import numpy as np
from scipy.io import wavfile
from fastapi.testclient import TestClient
from transcriber import api


def test_upload_job_real_decode_and_no_fake_silence(tmp_path,monkeypatch):
    monkeypatch.setattr(api,'DATA',tmp_path)
    client=TestClient(api.app)
    assert client.get('/api/v3/health').json()['ml_model'] is None
    audio=io.BytesIO();wavfile.write(audio,22050,np.zeros(22050,dtype=np.int16))
    r=client.post('/api/v3/analyze',files={'file':('silence.wav',audio.getvalue(),'audio/wav')})
    assert r.status_code==202,r.text
    job=r.json()['id']
    for _ in range(200):
        result=client.get('/api/v3/jobs/'+job).json()
        if result['status'] in ('done','failed'):break
        time.sleep(.03)
    assert result['status']=='done',result
    assert result['result']['notes']==[]
    assert result['result']['audio']['filename']=='silence.wav'
    assert not list((tmp_path/'uploads').glob('*'))


def test_invalid_formats_and_profile_are_rejected(tmp_path,monkeypatch):
    monkeypatch.setattr(api,'DATA',tmp_path);client=TestClient(api.app)
    assert client.post('/api/v3/analyze',files={'file':('a.exe',b'abc')}).status_code==415
    assert client.get('/api/v3/jobs/../../etc/passwd').status_code==404
    assert client.post('/api/v3/analyze',files={'file':('a.wav',b'abc')},data={'profile':'{"tones":[]}'}).status_code==422

def test_interrupted_jobs_are_marked_failed_after_restart(tmp_path,monkeypatch):
    monkeypatch.setattr(api,'DATA',tmp_path)
    (tmp_path/'jobs').mkdir()
    job='a'*32;path=tmp_path/'jobs'/(job+'.json')
    path.write_text(json.dumps({'id':job,'status':'running'}))
    with TestClient(api.app) as client:
        assert client.get('/api/v3/jobs/'+job).json()['status']=='failed'
