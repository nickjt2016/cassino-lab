const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../src/engine.js');
const app=fs.readFileSync(path.resolve(__dirname,'../src/app.js'),'utf8');
const css=fs.readFileSync(path.resolve(__dirname,'../src/compact.css'),'utf8');
test('Stack displays original cards, visible corner indices, then owner and large build value',()=>{
  assert.match(app,/cards\.map\(\(card,i\)=>/);
  assert.match(app,/\$\{renderCard\(card,false,selected\)\}/);
  assert.match(app,/class="build-value-owner"/);
  assert.match(app,/class="build-value-number"/);
  const start=app.indexOf('  function isRed('),end=app.indexOf('  // The reserved build lane',start);
  const game={players:[{name:'Human'},{name:'Computer'},{name:'CPU 2'}],rules:E.rulesFor('classic')};
  const render=new Function('E','game','pickedTable','escapeHtml',app.slice(start,end)+';return entryMarkup;')(E,game,new Set(),String);
  const cards=['S3','H7'].map(id=>E.allCards().find(card=>card.id===id));
  for(const [owner,label] of [[0,'You'],[1,'Computer'],[2,'CPU 2']]){
    const html=render({type:'build',id:'b1',owner,value:10,groups:[cards]});
    assert.match(html,new RegExp('class="build-value-owner">'+label+'<'));
    assert.match(html,/class="build-value-number">10</);
    for(const card of cards)assert.ok(html.includes('data-card-id="'+card.id+'"'));
  }
});

test('Builds stay aligned and value panel covers lower front card',()=>{
  assert.match(css,/--stack-splay:0px!important/);
  assert.match(css,/top:calc\(var\(--layer\)\*var\(--stack-step\)\)/);
  assert.match(css,/\.build-layer:last-child \.build-value/);
});

test('Build label enters after flying cards land',()=>{
  const flight=app.indexOf('await Promise.all(buildGhosts.map');
  const badge=app.indexOf("const label=destination.querySelector('.build-value');",flight);
  assert.ok(flight>=0 && badge>flight);
});
