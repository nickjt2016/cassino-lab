const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../src/compact.css'),'utf8');

test('Hand result leaders use bold type only; ties stay regular',()=>{
  const start=app.indexOf('  function renderRound()');
  const end=app.indexOf('  function renderExitConfirm()',start);
  const game={result:{points:[
    {cards:3,spades:10,big:0,little:1,aces:1,sweeps:0,total:15,cardCount:27,spadeCount:9},
    {cards:0,spades:4,big:2,little:0,aces:3,sweeps:0,total:9,cardCount:25,spadeCount:4}
  ],scores:[15,9],finishedRound:1},phase:'roundOver',rules:{spadeScoring:true,sweepPoints:0}};
  const render=new Function('game','prefs','checkpoint',app.slice(start,end)+';return renderRound;')(game,{},null);
  const html=render();
  assert.ok(html.includes('<td class="round-leading"><strong>3</strong></td><td class="">0</td>'));
  assert.ok(html.includes('<td class="">1</td><td class="round-leading"><strong>3</strong></td>'));
  assert.ok(html.includes('<td>Sweeps (0)</td><td class="">0</td><td class="">0</td>'));
  assert.ok(html.includes('<td>This hand (total)</td><td class="round-leading"><strong>15</strong></td><td class="">9</td>'));
  assert.ok(css.includes('.dialog .result-table .round-leading{font-weight:900}'));
  assert.ok(css.includes('.dialog .result-table .totals-row td:not(:first-child):not(.round-leading){font-weight:400}'));
  assert.ok(!css.includes('.dialog .result-table .totals-row .round-leading{'));
});

for(const kind of ['capture','trail'])for(const byComputer of [false,true]){
  test('Final '+kind+' ('+(byComputer?'computer':'human')+') collects residue without changing its scale or jumping',async()=>{
    const begin=app.indexOf('  function playMotion('),end=app.indexOf('  const escapeHtml',begin);
    const rect=(left,top,width=50,height=70)=>({left,top,width,height,right:left+width,bottom:top+height});
    const fieldRect=rect(0,100,300,400), badgeRect=rect(125,byComputer?20:540,50,20);
    const node=(r)=>({style:{},isConnected:true,matches:()=>false,querySelector:()=>null,getBoundingClientRect:()=>r});
    const field=node(fieldRect),badge=node(badgeRect),landing=node(rect(100,250,50,70));
    const piece=(id,left,top,w=50,h=70)=>({id,html:'<span class="playing-card"></span>',rect:rect(left,top,w,h)});
    const played=piece('S8',120,byComputer?40:510,60,84);
    const target=piece('D8',50,310);
    const remaining=[piece('H3',20,300),piece('C4',130,300)],nodes=[];
    const document={body:{appendChild(n){nodes.push(n);}},createElement(){return {
      style:{},frames:[],querySelector(){return null;},getAnimations(){return [];},remove(){},
      animate(frames){this.frames.push(frames);const a={};Promise.resolve().then(()=>a.onfinish?.());return a;}
    };}};
    const host={querySelector(selector){
      if(selector==='.table-area')return field;
      if(selector==='.your-score-tag'||selector==='.opponent-tag')return badge;
      if(selector==='.table-cards .playing-card')return landing;
      return null;
    }};
    const motion=new Function('app','document','motionAllowed','motionGeneration','sound','setTimeout','renderBack','game',
      app.slice(begin,end)+';return playMotion;')(host,document,()=>true,0,()=>{},cb=>cb(),()=>'<span class="card-back"></span>',{table:[]});
    await new Promise(resolve=>motion({kind,byComputer,played,tableRects:[target,...remaining].map(p=>p.rect),
      groups:kind==='capture'?[{rect:target.rect,cards:[target]}]:[],remainingCards:remaining,
      finalHand:true,residueOwner:byComputer?1:0},resolve));
    const cleanup=nodes.filter(n=>n.className.includes('residue-flight')||(kind==='trail'&&n===nodes[0]));
    assert.equal(cleanup.length,kind==='trail'?3:2);
    for(const n of cleanup){
      const flights=n.frames.filter(f=>f[0].transform?.startsWith('translate'));
      const gather=flights.at(-2),collect=flights.at(-1);
      assert.ok(gather&&collect);
      if(flights.length===3)assert.equal(gather[0].transform,flights[0].at(-1).transform);
      assert.equal(collect[0].transform,gather[2].transform);
      const scale=t=>t.slice(t.lastIndexOf('scale('));
      assert.equal(scale(gather[0].transform),scale(gather[2].transform));
      assert.equal(scale(collect[0].transform),scale(collect[2].transform));
      assert.equal(collect[2].opacity,.06);
    }
  });
}
