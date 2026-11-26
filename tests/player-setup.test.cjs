const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../src/engine.js'),app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
function harness(){
 const markup=app.slice(app.indexOf('  const SETTING_INFO = {'),app.indexOf('  function renderMenu()'));
 const state=app.slice(app.indexOf('  function openSettings('),app.indexOf("  app.addEventListener('change'"));
 return new Function('E',"let game={rules:E.rulesFor()},draft=null,draftPreset='classic',customDraft=null,customRules=null;let variationsScrollTop=0,detailSetting='',settingsOrigin='home',screen='home',modal='';const render=()=>{},escapeHtml=String;"+markup+state+"return {open:openSettings,set:updateDraftSetting,choose:selectVariation,html:renderSettings,rules:()=>({...draft}),effective:effectiveDraftRules,teams:playerTeamOptions,diagram:seatingDiagram,maximum:handMaximum};")(E);
}
test('Team options follow the exact requested player counts',()=>{
 assert.deepEqual(E.teamModesFor(2),['freeForAll','pairs']);
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
test('Setup appears before dealing; seats, dropdown and hand limit follow the selected count',()=>{
 const h=harness();h.open('newgame');
 let html=h.html();assert.ok(html.indexOf('id="rules-area-players"')<html.indexOf('id="rules-area-deal"'));
 assert.match(html,/data-setting="playerCount" min="2" max="6" step="1" value="2"/);
 for(let n=2;n<=6;n++){
   h.set('playerCount',n);html=h.html();
   assert.equal((html.match(/data-seat="/g)||[]).length,n);
   assert.match(html,/data-seat="0" data-team="none" data-seat-x="160\.00" data-seat-y="186\.00"/);
   assert.match(html,new RegExp('data-setting="handSize" min="1" max="'+Math.floor(52/n)+'"'));
   const select=html.match(/<select id="rule-teamMode"[\s\S]*?<\/select>/)[0];
   assert.equal(select.includes('value="pairs"'),n%2===0);assert.equal(select.includes('value="triples"'),n===6);
 }
 h.set('teamMode','pairs');html=h.html();assert.match(html,/data-seat="3" data-team="0"/);assert.match(html,/Team 3/);
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
test('Legacy partnerships migrate; only competitive two-player mode is playable',()=>{
 const legacy=E.normalizeRules({playerCount:'4team'});assert.equal(legacy.playerCount,4);assert.equal(legacy.teamMode,'pairs');
 assert.equal(E.rulesFor('partnership').teamMode,'pairs');
 assert.equal(E.rulesFor('fivePlayer').playerCount,5);
 for(let n=2;n<=6;n++)for(const mode of E.teamModesFor(n)){
   const r=E.rulesFor('classic',{playerCount:n,teamMode:mode});
   assert.equal(E.validateRules(r).playable,n===2&&mode==='freeForAll');
 }
 const h=harness();h.open('newgame');h.set('teamMode','pairs');
 assert.match(h.html(),/One pair, no opposing team/);
 assert.match(h.html(),/data-action="apply-settings"[^>]*disabled/);
 h.set('teamMode','freeForAll');assert.doesNotMatch(h.html(),/data-action="apply-settings"[^>]*disabled/);
});
test('A slider input handler updates preview before the change commits the new draft',()=>{
 assert.match(app,/target\?\.dataset\?\.setting==='playerCount'/);
 assert.match(app,/diagram\.innerHTML=seatingDiagram\(preview\)/);
 assert.match(app,/if\(prop==='playerCount'\)/);
});
