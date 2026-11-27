const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../src/engine.js'),app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8'),css=fs.readFileSync(path.join(__dirname,'../src/compact.css'),'utf8');
const section=(x,y)=>app.slice(app.indexOf(x),app.indexOf(y,app.indexOf(x)+x.length));
function ui(prefs,game){
 return new Function('prefs','game','E','escapeHtml','renderBack','checkpoint',section('  function renderToolbar(','  function renderHome(')+'return {toolbar:renderToolbar,hand:handPlan,plan:rowPlan,style:cardRowStyle,seats:renderCpuSeats,color:gameSeatColor};')(prefs,game,E,String,()=>'<span class="card-back"></span>',null);
}
test('Manual hand layout preference no longer changes toolbar or layout',()=>{
 const s=E.newMatch(),p={cardLayout:'fitRow',undo:true},h=ui(p,s);
 assert.doesNotMatch(h.toolbar(true),/Card layout|toggle-card-layout|One row|Multi row/);
 assert.doesNotMatch(app,/data-action="toggle-card-layout"|function cardLayoutPreference/);
 assert.match(app,/delete prefs\.cardLayout/);
});
test('Fixed hand geometry: center one row, fill the top before the bottom, then alternate new cards',()=>{
 const h=ui({},E.newMatch());
 const plan=n=>h.hand(n,360,55,55/.715,4,166);
 assert.equal(plan(1).capacity,6);
 assert.deepEqual(plan(6).rows,[6,0]);assert.deepEqual(plan(7).rows,[6,1]);
 assert.deepEqual(plan(12).rows,[6,6]);assert.deepEqual(plan(13).rows,[7,6]);
 assert.deepEqual(plan(14).rows,[7,7]);assert.deepEqual(plan(26).rows,[13,13]);
 assert.deepEqual(plan(27).rows,[14,13]);
 assert.equal(plan(13).cards[12].row,0);assert.equal(plan(14).cards[13].row,1);
 assert.equal(plan(1).cards[0].x,(360-55)/2);
 assert.equal(plan(1).cards[0].y,(166-55/.715)/2);
 assert.equal(plan(6).cards[1].x-plan(6).cards[0].x,59);
 assert.ok(plan(7).cards[0].y<plan(6).cards[0].y);
 assert.equal(plan(7).cards[6].x,(360-55)/2);
 for(const n of [13,14,26,27]){
  const p=plan(n);
  for(const row of [0,1]){
   const cards=p.cards.filter(c=>c.row===row);
   assert.ok(Math.abs(cards[0].x)<1e-8);
   assert.ok(Math.abs(cards.at(-1).x+55-360)<1e-8);
   assert.ok(cards.every((c,i)=>i===0||c.x>cards[i-1].x));
  }
 }
 assert.ok(plan(26).cards[0].indexScale<1);
});
test('Hand layout fits 0–27 cards at representative portrait and landscape widths, with two rows at most',()=>{
 const h=ui({},E.newMatch());
 for(const [width,cw] of [[272,46],[320,48],[360,55],[390,60],[760,38]])for(let n=0;n<=27;n++){
  const ch=cw/.715, height=2*ch+12;
  const p=h.hand(n,width,cw,ch,4,height);
  assert.equal(p.cards.length,n);
  assert.ok(Math.abs(p.rows[0]-p.rows[1])<=1||!p.overflow);
  for(const c of p.cards){
   assert.ok(c.row===0||c.row===1);
   assert.ok(c.x>=-1e-8&&c.x+cw<=width+1e-8);
   assert.ok(c.y>=0&&c.y+ch<=height+1e-8);
   assert.ok(c.indexScale>0&&c.indexScale<=1);
  }
 }
 assert.match(css,/\.shell \.human-hand\{[\s\S]*?height:calc\(2 \* var\(--hand-card-width\)/);
 assert.match(app,/layoutHumanHand\(\);\s*hidePendingDealCards\(\);\s*animateLayout/);
 assert.match(app,/node\.style\.zIndex=String\(p\.col\+1\)/);
});
test('Table still has independent responsive non-scrolling rows',()=>{
 const h=ui({},E.newMatch());
 for(let n=0;n<=54;n++){
  const p=h.plan(n,true);
  assert.ok(p.portraitCols*p.portraitRows>=n);assert.ok(p.wideCols*p.wideRows>=n);
  assert.ok(p.portraitRows<=4);assert.ok(p.wideRows<=3);
 }
 assert.match(css,/--row-budget:max\(12px,calc\(100cqh - 16px\)\)/);
});
test('No visible turn banner; hand dims and legal action buttons stay on one row',()=>{
 const render=section('  function render(mode','  const SETTING_INFO');
 assert.doesNotMatch(render,/class="turn-banner"/);
 assert.match(render,/hand-inactive/);assert.match(render,/actionButton\('capture','Capture'\)/);
 assert.match(css,/\.human-hand\.hand-inactive \.playing-card\{filter:grayscale/);
 assert.match(css,/\.move-action-slot \.contextual-controls \.main-actions\{[^}]*flex-wrap:nowrap/);
 assert.match(css,/\.move-action-slot \.main-actions \.action-btn\{[^}]*min-width:max-content;[^}]*white-space:nowrap/);
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
