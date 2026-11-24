const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../src/engine.js');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const slice=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)+start.length));
const card=id=>({id,suit:id[0],rank:Number(id.slice(1))});
function fixture(difficulty='casual'){
  return {phase:'playing',turn:0,rules:E.rulesFor('classic',{difficulty}),
    players:[{hand:[card('H8'),card('S4')],captured:[]},{hand:[card('C6')],captured:[]}],
    table:[{id:1,type:'loose',card:card('D8')},{id:2,type:'loose',card:card('C4')}],stock:[]};
}
function harness(state,choose=null){
  return new Function('E','game',`
    let pickedCard=null,pickedTable=new Set(),suggestedMove=null,toast='',renders=0;
    let prefs={undo:true},checkpoint='saved';
    const isHumanTurn=()=>game.phase==='playing'&&game.turn===0;
    const currentSelection=()=>[...pickedTable];
    const escapeHtml=String,render=()=>renders++;
    ${slice('  function suggestedAction(', '  function renderHome(')}
    ${slice('  function resetSelection()', '  function botTurn()')}
    return {suggest:suggestMove,match:suggestedAction,button:actionButton,toolbar:renderToolbar,
      undoPref:v=>prefs.undo=v,checkpoint:v=>checkpoint=v,clear:resetSelection,
      state:()=>({pickedCard,targets:[...pickedTable],suggestedMove,toast,renders})};
  `)(choose?{...E,chooseHintMove:choose}:E,state);
}
test('Hint picks the same best legal candidate independently of difficulty and randomness',()=>{
  const easy=fixture('casual'),medium=fixture('thoughtful');
  const before=JSON.stringify(easy);
  const first=E.chooseHintMove(easy);
  assert.equal(first.kind,'capture');
  assert.ok(E.validateAction(easy,first).ok);
  assert.deepEqual(first,E.chooseHintMove(easy));
  assert.deepEqual(first,E.chooseHintMove(medium));
  assert.equal(JSON.stringify(easy),before);
});
test('Hint selects the suggested cards and highlights the actual action without playing it',()=>{
  const state=fixture(),before=JSON.stringify(state),h=harness(state);
  h.suggest();
  const hint=h.state();
  assert.equal(hint.pickedCard,hint.suggestedMove.cardId);
  assert.deepEqual(hint.targets,hint.suggestedMove.targetIds);
  assert.equal(h.match('capture'),true);
  assert.match(h.button('capture','Capture cards'),/hint-recommended/);
  assert.doesNotMatch(h.button('trail','Trail'),/hint-recommended/);
  assert.equal(JSON.stringify(state),before);
  h.clear();
  assert.equal(h.match('capture'),false);
});
test('Build hint distinguishes two otherwise legal build buttons',()=>{
  const state=fixture();
  state.players[0].hand=[card('H2'),card('C6'),card('S3')];
  state.table=[{id:1,type:'loose',card:card('D4')}];
  const move=E.legalBuildOptions(state,'H2',[1])[0];
  assert.ok(move);
  const h=harness(state,()=>move);h.suggest();
  assert.equal(h.state().suggestedMove.value,6);
  assert.match(h.button('build',move.label,move,0),/hint-recommended/);
  assert.doesNotMatch(h.button('build','Build 7',{...move,value:7},1),/hint-recommended/);
  assert.doesNotMatch(h.button('build','Other mode',{...move,mode:'different'},2),/hint-recommended/);
});
test('Hint is inactive outside the human turn and invalid suggestions are rejected',()=>{
  const state=fixture();state.turn=1;
  const h=harness(state);h.suggest();assert.equal(h.state().renders,0);
  state.turn=0;
  const bad=harness(state,()=>({kind:'trail',cardId:'nonexistent',targetIds:[]}));
  bad.suggest();assert.equal(bad.state().suggestedMove,null);
  assert.ok(bad.state().toast);
});
test('Toolbar obeys persistent Undo preference and disables unavailable actions',()=>{
  const h=harness(fixture());
  assert.match(h.toolbar(true),/data-action="undo"/);
  h.undoPref(false);
  assert.doesNotMatch(h.toolbar(true),/data-action="undo"/);
  assert.match(h.toolbar(false),/data-action="hint"[^>]*disabled/);
  h.undoPref(true);h.checkpoint(null);
  assert.match(h.toolbar(true),/data-action="undo"[^>]*disabled/);
  assert.match(app,/if \(action === 'toggle-undo'\) \{ prefs\.undo = !prefs\.undo; savePrefs\(\)/);
  assert.match(app,/if \(!prefs\.undo \|\| !checkpoint \|\| screen !== 'game'\) return;/);
  assert.match(app,/&& !modal && prefs\.undo && checkpoint\) undo\(\)/);
});
