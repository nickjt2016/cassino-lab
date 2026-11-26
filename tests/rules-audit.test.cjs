const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../src/engine.js'),app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8'),css=fs.readFileSync(path.join(__dirname,'../src/compact.css'),'utf8');
const card=id=>E.allCards().find(c=>c.id===id);
function harness(){
 const markup=app.slice(app.indexOf('  const SETTING_INFO = {'),app.indexOf('  function renderMenu()'));
 const state=app.slice(app.indexOf('  function openSettings('),app.indexOf("  app.addEventListener('change'"));
 return new Function('E',"let game={rules:E.rulesFor()},draft=null,draftPreset='classic',customDraft=null,customRules=null;let variationsScrollTop=0,detailSetting='',settingsOrigin='home',screen='home',modal='';const render=()=>{},escapeHtml=String;"+markup+state+"return {open:openSettings,set:updateDraftSetting,choose:selectVariation,html:renderSettings,rules:()=>({...draft}),effective:effectiveDraftRules,info:key=>{detailSetting=key;}};")(E);
}
test('Seating has constant dimensions across every count and arrangement',()=>{
 const h=harness();h.open('newgame');
 for(let n=2;n<=6;n++){h.set('playerCount',n);for(const mode of E.teamModesFor(n)){h.set('teamMode',mode);const html=h.html();assert.doesNotMatch(html,/<p class="setup-preview-note">/);assert.equal((html.match(/<svg viewBox="0 0 320 220" class="setup-table-svg"/g)||[]).length,1);}}
 assert.match(css,/\.setup-table-figure \.setup-table-svg\{aspect-ratio:320\/220\}/);
 assert.match(css,/\.setup-seat-legend\.polar-seat-legend\{height:20px;min-height:20px;flex-wrap:nowrap/);
});
test('Inactive options retain their saved preferences',()=>{
 const h=harness();h.open('newgame');
 h.set('subtractiveBuilds',true);h.set('negativeBuilds',true);h.set('subtractiveBuilds',false);
 assert.equal(h.rules().negativeBuilds,true);assert.equal(h.effective().negativeBuilds,false);
 assert.match(h.html(),/data-setting="negativeBuilds"[^>]*disabled/);
 h.set('subtractiveBuilds',true);assert.equal(h.effective().negativeBuilds,true);
 h.set('forcedCapture','direct');h.set('directCapture',false);
 assert.equal(h.rules().forcedCapture,'direct');assert.equal(h.effective().forcedCapture,'optional');
 assert.match(h.html(),/<option value="direct"\s+disabled>/);
 h.set('directCapture',true);assert.equal(h.effective().forcedCapture,'direct');
 h.set('deckMode','40');assert.match(h.html(),/data-setting="faceMode"[^>]*disabled/);
 h.set('deckMode','52');assert.doesNotMatch(h.html(),/data-setting="faceMode"[^>]*disabled/);
 h.set('sweepPoints',1);h.set('sweepCancel',true);h.set('ignoreFinalSweep',true);h.set('extraAfterSweep',true);h.set('sweepPoints',0);
 assert.equal(h.effective().sweepCancel,false);assert.equal(h.effective().ignoreFinalSweep,false);assert.equal(h.effective().extraAfterSweep,true);
 h.set('sweepPoints',1);assert.equal(h.effective().sweepCancel,true);assert.equal(h.effective().ignoreFinalSweep,true);
 h.set('buildRange','custom');h.set('builds',false);assert.equal(h.effective().buildRange,'all');assert.equal(h.rules().buildRange,'custom');
});
test('All 2048 binary dependency combinations disable inactive flags',()=>{
 const keys=['builds','additiveBuilding','subtractiveBuilds','multipleBuilds','singleCardBuild','additiveCapture','directCapture','negativeBuilds','colorArithmetic','mergeSameValue','absorbMatching'];
 for(let mask=0;mask<2**keys.length;mask++){
  const raw=E.rulesFor('classic',Object.fromEntries(keys.map((k,i)=>[k,!!(mask&(1<<i))])));
  const active=E.activeRules(raw),activity=E.ruleActivity(raw);
  for(const k of ['additiveBuilding','subtractiveBuilds','multipleBuilds','singleCardBuild','negativeBuilds','colorArithmetic','mergeSameValue','absorbMatching','additiveBuilds','raiseOwnBuild','raiseOpponentBuild','directPriority'])
   if(activity.disabled[k])assert.equal(active[k],false,k+' mask '+mask);
  if(!raw.directCapture&&!raw.additiveCapture)assert.equal(E.validateRules(active).playable,false);
 }
});
test('No-capture decks are blocked for target-score matches, but fixed deals and dealer residue can finish',()=>{
 const r=E.rulesFor('classic',{deckMode:'custom',deckCards:['S11','S12','S13','S10'],initialTableSize:0,handSize:2,builds:false,directCapture:true,additiveCapture:false});
 assert.equal(E.validateRules(E.activeRules(r)).playable,false);
 assert.ok(E.validateRules(E.activeRules(r)).errors.some(s=>/cannot make any capture/.test(s)));
 assert.equal(E.validateRules(E.activeRules({...r,matchDeals:1})).playable,true);
 assert.ok(E.validateRules(E.activeRules({...r,matchDeals:1})).warnings.some(s=>/cannot make any capture/.test(s)));
 assert.equal(E.validateRules(E.activeRules({...r,residueOwner:'dealer'})).playable,true);
 assert.ok(E.validateRules(r).warnings.some(s=>/scoring categories/.test(s)));
 const sum=E.rulesFor('classic',{deckMode:'custom',deckCards:['S3','S5','H8','C11'],initialTableSize:0,handSize:2,builds:false,directCapture:false,additiveCapture:true});
 assert.equal(E.validateRules(E.activeRules(sum)).playable,true);
});
test('Direct priority does not strand the sole reserved build-capturing card',()=>{
 const s=E.newMatch(E.rulesFor('classic',{directPriority:true}));s.turn=0;s.players[0].hand=[card('S8')];s.table=[{id:'own',type:'build',owner:0,value:8,groups:[[card('S3'),card('D5')]]},{id:'eight',type:'loose',card:card('H8')}];
 const move={kind:'capture',cardId:'S8',targetIds:['own']};
 assert.equal(E.validateAction(s,move).ok,true);s.rules.pirateCaptures=true;assert.equal(E.validateAction(s,move).ok,true);
 s.players[0].hand.push(card('D8'));assert.equal(E.validateAction(s,move).ok,false);
});
test('Unequal deal starts at non-dealer and gives that seat the extra card',()=>{
 for(const dealer of [0,1]){const rules=E.rulesFor('classic',{deckMode:'custom',deckCards:['S1','S2','S3','S4','S5'],initialTableSize:0,dealMode:'full',remainderMode:'uneven'}),s=E.makeState(rules,dealer);assert.equal(s.players[1-dealer].hand.length,3);assert.equal(s.players[dealer].hand.length,2);}
});
test('Regional scoring fixtures and help',()=>{
 const full=E.allCards().filter(c=>c.suit!=='X');
 for(const [id,expected] of [['cassinoNortheast',11],['nordic',11],['swedishOver',16],['wippen',11]]){const s=E.newMatch(E.rulesFor(id));s.players[0].captured=full;s.players[1].captured=[];s.lastCapture=0;assert.equal(E.scoreHand(s)[0].total,expected,id);}
 assert.equal(E.rulesFor('wippen').sweepPoints,1);
 const h=E.newMatch(E.rulesFor('hurrikan'));h.players[0].captured=E.makeDeck(h.rules);h.players[1].captured=[];assert.equal(E.scoreHand(h)[0].total,4);
 assert.ok(E.scoreHelp(h.rules).some(([k,v])=>k==='Primiera'&&v.includes('J=8, Q=9, K=10')));
 assert.ok(E.scoreHelp(E.rulesFor('nordic')).some(([k])=>k==='Last capture'));
});
test('Randomized matrix: two complete CPU deals per playable configuration',()=>{
 let seed=175044;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296},choose=a=>a[Math.floor(rand()*a.length)];
 const deck=E.allCards().filter(c=>c.rank>=3&&c.rank<=7&&c.suit!=='X').map(c=>c.id);
 let configs=0,blocked=0,completed=0;
 for(let i=0;i<160;i++){
 const raw={deckMode:'custom',deckCards:deck,initialTableSize:choose([0,3,4,8]),handSize:choose([1,2,3,4,6,8]),dealMode:choose(['batch','draw','full']),remainderMode:choose(['equal','uneven','strict']),builds:choose([true,true,false]),directCapture:choose([true,true,false]),additiveCapture:choose([true,true,false]),captureGroups:choose(['one','unlimited']),forcedCapture:choose(['optional','direct','all','faces']),captureExtent:choose(['choice','maximal','maximum']),additiveBuilding:choose([true,false]),subtractiveBuilds:choose([true,false]),multipleBuilds:choose([true,false]),negativeBuilds:choose([true,false]),colorArithmetic:choose([true,false]),singleCardBuild:choose([true,false]),raiseOwnBuild:choose([true,false]),raiseOpponentBuild:choose([true,false]),mergeSameValue:choose([true,false]),absorbMatching:choose([true,false]),pirateCaptures:choose([true,false]),pirateBuilds:choose([true,false]),allowTrailWithOwnBuild:choose([true,false]),buildAnything:choose([true,false]),directPriority:choose([true,false]),extraAfterSweep:choose([true,false]),sweepPoints:choose([0,1,10]),sweepCancel:choose([true,false]),scoreProfile:choose(['cassino','scopa','wippen','tablic','diloti','kontsina','swedish','overspader','hurrikan','northeast']),residueOwner:choose(['dealer','lastCapture']),additiveBuilds:choose([true,false]),buildRange:choose(['all','custom','9-13']),buildMin:3,buildMax:7};
 const rules=E.activeRules(E.rulesFor('classic',raw)),v=E.validateRules(rules);configs++;
 if(!v.playable){blocked++;assert.equal(E.simulateRules(rules,2,300+i*2).tested,0);continue;}
 const r=E.simulateRules(rules,2,300+i*2);assert.equal(r.completed,2,'config '+i+' '+JSON.stringify(r.failures.map(f=>({seed:f.seed,reason:f.reason}))));completed+=r.completed;
 }
 assert.equal(configs,160);assert.ok(blocked>0);assert.ok(completed>=190);assert.equal(completed,2*(configs-blocked));
 console.log('Audit: '+configs+' configs; '+blocked+' blocked; '+completed+' completed deals.');
});
