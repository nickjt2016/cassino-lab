const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../src/engine.js');
function seeded(seed){
 let n=seed>>>0;return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};
}
function checkedMove(state,move){
 assert.equal(E.checkInvariants(state),null);
 const legal=E.validateAction(state,move);assert.equal(legal.ok,true,legal.reason);
 const result=E.applyAction(state,move);assert.equal(result.ok,true,result.reason);
 assert.equal(E.checkInvariants(state),null);
}
function checkCompletedDeal(s,previous){
 assert.ok(s.phase==='roundOver'||s.phase==='gameOver','Deal must finish');
 assert.equal(s.stock.length,0);assert.equal(s.table.length,0);
 assert.ok(s.players.every(p=>p.hand.length===0));
 assert.equal(E.checkInvariants(s),null);
 for(let i=0;i<2;i++)assert.equal(s.players[i].score,previous[i]+s.result.points[i].total);
 assert.deepEqual(s.result.scores,s.players.map(p=>p.score));
}
function runMatch(rules,seed,difficulty){
 const random=seeded(seed);
 let s=E.newMatch({...E.activeRules(rules),difficulty},random),moves=0,deals=0;
 const types={capture:0,build:0,trail:0};
 let previous=[0,0];
 for(;;){
  const count=E.makeDeck(s.rules).length;
  for(let i=0;s.phase==='playing'&&i<count;i++){
   const move=E.chooseComputerMove(s,random);
   checkedMove(s,move);moves++;types[move.kind]++;
  }
  checkCompletedDeal(s,previous);deals++;
  if(s.phase==='gameOver'){
   if(s.rules.matchDeals)assert.equal(deals,s.rules.matchDeals);
   else{
    assert.ok(s.result.winner===0||s.result.winner===1);
    assert.ok(s.result.scores[s.result.winner]>=s.rules.winningScore);
    assert.ok(s.result.scores[s.result.winner]>s.result.scores[1-s.result.winner]);
   }
   return {deals,moves,types};
  }
  assert.ok(deals<40,'Target-score match did not finish in 40 deals');
  previous=s.result.scores.slice();
  const next=E.nextHand(s,random);assert.ok(next);
  assert.equal(next.round,s.round+1);assert.equal(next.dealer,1-s.dealer);
  assert.deepEqual(next.players.map(p=>p.score),previous);
  s=next;
 }
}
test('Complete matches across all playable presets at Easy and Medium',()=>{
 const totals={matches:0,deals:0,moves:0,types:{capture:0,build:0,trail:0}};
 for(const preset of E.PRESET_CATALOG.filter(p=>p.status==='playable')){
  for(const [seed,difficulty] of [[741,'casual'],[742,'thoughtful']]){
   const r=runMatch(E.rulesFor(preset.id),seed,difficulty);
   totals.matches++;totals.deals+=r.deals;totals.moves+=r.moves;
   for(const kind of Object.keys(totals.types))totals.types[kind]+=r.types[kind];
  }
 }
 assert.equal(totals.matches,2*E.PRESET_CATALOG.filter(p=>p.status==='playable').length);
 assert.ok(totals.types.build>0&&totals.types.capture>0&&totals.types.trail>0);
 console.log('Full match audit: '+JSON.stringify(totals));
});
test('Hard and Expert search-based play completes full deals at reduced node budgets',()=>{
 const scenarios=[['classic',{}],['royal',{subtractiveBuilds:true,negativeBuilds:true,colorArithmetic:true,additiveBuilds:true}],['classic',{deckMode:'54',customizeCardValues:true,cardValueOverrides:{Joker:[20,30],S1:[1,14]},buildRange:'custom',buildMin:3,buildMax:10}],['scopa',{}]];
 let deals=0,moves=0;
 for(const [preset,overrides] of scenarios)for(const difficulty of ['hard','expert']){
  const random=seeded(1934);
  const s=E.newMatch(E.activeRules(E.rulesFor(preset,{...overrides,difficulty,matchDeals:1})),random);
  let turns=0,nodes=0;
  const maxNodes=difficulty==='expert'?350:180;
  while(s.phase==='playing'&&turns<E.makeDeck(s.rules).length){
   const info=E.analyzeComputerMove(E.publicPosition(s),{random,now:()=>0,timeMs:1e6,maxNodes,maxRoots:80});
   assert.ok(info.nodes<=maxNodes);
   checkedMove(s,info.move);nodes+=info.nodes;turns++;
  }
  assert.equal(s.phase,'gameOver');checkCompletedDeal(s,[0,0]);
  assert.ok(nodes>0);deals++;moves+=turns;
 }
 assert.equal(deals,8);console.log('Search gameplay audit: '+deals+' complete deals, '+moves+' legal moves.');
});
test('100 additional randomized configurations across reduced, standard, joker and custom decks',()=>{
 const rnd=seeded(489312),choose=a=>a[Math.floor(rnd()*a.length)],coin=()=>rnd()<.5;
 let tested=0,blocked=0,completed=0;
 const byDeck={};
 for(let i=0;i<100;i++){
  const mode=choose(['40','52','54','custom']);
  const all=E.allCards();const subset=all.filter(c=>rnd()<.48).map(c=>c.id);if(subset.length%2)subset.pop();
  const base={deckMode:mode,...(mode==='custom'?{deckCards:subset}:{}),handSize:choose([2,3,4,6,8]),initialTableSize:choose([0,4,8]),dealMode:choose(['batch','draw']),remainderMode:choose(['equal','uneven','strict']),royal:coin(),aceValue:choose([1,11,14]),jokerValue:choose([8,15,25,30]),royalBigLittle:coin(),builds:coin(),directCapture:rnd()<.8,additiveCapture:rnd()<.8,additiveBuilding:coin(),subtractiveBuilds:coin(),multipleBuilds:coin(),singleCardBuild:coin(),negativeBuilds:coin(),colorArithmetic:coin(),raiseOwnBuild:coin(),raiseOpponentBuild:coin(),buildAnything:coin(),pirateBuilds:coin(),pirateCaptures:coin(),allowTrailWithOwnBuild:coin(),mergeSameValue:coin(),absorbMatching:coin(),additiveBuilds:coin(),forcedCapture:choose(['optional','direct','all','faces']),captureExtent:choose(['choice','choice','maximal','maximum']),captureGroups:choose(['one','unlimited']),directPriority:coin(),sweepPoints:choose([0,1,10]),sweepCancel:coin(),extraAfterSweep:coin(),scoreProfile:choose(['cassino','wippen','scopa','northeast','swedish','overspader','tablic','diloti','kontsina','hurrikan']),residueOwner:choose(['lastCapture','dealer'])};
  if(i%5===0){base.customizeCardValues=true;base.cardValueOverrides={};for(const c of all)if(rnd()<.18)base.cardValueOverrides[E.cardKey(c)]=[choose([1,2,3,5,7,10,14,20,30])];}
  const rules=E.activeRules(E.rulesFor('classic',base)),v=E.validateRules(rules);
  const tally=byDeck[mode]??={configs:0,blocked:0,deals:0};tally.configs++;
  if(!v.playable){blocked++;tally.blocked++;assert.equal(E.simulateRules(rules,2,1000+i*2).tested,0);continue;}
  const result=E.simulateRules(rules,2,1000+i*2);tested+=result.tested;completed+=result.completed;tally.deals+=result.completed;
  assert.equal(result.completed,2,'Configuration '+i+' '+JSON.stringify(result.failures.map(f=>({seed:f.seed,reason:f.reason}))));
 }
 assert.equal(completed,tested);assert.equal(completed,2*(100-blocked));
 console.log('Deck gameplay matrix: '+JSON.stringify({tested,blocked,completed,byDeck}));
});
test('Player counts, team arrangements, deck size and deal settings are validated together',()=>{
 const ids=E.allCards().filter(c=>c.rank<=6&&c.suit!=='X').map(c=>c.id);
 let checks=0,blocked=0,playable=0;
 for(const deckMode of ['40','52','54','custom'])for(let n=2;n<=6;n++)for(const teamMode of E.teamModesFor(n))
 for(const initialTableSize of [0,3,4,8])for(const dealMode of ['batch','draw','full'])for(const remainderMode of ['equal','uneven','strict']){
  const size=deckMode==='custom'?24:Number(deckMode);
  const r=E.activeRules(E.rulesFor('classic',{deckMode,deckCards:ids,playerCount:n,teamMode,initialTableSize,dealMode,remainderMode,handSize:Math.max(1,Math.floor(size/n)-1)}));
  const v=E.validateRules(r);checks++;
  const available=size-initialTableSize;
  const expected=n===2&&teamMode==='freeForAll'&&available>=n&&(dealMode==='full'||available>=n*r.handSize)&&
    (dealMode!=='batch'||remainderMode!=='strict'||available%(n*r.handSize)===0)&&
    (dealMode==='draw'||remainderMode==='uneven'||available%n===0);
  assert.equal(v.playable,expected,JSON.stringify({deckMode,n,teamMode,initialTableSize,dealMode,remainderMode,errors:v.errors}));
  if(v.playable)playable++;else blocked++;
  if(n>2)assert.ok(v.unavailable.some(s=>s.includes('Multiplayer')));
  if(n===2&&teamMode==='pairs')assert.ok(v.errors.some(s=>s.includes('single team')));
  const seats=E.seatAssignments(n,teamMode);assert.equal(seats.length,n);assert.equal(seats.filter(s=>s.human).length,1);assert.equal(seats[0].human,true);
 }
 assert.equal(checks,1296);
 console.log('Setup matrix (not multiplayer gameplay): '+JSON.stringify({checks,blocked,playable}));
});
