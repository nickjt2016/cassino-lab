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
  assert.match(app,/setTimeout\(resolve,i\*48\)/);
  assert.match(app,/snapshot\.byComputer\?365:310/);
  assert.match(app,/await moveBuildCard\(piece,slotRect,snapshot\.byComputer\?365:310\)/);
});
test('Black build owner/value panel appears only after cards settle',()=>{
  const settle=app.indexOf('setTimeout(resolve,65)');
  const label=app.indexOf("const label=destination.querySelector('.build-value');",settle);
  assert.ok(settle>=0 && label>settle);
  assert.match(app.slice(label,label+450),/duration:140,easing:'ease-out'/);
  assert.match(css,/\.build-layer:last-child \.build-value/);
});
test('Computer card still flips before trail and capture; capture cards gather before return',()=>{
  const play=app.indexOf('await flipComputerCard();');
  const capture=app.indexOf('if(capture){',play);
  const direct=app.indexOf('await move(entry,frontPositions[i]',capture);
  const collect=app.indexOf('move(entry,end,280',direct);
  assert.ok(play>=0&&capture>play&&direct>capture&&collect>direct);
});
