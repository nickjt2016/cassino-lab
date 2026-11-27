const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../src/engine.js'),app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8'),css=fs.readFileSync(path.join(__dirname,'../src/compact.css'),'utf8');
function memory(){
 const map=new Map();let fail=false;
 return {getItem:key=>map.get(key)||null,setItem:(key,value)=>{if(fail)throw Error('quota');map.set(key,value);},fail:()=>{fail=true;}};
}
function harness(storage,current=E.rulesFor(),old=null){
 const markup=app.slice(app.indexOf('  const SETTING_INFO = {'),app.indexOf('  function renderMenu()'));
 const state=app.slice(app.indexOf('  function openSettings('),app.indexOf("  app.addEventListener('change'"));
 return new Function('E','localStorage','current','customRules',
 "let game={rules:current},draft=null,draftPreset='classic',customDraft=null;let variationsScrollTop=0,detailSetting='',settingsOrigin='home',screen='home',modal='';let prefs={cardLayout:'default'};const savePrefs=()=>{},render=()=>{},escapeHtml=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');"+
 markup+state+"return {open:openSettings,choose:selectVariation,set:updateDraftSetting,html:renderSettings,save:saveNamedVariant,remove:removeNamedVariant,edit:beginVariantEditor,info:k=>{detailSetting=k;},deck:updateDeckCards,values:updateCardValue,selectCard:k=>{valueCardKey=k;},list:()=>JSON.parse(JSON.stringify(savedVariants)),rules:()=>JSON.parse(JSON.stringify(draft)),effective:effectiveDraftRules,preset:()=>draftPreset,source:()=>savedVariantSource,difficulty:v=>{draft.difficulty=v;}};")(E,storage,current,old);
}
test('Multiple named variants persist independently, including custom decks and card values',()=>{
 const store=memory(),h=harness(store);h.open('newgame');
 h.set('deckMode','custom');h.deck(['S1','H1','D1','C1','S2','H2','D2','C2','X1','X2']);
 h.set('initialTableSize',0);h.set('handSize',2);h.set('customizeCardValues',true);h.selectCard('Joker');h.values('primaryValue','30');h.values('secondaryValue','20');h.difficulty('expert');
 const first=h.save('My Joker Rules');assert.equal(first.ok,true);const snapshot=h.rules();
 h.set('builds',false);const second=h.save('No Builds');assert.equal(second.ok,true);assert.notEqual(first.id,second.id);
 const fresh=harness(store);fresh.open('newgame');
 assert.equal(fresh.list().length,2);assert.match(fresh.html(),/<optgroup label="Saved variants">/);assert.match(fresh.html(),/My Joker Rules/);assert.match(fresh.html(),/No Builds/);
 fresh.choose(first.id);assert.deepEqual(fresh.rules(),snapshot);assert.equal(fresh.rules().difficulty,'expert');
 fresh.choose(second.id);assert.equal(fresh.rules().builds,false);
 fresh.choose(first.id);assert.equal(fresh.rules().builds,true);
 assert.deepEqual(fresh.rules().cardValueOverrides.Joker,[30,20]);
 assert.equal(E.validateRules(fresh.effective()).playable,true);
 assert.equal(E.simulateRules(fresh.effective(),3,1).completed,3);
});
test('Editing saved variants is non-destructive until explicit update; rename and delete preserve other snapshots',()=>{
 const store=memory(),h=harness(store);h.open('newgame');const first=h.save('Original');
 h.set('handSize',6);assert.equal(h.preset(),'custom');assert.equal(h.source(),first.id);
 assert.equal(h.list()[0].rules.handSize,4);
 const copy=h.save('Copy');assert.equal(copy.ok,true);assert.equal(h.list()[0].rules.handSize,4);
 h.choose(first.id);h.set('handSize',8);
 assert.equal(h.save('Copy',first.id).ok,false);assert.equal(h.save('Renamed',first.id).ok,true);
 assert.equal(h.list()[0].name,'Renamed');assert.equal(h.list()[0].rules.handSize,8);
 assert.equal(h.list()[1].rules.handSize,6);
 assert.equal(h.remove(first.id).ok,true);assert.equal(h.preset(),'custom');assert.equal(h.rules().handSize,8);assert.equal(h.list().length,1);
 assert.equal(harness(store).list()[0].id,copy.id);
});
test('Named match resumes into its stored raw preferences, old unnamed custom rules are preserved',()=>{
 const store=memory(),h=harness(store);h.open('newgame');h.set('subtractiveBuilds',true);h.set('negativeBuilds',true);h.set('subtractiveBuilds',false);
 const named=h.save('Inactive preferences');const match=h.effective();
 const resume=harness(store,match);resume.open('game');assert.equal(resume.preset(),named.id);assert.equal(resume.rules().negativeBuilds,true);assert.equal(resume.effective().negativeBuilds,false);
 const old=E.rulesFor('royal',{name:'Custom Fishing',handSize:6});
 const legacy=harness(store,E.rulesFor(),old);legacy.open('newgame');legacy.choose('custom');assert.equal(legacy.rules().handSize,6);
});
test('Invalid names, blocked research profiles and storage failures do not overwrite the library',()=>{
 const store=memory(),h=harness(store);h.open('newgame');
 assert.equal(h.save(' ').ok,false);assert.equal(h.save('x'.repeat(61)).ok,false);
 const first=h.save('Original');assert.equal(h.save('original').ok,false);
 h.choose('seep');assert.equal(h.save('Seep preview').ok,false);
 h.choose(first.id);h.set('handSize',8);store.fail();
 assert.equal(h.save('Original',first.id).ok,false);assert.equal(h.remove(first.id).ok,false);
 assert.equal(h.list()[0].rules.handSize,4);
});
test('Saved names are escaped; saving a draft does not bypass compatibility',()=>{
 const h=harness(memory());h.open('newgame');h.set('handSize',26);
 const saved=h.save('<My "variant">');assert.equal(saved.ok,true);
 assert.match(h.html(),/&lt;My &quot;variant&quot;&gt;/);
 assert.match(h.html(),/data-action="apply-settings"[^>]*disabled/);
});
