const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../src/engine.js');
test('static compatibility separates conflicts and planned capabilities',()=>{
  assert.equal(E.validateRules(E.rulesFor()).playable,true);
  assert.ok(E.validateRules(E.rulesFor('classic',{multiHandCapture:true})).errors.length);
  assert.equal(E.validateRules(E.rulesFor('classic',{playerCount:4})).playable,true);
  assert.ok(E.validateRules(E.rulesFor('classic',{handSize:8,initialTableSize:0,remainderMode:'strict'})).errors.length);
  assert.equal(E.validateRules(E.rulesFor('classic',{deckSize:40,builds:true,buildRange:'9-13'})).playable,false);
});
for(const [name,overrides] of [["Classic",{}],["Royal",{"royal":true,"royalAces":true}],["Large hand",{"handSize":8}],["Partial final batch",{"handSize":6}],["Unequal",{"initialTableSize":3,"remainderMode":"uneven"}],["40 deck",{"deckSize":40}],["Draw",{"drawMode":true}],["Restrictions",{"buildLimit":"1","raiseOwnBuild":false,"raiseOpponentBuild":false}],["Subtraction",{"subtractiveBuilds":true,"singleCardBuild":true,"royal":true}],["Compulsory",{"forcedCapture":"all"}],["Direct only",{"additiveCapture":false}],["Sum only",{"directCapture":false}],["One group",{"captureGroups":"one"}],["Build arithmetic",{"additiveBuilds":true}],["Extra turns",{"extraAfterSweep":true}],["Merging",{"mergeSameValue":true,"absorbMatching":true}],["Maximum",{"captureExtent":"maximum"}],["Maximal",{"captureExtent":"maximal"}],["Mixed",{"deckSize":40,"handSize":6,"buildRange":"9-13","royal":true,"extraAfterSweep":true,"subtractiveBuilds":true,"forcedCapture":"direct","captureGroups":"one"}]]){
  test(name+' completes seeded deals with conserved cards',()=>{
    const result=E.simulateRules(E.rulesFor('classic',overrides),5,1);
    assert.equal(result.completed,5,JSON.stringify(result.failures));
    assert.equal(result.failures.length,0);
  });
}
test('subtractive builds are legal and discoverable',()=>{
  const card=id=>({id,suit:id[0],rank:Number(id.slice(1))});
  const s=E.newMatch(E.rulesFor('classic',{subtractiveBuilds:true}));
  s.players[0].hand=[card('S2'),card('H7')];s.turn=0;s.table=[{id:'x',type:'loose',card:card('D9')}];
  assert.equal(E.validateAction(s,{kind:'build',cardId:'S2',targetIds:['x'],value:7,mode:'single'}).ok,true);
  assert.ok([...E.legalActions(s)].some(m=>m.kind==='build'&&m.value===7));
});
