const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const seeded = seed => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const card = id => ({ id, suit:id[0], rank:Number(id.slice(1)) });
const loose = (id, value) => ({id, type:'loose', card:card(value)});
const build = (id, owner, value, cards) => ({id, owner, value, type:'build', groups:[cards.map(card)]});
const variants = [
  ['classic', {}], ['royal', {}], ['spade', {}], ['royalSpade', {}],
  ['classic', {drawMode:true}],
  ['royal', {royalAces:true, royalBigLittle:true}],
  ['royal', {royalAces:true, royalBigLittle:true, drawMode:true}],
  ['classic', {buildAnything:true}],
  ['classic', {pirateCaptures:true, pirateBuilds:true, allowTrailWithOwnBuild:true}],
  ['royal', {royalAces:true, royalBigLittle:true, drawMode:true, buildAnything:true,
    pirateCaptures:true, pirateBuilds:true, allowTrailWithOwnBuild:true}],
  ['classic', {sweepPoints:1, sweepCancel:true}],
  ['classic', {builds:false}]
];
function assertDeck(state) {
  const cards = [...state.stock, ...state.players.flatMap(p => [...p.hand,...p.captured]),
    ...state.table.flatMap(E.cardsInElement)];
  assert.equal(cards.length,52);
  assert.equal(new Set(cards.map(c=>c.id)).size,52);
}
for(const [preset, overrides] of variants) {
  test(preset + ' ' + JSON.stringify(overrides) + ': 20 seeded full hands conserve cards and finish', () => {
    for(let seed=1; seed<=20; seed++) {
      const random=seeded(seed);
      const rules=E.rulesFor(preset,{...overrides,difficulty:seed%2?'thoughtful':'casual'});
      let state=E.newMatch(rules,random);
      for(let turn=0; turn<48; turn++) {
        assert.equal(state.phase,'playing');
        assertDeck(state);
        const move=E.chooseComputerMove(state,random);
        const checked=E.validateAction(state,move);
        assert.ok(checked.ok, checked.reason);
        const result=E.applyAction(state,move);
        assert.ok(result.ok,result.reason);
      }
      assert.equal(state.moveNumber,48);
      assert.ok(state.phase==='roundOver'||state.phase==='gameOver');
      if(state.lastCapture!==null) assertDeck(state);
      assert.equal(state.stock.length,0);
      assert.equal(state.players[0].hand.length+state.players[1].hand.length,0);
      if(state.phase==='roundOver') {
        const next=E.nextHand(state,random);
        assert.equal(next.dealer,1-state.dealer);
        assert.deepEqual(next.players.map(p=>p.score),state.players.map(p=>p.score));
        assertDeck(next);
      }
    }
  });
}
test('Build To Anything does not trap a player without the matching card', () => {
  const state=E.makeState(E.rulesFor('classic',{buildAnything:true}));
  state.players[0].hand=[card('D10'),card('S1'),card('S11')];
  state.table=[build('b',0,9,['S3','H6']),loose('l','H1')];
  assert.ok(E.validateAction(state,{kind:'trail',cardId:'D10',targetIds:[]}).ok);
  assert.ok(E.validateAction(state,{kind:'capture',cardId:'S1',targetIds:['l']}).ok);
  assert.ok(E.allComputerMoves(state).length>0);
});
test('Build To Anything preserves ordinary restrictions when the owner can capture', () => {
  const state=E.makeState(E.rulesFor('classic',{buildAnything:true}));
  state.players[0].hand=[card('D9'),card('S1')];
  state.table=[build('b',0,9,['S3','H6']),loose('l','H1')];
  assert.equal(E.validateAction(state,{kind:'trail',cardId:'S1',targetIds:[]}).ok,false);
  assert.equal(E.validateAction(state,{kind:'capture',cardId:'S1',targetIds:['l']}).ok,false);
  assert.ok(E.validateAction(state,{kind:'capture',cardId:'D9',targetIds:['b']}).ok);
});
test('Royal alternate values produce captures using one value, not mixed groups', () => {
  const state=E.makeState(E.rulesFor('royal',{royalAces:true}));
  state.players[0].hand=[card('S1')];
  state.table=[loose('one','H1'),loose('seven','D7'),loose('seven2','C7')];
  const moves=E.captureChoices(state,state.players[0].hand[0]);
  assert.ok(moves.some(m=>m.targetIds.length===1&&m.targetIds[0]==='one'));
  assert.ok(moves.some(m=>m.targetIds.length===2&&m.targetIds.includes('seven')&&m.targetIds.includes('seven2')));
  assert.ok(moves.every(m=>E.validateAction(state,m).ok));
  assert.equal(new Set(moves.map(m=>m.targetIds.join(','))).size,moves.length);
});
test('Reject invalid moves without changing state', () => {
  const state=E.newMatch(E.rulesFor(),seeded(27));
  const previous=JSON.stringify(state);
  const result=E.applyAction(state,{kind:'capture',cardId:'missing',targetIds:[]});
  assert.equal(result.ok,false);
  assert.equal(JSON.stringify(state),previous);
});
