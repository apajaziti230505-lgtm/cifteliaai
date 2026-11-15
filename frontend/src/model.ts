export type StringName='upper'|'lower';
export type Tone={string:StringName;fret:number;frequency:number;measured:boolean;harmonics?:number[];decay_seconds?:number;recording_count?:number;strengths?:string[]};
export type Profile={id:string;name:string;version:number;tones:Tone[];recordings:Record<string,unknown>[]};
export type Note={id:string;event_id:string;time:number;sample_index:number;event_time?:number;event_sample_index?:number;string:StringName;fret:number;frequency:number|null;confidence:number;confidence_status:string;duration:number;end_sample:number;end_time:number;group:number;manual:boolean;source:string;review:boolean;original_sample_index?:number;evidence?:Record<string,unknown>;[key:string]:unknown};
export type Group={id:number;start:number;start_sample:number;manual:boolean};
export type Tombstone={string:StringName;sample_index:number;original_sample_index?:number};
export type Project={schema:string;id:string;song:string;notes:Note[];groups:Group[];tombstones:Tombstone[];audio:{sample_rate:number;num_samples:number;duration:number;filename?:string;sha256?:string;[key:string]:unknown};analysis?:{version:string;engine:string;confidence_calibrated:boolean;onset_candidates:number;recognized_events?:number;unresolved:Record<string,unknown>[];processing_seconds?:number;[key:string]:unknown};profile:Profile;waveform:number[];spectrogram?:{db:number[][];max_hz:number};[key:string]:unknown};
export const SR=22050;
export const LOWER:Record<number,number>={14:293,1:329,2:358,3:389,4:440,5:477,6:521,7:587,8:660,9:719,10:784,11:880,12:960,13:1050};
export const defaultProfile=():Profile=>({version:1,id:'reference-220-293',name:'Çiftelia 220 / 293',recordings:[],tones:[{string:'upper',fret:14,frequency:220,measured:false},...Object.entries(LOWER).map(([f,frequency])=>({string:'lower' as const,fret:+f,frequency,measured:false}))]});
export const id=()=>crypto.randomUUID();
export const sampleAt=(seconds:number,sr=SR)=>Math.max(0,Math.round(seconds*sr));
export const secondsAt=(clientX:number,contentLeft:number,zoom:number,duration:number)=>Math.max(0,Math.min(duration,(clientX-contentLeft)/zoom));
export function emptyProject(song='Këngë e re',duration=20,profile=defaultProfile()):Project{return {schema:'ciftelia-transcription-v3',id:id(),song,notes:[],groups:[{id:1,start:0,start_sample:0,manual:false}],tombstones:[],audio:{sample_rate:SR,num_samples:sampleAt(duration),duration},profile,waveform:[]};}
export function retime(n:Note,sample:number,sr:number):Note{const length=Math.max(1,n.end_sample-n.sample_index);return {...n,original_sample_index:n.original_sample_index??n.sample_index,sample_index:sample,time:sample/sr,end_sample:sample+length,end_time:(sample+length)/sr,duration:length/sr,manual:true,source:'manual',review:false,confidence:1,confidence_status:'manual'};}
export function newNote(string:StringName,fret:number,time:number,sr:number,profile:Profile,group=1):Note{const sample=sampleAt(time,sr),end=sample+sampleAt(.2,sr);return {id:id(),event_id:'manual-'+sample,sample_index:sample,time:sample/sr,end_sample:end,end_time:end/sr,duration:(end-sample)/sr,string,fret,frequency:profile.tones.find(t=>t.string===string&&t.fret===fret)?.frequency??null,confidence:1,confidence_status:'manual',manual:true,source:'manual',review:false,group};}

export function parseImport(raw:any):Project{
 const root=Array.isArray(raw)?{}:raw;if(!root||typeof root!=='object')throw Error('JSON i pavlefshëm.');
 const list=Array.isArray(raw)?raw:root.events??root.notes??root.tablature??root.tablatura;
 if(!Array.isArray(list)||list.length>100000)throw Error('JSON duhet të ketë notes/events (deri 100 000).');
 const p=emptyProject(root.song||root.name||root.title||'Këngë e importuar');
 if(root.id)p.catalog_id=String(root.catalog_id||root.id);if(root.originalAudioId)p.originalAudioId=root.originalAudioId;
 const sr=Number(root.audio?.sample_rate)||SR;if(sr<8000||sr>192000)throw Error('Sample rate i pavlefshëm.');
 p.audio={...p.audio,...root.audio,sample_rate:sr};p.profile=validProfile(root.profile??p.profile);
 const markers=[...new Set<number>([...list.filter(e=>e.groupStart!=null).map(e=>Number(e.groupStart)),...(Array.isArray(root.stanzas)?root.stanzas.map((g:any)=>Number(g.startMs??g.start??0)):[])])].sort((a,b)=>a-b);
 const notes:Note[]=[];
 list.forEach((e:any,i:number)=>{
  if(e.string==='ghost')return;const legacy=e.noteNumber!=null;
  let time=Number(e.time??e.start??e.t??0)/(legacy?1000:1);
  const sample=(!legacy&&Number.isInteger(e.sample_index))?e.sample_index:sampleAt(time,sr);time=sample/sr;
  if(!Number.isFinite(time)||time<0)throw Error('Koha e notës '+(i+1)+' është e pavlefshme.');
  let string:StringName=['upper','lart','top',2,'2',0,'0'].includes(e.string)?'upper':'lower';
  let fret=Number(e.noteNumber??e.fret??14);if(legacy&&fret===15){fret=14;string='lower';}else if(legacy&&fret===14){string='upper';}if(fret===0)fret=14;if(!Number.isInteger(fret)||fret<1||fret>14)throw Error('Perdja duhet 1–14.');
  const duration=Number(e.duration??.2);if(!Number.isFinite(duration)||duration<0)throw Error('Zgjatje e pavlefshme.');
  const end=Math.max(sample+1,Number.isInteger(e.end_sample)&&!legacy?e.end_sample:sample+sampleAt(duration,sr));
  const group=Math.max(1,Number(e.group)||markers.filter(m=>m<=Number(e.groupStart??time*1000)).length||1);
  const n:Note={...e,id:e.id||id(),event_id:e.event_id||'import-'+sample,sample_index:sample,time,end_sample:end,end_time:end/sr,duration:(end-sample)/sr,string,fret,
   frequency:e.frequency??e.freq??(string==='lower'?LOWER[fret]:fret===14?220:null),confidence:Number(e.confidence)||0,confidence_status:e.confidence_status||'imported_unverified',manual:true,source:'import',review:!!e.review,group};
  notes.push(n);if(legacy&&e.withF&&string==='lower'){const f=Number(e.upperNoteNumber)||14;notes.push({...n,id:n.id+'-upper',string:'upper',fret:f,frequency:f===14?220:null});}
 });
 notes.sort((a,b)=>a.sample_index-b.sample_index);p.notes=notes;p.tombstones=Array.isArray(root.tombstones)?root.tombstones:[];
 p.audio.duration=Math.max(Number(root.audio?.duration)||0,...notes.map(n=>n.end_time),1);p.audio.num_samples=sampleAt(p.audio.duration,sr);
 p.groups=Array.isArray(root.groups)?root.groups:Array.isArray(root.stanzas)&&root.stanzas.length?root.stanzas.map((g:any,i:number)=>{const at=sampleAt(Number(g.startMs??g.start??0)/1000,sr);return {id:i+1,start:at/sr,start_sample:at,manual:true};}):[...new Set(notes.map(n=>n.group))].map(g=>{const at=Math.min(...notes.filter(n=>n.group===g).map(n=>n.sample_index));return {id:g,start:at/sr,start_sample:at,manual:true};});
 if(!p.groups.length)p.groups=[{id:1,start:0,start_sample:0,manual:false}];
 p.analysis=root.analysis;p.waveform=root.waveform||[];p.spectrogram=root.spectrogram;
 return p;
}
export function validProfile(p:any):Profile{
 if(!p||!Array.isArray(p.tones)||!p.tones.length||p.tones.length>28)throw Error('Profil kalibrimi i pavlefshëm.');
 const seen=new Set<string>();for(const t of p.tones){const k=t.string+':'+t.fret;if(!['upper','lower'].includes(t.string)||!Number.isInteger(t.fret)||t.fret<1||t.fret>14||!Number.isFinite(t.frequency)||t.frequency<100||t.frequency>2500||seen.has(k))throw Error('Referencë kalibrimi e pavlefshme.');seen.add(k);
 if(t.harmonics&&(!Array.isArray(t.harmonics)||t.harmonics.length<3||t.harmonics.length>12||t.harmonics.some((x:number)=>!Number.isFinite(x)||x<0||x>20)))throw Error('Harmonika të pavlefshme.');}
 return {...p,recordings:p.recordings||[]};
}
export function mergeAnalysis(previous:Project,next:Project):Project{
 const sr=next.audio.sample_rate;const oldSr=previous.audio.sample_rate;
 const scale=(sample:number)=>Math.round(sample/oldSr*sr);
 const manual=previous.notes.filter(n=>n.manual||n.source==='import').map(n=>({...n,sample_index:scale(n.sample_index),original_sample_index:scale(n.original_sample_index??n.sample_index),end_sample:scale(n.end_sample)}));
 const tombstones=previous.tombstones.map(n=>({...n,sample_index:scale(n.sample_index),original_sample_index:scale(n.original_sample_index??n.sample_index)}));
 const blocked=[...manual,...tombstones];
 const notes=next.notes.filter(n=>!blocked.some(m=>m.string===n.string&&Math.abs(n.sample_index-(m.original_sample_index??m.sample_index))<=sr*.045));
 const groups=previous.groups.some(g=>g.manual)?previous.groups.map(g=>({...g,start_sample:scale(g.start_sample)})):next.groups;
 const all=[...notes,...manual].sort((a,b)=>a.sample_index-b.sample_index).map(n=>({...n,time:n.sample_index/sr,end_time:n.end_sample/sr,duration:(n.end_sample-n.sample_index)/sr}));
 if(previous.groups.some(g=>g.manual))for(const n of all){if(!n.manual)n.group=[...groups].sort((a,b)=>b.start_sample-a.start_sample).find(g=>g.start_sample<=n.sample_index)?.id??1;}
 return {...next,id:previous.id,song:previous.song,tombstones,groups,notes:all};
}
export function toLegacy(p:Project){const markers=[...new Set([0,...p.groups.map(g=>Math.round(g.start*1000))])].sort((a,b)=>a-b);return {schema:'ciftelia-catalog-v1',id:p.catalog_id??p.id,name:p.song,time_unit:'milliseconds',preferNotes:true,originalAudioName:p.audio.filename,originalAudioId:p.originalAudioId,
 notes:p.notes.map(n=>({id:n.id,time:Math.round(n.time*1000),noteNumber:n.string==='lower'&&n.fret===14?15:n.fret,string:n.string==='upper'?2:1,withF:false,confidence:n.confidence,duration:n.duration,group:n.group,groupStart:Math.round((p.groups.find(g=>g.id===n.group)?.start??0)*1000),event_id:n.event_id,manual:n.manual})),
 stanzas:markers.map((start,i)=>({start,label:'Grupi '+(i+1),color:'#42bdae'}))};}
export function deleteNotes(p:Project,ids:string[]):Project{const removed=p.notes.filter(n=>ids.includes(n.id));return {...p,notes:p.notes.filter(n=>!ids.includes(n.id)),tombstones:[...p.tombstones,...removed.map(n=>({string:n.string,sample_index:n.sample_index,original_sample_index:n.original_sample_index}))]};}
