const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
test('Opponent flip and destination-sized trail are all scheduled before any animation finishes',async()=>{
  const calls=[],nodes=[],events=[];
  const rect=(left,top,width,height)=>({left,top,width,height});
  const source=rect(120.25,50.125,33.625,46.75),landing=rect(82.375,250.625,58.25,81.46875);
  const node=(name)=>({name,style:{},classList:{add(){}},getAnimations(){return [];},
    animate(frames,options){const anim={};calls.push({name,frames,options,anim});return anim;}});
  const face=node('face'),back=node('back'),ghost=node('flight');
  ghost.querySelector=s=>s.includes('card-back')?back:s.includes('card-selected')?null:face;
  ghost.insertAdjacentHTML=()=>events.push('back mounted');ghost.remove=()=>events.push('ghost removed');
  const doc={timeline:{currentTime:1000},body:{appendChild(n){nodes.push(n);}},createElement(){return ghost;}};
  const target={style:{},isConnected:true,matches:()=>true,getBoundingClientRect:()=>landing,
    querySelector:()=>({getBoundingClientRect:()=>landing})};
  const host={querySelector:()=>target};
  const start=app.indexOf('  function playMotion('),end=app.indexOf('  const escapeHtml',start);
  const play=new Function('app','document','game','motionAllowed','motionGeneration','sound','setTimeout','renderBack',
    app.slice(start,end)+';return playMotion;')(host,doc,{table:[{id:'t'}]},()=>true,0,()=>{},fn=>fn(),()=>'<span class="card-back"></span>');
  const done=new Promise(resolve=>play({kind:'trail',byComputer:true,played:{id:'S6',rect:source,html:'<span class="playing-card"></span>'},groups:[],finalHand:false},resolve));
  assert.equal(calls.length,3);
  assert.deepEqual(calls.map(c=>c.name),['flight','back','face']);
  assert.equal(calls[0].options.delay,335);
  assert.equal(calls[0].options.duration,610);
  assert.equal(calls[1].options.duration,335);
  assert.equal(calls[2].options.duration,335);
  assert.ok(calls.every(c=>c.anim.startTime===1000));
  assert.equal(ghost.style.width,landing.width+'px');
  assert.deepEqual(events,['back mounted']);
  assert.equal(target.style.visibility,'hidden');
  for(const call of calls)call.anim.onfinish();
  await done;
  assert.equal(target.style.visibility,'visible');
  assert.deepEqual(events,['back mounted','ghost removed']);
});
test('Capture timeline has no timer-driven movement stage or mid-flight geometry read',()=>{
  const track=app.slice(app.indexOf('    function captureTrack('),app.indexOf('    async function gatherEndOfHand'));
  assert.match(track,/const duration=collectAt\+280/);
  assert.match(track,/frames\.push\(\{transform:landing,opacity:1,offset:collectAt\/duration,easing\}\)/);
  assert.doesNotMatch(track,/setTimeout|getBoundingClientRect|innerHTML|\.cancel\(/);
  const capture=app.slice(app.indexOf('        if(capture){'),app.indexOf("        } else if(snapshot.kind === 'build'"));
  assert.doesNotMatch(capture,/await new Promise|await flipComputerCard/);
  assert.match(capture,/finally\{if\(typeof clearTimeout==='function'\)clearTimeout\(landedSound\);\}/);
});
test('Snapshot caches rectangles and only copies final-hand residue when needed',()=>{
  const s=app.slice(app.indexOf('  function takeMotionSnapshot('),app.indexOf('  function playMotion('));
  assert.match(s,/const measured=new WeakMap/);
  assert.match(s,/if\(measured\.has\(node\)\)return measured\.get\(node\)/);
  assert.match(s,/const remainingCards = \(lastCard\?tableNodes:\[\]\)/);
});
