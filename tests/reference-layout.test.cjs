const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root=path.join(__dirname,'..');
const css=fs.readFileSync(path.join(root,'src/compact.css'),'utf8');
const app=fs.readFileSync(path.join(root,'src/app.js'),'utf8');

test('Reference stage keeps stock, loose cards and builds in separate lanes',()=>{
  assert.match(css,/--stock-lane:clamp\(39px,12vw,53px\)/);
  assert.match(css,/--build-lane:clamp\(74px,20\.5vw,98px\)/);
  assert.match(css,/\.table-stage:has\(\.table-builds:not\(:empty\)\) \.table-cards/);
  assert.match(css,/position:absolute!important;\s*left:var\(--stock-lane\)!important/);
  assert.match(css,/\.table-stage \.table-builds:not\(:empty\) \{/);
  assert.match(css,/right:2px!important/);
});

test('Four loose cards have predictable row slots even with a build',()=>{
  assert.match(css,/flex:0 0 calc\(\(100% - 3\*clamp\(4px,1\.4vw,8px\) - 8px\)\/4\)/);
  assert.match(css,/max-width:68px/);
  assert.match(css,/justify-content:flex-start/);
});

test('Reference-style build animation shows real card layers and final owner/value panel',()=>{
  assert.match(app,/const layers=cards\.map\(\(card,i\)=>/);
  assert.match(app,/class="build-value-owner"/);
  assert.match(app,/class="build-value-number"/);
  assert.match(app,/await Promise\.all\(buildGhosts\.map/);
  assert.match(app,/const label=destination\.querySelector\('\.build-value'\)/);
});

test('Legal moves remain contextual; capture cards gather before moving as a stack',()=>{
  assert.match(app,/active && pickedCard && visibleActionCount/);
  assert.match(app,/captureTrack\(entry,frontPositions\[i\]/);
  assert.match(app,/const stack=ghosts\.map/);
  assert.match(app,/await flipComputerCard\(\)/);
  assert.match(app,/if\(capture\)/);
});

test('Unified setup and exit confirmation are preserved',()=>{
  assert.match(app,/return openSettings\('newgame'\)/);
  assert.doesNotMatch(app,/overlay\.classList\.add\('modal-stack'\)/);
  assert.match(app,/function showExitConfirm\(\)/);
  assert.match(app,/function cancelExit\(\)/);
  assert.match(app,/function exitGameToMenu\(\)/);
});
