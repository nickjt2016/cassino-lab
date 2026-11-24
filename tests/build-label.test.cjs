const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

const card = (suit, rank) => ({ id:suit+rank, suit, rank });
function stateWith(rules, hand, table) {
  const state = E.makeState(rules);
  state.turn = 0;
  state.players[0].hand = hand;
  state.table = table;
  return state;
}
const loose = (id, card) => ({id, type:'loose', card});
const royal = E.rulesFor('royal', {royalAces:true, royalBigLittle:true});

test('Ace plus 9 while holding 10 displays Build 10, never Build A (10)', () => {
  const state=stateWith(royal,[card('S',1),card('C',10)],[loose('l',card('H',9))]);
  const options=E.legalBuildOptions(state,'S1',['l']);
  assert.ok(options.some(o=>o.label==='Build 10' && o.value===10));
  assert.ok(options.every(o=>E.validateAction(state,o).ok));
});

test('Multiple build displays only its target, not the played Ace', () => {
  const state=stateWith(royal,[card('S',1),card('C',10)],[
    loose('nine',card('H',9)),loose('ten',card('D',10))
  ]);
  const options=E.legalBuildOptions(state,'S1',['nine','ten']);
  assert.ok(options.some(o=>o.label==='Multiple Build 10' && o.value===10));
});

test('Queen plus 2 can build 14 and the button says Build 14', () => {
  const state=stateWith(royal,[card('H',12),card('C',1)],[loose('two',card('D',2))]);
  const options=E.legalBuildOptions(state,'H12',['two']);
  assert.ok(options.some(o=>o.label==='Build 14' && o.value===14));
});

test('Every numerical target is displayed as a number for all build types', () => {
  for (const rules of [E.rulesFor(), royal]) {
    for (const value of Array.from({length:16},(_,i)=>i+1)) {
      for (const rank of [1,2,10,11,12,13]) {
        for (const [operation,kind,prefix] of [
          ['create','single','Build'],['create','multiple','Multiple Build'],
          ['extend','multiple','Multiple Build'],['raise','single','Raise to']
        ]) {
          assert.equal(E.buildActionLabel(card('S',rank),value,{operation,kind},rules),prefix+' '+value);
        }
      }
    }
  }
});

test('Raise uses the resulting numeric total rather than rank', () => {
  const state=stateWith(royal,[card('S',1),card('C',10)],[
    {id:'build9',type:'build',owner:0,value:9,groups:[[card('D',2),card('H',7)]]}
  ]);
  const raise=E.legalBuildOptions(state,'S1',['build9']).find(o=>o.mode==='raise'&&o.value===10);
  assert.ok(raise);
  assert.equal(raise.label,'Raise to 10');
  assert.equal(E.buildActionLabel(card('S',1),12,{operation:'raise',kind:'single'},royal),'Raise to 12');
});

test('Classic face cards remain non-numerical and cannot form builds', () => {
  const state=stateWith(E.rulesFor(),[card('S',11),card('C',11)],[loose('jack',card('H',11))]);
  assert.equal(E.cardValues(card('S',11),state.rules).length,0);
  assert.equal(E.legalBuildOptions(state,'S11',['jack']).length,0);
});
