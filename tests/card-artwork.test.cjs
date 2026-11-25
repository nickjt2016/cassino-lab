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

test('Selected cards have yellow paper and a gold border; build panel retains black paper',()=>{
  assert.match(css,/\.playing-card\.card-selected\s*\{\s*--divider-paper:#fff59b;--divider-edge:#d6a526/);
  assert.match(css,/\.build-value\.card-selected\s*\{\s*--build-ink:#fff59b;--build-outline:#d6a526/);
  assert.match(css,/\.retained-build-value\s*\{[^}]*background:#12110e;\s*border:1px solid var\(--build-outline,#c8c8c8\)/);
  assert.match(css,/\.retained-build-value\s*\{[^}]*color:var\(--build-ink,#fff\)/);
  assert.match(css,/\.build-value-number\s*\{[^}]*color:inherit/);
  assert.match(css,/\.build-value-owner\s*\{[^}]*color:inherit/);
  assert.doesNotMatch(css,/\.build-value\.card-selected\s*\{[^}]*(?:background|--build-panel-paper)/);
  assert.doesNotMatch(css,/\.build-item\.selected[^{}]*\{[^}]*outline:/);
  assert.doesNotMatch(css,/\.build-layer \.playing-card:not\(\.mini\)\s*\{[^}]*outline:/);
  assert.doesNotMatch(css,/\.build-item\.selected[^{}]*\{[^}]*box-shadow:/);
  assert.match(app,/renderCard\(card,false,selected\)/);
  assert.match(app,/renderCard\(element\.card,false,selected\)/);
  assert.match(app,/renderCard\(card,false,pickedCard===card\.id\)/);
  assert.match(app,/class="build-value \$\{selected\?'card-selected':''\}"/);
});

test('Selected moving cards fade an identical painted overlay using opacity only',()=>{
  assert.match(app,/html:byComputer\?renderCard\(playerCard\):from\.outerHTML/);
  assert.match(app,/id:card\.dataset\.cardId,rect:rect\(card\),html:card\.outerHTML/);
  const start=app.indexOf('    function releaseCardTint(');
  const fade=app.slice(start,app.indexOf('\n    }',start));
  assert.match(fade,/face\.cloneNode\(true\)/);
  assert.match(fade,/face\.classList\.remove\('card-selected'\)/);
  assert.match(fade,/animate\(tint,\[\{opacity:1\},\{opacity:0\}\]/);
  assert.match(fade,/then\(\(\)=>tint\.remove\(\)\)/);
  assert.doesNotMatch(fade,/getComputedStyle|backgroundColor|fontSize/);
  assert.match(css,/\.flight-selection-tint\s*\{[^}]*pointer-events:none/);
});

test('Build transfer reuses ghosts and lays out the destination face once',()=>{
  assert.match(app,/const individualBuild=snapshot\.kind==='build'&&!snapshot\.finalHand/);
  const build=app.slice(app.indexOf("} else if(snapshot.kind === 'build' && !snapshot.finalHand)"),app.indexOf('          // Trails use the exact same'));
  assert.match(build,/const buildGhosts=ghosts\.filter/);
  assert.doesNotMatch(build,/document\.createElement|innerHTML=/);
  const start=app.indexOf('    function moveBuildCard('),end=app.indexOf('    // A card\'s last position',start);
  const move=app.slice(start,end);
  assert.match(move,/width:slotRect\.width\+'px',height:slotRect\.height\+'px'/);
  assert.match(move,/Object\.assign\(entry\.ghost\.style,finish,\{transform:start,opacity:'1'\}\)/);
  assert.match(move,/animate\(entry\.ghost,\[\{transform:start\},\{transform:landed\}\]/);
  assert.match(move,/entry\.ghost\.style\.transform='none'/);
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

test('Retained build panel transitions only ink and border, keeping black paper throughout',()=>{
  const start=app.indexOf('const inkAndEdge=node=>');
  const end=app.indexOf('await Promise.all(buildGhosts.map',start);
  assert.ok(start>=0&&end>start);
  const transition=app.slice(start,end);
  assert.match(transition,/return \{color:style.color,borderColor:style.borderColor\}/);
  assert.match(transition,/retainedPanel.classList.remove\('card-selected'\)/);
  assert.doesNotMatch(transition,/backgroundColor|background:/);
});

test('Black build panel uses a neutral border except when selected',()=>{
  const panel=css.slice(css.indexOf('/* v0.5.8'),css.indexOf('.game-stats .deck-stat {',css.indexOf('/* v0.5.8')));
  assert.match(panel,/border:1px solid var\(--build-outline,#c8c8c8\)/);
  assert.doesNotMatch(panel,/border-top-color:|#c2ab69|#b29a64/);
});
