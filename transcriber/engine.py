"""Measured-reference DSP baseline: onsets, joint harmonic fitting and reattack gating.

Confidence is an uncalibrated evidence score, NOT measured accuracy. Ambiguous
octave collisions and uncalibrated upper frets are explicitly reported for review.
"""
from __future__ import annotations
import hashlib
import time
import warnings
import numpy as np
from scipy.ndimage import gaussian_filter1d, median_filter
from scipy.optimize import nnls
from scipy.signal import find_peaks, stft
from . import VERSION
from .audio import decode, waveform, SR
from .schema import validate_profile, note_id

HOP = 128
NFFT = 8192
# Analytic initialization only; replaced by measured isolated-note profiles.
INITIAL_HARMONICS = np.array([1., .32, .19, .12, .09, .065, .05, .04])


def _unit(x):
    scale = np.percentile(x, 98) if len(x) else 0
    return x / max(float(scale), 1e-10)


def onsets(y, sr=SR, min_gap=.028):
    if len(y) < 64 or np.max(np.abs(y)) < 1e-6: return np.empty(0, dtype=int), []
    parts = []
    complex_novelty = None
    for size in (256, 1024):
        _, _, z = stft(y, fs=sr, nperseg=min(size, len(y)), noverlap=min(size, len(y)) - HOP if len(y) >= HOP else 0,
                       nfft=size, boundary="zeros", padded=True)
        spec = np.abs(z).astype(np.float32)
        spec[:max(1, round(85 * size / sr))] = 0
        # sqrt flux retains weak repeated strikes without normalizing silence to noise.
        root = np.sqrt(spec)
        flux = np.maximum(0, np.diff(root, axis=1, prepend=np.zeros_like(root[:, :1]))).sum(axis=0)
        parts.append(_unit(flux))
        if size == 1024:
            phase = np.angle(z)
            predicted = np.abs(z[:,1:-1]) * np.exp(1j*(2*phase[:,1:-1]-phase[:,:-2]))
            complex_novelty = np.pad(np.sum(np.abs(z[:,2:]-predicted),axis=0),(2,0))
    n = min(map(len, parts))
    energy = np.sqrt(gaussian_filter1d(np.asarray(y, dtype=np.float64)**2, sr * .002))
    max_energy = float(energy.max())
    max_rise = max(1e-12, float(np.diff(energy).max()))
    rms = energy[np.minimum(np.arange(n) * HOP, len(y)-1)]
    attack = np.maximum(0, np.diff(rms, prepend=0))
    strength = .23 * parts[0][:n] + .27 * parts[1][:n] + .10 * _unit(attack) + .40 * _unit(complex_novelty[:n])
    strength = gaussian_filter1d(strength, .45)
    baseline = median_filter(strength, size=43, mode="nearest")
    deviation = median_filter(np.abs(strength-baseline), size=43, mode="nearest")
    height = baseline + np.maximum(.095, 2.4 * deviation)
    peaks, _ = find_peaks(np.pad(strength, (1,1)), height=np.pad(height, (1,1), constant_values=100),
                          prominence=.13, distance=max(1, round(min_gap * sr / HOP)))
    peaks = peaks - 1
    found = []
    for k in peaks:
        if k < 0 or k >= n: continue
        # Smooth beating of ringing partials has flux, but little unexpected phase.
        if float(np.max(complex_novelty[max(0,k-1):k+2])) < float(np.max(complex_novelty))*.12:
            continue
        center = min(len(y)-1, k * HOP)
        left, right = max(0, center-round(sr*.022)), min(len(y), center+round(sr*.008))
        region = energy[left:right]
        if len(region) < 3: continue
        derivative = np.diff(region)
        at = left + int(np.argmax(derivative))
        peak_rise = float(derivative.max())
        # Backtrack a steep rise to the foot; do not subtract a fixed STFT offset.
        floor = float(np.percentile(energy[max(0,at-round(.04*sr)):at+1], 20))
        local_peak = float(energy[at:min(len(y),at+round(.012*sr))].max())
        threshold = floor + .12 * max(0, local_peak-floor)
        start = at
        while start > left and energy[start] > threshold and at-start < round(sr*.009): start -= 1
        if local_peak < max(1e-5, max_energy*.012) or peak_rise < max_rise*.012: continue
        if found and start - found[-1] < min_gap * sr:
            continue
        found.append(start)
    return np.asarray(found, dtype=int), strength.tolist()


def _complex_spectrum(y, sr, start, length):
    a, b = max(0, int(start)), min(len(y), int(start+length))
    chunk = np.asarray(y[a:b], dtype=float)
    if len(chunk) < 32: return np.zeros(NFFT//2+1)
    win = np.hanning(len(chunk))
    raw = np.fft.rfft((chunk - chunk.mean())*win, n=NFFT) * 2 / max(1, win.sum())
    # Absolute phase lets ringing be subtracted even when the next pluck cancels it.
    return raw * np.exp(-2j*np.pi*np.fft.rfftfreq(NFFT,1/sr)*a/sr)


def spectrum(y, sr, start, length):
    return np.abs(_complex_spectrum(y,sr,start,length))


def _template(tone, freq, resolution):
    weights = np.asarray(tone.get("harmonics", INITIAL_HARMONICS), dtype=float)
    out = np.zeros_like(freq)
    for h, w in enumerate(weights, 1):
        f = float(tone["frequency"]) * h
        if f >= freq[-1]: break
        out += w * np.exp(-.5 * ((freq-f)/resolution)**2)
    return out


def _near(spec, freq, f, width=9):
    mask = np.abs(freq - f) <= width
    return float(np.max(spec[mask])) if mask.any() else 0.


def _attack_evidence(tone, before, after, freq, elapsed=.07):
    f = float(tone["frequency"])
    # Fundamental has veto power for 220 reattacks; an ongoing 440/660 harmonic cannot create one.
    prev = _near(before, freq, f)
    post = _near(after, freq, f)
    tau = max(.05, float(tone.get("decay_seconds", .45)))
    predicted = prev * np.exp(-elapsed/tau)
    novelty = max(0., post-predicted)
    ratio = post / max(prev, 1e-8)
    active = post > max(2e-5, after.max() * .022)
    new = active and (prev < post*.20 or ratio > 1.14)
    return {"new_attack": bool(new), "fundamental": post, "previous": prev,
            "ratio": round(float(ratio), 4), "novelty": novelty}


def fit_event(y, sr, sample, next_sample, tones, cqt_hint=None):
    length = min(round(sr*.085), max(round(sr*.032), next_sample-sample-round(sr*.005)))
    offset = min(round(sr*.010), max(0, (next_sample-sample)//8))
    after_complex = _complex_spectrum(y, sr, sample+offset, length)
    before_complex = _complex_spectrum(y, sr, sample-length-round(sr*.005), length)
    after_full, before_full = np.abs(after_complex), np.abs(before_complex)
    freq_full = np.fft.rfftfreq(NFFT, 1/sr)
    mask = (freq_full >= 110) & (freq_full <= min(6500, sr/2-1))
    freq = freq_full[mask]
    after, before = after_full[mask], before_full[mask]
    if after.max() < 1e-5: return [], {"reason": "no_tonal_evidence"}
    noise = max(1e-8, float(np.median(after)))
    # Subtract expected ringing BEFORE fitting. Presence does not imply another strike.
    residual = np.maximum(0, np.abs(after_complex[mask] - before_complex[mask]*.82) - noise*1.5)
    scale = max(np.linalg.norm(residual), 1e-12)
    obs = residual/scale
    resolution = max(5., sr/max(length, 1)*.63)
    dictionary = np.array([_template(t, freq, resolution) for t in tones]).T
    dictionary /= np.maximum(np.linalg.norm(dictionary, axis=0), 1e-12)
    evidence = [_attack_evidence(t, before, after, freq) for t in tones]
    # A weak fundamental can still be a lower note; upper reattacks need fresh evidence.
    eligible = [i for i,t in enumerate(tones) if evidence[i]["new_attack"] or (
        t["string"] == "lower" and _near(residual,freq,float(t["frequency"])) > max(noise*5, after.max()*.055, evidence[i]["previous"]*.24))]
    if not eligible: return [], {"reason": "resonance_without_new_attack"}
    lower = [i for i in eligible if tones[i]["string"] == "lower"]
    upper = [i for i in eligible if tones[i]["string"] == "upper"]
    hypotheses = [(i,) for i in eligible] + [(l,u) for l in lower for u in upper]
    ranked = []
    for ids in hypotheses:
        matrix = dictionary[:, ids]
        coeff, err = nnls(matrix, obs)
        if np.any(coeff < .07): continue
        acoustic = err**2
        # The style prior is small and bounded; evidence controls acceptance.
        prior = .004 if len(ids)==1 and tones[ids[0]]["string"] == "upper" else 0.
        cost = acoustic + .055 * (len(ids)-1) + prior
        if cqt_hint is not None:
            support = np.mean([cqt_hint(t["frequency"]) for t in (tones[i] for i in ids)])
            cost -= min(.012, float(support)*.012)
        ranked.append((cost, acoustic, ids, coeff))
    if not ranked: return [], {"reason": "no_supported_hypothesis"}
    ranked.sort(key=lambda h: h[0])
    best = ranked[0]
    margin = ranked[1][0]-best[0] if len(ranked)>1 else .2
    if best[1] > .83: return [], {"reason": "poor_harmonic_fit", "residual_error": best[1]}
    if not any(evidence[i]['new_attack'] for i in best[2]) and best[1]>.45:
        return [],{"reason":"phase_residual_without_supported_reattack","residual_error":best[1]}
    results = []
    for i, coefficient in zip(best[2], best[3]):
        tone = tones[i]
        competing = [r[0] for r in ranked if i not in r[2]]
        separation = max(0, min(competing, default=best[0]+.2)-best[0])
        confidence = np.clip(.32 + .43*(1-best[1]) + .18*min(1,separation/.18), .05, .93)
        harmonic_collision = False
        for j in best[2]:
            if i == j: continue
            ratio = float(tone["frequency"])/float(tones[j]["frequency"])
            if 1.9 < ratio < 5.1 and abs(ratio-round(ratio)) < .035:
                harmonic_collision = True
        if harmonic_collision and not all(tones[j].get("measured") for j in best[2]):
            confidence = min(confidence, .54)
        string_ambiguous=any(other['string']!=tone['string'] and abs(1200*np.log2(float(tone['frequency'])/float(other['frequency'])))<70 for other in tones)
        if string_ambiguous:confidence=min(confidence,.54)
        results.append({"tone": tone, "confidence": round(float(confidence), 4),
                        "review": bool(confidence < .65 or harmonic_collision or string_ambiguous),
                        "evidence": {**evidence[i], "fit_residual": round(best[1], 5),
                                     "hypothesis_margin": round(float(margin), 5), "harmonic_collision": harmonic_collision,
                                     "template_measured": bool(tone.get("measured")), "coefficient": round(float(coefficient), 5)}})
        results[-1]['evidence']['string_ambiguous']=bool(string_ambiguous)
    return results, {"hypothesis": "paired" if len(results)==2 else results[0]["tone"]["string"],
                     "sample_index": int(sample), "residual_error": round(best[1], 5)}


def individual_sample(y, sr, sample, frequency):
    """Frequency-local attack refinement, within the same physical strum (±18ms).

    Short coherent demodulation is used only when a clear rise exists. This is
    an estimate at the declared resolution, not a claim of sample-level accuracy.
    """
    a,b = max(0,sample-round(.035*sr)), min(len(y),sample+round(.04*sr))
    chunk = np.asarray(y[a:b],dtype=float)
    if len(chunk)<64: return int(sample)
    carrier = np.exp(-2j*np.pi*frequency*np.arange(a,b)/sr)
    demod = chunk*carrier
    width=max(2,sr*.003)
    env = np.abs(gaussian_filter1d(demod.real,width)+1j*gaussian_filter1d(demod.imag,width))
    d = np.diff(env)
    lo,hi = max(0,sample-a-round(.012*sr)), min(len(d),sample-a+round(.018*sr))
    if hi<=lo: return int(sample)
    k=lo+int(np.argmax(d[lo:hi]))
    if d[k] <= max(1e-8, env.max()*.001): return int(sample)
    # center of smoothed attack is later than its foot
    return int(max(0, a+k-round(.003*sr)))


def _duration(y, sr, start, limit, frequency):
    length = max(16, round(sr*.026))
    hop=max(1,round(sr*.012))
    amps=[]; ends=[]
    for at in range(start, min(len(y),limit,start+round(sr*3)), hop):
        chunk=y[at:min(len(y),at+length)]
        if len(chunk)<16: break
        n=np.arange(len(chunk))
        amp=abs(np.sum(chunk*np.hanning(len(chunk))*np.exp(-2j*np.pi*frequency*n/sr)))/len(chunk)
        amps.append(amp); ends.append(min(len(y),at+length))
    if not amps:return min(len(y),start+round(.03*sr))
    peak=max(amps)
    end=ends[-1]
    for i in range(2,len(amps)-2):
        if max(amps[i:i+3]) < max(1e-6,peak*.07):end=ends[i];break
    return max(start+1,min(limit,len(y),end))


def tuning_diagnostics(y,sr,profile):
    """Infer a persistent low harmonic family; NEVER turn it into measured calibration."""
    reference=next((float(t["frequency"]) for t in profile["tones"] if t["string"]=="upper" and t["fret"]==14),220.)
    frequencies=np.fft.rfftfreq(NFFT,1/sr)
    frames=[]
    for at in np.linspace(0,max(0,len(y)-round(sr*.18)),min(24,max(1,int(len(y)/sr*2))),dtype=int):
        chunk=y[at:at+round(sr*.18)]
        if len(chunk)<512 or np.sqrt(np.mean(chunk**2))<1e-4:continue
        s=spectrum(y,sr,int(at),round(sr*.18))
        floor=max(float(np.median(s)),1e-8)
        frames.append((s/max(float(s.max()),1e-8),floor/max(float(s.max()),1e-8)))
    if len(frames)<3:return {"reference_upper_hz":reference,"possible_mismatch":False,"status":"insufficient_audio"}
    candidates=np.arange(180,281,.5);scores=[]
    for f in candidates:
        supports=[]
        for s,floor in frames:
            fundamental=_near(s,frequencies,f,width=3)
            supports.append(sum(_near(s,frequencies,f*h,width=4)*w for h,w in enumerate([.6,1.,.8,.6,.4],1)) if fundamental>max(.018,floor*6) else 0.)
        scores.append(float(np.median(supports)))
    k=int(np.argmax(scores));estimate=float(candidates[k]);ref_k=int(np.argmin(np.abs(candidates-reference)))
    mismatch=abs(estimate-reference)>max(8,reference*.04) and scores[k]>max(.25,scores[ref_k]*2.5)
    return {"reference_upper_hz":reference,"candidate_persistent_family_hz":estimate,"possible_mismatch":bool(mismatch),
            "method":"median_harmonic_family_scan; inference_only_not_calibration","score":scores[k]}


def analyze_pcm(y, sr=SR, profile=None, use_cqt=True):
    began=time.perf_counter()
    y=np.asarray(y,dtype=np.float32)
    if y.ndim != 1 or not 8000<=sr<=96000 or not np.isfinite(y).all(): raise ValueError("PCM i pavlefshëm.")
    profile=validate_profile(profile)
    tones=profile["tones"]
    tuning=tuning_diagnostics(y,sr,profile)
    attacks, strength=onsets(y,sr)
    cqt=None
    if use_cqt and len(y)>sr*.15 and len(attacks):
        import librosa
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            bins=max(24,min(116,int(np.ceil(24*np.log2(max(t['frequency'] for t in tones)*1.1/110)))+1))
            cqt=np.abs(librosa.cqt(y=y,sr=sr,hop_length=256,fmin=110,n_bins=bins,bins_per_octave=24)).astype(np.float32)
    notes=[]; events=[]; unresolved=[]
    for idx,s in enumerate(attacks):
        nxt=int(attacks[idx+1]) if idx+1<len(attacks) else len(y)
        hint=None
        if cqt is not None:
            col=min(cqt.shape[1]-1,round((s+sr*.035)/256))
            values=cqt[:,col]; vmax=max(1e-8,float(values.max()))
            def hint(f,values=values,vmax=vmax):
                k=round(24*np.log2(f/110))
                return float(values[k])/vmax if 0<=k<len(values) else 0.
        fitted, details=fit_event(y,sr,int(s),nxt,tones,hint)
        event_id="e-"+str(int(s))
        if not fitted:
            unresolved.append({"event_id":event_id,"sample_index":int(s),"time":int(s)/sr,**details})
            continue  # Never fabricate an open note when classification fails.
        events.append({"id":event_id,"time":int(s)/sr,**details})
        for result in fitted:
            tone=result["tone"]
            sample=individual_sample(y,sr,int(s),float(tone["frequency"]))
            notes.append({"id":note_id(tone["string"],tone["fret"],sample),"event_id":event_id,
                          "event_sample_index":int(s),"event_time":int(s)/sr,"sample_index":sample,"time":sample/sr,
                          "string":tone["string"],"fret":tone["fret"],"frequency":float(tone["frequency"]),
                          "confidence":result["confidence"],"confidence_status":"heuristic_uncalibrated",
                          "review":result["review"],"manual":False,"source":"dsp","group":1,"evidence":result["evidence"]})
    notes.sort(key=lambda n:(n["sample_index"],n["string"]))
    if tuning["possible_mismatch"]:
        for note in notes:
            note["review"]=True;note["confidence"]=min(note["confidence"],.54)
    groups=[];group=1;last=None
    event_times=sorted({n["event_sample_index"] for n in notes})
    event_groups={}
    for at in event_times:
        if last is not None and at-last>sr*.9:group+=1
        if not groups or groups[-1]["id"]!=group:groups.append({"id":group,"start_sample":int(at),"start":int(at)/sr,"manual":False})
        event_groups[at]=group;last=at
    for i,n in enumerate(notes):
        next_same=next((m["sample_index"] for m in notes[i+1:] if m["string"]==n["string"]),len(y))
        end=_duration(y,sr,n["sample_index"],next_same,n["frequency"])
        n.update(end_sample=end,end_time=end/sr,duration=(end-n["sample_index"])/sr,
                 duration_method="fundamental_decay_or_next_same_string_attack",release_uncertain=True,
                 group=event_groups[n["event_sample_index"]])
    # Bounded, real spectrogram for review. Full analysis is not rescaled to playback speed.
    _,_,z=stft(y,fs=sr,nperseg=min(1024,max(32,len(y))),noverlap=0,boundary="zeros") if len(y) else ([],[],np.zeros((513,1)))
    spec=np.abs(z)[:min(180,z.shape[0])]
    stride=max(1,int(np.ceil(spec.shape[1]/900)))
    spec=spec[:,::stride]
    db=np.clip(20*np.log10(spec/max(float(spec.max()),1e-10)+1e-7),-80,0)
    return {"schema":"ciftelia-transcription-v3","song":"Çifteli","notes":notes,"events":events,"groups":groups,
            "tombstones":[],"waveform":waveform(y),"spectrogram":{"db":np.round(db,1).tolist(),"max_hz":(len(spec)-1)*sr/1024},
            "audio":{"sample_rate":sr,"num_samples":len(y),"duration":len(y)/sr,"time_reference":"decoded_pcm_samples"},
            "analysis":{"version":VERSION,"engine":"dsp-harmonic-residual","ml_model":None,"profile_id":profile.get("id"),
                        "cqt_used":cqt is not None,"onset_hop_samples":HOP,"onset_hop_ms":HOP/sr*1000,
                        "onset_candidates":len(attacks),"recognized_events":len(events),"unresolved":unresolved,
                        "processing_seconds":round(time.perf_counter()-began,3),"confidence_calibrated":False,
                        "real_world_accuracy":None,"upper_fretted_calibrated":any(t["string"]=="upper" and t["fret"]!=14 for t in tones),
                        "tuning_diagnostics":tuning,
                        "limitations":["Uncalibrated harmonic collisions require review.","Rare upper frets need measured calibration.",
                                       "Confidence is heuristic, not a measured probability.","Release time is an acoustic estimate."]},"profile":profile}


def analyze_file(path,profile=None):
    y,metadata=decode(path)
    result=analyze_pcm(y,metadata["sample_rate"],profile)
    result["audio"].update(metadata)
    result["song"]=metadata["filename"].rsplit(".",1)[0]
    result["id"]=hashlib.sha256(metadata["sha256"].encode()).hexdigest()[:20]
    return result
