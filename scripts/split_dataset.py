"""Partition a private labeled manifest by session; original audio is never copied."""
import argparse
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from transcriber.evaluate import split_sessions

parser=argparse.ArgumentParser();parser.add_argument('manifest');parser.add_argument('output')
args=parser.parse_args();path=Path(args.manifest);manifest=json.loads(path.read_text())
split=split_sessions(manifest['recordings'])
out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
for name,rows in split.items():
    records=[{**r,'audio':str((path.parent/r['audio']).resolve()),'labels':str((path.parent/r['labels']).resolve())} for r in rows]
    (out/(name+'.json')).write_text(json.dumps({**manifest,'recordings':records,'split':name},indent=2,ensure_ascii=False))
print(json.dumps({k:len(v) for k,v in split.items()}))
