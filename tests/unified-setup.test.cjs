const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../src/engine.js'),app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
function harness(saved=null,current=E.rulesFor()){
  const markup=app.slice(app.indexOf('  const SETTING_INFO = {'),app.indexOf('  function renderMenu()'));
  const state=app.slice(app.indexOf('  function openSettings('),app.indexOf("  app.addEventListener('change'"));
  return new Function('E','customRules','current',"let game={rules:current},draft=null,draftPreset='classic',customDraft=null;let variationsScrollTop=0,detailSetting='',settingsOrigin='home',screen='home',modal='';const render=()=>{},escapeHtml=String;"+markup+state+"return {open:openSettings,choose:selectVariation,set:updateDraftSetting,html:renderSettings,info:()=>{difficultyInfoOpen=true;},difficulty:v=>{draft.difficulty=v;},issues:()=>{rulesIssuesOpen=true;},rules:()=>({...draft}),preset:()=>draftPreset,effective:effectiveDraftRules};")(E,saved,current);
}
const make=()=>{const h=harness();h.open('newgame');return h;};
const blocked=h=>/data-action="apply-settings"[^>]*disabled/.test(h.html());
test('One dropdown includes all studied games, one rules page has no duplicate settings',()=>{
 const h=make(),html=h.html();
 assert.equal((html.match(/data-setting="preset"/g)||[]).length,1);
 assert.equal((html.match(/data-action="setup-difficulty"/g)||[]).length,4);
 assert.equal((html.match(/data-action="apply-settings"/g)||[]).length,1);
 assert.equal((html.match(/class="rules-page-section"/g)||[]).length,7);
 for(const k of ['handSize','initialTableSize','winningScore','forcedCapture','builds','faceMode','scoreMode'])assert.equal((html.match(new RegExp('data-setting="'+k+'"','g'))||[]).length,1,k);
 for(const p of E.PRESET_CATALOG)assert.ok(html.includes('value="'+p.id+'"'),p.name);
 assert.doesNotMatch(html,/data-action="rules-tab"/);
});
test('Each CPU level has an actual policy description',()=>{
 const h=make();h.info();for(const [,title,desc] of E.DIFFICULTY_INFO){assert.ok(h.html().includes(title));assert.ok(h.html().includes(desc));}
 h.difficulty('expert');h.choose('suipi');assert.equal(h.rules().difficulty,'expert');
});
test('All presets load; research previews cannot start or accidentally become Custom',()=>{
 const h=make();for(const p of E.PRESET_CATALOG){h.choose(p.id);assert.deepEqual(h.rules(),E.rulesFor(p.id));assert.equal(blocked(h),p.status==='preview',p.name);}
 h.choose('suipi');assert.equal(h.rules().handSize,8);assert.equal(h.rules().matchDeals,2);
 h.choose('diloti');assert.equal(h.rules().scoreProfile,'diloti');assert.equal(h.rules().sweepPoints,10);
 h.choose('zwicker');assert.match(h.html(),/Research preview/);h.set('handSize',8);assert.equal(h.preset(),'zwicker');
});
test('Custom editing and dependency preferences remain functional',()=>{
 const h=make();h.difficulty('hard');h.choose('royal');h.set('handSize',8);h.set('winningScore',31);
 assert.equal(h.preset(),'custom');h.choose('scopa');h.choose('custom');assert.equal(h.rules().handSize,8);assert.equal(h.rules().difficulty,'hard');
 h.set('mergeSameValue',true);h.set('multipleBuilds',false);assert.equal(h.effective().mergeSameValue,false);
 h.set('multipleBuilds',true);assert.equal(h.effective().mergeSameValue,true);
 h.set('builds',false);assert.equal(h.effective().multipleBuilds,false);h.set('builds',true);assert.equal(h.effective().mergeSameValue,true);
 h.set('directCapture',false);h.set('additiveCapture',false);assert.equal(blocked(h),true);h.issues();assert.match(h.html(),/data-action="rules-jump" data-value="capture"/);
 h.set('directCapture',true);assert.equal(blocked(h),false);
});
test('Legacy saved rule aliases survive',()=>{
 const h=harness(E.rulesFor('classic',{royalAces:true,drawMode:true,buildAnything:true}));h.open('newgame');h.choose('custom');
 assert.match(h.html(),/value="14" selected/);assert.match(h.html(),/value="draw" selected/);
 h.set('buildObligation',true);assert.equal(h.rules().buildAnything,false);
});
