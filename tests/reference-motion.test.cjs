const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../src/compact.css'),'utf8');

test('Filmed K-build cards travel on direct paths without a vertical hop',()=>{
  assert.match(app,/from\.y\+\(dy-from\.y\)\*\.58\}px/);
  assert.doesNotMatch(app,/from\.y\+\(dy-from\.y\)\*\.58-3\}px/);
});
test('Build stack assembly is quick, staggered and real-card-sized',()=>{
  assert.match(app,/existingIds\.has\(piece\.id\)\?0:Math\.max\(0,i-oldCount\)\*48/);
  assert.match(app,/moveBuildCard\(piece,slotRect,310,delay\)/);
  assert.match(app,/await moveBuildCard\(piece,slotRect,310,delay\)/);
});
test('Black build owner/value panel appears only after cards settle',()=>{
  const settle=app.indexOf('setTimeout(resolve,65)');
  const label=app.indexOf("const label=destination.querySelector('.build-value');",settle);
  assert.ok(settle>=0 && label>settle);
  assert.match(app.slice(label,label+2000),/duration:140,easing:'ease-out'/);
  assert.match(app.slice(label,label+2000),/await Promise\.all\(panelFades\)/);
  assert.match(css,/\.build-layer:last-child \.build-value/);
});
test('Computer flip and motion share the native clock; capture gathers before return',()=>{
  const track=app.slice(app.indexOf('    function captureTrack'),app.indexOf('    async function gatherEndOfHand'));
  assert.match(track,/const beginAt=flipDuration\+index\*stagger/);
  assert.match(track,/offset:collectAt\/duration,easing/);
  assert.match(track,/easing:'linear',fill:'both',sync:true/);
  assert.match(app,/await Promise\.all\(\[\.\.\.flights,flipComputerCard\(\)\]\)/);
});
