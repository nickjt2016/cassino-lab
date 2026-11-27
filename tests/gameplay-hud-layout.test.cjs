const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../src/engine.js'),app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8'),css=fs.readFileSync(path.join(__dirname,'../src/compact.css'),'utf8');
const section=(x,y)=>app.slice(app.indexOf(x),app.indexOf(y,app.indexOf(x)+x.length));
function ui(prefs,game){
 return new Function('prefs','game','E','escapeHtml','renderBack','checkpoint',section('  function renderToolbar(','  function renderHome(')+'return {toolbar:renderToolbar,sort:sortedHand,mode:handSortMode,slots:sortedHandSlots,dealSlots:dealHandSlots,landings:handDealLandingRects,hand:handPlan,plan:rowPlan,style:cardRowStyle,seats:renderCpuSeats,color:gameSeatColor};')(prefs,game,E,String,()=>'<span class="card-back"></span>',null);
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
   if(cards.length>p.capacity){
    assert.ok(Math.abs(cards[0].x)<1e-8);
    assert.ok(Math.abs(cards.at(-1).x+55-360)<1e-8);
   }else{
    assert.ok(Math.abs(cards[0].x-(360-(cards.length*55+(cards.length-1)*4))/2)<1e-8);
   }
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

test('Top-bar sort switch shows the current mode and disables during non-human turns',()=>{
 const s=E.newMatch(),p={undo:true},h=ui(p,s);
 assert.equal(h.mode(),'suit');
 assert.match(h.toolbar(true),/data-action="toggle-hand-sort"[^>]*>555<\/button>/);
 p.handSort='value';assert.equal(h.mode(),'value');
 assert.match(h.toolbar(true),/data-action="toggle-hand-sort"[^>]*>567<\/button>/);
 assert.match(h.toolbar(false),/data-action="toggle-hand-sort"[^>]*disabled/);
 p.handSort='unknown';assert.equal(h.mode(),'suit');
 assert.match(app,/prefs\.handSort=handSortMode\(\)==='suit'\?'value':'suit'/);
 assert.match(app,/if\(modal\|\|!isHumanTurn\(\)\|\|node\.disabled\)return/);
 assert.match(app,/sortedHand\(me\(\)\.hand,game\.rules,handSortMode\(\)\)/);
});
test('Hand sorting uses SHCD, ascending assigned values and never changes engine hand order',()=>{
 const rules=E.rulesFor('classic',{royal:true,royalAces:true,customizeCardValues:true,cardValueOverrides:{S7:[20,2],H3:[19,1],C2:[6],D10:[3,18],Joker:[15]}});
 const h=ui({},E.newMatch());
 const ids=['D10','C2','S7','H3','H2','S1','X1','D2','C1','S2','H11'];
 const hand=ids.map(id=>E.allCards().find(c=>c.id===id));
 assert.deepEqual(h.sort(hand,rules,'suit').map(c=>c.id),['S1','S2','S7','H3','H2','H11','C1','C2','D2','D10','X1']);
 assert.deepEqual(h.sort(hand,rules,'value').map(c=>c.id),['S1','H3','C1','S2','S7','H2','D2','D10','C2','H11','X1']);
 assert.deepEqual(hand.map(c=>c.id),ids);
});
test('Rank-only faces and joker placement stay deterministic; configured Italian values are respected',()=>{
 const h=ui({},E.newMatch()),cards=ids=>ids.map(id=>E.allCards().find(c=>c.id===id));
 const classic=E.rulesFor('classic');
 assert.deepEqual(h.sort(cards(['D13','C12','H11','S10','D1','S11']),classic,'value').map(c=>c.id),['D1','S10','S11','H11','C12','D13']);
 const italian=E.rulesFor('classic',{royal:true,faceValues:'italian',jokerValue:2});
 assert.deepEqual(h.sort(cards(['S11','S8','D9','X1','H1']),italian,'value').map(c=>c.id),['H1','X1','S8','S11','D9']);
 assert.deepEqual(h.sort(cards(['X2','D1','X1','C1']),italian,'suit').map(c=>c.id),['C1','D1','X1','X2']);
});
test('Even overlapping hands read in sorted order across top row then bottom row',()=>{
 const h=ui({},E.newMatch());
 for(let n=1;n<=27;n++){
   const plan=h.hand(n,360,55,55/.715,4,166),slots=h.slots(plan);
   assert.equal(slots.length,n);
   assert.deepEqual(slots.slice(0,plan.rows[0]).map(c=>c.row),Array(plan.rows[0]).fill(0));
   assert.deepEqual(slots.slice(plan.rows[0]).map(c=>c.row),Array(plan.rows[1]).fill(1));
   assert.ok(slots.every((c,i)=>i===0||c.row>slots[i-1].row||c.x>slots[i-1].x));
 }
 assert.match(app,/const slots=sortedHandSlots\(plan\)/);
});

test('Deal prefixes fill the first row, then the second, then alternate appended cards',()=>{
 const h=ui({},E.newMatch()),g={width:360,cardWidth:55,cardHeight:55/.715,gap:4,height:166,inset:4,lane:{getBoundingClientRect:()=>({left:10,top:100})}};
 const incoming=Array.from({length:26},(_,i)=>'card'+i);
 for(let n=1;n<=incoming.length;n++){
  const ids=incoming.slice(0,n),slots=h.dealSlots([],ids,g),last=slots.get(ids.at(-1));
  const expected=n<=6?0:n<=12?1:(n-13)%2;
  assert.equal(last.row,expected);
  const row=[...slots.values()].filter(s=>s.row===expected);
  assert.equal(last.col,row.length-1);
  assert.ok(row.every((s,i)=>i===0||s.x>row[i-1].x));
 }
 const one=h.dealSlots([],incoming.slice(0,1),g).get(incoming[0]);
 const two=h.dealSlots([],incoming.slice(0,2),g);
 assert.ok(two.get(incoming[0]).x<one.x);
 assert.ok(h.dealSlots([],incoming.slice(0,7),g).get(incoming[0]).y<one.y);
 const before=h.dealSlots([],incoming.slice(0,12),g),after=h.dealSlots([],incoming.slice(0,13),g);
 for(let i=6;i<12;i++)assert.deepEqual(after.get(incoming[i]),before.get(incoming[i]));
 const rects=h.landings({baseIds:[],incomingIds:incoming,arrived:0},g);
 for(let i=0;i<incoming.length;i++){
  const slot=h.dealSlots([],incoming.slice(0,i+1),g).get(incoming[i]),rect=rects.get(incoming[i]);
  assert.ok(Math.abs(rect.left-(10+4+slot.x))<1e-8);assert.ok(Math.abs(rect.top-(100+slot.y))<1e-8);
 }
});
test('Replacement draws preserve existing sorted row membership and append into the growth slot',()=>{
 const h=ui({},E.newMatch()),g={width:360,cardWidth:55,cardHeight:55/.715,gap:4,height:166};
 const base=Array.from({length:13},(_,i)=>'base'+i);
 const previous=h.dealSlots(base,[],g),next=h.dealSlots(base,['draw'],g);
 const slots=h.slots(h.hand(13,g.width,g.cardWidth,g.cardHeight,g.gap,g.height));
 for(let i=0;i<base.length;i++){
  assert.deepEqual(previous.get(base[i]),slots[i]);
  assert.equal(next.get(base[i]).row,previous.get(base[i]).row);
 }
 assert.equal(next.get('draw').row,1);assert.equal(next.get('draw').col,6);
});
