"""One-to-one matching, transparent denominators and session-isolated dataset splits.

python -m transcriber.evaluate --manifest PRIVATE_MANIFEST.json --output reports/test.json
Only a manifest whose annotations_verified=true may be reported as verified accuracy.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from scipy.optimize import linear_sum_assignment
from .engine import analyze_file
from .schema import import_notes


def matches(reference,predicted,tolerance=.05,require_note=False):
    if not reference or not predicted:return []
    costs=np.full((len(reference),len(predicted)),1e6,dtype=float)
    for i,a in enumerate(reference):
        for j,b in enumerate(predicted):
            delta=abs(a["time"]-b["time"])
            if delta<=tolerance and (not require_note or (a["string"],a["fret"])==(b["string"],b["fret"])):costs[i,j]=delta
    rows,cols=linear_sum_assignment(costs)
    return [(int(i),int(j),float(costs[i,j])) for i,j in zip(rows,cols) if costs[i,j]<1e5]


def prf(tp,fp,fn):
    precision=tp/(tp+fp) if tp+fp else None
    recall=tp/(tp+fn) if tp+fn else None
    f1=2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else None
    return {"tp":tp,"fp":fp,"fn":fn,"precision":precision,"recall":recall,"f1":f1}


def event_rows(notes):
    # De-duplicate simultaneous annotations by explicit event IDs or 20ms physical strums.
    rows=[];seen=set()
    for n in sorted(notes,key=lambda n:n["time"]):
        key=n.get("event_id")
        if key and key in seen:continue
        if not key and rows and n["time"]-rows[-1]["time"]<.02:continue
        if key:seen.add(key)
        rows.append(n)
    return rows


def metrics(reference,predicted,tolerance=.05):
    pairs=matches(reference,predicted,tolerance,True)
    onset_ref,onset_pred=event_rows(reference),event_rows(predicted)
    onset_pairs=matches(onset_ref,onset_pred,tolerance)
    result={"notes":prf(len(pairs),len(predicted)-len(pairs),len(reference)-len(pairs)),
            "onsets":prf(len(onset_pairs),len(onset_pred)-len(onset_pairs),len(onset_ref)-len(onset_pairs)),
            "time_tolerance_ms":tolerance*1000}
    errors=np.asarray([p[2]*1000 for p in onset_pairs])
    result["timing_ms"]={"matched":len(errors),"mean_absolute":float(errors.mean()) if len(errors) else None,
                         "median_absolute":float(np.median(errors)) if len(errors) else None,
                         "p95_absolute":float(np.percentile(errors,95)) if len(errors) else None}
    for string in ("lower","upper"):
        a=[n for n in reference if n["string"]==string];b=[n for n in predicted if n["string"]==string]
        correct=matches(a,b,tolerance,True);temporal=matches(a,b,tolerance)
        result[string]=prf(len(correct),len(b)-len(correct),len(a)-len(correct))
        result[string]["fret_accuracy_on_time_matched"]=sum(a[i]["fret"]==b[j]["fret"] for i,j,_ in temporal)/len(temporal) if temporal else None
    a=[n for n in reference if n["string"]=="upper" and n["fret"]==14]
    b=[n for n in predicted if n["string"]=="upper" and n["fret"]==14]
    m=matches(a,b,tolerance,True);result["upper_220_reattacks"]=prf(len(m),len(b)-len(m),len(a)-len(m))
    paired_ref=[n for n in onset_ref if any(m["string"]!=n["string"] and abs(m["time"]-n["time"])<.025 for m in reference)]
    paired_pred=[n for n in onset_pred if any(m["string"]!=n["string"] and abs(m["time"]-n["time"])<.025 for m in predicted)]
    m=matches(paired_ref,paired_pred,tolerance);result["paired_strums"]=prf(len(m),len(paired_pred)-len(m),len(paired_ref)-len(m))
    matched_pred={j for _,j,_ in pairs}
    bins=[];ece=0.;brier=0.
    for lo in np.arange(0,1,.1):
        indices=[j for j,n in enumerate(predicted) if lo<=float(n.get("confidence",0))<lo+.1+(1e-8 if lo>.85 else 0)]
        if not indices:continue
        conf=np.mean([float(predicted[j].get("confidence",0)) for j in indices]);acc=np.mean([j in matched_pred for j in indices])
        bins.append({"lower":round(float(lo),1),"count":len(indices),"mean_confidence":float(conf),"empirical_accuracy":float(acc)})
        ece+=len(indices)*abs(conf-acc)
    for j,n in enumerate(predicted):brier+=(float(n.get("confidence",0))-(j in matched_pred))**2
    result["confidence"]={"ece":float(ece/len(predicted)) if predicted else None,"brier":brier/len(predicted) if predicted else None,
                          "bins":bins,"population":"predicted_notes_only; false negatives counted in recall"}
    return result


def split_sessions(records):
    """All takes of a performer/session/instrument group stay in one split."""
    groups={}
    for record in records:
        key=record.get("leakage_group") or record.get("session_id")
        if not key:raise ValueError("Çdo regjistrim kërkon session_id ose leakage_group.")
        groups.setdefault(key,[]).append(record)
    keys=sorted(groups,key=lambda k:hashlib.sha256(k.encode()).hexdigest())
    if len(keys)<3:raise ValueError("Duhen të paktën tri sesione të pavarura për train/validation/test.")
    n_test=max(1,round(len(keys)*.15));n_val=max(1,round(len(keys)*.15))
    split={"train":[],"validation":[],"test":[]}
    for i,k in enumerate(keys):
        name="test" if i<n_test else "validation" if i<n_test+n_val else "train"
        split[name].extend(groups[k])
    return split


def main():
    parser=argparse.ArgumentParser();parser.add_argument("--manifest",required=True);parser.add_argument("--output",required=True)
    args=parser.parse_args();path=Path(args.manifest);manifest=json.loads(path.read_text())
    records=manifest["recordings"];output={"annotations_verified":bool(manifest.get("annotations_verified")),"recordings":[],"categories":{}}
    pooled={}
    for r in records:
        audio=path.parent/r["audio"];labels=json.loads((path.parent/r["labels"]).read_text())
        prediction=analyze_file(audio,manifest.get("profile"));reference=import_notes(labels,prediction["audio"]["sample_rate"])
        score=metrics(reference,prediction["notes"]);kind=r.get("category","unspecified")
        output["recordings"].append({"id":r["id"],"category":kind,"metrics":score,"analysis":prediction["analysis"]})
        a,b=pooled.setdefault(kind,([],[]))
        offset=(max((n["time"] for n in a+b),default=0)+10) if a or b else 0
        a.extend({**n,"time":n["time"]+offset,"event_id":r["id"]+":"+n["event_id"]} for n in reference)
        b.extend({**n,"time":n["time"]+offset,"event_id":r["id"]+":"+n["event_id"]} for n in prediction["notes"])
    output["categories"]={k:metrics(a,b) for k,(a,b) in pooled.items()}
    output["missing_categories"]=[k for k in ("slow","fast","difficult") if k not in pooled]
    Path(args.output).parent.mkdir(parents=True,exist_ok=True)
    Path(args.output).write_text(json.dumps(output,indent=2,ensure_ascii=False))
    print(json.dumps({"report":args.output,"verified":output["annotations_verified"],"recordings":len(records)}))


if __name__=="__main__":main()
