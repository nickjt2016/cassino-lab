
const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../src/engine.js');
const card=id=>({id,suit:id[0],rank:Number(id.slice(1))});
const loose=(id,c)=>({id,type:'loose',card:card(c)});
const build=(id,owner,value,...groups)=>({id,type:'build',owner,value,groups:groups.map(group=>group.map(card))});
const fixture=(hand,table,overrides={})=>{
  const state=E.makeState(E.rulesFor('royal',{pirateBuilds:true,pirateCaptures:true,allowTrailWithOwnBuild:true,...overrides}));
  state.turn=0; state.players[0].hand=hand.map(card); state.table=table;
  return state;
};
const new13={kind:'build',cardId:'S7',targetIds:['six'],value:13,mode:'single'};
const screenshotTable=()=>[build('old',0,13,['D1','D11','H1']),loose('six','D6')];
test('Screenshot: one King cannot support two independent builds of 13',()=>{
  const state=fixture(['S7','H13','D3','S4'],screenshotTable());
  const before=JSON.stringify(state);
  const check=E.validateAction(state,new13);
  assert.equal(check.ok,false);
  assert.match(check.reason,/Each independent build needs its own/);
  assert.equal(E.legalBuildOptions(state,'S7',['six']).some(m=>m.value===13),false);
  assert.equal(E.applyAction(state,new13).ok,false);
  assert.equal(JSON.stringify(state),before);
  assert.equal(E.allComputerMoves(state,Infinity).some(m=>m.kind==='build'&&m.cardId==='S7'&&m.value===13&&m.targetIds.length===1&&m.targetIds.includes('six')),false);
  assert.equal([...E.hintSelections(state)].some(m=>m.cardId==='S7'&&m.targetIds.length===1&&m.targetIds.includes('six')),false);
});
test('Two distinct Kings allow the second independent build',()=>{
  const state=fixture(['S7','H13','C13','S4'],screenshotTable());
  assert.ok(E.validateAction(state,new13).ok);
  assert.ok(E.legalBuildOptions(state,'S7',['six']).some(m=>m.label==='Build 13'));
  assert.ok([...E.hintSelections(state)].some(m=>m.cardId==='S7'&&m.targetIds.length===1&&m.targetIds.includes('six')));
  assert.ok(E.applyAction(state,new13).ok);
  assert.equal(state.table.filter(e=>e.type==='build'&&e.owner===0).length,2);
});
test('One King permits extending the existing 13 into a multiple build',()=>{
  const state=fixture(['S7','H13','D3','S4'],screenshotTable());
  const extend={...new13,targetIds:['old','six'],mode:'extend'};
  assert.ok(E.validateAction(state,extend).ok);
  assert.ok(E.legalBuildOptions(state,'S7',['old','six']).some(m=>m.label==='Multiple Build 13'));
  assert.ok(E.applyAction(state,extend).ok);
  const own=state.table.filter(e=>e.type==='build'&&e.owner===0);
  assert.equal(own.length,1);assert.equal(own[0].groups.length,2);
  state.turn=0;
  assert.ok(E.validateAction(state,{kind:'capture',cardId:'H13',targetIds:[own[0].id]}).ok);
});
test('A reserved King cannot be spent trailing or capturing unrelated loose cards',()=>{
  const state=fixture(['H13','C13','D3','S4'],[
    build('first',0,13,['H6','C7']),build('second',0,13,['D5','S8']),loose('king','D13')
  ]);
  assert.equal(E.validateAction(state,{kind:'trail',cardId:'H13',targetIds:[]}).ok,false);
  assert.equal(E.validateAction(state,{kind:'capture',cardId:'H13',targetIds:['king']}).ok,false);
  assert.ok(E.validateAction(state,{kind:'capture',cardId:'H13',targetIds:['first']}).ok);
  assert.ok(E.validateAction(state,{kind:'capture',cardId:'H13',targetIds:['first','second']}).ok);
  assert.ok(E.validateAction(state,{kind:'trail',cardId:'D3',targetIds:[]}).ok);
});
test('Alternate values do not let one physical Ace cover two different obligations',()=>{
  // The sole Ace in the hand has both 1 and 14. Neither the 7 nor the 8
  // can reserve 1 or 14; the proposed second build would reuse the Ace.
  const state=fixture(['S1','H7','D8','C3'],[
    build('one',0,1,['D1']),loose('seven','C7')
  ],{royalAces:true});
  const action={kind:'build',cardId:'H7',targetIds:['seven'],value:14,mode:'single'};
  assert.equal(E.validateAction(state,action).ok,false);
  state.players[0].hand[3]=card('H1');
  assert.ok(E.validateAction(state,action).ok);
});
test('Distinct matching is required for each owner, not for the other player',()=>{
  const state=fixture(['S7','H13','D3','S4'],[build('other',1,13,['D1','D11','H1']),loose('six','D6')]);
  assert.ok(E.validateAction(state,new13).ok);
  state.turn=1;state.players[1].hand=['H7','D13','C3','C4'].map(card);
  state.table=[build('old',1,13,['D1','D11','H1']),loose('six','D6')];
  assert.equal(E.validateAction(state,{...new13,cardId:'H7'}).ok,false);
});
test('Raising a build replaces its old obligation rather than adding another',()=>{
  const state=fixture(['S1','C10','D3','S4'],[build('nine',0,9,['C4','H5'])]);
  assert.ok(E.validateAction(state,{kind:'build',cardId:'S1',targetIds:['nine'],value:10,mode:'raise'}).ok);
});
test('Pirate Builds and Build To Anything retain their explicit meanings',()=>{
  const normal=fixture(['S7','H13','C13','S4'],screenshotTable(),{pirateBuilds:false});
  assert.equal(E.validateAction(normal,new13).ok,false);
  const anything=fixture(['S7','H13','D3','S4'],screenshotTable(),{buildAnything:true});
  assert.ok(E.validateAction(anything,new13).ok);
});
