/* Çiftelia Studio AI – analyser running in the browser, without uploading media.
   Audio: real-time spectral attack and heuristic harmonic fret matching.
   Video: optical-flow estimate inside an explicitly chosen hand ROI.
   This is NOT a trained hand/plectrum recognition model; output needs review.
*/
(function(global){
'use strict';
const W=160,H=90;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const now=()=>performance.now();
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
const sampleRect=(r)=>({x:clamp(Math.floor((r?.x||0)*W),0,W-1),y:clamp(Math.floor((r?.y||0)*H),0,H-1),w:clamp(Math.floor((r?.w||1)*W),1,W),h:clamp(Math.floor((r?.h||1)*H),1,H)});
function grayImage(video, canvas){
  if(video.readyState<2||!video.videoWidth)return null;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  try{ctx.drawImage(video,0,0,W,H);const image=ctx.getImageData(0,0,W,H).data;const gray=new Uint8Array(W*H);
    for(let i=0,j=0;i<gray.length;i++,j+=4)gray[i]=(image[j]*3+image[j+1]*6+image[j+2])/10;
    return gray;
  }catch{return null;}
}
function flow(previous,current,roi,axis='vertical',invert=false){
  if(!previous||!current||!roi)return null;
  const rect=sampleRect(roi);const xMax=Math.min(W-5,rect.x+rect.w-3),yMax=Math.min(H-5,rect.y+rect.h-3);
  let vx=0,vy=0,weight=0,cx=0,cy=0,count=0, active=0, total=0;
  for(let y=Math.max(5,rect.y+4);y<yMax;y+=7){for(let x=Math.max(5,rect.x+4);x<xMax;x+=7){
    total++;
    const p=y*W+x;
    const texture=Math.abs(previous[p+1]-previous[p-1])+Math.abs(previous[p+W]-previous[p-W]);
    if(texture<22)continue;
    const localChange=Math.abs(current[p]-previous[p]);
    if(localChange<7)continue;
    let best=1e8,dxBest=0,dyBest=0;
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
      let cost=0;
      for(let yy=-2;yy<=2;yy+=2)for(let xx=-2;xx<=2;xx+=2){
        cost+=Math.abs(previous[(y+yy)*W+x+xx]-current[(y+dy+yy)*W+x+dx+xx]);
      }
      if(cost<best){best=cost;dxBest=dx;dyBest=dy;}
    }
    if(best>350||Math.hypot(dxBest,dyBest)<0.8)continue;
    const q=clamp(localChange,5,80);vx+=dxBest*q;vy+=dyBest*q;cx+=x*q;cy+=y*q;weight+=q;count++;
    active+=Math.hypot(dxBest,dyBest);
  }}
  if(count<2||!weight)return null;
  vx/=weight;vy/=weight;
  let speed=axis==='horizontal'?vx:vy;
  if(invert)speed=-speed;
  const strength=clamp(Math.abs(speed)/2.4,0,1)*clamp(count/7,0,1);
  if(Math.abs(speed)<.4||strength<.13)return null;
  return {direction:speed>0?'down':'up',strength,confidence:clamp(.15+strength*.5,0,.65),x:cx/weight/W,y:cy/weight/H,moved:active/count};
}
function fretHint(position,marks,roi){
  if(!position||!marks||!(marks['4']&&marks['7']&&marks['8'])||!roi)return null;
  // Interpolate ONLY across the user-calibrated 4/7/8 span; extrapolation is unreliable.
  const axis=Math.abs(marks['4'].x-marks['8'].x)>=Math.abs(marks['4'].y-marks['8'].y)?'x':'y';
  const v=position[axis],p4=marks['4'][axis],p7=marks['7'][axis],p8=marks['8'][axis];
  const between=(a,b)=>v>=Math.min(a,b)&&v<=Math.max(a,b);
  let fret;
  if(between(p4,p7)&&Math.abs(p7-p4)>.015)fret=4+(v-p4)/(p7-p4)*3;
  else if(between(p7,p8)&&Math.abs(p8-p7)>.008)fret=7+(v-p7)/(p8-p7);
  else return null;
  return Math.round(clamp(fret,4,8));
}
function dbAmplitude(db){return Number.isFinite(db)?Math.pow(10,clamp(db,-130,20)/20):0;}
function peakNear(spectrum,sr,f,tol){
  const width=sr/spectrum.length/2;
  const c=Math.round(f/width),d=Math.max(1,Math.round(tol/width));let p=0;
  for(let i=Math.max(1,c-d);i<=Math.min(spectrum.length-1,c+d);i++)p=Math.max(p,dbAmplitude(spectrum[i]));
  return p;
}
function classifyFrequencies(spectrum,sampleRate,freqs){
  if(!spectrum||!sampleRate)return [];
  const candidates=[];
  for(const string of ['poshte','lart'])for(let fret=0;fret<Math.min(14,freqs[string]?.length||0);fret++){
    const hz=Number(freqs[string][fret]);if(!Number.isFinite(hz)||hz<100)continue;
    const a1=peakNear(spectrum,sampleRate,hz,9);
    const a2=hz*2<sampleRate/2?peakNear(spectrum,sampleRate,hz*2,14):0;
    const a3=hz*3<sampleRate/2?peakNear(spectrum,sampleRate,hz*3,18):0;
    candidates.push({string,fret,hz,a1,score:a1+.2*a2+.09*a3});
  }
  if(!candidates.length)return [];
  const strongest=Math.max(...candidates.map(x=>x.score));
  if(strongest<.00004)return [];
  const selected=[];
  for(const string of ['poshte','lart']){
    const best=candidates.filter(x=>x.string===string).sort((a,b)=>b.score-a.score)[0];
    const second=candidates.filter(x=>x.string===string&&x.fret!==best.fret).sort((a,b)=>b.score-a.score)[0];
    if(!best||best.score<strongest*(string==='poshte'?.4:.50))continue;
    let confidence=.3+.42*clamp((best.score-(second?.score||0))/(best.score+1e-8),0,1)+.14*clamp(best.score/strongest,0,1);
    if(best.a1<.00004)confidence*=.5;
    selected.push({string,fret:best.fret,hz:best.hz,confidence:clamp(confidence,.10,.86)});
  }
  // The same pitch can exist on both strings. E.g. lower fret 4 (440 Hz)
  // and upper fret 7 (~441 Hz) cannot be distinguished from sound alone.
  // Prefer the melody string as an editable placeholder, with explicit ambiguity.
  const globalTop=candidates.slice().sort((a,b)=>b.score-a.score)[0];
  const collision=candidates.filter(c=>c.string!==globalTop.string && Math.abs(c.hz-globalTop.hz)<9 && c.score>globalTop.score*.70);
  if(collision.length){
    const lower=candidates.filter(c=>c.string==='poshte'&&Math.abs(c.hz-globalTop.hz)<9).sort((a,b)=>b.score-a.score)[0];
    const chosen=lower||globalTop;
    return [{string:chosen.string,fret:chosen.fret,hz:chosen.hz,confidence:.35,ambiguous:true,alternatives:[...collision,globalTop].map(c=>({string:c.string,fret:c.fret}))}];
  }
  return selected;
}
function inferStroke(t,motion){
  let best=null,quality=0;
  for(const item of motion){const dt=Math.abs(item.t-t);if(dt>.13)continue;
    const q=item.confidence*(1-dt/.20);
    if(q>quality){quality=q;best=item;}}
  return best&&quality>.17?{stroke:best.direction,confidence:Math.min(.7,quality)}:{stroke:'unknown',confidence:0};
}
let handLandmarker=null;
async function loadHands(){
  if(handLandmarker)return handLandmarker;
  // Optional, browser-side MediaPipe: model and Wasm fetched, frames never uploaded.
  const version='@0.10.22';
  const pkg=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision'+version+'/vision_bundle.mjs');
  const wasm=await pkg.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision'+version+'/wasm');
  handLandmarker=await pkg.HandLandmarker.createFromOptions(wasm,{
    baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',delegate:'CPU'},
    runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.45,minTrackingConfidence:.45
  });
  return handLandmarker;
}
function fingerLandmarksAtVideo(player,detector,roi){
  if(!detector||!roi||player.readyState<2)return null;
  const result=detector.detectForVideo(player,performance.now());
  const points=[];
  const center={x:roi.x+roi.w/2,y:roi.y+roi.h/2};
  const horizontal=roi.w>=roi.h;
  for(const hand of result.landmarks||[]){
    const tips=[hand[8],hand[12],hand[16],hand[20]];
    const inside=tips.filter(p=>p && p.x>=roi.x&&p.x<=roi.x+roi.w&&p.y>=roi.y&&p.y<=roi.y+roi.h);
    if(!inside.length)continue;
    // Finger close to the centerline of the selected neck zone is one candidate,
    // not proof of pressure on the string (occlusion & decoration can confuse it).
    inside.sort((a,b)=>Math.abs((horizontal?a.y:a.x)-(horizontal?center.y:center.x))-
                        Math.abs((horizontal?b.y:b.x)-(horizontal?center.y:center.x)));
    const best=inside[0],dist=Math.abs((horizontal?best.y:best.x)-(horizontal?center.y:center.x));
    points.push({x:best.x,y:best.y,confidence:clamp(.60-dist/(horizontal?roi.h:roi.w)*.22,.25,.65)});
  }
  return points.sort((a,b)=>b.confidence-a.confidence)[0]||null;
}

// Geometry helpers for HAND boxes and an optionally calibrated instrument neck.
function handsFromLandmarks(result,settings={}){
  const hands=(result?.landmarks||[]).map((landmarks,index)=>{
    const x=landmarks.map(p=>p.x),y=landmarks.map(p=>p.y);
    const x1=clamp(Math.min(...x)-.025,0,1), y1=clamp(Math.min(...y)-.025,0,1),
      x2=clamp(Math.max(...x)+.025,0,1),y2=clamp(Math.max(...y)+.025,0,1);
    const thumb=landmarks[4],indexFinger=landmarks[8];
    return {id:index,landmarks,rect:{x:x1,y:y1,w:x2-x1,h:y2-y1},
      center:{x:(x1+x2)/2,y:(y1+y2)/2},
      pick:{x:(thumb.x+indexFinger.x)/2,y:(thumb.y+indexFinger.y)/2},
      wrist:{x:landmarks[0].x,y:landmarks[0].y}};
  });
  if(!hands.length)return {hands:[],fretting:null,picking:null};
  const neck=settings.fretRoi;
  let fretting;
  if(neck){const center={x:neck.x+neck.w/2,y:neck.y+neck.h/2};
    fretting=hands.slice().sort((a,b)=>Math.hypot(a.center.x-center.x,a.center.y-center.y)-Math.hypot(b.center.x-center.x,b.center.y-center.y))[0];
  }else if(hands.length>=2){
    fretting=hands.slice().sort((a,b)=>settings.neckOnRight?b.center.x-a.center.x:a.center.x-b.center.x)[0];
  }else if(!neck) return {hands,fretting:null,picking:null};
  else fretting=hands[0];
  const picking=hands.filter(h=>h!==fretting).sort((a,b)=>
    Math.abs(b.center.x-fretting.center.x)-Math.abs(a.center.x-fretting.center.x))[0]||null;
  fretting.role='fret';if(picking)picking.role='pick';
  return {hands,fretting,picking};
}
function shiftRegion(grayBefore,grayNow,roi){
  // Coarse block-matching on neck texture. Tracks modest translations only.
  // Low texture / occlusion => reject change rather than drifting.
  if(!grayBefore||!grayNow||!roi)return null;
  const r=sampleRect(roi),features=[];
  for(let y=Math.max(3,r.y+3);y<Math.min(H-3,r.y+r.h-3);y+=3){
    for(let x=Math.max(3,r.x+3);x<Math.min(W-3,r.x+r.w-3);x+=3){
      const i=y*W+x;
      const contrast=Math.abs(grayBefore[i-1]-grayBefore[i+1])+Math.abs(grayBefore[i-W]-grayBefore[i+W]);
      if(contrast>=35)features.push({x,y,contrast});
    }
  }
  features.sort((a,b)=>b.contrast-a.contrast);
  const good=features.slice(0,35);if(good.length<6)return null;
  let lowest=Infinity,dxBest=0,dyBest=0,initial=Infinity;
  const radius=7;
  for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
    let error=0,used=0;
    for(const p of good){
      if(p.x+dx<2||p.y+dy<2||p.x+dx>=W-2||p.y+dy>=H-2)continue;
      const first=p.y*W+p.x,second=(p.y+dy)*W+p.x+dx;
      error+=Math.abs(grayBefore[first]-grayNow[second]);
      error+=Math.abs(grayBefore[first+1]-grayNow[second+1])*.6;
      error+=Math.abs(grayBefore[first+W]-grayNow[second+W])*.6;
      used++;
    }
    if(used<good.length*.7)continue;
    error/=used*2.2;
    if(dx===0&&dy===0)initial=error;
    if(error<lowest){lowest=error;dxBest=dx;dyBest=dy;}
  }
  if(!Number.isFinite(lowest)||lowest>48||Math.hypot(dxBest,dyBest)>10)return null;
  const confidence=clamp((55-lowest)/55,0,1);
  if(confidence<.16)return null;
  return {dx:dxBest/W,dy:dyBest/H,confidence};
}
function translateRect(rect,delta){if(!rect||!delta)return rect;
  return {...rect,x:clamp(rect.x+delta.dx,0,1-rect.w),y:clamp(rect.y+delta.dy,0,1-rect.h)};
}
function translateMarks(marks,delta){if(!delta)return marks;
  return Object.fromEntries(Object.entries(marks||{}).map(([k,p])=>[k,{x:clamp(p.x+delta.dx,0,1),y:clamp(p.y+delta.dy,0,1)}]));
}
function projectFretMarkers(marks){
  if(!(marks?.['4']&&marks?.['7']&&marks?.['8']))return [];
  // 3 landmarks with their actual physical, NON-EQUAL separation; avoid claiming certainty.
  const p4=marks['4'],p7=marks['7'],p8=marks['8'];
  const c=(p,q,n)=>({x:p.x+(q.x-p.x)*n,y:p.y+(q.y-p.y)*n});
  const d47={x:(p7.x-p4.x)/3,y:(p7.y-p4.y)/3};
  const d78={x:p8.x-p7.x,y:p8.y-p7.y};
  const o=[];
  for(let f=1;f<=13;f++){
    let point;
    if(f<4){let n=4-f;point={x:p4.x-d47.x*n*1.07,y:p4.y-d47.y*n*1.07};}
    else if(f<=7)point=c(p4,p7,(f-4)/3);
    else if(f<=8)point=c(p7,p8,f-7);
    else {const steps=f-8;let n=0;for(let i=0;i<steps;i++)n+=Math.pow(.945,i);
      point={x:p8.x+d78.x*n,y:p8.y+d78.y*n};}
    o.push({f,x:clamp(point.x,0,1),y:clamp(point.y,0,1),measured:f===4||f===7||f===8});
  }
  return o;
}
function bestFingerAtNeck(fretting,roi){
  if(!fretting||!roi)return null;
  const horizontal=roi.w>=roi.h,center={x:roi.x+roi.w/2,y:roi.y+roi.h/2};
  const tips=[8,12,16,20].map(k=>fretting.landmarks[k]).filter(p=>
    p.x>=roi.x-.04&&p.x<=roi.x+roi.w+.04&&p.y>=roi.y-.04&&p.y<=roi.y+roi.h+.04);
  tips.sort((a,b)=>Math.abs((horizontal?a.y:a.x)-(horizontal?center.y:center.x))-
                     Math.abs((horizontal?b.y:b.x)-(horizontal?center.y:center.x)));
  return tips[0]||null;
}
function resultEvents(onsets,motions,fingerMotions,handObservations,frequencies,settings,analysisEnd){
  const out=[];let group=1,previous=-100;
  for(let i=0;i<onsets.length;i++){
    const a=onsets[i],gap=i+1<onsets.length?onsets[i+1].t-a.t:.3;
    if(a.t-previous>.85)group++;
    previous=a.t;
    const stroke=inferStroke(a.t,motions);
    const hand=handObservations.filter(m=>Math.abs(m.t-a.t)<.19).sort((x,y)=>Math.abs(x.t-a.t)-Math.abs(y.t-a.t))[0];
    const vis=hand||fingerMotions.filter(m=>Math.abs(m.t-a.t)<.15).sort((x,y)=>Math.abs(x.t-a.t)-Math.abs(y.t-a.t))[0];
    const noteHint=hand && hand.fret!=null?hand.fret:(vis?fretHint(vis,settings.fretMarks,settings.fretRoi):null);
    const tones=a.tones&&a.tones.length?a.tones:[{string:'poshte',fret:0,confidence:0,ambiguous:true}];
    for(const candidateTone of tones){
      let tone=candidateTone;
      if(tone.ambiguous && noteHint!==null && Array.isArray(tone.alternatives)){
        const fitting=tone.alternatives.slice().sort((a,b)=>Math.abs(a.fret-noteHint)-Math.abs(b.fret-noteHint))[0];
        if(fitting && Math.abs(fitting.fret-noteHint)<=1)tone={...tone,...fitting,confidence:hand?.confidence>.4?.55:.43,ambiguous:true};
      }
      const mismatch=noteHint!==null && tone.fret>=4&&tone.fret<=8&&Math.abs(noteHint-tone.fret)>1;
      out.push({id:global.crypto?.randomUUID?.().slice(0,12)||Math.random().toString(16).slice(2,14),time:Math.round(a.t*1000)/1000,
        duration:Math.round(clamp(gap*.85,.08,1.5)*1000)/1000,string:tone.string,fret:tone.fret,
        stroke:stroke.stroke,confidence:Math.round(clamp(tone.confidence,0,1)*100)/100,
        motion_confidence:Math.round(stroke.confidence*100)/100,video_fret_hint:noteHint,video_fret_method:hand?'mediapipe':vis?'motion':null,ambiguous:!!tone.ambiguous,
        source:'web-heuristic',review:!!tone.ambiguous||tone.confidence<.60||stroke.stroke==='unknown'||stroke.confidence<.40||mismatch,group:Math.max(1,group-1)});
    }
  }
  if(settings.ghosts && settings.roi){
    let last=-5;
    for(const m of motions){if(m.confidence<.45||m.t-last<.25)continue;
      if(onsets.some(a=>Math.abs(a.t-m.t)<.17))continue;
      out.push({id:global.crypto?.randomUUID?.().slice(0,12)||Math.random().toString(16).slice(2,14),time:Math.round(m.t*1000)/1000,
        duration:.12,string:'ghost',fret:null,stroke:m.direction==='up'?'ghost_up':'ghost_down',
        confidence:Math.round(m.confidence*100)/100,source:'web-heuristic',review:true,group:Math.max(1,group-1)});last=m.t;
    }
  }
  return out.filter(e=>e.time<=analysisEnd).sort((a,b)=>a.time-b.time);
}
let ac=null,source=null,analyserRMS=null,analyserFreq=null,attached=null;
async function prepareAudio(player){
  if(!ac){ac=new (global.AudioContext||global.webkitAudioContext)();source=ac.createMediaElementSource(player);
    analyserRMS=ac.createAnalyser();analyserRMS.fftSize=2048;analyserRMS.smoothingTimeConstant=.2;
    analyserFreq=ac.createAnalyser();analyserFreq.fftSize=8192;analyserFreq.smoothingTimeConstant=.25;
    source.connect(analyserRMS);analyserRMS.connect(analyserFreq);analyserFreq.connect(ac.destination);attached=player;}
  if(attached!==player)throw new Error('Përdor të njëjtin player për analizën.');
  await ac.resume();
  return {ctx:ac,rms:analyserRMS,freq:analyserFreq};
}
async function analyze({player,settings,frequencies,onProgress,signal}){
  if(!player?.src||!Number.isFinite(player.duration)||player.duration<=0)throw new Error('Ngarko MP3 ose MP4 që luhet në shfletues.');
  if(!frequencies?.lart?.length||!frequencies?.poshte?.length)throw new Error('Frekuencat e akordimit mungojnë.');
  const {ctx,rms,freq}=await prepareAudio(player);
  const maxSeconds=clamp(Number(settings.max_seconds)||120,1,300),end=Math.min(player.duration,maxSeconds);
  const buffer=new Float32Array(rms.fftSize),bins=new Float32Array(freq.frequencyBinCount);
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const motion=[];const fingerMotion=[];const handObservations=[];const onsets=[];const wave=[];
  let handDetector=null,handStatus='Nuk u aktivizua';
  if(settings.useHandAI && player.videoWidth){
    onProgress?.({status:'Po ngarkoj modelin e gishtave MediaPipe; nëse nuk ka internet, vazhdohet pa të...'});
    try{handDetector=await loadHands();handStatus='MediaPipe u ngarkua';}
    catch(error){handStatus='MediaPipe nuk u ngarkua; po përdor sinjalin audio dhe lëvizjen e pikselëve';onProgress?.({status:handStatus});}
  }
  let lastRMS=0,baseline=.005,lastAttack=-1,lastFrame=-1,lastVideo=null,pending=null;
  let dynamicRoi=settings.roi||null, dynamicNeck=settings.fretRoi||null;
  let dynamicMarks=structuredClone(settings.fretMarks||{}),prevPick=null;
  let autoHandFrames=0,neckTracked=0;
  let stopped=false,stalled=0,lastProgress=-1,prevBand=null,lastVideoTime=-1,videoFrameLimit=0;
  function sample(t){
    rms.getFloatTimeDomainData(buffer);let energy=0;for(let i=0;i<buffer.length;i+=2)energy+=buffer[i]*buffer[i];
    const value=Math.sqrt(energy/(buffer.length/2));
    freq.getFloatFrequencyData(bins);
    let band=0,flux=0;const currentBand=new Float32Array(44);
    for(let k=0;k<44;k++){
      const bin=Math.round((160+k*39)/ctx.sampleRate*bins.length*2);
      const a=dbAmplitude(bins[Math.min(bins.length-1,Math.max(0,bin))]);
      currentBand[k]=a;band+=a;
      if(prevBand)flux+=Math.max(0,a-prevBand[k]);
    }
    const spectral=flux/(band+1e-8);prevBand=currentBand;
    baseline=.996*baseline+.004*value;
    const rise=(value-lastRMS)/(Math.max(lastRMS,.004));
    const threshold=Math.max(.004,baseline*.9);
    const isAttack=(value>threshold&&((rise>.22&&spectral>.06)||spectral>.29||(rise>.47&&value>baseline*1.15)));
    if(isAttack&&t-lastAttack>.105){
      const onsetTime=Math.max(0,t-.035);
      const a={t:Math.round(onsetTime*1000)/1000,tones:null};onsets.push(a);pending=a;lastAttack=t;
    }
    if(pending && t-pending.t>=.085){pending.tones=classifyFrequencies(bins,ctx.sampleRate,frequencies);pending=null;}
    lastRMS=value;
    if(wave.length<3000 && (!wave.length||t>=wave.length*end/Math.min(3000,Math.ceil(end*20))))wave.push(Math.round(value*1000)/1000);
  }
  // The media is analysed in normal, realtime playback; no upload or server processing.
  const wasPaused=player.paused,oldRate=player.playbackRate,oldPitch=player.preservesPitch;
  player.pause();player.playbackRate=1;player.preservesPitch=true;player.currentTime=0;
  await new Promise((resolve,reject)=>{
    const cleanup=()=>{player.removeEventListener('ended',endHandler);player.removeEventListener('error',errorHandler);};
    const endHandler=()=>{stopped=true;cleanup();resolve();};
    const errorHandler=()=>{stopped=true;cleanup();reject(new Error('Gabim gjatë luajtjes së medias.'));};
    player.addEventListener('ended',endHandler);player.addEventListener('error',errorHandler);
    function loop(){
      if(stopped)return;
      if(signal?.aborted){stopped=true;cleanup();reject(new Error('Analiza u ndërpre.'));return;}
      const t=player.currentTime;
      if(t>=end-.03){stopped=true;cleanup();resolve();return;}
      if(t>lastFrame+.021){sample(t);lastFrame=t;}
      if(player.videoWidth&&t-lastVideoTime>.035){
        const frame=grayImage(player,canvas);
        if(frame&&lastVideo&&dynamicNeck){
          const drift=shiftRegion(lastVideo,frame,dynamicNeck);
          if(drift){dynamicNeck=translateRect(dynamicNeck,drift);dynamicMarks=translateMarks(dynamicMarks,drift);neckTracked++;}
        }
        if(frame&&lastVideo&&dynamicRoi){
          const drift=shiftRegion(lastVideo,frame,dynamicRoi);
          if(drift)dynamicRoi=translateRect(dynamicRoi,drift);
        }
        // Fallback for no hand landmark detection: optical flow inside each MOVING region.
        if(frame&&lastVideo&&!handDetector){
          const f=flow(lastVideo,frame,dynamicRoi,settings.axis,settings.invert);
          if(f)motion.push({...f,t});
          const hand=flow(lastVideo,frame,dynamicNeck,settings.axis,false);
          if(hand)fingerMotion.push({...hand,t});
        }
        if(frame)lastVideo=frame;
        lastVideoTime=t;
      }
      if(handDetector&&player.videoWidth&&t-videoFrameLimit>.085){
        videoFrameLimit=t;
        try{
          const raw=handDetector.detectForVideo(player,performance.now());
          const hands=handsFromLandmarks(raw,{...settings,fretRoi:dynamicNeck});
          autoHandFrames+=hands.hands.length>0?1:0;
          if(hands.fretting){
            if(!dynamicNeck){
              // Visual aid only: neck location inferred from fretting hand, not a detected fret board.
              const h=hands.fretting.rect;
              dynamicNeck={x:clamp(h.x-h.w*.6,0,1),y:clamp(h.y-h.h*.45,0,1),
                w:clamp(h.w*2.1,.12,.52),h:clamp(h.h*1.85,.1,.52)};
            }
            const tip=bestFingerAtNeck(hands.fretting,dynamicNeck);
            if(tip)handObservations.push({x:tip.x,y:tip.y,confidence:.58,t,fret:fretHint(tip,dynamicMarks,dynamicNeck)});
          }
          if(hands.picking){
            dynamicRoi=hands.picking.rect;
            const point=hands.picking.pick;
            const origin=dynamicNeck?{x:dynamicNeck.x,y:dynamicNeck.y}:{x:0,y:0};
            const relative={x:point.x-origin.x,y:point.y-origin.y};
            if(prevPick&&t-prevPick.t>.015&&t-prevPick.t<.26){
              const component=settings.axis==='horizontal'?relative.x-prevPick.x:relative.y-prevPick.y;
              const signed=settings.invert?-component:component;
              if(Math.abs(signed)>.006){
                const strength=clamp(Math.abs(signed)/.035,0,1);
                motion.push({direction:signed>0?'down':'up',strength,confidence:clamp(.25+strength*.51,.25,.76),t,
                  x:point.x,y:point.y});
              }
            }
            prevPick={...relative,t};
          }else prevPick=null;
          onProgress?.({frame:{hands:hands.hands.map(h=>({rect:h.rect,role:h.role||'hand'})),
            roi:dynamicRoi,fretRoi:dynamicNeck,fretMarks:dynamicMarks,frets:projectFretMarkers(dynamicMarks)}});
        }catch(error){handDetector=null;handStatus='Ndjekja e duarve u ndërpre; audio vazhdon.';}
      }
      const second=Math.floor(t);
      if(second!==lastProgress){lastProgress=second;onProgress?.({seconds:t,total:end,detected:onsets.length,motions:motion.length});}
      requestAnimationFrame(loop);
    }
    player.play().then(()=>requestAnimationFrame(loop)).catch(err=>{cleanup();reject(new Error('Shfletuesi nuk lejoi luajtjen: '+err.message));});
  }).finally(()=>{player.pause();player.playbackRate=oldRate;player.preservesPitch=oldPitch;});
  if(pending)pending.tones=classifyFrequencies(bins,ctx.sampleRate,frequencies);
  const result=resultEvents(onsets,motion,fingerMotion,handObservations,frequencies,
    {...settings,fretRoi:dynamicNeck,fretMarks:dynamicMarks},end);
  return {events:result,waveform:wave,analyzed_seconds:end,stats:{onsets:onsets.length,events:result.length,strokes:result.filter(e=>e.stroke==='up'||e.stroke==='down').length,ghosts:result.filter(e=>e.string==='ghost').length,visual:result.filter(e=>e.video_fret_hint!==null).length,handFrames:autoHandFrames,neckTracked,mediapipe:!!handDetector,handStatus}};
}
global.CifteliaAnalysis={analyze,flow,fretHint,classifyFrequencies,resultEvents,loadHands,handsFromLandmarks,
  shiftRegion,translateRect,translateMarks,projectFretMarkers,grayImage,
  detectHands:(player,detector,settings)=>handsFromLandmarks(detector.detectForVideo(player,performance.now()),settings)};
})(window);
