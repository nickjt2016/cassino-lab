const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../src/engine.js'),app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8'),css=fs.readFileSync(path.join(__dirname,'../src/compact.css'),'utf8');
const section=(x,y)=>app.slice(app.indexOf(x),app.indexOf(y,app.indexOf(x)+x.length));
function ui(prefs,game){
 return new Function('prefs','game','E','escapeHtml','renderBack','checkpoint',section('  function renderToolbar(','  function renderHome(')+'return {toolbar:renderToolbar,sort:sortedHand,mode:handSortMode,nextMode:nextHandSortMode,slots:sortedHandSlots,hand:handPlan,plan:rowPlan,style:cardRowStyle,seats:renderCpuSeats,color:gameSeatColor};')(prefs,game,E,String,()=>'<span class="card-back"></span>',null);
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
test('Table has exactly four reserved columns and enough rows for every card count',()=>{
 const h=ui({},E.newMatch());
 for(let n=0;n<=54;n++){
  const p=h.plan(n,true);
  assert.ok(p.portraitCols*p.portraitRows>=n);assert.ok(p.wideCols*p.wideRows>=n);
  assert.equal(p.portraitCols,4);assert.equal(p.wideCols,4);
  assert.equal(p.portraitRows,Math.max(1,Math.ceil(n/4)));assert.equal(p.wideRows,p.portraitRows);
 }
 assert.match(css,/--row-budget:max\(12px,calc\(88cqh - 16px\)\)/);
 const table=css.slice(css.indexOf('/* Four permanent loose-card columns'),css.indexOf('/* The hand reserves exactly'));
 assert.match(table,/\.shell \.table-stage:not\(:has\(\.table-builds:not\(:empty\)\)\) \.table-cards/);
 assert.match(table,/width:calc\(100% - var\(--build-lane\)\)!important/);
 assert.match(table,/grid-template-columns:repeat\(4,var\(--row-card-width\)\)/);
 assert.match(table,/top:56%!important/);
});
test('No visible turn banner; deal stays full-color and legal actions stay on one row',()=>{
 const render=section('  function render(mode','  const SETTING_INFO');
 assert.doesNotMatch(render,/class="turn-banner"/);
 assert.match(render,/active\|\|showingDeal\?'':' hand-inactive'/);assert.match(render,/const showingDeal=dealing\|\|!!pendingDeal/);assert.match(render,/if\(!showingDeal\)animateHandTone\(previousHandTone\)/);assert.match(render,/actionButton\('capture','Capture'\)/);
 assert.match(css,/\.human-hand\.hand-inactive\{filter:saturate\(\.72\) contrast\(\.72\) brightness\(1\.12\)\}/);
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

test('Top-bar sort cycles dealt, 555 value first, 567 suit first, with dealt as default',()=>{
 const s=E.newMatch(),p={undo:true},h=ui(p,s);
 assert.equal(h.mode(),'dealt');assert.match(h.toolbar(true),/data-action="toggle-hand-sort"[^>]*>dealt<\/button>/);
 p.handSort=h.nextMode();assert.equal(h.mode(),'value');assert.match(h.toolbar(true),/data-action="toggle-hand-sort"[^>]*>555<\/button>/);
 p.handSort=h.nextMode();assert.equal(h.mode(),'suit');assert.match(h.toolbar(true),/data-action="toggle-hand-sort"[^>]*>567<\/button>/);
 p.handSort=h.nextMode();assert.equal(h.mode(),'dealt');
 assert.match(h.toolbar(false),/data-action="toggle-hand-sort"[^>]*disabled/);
 p.handSort='unknown';assert.equal(h.mode(),'dealt');
 assert.match(app,/prefs\.handSort=nextHandSortMode\(\)/);
 assert.match(app,/if\(prefs\.handSortVersion!==2\)\{prefs\.handSort='dealt'/);
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
 assert.deepEqual(h.sort(hand,rules,'dealt').map(c=>c.id),ids);
 assert.deepEqual(h.sort(hand,rules).map(c=>c.id),ids);
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

test('Every final hand slot is row-major, with no partial-hand layout branch',()=>{
 const h=ui({},E.newMatch());
 for(let n=0;n<=27;n++){
  const p=h.hand(n,360,55,55/.715,4,166),slots=h.slots(p);
  assert.equal(slots.length,n);
  assert.ok(slots.every((slot,i)=>slot.row===(i<p.rows[0]?0:1)));
  assert.ok(slots.every((slot,i)=>i===0||slot.row>slots[i-1].row||slot.x>slots[i-1].x));
 }
 const layout=section('  function layoutHumanHand()','  // Size actual cards');
 assert.match(layout,/planForHand\(g\.nodes\.length,g\)/);
 assert.doesNotMatch(layout,/pendingDeal|arrived|progress/);
 assert.doesNotMatch(app,/advanceHandDeal|handDealLandingRects|activeHandDeal/);
});
test('Hand tone fades both ways across DOM replacement and continues from an interrupted fade',()=>{
 let current=null,allowed=true,animations=[];
 const makeLane=filter=>({filter,animate(frames,options){animations.push({frames,options});}});
 const host={querySelector:()=>current};
 const api=new Function('app','motionAllowed','globalThis',
  section('  function readHandTone()','  function render(mode')+
  'return {read:readHandTone,fade:animateHandTone};'
 )(host,()=>allowed,{getComputedStyle:lane=>({filter:lane.filter})});
 assert.equal(api.read(),null);
 current=makeLane('none');let before=api.read();
 current=makeLane('saturate(0.72) contrast(0.72) brightness(1.12)');api.fade(before);
 assert.deepEqual(animations[0],{frames:[{filter:'none'},{filter:'saturate(0.72) contrast(0.72) brightness(1.12)'}],options:{duration:160,easing:'ease-out'}});
 before=api.read();current=makeLane('none');api.fade(before);
 assert.deepEqual(animations[1].frames,[{filter:'saturate(0.72) contrast(0.72) brightness(1.12)'},{filter:'none'}]);
 current=makeLane('saturate(0.86) contrast(0.86) brightness(1.06)');before=api.read();
 current=makeLane('none');api.fade(before);
 assert.equal(animations[2].frames[0].filter,'saturate(0.86) contrast(0.86) brightness(1.06)');
 api.fade('none');assert.equal(animations.length,3);
 allowed=false;assert.equal(api.read(),null);api.fade('saturate(0.72) contrast(0.72) brightness(1.12)');assert.equal(animations.length,3);
 const render=section('  function render(mode','  const SETTING_INFO');
 assert.ok(render.indexOf('const previousHandTone=readHandTone()')<render.lastIndexOf('app.innerHTML ='));
 assert.ok(render.indexOf('animateHandTone(previousHandTone)')>render.lastIndexOf('app.innerHTML ='));
});

test('Maskable launcher icon has a full-bleed background and inset emblem',()=>{
 const icon=fs.readFileSync(path.join(__dirname,'../icon.svg'),'utf8');
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../manifest.webmanifest'),'utf8'));
 assert.match(icon,/<rect width="192" height="192" fill="#143c33"\/><g transform="translate\(96 96\) scale\(\.66\) translate\(-96 -96\)"/);
 assert.equal(manifest.icons[0].src,'./icon.svg?v=2');
 assert.match(manifest.icons[0].purpose,/maskable/);
});

test('Only three-or-more-player free-for-all opponents are grey; head-to-head is blue versus red',()=>{
 for(let n=2;n<=6;n++){
  const game=E.newMatch(E.rulesFor('classic',{playerCount:n,remainderMode:'uneven'}));
  const h=ui({},game);
  assert.equal(h.color(0),'#346da8');
  for(let seat=1;seat<n;seat++)assert.equal(h.color(seat),n===2?'#ac4847':'#777b73');
  if(n===2)assert.match(h.toolbar(true),/class="opponent-tag" style="--seat-color:#ac4847"/);
 }
 assert.match(css,/\.shell:not\(\.multiplayer-game\) \.game-toolbar \.opponent-tag\{[^}]*border-top:3px solid var\(--seat-color,#ac4847\)/);
});

test('Inactive hand is pale rather than dark, retaining distinctive red and black ink',()=>{
 const match=css.match(/\.human-hand\.hand-inactive\{filter:saturate\(([\d.]+)\) contrast\(([\d.]+)\) brightness\(([\d.]+)\)\}/);
 assert.ok(match);
 const [s,c,b]=match.slice(1).map(Number);
 const tone=rgb=>{
  const luminance=rgb[0]*.213+rgb[1]*.715+rgb[2]*.072;
  return rgb.map(v=>Math.max(0,Math.min(1,((luminance+(v-luminance)*s-.5)*c+.5)*b)));
 };
 const black=tone([0,0,0]),red=tone([.78,0,0]),paper=tone([1,1,1]);
 assert.ok(black[0]>.1&&black[0]<.24,'black ink lifts to a softer gray');
 assert.ok(red[0]-red[1]>.32,'red retains its hue');
 assert.ok(paper.every(v=>v>.94),'card stock remains pale');
});
