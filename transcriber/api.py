"""Local FastAPI service with persistent job status and real audio analysis."""
from __future__ import annotations
import json
import os
import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse,FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from . import VERSION
from .calibration import calibrate_file
from .engine import analyze_file
from .schema import default_profile,validate_profile,merge_manual,import_notes

ROOT=Path(__file__).resolve().parents[1]
DATA=Path(os.environ.get("CIFTELIA_DATA_DIR",str(ROOT/"data"/"transcriber")))
MAX_UPLOAD=256*1024*1024
EXTENSIONS={".mp3",".wav",".flac",".ogg",".m4a",".aac",".webm",".mp4",".mov",".aiff"}
POOL=ThreadPoolExecutor(max_workers=1,thread_name_prefix="ciftelia-dsp")
LOCK=threading.Lock()


@asynccontextmanager
async def lifespan(app):
    for path in (DATA/"jobs").glob("*.json"):
        try:
            job=json.loads(path.read_text())
            if job.get("status") in ("running","queued"):
                write_json(path,{"id":job["id"],"status":"failed","error":"Serveri u rinis gjatë analizës. Nise përsëri nga audioja origjinale."})
        except (OSError,ValueError,KeyError):pass
    yield


app=FastAPI(title="Çiftelia AI Transcriber",version=VERSION,lifespan=lifespan)
origins=[x.strip() for x in os.environ.get("CIFTELIA_ALLOWED_ORIGINS","http://localhost:5173,http://127.0.0.1:5173").split(",") if x.strip()]
app.add_middleware(CORSMiddleware,allow_origins=origins,allow_methods=["GET","POST"],allow_headers=["Content-Type"])


def write_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value,ensure_ascii=False,allow_nan=False),encoding="utf-8")
    tmp.replace(path)


def job_path(job_id):
    if not re.fullmatch("[a-f0-9]{32}",job_id):raise HTTPException(404,"Analiza nuk u gjet.")
    return DATA/"jobs"/(job_id+".json")


def parse_json(value,default=None):
    try:return json.loads(value) if value else default
    except (ValueError,TypeError) as e:raise HTTPException(422,"JSON i pavlefshëm.") from e


async def store_upload(file,job_id):
    ext=Path(file.filename or "audio.wav").suffix.lower()
    if ext not in EXTENSIONS:raise HTTPException(415,"Përdor MP3, WAV, FLAC, OGG, M4A ose WEBM.")
    path=DATA/"uploads"/(job_id+ext);path.parent.mkdir(parents=True,exist_ok=True)
    size=0
    try:
        with path.open("wb") as dst:
            while chunk:=await file.read(1024*1024):
                size+=len(chunk)
                if size>MAX_UPLOAD:raise HTTPException(413,"Kufiri është 256 MB.")
                dst.write(chunk)
        if not size:raise HTTPException(422,"Skedari është bosh.")
        return path
    except BaseException:
        path.unlink(missing_ok=True);raise
    finally:await file.close()


def execute_job(job_id,path,filename,profile,previous):
    target=job_path(job_id)
    try:
        write_json(target,{"id":job_id,"status":"running","stage":"STFT / CQT / analiza e goditjeve dhe harmonikave"})
        result=analyze_file(path,profile)
        result["song"]=Path(filename or "Çifteli").stem
        result["audio"]["filename"]=filename
        if previous:
            sr=result["audio"]["sample_rate"]
            # Results from another audio must never be mixed into this song.
            old_sha=previous.get("audio",{}).get("sha256")
            if old_sha and old_sha!=result["audio"]["sha256"]:raise ValueError("Korrigjimet i përkasin një audioje tjetër.")
            result["notes"]=merge_manual(import_notes(previous,sr),result["notes"],previous.get("tombstones",[]),sr)
            result["tombstones"]=previous.get("tombstones",[])
            manual_groups=[g for g in previous.get("groups",[]) if g.get("manual")]
            if manual_groups:result["groups"]=manual_groups
        write_json(target,{"id":job_id,"status":"done","result":result})
    except Exception as e:
        write_json(target,{"id":job_id,"status":"failed","error":str(e)[:800]})
    finally:
        # Uploaded source is unnecessary after analysis; browser retains the original.
        path.unlink(missing_ok=True)


@app.get("/api/v3/health")
def health():return {"status":"ok","version":VERSION,"engine":"dsp","ml_model":None,"accuracy_verified":False}


@app.get("/api/v3/profile")
def profile():return default_profile()


@app.post("/api/v3/analyze",status_code=202)
async def analyze(file:UploadFile=File(...),profile:str=Form(""),previous:str=Form("")):
    try:p=validate_profile(parse_json(profile))
    except ValueError as e:raise HTTPException(422,str(e)) from e
    old=parse_json(previous)
    filename=Path((file.filename or "audio").replace("\\","/")).name
    job_id=uuid.uuid4().hex
    path=await store_upload(file,job_id)
    write_json(job_path(job_id),{"id":job_id,"status":"queued"})
    POOL.submit(execute_job,job_id,path,filename,p,old)
    return {"id":job_id,"status":"queued"}


@app.get("/api/v3/jobs/{job_id}")
def job(job_id:str):
    path=job_path(job_id)
    if not path.is_file():raise HTTPException(404,"Analiza nuk u gjet.")
    return json.loads(path.read_text(encoding="utf-8"))


@app.post("/api/v3/calibrate")
async def calibrate(file:UploadFile=File(...),string:str=Form(...),fret:int=Form(...),profile:str=Form(""),strength:str=Form("medium"),target_hz:float|None=Form(None)):
    p=parse_json(profile)
    path=await store_upload(file,uuid.uuid4().hex)
    try:
        result,recording=await run_in_threadpool(calibrate_file,path,string,fret,p,strength,target_hz)
        return {"profile":result,"measurement":recording}
    except ValueError as e:raise HTTPException(422,str(e)) from e
    finally:path.unlink(missing_ok=True)


@app.get("/")
def index():return RedirectResponse("/studio/")


if (ROOT/"studio").is_dir():app.mount("/studio",StaticFiles(directory=ROOT/"studio",html=True),name="studio")
if (ROOT/"static").is_dir():app.mount("/static",StaticFiles(directory=ROOT/"static"),name="legacy-static")
if (ROOT/"web").is_dir():app.mount("/web",StaticFiles(directory=ROOT/"web"),name="legacy-web")


@app.get("/legacy.html")
def legacy():
    if not (ROOT/"legacy.html").is_file():raise HTTPException(404,"Studioja e mëparshme nuk është instaluar.")
    return FileResponse(ROOT/"legacy.html")


def main():
    import uvicorn
    uvicorn.run("transcriber.api:app",host="127.0.0.1",port=8765)


if __name__=="__main__":main()
