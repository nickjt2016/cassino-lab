const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../src/engine.js');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../src/compact.css'),'utf8');
function harness(saved=null,current=E.rulesFor()){
  const markup=app.slice(app.indexOf('  const SETTING_INFO = {'),app.indexOf('  function renderMenu()'));
  const state=app.slice(app.indexOf('  function openSettings('),app.indexOf("  app.addEventListener('change'"));
  return new Function('E','customRules','current',
    "let game={rules:current},draft=null,draftPreset='classic',customDraft=null;let variationsScrollTop=0,detailSetting='',settingsOrigin='home',screen='home',modal='';const render=()=>{},escapeHtml=String;"+
    markup+state+"return {open:openSettings,choose:selectVariation,set:updateDraftSetting,html:renderSettings,tab:value=>{rulesTab=value;},section:value=>{rulesSection=value;},info:key=>{detailSetting=key;},difficulty:value=>{draft.difficulty=value;},issues:()=>{rulesIssuesOpen=true;},rules:()=>({...draft}),effective:effectiveDraftRules,preset:()=>draftPreset};"
  )(E,saved,current);
}
const make=()=>{const h=harness();h.open('newgame');return h;};
const blocked=h=>/data-action="apply-settings"[^>]*disabled/.test(h.html());
test('Basic setup presents five presets, four difficulty choices and one Start action',()=>{
  const h=make(),html=h.html();
  assert.match(html,/New Game/);
  assert.match(html,/2 PLAYERS/);
  assert.equal((html.match(/data-action="preset-choice"/g)||[]).length,5);
  assert.equal((html.match(/data-action="setup-difficulty"/g)||[]).length,4);
  assert.equal((html.match(/data-action="apply-settings"/g)||[]).length,1);
  assert.equal(blocked(h),false);
  assert.doesNotMatch(html,/data-setting="playerCount"|data-setting="jokerCount"/);
});
test('Preset and custom edits preserve difficulty, and tabs share one draft',()=>{
  const h=make();h.difficulty('hard');
  for(const key of Object.keys(E.PRESETS)){h.choose(key);assert.deepEqual(h.rules(),E.rulesFor(key,{difficulty:'hard'}));}
  h.choose('custom');h.set('handSize',8);h.set('winningScore',31);
  h.tab('advanced');assert.equal(h.rules().handSize,8);assert.equal(h.rules().winningScore,31);
  assert.equal((h.html().match(/data-action="rules-section"/g)||[]).length,7);
  h.choose('royal');h.choose('custom');assert.equal(h.rules().handSize,8);assert.equal(h.rules().difficulty,'hard');
});
test('Aliases consolidate face, ace, deal and independent-build settings',()=>{
  const h=make();h.set('faceMode','extended');h.set('aceMode',11);
  assert.equal(h.rules().royal,true);assert.equal(h.rules().faceValues,'extended');assert.equal(h.rules().aceValue,11);assert.equal(h.rules().royalAces,false);
  h.set('independentBuilds','2');assert.equal(h.rules().pirateBuilds,true);assert.equal(h.rules().buildLimit,'2');
  h.set('dealMode','draw');assert.equal(h.rules().drawMode,true);
  h.set('dealMode','batch');assert.equal(h.rules().drawMode,false);
  h.set('remainderMode','strict');h.set('dealMode','full');assert.equal(h.rules().remainderMode,'equal');
  h.tab('advanced');assert.doesNotMatch(h.html(),/data-setting="royalAces"|data-setting="drawMode"|data-setting="pirateBuilds"/);
});
test('Inactive dependent preferences are remembered but not sent to the engine',()=>{
  const h=make();h.set('mergeSameValue',true);h.set('multipleBuilds',false);
  assert.equal(h.rules().mergeSameValue,true);assert.equal(h.effective().mergeSameValue,false);
  h.set('multipleBuilds',true);assert.equal(h.effective().mergeSameValue,true);
  h.set('builds',false);assert.equal(h.effective().multipleBuilds,false);assert.equal(h.effective().mergeSameValue,false);
  h.set('builds',true);assert.equal(h.effective().mergeSameValue,true);
  h.set('additiveBuilds',true);h.set('additiveCapture',false);assert.equal(h.effective().additiveBuilds,false);
  h.set('additiveCapture',true);assert.equal(h.effective().additiveBuilds,true);
});
test('Sweep cancellation no longer changes selected sweep points',()=>{
  const h=make();h.set('sweepPoints',10);h.set('sweepCancel',true);
  assert.equal(h.rules().sweepPoints,10);
  h.set('sweepPoints',0);assert.equal(h.rules().sweepCancel,true);assert.equal(h.effective().sweepCancel,false);
  h.set('sweepPoints',50);assert.equal(h.effective().sweepCancel,true);assert.equal(h.effective().sweepPoints,50);
});
test('Compatibility is always visible, blocks Start, and offers relevant review links',()=>{
  const h=make();h.set('directCapture',false);h.set('additiveCapture',false);
  assert.equal(blocked(h),true);h.issues();
  assert.match(h.html(),/data-action="rules-jump" data-value="capture"/);
  h.set('directCapture',true);assert.equal(blocked(h),false);
  assert.match(h.html(),/Static check/);
});
test('Advanced accordion summaries, explanations and old custom flags survive',()=>{
  const h=harness(E.rulesFor('classic',{royalAces:true,drawMode:true,buildAnything:true}));h.open('newgame');h.choose('custom');h.tab('advanced');h.section('values');h.info('faceMode');
  assert.match(h.html(),/value="14" selected/);assert.match(h.html(),/value="draw" selected/);assert.match(h.html(),/inline-setting-info/);
  assert.match(h.html(),/2 vs\. 2 partnerships/);assert.doesNotMatch(h.html(),/data-setting="multiHandCapture"|data-setting="pileAccess"/);
  h.set('buildObligation',true);assert.equal(h.rules().buildAnything,false);
});
test('Layout keeps four difficulty columns and fixed navigation/footer',()=>{
  assert.match(css,/\.diff-row\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(css,/\.diff-row\s*\{[^}]*grid-template-columns:repeat\(2,/);
  assert.match(css,/\.rules-footer\{flex:none/);
  assert.match(css,/\.rules-accordion-body\[hidden\]\{display:none/);
  assert.match(app,/existingSettings\.innerHTML = renderSettings\(\)/);
  assert.match(app,/restoreVariationsScroll\(\)/);
});
