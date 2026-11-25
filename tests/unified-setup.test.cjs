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
  return new Function('E','customRules','current',`
    let game={rules:current},draft=null,draftPreset='classic',customDraft=null;
    let variationsScrollTop=0,detailSetting='',settingsOrigin='home',screen='home',modal='';
    const render=()=>{},escapeHtml=String;
    ${markup}
    ${state}
    return {open:openSettings,choose:selectVariation,set:updateDraftSetting,html:renderSettings,
      info:key=>{detailSetting=key;},difficulty:value=>{draft.difficulty=value;},
      rules:()=>({...draft}),preset:()=>draftPreset};
  `)(E,saved,current);
}
const input=(html,key)=>html.match(new RegExp('<input[^>]*data-setting="'+key+'"[^>]*>'))?.[0] || '';
const checked=(html,key)=>/\bchecked\b/.test(input(html,key));
const disabled=(html,key)=>/\bdisabled\b/.test(input(html,key));
test('One setup contains players, difficulty, all five variations, and one Start Game action',()=>{
  const h=harness();h.open('newgame');
  const html=h.html();
  assert.match(html,/New Game/);
  assert.match(html,/PLAYERS/);
  assert.equal((html.match(/DIFFICULTY/g)||[]).length,1);
  assert.equal((html.match(/data-action="preset-choice"/g)||[]).length,5);
  assert.equal((html.match(/data-action="apply-settings"/g)||[]).length,1);
  assert.doesNotMatch(app,/function renderNewGame|function renderSettingInfo|modal = 'newgame'/);
});
test('All preset switches reflect the engine and can be edited directly',()=>{
  const h=harness();h.open('newgame');h.difficulty('casual');
  for(const key of Object.keys(E.PRESETS)){
    h.choose(key);
    const html=h.html(),rules=E.rulesFor(key,{difficulty:'casual'});
    assert.deepEqual(h.rules(),rules);
    for(const prop of Object.keys(rules).filter(p=>typeof rules[p]==='boolean')){
      const key=prop==='buildAnything'?'buildObligation':prop;
      assert.ok(input(html,key),key);
      assert.equal(checked(html,key),prop==='buildAnything'?!rules[prop]:rules[prop],key);
      assert.equal(disabled(html,key),false,key);
    }
    assert.doesNotMatch(html,/<select data-setting="winningScore" disabled>/);
    assert.match(html,new RegExp('value="'+rules.winningScore+'" selected'));
    h.set('royal',!rules.royal);
    assert.equal(h.preset(),'custom');
    assert.equal(h.rules().royal,!rules.royal);
    assert.equal(h.rules().winningScore,rules.winningScore);
  }
});
test('First Custom selection inherits the previewed preset and unlocks rules',()=>{
  const h=harness();h.open('newgame');h.choose('royalSpade');h.choose('custom');
  assert.equal(h.rules().royal,true);
  assert.equal(h.rules().spadeScoring,true);
  assert.equal(h.rules().winningScore,61);
  assert.equal(disabled(h.html(),'royal'),false);
  assert.doesNotMatch(h.html(),/<select data-setting="winningScore" disabled>/);
  h.set('royal',false);h.set('winningScore',31);
  assert.equal(h.rules().winningScore,31);
  h.choose('royal');assert.equal(h.rules().royal,true);
  h.choose('custom');assert.equal(h.rules().royal,false);
  assert.equal(h.rules().winningScore,31);
});
test('Previously saved custom rules are restored independently of preset and difficulty',()=>{
  const h=harness(E.rulesFor('classic',{drawMode:true,winningScore:50}));
  h.open('newgame');h.difficulty('casual');h.choose('royal');h.choose('custom');
  assert.equal(h.rules().drawMode,true);
  assert.equal(h.rules().winningScore,50);
  assert.equal(h.rules().difficulty,'casual');
});
test('Dependent build switches stay editable; enabling one enables building',()=>{
  const h=harness();h.open('newgame');h.choose('custom');h.set('pirateBuilds',true);
  h.set('builds',false);
  for(const key of ['multipleBuilds','pirateBuilds','allowTrailWithOwnBuild','buildAnything']){
    assert.equal(h.rules()[key],false);
    assert.equal(disabled(h.html(),key==='buildAnything'?'buildObligation':key),false);
    h.set(key,true);assert.equal(h.rules()[key],true);
    assert.equal(h.rules().builds,true);
    h.set('builds',false);
  }
});
test('In-game setup recognizes the current preset and explanations stay inline',()=>{
  const h=harness(null,E.rulesFor('spade'));h.open('game');
  assert.equal(h.preset(),'spade');
  h.info('royal');assert.match(h.html(),/inline-setting-info/);
  assert.match(h.html(),/Jacks, Queens and Kings have numerical values/);
  assert.doesNotMatch(css,/\.unified-setup \.var-toggle input:disabled:checked\+i/);
  assert.match(app,/existingSettings\.innerHTML = renderSettings\(\)/);
  assert.match(app,/restoreVariationsScroll\(\)/);
});

test('No explanatory paragraph appears beneath any variation selector',()=>{
  const h=harness();h.open('newgame');
  for(const key of [...Object.keys(E.PRESETS),'custom']) {
    h.choose(key);
    assert.doesNotMatch(h.html(),/setup-rule-note|Choose Custom to edit|Customize the rules below|Your choices are saved/);
  }
  assert.doesNotMatch(css,/\.setup-rule-note/);
});

test('Build Obligation is a visible inverse of the legacy saved Build To Anything flag',()=>{
  const h=harness();h.open('newgame');
  assert.equal(checked(h.html(),'buildObligation'),true);
  assert.equal(input(h.html(),'buildAnything'),'');
  h.set('buildObligation',false);assert.equal(h.rules().buildAnything,true);
  assert.equal(checked(h.html(),'buildObligation'),false);
  h.set('buildObligation',true);assert.equal(h.rules().buildAnything,false);
  assert.equal(checked(h.html(),'buildObligation'),true);
  const saved=harness(E.rulesFor('royal',{buildAnything:true}));
  saved.open('newgame');saved.choose('custom');
  assert.equal(checked(saved.html(),'buildObligation'),false);
});
