const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../src/engine.js'),app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const card=id=>E.allCards().find(c=>c.id===id);
function harness(){
 const markup=app.slice(app.indexOf('  const SETTING_INFO = {'),app.indexOf('  function renderMenu()'));
 const state=app.slice(app.indexOf('  function openSettings('),app.indexOf("  app.addEventListener('change'"));
 return new Function('E',"let game={rules:E.rulesFor()},draft=null,draftPreset='classic',customDraft=null,customRules=null;let variationsScrollTop=0,detailSetting='',settingsOrigin='home',screen='home',modal='';const render=()=>{},escapeHtml=String;"+markup+state+"return {open:openSettings,set:updateDraftSetting,html:renderSettings,info:k=>{detailSetting=k;},rules:()=>({...draft}),effective:effectiveDraftRules,deck:updateDeckCards};")(E);
}
test('Construction switches share one group, remain visible and disable with the master switch',()=>{
 const h=harness();h.open('newgame');const labels=['Allow building','Allow additive building','Allow subtractive building','Allow multi builds','Allow single hand card builds','Allowed build values'];
 const html=h.html();assert.ok(labels.every((label,i)=>html.includes(label)&&(!i||html.indexOf(label)>html.indexOf(labels[i-1]))));
 h.set('builds',false);for(const key of ['additiveBuilding','subtractiveBuilds','multipleBuilds','singleCardBuild','buildRange','raiseOwnBuild','raiseOpponentBuild','mergeSameValue','absorbMatching','buildObligation','independentBuilds','pirateCaptures','allowTrailWithOwnBuild'])assert.match(h.html(),new RegExp('data-setting="'+key+'"[^>]*disabled'));
 h.set('builds',true);assert.equal(h.rules().additiveBuilding,true);assert.equal(h.rules().multipleBuilds,true);
 h.info('raiseOwnBuild');assert.match(h.html(),/Raise your own single build.*lower it by subtraction/);
});
test('Custom build range uses current available values and two editable dropdowns',()=>{
 const h=harness();h.open('newgame');h.set('buildRange','custom');assert.equal(h.rules().buildMin,1);assert.equal(h.rules().buildMax,10);
 h.set('buildMin',5);h.set('buildMax',8);assert.deepEqual(E.buildTargets(h.effective()),[5,6,7,8]);
 assert.match(h.html(),/id="range-buildMin".*data-setting="buildBoundChoice"/);assert.match(h.html(),/id="range-buildMax"/);
 h.set('deckMode','custom');h.deck(['S1','H1','D1','C1','S7','H7','D7','C7']);assert.equal(h.rules().buildMin,7);assert.equal(h.rules().buildMax,7);
 assert.equal(E.validateRules(E.rulesFor('classic',{buildRange:'custom',buildMin:3,buildMax:11})).playable,false);
});
test('Subtraction and addition can be enabled separately, including single-build modifications',()=>{
 const s=E.newMatch(E.rulesFor('royal',{additiveBuilding:false,subtractiveBuilds:true,buildRange:'custom',buildMin:6,buildMax:9}));
 s.turn=0;s.players[0].hand=[card('S2'),card('H7'),card('S8'),card('C9')];s.table=[{id:'a',type:'loose',card:card('D9')},{id:'b',type:'loose',card:card('D6')}];
 const sub={kind:'build',cardId:'S2',targetIds:['a'],value:7,mode:'single'};
 assert.equal(E.validateAction(s,sub).ok,true);assert.equal(E.validateAction(s,{...sub,targetIds:['b'],value:8}).ok,false);
 assert.ok([...E.legalActions(s)].some(x=>x.kind==='build'&&x.value===7));
 s.table=[{id:'b',type:'build',owner:1,value:9,groups:[[card('D5'),card('D4')]]}];const lower={...sub,targetIds:['b'],mode:'raise'};
 assert.equal(E.validateAction(s,lower).ok,true);s.rules.raiseOpponentBuild=false;assert.equal(E.validateAction(s,lower).ok,false);
 s.rules.raiseOpponentBuild=true;s.rules.buildMin=8;assert.equal(E.validateAction(s,lower).ok,false);
});
