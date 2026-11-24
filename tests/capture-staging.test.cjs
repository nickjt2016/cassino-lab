const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/compact.css'), 'utf8');

test('turn banner only uses the two requested phrases', () => {
  assert.match(app, /const phaseText = game\.turn === 0 \? 'Your turn' : "Opponent's turn";/);
  assert.doesNotMatch(app, /message\.textContent=\`Remaining cards collected/);
  assert.doesNotMatch(app, /phaseText = [^\n]*Computer thinking/);
});

test('capture landing is player-front and mirrored CPU-front, not the score badge', () => {
  assert.match(app, /const captureFront = capture && feltRectForCapture/);
  assert.match(app, /feltRectForCapture\.height\*\(snapshot\.byComputer \? 0\.24 : 0\.72\)/);
  assert.match(app, /const frontPositions=stack\.map/);
  const branch = app.slice(app.indexOf('if(capture){'), app.indexOf("} else if(snapshot.kind === 'build' && !snapshot.finalHand)"));
  const land = branch.indexOf('move(entry,frontPositions[i]');
  const finish = branch.indexOf('move(entry,end,280',land);
  assert.ok(land >= 0 && finish > land);
  assert.doesNotMatch(branch, /targetCards|revealScale|move\(played,top|const collected|const avg/);
});

test('capturing card is topmost; every build card is collected individually', () => {
  assert.match(app, /snapshot\.groups\.flatMap\(group =>/);
  assert.match(app, /group\.cards && group\.cards\.length \? group\.cards : \[group\]/);
  assert.match(app, /i===0 \? 1000 : 105\+i/);
  assert.match(app, /const stack=ghosts\.map/);
  assert.match(app, /await Promise\.all\(stack\.map/);
});

test('whole stack remains card-sized until it is moved in front of the player', () => {
  assert.match(app, /scale:tableWidth\/Math\.max\(entry\.rect\.width,1\)/);
  assert.match(app, /setTimeout\(resolve,125\)/);
  assert.match(app, /scale:\.32,fade:true/);
});

test('build pile shoulder rank and suit share the same baseline', () => {
  const section = css.slice(css.indexOf('/* v0.5.11'));
  assert.match(section, /align-items:baseline/);
  assert.match(section, /flex:0 0 1\.35em/);
  assert.match(section, /font-variant-numeric:tabular-nums/);
  assert.match(section, /card-corner small/);
});

for (const byComputer of [false,true]) {
  test((byComputer?'Computer':'Human') + ' capture has exactly two flights per physical card, with no intermediate stop', async () => {
    const begin=app.indexOf('  function playMotion('), end=app.indexOf('  const escapeHtml',begin);
    const rect=(left,top,width=50,height=70)=>({left,top,width,height,right:left+width,bottom:top+height});
    const field=rect(0,100,300,300), badge=rect(125,byComputer?20:440,50,20);
    const piece=(id,left,top)=>({id,html:'<span class="playing-card"></span>',rect:rect(left,top)});
    const played=piece('S8',120,byComputer?40:410);
    const cards=[piece('H3',20,180),piece('D5',45,198),piece('C8',190,200)], nodes=[];
    const document={body:{appendChild(node){nodes.push(node);}},createElement(){return {
      style:{},frames:[],querySelector(){return null;},getAnimations(){return [];},remove(){},
      animate(frames){this.frames.push(frames);const anim={};Promise.resolve().then(()=>anim.onfinish?.());return anim;}
    };}};
    const host={querySelector(selector){return {getBoundingClientRect:()=>selector==='.table-area'?field:badge};}};
    const motion=new Function('app','document','motionAllowed','motionGeneration','sound','setTimeout',
      app.slice(begin,end)+';return playMotion;')(host,document,()=>true,0,()=>{},cb=>cb());
    await new Promise(resolve=>motion({kind:'capture',byComputer,played,groups:[
      {rect:cards[0].rect,cards:cards.slice(0,2)},{rect:cards[2].rect,cards:[cards[2]]}
    ],finalHand:false},resolve));
    assert.equal(nodes.length,4);
    assert.ok(Number(nodes[0].style.zIndex)>Number(nodes[3].style.zIndex));
    const frontY=100+300*(byComputer?.24:.72);
    for(let i=0;i<nodes.length;i++){
      const flights=nodes[i].frames.filter(frames=>frames[0].transform.startsWith('translate'));
      assert.equal(flights.length,2);
      const r=[played,...cards][i].rect;
      const dx=150+Math.min(i,7)*1.2-(r.left+r.width/2);
      const dy=frontY+Math.min(i,7)*1.5-(r.top+r.height/2);
      const landing='translate('+dx+'px,'+dy+'px) scale(1, 1)';
      assert.equal(flights[0][2].transform,landing);
      assert.equal(flights[1][0].transform,landing);
      assert.equal(flights[0][2].opacity,1);
      assert.equal(flights[1][2].opacity,.06);
    }
  });
}
