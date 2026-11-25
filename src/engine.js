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
    if (!cards.length || !Number.isInteger(target) || target < 1) return null;
    const possible = cards.map(x => cardValues(x.card, rules).filter(v => v <= target));
    if (possible.some(vals => !vals.length)) return null;
    // The common case has exactly one value for every card. No recursive
    // assignment or array copies are necessary before partitioning.
    if (possible.every(vals => vals.length === 1)) {
      return findPartition(cards.map((x,i) => ({card:x.card,v:possible[i][0]})), target, desired);
    }
    // For alternate values, prune branches whose remaining values cannot
    // make a total divisible by the target. Original value order is retained.
    const residues=Array(cards.length+1);
    residues[cards.length]=new Set([0]);
    for(let i=cards.length-1;i>=0;i--){
      const next=new Set();
      for(const value of possible[i])for(const rest of residues[i+1])next.add((value+rest)%target);
      residues[i]=next;
    }
    const chosen=[];
    const choose = (i,total) => {
      if(!residues[i].has((target-total%target)%target))return null;
      if (i === cards.length) return findPartition(chosen, target, desired);
      for (const v of possible[i]) {
        if(desired==='single'&&total+v>target)continue;
        chosen.push({card:cards[i].card,v});
        const result=choose(i+1,total+v);
        chosen.pop();
        if(result)return result;
      }
      return null;
    };
    return choose(0,0);
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
    const total=values.reduce((sum,v)=>sum+v,0);
    if(total%target || (desired==='single'&&total!==target) ||
      (desired==='multiple'&&total<2*target))return null;
    // The unique single-group partition is always in original card order.
    if(total===target)return [cards.map(x=>x.card)];
    const failed=new Set();
    // First unchecked card always starts the next group, so each partition is found once.
    const walk = (remaining, groups) => {
      if (!remaining.length) {
        if (desired === 'single' && groups.length !== 1) return null;
        if (desired === 'multiple' && groups.length < 2) return null;
        return groups;
      }
      // Only impossible subproblems are memoized. A successful branch
      // still returns the original card identities in the original order.
      const key=remaining.map(x=>x.v).join(',');
      if(failed.has(key))return null;
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
      const result=choose(0, target - first.v, [], []);
      if(!result&&failed.size<4096)failed.add(key);
      return result;
    };
    const partition = walk(cards.map((card, i) => ({ ...card, v: values[i] })), []);
    return partition && partition.map(group => group.map(x => x.card));
  }
  function ownBuildObligation(state, table, hand, player) {
    if (state.rules.buildAnything) return null;
    // A multiple build occupies one table element, regardless of its number
    // of equal-valued groups. Each independent owned element needs a distinct
    // physical card in the remaining hand, even if the values are identical.
    const own = table.filter(element => element.type === 'build' && element.owner === player);
    const values = hand.map(card => cardValues(card, state.rules));
    const obligations = own.map(element => ({
      value: element.value,
      choices: values.flatMap((possible, index) => possible.includes(element.value) ? [index] : [])
    })).sort((a,b) => a.choices.length - b.choices.length);
    for (const obligation of obligations) {
      if (!obligation.choices.length) return `You must retain a ${obligation.value} to capture your existing build.`;
    }
    // Solve the small assignment problem, rather than counting ranks
    // independently. A Royal Ace, for example, cannot reserve both a 1
    // and a 14 build, but can reserve either if a different card covers the
    // other. Backtracking avoids rejecting valid overlapping value choices.
    const used = new Set();
    function reserve(index) {
      if (index === obligations.length) return true;
      for (const choice of obligations[index].choices) {
        if (used.has(choice)) continue;
        used.add(choice);
        if (reserve(index + 1)) return true;
        used.delete(choice);
      }
      return false;
    }
    if (own.length > hand.length || !reserve(0)) {
      return 'Each independent build needs its own matching capture card in your hand.';
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
      return {ok:false,reason:`Keep a ${requestedValue} in hand to capture your build (or turn Build Obligation off).`};
    }
    const builds = selection.filter(e => e.type === 'build');
    const loose = selection.filter(e => e.type === 'loose').map(e => ({card:e.card}));
    if (loose.some(x => !cardValues(x.card, rules).length)) {
      return {ok:false,reason:'Face cards need numerical Royal values to form builds.'};
    }
    if (builds.length > 1) {
      // One contributed hand card must raise exactly one single build.
      // Other selected builds may join only at their unchanged value.
      if(requestedMode!=='merge'||!rules.multipleBuilds)
        return {ok:false,reason:'A raise-and-merge requires Multiple Builds.'};
      const lower=builds.filter(b=>b.value!==requestedValue);
      const matching=builds.filter(b=>b.value===requestedValue);
      if(lower.length!==1||!matching.length||lower[0].groups.length!==1||
        !playedValues.some(v=>lower[0].value+v===requestedValue))
        return {ok:false,reason:'Raise one single build and merge only matching-value builds.'};
      const extra=loose.length?findValuePartition(loose,requestedValue,'any',rules):[];
      if(!extra)return {ok:false,reason:'Loose cards must form complete matching groups.'};
      const groups=[...matching.flatMap(b=>b.groups),lower[0].groups[0].concat(card),...extra];
      return {ok:true,build:{value:requestedValue,groups,kind:'multiple',operation:'merge'}};
    }
    if(requestedMode==='merge')return {ok:false,reason:'Select a single build to raise and a matching build to merge.'};
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
    const buildCount=selection.filter(e=>e&&e.type==='build').length;
    const possibilities = [];
    for (const value of values) {
      for (const mode of buildCount>1 ? ['merge'] : buildCount ? ['extend', 'raise'] : ['single', 'multiple']) {
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
  // The contextual menu may offer a merge with the player's existing
  // equal-valued build even when only the smaller build is selected.
  // The actual action always includes every consumed stack explicitly.
  function contextualBuildOptions(state,cardId,targetIds){
    const options=legalBuildOptions(state,cardId,targetIds);
    if(!state.rules.builds||!state.rules.multipleBuilds)return options;
    const ids=targetIds||[];
    const selected=state.table.filter(b=>b.type==='build'&&ids.includes(b.id));
    if(selected.length!==1||selected[0].groups.length!==1)return options;
    const card=state.players[state.turn].hand.find(c=>c.id===cardId);
    if(!card)return options;
    for(const value of cardValues(card,state.rules).map(v=>v+selected[0].value)){
      const matching=state.table.filter(b=>b.type==='build'&&b.owner===state.turn&&b.value===value&&!ids.includes(b.id));
      // Prefer the existing matching stack as the visual base.
      if(matching.length)options.push(...legalBuildOptions(state,cardId,[...matching.map(b=>b.id),...ids])
        .filter(move=>move.mode==='merge'&&move.value===value));
    }
    return options;
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
      const op = { create: 'built', raise: 'raised a build to', extend: 'extended a build of', merge: 'merged builds of' }[checked.build.operation];
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
      if(b.groups.length===1&&state.rules.multipleBuilds)for(const other of builds){
        if(other===b||!cardValues(card,state.rules).some(v=>b.value+v===other.value))continue;
        targetSets.push([other.id,b.id]);
        for(const l of relevant)targetSets.push([other.id,b.id,l.id]);
      }
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
    if(state.rules.difficulty==='hard'||state.rules.difficulty==='expert')
      return analyzeComputerMove(publicPosition(state),{random}).move;
    const options = allComputerMoves(state);
    if (!options.length) throw new Error('No legal moves for computer.');
    if (state.rules.difficulty === 'casual') {
      // Casual computer mostly captures, but not necessarily the best combination.
      const captures = options.filter(m => m.kind === 'capture');
      if (captures.length && random() < 0.78) return captures[Math.floor(random() * captures.length)];
      return options[Math.floor(random() * options.length)];
    }
    // Stable maximum: identical scoring, random calls and tie order as
    // the former sort, without allocating and sorting a second move list.
    let best=options[0],bestScore=-Infinity;
    for(const move of options){
      const score=moveScore(state,move)+random()*.6;
      if(score>bestScore){best=move;bestScore=score;}
    }
    return best;
  }
  // Yield candidate subsets whose possible numerical sum is a multiple of
  // the target. The suffix residue masks prune impossible branches, without
  // limiting the number of cards or the number of legal results.
  function* hintSubsets(entries, target, initialValues, allowEmpty = false, stop=()=>false) {
    const suffix=Array(entries.length+1);
    suffix[entries.length]=new Set([0]);
    for(let i=entries.length-1;i>=0;i--){
      const after=suffix[i+1];
      suffix[i]=new Set(after);
      for(const value of entries[i].values) for(const residue of after)
        suffix[i].add((value+residue)%target);
    }
    function* walk(start, residues, ids){
      if(stop())return;
      if((ids.length||allowEmpty)&&residues.has(0)) yield ids;
      for(let i=start;i<entries.length&&!stop();i++){
        const next=new Set();
        for(const residue of residues) for(const value of entries[i].values)
          next.add((residue+value)%target);
        if(![...next].some(r=>suffix[i+1].has((target-r)%target)))continue;
        yield* walk(i+1,next,[...ids,entries[i].id]);
      }
    }
    yield* walk(0,new Set(initialValues.map(v=>v%target)),[]);
  }

  // Exhaustive legal action generation shares the same validator as manual
  // play. Optional interruption bounds search in pathological positions.
  // Hints collapse identical visible selections, AI keeps distinct actions.
  function* legalActions(state,stop=()=>false,visibleOnly=false) {
    if(!state||state.phase!=='playing')return;
    const hand=state.players[state.turn].hand;
    const rules=state.rules;
    const loose=state.table.filter(x=>x.type==='loose');
    const builds=state.table.filter(x=>x.type==='build');
    const seen=new Set();
    const key=(cardId,ids)=>JSON.stringify([cardId,[...ids].sort()]);
    function unique(move){
      const selection=key(move.cardId,move.targetIds||[]);
      const k=visibleOnly?selection:JSON.stringify([selection,move.kind,move.value,move.mode]);
      if(seen.has(k))return false;
      seen.add(k);return true;
    }
    const numericEntries=target=>loose.map(x=>({id:x.id,
      values:cardValues(x.card,rules).filter(v=>v<=target)})).filter(x=>x.values.length);
    for(const card of hand){
      if(stop())return;
      const values=cardValues(card,rules);
      if(!values.length){
        for(const item of loose){
          if(stop())return;
          if(item.card.rank!==card.rank)continue;
          const move={kind:'capture',cardId:card.id,targetIds:[item.id]};
          if(validateAction(state,move).ok&&unique(move))yield move;
        }
        continue;
      }
      for(const target of values){
        const entries=[...builds.filter(b=>b.value===target).map(b=>({id:b.id,values:[target]})),
          ...numericEntries(target)];
        for(const ids of hintSubsets(entries,target,[0],false,stop)){
          const move={kind:'capture',cardId:card.id,targetIds:ids};
          if(validateAction(state,move).ok&&unique(move))yield move;
        }
      }
    }
    if(rules.builds)for(const card of hand){
      if(stop())return;
      const played=cardValues(card,rules);
      if(!played.length)continue;
      const targets=rules.buildAnything
        ? Array.from({length:maxBuildValue(rules)},(_,i)=>i+1)
        : [...new Set(hand.filter(c=>c.id!==card.id).flatMap(c=>cardValues(c,rules)))];
      function* options(ids,target){
        if(stop()||(visibleOnly&&seen.has(key(card.id,ids))))return;
        for(const move of legalBuildOptions(state,card.id,ids)){
          if(move.value===target&&unique(move))yield move;
        }
      }
      for(const target of targets){
        if(stop())return;
        const entries=numericEntries(target);
        const values=played.filter(v=>v<=target);
        if(!values.length)continue;
        for(const ids of hintSubsets(entries,target,values,false,stop))yield* options(ids,target);
        for(const build of builds){
          if(stop())return;
          const extend=rules.multipleBuilds&&build.value===target;
          const raise=build.groups.length===1&&values.some(v=>build.value+v===target);
          if(!extend&&!raise)continue;
          const initial=extend?values:values.filter(v=>build.value+v===target);
          // When raising, matching existing builds can be included as
          // intact groups. They never contribute to the increase in value.
          const matching=raise&&rules.multipleBuilds?builds.filter(b=>b!==build&&b.value===target)
            .map(b=>({id:b.id,values:[target]})):[];
          for(const extra of hintSubsets(entries,target,initial.map(v=>v+build.value),true,stop))
            yield* options([build.id,...extra],target);
          if(matching.length){
            for(const extra of hintSubsets([...matching,...entries],target,[0],false,stop)){
              if(!matching.some(b=>extra.includes(b.id)))continue;
              yield* options([...extra.filter(id=>matching.some(b=>b.id===id)),build.id,...extra.filter(id=>!matching.some(b=>b.id===id))],target);
            }
          }
        }
      }
    }
    for(const card of hand){
      if(stop())return;
      const move={kind:'trail',cardId:card.id,targetIds:[]};
      if(validateAction(state,move).ok&&unique(move))yield move;
    }
  }
  function* hintSelections(state){yield* legalActions(state,()=>false,true);}

  // Strong opponents receive a detached, public-information-only view.
  // The other hand and stock are represented by counts, never actual IDs.
  function publicPosition(state){
    const root=state.turn;
    const players=state.players.map((p,i)=>({
      name:p.name,score:p.score,sweeps:p.sweeps,captured:p.captured,
      handCount:p.hand.length,...(i===root?{hand:p.hand}:{})
    }));
    return JSON.parse(JSON.stringify({rules:state.rules,players,table:state.table,
      stockCount:state.stock.length,turn:root,lastCapture:state.lastCapture,
      nextId:state.nextId,moveNumber:state.moveNumber,dealer:state.dealer,
      round:state.round,phase:state.phase}));
  }
  // Draw a plausible hidden world from the unseen deck. Public build
  // obligations constrain the opponent's hand; reserve distinct cards.
  // With an exhausted stock the remaining unseen cards determine the hand.
  function samplePublicPosition(view,random=Math.random){
    const root=view.turn,other=1-root;
    const known=new Set([
      ...view.players[root].hand,
      ...view.players.flatMap(p=>p.captured),
      ...view.table.flatMap(cardsInElement)
    ].map(c=>c.id));
    const pool=shuffle(makeDeck().filter(c=>!known.has(c.id)),random);
    const count=view.players[other].handCount;
    const obligations=view.rules.buildAnything?[]:view.table.filter(b=>b.type==='build'&&b.owner===other)
      .map(b=>({value:b.value,choices:pool.map((c,i)=>cardValues(c,view.rules).includes(b.value)?i:-1).filter(i=>i>=0)}))
      .sort((a,b)=>a.choices.length-b.choices.length);
    const reserved=new Set();
    function reserve(i){
      if(i===obligations.length)return true;
      for(const index of obligations[i].choices){
        if(reserved.has(index))continue;
        reserved.add(index);
        if(reserve(i+1))return true;
        reserved.delete(index);
      }
      return false;
    }
    if(obligations.length>count||!reserve(0))return null;
    const hidden=[...reserved].map(i=>pool[i]);
    const remaining=pool.filter((_,i)=>!reserved.has(i));
    hidden.push(...remaining.splice(0,count-hidden.length));
    if(hidden.length!==count||remaining.length<view.stockCount)return null;
    const players=view.players.map((p,i)=>({name:p.name,score:p.score||0,sweeps:p.sweeps||0,
      captured:p.captured.slice(),hand:(i===root?p.hand:hidden).slice()}));
    return {rules:view.rules,players,table:view.table.slice(),stock:remaining.slice(0,view.stockCount),
      turn:root,lastCapture:view.lastCapture,nextId:view.nextId,moveNumber:view.moveNumber,
      dealer:view.dealer,round:view.round,phase:view.phase,result:null,lastAction:'',log:[]};
  }
  // Cheap legal safety move: direct captures (including owned builds), then
  // a legal trail. A valid state always permits one or the other. No hidden
  // cards are read, even when the worker is unavailable or times out.
  function quickLegalMove(state){
    let best=null,bestScore=-Infinity;
    for(const card of state.players[state.turn].hand){
      const offer=move=>{
        if(!validateAction(state,move).ok)return;
        const score=moveScore(state,move);
        if(score>bestScore){best=move;bestScore=score;}
      };
      offer({kind:'trail',cardId:card.id,targetIds:[]});
      for(const item of state.table)offer({kind:'capture',cardId:card.id,targetIds:[item.id]});
    }
    if(best)return best;
    // Corrupt/legacy states can lack a simple move; do not invent an illegal one.
    throw new Error('No simple legal move in the current position.');
  }
  function simulationCopy(state){
    // Cards, groups and rules are immutable during applyAction. Only copy
    // the containers it mutates, not the entire serialized match history.
    return {...state,players:state.players.map(p=>({...p,hand:p.hand.slice(),captured:p.captured.slice()})),
      stock:state.stock.slice(),table:state.table.slice(),log:[]};
  }
  const tacticalWorth=c=>.11+(c.rank===1?1:0)+(c.id==='D10'?2:0)+(c.id==='S2'?1:0)+(c.suit==='S'?.14:0);
  function strategicValue(state,root){
    const other=1-root,p=state.players[root],q=state.players[other],rules=state.rules;
    if(state.phase!=='playing'){
      const margin=p.score-q.score;
      const terminal=state.result?.winner;
      return margin+(state.phase==='gameOver'?(terminal===root?100:terminal===other?-100:0):0);
    }
    function tally(pile){
      let spades=0,special=0;
      for(const c of pile){
        if(c.suit==='S'){spades++;if(rules.spadeScoring&&c.id==='S11')special++;}
        special+=(c.rank===1?1:0)+(c.id==='D10'?2:0)+(c.id==='S2'?1:0);
      }
      return {count:pile.length,spades,special};
    }
    const a=tally(p.captured),b=tally(q.captured);
    const remaining=Math.max(0,52-a.count-b.count),remainingSpades=Math.max(0,13-a.spades-b.spades);
    const majority=(diff,left,points)=>{
      if(diff>left)return points;
      if(diff< -left)return -points;
      if(!left)return Math.sign(diff)*points;
      return points*Math.tanh(diff/Math.max(1,left*.26));
    };
    let score=p.score-q.score+a.special-b.special+majority(a.count-b.count,remaining,3)
      +(rules.spadeScoring?a.spades-b.spades:majority(a.spades-b.spades,remainingSpades,1))
      +(p.sweeps-q.sweeps)*rules.sweepPoints+.045*(a.count-b.count);
    const vals=state.players.map(pl=>pl.hand.map(c=>cardValues(c,rules)));
    const matches=(i,v)=>vals[i].some(values=>values.includes(v));
    // Possible loose sums and exact build values, for mobility, capture
    // potential and preserving flexible cards. A bitset avoids subset copies.
    let sums=1;
    const buildValues=new Set(),faces=new Set();
    let tableWorth=0;
    for(const item of state.table){
      if(item.type==='loose'){
        const values=cardValues(item.card,rules);
        const old=sums;
        for(const v of values)sums|=old<<v;
        sums&=0x1ffff;
        if(!values.length)faces.add(item.card.rank);
        tableWorth+=tacticalWorth(item.card);
        continue;
      }
      buildValues.add(item.value);
      const worth=cardsInElement(item).reduce((sum,c)=>sum+tacticalWorth(c),0);
      tableWorth+=worth;
      const owner=item.owner,enemy=1-owner;
      const secured=matches(owner,item.value),stealable=matches(enemy,item.value);
      let raiseable=false;
      if(item.groups.length===1&&rules.builds){
        raiseable=vals[enemy].some((values,i)=>values.some(v=>
          v+item.value<=maxBuildValue(rules)&&
          (rules.buildAnything||vals[enemy].some((rest,j)=>i!==j&&rest.includes(v+item.value)))));
      }
      const security=secured?(stealable?.04:raiseable?.20:.43):-.14;
      score+=(owner===root?1:-1)*(worth*security-.065);
    }
    for(let i=0;i<2;i++){
      const hand=state.players[i].hand,distinct=new Set();
      let mobility=0;
      for(let j=0;j<hand.length;j++){
        const values=vals[i][j];
        if(values.length){
          values.forEach(v=>distinct.add(v));
          if(values.some(v=>buildValues.has(v)||(sums&(1<<v))))mobility++;
        }else{
          distinct.add('face'+hand[j].rank);
          if(faces.has(hand[j].rank))mobility++;
        }
      }
      score+=(i===root?1:-1)*(.052*distinct.size+.105*mobility);
    }
    // Late-hand residue matters: favor retaining the last-capture right
    // when few actions remain. Search handles the actual award exactly.
    if(!state.stock.length&&state.lastCapture!==null){
      const left=p.hand.length+q.hand.length;
      score+=(state.lastCapture===root?1:-1)*tableWorth*.23/(1+left*.35);
    }
    return score;
  }
  // Hard and Expert share the same evaluator and imperfect-information
  // model. Root moves are exhaustive until an explicit safety budget;
  // deeper nonterminal branches are ranked/limited, with iterative search
  // over common sampled worlds. A partial iteration never replaces the
  // last completed one. Small perfect-information endgames can be exact.
  function analyzeComputerMove(view,options={}){
    const expert=view.rules.difficulty==='expert',root=view.turn;
    const random=options.random||Math.random,now=options.now||Date.now;
    const timeMs=options.timeMs??(expert?1500:650),maxNodes=options.maxNodes??(expert?18000:4800);
    const maxRoots=options.maxRoots??(expert?1800:900);
    const began=now(),deadline=began+timeMs;
    let nodes=0,rootTruncated=false,completedDepth=1,samplesUsed=0;
    const stopped=()=>nodes>=maxNodes||now()>=deadline;
    const sampleCount=view.stockCount===0?1:expert?5:3;
    const worlds=[];
    for(let i=0;i<sampleCount;i++){
      const world=samplePublicPosition(view,random);
      if(world)worlds.push(world);
    }
    if(!worlds.length)throw new Error('No plausible hidden hand satisfies the public position.');
    const baseline=worlds[0];
    const fallback=quickLegalMove(baseline);
    const advance=(state,move)=>{
      if(stopped())return null;
      nodes++;
      const child=simulationCopy(state);
      return applyAction(child,move).ok?child:null;
    };
    const rootKey=m=>JSON.stringify([m.kind,m.cardId,[...m.targetIds].sort(),m.value,m.mode]);
    const seen=new Set(),roots=[];
    const rootSamples=Math.min(worlds.length,expert?3:2);
    const rootStopped=()=>{
      const stop=stopped()||roots.length>=maxRoots||now()>=began+timeMs*.38;
      if(stop)rootTruncated=true;
      return stop;
    };
    const risk=(view.players[root].score||0)>(view.players[1-root].score||0)&&
      (view.players[root].score||0)>view.rules.winningScore*.65?.12:0;
    const aggregate=values=>{
      const mean=values.reduce((a,b)=>a+b,0)/values.length;
      return mean-risk*Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length);
    };
    function addRoot(move){
      const key=rootKey(move);
      if(seen.has(key)||stopped())return;
      seen.add(key);
      const values=[];
      for(let i=0;i<rootSamples;i++){
        const child=advance(worlds[i],move);
        if(!child)break;
        values.push(strategicValue(child,root));
      }
      if(values.length!==rootSamples)return;
      roots.push({move,score:aggregate(values)+.0001*moveScore(baseline,move)});
    }
    addRoot(fallback);
    // Keep legal trails in the candidate list even if a huge capture set
    // hits the root limit before the generator reaches its trailing phase.
    for(const c of baseline.players[root].hand){
      const move={kind:'trail',cardId:c.id,targetIds:[]};
      if(validateAction(baseline,move).ok)addRoot(move);
    }
    for(const move of legalActions(baseline,rootStopped)){
      if(rootStopped())break;
      addRoot(move);
    }
    if(!roots.length)return {move:fallback,nodes,rootMoves:0,rootTruncated:true,completedDepth:0,samplesUsed:0,exact:false};
    roots.sort((a,b)=>b.score-a.score);
    let best=roots[0].move,ranked=roots;
    samplesUsed=rootSamples;
    const handLeft=view.players.reduce((n,p)=>n+p.handCount,0);
    const perfect=view.stockCount===0&&worlds.length===1&&
      worlds[0].players[1-root].hand.length===view.players[1-root].handCount;
    const exhaustive=perfect&&!rootTruncated&&handLeft<=8&&roots.length<=100;
    const branchLimit=expert?120:90,beam=expert?8:6;
    function minimax(state,depth,alpha,beta){
      if(stopped())return null;
      if(depth===0||state.phase!=='playing')return strategicValue(state,root);
      const maximize=state.turn===root,children=[],keys=new Set();
      function offer(move){
        const k=rootKey(move);
        if(keys.has(k))return;
        keys.add(k);
        const child=advance(state,move);
        if(child)children.push({child,score:strategicValue(child,root)});
      }
      // Keep a safe move and all trails represented even when a sampled
      // position is wide; in exact endgames no branch beam is used.
      offer(quickLegalMove(state));
      for(const c of state.players[state.turn].hand){
        const move={kind:'trail',cardId:c.id,targetIds:[]};
        if(validateAction(state,move).ok)offer(move);
      }
      for(const move of legalActions(state,stopped)){
        if(stopped())return null;
        offer(move);
        if(!exhaustive&&children.length>=branchLimit)break;
      }
      if(stopped())return null;
      children.sort((a,b)=>maximize?b.score-a.score:a.score-b.score);
      if(!children.length)return strategicValue(state,root);
      const selected=exhaustive?children:children.slice(0,beam);
      let best=maximize?-Infinity:Infinity;
      for(const {child,score} of selected){
        const value=depth===1?score:minimax(child,depth-1,alpha,beta);
        if(value===null)return null;
        if(maximize){best=Math.max(best,value);alpha=Math.max(alpha,best);}
        else{best=Math.min(best,value);beta=Math.min(beta,best);}
        if(beta<=alpha)break;
      }
      return best;
    }
    const rounds=exhaustive&&expert
      ? Array.from({length:Math.max(0,handLeft-1)},(_,i)=>({depth:i+2,width:Infinity,count:1}))
      : expert?[{depth:2,width:16,count:4},{depth:3,width:8,count:3},{depth:4,width:5,count:2}]
        : [{depth:2,width:12,count:3}];
    for(const round of rounds){
      if(stopped())break;
      const candidates=exhaustive?ranked:ranked.slice(0,round.width);
      const count=Math.min(worlds.length,round.count);
      const scored=[];
      let complete=true;
      for(const candidate of candidates){
        const values=[];
        for(let i=0;i<count;i++){
          const child=advance(worlds[i],candidate.move);
          if(!child){complete=false;break;}
          const value=minimax(child,round.depth-1,-Infinity,Infinity);
          if(value===null){complete=false;break;}
          values.push(value);
        }
        if(!complete)break;
        scored.push({move:candidate.move,score:aggregate(values)});
      }
      if(!complete||scored.length!==candidates.length)break;
      scored.sort((a,b)=>b.score-a.score);
      ranked=scored;best=ranked[0].move;completedDepth=round.depth;samplesUsed=count;
      if(exhaustive&&completedDepth>=handLeft)break;
    }
    return {move:best,nodes,rootMoves:roots.length,rootTruncated,completedDepth,samplesUsed,
      exact:exhaustive&&completedDepth>=handLeft};
  }

  function explainMove(state, move) {
    if (move.kind === 'trail') return `Trail ${cardName(state.players[state.turn].hand.find(c => c.id === move.cardId))} onto the table.`;
    if (move.kind === 'capture') return `Capture ${move.targetIds.length} table group${move.targetIds.length === 1 ? '' : 's'} with ${cardName(state.players[state.turn].hand.find(c => c.id === move.cardId))}.`;
    return `${move.label || 'Build'} by combining your card with the selected table cards.`;
  }
  return { SUITS, DEFAULT_RULES, PRESETS, rulesFor, cardValues, makeDeck, makeState, newMatch,
    cardName, cardValue, cardsInElement, findPartition, validateAction,
    legalBuildOptions, contextualBuildOptions, legalActions, applyAction, scoreHand, finishHand, nextHand,
    captureChoices, buildChoices, allComputerMoves, chooseComputerMove, hintSelections,
    explainMove, moveScore, buildActionLabel, publicPosition, samplePublicPosition, quickLegalMove, analyzeComputerMove, strategicValue };
});
