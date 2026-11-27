const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../src/compact.css'),'utf8');
test('All movement keyframes use transforms/opacity rather than layout properties',()=>{
  const start=app.indexOf('    function moveBuildCard(');
  const end=app.indexOf('    const flipDuration=',start);
  const flights=app.slice(start,end);
  assert.match(flights,/animate\(entry\.ghost,\[\{transform:start\},\{transform:landed\}\]/);
  assert.match(flights,/delay:options\.delay\|\|0,fill:'both'/);
  assert.doesNotMatch(flights,/animate\(entry\.ghost,\[start,finish\]/);
});
test('Staggered movements use native delays, batch rectangle reads, and wait for completion',()=>{
  assert.match(app,/const slotRects=layers\.map\(node=>node\.getBoundingClientRect\(\)\)/);
  assert.match(app,/moveBuildCard\(piece,slotRect,310,delay\)/);
  assert.match(app,/captureTrack\(entry,frontPositions\[i\],scale,i,stagger,gatherDuration,collectAt\)/);
  assert.match(app,/from,scale:from\?\.scale\?\?1,scaleY:from\?\.scaleY\?\?1,delay:i\*gap/);
  assert.match(app,/const measured=items\.map\(item=>\(\{\.\.\.item,rect:item\.node\.getBoundingClientRect\(\)\}\)\)/);
  assert.match(app,/duration:440,delay:index\*94/);
  assert.match(app,/return Promise\.all\(measured\.map\(flyOne\)\)/);
  assert.doesNotMatch(app,/setTimeout\(resolve,i\*stagger\)|setTimeout\(resolve,i\*gap\)|setTimeout\(resolve,delay\)/);
  assert.doesNotMatch(css,/animation:table-snap|animation:table-bloom/);
});
test('Synthesized card sounds reuse precomputed samples',()=>{
  const start=app.indexOf('  const soundBuffers=new Map()');
  const code=app.slice(start,app.indexOf('  // Take a snapshot',start));
  let buffers=0,starts=0;
  const audioContext={state:'running',sampleRate:8000,currentTime:0,
    createBuffer(ch,n){buffers++;return {getChannelData:()=>new Float32Array(n)};},
    createBufferSource(){return {connect(){},start(){starts++},stop(){}};},
    createBiquadFilter(){return {frequency:{},Q:{},connect(){}};},
    createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};},
    destination:{}};
  const sound=new Function('audioContext','prefs','globalThis',code+';return sound;')(audioContext,{sound:true},{AudioContext:function(){}});
  sound('tap');sound('tap');sound('tap');
  assert.equal(buffers,1);assert.equal(starts,3);
});
