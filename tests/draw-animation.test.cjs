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

test('All deal destinations are measured once from the final hand layout',()=>{
 assert.match(app,/const measured=items\.map\(item=>\(\{\.\.\.item,rect:item\.node\.getBoundingClientRect\(\)\}\)\)/);
 assert.doesNotMatch(app,/advanceHandDeal|handDealLandingRects|activeHandDeal/);
 assert.match(app,/const human=handCards\.filter\(node=>incoming\.has\(node\.dataset\.cardId\)\)/);
});

// Run the actual deal-target builder and animation callbacks against
// mock DOM cards, including all hidden final destinations.
function dealHarness(playerCount,count,baseCount=0,reverse=false){
 const cw=55,ch=cw/.715,width=360,height=2*ch+16,left=10,top=100,inset=4;
 const style=()=>({setProperty(k,v){this[k]=v;}});
 const humanIds=Array.from({length:count},(_,i)=>'incoming'+i);
 const baseIds=Array.from({length:baseCount},(_,i)=>'base'+i);
 const ids=[...baseIds,...humanIds];if(reverse)ids.reverse();
 let shifts=0;
 const nodes=ids.map(id=>{
   const button={dataset:{id,action:'hand'},style:{...style(),left:'4px',top:'4px'},animate:()=>{shifts++;return {cancel(){}}}};
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
   'let pendingDeal=deal,pendingStockOrigin=null,motionGeneration=0;'+
   'const motionAllowed=()=>true,renderBack=()=>"<span></span>",animateLayout=()=>{};'+
   targetCode+layoutCode+
   'return {targets:()=>dealTargets(deal),begin:()=>{layoutHumanHand();hidePendingDealCards();return animateNewDeal(false);},'+
   'layout:layoutHumanHand,slots:()=>{const g=humanHandGeometry();return sortedHandSlots(planForHand(g.nodes.length,g));}};'
 )(host,doc,()=>({paddingLeft:'4px',paddingRight:'4px',columnGap:'4px'}),{getComputedStyle:true},deal);
 return {api,ghosts,nodes,faces,deal,shifts:()=>shifts,geometry:{width,cardWidth:cw,cardHeight:ch,gap:4,height,inset,lane},left,top};
}
test('Every player count attaches human IDs in final visual order, including sorted views',()=>{
 for(let players=2;players<=6;players++)for(const reverse of [false,true]){
  const h=dealHarness(players,14,0,reverse);
  const targets=h.api.targets(),human=targets.filter(t=>t.humanId);
  const expected=[...h.deal.humanIds];if(reverse)expected.reverse();
  assert.deepEqual(human.map(t=>t.humanId),expected);
  assert.ok(human.every(t=>t.faceUp&&t.node.dataset.cardId===t.humanId));
  assert.equal(targets.length,players*14);
  for(let i=0;i<14;i++)assert.equal(targets[(i+1)*players-1].humanId,expected[i]);
 }
});
const finish=async a=>{assert.ok(a&&a.onfinish);a.onfinish();await Promise.resolve();await Promise.resolve();};
function positions(h){return h.nodes.map(n=>[n.style.left,n.style.top,n.style.zIndex]);}
async function checkDeal(players,count,baseCount=0,reverse=false){
 const h=dealHarness(players,count,baseCount,reverse),targets=h.api.targets(),completion=h.api.begin();
 const fixed=positions(h),slots=h.api.slots();
 assert.equal(h.ghosts.length,players*count);
 const incoming=targets.filter(t=>t.humanId);
 assert.ok(incoming.every(t=>t.node.style.visibility==='hidden'));
 let arrived=0;
 for(let i=0;i<targets.length;i++){
  const item=targets[i],ghost=h.ghosts[i];
  await finish(ghost.steps[0]);
  if(!item.humanId)continue;
  const nodeIndex=h.nodes.findIndex(n=>n.dataset.id===item.humanId);
  const slot=slots[nodeIndex];
  const flight=ghost.steps[0].frames.at(-1).transform.match(/translate\(([-.\d]+)px,([-.\d]+)px\)/);
  assert.ok(flight);
  const landedX=parseFloat(ghost.style.left)+Number(flight[1]);
  const landedY=parseFloat(ghost.style.top)+Number(flight[2]);
  assert.ok(Math.abs(landedX-(h.left+h.geometry.inset+slot.x))<1e-7);
  assert.ok(Math.abs(landedY-(h.top+slot.y))<1e-7);
  assert.deepEqual(positions(h),fixed);
  await finish(ghost.steps[1]);assert.ok(ghost.face);
  await finish(ghost.steps[2]);arrived++;
  assert.equal(item.node.style.visibility,'');
  assert.equal(incoming.filter(t=>t.node.style.visibility==='').length,arrived);
  assert.deepEqual(positions(h),fixed);
 }
 await completion;
 h.api.layout();assert.deepEqual(positions(h),fixed);
 assert.equal(h.shifts(),0);
 assert.ok(h.ghosts.every(g=>g.removed));
}
test('Every hand size from 1 through 27 lands in fixed final positions without any subsequent rearrangement',async()=>{
 for(let count=1;count<=27;count++)await checkDeal(2,count);
});
test('Multiplayer and selected sorted views deal directly into their final positions',async()=>{
 for(const [players,count,reverse] of [[3,16,false],[4,12,false],[5,10,true],[6,8,true],[2,26,true]])await checkDeal(players,count,0,reverse);
});
test('Replacement draw uses the full final hand layout without shifting already landed cards',async()=>{
 for(const count of [1,6,12,25])await checkDeal(2,1,count);
});
