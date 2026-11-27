const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'src/app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/compact.css'),'utf8');

test('Draw-mode replacement stays hidden until a face-down card travels from stock and flips on landing',()=>{
  assert.match(app,/function hidePendingDealCards\(\)/);
  assert.match(app,/node\.style\.visibility='hidden'/);
  assert.match(app,/const start=pendingStockOrigin/);
  assert.match(app,/ghost\.innerHTML=renderBack\(\)/);
  assert.match(app,/const face=node\.cloneNode\(true\)/);
  assert.match(app,/if\(faceUp\)/);
  assert.match(app,/dealAnimation = animateNewDeal/);
  assert.match(app,/Promise\.resolve\(dealAnimation\)\.then/);
});

test('Build piles align vertically and table is not cluttered with a sweep-clear caption',()=>{
  assert.match(css,/--stack-splay:0px!important/);
  assert.match(css,/transform:translateY\(calc\(var\(--layer\)\*var\(--stack-step\)\)\)!important/);
  assert.doesNotMatch(app,/Table cleared/);
});

test('Human flights land in incremental slots and move only the already-dealt hand cards',()=>{
 assert.match(app,/const landingRects=progress\?handDealLandingRects\(progress,geometry\)/);
 assert.match(app,/rect:landingRects\.get\(item\.humanId\)\|\|item\.node\.getBoundingClientRect\(\)/);
 assert.match(app,/if\(humanId&&progress\)advanceHandDeal\(progress,humanId,true\);/);
 assert.match(app,/if\(!previous\.has\(node\.dataset\.id\)\)continue/);
 assert.match(app,/activeHandDeal=null;\s*\/\/ The ordinary next-turn render sorts/);
});


// Exercise the real deal target builder and animation callbacks, not just
// the hand geometry in isolation. A hidden face starts at its CSS default
// position, so a missing humanId reproduces the reported single-stack bug.
function dealHarness(playerCount,count,baseCount=0){
 const cw=55,ch=cw/.715,width=360,height=2*ch+16,left=10,top=100,inset=4;
 const style=()=>({setProperty(k,v){this[k]=v;}});
 const humanIds=Array.from({length:count},(_,i)=>'incoming'+i);
 const baseIds=Array.from({length:baseCount},(_,i)=>'base'+i);
 const nodes=[...baseIds,...humanIds].reverse().map(id=>{
   const button={dataset:{id,action:'hand'},style:{...style(),left:'4px',top:'4px'},animate:()=>({cancel(){}})};
   const face={dataset:{cardId:id},style:style(),isConnected:true,animate(){},cloneNode:()=>({style:style()})};
   button.getBoundingClientRect=face.getBoundingClientRect=()=>({left:left+parseFloat(button.style.left),top:top+parseFloat(button.style.top),width:cw,height:ch});
   button.querySelector=()=>face;
   return button;
 });
 const faces=nodes.map(n=>n.querySelector());
 const cpu=Array.from({length:playerCount-1},()=>Array.from({length:count},()=>({style:style(),isConnected:true,animate(){},getBoundingClientRect:()=>({left:20,top:10,width:24,height:34})})));
 const lane={clientWidth:width+2*inset,clientHeight:height,querySelectorAll:()=>nodes,getBoundingClientRect:()=>({left,top})};
 const stock={getBoundingClientRect:()=>({left:180,top:380,width:24,height:34})};
 const ghosts=[];
 const doc={body:{appendChild(ghost){ghosts.push(ghost);}},createElement(){
   return {style:style(),steps:[],querySelector:()=>null,getAnimations:()=>[],remove(){this.removed=true;},
     replaceChildren(face){this.face=face;},animate(frames,options){const a={frames,options};this.steps.push(a);return a;}};
 }};
 const host={querySelector:s=>s==='.human-hand'?lane:s==='.draw-stock .stock-back'?stock:null,
   querySelectorAll:s=>s.includes('data-cpu-seat')?cpu[Number(s.match(/"(\d+)"/)[1])-1]:
     s==='.human-hand .playing-card[data-card-id]'?faces:s==='.opponent-hand .card-back'?cpu.flat():[]};
 const deal={humanIds,cpuIndices:Array.from({length:count},(_,i)=>i),tableIds:[]};
 if(playerCount>2)deal.cpuBySeat=cpu.map(row=>row.map((_,i)=>i));
 const targetCode=app.slice(app.indexOf('  function dealTargets('),app.indexOf('  // The next player becomes interactive'));
 const layoutCode=app.slice(app.indexOf('  function sortedHandSlots('),app.indexOf('  // Size actual cards'));
 const api=new Function('app','document','getComputedStyle','globalThis','deal',
   'let pendingDeal=deal,activeHandDeal=null,pendingStockOrigin=null,motionGeneration=0;'+
   'const motionAllowed=()=>true,renderBack=()=>"<span></span>",animateLayout=()=>{};'+
   targetCode+layoutCode+
   'return {targets:()=>dealTargets(deal),begin:()=>{layoutHumanHand();hidePendingDealCards();return animateNewDeal(false);},'+
   'progress:()=>activeHandDeal,slots:dealHandSlots};'
 )(host,doc,()=>({paddingLeft:'4px',paddingRight:'4px',columnGap:'4px'}),{getComputedStyle:true},deal);
 return {api,ghosts,nodes,faces,deal,geometry:{width,cardWidth:cw,cardHeight:ch,gap:4,height,inset,lane},left,top};
}
test('All player counts attach real human card IDs to flight targets in deal order',()=>{
 for(let players=2;players<=6;players++){
  const h=dealHarness(players,14);
  const targets=h.api.targets(),human=targets.filter(t=>t.humanId);
  assert.deepEqual(human.map(t=>t.humanId),h.deal.humanIds);
  assert.ok(human.every(t=>t.faceUp&&t.node.dataset.cardId===t.humanId));
  assert.equal(targets.length,players*14);
  for(let i=0;i<14;i++)assert.equal(targets[(i+1)*players-1].humanId,h.deal.humanIds[i]);
 }
});
test('Real two-player deal lands and flips each card before the next human landing, across both rows',async()=>{
 const h=dealHarness(2,26);
 const targets=h.api.targets();
 const completion=h.api.begin();
 assert.equal(h.ghosts.length,52);
 assert.ok(h.faces.every(n=>n.style.visibility==='hidden'));
 const finish=async a=>{assert.ok(a&&a.onfinish);a.onfinish();await Promise.resolve();await Promise.resolve();};
 for(let i=0;i<targets.length;i++){
  const item=targets[i],ghost=h.ghosts[i];
  await finish(ghost.steps[0]);
  if(!item.humanId)continue;
  const dealt=h.deal.humanIds.indexOf(item.humanId)+1;
  assert.equal(h.api.progress().arrived,dealt);
  const slots=h.api.slots([],h.deal.humanIds.slice(0,dealt),h.geometry);
  const slot=slots.get(item.humanId);
  assert.equal(slot.row,dealt<=6?0:dealt<=12?1:(dealt-13)%2);
  const flight=ghost.steps[0].frames.at(-1).transform.match(/translate\(([-.\d]+)px,([-.\d]+)px\)/);
  assert.ok(flight);
  const landedX=Number.parseFloat(ghost.style.left)+Number(flight[1]);
  const landedY=Number.parseFloat(ghost.style.top)+Number(flight[2]);
  assert.ok(Math.abs(landedX-(h.left+h.geometry.inset+slot.x))<1e-7);
  assert.ok(Math.abs(landedY-(h.top+slot.y))<1e-7);
  for(const n of h.nodes){
   const p=slots.get(n.dataset.id);
   if(p){
    assert.ok(Math.abs(parseFloat(n.style.left)-h.geometry.inset-p.x)<1e-7);
    assert.ok(Math.abs(parseFloat(n.style.top)-p.y)<1e-7);
   }else assert.equal(n.querySelector().style.visibility,'hidden');
  }
  await finish(ghost.steps[1]);
  assert.ok(ghost.face,'each arriving card flips to a face before the next landing');
  await finish(ghost.steps[2]);
  assert.equal(item.node.style.visibility,'');
  assert.equal(h.faces.filter(n=>n.style.visibility==='').length,dealt);
 }
 await completion;
 assert.equal(h.api.progress(),null);
 assert.ok(h.ghosts.every(g=>g.removed));
});
test('A real two-player replacement draw has its own incremental landing slot',async()=>{
 const h=dealHarness(2,1,12),completion=h.api.begin();
 const target=h.api.targets().find(t=>t.humanId),ghost=h.ghosts[1];
 const finish=async a=>{assert.ok(a&&a.onfinish);a.onfinish();await Promise.resolve();await Promise.resolve();};
 await finish(h.ghosts[0].steps[0]);
 await finish(ghost.steps[0]);
 assert.equal(h.api.progress().arrived,1);
 const p=h.api.slots(h.api.progress().baseIds,h.deal.humanIds,h.geometry).get(target.humanId);
 assert.equal(p.row,0);assert.equal(p.col,6);
 await finish(ghost.steps[1]);await finish(ghost.steps[2]);await completion;
 assert.equal(target.node.style.visibility,'');
});
