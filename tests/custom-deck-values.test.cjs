const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../src/engine.js'),app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const card=id=>E.allCards().find(c=>c.id===id);
function harness(){
 const markup=app.slice(app.indexOf('  const SETTING_INFO = {'),app.indexOf('  function renderMenu()'));
 const state=app.slice(app.indexOf('  function openSettings('),app.indexOf("  app.addEventListener('change'"));
 return new Function('E',"let game={rules:E.rulesFor()},draft=null,draftPreset='classic',customDraft=null,customRules=null;let variationsScrollTop=0,detailSetting='',settingsOrigin='home',screen='home',modal='';const render=()=>{},escapeHtml=String;"+markup+state+"return {open:openSettings,choose:selectVariation,set:updateDraftSetting,html:renderSettings,info:key=>{detailSetting=key;},difficultyInfo:()=>{difficultyInfoOpen=true;},rules:()=>({...draft}),effective:effectiveDraftRules,deck:updateDeckCards,card:updateOneDeckCard,values:updateCardValue,picker:()=>{valuePickerOpen=true;},selectCard:k=>{valueCardKey=k;}};")(E);
}
test('Named decks have the requested ranks and legacy Italian decks migrate intact',()=>{
 for(const mode of ['40','52','54']){const r=E.rulesFor('classic',{deckMode:mode});assert.equal(E.makeDeck(r).length,Number(mode));assert.equal(E.validateRules(r).playable,true);}
 assert.ok(E.makeDeck(E.rulesFor('classic',{deckMode:'40'})).every(c=>c.rank<=10&&c.suit!=='X'));
 const it=E.rulesFor('scopa');assert.equal(it.deckMode,'custom');assert.equal(it.deckSize,40);
 assert.ok(E.makeDeck(it).every(c=>c.rank<8||c.rank>10));
});
test('Custom physical decks, two shared-value jokers, and values up to 30 are legal and conserved',()=>{
 const map={...E.initialCardValues(E.rulesFor()),S1:[12,30],Joker:[20,30]};
 const r=E.rulesFor('classic',{deckMode:'54',customizeCardValues:true,cardValueOverrides:map});
 for(const id of ['X1','X2'])assert.deepEqual(E.cardValues(card(id),r),[20,30]);
 const s=E.newMatch(r);s.turn=0;s.players[0].hand=[card('S1')];s.table=[{id:'t',type:'loose',card:card('X1')}];
 assert.equal(E.validateAction(s,{kind:'capture',cardId:'S1',targetIds:['t']}).ok,true);
 for(const cfg of [r,E.rulesFor('classic',{deckMode:'40'}),E.rulesFor('classic',{deckMode:'custom',deckCards:['S1','H1','D1','C1','S2','H2','D2','C2','X1'],initialTableSize:3,handSize:1})])assert.equal(E.simulateRules(cfg,3,1).completed,3);
});
test('Compatibility accounts for reserved table cards and custom deck restrictions',()=>{
 assert.equal(E.validateRules(E.rulesFor('classic',{deckMode:'54',handSize:27})).playable,false);
 assert.equal(E.validateRules(E.rulesFor('classic',{deckMode:'54',handSize:27,initialTableSize:0})).playable,true);
 assert.equal(E.validateRules(E.rulesFor('classic',{deckMode:'custom',deckCards:['S1','H1','D1','C1','S2','H2'],handSize:1,initialTableRule:'distinct-nonpoints'})).playable,false);
 assert.equal(E.validateRules(E.rulesFor('classic',{customizeCardValues:true,cardValueOverrides:{S1:[31]}})).playable,false);
});
test('Deck checklist, dynamic slider and custom values use the actual draft',()=>{
 const h=harness();h.open('newgame');assert.match(h.html(),/max="26" step="1"/);
 h.set('deckMode','40');assert.match(h.html(),/max="20" step="1"/);
 h.set('deckMode','54');assert.match(h.html(),/max="27" step="1"/);
 h.set('deckMode','custom');assert.equal((h.html().match(/data-setting="deckCard"/g)||[]).length,54);
 h.deck(['S1','H1','D1','C1','S2','H2','D2','C2','X1','X2']);assert.equal(h.rules().deckSize,10);
 h.set('customizeCardValues',true);h.picker();
 assert.equal((h.html().match(/data-action="value-card"/g)||[]).length,53);
 assert.match(h.html(),/data-value="S13"[^>]*disabled/);
 assert.match(h.html(),/data-setting="faceMode"[^>]*disabled/);
 h.selectCard('Joker');h.values('primaryValue','30');h.values('secondaryValue','20');
 assert.deepEqual(E.cardValues(card('X1'),h.rules()),[30,20]);
 h.set('customizeCardValues',false);assert.deepEqual(E.cardValues(card('X1'),h.rules()),[15]);
 h.set('customizeCardValues',true);assert.deepEqual(E.cardValues(card('X2'),h.rules()),[30,20]);
});
test('Difficulty descriptions are info-only and multi-option help uses separate labeled paragraphs',()=>{
 const h=harness();h.open('newgame');
 assert.ok(!h.html().includes(E.DIFFICULTY_INFO[1][2]));h.difficultyInfo();
 for(const [,title,desc] of E.DIFFICULTY_INFO){assert.ok(h.html().includes(title));assert.ok(h.html().includes(desc));}
 h.info('remainderMode');assert.match(h.html(),/<p><b>Smaller equal hands<\/b>/);assert.match(h.html(),/<p><b>Unequal hands<\/b>/);assert.match(h.html(),/<p><b>Full batches only<\/b>/);
 h.info('initialTableRule');assert.match(h.html(),/<p><b>No 3 kings<\/b>/);
 h.info('independentBuilds');assert.match(h.html(),/Two separate 8-builds count as two/);
});
