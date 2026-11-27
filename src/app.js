/* Fishing Lab browser UI: all gameplay calls the shared rules engine. */
(function () {
  'use strict';
  const E = globalThis.CassinoEngine;
  if (!E) throw new Error('Cassino rules engine did not load.');
  const STORE = 'cassino-lab-v1';
  let game, checkpoint = null, pickedCard = null, pickedTable = new Set();
  let toast = '', modal = '', busy = false, pendingBot = null;
  let draft = null, draftPreset = 'classic';
  let detailSetting = '';
  let variationsScrollTop = 0;
  let buildOptions = [], lastMotion = '', hintIterator = null;
  let renderedActionMarkup = '';
  let screen = 'home';
  const APP_VERSION = '0.10.9';
  let availableUpdate = null;
  let updateReloading = false;
  let checkingForUpdate = false;
  // Apply new releases on launch or at the main menu, never during play.
  function applyPendingUpdate() {
    if (!availableUpdate || updateReloading || screen !== 'home' || modal || busy || dealing) return;
    const key = 'cassino-lab-auto-update-' + APP_VERSION + '-to-' + availableUpdate;
    try {
      // Do not retry endlessly if a CDN briefly serves stale HTML after reload.
      const previous = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - previous < 60000) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch (_) { /* Private browsing may restrict session storage. */ }
    updateReloading = true;
    location.reload();
  }
  async function checkForAppUpdate() {
    if (checkingForUpdate || updateReloading || !/^https?:/.test(location.protocol)) return;
    checkingForUpdate=true;
    try {
      const response = await fetch('./version.json', { cache: 'no-store' });
      if (!response.ok) return;
      const info = await response.json();
      if (typeof info.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(info.version)) return;
      const current = APP_VERSION.split('.').map(Number);
      const latest = info.version.split('.').map(Number);
      const newer = latest.some((value, i) => {
        const earlier = latest.slice(0,i).every((v,j)=>v===current[j]);
        return earlier && value>current[i];
      });
      if (newer) {
        availableUpdate = info.version;
        applyPendingUpdate();
      }
    } catch (_) { /* Offline: continue with the installed version. */ }
    finally { checkingForUpdate=false; }
  }
  let hasSavedMatch = false;
  let customDraft = null;
  let settingsOrigin = 'home';
  let exitReturnModal = '';
  const CUSTOM_STORE = 'cassino-lab-custom-rules-v1';
  let customRules = null;

  const PREF_STORE = 'cassino-lab-prefs-v1';
  let prefs = { sound: true, animations: true, undo: true, handSort:'suit' };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREF_STORE) || '{}') }; } catch (_) {}
  delete prefs.cardLayout; // Old saved layout choices no longer affect the board.
  let audioContext = null;
  const app = document.getElementById('app');
  function savePrefs() {
    try { localStorage.setItem(PREF_STORE, JSON.stringify(prefs)); } catch (_) {}
  }
  // Synthesized, original card-table Foley: a short dry click followed by a
  // quiet paper brush.  No audio samples from the reference app are reused.
  const soundBuffers=new Map();
  function sound(type = 'tap', dealCount = 12) {
    if (!prefs.sound) return;
    try {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) return;
      if (!audioContext) audioContext = new Audio();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      const now = audioContext.currentTime;
      const rate = audioContext.sampleRate;
      const pattern = {
        tap: [[0, .045, .045]],
        trail: [[0, .08, .09], [.095, .035, .038]],
        build: [[0, .085, .10], [.12, .05, .06]],
        capture: [[0, .07, .10], [.08, .06, .06], [.17, .045, .045]],
        sweep: [[0, .09, .10], [.09, .085, .09], [.19, .075, .08]],
        score: [[0, .08, .09], [.14, .06, .10]],
        undo: [[0, .042, .05]],
        deal: Array.from({length: dealCount}, (_, i) => [i * .094, i < 4 ? .15 : .13, .072]),
      }[type] || [[0, .04, .045]];
      for (const [offset, volume, duration] of pattern) {
        const key=(type==='deal'?'deal':'card')+':'+rate+':'+duration;
        let buffer=soundBuffers.get(key);
        if(!buffer){
          const frames = Math.ceil(rate * duration);
          buffer = audioContext.createBuffer(1, frames, rate);
          const channel = buffer.getChannelData(0);
        // Crisp attack + a decaying paper/riffle tail; intentionally subtle.
        for (let i = 0; i < frames; i++) {
          const t = i / rate;
          const body = Math.exp(-t * (type === 'deal' ? 56 : 72));
          const brush = Math.exp(-t * (type === 'deal' ? 30 : 21)) * (type === 'deal' ? .56 : .29);
          channel[i] = (Math.random() * 2 - 1) * (body + brush);
        }
          soundBuffers.set(key,buffer);
        }
        const src = audioContext.createBufferSource(); src.buffer = buffer;
        const filter = audioContext.createBiquadFilter();
        filter.type = 'bandpass'; filter.frequency.value = type === 'deal' ? 1150 + 130 * (Math.round(offset / .094) % 3) : (type === 'tap' ? 1800 : 1050);
        filter.Q.value = .53;
        const gain = audioContext.createGain();
        gain.gain.setValueAtTime(volume, now + offset);
        gain.gain.exponentialRampToValueAtTime(.0001, now + offset + duration);
        src.connect(filter); filter.connect(gain); gain.connect(audioContext.destination);
        src.start(now + offset); src.stop(now + offset + duration + .01);
      }
    } catch (_) { /* Browser audio permission is optional. */ }
  }
  // Take a snapshot *before* applying the move, then animate the old cards to
  // their actual positions in the newly rendered state.  Nothing fades except
  // cards being captured.  The opponent's card is turned face-up in flight.
  let motionGeneration = 0;
  // Cards are physically dealt from the visible stock on the left of the felt.
  // Track actual card IDs so draw-mode only animates replacement cards.
  let pendingDeal = null;
  let activeHandDeal = null;
  let pendingStockOrigin = null;
  let dealAnimation = Promise.resolve();
  let dealing = false;
  let turnInMotion = false;
  function collectDeal(beforeHuman = [], beforeCpu = [], beforeTable = [], beforeSeats = []) {
    const oldHuman = new Set(beforeHuman), oldCpu = new Set(beforeCpu), oldTable = new Set(beforeTable);
    const humanIds = game.players[0].hand.filter(c => !oldHuman.has(c.id)).map(c => c.id);
    const cpuIndices = game.players[1].hand.map((c,i) => !oldCpu.has(c.id) ? i : -1).filter(i => i >= 0);
    const tableIds = game.table.filter(e => e.type === 'loose' && !oldTable.has(e.card.id)).map(e => e.card.id);
    pendingDeal = { humanIds, cpuIndices, tableIds };
    if(game.players.length>2)pendingDeal.cpuBySeat=game.players.slice(1).map((p,i)=>{
      const old=new Set(beforeSeats[i+1]||[]);
      return p.hand.flatMap((c,j)=>old.has(c.id)?[]:[j]);
    });
  }
  function rememberStockOrigin() {
    const node = app.querySelector && app.querySelector('.draw-stock .stock-back');
    if (!node) return;
    const r = node.getBoundingClientRect();
    pendingStockOrigin = {x:r.left+r.width/2,y:r.top+r.height/2};
  }

  const motionAllowed = () => !!prefs.animations &&
    !(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // FLIP transitions: capture positions before replacing HTML, then translate
  // surviving cards from their old screen positions to their new ones. Using
  // the independent `translate` property preserves the selected-card transform.
  function layoutPositions() {
    if (!app || !app.querySelectorAll) return null;
    const positions = new Map();
    app.querySelectorAll('[data-action="table"][data-id], [data-action="hand"][data-id]').forEach(node => {
      if(node.dataset.action==='hand'&&node.querySelector?.('.playing-card')?.style?.visibility==='hidden')return;
      const key = node.dataset.action + ':' + node.dataset.id;
      const rect = node.getBoundingClientRect();
      if (rect.width && rect.height) positions.set(key, {x:rect.left+rect.width/2,y:rect.top+rect.height/2});
    });
    if(game.players.length===2)app.querySelectorAll('.opponent-hand .card-back').forEach((node,i)=>{
      const rect=node.getBoundingClientRect();
      if(rect.width && rect.height) positions.set('cpu-back:'+i,{x:rect.left+rect.width/2,y:rect.top+rect.height/2});
    });
    return positions;
  }
  function animateLayout(previous, motion = '', byComputer = false) {
    if (!previous || !motionAllowed() || !app.querySelectorAll) return;
    const nodes = [...app.querySelectorAll('[data-action="table"][data-id], [data-action="hand"][data-id]'),
      ...(game.players.length===2?app.querySelectorAll('.opponent-hand .card-back'):[])];
    // A retained card can still be sliding when the next tap occurs. The
    // caller has already measured its displayed position. Cancel the old
    // translation before measuring its new untransformed destination.
    const active=animateLayout.active||(animateLayout.active=new WeakMap());
    for(const node of nodes){
      active.get(node)?.cancel();
      active.delete(node);
    }
    let cpu=0;
    const shifts=[];
    nodes.forEach(node => {
      if(node.dataset.action==='hand'&&node.querySelector?.('.playing-card')?.style?.visibility==='hidden')return;
      const key = node.classList.contains('card-back') ? 'cpu-back:'+(cpu++) : node.dataset.action+':'+node.dataset.id;
      const from=previous.get(key);
      if(!from || !node.animate) return;
      const rect=node.getBoundingClientRect();
      const dx=from.x-(rect.left+rect.width/2), dy=from.y-(rect.top+rect.height/2);
      if(Math.abs(dx)<2 && Math.abs(dy)<2) return;
      // Table cards physically close gaps like the filmed fishing game.
      // Preserve each card's identity; only the remaining cards glide into
      // the vacated slots, never recentering the whole row.
      const isTableCard = node.dataset.action === 'table';
      // Wait until the captured cards are visibly leaving before closing
      // the gaps. The CPU first spends 335 ms turning its card face-up.
      const delay=motion==='capture' && isTableCard && node.classList.contains('table-item')
        ? (byComputer?495:160) : 0;
      shifts.push({node,dx,dy,isTableCard,delay});
    });
    for(const {node,dx,dy,isTableCard,delay} of shifts){
      const animation=node.animate([{translate:`${dx}px ${dy}px`},{translate:'0px 0px'}],
        {duration:isTableCard ? 355 : 420,delay,fill:'backwards',
         easing:isTableCard ? 'cubic-bezier(.22,.72,.24,1)' : 'cubic-bezier(.2,.8,.2,1)'});
      if(animation)active.set(node,animation);
    }
  }
  // Dealt cards never materialize in the hand. Until the deck animation
  // reaches them, their faces remain hidden; the hand grows on each landing.
  function dealTargets(deal, includeTable = true) {
    if (!app.querySelectorAll) return [];
    const items=[];
    const tableCards=[...app.querySelectorAll('.table-cards .playing-card[data-card-id]')];
    const handCards=[...app.querySelectorAll('.human-hand .playing-card[data-card-id]')];
    const backs=[...app.querySelectorAll('.opponent-hand .card-back')];
    if(includeTable) for(const id of deal.tableIds||[]) {
      const node=tableCards.find(c=>c.dataset.cardId===id);
      if(node) items.push({node,faceUp:true});
    }
    // Human targets carry their identity in every player-count branch.
    // Without it the flight falls back to the unpositioned, hidden face.
    const human=(deal.humanIds||[]).map(humanId=>{
      const node=handCards.find(c=>c.dataset.cardId===humanId);
      return node?{node,faceUp:true,humanId}:null;
    });
    const cpu=(deal.cpuIndices||[]).map(i=>backs[i]);
    if(deal.cpuBySeat){
      const seats=deal.cpuBySeat.map((indices,i)=>indices.map(j=>app.querySelectorAll('[data-cpu-seat="'+(i+1)+'"] .card-back')[j]));
      for(let i=0;i<Math.max(human.length,...seats.map(s=>s.length));i++){
        for(const seat of seats)if(seat[i])items.push({node:seat[i],faceUp:false});
        if(human[i])items.push(human[i]);
      }
      return items;
    }
    for(let i=0;i<Math.max(human.length,cpu.length);i++){
      if(cpu[i]) items.push({node:cpu[i],faceUp:false});
      if(human[i]) items.push(human[i]);
    }
    return items;
  }
  function hidePendingDealCards() {
    if (!pendingDeal || !app.querySelectorAll) return;
    for (const {node} of dealTargets(pendingDeal,true)) node.style.visibility='hidden';
  }
  // One face-down card travels out of the physical stock for EACH replacement.
  // The human/table cards turn face-up only once they reach their destinations.
  function animateNewDeal(includeTable = true) {
    const deal = pendingDeal || {
      humanIds:game.players[0].hand.map(c=>c.id),
      cpuIndices:game.players[1].hand.map((_,i)=>i),
      tableIds:includeTable?game.table.filter(e=>e.type==='loose').map(e=>e.card.id):[]
    };
    const items=dealTargets(deal,includeTable);
    const deck=app.querySelector?.('.draw-stock .stock-back');
    const deckRect=deck?.getBoundingClientRect();
    const start=pendingStockOrigin || (deckRect && {
      x:deckRect.left+deckRect.width/2,y:deckRect.top+deckRect.height/2
    });
    const geometry=humanHandGeometry();
    const progress=geometry&&deal.humanIds?.length?makeHandDealProgress(deal,geometry):null;
    activeHandDeal=progress;
    pendingDeal=null;
    pendingStockOrigin=null;
    if(!motionAllowed() || !start || !items.length || !document.body || !document.createElement){
      activeHandDeal=null;
      layoutHumanHand();
      items.forEach(item=>{item.node.style.visibility='';});
      return Promise.resolve();
    }
    const generation=motionGeneration;
    // Incoming cards land in the prefix of the deal, not the final sorted hand.
    const landingRects=progress?handDealLandingRects(progress,geometry):new Map();
    const measured=items.map(item=>({...item,rect:landingRects.get(item.humanId)||item.node.getBoundingClientRect()}));
    const flyOne=({node,faceUp,rect,humanId},index)=>new Promise(resolve=>{
        if(generation!==motionGeneration || !node.isConnected){
          node.style.visibility='';resolve();return;
        }
        if(!rect.width || !rect.height || !node.animate){
          if(humanId&&progress)advanceHandDeal(progress,humanId,false);
          node.style.visibility='';resolve();return;
        }
        const dest={x:rect.left+rect.width/2,y:rect.top+rect.height/2};
        const ghost=document.createElement('div');
        ghost.className='card-flight dealt-card-flight';
        const initialScale=Math.max(.28,Math.min(.95,(deckRect?.width || rect.width*.55)/rect.width));
        Object.assign(ghost.style,{
          position:'fixed',pointerEvents:'none',zIndex:'95',
          left:(start.x-rect.width/2)+'px',top:(start.y-rect.height/2)+'px',
          width:rect.width+'px',height:rect.height+'px',
          transformOrigin:'center',willChange:'transform,opacity',
          opacity:'0',transform:`scale(${initialScale})`
        });
        ghost.innerHTML=renderBack();
        const back=ghost.querySelector('.card-back');
        if(back)Object.assign(back.style,{width:'100%',height:'100%',margin:'0',boxSizing:'border-box'});
        document.body.appendChild(ghost);
        const dx=dest.x-start.x,dy=dest.y-start.y;
        const end=`translate(${dx}px,${dy}px) scale(1)`;
        const done=()=>{node.style.visibility='';ghost.remove();resolve();};
        const run=(frames,options)=>new Promise(finish=>{
          if(!ghost.animate){finish();return;}
          const anim=ghost.animate(frames,{fill:'forwards',...options});
          anim.onfinish=finish;anim.oncancel=finish;
        });
        (async()=>{
          try{
            await run([
              {transform:`scale(${initialScale}) rotate(-3deg)`,opacity:1},
              {transform:`translate(${dx*.70}px,${dy*.70-6}px) scale(${initialScale+(1-initialScale)*.7}) rotate(2deg)`,opacity:1,offset:.72},
              {transform:end,opacity:1}
            ],{duration:440,delay:index*94,easing:'cubic-bezier(.22,.74,.24,1)'});
            if(generation!==motionGeneration)return;
            if(humanId&&progress)advanceHandDeal(progress,humanId,true);
            ghost.style.transform=end;
            ghost.style.opacity='1';
            ghost.getAnimations().forEach(a=>a.cancel());
            if(faceUp){
              await run([{transform:end+' rotateY(0deg)'},{transform:end+' rotateY(90deg)'}],{duration:humanId?75:100,easing:'ease-in'});
              if(generation!==motionGeneration)return;
              const face=node.cloneNode(true);
              face.style.visibility='visible';
              face.style.width='100%';
              face.style.setProperty('height','100%','important');
              face.style.margin='0';
              ghost.replaceChildren(face);
              ghost.getAnimations().forEach(a=>a.cancel());
              await run([{transform:end+' rotateY(-90deg)'},{transform:end+' rotateY(0deg)'}],{duration:humanId?75:110,easing:'ease-out'});
            }
          }finally{done();}
        })();
    });
    const stockCount=app.querySelector('.draw-stock-count');
    if(stockCount?.animate)stockCount.animate([{scale:1.06},{scale:1}],{duration:250});
    return Promise.all(measured.map(flyOne)).then(()=>{
      if(generation===motionGeneration&&activeHandDeal===progress)activeHandDeal=null;
      // The ordinary next-turn render sorts the completed hand from its
      // actual landed positions.
    });
  }
  // The next player becomes interactive only after the outgoing move and
  // any replacement deal finish. The hand itself is the visible turn cue.
  function handIsActive(){
    return screen==='game'&&game.phase==='playing'&&game.turn===0&&!busy&&!turnInMotion&&!dealing;
  }
  function cancelMotion() {
    motionGeneration++;
    if(typeof cancelComputerSearch==='function')cancelComputerSearch();
    turnInMotion = false;
    // Explicit cancellation settles oncancel promises, including delayed
    // flights, and releases animated textures when a match is left or undone.
    if (document.querySelectorAll) document.querySelectorAll('.card-flight').forEach(node => {
      node.getAnimations?.({subtree:true}).forEach(animation=>animation.cancel());
      node.remove();
    });
    document.getElementById?.('app')?.getAnimations?.({subtree:true}).forEach(animation=>animation.cancel());
    pendingDeal=null;
    activeHandDeal=null;
    pendingStockOrigin=null;
    dealAnimation=Promise.resolve();
  }
  function takeMotionSnapshot(move, byComputer = false) {
    if (!motionAllowed() || !document.body || !app.querySelector) return null;
    const actor=game.turn;
    const from = byComputer
      ? app.querySelector(game.players.length>2?'[data-cpu-seat="'+actor+'"] .card-back:last-child':'.opponent-hand .card-back:last-child')
      : app.querySelector(`.hand-item[data-id="${move.cardId}"] .playing-card`);
    if (!from || !from.getBoundingClientRect) return null;
    const measured=new WeakMap();
    const rect = node => {
      if(measured.has(node))return measured.get(node);
      const r=node.getBoundingClientRect();
      const result={left:r.left,top:r.top,width:r.width,height:r.height};
      measured.set(node,result);
      return result;
    };
    const playerCard = game.players[actor].hand.find(c => c.id === move.cardId);
    if (!playerCard) return null;
    const tableNodes=[...app.querySelectorAll('[data-action="table"][data-id]')];
    const tableById=new Map(tableNodes.map(node=>[node.dataset.id,node]));
    const groupRects = (move.targetIds || []).map(id => {
      const node=tableById.get(id);
      const label = node?.querySelector('.build-value');
      return node ? {
        label:label ? {rect:rect(label),html:label.outerHTML,selected:node.classList.contains('selected')} : null,
        rect:rect(node),html:node.querySelector('.build-pile')?.outerHTML || node.querySelector('.playing-card')?.outerHTML || node.outerHTML,
        cards:[...node.querySelectorAll('.playing-card[data-card-id]')].map(card=>({
          id:card.dataset.cardId,rect:rect(card),html:card.outerHTML,
          groupStart:!!card.parentElement?.classList.contains('build-group-start')
        }))
      } : null;
    }).filter(Boolean);
    const selected = new Set(move.targetIds || []);
    const lastCard=!game.stock.length&&game.players.every((p,i)=>p.hand.length===(i===game.turn?1:0));
    const remainingCards = (lastCard?tableNodes:[])
      .filter(node => move.kind !== 'capture' || !selected.has(node.dataset.id))
      .flatMap(node => [...node.querySelectorAll('.playing-card[data-card-id]')].map(card=>({
        id:card.dataset.cardId,rect:rect(card),html:card.outerHTML
      })));
    const tableRects = move.kind==='capture'?[...app.querySelectorAll('.table-stage .playing-card')].map(rect):[];
    const looseCardRects = move.kind==='capture'?[...app.querySelectorAll('.table-cards .playing-card')].map(rect):[];
    return {kind:move.kind,byComputer,actor,tableRects,looseCardRects,played:{id:playerCard.id,rect:rect(from),html:byComputer?renderCard(playerCard):from.outerHTML},groups:groupRects,remainingCards};
  }
  function playMotion(snapshot, after) {
    if (!snapshot || !motionAllowed() || !document.body || !app.querySelector) { after(); return; }
    const generation = motionGeneration;
    const capture = snapshot.kind === 'capture';
    const destination = capture
      ? app.querySelector(game.players.length>2&&snapshot.byComputer?'[data-seat-score="'+snapshot.actor+'"]':snapshot.byComputer ? '.opponent-tag' : '.your-score-tag')
      : app.querySelector(`[data-action="table"][data-id="${game.table[game.table.length-1]?.id}"]`) ||
        (snapshot.finalHand ? app.querySelector('.table-area') : null);
    if (!destination) { after(); return; }
    const targetRect = destination.getBoundingClientRect();
    const center = r => ({x:r.left+r.width/2,y:r.top+r.height/2});
    const end = center(targetRect);
    // Capture stacks land in measured open lanes outside the table cards.
    const feltRectForCapture=app.querySelector('.table-area')?.getBoundingClientRect();
    const captureFront = capture && feltRectForCapture ? {
      x:feltRectForCapture.left + feltRectForCapture.width*.5,
      y:feltRectForCapture.top + feltRectForCapture.height*.72
    } : end;
    // The new build/trail enters only when the traveling card actually lands.
    if (!capture && destination.matches('[data-action="table"]')) destination.style.visibility='hidden';
    // A capture is a genuine stack of individual *face-up cards*, including
    // all the cards inside a multiple build.  It must not collapse into a
    // single generic build icon during the animation.
    const capturedCards = capture ? snapshot.groups.flatMap(group =>
      group.cards && group.cards.length ? group.cards : [group]) : [];
    const individualBuild=snapshot.kind==='build'&&!snapshot.finalHand;
    const firstLayerId=individualBuild?destination.querySelector('.build-layer .playing-card[data-card-id]')?.dataset.cardId:null;
    const existingBuild=individualBuild ? (snapshot.groups.find(group=>group.label&&group.cards?.some(c=>c.id===firstLayerId))
      ||snapshot.groups.find(group=>group.label&&group.cards?.length)) : null;
    const existingIds=new Set((existingBuild?.cards||[]).map(card=>card.id));
    const retainedAnchorId=existingBuild?.cards.at(-1)?.id;
    const pieces = capture ? [snapshot.played, ...capturedCards] : individualBuild
      ? [snapshot.played,...snapshot.groups.flatMap(group=>group.cards||[])]
      : [snapshot.played, ...snapshot.groups];
    const ghosts=pieces.map((piece,i) => {
      const ghost=document.createElement('div');
      ghost.className='card-flight'+(individualBuild&&piece.groupStart?' build-group-start':'');
      ghost.innerHTML=piece.html;
      const r=piece.rect;
      Object.assign(ghost.style,{position:'fixed',pointerEvents:'none',
        // The capturing card is always on TOP of the collected pile.
        zIndex:String(capture ? (i===0 ? 1000 : 105+i) : 90+i),
        left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px',
        margin:'0',padding:'0',transformOrigin:'center center',willChange:'transform,opacity'});
      const card=ghost.querySelector(':scope > .playing-card');
      if(card) Object.assign(card.style,{width:'100%',height:'100%',margin:'0'});
      document.body.appendChild(ghost);
      return {ghost,rect:r,id:piece.id};
    });
    // Retain the old panel on its original front card. Later card layers
    // have higher stacking order and physically cover it as they arrive.
    let retainedPanel=null;
    if(existingBuild){
      const anchor=ghosts.find(piece=>piece.id===retainedAnchorId);
      if(anchor){
        anchor.ghost.insertAdjacentHTML('beforeend',existingBuild.label.html);
        retainedPanel=anchor.ghost.querySelector('.build-value');
        retainedPanel?.classList.add('retained-build-value');
      }
    }
    // The build's black owner/value panel is separate from the physical cards.
    // Retain a copy at its original position while it quickly fades away.
    const fadingLabels = capture || individualBuild ? snapshot.groups.filter(group=>group.label&&(capture||group!==existingBuild)).map(({label})=>{
      const ghost=document.createElement('div');
      ghost.className='card-flight capture-label-flight'+(label.selected?' selected':'');
      ghost.innerHTML=label.html;
      Object.assign(ghost.style,{position:'fixed',pointerEvents:'none',zIndex:'900',
        left:label.rect.left+'px',top:label.rect.top+'px',width:label.rect.width+'px',
        height:label.rect.height+'px',margin:'0',padding:'0'});
      document.body.appendChild(ghost);
      return ghost;
    }) : [];
    // When a hand ends, the engine awards the remaining table cards immediately
    // for correct scoring. Preserve visual copies until the collection finishes,
    // so they don't simply vanish under the scoring dialog.
    const leftoverGhosts = snapshot.finalHand && snapshot.residueOwner !== null
      ? (snapshot.remainingCards || []).map((piece,i)=>{
        const ghost=document.createElement('div');ghost.className='card-flight residue-flight';
        ghost.innerHTML=piece.html;
        Object.assign(ghost.style,{position:'fixed',pointerEvents:'none',zIndex:String(80+i),
          left:piece.rect.left+'px',top:piece.rect.top+'px',width:piece.rect.width+'px',height:piece.rect.height+'px',
          margin:'0',padding:'0',willChange:'transform,opacity'});
        const face=ghost.querySelector('.playing-card');
        if(face)Object.assign(face.style,{width:'100%',height:'100%',margin:'0'});
        document.body.appendChild(ghost);
        return {ghost,rect:piece.rect};
      }) : [];
    let motionStart=null;
    // Give the browser a brief opportunity to paint both sides at their
    // fixed sizes before the shared timeline moves them. This is a start
    // offset, not a frame-rate limit or a JS frame loop.
    function beginMotionBatch(){
      const now=document.timeline?.currentTime;
      motionStart=Number.isFinite(now)?now+16:null;
    }
    // All physical travel has the same rhythm, regardless of the actor.
    // The opponent's face-down reveal is the only additional stage.
    const travelEasing='cubic-bezier(.35,0,.35,1)';
    const animate=(node,frames,opts) => new Promise(resolve=>{
      if (!node.animate) {resolve();return;}
      const {sync,...timing}=opts;
      const anim=node.animate(frames,{fill:'forwards',easing:'cubic-bezier(.23,.68,.28,1)',...timing});
      let done=false;
      const finish=()=>{if(done)return;done=true;resolve();};
      anim.onfinish=finish;anim.oncancel=finish;
      if(sync&&Number.isFinite(motionStart))anim.startTime=motionStart;
    });
    // The source face stays intact. Only its selection tint fades away.
    function releaseCardTint(entry,delay=0) {
      const face=entry.ghost.querySelector('.playing-card.card-selected');
      if (!face) return;
      // Keep the exact selected artwork in a temporary compositor layer.
      // No animation of gradient colors (which repaints the face each frame).
      const tint=face.cloneNode(true);
      tint.classList.add('flight-selection-tint');
      tint.setAttribute('aria-hidden','true');
      tint.removeAttribute('data-card-id');
      face.classList.remove('card-selected');
      entry.ghost.appendChild(tint);
      animate(tint,[{opacity:1},{opacity:0}],{duration:130,delay,fill:'both',easing:'ease-out'})
        .then(()=>tint.remove());
    }
    // Lay out the face once at its exact destination dimensions, then let
    // the browser composite its position/scale. The inverse start transform
    // matches the source rectangle; landing has no scaled-font reset.
    function moveBuildCard(entry, slotRect, duration, delay=0) {
      const source=entry.rect;
      const finish={left:slotRect.left+'px',top:slotRect.top+'px',
        width:slotRect.width+'px',height:slotRect.height+'px'};
      const dx=source.left+source.width/2-slotRect.left-slotRect.width/2;
      const dy=source.top+source.height/2-slotRect.top-slotRect.height/2;
      const start=`translate(${dx}px,${dy}px) scale(${source.width/Math.max(slotRect.width,1)}, ${source.height/Math.max(slotRect.height,1)})`;
      const landed='translate(0px,0px) scale(1, 1)';
      entry.ghost.getAnimations?.().forEach(animation=>animation.cancel());
      Object.assign(entry.ghost.style,finish,{transform:start,opacity:'1'});
      releaseCardTint(entry,delay);
      return animate(entry.ghost,[{transform:start},{transform:landed}],
        {duration,delay,fill:'both',sync:snapshot.kind==='trail',
         easing:travelEasing}).then(()=>{
        if(generation!==motionGeneration)return;
        entry.ghost.style.transform='none';
        entry.rect={left:slotRect.left,top:slotRect.top,width:slotRect.width,height:slotRect.height};
        entry.motion={x:0,y:0,scale:1,scaleY:1};
        entry.ghost.getAnimations?.().forEach(animation=>animation.cancel());
      });
    }
    // A card's last position is committed to its element before cancelling the
    // finished keyframe animation. Without this, consecutive flight stages
    // briefly jump back to the original rect (a visible one-frame hard cut).
    const move=(entry,where,duration,options={})=>{
      const c=center(entry.rect), dx=where.x-c.x,dy=where.y-c.y;
      const scale=options.scale??1;
      const scaleY=options.scaleY??scale;
      const from=options.from || {x:0,y:0,scale:1};
      const fromScaleY=from.scaleY??from.scale;
      const start=`translate(${from.x}px,${from.y}px) scale(${from.scale}, ${fromScaleY})`;
      const finish=`translate(${dx}px,${dy}px) scale(${scale}, ${scaleY})`;
      const finalOpacity=options.fade?0.06:1;
      releaseCardTint(entry,options.delay||0);
      entry.ghost.getAnimations?.().forEach(animation=>animation.cancel());
      entry.ghost.style.transform=start;
      entry.ghost.style.opacity='1';
      return animate(entry.ghost,[
        {transform:start,opacity:1,offset:0},
        {transform:`translate(${from.x+(dx-from.x)*.58}px,${from.y+(dy-from.y)*.58}px) scale(${from.scale+(scale-from.scale)*.58}, ${fromScaleY+(scaleY-fromScaleY)*.58})`,opacity:1,offset:.58},
        {transform:finish,opacity:finalOpacity,offset:1}
      ],{duration,delay:options.delay||0,fill:'both',easing:travelEasing}).then(()=>{
        if(generation!==motionGeneration)return;
        entry.ghost.style.transform=finish;
        entry.ghost.style.opacity=String(finalOpacity);
        entry.motion={x:dx,y:dy,scale,scaleY};
        entry.ghost.getAnimations?.().forEach(animation=>animation.cancel());
      });
    };
    const flipDuration=snapshot.byComputer?335:0;
    // Keep both faces mounted. Rotating two independently painted sides
    // avoids the innerHTML swap and repaint at the narrow midpoint.
    function flipComputerCard(){
      if(!snapshot.byComputer)return Promise.resolve();
      const ghost=ghosts[0].ghost;
      const face=ghost.querySelector(':scope > .playing-card');
      if(!face||!ghost.insertAdjacentHTML)return Promise.resolve();
      ghost.classList.add('two-sided-flight');
      ghost.insertAdjacentHTML('beforeend',renderBack());
      const back=ghost.querySelector(':scope > .card-back');
      if(!back)return Promise.resolve();
      const opts={duration:flipDuration,fill:'both',sync:true,easing:'cubic-bezier(.42,0,.58,1)'};
      return Promise.all([
        animate(back,[{transform:'rotateY(0deg)'},{transform:'rotateY(180deg)'}],opts),
        animate(face,[{transform:'rotateY(-180deg)'},{transform:'rotateY(0deg)'}],opts)
      ]);
    }
    // Gather, hold and collect in a single native transform track per card.
    // No JS callback, new layer, layout read or animation restart at the
    // landing point. All cards share the same collection start time.
    function captureTrack(entry,front,scale,index,stagger,gatherDuration,collectAt){
      const c=center(entry.rect);
      const transform=(x,y,s)=>`translate(${x-c.x}px,${y-c.y}px) scale(${s}, ${s})`;
      const start=transform(c.x,c.y,1),landing=transform(front.x,front.y,scale);
      const finish=transform(end.x,end.y,scale*.32);
      const beginAt=flipDuration+index*stagger;
      const duration=collectAt+280;
      const easing=travelEasing;
      const frames=[{transform:start,opacity:1,offset:0}];
      if(beginAt>0)frames.push({transform:start,opacity:1,offset:beginAt/duration});
      frames[frames.length-1].easing=easing;
      frames.push({transform:landing,opacity:1,offset:(beginAt+gatherDuration)/duration});
      frames.push({transform:landing,opacity:1,offset:collectAt/duration,easing});
      frames.push({transform:finish,opacity:.06,offset:1});
      releaseCardTint(entry,beginAt);
      entry.ghost.style.transform=start;
      entry.ghost.style.opacity='1';
      return animate(entry.ghost,frames,{duration,easing:'linear',fill:'both',sync:true}).then(()=>{
        if(generation!==motionGeneration)return;
        entry.ghost.style.transform=finish;
        entry.ghost.style.opacity='.06';
      });
    }
    async function gatherEndOfHand() {
      if(!snapshot.finalHand || snapshot.residueOwner === null) return;
      const all = capture ? leftoverGhosts : [...leftoverGhosts,...ghosts];
      if(!all.length) return;
      if(generation!==motionGeneration)return;
      const pile=app.querySelector(game.players.length>2&&snapshot.residueOwner>0?'[data-seat-score="'+snapshot.residueOwner+'"]':snapshot.residueOwner===1 ? '.opponent-tag' : '.your-score-tag');
      if(!pile)return;
      // The turn banner remains limited to the two requested turn labels.
      const felt=app.querySelector('.table-area')?.getBoundingClientRect();
      const source=all.map(entry=>center(entry.rect));
      const together={x:felt ? felt.left+felt.width*.5 : source[0].x,
        y:felt ? felt.top+felt.height*.5 : source[0].y};
      const gap=Math.min(60,Math.max(22,300/Math.max(all.length,1)));
      await Promise.all(all.map((entry,i)=>{
        if(generation!==motionGeneration)return;
        // Continue from the actual landing transform of a final played card.
        // Remaining table cards keep their original size throughout collection.
        const from=entry.motion;
        return move(entry,{x:together.x+Math.min(i,8)*2,y:together.y+Math.min(i,8)*2},330,{
          from,scale:from?.scale??1,scaleY:from?.scaleY??1,delay:i*gap
        });
      }));
      if(generation!==motionGeneration)return;
      await new Promise(resolve=>setTimeout(resolve,240));
      if(generation!==motionGeneration)return;
      const finish=center(pile.getBoundingClientRect());
      // Move the full-size stack to its recipient and fade it out in place
      // without scaling down, including when the last move was a trail.
      await Promise.all(all.map(entry=>move(entry,finish,560,{
        from:entry.motion,scale:entry.motion?.scale??1,scaleY:entry.motion?.scaleY??1,fade:true
      })));
    }
    (async()=>{
      try {
        // Begin the panel fade with the move, even before a CPU card flips.
        const labelsFaded=Promise.all(fadingLabels.map(ghost=>animate(ghost,
          [{opacity:1},{opacity:0}],{duration:130,easing:'ease-out'}).then(()=>ghost.remove())));
        // Compute all landing geometry and start native tracks together.
        // Only the build branch needs to wait for a flip to complete.
        if(capture){
          // All cards fly directly to the stack in front of the capturer.
          // No intermediate stop over the table or selected build.
          // Use normal table-card dimensions, independent of build group
          // count. A departing build is no longer a landing obstacle.
          const liveRects=Array.from(app.querySelectorAll?.('.table-stage .playing-card')||[],node=>node.getBoundingClientRect());
          const liveLooseRects=Array.from(app.querySelectorAll?.('.table-cards .playing-card')||[],node=>node.getBoundingClientRect());
          const looseRefs=[...(snapshot.looseCardRects??snapshot.tableRects??[]),...liveLooseRects];
          const sizeRefs=looseRefs.length?looseRefs:capturedCards.map(piece=>piece.rect);
          const tableWidth=sizeRefs.length?Math.max(...sizeRefs.map(r=>r.width)):ghosts[0].rect.width;
          const tableHeight=Math.max(...ghosts.map(entry=>entry.rect.height*tableWidth/Math.max(entry.rect.width,1)));
          let frontScale=1,spreadStep=1.5;
          if(feltRectForCapture){
            const overlaps=r=>r.left<captureFront.x+tableWidth/2+12&&r.left+r.width>captureFront.x-tableWidth/2-4;
            const rowRects=[...looseRefs,...liveRects.filter(overlaps)];
            const mid=feltRectForCapture.top+feltRectForCapture.height*.53;
            const clearance=snapshot.byComputer?Math.max(14,Math.min(26,tableHeight*.30)):
              Math.max(12,Math.min(22,tableHeight*.24));
            let laneTop,laneBottom;
            if(snapshot.byComputer){
              const tableTop=rowRects.length?Math.min(...rowRects.map(r=>r.top)):mid-tableHeight/2;
              laneTop=feltRectForCapture.top+8;
              laneBottom=tableTop-clearance;
            }else{
              const tableBottom=rowRects.length?Math.max(...rowRects.map(r=>r.top+r.height)):mid+tableHeight/2;
              const fieldBottom=feltRectForCapture.top+feltRectForCapture.height;
              const handTop=app.querySelector('.human-hand')?.getBoundingClientRect().top??fieldBottom;
              laneTop=tableBottom+clearance;
              laneBottom=Math.min(fieldBottom,handTop)-8;
            }
            const available=laneBottom-laneTop;
            // Compress overlap offsets before shrinking the physical cards.
            frontScale=Math.min(1,Math.max(.35,available/tableHeight));
            const levels=Math.min(ghosts.length-1,7);
            spreadStep=levels?Math.min(1.5,Math.max(0,available-tableHeight*frontScale)/levels):0;
            const spread=levels*spreadStep;
            const half=tableHeight*frontScale/2;
            captureFront.y=snapshot.byComputer
              ? Math.min(laneTop+Math.max(half,(available-spread)/2),laneBottom-spread-half)
              : laneTop+half;
          }
          const stack=ghosts.map(entry=>({
            entry, scale:frontScale*tableWidth/Math.max(entry.rect.width,1)
          }));
          const frontPositions=stack.map((_,i)=>({
            x:captureFront.x+Math.min(i,7)*1.2,
            y:captureFront.y+Math.min(i,7)*spreadStep
          }));
          const stagger=Math.min(35,150/Math.max(stack.length-1,1));
          const gatherDuration=340;
          const gatherAt=flipDuration+gatherDuration+(stack.length-1)*stagger;
          const collectAt=gatherAt+125;
          beginMotionBatch();
          const flights=stack.map(({entry,scale},i)=>
            captureTrack(entry,frontPositions[i],scale,i,stagger,gatherDuration,collectAt));
          const flip=flipComputerCard();
          // Sound is incidental, not a prerequisite for movement.
          const landedSound=setTimeout(()=>{
            if(generation===motionGeneration)sound('tap');
          },gatherAt);
          try{await Promise.all([...flights,flip]);}
          finally{if(typeof clearTimeout==='function')clearTimeout(landedSound);}
        } else if(snapshot.kind === 'build' && !snapshot.finalHand) {
          beginMotionBatch();
          await flipComputerCard();
          if(generation!==motionGeneration)return;
          const layers=[...destination.querySelectorAll('.build-layer .playing-card[data-card-id]')];
          const order=new Map(layers.map((node,i)=>[node.dataset.cardId,i]));
          const slotRects=layers.map(node=>node.getBoundingClientRect());
          const buildGhosts=ghosts.filter(piece=>order.has(piece.id)).sort((a,b)=>order.get(a.id)-order.get(b.id));
          buildGhosts.forEach(piece=>{piece.ghost.style.zIndex=String(105+order.get(piece.id));});
          const oldCount=buildGhosts.filter(piece=>existingIds.has(piece.id)).length;
          if(retainedPanel?.classList.contains('card-selected')){
            // Fade the old panel's highlighted ink and border, never its black paper.
            const tintNodes=[retainedPanel,...retainedPanel.querySelectorAll('.build-value-owner,.build-value-number')];
            const inkAndEdge=node=>{
              const style=getComputedStyle(node);
              return {color:style.color,borderColor:style.borderColor};
            };
            const before=tintNodes.map(inkAndEdge);
            retainedPanel.classList.remove('card-selected');
            tintNodes.forEach((node,i)=>node.animate?.([before[i],inkAndEdge(node)],
              {duration:130,easing:'ease-out'}));
          }
          await Promise.all(buildGhosts.map(async(piece,i)=>{
            // The existing stack travels as a unit. New cards arrive on top.
            const delay=existingIds.has(piece.id)?0:Math.max(0,i-oldCount)*48;
            if(generation!==motionGeneration)return;
            const index=order.get(piece.id);
            const slot=layers[index];
            if(!slot)return;
            const slotRect=slotRects[index];
            await moveBuildCard(piece,slotRect,310,delay);
            if(generation!==motionGeneration)return;
            piece.ghost.classList.toggle('build-group-start',slot.parentElement.classList.contains('build-group-start'));
            sound('tap');
          }));
          if(generation!==motionGeneration)return;
          await new Promise(resolve=>setTimeout(resolve,65));
          if(generation!==motionGeneration || !destination.isConnected)return;
          const label=destination.querySelector('.build-value');
          // Set opacity before revealing the stack; never expose an opaque
          // new box for even a single frame.
          if(label)label.style.opacity='0';
          if(retainedPanel){
            const oldLayer=layers[order.get(retainedAnchorId)]?.parentElement;
            if(oldLayer)oldLayer.appendChild(retainedPanel);
            else {retainedPanel.remove();retainedPanel=null;}
          }
          destination.style.visibility='visible';
          buildGhosts.forEach(piece=>piece.ghost.remove());
          const panelFades=[];
          if(retainedPanel)panelFades.push(animate(retainedPanel,[{opacity:1},{opacity:0}],
            {duration:110,easing:'ease-out'}).then(()=>retainedPanel?.remove()));
          if(label)panelFades.push(animate(label,[{opacity:0},{opacity:1}],
            {duration:140,easing:'ease-out'}).then(()=>{
              label.style.opacity='1';
              label.getAnimations?.().forEach(animation=>animation.cancel());
            }));
          // Do not let the next turn's render destroy an unfinished fade.
          await Promise.all(panelFades);
        } else {
          // Trails use the exact same destination-sized composited flight
          // as builds, so their final lettering and border already match.
          const landingCard=destination.querySelector('.playing-card') ||
            app.querySelector('.table-cards .playing-card') ||
            app.querySelector('.human-hand .playing-card');
          let landingRect=landingCard?.getBoundingClientRect();
          if(!landingRect){
            const probe=document.createElement('span');probe.className='playing-card';
            Object.assign(probe.style,{position:'fixed',visibility:'hidden'});
            document.body.appendChild(probe);
            landingRect=probe.getBoundingClientRect();probe.remove();
          }
          const landingCenter=destination.matches('[data-action="table"]')?center(landingRect):end;
          beginMotionBatch();
          const flights=ghosts.map((g,i)=>moveBuildCard(g,{
            left:landingCenter.x+i*3-landingRect.width/2,
            top:landingCenter.y+i*2-landingRect.height/2,
            width:landingRect.width,height:landingRect.height
          },490,flipDuration));
          // The face is already laid out at its landing size before its
          // flip begins. Translation starts on the same native clock.
          await Promise.all([...flights,flipComputerCard()]);
        }
        await labelsFaded;
        await gatherEndOfHand();
      } finally {
        // Reveal the final DOM stack before removing the last flight image.
        // This avoids a blank frame between a landing card and its pile.
        if(generation===motionGeneration && !capture && destination.isConnected){
          destination.style.visibility='visible';
        }
        ghosts.forEach(({ghost})=>ghost.remove());
        leftoverGhosts.forEach(({ghost})=>ghost.remove());
        fadingLabels.forEach(ghost=>ghost.remove());
        retainedPanel?.remove();
        if(generation!==motionGeneration)return;
        after();
      }
    })();
  }
  const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);

  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && saved.game && saved.game.players && saved.game.rules) {
      game = saved.game;
      game.rules = E.normalizeRules(game.rules);
      checkpoint = saved.checkpoint || null;
      hasSavedMatch = true;
    }
  } catch (error) { /* local storage may be unavailable on file:// */ }
  if (!game) game = E.newMatch();
  try {
    const stored = JSON.parse(localStorage.getItem(CUSTOM_STORE) || 'null');
    if (stored && typeof stored === 'object') customRules = E.normalizeRules(stored);
  } catch (_) { /* Custom rules are optional. */ }
  function saveCustomRules() {
    try { localStorage.setItem(CUSTOM_STORE, JSON.stringify(customRules)); } catch (_) {}
  }
  let persistedGame=null, persistedMove=-1, persistedCheckpoint;
  function persist() {
    hasSavedMatch = true;
    // Game state mutates only on an engine move; new hands/undo replace it.
    // Keep the immediate committed-move save, but skip identical writes
    // during its animation, completion, and return to the menu.
    if(persistedGame===game&&persistedMove===game.moveNumber&&persistedCheckpoint===checkpoint)return;
    try {
      localStorage.setItem(STORE,JSON.stringify({game,checkpoint}));
      persistedGame=game;persistedMove=game.moveNumber;persistedCheckpoint=checkpoint;
    } catch(error){ /* Retry on the next save if storage was unavailable. */ }
  }
  function me() { return game.players[0]; }
  function opponent() { return game.players[1]; }
  function isRed(card) { return card.suit === 'D' || card.suit === 'H'; }
  function prettySuit(card) { return { S: '♠', H: '♥', D: '♦', C: '♣', X:'✦' }[card.suit]; }
  function prettyRank(card) { return card.suit==='X'?'Joker':(({1:'A',11:'J',12:'Q',13:'K'})[card.rank]||card.rank); }
  function suitClass(card) { return isRed(card) ? 'red' : 'black'; }
  function renderCard(card, small = false, selected = false) {
    const activeRules=typeof game!=='undefined'&&game?.rules;
    const valueText=activeRules&&(activeRules.customizeCardValues||card.suit==='X')?(E.cardValues(card,activeRules).join(' / ')||'Rank'):card.suit==='X'?'15':'';
    return `<span class="playing-card ${suitClass(card)} ${small ? 'mini' : ''} ${selected?'card-selected':''} ${card.rank === 10 ? 'ten-card' : ''} rank-${String(prettyRank(card)).toLowerCase()}" data-card-id="${card.id}" aria-label="${escapeHtml(E.cardName(card))}">
      <span class="card-corner"><b>${prettyRank(card)}</b><small>${prettySuit(card)}</small></span>
      <span class="card-big">${card.suit==='X'?'✦':prettyRank(card)}</span>${valueText?`<span class="card-assigned-values">${escapeHtml(valueText)}</span>`:''}</span>`;
  }
  function renderBack() { return '<span class="card-back" aria-hidden="true"><span class="back-pattern"></span></span>'; }
  // Builds are numerical targets, even when a Royal rank (A/J/Q/K) supplies
  // that value. Leave the physical card's corner index unchanged, but show
  // the actual build total (1, 11, 12, 13, 14, etc.) on the black panel.
  function buildPanelValue(value,signedValue) {
    return String(signedValue??value);
  }
  function entryMarkup(element) {
    const selected = pickedTable.has(element.id);
    if (element.type === 'loose') {
      return `<button type="button" class="table-item ${selected ? 'selected' : ''}" data-action="table" data-id="${element.id}" aria-pressed="${selected}" aria-label="Select ${escapeHtml(E.cardName(element.card))} on table">${renderCard(element.card,false,selected)}</button>`;
    }
    const cards=element.groups.flat();
    // Mark only the beginning of each subsequent equal-valued group.
    const groupStarts=new Set();
    let groupOffset=0;
    for(const group of element.groups){
      if(groupOffset>0)groupStarts.add(groupOffset);
      groupOffset+=group.length;
    }
    const ownerName = element.owner === 0 ? 'You' : (typeof game!=='undefined'&&game.players[element.owner]?.name)||'Computer';
    const panelValue = buildPanelValue(element.value,element.signedValue);
    const layers=cards.map((card,i)=>`<span class="build-layer${groupStarts.has(i)?' build-group-start':''}" style="--layer:${i}">${renderCard(card,false,selected)}${i===cards.length-1?`<span class="build-value ${selected?'card-selected':''}"><span class="build-value-owner">${ownerName}</span><strong class="build-value-number">${panelValue}</strong></span>`:''}</span>`).join('');
    return `<button type="button" class="build-item ${selected ? 'selected' : ''}" data-action="table" data-id="${element.id}" aria-pressed="${selected}" aria-label="Select ${element.groups.length>1?'multiple ':''}${element.signedValue??element.value} build${element.signedValue<0?' (capture value '+element.value+')':''} owned by ${escapeHtml(ownerName)}">
      <span class="build-pile" style="--layers:${cards.length}" aria-hidden="true">${layers}</span>
    </button>`;
  }
  function isHumanTurn() { return handIsActive(); }
  function currentSelection() { return [...pickedTable]; }
  function actionReady(kind) {
    if (!isHumanTurn() || !pickedCard) return null;
    const move = { kind, cardId: pickedCard, targetIds: kind === 'trail' ? [] : currentSelection() };
    return E.validateAction(game, move);
  }
  // A hint identifies the precise legal action without executing it.
  // Hints only change the ordinary card selection. Repeated taps walk
  // every legal selection; after the last trail, start the cycle again.
  function actionButton(kind, label, option = null, index = -1) {
    return `<button class="action-btn ${kind==='build'?'build-main':kind==='capture'?'primary':''}" data-action="${kind}" ${kind==='build'?`data-index="${index}"`:''}>${escapeHtml(label)}</button>`;
  }
  function suggestMove() {
    if (!isHumanTurn()) return;
    try {
      if(!hintIterator)hintIterator=E.hintSelections(game);
      let next=hintIterator.next();
      if(next.done){
        hintIterator=E.hintSelections(game);
        next=hintIterator.next();
      }
      if(next.done)throw new Error('No legal move found.');
      const move=next.value;
      const check=E.validateAction(game,move);
      if(!check.ok)throw new Error(check.reason);
      pickedCard=move.cardId;
      pickedTable=new Set(move.targetIds||[]);
      toast='';
    } catch(error) { resetSelection(); toast=error.message; }
    render('selection');
  }
  function renderToolbar(active, computerScore = 0, multiplayerLabel='') {
    return `<header class="header game-toolbar" aria-label="Game controls">
      <div class="toolbar-left">
        <button class="game-back" data-action="home" aria-label="Return to main menu">×</button>
        <button class="game-help" data-action="menu" aria-label="Open game menu">☰</button>
      </div>
      <div class="opponent-tag" aria-label="${multiplayerLabel?escapeHtml(multiplayerLabel):`Computer has ${computerScore} points`}">${multiplayerLabel?escapeHtml(multiplayerLabel):`Computer · ${computerScore} pts`}</div>
      <div class="header-actions">
        ${renderHandSortToggle(active)}
        <button class="game-help" data-action="hint" aria-label="Suggest a move" title="Hint" ${active?'':'disabled'}>✧</button>
        ${prefs.undo?`<button class="game-help" data-action="undo" aria-label="Undo previous move" title="Undo" ${checkpoint?'':'disabled'}>↶</button>`:''}
      </div>
    </header>`;
  }
  function handSortMode(){return prefs.handSort==='value'?'value':'suit';}
  function renderHandSortToggle(active){
    const suitFirst=handSortMode()==='suit';
    const label=suitFirst?'555':'567';
    const next=suitFirst?'value then suit':'suit then value';
    return '<button type="button" class="hand-sort-toggle" data-action="toggle-hand-sort" aria-label="Sort hand: '+(suitFirst?'suit then value':'value then suit')+'. Tap to sort by '+next+'." title="Switch hand sort order" '+(active?'':'disabled')+'>'+
      label+'</button>';
  }
  function sortedHand(hand,rules,mode='suit'){
    const suitOrder='SHCDX';
    // Numerical capture/build values follow the actual active rules.
    // Classic rank-only face cards have no numerical value: retain J/Q/K
    // as ranks 11/12/13 for presentation only, without changing the rules.
    const keyed=hand.map(card=>{
      const values=E.cardValues(card,rules);
      const suit=suitOrder.indexOf(card.suit);
      return {card,value:values.length?Math.min(...values):card.rank,suit:suit<0?suitOrder.length:suit};
    });
    return keyed.sort((a,b)=>
      (mode==='value'?a.value-b.value||a.suit-b.suit:a.suit-b.suit||a.value-b.value)||
      a.card.rank-b.card.rank||String(a.card.id).localeCompare(String(b.card.id))
    ).map(entry=>entry.card);
  }
  function sortedHandSlots(plan){
    // Growth still alternates rows once both are full; the displayed order
    // reads across the first row and then across the second at all counts.
    return [...plan.cards].sort((a,b)=>a.row-b.row||a.col-b.col);
  }
  // Keep the first row at normal spacing until full, then fill the second.
  // Once both rows are full, each successive card goes to alternating rows.
  // All positions are physical CSS pixels so flights and hitboxes agree.
  function handPlan(count,width,cardWidth,cardHeight,gap,height){
    const n=Math.max(0,Math.floor(count)||0),w=Math.max(1,width),cw=Math.min(w,Math.max(1,cardWidth)),g=Math.max(0,gap);
    const capacity=Math.max(1,Math.floor((w+g+0.001)/(cw+g)));
    const rows=[[],[]];
    for(let i=0;i<n;i++){
      const row=i<capacity?0:i<capacity*2?1:(i-capacity*2)%2;
      rows[row].push(i);
    }
    const used=rows[1].length?2:1,overflow=n>capacity*2;
    const top=Math.max(0,(height-used*cardHeight-(used-1)*g)/2);
    const cards=Array(n);
    rows.forEach((indices,row)=>{
      const len=indices.length;
      if(!len)return;
      const step=len>1?(len>capacity?(w-cw)/(len-1):cw+g):0;
      const left=(w-cw-step*(len-1))/2;
      // The corner occupies about 45% of the face. In crowded rows
      // reduce only the index enough to fit the exposed shoulder.
      const indexScale=len>1&&step<cw?Math.min(1,Math.max(.25,(step-4)/(cw*.45))):1;
      indices.forEach((index,col)=>{cards[index]={row,col,x:left+col*step,y:top+row*(cardHeight+g),indexScale:col===len-1?1:indexScale};});
    });
    return {capacity,rows:rows.map(r=>r.length),cards,overflow};
  }
  function humanHandGeometry(){
    const lane=app.querySelector?.('.human-hand');
    if(!lane||!globalThis.getComputedStyle)return null;
    const nodes=[...lane.querySelectorAll('.hand-item')];
    if(!nodes.length)return null;
    const metrics=getComputedStyle(lane);
    const inset=parseFloat(metrics.paddingLeft)||0;
    const width=lane.clientWidth-inset-(parseFloat(metrics.paddingRight)||0);
    const rect=nodes[0].querySelector('.playing-card')?.getBoundingClientRect();
    if(!rect?.width||!rect.height||width<=0)return null;
    const gap=parseFloat(metrics.columnGap)||4;
    return {lane,nodes,inset,width,cardWidth:rect.width,cardHeight:rect.height,gap,height:lane.clientHeight};
  }
  function planForHand(count,g){
    return handPlan(count,g.width,g.cardWidth,g.cardHeight,g.gap,g.height);
  }
  function makeHandDealProgress(deal,g){
    const incomingIds=[...deal.humanIds],incoming=new Set(incomingIds);
    const baseIds=g.nodes.map(node=>node.dataset.id).filter(id=>!incoming.has(id));
    return {baseIds,incomingIds,arrived:0};
  }
  function dealHandSlots(baseIds,arrivedIds,g){
    // Map the retained sorted cards back to their current growth slots.
    const basePlan=planForHand(baseIds.length,g),baseSlots=sortedHandSlots(basePlan);
    const ids=basePlan.cards.map(slot=>baseIds[baseSlots.indexOf(slot)]).concat(arrivedIds);
    const plan=planForHand(ids.length,g);
    return new Map(ids.map((id,i)=>[id,plan.cards[i]]));
  }
  function handDealLandingRects(progress,g){
    const origin=g.lane.getBoundingClientRect(),result=new Map();
    progress.incomingIds.forEach((id,i)=>{
      const slot=dealHandSlots(progress.baseIds,progress.incomingIds.slice(0,i+1),g).get(id);
      result.set(id,{left:origin.left+g.inset+slot.x,top:origin.top+slot.y,width:g.cardWidth,height:g.cardHeight});
    });
    return result;
  }
  function writeHandSlot(node,p,g){
    node.style.left=(g.inset+p.x)+'px';
    node.style.top=p.y+'px';
    node.style.zIndex=String(p.col+1);
    node.style.setProperty('--hand-index-scale',String(p.indexScale));
  }
  function layoutHumanHand(){
    const g=humanHandGeometry();
    if(!g)return;
    const progress=activeHandDeal||(pendingDeal?.humanIds?.length?makeHandDealProgress(pendingDeal,g):null);
    if(progress){
      const slots=dealHandSlots(progress.baseIds,progress.incomingIds.slice(0,progress.arrived),g);
      g.nodes.forEach(node=>{const p=slots.get(node.dataset.id);if(p)writeHandSlot(node,p,g);});
      return;
    }
    const plan=planForHand(g.nodes.length,g);
    const slots=sortedHandSlots(plan);
    g.nodes.forEach((node,i)=>writeHandSlot(node,slots[i],g));
  }
  function advanceHandDeal(progress,id,animate=true){
    if(activeHandDeal!==progress)return;
    const next=progress.incomingIds.indexOf(id)+1;
    if(next<=progress.arrived)return;
    const g=humanHandGeometry();
    if(!g){progress.arrived=next;return;}
    const previous=dealHandSlots(progress.baseIds,progress.incomingIds.slice(0,progress.arrived),g);
    const oldRects=new Map(),active=animateLayout.active||(animateLayout.active=new WeakMap());
    for(const node of g.nodes){
      if(!previous.has(node.dataset.id))continue;
      if(animate)oldRects.set(node,node.getBoundingClientRect());
      active.get(node)?.cancel();
      active.delete(node);
    }
    progress.arrived=next;
    const slots=dealHandSlots(progress.baseIds,progress.incomingIds.slice(0,next),g);
    for(const node of g.nodes){
      const slot=slots.get(node.dataset.id);
      if(slot)writeHandSlot(node,slot,g);
    }
    if(!animate||!motionAllowed())return;
    // Read geometry first; translate only cards already dealt.
    const shifts=[];
    for(const [node,from] of oldRects){
      const to=node.getBoundingClientRect(),dx=from.left-to.left,dy=from.top-to.top;
      if(node.animate&&(Math.abs(dx)>.5||Math.abs(dy)>.5))shifts.push({node,dx,dy});
    }
    for(const {node,dx,dy} of shifts){
      const animation=node.animate([{translate:dx+'px '+dy+'px'},{translate:'0px 0px'}],{duration:150,easing:'cubic-bezier(.2,.8,.2,1)'});
      if(animation)active.set(node,animation);
    }
  }
  // Size actual cards, not transformed hitboxes. Keep row counts bounded
  // so a full hand still leaves space for the table and legal move buttons.
  function rowPlan(count,table=false){
    const n=Math.max(1,Math.floor(count)||1);
    const portraitRows=Math.min(table?4:3,Math.ceil(n/6));
    const wideRows=Math.min(table?3:2,Math.ceil(n/12));
    return {count:n,portraitRows,portraitCols:Math.ceil(n/portraitRows),
      wideRows,wideCols:Math.ceil(n/wideRows),gap:n>18?2:n>10?3:n>6?4:7,oneGap:n>18?1:n>10?2:n>5?3:6};
  }
  function cardRowStyle(count,table=false){
    const p=rowPlan(count,table);
    return '--row-count:'+p.count+';--portrait-cols:'+p.portraitCols+';--portrait-rows:'+p.portraitRows+
      ';--wide-cols:'+p.wideCols+';--wide-rows:'+p.wideRows+';--multi-gap:'+p.gap+'px;--one-gap:'+p.oneGap+'px';
  }
  function gameSeatColor(seat){
    if(game.rules.teamMode==='freeForAll')return seat===0?'#346da8':'#777b73';
    return ['#346da8','#ac4847','#367c55'][E.sideFor(game.rules,seat)];
  }
  function multiToolbarLabel(){
    if(game.players.length===2)return '';
    return game.players.length+' players · Hand '+game.round;
  }
  function renderCpuSeats(){
    return '<div class="multi-cpu-seats" aria-label="Computer seats">'+game.players.slice(1).map((p,i)=>{
      const seat=i+1,active=game.phase==='playing'&&game.turn===seat;
      return '<div class="multi-cpu-seat'+(active?' current-seat':'')+'" data-cpu-seat="'+seat+'" style="--seat-color:'+gameSeatColor(seat)+'" '+(active?'aria-current="true"':'')+'>'+
        '<div class="multi-seat-caption" data-seat-score="'+seat+'"><b>'+escapeHtml(p.name)+'</b><span>'+p.score+' pts</span></div>'+
        '<div class="opponent-hand multi-seat-hand" style="--hand-count:'+Math.max(1,p.hand.length)+'" aria-label="'+escapeHtml(p.name)+' has '+p.hand.length+' hidden cards">'+p.hand.map(()=>renderBack()).join('')+'</div></div>';
    }).join('')+'</div>';
  }
  function ownCapturedCards(){
    return game.players.length>2?E.scoringSides(game)[E.sideFor(game.rules,0)].captured:me().captured;
  }
  function renderHome() {
    return `<main class="launch-screen">
      <div class="launch-scroll">
        <div class="launch-brand">
          <div class="launch-logo-art" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" role="img" aria-label="Fishing Lab emblem"><rect width="192" height="192" rx="37" fill="#143c33"/><g transform="rotate(-17 72 95)"><rect x="31" y="26" width="80" height="132" rx="10" fill="#204f42" stroke="#d9b96b" stroke-width="3"/><path d="M71 54c-8 9-17 15-17 23a10 10 0 0 0 17 7l-3 9h6l-3-9a10 10 0 0 0 17-7c0-8-9-14-17-23Z" fill="#e4c680"/></g><g transform="rotate(12 115 97)"><rect x="70" y="24" width="91" height="140" rx="10" fill="#fff9ea" stroke="#d9b96b" stroke-width="3"/><path d="M85 35l6 9-6 9-6-9Z M145 135l6 9-6 9-6-9Z" fill="#aa3d36"/><path d="M80 95c15-20 38-22 52-8l18-12v40l-18-12c-14 14-37 12-52-8Z" fill="#24634f"/><path d="M109 82l7-14 10 17M108 107l8 13 10-17" fill="#24634f"/><circle cx="95" cy="92" r="4" fill="#f0ce78"/><path d="M104 94c7-5 17-5 24 0" fill="none" stroke="#f0ce78" stroke-width="2.8" stroke-linecap="round"/></g></svg>
          </div>
          <h1>Fishing Lab</h1><div class="gold-divider">◆</div><p>FISHING CARD GAMES</p>
        </div>
        <div class="launch-actions">
          ${hasSavedMatch ? `<button class="launch-primary" data-action="resume-game"><b>Resume Game</b><small>${game.players.length===2?'vs Computer':game.players.length+' players · vs CPUs'} · ${escapeHtml(game.rules.name)} · Hand ${game.round}</small></button>` : ''}
          <button class="launch-outlined" data-action="setup-new-game"><b>New Game</b></button>
          <button class="launch-outlined" disabled><b>Local Multiplayer</b><small>Coming later</small></button>
          <button class="launch-outlined" disabled><b>Online Multiplayer</b><small>Coming later</small></button>
        </div>
        <div class="launch-tiles">
          <button data-action="rules" class="launch-tile"><span>♧</span><b>How to Play</b></button>
          <button data-action="settings" class="launch-tile"><span>⚙</span><b>Game Variations</b></button>
          <button data-action="toggle-sound" class="launch-tile"><span>♫</span><b>Sound: ${prefs.sound ? 'On' : 'Off'}</b></button>
          <button data-action="toggle-animations" class="launch-tile"><span>✦</span><b>Animations: ${prefs.animations ? 'On' : 'Off'}</b></button>
        </div>
        <p class="launch-foot">Play against the CPU · v${APP_VERSION} · Offline-ready</p>
      </div>
      ${modal ? renderModal() : ''}
    </main>`;
  }
  // A full render replaces the scroll container. Preserve its position whenever
  // a variation changes (and while opening an explanation of a setting).
  function rememberVariationsScroll() {
    const scrollArea = app && app.querySelector && app.querySelector('.variations-content');
    if (scrollArea) variationsScrollTop = scrollArea.scrollTop;
  }
  function restoreVariationsScroll() {
    if (modal !== 'settings') return;
    const scrollArea = app && app.querySelector && app.querySelector('.variations-content');
    if (scrollArea) scrollArea.scrollTop = Math.min(variationsScrollTop, Math.max(0, scrollArea.scrollHeight - scrollArea.clientHeight));
  }
  function syncSelection(controlsMarkup,actionsMarkup) {
    const felt=app.querySelector('.shell .felt');
    const human=felt?.querySelector('.human-area');
    const stats=felt?.querySelector('.game-stats');
    if(!felt||!human||!stats||modal)return false;
    for(const node of felt.querySelectorAll('[data-action="hand"][data-id],[data-action="table"][data-id]')){
      const selected=node.dataset.action==='hand'?node.dataset.id===pickedCard:pickedTable.has(node.dataset.id);
      if(node.classList.contains('selected')!==selected){
        node.classList.toggle('selected',selected);
        node.setAttribute('aria-pressed',String(selected));
        for(const face of node.querySelectorAll('.playing-card,.build-value'))face.classList.toggle('card-selected',selected);
      }
    }
    const controls=felt.querySelector('.contextual-controls');
    if(!controlsMarkup){controls?.remove();}
    else if(!controls){const slot=felt.querySelector('.move-action-slot');if(slot)slot.innerHTML=controlsMarkup;else human.insertAdjacentHTML('beforebegin',controlsMarkup);}
    else if(actionsMarkup!==renderedActionMarkup){controls.querySelector('.main-actions').innerHTML=actionsMarkup;}
    renderedActionMarkup=actionsMarkup;
    const error=felt.querySelector('.game-error');
    if(!toast)error?.remove();
    else if(error)error.textContent=toast;
    else stats.insertAdjacentHTML('beforebegin',`<p class="game-error" role="alert">${escapeHtml(toast)}</p>`);
    return true;
  }
  // Dialog-only interactions must never replace live animation destinations.
  function syncGameOverlay() {
    const shell=app.querySelector('.shell');
    if(!shell)return false;
    shell.classList.toggle('animations-on',!!prefs.animations);
    shell.classList.toggle('animations-off',!prefs.animations);
    const actions=shell.querySelector('.header-actions');
    if(actions&&!!actions.querySelector('[data-action="undo"]')!==!!prefs.undo){
      // The toolbar markup has one canonical renderer. Reuse just its
      // right-hand controls when the Undo preference changes.
      const template=document.createElement('template');
      template.innerHTML=renderToolbar(isHumanTurn(),opponent().score,multiToolbarLabel());
      actions.replaceChildren(...template.content.querySelector('.header-actions').children);
    }
    const overlay=app.querySelector('.overlay');
    if(!modal){overlay?.remove();return true;}
    if(!overlay){app.insertAdjacentHTML('beforeend',renderModal());}
    else {
      const panel=overlay.querySelector('.dialog');
      if(!panel)return false;
      panel.setAttribute('aria-label',modal);
      panel.innerHTML=renderDialogBody();
    }
    restoreVariationsScroll();
    return true;
  }
  function render(mode = 'full') {
    if (!app) return;
    rememberVariationsScroll();
    // Changes to rules redraw only the content inside the mounted settings dialog.
    // Keeping the backdrop and dialog intact prevents their opening fade from replaying.
    const existingSettings = modal === 'settings' && (mode==='overlay'||screen==='home') && app.querySelector
      ? app.querySelector('.overlay .dialog[aria-label="settings"]') : null;
    if (existingSettings) {
      const focused=typeof document!=='undefined'&&document.activeElement;
      const focusData=focused&&existingSettings.contains?.(focused)?{...focused.dataset}:null;
      const deckScroll=existingSettings.querySelector?.('.deck-checklist-scroll');
      if(deckScroll)deckChecklistScroll=deckScroll.scrollTop;
      existingSettings.innerHTML = renderSettings();
      const newDeckScroll=existingSettings.querySelector?.('.deck-checklist-scroll');
      if(newDeckScroll)newDeckScroll.scrollTop=deckChecklistScroll;
      restoreVariationsScroll();
      if(focusData&&Object.keys(focusData).length&&existingSettings.querySelectorAll){
        const next=[...existingSettings.querySelectorAll('[data-setting],[data-action]')].find(node=>
          Object.entries(focusData).every(([key,value])=>node.dataset[key]===value)&&!node.closest?.('[hidden]'));
        if(next&&!next.disabled)next.focus?.({preventScroll:true});
      }
      return;
    }
    if(screen==='game'&&mode==='overlay'&&syncGameOverlay())return;
    if (screen === 'home') {
      const home = app.querySelector('.launch-screen');
      const overlay = home?.querySelector('.overlay');
      // Keep the home screen mounted while the single setup dialog is open.
      if (home && !modal && overlay) { overlay.remove(); return; }
      if (home && modal && !overlay) {
        home.insertAdjacentHTML('beforeend', renderModal());
        return;
      }
      const oldScroll = home?.scrollTop || 0;
      app.innerHTML = renderHome();
      const newHome = app.querySelector('.launch-screen');
      if (newHome) newHome.scrollTop = oldScroll;
      restoreVariationsScroll();
      return;
    }
    const oldLayout=mode!=='selection'&&motionAllowed()?layoutPositions():null;
    if (game.phase !== 'playing') resetSelection();
    if (pickedCard && !me().hand.some(c => c.id === pickedCard)) resetSelection();
    const active = isHumanTurn();
    // Never run a validator for an action the current selection cannot show.
    const capture = pickedTable.size ? actionReady('capture') : null;
    const trail = pickedTable.size ? null : actionReady('trail');
    buildOptions = active && pickedCard && (pickedTable.size || game.rules.singleCardBuild) ? E.contextualBuildOptions(game,pickedCard,currentSelection()) : [];
    const canTrail = !!(trail && trail.ok && !pickedTable.size);
    const canCapture = !!(capture && capture.ok && pickedTable.size);
    const canBuild = buildOptions.length > 0;
    const visibleActionCount = Number(canTrail) + Number(canCapture) + Number(canBuild);
    const actionsMarkup=buildOptions.map((o,i)=>actionButton('build',o.label,o,i)).join('')+
      (canTrail?actionButton('trail','Trail'):'')+(canCapture?actionButton('capture','Capture'):'');
    const controlsMarkup=active && pickedCard && visibleActionCount
      ? `<section class="controls contextual-controls" aria-label="Legal moves"><div class="main-actions">${actionsMarkup}</div></section>`:'';
    // Selection lift is a CSS-only transform, not a change in layout.
    // Do not layer a second FLIP animation on top or measure a transient
    // hover/selection position as if it were a new table slot.
    if(mode==='selection'&&syncSelection(controlsMarkup,actionsMarkup))return;
    renderedActionMarkup=actionsMarkup;
    const motion = lastMotion;
    lastMotion = '';
    app.innerHTML = `
      <div class="shell ${prefs.animations ? 'animations-on' : 'animations-off'}${game.players.length>2?' multiplayer-game':''}">
        ${renderToolbar(active,opponent().score,multiToolbarLabel())}
        <main class="felt" data-motion="${motion}">
          <div class="table-grain"></div>
          <div class="opponent-area">
            ${game.players.length>2?renderCpuSeats():`<div class="opponent-hand${opponent().hand.length>5?' wide-hand':''}" style="--hand-count:${Math.max(1,opponent().hand.length)}" aria-label="Computer has ${opponent().hand.length} hidden cards">${opponent().hand.map(() => renderBack()).join('')}</div>`}
          </div>
          <div class="table-area">
            <div class="table-stage"><div class="table-cards" aria-label="Table cards" style="${cardRowStyle(game.table.filter(e=>e.type==='loose').length,true)}">${game.table.some(e => e.type === 'loose') ? game.table.filter(e => e.type === 'loose').map(entryMarkup).join('') : ''}</div>
            <div class="table-builds" aria-label="Builds on the table">${game.table.filter(e => e.type === 'build').map(entryMarkup).join('')}</div></div>
          </div>
          <div class="turn-action-area">
            <div class="move-action-slot">${controlsMarkup}</div>
          </div>
          <div class="human-area">
            <span class="sr-only" role="status">${active?'Your turn':'Waiting for your turn'}</span>
            <div class="human-hand${active?'':' hand-inactive'}" aria-label="Your hand" aria-disabled="${!active}">${sortedHand(me().hand,game.rules,handSortMode()).map(card => `<button type="button" data-action="hand" data-id="${card.id}" class="hand-item ${pickedCard === card.id ? 'selected' : ''}" aria-pressed="${pickedCard === card.id}" aria-label="Play ${escapeHtml(E.cardName(card))}" ${active ? '' : 'disabled'}>${renderCard(card,false,pickedCard===card.id)}</button>`).join('')}</div>
            <div class="your-score-tag" style="--seat-color:${gameSeatColor(0)}">${game.rules.teamMode==='freeForAll'?'You':'Your team'} · ${me().score} pts</div>
          </div>
          ${toast ? `<p class="game-error" role="alert">${escapeHtml(toast)}</p>` : ''}
          <div class="game-stats"><span>${game.rules.teamMode==='freeForAll'?'Cards Captured':'Team Cards'} <b>${ownCapturedCards().length}</b></span><span>${game.rules.teamMode==='freeForAll'?'Spades Captured':'Team Spades'} <b>${ownCapturedCards().filter(c=>c.suit==='S').length}</b></span>
            <span class="deck-stat"><span class="deck-stat-label">Cards in Deck</span><span class="deck-stat-content">
              <span class="draw-stock ${game.stock.length===0?'empty':''}" role="img" aria-label="Draw pile: ${game.stock.length} cards remaining">
                <span class="stock-stack" aria-hidden="true"><span class="stock-back stock-bottom">${renderBack()}</span><span class="stock-back stock-middle">${renderBack()}</span><span class="stock-back stock-top">${renderBack()}</span></span>
              </span><b class="draw-stock-count">${game.stock.length}</b>
            </span></span>
          </div>
        </main>
        <footer class="footer"><span>Single-player · Saves on this device · v${APP_VERSION}</span></footer>
      </div>
      ${modal ? renderModal() : ''}`;
    restoreVariationsScroll();
    layoutHumanHand();
    hidePendingDealCards();
    animateLayout(oldLayout,motion,motion==='capture'&&(game.lastActor??(1-game.turn))!==0);
    if (motion === 'deal' || motion === 'deal-hands') dealAnimation = animateNewDeal(motion === 'deal');
  }
  const SETTING_INFO = {
    royal: ['Face Cards', 'With Royal face cards on, Jacks, Queens and Kings have numerical values 11, 12 and 13 and may participate in sums and builds. Otherwise they capture matching face cards only.'],
    royalAces: ['Aces', 'Royal Aces may count as either 1 or 14 in captures and builds. The game chooses a legal value for the move.'],
    royalBigLittle: ['2 and 10', 'Little Cassino (2♠) can count as 2 or 15; Big Cassino (10♦) can count as 10 or 16 in captures and builds.'],
    pirateCaptures: ['Captures', 'When enabled, you may capture table cards and other builds while you still own a build. When off, you must first capture your own build.'],
    pirateBuilds: ['Builds', 'When enabled, you may start another independent build while you own one. Each separate build requires its own matching capture card in your hand, unless Build Obligation is off. A multiple build counts as one stack. Otherwise, resolve your current build first.'],
    allowTrailWithOwnBuild: ['Trails', 'Allows trailing a card onto the table while owning builds, as long as you retain a distinct matching capture card for each independent build (unless Build Obligation is off).'],
    buildObligation: ['Build Obligation', 'When on, keep a distinct matching capture card for each independent build. One card covers one multiple build. When off, you may build without holding the capture card. The Pirate switches separately control other moves while owning builds.'],
    drawMode: ['Draw', 'After every turn, the player who played draws a replacement card until the stock is exhausted, rather than waiting for all players to run out of cards.'],
    sweepCancel: ['Sweep', 'When a capture clears the table, award a sweep. At hand scoring, each side scores only the number of sweeps beyond the opponent’s sweep count.'],
    spadeScoring: ['Spade Scoring', 'Every spade captured earns one point, plus a bonus point for the Jack of spades, replacing the ordinary most-spades award.'],
    builds: ['Building', 'Allow single builds; with this switched off, players can only capture or trail.'],
    multipleBuilds: ['Multiple Builds', 'Allow two or more equal-valued combinations to be combined into a multiple build.'],
    directCapture:['Allow single card captures','A table card can be captured by matching its rank or numerical value. Matching builds remain capturable.'],
    additiveCapture:['Allow multiple card / sum captures','Allow several table cards whose values add to the played card.'],
    additiveBuilds:['Allow single builds in sum captures','A build can contribute its announced value to an arithmetic capture.'],
    subtractiveBuilds:['Subtractive building','Two cards may create a build at their positive difference, or a single build may be lowered by the played card.'],
    singleCardBuild:['Single-card declaration','A hand card alone can be declared as a build, subject to the ordinary obligation.'],
    raiseOwnBuild:['Modify own builds','Permit changing the announced value of your own single build.'],
    raiseOpponentBuild:['Modify opponent builds','Permit changing the announced value of the opponent’s single build.'],
    mergeSameValue:['Builds must combine same-value builds','Include existing same-value builds in a new build.'],
    absorbMatching:['Builds must combine same-value table cards','Include table cards matching the new build value.'],
    extraAfterSweep:['Extra turn after a sweep','The opponent receives a second turn after a sweep, if they still have a card.'],
    multiHandCapture:['Multiple hand cards','Planned: use multiple cards from hand for one capture.'],
    tableOnlyBuild:['Table-only building','Planned: build without spending a card from hand.'],
  };
  let rulesSection='',rulesIssuesOpen=false,labResult=null,difficultyInfoOpen=false;
  let valueCardKey='S1',valuePickerOpen=false,deckChecklistScroll=0;
  const RULE_HELP={
    handSize:'Cards dealt to each player at a time. In a full deal, all remaining cards are distributed at once.',
    initialTableSize:'Table cards placed on the table before the first turn.',
    deckSize:'The 40-card deck removes ranks 8, 9 and 10, including Big Cassino.',
    dealMode:'Batch: deal again when both hands are empty. Draw: replace each played card. Full: deal the entire remaining stock at the start.',
    remainderMode:'How to distribute the stock when it does not divide into equal full batches.',
    faceMode:'Classic: Jacks, Queens and Kings capture their own rank. Numerical: face cards also participate in sums and builds.',
    aceMode:'An ace can use either of its listed values in captures and builds.',
    forcedCapture:'A card with an otherwise legal capture cannot be trailed. Building remains a separate action; build obligations take precedence.',
    captureGroups:'Capture one matching group, or several disjoint groups at the same value.',
    captureExtent:'Selective: choose legal groups. Maximal: no additional group can be added to your selection. Maximum: take the greatest number of cards possible with the played card.',
    buildRange:'Restrict the numerical values that can be announced for a build.',
    independentBuilds:'Limit independent owned builds; multiple equal-value groups in a single stack count as one build.',
    sweepPoints:'Award points when a capture clears every card from the table.',
    winningScore:'Reach this score and lead the opponent after a completed deal.',
    scoreMode:'Choose the scoring system. The results table uses its actual point categories.',
    matchDeals:'The higher cumulative score wins after the selected number of deals.',
    initialTableRule:'Replace forbidden starting cards and return them to the stock.',
    directPriority:'If the played card directly matches a table card, capture a matching card rather than a sum.',
    ignoreOpeningSweep:'The first move of a deal does not score a sweep.',
    ignoreFinalSweep:'The final move of a deal does not score a sweep.',
    residueOwner:'Who receives the table cards left at deal end.'
  };
  const OPTION_HELP={
  "deckMode": [
    [
      "40 (A–10)",
      "All four suits, ace through ten. No face cards or jokers."
    ],
    [
      "52",
      "All four suits, ace through king. No jokers."
    ],
    [
      "54",
      "Standard 52 cards plus two visually identical jokers."
    ],
    [
      "Custom",
      "Choose any subset of all 54 physical cards. For an Italian deck, exclude 8–10 instead of the face cards."
    ]
  ],
  "dealMode": [
    [
      "Repeated batches",
      "Deal the selected number of cards to each player, then deal again after all hands are empty."
    ],
    [
      "Draw replacement",
      "After playing a hand card, draw one replacement while stock remains."
    ],
    [
      "All cards at start",
      "Deal every remaining card at the start. The cards-per-hand slider is ignored."
    ]
  ],
  "remainderMode": [
    [
      "Smaller equal hands",
      "The final batch may have fewer cards than the selected hand size, but all players must receive the same number."
    ],
    [
      "Unequal hands",
      "Distribute every remaining card even if one player receives an extra card. Skip a player whose hand is empty."
    ],
    [
      "Full batches only",
      "Every batch must contain exactly the selected hand size for each player. The validator blocks decks and starting tables that leave an incomplete batch."
    ]
  ],
  "initialTableRule": [
    [
      "None",
      "Any cards may appear on the starting table."
    ],
    [
      "Distinct non-point cards",
      "No repeated ranks, aces, 10♦ or 2♠. These are the ordinary Cassino point cards; rejected cards are returned to the stock."
    ],
    [
      "No 3 equal face cards",
      "At most two jacks, two queens and two kings may appear at the start."
    ],
    [
      "No 3 kings",
      "At most two kings may appear at the start; other ranks are unrestricted."
    ]
  ],
  "faceMode": [
    [
      "Rank matching",
      "J, Q and K have no numerical capture value. Each matches its own rank."
    ],
    [
      "J=11, Q=12, K=13",
      "Face cards can participate in numerical sums and builds."
    ],
    [
      "J=12, Q=13, K=14",
      "Alternative numerical face values, one higher than the preceding option."
    ],
    [
      "J=8, Q=9, K=10",
      "Italian values. Ordinary 8–10 must be excluded when face cards are included."
    ]
  ],
  "aceMode": [
    [
      "1",
      "Aces have numerical value 1 only."
    ],
    [
      "1 or 11",
      "An ace may be used at either 1 or 11."
    ],
    [
      "1 or 14",
      "An ace may be used at either 1 or 14."
    ]
  ],
  "royalBigLittle": [
    [
      "Off",
      "2♠ and 10♦ have their normal values, 2 and 10."
    ],
    [
      "On",
      "2♠ can additionally count as 15, and 10♦ as 16, if those cards are included."
    ]
  ],
  "customizeCardValues": [
    [
      "Off",
      "Use the standard face-card, ace and special-card settings. Custom assignments are remembered but ignored."
    ],
    [
      "On",
      "Use individual card assignments instead; the standard settings are greyed out. Both identical jokers share one assignment."
    ]
  ],
  "customValues": [
    [
      "Card",
      "Choose any included card in the four-suit rank grid. Excluded cards are greyed out. The single Joker row represents both identical copies."
    ],
    [
      "Primary 1–30",
      "The card may be used at the selected numerical value."
    ],
    [
      "Rank only",
      "The card has no numerical value. It can match only another rank-only card of the same rank."
    ],
    [
      "Secondary 1–30",
      "An optional alternative value. Use either value in a legal move, not both at once."
    ],
    [
      "None",
      "No additional numerical value."
    ]
  ],
  "forcedCapture": [
    [
      "Optional",
      "Capturing is not compulsory. Trailing remains an option if otherwise legal."
    ],
    [
      "Face cards only",
      "J, Q or K cannot be trailed when the played card has a legal capture."
    ],
    [
      "Direct matches",
      "A card cannot be trailed when it can legally take a single matching table card."
    ],
    [
      "Any legal match",
      "A card with any otherwise legal capture cannot be trailed. Building is a separate action; build obligations take precedence."
    ]
  ],
  "captureGroups": [
    [
      "One group",
      "Take one matching group at the played card's value."
    ],
    [
      "Multiple groups",
      "Take several independent groups, each matching the same selected value."
    ]
  ],
  "captureExtent": [
    [
      "Selective",
      "Choose any legal capture selection."
    ],
    [
      "Maximal",
      "No further eligible group can be added to your selection."
    ],
    [
      "Maximum cards",
      "Take the greatest number of physical cards possible with the played card."
    ]
  ],
  "buildRange": [
    [
      "All capturable",
      "Use any numerical build value supported by the selected deck."
    ],
    [
      "9–13",
      "Restrict builds to available capture values from 9 through 13."
    ],
    [
      "10–13",
      "Restrict builds to available capture values from 10 through 13."
    ],
    ["Custom","Set an inclusive minimum and maximum by typing a value or choosing from the dropdown. Only numerical values available in the selected deck can be endpoints or legal build values."]
  ],
  "independentBuilds": [
    [
      "One",
      "You may own only one separate stack, regardless of its value. A multiple build made of equal-value groups counts as one stack."
    ],
    [
      "Up to two",
      "You may own at most two independent stacks of any values. Two separate 8-builds count as two; one multiple 8-build counts as one."
    ],
    [
      "Unlimited",
      "There is no fixed per-player stack limit. Equal-value stacks may coexist unless Builds must combine same-value builds is enabled. Each stack may require its own capturing card."
    ]
  ],

  "residueOwner": [
    [
      "Last capturer",
      "Award remaining table cards to the last player who captured; if no player captured, they are unclaimed."
    ],
    [
      "Dealer",
      "Award remaining table cards to the dealer, even if another player made the last capture."
    ]
  ],
  "directCapture": [
    [
      "Off",
      "You cannot capture an individual table card just because it matches your played card. Matching builds can still be captured."
    ],
    [
      "On",
      "Example: play an 8 to capture an 8 on the table. Rank-only cards match by rank instead. Capturing several separate matching groups is governed by Groups per capture."
    ]
  ],
  "additiveCapture": [
    [
      "Off",
      "You cannot combine smaller values to make a matching sum. Individual matches and matching builds remain available if allowed."
    ],
    [
      "On",
      "Example: play an 8 to capture a 5 and a 3 together. Their values add up to 8. Separate matching groups are governed by Groups per capture."
    ]
  ],
  "additiveBuilds": [
    [
      "Off",
      "All builds must be captured at their announced value. For example, a 6-build requires a 6, not an 8 plus a table 2."
    ],
    [
      "On",
      "Example: play an 8 to capture a single 6-build and a table 2 together. The single build acts as one card worth 6. Multiple builds still require an exact match to their announced value. No new build is created."
    ]
  ],
  "directPriority": [
    [
      "Off",
      "A legal sum may be selected even if a direct table-card match exists."
    ],
    [
      "On",
      "If the played card matches a table card directly, take a matching table card rather than an additive alternative."
    ]
  ],
  "builds": [
    [
      "Off",
      "Only capture and trail. Build-specific settings become inactive."
    ],
    [
      "On",
      "Create and capture numerical builds using the enabled construction rules."
    ]
  ],
  "additiveBuilding": [
    ["Off","Do not add different card values to construct or raise a build. Same-value groups can still be combined if multi builds are allowed."],
    ["On","Add the values of the played card and table cards, such as 3 + 5 to make an 8-build. This also permits raising a single build when the relevant modification permission is enabled."]
  ],
  "multipleBuilds": [
    [
      "Off",
      "A build contains one group only."
    ],
    [
      "On",
      "Stack two or more groups with the same value as a multiple build."
    ]
  ],
  "subtractiveBuilds": [
    [
      "Off",
      "Do not create a build by subtraction or lower the value of a single build."
    ],
    [
      "On",
      "Example: 9 − 2 makes a 7-build. You may also lower a single 9-build to 7 with a 2, if the appropriate modification permission is enabled."
    ]
  ],
  "negativeBuilds": [
    ["Off","Subtraction uses the normal positive build values. In color arithmetic, a negative result cannot be declared."],
    ["On","Permit a negative result, such as 3 − 7 = −4. Display −4 on the single build; capture it with any card valued 4. Its absolute value is used for build limits, reserved cards, merging and subsequent arithmetic. Zero is never a valid build. Requires subtractive building."]
  ],
  "colorArithmetic": [
    ["Off","Choose addition or subtraction according to the enabled building methods, regardless of suit."],
    ["On","When forming arithmetic groups, spades and clubs add, hearts and diamonds subtract. Both jokers add. For example, 5♣ + 3♠ − 2♥ makes a 6-build. When changing a single build, the played card determines the operation. Single-card declarations and individual same-value groups retain their ordinary values. Captures still use ordinary card values. Addition and subtraction must be enabled separately."]
  ],
  "singleCardBuild": [
    [
      "Off",
      "A new build cannot consist of only the card played from your hand; it must involve at least one table card or existing build."
    ],
    [
      "On",
      "Declare just the card played from your hand as a new single build, without selecting any table cards. It must have an allowed build value and meet any build obligation."
    ]
  ],
  "raiseOwnBuild": [
    [
      "Off",
      "You cannot raise or lower your own existing single build. Combining same-value groups does not change its value."
    ],
    [
      "On",
      "Raise your own single build by adding a hand card, or lower it by subtraction, when the corresponding building option is enabled. If color arithmetic is on, the played card's suit determines which operation is allowed. Multi builds cannot be raised or lowered."
    ]
  ],
  "raiseOpponentBuild": [
    [
      "Off",
      "You cannot raise or lower an opponent’s existing single build. Combining same-value groups is governed separately."
    ],
    [
      "On",
      "Raise an opponent’s single build by addition, or lower it by subtraction, when the corresponding building option is enabled. If color arithmetic is on, the played card's suit determines which operation is allowed. The modified build becomes yours. Multi builds cannot be raised or lowered."
    ]
  ],
  "mergeSameValue": [
    [
      "Off",
      "Two separate stacks of the same value may coexist, subject to each player's independent-build limit and capturing-card obligation."
    ],
    [
      "On",
      "A new build must include any existing stacks at the same value. This governs whether separate equal-value stacks can coexist; it is not a limit on the number of stacks. Requires multiple builds."
    ]
  ],
  "absorbMatching": [
    [
      "Off",
      "Individual table cards matching the new build value may remain separate."
    ],
    [
      "On",
      "A new or modified build must combine with every unbuilt table card that individually matches its value. For example, a new 8-build must include any separate 8 on the table. Additional combinations summing to 8 are not required. Requires multiple builds."
    ]
  ],
  "buildObligation": [
    [
      "Off",
      "Make builds without retaining a matching capture card. Unresolved builds may remain until the deal ends."
    ],
    [
      "On",
      "Reserve a distinct matching hand card for each independently owned build."
    ]
  ],
  "pirateCaptures": [
    [
      "Off",
      "Capture your own active build before making an unrelated capture."
    ],
    [
      "On",
      "Capture unrelated table cards or builds while owning a build, subject to any obligation to retain a matching card."
    ]
  ],
  "allowTrailWithOwnBuild": [
    [
      "Off",
      "Do not trail while owning an active build."
    ],
    [
      "On",
      "Trail while owning a build, provided required capturing cards are retained."
    ]
  ],
  "extraAfterSweep": [
    [
      "Off",
      "The players alternate turns normally."
    ],
    [
      "On",
      "The opponent of a player who sweeps receives an extra turn, provided they have cards to play."
    ]
  ],
  "sweepCancel": [
    [
      "Off",
      "Each player scores all their eligible sweeps."
    ],
    [
      "On",
      "Cancel opposing sweeps one for one. With three or more sides, only sweeps exceeding all opposing sweeps combined score."
    ]
  ],
  "ignoreOpeningSweep": [
    [
      "Off",
      "The first move can score a sweep."
    ],
    [
      "On",
      "Clearing the table on the first move scores no sweep points."
    ]
  ],
  "ignoreFinalSweep": [
    [
      "Off",
      "The last move can score a sweep."
    ],
    [
      "On",
      "Clearing the table on the last move of the deal scores no sweep points."
    ]
  ]
};
  function helpFor(key,options=[],rules=draft){
    if(key==='scoreMode')return E.scoreHelp(draft);
    if(key==='playerCount')return [2,3,4,5,6].map(n=>[n+' players','You and '+(n-1)+' computer '+(n===2?'opponent.':'players.')]);
    if(key==='teamMode')return playerTeamHelp(rules.playerCount);
    if(OPTION_HELP[key])return OPTION_HELP[key];
    if(key==='handSize')return [['1 to '+handMaximum(),'Drag the stepped slider or type a whole number into the value box. Maximum = deck size divided by player count, rounded down. Starting table cards can impose a tighter legal limit; the compatibility check catches that.'],['All cards at start','The slider has no effect in this dealing mode.']];
    if(key==='jokerValue')return options.map(n=>[String(n),'Both identical jokers have numerical capture and build value '+n+'.']);
    if(key==='initialTableSize')return options.map(([n,label])=>[label,n===0?'The table starts empty.':'Place '+n+' table cards on the table before the first turn.']);
    if(key==='sweepPoints')return options.map(n=>[String(n),n===0?'Sweeps earn no points.':'Each eligible sweep earns '+n+' point'+(n===1?'':'s')+'.']);
    if(key==='winningScore')return options.map(([n,label])=>[label,'Win at the end of a deal when your side has at least '+n+' points and leads all opposing sides.']);
    if(key==='matchDeals')return options.map(([n,label])=>[label,n===0?'Continue until a player reaches the winning score and leads.':'Play exactly '+n+' deal'+(n===1?'':'s')+'; the higher cumulative score wins.']);
    return [['Explanation',RULE_HELP[key]||SETTING_INFO[key]?.[1]||'']];
  }
  function ruleInfo(key,title){
    return '<button type="button" class="var-info rules-info" data-action="info-setting" data-key="'+key+'" aria-label="Explain '+escapeHtml(title)+'" aria-expanded="'+(detailSetting===key)+'">ⓘ</button>';
  }
  function ruleExplanation(key,options=[],rules=draft){
    if(detailSetting!==key)return '';
    // A single available arrangement is fixed, not an inactive gameplay rule.
    const inactive=key!=='teamMode'&&E.ruleActivity(rules).disabled[key];
    return '<div class="inline-setting-info rule-option-help">'+(inactive?'<p class="inactive-rule-note"><b>Inactive:</b> this setting has no effect under the current configuration. Your preference is retained.</p>':'')+helpFor(key,options,rules).map(([label,description])=>'<p><b>'+escapeHtml(label)+'</b> — '+escapeHtml(description)+'</p>').join('')+'</div>';
  }
  function ruleSwitch(key,title,disabled=false,hint=''){
    disabled=disabled||!!draft.presetBlocker||!!E.ruleActivity(draft).disabled[key];
    const checked=key==='buildObligation'?!draft.buildAnything:!!draft[key];
    return '<div class="rules-setting rules-switch'+(disabled?' is-inactive':'')+'"><div class="rules-setting-label"><span class="rules-label">'+escapeHtml(title)+'</span>'+
      (hint?'<small>'+escapeHtml(hint)+'</small>':'')+'</div>'+ruleInfo(key,title)+
      '<label class="var-toggle"><input type="checkbox" data-setting="'+key+'" '+(checked?'checked ':'')+(disabled?'disabled ':'')+'aria-label="'+escapeHtml(title)+'"><i></i></label>'+
      ruleExplanation(key)+'</div>';
  }
  function ruleValue(key){
    if(key==='faceMode')return !draft.royal?'classic':draft.faceValues==='extended'?'extended':draft.faceValues==='italian'?'italian':'royal';
    if(key==='scoreMode')return draft.scoreProfile==='cassino'&&draft.spadeScoring?'spade':draft.scoreProfile;
    if(key==='forcedCapture')return E.ruleActivity(draft).forcedOptions.includes(draft.forcedCapture)?draft.forcedCapture:'optional';
    if(key==='aceMode')return draft.royalAces?14:(draft.aceValue||1);
    if(key==='independentBuilds')return !draft.pirateBuilds||draft.buildLimit==='1'?'1':draft.buildLimit;
    return draft[key];
  }
  function ruleSelect(key,title,options,disabled=false,hint=''){
    const activity=E.ruleActivity(draft);
    disabled=disabled||!!draft.presetBlocker||!!activity.disabled[key];
    const value=ruleValue(key);
    return '<div class="rules-setting rules-select'+(disabled?' is-inactive':'')+'"><label class="rules-setting-label" for="rule-'+key+'"><span class="rules-label">'+escapeHtml(title)+'</span>'+
      (hint?'<small>'+escapeHtml(hint)+'</small>':'')+'</label>'+ruleInfo(key,title)+
      '<select id="rule-'+key+'" data-setting="'+key+'" aria-label="'+escapeHtml(title)+'" '+(disabled?'disabled':'')+'>'+
      options.map(option=>{const pair=Array.isArray(option)?option:[option,option];const blocked=key==='forcedCapture'&&!activity.forcedOptions.includes(pair[0]);return '<option value="'+escapeHtml(pair[0])+'" '+(String(value)===String(pair[0])?'selected':'')+(blocked?' disabled':'')+'>'+escapeHtml(pair[1])+'</option>';}).join('')+
      '</select>'+ruleExplanation(key,options)+'</div>';
  }
  function ruleGroup(title,content){
    return '<h4 class="rules-subheading">'+title+'</h4><div class="rules-group">'+content+'</div>';
  }
  function effectiveDraftRules(){return E.activeRules(draft);}
  function faceLabel(){return !draft.royal?'Rank matching':draft.faceValues==='extended'?'J=12 · Q=13 · K=14':draft.faceValues==='italian'?'J=8 · Q=9 · K=10':'J=11 · Q=12 · K=13';}
  function dealLabel(){return draft.dealMode==='full'?'All cards at start':draft.dealMode==='draw'?draft.handSize+' cards · replace after play':draft.dealMode==='bid'?'Opening bid':draft.handSize+'-card batches';}
  function buildLabel(){return !draft.builds?'Disabled':(draft.multipleBuilds?'Single & multi builds':'Single builds')+' · '+(draft.buildAnything?'No reserved card':'Reserved card required')+(draft.buildRange==='custom'?' · Values '+(draft.buildMin??'—')+'–'+(draft.buildMax??'—'):'');}
  function nearestBuildValue(values,value){
    if(!values.length)return null;
    if(!Number.isFinite(Number(value))||value==null||value==='')return values[0];
    return values.reduce((best,v)=>Math.abs(v-Number(value))<Math.abs(best-Number(value))?v:best,values[0]);
  }
  function fitBuildBounds(){
    if(draft.buildRange!=='custom')return;
    const vals=E.availableValues(draft);
    draft.buildMin=nearestBuildValue(vals,draft.buildMin);
    draft.buildMax=nearestBuildValue(vals,draft.buildMax??vals[vals.length-1]);
    if(draft.buildMin!=null&&draft.buildMax<draft.buildMin)draft.buildMax=draft.buildMin;
  }
  function buildBoundChoices(key){
    const vals=E.availableValues(draft);
    return vals.filter(v=>key==='buildMin'?draft.buildMax==null||v<=draft.buildMax:draft.buildMin==null||v>=draft.buildMin);
  }
  function renderBuildRangeFields(disabled){
    if(draft.buildRange!=='custom')return '';
    const vals=E.availableValues(draft);
    const locked=disabled||!!draft.presetBlocker||!vals.length||E.ruleActivity(draft).disabled.buildRange;
    const field=(key,title)=>{
      const choices=buildBoundChoices(key),val=draft[key]??'';
      return '<div class="build-bound"><label for="range-'+key+'">'+title+'</label><div class="build-bound-combo">'+
        '<input id="range-'+key+'" type="number" inputmode="numeric" step="1" min="'+(choices[0]??1)+'" max="'+(choices[choices.length-1]??30)+'" data-setting="buildBoundText" data-bound="'+key+'" aria-label="Type '+title.toLowerCase()+' build value" value="'+escapeHtml(val)+'" '+(locked?'disabled':'')+'>'+
        '<select data-setting="buildBoundChoice" data-bound="'+key+'" aria-label="Choose '+title.toLowerCase()+' build value" '+(locked?'disabled':'')+'>'+
        choices.map(v=>'<option value="'+v+'" '+(v===val?'selected':'')+'>'+v+'</option>').join('')+'</select></div></div>';
    };
    return '<div class="build-range-editor'+(locked?' is-inactive':'')+'">'+field('buildMin','Minimum')+field('buildMax','Maximum')+
      '<small>'+(vals.length?'Only values available in this deck can be used.':'No numerical card values are available.')+'</small></div>';
  }
  function playerTeamLabel(count,mode){
    if(mode==='freeForAll')return count===2?'1 vs. 1':'FFA';
    if(mode==='pairs')return count===6?'2 vs. 2 vs. 2':'2 vs. 2';
    if(mode==='triples')return '3 vs. 3';
    return '';
  }
  function playerTeamOptions(count){return E.teamModesFor(count).map(mode=>[mode,playerTeamLabel(count,mode)]);}
  function teamCycleControl(rules=draft){
    const modes=E.teamModesFor(rules.playerCount),mode=rules.teamMode;
    const label=playerTeamLabel(rules.playerCount,mode),canCycle=modes.length>1&&!rules.presetBlocker;
    const next=modes[(modes.indexOf(mode)+1)%modes.length];
    const aria='Teams: '+label+(canCycle?'. Tap to switch to '+playerTeamLabel(rules.playerCount,next)+'.':' (only available arrangement)');
    return '<button type="button" id="rule-teamMode" class="team-cycle-control" data-action="cycle-team-mode" aria-label="'+escapeHtml(aria)+'" '+(canCycle?'':'disabled')+'><span>'+escapeHtml(label)+'</span>'+
      (canCycle?'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7h-3V4M17 7a7 7 0 0 0-12 4M4 17h3v3M7 17a7 7 0 0 0 12-4"/></svg>':'')+'</button>';
  }
  function teamModeSetting(){
    return '<div class="rules-setting team-mode-setting"><label class="rules-setting-label" for="rule-teamMode"><span class="rules-label">Teams</span></label>'+ruleInfo('teamMode','Teams')+
      teamCycleControl()+ruleExplanation('teamMode',playerTeamOptions(draft.playerCount))+'</div>';
  }
  function playerTeamHelp(count){
    return playerTeamOptions(count).map(([mode,label])=>[label,
      mode==='freeForAll'?(count===2?'You compete against one CPU opponent. Each player has an individual score.':'Free for all: all '+count+' players compete independently, each with their own captured cards and score.'):
      mode==='pairs'?(count===6?'Three teams of two compete. Partners sit opposite one another and share captured cards and a team score.':'Two teams of two compete. Partners sit opposite one another and share captured cards and a team score.'):
      'Two teams of three compete. Teammates alternate around the table and share captured cards and a team score.'
    ]);
  }
  function playerSetupSummary(rules=draft){
    return rules.playerCount+' players · '+playerTeamLabel(rules.playerCount,rules.teamMode);
  }
  function playerHeader(rules=draft){
    return 'FISHING LAB · '+rules.playerCount+' PLAYERS · VS '+(rules.playerCount===2?'COMPUTER':'CPUs');
  }
  function playerCountSetting(){
    const n=draft.playerCount,disabled=!!draft.presetBlocker;
    return '<div class="rules-setting hand-slider-setting player-count-setting'+(disabled?' is-inactive':'')+'"><label class="rules-setting-label" for="rule-playerCount"><span class="rules-label">Number of players</span></label>'+ruleInfo('playerCount','Number of players')+
      '<output class="player-count-number" id="player-count-output" for="rule-playerCount">'+n+'</output>'+
      '<div class="hand-slider-control player-count-control"><input id="rule-playerCount" type="range" data-setting="playerCount" min="2" max="6" step="1" value="'+n+'" '+(disabled?'disabled':'')+' aria-label="Number of players">'+
      '<div class="player-count-ticks" aria-hidden="true">'+[2,3,4,5,6].map(v=>'<span class="'+(v===n?'active':'')+'" data-player-tick="'+v+'"><i></i><b>'+v+'</b></span>').join('')+'</div></div>'+
      ruleExplanation('playerCount')+'</div>';
  }
  // A polar rectangle is a fixed radial band and fixed angular interval.
  // All seats keep exactly the same shape at every player count; only
  // their angular positions change. The center is deliberately empty.
  function polarSeatPath(cx,cy,inner,outer,angle,halfAngle){
    const point=(r,t)=>[+(cx+r*Math.cos(t)).toFixed(3),+(cy+r*Math.sin(t)).toFixed(3)].join(' ');
    const start=angle-halfAngle,end=angle+halfAngle;
    return 'M '+point(outer,start)+' A '+outer+' '+outer+' 0 0 1 '+point(outer,end)+
      ' L '+point(inner,end)+' A '+inner+' '+inner+' 0 0 0 '+point(inner,start)+' Z';
  }
  function seatingDiagram(rules=draft){
    const n=rules.playerCount,mode=rules.teamMode,seats=E.seatAssignments(n,mode);
    const colors=['#346da8','#ac4847','#367c55'];
    const free=mode==='freeForAll';
    const fillFor=s=>free?(s.human?colors[0]:'#777b73'):colors[s.team];
    const labels=seats.map(s=>(s.human?'You':'CPU '+s.seat)+(free?'':', team '+(s.team+1)));
    const cx=160,cy=110,inner=60,outer=100,halfAngle=22*Math.PI/180,labelRadius=(inner+outer)/2;
    const groups=seats.map(s=>{
      const angle=Math.PI/2+2*Math.PI*s.seat/n;
      const xPos=(cx+labelRadius*Math.cos(angle)).toFixed(2),yPos=(cy+labelRadius*Math.sin(angle)).toFixed(2);
      const label=s.human?'You':'CPU '+s.seat;
      return '<g class="setup-seat'+(s.human?' human-seat':'')+'" data-seat="'+s.seat+'" data-team="'+(s.team===null?'none':s.team)+'" data-seat-x="'+xPos+'" data-seat-y="'+yPos+'"><title>'+escapeHtml(labels[s.seat])+(s.human?' (south seat)':'')+'</title>'+
        '<path class="polar-seat" d="'+polarSeatPath(cx,cy,inner,outer,angle,halfAngle)+'" fill="'+fillFor(s)+'" stroke="'+(s.human?'#193b60':fillFor(s))+'" stroke-width="1.6" stroke-linejoin="round"/>'+
        '<text x="'+xPos+'" y="'+yPos+'" dominant-baseline="central" text-anchor="middle" fill="#ffffff" font-size="10.5" font-weight="700">'+label+'</text></g>';
    }).join('');
    return '<div class="setup-table-figure"><svg viewBox="0 0 320 220" class="setup-table-svg" role="img" aria-labelledby="setup-table-title setup-table-desc">'+
      '<title id="setup-table-title">'+escapeHtml(playerSetupSummary(rules))+' seating</title><desc id="setup-table-desc">You sit at the south seat. '+escapeHtml(labels.join('; '))+'.</desc>'+
      groups+'</svg></div>';
  }
  function playerSetupContent(){
    return '<div class="rules-group player-setup-group">'+playerCountSetting()+
      teamModeSetting()+
      '<div id="player-seating-preview">'+seatingDiagram()+'</div></div>';
  }
  function handMaximum(){
    const players=[2,3,4,5,6].includes(draft.playerCount)?draft.playerCount:2;
    return Math.floor(E.makeDeck(draft).length/players);
  }
  function handSetting(){
    const maximum=handMaximum(),n=Math.max(1,Math.min(maximum||1,draft.handSize||1)),disabled=draft.dealMode==='full'||maximum<1||!!draft.presetBlocker;
    const ticks=Array.from({length:maximum},(_,i)=>'<span class="'+(i+1===n?'active':'')+'" data-hand-tick="'+(i+1)+'"></span>').join('');
    return '<div class="rules-setting hand-slider-setting'+(disabled?' is-inactive':'')+'"><label class="rules-setting-label" for="rule-handSize"><span class="rules-label">Cards per hand</span>'+
      (draft.dealMode==='full'?'<small>Entire deck dealt at start</small>':'')+'</label>'+ruleInfo('handSize','Cards per hand')+
      '<input id="hand-size-output" class="hand-size-number" type="number" inputmode="numeric" data-setting="handSizeText" min="1" max="'+Math.max(1,maximum)+'" step="1" value="'+(maximum?n:'')+'" '+(disabled?'disabled':'')+' aria-label="Type cards per hand">'+
      '<div class="hand-slider-control"><input id="rule-handSize" type="range" data-setting="handSize" min="1" max="'+Math.max(1,maximum)+'" step="1" value="'+n+'" '+(disabled?'disabled':'')+' aria-label="Cards per hand">'+
      '<div class="hand-size-ticks" aria-hidden="true">'+ticks+'</div><div class="hand-size-bounds"><span>1</span><span>'+maximum+'</span></div></div>'+
      ruleExplanation('handSize')+'</div>';
  }
  const rankOrder=Array.from({length:13},(_,i)=>i+1),suitOrder=['S','H','C','D'];
  const suitGlyph={S:'♠',H:'♥',C:'♣',D:'♦'};
  function rankLabel(rank){return ({1:'A',11:'J',12:'Q',13:'K'})[rank]||String(rank);}
  function deckCardCheckbox(id,label,red,selected){
    return '<label class="deck-check-card'+(red?' red-card':'')+'"><input type="checkbox" data-setting="deckCard" data-card-id="'+id+'" '+(selected.has(id)?'checked ':'')+(draft.presetBlocker?'disabled ':'')+'aria-label="Include '+escapeHtml(label)+'"><span>'+escapeHtml(label)+'</span></label>';
  }
  function renderDeckChecklist(){
    if(draft.deckMode!=='custom')return '';
    const selected=new Set(E.makeDeck(draft).map(c=>c.id)),disabled=draft.presetBlocker?'disabled':'';
    return '<div class="deck-checklist"><div class="deck-checklist-head"><b>'+selected.size+' / 54 cards</b><button type="button" class="rules-reset" data-action="deck-all" '+disabled+'>Select all</button><button type="button" class="rules-reset" data-action="deck-none" '+disabled+'>Deselect all</button></div>'+
      '<div class="deck-checklist-scroll" role="group" aria-label="Cards included in the deck"><div class="deck-grid">'+suitOrder.map(s=>'<b class="card-grid-suit'+(s==='H'||s==='D'?' red-card':'')+'">'+suitGlyph[s]+'</b>').join('')+
      rankOrder.flatMap(rank=>suitOrder.map(s=>deckCardCheckbox(s+rank,rankLabel(rank)+suitGlyph[s],s==='H'||s==='D',selected))).join('')+
      '<div class="deck-joker-row">'+deckCardCheckbox('X1','Joker (copy 1)',false,selected)+deckCardCheckbox('X2','Joker (copy 2)',false,selected)+'</div></div></div>'+
      '<p class="rules-description">Jokers look identical during play; either physical copy can be included.</p></div>';
  }
  function currentValueCard(){
    const deck=E.makeDeck(draft);
    return deck.find(c=>E.cardKey(c)===valueCardKey)||deck[0]||null;
  }
  function renderValuePicker(card){
    if(!valuePickerOpen)return '';
    const included=new Set(E.makeDeck(draft).map(E.cardKey));
    const current=card?E.cardKey(card):'';
    const cell=(key,label,red)=>'<button type="button" class="value-card-choice'+(red?' red-card':'')+(current===key?' selected':'')+'" data-action="value-card" data-value="'+key+'" aria-pressed="'+(current===key)+'" '+(included.has(key)&&!draft.presetBlocker?'':'disabled')+'>'+label+'</button>';
    return '<div class="value-picker-scroll"><div class="value-card-grid" role="group" aria-label="Select a card for value assignment">'+suitOrder.map(s=>'<b class="card-grid-suit'+(s==='H'||s==='D'?' red-card':'')+'">'+suitGlyph[s]+'</b>').join('')+
      rankOrder.flatMap(rank=>suitOrder.map(s=>cell(s+rank,rankLabel(rank)+suitGlyph[s],s==='H'||s==='D'))).join('')+
      '<div class="value-joker-row">'+cell('Joker','Joker',false)+'</div></div></div>';
  }
  function renderValueEditor(){
    if(!draft.customizeCardValues)return '';
    const card=currentValueCard(),key=card?E.cardKey(card):'',values=card?E.cardValues(card,draft):[];
    const first=values[0]??'rank',second=values[1]??'none',disabled=!card||draft.presetBlocker;
    const option=(v,label,current,off=false)=>'<option value="'+v+'" '+(String(v)===String(current)?'selected ':'')+(off?'disabled':'')+'>'+label+'</option>';
    const numbers=Array.from({length:30},(_,i)=>i+1);
    return '<div class="custom-value-editor"><div class="custom-value-heading"><b>Individual card values</b>'+ruleInfo('customValues','Individual card values')+'</div>'+
      '<div class="card-value-equation"><div><label>Card</label><button type="button" class="value-picker-button" data-action="toggle-value-picker" aria-expanded="'+valuePickerOpen+'" '+(disabled?'disabled':'')+'>'+(card?escapeHtml(E.cardName(card)):'—')+' <span aria-hidden="true">▾</span></button></div><span class="equation-symbol">=</span>'+
      '<div><label for="value-primary">Primary</label><select id="value-primary" data-setting="primaryValue" aria-label="Primary card value" '+(disabled?'disabled':'')+'>'+option('rank','Rank only',first)+numbers.map(n=>option(n,String(n),first)).join('')+'</select></div><span class="equation-symbol">,</span>'+
      '<div><label for="value-secondary">Secondary</label><select id="value-secondary" data-setting="secondaryValue" aria-label="Secondary card value" '+(disabled||first==='rank'?'disabled':'')+'>'+option('none','None',second)+numbers.map(n=>option(n,String(n),second,n===first)).join('')+'</select></div></div>'+
      ruleExplanation('customValues')+renderValuePicker(card)+'</div>';
  }
  function targetSetting(){return ruleSelect('winningScore','Winning score',[11,16,21,31,41,50,51,61,100,101,121].map(n=>[n,n+' pts']),!!draft.matchDeals);}
  function forcedSetting(){const inactive=!E.ruleActivity(draft).forcedOptions.includes(draft.forcedCapture);return ruleSelect('forcedCapture','Compulsory captures',[['optional','Optional'],['faces','Face cards only'],['direct','Direct matches'],['all','Any legal match']],false,inactive?'Previous preference inactive; restores when available.':'');}
  const VARIANT_STORE='fishing-lab-saved-variants-v1';
  let savedVariants=readSavedVariants(),savedVariantSource=null,variantEditorMode='',variantNameText='',variantMessage='',variantMessageError=false;
  function cloneVariantRules(rules){return JSON.parse(JSON.stringify(rules));}
  function readSavedVariants(){
    try{
      const raw=JSON.parse(localStorage.getItem(VARIANT_STORE)||'[]');
      if(!Array.isArray(raw))return [];
      const ids=new Set(),names=new Set();
      return raw.filter(v=>{
        if(!v||typeof v.id!=='string'||!/^saved-\d+$/.test(v.id)||typeof v.name!=='string'||!v.name.trim()||v.name.length>60||!v.rules||typeof v.rules!=='object'||Array.isArray(v.rules)||ids.has(v.id)||names.has(v.name.trim().toLowerCase()))return false;
        ids.add(v.id);names.add(v.name.trim().toLowerCase());return true;
      }).map(v=>({id:v.id,name:v.name.trim(),rules:cloneVariantRules(v.rules)}));
    }catch(_){return [];}
  }
  function writeSavedVariants(next){
    try{localStorage.setItem(VARIANT_STORE,JSON.stringify(next));}
    catch(_){return false;}
    savedVariants=next;return true;
  }
  function savedVariant(id){return savedVariants.find(v=>v.id===id);}
  function variantRulesMatch(left,right){
    const a=E.activeRules(left),b=E.activeRules(right);
    return Object.keys(E.DEFAULT_RULES).every(k=>k==='name'||k==='difficulty'||JSON.stringify(a[k])===JSON.stringify(b[k]));
  }
  function copySavedRules(entry){
    return E.normalizeRules({...cloneVariantRules(entry.rules),name:entry.name,savedVariantId:entry.id});
  }
  function clearVariantEditor(){
    variantEditorMode='';variantNameText='';variantMessage='';variantMessageError=false;
  }
  function beginVariantEditor(mode){
    if(!draft||draft.presetBlocker)return;
    const source=savedVariant(savedVariantSource);
    if(mode==='update'&&!source)return;
    clearVariantEditor();
    variantEditorMode=mode;
    variantNameText=mode==='update'?source.name:'';
    render('overlay');
  }
  function markCustomDraft(){
    draftPreset='custom';draft.name='Custom Fishing';
    delete draft.savedVariantId;
    customDraft=cloneVariantRules(draft);
  }
  function saveNamedVariant(name,replaceId=null){
    if(!draft||draft.presetBlocker)return {ok:false,reason:'Choose a customizable rule configuration first.'};
    const clean=String(name??'').trim();
    if(!clean||clean.length>60)return {ok:false,reason:'Enter a variant name of 1–60 characters.'};
    const old=replaceId?savedVariant(replaceId):null;
    if(replaceId&&!old)return {ok:false,reason:'That saved variant no longer exists.'};
    if(savedVariants.some(v=>v.id!==replaceId&&v.name.toLowerCase()===clean.toLowerCase()))return {ok:false,reason:'A saved variant already has that name. Choose another name or update that variant.'};
    let id=old?.id;
    if(!id){do{id='saved-'+Date.now()+String(Math.floor(Math.random()*1e6)).padStart(6,'0');}while(savedVariant(id));}
    const rules=cloneVariantRules(E.normalizeRules(draft));
    delete rules.savedVariantId;rules.name=clean;
    const entry={id,name:clean,rules};
    const next=old?savedVariants.map(v=>v.id===id?entry:v):[...savedVariants,entry];
    if(!writeSavedVariants(next))return {ok:false,reason:'Could not save on this device. The previous variants are unchanged.'};
    draft=copySavedRules(entry);draftPreset=id;savedVariantSource=id;
    clearVariantEditor();variantMessage=(old?'Updated ':'Saved ')+clean+'.';
    return {ok:true,id};
  }
  function removeNamedVariant(id){
    const old=savedVariant(id);if(!old)return {ok:false,reason:'That saved variant no longer exists.'};
    if(!writeSavedVariants(savedVariants.filter(v=>v.id!==id)))return {ok:false,reason:'Could not delete the variant. Your saved variants are unchanged.'};
    if(draftPreset===id||savedVariantSource===id){
      savedVariantSource=null;
      markCustomDraft();
    }
    clearVariantEditor();variantMessage='Deleted '+old.name+'. Your current rules are still available.';
    return {ok:true};
  }
  function renderVariantControls(){
    const source=savedVariant(savedVariantSource),blocked=!!draft.presetBlocker;
    const actions='<div class="saved-variant-actions"><button type="button" class="rules-reset" data-action="save-variant-as" '+(blocked?'disabled':'')+'>Save as new variant</button>'+
      (source?'<button type="button" class="rules-reset" data-action="update-saved-variant">Update saved</button><button type="button" class="rules-reset variant-delete" data-action="delete-saved-variant">Delete saved</button>':'')+'</div>';
    const editor=variantEditorMode?'<div class="variant-editor"><label for="variant-name">'+(variantEditorMode==='update'?'Update or rename saved variant':'Name your variant')+'</label>'+
      '<input type="text" id="variant-name" data-setting="variantName" maxlength="60" autocomplete="off" placeholder="e.g. My Royal Cassino" value="'+escapeHtml(variantNameText)+'">'+
      '<div class="saved-variant-actions"><button type="button" class="rules-reset" data-action="cancel-variant-save">Cancel</button><button type="button" class="rules-reset variant-save-primary" data-action="confirm-variant-save">'+(variantEditorMode==='update'?'Update':'Save')+'</button></div></div>':'';
    return '<div class="saved-variant-controls">'+actions+
      (source?'<p class="saved-variant-source">Saved variant: '+escapeHtml(source.name)+'</p>':'')+
      editor+(variantMessage?'<p class="variant-message'+(variantMessageError?' variant-error':'')+'" role="'+(variantMessageError?'alert':'status')+'">'+escapeHtml(variantMessage)+'</p>':'')+'</div>';
  }
  function completeVariantEditor(){
    if(!variantEditorMode)return;
    const result=saveNamedVariant(variantNameText,variantEditorMode==='update'?savedVariantSource:null);
    if(!result.ok){variantMessage=result.reason;variantMessageError=true;}
    render('overlay');
  }
  function renderPresetPicker(){
    const chosen=E.PRESET_CATALOG.find(p=>p.id===draftPreset),saved=savedVariant(draftPreset),groups=[...new Set(E.PRESET_CATALOG.map(p=>p.group))];
    const savedOptions=savedVariants.length?'<optgroup label="Saved variants">'+savedVariants.map(v=>'<option value="'+escapeHtml(v.id)+'" '+(draftPreset===v.id?'selected':'')+'>'+escapeHtml(v.name)+'</option>').join('')+'</optgroup>':'';
    const options=groups.map(group=>'<optgroup label="'+escapeHtml(group)+'">'+E.PRESET_CATALOG.filter(p=>p.group===group).map(p=>'<option value="'+p.id+'" '+(draftPreset===p.id?'selected':'')+'>'+escapeHtml(p.name+(p.status==='preview'?' — preview':''))+'</option>').join('')+'</optgroup>').join('');
    return '<div class="preset-picker"><label for="variation-picker" class="rules-main-label">Game variation</label><select id="variation-picker" data-setting="preset" aria-label="Game variation"><option value="custom" '+(draftPreset==='custom'?'selected':'')+'>Custom rules</option>'+savedOptions+options+'</select>'+
      '<p class="preset-description">'+escapeHtml(saved?'Saved on this device. Edit the rules and update or save a new copy.':chosen?chosen.note:'Your own combination of fishing-game mechanics.')+'</p>'+
      (draft.presetBlocker?'<div class="preset-preview-note" role="note"><b>Research preview — not playable yet</b><p>'+escapeHtml(draft.presetBlocker)+'</p>'+
      (chosen?.partial?'<button type="button" class="rules-reset" data-action="use-partial-preset">Use available mechanics as Custom</button>':'')+'</div>':'')+renderVariantControls()+'</div>';
  }
  function renderDifficulty(){
    const levels=E.DIFFICULTY_INFO;
    return '<div class="difficulty-heading"><h3>DIFFICULTY</h3><button type="button" class="var-info" data-action="difficulty-info" aria-label="Explain all CPU difficulty levels" aria-expanded="'+difficultyInfoOpen+'">ⓘ</button></div>'+
      '<div class="pill-row diff-row">'+levels.map(([key,title])=>'<button type="button" class="pill-choice '+(draft.difficulty===key?'selected':'')+'" data-action="setup-difficulty" data-value="'+key+'" aria-pressed="'+(draft.difficulty===key)+'">'+title+'</button>').join('')+'</div>'+
      (difficultyInfoOpen?'<div class="difficulty-explanations">'+levels.map(([key,title,desc])=>'<div class="'+(key===draft.difficulty?'current':'')+'"><b>'+title+'</b><p>'+escapeHtml(desc)+'</p></div>').join('')+'<p class="difficulty-footnote">CPU uses its hand and public information, not the actual hidden human hand or future stock order. Search may stop early to keep the app responsive.</p></div>':'');
  }
  function rulesAccordion(key,title,summary,content){
    if(key==='lab'){
      const open=rulesSection==='lab';
      return '<section class="rules-accordion"><button type="button" class="rules-accordion-head" data-action="rules-section" data-value="lab" aria-controls="rules-area-lab" aria-expanded="'+open+'"><span><b>'+title+'</b><small>'+escapeHtml(summary)+'</small></span><i aria-hidden="true">'+(open?'−':'+')+'</i></button><div id="rules-area-lab" class="rules-accordion-body" '+(open?'':'hidden')+'>'+content+'</div></section>';
    }
    return '<section class="rules-page-section" id="rules-area-'+key+'"><div class="rules-page-heading"><h3>'+title+'</h3><small>'+escapeHtml(summary)+'</small></div><div class="rules-page-body">'+content+'</div></section>';
  }
  function renderLab(){
    let results='';
    if(labResult){
      results='<div class="rules-lab-result" role="status"><b>'+labResult.completed+' / '+labResult.tested+' deals completed</b><p>'+labResult.failures.length+' failures · '+labResult.zeroScore+' scoreless deals</p>'+
        labResult.failures.slice(0,3).map(f=>'<p class="rule-error">Seed '+f.seed+': '+escapeHtml(f.reason)+'</p>').join('')+
        (labResult.failures.length?'<button type="button" class="action-btn" data-action="copy-lab-report">Copy diagnostic report</button>':'')+'</div>';
    }
    return '<p class="rules-description">Test 10 seeded deals with every seat controlled by a CPU. Failures retain the seed, board and move log. Passing is not proof of universal playability.</p>'+
      '<button type="button" class="action-btn rules-test" data-action="run-rules-lab" '+(E.validateRules(effectiveDraftRules()).playable?'':'disabled')+'>Simulate 10 deals</button>'+results;
  }
  function renderAllRules(){
    const building=draft.builds, multiple=building&&draft.multipleBuilds;
    const hasSums=draft.additiveCapture;
    const deckContent='<div class="rules-group">'+ruleSelect('deckMode','Deck size',[['40','40 (A–10)'],['52','52'],['54','54'],['custom','Custom']])+renderDeckChecklist()+ruleSelect('initialTableSize','Starting table',[0,3,4,8].map(n=>[n,n+' cards']))+
      ruleSelect('dealMode','Dealing method',[['batch','Repeated batches'],['draw','Draw replacement'],['full','All cards at start']])+handSetting()+
      ruleSelect('remainderMode','Final deal',[['equal','Smaller equal hands'],['uneven','Unequal hands'],...(draft.dealMode==='batch'?[['strict','Full batches only']]:[])],draft.dealMode==='draw',draft.dealMode==='draw'?'Not used in draw mode':'')+
      ruleSelect('initialTableRule','Starting table restrictions',[['any','None'],['distinct-nonpoints','Distinct non-point cards'],['no-three-faces','No 3 equal face cards'],['no-three-kings','No 3 kings']],!draft.initialTableSize)+'</div>';
    const includedIds=new Set(E.makeDeck(draft).map(c=>c.id));
    const valueOverride=draft.customizeCardValues,hasSpecial=includedIds.has('S2')||includedIds.has('D10');
    const valuesContent='<div class="rules-group">'+ruleSelect('faceMode','Face cards',[['classic','Rank matching'],['royal','J=11, Q=12, K=13'],['extended','J=12, Q=13, K=14'],['italian','J=8, Q=9, K=10']],valueOverride)+
      ruleSelect('aceMode','Ace values',[[1,'1'],[11,'1 or 11'],[14,'1 or 14']],valueOverride)+ruleSwitch('royalBigLittle','Special values for 2♠ / 10♦',valueOverride||!hasSpecial,'2 or 15 · 10 or 16')+
      (draft.jokerCount?ruleSelect('jokerValue','Joker value',Array.from({length:30},(_,i)=>i+1),valueOverride):'')+
      ruleSwitch('customizeCardValues','Customize card values')+renderValueEditor()+'</div>';
    const captureContent=ruleGroup('What can be captured',ruleSwitch('directCapture','Allow single card captures',false,'8 takes 8')+ruleSwitch('additiveCapture','Allow multiple card / sum captures',false,'8 takes 5 + 3')+ruleSwitch('additiveBuilds','Allow single builds in sum captures',!building||!hasSums,'8 takes a single 6-build + 2'))+
      ruleGroup('Capture requirements',forcedSetting()+ruleSwitch('directPriority','Direct matches take priority',!draft.directCapture)+ruleSelect('captureGroups','Groups per capture',[['one','One group'],['unlimited','Multiple groups']])+ruleSelect('captureExtent','Capture extent',[['choice','Selective'],['maximal','Maximal'],['maximum','Maximum cards']]));
    const arithmetic=draft.additiveBuilding!==false||draft.subtractiveBuilds;
    const buildContent='<div class="rules-group">'+ruleSwitch('builds','Allow building')+
      ruleSwitch('additiveBuilding','Allow additive building',!building,'3 + 5 makes an 8-build')+
      ruleSwitch('subtractiveBuilds','Allow subtractive building',!building,'9 − 2 makes a 7-build')+
      ruleSwitch('multipleBuilds','Allow multi builds',!building,'Stack equal-value groups')+
      ruleSwitch('singleCardBuild','Allow single hand-card builds',!building)+
      ruleSwitch('negativeBuilds','Allow negative builds',!building||!draft.subtractiveBuilds,'3 − 7 = −4; captured by a 4')+
      ruleSwitch('colorArithmetic','Black adds, red subtracts',!building,'♠ ♣ add · ♥ ♦ subtract')+
      ruleSelect('buildRange','Allowed build values',[['all','All capturable'],['9-13','9–13'],['10-13','10–13'],['custom','Custom']],!building)+
      renderBuildRangeFields(!building)+'</div>'+
      ruleGroup('Modifying builds',ruleSwitch('raiseOwnBuild','Can modify your own single build',!building||!arithmetic)+
        ruleSwitch('raiseOpponentBuild',"Can modify opponent's single build",!building||!arithmetic)+
        ruleSwitch('mergeSameValue','Builds must combine same-value builds',!multiple)+ruleSwitch('absorbMatching','Builds must combine same-value table cards',!multiple))+
      ruleGroup('While owning a build',ruleSwitch('buildObligation','Keep a capturing card',!building,'Reserve a distinct card for each stack')+
        ruleSelect('independentBuilds','Independent builds per player',[['1','One'],['2','Up to two'],['unlimited','Unlimited']],!building)+
        ruleSwitch('pirateCaptures','Allow unrelated captures',!building)+ruleSwitch('allowTrailWithOwnBuild','Allow trailing',!building));
    const turnContent='<p class="rules-description">Play one hand card per action. Play proceeds around the table, skipping players with empty hands.</p><div class="rules-group">'+
      ruleSwitch('extraAfterSweep','Extra turn after opponent sweep')+'</div>';
    const scoreContent='<div class="rules-group">'+ruleSelect('scoreMode','Scoring system',[['cassino','Classic Cassino'],['spade','Spade Cassino'],['wippen','Wippen'],['diloti','Diloti'],['kontsina','Kontsina'],['tablic','Tablić / Tabinet'],['scopa','Scopa'],['northeast','Connecticut / New York'],['swedish','Swedish Kasino'],['overspader','Överspader'],['hurrikan','Hurrikan']])+
      ruleSelect('matchDeals','Match length',[[0,'Target score'],[1,'1 deal'],[2,'2 deals'],[3,'3 deals'],[4,'4 deals'],[6,'6 deals']])+targetSetting()+
      ruleSelect('sweepPoints','Points per sweep',[0,1,10,50])+ruleSwitch('sweepCancel','Cancel opposing sweeps',!draft.sweepPoints)+
      ruleSwitch('ignoreOpeningSweep','No opening sweep points',!draft.sweepPoints)+ruleSwitch('ignoreFinalSweep','No final sweep points',!draft.sweepPoints)+
      ruleSelect('residueOwner','Remaining table cards',[['lastCapture','Last capturer'],['dealer','Dealer']])+'</div>';
    const captureSummary=(draft.directCapture&&draft.additiveCapture?'Match & sum':draft.directCapture?'Direct only':draft.additiveCapture?'Sums only':'No capture of individual table cards')+' · '+(draft.forcedCapture==='optional'?'Optional':draft.forcedCapture==='direct'?'Direct matches required':draft.forcedCapture==='faces'?'Face matches required':'Legal captures required');
    return '<div class="all-rules-heading"><h3>RULES</h3><button type="button" class="rules-reset" data-action="reset-rules">Reset to Classic</button></div><div class="rules-accordions rules-single-page">'+
      rulesAccordion('players','Player Setup',playerSetupSummary(),playerSetupContent())+
      rulesAccordion('deal','Deck & dealing',draft.deckSize+' cards · '+dealLabel()+' · '+draft.initialTableSize+' on table',deckContent)+
      rulesAccordion('values','Card values',draft.customizeCardValues?'Individual card values':faceLabel()+' · Ace '+(ruleValue('aceMode')===1?'1':'1 or '+ruleValue('aceMode')),valuesContent)+
      rulesAccordion('capture','Capturing',captureSummary,captureContent)+
      rulesAccordion('build','Building',buildLabel(),buildContent)+
      rulesAccordion('turn','Turn order',draft.extraAfterSweep?'Extra turn after a sweep':'Alternating turns',turnContent)+
      rulesAccordion('score','Scoring',(draft.matchDeals?draft.matchDeals+' deals':draft.winningScore+' to win')+' · '+draft.sweepPoints+' per sweep',scoreContent)+
      rulesAccordion('lab','Rules laboratory',labResult?labResult.completed+' / '+labResult.tested+' deals completed':'Test your custom rules',renderLab())+
      '</div>';
  }
  function issueArea(message){
    if(/multiplayer gameplay|team arrangement|single team with no opponent|four-player partnerships/i.test(message))return 'players';
    if(/capture method|compulsory direct|cannot make any capture|Rank-only cards/i.test(message))return 'capture';
    if(/build|obligation/i.test(message))return 'build';
    if(/score|sweep/i.test(message))return 'score';
    if(/Italian face|custom card values|numerical card values/i.test(message))return 'values';
    if(/hand|deck|stock|batch|cards for|divided|bid|joker|player/i.test(message))return 'deal';
    return '';
  }
  function rulesFooter(){
    const validation=E.validateRules(effectiveDraftRules());
    const issues=[...validation.errors.map(message=>({message,type:'error'})),...validation.unavailable.map(message=>({message,type:'unavailable'})),...validation.warnings.map(message=>({message,type:'warning'}))];
    const count=validation.errors.length+validation.unavailable.length;
    const status=count?count+' blocking '+(count===1?'issue':'issues'):validation.warnings.length?validation.warnings.length+' '+(validation.warnings.length===1?'warning':'warnings'):'No known conflicts';
    const detail=issues.length&&rulesIssuesOpen?'<div class="rules-issues" id="rules-issues">'+issues.map(({message,type})=>{
      const targetArea=issueArea(message),area=type==='unavailable'&&targetArea!=='players'?'':targetArea;
      return '<div class="rules-issue"><span class="rule-'+(type==='warning'?'warning':'error')+'">'+escapeHtml((type==='unavailable'?'Not available: ':'')+message)+'</span>'+
        (area?'<button type="button" data-action="rules-jump" data-value="'+area+'">Review ›</button>':'')+'</div>';
    }).join('')+(validation.unavailable.length?'<button type="button" class="rules-reset" data-action="reset-rules">Reset to Classic</button>':'')+'</div>':'';
    return '<div class="rules-footer"><div class="rules-status-line '+(count?'status-blocked':issues.length?'status-warning':'status-ready')+'" role="status">'+
      (issues.length?'<button class="rules-status-button" type="button" data-action="rules-issues" aria-expanded="'+rulesIssuesOpen+'"><span aria-hidden="true">'+(count?'!':'⚠')+'</span> '+status+' <span aria-hidden="true">'+(rulesIssuesOpen?'▴':'▾')+'</span></button>':'<span><span aria-hidden="true">✓</span> '+status+'</span>')+
      '<small>Static check</small></div>'+detail+(settingsOrigin==='game'?'<p class="rules-replace-note">Starting a game replaces the current match.</p>':'')+
      '<div class="dialog-actions"><button type="button" data-action="close" class="action-btn">Cancel</button><button type="button" data-action="apply-settings" class="action-btn primary" '+(validation.playable?'':'disabled')+'>Start Game</button></div></div>';
  }
  function renderSettings(){
    if(!draft)draft=E.normalizeRules(game.rules);
    return '<div class="dialog-head rules-header"><div><p class="rules-eyebrow">'+escapeHtml(playerHeader())+'</p><h2>'+(settingsOrigin==='newgame'?'New Game':'Game Setup')+'</h2></div><button type="button" data-action="close" class="icon-close" aria-label="Close">×</button></div>'+
      '<div class="dialog-content variations-content unified-setup rules-content">'+renderPresetPicker()+renderDifficulty()+renderAllRules()+'</div>'+rulesFooter();
  }

  function renderMenu() {
    return `<div class="dialog-head"><div><span class="eyebrow menu-brand"><img src="./icon.svg" alt="" width="26" height="26"> FISHING LAB</span><h2>Game menu</h2><p>Single-player · Hand ${game.round} · ${escapeHtml(game.rules.name)}</p></div><button data-action="close" class="icon-close" aria-label="Close menu">×</button></div>
      <div class="dialog-content menu-list">
        <button data-action="close" class="menu-row"><span>▶</span><b>Continue playing</b></button>
        <button data-action="home" class="menu-row"><span>⌂</span><b>Main menu</b></button>
        <button data-action="settings" class="menu-row"><span>⚙</span><b>Game rules & variants</b></button>
        <button data-action="rules" class="menu-row"><span>?</span><b>How to play</b></button>
        <button data-action="history" class="menu-row"><span>☷</span><b>Move history</b></button>
        <button data-action="toggle-sound" class="menu-row"><span>${prefs.sound ? '♫' : '♪'}</span><b>Sound effects</b><em>${prefs.sound ? 'On' : 'Off'}</em></button>
        <button data-action="toggle-animations" class="menu-row"><span>✦</span><b>Card animations</b><em>${prefs.animations ? 'On' : 'Off'}</em></button>
        <button data-action="toggle-undo" class="menu-row" aria-pressed="${prefs.undo}"><span>↶</span><b>Undo button</b><em>${prefs.undo ? 'On' : 'Off'}</em></button>
        <button data-action="new-match" class="menu-row danger-row"><span>↻</span><b>Start new match</b></button>
      </div><div class="dialog-actions"><button data-action="close" class="action-btn primary">Back to table</button></div>`;
  }
  function renderRules() {
    return `<div class="dialog-head"><div><span class="eyebrow">HOW TO PLAY</span><h2>Cassino, in brief</h2><p>A capture-and-build fishing card game.</p></div><button data-action="close" class="icon-close">×</button></div>
      <div class="dialog-content rules-copy">
      <h3>Your turn</h3><p>Play exactly one card from your hand. <b>Capture</b> selected table cards whose values split into groups equal to your played card, or take a matching build. <b>Trail</b> to place your card on the table without building. <b>Build</b> to combine your played card with table cards for a later capture.</p>
      <h3>Making builds</h3><p>To create a build, keep another card with its announced value in your hand. A <b>single build</b> contains one group summing to that value. A <b>multiple build</b> has two or more such groups. You can add an equal-valued group to any build; you can raise a single build by contributing its increase from your hand. Multiple builds cannot be raised. Builds are indivisible and can only be captured at their announced value.</p>
      <p>In standard Cassino, you cannot trail while owning an active build, or play away its last matching capture card.</p>
      <h3>Scoring</h3><div class="rules-points">${E.scoreCategories(game.rules).filter(([key])=>key!=='total').map(([,label])=>'<span>'+escapeHtml(label)+'</span><b>·</b>').join('')}</div>
      ${game.rules.spadeScoring ? '<p>Spade rules: every captured spade is worth 1, plus 1 extra for J♠.</p>' : ''}
      <h3>After the final deal</h3><p>${game.rules.residueOwner==='dealer'?'The dealer receives':'The player who made the last actual capture receives'} all cards still on the table. The scoring bonuses are calculated and added to the match totals. Tied majorities earn no points.</p>
      <p class="source-note">Rules basis: <a href="https://www.pagat.com/fishing/casino.html" target="_blank" rel="noopener noreferrer">Pagat — Cassino</a>. House rules differ. The app supports two to six seats against CPUs, including pairs and triples. Teams pool captured cards and scores; builds and required reserve cards belong to the individual who made the build.</p>
      </div><div class="dialog-actions"><button data-action="close" class="action-btn primary">Back to game</button></div>`;
  }
  function renderHistory() {
    return `<div class="dialog-head"><div><span class="eyebrow">MATCH JOURNAL</span><h2>Move history</h2><p>Latest actions in this hand.</p></div><button data-action="close" class="icon-close">×</button></div>
      <div class="dialog-content">${game.log.length ? `<ol class="move-log">${game.log.slice().reverse().map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ol>` : '<p>No moves yet.</p>'}</div><div class="dialog-actions"><button data-action="close" class="action-btn primary">Close</button></div>`;
  }
  function renderMultiplayerRound(){
    const r=game.result,p=r.points,scores=r.scores,ended=game.phase==='gameOver';
    const sides=r.sides||E.scoringSides(game);
    const team=game.rules.teamMode!=='freeForAll';
    const label=i=>i===0?(team?'Your team':'You'):sides[i].name;
    const max=Math.max(...p.map(row=>row.total)),leaders=p.flatMap((row,i)=>row.total===max?[i]:[]);
    const lead=leaders.length===1?leaders[0]:null;
    const categoryCell=(row,key,i)=>{
      const v=row[key]??0,leading=p.every((other,j)=>j===i||v>(other[key]??0));
      return '<td class="'+(leading?'round-leading':'')+'">'+(leading?'<strong>'+v+'</strong>':v)+'</td>';
    };
    const title=ended?(r.winner===null?'Match tied':r.winner===0?(team?'Your team wins!':'You win the match!'):label(r.winner)+' wins the match'):'Hand results';
    return '<div class="dialog-head"><div><span class="eyebrow">HAND '+r.finishedRound+' COMPLETE</span><h2>'+escapeHtml(title)+'</h2><p>'+(ended?'Match complete. Play another?':'Scores are added. Continue to the next hand.')+'</p></div><button data-action="close" class="icon-close">×</button></div>'+
      '<div class="dialog-content"><p class="hand-winner-message">'+(lead===null?'Hand tied':escapeHtml(label(lead))+' won this hand')+'</p>'+
      '<div class="multi-results-scores">'+sides.map((side,i)=>'<div style="--side-color:'+gameSeatColor(side.members[0])+'"><small>'+escapeHtml(label(i))+'</small><b>'+scores[i]+'</b><span>+'+p[i].total+' this hand</span>'+
        (team?'<small>'+escapeHtml(side.members.map(j=>game.players[j].name).join(' · '))+'</small>':'')+'</div>').join('')+'</div>'+
      '<div class="multi-score-scroll"><table class="result-table multi-result-table"><thead><tr><th>Category</th>'+sides.map((s,i)=>'<th>'+escapeHtml(label(i))+'</th>').join('')+'</tr></thead><tbody>'+
      (r.categories||E.scoreCategories(game.rules)).map(([key,name])=>'<tr class="'+(key==='total'?'totals-row':'')+'"><td>'+escapeHtml(name)+'</td>'+p.map((row,i)=>categoryCell(row,key,i)).join('')+'</tr>').join('')+
      '<tr><td>Cards captured</td>'+p.map(row=>'<td>'+row.cardCount+'</td>').join('')+'</tr><tr><td>Spades captured</td>'+p.map(row=>'<td>'+row.spadeCount+'</td>').join('')+'</tr></tbody></table></div></div>'+
      '<div class="dialog-actions">'+(prefs.undo?'<button data-action="undo" class="action-btn" '+(!checkpoint?'disabled':'')+'>Undo last turn</button>':'')+
      '<button data-action="'+(ended?'new-match':'next-hand')+'" class="action-btn primary">'+(ended?'New match':'Next hand')+' →</button></div>';
  }
  function renderRound() {
    if (!game.result) return '';
    if(game.players.length>2)return renderMultiplayerRound();
    const p = game.result.points;
    const scores = game.result.scores;
    const winner = game.result.winner;
    const ended = game.phase === 'gameOver';
    const sweepInfo = game.rules.sweepPoints ? `${game.rules.sweepPoints} each${game.rules.sweepCancel?', net':''}` : '0';
    const fallbackHeads = [
      'Most cards (3)',game.rules.spadeScoring?'Spades (1 each)':'Most spades (1)',
      '10♦ · Big Cassino (2)','2♠ · Little Cassino (1)',
      'Aces (1–4)',`Sweeps (${sweepInfo})`,'This hand (total)'
    ];
    const fallbackKeys = ['cards','spades','big','little','aces','sweeps','total'];
    const categories=game.result.categories||fallbackKeys.map((key,i)=>[key,fallbackHeads[i]]);
    const keys=categories.map(row=>row[0]),heads=categories.map(row=>row[1]);
    const lead = p[0].total===p[1].total ? -1 : (p[0].total>p[1].total?0:1);
    const scoreCell=(key,player)=>{
      const value=p[player][key],other=p[1-player][key];
      return `<td class="${value>other?'round-leading':''}">${value>other?`<strong>${value}</strong>`:value}</td>`;
    };
    return `<div class="dialog-head"><div><span class="eyebrow">HAND ${game.result.finishedRound} COMPLETE</span><h2>${ended ? (winner === null ? 'Match tied' : winner === 0 ? 'You win the match!' : 'Computer wins the match') : 'Hand results'}</h2><p>${ended ? 'Match complete. Play another?' : 'Scores are added. Continue to the next hand.'}</p></div><button data-action="close" class="icon-close">×</button></div>
      <div class="dialog-content"><p class="hand-winner-message">${lead<0?'Hand tied':lead===0?'You won this hand':'Computer won this hand'}</p>
      <div class="results-scores"><div class="${lead===0?'round-winner':''}"><small>YOU</small><b>${scores[0]}</b><span>+${p[0].total} this hand</span></div><div class="result-vs">VS</div><div class="${lead===1?'round-winner':''}"><small>COMPUTER</small><b>${scores[1]}</b><span>+${p[1].total} this hand</span></div></div>
      <table class="result-table"><thead><tr><th>Category</th><th>You</th><th>Computer</th></tr></thead><tbody>${heads.map((name,i) => `<tr class="${i === heads.length-1 ? 'totals-row' : ''}"><td>${name}</td>${scoreCell(keys[i],0)}${scoreCell(keys[i],1)}</tr>`).join('')}</tbody></table>
      <p class="smallnote">Cards captured: ${p[0].cardCount}–${p[1].cardCount}. Spades captured: ${p[0].spadeCount}–${p[1].spadeCount}.</p></div>
      <div class="dialog-actions">${prefs.undo?`<button data-action="undo" class="action-btn" ${!checkpoint ? 'disabled' : ''}>Undo last turn</button>`:''}<button data-action="${ended ? 'new-match' : 'next-hand'}" class="action-btn primary">${ended ? 'New match' : 'Next hand'} →</button></div>`;
  }
  function renderExitConfirm() {
    return `<div class="dialog-head"><div><h2>Exit game?</h2><p>Are you sure you want to exit this game?</p></div></div>
      <div class="dialog-content"><p class="exit-confirm-copy">Your match will be saved. You can resume it from the main menu.</p></div>
      <div class="dialog-actions"><button data-action="cancel-exit" class="action-btn">Keep playing</button>
        <button data-action="confirm-exit" class="action-btn primary">Exit to menu</button></div>`;
  }
  function renderDialogBody() {
    return modal === 'exit-confirm' ? renderExitConfirm() : modal === 'menu' ? renderMenu() : modal === 'settings' ? renderSettings() : modal === 'rules' ? renderRules() : modal === 'history' ? renderHistory() : renderRound();
  }
  function renderModal() {
    const body=renderDialogBody();
    return `<div class="overlay" role="presentation"><section class="dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(modal)}">${body}</section></div>`;
  }
  function showExitConfirm() {
    exitReturnModal = modal === 'menu' ? 'menu' : '';
    modal = 'exit-confirm';
    const panel = app.querySelector('.overlay .dialog');
    if (panel) {
      panel.setAttribute('aria-label','exit-confirm');
      panel.innerHTML = renderExitConfirm();
    } else {
      app.insertAdjacentHTML('beforeend', renderModal());
    }
  }
  function cancelExit() {
    modal = exitReturnModal;
    exitReturnModal = '';
    const overlay = app.querySelector('.overlay');
    if (modal === 'menu') {
      const panel = overlay?.querySelector('.dialog');
      if (panel) {
        panel.setAttribute('aria-label','menu');
        panel.innerHTML = renderMenu();
        return;
      }
    }
    if (overlay) overlay.remove();
    else render();
  }
  function exitGameToMenu() {
    cancelMotion();
    if (pendingBot !== null) { clearTimeout(pendingBot); pendingBot = null; }
    busy = false; dealing = false;
    modal = ''; screen = 'home'; exitReturnModal = ''; toast = '';
    persist(); resetSelection(); sound('tap'); render();
    applyPendingUpdate();
  }
  function resetSelection() { pickedCard = null; pickedTable.clear(); hintIterator = null; }
  let activeBotSearch=null;
  let preparedBotTurn=null;
  function cancelComputerSearch(){
    preparedBotTurn=null;
    activeBotSearch?.cancel();
  }
  function requestAdvancedMove(state){
    const view=E.publicPosition(state);
    const fallback=E.quickLegalMove(state);
    const advanced=view.rules.difficulty==='hard'||view.rules.difficulty==='expert';
    const localMove=()=>{
      if(advanced)return fallback;
      // Preserve the existing Easy/Medium policy if a browser disallows
      // workers. Normal supported browsers do not run this on the UI thread.
      try{return E.chooseComputerMove(state);}catch(_){return fallback;}
    };
    const source=document.scripts?.[0]?.textContent;
    if(!source||typeof Worker!=='function'||typeof Blob!=='function'||!URL.createObjectURL)
      return Promise.resolve(localMove());
    return new Promise(resolve=>{
      let worker=null,url=null,timer=null,done=false,best=fallback;
      function finish(move){
        if(done)return;
        done=true;
        if(timer!==null)clearTimeout(timer);
        worker?.terminate();
        if(url)URL.revokeObjectURL(url);
        if(activeBotSearch===search)activeBotSearch=null;
        resolve(move);
      }
      const search={cancel:()=>finish(null),take:()=>finish(best)};
      activeBotSearch=search;
      try {
        // Easy/Medium use their existing scoring policy on a sampled world;
        // only the public position is sent. Advanced search streams each
        // completed iteration before its final answer.
        const workerCode="\nself.onmessage=event=>{try{const E=self.CassinoEngine,view=event.data;const advanced=view.rules.difficulty==='hard'||view.rules.difficulty==='expert';const move=advanced?E.analyzeComputerMove(view,{onProgress:move=>self.postMessage({move,progress:true})}).move:E.chooseComputerMove(E.samplePublicPosition(view));self.postMessage({move});}catch(error){self.postMessage({error:String(error)});}};";
        url=URL.createObjectURL(new Blob([source,workerCode],{type:'text/javascript'}));
        worker=new Worker(url);
        worker.onmessage=event=>{
          if(done)return;
          const move=event.data?.move;
          if(move&&E.validateAction(state,move).ok)best=move;
          if(event.data?.progress===true)return;
          finish(move||advanced?best:localMove());
        };
        worker.onerror=()=>{if(!done)finish(advanced?best:localMove());};
        timer=setTimeout(()=>finish(best),view.rules.difficulty==='expert'?2700:1800);
        worker.postMessage(view);
      }catch(_){finish(localMove());}
    });
  }
  // Start as soon as a committed position is known. A generation and move
  // number bind the result to exactly one turn, even across Undo or dealing.
  function prepareComputerTurn(){
    if(screen!=='game'||game.phase!=='playing'||game.turn===0)return null;
    if(preparedBotTurn?.state===game&&preparedBotTurn.generation===motionGeneration&&
       preparedBotTurn.moveNumber===game.moveNumber&&preparedBotTurn.actor===game.turn)return preparedBotTurn;
    cancelComputerSearch();
    const prepared={state:game,generation:motionGeneration,moveNumber:game.moveNumber,actor:game.turn,promise:null,error:null};
    try{prepared.promise=requestAdvancedMove(game);}
    catch(error){prepared.error=error;prepared.promise=Promise.resolve(null);}
    preparedBotTurn=prepared;
    return prepared;
  }
  function botTurn() {
    if (screen !== 'game' || busy || game.phase !== 'playing' || game.turn === 0) return;
    busy = true;
    render();
    const startedGame=game,generation=motionGeneration,actor=game.turn,startedMove=game.moveNumber;
    const stillCurrent=()=>screen==='game'&&busy&&game===startedGame&&generation===motionGeneration&&game.phase==='playing'&&game.turn===actor&&game.moveNumber===startedMove;
    const fail=error=>{
      if(!stillCurrent())return;
      busy=false;turnInMotion=false;toast=`Computer move error: ${error.message}`;render();
    };
    const prepared=prepareComputerTurn();
    const commitMove=move=>{
      if(!stillCurrent()||!move)return;
      try{
        const stockBefore = game.stock.length;
        const preHuman=game.players[0].hand.map(c=>c.id),preCpu=game.players[1].hand.map(c=>c.id);
    const preSeats=game.players.map(p=>p.hand.map(c=>c.id));
        const before = takeMotionSnapshot(move, true);
        rememberStockOrigin();
        const outcome = E.applyAction(game, move);
        if (!outcome.ok) throw new Error(outcome.reason);
        turnInMotion = true;
        if (before) { before.finalHand = game.phase !== 'playing'; before.residueOwner=game.rules.residueOwner==='dealer'?game.dealer:game.lastCapture; }
        const cardsDealt = stockBefore - game.stock.length;
        if(cardsDealt>0) collectDeal(preHuman,preCpu,game.table.filter(e=>e.type==='loose').map(e=>e.card.id),preSeats);
        lastMotion = move.kind;
        sound(game.phase !== 'playing' ? 'score' : move.kind);
        persist(); render();
        playMotion(before, () => completeTurn(cardsDealt));
        if(game.players.length>2)prepareComputerTurn();
      }catch(error){if(game===startedGame&&generation===motionGeneration){busy=false;turnInMotion=false;toast='Computer move error: '+error.message;render();}}
    };
    // Only the presentation pause starts after the player's animation.
    // Analysis was already running. At 600 ms, take the final result or the
    // latest completed search iteration; never wait for a deeper search.
    pendingBot=setTimeout(()=>{
      pendingBot=null;
      if(!stillCurrent()||preparedBotTurn!==prepared)return;
      activeBotSearch?.take();
      preparedBotTurn=null;
      if(!prepared||prepared.error){fail(prepared?.error||new Error('No prepared computer turn.'));return;}
      prepared.promise.then(commitMove,fail);
    },600);
  }
  function play(action) {
    if (!isHumanTurn()) return;
    const check = E.validateAction(game, action);
    if (!check.ok) { toast = check.reason; render(); return; }
    const before = takeMotionSnapshot(action, false);
    rememberStockOrigin();
    const stockBefore = game.stock.length;
    const preHuman=game.players[0].hand.map(c=>c.id),preCpu=game.players[1].hand.map(c=>c.id);
    const preSeats=game.players.map(p=>p.hand.map(c=>c.id));
    checkpoint = JSON.stringify(game);
    const result = E.applyAction(game, action);
    if (!result.ok) { toast = result.reason; return render(); }
    turnInMotion = true;
    if (before) { before.finalHand = game.phase !== 'playing'; before.residueOwner=game.rules.residueOwner==='dealer'?game.dealer:game.lastCapture; }
    const cardsDealt = stockBefore - game.stock.length;
    if(cardsDealt>0)collectDeal(preHuman,preCpu,game.table.filter(e=>e.type==='loose').map(e=>e.card.id),preSeats);
    lastMotion = action.kind;
    sound(game.phase !== 'playing' ? 'score' : (action.kind === 'capture' && result.description.includes('sweep') ? 'sweep' : action.kind));
    toast = '';
    resetSelection();
    busy = true;
    persist(); render();
    playMotion(before, () => completeTurn(cardsDealt));
    // The state (including any replacement draw) is committed. Let the
    // worker calculate while the visual confirmation is still in flight.
    prepareComputerTurn();
  }
  // One shared deal/round-end/next-turn path for human and computer.
  function completeTurn(cardsDealt) {
    if (screen !== 'game') return;
    const generation = motionGeneration;
    const finish = () => {
      if (screen !== 'game' || generation !== motionGeneration) return;
      dealing = false; busy = false; turnInMotion = false;
      if (game.phase !== 'playing') modal = 'round';
      persist();
      // Restore the active hand only at the real start of the next turn.
      if (game.turn !== 0 && game.phase === 'playing') botTurn();
      else render();
    };
    if (cardsDealt > 0) {
      lastMotion = 'deal-hands'; dealing = true; busy = true;
      sound('deal', cardsDealt); persist(); render();
      Promise.resolve(dealAnimation).then(finish);
    } else finish();
  }
  function undo() {
    if (!prefs.undo || !checkpoint || screen !== 'game') return;
    pendingDeal = null; pendingStockOrigin = null;
    cancelMotion();
    if (pendingBot !== null) { clearTimeout(pendingBot); pendingBot = null; }
    busy = false;
    game = JSON.parse(checkpoint);
    game.rules=E.normalizeRules(game.rules);
    checkpoint = null;
    modal = '';
    toast = '';
    dealing = false;
    sound('undo');
    resetSelection(); persist(); render();
  }
  function nextHand() {
    cancelMotion();
    const next = E.nextHand(game);
    if (!next) return;
    game = next; checkpoint = null; resetSelection(); toast = ''; modal = ''; lastMotion = 'deal';
    collectDeal(); pendingStockOrigin=null;
    dealing = busy = !!(motionAllowed() && app.querySelectorAll);
    sound('deal',12); persist(); render();
    prepareComputerTurn();
    const generation=motionGeneration;
    Promise.resolve(dealAnimation).then(() => {
      if(screen!=='game'||generation!==motionGeneration)return;
      dealing=false;busy=false;turnInMotion=false;persist();
      if(game.turn!==0)botTurn();else render();
    });
  }
  function startNewMatch(rules = game.rules, ask = true) {
    if (ask && game.phase === 'playing' && !confirm('Start a new match? Your current match will be replaced.')) return;
    if (pendingBot !== null) { clearTimeout(pendingBot); pendingBot = null; }
    cancelMotion();
    busy = false; game = E.newMatch(rules); checkpoint = null; modal = ''; toast = ''; lastMotion = 'deal';
    collectDeal(); pendingStockOrigin=null;
    screen = 'game'; resetSelection(); draft = null;
    dealing = busy = !!(motionAllowed() && app.querySelectorAll);
    sound('deal',12); persist(); render();
    prepareComputerTurn();
    const generation=motionGeneration;
    Promise.resolve(dealAnimation).then(() => {
      if(screen!=='game'||generation!==motionGeneration)return;
      dealing=false;busy=false;turnInMotion=false;persist();
      if(game.turn!==0)botTurn();else render();
    });
  }
  // All setup entry points share a single draft and scrollable dialog.
  function openSettings(origin = screen) {
    variationsScrollTop = 0; detailSetting = ''; settingsOrigin = origin; rulesSection=''; rulesIssuesOpen=false; labResult=null; difficultyInfoOpen=false; valueCardKey='S1';valuePickerOpen=false;deckChecklistScroll=0;
    savedVariantSource=null;clearVariantEditor();
    const difficulty = game.rules.difficulty || 'thoughtful';
    if (origin === 'newgame') {
      draftPreset = 'classic';
      draft = E.rulesFor('classic', {difficulty});
      customDraft = customRules ? {...customRules} : null;
    } else {
      draft = E.normalizeRules(game.rules);
      const saved=savedVariant(draft.savedVariantId);
      if(saved&&variantRulesMatch(saved.rules,draft)){
        draft=copySavedRules(saved);draft.difficulty=difficulty;draftPreset=saved.id;savedVariantSource=saved.id;
      }else{
      draftPreset = draft.savedVariantId?'custom':Object.keys(E.PRESETS).sort((x,y)=>Number(E.PRESETS[y].name===draft.name)-Number(E.PRESETS[x].name===draft.name)).find(key => {
        const preset=E.activeRules(E.rulesFor(key)),current=E.activeRules(draft);
        return Object.keys(E.DEFAULT_RULES).every(prop =>
          prop === 'name' || prop === 'difficulty' || JSON.stringify(preset[prop]) === JSON.stringify(current[prop]));
      }) || 'custom';
      if(draftPreset==='custom'){savedVariantSource=saved?.id||null;delete draft.savedVariantId;}
      }
      customDraft = draftPreset === 'custom' ? {...draft} : customRules ? {...customRules} : null;
    }
    modal = 'settings'; render('overlay');
  }
  function selectVariation(key) {
    const saved=savedVariant(key);
    if (!Object.hasOwn(E.PRESETS,key) && key !== 'custom'&&!saved) return;
    if (key === draftPreset) return;
    savedVariantSource=saved?.id||null;clearVariantEditor();
    labResult=null; rulesIssuesOpen=false;valuePickerOpen=false;deckChecklistScroll=0;
    const difficulty = draft.difficulty;
    if (draftPreset === 'custom') customDraft = {...draft};
    if (key === 'custom') {
      // Restore custom edits, or inherit the previewed preset on first use.
      draft = {...(customDraft || (draft.presetBlocker?E.rulesFor('classic'):draft)),name:'Custom Fishing',difficulty,presetBlocker:''};delete draft.savedVariantId;
    } else if(saved) {
      draft=copySavedRules(saved);
    } else {
      draft = E.rulesFor(key,{difficulty});
    }
    draft=E.normalizeRules(draft);if(!E.teamModesFor(draft.playerCount).includes(draft.teamMode))draft.teamMode='freeForAll';fitBuildBounds();draftPreset = key;
    render('overlay');
  }
  function commitDraftEdit(){
    draft=E.normalizeRules(draft);fitBuildBounds();
    markCustomDraft();
    labResult=null;render('overlay');
  }
  function fitHandSize(){
    draft=E.normalizeRules(draft);
    draft.handSize=Math.max(1,Math.min(draft.handSize,handMaximum()||1));
  }
  function updateDeckCards(ids){
    if(!draft||draft.presetBlocker||draft.deckMode!=='custom')return;
    const wanted=new Set(ids);draft.deckCards=E.allCards().filter(c=>wanted.has(c.id)).map(c=>c.id);
    fitHandSize();commitDraftEdit();
  }
  function updateOneDeckCard(id,checked){
    if(!E.allCards().some(c=>c.id===id)||draft.deckMode!=='custom')return;
    const ids=new Set(E.makeDeck(draft).map(c=>c.id));
    if(checked)ids.add(id);else ids.delete(id);
    updateDeckCards([...ids]);
  }
  function updateCardValue(which,value){
    if(!draft||draft.presetBlocker||!draft.customizeCardValues)return;
    const card=currentValueCard();if(!card)return;
    const key=E.cardKey(card),old=E.cardValues(card,draft);
    let vals;
    if(which==='primaryValue'){
      if(value==='rank')vals=[];
      else{const n=Number(value);if(!Number.isInteger(n)||n<1||n>30)return;vals=[n,...old.slice(1).filter(v=>v!==n)];}
    }else{
      if(!old.length)return;
      if(value==='none')vals=[old[0]];
      else{const n=Number(value);if(!Number.isInteger(n)||n<1||n>30||n===old[0])return;vals=[old[0],n];}
    }
    draft.cardValueOverrides={...(draft.cardValueOverrides||E.initialCardValues(draft)),[key]:vals};
    commitDraftEdit();
  }
  function cycleTeamMode(){
    if(!draft||draft.presetBlocker)return;
    const modes=E.teamModesFor(draft.playerCount);
    if(modes.length<2)return;
    updateDraftSetting('teamMode',modes[(modes.indexOf(draft.teamMode)+1)%modes.length]);
  }
  function updateDraftSetting(prop,value){
    if(!draft||draft.presetBlocker)return;
    if(prop==='playerCount'){
      if(![2,3,4,5,6].includes(value)||draft.playerCount===value)return;
      draft.playerCount=value;
      if(!E.teamModesFor(value).includes(draft.teamMode))draft.teamMode='freeForAll';
      if(draft.dealMode!=='draw'&&(E.makeDeck(draft).length-draft.initialTableSize)%value!==0)draft.remainderMode='uneven';
      rulesIssuesOpen=false;fitHandSize();commitDraftEdit();return;
    }
    if(prop==='teamMode'){
      if(!E.teamModesFor(draft.playerCount).includes(value)||draft.teamMode===value)return;
      draft.teamMode=value;rulesIssuesOpen=false;commitDraftEdit();return;
    }
    if(prop==='deckMode'){
      if(!['40','52','54','custom'].includes(value)||draft.deckMode===value)return;
      if(value==='custom'&&!Array.isArray(draft.deckCards))draft.deckCards=E.makeDeck(draft).map(c=>c.id);
      draft.deckMode=value;fitHandSize();valuePickerOpen=false;commitDraftEdit();return;
    }
    if(prop==='deckSize'){
      // Legacy compatibility for programmatic callers of the old editor.
      return updateDraftSetting('deckMode',String(value));
    }
    if(prop==='customizeCardValues'){
      if(!!draft.customizeCardValues===!!value)return;
      if(value&&!draft.cardValueOverrides)draft.cardValueOverrides=E.initialCardValues(draft);
      draft.customizeCardValues=!!value;valuePickerOpen=false;commitDraftEdit();return;
    }
    if(E.ruleActivity(draft).disabled[prop])return;
    if(prop==='forcedCapture'&&!E.ruleActivity(draft).forcedOptions.includes(value))return;
    if(prop==='handSize'&&(!Number.isInteger(value)||value<1||value>handMaximum()))return;
    if(prop==='buildRange'&&!['all','9-13','10-13','custom'].includes(value))return;
    if(['buildMin','buildMax'].includes(prop)&&(!draft.builds||draft.buildRange!=='custom'||!buildBoundChoices(prop).includes(value)))return;
    if(String(ruleValue(prop))===String(value)&&!(prop==='forcedCapture'&&draft.forcedCapture!==value))return;
    if(prop==='faceMode'){
      if(!['classic','royal','extended','italian'].includes(value))return;
      draft.royal=value!=='classic';
      draft.faceValues=value==='classic'||value==='royal'?'standard':value;
    }else if(prop==='scoreMode'){
      if(!['cassino','spade','wippen','diloti','kontsina','tablic','scopa','northeast','swedish','overspader','hurrikan'].includes(value))return;
      draft.scoreProfile=value==='spade'?'cassino':value;draft.spadeScoring=value==='spade';
    }else if(prop==='aceMode'){
      if(![1,11,14].includes(value))return;
      draft.royalAces=false;draft.aceValue=value;
    }else if(prop==='independentBuilds'){
      if(!['1','2','unlimited'].includes(value))return;
      draft.pirateBuilds=value!=='1';draft.buildLimit=value;
    }else{
      if(prop==='buildObligation'){prop='buildAnything';value=!value;}
      if(!Object.hasOwn(E.DEFAULT_RULES,prop)||prop==='name'||prop==='difficulty'||draft[prop]===value)return;
      draft[prop]=value;
      if(prop==='dealMode'){
        draft.drawMode=value==='draw';
        if(value!=='batch'&&draft.remainderMode==='strict')draft.remainderMode='equal';
      }
      if(prop==='drawMode')draft.dealMode=value?'draw':'batch';
      if(prop==='faceValues'&&value==='extended')draft.royal=true;
    }
    // A parent switch temporarily deactivates its dependents, without deleting
    // the user's preferences. effectiveDraftRules is the only export path.
    commitDraftEdit();
  }
  function normalizedHandSize(text,previous,maximum){
    const value=String(text??'').trim();
    if(!value||!Number.isFinite(Number(value)))return previous;
    return Math.max(1,Math.min(Math.max(1,maximum),Math.round(Number(value))));
  }
  function syncHandSizeControls(value,fromText=false){
    const out=app.querySelector('#hand-size-output'),range=app.querySelector('#rule-handSize');
    if(out&&!fromText)out.value=String(value);
    if(range&&fromText)range.value=String(value);
    for(const tick of app.querySelectorAll('[data-hand-tick]'))tick.classList.toggle('active',Number(tick.dataset.handTick)===value);
  }
  function applyTypedHandSize(value){
    if(!draft||draft.presetBlocker||draft.dealMode==='full'||handMaximum()<1||!Number.isInteger(value)||value<1||value>handMaximum()||draft.handSize===value)return false;
    draft.handSize=value;refreshNumericRuleEdit();return true;
  }
  function refreshNumericRuleEdit(){
    markCustomDraft();labResult=null;
    // Updating just the affected elements keeps the numeric field focused
    // and avoids replacing a tapped Start button during a blur event.
    const picker=app.querySelector('#variation-picker');
    if(picker)picker.value='custom';
    const desc=app.querySelector('.preset-description');if(desc)desc.textContent='Your own combination of fishing-game mechanics.';
    const summary=app.querySelector('#rules-area-deal .rules-page-heading small');
    if(summary)summary.textContent=draft.deckSize+' cards · '+dealLabel()+' · '+draft.initialTableSize+' on table';
    const buildSummary=app.querySelector('#rules-area-build .rules-page-heading small');if(buildSummary)buildSummary.textContent=buildLabel();
    const status=app.querySelector('.rules-footer');
    if(status){
      // Keep the Start and Cancel buttons mounted. Replace just the status
      // portion and recompute the Start disabled flag synchronously.
      const template=document.createElement('template');template.innerHTML=rulesFooter();
      const next=template.content.firstElementChild;
      if(next){
        for(const cls of ['.rules-status-line','.rules-issues']){
          const before=status.querySelector(cls),after=next.querySelector(cls);
          if(before&&after)before.replaceWith(after);
          else if(before)before.remove();
          else if(after)status.querySelector('.rules-status-line')?.after(after);
        }
        const start=status.querySelector('[data-action="apply-settings"]'),newStart=next.querySelector('[data-action="apply-settings"]');
        if(start&&newStart)start.disabled=newStart.disabled;
      }
    }
    const lab=app.querySelector('#rules-area-lab');if(lab)lab.innerHTML=renderLab();
    const labSummary=app.querySelector('[data-action="rules-section"][data-value="lab"] small');if(labSummary)labSummary.textContent='Test your custom rules';
    return true;
  }
  function finishHandSizeText(target){
    if(!draft||draft.dealMode==='full'||handMaximum()<1)return;
    const value=normalizedHandSize(target.value,draft.handSize,handMaximum());
    applyTypedHandSize(value);syncHandSizeControls(value);target.value=String(value);
  }
  function syncBuildBounds(exceptInput){
    for(const key of ['buildMin','buildMax']){
      const choices=buildBoundChoices(key),input=app.querySelector('#range-'+key);
      const select=app.querySelector('[data-setting="buildBoundChoice"][data-bound="'+key+'"]');
      if(input){input.min=String(choices[0]??1);input.max=String(choices[choices.length-1]??30);if(input!==exceptInput)input.value=String(draft[key]??'');}
      if(select){select.innerHTML=choices.map(v=>'<option value="'+v+'" '+(v===draft[key]?'selected':'')+'>'+v+'</option>').join('');}
    }
  }
  function applyBuildBound(key,value,exceptInput){
    if(!draft||draft.presetBlocker||E.ruleActivity(draft).disabled.buildRange||draft.buildRange!=='custom'||!['buildMin','buildMax'].includes(key)||!buildBoundChoices(key).includes(value))return false;
    if(draft[key]!==value){draft[key]=value;refreshNumericRuleEdit();}
    syncBuildBounds(exceptInput);return true;
  }
  function finishBuildBound(target){
    const key=target.dataset.bound;
    if(!['buildMin','buildMax'].includes(key))return;
    const choices=buildBoundChoices(key),raw=target.value.trim();
    const value=raw?nearestBuildValue(choices,raw):draft[key];
    if(value!=null&&applyBuildBound(key,value))target.value=String(value);
  }
  app.addEventListener('change', ev => {
    const target = ev.target;
    if (!(target instanceof HTMLElement) || !target.dataset.setting || target.disabled || modal !== 'settings') return;
    const prop = target.dataset.setting;
    if(prop==='preset')return selectVariation(target.value);
    if(prop==='variantName'){variantNameText=target.value;return;}
    if(prop==='handSizeText')return finishHandSizeText(target);
    if(prop==='buildBoundText')return finishBuildBound(target);
    if(prop==='buildBoundChoice')return applyBuildBound(target.dataset.bound,Number(target.value));
    if(prop==='deckCard')return updateOneDeckCard(target.dataset.cardId,target.checked);
    if(prop==='primaryValue'||prop==='secondaryValue')return updateCardValue(prop,target.value);
    updateDraftSetting(prop,target.type === 'checkbox' ? target.checked :
      ['winningScore','sweepPoints','deckSize','handSize','initialTableSize','aceValue','aceMode','matchDeals','jokerCount','jokerValue','playerCount'].includes(prop)&&target.value!=='4team' ? Number(target.value) : target.value);
  });
  app.addEventListener('input',ev=>{
    const target=ev.target;
    if(modal!=='settings'||target?.disabled)return;
    if(target?.dataset?.setting==='variantName'){variantNameText=target.value;return;}
    if(target?.dataset?.setting==='playerCount'){
      // Preview every slider step without replacing the active range input.
      // The change event commits the configuration and revalidates dealing.
      const n=Number(target.value);
      if(![2,3,4,5,6].includes(n)||draft.presetBlocker)return;
      const allowed=E.teamModesFor(n),mode=allowed.includes(draft.teamMode)?draft.teamMode:'freeForAll';
      const preview={...draft,playerCount:n,teamMode:mode};
      const output=app.querySelector('#player-count-output');if(output)output.textContent=String(n);
      for(const tick of app.querySelectorAll('[data-player-tick]'))tick.classList.toggle('active',Number(tick.dataset.playerTick)===n);
      const control=app.querySelector('#rule-teamMode');
      if(control)control.outerHTML=teamCycleControl(preview);
      if(detailSetting==='teamMode'){
        const help=app.querySelector('.team-mode-setting .rule-option-help');
        if(help)help.outerHTML=ruleExplanation('teamMode',playerTeamOptions(n),preview);
      }
      const diagram=app.querySelector('#player-seating-preview');if(diagram)diagram.innerHTML=seatingDiagram(preview);
      const summary=app.querySelector('#rules-area-players .rules-page-heading small');if(summary)summary.textContent=playerSetupSummary(preview);
      const eyebrow=app.querySelector('.rules-header .rules-eyebrow');if(eyebrow)eyebrow.textContent=playerHeader(preview);
      return;
    }
    if(target?.dataset?.setting==='handSize'){
      syncHandSizeControls(Number(target.value));return;
    }
    if(target?.dataset?.setting==='buildBoundText'){
      if(target.value!=='')applyBuildBound(target.dataset.bound,Number(target.value),target);return;
    }
    if(target?.dataset?.setting==='handSizeText'){
      const value=Number(target.value);
      if(target.value!==''&&Number.isInteger(value)&&value>=1&&value<=handMaximum()){
        applyTypedHandSize(value);syncHandSizeControls(value,true);
      }
    }
  });
  app.addEventListener('keydown',ev=>{
    const target=ev.target;
    if(modal==='settings'&&ev.key==='Enter'){
      if(target?.dataset?.setting==='variantName'){ev.preventDefault();variantNameText=target.value;completeVariantEditor();}
      else if(target?.dataset?.setting==='handSizeText'){ev.preventDefault();finishHandSizeText(target);target.blur();}
      else if(target?.dataset?.setting==='buildBoundText'){ev.preventDefault();finishBuildBound(target);target.blur();}
    }
  });
  app.addEventListener('click', event => {
    const node = event.target.closest('[data-action]');
    if (!node) return;
    const action = node.dataset.action;
    if (action === 'home') {
      if (screen === 'game') { showExitConfirm(); return; }
      exitGameToMenu(); return;
    }
    if (action === 'cancel-exit') { cancelExit(); return; }
    if (action === 'confirm-exit') { exitGameToMenu(); return; }
    if (action === 'resume-game') { screen='game'; modal=''; sound('tap'); if(game.turn!==0 && game.phase==='playing') botTurn(); else {if(game.phase!=='playing')modal='round';render();} return; }
    if (action === 'setup-new-game') { sound('tap'); return openSettings('newgame'); }
    if(modal==='settings'&&action==='save-variant-as')return beginVariantEditor('new');
    if(modal==='settings'&&action==='update-saved-variant')return beginVariantEditor('update');
    if(modal==='settings'&&action==='cancel-variant-save'){clearVariantEditor();render('overlay');return;}
    if(modal==='settings'&&action==='confirm-variant-save'){
      const field=app.querySelector('#variant-name');if(field)variantNameText=field.value;
      return completeVariantEditor();
    }
    if(modal==='settings'&&action==='delete-saved-variant'){
      const entry=savedVariant(savedVariantSource);
      if(!entry||!confirm('Delete saved variant "'+entry.name+'"? Your current game and rules will not be deleted.'))return;
      const result=removeNamedVariant(entry.id);
      if(!result.ok){variantMessage=result.reason;variantMessageError=true;}
      render('overlay');return;
    }
    if(action==='cycle-team-mode'&&modal==='settings'){
      if(node.disabled)return;
      cycleTeamMode();
      if(event.detail===0)app.querySelector('#rule-teamMode')?.focus({preventScroll:true});
      return;
    }
    if (action === 'info-setting' && modal === 'settings') { detailSetting=detailSetting===node.dataset.key?'':node.dataset.key; render('overlay'); return; }
    if(action==='difficulty-info'&&modal==='settings'){difficultyInfoOpen=!difficultyInfoOpen;render('overlay');return;}
    if(modal==='settings'&&(action==='deck-all'||action==='deck-none'))return updateDeckCards(action==='deck-all'?E.allCards().map(c=>c.id):[]);
    if(modal==='settings'&&action==='toggle-value-picker'){if(draft.customizeCardValues&&E.makeDeck(draft).length){valuePickerOpen=!valuePickerOpen;render('overlay');}return;}
    if(modal==='settings'&&action==='value-card'){if(draft.customizeCardValues&&E.makeDeck(draft).some(c=>E.cardKey(c)===node.dataset.value)){valueCardKey=node.dataset.value;valuePickerOpen=false;render('overlay');}return;}
    if(action==='use-partial-preset'&&modal==='settings'){
      const p=E.PRESET_CATALOG.find(x=>x.id===draftPreset);
      if(!p?.partial||!draft.presetBlocker)return;
      draft=E.normalizeRules({...draft,presetBlocker:'',name:'Custom Fishing'});
      savedVariantSource=null;clearVariantEditor();markCustomDraft();labResult=null;rulesIssuesOpen=false;render('overlay');return;
    }
    if (action === 'rules-section' && modal === 'settings'){
      rulesSection=rulesSection==='lab'?'':'lab';render('overlay');return;
    }
    if(action==='rules-issues'&&modal==='settings'){rulesIssuesOpen=!rulesIssuesOpen;render('overlay');return;}
    if(action==='rules-jump'&&modal==='settings'){
      rulesSection='';rulesIssuesOpen=false;detailSetting='';
      render('overlay');const area=app.querySelector('.variations-content');
      const header=area?.querySelector('#rules-area-'+node.dataset.value);
      if(area&&header)area.scrollTop+=header.getBoundingClientRect().top-area.getBoundingClientRect().top;
      return;
    }
    if(action==='reset-rules'&&modal==='settings'){
      if(draftPreset==='custom')customDraft={...draft};
      savedVariantSource=null;clearVariantEditor();
      draft=E.rulesFor('classic',{difficulty:draft.difficulty});draftPreset='classic';rulesIssuesOpen=false;labResult=null;detailSetting='';valuePickerOpen=false;valueCardKey='S1';deckChecklistScroll=0;render('overlay');return;
    }
    if (action === 'run-rules-lab' && modal === 'settings'){
      if(!E.validateRules(effectiveDraftRules()).playable)return;
      const snapshot=JSON.stringify(draft);node.disabled=true;node.textContent='Testing…';
      setTimeout(()=>{if(modal!=='settings'||JSON.stringify(draft)!==snapshot)return;labResult=E.simulateRules(effectiveDraftRules(),10,1);render('overlay');},0);return;
    }
    if (action === 'copy-lab-report' && modal === 'settings' && labResult){
      const report=JSON.stringify(labResult,null,2);
      if(navigator.clipboard?.writeText)navigator.clipboard.writeText(report).catch(()=>window.prompt('Copy report',report));
      else window.prompt('Copy report',report);return;
    }
    if (action === 'setup-difficulty' && modal === 'settings') { draft.difficulty=node.dataset.value; render('overlay'); return; }
    if (action === 'menu') { modal = 'menu'; sound('tap'); render('overlay'); return; }
    if (action === 'settings') return openSettings(screen);
    if (action === 'rules' || action === 'history') { modal = action; render('overlay'); return; }
    if (action === 'toggle-sound') { prefs.sound = !prefs.sound; savePrefs(); if (prefs.sound) sound('tap'); render('overlay'); return; }
    if (action === 'toggle-animations') { prefs.animations = !prefs.animations; savePrefs(); render('overlay'); return; }
    if (action === 'toggle-hand-sort') {
      // Do not move a live flight/deal destination. The selected card and
      // table selection are identified by ID and survive a presentation sort.
      if(modal||!isHumanTurn()||node.disabled)return;
      prefs.handSort=handSortMode()==='suit'?'value':'suit';
      savePrefs();
      render();
      if(event.detail===0)app.querySelector('[data-action="toggle-hand-sort"]')?.focus({preventScroll:true});
      return;
    }
    if (action === 'toggle-undo') { prefs.undo = !prefs.undo; savePrefs(); render('overlay'); return; }
    if (action === 'close') { modal = ''; render('overlay'); applyPendingUpdate(); return; }
    if (action === 'new-match') return startNewMatch(game.rules, true);
    if (action === 'next-hand') return nextHand();
    if (action === 'undo') return undo();
    if (action === 'apply-settings' && modal === 'settings') {
      const saved=savedVariant(draftPreset);
      const nextRules={...effectiveDraftRules(),name:saved?saved.name:draftPreset==='custom'?'Custom Fishing':E.PRESETS[draftPreset].name};
      if(saved)nextRules.savedVariantId=saved.id;else delete nextRules.savedVariantId;
      if(!E.validateRules(nextRules).playable)return;
      if (screen === 'game' && game.phase === 'playing' && !confirm('Start a new match with these rules?')) return;
      if (draftPreset==='custom') {customRules = {...draft,name:nextRules.name};saveCustomRules();}
      return startNewMatch(nextRules, false);
    }
    if (action === 'hand') {
      if (!isHumanTurn()) return;
      const id = node.dataset.id;
      pickedCard = pickedCard === id ? null : id;
      hintIterator = null; toast = '';
      sound('tap'); return render('selection');
    }
    if (action === 'table') {
      if (!isHumanTurn()) return;
      const id = node.dataset.id;
      if (pickedTable.has(id)) pickedTable.delete(id); else pickedTable.add(id);
      hintIterator = null; toast = ''; sound('tap'); return render('selection');
    }
    if (action === 'clear') { resetSelection(); toast = ''; return render('selection'); }
    if (action === 'trail' || action === 'capture') return play({ kind: action, cardId: pickedCard, targetIds: action === 'trail' ? [] : currentSelection() });
    if (action === 'build') return play(buildOptions[Number(node.dataset.index)]);
    if (action === 'hint') return suggestMove();
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && modal) {
      if (modal === 'exit-confirm') { cancelExit(); return; }
      modal = ''; render('overlay'); applyPendingUpdate(); return;
    }
    else if (ev.key.toLowerCase() === 'u' && !modal && prefs.undo && checkpoint) undo();
  });
  window.addEventListener('resize',()=>{if(screen==='game')layoutHumanHand();});
  render(); // The main menu is the entry point; the computer does not move until Resume/Start.
  if (/^https?:/.test(location.protocol)) {
    // A version file is checked at launch, even if the browser has cached the app.
    // The player never has to approve an update, and an active game is never reloaded.
    checkForAppUpdate();
    window.addEventListener('online', checkForAppUpdate);
    window.addEventListener('pageshow', event => {
      if (event.persisted) checkForAppUpdate();
    });
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', checkForAppUpdate);
      navigator.serviceWorker.register('./service-worker.js')
        .then(registration => {
          registration.update().catch(() => {});
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
              registration.update().catch(() => {});
              checkForAppUpdate();
            }
          });
        }).catch(() => {});
    }
  }
})();
