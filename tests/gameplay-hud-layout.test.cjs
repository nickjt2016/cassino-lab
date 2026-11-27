const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../src/engine.js'),app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8'),css=fs.readFileSync(path.join(__dirname,'../src/compact.css'),'utf8');
const section=(x,y)=>app.slice(app.indexOf(x),app.indexOf(y,app.indexOf(x)+x.length));
function ui(prefs,game){
 return new Function('prefs','game','E','escapeHtml','renderBack','checkpoint',section('  function renderToolbar(','  function renderHome(')+'return {toolbar:renderToolbar,mode:cardLayoutPreference,label:cardLayoutLabel,plan:rowPlan,style:cardRowStyle,seats:renderCpuSeats,color:gameSeatColor};')(prefs,game,E,String,()=>'<span class="card-back"></span>',null);
}
test('Only the live toolbar toggles One row and Multi row, preserving the existing saved choice',()=>{
 const s=E.newMatch(),p={cardLayout:'default',undo:true},h=ui(p,s);
 assert.equal(h.mode(),'multiRow');assert.match(h.toolbar(true),/Card layout: Multi row/);
 p.cardLayout='fitRow';assert.equal(h.mode(),'oneRow');assert.match(h.toolbar(true),/Card layout: One row/);
 p.cardLayout='multiRow';assert.equal(h.label(),'Multi row');
 assert.match(h.toolbar(false),/data-action="toggle-card-layout"[^>]*disabled/);
 assert.doesNotMatch(section('  function renderSettings()','  function renderRules()'),/data-setting="cardLayout"|renderCardLayoutSetting|data-action="toggle-card-layout"/);
 assert.match(app,/prefs\.cardLayout=cardLayoutPreference\(\)==='oneRow'\?'multiRow':'oneRow'/);
 assert.match(app,/if\(screen!=='game'\|\|modal\|\|busy\|\|dealing\|\|turnInMotion\|\|node\.disabled\)return/);
});
test('Row plans cover every possible hand/table count without a horizontal-scroll mode',()=>{
 const h=ui({cardLayout:'multiRow'},E.newMatch());
 for(let n=0;n<=54;n++)for(const table of [false,true]){
  const p=h.plan(n,table);
  assert.ok(p.portraitCols*p.portraitRows>=n);assert.ok(p.wideCols*p.wideRows>=n);
  assert.ok(p.portraitRows<=(table?4:3));assert.ok(p.wideRows<=(table?3:2));
  assert.match(h.style(n,table),/--row-count:\d+;--portrait-cols:\d+/);
 }
 assert.equal(h.plan(12).portraitRows,2);
 assert.equal(h.plan(12).portraitCols,6);
 assert.equal(h.plan(27).portraitRows,3);
 assert.doesNotMatch(css,/\.human-hand\.wide-hand\s*\{/);
 assert.match(css,/\.shell\.fit-card-rows \.human-hand,[\s\S]*?--row-cols:var\(--row-count,1\);--row-rows:1/);
 assert.match(css,/flex:0 0 var\(--row-card-width\)!important/);
 assert.match(css,/--row-budget:max\(12px,calc\(100cqh - 16px\)\)/);
});
test('Turn strip reserves a separate position for legal buttons and keeps selection updates mounted',()=>{
 const render=section('  function render(mode','  const SETTING_INFO');
 assert.match(render,/<div class="turn-action-area">[\s\S]*?<div class="turn-banner"[\s\S]*?<div class="move-action-slot">\$\{controlsMarkup\}<\/div>/);
 assert.match(css,/\.shell \.turn-action-area\{[^}]*grid-template-rows:max-content minmax\(0,1fr\)/);
 assert.match(css,/\.shell \.turn-action-area \.turn-banner\{[^}]*position:static/);
 assert.doesNotMatch(css,/\.felt:has\(\.contextual-controls\) \.turn-banner\{opacity:\.32/);
 const slot={innerHTML:''},felt={querySelector:s=>s==='.move-action-slot'?slot:s==='.human-area'||s==='.game-stats'?{}:null,querySelectorAll:()=>[]};
 const sync=new Function('app',"let pickedCard=null,pickedTable=new Set(),modal='',toast='',renderedActionMarkup='';"+section('  function syncSelection(','  // Dialog-only interactions')+'return syncSelection;')({querySelector:()=>felt});
 assert.equal(sync('<section class="contextual-controls">Capture</section>','Capture'),true);
 assert.match(slot.innerHTML,/Capture/);
});
test('Human score uses team accent and equal vertical spacing; CPU panels omit redundant visible metadata',()=>{
 const s=E.newMatch(E.rulesFor('classic',{playerCount:4,teamMode:'pairs',handSize:12}));
 const h=ui({cardLayout:'multiRow'},s),seats=h.seats();
 assert.equal(h.color(0),h.color(2));
 assert.notEqual(h.color(0),h.color(1));
 assert.equal((seats.match(/class="card-back"/g)||[]).length,36);
 assert.match(seats,/aria-label="CPU 1 has 12 hidden cards"/);
 assert.doesNotMatch(seats,/multi-seat-meta|12 cards ·|Your team|Team 2/);
 assert.match(app,/class="your-score-tag" style="--seat-color:\$\{gameSeatColor\(0\)\}"/);
 assert.match(css,/\.shell \.human-area\{[^}]*gap:var\(--score-gap\);margin:0;padding:0 0 var\(--score-gap\)/);
 assert.match(css,/\.shell \.your-score-tag\{[^}]*border-top:3px solid var\(--seat-color,#346da8\)/);
 assert.match(css,/\.shell \.game-stats\{order:4;margin:0 0 4px/);
});
