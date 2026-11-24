const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=fs.readFileSync(path.resolve(__dirname,'../src/app.js'),'utf8');
const css=fs.readFileSync(path.resolve(__dirname,'../src/compact.css'),'utf8');
test('Stack displays original cards, visible corner indices, then owner and large build value',()=>{
  assert.match(app,/cards\.map\(\(card,i\)=>/);
  assert.match(app,/\$\{renderCard\(card\)\}/);
  assert.match(app,/class="build-value-owner"/);
  assert.match(app,/class="build-value-number"/);
  assert.match(app,/element\.owner === 0 \? 'You' : 'Computer'/);
});

test('Builds stay aligned and value panel covers lower front card',()=>{
  assert.match(css,/--stack-splay:0px!important/);
  assert.match(css,/transform:translateY\(calc\(var\(--layer\)\*var\(--stack-step\)\)\)!important/);
  assert.match(css,/\.build-layer:last-child \.build-value/);
});

test('Build label enters after flying cards land',()=>{
  const flight=app.indexOf('await Promise.all(buildGhosts.map');
  const badge=app.indexOf("const label=destination.querySelector('.build-value');",flight);
  assert.ok(flight>=0 && badge>flight);
});
