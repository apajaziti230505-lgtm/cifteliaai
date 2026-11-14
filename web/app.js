'use strict';
const $=id=>document.getElementById(id);
const player=$('player');
let project=null, events=[], selectedId=null, zoom=60, roi=null, choosingROI=false, roiDrag=null;
let undoStack=[],redoStack=[],saveTimer=null,toastTimer=null,groupEnd=null,lastMediaId=null;
let fretRoi=null,fretMarks={},selectionMode=null,calibIndex=-1,analysisController=null;
let liveHandDetector=null,liveTrackRun=false,liveTrackToken=0,liveHands=[],liveMarks=null,liveFretRoi=null,liveRoi=null;
const strings={poshte:'poshtë',lart:'lart',ghost:'lëvizje e heshtur'};
const allowedStrokes=['down','up','unknown','ghost_up','ghost_down'];

function num(n,d=3){return Number(n).toFixed(d)}
function timeText(s){if(!Number.isFinite(s))s=0;const mm=Math.floor(s/60);const ss=Math.floor(s%60);const h=Math.floor((s%1)*100);return `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}.${String(h).padStart(2,'0')}`;}
function toast(s,error=false){let el=$('toast');el.textContent=s;el.classList.remove('hidden');el.classList.toggle('error',!!error);clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),4500);}
function busy(on,title='Duke analizuar…',detail='Analiza bëhet në kompjuter. Për video të gjata mund të zgjasë më shumë.'){$('busy').classList.toggle('hidden',!on);$('busyTitle').textContent=title;$('busyDetail').textContent=detail;}
// GitHub Pages nuk ekzekuton server Python. Kjo shtresë menaxhon MP3/MP4 dhe JSON vetëm në shfletues.
const STORAGE_KEY='cifteliaai-web-project-v1';
let browserMediaURL=null;
function readWebSaved(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');}catch{return null;}}
function webSave(){
  if(!project?.media)return;
  const media={...project.media}; delete media.url;delete media.preview_url;delete media.thumb;
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify({media,events,settings:settingsFromForm(),updated_at:new Date().toISOString()}));}
  catch(e){throw new Error('Hapësira e shfletuesit është plot. Eksporto JSON për të ruajtur notat.');}
}
async function probeMedia(file,url){
  const isVideo=/^video\//.test(file.type)||/\.(mp4|mov|webm|m4v|mkv)$/i.test(file.name);
  return new Promise((resolve,reject)=>{
    const el=document.createElement(isVideo?'video':'audio'); el.preload='metadata';
    let finished=false;
    const timeout=setTimeout(()=>end(null,new Error('Formati nuk u lexua nga shfletuesi. Përdor MP4 (H.264/AAC) ose MP3.')),18000);
    function end(info,err){if(finished)return;finished=true;clearTimeout(timeout);el.removeAttribute('src');el.load();err?reject(err):resolve(info);}
    el.onloadedmetadata=()=>end({has_video:isVideo,duration:Number.isFinite(el.duration)?el.duration:0,width:el.videoWidth||0,height:el.videoHeight||0},null);
    el.onerror=()=>end(null,new Error('Shfletuesi nuk e mbështet këtë format. Provo MP4/H.264 ose MP3.'));
    el.src=url;
  });
}
async function api(url,options={}){
  if(url==='/api/project')return {project:null};
  if(url==='/api/upload'){
    const file=options.body;if(!(file instanceof File))throw new Error('Zgjidh një MP3 ose MP4.');
    if(file.size>500*1024*1024)throw new Error('Skedari është mbi 500 MB.');
    const nextURL=URL.createObjectURL(file);let info;
    try{info=await probeMedia(file,nextURL);}catch(e){URL.revokeObjectURL(nextURL);throw e;}
    if(browserMediaURL)URL.revokeObjectURL(browserMediaURL);
    browserMediaURL=nextURL;
    const saved=readWebSaved();const matches=saved?.media?.filename===file.name && saved?.media?.file_size===file.size;
    const media={id:makeId(),filename:file.name,file_size:file.size,url:nextURL, ...info};
    return {project:{schema:'ciftelia-studio-v1',media,events:matches? saved.events||[]:[],waveform:[],settings:matches?saved.settings||{}:{},updated_at:new Date().toISOString()}};
  }
  if(url==='/api/save'){
    const body=JSON.parse(options.body||'{}');if(!project)throw new Error('Ngarko një skedar fillimisht.');
    project.events=body.events||[]; project.settings=body.settings||{};webSave();return {saved:true,count:events.length};
  }
  if(url==='/api/analyze')throw new Error('Analiza AI e audios/videos kërkon programin lokal Python. Në Web mund të luash, korrigjosh dhe importosh JSON.');
  if(url==='/api/convert')throw new Error('Konvertimi është vetëm në versionin lokal Python.');
  throw new Error('Funksion i pambështetur në Web: '+url);
}

function jsonPost(url,data){return api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
function markSaved(label='Gati'){$('saveState').textContent=label;}
function currentDuration(){return Math.max(20,Math.min(1200, Number(project?.media?.duration)||30));}
function currentMaxSec(){return Math.max(10,Math.min(1200,Number(project?.media?.duration)||30));}
function currentTime(){return Number.isFinite(player.currentTime)?player.currentTime:0;}
function noteById(id){return events.find(e=>e.id===id);}
function snapshot(){undoStack.push(JSON.stringify(events));if(undoStack.length>40)undoStack.shift();redoStack=[];}
function restore(next){events=JSON.parse(next);if(selectedId&&!noteById(selectedId))selectedId=null;refresh();scheduleSave();}
function undo(){if(!undoStack.length)return;redoStack.push(JSON.stringify(events));restore(undoStack.pop());}
function redo(){if(!redoStack.length)return;undoStack.push(JSON.stringify(events));restore(redoStack.pop());}
function scheduleSave(){if(!project)return;clearTimeout(saveTimer);markSaved('Ndryshime pa ruajtur…');saveTimer=setTimeout(saveNow,600);}
async function saveNow(){if(!project)return;clearTimeout(saveTimer);markSaved('Duke ruajtur…');try{await jsonPost('/api/save',{events,settings:settingsFromForm()});markSaved('✓ Ruajtur lokalisht');}catch(e){markSaved('Gabim ruajtjeje');toast(e.message,true);}}
function validBaseFrequencies(){const old=project?.settings?.frequencies||{poshte:[293,329,358,389,440,477,521,587,660,719,784,880,960,1050],lart:[220,247.03,268.8,292.01,330.38,358.16,391.13,440.75,495.56,539.93,588.53,660.75,720.82,788.4]};
 const upper=Number($('freqUpper').value)||220,lower=Number($('freqLower').value)||293;
 const previousLower=Number(old.poshte[0])||293,previousUpper=Number(old.lart[0])||220;
 return {poshte:old.poshte.map(x=>Math.round(x*lower/previousLower*100)/100),lart:old.lart.map(x=>Math.round(x*upper/previousUpper*100)/100)};
}
function settingsFromForm(){return {roi,fretRoi,fretMarks,useHandAI:$('useHandAI').checked,axis:$('axis').value,invert:$('invert').checked,detect_ghosts:$('ghosts').checked,max_seconds:Number($('maxSeconds').value),frequencies:validBaseFrequencies()};}
function loadSettings(settings){const s=settings||{};roi=s.roi||null;fretRoi=s.fretRoi||null;fretMarks=s.fretMarks||{};$('neckOnRight').checked=!!s.neckOnRight;$('useHandAI').checked=s.useHandAI!==false;$('useHandAI').checked=s.useHandAI!==false;$('axis').value=s.axis||'vertical';$('invert').checked=!!s.invert;$('ghosts').checked=s.detect_ghosts!==false;$('maxSeconds').value=String(s.max_seconds||120);$('freqUpper').value=Number(s.frequencies?.lart?.[0]||220);$('freqLower').value=Number(s.frequencies?.poshte?.[0]||293);setROIText();drawROI();}
function applyProject(p){
  project=p;events=Array.isArray(p?.events)?structuredClone(p.events):[];selectedId=null;undoStack=[];redoStack=[];
  const m=p?.media;
  if(m){
    $('mediaName').textContent=m.filename||'Regjistrim';$('mediaName').title=m.filename||'';
    const url=m.preview_url||m.url;
    if(lastMediaId!==m.id || player.getAttribute('src')!==url){player.src=url;player.load();}
    lastMediaId=m.id;$('videoPlaceholder').style.display='none';$('videoChip').textContent=(m.has_video?'VIDEO':'AUDIO')+' · '+timeText(Number(m.duration)||0);
    $('videoBox').style.aspectRatio=(m.width&&m.height)?m.width+'/'+m.height:'16/9';
    $('convertBtn').disabled=true;
  }else{
    player.removeAttribute('src');player.load();$('videoPlaceholder').style.display='flex';$('mediaName').textContent='Nuk ka skedar të ngarkuar';$('videoChip').textContent='PA MEDIA';$('convertBtn').disabled=true;
  }
  loadSettings(p?.settings);
  markSaved('Gati');refresh();
}
function groupNames(){let distinct=[...new Set(events.map(e=>Number(e.group)||1))].sort((a,b)=>a-b);return distinct;}
function refreshGroups(){const sel=$('groupSelect'),keep=sel.value;sel.replaceChildren();const all=document.createElement('option');all.value='all';all.textContent='E gjithë kënga';sel.append(all);
 for(const g of groupNames()){const o=document.createElement('option');o.value=String(g);o.textContent=`Grupi ${g}`;sel.append(o)}if([...sel.options].some(o=>o.value===keep))sel.value=keep;else sel.value='all';}
function arrow(e){return e.stroke==='down'||e.stroke==='ghost_down'?'↓':e.stroke==='up'||e.stroke==='ghost_up'?'↑':'?';}
function renderTimeline(){
 const width=Math.max(620,Math.ceil(currentDuration()*zoom+100));$('timeline').style.width=width+'px';
 for(const id of ['laneLower','laneUpper','laneGhost','ruler'])$(id).replaceChildren();
 const ruler=$('ruler');const seconds=currentDuration();const stride=seconds>450?5:seconds>90?2:1;
 for(let s=0;s<seconds;s+=stride){const t=document.createElement('div');t.className='tick';t.style.left=s*zoom+'px';t.textContent= timeText(s).slice(0,5);ruler.append(t)}
 for(const e of events){
    if(e.time>currentDuration())continue;
    const lane=e.string==='lart'?$('laneUpper'):e.string==='ghost'?$('laneGhost'):$('laneLower');
    const el=document.createElement('div');el.className=`event string-${e.string} ${e.review?'review':''} ${e.id===selectedId?'selected':''}`;
    el.style.left=(e.time*zoom)+'px';el.style.width=Math.min(180,Math.max(29,e.duration*zoom))+'px';el.dataset.id=e.id;el.title=`${timeText(e.time)} · ${strings[e.string]} · ${e.string==='ghost'?'pa notë':'perdja '+e.fret} · ${arrow(e)} · saktësia e vlerësuar ${Math.round(100*(e.confidence||0))}%`;
    const a=document.createElement('span');a.className='arrow';a.textContent=arrow(e);el.append(a);
    const b=document.createElement('span');b.textContent=e.string==='ghost'?'·':String(e.fret);el.append(b);
    el.addEventListener('pointerdown',ev=>startDrag(ev,e,el));
    el.addEventListener('click',ev=>{ev.stopPropagation();selectEvent(e.id)});
    lane.append(el);
 }
 for(const [lane,string] of [['laneLower','poshte'],['laneUpper','lart'],['laneGhost','ghost']]){
    $(lane).ondblclick=e=>{if(!project)return;const rect=$('timeline').getBoundingClientRect();const time=Math.max(0,Math.min(currentMaxSec(),(e.clientX-rect.left)/zoom));addEvent(string,time)};
 }
 ruler.onclick=ev=>{const r=$('timeline').getBoundingClientRect();if(player.src)player.currentTime=Math.max(0,(ev.clientX-r.left)/zoom);updatePlayback()};
 drawWave();updatePlayback();
}
function drawWave(){const canvas=$('waveCanvas');const wave=project?.waveform||[];const w=Math.min(12000,Math.ceil(currentDuration()*zoom+100));canvas.width=w;canvas.height=198;const ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,198);if(!wave.length)return;const analyzed=Number(project?.analyzed_seconds)||currentDuration();
 const step=analyzed/(wave.length||1),max=Math.max(0.05,...wave.slice(0,15000));ctx.fillStyle='rgba(74,174,195,.38)';
 for(let x=0;x<w;x+=2){const sec=x/Math.max(1,w)*currentDuration();const i=Math.min(wave.length-1,Math.round(sec/step));if(i<0||sec>analyzed)continue;const h=Math.min(28,28*wave[i]/max);ctx.fillRect(x,33-h/2,1,Math.max(1,h));}
}
function updatePlayback(){let t=currentTime();$('currentTime').textContent=timeText(t);$('durationTime').textContent=timeText(Number(player.duration)||Number(project?.media?.duration)||0);$('positionLabel').textContent=num(t)+' s';$('seek').max=Math.max(1,Number(player.duration)||Number(project?.media?.duration)||1);$('seek').value=Math.min(Number($('seek').max),t);$('playhead').style.left=(t*zoom)+'px';$('playBtn').textContent=player.paused?'▶':'Ⅱ';
 const active=events.filter(e=>e.time<=t+.04 && (e.time+Math.max(.15,e.duration))>=t-.05 && e.string!=='ghost').sort((a,b)=>b.time-a.time)[0];
 const live=$('liveNote');if(live)live.textContent=active?`Nota aktive: ${active.string==='lart'?'LART':'POSHTË'} · Perdja ${active.fret} · ${arrow(active)} ${active.stroke==='unknown'?'(drejtim i panjohur)':''}`:'Nota aktive: — · Goditja: ?';
 if(groupEnd!==null && t>=groupEnd-0.02){player.pause();groupEnd=null;}
 const sc=$('timelineScroll');if(!player.paused&&t*zoom>sc.scrollLeft+sc.clientWidth-100)sc.scrollLeft=Math.max(0,t*zoom-100);
}
function selectEvent(id,rerender=true){selectedId=id;const e=noteById(id);$('emptyEditor').style.display=e?'none':'block';$('noteForm').classList.toggle('hidden',!e);$('deleteBtn').disabled=!e;if(e){$('noteTime').value=num(e.time);$('noteDuration').value=num(e.duration);$('noteString').value=e.string;$('noteFret').value=e.fret===null?'0':String(e.fret);$('noteStroke').value=allowedStrokes.includes(e.stroke)?e.stroke:'unknown';$('noteGroup').value=e.group||1;$('noteInfo').textContent=`${e.source==='manual'?'Manuale':'Automatike'} · siguri e vlerësuar ${Math.round((e.confidence||0)*100)}% ${e.video_fret_hint!=null?'· video: afërsisht perdja '+e.video_fret_hint:''} ${e.ambiguous?'· audio: teli i paqartë':''} ${e.review?'· rishiko':' '}`;$('noteFret').disabled=e.string==='ghost';}if(rerender)renderTimeline();else {document.querySelectorAll('.event').forEach(el=>el.classList.toggle('selected',el.dataset.id===id));}}
function makeId(){return (typeof crypto.randomUUID==='function'?crypto.randomUUID().replaceAll('-',''):(Date.now().toString(16)+Math.random().toString(16).slice(2))).slice(0,12)}
function newEvent(string,time){return {id:makeId(),time:Math.max(0,Math.round(time*1000)/1000),duration:.22,string,fret:string==='ghost'?null:0,stroke:string==='ghost'?'ghost_up':'unknown',confidence:1,source:'manual',review:false,group:1};}
function addEvent(string='poshte',time=currentTime()){if(!project)return toast('Ngarko një video ose audio fillimisht.',true);snapshot();const e=newEvent(string,time);const groups=events.filter(x=>x.time<=time).sort((a,b)=>b.time-a.time);e.group=groups.length?groups[0].group:1;events.push(e);events.sort((a,b)=>a.time-b.time);selectedId=e.id;refresh();selectEvent(e.id);scheduleSave();toast('Nota u shtua. Vendos perden dhe goditjen në panelin poshtë.');}
function deleteSelected(){if(!selectedId)return;snapshot();events=events.filter(e=>e.id!==selectedId);selectedId=null;refresh();scheduleSave();}
function applyEdits(){const e=noteById(selectedId);if(!e)return;const time=Number($('noteTime').value),duration=Number($('noteDuration').value),group=Number($('noteGroup').value);if(!Number.isFinite(time)||time<0||time>36000||!Number.isFinite(duration)||duration<.03||duration>20||!Number.isInteger(group)||group<1){return toast('Koha, zgjatja ose grupi është i pavlefshëm.',true)}
 snapshot();e.time=Math.round(time*1000)/1000;e.duration=Math.round(duration*1000)/1000;e.string=$('noteString').value;e.fret=e.string==='ghost'?null:Math.max(0,Math.min(13,Number($('noteFret').value)));e.stroke=$('noteStroke').value;if(e.string==='ghost'&&!e.stroke.startsWith('ghost'))e.stroke='ghost_up';if(e.string!=='ghost'&&e.stroke.startsWith('ghost'))e.stroke='unknown';e.group=group;e.source='manual';e.review=false;e.confidence=1;events.sort((a,b)=>a.time-b.time);refreshGroups();selectEvent(e.id);scheduleSave();toast('Ndryshimet u regjistruan.');}
function startDrag(pointer,event,el){if(pointer.button!==0)return;pointer.stopPropagation();let sx=pointer.clientX,initial=event.time,moved=false,snapshotDone=false;el.setPointerCapture(pointer.pointerId);selectEvent(event.id,false);
 const move=e=>{const dx=e.clientX-sx;if(Math.abs(dx)>4){if(!snapshotDone){snapshot();snapshotDone=true}moved=true;event.time=Math.max(0,Math.min(currentMaxSec(),Math.round((initial+dx/zoom)*1000)/1000));el.style.left=event.time*zoom+'px';$('positionLabel').textContent=num(event.time)+' s';}};
 const end=()=>{el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',end);el.removeEventListener('pointercancel',end);if(moved){events.sort((a,b)=>a.time-b.time);refresh();scheduleSave();}};
 el.addEventListener('pointermove',move);el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
}
function refresh(){
 $('eventCount').textContent=events.length+' NGJARJE';
 $('lane-labels')?.removeAttribute('unused');refreshGroups();renderTimeline();
 const e=noteById(selectedId);$('deleteBtn').disabled=!e;$('emptyEditor').style.display=e?'none':'block';$('noteForm').classList.toggle('hidden',!e);
 if(e){$('noteTime').value=num(e.time);$('noteDuration').value=num(e.duration);$('noteString').value=e.string;$('noteFret').value=String(e.fret??0);$('noteFret').disabled=e.string==='ghost';$('noteStroke').value=e.stroke;$('noteGroup').value=e.group||1;}
}
function download(text,name,mime='application/json'){const blob=new Blob([text],{type:mime});const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1200);}
function exportJSON(){if(!project)return toast('Nuk ka projekt për eksport.',true);const data={schema:'ciftelia-studio-v1',title:project.media.filename,media_filename:project.media.filename,created_at:new Date().toISOString(),frequencies:settingsFromForm().frequencies,events:events.map(e=>({...e})),notes:events.filter(e=>e.string!=='ghost').map(e=>({time:e.time,duration:e.duration,string:e.string,fret:e.fret,stroke:e.stroke,group:e.group}))};download(JSON.stringify(data,null,2),`${(project.media.filename||'ciftelia').replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9_-]/g,'_')}_tablatura.json`);toast('JSON u eksportua. Videoja ruhet veçmas.');}
function parseImported(raw){const list=Array.isArray(raw)?raw:(raw.events||raw.notes||raw.tablature||raw.tablatura);if(!Array.isArray(list))throw new Error('JSON nuk ka listë events ose notes.');if(list.length>12000)throw new Error('Shumë nota (maksimumi 12000).');return list.map((e,i)=>{
 let s=(e.string||e.tel||e.teli||'poshte').toString().toLowerCase();if(['upper','up','top','lartë','lart'].includes(s))s='lart';else if(['ghost','silent','pause','heshtje'].includes(s))s='ghost';else s='poshte';
 const time=Number(e.time??e.start??e.t??e.seconds??e.sec??0);
 let fret=Number(e.fret??e.perdja??e.note??e.nota??0);if(Number(e.nota??e.note)===14 && e.fret==null && e.perdja==null)fret=0; if(!Number.isInteger(fret)||fret<0||fret>13)fret=0;
 const stroke=allowedStrokes.includes(e.stroke)?e.stroke:('unknown');
 return {id:makeId(),time:Number.isFinite(time)?Math.max(0,Math.round(time*1000)/1000):0,duration:Math.max(.03,Math.min(20,Number(e.duration??e.length??.22)||.22)),string:s,fret:s==='ghost'?null:fret,stroke,source:'import',confidence:1,review:false,group:Math.max(1,Number(e.group)||1)};
 }).sort((a,b)=>a.time-b.time)}
function newGroup(){if(!project)return;const time=currentTime(),g=Math.max(0,...events.map(e=>Number(e.group)||1))+1;snapshot();for(const e of events.filter(e=>e.time>=time))e.group=g;refreshGroups();$('groupSelect').value=String(g);scheduleSave();toast(`Grupi ${g} fillon në ${num(time)} s. Mund ta ndryshosh për çdo notë.`);}
function playGroup(){if(!player.src)return;const g=$('groupSelect').value;if(g==='all'){groupEnd=null;player.currentTime=0;player.play().catch(()=>{});return;}const notes=events.filter(e=>String(e.group)===g).sort((a,b)=>a.time-b.time);if(!notes.length)return;player.currentTime=Math.max(0,notes[0].time-.08);groupEnd=Math.max(...notes.map(e=>e.time+e.duration))+.05;player.play().catch(()=>{});}
function clickUpload(){if($('fileInput'))$('fileInput').click();}
async function uploadFile(file){if(!file)return;stopAutoHandTracking();if(file.size>500*1024*1024)return toast('Skedari është mbi 500 MB.',true);busy(true,'Duke importuar skedarin…','Skedari ruhet vetëm në kompjuterin tënd.');try{
  await saveNow();const result=await api('/api/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(file.name)},body:file});applyProject(result.project);toast('Videoja/audioja është gati për luajtje! Shto nota ose importo JSON.');
 }catch(e){toast(e.message,true)}finally{busy(false);$('fileInput').value='';}}
async function analyzeMedia(){
 if(!project?.media)return toast('Ngarko një video ose audio fillimisht.',true);
 if(analysisController)return toast('Një analizë është ende duke u kryer.',true);
 if(events.length&&!confirm('Analiza e re zëvendëson notat aktuale. Eksporto JSON për kopje rezervë nëse i ke korrigjuar. Vazhdo?'))return;
 if(!window.CifteliaAnalysis)return toast('Moduli i analizës nuk është ngarkuar. Rifresko faqen.',true);
 const previousTime=currentTime();const controller=new AbortController();analysisController=controller;
 $('analyzeBtn').disabled=true;$('cancelAnalyzeBtn').disabled=false;$('uploadBtn').disabled=true;
 $('analysisProgress').textContent='Analiza ka filluar. Mos e ndërro faqen: media luhet në 1×, në kohë reale.';
 try{
   const settings=settingsFromForm();
   const result=await window.CifteliaAnalysis.analyze({player,settings,frequencies:settings.frequencies,signal:controller.signal,
     onProgress:s=>{$('analysisProgress').textContent=s.status||`Duke analizuar ${num(s.seconds,1)} / ${num(s.total,1)} sekonda · ${s.detected} goditje audio · ${s.motions} lëvizje të dorës`;} });
   if(result.stats.onsets===0){$('analysisProgress').textContent='Nuk u zbuluan goditje të sigurta. Provo regjistrim më të pastër.';return toast('Nuk u zbuluan goditje. Mos u ruajt asnjë notë.',true)}
   snapshot();events=result.events;selectedId=null;project.events=events;project.waveform=result.waveform;project.analyzed_seconds=result.analyzed_seconds;project.analysis=result.stats;
   refresh();scheduleSave();
   $('analysisProgress').textContent=`Analiza përfundoi: ${result.stats.onsets} goditje, ${result.stats.events} ngjarje, ${result.stats.strokes} shigjeta ↓/↑, ${result.stats.ghosts} lëvizje të heshtura. Korrigjo notat me pika.`;
   toast('Analiza Web u përfundua. Shiko notat me pika për kontroll.');
 }catch(e){$('analysisProgress').textContent='Analiza nuk u përfundua: '+e.message;toast(e.message,true)}
 finally{
   player.pause();try{player.currentTime=previousTime}catch{}$('timelineScroll').scrollLeft=Math.max(0,previousTime*zoom-80);
   analysisController=null;$('analyzeBtn').disabled=false;$('cancelAnalyzeBtn').disabled=true;$('uploadBtn').disabled=false;updatePlayback();
 }
}
async function convertMedia(){if(!project)return;busy(true,'Duke konvertuar në MP4…','Kjo kryhet vetëm në kompjuter; videoja origjinale ruhet.');try{const r=await jsonPost('/api/convert',{});const t=currentTime();applyProject(r.project);player.addEventListener('loadedmetadata',()=>{player.currentTime=t;},{once:true});toast('U krijua pamja MP4 për shfletuesin.');}catch(e){toast(e.message,true)}finally{busy(false)}}
// Two hand boxes are detected automatically and redrawn as the instrument/player moves.
async function startAutoHandTracking(){
 if(!project?.media?.has_video)return toast('Ngarko MP4 që tregon duart.',true);
 if(analysisController)return toast('Ndalo analizën para gjurmimit të drejtpërdrejtë.',true);
 if(!window.CifteliaAnalysis)return toast('Moduli i analizës mungon.',true);
 const token=++liveTrackToken;
 $('autoTrackBtn').disabled=true;
 $('trackStatus').textContent='Po ngarkohet MediaPipe për njohjen e dy duarve…';
 try{liveHandDetector=await window.CifteliaAnalysis.loadHands();}
 catch(e){$('trackStatus').textContent='Nuk u ngarkua modeli i duarve. Kontrollo internetin. '+e.message;
  $('autoTrackBtn').disabled=false;return;}
 if(token!==liveTrackToken)return;
 liveTrackRun=true;$('stopTrackBtn').disabled=false;
 let lastTime=-1,lastImage=null,lastClock=0;
 let dynamicNeck=fretRoi, dynamicMarks=structuredClone(fretMarks),dynamicPick=roi;
 const grayCanvas=document.createElement('canvas');grayCanvas.width=160;grayCanvas.height=90;
 const loop=()=>{
   if(!liveTrackRun||token!==liveTrackToken)return;
   if(analysisController){setTimeout(loop,120);return;}
   const clock=performance.now();
   if(clock-lastClock<105){requestAnimationFrame(loop);return;}
   lastClock=clock;
   if(player.readyState>=2&&player.videoWidth){
     try{
       const frame=window.CifteliaAnalysis.grayImage(player,grayCanvas);
       if(frame&&lastImage&&dynamicNeck){
         const delta=window.CifteliaAnalysis.shiftRegion(lastImage,frame,dynamicNeck);
         if(delta){dynamicNeck=window.CifteliaAnalysis.translateRect(dynamicNeck,delta);
           dynamicMarks=window.CifteliaAnalysis.translateMarks(dynamicMarks,delta);}
       }
       const result=window.CifteliaAnalysis.detectHands(player,liveHandDetector,{...settingsFromForm(),fretRoi:dynamicNeck});
       liveHands=result.hands.map(h=>({rect:h.rect,role:h.role||'hand'}));
       if(result.fretting&&!dynamicNeck){const h=result.fretting.rect;
         dynamicNeck={x:Math.max(0,h.x-h.w*.55),y:Math.max(0,h.y-h.h*.35),
           w:Math.min(.5,h.w*2),h:Math.min(.5,h.h*1.7)};}
       if(result.picking)dynamicPick=result.picking.rect;
       liveFretRoi=dynamicNeck;liveRoi=dynamicPick;liveMarks=dynamicMarks;
       $('trackStatus').textContent=`U gjetën ${result.hands.length} duar. Katrorët lëvizin me duart; shenjat e perdeve ndiqen afërsisht me teksturën e qafës. ${result.hands.length<2?'Për dy katrorë duhen të duken të dy duart.':''}`;
       drawROI();lastImage=frame;
     }catch(e){$('trackStatus').textContent='Gabim gjatë gjurmimit: '+e.message;}
   }
   requestAnimationFrame(loop);
 };
 requestAnimationFrame(loop);
}
function stopAutoHandTracking(){
 liveTrackRun=false;liveTrackToken++;liveHands=[];liveFretRoi=null;liveRoi=null;liveMarks=null;
 $('autoTrackBtn').disabled=false;$('stopTrackBtn').disabled=true;
 $('trackStatus').textContent='Gjurmimi u ndal. Katrorët manualë ruhen në projekt.';drawROI();
}
function selectRoiMode(type='roi'){stopAutoHandTracking();
 if(!project?.media?.has_video)return toast('Duhet video MP4 për kalibrimin e dorës.',true);
 if(analysisController)return toast('Ndalo analizën para kalibrimit.',true);
 player.pause();selectionMode=type;calibIndex=-1;choosingROI=true;
 $('videoBox').classList.remove('calibrating');$('videoBox').classList.add('selecting');
 toast(type==='roi'?'Tërhiq drejtkëndësh të vogël vetëm mbi plektrumin/dorën e djathtë.':'Tërhiq një drejtkëndësh mbi gishtat dhe perdet e çiftelisë.');
}
function selectFretCalibration(){stopAutoHandTracking();
 if(!project?.media?.has_video)return toast('Duhet video për të shënuar 4, 7 dhe 8.',true);
 if(analysisController)return toast('Ndalo analizën para kalibrimit.',true);
 player.pause();selectionMode='marks';calibIndex=0;choosingROI=false;fretMarks={};
 $('videoBox').classList.remove('selecting');$('videoBox').classList.add('calibrating');setROIText();drawROI();
 toast('Kliko shenjën fizike të perdes 4, pastaj 7, pastaj 8, në këtë rend.');
}
function setROIText(){
 const fmt=r=>r?`x=${Math.round(r.x*100)}%, y=${Math.round(r.y*100)}%, gjerësi=${Math.round(r.w*100)}%`:'nuk është zgjedhur';
 $('roiStatus').textContent='Plektrumi: '+fmt(roi)+' · Gishtat: '+fmt(fretRoi);
 const have=Object.keys(fretMarks);
 $('fretStatus').textContent=calibIndex>=0?`Kliko perden ${[4,7,8][calibIndex]} mbi video.`:`Shenja kalibruese: ${have.length?have.join(', '):'asnjë'}. Pikat janë orientim, jo njohje e sigurt e gishtit.`;
}
function drawROI(){
 const canvas=$('roiCanvas');if(!canvas)return;
 const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
 const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);
 const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,rect.width,rect.height);
 function drawRect(r,color,text){if(!r)return;const x=r.x*rect.width,y=r.y*rect.height,w=r.w*rect.width,h=r.h*rect.height;ctx.strokeStyle=color;ctx.lineWidth=2;ctx.fillStyle=color+'22';ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);ctx.font='bold 12px sans-serif';ctx.fillStyle=color;ctx.fillText(text,x+5,Math.max(14,y-6));}
 drawRect(liveRoi||roi,'#4ff1d1','PLEKTRUM');drawRect(liveFretRoi||fretRoi,'#f1b77d','GISHTAT');if(roiDrag)drawRect(roiDrag,'#fcf3b0','ZONA E RE');
 for(const [f,p] of Object.entries(liveMarks||fretMarks)){const x=p.x*rect.width,y=p.y*rect.height;
   ctx.fillStyle='#ffe28d';ctx.strokeStyle='#152336';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.fill();ctx.stroke();
   ctx.font='bold 11px sans-serif';ctx.fillStyle='#102332';ctx.textAlign='center';ctx.fillText(f,x,y+4);ctx.textAlign='start';}
 // Distinct LIVE boxes follow the fingers and picking hand in every analysed frame.
 for(const h of liveHands){
   const label=h.role==='fret'?'GISHTAT / PERDET':h.role==='pick'?'DORA / PLEKTRUM':'DORA';
   drawRect(h.rect,h.role==='fret'?'#ffc477':'#5bf8d3',label);
 }
 if(window.CifteliaAnalysis?.projectFretMarkers){
   const frets=window.CifteliaAnalysis.projectFretMarkers(liveMarks||fretMarks);
   for(const p of frets){
     const x=p.x*rect.width,y=p.y*rect.height;
     ctx.beginPath();ctx.arc(x,y,p.measured?6:3,0,Math.PI*2);
     ctx.fillStyle=p.measured?'#ffcf6d':'#fbdb987d';ctx.fill();
     ctx.font='bold 9px sans-serif';ctx.fillStyle='#fff3c6';ctx.fillText(String(p.f),x+4,y-4);
   }
 }
}
function pointerNorm(ev){const rect=$('roiCanvas').getBoundingClientRect();return {x:Math.max(0,Math.min(1,(ev.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(ev.clientY-rect.top)/rect.height))};}
function initROI(){const canvas=$('roiCanvas');let start=null;
 canvas.addEventListener('pointerdown',e=>{
   if(selectionMode==='marks')return;
   if(!choosingROI)return;start=pointerNorm(e);canvas.setPointerCapture(e.pointerId);
 });
 canvas.addEventListener('pointermove',e=>{if(!start||!choosingROI)return;const p=pointerNorm(e);
   roiDrag={x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),w:Math.abs(start.x-p.x),h:Math.abs(start.y-p.y)};drawROI();
 });
 canvas.addEventListener('pointerup',e=>{
   if(selectionMode==='marks'){
     const mark=[4,7,8][calibIndex];if(mark===undefined)return;
     fretMarks[String(mark)]=pointerNorm(e);calibIndex++;
     if(calibIndex>=3){calibIndex=-1;selectionMode=null;$('videoBox').classList.remove('calibrating');toast('U ruajtën shenjat 4, 7 dhe 8. Janë vetëm kalibrim orientues.');}
     setROIText();drawROI();scheduleSave();return;
   }
   if(!start)return;
   if(roiDrag&&roiDrag.w>.03&&roiDrag.h>.03){
     if(selectionMode==='fretRoi')fretRoi=roiDrag;else roi=roiDrag;
     scheduleSave();toast('Zona u caktua. Mund ta analizosh videon.');
   }else toast('Shëno një zonë më të madhe.',true);
   roiDrag=null;start=null;choosingROI=false;selectionMode=null;$('videoBox').classList.remove('selecting');setROIText();drawROI();
 });
}
function register(){
 for(let i=0;i<=13;i++){const o=document.createElement('option');o.value=String(i);o.textContent=i===0?'0 (teli i hapur)':String(i);$('noteFret').append(o);}
 $('uploadBtn').onclick=clickUpload;$('fileInput').onchange=e=>uploadFile(e.target.files[0]);
 $('playBtn').onclick=()=>{if(!player.src)return;player.paused?player.play().catch(e=>toast('Luajtja dështoi: '+e.message,true)):player.pause();};
 player.addEventListener('error',()=>{if(player.src)toast('Ky format nuk luhet në shfletues. Provo MP4/H.264 ose MP3.',true)});
 player.addEventListener('timeupdate',updatePlayback);player.addEventListener('play',updatePlayback);player.addEventListener('pause',updatePlayback);
 player.addEventListener('loadedmetadata',()=>{if(player.videoWidth&&player.videoHeight){$('videoBox').style.aspectRatio=player.videoWidth+'/'+player.videoHeight;}updatePlayback();drawROI();});
 $('seek').oninput=e=>{if(player.src)player.currentTime=Number(e.target.value);updatePlayback()};
 document.querySelectorAll('.speed-btn').forEach(b=>b.onclick=()=>{const rate=Number(b.dataset.speed);player.playbackRate=rate;player.preservesPitch=true;document.querySelectorAll('.speed-btn').forEach(x=>x.classList.toggle('active',x===b));});
 $('autoTrackBtn').onclick=startAutoHandTracking;$('stopTrackBtn').onclick=stopAutoHandTracking;
 $('neckOnRight').onchange=scheduleSave;$('useHandAI').onchange=scheduleSave;
 $('roiBtn').onclick=()=>selectRoiMode('roi');$('fretRoiBtn').onclick=()=>selectRoiMode('fretRoi');
 $('fretMarkBtn').onclick=selectFretCalibration;$('clearFretMarksBtn').onclick=()=>{fretMarks={};calibIndex=-1;selectionMode=null;$('videoBox').classList.remove('calibrating');setROIText();drawROI();scheduleSave()};
 $('analyzeBtn').onclick=analyzeMedia;$('cancelAnalyzeBtn').onclick=()=>analysisController?.abort();initROI();new ResizeObserver(drawROI).observe($('videoBox'));
 $('addBtn').onclick=()=>addEvent('poshte');$('addGhostBtn').onclick=()=>addEvent('ghost');$('applyBtn').onclick=applyEdits;$('deleteBtn').onclick=deleteSelected;
 $('noteString').onchange=()=>{$('noteFret').disabled=$('noteString').value==='ghost';if($('noteString').value==='ghost')$('noteStroke').value='ghost_up';else if($('noteStroke').value.startsWith('ghost'))$('noteStroke').value='unknown';};
 $('undoBtn').onclick=undo;$('redoBtn').onclick=redo;
 $('jsonExportBtn').onclick=exportJSON;$('jsonImportBtn').onclick=()=>$('jsonInput').click();
 $('jsonInput').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;if(!project)return toast('Ngarko një video/audio para importit JSON.',true);try{const data=JSON.parse(await f.text());const imported=parseImported(data);if(events.length&&!confirm('Të zëvendësohen notat aktuale me '+imported.length+' nota nga JSON?'))return;snapshot();events=imported;selectedId=null;refresh();scheduleSave();toast('U importuan '+events.length+' ngjarje.');}catch(err){toast(err.message,true)}};
 $('saveBtn').onclick=saveNow;$('groupPlay').onclick=playGroup;$('newGroup').onclick=newGroup;
  function zoomAt(z){const sc=$('timelineScroll'),center=sc.scrollLeft+sc.clientWidth/2;const t=center/zoom;zoom=Math.max(15,Math.min(260,z));$('zoomValue').textContent=zoom+' px/s';$('zoomSlider').value=zoom;renderTimeline();sc.scrollLeft=Math.max(0,t*zoom-sc.clientWidth/2);}
 $('zoomIn').onclick=()=>zoomAt(zoom+15);
 $('zoomOut').onclick=()=>zoomAt(zoom-15);
 $('zoomSlider').oninput=e=>zoomAt(Number(e.target.value));
 $('panLeft').onclick=()=>$('timelineScroll').scrollBy({left:-Math.max(200,$('timelineScroll').clientWidth*.65),behavior:'smooth'});
 $('panRight').onclick=()=>$('timelineScroll').scrollBy({left:Math.max(200,$('timelineScroll').clientWidth*.65),behavior:'smooth'});
 let pan=null;const sc=$('timelineScroll');
 sc.addEventListener('pointerdown',e=>{if(!e.shiftKey||e.target.closest('.event'))return;pan={x:e.clientX,scroll:sc.scrollLeft};sc.setPointerCapture(e.pointerId);sc.classList.add('dragging-pan')});
 sc.addEventListener('pointermove',e=>{if(pan)sc.scrollLeft=pan.scroll+pan.x-e.clientX});
 const endPan=()=>{pan=null;sc.classList.remove('dragging-pan')};sc.addEventListener('pointerup',endPan);sc.addEventListener('pointercancel',endPan);

 document.addEventListener('keydown',e=>{const target=e.target;const isInput=target.matches('input,select,textarea')||target.isContentEditable;if(isInput)return;if(e.code==='Space'){e.preventDefault();if(player.src){player.paused?player.play():player.pause();}}if((e.key==='Delete'||e.key==='Backspace')&&selectedId){e.preventDefault();deleteSelected()}if(e.ctrlKey&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}});
}
register();
api('/api/project').then(r=>{if(r.project)applyProject(r.project);else {project=null;refresh();$('convertBtn').disabled=true;}}).catch(e=>toast(e.message,true));
