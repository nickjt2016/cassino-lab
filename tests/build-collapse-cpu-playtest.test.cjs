const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../src/engine.js');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../src/compact.css'),'utf8');
const section=(a,b)=>app.slice(app.indexOf(a),app.indexOf(b,app.indexOf(a)+a.length));
const card=id=>E.allCards().find(c=>c.id===id);
function position(overrides={}){
 const s=E.newMatch(E.rulesFor('classic',{buildAnything:true,pirateBuilds:true,pirateCaptures:true,allowTrailWithOwnBuild:true,forcedCapture:'optional',...overrides}),()=>.6);
 s.turn=1;s.players[0].hand=[card('D9')];s.players[1].hand=['S4','H4','S8','D8','C2','H7'].map(card);
 s.table=[{id:'t1',type:'loose',card:card('C4')},{id:'t2',type:'loose',card:card('D4')},{id:'t3',type:'loose',card:card('H8')},
 {id:'b1',type:'build',owner:0,value:8,groups:[[card('S3'),card('D5')]]}];
 return s;
}
test('CPU restrictions filter moves independently and never change human move legality',()=>{
 const s=position();
 const unrestricted=E.allComputerMoves(s);
 assert.ok(unrestricted.some(m=>m.kind==='capture'));
 assert.ok(unrestricted.some(m=>m.kind==='build'));
 const multi=unrestricted.find(m=>m.kind==='build'&&E.validateAction(s,m).build.groups.length>1);
 assert.ok(multi,'fixture includes a legal multiple build');
 for(let mask=0;mask<8;mask++){
  const limits={noCapture:!!(mask&1),noBuild:!!(mask&2),noMultiBuild:!!(mask&4)};
  const chosen=E.choosePlaytestMove(s,limits,()=>.5);
  const quick=E.quickPlaytestMove(s,limits);
  for(const m of [chosen,quick,...E.allComputerMoves(s,500,limits)]){
   assert.ok(E.validateAction(s,m).ok);assert.ok(E.cpuPlaytestAllowed(s,m,limits));
   if(limits.noCapture)assert.notEqual(m.kind,'capture');
   if(limits.noBuild)assert.notEqual(m.kind,'build');
   if(limits.noMultiBuild&&m.kind==='build')assert.equal(E.validateAction(s,m).build.groups.length,1);
  }
  assert.ok(E.validateAction(s,multi).ok,'testing limits never modify the underlying rules');
 }
 assert.equal(E.cpuPlaytestAllowed(s,multi,{noMultiBuild:true}),false);
});
test('No multi builds includes extensions, not just a move whose mode is multiple',()=>{
 const s=position();
 const extendsBuild=E.allComputerMoves(s).find(m=>m.kind==='build'&&m.targetIds.includes('b1')&&E.validateAction(s,m).build.groups.length>1);
 assert.ok(extendsBuild);
 assert.equal(E.cpuPlaytestAllowed(s,extendsBuild,{noMultiBuild:true}),false);
 const singles=E.allComputerMoves(s,500,{noMultiBuild:true}).filter(m=>m.kind==='build');
 assert.ok(singles.length);
 assert.ok(singles.every(m=>E.validateAction(s,m).build.groups.length===1));
});
test('Impossible temporary restrictions stop legally and can be removed',()=>{
 const s=position({forcedCapture:'direct'});
 s.players[1].hand=[card('S4')];s.table=[{id:'t1',type:'loose',card:card('C4')}];
 assert.ok(E.validateAction(s,{kind:'capture',cardId:'S4',targetIds:['t1']}).ok);
 assert.throws(()=>E.choosePlaytestMove(s,{noCapture:true,noBuild:true}),/CPU playtest restrictions leave no legal move/);
 assert.throws(()=>E.quickPlaytestMove(s,{noCapture:true,noBuild:true}),/Change the temporary restrictions in Settings/);
 assert.equal(E.quickPlaytestMove(s,{noBuild:true}).kind,'capture');
});
test('Worker rejects forbidden answers, receives only public information and supplies a legal allowed fallback',async()=>{
 const s=position({difficulty:'expert'}),prefs={cpuPlaytest:{noCapture:true,noBuild:true}};
 let worker,sent;
 const Worker=function(){worker=this;this.postMessage=value=>sent=value;this.terminate=()=>{};};
 const Blob=function(){};
 const URL={createObjectURL:()=>'blob:test',revokeObjectURL(){}};
 const source=section('  let activeBotSearch=null;','  function botTurn()');
 const request=new Function('E','prefs','Worker','Blob','URL','document','setTimeout','clearTimeout',source+';return requestAdvancedMove;')(E,prefs,Worker,Blob,URL,{scripts:[{textContent:'engine'}]},()=>1,()=>{});
 const result=request(s);
 assert.deepEqual(sent.cpuPlaytest,prefs.cpuPlaytest);
 assert.equal(sent.players[0].hand,undefined);
 assert.equal(sent.stock,undefined);
 const forbidden=E.allComputerMoves(s).find(m=>m.kind==='capture');
 worker.onmessage({data:{move:forbidden}});
 const chosen=await result;
 assert.equal(chosen.kind,'trail');assert.ok(E.validateAction(s,chosen).ok);
});
test('Temporary settings are independent toggles and expose recovery when a CPU is blocked',()=>{
 const render=new Function('prefs',section('  function renderCpuPlaytestOptions()','  function renderSettings()')+'return renderCpuPlaytestOptions;')({cpuPlaytest:{noMultiBuild:true}});
 const html=render();
 assert.match(html,/CPU playtesting \(temporary\)/);
 for(const key of ['noCapture','noBuild','noMultiBuild'])assert.match(html,new RegExp('data-key="'+key+'"'));
 assert.match(html,/data-key="noMultiBuild" aria-pressed="true"/);
 assert.match(app,/renderAllRules\(\)\+renderCpuPlaytestOptions\(\)/);
 assert.match(app,/prefs\.cpuPlaytest=\{\.\.\.prefs\.cpuPlaytest,\[key\]:!prefs\.cpuPlaytest\?\.\[key\]\}/);
 assert.match(app,/if\(screen==='game'&&!busy&&game\.phase==='playing'&&game\.turn!==0\)\{toast='';botTurn\(\);\}/);
});
function buildFixture(){
 const s=position(),pickedTable=new Set(['b1']);
 const source=section('  function renderCard(','  function isHumanTurn()');
 const f=new Function('E','game','pickedTable','escapeHtml','suitClass','prettyRank','prettySuit','app','document','globalThis',source+';return {markup:entryMarkup,collapse:buildsNeedCollapse,layout:layoutBuilds,inspect:syncBuildInspections};');
 return {source,s,pickedTable,f};
}
test('Build summaries show owner, value, single/multi and the real number of cards',()=>{
 const {f,s,pickedTable}=buildFixture();
 const h=f(E,s,pickedTable,String,()=>'',c=>c.rank,c=>c.suit,{}, {}, {});
 const single=h.markup(s.table.at(-1));
 assert.match(single,/class="build-summary card-selected"/);
 assert.match(single,/build-summary-owner build-value-owner">You<\/span><strong class="build-value-number">8<\/strong><span class="build-summary-detail">Single<\/span><span class="build-summary-detail">2 cards<\/span>/);
 const build={...s.table.at(-1),owner:1,groups:[[card('S3'),card('D5')],[card('C8')]]};
 const multi=h.markup(build);
 assert.match(multi,/build-summary-owner build-value-owner">Computer<\/span><strong class="build-value-number">8<\/strong><span class="build-summary-detail">Multi<\/span><span class="build-summary-detail">3 cards<\/span>/);
 assert.equal((multi.match(/class="playing-card /g)||[]).length,3);
 assert.equal(h.collapse([90],100,5),false);
 assert.equal(h.collapse([101],100,5),true);
 assert.equal(h.collapse([90,90],185,5),false);
 assert.equal(h.collapse([90,90,90],185,5),true);
});
test('Two-column packing keeps the maximum number of full piles and fills the right column first',()=>{
 const source=section('  function planBuildColumns(','  function layoutBuilds(');
 const plan=new Function(source+';return planBuildColumns;')();
 const pile=cards=>({cards,height:80+(cards-1)*20});
 const arrange=(cards,height)=>plan(cards.map(pile),height,80,5);
 const check=(r,height)=>{
   for(let c=0;c<r.columns;c++){
     const slots=r.slots.filter(s=>s.column===c);
     for(let i=0;i<slots.length;i++){
       assert.ok(slots[i].y+slots[i].height<=height+1e-6);
       if(i)assert.ok(slots[i].y>=slots[i-1].y+slots[i-1].height);
     }
   }
 };
 let r=arrange([8],180);
 assert.equal(r.columns,1);assert.ok(r.slots[0].collapsed);
 r=arrange([3,3],180);
 assert.equal(r.columns,2);assert.ok(r.slots.every(s=>!s.collapsed));
 r=arrange([4,3,2],230);
 assert.equal(r.slots.filter(s=>s.column===0).length,2);
 assert.ok(r.slots.every(s=>!s.collapsed));
 r=arrange([6,4,3],220);
 assert.ok(r.slots[0].collapsed);assert.equal(r.slots.filter(s=>s.collapsed).length,1);assert.equal(r.scale,1);
 r=arrange([2,2,2,2,2],150);
 assert.ok(r.scale<1);assert.ok(r.slots.every(s=>s.collapsed));check(r,150);
 r=arrange([2,2],220);
 assert.equal(r.columns,1);assert.ok(r.slots.every(s=>!s.collapsed));
 for(let n=1;n<=28;n++)for(let h=35;h<410;h+=13)check(arrange(Array.from({length:n},(_,i)=>1+(i*7+n)%12),h),h);
 assert.match(css,/width:calc\(100% - var\(--build-lane\)\*var\(--build-columns\)\)!important/);
 assert.match(css,/right:calc\(2px \+ var\(--build-lane\)\*var\(--build-column,0\)\)/);
});
test('Tighten the spread to keep the screenshot pair in one column',()=>{
 const plan=new Function(section('  function planBuildColumns(','  function layoutBuilds(')+';return planBuildColumns;')();
 // The four-card and two-card stacks are about 147 and 103 CSS pixels.
 const p=[{cards:4,height:147},{cards:2,height:103}];
 const tight=plan(p,244,81,5);
 assert.equal(tight.columns,1);
 assert.ok(tight.slots.every(s=>!s.collapsed));
 assert.ok(tight.slots.reduce((sum,s)=>sum+s.savedHeight,0)>=11-1e-7);
 const loose=plan(p,276,81,5);
 assert.equal(loose.columns,1);
 assert.ok(loose.slots.every(s=>s.savedHeight<1e-7));
 assert.match(css,/height:94%;max-height:94%;top:52%!important/);
});

test('Measure the whole shoulder index and reserve a pixel below it',()=>{
 const measure=new Function(section('  function buildStackGeometry(','  function planBuildColumns(')+';return buildStackGeometry;')();
 const face=(top,bottom)=>({getBoundingClientRect:()=>({top,height:84}),querySelector:()=>({getBoundingClientRect:()=>({bottom})})});
 const pile={getBoundingClientRect:()=>({width:60,height:128}),style:{getPropertyValue:()=>'3'},
   querySelectorAll:()=>[face(20,36.1),face(42,58.65),face(64,79)]};
 const p=measure(pile);
 assert.equal(p.cardHeight,84);
 assert.equal(p.cards,3);
 assert.equal(p.minStep,17.75);
});
test('Growing the filmed nine-card build to eleven tightens before collapsing',()=>{
 const plan=new Function(section('  function planBuildColumns(','  function layoutBuilds(')+';return planBuildColumns;')();
 const pile=cards=>({cards,width:60,cardHeight:84,height:84+(cards-1)*22,minStep:16.5});
 const before=plan([pile(9)],260,84,5);
 assert.equal(before.slots[0].step,22);
 const after=plan([pile(11)],260,84,5);
 assert.equal(after.columns,1);
 assert.ok(!after.slots[0].collapsed);
 assert.ok(Math.abs(after.slots[0].step-17.6)<1e-8);
 assert.ok(Math.abs(after.slots[0].savedHeight-44)<1e-8);
 assert.ok(after.slots[0].step>=16.5);
 const impossible=plan([pile(11)],240,84,5);
 assert.ok(impossible.slots[0].collapsed);
});
test('Use newly freed column height, borrow the second column only when necessary, and restore spacing',()=>{
 const plan=new Function(section('  function planBuildColumns(','  function layoutBuilds(')+';return planBuildColumns;')();
 const pile=cards=>({cards,width:60,cardHeight:84,height:84+(cards-1)*22,minStep:16.5});
 const piles=[pile(6),pile(3)];
 const one=plan(piles,290,84,5);
 assert.equal(one.columns,1);
 assert.ok(one.slots.every(s=>!s.collapsed&&s.step>=16.5&&s.step<=22));
 assert.ok(Math.abs(one.slots[1].y+one.slots[1].height-290)<1e-7);
 const two=plan(piles,270,84,5);
 assert.equal(two.columns,2);
 assert.ok(two.slots.every(s=>!s.collapsed&&s.step===22));
 const tightTwo=plan([pile(9),pile(9)],240,84,5);
 assert.equal(tightTwo.columns,2);
 assert.ok(tightTwo.slots.every(s=>!s.collapsed&&s.step>=16.5&&s.step<22));
 const released=plan([pile(6)],290,84,5);
 assert.equal(released.slots[0].step,22);
 assert.match(app,/style.setProperty\('--stack-step',slot.step\+'px'\)/);
 assert.match(app,/style.removeProperty\('--stack-step'\)/);
});

test('Full ribbon keeps every card inside the felt; normal sizes and spacing are preserved when possible',()=>{
 const geometry=new Function(section('  function buildInspectionGeometry(','  function syncBuildInspections(')+';return buildInspectionGeometry;')();
 const bounds={left:10,top:20,width:350,height:300};
 const box=(left,top,width=60,height=84)=>({left,top,width,height,bottom:top+height});
 let g=geometry(box(200,160),bounds,{width:60,height:60/.715+3*20},4);
 assert.equal(g.width,60);assert.equal(g.step,20);
 assert.ok(Math.abs(g.top+g.height-224)<1e-8);
 g=geometry(box(200,25),bounds,{width:60,height:60/.715+3*20},4);
 assert.equal(g.top,0);assert.equal(g.width,60);
 for(const H of [130,240,300,540,750])for(const W of [240,350,800])for(let n=1;n<=54;n++){
   const b={...bounds,width:W,height:H},a=box(170,80,48,48/.715);
   const result=geometry(a,b,{width:60,height:60/.715+(n-1)*22},n);
   assert.ok(result.height<=H+1e-7);
   assert.ok(result.left>=0&&result.left+result.width<=W+1e-7);
   assert.ok(result.top>=0&&result.top+result.height<=H+1e-7);
   assert.ok(Math.abs(result.cardHeight+(n-1)*result.step-result.height)<1e-7);
   if(n>1)assert.ok(result.step>=result.width*.34-1e-7,'all rank/suit shoulders exposed');
   assert.equal('scrollTop' in result,false);
 }
 const first=geometry(box(200,160),bounds,{width:60,height:164},5);
 const second=geometry(box(200,170),bounds,{width:60,height:164},5,[first]);
 assert.ok(first.left+first.width<=second.left||second.left+second.width<=first.left);
 assert.match(css,/build-summary \.build-value-number\{\s*font:700[^;]+Georgia/);
 assert.match(css,/\.shell \.build-inspection\{\s*display:block;max-height:none;max-width:none;overflow:visible/);
 assert.match(css,/\.shell \.build-inspection \.build-layer\{\s*top:calc\(var\(--layer\)\*var\(--stack-step\)\);transform:none!important/);
 assert.match(app,/<\/div>\s*<div class="build-inspections"[^>]*><\/div>\s*<div class="turn-action-area">/);
});
test('Ribbon tracks begin each individual card at the same black box and end at distinct vertical slots',()=>{
 const api=new Function(section('  function buildInspectionGeometry(','  function syncBuildInspections(')+';return {geometry:buildInspectionGeometry,tracks:buildRibbonTracks};')();
 const bounds={left:10,top:20,width:350,height:540};
 for(const top of [25,200,450])for(const n of [1,2,11,27,52]){
  const a={left:270,top,width:48,height:48/.715,bottom:top+48/.715};
  const g=api.geometry(a,bounds,{width:60,height:60/.715+(n-1)*22},n);
  const {duration,tracks}=api.tracks(g,n);
  assert.equal(tracks.length,n);
  assert.ok(duration>=235&&duration<=375+1e-8);
  const movementOffsets=[];
  tracks.forEach((frames,i)=>{
   const [dx,dy]=frames[0].translate.split(' ').map(parseFloat);
   assert.ok(Math.abs(bounds.left+g.left+dx-a.left)<1e-7);
   assert.ok(Math.abs(bounds.top+g.top+i*g.step+dy-a.top)<1e-7);
   const [sx,sy]=frames[0].scale.split(' ').map(Number);
   assert.ok(Math.abs(g.width*sx-a.width)<1e-7);
   assert.ok(Math.abs(g.cardHeight*sy-a.height)<1e-7);
   assert.equal(frames.at(-1).translate,'0px 0px');assert.equal(frames.at(-1).scale,'1 1');
   assert.equal(frames.at(-1).offset,1);
   const move=frames.find(f=>f.easing);
   movementOffsets.push(move.offset);
   assert.ok(frames.every((f,j)=>j===0||f.offset>=frames[j-1].offset));
   assert.ok(frames.every(f=>!('clipPath' in f)));
  });
  assert.equal(new Set(movementOffsets).size,n);
 }
});
function ribbonHarness(animate=true,count=11){
 const {source,s,pickedTable}=buildFixture();
 const classes=initial=>{const set=new Set(initial);return {contains:x=>set.has(x),add:x=>set.add(x),remove:x=>set.delete(x)}};
 const style=()=>({setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}});
 const box={left:270,top:160,bottom:244,width:60,height:84};
 const motions=[];
 const layers=Array.from({length:count},(_,i)=>({animate(frames,options){
    let resolve;const m={i,frames,options,playbackRate:1,reversals:0,
     reverse(){this.playbackRate*=-1;this.reversals++;this.finished=new Promise(r=>resolve=r);},
     cancel(){resolve?.();},finish(){resolve?.();},
     settle(){resolve?.();}};
    m.finished=new Promise(r=>resolve=r);motions.push(m);return m;
 }}));
 const clone={style:style(),querySelectorAll:()=>layers,
    getBoundingClientRect:()=>({width:60,height:60/.715+(count-1)*22})};
 const pile={cloneNode:()=>clone};
 const item={dataset:{id:'b1'},disabled:false,getAttribute:()=> 'Build 1',
   classList:classes(['is-collapsed','selected']),
   querySelector:sel=>sel==='.build-pile'?pile:{getBoundingClientRect:()=>box}};
 let selected=true;
 const lane={querySelectorAll:()=>selected?[item]:[]};
 const rail={children:[],querySelectorAll(){return this.children;},appendChild(node){this.children.push(node);},
   getBoundingClientRect:()=>({left:10,top:20,width:350,height:540})};
 const host={querySelector:sel=>sel==='.table-builds'?lane:sel==='.build-inspections'?rail:null};
 const doc={createElement:()=>({dataset:{},style:style(),setAttribute(){},removeAttribute(){},appendChild(p){this.pile=p;},
   querySelector(){return this.pile;},classList:classes([]),
   remove(){rail.children=rail.children.filter(n=>n!==this);}})};
 const inspect=new Function('E','game','pickedTable','escapeHtml','suitClass','prettyRank','prettySuit','app','document','globalThis','motionAllowed',source+';return syncBuildInspections;')
 (E,s,pickedTable,String,()=>'',c=>c.rank,c=>c.suit,host,doc,{},()=>animate);
 return {inspect,rail,item,motions,clone,select:value=>{selected=value;}};
}
test('Selection fans each layer, reverses on deselection, and restores the summary after all layers finish',async()=>{
 const h=ribbonHarness(true);
 h.inspect();assert.equal(h.rail.children.length,1);assert.equal(h.motions.length,11);
 const preview=h.rail.children[0];
 assert.equal(preview.dataset.action,'inspect-build');
 assert.ok(h.item.classList.contains('is-inspecting'));
 assert.ok(h.motions.every(m=>m.options.fill==='both'&&m.options.duration===375));
 assert.ok(parseFloat(h.clone.style.height)<=540+1e-7);
 h.select(false);h.inspect();
 assert.ok(preview.classList.contains('is-closing'));assert.equal(h.rail.children.length,1);
 assert.ok(h.motions.every(m=>m.playbackRate===-1));
 h.select(true);h.inspect();assert.equal(h.rail.children[0],preview);
 assert.ok(!preview.classList.contains('is-closing'));
 assert.ok(h.motions.every(m=>m.playbackRate===1&&m.reversals===2));
 h.select(false);h.inspect();
 h.motions.forEach(m=>m.settle());await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.equal(h.rail.children.length,0);assert.ok(!h.item.classList.contains('is-inspecting'));
});
test('Reduced motion opens the complete ribbon without scrolling or animations and closes immediately',()=>{
 const h=ribbonHarness(false,52);
 h.inspect();assert.equal(h.rail.children.length,1);assert.equal(h.motions.length,0);
 assert.ok(parseFloat(h.clone.style.height)<=540+1e-7);
 h.select(false);h.inspect();assert.equal(h.rail.children.length,0);assert.ok(!h.item.classList.contains('is-inspecting'));
});
test('Collapsed source and destination animations use a visible summary or preview, not hidden pile geometry',()=>{
 assert.match(app,/const previews=new Map\(\[\.\.\.app\.querySelectorAll\('\.build-inspection'\)\]/);
 assert.match(app,/return rect\(summary\)/);
 assert.match(app,/if\(summary\)slotRects\.fill\(summary\)/);
 assert.match(app,/action === 'table' \|\| action === 'inspect-build'/);
});

test('Closing and disabled ribbon previews retain full opacity, including halfway through reversal',()=>{
 assert.match(app,/preview\.classList\.add\('is-closing'\)[\s\S]*?preview\.disabled=true/);
 assert.match(css,/\.shell \.build-inspection:disabled,\.shell \.build-inspection\.is-closing\{opacity:1;/);
 const h=ribbonHarness(true,11);
 h.inspect();h.select(false);h.inspect();
 assert.ok(h.rail.children[0].disabled);
 assert.ok(h.motions.every(m=>m.frames.every(f=>!('opacity' in f))));
});
