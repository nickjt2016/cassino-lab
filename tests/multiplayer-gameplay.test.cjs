const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../src/engine.js'),app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
function seeded(n){return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
const arrangements=[2,3,4,5,6].flatMap(n=>E.teamModesFor(n).map(teamMode=>({playerCount:n,teamMode})));
test('Play every competitive arrangement on 40, 52 and 54 cards, including unequal remainders',()=>{
 let deals=0,moves=0;
 for(const seats of arrangements)for(const deckMode of ['40','52','54']){
  const r=E.rulesFor('classic',{...seats,deckMode,remainderMode:'uneven',matchDeals:1});
  for(let seed=1;seed<=4;seed++){
   const random=seeded(seed),s=E.newMatch({...r,difficulty:seed%2?'casual':'thoughtful'},random),actors=new Set();
   let steps=0;
   while(s.phase==='playing'&&steps<E.makeDeck(r).length){
    assert.equal(E.checkInvariants(s),null);actors.add(s.turn);
    const m=E.chooseComputerMove(s,random);assert.equal(E.validateAction(s,m).ok,true);assert.equal(E.applyAction(s,m).ok,true);
    steps++;
   }
   assert.equal(s.phase,'gameOver');assert.equal(actors.size,seats.playerCount);assert.equal(E.checkInvariants(s),null);
   assert.equal(s.result.scores.length,seats.teamMode==='freeForAll'?seats.playerCount:seats.playerCount/(seats.teamMode==='pairs'?2:3));
   assert.equal(s.players.every(p=>!p.hand.length),true);deals++;moves+=steps;
  }
 }
 console.log('Multiplayer deck matrix: '+deals+' deals, '+moves+' legal moves.');
});
test('Vary deal mode, deck composition, initial table, hand size and build/capture policies for multiplayer',()=>{
 const random=seeded(98172),pick=a=>a[Math.floor(random()*a.length)],coin=()=>random()<.5;
 let completed=0,blocked=0;
 for(let i=0;i<160;i++){
  const seats=pick(arrangements),deckMode=pick(['40','52','54','custom']);
  const deckCards=E.allCards().filter(c=>random()<.55).map(c=>c.id);
  const rules=E.activeRules(E.rulesFor('classic',{...seats,deckMode,deckCards,dealMode:pick(['batch','draw','full']),remainderMode:pick(['equal','uneven','strict']),initialTableSize:pick([0,3,4,8]),handSize:pick([1,2,3,4,6]),matchDeals:1,builds:coin(),additiveBuilding:coin(),subtractiveBuilds:coin(),negativeBuilds:coin(),colorArithmetic:coin(),singleCardBuild:coin(),multipleBuilds:coin(),mergeSameValue:coin(),absorbMatching:coin(),pirateBuilds:coin(),pirateCaptures:coin(),allowTrailWithOwnBuild:coin(),buildAnything:coin(),raiseOwnBuild:coin(),raiseOpponentBuild:coin(),directCapture:true,additiveCapture:coin(),captureGroups:pick(['one','unlimited']),forcedCapture:pick(['optional','direct','all']),captureExtent:pick(['choice','maximal','maximum']),directPriority:coin(),extraAfterSweep:coin(),sweepPoints:pick([0,1,10]),sweepCancel:coin()}));
  const v=E.validateRules(rules);
  if(!v.playable){blocked++;continue;}
  const s=E.simulateRules(rules,2,900+i*2);assert.equal(s.completed,2,JSON.stringify(s.failures.map(x=>({seed:x.seed,reason:x.reason}))));
  completed+=s.completed;
 }
 assert.equal(completed,2*(160-blocked));console.log('Mixed multiplayer configurations: '+JSON.stringify({completed,blocked}));
});
test('Team score aggregates captures and sweep counts, ties award no majority points, and the dealer rotates',()=>{
 const s=E.newMatch(E.rulesFor('classic',{playerCount:6,teamMode:'pairs',sweepPoints:1,sweepCancel:true,matchDeals:2,remainderMode:'uneven'}));
 const deck=E.makeDeck(s.rules);
 s.players.forEach(p=>{p.captured=[];p.sweeps=0;p.hand=[];});s.stock=[];s.table=[];
 s.players[0].captured=deck.slice(0,10);s.players[3].captured=deck.slice(10,20);s.players[1].captured=deck.slice(20,35);s.players[2].captured=deck.slice(35);
 s.players[3].sweeps=4;s.players[1].sweeps=2;s.players[2].sweeps=1;
 const rows=E.scoreHand(s);assert.equal(rows.length,3);assert.equal(rows[0].cardCount,20);assert.equal(rows[0].cards,3);assert.equal(rows[0].sweeps,1);
 E.finishHand(s);assert.equal(s.phase,'roundOver');assert.equal(s.players[0].score,s.players[3].score);
 const next=E.nextHand(s);assert.equal(next.dealer,(s.dealer+1)%6);assert.deepEqual(next.players.map(p=>p.score),s.players.map(p=>p.score));
 const tied=E.newMatch(E.rulesFor('classic',{playerCount:4,teamMode:'freeForAll',remainderMode:'uneven'}));const pack=E.makeDeck(tied.rules);
 tied.players.forEach((p,i)=>{p.captured=pack.slice(i*13,(i+1)*13);});assert.ok(E.scoreHand(tied).every(row=>row.cards===0));
});
test('Public sampling hides every nonacting hand, preserves all build reservations, and Hard/Expert return legal moves',()=>{
 let moves=0;
 for(const seats of arrangements.filter(s=>s.playerCount>2))for(const difficulty of ['hard','expert']){
  const random=seeded(1934),s=E.newMatch(E.rulesFor('classic',{...seats,deckMode:'40',remainderMode:'uneven',difficulty,matchDeals:1}),random);
  while(s.phase==='playing'){
   const view=E.publicPosition(s);for(let i=0;i<s.players.length;i++)if(i!==s.turn)assert.equal(view.players[i].hand,undefined);
   const sample=E.samplePublicPosition(view,random);assert.ok(sample);assert.equal(E.checkInvariants(sample),null);
   const info=E.analyzeComputerMove(view,{random,now:()=>0,timeMs:1e6,maxNodes:100,maxRoots:30});
   assert.equal(E.validateAction(s,info.move).ok,true);assert.equal(E.applyAction(s,info.move).ok,true);moves++;
  }
  assert.equal(s.phase,'gameOver');
 }
 console.log('Multiplayer search: '+moves+' legal moves.');
});
test('Multiplayer browser controller targets the acting seat, and renders one score column per side',()=>{
 assert.match(app,/function renderCpuSeats\(\)/);
 assert.match(app,/data-cpu-seat/);
 assert.match(app,/data-seat-score/);
 assert.match(app,/game\.players\[actor\]\.hand\.find/);
 assert.match(app,/game\.turn===actor&&game\.moveNumber===startedMove/);
 assert.match(app,/if\(game\.players\.length>2\)return renderMultiplayerRound\(\)/);
 assert.match(app,/if \(game\.turn !== 0 && game\.phase === 'playing'\) botTurn\(\)/);
 assert.match(app,/pendingDeal\.cpuBySeat/);
});
