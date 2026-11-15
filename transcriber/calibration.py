"""Calibration from actual isolated plucks. No inferred upper fret frequencies."""
from __future__ import annotations
import copy
import hashlib
import numpy as np
from .audio import decode
from .engine import onsets, spectrum, NFFT
from .schema import validate_profile


def calibrate_pcm(y,sr,string,fret,profile=None,strength="medium",target_hz=None):
    if string not in ("upper","lower") or not 1<=int(fret)<=14:raise ValueError("Tel/perde e pavlefshme.")
    if strength not in ("light","medium","strong"):raise ValueError("Zgjidh light, medium ose strong.")
    if len(y)<sr*.15:raise ValueError("Regjistro të paktën 0.15 s të një note të izoluar.")
    p=validate_profile(profile)
    prior=next((t for t in p["tones"] if t["string"]==string and t["fret"]==int(fret)),None)
    target=float(target_hz or (prior or {}).get("frequency",0))
    attacks,_=onsets(y,sr,min_gap=.08)
    at=int(attacks[0]) if len(attacks) else 0
    end=min(len(y),int(attacks[1]) if len(attacks)>1 else at+round(sr*.65))
    clip=np.asarray(y[at+round(sr*.018):end],dtype=np.float32)
    if len(clip)<512 or np.sqrt(np.mean(clip**2))<1e-5:raise ValueError("Nuk ka tingull të mjaftueshëm për kalibrim.")
    import librosa
    fmin=max(100,target*.84) if target else 130
    fmax=min(sr/3,target*1.16) if target else 1800
    frequencies=librosa.yin(clip,fmin=fmin,fmax=fmax,sr=sr,frame_length=min(2048,2**int(np.floor(np.log2(len(clip))))),hop_length=128)
    valid=frequencies[np.isfinite(frequencies)]
    if not len(valid):raise ValueError("Frekuenca nuk u mat; regjistro një tel të vetëm.")
    measured=float(np.median(valid))
    spread=float(np.percentile(valid,75)-np.percentile(valid,25))
    if spread>measured*.06:raise ValueError("Lartësia ndryshon shumë; përdor një notë të izoluar pa telin tjetër.")
    freq=np.fft.rfftfreq(NFFT,1/sr)
    spectra=[spectrum(y,sr,at+round(sr*t),round(sr*.11)) for t in (.02,.07,.12) if at+sr*(t+.11)<end]
    if not spectra:spectra=[spectrum(clip,sr,0,min(len(clip),round(sr*.11)))]
    spec=np.median(spectra,axis=0)
    harmonics=[]
    for h in range(1,9):
        mask=np.abs(freq-measured*h)<max(7,measured*.008)
        harmonics.append(float(spec[mask].max()) if mask.any() else 0.)
    base=max(harmonics[0],1e-8)
    harmonics=[min(20,h/base) for h in harmonics]
    # Log-linear regression over energy decay after the attack peak.
    step=max(1,round(sr*.012)); env=[];times=[]
    for k in range(at+round(sr*.04),end-round(sr*.02),step):
        env.append(float(np.sqrt(np.mean(np.asarray(y[k:k+step],dtype=float)**2))));times.append((k-at)/sr)
    tau=.45
    if len(env)>5:
        env=np.asarray(env);times=np.asarray(times);mask=env>max(env.max()*.08,1e-6)
        if mask.sum()>4:
            slope=np.polyfit(times[mask],np.log(env[mask]+1e-12),1)[0]
            if slope<-.05:tau=float(np.clip(-1/slope,.03,5))
    digest=hashlib.sha256(np.asarray(y,dtype=np.float32).tobytes()).hexdigest()
    recording={"sha256_pcm":digest,"string":string,"fret":int(fret),"strength":strength,
               "frequency":measured,"harmonics":harmonics,"decay_seconds":tau,"onset_sample":at,
               "sample_rate":sr,"samples":len(y),"frequency_iqr":spread,"kind":"isolated"}
    if any(r.get("sha256_pcm")==digest for r in p.get("recordings",[])):raise ValueError("Ky regjistrim është përdorur tashmë.")
    p.setdefault("recordings",[]).append(recording)
    samples=[r for r in p["recordings"] if r.get("string")==string and r.get("fret")==int(fret) and r.get("kind")=="isolated"]
    tone={"string":string,"fret":int(fret),"frequency":float(np.median([r["frequency"] for r in samples])),
          "harmonics":np.median([r["harmonics"] for r in samples],axis=0).tolist(),
          "decay_seconds":float(np.median([r["decay_seconds"] for r in samples])),"measured":True,
          "recording_count":len(samples),"strengths":sorted({r["strength"] for r in samples})}
    p["tones"]=[t for t in p["tones"] if not (t["string"]==string and t["fret"]==int(fret))]+[tone]
    p["id"]="cal-"+hashlib.sha256("".join(sorted(r["sha256_pcm"] for r in p["recordings"])).encode()).hexdigest()[:20]
    return validate_profile(p),recording


def calibrate_file(path,string,fret,profile=None,strength="medium",target_hz=None):
    y,meta=decode(path)
    return calibrate_pcm(y,meta["sample_rate"],string,fret,profile,strength,target_hz)
