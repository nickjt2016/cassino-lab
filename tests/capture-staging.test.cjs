const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/compact.css'), 'utf8');

test('The hand is the turn cue and becomes active only when the player can act', () => {
  const start=app.indexOf('  function handIsActive('),end=app.indexOf('  function cancelMotion(',start);
  const ready=(screen,phase,turn,busy=false,turnInMotion=false,dealing=false)=>
    new Function('screen','game','busy','turnInMotion','dealing',app.slice(start,end)+';return handIsActive();')(
      screen,{phase,turn},busy,turnInMotion,dealing);
  assert.equal(ready('game','playing',0),true);
  for(const state of [
    ['game','playing',1],['game','playing',0,true],['game','playing',0,false,true],
    ['game','playing',0,false,false,true],['game','roundOver',0],['home','playing',0]
  ])assert.equal(ready(...state),false,JSON.stringify(state));
  assert.match(app,/human-hand\$\{active\|\|showingDeal\?'':' hand-inactive'\}/);
  assert.match(app,/class="sr-only" role="status">\$\{active\?'Your turn':'Waiting for your turn'\}/);
  assert.doesNotMatch(app,/class="turn-banner"/);
  assert.doesNotMatch(app, /message\.textContent=\`Remaining cards collected/);
  assert.doesNotMatch(app, /phaseText = [^\n]*Computer thinking/);
});

test('capture landing is player-front and mirrored CPU-front, not the score badge', () => {
  assert.match(app, /const captureFront = capture && feltRectForCapture/);
  assert.match(app, /height\*\(snapshot\.byComputer\?\.28:\.72\)/);
  assert.doesNotMatch(app, /available\/tableHeight|frontScale/);
  assert.match(app, /const frontPositions=stack\.map/);
  const branch = app.slice(app.indexOf('if(capture){'), app.indexOf("} else if(snapshot.kind === 'build' && !snapshot.finalHand)"));
  assert.match(branch,/captureTrack\(entry,frontPositions\[i\],scale,i,stagger,gatherDuration,collectAt\)/);
  const track=app.slice(app.indexOf('    function captureTrack('),app.indexOf('    async function gatherEndOfHand'));
  assert.match(track,/landing=transform\(front.x,front.y,scale,scaleY\)/);
  assert.match(track,/finish=transform\(end.x,end.y,scale\*collectionFinish,scaleY\*collectionFinish\)/);
  assert.doesNotMatch(branch, /targetCards|revealScale|move\(played,top|const collected|const avg/);
});

test('capturing card is topmost; every build card is collected individually', () => {
  assert.match(app, /snapshot\.groups\.flatMap\(group =>/);
  assert.match(app, /group\.cards && group\.cards\.length \? group\.cards : \[group\]/);
  assert.match(app, /i===0 \? 1000 : 105\+i/);
  assert.match(app, /const stack=ghosts\.map/);
  assert.match(app, /const flights=stack\.map/);
});

test('whole stack remains card-sized until it is moved in front of the player', () => {
  assert.match(app, /scale:size.width\/Math\.max\(entry\.rect\.width,1\)/);
  assert.match(app, /const collectAt=gatherAt\+125/);
  assert.match(app, /finish=transform\(end.x,end.y,scale\*collectionFinish,scaleY\*collectionFinish\)/);
});

test('All cards share centered rank and suit columns and a small fixed gap', () => {
  const section = css.slice(css.indexOf('/* Shared card artwork:'));
  assert.match(section, /grid-template-columns:25cqw 19cqw;column-gap:1cqw/);
  assert.match(section, /align-items:center;justify-items:center/);
  assert.match(section, /text-align:center/);
  assert.match(section, /font-variant-numeric:tabular-nums/);
  assert.doesNotMatch(css, /\.build-pile \.build-layer \.playing-card:not\(\.mini\) \.card-corner/);
  assert.doesNotMatch(section, /flex:0 0 1\.35em/);
});

for (const byComputer of [false,true]) {
  test((byComputer?'Computer':'Human') + ' capture uses one uninterrupted track with gather and collection stages', async () => {
    const begin=app.indexOf('  function playMotion('), end=app.indexOf('  const escapeHtml',begin);
    const rect=(left,top,width=50,height=70)=>({left,top,width,height,right:left+width,bottom:top+height});
    const field=rect(0,100,300,400), badge=rect(125,byComputer?20:540,50,20);
    const piece=(id,left,top)=>({id,html:'<span class="playing-card"></span>',rect:rect(left,top)});
    const played=piece('S8',120,byComputer?40:510);
    const cards=[piece('H3',20,300),piece('D5',45,318),piece('C8',130,300)], nodes=[];
    const document={body:{appendChild(node){nodes.push(node);}},createElement(){return {
      style:{},frames:[],querySelector(){return null;},getAnimations(){return [];},remove(){},
      animate(frames){this.frames.push(frames);const anim={};Promise.resolve().then(()=>anim.onfinish?.());return anim;}
    };}};
    const host={querySelector(selector){return {getBoundingClientRect:()=>selector==='.table-area'?field:badge};}};
    const motion=new Function('app','document','motionAllowed','motionGeneration','sound','setTimeout','renderBack','game',
      app.slice(begin,end)+';return playMotion;')(host,document,()=>true,0,()=>{},cb=>cb(),()=>'<span class="card-back"><span class="back-pattern"></span></span>',{players:[{},{}]});
    await new Promise(resolve=>motion({kind:'capture',byComputer,played,tableRects:cards.map(c=>c.rect),looseCardRects:cards.map(c=>c.rect),groups:[
      {rect:cards[0].rect,cards:cards.slice(0,2)},{rect:cards[2].rect,cards:[cards[2]]}
    ],finalHand:false},resolve));
    assert.equal(nodes.length,4);
    assert.ok(Number(nodes[0].style.zIndex)>Number(nodes[3].style.zIndex));
    const frontY=100+400*(byComputer?.28:.72);
    for(let i=0;i<nodes.length;i++){
      const flights=nodes[i].frames.filter(frames=>frames[0].transform.startsWith('translate'));
      assert.equal(flights.length,1);
      const r=[played,...cards][i].rect;
      const dx=150+Math.min(i,7)*1.2-(r.left+r.width/2);
      const dy=frontY+Math.min(i,7)*1.5-(r.top+r.height/2);
      const landing='translate('+dx+'px,'+dy+'px) scale('+50*1.06/r.width+', '+(50*1.06/.715/r.height)+')';
      const frames=flights[0],gather=frames.at(-3),hold=frames.at(-2),finish=frames.at(-1);
      assert.equal(gather.transform,landing);
      assert.equal(hold.transform,landing);
      assert.match(nodes[i].style.boxShadow,/rgba\(0,0,0,.36\)/);
      const dimensions=frame=>frame.transform.match(/scale\(([^,]+), ([^)]+)\)/).slice(1).map(Number);
      const raised=dimensions(hold),collected=dimensions(finish);
      assert.ok(Math.abs(collected[0]-raised[0]*.32)<1e-8);
      assert.ok(Math.abs(collected[1]-raised[1]*.32)<1e-8);
      const lifted=frames.find(frame=>frame.transform.includes('translate(0px,-5px)'));
      assert.deepEqual(dimensions(lifted),raised);
      assert.ok(frames.some(frame=>frame.transform.includes('translate(0px,-5px)')));
      assert.equal(gather.opacity,1);
      assert.equal(hold.opacity,1);
      assert.equal(finish.opacity,.06);
      const flip=byComputer?335:0,duration=flip+340+105+125+280;
      assert.ok(Math.abs(hold.offset*duration-(duration-280))<1e-8);
      assert.ok(Math.abs(gather.offset*duration-(flip+340+i*35))<1e-8);
    }
  });
}

for (const byComputer of [false,true]) {
  test((byComputer?'CPU':'Human')+' tall multiple build keeps the same size as an ordinary capture',async()=>{
    const begin=app.indexOf('  function playMotion('),end=app.indexOf('  const escapeHtml',begin);
    const rect=(left,top,width=58,height=81)=>({left,top,width,height});
    const field=rect(0,100,400,440),badge=rect(180,byComputer?10:570,40,20);
    const piece=(id,left,top,width=58,height=81)=>({id,html:'<span class="playing-card"></span>',rect:rect(left,top,width,height)});
    const row=piece('loose',150,285);
    const played=piece('played',170,byComputer?40:550,byComputer?35:70,byComputer?49:98);
    const layers=Array.from({length:8},(_,i)=>piece('build'+i,300,byComputer?102+i*25:250+i*25,52,72.8));
    const run=async(cards,isBuild,cramped=false)=>{
      const nodes=[];
      const document={body:{appendChild(node){nodes.push(node);}},createElement(){return{
        style:{},frames:[],querySelector(){return null;},getAnimations(){return [];},remove(){},
        animate(frames){this.frames.push(frames);const anim={};Promise.resolve().then(()=>anim.onfinish?.());return anim;}
      };}};
      const host={querySelector(selector){return {getBoundingClientRect:()=>selector==='.table-area'?(cramped?rect(0,260,400,120):field):selector==='.human-hand'?rect(40,540,320,100):badge};},
        querySelectorAll(){return [];}};
      const motion=new Function('app','document','motionAllowed','motionGeneration','sound','setTimeout','renderBack','game',
        app.slice(begin,end)+';return playMotion;')(host,document,()=>true,0,()=>{},fn=>fn(),()=>'<span class="card-back"></span>',{players:[{},{}]});
      await new Promise(resolve=>motion({kind:'capture',byComputer,played,
        tableRects:[row.rect,...layers.map(p=>p.rect)],looseCardRects:[row.rect],
        groups:isBuild?[{rect:layers[0].rect,cards}]:[{rect:row.rect,cards:[row]}],finalHand:false},resolve));
      return nodes.map((node,i)=>{
        const r=[played,...cards][i].rect;
        const flights=node.frames.filter(frames=>frames[0].transform.startsWith('translate'));
        const scale=frame=>Number(frame.transform.match(/scale\(([^,]+),/)[1]);
        return {land:r.width*scale(flights[0].at(-3)),collect:r.width*scale(flights[0].at(-1))};
      });
    };
    for(const card of [...await run([row],false),...await run(layers,true),...await run(layers,true,true)]){
      assert.ok(Math.abs(card.land-58*1.06)<1e-8,'fixed raised width');
      assert.ok(Math.abs(card.collect-card.land*.32)<1e-8,'shrink only toward score badge');
    }
  });
}
