const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'src/app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/compact.css'),'utf8');

test('Loose row remains left anchored when a build is made or removed',()=>{
  const rules=css.slice(css.indexOf('/* v0.5.10'));
  assert.match(rules,/\.table-stage:not\(:has\(\.table-builds:not\(:empty\)\)\) \.table-cards/);
  assert.match(rules,/justify-content:flex-start!important/);
  assert.match(rules,/flex-wrap:wrap!important/);
});

test('Each survivor slides to its newly vacated slot using its stable table id',()=>{
  assert.match(app,/node\.dataset\.action\+':'\+node\.dataset\.id/);
  assert.match(app,/const from=previous\.get\(key\)/);
  assert.match(app,/const isTableCard = node\.dataset\.action === 'table'/);
  assert.match(app,/duration:isTableCard \? 355 : 420/);
  assert.match(app,/translate:\`\$\{dx\}px \$\{dy\}px\`/);
});

test('A new build remains on the right and does not force the table to recenter',()=>{
  assert.match(css,/\.table-stage \.table-builds:not\(:empty\)/);
  assert.match(css,/right:2px!important/);
  const looseCardRules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([,selector])=>selector.trim().split(',').some(part=>/\.table-cards$/.test(part.trim())))
    .map(([,selector,declarations])=>({selector,declarations}));
  assert.ok(looseCardRules.length);
  // Scope the assertion to the lane itself; newer toolbars, dialogs and
  // CPU hands legitimately center their contents elsewhere in this file.
  const finalAlignment=looseCardRules.filter(rule=>/justify-content:/.test(rule.declarations)).at(-1);
  assert.match(finalAlignment.declarations,/justify-content:(?:flex-start|start)!important/);
});

test('Capture gap filling waits at the original slot, including the CPU flip',()=>{
  const start=app.indexOf('  function layoutPositions('),end=app.indexOf('  // Dealt cards',start);
  const create=(motion,byComputer)=>{
    const calls=[];
    const node=(action,cls,id)=>({
      dataset:{action,id},classList:{contains:k=>k===cls},
      getBoundingClientRect:()=>({left:100,top:100,width:50,height:70}),
      animate(frames,opts){calls.push({id,frames,opts});}
    });
    const nodes=[node('table','table-item','t1'),node('table','build-item','b1'),node('hand','hand-item','h1')];
    const host={querySelectorAll:selector=>selector.includes('data-action')?nodes:[]};
    const prev=new Map([['table:t1',{x:200,y:135}],['table:b1',{x:200,y:135}],['hand:h1',{x:200,y:135}]]);
    new Function('app','motionAllowed','game',app.slice(start,end)+';return animateLayout;')(host,()=>true,{players:[{},{}]})(prev,motion,byComputer);
    return calls;
  };
  for(const [cpu,delay] of [[false,160],[true,495]]){
    const calls=create('capture',cpu);
    assert.equal(calls[0].opts.delay,delay);
    assert.equal(calls[0].opts.fill,'backwards');
    assert.equal(calls[0].frames[0].translate,'75px 0px');
    assert.equal(calls[1].opts.delay,0);
    assert.equal(calls[2].opts.delay,0);
  }
  assert.equal(create('build',false)[0].opts.delay,0);
});


test('An empty table has no placeholder outline or minimum width',()=>{
  const base=fs.readFileSync(path.join(root,'src/styles.css'),'utf8');
  assert.doesNotMatch(base,/\.empty-table/);
  assert.doesNotMatch(css,/\.empty-table/);
  assert.doesNotMatch(app,/empty-table/);
  assert.match(app,/class="table-cards" aria-label="Loose table cards"/);
});
