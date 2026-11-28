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
  const APP_VERSION = '0.10.22';
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
  let prefs = { sound: true, animations: true, undo: true, handSort:'dealt' };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREF_STORE) || '{}') }; } catch (_) {}
  delete prefs.cardLayout; // Old saved layout choices no longer affect the board.
  // Existing installations receive the new dealt-order default once.
  if(prefs.handSortVersion!==2){prefs.handSort='dealt';prefs.handSortVersion=2;}
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
  // reaches them, their faces stay hidden in precomputed final positions.
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
    // The hand DOM is already in the chosen display order, so incoming
    // cards travel left to right across the top row, then the bottom row.
    // In dealt mode this is the original engine receipt order.
    const incoming=new Set(deal.humanIds||[]);
    const human=handCards.filter(node=>incoming.has(node.dataset.cardId))
      .map(node=>({node,faceUp:true,humanId:node.dataset.cardId}));
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
    pendingDeal=null;
    pendingStockOrigin=null;
    if(!motionAllowed() || !start || !items.length || !document.body || !document.createElement){
      items.forEach(item=>{item.node.style.visibility='';});
      return Promise.resolve();
    }
    const generation=motionGeneration;
    // All final hand slots were laid out before any faces were revealed.
    // Measure once, then never move a landed card during the deal.
    const measured=items.map(item=>({...item,rect:item.node.getBoundingClientRect()}));
    const flyOne=({node,faceUp,rect,humanId},index)=>new Promise(resolve=>{
        if(generation!==motionGeneration || !node.isConnected){
          node.style.visibility='';resolve();return;
        }
        if(!rect.width || !rect.height || !node.animate){
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
            ghost.style.transform=end;
            ghost.style.opacity='1';
            ghost.getAnimations().forEach(a=>a.cancel());
            if(faceUp){
              await run([{transform:end+' rotateY(0deg)'},{transform:end+' rotateY(90deg)'}],{duration:humanId?75:100,easing:'ease-in'});
              if(generation!==motionGeneration)return;
              const face=node.cloneNode(true);
              if(humanId){
                ghost.classList?.add('hand-deal-flight');
                face.style.setProperty('--hand-index-scale',node.parentElement?.style?.getPropertyValue?.('--hand-index-scale')||'1');
              }
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
    return Promise.all(measured.map(flyOne)).then(()=>{});
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
    const previews=new Map([...app.querySelectorAll('.build-inspection')].filter(node=>!node.classList.contains('is-closing')).map(node=>[node.dataset.id,node]));
    const sourceFor=node=>{
      const collapsed=node.classList.contains('is-collapsed');
      const preview=collapsed?previews.get(node.dataset.id):null;
      const visible=preview||node;
      const summary=collapsed?node.querySelector('.build-summary'):null;
      const cardRect=card=>{
        if(summary&&!preview)return rect(summary);
        return rect(card); // the entire ribbon is visible, even in mid-spread
      };
      return {visible,cardRect,collapsed,preview};
    };
    const groupRects = (move.targetIds || []).map(id => {
      const node=tableById.get(id);
      if(!node)return null;
      const {visible,cardRect,collapsed,preview}=sourceFor(node);
      let label=collapsed&&!preview?null:visible.querySelector('.build-value');
      return {
        label:label ? {rect:rect(label),html:label.outerHTML,selected:node.classList.contains('selected')} : null,
        rect:rect(visible),html:visible.querySelector('.build-pile')?.outerHTML || visible.querySelector('.playing-card')?.outerHTML || visible.outerHTML,
        cards:[...visible.querySelectorAll('.playing-card[data-card-id]')].map(card=>({
          id:card.dataset.cardId,rect:cardRect(card),html:card.outerHTML,
          groupStart:!!card.parentElement?.classList.contains('build-group-start')
        }))
      };
    }).filter(Boolean);
    const selected = new Set(move.targetIds || []);
    const lastCard=!game.stock.length&&game.players.every((p,i)=>p.hand.length===(i===game.turn?1:0));
    const remainingCards = (lastCard?tableNodes:[])
      .filter(node => move.kind !== 'capture' || !selected.has(node.dataset.id))
      .flatMap(node => {
        const {visible,cardRect}=sourceFor(node);
        return [...visible.querySelectorAll('.playing-card[data-card-id]')].map(card=>({
          id:card.dataset.cardId,rect:cardRect(card),html:card.outerHTML
        }));
      });
    const tableRects = move.kind==='capture'?[...app.querySelectorAll('.table-stage .playing-card,.table-stage .build-summary')].filter(node=>node.closest?.('.is-collapsed')?node.classList?.contains('build-summary'):!node.classList?.contains('build-summary')).map(rect):[];
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
    // A lifted collection stack may float above occupied felt; never pack it
    // into the remaining green space like ordinary table cards.
    const collectionField=app.querySelector('.table-area');
    const feltRectForCapture=collectionField?.getBoundingClientRect();
    const captureFront = capture && feltRectForCapture ? {
      x:feltRectForCapture.left + feltRectForCapture.width*.5,
      y:feltRectForCapture.top + feltRectForCapture.height*(snapshot.byComputer?.28:.72)
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
    // The normal responsive build-card width is independent of card count,
    // collapsed builds, and the open area left over by the board layout.
    const collectionLift=1.06;
    const collectionFinish=.32;
    let raisedSize=null;
    function collectionSize(entries){
      if(raisedSize)return raisedSize;
      const refs=snapshot.looseCardRects?.length?snapshot.looseCardRects:entries.map(entry=>entry.rect);
      let width=refs.length?Math.max(...refs.map(r=>r.width)):ghosts[0].rect.width;
      if(collectionField?.appendChild){
        const probe=document.createElement('div');
        Object.assign(probe.style,{position:'absolute',visibility:'hidden',pointerEvents:'none',
          width:'var(--build-card-width, 58px)',height:'0',padding:'0',border:'0'});
        collectionField.appendChild(probe);
        const measured=probe.getBoundingClientRect?.().width;
        probe.remove();
        if(Number.isFinite(measured)&&measured>0)width=measured;
      }
      raisedSize={width:width*collectionLift,height:width*collectionLift/.715};
      return raisedSize;
    }
    function collectionShadow(entry){
      // A fixed, prepainted shadow travels with each composited card.
      entry.ghost.style.boxShadow='0 7px 11px 1px rgba(0,0,0,.36)';
      entry.ghost.style.borderRadius='3px';
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
      const frames=[{transform:start,opacity:1,offset:0}];
      if(options.lift){
        collectionShadow(entry);
        frames.push({transform:`translate(${from.x}px,${from.y-5}px) scale(${scale}, ${scaleY})`,opacity:1,offset:.18});
      }
      frames.push(
        {transform:`translate(${from.x+(dx-from.x)*.58}px,${from.y+(dy-from.y)*.58}px) scale(${options.lift?scale:from.scale+(scale-from.scale)*.58}, ${options.lift?scaleY:fromScaleY+(scaleY-fromScaleY)*.58})`,opacity:1,offset:.58},
        {transform:finish,opacity:finalOpacity,offset:1}
      );
      return animate(entry.ghost,frames,{duration,delay:options.delay||0,fill:'both',easing:travelEasing}).then(()=>{
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
      const transform=(x,y,s,sy=s)=>`translate(${x-c.x}px,${y-c.y}px) scale(${s}, ${sy})`;
      const scaleY=raisedSize.height/Math.max(entry.rect.height,1);
      const start=transform(c.x,c.y,1),landing=transform(front.x,front.y,scale,scaleY);
      // Only the final flight into the score badge tapers down.
      const finish=transform(end.x,end.y,scale*collectionFinish,scaleY*collectionFinish);
      collectionShadow(entry);
      const beginAt=flipDuration+index*stagger;
      const duration=collectAt+280;
      const easing=travelEasing;
      const frames=[{transform:start,opacity:1,offset:0}];
      if(beginAt>0)frames.push({transform:start,opacity:1,offset:beginAt/duration});
      frames[frames.length-1].easing=easing;
      frames.push({transform:transform(c.x,c.y-5,scale,scaleY),opacity:1,offset:(beginAt+65)/duration,easing});
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
      const size=collectionSize(all);
      await Promise.all(all.map((entry,i)=>{
        if(generation!==motionGeneration)return;
        // Continue from the actual landing transform of a final played card.
        // Lift to the same standard size used by ordinary captures.
        const from=entry.motion;
        return move(entry,{x:together.x+Math.min(i,8)*2,y:together.y+Math.min(i,8)*2},330,{
          from,scale:size.width/Math.max(entry.rect.width,1),scaleY:size.height/Math.max(entry.rect.height,1),delay:i*gap,lift:true
        });
      }));
      if(generation!==motionGeneration)return;
      await new Promise(resolve=>setTimeout(resolve,240));
      if(generation!==motionGeneration)return;
      const finish=center(pile.getBoundingClientRect());
      // As with ordinary captures, reduce size only on the final flight
      // into the recipient's score badge; start from the exact raised size.
      await Promise.all(all.map(entry=>move(entry,finish,560,{
        from:entry.motion,scale:(entry.motion?.scale??1)*collectionFinish,
        scaleY:(entry.motion?.scaleY??1)*collectionFinish,fade:true
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
          // Use a single raised size; no available-space or count-dependent
          // shrink. Allow the shadows and elevated stack to overlap the felt.
          const size=collectionSize(ghosts);
          const spreadStep=1.5;
          const stack=ghosts.map(entry=>({
            entry, scale:size.width/Math.max(entry.rect.width,1)
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
          if(destination.classList?.contains('is-collapsed')){
            const summary=destination.querySelector('.build-summary')?.getBoundingClientRect();
            if(summary)slotRects.fill(summary);
          }
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
  function entryMarkup(element,active=true) {
    const selected = pickedTable.has(element.id);
    if (element.type === 'loose') {
      return `<button type="button" class="table-item ${selected ? 'selected' : ''}" data-action="table" data-id="${element.id}" aria-pressed="${selected}" aria-label="Select ${escapeHtml(E.cardName(element.card))} on table" ${active?'':'disabled'}>${renderCard(element.card,false,selected)}</button>`;
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
    return `<button type="button" class="build-item ${selected ? 'selected' : ''}" data-action="table" data-id="${element.id}" aria-pressed="${selected}" aria-label="Select ${element.groups.length>1?'multiple ':''}${element.signedValue??element.value} build${element.signedValue<0?' (capture value '+element.value+')':''} owned by ${escapeHtml(ownerName)}, ${cards.length} cards" ${active?'':'disabled'}>
      <span class="build-pile" style="--layers:${cards.length}" aria-hidden="true">${layers}</span>
      <span class="build-summary${selected?' card-selected':''}" aria-hidden="true"><span class="build-summary-owner build-value-owner">${escapeHtml(ownerName)}</span><strong class="build-value-number">${escapeHtml(panelValue)}</strong><span class="build-summary-detail">${element.groups.length>1?'Multi':'Single'}</span><span class="build-summary-detail">${cards.length} card${cards.length===1?'':'s'}</span></span>
    </button>`;
  }
  // The reserved build lane has a hard vertical boundary. Measure the
  // actual full-size stacks rather than guessing from the number of cards.
  function buildsNeedCollapse(heights,available,gap=5){
    return heights.length>0&&heights.reduce((total,h)=>total+h,0)+Math.max(0,heights.length-1)*gap>available+.5;
  }
  // Selected stacks can use the whole felt. Keep their ordinary dimensions
  // and exposed index spacing unless fitting the complete ribbon requires
  // a smaller gap (or, exceptionally, slightly smaller cards).
  function buildInspectionGeometry(anchor,bounds,pile,count=1,occupied=[]){
    const n=Math.max(1,count),normalWidth=pile.width;
    if(normalWidth<=0||bounds.width<=0||bounds.height<=0||anchor.width<=0||anchor.height<=0)return null;
    const normalHeight=normalWidth/.715;
    const normalStep=n>1?Math.max(1,(pile.height-normalHeight)/(n-1)):0;
    const stepRatio=normalStep/normalWidth;
    const minRatio=Math.min(stepRatio,.34);
    const width=Math.min(normalWidth,bounds.width,bounds.height/(1/.715+(n-1)*minRatio));
    const cardHeight=width/.715;
    const step=n>1?Math.max(0,Math.min(stepRatio*width,(bounds.height-cardHeight)/(n-1))):0;
    const height=cardHeight+(n-1)*step;
    const anchorBottom=anchor.bottom??anchor.top+anchor.height;
    const desiredLeft=anchor.left-bounds.left+(anchor.width-width)/2;
    const clampX=x=>Math.max(0,Math.min(bounds.width-width,x));
    const top=Math.max(0,Math.min(bounds.height-height,anchorBottom-bounds.top-height));
    // If several selected ribbons would cover each other, prefer the
    // nearest open horizontal slot while preserving the original anchor.
    const obstacles=occupied.filter(p=>p.top<top+height&&p.top+p.height>top);
    const candidates=[clampX(desiredLeft),0,bounds.width-width,...obstacles.flatMap(p=>[clampX(p.left-width-6),clampX(p.left+p.width+6)])];
    const available=candidates.filter(x=>obstacles.every(p=>x+width+5<=p.left||x>=p.left+p.width+5));
    const left=available.length?available.sort((a,b)=>Math.abs(a-desiredLeft)-Math.abs(b-desiredLeft))[0]:clampX(desiredLeft);
    return {left,top,width,height,cardHeight,step,cardScale:width/normalWidth,
      startX:anchor.left-bounds.left-left,startY:anchor.top-bounds.top-top,
      startScaleX:anchor.width/width,startScaleY:anchor.height/cardHeight};
  }
  // Each physical card has its own travel track, not a reveal mask. All
  // tracks share a timeline so reversing it gathers the ribbon in order.
  function buildRibbonTracks(g,count){
    const n=Math.max(1,count),glide=235;
    const stagger=n>1?Math.min(16,140/(n-1)):0;
    const duration=glide+(n-1)*stagger;
    const downward=g.startY<(n-1)*g.step/2;
    const easing='cubic-bezier(.2,.8,.2,1)';
    const tracks=Array.from({length:n},(_,i)=>{
      const delay=(downward?n-1-i:i)*stagger;
      const start={translate:g.startX+'px '+(g.startY-i*g.step)+'px',scale:g.startScaleX+' '+g.startScaleY};
      const end={translate:'0px 0px',scale:'1 1'};
      const frames=[{...start,offset:0}];
      if(delay>0)frames.push({...start,offset:delay/duration});
      frames[frames.length-1].easing=easing;
      frames.push({...end,offset:(delay+glide)/duration});
      if(delay+glide<duration-1e-6)frames.push({...end,offset:1});
      return frames;
    });
    return {duration,tracks};
  }
  function removeBuildInspection(preview){
    preview._ribbonToken=(preview._ribbonToken||0)+1;
    for(const motion of preview._ribbonAnimations||[])motion.cancel();
    preview._buildAnchor?.classList.remove('is-inspecting');
    preview.remove();
  }
  function closeBuildInspection(preview,animate){
    if(preview.classList.contains('is-closing'))return;
    const motions=preview._ribbonAnimations||[];
    if(!animate||!motions.length||motions.some(m=>typeof m.reverse!=='function')){
      removeBuildInspection(preview);return;
    }
    preview.classList.add('is-closing');
    preview.setAttribute('aria-hidden','true');
    preview.disabled=true;
    const token=preview._ribbonToken=(preview._ribbonToken||0)+1;
    for(const motion of motions)motion.reverse();
    Promise.allSettled(motions.map(m=>m.finished)).then(()=>{
      if(preview._ribbonToken===token&&preview.classList.contains('is-closing'))removeBuildInspection(preview);
    });
  }
  function syncBuildInspections(){
    const lane=app.querySelector?.('.table-builds'),rail=app.querySelector?.('.build-inspections');
    if(!lane||!rail)return;
    const selected=[...lane.querySelectorAll('.build-item.is-collapsed.selected')];
    const selectedIds=new Set(selected.map(node=>node.dataset.id));
    const previews=new Map([...rail.querySelectorAll('.build-inspection')].map(node=>[node.dataset.id,node]));
    const animate=typeof motionAllowed==='function'&&motionAllowed();
    for(const [id,preview] of previews){
      if(selectedIds.has(id))continue;
      if(!preview._buildAnchor?.classList.contains('is-collapsed'))removeBuildInspection(preview);
      else closeBuildInspection(preview,animate);
    }
    const bounds=rail.getBoundingClientRect();
    const occupied=[];
    // Existing open ribbons keep priority when a new one is selected.
    selected.sort((a,b)=>Number(previews.has(b.dataset.id))-Number(previews.has(a.dataset.id)));
    for(const node of selected){
      const pile=node.querySelector('.build-pile'),summary=node.querySelector('.build-summary');
      if(!pile||!summary)continue;
      let preview=previews.get(node.dataset.id);
      const fresh=!preview;
      if(fresh){
        preview=document.createElement('button');
        preview.type='button';
        preview.className='build-inspection';
        preview.dataset.action='inspect-build';
        preview.dataset.id=node.dataset.id;
        preview.dataset.buildPreview=node.dataset.id;
        preview.setAttribute('aria-label',node.getAttribute('aria-label')+'; tap to deselect');
        preview.setAttribute('aria-pressed','true');
        preview.appendChild(pile.cloneNode(true));
        preview._buildAnchor=node;
        rail.appendChild(preview);
      }
      const reopening=preview.classList.contains('is-closing');
      preview.disabled=node.disabled;
      const clone=preview.querySelector('.build-pile');
      const layers=[...clone.querySelectorAll('.build-layer')];
      const anchor=summary.getBoundingClientRect();
      const inputKey=[bounds.left,bounds.top,bounds.width,bounds.height,anchor.left,anchor.top,anchor.width,anchor.height,
        ...occupied.map(p=>[p.left,p.top,p.width,p.height].join(','))].join('|');
      if(!fresh&&preview._buildGeometry===inputKey&&preview._ribbonGeometry){
        occupied.push(preview._ribbonGeometry);
        if(reopening){
          preview._ribbonToken=(preview._ribbonToken||0)+1;
          preview.classList.remove('is-closing');
          preview.removeAttribute('aria-hidden');
          for(const motion of preview._ribbonAnimations||[]){motion.reverse();motion.finished.catch(()=>{});}
        }
        node.classList.add('is-inspecting');
        continue;
      }
      // A resize may alter the available spread, but must not inherit the
      // previous preview's fitted dimensions or a cancelled closing motion.
      preview._ribbonToken=(preview._ribbonToken||0)+1;
      for(const motion of preview._ribbonAnimations||[])motion.cancel();
      preview._ribbonAnimations=[];
      preview.classList.remove('is-closing');
      preview.removeAttribute('aria-hidden');
      clone.style.removeProperty('--stack-card-width');
      clone.style.removeProperty('--stack-step');
      clone.style.removeProperty('height');
      const full=clone.getBoundingClientRect();
      const g=buildInspectionGeometry(anchor,bounds,full,layers.length,occupied);
      if(!g){removeBuildInspection(preview);continue;}
      occupied.push(g);
      Object.assign(preview.style,{left:g.left+'px',top:g.top+'px',width:g.width+'px',height:g.height+'px'});
      clone.style.setProperty('--stack-card-width',g.width+'px');
      clone.style.setProperty('--stack-step',g.step+'px');
      clone.style.setProperty('height',g.height+'px');
      preview.style.setProperty('--ribbon-card-scale',String(g.cardScale));
      preview._buildGeometry=inputKey;
      preview._ribbonGeometry=g;
      node.classList.add('is-inspecting');
      if(animate&&layers.length&&layers.every(layer=>typeof layer.animate==='function')){
        const {duration,tracks}=buildRibbonTracks(g,layers.length);
        preview._ribbonAnimations=layers.map((layer,i)=>{
          const motion=layer.animate(tracks[i],{duration,easing:'linear',fill:'both'});
          motion.finished.catch(()=>{});
          if(!fresh&&!reopening)motion.finish(); // resize without replay
          return motion;
        });
      }
    }
  }
  // The upper-left rank and suit are the hard limit for compression.
  // Measure the real card artwork, not an assumed fraction of the stack.
  function buildStackGeometry(pile){
    const rect=pile.getBoundingClientRect();
    const cards=Number(pile.style.getPropertyValue('--layers'))||1;
    const faces=[...pile.querySelectorAll('.build-layer .playing-card')];
    const cardHeight=faces[0]?.getBoundingClientRect().height||rect.width/.715;
    let minStep=0;
    for(const face of faces){
      const shoulder=face.querySelector('.card-corner:not(.bottom)');
      if(!shoulder)continue;
      const top=face.getBoundingClientRect().top;
      const bottom=shoulder.getBoundingClientRect().bottom;
      // Leave one CSS pixel below the entire shoulder index; round upwards
      // to quarter pixels to avoid covering it through subpixel rounding.
      minStep=Math.max(minStep,Math.ceil((bottom-top+1)*4)/4);
    }
    return {height:rect.height,width:rect.width,cards,cardHeight,
      minStep:minStep||Math.ceil((rect.width*.28+1)*4)/4};
  }
  // Recalculate natural and tight heights on every layout. Tightening
  // overlaps takes precedence over borrowing a second column or collapsing
  // any pile, but neither the cards themselves nor their indices are shrunk.
  function planBuildColumns(piles,available,summaryHeight,gap=5){
    const n=piles.length,H=Math.max(0,available),S=Math.max(0,summaryHeight);
    if(!n)return {columns:1,scale:1,gap,slots:[]};
    const geometry=piles.map(p=>{
      const count=Math.max(1,p.cards),intervals=count-1;
      const cardHeight=p.cardHeight??S;
      const minStep=intervals?Math.max(0,p.minStep??Math.ceil(((p.width??S*.715)*.28+1)*4)/4):0;
      const naturalStep=intervals?Math.max(minStep,(p.height-cardHeight)/intervals):0;
      return {intervals,cardHeight,minStep,naturalStep,
        natural:cardHeight+intervals*naturalStep,tight:cardHeight+intervals*minStep};
    });
    // An individually oversized stack may collapse only if even its
    // shoulder-safe minimum height exceeds the entire column.
    const collapsed=geometry.map(p=>p.tight>H+1e-7);
    const order=geometry.map((_,i)=>i).sort((a,b)=>geometry[b].tight-geometry[a].tight||piles[b].cards-piles[a].cards||a-b);
    const pack=(heights,oneOnly=false)=>{
      const total=heights.reduce((a,b)=>a+b,0)+gap*(n-1);
      if(total<=H+1e-7)return {columns:1,assignment:heights.map(()=>0)};
      if(oneOnly||n===1||heights.some(h=>h>H))return null;
      const cap=Math.floor((H+gap)*4+1e-7);
      const weights=heights.map(h=>Math.ceil((h+gap)*4-1e-7));
      const sum=weights.reduce((a,b)=>a+b,0);
      if(sum>2*cap)return null;
      // Exact subset packing of the measured minimum heights. Prefer the
      // right column and keep the original order within each column.
      const dp=Array(cap+1).fill(null);
      dp[0]={count:0,mask:0n};
      for(let i=0;i<n;i++){
        const w=weights[i];
        for(let j=cap;j>=w;j--){
          const prev=dp[j-w];
          if(!prev)continue;
          const count=prev.count+1;
          if(!dp[j]||count>dp[j].count)dp[j]={count,mask:prev.mask|(1n<<BigInt(i))};
        }
      }
      let best=null;
      for(let j=Math.max(0,sum-cap);j<=cap;j++){
        if(dp[j]&&(!best||dp[j].count>=best.count))best=dp[j];
      }
      if(!best)return null;
      return {columns:2,assignment:heights.map((_,i)=>(best.mask&(1n<<BigInt(i)))?0:1)};
    };
    const tryPack=()=>{
      const natural=geometry.map((p,i)=>collapsed[i]?S:p.natural);
      const tight=geometry.map((p,i)=>collapsed[i]?S:p.tight);
      return pack(natural,true)||pack(tight,true)||pack(natural)||pack(tight);
    };
    // Try natural spread, tighter spread, and two-column packing before
    // sacrificing another pile. Re-run the same feasibility checks after
    // each collapse so the remaining piles can keep their cards visible.
    let result=tryPack();
    for(const i of order){
      if(result)break;
      if(!collapsed[i]){collapsed[i]=true;result=tryPack();}
    }
    let scale=1,usedGap=gap;
    if(!result){
      // Even all single-card summaries are too tall. Only now reduce
      // summary dimensions and the gaps; ordinary cards remain full size.
      const firstCount=Math.ceil(n/2);
      const needed=firstCount*S+(firstCount-1)*gap;
      scale=needed>0?Math.min(1,H/needed):1;
      usedGap=gap*scale;
      result={columns:n===1?1:2,assignment:piles.map((_,i)=>i<firstCount?0:1)};
      collapsed.fill(true);
    }
    // Determine exactly how much height the packed column must free up.
    // Share only the necessary compression across its expandable gaps,
    // keeping as much of the natural spread as the column permits.
    const tight=geometry.map((p,i)=>collapsed[i]?S*scale:p.tight);
    const natural=geometry.map((p,i)=>collapsed[i]?S*scale:p.natural);
    const expansion=Array.from({length:result.columns},(_,column)=>{
      const indices=result.assignment.flatMap((c,i)=>c===column?[i]:[]);
      const minimum=indices.reduce((total,i)=>total+tight[i],0)+Math.max(0,indices.length-1)*usedGap;
      const flexible=indices.reduce((total,i)=>total+natural[i]-tight[i],0);
      return flexible>0?Math.max(0,Math.min(1,(H-minimum)/flexible)):1;
    });
    const y=[0,0];
    const slots=result.assignment.map((column,i)=>{
      const p=geometry[i];
      const step=collapsed[i]?null:p.minStep+(p.naturalStep-p.minStep)*expansion[column];
      const height=collapsed[i]?S*scale:p.cardHeight+p.intervals*step;
      const slot={column,y:y[column],height,step,collapsed:collapsed[i],
        savedHeight:Math.max(0,p.natural-height)};
      y[column]+=height+usedGap;
      return slot;
    });
    return {columns:result.columns,scale,gap:usedGap,slots};
  }
  function layoutBuilds(){
    const lane=app.querySelector?.('.table-builds');
    const stage=lane?.parentElement;
    if(!stage||!lane)return;
    const items=[...lane.querySelectorAll('.build-item')];
    stage.style.setProperty('--build-columns','1');
    lane.classList.remove('builds-collapsed');
    items.forEach(node=>{
      node.classList.remove('is-collapsed');
      node.style.removeProperty('--build-scale');
      // Always measure the default spread, never yesterday's compression.
      node.querySelector('.build-pile').style.removeProperty('--stack-step');
    });
    if(items.length){
      const inset=Math.min(4,lane.clientHeight/4);
      const available=Math.max(0,lane.clientHeight-2*inset);
      const piles=items.map(node=>buildStackGeometry(node.querySelector('.build-pile')));
      const summaryHeight=piles[0].width/.715;
      const plan=planBuildColumns(piles,available,summaryHeight,5);
      stage.style.setProperty('--build-columns',String(plan.columns));
      lane.classList.toggle('builds-collapsed',plan.slots.some(slot=>slot.collapsed));
      items.forEach((node,i)=>{
        const slot=plan.slots[i];
        node.classList.toggle('is-collapsed',slot.collapsed);
        node.style.setProperty('--build-column',String(slot.column));
        node.style.setProperty('--build-scale',String(plan.scale));
        if(!slot.collapsed)node.querySelector('.build-pile').style.setProperty('--stack-step',slot.step+'px');
        node.style.top=(inset+slot.y)+'px';
      });
    }
    syncBuildInspections();
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
      <div class="opponent-tag" ${multiplayerLabel?'':`style="--seat-color:${gameSeatColor(1)}"`} aria-label="${multiplayerLabel?escapeHtml(multiplayerLabel):`Computer has ${computerScore} points`}">${multiplayerLabel?escapeHtml(multiplayerLabel):`Computer · ${computerScore} pts`}</div>
      <div class="header-actions">
        ${renderHandSortToggle(active)}
        <button class="game-help" data-action="hint" aria-label="Suggest a move" title="Hint" ${active?'':'disabled'}>✧</button>
        ${prefs.undo?`<button class="game-help" data-action="undo" aria-label="Undo previous move" title="Undo" ${checkpoint?'':'disabled'}>↶</button>`:''}
      </div>
    </header>`;
  }
  function handSortMode(){
    return prefs.handSort==='value'||prefs.handSort==='suit'?prefs.handSort:'dealt';
  }
  function nextHandSortMode(mode=handSortMode()){
    return mode==='dealt'?'value':mode==='value'?'suit':'dealt';
  }
  function renderHandSortToggle(active){
    const mode=handSortMode(),next=nextHandSortMode(mode);
    const labels={dealt:'dealt',value:'555',suit:'567'};
    const names={dealt:'dealt order',value:'value then suit',suit:'suit then value'};
    return '<button type="button" class="hand-sort-toggle" data-action="toggle-hand-sort" aria-label="Sort hand: '+names[mode]+'. Tap to sort by '+names[next]+'." title="Switch hand sort order" '+(active?'':'disabled')+'>'+
      labels[mode]+'</button>';
  }
  function sortedHand(hand,rules,mode='dealt'){
    if(mode==='dealt')return hand.slice();
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
    // The final hand reads across the top row, then the bottom row.
    // Flight order follows these same fixed slots.
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
  function writeHandSlot(node,p,g){
    node.style.left=(g.inset+p.x)+'px';
    node.style.top=p.y+'px';
    node.style.zIndex=String(p.col+1);
    node.style.setProperty('--hand-index-scale',String(p.indexScale));
  }
  function layoutHumanHand(){
    const g=humanHandGeometry();
    if(!g)return;
    const plan=planForHand(g.nodes.length,g);
    const slots=sortedHandSlots(plan);
    // Use the full committed hand count, including hidden incoming cards.
    g.nodes.forEach((node,i)=>writeHandSlot(node,slots[i],g));
  }
  // Size actual cards, not transformed hitboxes. Keep row counts bounded
  // so a full hand still leaves space for the table and legal move buttons.
  function rowPlan(count,table=false){
    const n=Math.max(1,Math.floor(count)||1);
    // Always reserve four physical slots across the loose-card lane.
    // Count the actual number of rows, even in unusually large custom deals.
    if(table){
      const rows=Math.ceil(n/4);
      return {count:n,portraitRows:rows,portraitCols:4,wideRows:rows,wideCols:4,gap:n>18?2:n>10?3:n>6?4:7,oneGap:4};
    }
    const portraitRows=Math.min(3,Math.ceil(n/6));
    const wideRows=Math.min(2,Math.ceil(n/12));
    return {count:n,portraitRows,portraitCols:Math.ceil(n/portraitRows),
      wideRows,wideCols:Math.ceil(n/wideRows),gap:n>18?2:n>10?3:n>6?4:7,oneGap:n>18?1:n>10?2:n>5?3:6};
  }
  function cardRowStyle(count,table=false){
    const p=rowPlan(count,table);
    return '--row-count:'+p.count+';--portrait-cols:'+p.portraitCols+';--portrait-rows:'+p.portraitRows+
      ';--wide-cols:'+p.wideCols+';--wide-rows:'+p.wideRows+';--multi-gap:'+p.gap+'px;--one-gap:'+p.oneGap+'px';
  }
  function gameSeatColor(seat){
    if(game.rules.teamMode==='freeForAll')return seat===0?'#346da8':game.players.length===2?'#ac4847':'#777b73';
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
          <button data-action="settings" class="launch-tile"><span>⚙</span><b>Game Variations</b></button>
          <button data-action="toggle-sound" class="launch-tile"><span>♫</span><b>Sound: ${prefs.sound ? 'On' : 'Off'}</b></button>
          <button data-action="toggle-animations" class="launch-tile"><span>✦</span><b>Animations: ${prefs.animations ? 'On' : 'Off'}</b></button>
          <button data-action="open-soundboard" class="launch-tile"><span>♫</span><b>Soundboard</b></button>
        </div>
        <p class="launch-foot">Play against the CPU · v${APP_VERSION} · Offline-ready</p>
      </div>
      ${modal ? renderModal() : ''}
    </main>`;
  }
  // The six original audition recordings are embedded in the release.
  // Each contains three distinct candidates; native audio-buffer offsets
  // let us audition individual clips without a separate webpage or fetch.
  const soundboardCategories=[{"key":"ui","title":"UI taps","audio":"SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYxLjcuMTAzAAAAAAAAAAAAAAD/+0DAAAAAAAAAAAAAAAAAAAAAAABYaW5nAAAADwAAALoAAGDDAAQGCAoMDhUXGx4gIiQnKDE1ODo9P0BCREZIS01OUFJUVllbXF5jaWxvcXJ0dnuChoiKi46QkpSWmJmbnqCipKanqayut7u9vsHDxcfQ1NXY2tze4OLk5ujq7O7w8vT2+Pr8/gAAAABMYXZjNjEuMTkAAAAAAAAAAAAAAAAkBG8AAAAAAABgwxjSWskAAAAAAP/7EMQAA8AAAaQAAAAgAAA0gAAABExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxCmDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDEUwPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMR8g8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxKYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDEz4PAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV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lO/B8uHxOHj4KzqyP8uEQccCCgwUUDRY8Ip7//KDgGgP/+ShoqdVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7UMT8AA4EtUfssMyppJnofrCABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1DE7IAUKOdD+akEgAAAP8OAAARVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAAB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VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tgxOqADk0HSfWEACoEkuj/NvIQVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sgxOiACXiHK7k2gAAAADSDgAAEVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUAYAgAYAUAYAUCgMBg//sQxNYDwAABpAAAACAAADSAAAAEAAADwAAWBQ1eByZRAdcVHgYTFYYq8LHQGD/haICmAsf/w+QUUMeAKh/4FwBv4XAASIRL/8ZgcwfxkxRhbf/8NvEAwyAGMAtYFvEEP//xwFEiZJn/+xDE1gPAAAGkAAAAIAAANIAAAASiaTJ///+V2Tdk36/////0zdApuE4E////9Dbr2TqaoDMbIHZpFARARFZgyQVkYT0GX2RUArbsYAQA5mbpmc55P/5W3UwFwBJZIYAsAuH+44K5s//7EMTWA8AAAaQAAAAgAAA0gAAABJo9yYCuAAMOMBXABAKAFmCbA45hYIeO8pCAArbcUxcMN7MEjF7zImyRVlaqaY8hXwoaY9+H2mUFkrJkTpFWZFWKTtUe9c9MzVuLiK3GJQkUpj8I//sQxNYDwAABpAAAACAAADSAAAAEVmYTQDIGnHIxRndRXNLEqoFsujFLMBuUtMw2gDaMagD3jAcwnMwaUAxM2lLTTIyRluZg6Vv1HoAlLhQNcYc1kwzECDNFNO7zLkx5UxGsIvMJ9GL/+xDE1gPAAAGkAAAAIAAANIAAAARTHZRkcxHsIpkkxQV7k1F4TXnZLGMIHMMQC2jCWARAwAUABMMZC8TC6wnkwYMB3MIOCADB/AhAwe4D8n/gCl5A++V4bgWHZVWksemmymEfgsJgH//7EMTWA8AAAaQAAAAgAAA0goAABIDEYC8AOGBqgNaPSg5gEgA0SAEZgGYAiDgAsUAEn2v2p7Hu8cNblkbf3G7uLY8z0YBcALGDJgrJgkIHqYF2AmmAHAAxgDwBwYBwAIGA8AOhgNgC//ugxP+AD0WBM/lZgEdPtaz/P/oI0YBoACAkArMBFAKxgAEMCzAjzAfwH+FP1p5pfUoZ+9S5yqNV6spjNJblMpjNmpP1f5vhgNYBSowDQAkMAEzARwC0wBUAHS7Zwl4vT///6vyiAAAAAAABX0tdnIUBVqAEET2QWYsOhxhVwGPTOmdQNHXJayO/A4ZYYLGBwUijOEquXOXo1BEXjz7SiXS93Yq6TvMOZ07L+wS/tLbvOCsWpWhqnsU7guLSbZS/MZkFuMy6A4VOR9hruvzlKoefBiUaf7davEGHLCsRdVwpc/1WKvrP4ZRKV3NynVeKxmpKpVLsbXc6aVP9DVM/0itXJ6tTZ0tLLauGVNnLcb367+ONb+4Y0tLjz//n1aXn7/L/x1v+5apqtk1038m8bkUlmjf+KIOguthhIU9A+7AEBalAVS0gOdChxRrHBAcNpkn3BDLlL3lVO2rWqG5vWPM4WsWQWsI1ZJJUSBkqqMfqW0q4YU4CWtjNDXgq8aCibUqsP+arD//hrVnszfqXsa0jXql3/9mjfquUZj5s2x8/9cMDT8WPHT2POu1qvbQAlAdL99bAPpGtqYLnBgB2wIDb8KQjnho2WQYfclL7tIBAllLNqo1FaC9wxjlKOk6mjGwoKv+UZtRNWHsd6TcY+BjWNrl/VjQ1EjMNB0sBQaBr6zvJRUIAUQSs//uQxNMAGfVtRd28gAnjK+m9gw7EHA7SM7UAVOXIVOHMYeYzSHkETClhkKhl2QsBJYGk0H832lqfivtDa27+TnelAGMHXf8AAAZAY6y1VmylUUhsaGmTFYUrlvorWfSVLXIjNF7WzqdT7sN1H1j3aAw+8AAfEAHaMU6nU67woFBgp/7CrGYrMv45boInr0PJgWNkMYmQYTEW5PKEFbFqyvfJap3b8J8rnz6uGDATNVYND6qqx1VUr1VGCswIq4ugOAAAL0foYTsAcPxYzOlhVtBKI6hzgXpsyTJPQEJT3+nb0H0d7/NgAPcxBmbSlIiQ0JAVWyBgCo3cBpUdk6W/YYysZEtWIiUThieE2TEBU0SEZ0VCwnICpMOCsuseJyA6iPE5cpFMgXSJM8rA8FkZYWBwU4CsW2knR01MQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVRWYAAAKjbKJCRCEVDUSzQtGJ1CBzExBTUUzLjEwMKqqqqqqqqqqqqqqqqqq//swxPSASuS9P+00cKDCh+Z9jeDEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//swxPQAR4xDL+Hp46j2kOV9l400qqqqqqqqqqpMQU1FMy4xMDCqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//swxPqABMA9O+A+IaFmkST1hJntqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy4xMDCqqqqq//sQxOCDwpwhEwGlgKgAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjEwMKqqqqr/+xDE1gPAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqv/7EMTWA8AAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy4xMDCqqqqq//sQxNYDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjEwMKqqqqr/+xDE1gPAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTbbUabTabvfaKFFmm//7EMTWA8AAAaQAAAAgAAA0gAAABApgGA4DcYCAGpgUAqF60DzDcCkMWIGsxMQtjK5sRhjZmFnVmWSJSa5g6Bh7h7YxsEkOZllaNO6aDOdbt4AYpxoXiURzacuDLMWTTQmeYbtmOYdm//sQxNYDwAABpAAAACAAADSAAAAEP4jmBgyGPgeGnTVHDp0GGq1GUY62+Z/5kub5oea4OLcSSAyNK0yifE144gywEI2ibs2uSLvf//McwbMlRtMQwrAQbmXoFmTBcGnJNHY7Pm3bmnP/+xDE1gPAAAGkAAAAIAAANIAAAAQY7nC7iG3cA93lYvdwMVgSM0gwMdSNMUwRM3jkM2CSFhJMZjTOWITNRFiMV0XBo+GI7InCRrfvvdc5/BCBBhECD8mcY0mDAiDQaGJQnGMQ3GKwMP/7EMTWA8AAAaQAAAAgAAA0gAAABGdqQGAgeGOSmGirAGboNmyg9GwYPmHQXmOrV8//////8yIF4BB6YNgKtekpwMA7KkrHLFAEMIxxEmgMgCMMCQ0MGARDhXMQgmMEQsDghMFgCLf///sQxNYDwAABpAAAACAAADSAAAAE/////////hAKGGgYGEQDOmYHAEj46i+1JsQMCwBJQCBwKJuGAgAGNZYpJigwmPwXGEoNllBYETGYBQENxhKAY8F5hSIAJEkLhwFQH///////////+xDE1gPAAAGkAAAAIAAAP8KAAAT////////9vIcdB1JRFN2Ltv///////////8HCQ97cjAMD17Jl1mBtbfT8YgAQAAAAAE5WABUACALJbLLQ4FcVdoEDTvDEHAKAVXMQXcp2Cwwi2P/7wMT/gDrCHS2Z7oAD5bAo+7eQAdF0wSYEBI/Q1RxFL1asOtxYagJLwwJJ4rDwVALjKSYa5JblWJ3Xo61prTlLmZDKpTaclsywzFm1huXP431Wfhl8o8w9rTWwQOXpXSwpdyxvawn0pkpdWmpctlkDaO21FnNZsrOW1bk/tpwWGr1f1YVhrLYlG35iN5wX5itLlg+z9ca1AaYsCuzFX1ZzLH2fqGn6matL2pdlU9Q0cZluq1+mv5Uty7hTWt48uX7l+rLZbjzdLLaWU0tXlNW7lljj9bvatlWLS0+KKOhX6KO0d/417vVAZAMikCC78sb9Ev4MRVWBwcWJSCD0WZBQzKbU5L2kAwmGVpuq7uG8Np8SMJEtoijaJxaMzlGxpZGAZE14a54Y6AqGMKKDDqql4Y1Uuf8Y/1Uteaqxt9jMTHDMsKzMdh1T/jc1hwMBH3UukeZ7Mf1T2NZn/eal+wEYl6Sob/+QwpQY7//duKWPQa0RbY4VH05XGIQAOlFxphWtvc4yraqg1+cxIFzH6A5Fp36rAoCrM1WdARPS2OARqhr0BLUEOAgICUAvjVYx1QQo1UjabccTwwq9BckwVp/CpoKif//12X3f+KqIcAAwBDG/AAAeLQtvGpowyIKAoiBzSMo6cYRRQlMNdKhkDNjbCOYtwZyFzlv+9eAvq9r/92v7ECUSxQctYTLVF44JZhJ8cDeD/sMLhmRSX5oND5z7AkR2y6jS32q+RQSUUTlVDlbCj/noqjX+6nh1AGIFT/6AACWxZ+Xeh13n9R6SGNhrGgMuV60JoM84MZhQsGlNYglJOXG7gGtw4JCiJIGLKAzLIE0EFyuUpo0umGBqrJH00esssEzYPlPVdgN4CEsZCoiK0CsGfmXYNlZqQFSys95lzfMUfZ3/RftQtTvv6wAAu9d7O2drDqnS/U3ZMdvsBaej2nWsOXMn5hoSgtYZHjIwMDMKJnfhZMmT//tQxPqAD9mFTeyYcsGZnCl9k44VJkAgIIECBAgMC0wsmTJkyaZCIiIiIu7X31mOdxyMKNAtSgCxECQaCxM+M0M0B2BrITCIpiYiSCINlbs//xQUFBQoKCgoJBQUFBQoKCgoJBQUFBQoKCgoJBQUFBQoKCgpTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVf/7QMTlAEf8Py3k7yEotoem/Yy81FVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVV//sgxP6AyVRvK+0w0GiQB6c4AeAMVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7MMT9gAnIiSesPMzpDgWjsJewlVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=","options":[{"letter":"A","name":"Soft pop","description":"A round, muted touch response.","start":0.35,"duration":0.115},{"letter":"B","name":"Wooden tick","description":"A compact mechanical click.","start":2.23,"duration":0.13},{"letter":"C","name":"Glass click","description":"A brighter, clean digital tap.","start":3.73,"duration":0.13}]},{"key":"single","title":"Single card dealt","audio":"SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYxLjcuMTAzAAAAAAAAAAAAAAD/+0DAAAAAAAAAAAAAAAAAAAAAAABYaW5nAAAADwAAAMwAAIgdAAMFBggJCxEXHCAjJCYnKSoxNjs+QEJDRUdISktNT1BSU1VWWFlbY2tucHJzdXZ4gIaKjI2PkZKUlZeYmpudnqCho6SmrLa8wMHDxcbI0drf4uTm5+nq7O3v8PLz9fb4+fv8/gAAAABMYXZjNjEuMTkAAAAAAAAAAAAAAAAkBHoAAAAAAACIHfGb1AEAAAAAAP/7EMQAA8AAAaQAAAAgAAA0gAAABExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxCmDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDEUwPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMR8g8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxKYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDEz4PAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV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VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tQxPYADXk7O+wkbsEMEaTwww4BVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=","options":[{"letter":"A","name":"Felt slide","description":"Soft paper friction and a muted landing.","start":0.35,"duration":0.225},{"letter":"B","name":"Quick snap","description":"A dry, decisive flick and tap.","start":2.04,"duration":0.18},{"letter":"C","name":"Crisp flick","description":"A bright edge sound with a firm landing.","start":3.64,"duration":0.205}]},{"key":"multiple","title":"Multiple cards dealt","audio":"SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYxLjcuMTAzAAAAAAAAAAAAAAD/+0DAAAAAAAAAAAAAAAAAAAAAAABYaW5nAAAADwAAAM8AAKxvAAIEBQYHCAwSFhkdICMnLC8zNjk6PD0+P0BCQ0RGR0hKS0xNTlBVWl9kaXB0eH2BhYeIiYuMjY6PkZKUlZaXmJqbnJ2eo6qvuL/EytDW3OPm6Onq7O3v8PHy8/X29/j5+/z9/gAAAABMYXZjNjEuMTkAAAAAAAAAAAAAAAAkBekAAAAAAACsb5MLIhUAAAAAAP/7EMQAA8AAAaQAAAAgAAA0gAAABExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxCmDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDEUwPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMR8g8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxKYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDEz4PAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV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VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVf/7YMTogA5ZA0HsGHFJjJsmPYMOMVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTsA8V8SxmAJGWIAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV","options":[{"letter":"A","name":"Soft sequence","description":"Six felt-slide deals.","start":0.35,"duration":0.71},{"letter":"B","name":"Dry sequence","description":"Six quick-snap deals.","start":2.02,"duration":0.71},{"letter":"C","name":"Crisp sequence","description":"Six crisp-flick deals.","start":3.69,"duration":0.71}]},{"key":"ruffle","title":"Cards ruffled","audio":"SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYxLjcuMTAzAAAAAAAAAAAAAAD/+0DAAAAAAAAAAAAAAAAAAAAAAABYaW5nAAAADwAAAMYAALcJAAIDBAUGBwgPFx4iKC80OTw+P0BBQkNFRkdISUpLTU5PUFFSU1hcZGxzeoKIjJGUl5iampucnp+goaKjpKanqKmqq6yvs7m+wsfN09ne4ubp6uzt7u/w8fL09fb3+Pn6/P3+/wAAAABMYXZjNjEuMTkAAAAAAAAAAAAAAAAkA08AAAAAAAC3CQi/zKEAAAAAAP/7EMQAA8AAAaQAAAAgAAA0gAAABExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxCmDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDEUwPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMR8g8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxKYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDEz4PAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEAgFAoDAoEAoEAYDAAA+QeLAr+AuBf7mfmBuFx/jQ4VBp/5GAeAmAmf/+eFgWzDx///uLBhhOZ///EIRk4ix+5OGP/uKdqhqjtzakRUQlc602kgb/+xDE1gPAAAGkAAAAIAAANIAAAAQhsPdSv4ih2C0UM1FQwha0IWNnSKASKosA4WQmmxMDzFs7OlY4cDn5vUZjwEIXS90bUm4htCxgBBhj5m0aQcUcZdj/qvhC9zplysEZNkf64ZRXSf/7EMTWA8AAAaQAAAAgAAA0gAAABCR7WtssafSdam1wLgQsdTIARguChXk5UlfPOG5Zdj8DzMSQlxWKKxhQExRPmD9bpqSnzhxkkbwl8onEzVb3mZQ88BRbCEwHncfugvR+1ebyN4Ul//sQxNYDwAABpAAAACAAADSAAAAEmnz/cZjVmTSWYv2JuvUlr92Jyklssp60P5O5H4HoabjeW4puOZSzu/1v/wy3h+GL937lJU7ypvveYcikCdpL1qWRSvft65Y3qubzm77JbDAhIAr/+xDE1gPAAAGkAAAAIAAANIAAAAQAYDAICAhDZxhoMhr7XIiCAxIBEQgIVQCMIhsM/RXEIIDoRiIBwaApkCJpi0Hyi5gAAbHBEAoNenREOUnSYIUAi52nRI+NocLAS+j02ZUi5zQEBv/7EMTWA8AAAaQAAAAgAAA0gAAABIYb2CWBiZYMFImtBam3JczXAhWZVGNIzrRBgKpWXYBIBrq23/hqHHrazKTJHzouSoGJ2R1HijS/39LYigFuz8P67VR7Y0Z1mZW+adUcxAtIsACg//sQxPkAAAABpBQAACEVnyR3FKAAbTLaR7XIgJT/ZvEYU02TddqAjJnyUkNBBY2uli6bQOEPvADDllMRaZL5c1OA4HkD/OxL3npovZMOLTWBQAMdgIIl+00LDAgwvQufJHdhxpLgS6X/+6DE/4AfzZ1J+Y0yBUO1rL87pEARmQT2U9b5nfvVbF2/UM+PDoJEOEgCD7MEE5MJTsBQgmHJ8JFl6HZiMKwjtJLKWpMzFmd1cpo9UuUs3S3bWNSdx7vk/jP2JXnL917f/AoeWyrOyJZoJGADADAIAAIFBMTACAMw9GjBJCMPRswGPDIcrDEOZyXpplBmMGubAJJiVjGHgwOmc1eczAIcMjmgzGQDR2gCGMwRMe5M6ZRhQpC4oINjwYz5ERAgqnMCaMGNCokeGBwwu2zUqBRYcCjBEDNgJFippmaLwhBCACVQg4HGhYcPCCYXImXFtGADIMVjTUy50vowgDCVUxgGYIlClrw0wxMNTMElEhQUpEtgIQgYCSgjFBQEGKoReTGUiQUPMkCEgjDEvI47RiJygZjD4XEmZOpnCgNujMS9jpoGosr5WBbCW3gZuixH4edU6YbQxrIABLOEpwcMBxMGk0GS1SSUhXhBqvVY56TR1pzLmGJiR5lKg8+wx8ocS7vhwNZQODpOJbMKSRTNaa/j8oIWnKHVVispgBtG5w6+zhSNMl/E6AMXc5di7mIQJAMPx+jrUL0u/SPqu1s0mSKZqprZdh0WQyDcNZ6qb1jhrWv///////////+ZYcyw5rn////////////w3SV6GX7lWpFVz8ing1UAAAAQAAAEIsesgbF5AOmADo3/+8DE0gAxoh1V+c0QRNtBans1kAmDZBkzj4QSDGlwImB0kRBCFavUxQU1FUEHT2tMA9kzdwaCFgE9WytFXY+SqoZAbiBMohYjMwKHF2Pg4TfhwQuIAiUvUu2SNLa84i0n6gh0GNFuEUEMlCVjBwxaZNJZKNwQM/D1s1lk8ztCeDgFLUvC07pKbZqimo840Mv82Z71Gqd+W7vyELAIYuKkCDAlITjXF2raXVForGXJgafsUbfzta07yIIGPZ2gfAiKLgxN2XZhHwiHJXDUOb1OQ9e05WMNUku1DF9/FKXDXe7TXJ5iUNSixG7UNxaYooxSzk9TV8e5TE3HO19WaOtdtX5HjVilmGd0dmQwHFKSKZy/OYy1l3L/////////////////////////////////+oMbHjre9tZHIFEEIDAEAAEAgMCgwc41fF8AUbAJM3FU2wg3OwuSAnhjCxp2R1Z5vqhCHARUxgoBGjGwi2KaeYwHMSSM/NDQJo7rB6BsoUEgQwDgj/F6gFFEljE2mv2zwxgl8AguZIiY54NLQwyBqRiGrRHOf19osnMo8nkJDgEgVvMGLCFBrUJISMWRlUtuRClh0qkCJ0VlwAFC4pTUiFmSMFYkMKM9LBovLA0zQQqjmaRpXgoCm61WBASIMYJCgwukqsTEwwQ6K8gcTsRaU15Ra3dzYMAQCRSMbmrGg2BofQyAgEcGIsAkIvx3E3oEJg8mnoi+uVaZwrZY+3WnZK/ttwLEnicqpncZcui83R6YakUnjLD6V/KeRQxfnMsc5bjZ/VnDvXhlMByqrLJm/yMRGzGc+ymPRW1nZtVMbH//////////////////////////////5brcMidzMuadWWVhWMTIYBAAAQcfsg1Yt2Zbr6iKMCgmMWBijomIUA7kOpTrLkDAJMyYxgEFiIOZsCZc6oQFSaQADKGoahUqNGzQkTAAC9DbM5bV1f/7sMTTACrKEWf5rSCMIbMsvzOiQBAEXWlWj2xd+1n4KPr4yYc88OpIMxjc+7DytWXtKkcn5lUBvy/sVaQ8CDibDTH0fmULWYKyliEnh+ApBILVuQWmcMMXX3PtNMT0lpH5maGpVnZdzK/LJukVOruL08N13H19DWl9mR37j9TV2GaS7yX16SWff+tzWtRuXx6CYKnoxSy7dS1KpdR8lMxbypatnet48p3Ewo6SpjLLlSVxvONz7A3FgOD3+iLS8IYnYjHJFQy5n/8uz/9N/fy6U1M0IAEAABAICBYebKgOMdWEwGNjNZXC4dMlH80wIDXscNXJ0VgpldCmcaCYXEBkcLGHiYYFNpiNHGIAebbw8swk2pTYOCzhljhDQUQCpIFcBAhlkGM+CuFjloQgwssYKCDDWClMilMAktsXlRkLnLGHRG6qOGRGCdAcqnElyIgguKm8JK1xpZ2lXF+mnnOkakQ1WYQqY7lm2YFUn6L3megLTBYtGxFJG11k6U5wcQi01tqKPQ4M3Fpaew4EmK6SExtnBSRQvTDLYxdYqyI2aoQFGZCXaJQ13poXoYdtUC8llQtbSciKDCmVCQTd9vitFwm5rCvMsMnExlHp7V3LUeOGajUXdHhUcFdrlVrYJBT6IzLwlzIEv2Hu8oAvZgaPK7U7r62GruJI3TQ5oBGlPpBSgbgK9ftqruxWcft+15vfQsWtv7La1manbkEOj9r9b/v6////////////+a5zLt2znZ5////////////d6lCTwPb+YZ2nDWTVDMsEFIsmt65OQxxiVhxddhqKaDgXJmPF1FKDAgCz5ELMcFDhzKzB//vAxNIALqoNU/nMgkv/syw/NZAAkhO85CCqVIEQF1GsGAujUUWgBkl9pDqaEwT8MzQbbDAT/FrAgqIMSMEJg03L6Vr8Dl/W4Pc0pgVizD8EvlJ2txfePG5Su/OyiJw/EuPe9VHAziQW/9LlSNxp1hX+gdxqOfh6AOQDJbM9QTsXqUD/w3TvxJYdgKRSiWXJVLn2po/IaC5FqWfkcqjD+Umde3QWLMNw5FX7r9jEbtV41Ou789cmp6vapqKBLtqKRS9cqfrG3nboW4tmfWNP/XnrXIzqgpb8G7huMYU1BGJbTztW/9Gq/sdlcjRBUgMAIBAQCAQGKCoI0B5bAEgEggwUZU4yFUBEJJBOZc2LClFU9xIcQnk/C/DOhZwH6NPBWjEchgITL+VpTdZ+kfPKBr6feBUN050ex4hiG6hZlE5+GySVrzvBkFLlUWShQhQN0ljlsEzXgfFtonTQhudti7KpU9SeI0BrDTFLn5h+SxlyaCQYKq2HfgmGXdetQN0mv3YKbFKo7eqSKWv5DEWycRmzxT7vw2/PbUret61vyPGXwxfiONiljNqM5as0k5DEqpqenn+znwfYns52rhLI7WxpYtKqSNQI8+dSEz9Wmyv1aalpIKs5UE7doamP73B0ZpaWX253c9dptT9u1//nhjmp/4fRWjf15E1MVACACAEAgMEgsPAgNmdqIMhgAwZYyboxQYKri9wcFFAIMGhQULDAYKdgAFDJiEQTeNmJd00wN0aquFwSNe7wiBoD2amsvUOU0Qcgx5GpPYEdFMi8wXxRQcCX6S/THhmq+7luKmMbBFogGNpJpC3FWZ2ILXv1uT4S6JP8aYJmAoBjudDBdrmKlbJH40xFS+6zOZRSd9w40arFzDvwRJAB8hEZNeQMKYOv6MNuuuMSGxEL9+nkFyHhYCFyGxE2IkymLsXgNuLnzbyNcduRKWW845QyqBuuLQcyrauL/ZUsOw//+6DE+gAh6Zlb+awCRPTDLL81ghGGWVO5Ab/QlrEVb+ozh3JiBI3Yzlc+7jtRXO7WocrFmPZ0Ugz529Qw3Zh6Hbu7GdStuW581lhz8+/rf//////////////////////////////0mFqv/LmVFY/nhVdwJAAQAAACAAAGRI6pCOLOiCKQBDXXR5Cq5OcAOE9xksCiJILA2YzqQqFQukbkpyDCOEAYoCWkLpScaE1luKRwZhIZzmlK25KaItOuzeB0TUiw46zk+XGkbmIaNvTqbK/LiFmA5BjSx6A2ArpUGhxnMdVsZgwlTqNOuq5X692oNLTVmY+yqirvFLrsba3Dj/QI36RCkFuKbt+/8YsUsXnvjkQls1RPzGKfFvaeXLEYhLGd00CM7c975ZB8tpn3jcVhmnqU87Xo4/G4vEr/bGMOXpy0/F6H5XVz1G565F5bEJ3WFNE8YnW3EY7LI5dt2a8ivz1avY7QTEYqX7c/GJykwmKnb3d//////////////////63/////////////////27qdz/F7ImAhASAAAAAAFLL+G1BNaOgQR2NkpiBhRamJgThiwoLKmfKIHGDCl2CEWIyhjBQqkYqMi1elwjTWTHvTPiDDFwCIAAVHRKpQ40hwLWTfDAdjU1aHYUGnlU2tOOZOIApwQJNASHj08qivoHAVOlhU/VP/+8DEzgAlAg1R+awADO01qns1ogAYFYuYBYDsawwyJVOCiCgSSTTmoOTIkvHjSibvBrqjJk2hMUGOIDSQ9Z8mDsZdRBVWJbVMpix2MqlmHcgsBNVJAYQZZAasYLDCZ2DBQKEL+cNW54Ik+r+wm26V9n8HR6K2rfUjUPFul5lh0zFOF1pXJFtOdWw70tpn0iFSrnUqX7j0ujIZi1br8WlBD8pEMRdV94XBLpv0xK3LI/DUlkdL9fKg7BeWeHMJyG56tlPVqtNXs5YctP9SQ9XqYVOdlH/ccaw7/zy6lfl1EwAAAAAAZiwde4WRQigEoE0EwXytqDRl3FYH/WDL1v0OCA2BwhcA6IDiiiqUFkDimOJpKpmNHQzCLlz1jBwFMAoQ0MATCyAEYoNEGRRwDIZwwNKt22XsrUUZIpWFStPRmL8Xlg4QQAOBkaEiUcExGKMRgNZCHZUr6MDUvdNXCY7Oi8C0Wtq2LCNmaw5D2sHg1NNrzC3beppjEHIhyOySklbd2vvNKe2rcxGpBWaRMTUHuRDs81iKTEca47kI1BETYfTX4MhycjEtaxSyKpBEYtSi1JIxKIcjEOVKtPYwrXqXCkr27EspLEo5rVJL6/4yixhUwr0+8+Ycsa3vPf65hy2eSHK4dsrD/9LORAAAnqZorDmfQstljcy3KJyZ0HKYv+9yzWQK69TZ047D6mS8zEFMUtCIgoGruh1Ua1VNVgkzm3gF+WyNPYg3cu6iatKAmEIjTtIoFOl3mKJrOw4LyF7h4y90qX7bow5Htaq2F7tZpXEaSpawaPv64bittoQhKJhKjDonnIFh7UobYuJhuVkwlEhQKwoGR2IAUpCmSUhLHxGlTMDuUGxOI5VucjqTRxEURQ9JswHyYyEa31MRlzih2Iw2ytM8szZlTUKqH5JXbpOuhZm+vGKXizqtybigtgrsW5zznf+l/YmEIwAAAAIDGBnPwBAGAAQAC//7kMT/AOFNoUfdjAADgK+qOYYn0QLQBhE/LuJnBNowzSSzbGPmO4qxxOtGpw51ewMCxfEZPnXDcm1Po1NnYkoE7LHVDCn2w5W854ysisbUtUS7Ed5C2lhjXLmrFAwHYeB3jjS6ZBB4roVlRWiICMLhtaoLQVEDETZ+EKYICBAgttzPkxkriu2jYIFMb3y2ptylk9YdzjvdHdymeZn8/IuxIhdaucw9Etio2iY/Ll1MBAQC7HhCBIoHWKplRI+iFYkktS3VHLUOMDxbFGiovN31oIsoKoqA2A0zAflIKRyDkyFhbNDMsk4fR6OUhKLZdHQyT1HAlFUcn06QlGR2DVYUicU+JJkSSkehyA1UTmRCVJQWKiVsRD9xEQmmkK5IaTFNDTSGBKieuZIYxWZuEdZiQoI4fVVizt2hVYE1tOakUTS6eTpZCNSWfkqksk3kY0jZPyQCq1sdiFtzK2qqoMgluuRTxpdmo1zKoKr8QwMAAAAAABoKVYFCbhxFF9lYs2HlKWCohqudpNdLcqAToZkI3NfEQkE6laSQcAdSj+s5pv/7kMTPgJVJe1nHpH6C/LPr/YYl+awzA0hS74oBPBdC4RCNnT0LAKDxGjREa00aBVFWiJUJ7g0oWAhNf1JwFBdgu+lsokpQEBZeHVTRm15QHQji2ayRYSLETiIEqdEymYtBJW5VJFwLoQc9w0EcU5O0JPw4DhZ1Kbp1EsIMkzOcmBEE9URpH6f7IaSScCFoakENX0eojxetzAqpp1FDeYUzI+YnM3gqbPKqiQkn2zDL0BAMoycH2zAhq5oWM2ZlhWaSZ1uEWVZ+Ck6T/pleK9s9Nb0R7hV2dUa79GAAYQiewy8RmTJb1IwvEHBQoFJBLYxEMM2OMCHMsvAJYcXGOJgCUZcClaZFyWGCCU8YANcgUcAACNpsACQRmVILMGlTCISF55yypuA5lmJpWRqSJlzhro5jVBkRIWDESwP7Pg19zbEO1kxrwMacC4gQAKZuoBZ8zhCLIS1MsABZARUxXgEaIUR5MHOIVGAAIjDCJCSiEoQIiMwUbNmAiJDgiUJYEeFHQVzDJZlqAwtbZgqAKRRtUxMmX4GhyikHAkRgkcAQQf/7sMTggd89mUfMPT6Ngbnn+ay/KUoXWFDYbQFIFEiIhAcNDddTKaYlGBJRcc1DUBydTjPuRMkxY0MlC6+REKAglBUwUs1zKnXiypLxu68GRKsUAxlYSEnSXP0YQm49Qr701l8kg5UsLtOGE3mIrVcXE9mNCplM4LR0jcTbioTmPBdysJOmRIolJHOoV5ia3BgUMBzu4K9sV7AxWYY8RyV80lLXet0un1PAxeaxVirftkEAAAAAAHiHSCxjGwCnWUPNb1njQltwEsl0JtXLjOsth91NCEMTYGzmy57P0HZCzdcEdawksom8bwLBP0+78qJQpeOlgUUn/dpXrbuzFFH0U2DBYyXKcXIphgnC9iG+X8mRd1eRyNY0chiaLMrCGFkwFSLGdh1mmpEVAUBYkKcHE/HGA1DCcTkeqJRJlGG9DcUesvGndXk9llA5zDSJliyWAdFjCCZvCkZCirTJFsWo1dnL2ElIQXOS991N9/rOjOVvwo2sNXTbXoSLzH7NKyAAAAQAGafBSprAomZ0NCIUx1M1lC20B7LV1SpnK7tPbJ1VaCkbjeZbLWuZOTGFSKUrHaxRTkpWi9ow0ykF8HWSAvJIW9XscIuBUL57KFXMEMsbGhjrBCTQISciwgi8Is0EiSdwJYco5hYi4uWEA0nhWDKTtDHyyysxnxzHPBRnIp10hjGxJs6C/nw9fquI+UcrZ2qOzzUYmVymUclI9FfIyUc6zwIsHgUlXng6T3/pvUrgm0e30hN3jlQbQHbKT/pAtPOe7xBj6/hfT/dV+XdDAAAAAABYEGkXclwLCRIRBL8NMCwookAoKiAydH9hDbCg//uQxOGAmcV5Tcw82sNANCp5h5rwm5qzO42aDlhlSaTDRrcUvCxJnDF16LRLmtKok9FMkOqeL6loUJr4oPS0vjA6PTCVjJdl0lyLhXPDcBuEztOpNe+nRLFL3hUzT6TqW1ElD2/ftvFh2Evm3FGt925KCs6aMzZnWLJYS0V1IIvvJALZnKutdX4+E5nOTDTn7iEN8o4jRxRxo1DWpHfmodhp3oahnkSzq284xLrl2rK+/cm7EZv2/jep+nsXaKpTVsJqryZzsXc7Wu6v4VrVvC9+secwz5jz+WRKsoMa5izGpS8rv7CsZEIgAgBAQAAAAASHFJTF0C+I42JnQb5EhYXVs3HBoFEm1PgkUW/GgrETCHkbWar4YqRAIdWiKHp9pFp7SpAg9wIAQCMSlqeClrAmDIloQAoBDaAB4BnDYGvIhiEh5Ig37CsC+JkgmSKvdRikYA3JRx632baqlTAj39CgA2ULOF04k6bl13avS6VYO7LGlwZKH8fVa7WzEAR/TFDDy/jyvTPPzORq3bwl7qvzLYpVjtaVIiOU3kwxOG2a//uwxNgAHl2HSdWMAASvwqo/NZAAtcduhiXyyluS+tRauW5+nf6V9kFWK/TTr8Ria3Viccrw5nWe6vPT07JJytN5TOWWWGd6Gb2UtqU1qzjXp8ak/DmEsj7E4pFJfS238uV99////1///////////////////////////////9zz1U2l3uXLBmBlASARAAAAIBCYlBqUOXigEAIMOI6FjKqLMRCs34eTO46OjLAzJATVqHFQsaVRJgQ+GFzEZPFBnEwBizMukoITQOAiSZiMgGPCSaQEY0qgQLggRDgyMOhERAgwAGTHhwETYM6Hk0AckECgQQO5gChAQBEAgEVBJg9AmHyQYTPJp9QAIoowggBqDhAAMPh5Z4XAAhCaAwvcPBcxkrTOkOMVCEw4GDL4vHAOhkCgSFQwWWFgaGBMoAAUAqgqJzSjJ5aLnmJUiYPThgEVmEwKZLBhhQKkQTd8eABQBS1ZEAU3EgleiAAioDMCANlphYumDjsZLChgIPCxaHBKYSE5MNDGIBQ+BQKRzSNXKpU9S40TVKAaAmvlyk+0qW7F60jwaEzDY4CwCFiCBAOYIBJbIwsHRkRF4klEf0vBEAEJyAJjxUAjKS+rbolISEWhIDJRu43R3C/kAKWO6BhCtVCuTrUQeHgsw8gAL1UiOC50iGBJusvTECoDbZl6/4LcBsbZWNMWbo1IOBqf6lpfAaATxrfYNKGnKARZtX+VkQLpZFDUof+gosZr////////////du/SZa/uWX///////////9i5WrX5lrNA0gKgxgKAACAYMFws0GIBCUA55/TDDTGngKJCDBzDYqELsmP/+8DE9wA43gtH+c4QDJU8a/81kIgKkw0swFT4BIF4jHJZUacxjophsBFpGAsgNJ5d4gSB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qkx1ZneGZCBLlAABUP/7YMT0AA+NZVXsGHLp+ibp/YMOZKfKPUVlg7BKFg/jrQnByQygTm3Wn1oZGqxyamsNZ9pNSaqGg4mJQIHJLfiSHFd9VJJZStVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVf/7YMTugA5NR0nsJG9ht6WoPYMOJVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMT1g8fEdSvjMGdIAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV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9Jh////////////nq16W0tXO47kXYAEDABAEAAAAAECkRFTOKsxERUdAIURhAQbdUCHXJNjRS4Kw4CCr3NGfEgYcOaLkvZau9OtLZdzVlcFvlfO+3VOcMiW0WNwZA4K5XdkzLwUAvSUBDy8iqqgKRyW005xoGYcBhErInDbcHqDDTiTB1heMQhuk7Ttww11+liNOpGhx9nY1KFUzCOOAdPUM5GG2yRmEOBccN2adg7W4fLkNdUvBqhugCVZZYsCA0YGAISmitOhT7R+Ho1rCIA4BXEUcpQS3GWVyNnzJC8Td2Mo+MCLpKzLGaXSQNB/Zda1M/QzD5Rt14ba249Lb7Vla7HMjEPsNexq8V1dtteo4lEbkhpa0qfeQz7628Y/jWqyJrjuYO/fvX87cOUWdPbhuz2RYWZblvn///////////+/1////////////////+dSk5L52JKAZgRAAAAAAAAACGESmoiLBgRMqUqhS6xnJIBABU01owAkFKTPDV0kwZY5gwhxKnDylMXtEAKWhssh5xnKKUwClQXRUwFVAKGXzaYAUskvX4Q7AJ4hABghd4FwBnIRGOkBcZOZhbBHxh9gbXwcK7AOCB+LBVLDouMpY0mGlRBzXGdNYrQwMKCj39nX/+8DE6IAodhFP+ayQBWRDKjs1kglThpwzii6cGRkAHMudpyGtR1JHDz+riZ8vdiY0M6tqBQdcdC5m2HEqZotDBZhCmYLMv6/sdXC7TgxSXJeuI9w4CzNQZZa+k2ga+ACFjU40GgoSBFpkyAACKkT8Zf7T/U0SypZiUymCHwde/KWvW4CpIAaQiSsIggcpTt7HjnW5M8hpVz7P28WEhheUunssblNq/cvyRwl1XYJsR3K8/uN6/PTzrQRDsw9UWo6eW9////////////y1zWP///////////////hhh3/7bGre52VjFQAQAAAAAAAAA1U1Dh5w+fEBwkQDgRJozxxt52gZCCAjAYBsZgyJEioZRHBJxNEGgyoMMOhbgggBBROUsyLWjED0kRoURAAcjk7ZwEMAhqIGSOCAqyoYBEApqhggBbwvYloHBzEgAlSChIBHLHMGIKAKpAsXQgeOEJQoJDFAjJAwaWEQxNAWVwCgHCxAHE2ispR1BQgIDgEC0NEdEBWxDVPQ1QIMFiMUBoQAGiMAw5DUt69bxM/gBTRri5od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","options":[{"letter":"A","name":"Thumb fan","description":"A soft series of fluttering card edges.","start":0.35,"duration":0.57},{"letter":"B","name":"Riffle shuffle","description":"A rapid cascade followed by a squared deck.","start":1.88,"duration":0.66},{"letter":"C","name":"Packet rustle","description":"A few textured swishes and a final tap.","start":3.5,"duration":0.68}]},{"key":"success","title":"You capture an opponent’s pile","audio":"SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYxLjcuMTAzAAAAAAAAAAAAAAD/+0DAAAAAAAAAAAAAAAAAAAAAAABYaW5nAAAADwAAAL8AAH/AAAMEBgcJCw0WHiYsLzI1ODo8PkFDREZHSEpMTU9RUlRWV1haW11eYmlwd3yAgoeKjpCSlZaYmpucnp+ho6Smp6mrrK2vsLK4v8fN0tjb3N7h4uTl5+nq7O7u8PLz9ff4+vv9/wAAAABMYXZjNjEuMTkAAAAAAAAAAAAAAAAkBkMAAAAAAAB/wB0B+V0AAAAAAP/7EMQAA8AAAaQAAAAgAAA0gAAABExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxCmDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDEUwPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMR8g8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxKYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDEz4PAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUCA0PAcLh8PgUCgMBg//sQxNYDwAABpAAAACAAADSAAAAEHxwivdg2ADkLt0AWmAaUn4GIkoBuJvdM+gBqomALIoDRwE9NA6bgZPFoGTR4BuKRAcMRnyJmDIQNJmsDQ6BAymGQNBp8DV6l/9oGPQaBn4mAVKr/+xDE1gPAAAGkAAAAIAAANIAAAAQGcxyAoTBBb+zfElA0EWgGi4BhUFgZRHoGHQqBhkB///gYUBQGAgUAMIBW4boBgCAKBAMhh7////gYVA4NgsMZmIzgsANnBPIYzBs+GJ/////yJv/7EMTWA8AAAaQAAAAgAAA0gAAABE4XDQZs2JwnzebmZPuh/////////yfMzcPw2quVKVUiNohNO9VQQgQKODgqYatDH10zMBLLGBAJcI155OY0jWF4ysNER+eVNGpcRqTuZIFhZWGh//sQxNYDwAABpAAAACAAADSAAAAEEtKYSIDoOFgILkZdYzIEEASJAQQRmow5ppGFiExsSMLFzIAIw0EMMADBEYHOpYFDOBIws3Dh4QgBEWmKBRh4CGChgYKECQhATJScVAygIAg8GCD/+xDE1gPAAAGkAAAAIAAANIAAAARa9EsOFSYDSZBQapeQAgIBzBwsiEzMDAxYeLYAYMMVRTKR0IKy7gFCww7GhwcGTLA8SlhEXjogYGPmZqoCCqUwERMsAgw8MJKDDRcGBBmwMXYCwv/7EMTWA8AAAaQAAAAgAAA0gAAABAYOQqYjQAh4YcCIvg4jYC0wCiIiEAcYGEBAgFgAAM9AweXnYetNW4s6wUiC5YEBgEAh0MMXDw4TMGDjAQ1ZyEiwIhABFDT1TraZSnkykGBSgigJ//tQxP+AAAABpBQAACM2wiP3KVABfAwcNLrmIhJhgQYkFmCgSujDQkaBC1IKG00yoDKELiQ6l8zDhYICC3DGWJMsU2UQd4wENMHAwgCJAlhAKAxoGZGg4YGCo2EQwXrGQVFJZ5cFFYxAaft+wKIsOWuXcvKuf9pC72BLMZY8KO0GoqMsqWJZZz1UtXuV87f81reeedfP/pjMxAAAAA4Cf9porNB0kGqgF1K2Fv5SgRa4oY1CCXbZwt+dbnB7dHQaI+i8nVOnUmLG3ro71aLYEf/7sMT2ADY50S/9vYADOTKpeYeaeYP1rSirV6umRxCw4yXoacg3B4Jo5j6RhlP510bquNwsBQCYMuEJVZl2VsjHAZm5PpNkcD8WKTHCTNV7WE6SdRynun2RBQHUJsjs/SCFphjQuMrIikXDGdYWTDpnIWhjsQUYQBAtJ/FkyZhYPRQIQIAAhZ4Xd20OZmdoMM5DCjGKUZBggg4ohJ+kFbafhD5h55e8SRf7QhAAAAAAAG0BrQGbECg4u0gsFGcCXjUseECHDIACoIoR88qrKjRcGSyUURHC04kUtYoAhQkEazwWZEARf9Q8ZRKCwSQa4iuysAw7jFIAgYkOYUjhKvKopiBho7qGGIPVBZ1HQ2ySsUMFFI0EhWUY6JMILVqRAyxCEOmowJVMKMkGvJPgIiNcSQ5DMUf20L5p2o7BiG4jiy4z1wE6ye6UzcxEIOGhoWQRZS1mRpSqLlKxpvhgFAWJK2SljSDCwqWjJWlr2eNvER1yRVNCjcNJV/ZU+6xolEpW8DX5AoG692fmZlaTd1sxaLPI3826s88bjzsMQJE4hWlGU7SyqUTV3kMQGCnDziDIjFihaQWBuiIPTdRJMsywuCsdMCKEFHpUpzrZ31MyUKOuEr/LQQOWFUQcGIWUVA0R+RYuJD1DDV+pmINoRMMKwEN3/Bx9kOIcFJ+YTpQgCDsnXM/gWEBCA2I1dO5g7KC64ucKgFQJXQoIWWkeILigdk4KeGLRcUELjqDuQnOWCgKYc8VECiInLdWiRHloXW7aXiDgkhYR2YHXi99lfDWmIKVjR0qmONJeSI0k087KaaysiCo4zxjckh5xJSzGcb6V//ugxOSB5XW3Q8zg3QvSsml5nCZ5w2w6Qw2ueG3m+Sw7LDwKhgMKvREokJyx0NjwqHBOcZDLLgHIbDY/JBFWLFo2IonoiBmZchx0H8wuQGKUmmjbSmih43uo1PaHGPcOwoYaJPAOW59F/6f+qvlVMAAAAAABU4G0ISGqWASoE6IwBbOo/g2wH9Al4CYLmTEOku+kCOEuYVBZBaBOkUJAPIvQvDeLsdoC0EuDUnQfYwTwG4OcXEGARIziYiTiTCfjwBpEgIML8sI4QLyGiKhsHIhgNkAfikCzrQfMY0XJEHWlUWniVhllxUpoHqXZIPTzVz5aQxkXKikil7enuXKKp1WkKlsP1Rq2eMdCfX2FlDwyeEgByhCKxIwCNgtzBskSRkLkaZsX4+91UsnJOk2UmzSGUGZShb71ELU2IMyaS8mWGo3U7XhUmby7zqRSbTobtu5/uhfJCAAA3UVbMU86UXZLNs7IRUASsyEovmISzQZFxDmAZWCRi4QRiFCRBSAiwYCr82lgJUGNj0BhCCwJKimuZAhaCCTQNBAUvMQQLiCIozkhLwC0iIo4xBiJBOAnhw4xRDVIEviAsHGCQaBghBOUNQsacL3msoCnQz4MqT3FTpUgOKMAyEMm/QUKBikNzSUBHLSiRwRg4IFVDQRKqPqxCJJbidFljmjM4GoS2EaTO9YVYZGQWA0w//uwxM6BnPWVVce9M8ziOKi5nCehWIPJhta7gxpgEvTHSVdheCGiUTlpoMUWzIH1QhbRYcOOWnGhvWv0YKtuAmwsTfuKLkbk80ScVzoYWbBsTm4jDTcHfiMsoG6Mgusrepp8Wj0mmOwt14UQg0JgqGWScNcuioTI0RcgHNC4rEcdSM/GZq42ffNAguaeKeEl22qneqejME3V/ZdSIAAAAAGJliawBxSSrZWwElCnMt2jT4U4V9N5Tq1GsQ/A0HSJiLkQZJ4djDttbIAnEUepJj+LoqEoLtk0DLPMeSHlMQooYBdk4fxNUNNFYirR3GyQwlqsWBTylGUikE2sKfOElJ0juZzKLAOZIj9WjdRDPLAuuIqvj1TatXfbWE7EW/kX0cyum+LJFbEMkVPZ9vVZ3BlhwHtdKRvYaxY9I1mXF/GCNAsSm3lsqqrbh/bt4swhh8t/XbMX5WoE0zHzX39KZAAAAAA7I+QSIYFoCVg3WLpNYLguCia0hHVglMla3kBQAShZvE2cuspUpcv5t4AHD0Sl7G0imsPCl2XmgwcAaRF/mXjr0GliP0KGX2WrUxaQiM5DwNCSeZ2q5h6YSZFIg+6bEUsY2Xuh1yBYaYpcldrAYk1xmKrw0ROgRoI6SY5Wd0Pl8FqEOLJDYhMlovQeBdTyXQbBVMwuQRpUF9jGHZrT6KL84mUuGw/zKU9jfajubkcuVM8U9z+Z0irTlZVRaMqWfSTb9PZGdlZYbpkqnJo6vvK9gOMr3DlmgVekrRkuSuo9PIany/G95e9bIj7u9DqMNqVUd/j7lVEgAAAAAAoI7eQlg2wkwLDCwlM3tUXkaCj/+5DE7ICYjXddzDzVy+Y2KbmHm9nZGgOe77QWdwMzhprBiSJ4MIRY9UaVSgOod4n55HwpyEC1uBeEPOwkyFFhaT1SAs4WhVlUwDRHUqYbUd5ckenIDUTAUsh51KlSjHXRxuSnYVPHQsqVYcTefjWojBSx+nQ+U/jnUZKOWlz7AaQMTXAoVEK2jhFIxZ8EDZGkOyG1xx5I1hGeJmXm5tV4vYSaowikmToM8lbizjKCrUnG6qpQhNrIY3rhrGXAmA1qMqSrZr+IVDEAAAGS2BUmZpAJDFs0BLAUrKRU0blaqKxLTfRuMOzQwlTNCPJUc6fOwYDGJOGpHEL0k8QdSNSyEqQZRRm+NBDWknqMSyGMYrguRqn+yJRFnUdpPHG8RteWNYkKYOtjXTehp6nMuEuwHOmE+pF23zTRKpaz+DTgELWYiGRFFoigYxIBurh8SumaKfno3JeajuGkTpVLy1dio2Do9zVVU43Oem7wkc+S6LuXjPkcn0uf0mxV+VQAEAAAAAC+FRqlGkLWVSRqLSsiXTH0+2/UoZw3rSTfAARUadn/+5DE04CZcWtXzD0xwtKtazmHmjkFBcwuq8IIGh+2hYGkaicKlMBwUFEUSEF3AY4F8GWaKFhobAkgFI/Q0BW5PRpKcyAZHhI1OmPNlAR12MrgpmqXqU5cJmS+BdTiHUwkJGmIYQNdhmGUH+Qo/B+jgD/dEitMoR4koQtTqonTIljEV6FNBxNBcTfXR+oQyL6Er7dRwfNa6zAfPH64RNsIUoVLDTqzK7ce6U0TVO/UaZY8gmBSzEmKWHA1ESJMxA7DL1CpOxeUSSK/aprqssJRK0UfrFU1NY/Hiv47mIAAAAMsFAMFLdtGTIQgDiP4pF+EJMw7KH6NIgDAQh4E4eYsoN0lAtw+inF0B6DyCPEzJCQAmQ+x9FMBIh8F8HqDPTIc6iDaaWNgPMQgmSFECK6Eij7LoT5dnSoTPJYllEnzdUllwp1M/PxWXTponMpj5Ss6lOWCijoT0OK6ybqEPoyifryHP3qkctZ1mDRDkKQ5ri5eMUs1bPa0zFixY2N/efiS1c1mr4WN78KM+3jP3bNa4+tY+LWvjG7ZrX5+8Zxb4tH/+6DE2QCdZYFJzDzcwy4xKPqw8ACxUL3fQu3Hg0dAZEAyAiAgGE083VnYMDiMEAkw+DjdsLNBohQIdARjYNA4QPqZcKgFAi7wKQTFAjMrDYIFFtqwYsDADKWOJIhAVqVyspDEQAmGmfgxhmslghl7Xl1IltYRxb5SwGjpFp9PTCJ6md2CHATMHAVN4fLpiwlHSu3A8ORN/22uvvIGcw4xCD6WULPlsLnIKrWJHKbDQos41WT07L2AJgP64b9z8RpaCjzpJ2xXpJFWeG3PvvOVHbcuGG3lUTZpQ2oIgGlvwzT6mKfKYvTL+UEgf2GqezWly95JjAlPUi8xLJfKLP5/lrDXf1/f+pyVc3hzLLvNZa26lGyiibSJxeWXKRwHE92JApSGFAKAQABAEBiK1ZOOkzT2jGDzZT2JGCkBcaYWEi4aoONgAoBMAKIoZnQhEWMUDIBAVnIqDAHLkJsFrACwakSkDAXQBhQNASzmGC1pmAwQZCQNLKogqmLCPvCmmuiIA4GX0GELmZalDDa/mVLETnaSy9XjBHZUtZInM11I2AG3hbcmBwxXfaKfRu01d3G2uRNlzI35YG/8zpsK7kPVVLz/RhvI/LX1lFPH7Mjhyki9n5NanpRqQy2HorI6a/XjcPP+qSVvxbk96UxyloZFcllDBt23VlOs7NBL5Vct1q9e/KZXIIRF5LX/+6DE+AAg9ZlR+cyCBD8ybDc1kkAonYr0dPTUOcP0NFW7SzeNmbkX1K1R+bGEpywl0ul8xRXgu6ZUv/012INmZkIAi03L2ilCHfGVJqprl/kLUPYs1pJFwk0lL5REGdjkWFZ81JxAEp1NaXZMs+eKjy48nD541ZT3KoHzhImTpKRXSOmrXrcaXWdWe7tFtVcvitFrnbttS+UmJw2GsOXFJy3d0yK73HUQoh72ukdFUPWJu33uUh+7DXh3ZXCxj/2/2f/luoOhIQAAEklPMEqmbhwVroajo1aS30EIrNYp2/ay7rvstEpCME9s0XQKLqikSGxEKuTzIGkYpZb/a1m3+UtFyqJDtKtdTIuQyWW1C2VSqP6AQZ7ght0dZWNRQsSqhl0zY2CiTGlXYd/XLnqUtln+yHQon1769/yh3giWi5E9rTTLkuP+X/t1yUBnAjAAAQE51ggCABQGONICwI5PE0lCEJIJPXFYGqHwnpykpL5PdWKk5ifHpzYtnBOPqQPsmSeBqfO3MtlavUsGZApIGU01EizaliWNHXM1VS7DQ1KzAiUUpoSwLCRo5Lx6XUUHbWAvb6TNWhU2YmN4+THUbjba7cNgPJDdtgVMSuCt4eWhOSoKYERAAAElPYIWgosDIFplmBZOdM0vyg3HayaEuGwuJI9JC1Y8Nys6X24SriHhitUKmD8s0S3/+3DE5oAQ1P9t/YWAKhyrbD2Ejf0aPXXavPQLl0MI4NGWojRi4q3PVhTM0UILEhTFcgp3GnRVU83eiQakyUtT+mJI49+dds1Ztu/FNjacpzhG0vDjL0NLDg6UIcnPnhiuJpnq9cwwhBUAAAEFK9BKkWMlI3shReCnA98bAodAIxXvlCSUONhb6Sj7wFMETzDZMW6ql2XRho9AfAJHB6JiioIvUY/cZBxLCw4WobHbFSPKmmpUba4OVtNuYv4axNJS9qvNpfrMdc0YzL1X0vPro/TFT2fxFK8bFHNVxyX61sph3qsPTSSa/IJJ/pftcGcFNBJLMm/dEOQQ9GAFhxAoK6Owm+zcOEgy2obXWJB5PYgJVZsdntYl3Orkdlz8oy5rGImpETqTUMKUSRXpKpMct9ShisMFAdo9//twxPGAEO1zWeywbaIdrmp9hg21ZGctn5n1ewU2Z8/LBOZHhQpPugViOiUP9RTAX5UQEzo90Rgqctfr/qXcYGMnIhTUl24LNIDU4gIRq6GgBYRsGjtLVmf6sIEPmXhgSNc9wcecl9p5kwK18k7WLR80pNSaxlCqFWrqzbMxxl1Q1b9YalBS6r3OgNDCo37ZNY4mAwBbEErQVzoaiNyS2VInVHpXsAAAACbhNZAK0NYVoQIBZl23k3UGF4PuHz6gccAmhuyQcsgdwJMsGhWMmEaDTjMc8OI2GgfIda4mpTb+Pe973vR4AAAAjDx4ePIEFYQAAAAGIv5sAA/NP6yKoJWnQMgZmCYXiYKgFxg4BqmFGMqalCRxhdgZhQJGAFq08QgJqKYTtmGiacpT5koHmBwoYUFJeAYA8P/7YMT8ABEBY03spQ7p0ibqPZYNpCw02QwWDjHixNRgZ7HWuT25buW/S4VcICi8oe6kfqy/1K+tyZwu2K87bpuUwNyIjNJEq7KokXabI6QQAAEHCzgF4DHRdIgBAaDhhoWbVDn9hYQC0YLwqRoPDLmDIAoLDZjiEUByJsPxigZ6d8SPysZ0XGcnLKZZkYErHAkhbVrUpDgc/eq1EAAAAwF4AAAN506ZExSyygJgoGHxwGaYHGNYYGMrnHe69mKoSGGAJlYgNCKX0t7VbsdKcw9SzV25/LcOGNiQ8YQuxmcC3sG1ygAAAYKCOogDF5l9GRiIKMT9DKhIiITRb88lPYxHAMmACv/7UMT1gEzY6U3sGHDhLgvmNc085TOMod3ki+UEn2cUsqpbF/mNZ6Sq/WLNC0z+5SqUEAADBgG4AAALpD1Wpp4MXGkGKJDCzIGMQYmJzhnLi/GHwSmDgxihAHAywi6od2+Bw6zKnhr3Jn8rMiEiwrGYOvmSgtXXEN8IAAAECgZwEqhwDaom22QgBTG6M14JDB81KUPhjZMUgEGg5iQjUFAaeUXHxPVcqx7O1Z/V16AbCTkldQHEu64juoYwAAEEATgAACHFB1BCy6EgxYzC0VP/+1DE+YBQIIUp7HuC6TAI5j2/bMwfgczGKjHeuPh3ExaJDABxxatFHqO4VXqPDtoKGgq1t45QyY8yPJZFZ7b2iJbwFMMAACA4DcBhq0l4ohJUmLAGaqk4Mv4bdqdOjkEDehAIhkDKKto/fZKbCVXiEllFP/6iYEPqx0gOQz7FnppgACcJAfgAACZiC80EC+yWwIRhoiMkAzCMU46oMABS5wYMxBb7AoJ3MGjjg+/J6W/+M0IClnWX3/uU8IAACA4NYIF4oEBCSCYSboOFQ4qE//tAxPCAySRHMez3ZKD0CGZ5vukEEeFRJsKEYumbF4xhNmMhW4Yps8P/OkAoZOC2GYe9qjt5kAAlBgX4AAAxylMSU7ADBhxCygGQjAbYz2hBoEmiDFG3UCguk+4DcbFPhjl/6mR09NWmCUz++8gAA5CQA4Ft3EwwcBa4ckL9KOs6CJHAwEUA5GEHA5TzJ0gGn/sgCXSYVoJ/2AyE3f6Vi3AACAkLuAAAI1DqDxgAo9ASkkWQ4VD/+zDE/YBI/EUv7HdkoQOIpf2+6QRxqFKcGzCCGAhwfJAO1qS/UGLbD90kjk3/ugJTEbpLcFk+q2rgQA1CgQ4EkdNAQBVhQBr+Yoie06TY0XEpEFRoRiEs5jsisfmIbdfiXUtN//iy9Qm/z/QqmQAAAgACvmQADiCk6s9OcjDg8lBAOhIVUDew4xmBCWdGlpaIAoz0AgRTtTJkLtT/+zDE/IBIlEct7PNEoPGIZj2u6QT0sMOGVtI3SV7lWlrQSFBWLnikskJ7GizxH7yGWZhE9NIvJjFYZZODcRaYRKHKlLJRRq9OKdcQYT2M4xI7yHAlhQQpUDI0gyqpGiMLRgdUYWqgqqFqpC1UZRZaqo5ZaqLIs/nZNLf/YhUACcHAegKZPjIW5PSn8VEU0i1xt7HgQGLDIaBZtAr/+yDE/4DHXEM17G8koNQIZjhu6FyhzNHL30yZL85XrSn/3WQEMWDcsLCyOmq8xACXCxw4AAAvyxl6dAOGdkNfKQK9Ktpx1OmMKFgFR4n8l/wG3S28fxP/gkQKxnoDn9O9tEF6XnwAK1WPPS0YkCQiR9h1CaP8kISZEVkyIjrSbBWn//sQxP4ARvBDM+zvJmDICCc9ji0cGg8Wnv5FMDLqq7QAigsqOAAAOXkwD6ggCHcgoPZsSOHQ7DADOOxJl/O9SfhIdNL20v/uTkUcTf+iIpQBmCgw4EnGil8jIRRVJJgwNKH9BrODhK3/+zDE8oBHSEUx7O8koM+Ipr2OYQRnFeK9ngBk5RP0eoPgSIxCv+6apACJCCQ4AAA3SP+zhMcwAYeTYX6OpTkpnLBARStuAqBjEv/y6PCYynYIgSf/kWeGAFcHDiAZY1pluSMojGCMUcTAvOqGEIQgKVy4yxH6nagFSc1s/WHVDiyMOgn/TbzZEMwNbgAAADWdJG2GF/1MCNc8k4D/+1DE/oBSyKEl7fHnqNwIJb2eZQTq2AENYR226yuk8COcSy9ILQKSrxAAAGAAf80AAa8bBdJOTcyw/HUMxl9SW/EAwKAgAqBOGMSFkFS38BAIiy1L7rPDqZmjK5E/lLG6tPggKZW27oQh/5CZ1o/GYiVICWncDiJliRC+6Z5exTguu2yAR3UUHhXW2Bgjc23aQ6jKISw+HgQIQ2cEhwSEZsgPCtoUNIFUaTC7ajZBiOSCKOm6YnOGL6HESxEuGI0gODwI4gcPASxEikRpEAPA//sgxPUARlxFOexl5qCqiGj9hq3EjySDxAcQItMpEmeG9yTyHnmPZ6qXEhWFhNyAAEiEyI2FaD6AMj1JqDaE6L2WEfSrULIaTGieAUYaVyTsYUCiyyiipIoEokqKFFlmOOBCpJElRJccosKaYaaVTEFNRTMuMTAwqqqqqqqqqqqqqv/7EMT8gEX4RTnmZeLgsQhmvG00bKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjEwMKqqqqqqqqqqqqqqqqqq//sgxPgAReBBM+xpRyC+iKW9nckUqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/7UMT/AAUsQUHsIa5q7BskfbwlvaqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy4xMDCqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/+yDE6gPIwD0tp6RuaAAANIAAAASqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy4xMDCqqqqq//sQxNYDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjEwMKqqqqr/+xDE1gPAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqv/7EMTWA8AAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy4xMDCqqqqq//sQxNYDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjEwMKqqqqr/+xDE1gPAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqv/7EMTWA8AAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy4xMDCqqqqq//sQxNYDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjEwMKqqqqr/+xDE1gPAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqv/7EMTWA8AAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy4xMDCqqqqq//sQxNYDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjEwMKqqqqr/+xDE1gPAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqv/7EMTWA8AAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy4xMDCqqqqq//sQxNYDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjEwMKqqqqr/+xDE1gPAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqv/7EMTWA8AAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy4xMDCqqqqq//sQxNYDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjEwMKqqqqr/+xDE1gPAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqv/7EMTWA8AAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy4xMDCqqqqq//sQxNYDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjEwMKqqqqr/+xDE1gPAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqv/7EMTWA8AAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy4xMDCqqqqq//sQxNYDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjEwMKqqqqr/+xDE1gPAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqv/7EMTWA8AAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy4xMDCqqqqq//sQxNYDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjEwMKqqqqr/+xDE1gPAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqv/7EMTWA8AAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy4xMDCqqqqq//sQxNYDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjEwMKqqqqr/+xDE1gPAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqv/7EMTWA8AAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqoDYFcEcFgGcFcbiYGA//sQxNYDwAABpAAAACAAADSAAAAEIAAD/r1nCMKFT/XQYOCAhAp5WR/6UKl5o5YHRo1hMBQGCgGgHAdPoGcMKfAweAOAwkghBtuBhtESBqBFmBifJt4g8DCGBcDAQDQDBsA4DJ0XQIT/+xDE1gPAAAGkAAAAIAAANIAAAAQDgZtR0gYZy2/Aw6BcAwaAIDL4GCgDwGBoBwGCwk4GMEjoGCAG4GTsQQGToiX4gwEQDBAYAoBgGAAAQGAQBAGL4CQGM0goGIwYgGF0fIGQQWwGA//7EMTWA8AAAaQAAAAgAAA0gAAABABv8TgQ4QUHASROQAQLgYFhDAYdACgYWwbgYRQJAYKgPALgQ/42yKJjME4aEsLPHeBgBBcBgeAEBgkAMBgsBEBgwBgCgRAFA8BlgBwEP/i4yvJ8//sQxNYDwAABpAAAACAAADSAAAAEjCICyCqX0ED4WVkGD3xOQXrD8xmwbYC5g1R//5unJw6b1u6E3cgggIGWB2CDwuQLMIkLAgNQqlAzOf////oX0G///k+LkMS4bmx43PNV3ohgMxP/+xDE1gPAAAGkAAAAIAAANIAAAAQUiik5sYDDiJoN1BggaUD9Kjhl7P34TKKwA06ewZwOXG2ksgc1qDlsjgV0GGNMolSTRbpHVxWPqMMvWSnJE3bdtgSA1pqx1+JVs3YW77Xk8FxIPv/7EMTWA8AAAaQAAAAgAAA0gAAABCpFksnXwgMd99kJiPJENajAGwMgkkJnS+61l2xKJvrB8pchm1yIK3NVZg5KvmvsJaJBbvvNHGGPcsdua74Aites/MWhVVnjyOIzt3ojI2iRRqLW//twxP+AAAAB/hQAACVMw6Y/OWBI87bS43C7cSaa5bzM5kbiOHBzeSycZXWqt/B0VcRhklf5yX/7cyiS4IeiMpnHbh6UQFTTcfhyQwRE4+uu639BByg7+QI5n4WGUPBCXAeWQReGYfnPkT7SaXQ3D9LSU0/EcI/Qh+78hkQREAAAAXTYOj+bmAqB1SWQT3ggFbZQidAjbJ0MzhbAE5FshgwMRvH8LwKgexNwHAQzVfHHkkCz0VICSrLrwQquyZYVvmGOE2jolw2qMQLmA4D6r8f192VpeNwTUYhtQwuw5u4CEiB1iHSQdVKFnobxLEL7mb5dDfTA9EM+kAixXz7XKXU7YSANh2B+j4kGo4JR7VkNs3RKnHFiczNlC9XyEqZgssWGBxkX3X2WHn05Pdk/o2Z7aJfZl7pfM//7oMTngCIBo0H9jAADbS9peYeziV97+ede2tLKwde7bnb7eQsV+CMLj5NGcp1zD/zV+4IQAAAAAABW8BcgccGgwDjMhRXQkShVGBmaw6nUvR1km0GpU05rjHGZrScFpC33OVhZeLhYW4KoUcVDgbpZGlIXxImEEAMQ1Q1idIQEeVB2kpGUT0OpDgQhcCwE0T4sQtCPYk+SVKm2pXI7nghpMCTl7bnoVzEnU83QlbokSLOUxS4GS4Kh68ONDTPgvWk5VluV6EHSoSrcnkFTOJYQyKBYjscFQN2Ej7zkxhBIUiIRAUYcTnv4iOieZKhJjzR9BJ+haSKVRI6deZn161p/fBvZVeVSvvY5/BcauOPMXUm2Sp+6RCIAAABrAxRUGXWEIWWQ4kIizGYymQwxp9h+GIPdLow2r1SyDYabqgyXk8Olji0I5PuLksmmMYnghBKBiwC9FwQowFCqttJbD7UCpSKYMMyxD2ZUs58CSD8XaFmWfbOS1zZT1fLTYTg/E4wGRHnPw/VGdCuTTyPAiLeme+IZyNEKC8Z3slXjfmLDePrTOgLBDZcmT5xY9QANJlRhCGu/uMezoQvs+zUv+1Xtq29wOW+9Lthk5Zxb7maV+UIgAAAAAAB6xVAWCIiKGq2rpYQ94VAy5MKnl7NU0nNT8lyhkrLxQLEHfS+T9Zq3JPpFaG3TUi5D8P/7kMTsAJxRlU3MPTdC6ytq+YeaeRgQMqMwwlch8zZ4V/vg3VCakVEGOOu8yPCzEyho72ryZcmM1hoKCsbjkPpIsQRsehDhrpooRWlxVRkIacTfFVa0X1AlKK+gS6t5onKjENjo0x5OtACL5YiPUbpnQDK4D2KjYlKTdYUR3ezmCGSTIittxqSmpPeZTGR+hs1Ip+cJVvfQ/e6Gk86kquP8W3WxXgrHz1leRsUX1yswUr/5vZ8/sHzatpWqfuv0j9kIwAAQaqJiUy8arESlRCTAacMWBsTDNFZZ5VqRK8Vjjy0kwIZCs9QQpETTJIBUNgQFYxPL3FtRhxkII4AEMIjN6gLiosEwRmEhYFLRXI8eFwjj7AsAiNHjTRXAyhMaHXhVEMCACQKVKr6mQCrDwxCUDnEljVLBojDE+DOAWsLBKkRZTGQAkQVALCEAw4u9LDxZMKALLLwJCOC0xeKV7KEw04Fal7oAKFWGGE8WFqVvw7zSW3TMd4tg/TsuUhEBhNOA05qrlv4vxFBMNvGwOy6U4viPPzTv8zF9ZFinXqs3df/7oMTjAdyZl1PMPZxMpbjo+Yym+T7OG8jcohMDRGFSVmluMNnsus0+FOBHY5RTEtgcA4HoyYgEAZbSFpoH2JJoiRR5O4v97CC2Pyi62MKvYxNvk85wc3OTGddJzar+p0MQAAAAAJhLUuUpSmkNKUCRkaeXpU0eanbMu2CJE2J4rBxEZDUBlolPI9TwzWNUm6NPU4jEOg5UufqUFQOJvJCWpyF3OUnwcJOScoZYgpKFUhRDZyXH/K1Gyni5Nj+IZxJDLYVYeiFJ4vQ3khbLtmT5USSoMBm1GuXIfFZtFpwrDk8qVsbhV8xdUerVy5xPV4mnx9A/BKKv9BCmV0veP9XTa9e/l9N3Jb6WvnrbR5B6DUOAICjuvR5TX2/sQiACsEJILRkCUPUTSyatqJC+gclSTWGiqXxxr0JgyuoG16UyKIuEhpLxvkFH81EFYDdNUOhWIZGQhVOZwF9JgPQXVQHqhbOOZUE9GOuj0IGby6HpT5uHGP47Uoe6EplrJQcaMMhKJaPM9Kg11dBSyUhqiS5wrqKsNyneJk7Wdcs0qHv2NQSMUq4U7dDxNCfBQoYZgHkLWIV7Wxy7CTCtT/2dVGPnHGHQdqC1N107yGVdxYhSafBRYxuMErQpbE3M//3w//1V+ZACAAAAAAEwKfdyS7aTRECugnMIwcBSxL9rDYn8bqqNr0YXIzB5V//7kMTWAZeVVVvMPY/DGizquYemeUuO2N/WdsQh52WfOq8D3NYgOwyRajy0y73liKsDdGo3IYfynadAbsrnHIMy8KV5WKpIeH4RBcbmxNNh+EAvtK0ZdDszJw+HMR4dGBm6nWC1WPp+0HaGMCaifNW1zqcwqmSXTTdbE61DZbdeiSw+7fJfzrLXlWP78NEBiXDw6FleMqqrTXBqR+f7yQsZwJQlE/JPGf0KCEAAAFr5CAhQoiIwlGRQ0tSdgK5TjSbo17MNflpy33/ss6jTMXka1DTxvRKpU1N9XFicCwpucZhmPvM7O5TEo1BcM07/S575+IsGLUATGy5o5Q4x0J6hVGtPyqqRonF6nJ5e+89arPXiQ4FzbsdKVOr9d1LekrVl+z69f/oZX+2FL6RuIXiSUhUQNVIoZPJlqTepCqmvq73VXyZS760/ffqGBAAAAAAAuhcEyMRDEawoORyBBo5rYODKHJzKbLCuzxStCFnbKWutklagLrJEPs+MqZSiixR52YOurM0FvJNH2FsGZ04CwMffSVN9CWnL2a8r9fymLf/7kMTaAJddd1nMMHsCiKtruYYPWav/ADlVqroQQtKRO6tOoSFU9iXIgTIlgsEsIyrAhrW06gch1SoB1zanUJKYrIZKbFnaMKnbVX/WzS5qpNUciKqiyTgq53t410pbtKW7sF5S2LMAYqIqxoKkQDUsypQrb73/lGBoIAAABKczGC7jTC64hBYG3RIgzr16LdgiH4fYQ/1EyUaAqQAYGwfHgLGsC6JcoLCMOB0SA2BUC5RYXEMY5NFjJMGSc00avL1RRQ8VGD2WmeTUiu2KFm+1vKv6HzHDStcM8Spsdj9t1qH4vX5GPU9TUxrt61MTK/LfF/zfMDczftc3xQUMFcCeNOZgAFcigCAjAiEQmVC67JwhKHxxgIba0IjwgegjghiKfCKcgsFxKgRnQgCRnQelkDAg1nMACUkRnkRaUPTodJyBYRGcGjhllRliQULWesOroECFxAaMvRAGhA7NlYGBnAL+FxGaK3IBC0qmiMyVrA5HF4hA1aVpWX13v2vSbUxZy39VeMVgyHIQ7dLFqSF13Hkcvtz9I2Wio3nffKIyuf/7gMTxgBcNQ0/NMNyCLiwq/rKAAbldNEuymldtx8qeNxd3IxOS12oHi9Fbfu7HX7syavGKKzhKqlK+jkPxR3+xSrRxiWP7UdWJTWq0Ovc/cX5/3OZ42stbx/mMUcen3YsWP73le3b02dyIpS0c5nFIry38BTV3WZyRCISBACTnScBsFUk6miiRi+rKC67NmnLDMHeWGYRH4GAVBaDgAoCwigAQ9GB6LgoCNxYP6FARLD0wkPQ5JCeDqukiB5R1q6Di6uhsOkVcDu/nvEkk3JL1FsK71Rt3FK8o5rXMcLfMkoVftdUzcRPKz3/o9cvEDVVV6qYuto9ampro5aIeoDHZXJFdded4FEUAAAAIt8dklyvoVIFwLHEgl3kgXZbGtxhcHzkOsEfSHZqxMmBkPH2VjqEhHKHxKiGDSIhURHbs26nORaWmsRoVkXhKszJPlFHl+6TvWO1h8q2zFVlKad+viuqHmzrBK7l/1RJl//uQxPuAIBmZW/mskgI2re1/sIAERJKFsYr1DYCHM8tGhn6FFy5uxkUaeYk1bIG2NKgoVhBBNfj75UOS8CDGQAQUEnez4EgC5BkDYQqEaKhML/U7sm9pvItmXvlTPaCIZBYRERIaKeLyFmJKLvapZFu+m3mpMxgriWRBB3Ua4G7gMPloZueVxJwVWeA2N0qkbAwUbgo22aqpMfdmokm3UFYR2Hr+ZmTtYtgP9FajxvwpBcLaDtm/y90L2bsTKsdlAFMwAAAEu99wqWocCQ0xEOKAlcJUNjF07qi76yJp9oEgOmobMEcXD8aJBlpEjSefB4lRFlyWaa7aTHNRqTXZq0GoM46q3CSqFt99uldarORRzOMbECp0mpkJVT/8WMNIEdoqkRsZlGc4+w9AoZQP3NozRfZWO32YODRE1VlI9ptcoa/dSyABiQAACUnfEUXU7QMEDgj5KrF5goQhmmOHDZE77RJunc7ONwVcvJwT2d10XrjKNSHqo4fXdZUVlzS70TntNJl3YNyFEKmWzO1VFdX912eCYYdlrGpMboaC8BCO//tgxPoAEb1vY+wkceoJJuw9hI3ttpEGdVYzBiRJqjmmjM0YrC/2ZWYlCs4o9SmrS5l7utEkezAiim9fsbRz2tzf2rx0AFIQAAMJPeVjAVHgvgupxAQBXQCi7jQGcqsg+pZDUOtZyn701HXhKAParlEzal+KIAz7jqmB5lysbSVa5TLWtj5dWXjifYYLqliOMR6TgptgEM6GjJdPSwmwJGXX1u3hSz8t0Z4Sfe3Kk32DVihohKIYkyYEWR8b6EBQUbClk//5/ir8a59ygAoCAAAkp2DowU5rg0RIlLgCkQzPz1qwAbvJl8FXKYya25mEtlWDPyYdrxmvLpuvJI1LuLV3ZNOo//twxOmAELVhV+ykcuorrWo9pg5dHYts0VUyxBGLyDzjc1kU3fMFJJO11bzb9q2I2dbfqFa21MFs83rUlXbmu/j0ukZfWfYiJ7ffuNWosBwUUFIgnkoo6m/22N1V37QAVVAxInXKKbJLUgYvYLgCh0JhhVDfP+d78JD4cp6VyAchZ040atqdkxHGzA2OXddx4tbL0ACiblFkdNIonJU6JqMzM4x05/5zm0d/xcQV2QyWbxsL/xNNCv+42KiTP/4v5HCvhYmnBWLusipcViQAABAAHga3JHxW0rCYXEozA080yAAARs3FocBD9yyum0HAPE3WzgkIrQR1TgfwbS06sxAGknlEP/n0Azuuqv6AAAAB6gAAbtmcOeAowNQmaoAbSapK1wxJhhjBOAeBALpnOLJGB+d6beMG5v/7YMTzABDtR03tMHMqBySovY2ZNdmnMmUWEYNLphs0GDwUYJDIoDCABiBEnDgSXiC4lNIo8zEHzLZDHg2X/Xc6KfhnMDMiYczRI4GCU0CvTW5xMGgRNV9jDIAEAFR+HQaXKS9HQAkCnYilDrYHNgx9YW8b5zUEwPAdq9QUVSmsTFjV23Xv/POw6STr08/CDoFm35zudsR7/z/X7ukAAAwAAH9GkDiKDjBTLQzEWxCHQDhxIWBn9FAamYAIBhiPjVmCWCAZvCYhkIhZGCsEiYEgCIOA5UvZS4a0SUCsaCFhoRgBmA4A+YsoHAKAyhdeS0MfGgKaeWTskiIUB5CAaonO13icVv/7UMTmAE3ok0XsaMfo+4vl/Y7Q5SgQxDEMQxWK8g5pqtmXjcJwOAMMMMNWGrELELHrJehaxNKrzrLmPWLeLeaBoIYhigVjym3jAwKxOIYhiGKBRq9Xsb++IDxXq9XqNRoer1e/ZHmtZu/fv1YrFYrHjx5E1/Sjx48ePGd+/fv739Lw379+/fv37x5Smve78AAAAAV/4AAHh4e//jh4eAWohCAAEAIkcn9ZCXBVKoCpqkapqxkv6tbAxhELUHi1QGmFJvxG5XSZ6aqpx/UPDID/+5DE7AAWeKUhrXuGq8+q5f2vPT0h+csaMYfwljFR6qt/7zVVVVVU//7VVTMzMz//5mZmaqqr/vVVVVVVMzn/qpkAgEiRIkUa3zJEiRIkiRIkSJVXaqOJEiRIkRIkUZntRpEiRIkSJEiN/8QYKCgp//kFBIKChVGgABgAHA/+4XUfEHodYkj0+piGQZAIJi1RIECtKRu8MOI98HUZYBKxKeGASGb3Mcq6XWJJrwlsOCdklQqjQAAwADgAAD/wzuLGQkvEsKXhbYyEijCYgOYaw1ODBIazaQQBAMSjpUAkwWo+6Ek+oxT87kzxG+lhB0PE7JAFooAAgErT3AoCYG3BWNdhklZmGhAetyRrYMBB9Sxr7lv5T1CoJKBPMhw0eZUnzLrOWPVYP/H/JE6hTlSSAJVQACAAOAAAKRTUwEAdLEukBQQSnMQDcEIzmOnHmCgjlgMvt2HEc+DqMqDysRTuAYUmai2+FXLH/Uv/8v0SM1CncqmAJZAro7A4JISlSlsWBGG0+YLEh0zcGtQYJFV/SCORGVR0qB0oaR90AJ+yinP/+2DE3gBSJVdF7cDUaPCKp33czZw73ndsQ/8f8kRtSdkqAJSAABACOAAALiCNEWA1gEI5YYSSRgwPHicYakCwQXVw1924xT1CoHUJxrEBQ8iBWGXWbWOSg//l/kiVznWkgD7wAaFPkAVWmBwJrqKQFDYoc2MiDC0lVJ65RFJPRX1E2zZygQnAdzi6KliFPi7eA9gAQBHAAAHyBAFoZCWFLitOMJH4wmHDn2GNVggWCLQpBEI7KpkqAVoNI+6Ppm8LMfvdZ0A9PSwg+VmhG6YhncAAAAAB6yAAcIJhaCJgQCQhB8wHC4wwBEx3CgxWCoQgCWATBIVGHhgmTg3Hb98GnArGD4L/+zDE7wDH9FU57mps4PQKprgOaGRpUXYCa6x9YgiBkSBxVdeQgDwzcEoFAKtJnLFlqK3p+Pu/LvuRAZYFeDnfdiDX9g9+H3gyMwfDkNx01kH4HVJgsMTAUhdBxaDaiNwGiLnARBCUZEXpDllkxARBCX6EkFkxQRfVIJe6pF9tKZqvdYRfbhM2ZIsOzBlLQmCLnFAhDEKwkGsShiH/+zDE9AHIiFUx4HdDKOUKpngOaGRYSDUJI3CgJxOEkZiIOBBMjQnlQunxoTCuXj03JhXTKTQzKiU+NDMuJVJbMCudKS2YJzlUWDMuHKo8MymdIj8wQ1yI/O0JbGsO4Fr69ZCuiXsQvI1jbTsaxtp5xewy84vYadDIyMgLA4KQiMDIxCqru6UCVwQu/sAhqSvo77mSKOrwTDBQCVX/+yDE+IBH6FUx4HNDIL4KqXwNRHxFQgSAsAQcEANbUFyh+Hzisqht+HXTAYGKAmtjkiqylcNa3Z23Kf/y15ss75TwmiSElqSkq1EjS0Fo08JGzFqo2UnSqS9FEWK0JbKkpWL4lFn2YAMynBIcOABuAlVRCAS9LMqDAIKw43kgaXIW//uAxPeAB8hXL6hyZ6SsNGR93DMdvdOQBAMSjuFeIMDKoE0f2f+Ky1UA3ukFnA6AAAA+JrQSraQmGuwAgvobsiQCsb8Rty38jdImcIofCoFQjpI/xVYAjaUGqQ5AH0zZCldSCZ4VUlHRjisKjs2WINMau9sWzpI2uQd4YUtFL+Kp5QCLhwJ2DgAAAD6y8S8zDUiUUjEA1hjpWBqEs2RWIAgmJTOFeUMDJEBWj7WdvxKy0AXuuCzgdAD67SFb3IXe7CQ76HDYhYpe7kba2/kbpM6CPrIIgJg10kX/FUsVAIynBrgegAAAPp5lYWJIZL5HQzGSTOu1Mp6ZQyRcTew9vCndgT8FGlopfwgSwAmqYEhw4AH1nRWkoCWZYkgqzo4D4eXIWvdOPpBMekuFPDDAy0A3H9n/islpAJuoBqwOQAAAPziDt0kbawXXfQ26kzEc3Eh9d7XIflGcxAayCoEwe0kf4ulgA1VANUh9RZz/+0DE7oBNWME57kDUaLWKp/wNRHxV1F7kZRUoo6S71iohPTKHUak8sW3SRthg7wmaWikj+KpGAHliBmUOeAAAP//+uj2yZrCp4KLcBYEcpoEV0i2JLUcCW9leduAGAQIEK1z+Zc/eH7rqPvJYsZHNLSDADNDMLMqXRQBAAAAAJzkIId48nm6DAnbNOIjgEgYAQQWvKwE402QMNUTwg8fhdwgQXMBn4lgZRGAXSFxgYERQGDAkIf/7IMTygEWgVUXgZaOgrgqn/B00tAghAQBgBEJBTiHFsiRqBgoWhYuBgcAhZUHyABA4umKB0WMiiy+ZAAgwBcAg2YC+oNtsySTNDROpYpETaLkFli4hWv7v8jikT5OEVJos/2++s0Pl4xOKPt///mIjNA0JAF//BURgUGgcBYXd////+xDE/IBF9FU34GpD4K6Kp/wMtHzwMEiIBFVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EMT4AEWwVTvg6aWgsQqmvA1AfFVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sgxPSAxZRVO+Blo+Cpiqa4HTS0VVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVf/7YMT/gAcMVy/1rAAi5aKlfzdQAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAf4cAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVAYtGonDotHwkAQAAAP/7EMTWA8AAAaQAAAAgAAA0gAAABA//+yX3//wMdCTk1v/uy8GjBnRVvA9fCQM8o/2gZjGYGYTaBh8iegmpgMzCoDPBSAwAEwMVhH5gak+O8mANElEDMK1A1OMQOPvUDisn/Zk59gNB//sQxNYDwAABpAAAACAAADSAAAAEjcDJI/AJEgGKgYBhEJAUGv/+AMMwMLhMFAmDYwBhUGgYHBICgT///ACAYNg8PfBtoOwWQKXJhf///kMGgM2YlcvjBJM8IXHf////+odBIkTJsgb/+xDE1gPAAAGkAAAAIAAANIAAAAREyKMXzpfPpGn////lDJ8uu4xzcTYmSASp4CZYFQiLAwwWFTDoLNPpU2nb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dWyZF4t043igXl9WaTpZALAKAYAZBJC8HAQAgAAAwOFzFJtBoIEIt/zKYUNCi43tZTOj5/zBwGMTCQ1YPTI6Q//7MMT1gEqYgTft5GlgzgemfY3oxPwUwBkIVQHgwHHEcBlgDv4VqH+4YIAWAAEgUoBlYRUPaAwm8AAwAzCEAxEAaAws4MjHBZ30xZBIF8WQVRWxkOcLmKQ535fIIYk+RA6T5eMi8bGRef+RAzJ8qFMny0TZPqSqep1/81Jsn0SbNzpfNzMv69ev/+mZl9y+by+fQL7oE+kjo6/////7IMT0gEZUOzHh42Cgy4el/Y3kxPmhuo0NzA0PmBpVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+xDE+ABFxD835+nlIK4HpnwNYBxVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7IMT0gAXMOzn1l4AhBQgmezeAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1DE8wAYZa0z+cmQAAAANIOAAARVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV","options":[{"letter":"A","name":"Soft rising cue","description":"Card gather and a gentle rising two-note tone.","start":0.35,"duration":0.63},{"letter":"B","name":"Bright reward","description":"Three short rising notes over a card gather.","start":1.94,"duration":0.61},{"letter":"C","name":"Wooden reward","description":"A restrained, percussive rising double knock.","start":3.51,"duration":0.47}]},{"key":"loss","title":"Opponent captures your pile","audio":"SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYxLjcuMTAzAAAAAAAAAAAAAAD/+0DAAAAAAAAAAAAAAAAAAAAAAABYaW5nAAAADwAAAL8AAHnWAAMEBggKCw4WHyUsLjI0NTc7PUBBQ0VGR0lLTE5QUlNVV1hZW11eZGpxeH6Cg4WJi42PkZOVlpiZm5yeoKGjpaeoqqutrrCzusLJz9XZ293f4eLk5ujp6+3u7/Hz9Pb4+vv9/wAAAABMYXZjNjEuMTkAAAAAAAAAAAAAAAAkBkMAAAAAAAB51rCeozgAAAAAAP/7EMQAA8AAAaQAAAAgAAA0gAAABExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxCmDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDEUwPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMR8g8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxKYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDEz4PAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV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eYw8XAAaSXg2eZSsQGBut4W0Ft8B0iCgBt/AuRxDyO/5OGGEaRV/5JE0eo9Zd//JEyNklF4kv9YKzv+oGlHpX/52WPK//+VxFUxBTUUzLjEwMFVVVVVV//sQxPUAQ7wdRcxjAmB/A6b9jWBEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVX/+xDE8YDDaB1FzGGA6G6Dp3mcPBxVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVf/7EMTygMOEHUPMYeDocwOm+rAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVV//tgxP+AFIYdM/m6AEFOFWY3JNAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpBwAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVV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Apjz//tAxP+ATLiHJ+5hh+j+iaV9jaQ1Q0sA0RACYg5UBlAnz7Jm7ADAAMGJAIDAGiAHBf/x3CPhURBMZsUB/t8gZDSONSIkkRD//9AvmBkYpGx43///9NAzMTiJqfNED//+UCoNAMCBcQhv////wwDgqIgXTEFNRZfps3WNXANxSFLis1RuLNOWBDlpWDLxQdYLMOVfiL+pAoBCRpxIlQlBU6Ig4IrgaAQNdQNLBUedlQ2JTvEp0RD/+xDE8IDDXBtHzGAhKGWDKLmM4ERwjcDSg7+CtUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EMTwgMOMHT3MYGEgYYNoeYw8HVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQxPCAw2QdQ8xh4OBkgyf5jOAEVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1DE/4ADzB091YAAIo6np381QEhVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxPoDyOw3I52DAAAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV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RTMuMTAwqqqqqv/7EMTWA8AAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//sQxNYDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/+xDE1gPAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/7EMTWA8AAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//sQxNYDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/+xDE1gPAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqg==","options":[{"letter":"A","name":"Soft falling cue","description":"Card gather and a quiet falling two-note tone.","start":0.35,"duration":0.62},{"letter":"B","name":"Low descending cue","description":"Three restrained falling notes.","start":1.93,"duration":0.64},{"letter":"C","name":"Muted setback","description":"Two dry, low falling knocks.","start":3.53,"duration":0.45}]}];
  const soundboardBuffers=new Map(),soundboardChoices={};
  let soundboardAudio=null,soundboardSource=null,soundboardToken=0,soundboardPlaying='';
  function soundboardStatus(message){
    const el=app.querySelector('.soundboard-status');
    if(el)el.textContent=message;
  }
  function soundboardButtons(){
    app.querySelectorAll('[data-action="soundboard-play"]').forEach(node=>{
      node.setAttribute('aria-pressed',String(soundboardPlaying===node.dataset.category+':'+node.dataset.clip));
    });
    app.querySelectorAll('[data-action="soundboard-pick"]').forEach(node=>{
      node.setAttribute('aria-pressed',String(soundboardChoices[node.dataset.category]===node.dataset.clip));
      node.textContent=soundboardChoices[node.dataset.category]===node.dataset.clip?'Picked':'Pick';
    });
  }
  function stopSoundboard(){
    soundboardToken++;
    if(soundboardSource){try{soundboardSource.stop();}catch(_){} soundboardSource=null;}
    soundboardPlaying='';
    if(modal==='soundboard')soundboardButtons();
  }
  function soundboardSummary(){
    return soundboardCategories.filter(c=>soundboardChoices[c.key]).map(c=>{
      const option=c.options.find(o=>o.letter===soundboardChoices[c.key]);
      return c.title+': '+option.letter+' — '+option.name;
    }).join('\n');
  }
  function refreshSoundboardChoices(){
    soundboardButtons();
    const el=app.querySelector('.soundboard-summary');
    if(el)el.textContent=soundboardSummary()||'No choices selected.';
  }
  async function playSoundboard(key,clip){
    const category=soundboardCategories.find(c=>c.key===key);
    const option=category?.options.find(o=>o.letter===clip);
    if(!category||(!option&&clip!=='all'))return;
    const wasPlaying=soundboardPlaying===key+':'+clip;
    stopSoundboard();
    if(wasPlaying){soundboardStatus('Playback stopped.');return;}
    const token=soundboardToken;
    try{
      const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;
      if(!Audio)throw Error('Audio not supported');
      // Separate preview context: test sounds even when game sound is off.
      if(!soundboardAudio)soundboardAudio=new Audio();
      const context=soundboardAudio;
      if(context.state==='suspended')await context.resume();
      if(token!==soundboardToken||modal!=='soundboard')return;
      soundboardPlaying=key+':'+clip;
      soundboardButtons();
      soundboardStatus('Playing '+(option?option.letter+' — '+option.name:category.title+' · A/B/C'));
      if(!soundboardBuffers.has(key)){
        const bytes=Uint8Array.from(atob(category.audio),ch=>ch.charCodeAt(0));
        const decoding=context.decodeAudioData(bytes.buffer);
        soundboardBuffers.set(key,decoding);
        decoding.catch(()=>soundboardBuffers.delete(key));
      }
      const buffer=await soundboardBuffers.get(key);
      if(token!==soundboardToken||modal!=='soundboard')return;
      const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);
      soundboardSource=source;
      source.onended=()=>{
        if(soundboardSource!==source)return;
        soundboardSource=null;soundboardPlaying='';
        if(modal==='soundboard'){soundboardButtons();soundboardStatus('Ready to listen.');}
      };
      // Include a short quiet margin on both sides of each clip. This
      // also accommodates minor MP3 decoder delay differences.
      if(option){
        const from=Math.max(0,option.start-.10);
        source.start(0,from,Math.min(buffer.duration-from,option.duration+.22));
      }else source.start();
    }catch(_){
      if(token!==soundboardToken||modal!=='soundboard')return;
      stopSoundboard();soundboardStatus('Audio could not play. Tap a candidate again.');
    }
  }
  function renderSoundboard(){
    return '<div class="dialog-head"><div><span class="eyebrow">AUDIO TEST</span><h2>Soundboard</h2><p>Listen to 18 candidates and pick your favorites. Game sounds stay unchanged.</p></div><button type="button" data-action="soundboard-back" class="icon-close" aria-label="Close soundboard">×</button></div>'+
      '<div class="dialog-content soundboard-content"><p class="soundboard-status" role="status">Ready to listen.</p>'+
      soundboardCategories.map(c=>'<section class="soundboard-category"><div class="soundboard-heading"><h3>'+escapeHtml(c.title)+'</h3><button type="button" class="soundboard-compare" data-action="soundboard-play" data-category="'+c.key+'" data-clip="all" aria-pressed="false">▶ A/B/C</button></div>'+
        c.options.map(o=>'<div class="soundboard-option"><button type="button" class="soundboard-play" data-action="soundboard-play" data-category="'+c.key+'" data-clip="'+o.letter+'" aria-label="Play '+escapeHtml(o.name)+'" aria-pressed="false">▶ '+o.letter+'</button><span><b>'+escapeHtml(o.name)+'</b><small>'+escapeHtml(o.description)+'</small></span><button type="button" class="soundboard-pick" data-action="soundboard-pick" data-category="'+c.key+'" data-clip="'+o.letter+'" aria-pressed="'+String(soundboardChoices[c.key]===o.letter)+'">'+(soundboardChoices[c.key]===o.letter?'Picked':'Pick')+'</button></div>').join('')+'</section>').join('')+
      '<div class="soundboard-summary" aria-live="polite">'+escapeHtml(soundboardSummary()||'No choices selected.')+'</div></div>'+
      '<div class="dialog-actions soundboard-actions"><button type="button" data-action="soundboard-stop" class="action-btn">Stop</button><button type="button" data-action="soundboard-copy" class="action-btn primary">Copy choices</button><button type="button" data-action="soundboard-back" class="action-btn">Back</button></div>';
  }
  function closeSoundboard(){
    stopSoundboard();
    modal=screen==='game'?'menu':'';
    render('overlay');
    applyPendingUpdate();
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
        for(const face of node.querySelectorAll('.playing-card,.build-value,.build-summary'))face.classList.toggle('card-selected',selected);
      }
    }
    if(typeof syncBuildInspections==='function')syncBuildInspections();
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
      panel.setAttribute('aria-label',modal==='menu'?'Settings':modal);
      panel.innerHTML=renderDialogBody();
    }
    restoreVariationsScroll();
    return true;
  }
  // The game replaces the hand DOM between turns. Carry its *displayed*
  // tone across that replacement so a quick redraw cannot cause a flash.
  function readHandTone(){
    if(!motionAllowed())return null;
    const lane=app.querySelector?.('.human-hand');
    return lane?globalThis.getComputedStyle?.(lane)?.filter??null:null;
  }
  function animateHandTone(previous){
    if(previous==null||!motionAllowed())return;
    const lane=app.querySelector?.('.human-hand');
    if(!lane?.animate)return;
    const next=globalThis.getComputedStyle?.(lane)?.filter;
    if(!next||previous===next)return;
    // Animate the isolated hand as one layer; don't change card dimensions,
    // stacking, flight targets, or when the buttons become interactive.
    lane.animate([{filter:previous},{filter:next}],{
      duration:160,easing:'ease-out'
    });
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
    const previousBuildScroll=app.querySelector?.('.table-builds')?.scrollTop||0;
    const previousHandTone=readHandTone();
    if (game.phase !== 'playing') resetSelection();
    if (pickedCard && !me().hand.some(c => c.id === pickedCard)) resetSelection();
    const active = isHumanTurn();
    const showingDeal=dealing||!!pendingDeal;
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
            <div class="table-stage"><div class="table-cards" aria-label="Loose table cards" style="${cardRowStyle(game.table.filter(e=>e.type==='loose').length,true)}">${game.table.some(e => e.type === 'loose') ? game.table.filter(e => e.type === 'loose').map(e=>entryMarkup(e,active)).join('') : ''}</div>
            <div class="table-builds" aria-label="Builds on the table">${game.table.filter(e => e.type === 'build').map(e=>entryMarkup(e,active)).join('')}</div></div>
          </div>
          <div class="build-inspections" aria-label="Selected expanded builds"></div>
          <div class="turn-action-area">
            <div class="move-action-slot">${controlsMarkup}</div>
          </div>
          <div class="human-area">
            <span class="sr-only" role="status">${active?'Your turn':'Waiting for your turn'}</span>
            <div class="human-hand${active||showingDeal?'':' hand-inactive'}" aria-label="Your hand" aria-disabled="${!active}">${sortedHand(me().hand,game.rules,handSortMode()).map(card => `<button type="button" data-action="hand" data-id="${card.id}" class="hand-item ${pickedCard === card.id ? 'selected' : ''}" aria-pressed="${pickedCard === card.id}" aria-label="Play ${escapeHtml(E.cardName(card))}" ${active ? '' : 'disabled'}>${renderCard(card,false,pickedCard===card.id)}</button>`).join('')}</div>
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
    layoutBuilds(previousBuildScroll,motion==='build');
    layoutHumanHand();
    hidePendingDealCards();
    animateLayout(oldLayout,motion,motion==='capture'&&(game.lastActor??(1-game.turn))!==0);
    if(!showingDeal)animateHandTone(previousHandTone);
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
    const fillFor=s=>free?(s.human?colors[0]:n===2?colors[1]:'#777b73'):colors[s.team];
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
  function renderCpuPlaytestOptions(){
    const options=typeof prefs!=='undefined'?prefs.cpuPlaytest||{}:{};
    const locked=(typeof busy!=='undefined'&&busy)||(typeof dealing!=='undefined'&&dealing)||(typeof turnInMotion!=='undefined'&&turnInMotion);
    const names=[['noCapture','No CPU captures'],['noBuild','No CPU builds'],['noMultiBuild','No CPU multi builds']];
    return '<section class="cpu-playtest-options"><h3>CPU playtesting (temporary)</h3><p>These switches restrict computers only, not the game rules. Turn them off if a CPU has no allowed legal move.</p>'+
      names.map(([key,label])=>'<button type="button" class="cpu-test-toggle menu-row" data-action="toggle-cpu-playtest" data-key="'+key+'" aria-pressed="'+!!options[key]+'" '+(locked?'disabled':'')+'><b>'+label+'</b><em>'+(options[key]?'On':'Off')+'</em></button>').join('')+'</section>';
  }
  function renderSettings(){
    if(!draft)draft=E.normalizeRules(game.rules);
    return '<div class="dialog-head rules-header"><div><p class="rules-eyebrow">'+escapeHtml(playerHeader())+'</p><h2>'+(settingsOrigin==='newgame'?'New Game':'Game Setup')+'</h2></div><button type="button" data-action="close" class="icon-close" aria-label="Close">×</button></div>'+
      '<div class="dialog-content variations-content unified-setup rules-content">'+renderPresetPicker()+renderDifficulty()+renderAllRules()+renderCpuPlaytestOptions()+'</div>'+rulesFooter();
  }

  function renderMenu() {
    return `<div class="dialog-head"><div><h2>Settings</h2></div><button data-action="close" class="icon-close" aria-label="Close settings">×</button></div>
      <div class="dialog-content menu-list">
        <button data-action="close" class="menu-row"><span>▶</span><b>Continue playing</b></button>
        <button data-action="history" class="menu-row"><span>☷</span><b>Move history</b></button>
        <button data-action="toggle-sound" class="menu-row"><span>${prefs.sound ? '♫' : '♪'}</span><b>Sound effects</b><em>${prefs.sound ? 'On' : 'Off'}</em></button>
        <button data-action="open-soundboard" class="menu-row" ${busy||dealing||turnInMotion?'disabled':''}><span>♫</span><b>Soundboard</b></button>
        <button data-action="toggle-undo" class="menu-row" aria-pressed="${prefs.undo}"><span>↶</span><b>Undo button</b><em>${prefs.undo ? 'On' : 'Off'}</em></button>
        ${renderCpuPlaytestOptions()}
        <button data-action="new-match" class="menu-row danger-row"><span>↻</span><b>Restart game</b></button>
      </div><div class="dialog-actions"><button data-action="home" class="action-btn primary">Exit to menu</button></div>`;
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
      <div class="dialog-content"><p class="exit-confirm-copy">Your match will be saved if you exit to the menu. Restarting begins a new match with the same rules.</p></div>
      <div class="dialog-actions exit-confirm-actions"><button data-action="new-match" class="action-btn restart-action">Restart game</button>
        <button data-action="cancel-exit" class="action-btn">Keep playing</button>
        <button data-action="confirm-exit" class="action-btn primary">Exit to menu</button></div>`;
  }
  function renderDialogBody() {
    return modal === 'exit-confirm' ? renderExitConfirm() : modal === 'menu' ? renderMenu() : modal === 'settings' ? renderSettings() : modal === 'rules' ? renderRules() : modal === 'history' ? renderHistory() : modal === 'soundboard' ? renderSoundboard() : renderRound();
  }
  function renderModal() {
    const body=renderDialogBody();
    return `<div class="overlay" role="presentation"><section class="dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(modal==='menu'?'Settings':modal)}">${body}</section></div>`;
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
        panel.setAttribute('aria-label','Settings');
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
    const limits=typeof prefs==='undefined'?{}:{...prefs.cpuPlaytest};
    const restricted=Object.values(limits).some(Boolean);
    if(restricted)view.cpuPlaytest=limits;
    const fallback=restricted?E.quickPlaytestMove(state,limits):E.quickLegalMove(state);
    const advanced=view.rules.difficulty==='hard'||view.rules.difficulty==='expert';
    const localMove=()=>{
      if(restricted){try{return E.choosePlaytestMove(state,limits);}catch(_){return fallback;}}
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
        const workerCode="\nself.onmessage=event=>{try{const E=self.CassinoEngine,view=event.data;const advanced=view.rules.difficulty==='hard'||view.rules.difficulty==='expert';const move=view.cpuPlaytest?E.choosePlaytestMove(E.samplePublicPosition(view),view.cpuPlaytest):advanced?E.analyzeComputerMove(view,{onProgress:move=>self.postMessage({move,progress:true})}).move:E.chooseComputerMove(E.samplePublicPosition(view));self.postMessage({move});}catch(error){self.postMessage({error:String(error)});}};";
        url=URL.createObjectURL(new Blob([source,workerCode],{type:'text/javascript'}));
        worker=new Worker(url);
        worker.onmessage=event=>{
          if(done)return;
          const move=event.data?.move;
          if(move&&E.validateAction(state,move).ok&&(!restricted||E.cpuPlaytestAllowed(state,move,limits)))best=move;
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
        const limits=typeof prefs==='undefined'?{}:prefs.cpuPlaytest||{};
        if(Object.values(limits).some(Boolean)&&!E.cpuPlaytestAllowed(game,move,limits))throw new Error('CPU playtest move was restricted. Change the temporary restrictions in Settings to continue.');
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
    busy = false; game = E.newMatch(rules); checkpoint = null; modal = ''; exitReturnModal = ''; toast = ''; lastMotion = 'deal';
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
    if(action==='open-soundboard'){
      if(node.disabled||busy||dealing||turnInMotion)return;
      stopSoundboard();modal='soundboard';render('overlay');return;
    }
    if(modal==='soundboard'){
      if(action==='soundboard-back'||action==='close')return closeSoundboard();
      if(action==='soundboard-play')return playSoundboard(node.dataset.category,node.dataset.clip);
      if(action==='soundboard-stop'){stopSoundboard();soundboardStatus('Playback stopped.');return;}
      if(action==='soundboard-pick'){
        const c=soundboardCategories.find(c=>c.key===node.dataset.category),clip=node.dataset.clip;
        if(c?.options.some(o=>o.letter===clip)){
          if(soundboardChoices[c.key]===clip)delete soundboardChoices[c.key];else soundboardChoices[c.key]=clip;
          refreshSoundboardChoices();
        }
        return;
      }
      if(action==='soundboard-copy'){
        const value=soundboardSummary();
        if(!value){soundboardStatus('Pick at least one candidate first.');return;}
        if(navigator.clipboard?.writeText)navigator.clipboard.writeText(value).then(()=>soundboardStatus('Choices copied.')).catch(()=>window.prompt('Copy choices',value));
        else window.prompt('Copy choices',value);
        return;
      }
      return;
    }
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
    if (action === 'settings' && screen === 'home') return openSettings(screen);
    if (action === 'history') { modal = action; render('overlay'); return; }
    if (action === 'toggle-sound') { prefs.sound = !prefs.sound; savePrefs(); if (prefs.sound) sound('tap'); render('overlay'); return; }
    if (action === 'toggle-animations' && screen === 'home') { prefs.animations = !prefs.animations; savePrefs(); render('overlay'); return; }
    if (action === 'toggle-hand-sort') {
      // Do not move a live flight/deal destination. The selected card and
      // table selection are identified by ID and survive a presentation sort.
      if(modal||!isHumanTurn()||node.disabled)return;
      prefs.handSort=nextHandSortMode();
      savePrefs();
      render();
      if(event.detail===0)app.querySelector('[data-action="toggle-hand-sort"]')?.focus({preventScroll:true});
      return;
    }
    if(action==='toggle-cpu-playtest'&&(modal==='menu'||modal==='settings')){
      const key=node.dataset.key;
      if(busy||dealing||turnInMotion||!['noCapture','noBuild','noMultiBuild'].includes(key))return;
      prefs.cpuPlaytest={...prefs.cpuPlaytest,[key]:!prefs.cpuPlaytest?.[key]};
      cancelComputerSearch();savePrefs();render('overlay');return;
    }
    if (action === 'toggle-undo') { prefs.undo = !prefs.undo; savePrefs(); render('overlay'); return; }
    if (action === 'close') { modal = ''; render('overlay'); applyPendingUpdate(); if(screen==='game'&&!busy&&game.phase==='playing'&&game.turn!==0){toast='';botTurn();} return; }
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
    if (action === 'table' || action === 'inspect-build') {
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
      if(modal==='soundboard')return closeSoundboard();
      if (modal === 'exit-confirm') { cancelExit(); return; }
      modal = ''; render('overlay'); applyPendingUpdate(); if(screen==='game'&&!busy&&game.phase==='playing'&&game.turn!==0){toast='';botTurn();} return;
    }
    else if (ev.key.toLowerCase() === 'u' && !modal && prefs.undo && checkpoint) undo();
  });
  window.addEventListener('resize',()=>{if(screen==='game'){layoutBuilds(app.querySelector('.table-builds')?.scrollTop||0);layoutHumanHand();}});
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
