const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../src/engine.js'),app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const card=id=>E.allCards().find(c=>c.id===id);
function fixture(o,hand,table){const s=E.newMatch(E.rulesFor('classic',o));s.turn=0;s.players[0].hand=hand.map(card);s.table=table.map(([id,c])=>({id,type:'loose',card:card(c)}));return s;}
const negative={kind:'build',cardId:'H7',targetIds:['three'],value:4,mode:'single'};
test('A signed negative single build is stored and captured at its absolute value',()=>{
 const s=fixture({subtractiveBuilds:true,negativeBuilds:true},['H7','S4'],[['three','S3']]);
 const result=E.validateAction(s,negative);assert.equal(result.ok,true);assert.equal(result.build.signedValue,-4);assert.equal(result.build.value,4);
 assert.ok(E.legalBuildOptions(s,'H7',['three']).some(m=>m.label==='Build -4'));
 assert.equal(E.applyAction(s,negative).ok,true);
 const build=s.table[0];assert.equal(build.value,4);assert.equal(build.signedValue,-4);
 s.turn=0;assert.equal(E.validateAction(s,{kind:'capture',cardId:'S4',targetIds:[build.id]}).ok,true);
});
test('Color arithmetic uses signed groups, and prohibits a negative result unless allowed',()=>{
 const s=fixture({colorArithmetic:true,subtractiveBuilds:true,negativeBuilds:true},['H7','S4'],[['three','S3']]);
 assert.equal(E.validateAction(s,negative).build.signedValue,-4);s.rules.negativeBuilds=false;assert.equal(E.validateAction(s,negative).ok,false);
 s.rules.negativeBuilds=true;assert.ok([...E.legalActions(s)].some(m=>m.kind==='build'&&m.value===4));
 const p=fixture({colorArithmetic:true,subtractiveBuilds:true},['H2','S6','C8'],[['five','C5'],['three','S3']]);
 const move={kind:'build',cardId:'H2',targetIds:['five','three'],value:6,mode:'single'};
 assert.equal(E.validateAction(p,move).ok,true);assert.ok([...E.legalActions(p)].some(m=>m.kind==='build'&&m.value===6&&m.targetIds.length===2));
 p.rules.subtractiveBuilds=false;assert.equal(E.validateAction(p,move).ok,false);
});
test('Color determines modification arithmetic; a negative result still honors owner and range rules',()=>{
 const s=fixture({colorArithmetic:true,subtractiveBuilds:true,negativeBuilds:true},['H7','S4'],[]);
 s.table=[{id:'b',type:'build',owner:1,value:3,groups:[[card('C1'),card('S2')]]}];
 const lower={kind:'build',cardId:'H7',targetIds:['b'],value:4,mode:'raise'};
 assert.equal(E.validateAction(s,lower).build.signedValue,-4);s.rules.raiseOpponentBuild=false;assert.equal(E.validateAction(s,lower).ok,false);
 s.rules.raiseOpponentBuild=true;s.players[0].hand=[card('S7'),card('C10'),card('S4')];
 assert.equal(E.validateAction(s,{...lower,cardId:'S7',value:10}).ok,true);assert.equal(E.validateAction(s,{...lower,cardId:'S7'}).ok,false);
});
test('Signed and color arithmetic complete seeded deals with conserved cards',()=>{
 for(const options of [{subtractiveBuilds:true,negativeBuilds:true},{subtractiveBuilds:true,negativeBuilds:true,colorArithmetic:true},{subtractiveBuilds:true,colorArithmetic:true},{additiveBuilding:false,subtractiveBuilds:true,colorArithmetic:true,negativeBuilds:true}])
 assert.equal(E.simulateRules(E.rulesFor('classic',options),5,1).completed,5);
});
test('Scoring help shows only the active system, before sweep controls',()=>{
 const markup=app.slice(app.indexOf('  const SETTING_INFO = {'),app.indexOf('  function renderMenu()'));
 const state=app.slice(app.indexOf('  function openSettings('),app.indexOf("  app.addEventListener('change'"));
 const h=new Function('E',"let game={rules:E.rulesFor()},draft=null,draftPreset='classic',customDraft=null,customRules=null;let variationsScrollTop=0,detailSetting='',settingsOrigin='home',screen='home',modal='';const render=()=>{},escapeHtml=String;"+markup+state+"return {open:openSettings,set:updateDraftSetting,html:renderSettings,info:k=>{detailSetting=k;},effective:effectiveDraftRules};")(E);
 h.open('newgame');h.info('scoreMode');let html=h.html();
 assert.ok(html.indexOf('data-setting="scoreMode"')<html.indexOf('data-setting="sweepPoints"'));
 assert.match(html,/<p><b>Most cards<\/b> — 3 points<\/p>/);assert.doesNotMatch(html,/<p><b>Primiera<\/b>/);
 h.set('scoreMode','scopa');assert.match(h.html(),/<p><b>Primiera<\/b>/);assert.doesNotMatch(h.html(),/<p><b>Most spades<\/b>/);
 h.set('scoreMode','spade');assert.match(h.html(),/<p><b>Each spade<\/b> — 1 point<\/p>/);
 h.set('subtractiveBuilds',true);h.set('negativeBuilds',true);h.set('colorArithmetic',true);assert.equal(h.effective().negativeBuilds,true);
 h.set('builds',false);assert.equal(h.effective().negativeBuilds,false);assert.equal(h.effective().colorArithmetic,false);
});
