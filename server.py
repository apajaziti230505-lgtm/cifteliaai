"""Local-only çifteli studio. Start with: python server.py"""
from __future__ import annotations
import json
import mimetypes
import os
import re
import socket
import threading
import traceback
import uuid
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from analyzer import analyze, media_info, thumbnail, LOWER_DEFAULT, UPPER_DEFAULT, run_ffmpeg

ROOT=Path(__file__).resolve().parent
STATIC=ROOT/'static'
DATA=ROOT/'data'
MEDIA=DATA/'media'
PROJECTS=DATA/'projects'
for d in (DATA, MEDIA, PROJECTS): d.mkdir(parents=True,exist_ok=True)
ACTIVE=DATA/'active.json'
MAX_UPLOAD=500*1024*1024
EXTENSIONS={'.mp4','.mov','.m4v','.webm','.mkv','.avi','.mp3','.wav','.m4a','.aac','.flac'}
CURRENT_LOCK=threading.Lock()


def read_active():
    if ACTIVE.exists():
        try:return json.loads(ACTIVE.read_text(encoding='utf-8'))
        except Exception:pass
    return None


def atomic_json(path,data):
    tmp=path.with_suffix('.tmp')
    tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    tmp.replace(path)


def get_project():
    active=read_active()
    if not active:return None
    path=PROJECTS/(str(active['id'])+'.json')
    if not path.is_file():return None
    return json.loads(path.read_text(encoding='utf-8'))


def save_project(data):
    meta=data.get('media') or {}
    pid=str(meta.get('id') or '')
    if not re.fullmatch('[a-f0-9]{32}',pid):
        raise ValueError('Identifikim i pavlefshëm i projektit.')
    path=PROJECTS/(pid+'.json')
    with CURRENT_LOCK:
        atomic_json(path,data)
        atomic_json(ACTIVE,{'id':pid})


def safe_event(event):
    if not isinstance(event,dict):raise ValueError('Event i pavlefshëm')
    try:
        t=max(0,float(event.get('time',0)))
        duration=max(0.03,min(20.0,float(event.get('duration',0.2))))
    except (ValueError, TypeError):raise ValueError('Koha ose zgjatja është e pavlefshme')
    string=event.get('string','poshte')
    if string not in ('poshte','lart','ghost'):raise ValueError('Tel i panjohur')
    fret=event.get('fret',0)
    if string=='ghost':fret=None
    else:
        if fret is None or int(fret)!=float(fret) or not 0<=int(fret)<=13:
            raise ValueError('Perdja duhet 0–13')
        fret=int(fret)
    stroke=event.get('stroke','unknown')
    if stroke not in ('down','up','unknown','ghost_up','ghost_down'):
        stroke='unknown'
    return {'id':str(event.get('id') or uuid.uuid4().hex[:12])[:40],
            'time':round(t,3),'duration':round(duration,3),'string':string,'fret':fret,
            'stroke':stroke,'confidence':round(max(0,min(1,float(event.get('confidence',0)))),2),
            'source':str(event.get('source','manual'))[:24],
            'review':bool(event.get('review',False)),
            'group':max(1,min(9999,int(event.get('group',1))))}


class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    server_version='CifteliaStudio/1.0'

    def log_message(self,fmt,*args):
        print('[lokal]',fmt%args)

    def send_json(self,data,status=200):
        body=json.dumps(data,ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(body)))
        self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers()
        self.wfile.write(body)

    def body_json(self, limit=3_000_000):
        length=int(self.headers.get('Content-Length','0'))
        if length<0 or length>limit:raise ValueError('Kërkesa është shumë e madhe')
        return json.loads(self.rfile.read(length) or b'{}')

    def serve_file(self,file,content_type=None):
        file=Path(file)
        if not file.is_file():return self.send_json({'error':'Skedari nuk u gjet.'},404)
        total=file.stat().st_size
        range_header=self.headers.get('Range','')
        match=re.match(r'^bytes=(\d*)-(\d*)$',range_header)
        start=0;end=total-1
        if match:
            s,e=match.groups()
            if s:start=int(s)
            if e:end=int(e)
            if not s and e:
                start=max(0,total-int(e));end=total-1
            if start>=total or end<start:
                self.send_response(416)
                self.send_header('Content-Range',f'bytes */{total}')
                self.send_header('Content-Length','0')
                self.end_headers()
                return
            end=min(end,total-1)
        length=max(0,end-start+1)
        self.send_response(206 if match else 200)
        self.send_header('Content-Type',content_type or mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
        self.send_header('Content-Length',str(length))
        self.send_header('Accept-Ranges','bytes')
        self.send_header('X-Content-Type-Options','nosniff')
        if match:self.send_header('Content-Range',f'bytes {start}-{end}/{total}')
        self.end_headers()
        try:
            with file.open('rb') as f:
                f.seek(start)
                while length>0:
                    chunk=f.read(min(length,1024*512))
                    if not chunk:break
                    self.wfile.write(chunk)
                    length-=len(chunk)
        except (BrokenPipeError,ConnectionResetError):pass

    def do_GET(self):
        path=urlparse(self.path).path
        if path in ('/','/index.html'):
            return self.serve_file(STATIC/'index.html','text/html; charset=utf-8')
        if path=='/api/project':
            return self.send_json({'project':get_project(),'frequencies':{'lart':UPPER_DEFAULT,'poshte':LOWER_DEFAULT}})
        if path.startswith('/static/'):
            name=unquote(path[len('/static/'):])
            target=(STATIC/name).resolve()
            if STATIC.resolve() not in target.parents:
                return self.send_json({'error':'Rrugë e pavlefshme'},403)
            return self.serve_file(target)
        if path.startswith('/media/'):
            mid=path.split('/')[-1]
            if not re.fullmatch(r'[a-f0-9]{32}(?:_preview)?\.[a-z0-9]{2,5}',mid):
                return self.send_json({'error':'Skedar i pavlefshëm'},404)
            return self.serve_file(MEDIA/mid)
        if path.startswith('/thumbnail/'):
            mid=path.split('/')[-1]
            if not re.fullmatch(r'[a-f0-9]{32}\.jpg',mid):
                return self.send_json({'error':'Skedar i pavlefshëm'},404)
            return self.serve_file(MEDIA/mid,'image/jpeg')
        return self.send_json({'error':'Nuk u gjet'},404)

    def do_POST(self):
        try:
            path=urlparse(self.path).path
            if path=='/api/upload':return self.upload()
            if path=='/api/save':return self.save()
            if path=='/api/analyze':return self.perform_analysis()
            if path=='/api/convert':return self.convert()
            return self.send_json({'error':'Nuk u gjet'},404)
        except (ValueError, TypeError, KeyError) as e:
            return self.send_json({'error':str(e)},400)
        except Exception as e:
            traceback.print_exc()
            return self.send_json({'error':f'Analiza dështoi: {str(e)[:450]}'},500)

    def upload(self):
        length=int(self.headers.get('Content-Length','0'))
        if not 0<length<=MAX_UPLOAD:
            return self.send_json({'error':'Skedari duhet të jetë nën 500 MB.'},413)
        filename=Path(unquote(self.headers.get('X-Filename','video.mp4')).replace('\\','/')).name
        ext=Path(filename).suffix.lower()
        if ext not in EXTENSIONS:raise ValueError('Format i papërkrahur. Përdor MP4, MOV, MKV, WEBM, MP3 ose WAV.')
        pid=uuid.uuid4().hex
        file=MEDIA/(pid+ext)
        remain=length
        try:
            with file.open('wb') as dst:
                while remain:
                    chunk=self.rfile.read(min(remain,512*1024))
                    if not chunk:raise ValueError('Ngarkim i ndërprerë.')
                    dst.write(chunk)
                    remain-=len(chunk)
            info=media_info(str(file))
            if info['has_video']:
                thumbnail(file,MEDIA/(pid+'.jpg'))
            elif info['duration']<=0:
                raise ValueError('Audioja/videoja nuk mund të lexohet.')
            meta={'id':pid,'filename':filename,'stored':file.name,'url':'/media/'+file.name,
                  'thumb':'/thumbnail/'+pid+'.jpg' if info['has_video'] else None,
                  **info}
            project={'schema':'ciftelia-studio-v1','media':meta,'events':[],
                     'waveform':[],'settings':{'axis':'vertical','invert':False,'detect_ghosts':True,
                     'max_seconds':180,'frequencies':{'lart':UPPER_DEFAULT,'poshte':LOWER_DEFAULT}},
                     'updated_at':datetime.now().isoformat()}
            save_project(project)
            return self.send_json({'project':project})
        except Exception:
            file.unlink(missing_ok=True)
            raise

    def save(self):
        payload=self.body_json()
        project=get_project()
        if not project:raise ValueError('Ngarko një audio ose video fillimisht.')
        raw=payload.get('events',[])
        if not isinstance(raw,list) or len(raw)>12000:raise ValueError('Lista e notave është e pavlefshme.')
        project['events']=[safe_event(e) for e in raw]
        project['events'].sort(key=lambda e:(e['time'],e['string']))
        if isinstance(payload.get('settings'),dict):
            valid={k:v for k,v in payload['settings'].items() if k in ('roi','axis','invert','detect_ghosts','max_seconds','frequencies')}
            project['settings'].update(valid)
        project['updated_at']=datetime.now().isoformat()
        save_project(project)
        return self.send_json({'saved':True,'count':len(project['events'])})

    def perform_analysis(self):
        payload=self.body_json()
        project=get_project()
        if not project:raise ValueError('Ngarko video ose audio para analizës.')
        settings={**project.get('settings',{}), **payload.get('settings',{})}
        media_file=MEDIA/project['media']['stored']
        if not media_file.exists():raise ValueError('Videoja e projektit nuk ekziston.')
        result=analyze(str(media_file),settings)
        project.update({'events':result['events'],'waveform':result['waveform'],
                        'settings':settings,'analysis':result['stats'],
                        'analyzed_seconds':result['analyzed_seconds'],
                        'updated_at':datetime.now().isoformat()})
        save_project(project)
        return self.send_json({'project':project,'stats':result['stats']})

    def convert(self):
        project=get_project()
        if not project:raise ValueError('Nuk ka video.')
        meta=project['media']
        if not meta.get('has_video'):raise ValueError('Kjo është vetëm audio.')
        src=MEDIA/meta['stored']
        output=MEDIA/(meta['id']+'_preview.mp4')
        if output.exists():output.unlink()
        try:
            run_ffmpeg(['-i',str(src),'-c:v','libx264','-preset','veryfast','-crf','24',
                        '-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart',
                        str(output)],timeout=720)
        except Exception:
            run_ffmpeg(['-i',str(src),'-c:v','mpeg4','-q:v','4','-c:a','aac',str(output)],timeout=720)
        # video analysis still uses original; preview uses converted file
        meta['preview_url']='/media/'+output.name
        project['updated_at']=datetime.now().isoformat()
        save_project(project)
        return self.send_json({'project':project})


def main():
    host='127.0.0.1'
    port=8765
    # Avoid binding to a remotely accessible network interface.
    for p in range(8765,8785):
        try:
            httpd=ThreadingHTTPServer((host,p),Handler)
            port=p
            break
        except OSError:continue
    else:raise RuntimeError('Portat lokale 8765–8784 janë të zëna.')
    url=f'http://{host}:{port}'
    print('\n'+'='*60+'\nÇIFTELIA STUDIO AI — LOKAL\n'+url+'\nShtyp Ctrl+C për ta mbyllur.\n'+'='*60+'\n')
    if os.environ.get('CIFTELIA_NO_BROWSER')!='1':
        import time
        threading.Thread(target=lambda:(time.sleep(.6),webbrowser.open(url)),daemon=True).start()
    try:httpd.serve_forever()
    except KeyboardInterrupt:pass
    finally:httpd.server_close()


if __name__=='__main__':main()
