const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../src/engine.js'),app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
function harness(){
 const markup=app.slice(app.indexOf('  const SETTING_INFO = {'),app.indexOf('  function renderMenu()'));
 const state=app.slice(app.indexOf('  function openSettings('),app.indexOf("  app.addEventListener('change'"));
 return new Function('E',"let game={rules:E.rulesFor()},draft=null,draftPreset='classic',customDraft=null,customRules=null;let variationsScrollTop=0,detailSetting='',settingsOrigin='home',screen='home',modal='';const render=()=>{},escapeHtml=String;"+markup+state+"return {open:openSettings,set:updateDraftSetting,cycle:cycleTeamMode,choose:selectVariation,html:renderSettings,rules:()=>({...draft}),effective:effectiveDraftRules,teams:playerTeamOptions,diagram:seatingDiagram,maximum:handMaximum,help:key=>{detailSetting=key;},summary:playerSetupSummary};")(E);
}
test('Team options follow the exact requested player counts',()=>{
 assert.deepEqual(E.teamModesFor(2),['freeForAll']);
 assert.deepEqual(E.teamModesFor(3),['freeForAll']);
 assert.deepEqual(E.teamModesFor(4),['freeForAll','pairs']);
 assert.deepEqual(E.teamModesFor(5),['freeForAll']);
 assert.deepEqual(E.teamModesFor(6),['freeForAll','pairs','triples']);
});
test('Team assignment alternates seats and always puts human on team zero',()=>{
 assert.deepEqual(E.seatAssignments(4,'pairs').map(s=>s.team),[0,1,0,1]);
 assert.deepEqual(E.seatAssignments(6,'pairs').map(s=>s.team),[0,1,2,0,1,2]);
 assert.deepEqual(E.seatAssignments(6,'triples').map(s=>s.team),[0,1,0,1,0,1]);
 assert.deepEqual(E.seatAssignments(3,'freeForAll').map(s=>s.team),[null,null,null]);
 for(let n=2;n<=6;n++)for(const mode of E.teamModesFor(n))assert.equal(E.seatAssignments(n,mode).filter(s=>s.human)[0].seat,0);
});
test('Setup appears before dealing; seats, cycle button and hand limit follow the selected count',()=>{
 const h=harness();h.open('newgame');
 let html=h.html();assert.ok(html.indexOf('id="rules-area-players"')<html.indexOf('id="rules-area-deal"'));
 assert.match(html,/data-setting="playerCount" min="2" max="6" step="1" value="2"/);
 for(let n=2;n<=6;n++){
   h.set('playerCount',n);html=h.html();
   assert.equal((html.match(/data-seat="/g)||[]).length,n);
   assert.match(html,/data-seat="0" data-team="none" data-seat-x="160\.00" data-seat-y="190\.00"/);
   assert.match(html,new RegExp('data-setting="handSize" min="1" max="'+Math.floor(52/n)+'"'));
   const control=html.match(/<button[^>]*id="rule-teamMode"[\s\S]*?<\/button>/)[0];
   assert.match(control,/data-action="cycle-team-mode"/);
   assert.equal(/\bdisabled\b/.test(control),n!==4&&n!==6);
   assert.doesNotMatch(html,/<select id="rule-teamMode"/);
   assert.doesNotMatch(html,/setup-seat-legend/);
 }
 h.set('teamMode','pairs');html=h.html();assert.match(html,/data-seat="3" data-team="0"/);assert.doesNotMatch(html,/setup-seat-legend|>Team 3</);
 h.set('teamMode','triples');html=h.html();assert.match(html,/data-seat="2" data-team="0"/);assert.doesNotMatch(html,/Team 3/);
 h.set('playerCount',5);assert.equal(h.rules().teamMode,'freeForAll');
 h.set('playerCount',4);h.set('teamMode','pairs');h.set('playerCount',6);assert.equal(h.rules().teamMode,'pairs');
});
test('Player count clamps hand-size preferences and validator uses actual seats',()=>{
 const h=harness();h.open('newgame');h.set('handSize',25);h.set('playerCount',6);
 assert.equal(h.maximum(),8);assert.equal(h.rules().handSize,8);
 assert.equal(E.validateRules(E.rulesFor('classic',{playerCount:3,handSize:16})).errors.length,0);
 assert.ok(E.validateRules(E.rulesFor('classic',{playerCount:5,handSize:10})).errors.some(s=>/starting hands/.test(s)));
 assert.ok(E.validateRules(E.rulesFor('classic',{playerCount:5,teamMode:'pairs'})).errors.some(s=>/team arrangement/.test(s)));
});
test('Legacy partnerships migrate; every competitive arrangement is playable',()=>{
 const legacy=E.normalizeRules({playerCount:'4team'});assert.equal(legacy.playerCount,4);assert.equal(legacy.teamMode,'pairs');
 assert.equal(E.rulesFor('partnership').teamMode,'pairs');
 assert.equal(E.rulesFor('fivePlayer').playerCount,5);
 for(let n=2;n<=6;n++)for(const mode of E.teamModesFor(n)){
   const r=E.rulesFor('classic',{playerCount:n,teamMode:mode,remainderMode:'uneven'});
   assert.equal(E.validateRules(r).playable,true);
 }
 assert.equal(E.validateRules(E.rulesFor('classic',{teamMode:'pairs'})).playable,false);
 const h=harness();h.open('newgame');h.set('teamMode','pairs');
 assert.equal(h.rules().teamMode,'freeForAll');
 assert.match(h.html(),/<button[^>]*id="rule-teamMode"[^>]*disabled[^>]*><span>1 vs\. 1<\/span>/);
 h.set('playerCount',4);h.set('teamMode','pairs');assert.equal(h.rules().teamMode,'pairs');
 assert.doesNotMatch(h.html(),/data-action="apply-settings"[^>]*disabled/);
 h.set('playerCount',2);assert.equal(h.rules().teamMode,'freeForAll');
});
test('A slider input handler updates preview before the change commits the new draft',()=>{
 assert.match(app,/target\?\.dataset\?\.setting==='playerCount'/);
 assert.match(app,/diagram\.innerHTML=seatingDiagram\(preview\)/);
 assert.match(app,/if\(prop==='playerCount'\)/);
});

test('Every seat is a fixed-size polar rectangle with an empty center, at every player count',()=>{
 const h=harness();h.open('newgame');
 for(let n=2;n<=6;n++){
  h.set('playerCount',n);
  const svg=h.html().match(/<svg viewBox="0 0 320 220" class="setup-table-svg"[\s\S]*?<\/svg>/)[0];
  assert.doesNotMatch(svg,/<(?:ellipse|rect|circle)\b/);
  assert.equal((svg.match(/class="polar-seat"/g)||[]).length,n);
  const points=[...svg.matchAll(/data-seat-x="([\d.]+)" data-seat-y="([\d.]+)"/g)].map(m=>[Number(m[1]),Number(m[2])]);
  assert.deepEqual(points[0],[160,190]);
  for(let i=0;i<n;i++){
   const angle=Math.PI/2+2*Math.PI*i/n;
   assert.ok(Math.abs(points[i][0]-(160+80*Math.cos(angle)))<.006);
   assert.ok(Math.abs(points[i][1]-(110+80*Math.sin(angle)))<.006);
  }
  const paths=[...svg.matchAll(/class="polar-seat" d="([^"]+)"/g)].map(m=>m[1]);
  for(const path of paths){
   const nums=path.match(/^M ([\d.]+) ([\d.]+) A 100 100 0 0 1 ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+) A 60 60 0 0 0 ([\d.]+) ([\d.]+) Z$/);
   assert.ok(nums,path);
   const p=nums.slice(1).map(Number);
   for(let i=0;i<4;i++)assert.ok(Math.abs(Math.hypot(p[2*i]-160,p[2*i+1]-110)-(i<2?100:60))<.002);
   assert.ok(Math.abs(Math.hypot(p[0]-p[2],p[1]-p[3])-200*Math.sin(22*Math.PI/180))<.003);
  }
 }
 h.set('teamMode','pairs');const svg=h.html().match(/<svg viewBox="0 0 320 220" class="setup-table-svg"[\s\S]*?<\/svg>/)[0];
 for(const color of ['#346da8','#ac4847','#367c55'])assert.equal((svg.match(new RegExp('fill="'+color+'"','g'))||[]).length,2);
});

test('Arrangement labels and information match the selected player count',()=>{
 const h=harness();h.open('newgame');h.help('teamMode');
 const expected={2:['1 vs. 1'],3:['FFA'],4:['FFA','2 vs. 2'],5:['FFA'],6:['FFA','2 vs. 2 vs. 2','3 vs. 3']};
 for(let n=2;n<=6;n++){
  h.set('playerCount',n);
  assert.deepEqual(h.teams(n).map(row=>row[1]),expected[n]);
  const labels=[];
  for(let i=0;i<expected[n].length;i++){
   const html=h.html(),control=html.match(/<button[^>]*id="rule-teamMode"[\s\S]*?<\/button>/)[0];
   labels.push(control.match(/<span>([^<]+)<\/span>/)[1]);
   h.cycle();
  }
  assert.deepEqual(labels,expected[n]);
  assert.equal(h.rules().teamMode,'freeForAll');
  const html=h.html();
  const info=html.match(/<div class="inline-setting-info rule-option-help">([\s\S]*?)<\/div>/)[1];
  assert.deepEqual([...info.matchAll(/<p><b>([^<]+)<\/b>/g)].map(m=>m[1]),expected[n]);
  assert.doesNotMatch(info,/Inactive:/);
  if(n===2)assert.match(info,/one CPU opponent/);
  else assert.match(info,new RegExp('all '+n+' players compete independently'));
  if(n===4)assert.match(info,/Two teams of two/);
  if(n===6){assert.match(info,/Three teams of two/);assert.match(info,/Two teams of three/);}
 }
 h.set('teamMode','pairs');assert.equal(h.summary(),'6 players · 2 vs. 2 vs. 2');
 h.set('playerCount',4);assert.equal(h.summary(),'4 players · 2 vs. 2');
 h.set('playerCount',2);assert.equal(h.summary(),'2 players · 1 vs. 1');
});

test('Team cycle wraps, preserves color assignments, and is fixed for 2, 3 and 5 players',()=>{
 const h=harness();h.open('newgame');
 for(const n of [2,3,5]){h.set('playerCount',n);h.cycle();assert.equal(h.rules().teamMode,'freeForAll');}
 h.set('playerCount',4);h.cycle();assert.equal(h.rules().teamMode,'pairs');
 assert.match(h.diagram(),/data-seat="2" data-team="0"/);
 assert.doesNotMatch(h.diagram(),/setup-seat-legend|>Your team<|>Team 2</);
 h.cycle();assert.equal(h.rules().teamMode,'freeForAll');
 h.set('playerCount',6);
 for(const mode of ['pairs','triples','freeForAll']){h.cycle();assert.equal(h.rules().teamMode,mode);}
 assert.match(app,/control\.outerHTML=teamCycleControl\(preview\)/);
 assert.match(app,/action==='cycle-team-mode'&&modal==='settings'/);
});
