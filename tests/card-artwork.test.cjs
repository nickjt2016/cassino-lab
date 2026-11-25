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

test('Selection fills the entire card and build panel with no overlapping outlines',()=>{
  assert.match(css,/\.playing-card\.card-selected\s*\{background-color:#fff59b/);
  assert.match(css,/\.build-value\.card-selected\s*\{\s*--build-panel-paper:#fff59b/);
  assert.doesNotMatch(css,/\.build-item\.selected[^{}]*\{[^}]*outline:/);
  assert.doesNotMatch(css,/\.build-layer \.playing-card:not\(\.mini\)\s*\{[^}]*outline:/);
  assert.doesNotMatch(css,/\.build-item\.selected[^{}]*\{[^}]*box-shadow:/);
  assert.match(app,/renderCard\(card,false,selected\)/);
  assert.match(app,/renderCard\(element\.card,false,selected\)/);
  assert.match(app,/renderCard\(card,false,pickedCard===card\.id\)/);
  assert.match(app,/class="build-value \$\{selected\?'card-selected':''\}"/);
});

test('Selected moving cards keep their source face and fade only the tint',()=>{
  assert.match(app,/html:byComputer\?renderCard\(playerCard\):from\.outerHTML/);
  assert.match(app,/id:card\.dataset\.cardId,rect:rect\(card\),html:card\.outerHTML/);
  const start=app.indexOf('    function releaseCardTint(');
  const fade=app.slice(start,app.indexOf('\n    }',start));
  assert.match(fade,/face\.classList\.remove\('card-selected'\)/);
  assert.match(fade,/\{backgroundColor:color\},\{backgroundColor:'#fff'\}/);
  assert.doesNotMatch(fade,/innerHTML|fontSize|border|opacity:/);
});

test('Build transfer reuses physical card ghosts and interpolates actual dimensions',()=>{
  assert.match(app,/const individualBuild=snapshot\.kind==='build'&&!snapshot\.finalHand/);
  const build=app.slice(app.indexOf("} else if(snapshot.kind === 'build' && !snapshot.finalHand)"),app.indexOf('          // Computer trails:'));
  assert.match(build,/const buildGhosts=ghosts\.filter/);
  assert.doesNotMatch(build,/document\.createElement|innerHTML=/);
  const start=app.indexOf('    function moveBuildCard('),end=app.indexOf('    // A card\'s last position',start);
  const move=app.slice(start,end);
  assert.match(move,/width:entry\.rect\.width\+'px',height:entry\.rect\.height\+'px'/);
  assert.match(move,/width:slotRect\.width\+'px',height:slotRect\.height\+'px'/);
  assert.match(move,/Object\.assign\(entry\.ghost\.style,finish\)/);
  assert.doesNotMatch(move,/scale\(/);
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
