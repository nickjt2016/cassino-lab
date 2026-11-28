// Loaded only by the isolated browser audit; never by the game.

  const audit = globalThis.animationAudit = {
    dialogCounter:0,
    commandSerial:0,
    reportRevision:0,
    lastCommand:'init',
    runId:0,
    frameRequest:null,
    paused:false,
    stopSampling() {
      audit.runId++;
      if(audit.frameRequest!==null)cancelAnimationFrame(audit.frameRequest);
      audit.frameRequest=null;
    },
    state: () => ({phase:game.phase,turn:game.turn,busy,dealing,turnInMotion,modal,motionGeneration,
      flights:document.querySelectorAll('.card-flight').length,dialogIdentity:(()=>{const n=app.querySelector('.overlay');if(!n)return null;return n._auditIdentity||(n._auditIdentity=++audit.dialogCounter);})(),hidden:[...app.querySelectorAll('.playing-card')].filter(n=>n.style.visibility==='hidden').length}),
    setup(name='table-gap') {
      audit.stopSampling();audit.paused=false;audit.error=null;
      cancelMotion(); if(pendingBot!==null){clearTimeout(pendingBot);pendingBot=null;}
      // A fixture starts from its own stationary scene, never from the
      // preceding scenario's DOM positions or partly folded build layers.
      app.innerHTML='';
      prefs={...prefs,animations:true,sound:false,handSort:'dealt'};
      game=E.makeState(E.rulesFor('royal',{buildAnything:true,pirateBuilds:true,pirateCaptures:true,allowTrailWithOwnBuild:true,forcedCapture:'optional',playerCount:name==='multi-cpu'?4:2}));
      const c=id=>E.allCards().find(c=>c.id===id), loose=(id,i)=>({id:'a'+i,type:'loose',card:c(id)});
      const build=(id,ids,value=10)=>({id,type:'build',owner:1,value,groups:[ids.map(c)]});
      game.players.forEach((p,i)=>{p.hand=(i===0?['S10','H13','D12','C11']:i===1?['H10','D13','C12','S11']:i===2?['D10','C13','S12','H11']:['C10','S13','H12','D11']).map(c);p.captured=[];});
      game.table=['S2','H3','D4','C5','S6','H7','D8'].map(loose);
      game.turn=name==='cpu-trail'||name==='cpu-capture'||name==='multi-cpu'?1:0;
      game.nextId=100;
      audit.action={kind:'capture',cardId:'S10',targetIds:['a0','a6']};
      if(name==='table-gap') {game.players[0].hand[0]=c('S8');audit.action={kind:'capture',cardId:'S8',targetIds:['a6']};}
      if(name==='trail'||name==='cpu-trail'||name==='multi-cpu') audit.action={kind:'trail',cardId:game.players[game.turn].hand[1].id,targetIds:[]};
      if(name==='cpu-capture') audit.action={kind:'capture',cardId:'H10',targetIds:['a0','a6']};
      if(name==='dense-table') {game.table=E.allCards().filter(x=>!game.players.flatMap(p=>p.hand).some(h=>h.id===x.id)).slice(0,20).map((c,i)=>({id:'a'+i,type:'loose',card:c}));audit.action=E.allComputerMoves(game).find(a=>a.kind==='capture'&&a.targetIds.length>2);}
      if(name==='build') {game.table=['S2','H3','D4','C5'].map(loose);audit.action=E.contextualBuildOptions(game,'S10',['a0'])[0];}
      if(name==='build-pack'||name==='ribbons') {
        const deck=E.allCards().filter(x=>!game.players.flatMap(p=>p.hand).some(h=>h.id===x.id));
        game.table=[build('b0',deck.slice(0,12).map(c=>c.id)),build('b1',deck.slice(12,24).map(c=>c.id)),build('b2',deck.slice(24,34).map(c=>c.id))];
        audit.action={kind:'capture',cardId:'S10',targetIds:['b0']};
      }
      if(name==='crowded-hand') {game.players[0].hand=E.allCards().slice(0,26);game.players[1].hand=E.allCards().slice(26,52);game.table=[];audit.action={kind:'trail',cardId:'S5',targetIds:[]};}
      if(name==='final-residue') {game.players[0].hand=[c('S10')];game.players[1].hand=[];game.table=['S2','H3','D4','C5'].map(loose);game.lastCapture=1;audit.action={kind:'trail',cardId:'S10',targetIds:[]};}
      const used=new Set([...game.players.flatMap(p=>p.hand),...game.table.flatMap(E.cardsInElement)].map(c=>c.id));
      const remaining=E.makeDeck(game.rules).filter(c=>!used.has(c.id));
      if(name==='final-residue'||name==='crowded-hand'){game.stock=[];game.players[1].captured=remaining;}else game.stock=remaining;
      game.moveNumber=5;game.phase='playing';
      busy=false;dealing=false;turnInMotion=false;modal='';screen='game';lastMotion='';checkpoint=null;resetSelection();render();
      if(name==='ribbons'){pickedTable=new Set(game.table.map(b=>b.id));render('selection');}
      document.getAnimations().forEach(animation=>{try{animation.finish();}catch(_){}});
      audit.name=name; audit.samples=[]; audit.before=audit.rects(); audit.done=false;
      return audit.state();
    },
    rects() {
      return [...app.querySelectorAll('[data-action="table"][data-id],[data-action="hand"][data-id],.opponent-hand .card-back,.build-inspection')].map((n,i)=>{const r=n.getBoundingClientRect();return {id:n.dataset.id||'back'+i,cls:n.className,x:r.x,y:r.y,w:r.width,h:r.height,opacity:getComputedStyle(n).opacity,visibility:getComputedStyle(n).visibility};});
    },
    run() {
      audit.stopSampling();audit.samples=[];audit.done=false;
      audit.before=audit.rects();
      if(audit.name==='ribbons'){pickedTable.delete('b0');render('selection');audit.done=true;return;}
      const action=audit.action, byComputer=game.turn!==0;
      if(!action)throw Error('No action for fixture '+audit.name);
      const check=E.validateAction(game,action);if(!check.ok)throw Error(check.reason);
      const before=takeMotionSnapshot(action,byComputer);checkpoint=JSON.stringify(game);
      const stockBefore=game.stock.length,preHuman=game.players[0].hand.map(c=>c.id),preCpu=game.players[1].hand.map(c=>c.id),preSeats=game.players.map(p=>p.hand.map(c=>c.id));
      rememberStockOrigin();const result=E.applyAction(game,action);if(!result.ok)throw Error(result.reason);
      turnInMotion=true;busy=true;lastMotion=action.kind;
      if(before){before.finalHand=game.phase!=='playing';before.residueOwner=game.lastCapture;}
      const cardsDealt=stockBefore-game.stock.length;
      if(cardsDealt)collectDeal(preHuman,preCpu,game.table.filter(e=>e.type==='loose').map(e=>e.card.id),preSeats);
      render();audit.started=performance.now();
      const generation=motionGeneration,runId=audit.runId,startedGame=game;
      const current=()=>generation===motionGeneration&&runId===audit.runId&&game===startedGame;
      const sample=()=>{
        audit.frameRequest=null;
        if(!current())return;
        audit.samples.push({ms:performance.now()-audit.started,rects:audit.rects(),flights:document.querySelectorAll('.card-flight').length});
        if(!audit.done)audit.frameRequest=requestAnimationFrame(sample);
      };
      sample();
      playMotion(before,()=>{
        if(!current())return;
        audit.done=true;audit.stopSampling();turnInMotion=false;busy=false;dealing=false;
        if(game.phase!=='playing')modal='round';render();report();
      });
    },
    deal() {
      audit.stopSampling();audit.paused=false;audit.error=null;audit.samples=[];audit.done=false;
      cancelMotion();if(pendingBot!==null){clearTimeout(pendingBot);pendingBot=null;}
      app.innerHTML='';audit.name='deal';audit.before=[];
      game=E.newMatch(E.rulesFor('classic'),()=>.63);screen='game';modal='';busy=dealing=true;turnInMotion=false;lastMotion='deal';collectDeal();render();
      const generation=motionGeneration,runId=audit.runId,startedGame=game;
      dealAnimation.then(()=>{
        if(generation!==motionGeneration||runId!==audit.runId||game!==startedGame)return;
        dealing=busy=false;audit.done=true;render();report();
      });
    },
    modal() {modal=modal?'':'menu';render('overlay');},
    redraw() {render();},
    undo() {audit.stopSampling();audit.paused=false;undo();audit.done=true;},
    pause() {audit.paused=true;document.getAnimations().forEach(a=>a.pause());},
    seek(ms) {audit.paused=true;document.getAnimations().forEach(a=>{a.pause();a.currentTime=ms;});},
    resume() {audit.paused=false;document.getAnimations().forEach(a=>a.play());},
    finish() {document.getAnimations().forEach(a=>{try{a.finish();}catch(_){}});},
    summary() {
      const samples=audit.samples||[];
      const first=samples[0]?.rects||[];
      const continuity=(audit.before||[]).flatMap(b=>{const a=first.find(n=>n.id===b.id&&n.cls===b.cls);return a?[{id:b.id,dx:+(a.x-b.x).toFixed(3),dy:+(a.y-b.y).toFixed(3),dw:+(a.w-b.w).toFixed(3),dh:+(a.h-b.h).toFixed(3)}]:[]});
      return {scenario:audit.name,done:audit.done,frames:samples.length,...audit.state(),continuity,
        overflow:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,viewport:[innerWidth,innerHeight]}};
    }
  };
  // Build/deal flights create later stages after promises settle. Keep those
  // stages paused too; the hook runs after production sets its shared clock.
  const nativeAnimate=Element.prototype.animate;
  Element.prototype.animate=function(...args){
    const effect=nativeAnimate.apply(this,args),runId=audit.runId;
    queueMicrotask(()=>{if(audit.paused&&audit.runId===runId)effect.pause();});
    return effect;
  };
  addEventListener('error',e=>{audit.error=String(e.error||e.message);});
  addEventListener('unhandledrejection',e=>{audit.error=String(e.reason);});
  audit.setup('table-gap');

  const report=()=>parent.postMessage({kind:'animation-audit-result',result:{...audit.summary(),error:audit.error,
    revision:++audit.reportRevision,commandSerial:audit.commandSerial,command:audit.lastCommand}},'*');
  addEventListener('message',event=>{
    if(event.source!==parent||event.data?.kind!=='animation-audit-command')return;
    const {command,value}=event.data;
    audit.commandSerial++;audit.lastCommand=command;
    try{
      if(command==='setup')audit.setup(value);
      else if(command==='run-paused'){audit.run();audit.pause();}
      else if(command==='seek')audit.seek(Number(value));
      else if(command==='inspect'){/* Report the current state below. */}
      else if(['run','deal','modal','redraw','undo','pause','resume','finish'].includes(command))audit[command]();
      report();
    }catch(error){audit.error=String(error.stack||error);report();}
  });
  report();
