const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=fs.readFileSync(path.resolve(__dirname,'../src/app.js'),'utf8');
const css=fs.readFileSync(path.resolve(__dirname,'../src/compact.css'),'utf8');
const marker='  function buildPanelValue(value) {';
const end='  function elCards(element)';
const a=app.indexOf(marker),b=app.indexOf(end,a);
assert.ok(a>=0 && b>a,'build value display helper should exist');
const pure=app.slice(a,b);

test('Royal values identify face ranks, numeric builds stay numeric',()=>{
  const get=(rules,value)=>{
    const fn=new Function('game',pure+';return buildPanelValue;')({rules});
    return fn(value);
  };
  assert.equal(get({royal:true,royalAces:true},13),'K');
  assert.equal(get({royal:true,royalAces:true},12),'Q');
  assert.equal(get({royal:true,royalAces:true},14),'A');
  assert.equal(get({royal:true,royalAces:true},10),'10');
  assert.equal(get({royal:false,royalAces:false},12),'12');
});

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
  assert.match(css,/height:65%!important;min-height:65%!important/);
  assert.match(css,/\.build-layer:last-child \.build-value/);
});

test('Build label enters after flying cards land',()=>{
  const flight=app.indexOf('await Promise.all(buildGhosts.map');
  const badge=app.indexOf("const label=destination.querySelector('.build-value');",flight);
  assert.ok(flight>=0 && badge>flight);
});
