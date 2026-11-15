"""Canonical seconds/sample-index schema and loss-aware legacy adapters."""
from __future__ import annotations
import copy
import hashlib
import math

LOWER = {14: 293., **dict(enumerate([329.,358.,389.,440.,477.,521.,587.,660.,719.,784.,880.,960.,1050.], 1))}


def default_profile():
    return {"version": 1, "id": "reference-220-293", "name": "Çiftelia 220 / 293",
            "tones": [{"string": "upper", "fret": 14, "frequency": 220., "measured": False}] +
                     [{"string": "lower", "fret": fret, "frequency": freq, "measured": False,
                       "reference_source": "user_measured_reference"} for fret, freq in LOWER.items()],
            "recordings": []}


def validate_profile(profile):
    p = copy.deepcopy(profile or default_profile())
    if not isinstance(p.get("tones"), list) or not 1 <= len(p["tones"]) <= 28:
        raise ValueError("Profili duhet të ketë 1–28 referenca notash.")
    seen = set()
    for t in p["tones"]:
        key = (t.get("string"), t.get("fret"))
        if key[0] not in ("upper", "lower") or isinstance(key[1], bool) or not isinstance(key[1], int) or not 1 <= key[1] <= 14 or key in seen:
            raise ValueError("Tel/perde e pavlefshme ose e përsëritur; hapur = 14.")
        f = float(t.get("frequency", 0))
        if not math.isfinite(f) or not 100 <= f <= 2500:
            raise ValueError("Frekuenca duhet të jetë 100–2500 Hz.")
        weights = t.get("harmonics")
        if weights is not None and (not 3 <= len(weights) <= 12 or any(not math.isfinite(float(w)) or float(w) < 0 or float(w) > 20 for w in weights)):
            raise ValueError("Profil harmonik i pavlefshëm.")
        seen.add(key)
    return p


def note_id(string, fret, sample, namespace="auto"):
    return hashlib.sha256(f"{namespace}:{string}:{fret}:{sample}".encode()).hexdigest()[:20]


def import_notes(raw, sr=22050):
    """Explicit format detection: legacy noteNumber times are ms; v3 times are seconds.

    withF is honored only as an imported annotation, never used by the detector.
    """
    root = raw if isinstance(raw, dict) else {}
    items = raw if isinstance(raw, list) else root.get("events", root.get("notes", root.get("tablature", [])))
    if not isinstance(items, list) or len(items) > 100000:
        raise ValueError("JSON duhet të përmbajë listën notes/events.")
    sr = int(root.get("audio", {}).get("sample_rate", sr))
    if not 8000 <= sr <= 192000:
        raise ValueError("Sample rate i pavlefshëm.")
    out = []
    group_starts = sorted(set(float(e["groupStart"]) for e in items if e.get("groupStart") is not None))
    stanzas = root.get("stanzas") or []
    for i, item in enumerate(items):
        e = copy.deepcopy(item)
        if e.get("string") == "ghost":
            continue
        legacy = "noteNumber" in e
        time = float(e.get("time", e.get("start", 0))) / (1000 if legacy else 1)
        sample = int(e["sample_index"]) if "sample_index" in e and not legacy else round(time * sr)
        time = sample / sr
        if not math.isfinite(time) or time < 0:
            raise ValueError("Koha e notës është e pavlefshme.")
        string = "upper" if e.get("string") in ("upper", "lart", "top", 2, "2", 0, "0") else "lower"
        fret = int(e.get("noteNumber", e.get("fret", 14)))
        if legacy and fret == 15:
            fret, string = 14, "lower"  # existing ciftelia catalog: G/open lower
        elif legacy and fret == 14:
            string = "upper"  # existing catalog: F/open upper, even old string:1 rows
        if fret == 0: fret = 14  # old ciftelia-studio-v1
        if not 1 <= fret <= 14: raise ValueError("Perdja duhet të jetë 1–14.")
        duration = float(e.get("duration", .2))
        if legacy and root.get("duration_unit") == "milliseconds": duration /= 1000
        if not math.isfinite(duration) or duration < 0: raise ValueError("Zgjatje e pavlefshme.")
        group = int(e.get("group", 1))
        if legacy and not e.get("group"):
            marker = float(e.get("groupStart", time * 1000))
            group = max(1, sum(g <= marker for g in group_starts))
            if stanzas:
                group = max(1, sum(float(s.get("startMs", s.get("start", s.get("time", 0)))) <= time * 1000 for s in stanzas if isinstance(s, dict)))
        end = max(sample, int(e.get("end_sample", round((time + duration) * sr))))
        n = {**e, "id": str(e.get("id") or note_id(string, fret, sample, f"import-{i}")),
             "event_id": str(e.get("event_id") or f"import-{sample}"), "string": string, "fret": fret,
             "sample_index": sample, "time": time, "end_sample": end, "end_time": end / sr,
             "duration": (end - sample) / sr, "group": group,
             "frequency": e.get("frequency", e.get("freq", LOWER.get(fret) if string == "lower" else (220 if fret == 14 else None))),
             "confidence": float(e.get("confidence", 0)), "confidence_status": e.get("confidence_status", "imported_unverified"),
             "manual": bool(e.get("manual", e.get("source") in ("manual", "import"))),
             "source": e.get("source", "import"), "review": bool(e.get("review", False))}
        out.append(n)
        if legacy and e.get("withF") and string == "lower":
            upper = copy.deepcopy(n)
            upper.update(id=n["id"] + "-upper", string="upper", fret=int(e.get("upperNoteNumber", 14)), frequency=220 if int(e.get("upperNoteNumber", 14)) == 14 else None)
            out.append(upper)
    return sorted(out, key=lambda e: (e["sample_index"], e["string"]))


def legacy_export(project):
    """One row per note, existing numeric strings (2 upper / 1 lower), explicit ms.

    Independent rows preserve staggered paired strokes. No synthetic withF flags.
    """
    groups=project.get("groups",[])
    return {"id": project.get("catalog_id",project.get("id", "ciftelia-transcription")), "name": project.get("song", "Çifteli"),
            "schema": "ciftelia-catalog-v1", "time_unit": "milliseconds", "preferNotes": True,
            "originalAudioName": project.get("audio", {}).get("filename"),
            "notes": [{"id": n["id"], "time": n["time"] * 1000, "noteNumber": 15 if n["string"] == "lower" and n["fret"] == 14 else n["fret"],
                       "string": 2 if n["string"] == "upper" else 1, "confidence": n["confidence"],
                       "withF": False, "group": n["group"], "groupStart":round(next((g["start"] for g in groups if g["id"]==n["group"]),0)*1000),
                       "event_id": n["event_id"], "duration": n["duration"],
                       "manual": n.get("manual", False)} for n in project["notes"]],
            "stanzas": [{"start": start, "label": f"Grupi {i+1}", "color": "#42bdae"} for i,start in enumerate(sorted({0,*[round(g["start"]*1000) for g in groups]}))]}


def merge_manual(previous, automatic, tombstones=None, sr=22050):
    """Keep edits, additions AND deletions. Match by time/string, not unstable IDs."""
    manual = [copy.deepcopy(n) for n in previous if n.get("manual") or n.get("source") in ("manual", "import")]
    tombstones = tombstones or []
    blockers = manual + tombstones
    kept = [copy.deepcopy(n) for n in automatic if not any(
        n["string"] == b["string"] and abs(n["sample_index"] - int(b.get("original_sample_index", b["sample_index"]))) <= sr * .045
        for b in blockers)]
    return sorted(kept + manual, key=lambda n: (n["sample_index"], n["string"]))
