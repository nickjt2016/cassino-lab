const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../src/engine.js'),app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const card=id=>E.allCards().find(c=>c.id===id);
test('Hand-size entry is a bounded numeric input synchronized with the stepped slider',()=>{
 const markup=app.slice(app.indexOf('  const SETTING_INFO = {'),app.indexOf('  function renderMenu()'));
 const state=app.slice(app.indexOf('  function openSettings('),app.indexOf("  app.addEventListener('change'"));
 const h=new Function('E',"let game={rules:E.rulesFor()},draft=null,draftPreset='classic',customDraft=null,customRules=null;let variationsScrollTop=0,detailSetting='',settingsOrigin='home',screen='home',modal='';const render=()=>{},escapeHtml=String;"+markup+state+"return {open:openSettings,html:renderSettings,set:updateDraftSetting,normalize:normalizedHandSize,info:key=>{detailSetting=key;}};")(E);
 h.open('newgame');assert.match(h.html(),/type="number" inputmode="numeric" data-setting="handSizeText" min="1" max="26" step="1" value="4"/);
 h.set('handSize',18);assert.match(h.html(),/data-setting="handSizeText" min="1" max="26" step="1" value="18"/);assert.match(h.html(),/type="range" data-setting="handSize" min="1" max="26" step="1" value="18"/);
 h.set('deckMode','54');assert.match(h.html(),/data-setting="handSizeText" min="1" max="27"/);
 assert.equal(h.normalize('99',4,26),26);assert.equal(h.normalize('0',4,26),1);assert.equal(h.normalize('',4,26),4);assert.equal(h.normalize('8',4,26),8);
 assert.match(h.html(),/Allow single card captures/);assert.match(h.html(),/Allow multiple card \/ sum captures/);assert.match(h.html(),/Allow single builds in sum captures/);
 h.info('additiveBuilds');assert.match(h.html(),/Multiple builds still require an exact match/);
});
test('Single builds can contribute to capture sums but multiple builds require exact matches',()=>{
 const s=E.newMatch(E.rulesFor('classic',{additiveBuilds:true,pirateCaptures:true}));s.turn=0;s.players[0].hand=[card('S8'),card('H6')];
 s.table=[{id:'b',type:'build',owner:1,value:6,groups:[[card('C4'),card('H2')]]},{id:'t',type:'loose',card:card('D2')}];
 const move={kind:'capture',cardId:'S8',targetIds:['b','t']};
 assert.equal(E.validateAction(s,move).ok,true);
 s.table[0].groups.push([card('D6')]);assert.equal(E.validateAction(s,move).ok,false);
 assert.equal(E.validateAction(s,{kind:'capture',cardId:'H6',targetIds:['b']}).ok,true);
 assert.ok(![...E.legalActions(s)].some(x=>x.cardId==='S8'&&x.kind==='capture'&&x.targetIds.includes('b')));
});
