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
    let game={turn:0,moveNumber:0,rules:{residueOwner:'lastCapture'},phase:'playing',stock:Array(8),players:[{name:'You',hand:[]},{name:'Computer',hand:[]}],table:[]};
    let busy=false,turnInMotion=false,dealing=false,screen='game',modal='',toast='',
      motionGeneration=0,lastMotion='',pendingBot=null,checkpoint=null;
    let animationDone, timer, timerDelay, finishDeal, preparedBotTurn=null, activeBotSearch=null;
    const searches=[];
    function prepareComputerTurn(){
      if(game.turn!==1||game.phase!=='playing')return null;
      if(preparedBotTurn)return preparedBotTurn;
      searches.push({turn:game.turn,stock:game.stock.length,frames:frames.slice()});
      preparedBotTurn={promise:Promise.resolve({kind:'trail'}),error:null};
      return preparedBotTurn;
    }
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
    const setTimeout=(fn,delay)=>{timer=fn;timerDelay=delay;return 1;};
    ${app.slice(start,end)}
    ${app.slice(moveStart,moveEnd)}
    return {play,frames,finish:()=>animationDone(),cpu:()=>timer(),
      deal:()=>finishDeal(),text:turnBannerText,searches,delay:()=>timerDelay};
  `)();
}

test('Human and opponent banners are hidden during every committed move and appear only on completion',async()=>{
  const h=harness();
  assert.equal(h.text(),'Your turn');
  h.play({kind:'trail'});
  assert.equal(h.text(),'');
  assert.deepEqual(h.frames,['']);
  assert.equal(h.searches.length,1,'calculation begins before human flight ends');
  assert.deepEqual(h.searches[0].frames,['']);
  h.finish();
  assert.equal(h.text(),"Opponent's turn");
  assert.deepEqual(h.frames,['',"Opponent's turn"]);
  assert.equal(h.delay(),600);
  assert.equal(h.searches.length,1,'reuse the in-flight calculation');
  h.cpu();
  await Promise.resolve();
  assert.equal(h.text(),'');
  h.finish();
  assert.equal(h.text(),'Your turn');
  assert.deepEqual(h.frames,['',"Opponent's turn",'','Your turn']);
});

test('Replacement dealing is part of the outgoing turn, not the next turn',async()=>{
  const h=harness(1);
  h.play({kind:'trail'});
  assert.equal(h.searches[0].stock,7,'search uses committed replacement draw');
  h.finish();
  assert.equal(h.text(),'');
  assert.equal(h.delay(),undefined,'no visible thinking timer during dealing');
  h.deal();
  await Promise.resolve();
  assert.equal(h.text(),"Opponent's turn");
  assert.equal(h.delay(),600);
  assert.equal(h.searches.length,1);
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
  assert.match(app,/const fadingLabels = capture \|\| individualBuild \? snapshot\.groups\.filter\(group=>group\.label&&\(capture\|\|group!==existingBuild\)\)/);
  const fade=app.indexOf('const labelsFaded=Promise.all');
  const flip=app.indexOf('const flip=flipComputerCard();',fade);
  assert.ok(fade>=0&&flip>fade);
  assert.match(app.slice(fade,flip),/\[\{opacity:1\},\{opacity:0\}\],\{duration:130/);
  assert.match(css,/\.capture-label-flight > \.build-value \{\s*height:100%!important/);
});

test('Horizontal toolbar groups Exit and Menu left, Hint and optional Undo right',()=>{
  const toolbar=app.slice(app.indexOf('  function renderToolbar('),app.indexOf('  function renderHome('));
  assert.match(toolbar,/class="header game-toolbar"/);
  assert.ok(toolbar.indexOf('data-action="home"')<toolbar.indexOf('data-action="menu"'));
  assert.ok(toolbar.indexOf('data-action="menu"')<toolbar.indexOf('class="header-actions"'));
  assert.ok(toolbar.indexOf('class="opponent-tag"')<toolbar.indexOf('class="header-actions"'));
  assert.match(toolbar,/data-action="hint"/);
  assert.match(toolbar,/data-action="undo"/);
  assert.match(toolbar,/data-action="menu"/);
  assert.doesNotMatch(toolbar,/data-action="rules"/);
  const section=css.slice(css.indexOf('/* v0.5.18'));
  assert.match(section,/\.shell \.game-toolbar \{\s*position:relative;[^}]*flex-direction:row/);
  assert.match(section,/justify-content:space-between/);
  assert.match(section,/\.game-toolbar \.header-actions \{\s*display:flex;flex-direction:row/);
  assert.match(section,/\.table-stage\{top:53%!important/);
});
