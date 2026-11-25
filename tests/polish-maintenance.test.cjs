const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const sw=fs.readFileSync(path.join(__dirname,'../service-worker.js'),'utf8');
const E=require('../src/engine.js');
const section=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)+start.length));

test('Selection updates existing hand/build faces and leaves the board mounted',()=>{
  const calls=[];
  const makeNode=(action,id)=>{
    const classes=new Set(),faceClasses=new Set(),panelClasses=new Set();
    const classList=set=>({contains:x=>set.has(x),toggle(x,on){if(on)set.add(x);else set.delete(x);}});
    return {dataset:{action,id},classList:classList(classes),
      setAttribute(k,v){calls.push([id,k,v]);},
      querySelectorAll(){return [{classList:classList(faceClasses)},{classList:classList(panelClasses)}];},
      classes,faceClasses,panelClasses};
  };
  const hand=makeNode('hand','S7'),build=makeNode('table','b1'),loose=makeNode('table','l1');
  const actions={innerHTML:'old'};
  let inserted=0,removed=0;
  const controls={querySelector:()=>actions,remove(){removed++;}};
  const human={insertAdjacentHTML(){inserted++;}},stats={insertAdjacentHTML(){inserted++;}};
  const felt={querySelector:s=>({'.human-area':human,'.game-stats':stats,'.contextual-controls':controls})[s]||null,
    querySelectorAll:()=>[hand,build,loose]};
  const api=new Function('app','nodes',section('  function syncSelection(','  // Dialog-only interactions')+
    "\nlet pickedCard='S7',pickedTable=new Set(['b1']),modal='',toast='',renderedActionMarkup='old';return {sync:syncSelection,clear:()=>{pickedCard=null;pickedTable.clear();}};")
    ({querySelector:()=>felt},[hand,build,loose]);
  assert.ok(api.sync('<section/>','new'));
  assert.ok(hand.classes.has('selected'));assert.ok(build.faceClasses.has('card-selected'));
  assert.ok(build.panelClasses.has('card-selected'));assert.equal(loose.classes.size,0);
  assert.equal(actions.innerHTML,'new');assert.equal(inserted,0);
  const count=calls.length;api.sync('<section/>','new');assert.equal(calls.length,count);
  api.clear();api.sync('','');assert.equal(removed,1);assert.equal(hand.classes.size,0);
});
test('Dialog changes preserve the live board and existing modal shell',()=>{
  const actions={querySelector:()=>({})};
  const shell={classList:{toggle(){}},querySelector:()=>actions};
  const panel={innerHTML:'old',setAttribute(k,v){this.label=v;}};
  let removed=0,inserted=0;
  const overlay={querySelector:()=>panel,remove(){removed++;}};
  const host={querySelector:s=>s==='.shell'?shell:overlay,insertAdjacentHTML(){inserted++;}};
  const api=new Function('app','document',section('  function syncGameOverlay(','  function render(mode')+
    "\nlet modal='menu',prefs={undo:true,animations:true};const renderDialogBody=()=>'<p>menu</p>',restoreVariationsScroll=()=>{};return {sync:syncGameOverlay,close:()=>modal=''};")(host,{});
  assert.ok(api.sync());assert.equal(panel.label,'menu');assert.equal(panel.innerHTML,'<p>menu</p>');assert.equal(inserted,0);
  api.close();assert.ok(api.sync());assert.equal(removed,1);
});
test('Duplicate saves are skipped, but every committed move and undo checkpoint are saved',()=>{
  let writes=0,fail=false;
  const storage={setItem(){writes++;if(fail)throw Error('quota');}};
  const code=section('  let persistedGame=','  function me()');
  const api=new Function('localStorage',code+
    "\nlet game={moveNumber:0},checkpoint=null,hasSavedMatch=false,STORE='game';return {save:persist,move:()=>game.moveNumber++,checkpoint:v=>checkpoint=v,replace:()=>game={moveNumber:0}};")(storage);
  api.save();api.save();assert.equal(writes,1);
  api.move();api.save();api.save();assert.equal(writes,2);
  api.checkpoint('old');api.save();assert.equal(writes,3);
  api.replace();fail=true;api.save();fail=false;api.save();api.save();assert.equal(writes,5);
});
test('Cancelling motion cancels descendant animations and clears pending deal references',()=>{
  let cancelled=0,removed=0;
  const node={getAnimations(opts){assert.equal(opts.subtree,true);return [{cancel(){cancelled++;}},{cancel(){cancelled++;}}];},remove(){removed++;}};
  const api=new Function('document',section('  function cancelMotion()','  function takeMotionSnapshot')+
    "\nlet motionGeneration=1,turnInMotion=true,pendingDeal={},pendingStockOrigin={},dealAnimation=null;return {cancel:cancelMotion,state:()=>({motionGeneration,turnInMotion,pendingDeal,pendingStockOrigin,dealAnimation})};")({querySelectorAll:()=>[node]});
  api.cancel();assert.equal(cancelled,2);assert.equal(removed,1);
  const state=api.state();assert.equal(state.motionGeneration,2);assert.equal(state.turnInMotion,false);
  assert.equal(state.pendingDeal,null);assert.equal(state.pendingStockOrigin,null);assert.ok(state.dealAnimation instanceof Promise);
});
test('Offline cache uses four canonical asset keys and skips unknown non-navigation requests',()=>{
  assert.match(sw,/const ASSETS = \['\.\/index\.html', '\.\/manifest\.webmanifest', '\.\/icon\.svg', '\.\/version\.json'\]/);
  assert.match(sw,/assetKeys\.set\(scope\.pathname,home\)/);
  assert.match(sw,/const key=assetKeys\.get\(url\.pathname\)/);
  assert.match(sw,/if\(!key&&request\.mode!=='navigate'\)return/);
  assert.match(sw,/cache\.put\(key,copy\)/);
  assert.doesNotMatch(sw,/cache\.put\(request/);
});
test('Partition fast paths preserve exact original ordering and reject only impossible totals',()=>{
  const cards=[2,3,1,4].map((v,i)=>({card:{id:String(i)},v}));
  assert.deepEqual(E.findPartition(cards,5,'multiple'),[[cards[0].card,cards[1].card],[cards[2].card,cards[3].card]]);
  assert.deepEqual(E.findPartition(cards,10,'single'),[cards.map(c=>c.card)]);
  assert.equal(E.findPartition(cards,6,'any'),null);
  assert.equal(E.findPartition(cards,10,'multiple'),null);
});

test('Rapid selection restarts movement from the displayed position, not an old translation',()=>{
  let offset=0,cancels=0,reads=0;
  const flights=[];
  const node={dataset:{action:'table',id:'t1'},classList:{contains:k=>k==='table-item'},
    getBoundingClientRect(){reads++;return {left:100+offset,top:100,width:50,height:70};},
    animate(frames,options){
      flights.push({frames,options});
      offset=Number(frames[0].translate.split('px')[0]);
      return {cancel(){cancels++;offset=0;}};
    }};
  const host={querySelectorAll:s=>s.includes('data-action')?[node]:[]};
  const helper=section('  function animateLayout(','  // Dealt cards');
  const slide=new Function('app','motionAllowed',helper+';return animateLayout;')(host,()=>true);
  slide(new Map([['table:t1',{x:200,y:135}]]));
  assert.equal(flights[0].frames[0].translate,'75px 0px');
  offset=30;
  slide(new Map([['table:t1',{x:155,y:135}]]));
  assert.equal(cancels,1);
  assert.equal(flights[1].frames[0].translate,'30px 0px');
  assert.equal(reads,2);
});
test('Modal layer stays above the highest moving capture card',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../src/compact.css'),'utf8');
  assert.match(css,/\.overlay\s*\{z-index:1100;\}/);
  assert.match(app,/i===0 \? 1000 : 105\+i/);
});
test('The failed-subproblem cache is explicitly bounded',()=>{
  const engine=fs.readFileSync(path.join(__dirname,'../src/engine.js'),'utf8');
  assert.match(engine,/if\(!result&&failed\.size<4096\)failed\.add\(key\)/);
});
