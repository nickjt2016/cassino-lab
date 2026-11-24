/* Cassino Lab — dependency-free, deterministic rules engine.
   This file is shared by the browser and the Node.js test suite. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CassinoEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SUITS = ['S', 'H', 'D', 'C'];
  const DEFAULT_RULES = Object.freeze({
    name: 'Classic Cassino', royal: false, spadeScoring: false,
    sweepPoints: 0, builds: true, multipleBuilds: true,
    allowTrailWithOwnBuild: false, drawMode: false, sweepCancel: false,
    royalAces: false, royalBigLittle: false, pirateCaptures: false,
    pirateBuilds: false, buildAnything: false, winningScore: 21, difficulty: 'thoughtful'
  });
  const PRESETS = Object.freeze({
    classic: { name: 'Classic Cassino', royal: false, spadeScoring: false, sweepPoints: 0, builds: true, multipleBuilds: true, allowTrailWithOwnBuild: false, winningScore: 21 },
    royal: { name: 'Royal Cassino', royal: true, spadeScoring: false, sweepPoints: 0, builds: true, multipleBuilds: true, allowTrailWithOwnBuild: false, winningScore: 21 },
    spade: { name: 'Spade Cassino', royal: false, spadeScoring: true, sweepPoints: 0, builds: true, multipleBuilds: true, allowTrailWithOwnBuild: false, winningScore: 61 },
    royalSpade: { name: 'Royal Spade', royal: true, spadeScoring: true, sweepPoints: 0, builds: true, multipleBuilds: true, allowTrailWithOwnBuild: false, winningScore: 61 }
  });

  function rulesFor(preset = 'classic', overrides = {}) {
    return { ...DEFAULT_RULES, ...(PRESETS[preset] || PRESETS.classic), ...overrides };
  }
  function cardName(card) {
    return `${({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' })[card.rank] || card.rank}${({ S: '♠', H: '♥', D: '♦', C: '♣' })[card.suit]}`;
  }
  function cardValue(card, rules) {
    return card.rank <= 10 || rules.royal ? card.rank : null;
  }
  // A few established/house variants let certain cards play at two values.
  // Keep both possibilities until a move commits to a legal total.
  function cardValues(card, rules) {
    const base = cardValue(card, rules);
    if (base === null) return [];
    const values = [base];
    if (rules.royalAces && card.rank === 1) values.push(14);
    if (rules.royalBigLittle && card.id === 'S2') values.push(15);
    if (rules.royalBigLittle && card.id === 'D10') values.push(16);
    return values;
  }
  function maxBuildValue(rules) {
    return rules.royalBigLittle ? 16 : rules.royalAces ? 14 : rules.royal ? 13 : 10;
  }
  function hasValue(hand, value, rules) {
    return hand.some(c => cardValues(c, rules).includes(value));
  }
  function findValuePartition(cards, target, desired, rules) {
    // Enumerate alternative card values only for the few special cards; ordinary
    // hands take the same fast path as classic Cassino.
    const possible = cards.map(x => cardValues(x.card, rules));
    if (possible.some(vals => !vals.length)) return null;
    const choose = (i, chosen) => {
      if (i === cards.length) return findPartition(chosen, target, desired);
      for (const v of possible[i]) {
        if (v > target) continue;
        const result = choose(i + 1, [...chosen, {card:cards[i].card, v}]);
        if (result) return result;
      }
      return null;
    };
    return choose(0, []);
  }
  function makeDeck() {
    return SUITS.flatMap(suit => Array.from({ length: 13 }, (_, i) => ({
      id: suit + (i + 1), suit, rank: i + 1
    })));
  }
  function shuffle(array, random = Math.random) {
    const deck = [...array];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }
  function makeState(rules = rulesFor(), dealer = 1, scores = [0, 0], round = 1, random = Math.random) {
    const state = {
      rules: { ...rules }, players: [
        { name: 'You', hand: [], captured: [], sweeps: 0, score: scores[0] },
        { name: 'Computer', hand: [], captured: [], sweeps: 0, score: scores[1] }
      ], table: [], stock: shuffle(makeDeck(), random),
      dealer, turn: 1 - dealer, lastCapture: null, nextId: 1,
      round, phase: 'playing', result: null, lastAction: 'New hand dealt.',
      log: [], moveNumber: 0
    };
    drawCards(state, true);
    return state;
  }
  function newMatch(rules = rulesFor(), random = Math.random) {
    return makeState(rules, 1, [0, 0], 1, random);
  }
  function drawCards(state, initial = false) {
    if (initial) {
      for (let i = 0; i < 4; i++) state.table.push({
        id: `t${state.nextId++}`, type: 'loose', card: state.stock.pop()
      });
    }
    // Two-player: every deal after the first contains exactly four cards each.
    for (let i = 0; i < 4; i++) {
      state.players[0].hand.push(state.stock.pop());
      state.players[1].hand.push(state.stock.pop());
    }
  }
  function cardsInElement(element) {
    return element.type === 'loose' ? [element.card] : element.groups.flat();
  }
  function findPartition(cards, target, desired = 'any') {
    if (!cards.length || !Number.isInteger(target) || target < 1) return null;
    const values = cards.map(c => c.v);
    if (values.some(v => !Number.isInteger(v) || v < 1 || v > target)) return null;
    // First unchecked card always starts the next group, so each partition is found once.
    const walk = (remaining, groups) => {
      if (!remaining.length) {
        if (desired === 'single' && groups.length !== 1) return null;
        if (desired === 'multiple' && groups.length < 2) return null;
        return groups;
      }
      const [first, ...rest] = remaining;
      const choose = (offset, need, selected, leftovers) => {
        if (need === 0) {
          const result = walk(leftovers.concat(rest.slice(offset)), [...groups, [first, ...selected]]);
          if (result) return result;
          return null;
        }
        for (let i = offset; i < rest.length; i++) {
          if (rest[i].v > need) continue;
          const skipped = leftovers.concat(rest.slice(offset, i));
          const result = choose(i + 1, need - rest[i].v, [...selected, rest[i]], skipped);
          if (result) return result;
        }
        return null;
      };
      return choose(0, target - first.v, [], []);
    };
    const partition = walk(cards.map((card, i) => ({ ...card, v: values[i] })), []);
    return partition && partition.map(group => group.map(x => x.card));
  }
  function ownBuildObligation(state, table, hand, player) {
    for (const element of table) {
      if (element.type === 'build' && element.owner === player && !state.rules.buildAnything && !hasValue(hand, element.value, state.rules)) {
        return `You must retain a ${element.value} to capture your existing build.`;
      }
    }
    return null;
  }
  function describeCapture(selection, card, rules) {
    if (!selection.length) return { ok:false, reason:'Select at least one table card to capture.' };
    const playedValues = cardValues(card, rules);
    if (!playedValues.length) {
      if (selection.length !== 1 || selection[0].type !== 'loose' || selection[0].card.rank !== card.rank) {
        return { ok:false, reason:'A face card captures one equal-rank face card unless Royal Face Cards is enabled.' };
      }
      return {ok:true};
    }
    const loose = selection.filter(e => e.type === 'loose').map(e => ({card:e.card}));
    const builds = selection.filter(e => e.type === 'build');
    for (const value of playedValues) {
      if (builds.some(e => e.value !== value)) continue;
      if (loose.length && !findValuePartition(loose, value, 'any', rules)) continue;
      if (builds.length || loose.length) return {ok:true, value};
    }
    return {ok:false, reason:'Selected cards must form matching groups at one legal value (builds must match exactly).'};
  }
  function describeBuild(selection, card, remainingHand, rules, requestedValue, requestedMode) {
    if (!rules.builds) return { ok:false, reason:'Building is disabled.' };
    const playedValues = cardValues(card, rules);
    if (!playedValues.length) return {ok:false,reason:'This card has no numerical build value.'};
    if (!Number.isInteger(requestedValue) || requestedValue < 1 || requestedValue > maxBuildValue(rules)) {
      return {ok:false, reason:'Choose a valid build value.'};
    }
    if (!rules.buildAnything && !hasValue(remainingHand, requestedValue, rules)) {
      return {ok:false,reason:`Keep a ${requestedValue} in hand to capture your build (or enable Build To Anything).`};
    }
    const builds = selection.filter(e => e.type === 'build');
    const loose = selection.filter(e => e.type === 'loose').map(e => ({card:e.card}));
    if (builds.length > 1) return {ok:false,reason:'Separate existing builds cannot be combined.'};
    if (loose.some(x => !cardValues(x.card, rules).length)) {
      return {ok:false,reason:'Face cards need numerical Royal values to form builds.'};
    }
    if (!builds.length) {
      if (!loose.length) return {ok:false,reason:'Select at least one table card to build.'};
      const groups = findValuePartition([{card}, ...loose], requestedValue,
        requestedMode === 'single' ? 'single' : requestedMode === 'multiple' ? 'multiple' : 'any', rules);
      if (!groups) return {ok:false,reason:'Selected cards do not form the requested build.'};
      if (groups.length > 1 && !rules.multipleBuilds) return {ok:false,reason:'Multiple builds are disabled.'};
      return {ok:true,build:{value:requestedValue,groups,kind:groups.length===1?'single':'multiple',operation:'create'}};
    }
    const current = builds[0];
    if (requestedValue === current.value && requestedMode !== 'raise') {
      if (!rules.multipleBuilds) return {ok:false,reason:'Multiple builds are disabled.'};
      const groups = findValuePartition([{card}, ...loose], current.value, 'any', rules);
      if (!groups) return {ok:false,reason:'The additional group must equal the build value.'};
      return {ok:true,build:{value:current.value,groups:current.groups.concat(groups),kind:'multiple',operation:'extend'}};
    }
    if (requestedMode === 'extend') return {ok:false,reason:'Extending preserves the build value.'};
    if (current.groups.length > 1) return {ok:false,reason:'A multiple build cannot be raised.'};
    if (!playedValues.some(v => current.value + v === requestedValue)) {
      return {ok:false,reason:'The card played must raise this build to its new value.'};
    }
    const extraGroups = loose.length ? findValuePartition(loose, requestedValue, 'any', rules) : [];
    if (!extraGroups) return {ok:false,reason:'Loose cards must form extra complete groups when raising.'};
    if (extraGroups.length && !rules.multipleBuilds) return {ok:false,reason:'Multiple builds are disabled.'};
    return {ok:true,build:{value:requestedValue,groups:[current.groups[0].concat(card),...extraGroups],kind:extraGroups.length?'multiple':'single',operation:'raise'}};
  }
  function validateAction(state, action) {
    if (!state || state.phase !== 'playing') return { ok: false, reason: 'This hand has ended.' };
    if (!action || !['capture', 'trail', 'build'].includes(action.kind)) return { ok: false, reason: 'Unknown move.' };
    const player = state.turn;
    const hand = state.players[player].hand;
    const card = hand.find(c => c.id === action.cardId);
    if (!card) return { ok: false, reason: 'Choose a card from your hand.' };
    const selectedIds = action.targetIds || [];
    if (new Set(selectedIds).size !== selectedIds.length) return { ok: false, reason: 'Duplicate table selection.' };
    const selected = selectedIds.map(id => state.table.find(e => e.id === id));
    if (selected.some(x => !x)) return { ok: false, reason: 'That table selection is no longer available.' };
    const remainingHand = hand.filter(c => c.id !== card.id);
    // An owner without a matching card under Build To Anything must not be trapped.
    const own = state.table.filter(e => e.type === 'build' && e.owner === player &&
      (!state.rules.buildAnything || hasValue(hand, e.value, state.rules)));
    const remainingTable = state.table.filter(e => !selectedIds.includes(e.id));
    let outcome;
    if (action.kind === 'trail') {
      if (selected.length) return { ok: false, reason: 'Deselect table cards before trailing.' };
      if (!state.rules.allowTrailWithOwnBuild && own.length) {
        return { ok: false, reason: 'You cannot trail while owning an active build.' };
      }
      outcome = { ok: true };
    } else if (action.kind === 'capture') {
      // The reference app calls these relaxed restrictions Pirate Captures.
      if (own.length && !state.rules.pirateCaptures && !own.some(e => selectedIds.includes(e.id))) {
        return {ok:false,reason:'Capture your own build first, or enable Pirate Captures.'};
      }
      outcome = describeCapture(selected, card, state.rules);
    } else {
      if (own.length && !state.rules.pirateBuilds && !own.some(e => selectedIds.includes(e.id))) {
        return {ok:false,reason:'Finish your current build first, or enable Pirate Builds.'};
      }
      outcome = describeBuild(selected, card, remainingHand, state.rules, action.value, action.mode);
    }
    if (!outcome.ok) return outcome;
    const resultTable = action.kind === 'trail'
      ? [...state.table, { id: 'preview', type: 'loose', card }]
      : action.kind === 'capture' ? remainingTable
      : [...remainingTable, { id: 'preview', type: 'build', value: outcome.build.value, groups: outcome.build.groups, owner: player }];
    const obligation = ownBuildObligation(state, resultTable, remainingHand, player);
    if (obligation) return { ok: false, reason: obligation };
    return { ...outcome, card, selected, remainingTable };
  }
  // Label the resulting stack, never the rank of the card being played.
  // All currently legal builds have numerical targets. If a future rule
  // supports non-numerical face-rank builds, their target can be J, Q or K.
  function buildActionLabel(_card, value, build, _rules) {
    const title = build.operation === 'raise' ? 'Raise to'
      : build.kind === 'multiple' ? 'Multiple Build' : 'Build';
    return `${title} ${value}`;
  }
  function legalBuildOptions(state, cardId, targetIds) {
    if (!state.rules.builds || !cardId) return [];
    const hand = state.players[state.turn].hand;
    const values = state.rules.buildAnything ? Array.from({length:maxBuildValue(state.rules)},(_,i)=>i+1) : [...new Set(hand.filter(c => c.id !== cardId).flatMap(c => cardValues(c, state.rules)))];
    const selection = (targetIds || []).map(id => state.table.find(e => e.id === id));
    const hasBuild = selection.some(e => e && e.type === 'build');
    const possibilities = [];
    for (const value of values) {
      for (const mode of hasBuild ? ['extend', 'raise'] : ['single', 'multiple']) {
        const action = { kind: 'build', cardId, targetIds: targetIds || [], value, mode };
        const check = validateAction(state, action);
        if (check.ok) {
          const label = buildActionLabel(hand.find(c => c.id === cardId), value, check.build, state.rules);
          possibilities.push({...action,label,detail:check.build.kind});
        }
      }
    }
    return possibilities;
  }
  function applyAction(state, action) {
    const checked = validateAction(state, action);
    if (!checked.ok) return { ok: false, reason: checked.reason };
    const playerIndex = state.turn;
    const player = state.players[playerIndex];
    const opponent = state.players[1 - playerIndex];
    player.hand = player.hand.filter(c => c.id !== action.cardId);
    const played = checked.card;
    let description;
    if (action.kind === 'trail') {
      state.table.push({ id: `t${state.nextId++}`, type: 'loose', card: played });
      description = `${player.name} trailed ${cardName(played)}.`;
    } else if (action.kind === 'capture') {
      state.table = checked.remainingTable;
      const won = [played, ...checked.selected.flatMap(cardsInElement)];
      player.captured.push(...won);
      state.lastCapture = playerIndex;
      const swept = state.table.length === 0;
      if (swept) player.sweeps += 1;
      description = `${player.name} captured ${won.length - 1} table card${won.length === 2 ? '' : 's'} with ${cardName(played)}${swept ? ' — sweep!' : '.'}`;
    } else {
      state.table = checked.remainingTable;
      state.table.push({ id: `t${state.nextId++}`, type: 'build', value: checked.build.value, groups: checked.build.groups, owner: playerIndex });
      const op = { create: 'built', raise: 'raised a build to', extend: 'extended a build of' }[checked.build.operation];
      description = `${player.name} ${op} ${checked.build.value} (${checked.build.kind}).`;
    }
    state.moveNumber++;
    state.lastAction = description;
    state.log.push(description);
    if (state.log.length > 35) state.log.shift();
    state.turn = 1 - playerIndex;
    // Draw Cassino: the player who just played immediately replenishes their hand.
    // Ordinary Cassino waits until both four-card hands have been played.
    if (state.rules.drawMode && state.stock.length && player.hand.length < 4) {
      player.hand.push(state.stock.pop());
      state.lastAction += ' Replacement card drawn.';
    }

    if (!player.hand.length && !opponent.hand.length) {
      if (state.stock.length) {
        drawCards(state);
        state.lastAction += ' New cards dealt.';
      } else {
        finishHand(state);
      }
    }
    return { ok: true, description };
  }
  function scoreHand(state) {
    const piles = state.players.map(p => p.captured);
    const counts = piles.map(p => p.length);
    const spades = piles.map(p => p.filter(c => c.suit === 'S').length);
    const rows = [0, 1].map(i => {
      const cards = counts[i] > counts[1 - i] ? 3 : 0;
      const spadesPoints = state.rules.spadeScoring
        ? spades[i] + (piles[i].some(c => c.id === 'S11') ? 1 : 0)
        : (spades[i] > spades[1 - i] ? 1 : 0);
      const big = piles[i].some(c => c.id === 'D10') ? 2 : 0;
      const little = piles[i].some(c => c.id === 'S2') ? 1 : 0;
      const aces = piles[i].filter(c => c.rank === 1).length;
      const netSweeps = state.rules.sweepCancel
        ? Math.max(0, state.players[i].sweeps - state.players[1 - i].sweeps)
        : state.players[i].sweeps;
      const sweeps = netSweeps * state.rules.sweepPoints;
      return { cards, spades: spadesPoints, big, little, aces, sweeps,
        total: cards + spadesPoints + big + little + aces + sweeps,
        cardCount: counts[i], spadeCount: spades[i], sweepCount: state.players[i].sweeps };
    });
    return rows;
  }
  function finishHand(state) {
    if (state.table.length && state.lastCapture !== null) {
      state.players[state.lastCapture].captured.push(...state.table.flatMap(cardsInElement));
      state.lastAction += ` Remaining table cards awarded to ${state.players[state.lastCapture].name}.`;
    }
    if (state.table.length && state.lastCapture === null) {
      // Extremely unusual case: no capture all hand. Leave unclaimed cards out of scoring.
      state.lastAction += ' No player captured; table residue is unclaimed.';
    }
    state.table = [];
    const totals = scoreHand(state);
    totals.forEach((row, i) => { state.players[i].score += row.total; });
    const scores = state.players.map(p => p.score);
    const reached = scores.some(s => s >= state.rules.winningScore);
    let winner = null;
    if (reached && scores[0] !== scores[1]) winner = scores[0] > scores[1] ? 0 : 1;
    state.phase = reached && winner !== null ? 'gameOver' : 'roundOver';
    state.result = { points: totals, scores, winner, finishedRound: state.round };
  }
  function nextHand(state, random = Math.random) {
    if (state.phase !== 'roundOver') return null;
    return makeState(state.rules, 1 - state.dealer, state.players.map(p => p.score), state.round + 1, random);
  }
  // All loose-card subsets whose sum is value. Pruned by positive card values.
  function valueGroups(state, target, max = 160) {
    const matching = state.table.filter(e => e.type === 'build' && e.value === target).map(e => [e.id]);
    const loose = state.table.filter(e => e.type === 'loose' && cardValues(e.card,state.rules).length)
      .map(e => ({id:e.id, vals:cardValues(e.card,state.rules)}));
    const seen = new Set(matching.map(group=>group.join(',')));
    const go = (start,total,chosen) => {
      if (matching.length >= max) return;
      if (total === target) {
        const key = chosen.join(',');
        if (!seen.has(key)) {seen.add(key); matching.push([...chosen]);}
        return;
      }
      for (let i = start; i < loose.length; i++) {
        for (const v of loose[i].vals) {
          if (total + v > target) continue;
          go(i+1,total+v,[...chosen,loose[i].id]);
          if (matching.length >= max) return;
        }
      }
    };
    go(0,0,[]);
    return matching;
  }
  function captureChoices(state, card, limit = 110) {
    const values = cardValues(card, state.rules);
    if (!values.length) {
      return state.table.filter(e => e.type === 'loose' && e.card.rank === card.rank).map(e => ({ kind: 'capture', cardId: card.id, targetIds: [e.id] }));
    }
    const moves = [];
    const visited = new Set();
    const add = picked => {
      const ids = [...picked].sort();
      const key = ids.join(',');
      if (!visited.has(key) && moves.length < limit) {
        visited.add(key);
        moves.push({ kind: 'capture', cardId: card.id, targetIds: ids });
      }
    };
    // Keep alternate numerical values separate: mixed-value groups are illegal.
    const groupSets = values.map(v => valueGroups(state, v));
    for (const groups of groupSets) {
      const builds = groups.filter(g => g.length === 1 && state.table.some(e => e.id === g[0] && e.type === 'build'));
      if (builds.length) add(builds.flat());
      if (groups.length) add(groups[0]);
    }
    for (const groups of groupSets) {
      const combine = (start, picked) => {
        if (moves.length >= limit) return;
        if (picked.length) add(picked);
        for (let i = start; i < groups.length; i++) {
          if (groups[i].some(id => picked.includes(id))) continue;
          combine(i + 1, picked.concat(groups[i]));
          if (moves.length >= limit) break;
        }
      };
      combine(0, []);
    }
    return moves;
  }
  function buildChoices(state, card, max = 55) {
    if (!state.rules.builds || cardValue(card, state.rules) === null) return [];
    const relevant = state.table.filter(e => e.type === 'loose' && cardValue(e.card, state.rules) !== null);
    const builds = state.table.filter(e => e.type === 'build');
    const targetSets = [];
    const collect = (start, picked, bound) => {
      if (picked.length) targetSets.push([...picked]);
      if (picked.length >= bound || targetSets.length >= 120) return;
      for (let i = start; i < relevant.length; i++) collect(i + 1, [...picked, relevant[i].id], bound);
    };
    collect(0, [], 3);
    for (const b of builds) {
      targetSets.push([b.id]);
      for (const l of relevant) targetSets.push([b.id, l.id]);
    }
    const moves = [];
    const keys = new Set();
    for (const ids of targetSets) {
      for (const option of legalBuildOptions(state, card.id, ids)) {
        const key = [option.value, option.mode, ...option.targetIds].join('/');
        if (!keys.has(key)) { keys.add(key); moves.push(option); }
        if (moves.length >= max) return moves;
      }
    }
    return moves;
  }
  function allComputerMoves(state, limit = 500) {
    const moves = [];
    for (const card of state.players[state.turn].hand) {
      const trail = { kind: 'trail', cardId: card.id, targetIds: [] };
      if (validateAction(state, trail).ok) moves.push(trail);
      for (const move of captureChoices(state, card)) if (validateAction(state, move).ok) moves.push(move);
      for (const move of buildChoices(state, card)) moves.push(move);
      if (moves.length >= limit) break;
    }
    return moves;
  }
  function moveScore(state, move) {
    const card = state.players[state.turn].hand.find(c => c.id === move.cardId);
    if (move.kind === 'capture') {
      const selection = state.table.filter(e => move.targetIds.includes(e.id));
      const cards = [card, ...selection.flatMap(cardsInElement)];
      const swept = selection.length === state.table.length;
      const specials = cards.reduce((s, c) => s + (c.id === 'D10' ? 4.1 : 0) + (c.id === 'S2' ? 2.7 : 0) + (c.rank === 1 ? 1.8 : 0) + (c.suit === 'S' ? state.rules.spadeScoring ? 1.2 : 0.55 : 0), 0);
      return 3 + (cards.length - 1) * 1.3 + specials + (swept ? 3.2 + state.rules.sweepPoints * 2 : 0) + selection.filter(e => e.type === 'build').length * 1.1;
    }
    if (move.kind === 'build') {
      const chosen = state.table.filter(e => move.targetIds.includes(e.id));
      const consumed = chosen.flatMap(cardsInElement);
      const risk = 1.2 + Math.max(0, state.players[1 - state.turn].hand.length - 2) * 0.3;
      return 1.5 + consumed.length * 0.6 + (consumed.some(c => c.id === 'D10') ? 1.5 : 0) - risk;
    }
    const v = cardValue(card, state.rules) || 11;
    return -0.1 - (card.id === 'D10' ? 4 : 0) - (card.id === 'S2' ? 2 : 0) - (card.rank === 1 ? 1.1 : 0) - (v >= 8 ? 0.35 : 0);
  }
  function chooseComputerMove(state, random = Math.random) {
    const options = allComputerMoves(state);
    if (!options.length) throw new Error('No legal moves for computer.');
    if (state.rules.difficulty === 'casual') {
      // Casual computer mostly captures, but not necessarily the best combination.
      const captures = options.filter(m => m.kind === 'capture');
      if (captures.length && random() < 0.78) return captures[Math.floor(random() * captures.length)];
      return options[Math.floor(random() * options.length)];
    }
    const scored = options.map(move => ({ move, score: moveScore(state, move) + random() * 0.6 }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0].move;
  }
  // Hints rank legal moves independently of the opponent's difficulty.
  // Include every hand card and choose deterministically without playing.
  function chooseHintMove(state) {
    const moves = allComputerMoves(state, Infinity);
    let best = null, bestScore = -Infinity;
    for (const move of moves) {
      if (!validateAction(state, move).ok) continue;
      const score = moveScore(state, move);
      if (score > bestScore) { best = move; bestScore = score; }
    }
    if (!best) throw new Error('No legal move found.');
    return best;
  }
  function explainMove(state, move) {
    if (move.kind === 'trail') return `Trail ${cardName(state.players[state.turn].hand.find(c => c.id === move.cardId))} onto the table.`;
    if (move.kind === 'capture') return `Capture ${move.targetIds.length} table group${move.targetIds.length === 1 ? '' : 's'} with ${cardName(state.players[state.turn].hand.find(c => c.id === move.cardId))}.`;
    return `${move.label || 'Build'} by combining your card with the selected table cards.`;
  }
  return { SUITS, DEFAULT_RULES, PRESETS, rulesFor, cardValues, makeDeck, makeState, newMatch,
    cardName, cardValue, cardsInElement, findPartition, validateAction,
    legalBuildOptions, applyAction, scoreHand, finishHand, nextHand,
    captureChoices, buildChoices, allComputerMoves, chooseComputerMove, chooseHintMove,
    explainMove, moveScore, buildActionLabel };
});
