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
 assert.match(single,/build-summary-owner">You<\/span><strong>8<\/strong><span>Single<\/span><span>2 cards<\/span>/);
 const build={...s.table.at(-1),owner:1,groups:[[card('S3'),card('D5')],[card('C8')]]};
 const multi=h.markup(build);
 assert.match(multi,/build-summary-owner">Computer<\/span><strong>8<\/strong><span>Multi<\/span><span>3 cards<\/span>/);
 assert.equal((multi.match(/class="playing-card /g)||[]).length,3);
 assert.equal(h.collapse([90],100,5),false);
 assert.equal(h.collapse([101],100,5),true);
 assert.equal(h.collapse([90,90],185,5),false);
 assert.equal(h.collapse([90,90,90],185,5),true);
});
test('Actual layout collapses overflowing builds, expands selected summaries and restores them on deselection',()=>{
 const {f,s,pickedTable}=buildFixture();
 const classes=(...initial)=>{const set=new Set(initial);return {contains:k=>set.has(k),remove:k=>set.delete(k),toggle:(k,on)=>on?set.add(k):set.delete(k)};};
 const items=[100,105].map((height,i)=>({dataset:{id:'b'+i},classList:classes('build-item'),disabled:false,
   getAttribute:()=> 'Build '+i,querySelector:()=>({getBoundingClientRect:()=>({height}),cloneNode:()=>({height})})}));
 const lane={classList:classes(),clientHeight:230,scrollHeight:260,scrollTop:0,querySelectorAll(sel){return sel.includes('selected')?items.filter(n=>n.classList.contains('is-collapsed')&&n.classList.contains('selected')):items;}};
 const rail={dataset:{},children:[],replaceChildren(){this.children=[];},appendChild(node){this.children.push(node);}};
 const host={querySelector:sel=>sel==='.table-builds'?lane:sel==='.build-inspections'?rail:null};
 const doc={createElement:()=>({dataset:{},setAttribute(){},appendChild(pile){this.pile=pile;}})};
 const h=f(E,s,pickedTable,String,()=>'',c=>c.rank,c=>c.suit,host,doc,{getComputedStyle:()=>({rowGap:'5px',paddingTop:'5px',paddingBottom:'5px'})});
 h.layout();assert.ok(!lane.classList.contains('builds-collapsed'));
 lane.clientHeight=180;h.layout(0,true);
 assert.ok(lane.classList.contains('builds-collapsed'));assert.equal(lane.scrollTop,260);
 assert.ok(items.every(n=>n.classList.contains('is-collapsed')));
 items[0].classList.toggle('selected',true);h.inspect();
 assert.equal(rail.children.length,1);assert.equal(rail.children[0].dataset.action,'inspect-build');
 assert.equal(rail.children[0].pile.height,100);
 items[0].classList.toggle('selected',false);h.inspect();assert.equal(rail.children.length,0);
 lane.clientHeight=250;h.layout();assert.ok(!lane.classList.contains('builds-collapsed'));
 assert.match(css,/\.shell \.build-item\.is-collapsed \.build-pile\{display:none/);
 assert.match(css,/\.shell \.build-inspection\{[^}]*max-height:100%;[^}]*box-shadow:/);
 assert.match(css,/\.shell \.table-stage \.table-builds:not\(:empty\)\{[\s\S]*?height:84%;max-height:84%/);
 assert.match(css,/\.shell \.table-stage \.table-builds\.builds-collapsed:not\(:empty\)\{overflow-y:auto/);
});
test('Collapsed source and destination animations use a visible summary or preview, not hidden pile geometry',()=>{
 assert.match(app,/const previews=new Map\(\[\.\.\.app\.querySelectorAll\('\.build-inspection'\)\]/);
 assert.match(app,/return rect\(summary\)/);
 assert.match(app,/if\(summary\)slotRects\.fill\(summary\)/);
 assert.match(app,/action === 'table' \|\| action === 'inspect-build'/);
});
