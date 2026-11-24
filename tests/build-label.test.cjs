const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

function card(suit, rank) {
  return { id: suit + rank, suit, rank };
}

test('raising 2 + 7 = 9 using an Ace while retaining 10 says Raise to 10', () => {
  const rules = E.rulesFor('royal', { royalAces: true });
  const state = E.makeState(rules);
  state.turn = 0;
  state.players[0].hand = [card('S', 1), card('C', 10)];
  state.table = [{
    id: 'build9', type: 'build', owner: 0, value: 9,
    groups: [[card('D', 2), card('H', 7)]]
  }];

  const options = E.legalBuildOptions(state, 'S1', ['build9']);
  const raise = options.find(option => option.value === 10 && option.mode === 'raise');
  assert.ok(raise, 'Ace (1) can legally raise the 9-build to 10');
  assert.equal(raise.label, 'Raise to 10');
  assert.equal(E.validateAction(state, raise).ok, true);
});

test('Royal build creation still identifies a played royal card and target', () => {
  const rules = E.rulesFor('royal', { royalAces: true });
  assert.equal(
    E.buildActionLabel(card('H', 12), 14, { operation: 'create', kind: 'single' }, rules),
    'Build Q (14)'
  );
  assert.equal(
    E.buildActionLabel(card('S', 1), 14, { operation: 'extend', kind: 'multiple' }, rules),
    'Multiple Build A (14)'
  );
  assert.equal(
    E.buildActionLabel(card('S', 1), 1, { operation: 'create', kind: 'single' }, rules),
    'Build A (1)'
  );
});

test('raising to a royal face value uses the destination rank instead of the played rank', () => {
  const rules = E.rulesFor('royal', { royalAces: true });
  assert.equal(
    E.buildActionLabel(card('S', 1), 12, { operation: 'raise', kind: 'single' }, rules),
    'Raise to Q (12)'
  );
});
