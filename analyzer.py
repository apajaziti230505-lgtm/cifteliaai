"""Offline audio / video analysis for two-string çifteli.

Heuristic prototype, not an ML model. Outputs confidence and leaves all events editable.
No sound is uploaded to a remote service.
"""
from __future__ import annotations
import json
import math
import os
import re
import subprocess
import tempfile
import uuid
from pathlib import Path

import cv2
import numpy as np
from scipy.io import wavfile
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks, stft

# Measured notes from user's lower string. Configurable via interface.
LOWER_DEFAULT = [293, 329, 358, 389, 440, 477, 521, 587, 660, 719, 784, 880, 960, 1050]
UPPER_DEFAULT = [220] + [None] * 13  # unmeasured upper frets are intentionally absent
SR = 16000
MAX_ANALYSIS_SECONDS = 600


def ffmpeg_exe():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        from shutil import which
        if which('ffmpeg'):
            return which('ffmpeg')
        raise RuntimeError('FFmpeg nuk u gjet. Instalo imageio-ffmpeg nga requirements.txt.')


def run_ffmpeg(args, timeout=300):
    cmd = [ffmpeg_exe(), '-hide_banner', '-loglevel', 'error', '-nostdin', '-y'] + list(args)
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if proc.returncode:
        raise RuntimeError('Gabim nga FFmpeg: ' + (proc.stderr or '')[-1000:])


def media_info(path: str):
    cap = cv2.VideoCapture(str(path))
    fps = float(cap.get(cv2.CAP_PROP_FPS))
    n = float(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    if fps > 0 and n > 0 and w > 0:
        return {'duration': round(n / fps, 3), 'fps': round(fps, 2), 'width': w, 'height': h, 'has_video': True}
    proc = subprocess.run([ffmpeg_exe(), '-hide_banner', '-i', str(path)], capture_output=True, text=True, timeout=25)
    m = re.search(r'Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)', proc.stderr)
    duration = (int(m.group(1))*3600 + int(m.group(2))*60 + float(m.group(3))) if m else 0
    return {'duration': round(duration, 3), 'fps': 0, 'width': 0, 'height': 0, 'has_video': False}


def thumbnail(path, dest):
    cap = cv2.VideoCapture(str(path))
    ok, frame = cap.read()
    cap.release()
    if ok:
        h, w = frame.shape[:2]
        frame = cv2.resize(frame, (min(780,w), max(1,round(h*min(780,w)/w))))
        cv2.imwrite(str(dest), frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return True
    return False


def extract_audio(path, max_sec=MAX_ANALYSIS_SECONDS):
    fd, wav_path = tempfile.mkstemp(prefix='ciftelia_', suffix='.wav')
    os.close(fd)
    try:
        run_ffmpeg(['-i', str(path), '-t', str(max_sec), '-vn', '-ac', '1', '-ar', str(SR), '-c:a', 'pcm_s16le', wav_path], timeout=360)
        sr, audio = wavfile.read(wav_path)
        if len(audio) == 0:
            raise RuntimeError('Videoja nuk ka audio të lexueshme.')
        return audio.astype(np.float32)/32768.0, sr
    finally:
        Path(wav_path).unlink(missing_ok=True)


def envelope(audio: np.ndarray, sr=SR, n_values=2500):
    """Lightweight waveform for drawing timeline."""
    if len(audio) < 1:
        return []
    size = max(1, math.ceil(len(audio)/n_values))
    result = [round(float(np.max(np.abs(audio[i:i+size]))),3) for i in range(0,len(audio),size)]
    return result[:n_values]


def detect_onsets(audio: np.ndarray, sr=SR, min_gap=0.095):
    """Transient detection based on positive spectral flux and attack in RMS."""
    if len(audio) < 512:
        return [], []
    hop = 160
    _, ts, z = stft(audio, fs=sr, nperseg=512, noverlap=512-hop, boundary='zeros')
    spec = np.abs(z)
    # Emphasize melodic transients; remove bass rumble.
    freq_bin = sr / 512
    spec[:int(95/freq_bin)] = 0
    spec = np.sqrt(spec)
    flux = np.maximum(0, np.diff(spec, axis=1, prepend=spec[:, :1])).sum(axis=0)
    rms = np.sqrt(np.mean(spec ** 2, axis=0))
    rise = np.maximum(0, np.diff(rms, prepend=rms[0]))
    flux /= max(np.percentile(flux, 99),1e-9)
    rise /= max(np.percentile(rise, 99),1e-9)
    strength = gaussian_filter1d(flux*0.8+rise*0.2, 1)
    active = strength[strength > max(0.02, np.percentile(strength, 50))]
    if active.size == 0:
        return [], envelope(audio)
    threshold = max(0.07, float(np.percentile(active, 56))*0.80)
    peaks, props = find_peaks(strength, height=threshold,
                               prominence=max(0.055, float(np.percentile(active, 58))*0.35),
                               distance=max(1,int(sr*min_gap/hop)))
    onset_times = []
    for k in peaks:
        t = float(ts[k])
        if t < 0.025:
            t = 0.0
        # STFT centered window produces a small timing offset.
        t = max(0.0,t-0.01)
        if onset_times and t-onset_times[-1] < min_gap:
            continue
        onset_times.append(round(t,3))
    return onset_times[:4000], envelope(audio)


def _spectral_magnitude(audio: np.ndarray, sr: int, t: float, length=0.135):
    start = int((t+0.025)*sr)
    end = min(len(audio),start+int(length*sr))
    chunk = audio[start:end]
    if len(chunk)<320:
        return None, None
    chunk = chunk - np.mean(chunk)
    win = np.hanning(len(chunk))
    nfft = 16384
    spec = np.abs(np.fft.rfft(chunk*win, n=nfft))
    freq = np.fft.rfftfreq(nfft,1/sr)
    return freq, spec


def _max_near(spec, freq, f, tol_hz=3):
    center = int(round(f/(freq[1]-freq[0])))
    delta = max(2,int(tol_hz/(freq[1]-freq[0])))
    return float(np.max(spec[max(0,center-delta):min(len(spec),center+delta+1)]))


def _transcriber_profile(freqs):
    from transcriber.schema import default_profile
    p=default_profile()
    if freqs:
        for tone in p['tones']:
            key='lart' if tone['string']=='upper' else 'poshte'
            index=0 if tone['fret']==14 else tone['fret']
            values=freqs.get(key,[])
            if index<len(values) and values[index] and float(values[index])>100:
                tone['frequency']=float(values[index])
    return p


def identify_tones(audio, sr, time_s, freqs):
    from transcriber.engine import fit_event
    p=_transcriber_profile(freqs)
    sample=round(time_s*sr)
    fitted,_=fit_event(audio,sr,sample,min(len(audio),sample+round(sr*.15)),p['tones'])
    return [{'string':'lart' if r['tone']['string']=='upper' else 'poshte',
             'fret':0 if r['tone']['fret']==14 else r['tone']['fret'],
             'freq':r['tone']['frequency'],'confidence':r['confidence']} for r in fitted]


def detect_audio_events(audio, sr=SR, freqs=None):
    from transcriber.engine import analyze_pcm
    result=analyze_pcm(audio,sr,_transcriber_profile(freqs))
    events=[{**n,'string':'lart' if n['string']=='upper' else 'poshte',
             'fret':0 if n['fret']==14 else n['fret'],'stroke':'unknown','source':'auto'} for n in result['notes']]
    return events,result['waveform']


def group_events(events, pause=0.95):
    group=1
    last = None
    for event in sorted(events,key=lambda e:(e.get('time',0),e.get('string') or '')):
        if last is not None and event['time']-last > pause:
            group+=1
        event['group']=group
        last=event['time']
    return events


def motion_track(path, roi, max_seconds=180, axis='vertical', invert=False):
    """Track average strong optical flow in hand ROI. Requires a fixed camera & close hand ROI.

    Direction is SCREEN direction, not inherently pick direction; user can invert/calibrate.
    """
    if not roi or roi.get('w',0)<0.03 or roi.get('h',0)<0.03:
        return [], []
    cap=cv2.VideoCapture(str(path))
    if not cap.isOpened():return [], []
    fps=float(cap.get(cv2.CAP_PROP_FPS))
    if fps<=0:cap.release();return [], []
    frame_skip=max(1,round(fps/24))
    time_list=[]; directions=[]; intensity=[]
    previous=None; idx=0
    while True:
        ok, frame=cap.read()
        if not ok:break
        t=idx/fps
        idx+=1
        if t>max_seconds: break
        if (idx-1)%frame_skip:continue
        h,w=frame.shape[:2]
        x=int(max(0,min(1,float(roi.get('x',0))))*w)
        y=int(max(0,min(1,float(roi.get('y',0))))*h)
        ww=int(min(1-float(roi.get('x',0)),float(roi.get('w',.25)))*w)
        hh=int(min(1-float(roi.get('y',0)),float(roi.get('h',.25)))*h)
        crop=frame[y:y+hh,x:x+ww]
        if crop.size==0: continue
        gray=cv2.cvtColor(cv2.resize(crop,(100,100)),cv2.COLOR_BGR2GRAY)
        gray=cv2.GaussianBlur(gray,(5,5),0)
        if previous is not None:
            flow=cv2.calcOpticalFlowFarneback(previous,gray,None,.5,2,13,2,5,1.1,0)
            component=flow[:,:,0 if axis=='horizontal' else 1]
            mags=np.sqrt(flow[:,:,0]**2 + flow[:,:,1]**2)
            cutoff=np.percentile(mags,75)
            mask=mags>max(0.13,cutoff)
            signed=float(np.median(component[mask])) if mask.sum()>8 else 0.0
            strength=float(np.median(mags[mask])) if mask.sum()>8 else 0.0
            if invert:signed=-signed
            time_list.append(float(t))
            directions.append(signed)
            intensity.append(strength)
        previous=gray
    cap.release()
    return time_list, directions


def combine_motion(events, times, dirs, ghost=True):
    if len(times)<6:
        return events,{'motion_samples':0,'recognized_strokes':0,'silent_movements':0}
    ts=np.asarray(times)
    vel=gaussian_filter1d(np.asarray(dirs),0.7)
    size=np.abs(vel)
    moving=size[size>0.05]
    threshold=max(.21,float(np.percentile(moving,43)) if moving.size else .3)
    recognized=0
    for ev in events:
        at=float(ev['time'])
        idx=np.where(np.abs(ts-at)<.12)[0]
        if idx.size==0:continue
        k=idx[np.argmax(size[idx])]
        if size[k] >= threshold:
            ev['stroke']='down' if vel[k]>0 else 'up'
            ev['stroke_confidence']=round(min(.94,float(size[k]/max(threshold*3,1e-3))),2)
            recognized+=1
    ghost_count=0
    if ghost:
        peaks,_=find_peaks(size,distance=max(2,int(.15/max(np.median(np.diff(ts)),.02))),
                           prominence=threshold*.75,height=threshold*1.35)
        onset_times=np.array([e['time'] for e in events])
        for k in peaks:
            t=float(ts[k])
            if len(onset_times) and np.min(np.abs(onset_times-t))<.125:
                continue
            # Reject peaks that don't show a coherent vertical movement, heuristic only.
            if abs(float(vel[k])) < threshold*1.35: continue
            events.append({'id':uuid.uuid4().hex[:12],'time':round(t,3),'duration':.095,
                           'string':'ghost','fret':None,'stroke': 'ghost_down' if vel[k]>0 else 'ghost_up',
                           'confidence':0.2,'source':'video','review':True,'group':1})
            ghost_count+=1
    events.sort(key=lambda e:(e['time'],e['string']))
    group_events(events)
    return events,{'motion_samples':len(times),'recognized_strokes':recognized,'silent_movements':ghost_count}


def analyze(media_path, settings):
    max_sec=min(MAX_ANALYSIS_SECONDS,max(3,int(settings.get('max_seconds',180))))
    audio, sr=extract_audio(media_path,max_sec)
    frequencies=settings.get('frequencies') or {'lart':UPPER_DEFAULT,'poshte':LOWER_DEFAULT}
    if not all(len(frequencies.get(k,[]))==14 for k in ('lart','poshte')):
        raise ValueError('Duhet të ketë 14 frekuenca (teli i hapur + 13 perde) për secilin tel.')
    events,wave=detect_audio_events(audio,sr,frequencies)
    motion_info={'motion_samples':0,'recognized_strokes':0,'silent_movements':0}
    info=media_info(media_path)
    if info['has_video'] and settings.get('roi'):
        times,dirs=motion_track(media_path,settings['roi'],min(max_sec,len(audio)/sr),
                                axis=settings.get('axis','vertical'), invert=bool(settings.get('invert',False)))
        events,motion_info=combine_motion(events,times,dirs, bool(settings.get('detect_ghosts',True)))
    return {'events':events,'waveform':wave,'analyzed_seconds':round(len(audio)/sr,2),
            'stats':{'events':len(events),'audio_onsets':len(set(e['time'] for e in events if e['source']=='auto')),
                     **motion_info},'settings':settings}
