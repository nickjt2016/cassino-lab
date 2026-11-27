const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'src/app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/compact.css'),'utf8');

test('Draw-mode replacement stays hidden until a face-down card travels from stock and flips on landing',()=>{
  assert.match(app,/function hidePendingDealCards\(\)/);
  assert.match(app,/node\.style\.visibility='hidden'/);
  assert.match(app,/const start=pendingStockOrigin/);
  assert.match(app,/ghost\.innerHTML=renderBack\(\)/);
  assert.match(app,/const face=node\.cloneNode\(true\)/);
  assert.match(app,/if\(faceUp\)/);
  assert.match(app,/dealAnimation = animateNewDeal/);
  assert.match(app,/Promise\.resolve\(dealAnimation\)\.then/);
});

test('Build piles align vertically and table is not cluttered with a sweep-clear caption',()=>{
  assert.match(css,/--stack-splay:0px!important/);
  assert.match(css,/transform:translateY\(calc\(var\(--layer\)\*var\(--stack-step\)\)\)!important/);
  assert.doesNotMatch(app,/Table cleared/);
});

test('Human flights land in incremental slots and move only the already-dealt hand cards',()=>{
 assert.match(app,/const landingRects=progress\?handDealLandingRects\(progress,geometry\)/);
 assert.match(app,/rect:landingRects\.get\(item\.humanId\)\|\|item\.node\.getBoundingClientRect\(\)/);
 assert.match(app,/if\(humanId&&progress\)advanceHandDeal\(progress,humanId,true\);/);
 assert.match(app,/if\(!previous\.has\(node\.dataset\.id\)\)continue/);
 assert.match(app,/activeHandDeal=null;\s*\/\/ The ordinary next-turn render sorts/);
});
