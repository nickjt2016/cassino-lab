const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const css = fs.readFileSync(path.join(__dirname,'../src/compact.css'),'utf8');

test('Moving cards use exact source dimensions and no extra flight-only texture or shadow',()=>{
  assert.match(css,/\.card-flight > \.playing-card,\s*\.card-flight > \.card-back\s*\{[\s\S]*?width:100%!important;height:100%!important/);
  assert.match(css,/\.card-flight\s*\{\s*contain:layout;isolation:isolate;filter:none;overflow:visible/);
  assert.doesNotMatch(css,/\.card-flight\s*\{[^}]*filter:drop-shadow/);
  assert.doesNotMatch(css,/\.build-layer\s*\{[^}]*filter:drop-shadow/);
});

test('Selections glow externally, without replacing the face texture',()=>{
  const section=css.slice(css.indexOf('/* Selection is an external golden outline'));
  assert.match(section,/outline:2px solid #ffe176/);
  assert.doesNotMatch(css,/\.hand-item\.selected \.playing-card,\.table-item\.selected \.playing-card\s*\{[^}]*background:/);
  assert.doesNotMatch(css,/\.build-item\.selected \.build-layer \.playing-card\s*\{[^}]*background:/);
});

test('Stock, opponent and flying card backs share a proportional pattern',()=>{
  const section=css.slice(css.indexOf('/* One physical back design'));
  assert.match(section,/\.card-back\s*\{[\s\S]*?border:0;padding:0/);
  assert.match(section,/\.back-pattern\s*\{[\s\S]*?inset:8%[\s\S]*?background-size:50% auto/);
  const stock=css.match(/\.game-stats \.stock-back \.card-back\s*\{([^}]*)\}/)[1];
  assert.doesNotMatch(stock,/padding:|border:/);
});

test('Both CPU flips and dealing use the same card-back renderer; only flips replace the artwork',()=>{
  const flip=app.slice(app.indexOf('    async function flipComputerCard'),app.indexOf('    async function gatherEndOfHand'));
  assert.match(flip,/ghost\.innerHTML=renderBack\(\)/);
  assert.ok(flip.indexOf("rotateY(90deg)")<flip.indexOf("ghost.innerHTML=face"));
  assert.ok(flip.indexOf("ghost.innerHTML=face")<flip.indexOf("rotateY(-90deg)"));
  const deal=app.slice(app.indexOf('  function animateNewDeal'),app.indexOf('  function animateTurnMessage'));
  assert.match(deal,/ghost\.innerHTML=renderBack\(\)/);
  assert.ok(deal.indexOf('if(faceUp)')<deal.indexOf('ghost.replaceChildren(face)'));
});
