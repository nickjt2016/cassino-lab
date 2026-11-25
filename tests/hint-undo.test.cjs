const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../src/engine.js');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../src/compact.css'),'utf8');
const slice=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)+start.length));
const card=id=>({id,suit:id[0],rank:Number(id.slice(1))});
const loose=(id,c)=>({id,type:'loose',card:card(c)});
function fixture(difficulty='casual'){
  return {phase:'playing',turn:0,rules:E.rulesFor('classic',{difficulty}),
    players:[{hand:[card('H8'),card('S4')],captured:[]},{hand:[card('C6')],captured:[]}],
    table:[loose('t1','D8'),loose('t2','C4')],stock:[]};
}
const key=(cardId,ids)=>JSON.stringify([cardId,[...ids].sort()]);
const moveKey=m=>key(m.cardId,m.targetIds||[]);
function oracle(state){
  const moves=new Set();
  for(const card of state.players[state.turn].hand){
    const n=state.table.length;
    for(let bits=0;bits<2**n;bits++){
      const ids=state.table.filter((_,i)=>bits&(1<<i)).map(e=>e.id);
      const capture={kind:ids.length?'capture':'trail',cardId:card.id,targetIds:ids};
      if(E.validateAction(state,capture).ok||E.legalBuildOptions(state,card.id,ids).length)
        moves.add(key(card.id,ids));
    }
  }
  return [...moves].sort();
}
function harness(state,choose=null){
  return new Function('E','game',`
    let pickedCard=null,pickedTable=new Set(),hintIterator=null,toast='',renders=0;
    let prefs={undo:true},checkpoint='saved';
    const isHumanTurn=()=>game.phase==='playing'&&game.turn===0;
    const escapeHtml=String,render=()=>renders++;
    ${slice('  function actionButton(', '  function renderHome(')}
    ${slice('  function resetSelection()', '  function botTurn()')}
    return {suggest:suggestMove,button:actionButton,toolbar:renderToolbar,
      undoPref:v=>prefs.undo=v,checkpoint:v=>checkpoint=v,clear:resetSelection,
      state:()=>({pickedCard,targets:[...pickedTable],toast,renders})};
  `)(choose?{...E,hintSelections:choose}:E,state);
}
test('Hints cycle captures, builds and trails, then wrap without mutating state',()=>{
  const state=fixture(),before=JSON.stringify(state),h=harness(state);
  const expected=[...E.hintSelections(state)];
  assert.ok(expected.length>=4);
  const firstTrail=expected.findIndex(m=>m.kind==='trail');
  assert.ok(firstTrail>0);
  assert.ok(expected.slice(firstTrail).every(m=>m.kind==='trail'));
  for(const move of [...expected,expected[0]]){
    h.suggest();const picked=h.state();
    assert.equal(key(picked.pickedCard,picked.targets),moveKey(move));
    assert.ok(E.validateAction(state,move).ok);
  }
  assert.deepEqual([...E.hintSelections(fixture('thoughtful'))],expected);
  assert.equal(JSON.stringify(state),before);
  h.clear();h.suggest();assert.equal(key(h.state().pickedCard,h.state().targets),moveKey(expected[0]));
});
test('Hints use exactly the same action button markup as a manual selection',()=>{
  const h=harness(fixture());
  const before=h.button('capture','Capture cards');
  h.suggest();
  assert.equal(h.button('capture','Capture cards'),before);
  assert.doesNotMatch(before,/hint-recommended|Suggested move:|✧/);
  assert.doesNotMatch(css,/hint-recommended/);
  assert.doesNotMatch(app,/suggestedAction|suggestedMove/);
});
test('Every legal visible selection is covered, including more than three loose build cards',()=>{
  const state=fixture();
  state.rules=E.rulesFor('royal',{royalAces:true,royalBigLittle:true,buildAnything:true,pirateBuilds:true,pirateCaptures:true,allowTrailWithOwnBuild:true});
  state.players[0].hand=[card('S1'),card('H10'),card('C12')];
  state.table=[loose('a','H1'),loose('b','D2'),loose('c','C3'),loose('d','D4'),loose('e','S5'),
    {id:'f',type:'build',owner:1,value:5,groups:[[card('H2'),card('H3')]]}];
  const actual=[...E.hintSelections(state)];
  assert.ok(actual.some(m=>m.kind==='build'&&m.targetIds.length>3));
  assert.deepEqual(actual.map(moveKey).sort(),oracle(state));
  assert.equal(new Set(actual.map(moveKey)).size,actual.length);
  assert.ok(actual.every(m=>E.validateAction(state,m).ok));
});
test('Multiple action buttons sharing the same card selection are represented once',()=>{
  const state=fixture();
  state.rules=E.rulesFor('royal',{royalAces:true,buildAnything:true});
  state.players[0].hand=[card('S1'),card('H10'),card('D1')];
  state.table=[loose('a','H1')];
  assert.ok(E.legalBuildOptions(state,'S1',['a']).length>=2);
  assert.equal([...E.hintSelections(state)].filter(m=>m.cardId==='S1'&&m.targetIds.join()==='a').length,1);
  assert.deepEqual([...E.hintSelections(state)].map(moveKey).sort(),oracle(state));
});
test('Hint is inactive outside the human turn and invalid suggestions are rejected',()=>{
  const state=fixture();state.turn=1;
  const h=harness(state);h.suggest();assert.equal(h.state().renders,0);
  state.turn=0;
  const bad=harness(state,function*(){yield {kind:'trail',cardId:'nonexistent',targetIds:[]};});
  bad.suggest();assert.equal(bad.state().pickedCard,null);assert.ok(bad.state().toast);
});
test('Toolbar obeys persistent Undo preference and disables unavailable actions',()=>{
  const h=harness(fixture());
  assert.match(h.toolbar(true),/data-action="undo"/);
  h.undoPref(false);assert.doesNotMatch(h.toolbar(true),/data-action="undo"/);
  assert.match(h.toolbar(false),/data-action="hint"[^>]*disabled/);
  h.undoPref(true);h.checkpoint(null);
  assert.match(h.toolbar(true),/data-action="undo"[^>]*disabled/);
  assert.match(app,/if \(action === 'toggle-undo'\) \{ prefs\.undo = !prefs\.undo; savePrefs\(\)/);
  assert.match(app,/if \(!prefs\.undo \|\| !checkpoint \|\| screen !== 'game'\) return;/);
  assert.match(app,/&& !modal && prefs\.undo && checkpoint\) undo\(\)/);
});
