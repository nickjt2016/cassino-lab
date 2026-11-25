const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/compact.css'), 'utf8');

test('Trails use destination-sized faces and composited transforms', () => {
  const start=app.indexOf('          // Trails use the exact same');
  const trail=app.slice(start,app.indexOf('        await labelsFaded;',start));
  assert.ok(start>=0);
  assert.match(app,/await flipComputerCard\(\)/);
  assert.match(trail,/const landingCard=destination\.querySelector\('\.playing-card'\)/);
  assert.match(trail,/const probe=document\.createElement\('span'\)/);
  assert.match(trail,/const flights=ghosts\.map\(\(g,i\)=>moveBuildCard\(g,/);
  assert.match(trail,/await Promise\.all\(\[\.\.\.flights,flipComputerCard\(\)\]\)/);
  assert.doesNotMatch(trail,/scaleY:|scale:|=>move\(/);
  assert.match(css,/\.playing-card:not\(\.mini\)\s*\{\s*box-sizing:border-box/);
});

for(const byComputer of [true,false])for(const rank of [1,6,10,13]){
  test((byComputer?'CPU':'Human')+' rank '+rank+' trails with exact physical landing geometry',async()=>{
    const begin=app.indexOf('  function playMotion('),end=app.indexOf('  const escapeHtml',begin);
    const rect=(left,top,width,height)=>({left,top,width,height});
    const source=byComputer?rect(140.125,30.5,33.625,46.75):rect(100.25,500.125,68.75,96.125);
    const landing=rect(83.375,257.625,58.25,81.46875);
    const events=[],nodes=[];
    const face='<span class="playing-card rank-'+rank+'"><span class="card-corner"><b>'+rank+'</b><small>♠</small></span></span>';
    const target={style:{},isConnected:true,matches:()=>true,
      getBoundingClientRect:()=>landing,
      querySelector:()=>({getBoundingClientRect:()=>landing})};
    const doc={body:{appendChild(node){nodes.push(node);}},createElement(){return{
      style:{},frames:[],querySelector(){return null;},getAnimations(){return [];},
      remove(){events.push('remove');},
      animate(frames,opts){this.frames.push({frames,opts});const anim={};Promise.resolve().then(()=>anim.onfinish?.());return anim;}
    };}};
    const host={querySelector:selector=>selector==='.table-area'?{getBoundingClientRect:()=>rect(0,100,400,350)}:target};
    const state={table:[{id:'trail'}]};
    const play=new Function('app','document','game','motionAllowed','motionGeneration','sound','setTimeout','renderBack',
      app.slice(begin,end)+';return playMotion;')(host,doc,state,()=>true,0,()=>{},fn=>fn(),()=>'<span class="card-back"></span>');
    await new Promise(resolve=>play({kind:'trail',byComputer,played:{id:'S'+rank,rect:source,html:face},groups:[],finalHand:false},resolve));
    assert.equal(nodes.length,1);
    const node=nodes[0];
    const flights=node.frames.filter(x=>x.frames[0].transform.startsWith('translate'));
    assert.equal(flights.length,1);
    const expected=r=>({left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
    const dx=source.left+source.width/2-landing.left-landing.width/2;
    const dy=source.top+source.height/2-landing.top-landing.height/2;
    assert.deepEqual(flights[0].frames,[
      {transform:'translate('+dx+'px,'+dy+'px) scale('+source.width/landing.width+', '+source.height/landing.height+')'},
      {transform:'translate(0px,0px) scale(1, 1)'}
    ]);
    assert.equal(flights[0].opts.fill,'both');
    for(const [key,value] of Object.entries(expected(landing)))assert.equal(node.style[key],value);
    assert.equal(node.style.transform,'none');
    assert.equal(node.innerHTML,face);
    assert.equal(target.style.visibility,'visible');
    assert.equal(node.frames.length,1);
    assert.equal(flights[0].opts.delay,byComputer?335:0);
  });
}
test('Final trail commits real landing size before remaining-card collection',()=>{
  const start=app.indexOf('    function moveBuildCard(');
  const end=app.indexOf('    // A card\'s last position',start);
  const helper=app.slice(start,end);
  assert.match(helper,/entry\.rect=\{left:slotRect\.left,top:slotRect\.top,width:slotRect\.width,height:slotRect\.height\}/);
  assert.match(helper,/entry\.motion=\{x:0,y:0,scale:1,scaleY:1\}/);
});
