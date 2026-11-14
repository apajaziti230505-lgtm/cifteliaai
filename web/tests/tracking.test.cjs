'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const target={};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'..','analysis.js'),'utf8'),{
 window:target,performance:{now:()=>0},Float32Array,Uint8Array,Number,Math,Promise,setTimeout,clearTimeout});
const a=target.CifteliaAnalysis;
const fake=(x,y)=>Array.from({length:21},(_,k)=>({x:x+(k%3)*.004,y:y+(k%5)*.004}));
let h=a.handsFromLandmarks({landmarks:[fake(.14,.3),fake(.7,.55)]},{neckOnRight:false});
assert.equal(h.hands.length,2);assert(h.picking);assert(h.fretting);
assert(h.fretting.center.x<h.picking.center.x);
h=a.handsFromLandmarks({landmarks:[fake(.14,.3)]},{});
assert.equal(h.picking,null);assert.equal(h.fretting,null);
const marks={'4':{x:.2,y:.5},'7':{x:.5,y:.5},'8':{x:.56,y:.5}};
const frets=a.projectFretMarkers(marks);assert.equal(frets.length,13);
assert.equal(frets[3].f,4);assert.equal(frets[6].f,7);assert.equal(frets[7].f,8);
assert.equal(frets[3].x,.2);assert.equal(frets[6].x,.5);
const g1=new Uint8Array(160*90),g2=new Uint8Array(160*90);
for(let y=20;y<60;y++)for(let x=20;x<80;x++){
 const val=((x*17+y*13)%190)+40;g1[y*160+x]=val;g2[(y+2)*160+(x+3)]=val;
}
const mv=a.shiftRegion(g1,g2,{x:18/160,y:18/90,w:65/160,h:44/90});
assert(mv, 'should detect moderate instrument movement');
assert(Math.abs(mv.dx-3/160)<.007,'x-translation');
assert(Math.abs(mv.dy-2/90)<.013,'y-translation');
const moved=a.translateMarks(marks,mv);assert(moved['4'].x>marks['4'].x);
console.log('OK: auto hands, 13 approximate frets, moving instrument ROI, marker translation');
