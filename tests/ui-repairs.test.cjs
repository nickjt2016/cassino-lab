const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const css = fs.readFileSync(path.join(__dirname,'../src/compact.css'),'utf8');

function drawSnapshot(game,beforeHuman,beforeCpu,beforeTable) {
  const start=app.indexOf('  function collectDeal(');
  const end=app.indexOf('  function rememberStockOrigin(',start);
  assert.ok(start>=0&&end>start);
  const ctx={game,beforeHuman,beforeCpu,beforeTable};
  vm.runInNewContext('let pendingDeal=null;\n'+app.slice(start,end)+
    '\ncollectDeal(beforeHuman,beforeCpu,beforeTable);globalThis.result=pendingDeal;',ctx);
  return JSON.parse(JSON.stringify(ctx.result));
}

test('Draw mode does not hide/redeal existing table cards',()=>{
  const game={players:[{hand:[{id:'H1'},{id:'H5'}]},{hand:[{id:'S8'}]}],
    table:[{type:'loose',card:{id:'D3'}},{type:'loose',card:{id:'C4'}},{type:'loose',card:{id:'H6'}}]};
  const current=game.table.map(e=>e.card.id);
  const deal=drawSnapshot(game,['H1'],['S8'],current);
  assert.deepEqual(deal.tableIds,[]);
  assert.deepEqual(deal.humanIds,['H5']);
  assert.deepEqual(deal.cpuIndices,[]);
});

test('Human and computer replacement draws preserve current table IDs',()=>{
  const pattern=/collectDeal\(preHuman,preCpu,game\.table\.filter\(e=>e\.type==='loose'\)\.map\(e=>e\.card\.id\)\)/g;
  assert.equal((app.match(pattern)||[]).length,2);
});

test('Rules toggles keep mounted dialog and scroll position',()=>{
  assert.match(app,/app\.querySelector\('\.overlay \.dialog\[aria-label="settings"\]'\)/);
  assert.match(app,/existingSettings\.innerHTML = renderSettings\(\)/);
  assert.match(app,/restoreVariationsScroll\(\)/);
});

test('Four card slots fit a row and the build label covers the front card',()=>{
  assert.match(css,/flex:0 0 calc\(\(100% - 3\*var\(--loose-gap\) - 8px\)\/4\)/);
  assert.match(css,/\.build-layer:last-child \.build-value/);
  assert.match(css,/height:36%;\s*min-height:36%/);
});
