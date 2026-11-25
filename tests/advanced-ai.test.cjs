const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../src/engine.js');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const seeded=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const card=id=>({id,suit:id[0],rank:Number(id.slice(1))});
const key=m=>JSON.stringify([m.kind,m.cardId,[...m.targetIds].sort(),m.value,m.mode]);
function endgame(difficulty='expert'){
  const s=E.makeState(E.rulesFor('royal',{difficulty,pirateCaptures:true,pirateBuilds:true,allowTrailWithOwnBuild:true}),1,[10,11],2,seeded(1));
  s.turn=0;s.stock=[];s.players[0].hand=['H7','S4'].map(card);s.players[1].hand=['C8','D9'].map(card);
  s.table=[{id:'t1',type:'loose',card:card('D7')},{id:'t2',type:'loose',card:card('C4')},{id:'t3',type:'loose',card:card('S3')}];
  const used=new Set([...s.players.flatMap(p=>p.hand),...s.table.map(t=>t.card)].map(c=>c.id));
  const residue=E.makeDeck().filter(c=>!used.has(c.id));
  s.players[0].captured=residue.slice(0,22);s.players[1].captured=residue.slice(22);
  s.nextId=10;s.lastCapture=1;s.moveNumber=44;
  return s;
}
test('Public observation and seeded analysis do not reveal hidden hand or stock order',()=>{
  const s=E.newMatch(E.rulesFor('royal',{difficulty:'hard'}),seeded(7));
  const hidden=JSON.parse(JSON.stringify(s));
  const other=1-s.turn;
  const temp=hidden.players[other].hand[0];hidden.players[other].hand[0]=hidden.stock[0];hidden.stock[0]=temp;
  hidden.stock.reverse();
  const a=E.publicPosition(s),b=E.publicPosition(hidden);
  assert.deepEqual(a,b);assert.equal(a.players[other].hand,undefined);assert.equal(a.stock,undefined);
  const original=JSON.stringify(s);
  const opts=()=>({random:seeded(42),now:()=>0,timeMs:1000,maxNodes:3000});
  const x=E.analyzeComputerMove(a,opts()),y=E.analyzeComputerMove(b,opts());
  assert.deepEqual(x,y);
  assert.ok(E.validateAction(s,x.move).ok);
  assert.equal(JSON.stringify(s),original);
});
test('Sampled worlds reserve different physical cards for public independent builds',()=>{
  const s=E.newMatch(E.rulesFor('royal',{difficulty:'hard',pirateBuilds:true}),seeded(8));
  s.turn=0;s.players[0].hand=['S2','H3','C5','D6'].map(card);
  s.players[0].captured=[];s.players[1].captured=[];
  s.table=[{id:'a',type:'build',value:13,owner:1,groups:[['D1','D11','H1'].map(card)]},
    {id:'b',type:'build',value:13,owner:1,groups:[['C6','C7'].map(card)]}];
  s.players[1].hand=['D13','H13','S9','C10'].map(card);
  const used=new Set([...s.players.flatMap(p=>p.hand),...s.table.flatMap(E.cardsInElement)].map(c=>c.id));
  s.stock=E.makeDeck().filter(c=>!used.has(c.id));
  const view=E.publicPosition(s);
  for(let i=0;i<20;i++){
    const world=E.samplePublicPosition(view,seeded(i+1));
    assert.ok(world);
    assert.equal(world.players[1].hand.filter(c=>c.rank===13).length>=2,true);
    const all=[...world.stock,...world.players.flatMap(p=>[...p.hand,...p.captured]),...world.table.flatMap(E.cardsInElement)];
    assert.equal(all.length,52);assert.equal(new Set(all.map(c=>c.id)).size,52);
  }
});
test('All distinct legal actions are generated on a small mixed build position',()=>{
  const s=endgame();
  s.rules.buildAnything=true;s.rules.royalAces=true;s.rules.royalBigLittle=true;
  s.players[0].hand=['C1','H13','S4'].map(card);
  s.table=[{id:'a',type:'build',owner:0,value:13,groups:[['H6','D7'].map(card)]},
    {id:'b',type:'build',owner:1,value:12,groups:[['S9','D3'].map(card)]},
    {id:'c',type:'loose',card:card('C4')},{id:'d',type:'loose',card:card('S8')}];
  const expected=new Set();
  for(const c of s.players[s.turn].hand)for(let mask=0;mask<2**s.table.length;mask++){
    const ids=s.table.filter((_,i)=>mask&(1<<i)).map(t=>t.id);
    const move={kind:ids.length?'capture':'trail',cardId:c.id,targetIds:ids};
    if(E.validateAction(s,move).ok)expected.add(key(move));
    for(const b of E.legalBuildOptions(s,c.id,ids))expected.add(key(b));
  }
  const actual=[...E.legalActions(s)].map(key);
  assert.deepEqual(actual.slice().sort(),[...expected].sort());
  assert.equal(new Set(actual).size,actual.length);
});
test('Expert can solve a small exhausted-stock endgame against a brute-force oracle',()=>{
  const s=endgame(),root=s.turn;
  const world=E.samplePublicPosition(E.publicPosition(s),seeded(2));
  assert.deepEqual(world.players[1].hand.map(c=>c.id).sort(),s.players[1].hand.map(c=>c.id).sort());
  const recurse=(state)=>{
    if(state.phase!=='playing')return E.strategicValue(state,root);
    const values=[...E.legalActions(state)].map(move=>{
      const next=JSON.parse(JSON.stringify(state));assert.ok(E.applyAction(next,move).ok);return recurse(next);
    });
    return state.turn===root?Math.max(...values):Math.min(...values);
  };
  const result=E.analyzeComputerMove(E.publicPosition(s),{random:seeded(9),now:()=>0,maxNodes:100000,timeMs:1000});
  assert.equal(result.exact,true);assert.equal(result.completedDepth,4);
  const next=JSON.parse(JSON.stringify(s));assert.ok(E.applyAction(next,result.move).ok);
  assert.equal(recurse(next),recurse(s));
});
test('Hard and Expert respect a strict node budget and return legal fallback moves',()=>{
  for(const difficulty of ['hard','expert']){
    const s=E.newMatch(E.rulesFor('royal',{difficulty,buildAnything:true}),seeded(4));
    const result=E.analyzeComputerMove(E.publicPosition(s),{random:seeded(3),now:()=>0,timeMs:1000,maxNodes:7});
    assert.ok(result.nodes<=7);
    assert.ok(E.validateAction(s,result.move).ok);
  }
});
test('Worker gets only the public view and cancels obsolete searches',async()=>{
  const start=app.indexOf('  let activeBotSearch=null;'),end=app.indexOf('  function botTurn()',start);
  let sent=null,terminated=0,revoked=0;const workers=[];
  const Worker=function(){workers.push(this);this.postMessage=value=>sent=value;this.terminate=()=>terminated++;};
  const Blob=function(parts){this.parts=parts;};
  const URL={createObjectURL:()=>'blob:worker',revokeObjectURL(){revoked++;}};
  const doc={scripts:[{textContent:'/* engine */'}]};
  const api=new Function('E','Worker','Blob','URL','document','setTimeout','clearTimeout',
    app.slice(start,end)+';return {request:requestAdvancedMove,cancel:cancelComputerSearch};')
    (E,Worker,Blob,URL,doc,()=>1,()=>{});
  const s=E.newMatch(E.rulesFor('royal',{difficulty:'hard'}),seeded(6));
  const pending=api.request(s);
  assert.deepEqual(sent,E.publicPosition(s));assert.equal(sent.players[1-s.turn].hand,undefined);
  api.cancel();assert.equal(await pending,null);assert.equal(terminated,1);assert.equal(revoked,1);
  const next=api.request(s);const move=E.quickLegalMove(s);workers[1].onmessage({data:{move}});
  assert.deepEqual(await next,move);assert.equal(terminated,2);assert.equal(revoked,2);
});

test('Search reports completed iterations without changing its selected result',()=>{
  const s=endgame(),published=[];
  const options=()=>({random:seeded(9),now:()=>0,maxNodes:100000,timeMs:1000});
  const ordinary=E.analyzeComputerMove(E.publicPosition(s),options());
  const streamed=E.analyzeComputerMove(E.publicPosition(s),{...options(),onProgress:move=>published.push(move)});
  assert.deepEqual(streamed,ordinary);
  assert.ok(published.length>=2);
  assert.deepEqual(published.at(-1),streamed.move);
  assert.ok(published.every(move=>E.validateAction(s,move).ok));
});
test('Prepared turn launches once, reuses its worker, and takes the latest completed move at deadline',async()=>{
  const start=app.indexOf('  let activeBotSearch=null;'),end=app.indexOf('  function botTurn()',start);
  let terminated=0,revoked=0;const workers=[];
  const Worker=function(){workers.push(this);this.postMessage=view=>this.view=view;this.terminate=()=>terminated++;};
  const Blob=function(parts){this.parts=parts;};
  const URL={createObjectURL:()=>'blob:worker',revokeObjectURL(){revoked++;}};
  const doc={scripts:[{textContent:'/* engine */'}]};
  const s=E.newMatch(E.rulesFor('royal',{difficulty:'expert'}),seeded(6));
  s.turn=1;
  const api=new Function('E','Worker','Blob','URL','document','setTimeout','clearTimeout','game',
    "let screen='game',motionGeneration=0;\n"+app.slice(start,end)+
    ';return {prepare:prepareComputerTurn,cancel:cancelComputerSearch,take:()=>activeBotSearch?.take(),next:()=>{motionGeneration++;}};')
    (E,Worker,Blob,URL,doc,()=>1,()=>{},s);
  const pending=api.prepare();
  assert.equal(workers.length,1);
  assert.equal(api.prepare(),pending);
  assert.equal(workers[0].view.players[0].hand,undefined);
  const moves=E.allComputerMoves(s);
  const move=moves.at(-1);
  workers[0].onmessage({data:{move,progress:true}});
  assert.equal(terminated,0,'progress does not end the search');
  api.take();
  assert.deepEqual(await pending.promise,move);
  assert.equal(terminated,1);assert.equal(revoked,1);
  api.next();const next=api.prepare();
  assert.equal(workers.length,2);
  api.cancel();
  assert.equal(await next.promise,null);
  assert.equal(terminated,2);assert.equal(revoked,2);
});
test('Every difficulty can execute in the public-information worker',async()=>{
  const engine=fs.readFileSync(path.join(__dirname,'../src/engine.js'),'utf8');
  const start=app.indexOf('  let activeBotSearch=null;'),end=app.indexOf('  function botTurn()',start);
  let source,posted;
  const Blob=function(parts){this.source=parts.join('');};
  const URL={createObjectURL:blob=>{source=blob.source;return 'blob:worker';},revokeObjectURL(){}};
  const Worker=function(){
    const worker=this,scope={postMessage:data=>worker.onmessage({data})};
    new Function('globalThis','self',source)(scope,scope);
    this.postMessage=view=>{posted=view;scope.onmessage({data:view});};
    this.terminate=()=>{};
  };
  const api=new Function('E','Worker','Blob','URL','document','setTimeout','clearTimeout',
    app.slice(start,end)+';return requestAdvancedMove;')(E,Worker,Blob,URL,{scripts:[{textContent:engine}]},()=>1,()=>{});
  for(const difficulty of ['casual','thoughtful','hard','expert']){
    const state=E.newMatch(E.rulesFor('classic',{difficulty}),seeded(19));
    const move=await api(state);
    assert.ok(E.validateAction(state,move).ok);
    assert.equal(posted.players[1-state.turn].hand,undefined);
    assert.equal(posted.stock,undefined);
  }
});
