const test=require('node:test'),assert=require('node:assert/strict'),E=require('../src/engine.js');
const card=id=>({id,suit:id[0],rank:Number(id.slice(1))});
test('All catalog entries have an explicit availability state; playable presets complete seeded deals',()=>{
 for(const p of E.PRESET_CATALOG){const r=E.rulesFor(p.id),v=E.validateRules(r);assert.equal(v.playable,p.status==='playable',p.name);
 if(v.playable)assert.equal(E.simulateRules(r,5,1).completed,5,p.name);else assert.throws(()=>E.newMatch(r),/./);}
});
test('Suipi starting-table restrictions',()=>{
 for(let seed=1;seed<=15;seed++){let n=seed;const random=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};const s=E.newMatch(E.rulesFor('suipi'),random),cards=s.table.map(x=>x.card);assert.equal(new Set(cards.map(c=>c.rank)).size,4);assert.ok(cards.every(c=>c.rank!==1&&c.id!=='D10'&&c.id!=='S2'));assert.equal(E.checkInvariants(s),null);}
});
test('Scopa priority and compulsory capture',()=>{
 const s=E.newMatch(E.rulesFor('scopa'));s.turn=0;s.players[0].hand=[card('S5')];s.table=[{id:'x',type:'loose',card:card('H5')},{id:'y',type:'loose',card:card('D2')},{id:'z',type:'loose',card:card('C3')}];
 assert.equal(E.validateAction(s,{kind:'capture',cardId:'S5',targetIds:['y','z']}).ok,false);
 assert.equal(E.validateAction(s,{kind:'capture',cardId:'S5',targetIds:['x']}).ok,true);
 assert.equal(E.validateAction(s,{kind:'trail',cardId:'S5',targetIds:[]}).ok,false);
});
test('Diloti and Tablic regional scoring',()=>{
 const d=E.newMatch(E.rulesFor('diloti'));d.players[0].captured=[card('C2'),card('D10'),card('H1')];d.players[1].captured=[card('S2')];d.players[0].sweeps=2;assert.equal(E.scoreHand(d)[0].total,28);
 const t=E.newMatch(E.rulesFor('tablic'));t.players[0].captured=[card('C2'),card('D10'),card('H10'),card('S1'),card('C13')];assert.equal(E.scoreHand(t)[0].total,9);
});
