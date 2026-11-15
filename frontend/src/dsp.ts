/** Actual PCM analysis; synthetic audio is used only in tests. No note generator. */
import {defaultProfile,emptyProject,validProfile,type Profile,type Project,type Tone,SR} from './model';
const INITIAL=[1,.32,.19,.12,.09,.065,.05,.04];
const HOP=128, SIZE=1024, FFTSIZE=4096;
type Spectrum={re:Float64Array;im:Float64Array;mag:Float64Array};
function fft(re:Float64Array,im:Float64Array){const n=re.length;for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}for(let len=2;len<=n;len<<=1){const a=-2*Math.PI/len,wr=Math.cos(a),wi=Math.sin(a);for(let i=0;i<n;i+=len){let r=1,m=0;for(let j=0;j<len/2;j++){const u=i+j,v=u+len/2,tr=re[v]*r-im[v]*m,ti=re[v]*m+im[v]*r;re[v]=re[u]-tr;im[v]=im[u]-ti;re[u]+=tr;im[u]+=ti;const next=r*wr-m*wi;m=r*wi+m*wr;r=next;}}}}
function spec(y:Float32Array,start:number,length:number,nfft=FFTSIZE,absolute=true):Spectrum{
 const a=Math.max(0,Math.round(start)),b=Math.min(y.length,Math.round(start+length)),n=Math.max(0,b-a);const re=new Float64Array(nfft),im=new Float64Array(nfft);let sum=0,mean=0;
 for(let i=a;i<b;i++)mean+=y[i];mean/=Math.max(n,1);
 for(let i=0;i<n;i++){const w=.5-.5*Math.cos(2*Math.PI*i/Math.max(1,n-1));re[i]=(y[a+i]-mean)*w;sum+=w;}
 fft(re,im);const mag=new Float64Array(nfft/2+1);for(let k=0;k<mag.length;k++){re[k]*=2/Math.max(sum,1);im[k]*=2/Math.max(sum,1);if(absolute){const angle=-2*Math.PI*k*a/nfft,c=Math.cos(angle),s=Math.sin(angle),r=re[k];re[k]=r*c-im[k]*s;im[k]=r*s+im[k]*c;}mag[k]=Math.hypot(re[k],im[k]);}return {re,im,mag};
}
const percentile=(x:number[],q:number)=>{if(!x.length)return 0;const a=[...x].sort((a,b)=>a-b);return a[Math.min(a.length-1,Math.floor((a.length-1)*q))];};
const norm=(v:Float64Array)=>Math.sqrt(v.reduce((s,x)=>s+x*x,0));
const dot=(a:Float64Array,b:Float64Array)=>a.reduce((s,x,i)=>s+x*b[i],0);
function near(v:Float64Array,f:number,sr:number,width=10){const k=Math.round(f*FFTSIZE/sr),d=Math.max(1,Math.round(width*FFTSIZE/sr));let best=0;for(let i=Math.max(0,k-d);i<=Math.min(v.length-1,k+d);i++)best=Math.max(best,v[i]);return best;}
function envelope(y:Float32Array,sr:number){const n=Math.max(1,Math.round(sr*.004)),env=new Float64Array(y.length);let sum=0;for(let i=0;i<y.length+n/2;i++){if(i<y.length)sum+=y[i]*y[i];if(i>=n&&i-n<y.length)sum-=y[i-n]*y[i-n];const at=i-Math.floor(n/2);if(at>=0&&at<y.length)env[at]=Math.sqrt(Math.max(0,sum)/n);}return env;}
export function detectOnsets(y:Float32Array,sr:number,progress?:(n:number,status:string)=>void){
 const count=Math.ceil(y.length/HOP)+1,flux:number[]=[],complex:number[]=[],rms:number[]=[],strength:number[]=[];let prev: Spectrum|undefined,phasePrev:Float64Array|undefined,phaseOlder:Float64Array|undefined;
 for(let i=0;i<count;i++){
  const s=spec(y,i*HOP-SIZE/2,SIZE,SIZE,false);let f=0,c=0,e=0;const phase=new Float64Array(s.mag.length);
  for(let k=4;k<s.mag.length;k++){phase[k]=Math.atan2(s.im[k],s.re[k]);if(prev){f+=Math.max(0,Math.sqrt(s.mag[k])-Math.sqrt(prev.mag[k]));if(phasePrev&&phaseOlder){const angle=2*phasePrev[k]-phaseOlder[k];c+=Math.hypot(s.re[k]-prev.mag[k]*Math.cos(angle),s.im[k]-prev.mag[k]*Math.sin(angle));}}e+=s.mag[k]**2;}
  flux.push(f);complex.push(c);rms.push(Math.sqrt(e));prev=s;phaseOlder=phasePrev;phasePrev=phase;
  if(i%800===0)progress?.(i/count*.35,'Zbulimi i goditjeve · spektri dhe faza');
 }
 const fs=Math.max(1e-8,percentile(flux,.98)),cs=Math.max(1e-8,percentile(complex,.98));
 for(let i=0;i<count;i++)strength.push(.55*flux[i]/fs+.45*complex[i]/cs);
 const env=envelope(y,sr);let envMax=0,riseMax=0;for(let i=1;i<env.length;i++){envMax=Math.max(envMax,env[i]);riseMax=Math.max(riseMax,env[i]-env[i-1]);}
 const cdMax=complex.reduce((a,b)=>Math.max(a,b),0),peaks:number[]=[];
 for(let k=1;k<count-1;k++){
  if(strength[k]<strength[k-1]||strength[k]<strength[k+1])continue;
  const local=strength.slice(Math.max(0,k-21),Math.min(count,k+22)),med=percentile(local,.5),mad=percentile(local.map(v=>Math.abs(v-med)),.5);
  const prominence=strength[k]-Math.max(Math.min(...strength.slice(Math.max(0,k-5),k)),Math.min(...strength.slice(k+1,Math.min(count,k+6))));
  if(strength[k]<med+Math.max(.11,1.4*mad)||prominence<.16||Math.max(...complex.slice(k-1,k+2))<cdMax*.12)continue;
  let a=Math.max(0,k*HOP-Math.round(sr*.012)),b=Math.min(y.length-1,k*HOP+Math.round(sr*.026)),at=a,rise=0;
  for(let i=a;i<b;i++){const d=env[i+1]-env[i];if(d>rise){rise=d;at=i;}}
  if(rise<riseMax*.012||env[at]<envMax*.012)continue;
  const floor=percentile(Array.from(env.slice(Math.max(0,at-Math.round(sr*.04)),at+1)),.2);let peak=0;for(let i=at;i<Math.min(env.length,at+Math.round(sr*.012));i++)peak=Math.max(peak,env[i]);const threshold=floor+.12*Math.max(0,peak-floor);
  let start=at;while(start>a&&env[start]>threshold&&at-start<sr*.009)start--;
  if(peaks.length&&start-peaks[peaks.length-1]<sr*.028)continue;peaks.push(start);
 }
 return peaks;
}
function template(t:Tone,sr:number,resolution:number){const out=new Float64Array(FFTSIZE/2+1),harmonics=t.harmonics||INITIAL;for(let h=1;h<=harmonics.length;h++){const f=t.frequency*h;if(f>=sr/2)break;const k=f*FFTSIZE/sr,d=resolution*4*FFTSIZE/sr;for(let j=Math.max(0,Math.floor(k-d));j<=Math.min(out.length-1,Math.ceil(k+d));j++){if(j*sr/FFTSIZE<110||j*sr/FFTSIZE>6500)continue;out[j]+=harmonics[h-1]*Math.exp(-.5*((j*sr/FFTSIZE-f)/resolution)**2);}}const scale=norm(out)||1;for(let i=0;i<out.length;i++)out[i]/=scale;return out;}
type Fit={tone:Tone;confidence:number;review:boolean;evidence:Record<string,unknown>};
export function fitEvent(y:Float32Array,sr:number,sample:number,next:number,tones:Tone[]):Fit[]{
 const len=Math.min(Math.round(sr*.085),Math.max(Math.round(sr*.032),next-sample-Math.round(sr*.005))),offset=Math.min(Math.round(sr*.010),Math.max(0,Math.floor((next-sample)/8)));
 const after=spec(y,sample+offset,len),before=spec(y,sample-len-Math.round(sr*.005),len);let max=0;for(const x of after.mag)max=Math.max(max,x);if(max<1e-5)return [];
 const noise=Math.max(1e-8,percentile(Array.from(after.mag),.5)),residual=new Float64Array(after.mag.length);
 for(let k=0;k<residual.length;k++){const f=k*sr/FFTSIZE;if(f<110||f>6500)continue;residual[k]=Math.max(0,Math.hypot(after.re[k]-.82*before.re[k],after.im[k]-.82*before.im[k])-noise*1.5);}
 const scale=norm(residual)||1,obs=residual.map(v=>v/scale),resolution=Math.max(5,sr/len*.63);
 const columns=tones.map(t=>template(t,sr,resolution));
 const evidence=tones.map(t=>{const pre=near(before.mag,t.frequency,sr),post=near(after.mag,t.frequency,sr),ratio=post/Math.max(pre,1e-8);return {ratio,previous:pre,fundamental:post,new_attack:post>Math.max(2e-5,max*.022)&&(pre<post*.2||ratio>1.14),novelty:near(residual,t.frequency,sr)};});
 const eligible=tones.map((_,i)=>i).filter(i=>evidence[i].new_attack||(tones[i].string==='lower'&&evidence[i].novelty>Math.max(noise*5,max*.055,evidence[i].previous*.24)));
 const scores=columns.map(c=>dot(c,obs));const options:{ids:number[];cost:number;err:number;coeff:number[]}[]=[];
 for(const i of eligible){const coeff=Math.max(0,scores[i]);if(coeff<.07)continue;const err=Math.max(0,1-coeff*coeff);options.push({ids:[i],cost:err+(tones[i].string==='upper'?.004:0),err,coeff:[coeff]});}
 for(const l of eligible.filter(i=>tones[i].string==='lower'))for(const u of eligible.filter(i=>tones[i].string==='upper')){const cross=dot(columns[l],columns[u]),det=1-cross*cross;if(det<1e-4)continue;const a=(scores[l]-cross*scores[u])/det,b=(scores[u]-cross*scores[l])/det;if(a<.07||b<.07)continue;const err=Math.max(0,1-a*scores[l]-b*scores[u]);options.push({ids:[l,u],err,cost:err+.055,coeff:[a,b]});}
 options.sort((a,b)=>a.cost-b.cost);const best=options[0];if(!best||best.err>.83||(!best.ids.some(i=>evidence[i].new_attack)&&best.err>.45))return [];
 return best.ids.map((i,j)=>{const t=tones[i],other=best.ids.find(k=>k!==i),ratio=other==null?0:t.frequency/tones[other].frequency,collision=ratio>1.9&&ratio<5.1&&Math.abs(ratio-Math.round(ratio))<.035;
 const competing=options.filter(o=>!o.ids.includes(i));const margin=(competing[0]?.cost??best.cost+.2)-best.cost;let confidence=Math.max(.05,Math.min(.93,.32+.43*(1-best.err)+.18*Math.min(1,Math.max(0,margin)/.18)));if(collision&&!best.ids.every(k=>tones[k].measured))confidence=Math.min(.54,confidence);
 const ambiguous=tones.some(other=>other.string!==t.string&&Math.abs(1200*Math.log2(t.frequency/other.frequency))<70);if(ambiguous)confidence=Math.min(confidence,.54);
 return {tone:t,confidence,review:confidence<.65||collision||ambiguous,evidence:{...evidence[i],fit_residual:best.err,harmonic_collision:collision,string_ambiguous:ambiguous,coefficient:best.coeff[j],template_measured:t.measured}};
 });
}
function refineSample(y:Float32Array,sr:number,sample:number,f:number){
 const a=Math.max(0,sample-Math.round(sr*.025)),b=Math.min(y.length,sample+Math.round(sr*.04)),n=b-a,width=Math.max(4,Math.round(sr*.006));let re=0,im=0;const env=new Float64Array(n),r=new Float64Array(n),m=new Float64Array(n);
 for(let i=0;i<n;i++){const phase=2*Math.PI*f*(a+i)/sr;r[i]=y[a+i]*Math.cos(phase);m[i]=-y[a+i]*Math.sin(phase);re+=r[i];im+=m[i];if(i>=width){re-=r[i-width];im-=m[i-width];}const at=i-Math.floor(width/2);if(at>=0)env[at]=Math.hypot(re,im)/width;}
 const lo=Math.max(1,sample-a-Math.round(sr*.012)),hi=Math.min(n-1,sample-a+Math.round(sr*.018));let at=sample-a,best=0;
 for(let i=lo;i<hi;i++){const d=env[i]-env[i-1];if(d>best){best=d;at=i;}}
 return Math.max(0,best>1e-6?a+at-Math.round(sr*.003):sample);
}
function noteEnd(y:Float32Array,sr:number,start:number,limit:number,f:number){const size=Math.round(sr*.026),hop=Math.round(sr*.012),amps:number[]=[],ends:number[]=[];for(let at=start;at<Math.min(limit,start+sr*3,y.length);at+=hop){const n=Math.min(size,y.length-at);let re=0,im=0;for(let i=0;i<n;i++){const w=.5-.5*Math.cos(2*Math.PI*i/Math.max(1,n-1)),a=2*Math.PI*f*i/sr;re+=y[at+i]*w*Math.cos(a);im+=y[at+i]*w*Math.sin(a);}amps.push(Math.hypot(re,im)/Math.max(1,n));ends.push(Math.min(limit,at+n));}if(!amps.length)return Math.min(y.length,start+1);const peak=Math.max(...amps);let end=ends[ends.length-1];for(let i=2;i<amps.length-2;i++)if(Math.max(amps[i],amps[i+1],amps[i+2])<Math.max(1e-6,peak*.07)){end=ends[i];break;}return Math.max(start+1,Math.min(limit,y.length,end));}
export function analyzePCM(y:Float32Array,sr=SR,profile:Profile=defaultProfile(),progress?:(fraction:number,status:string)=>void):Project{
 const began=performance.now();validProfile(profile);if(!y.length||y.some(x=>!Number.isFinite(x)))throw Error('PCM bosh ose i pavlefshëm.');
 const p=emptyProject('Çifteli',y.length/sr,profile);p.audio.sample_rate=sr;p.audio.num_samples=y.length;const tuning=diagnoseTuning(y,sr,profile);
 const attacks=detectOnsets(y,sr,progress);let group=1,last=-Infinity;const unresolved:Record<string,unknown>[]=[];p.groups=[];
 attacks.forEach((s,i)=>{const next=attacks[i+1]??y.length,fit=fitEvent(y,sr,s,next,profile.tones);if(!fit.length){unresolved.push({sample_index:s,time:s/sr,reason:'insufficient_acoustic_evidence'});return;}
 if(s-last>sr*.9){if(last!==-Infinity)group++;p.groups.push({id:group,start:s/sr,start_sample:s,manual:false});}last=s;
 for(const item of fit){const at=refineSample(y,sr,s,item.tone.frequency),end=Math.min(y.length,at+Math.round(sr*.3));p.notes.push({id:`dsp-${item.tone.string}-${item.tone.fret}-${at}`,event_id:`e-${s}`,event_time:s/sr,event_sample_index:s,sample_index:at,time:at/sr,end_sample:end,end_time:end/sr,duration:(end-at)/sr,string:item.tone.string,fret:item.tone.fret,frequency:item.tone.frequency,confidence:item.confidence,confidence_status:'heuristic_uncalibrated',review:item.review,source:'dsp',manual:false,group,evidence:item.evidence});}
 if(i%15===0)progress?.(.35+.55*(i+1)/attacks.length,'Dallimi i notave, harmonikave dhe rezonancës');
 });
 p.notes.sort((a,b)=>a.sample_index-b.sample_index);if(tuning.possible_mismatch)for(const n of p.notes){n.review=true;n.confidence=Math.min(.54,n.confidence);}
 for(let i=0;i<p.notes.length;i++){const n=p.notes[i],next=p.notes.slice(i+1).find(m=>m.string===n.string)?.sample_index??y.length;n.end_sample=noteEnd(y,sr,n.sample_index,next,n.frequency||220);n.end_time=n.end_sample/sr;n.duration=(n.end_sample-n.sample_index)/sr;n.duration_method='fundamental_decay_or_next_same_string_attack';n.release_uncertain=true;}
 const step=Math.max(1,Math.ceil(y.length/3000));for(let i=0;i<y.length;i+=step){let max=0;for(let k=i;k<Math.min(y.length,i+step);k++)max=Math.max(max,Math.abs(y[k]));p.waveform.push(max);}
 const cols=Math.min(600,Math.ceil(y.length/1024)),bins=160,db:number[][]=Array.from({length:bins},()=>[]);let max=1e-8;const spectra:Float64Array[]=[];
 for(let col=0;col<cols;col++){const s=spec(y,Math.round(col*y.length/cols),1024,1024,false).mag;spectra.push(s);for(let k=0;k<bins;k++)max=Math.max(max,s[k]);}
 for(const s of spectra)for(let k=0;k<bins;k++)db[k].push(Math.max(-80,20*Math.log10(s[k]/max+1e-7)));
 p.spectrogram={db,max_hz:(bins-1)*sr/1024};p.analysis={version:'3.0.0-browser-dsp',engine:'browser-dsp-harmonic-residual',onset_candidates:attacks.length,recognized_events:new Set(p.notes.map(n=>n.event_id)).size,unresolved,confidence_calibrated:false,processing_seconds:(performance.now()-began)/1000,cqt_used:false,ml_model:null,real_world_accuracy:null,onset_hop_samples:HOP,tuning_diagnostics:tuning,limitations:['Browser DSP baseline; use Python for CQT.','Uncalibrated harmonic collisions require review.','Rare upper frets need calibration.']};progress?.(1,'Analiza përfundoi');return p;
}
export function diagnoseTuning(y:Float32Array,sr:number,profile:Profile){
 const reference=profile.tones.find(t=>t.string==='upper'&&t.fret===14)?.frequency??220,spectra:Float64Array[]=[];const count=Math.min(24,Math.max(1,Math.floor(y.length/sr*2)));
 for(let i=0;i<count;i++){const at=Math.round(i/Math.max(1,count-1)*Math.max(0,y.length-sr*.18)),s=spec(y,at,Math.round(sr*.18)).mag;let max=0;for(const v of s)max=Math.max(max,v);if(max>1e-4)spectra.push(s.map(v=>v/max));}
 if(spectra.length<3)return {reference_upper_hz:reference,possible_mismatch:false,status:'insufficient_audio'};
 let best=0,estimate=reference,referenceScore=0;
 for(let f=180;f<=280;f+=.5){const supports=spectra.map(s=>near(s,f,sr,4)>.018?[.6,1,.8,.6,.4].reduce((v,w,i)=>v+w*near(s,f*(i+1),sr,5),0):0),score=percentile(supports,.5);if(Math.abs(f-reference)<.26)referenceScore=score;if(score>best){best=score;estimate=f;}}
 return {reference_upper_hz:reference,candidate_persistent_family_hz:estimate,possible_mismatch:Math.abs(estimate-reference)>Math.max(8,reference*.04)&&best>Math.max(.25,referenceScore*2.5),method:'median_harmonic_family_scan; inference_only_not_calibration',score:best};
}
export function calibratePCM(y:Float32Array,sr:number,profile:Profile,string:'upper'|'lower',fret:number,strength:string,target?:number):Profile{
 validProfile(profile);if(y.length<sr*.15)throw Error('Regjistro të paktën 0.15 sekonda.');const attacks=detectOnsets(y,sr),at=attacks[0]??0,a=at+Math.round(sr*.025),n=Math.min(Math.round(sr*.12),y.length-a);if(n<512)throw Error('Regjistrim shumë i shkurtër.');
 const expected=target||profile.tones.find(t=>t.string===string&&t.fret===fret)?.frequency;const minLag=Math.max(2,Math.floor(sr/(expected?expected*1.16:1800))),maxLag=Math.min(Math.floor(n/2),Math.ceil(sr/(expected?expected*.84:130)));
 const cmnd=new Float64Array(maxLag+1);let sum=0;for(let tau=1;tau<=maxLag;tau++){let d=0;for(let j=0;j<n-maxLag;j++)d+=(y[a+j]-y[a+j+tau])**2;sum+=d;cmnd[tau]=d*tau/Math.max(sum,1e-12);}
 let lag=0,best=Infinity;for(let t=minLag;t<maxLag;t++){if(cmnd[t]<.17&&cmnd[t]<=cmnd[t-1]&&cmnd[t]<=cmnd[t+1]){lag=t;break;}if(cmnd[t]<best){best=cmnd[t];lag=t;}}
 if(!lag||cmnd[lag]>.3)throw Error('Tingulli nuk është mjaftueshëm periodik. Regjistro vetëm një tel.');
 const denom=2*(2*cmnd[lag]-cmnd[lag-1]-cmnd[lag+1]),offset=denom?(cmnd[lag+1]-cmnd[lag-1])/denom:0;const frequency=sr/(lag+Math.max(-.5,Math.min(.5,offset)));
 const s=spec(y,a,Math.min(Math.round(sr*.12),n)),harmonics=INITIAL.map((_,i)=>near(s.mag,frequency*(i+1),sr));const base=Math.max(harmonics[0],1e-8);const weights=harmonics.map(x=>Math.min(20,x/base));
 const env=envelope(y,sr);let sx=0,sy=0,sxx=0,sxy=0,count=0;for(let k=at+Math.round(sr*.05);k<Math.min(y.length,at+sr*.55);k+=Math.round(sr*.012)){if(env[k]<1e-5)continue;const x=(k-at)/sr,z=Math.log(env[k]);sx+=x;sy+=z;sxx+=x*x;sxy+=x*z;count++;}const slope=(count*sxy-sx*sy)/Math.max(1e-12,count*sxx-sx*sx),decay=slope<-.05?Math.min(5,Math.max(.03,-1/slope)):.45;
 const p=structuredClone(profile);p.recordings.push({string,fret,strength,frequency,harmonics:weights,decay_seconds:decay,kind:'isolated',sample_rate:sr,samples:y.length});
 const takes=p.recordings.filter(r=>r.string===string&&r.fret===fret&&r.kind==='isolated');const tone:Tone={string,fret,frequency:percentile(takes.map(r=>Number(r.frequency)),.5),harmonics:weights.map((_,h)=>percentile(takes.map(r=>(r.harmonics as number[])[h]),.5)),decay_seconds:percentile(takes.map(r=>Number(r.decay_seconds)),.5),measured:true,recording_count:takes.length,strengths:[...new Set(takes.map(r=>String(r.strength)))]};
 p.tones=p.tones.filter(t=>t.string!==string||t.fret!==fret);p.tones.push(tone);p.id='cal-'+crypto.randomUUID();return p;
}
