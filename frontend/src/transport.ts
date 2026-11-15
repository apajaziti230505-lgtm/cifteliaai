/** Playback uses the same decoded PCM timeline, avoiding MP3 container timing offsets. */
export function pcmWav(samples:Float32Array,sr:number):Blob{
 const bytes=new ArrayBuffer(44+samples.length*2),v=new DataView(bytes),text=(at:number,s:string)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
 text(0,'RIFF');v.setUint32(4,36+samples.length*2,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,samples.length*2,true);
 for(let i=0;i<samples.length;i++){const x=Math.max(-1,Math.min(1,samples[i]));v.setInt16(44+i*2,Math.round(x*(x<0?32768:32767)),true);}return new Blob([bytes],{type:'audio/wav'});
}
