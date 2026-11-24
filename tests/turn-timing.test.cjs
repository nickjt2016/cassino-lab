const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../src/compact.css'),'utf8');

function harness(cardsDealt=0){
  const start=app.indexOf('  function turnBannerText()');
  const end=app.indexOf('  function cancelMotion()',start);
  const moveStart=app.indexOf('  function botTurn()');
  const moveEnd=app.indexOf('  function undo()',moveStart);
  return new Function(`
    let game={turn:0,phase:'playing',stock:Array(8),players:[{hand:[]},{hand:[]}],table:[]};
    let busy=false,turnInMotion=false,dealing=false,screen='game',modal='',toast='',
      motionGeneration=0,lastMotion='',pendingBot=null,checkpoint=null;
    let animationDone, timer, finishDeal;
    const dealAnimation=new Promise(resolve=>{finishDeal=resolve;});
    const frames=[];
    const render=()=>frames.push(turnBannerText());
    const E={
      validateAction:()=>({ok:true}),
      chooseComputerMove:()=>({kind:'trail'}),
      applyAction:(g)=>{g.turn=1-g.turn;if(g.turn===1)g.stock.splice(0,${cardsDealt});return {ok:true,description:'trail'};}
    };
    const isHumanTurn=()=>game.turn===0&&!busy;
    const takeMotionSnapshot=()=>({});
    const rememberStockOrigin=()=>{},collectDeal=()=>{},sound=()=>{},persist=()=>{},resetSelection=()=>{};
    const playMotion=(snapshot,after)=>{animationDone=after;};
    const setTimeout=fn=>{timer=fn;return 1;};
    ${app.slice(start,end)}
    ${app.slice(moveStart,moveEnd)}
    return {play,frames,finish:()=>animationDone(),cpu:()=>timer(),
      deal:()=>finishDeal(),text:turnBannerText};
  `)();
}

test('Human and opponent banners are hidden during every committed move and appear only on completion',()=>{
  const h=harness();
  assert.equal(h.text(),'Your turn');
  h.play({kind:'trail'});
  assert.equal(h.text(),'');
  assert.deepEqual(h.frames,['']);
  h.finish();
  assert.equal(h.text(),"Opponent's turn");
  assert.deepEqual(h.frames,['',"Opponent's turn"]);
  h.cpu();
  assert.equal(h.text(),'');
  h.finish();
  assert.equal(h.text(),'Your turn');
  assert.deepEqual(h.frames,['',"Opponent's turn",'','Your turn']);
});

test('Replacement dealing is part of the outgoing turn, not the next turn',async()=>{
  const h=harness(1);
  h.play({kind:'trail'});
  h.finish();
  assert.equal(h.text(),'');
  h.deal();
  await Promise.resolve();
  assert.equal(h.text(),"Opponent's turn");
});

test('Outgoing turn fades immediately and incoming turn fades in without sliding',()=>{
  const start=app.indexOf('  function animateTurnMessage(');
  const end=app.indexOf('  function cancelMotion()',start);
  const node={textContent:'',style:{},isConnected:true,animate(frames,options){this.frames=frames;this.options=options;this.fade={};return this.fade;}};
  const fade=new Function('app','motionAllowed',app.slice(start,end)+';return animateTurnMessage;')({querySelector:()=>node},()=>true);
  fade({text:'Your turn',opacity:1});
  assert.equal(node.textContent,'Your turn');
  assert.deepEqual(node.frames,[{opacity:1},{opacity:0}]);
  assert.equal(node.options.duration,140);
  node.fade.onfinish();
  assert.equal(node.textContent,'');
  node.textContent="Opponent's turn";
  fade(null);
  assert.deepEqual(node.frames,[{opacity:0},{opacity:1}]);
});

test('Captured build panel is snapshotted and fades at the beginning of the capture',()=>{
  assert.match(app,/label:label \? \{rect:rect\(label\),html:label\.outerHTML/);
  assert.match(app,/const fadingLabels = capture \? snapshot\.groups\.filter\(group=>group\.label\)/);
  const fade=app.indexOf('const labelsFaded=Promise.all');
  const flip=app.indexOf('await flipComputerCard();',fade);
  assert.ok(fade>=0&&flip>fade);
  assert.match(app.slice(fade,flip),/\[\{opacity:1\},\{opacity:0\}\],\{duration:130/);
  assert.match(css,/\.capture-label-flight > \.build-value \{\s*height:100%!important/);
});

test('The five top controls form a left vertical rail without taking a row',()=>{
  assert.match(app,/class="header game-toolbar"/);
  const section=css.slice(css.indexOf('/* v0.5.16'));
  assert.match(section,/\.shell \.game-toolbar \{\s*position:absolute;top:/);
  assert.match(section,/left:max\(5px,env\(safe-area-inset-left\)\)/);
  assert.match(section,/\.game-toolbar \.header-actions \{\s*display:flex;flex-direction:column/);
  assert.match(section,/\.table-stage\{top:53%!important/);
});
