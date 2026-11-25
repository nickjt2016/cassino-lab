/* Cassino Lab browser UI: all gameplay calls the shared rules engine. */
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
  const APP_VERSION = '0.5.33';
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
  let prefs = { sound: true, animations: true, undo: true };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREF_STORE) || '{}') }; } catch (_) {}
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
  function collectDeal(beforeHuman = [], beforeCpu = [], beforeTable = []) {
    const oldHuman = new Set(beforeHuman), oldCpu = new Set(beforeCpu), oldTable = new Set(beforeTable);
    const humanIds = game.players[0].hand.filter(c => !oldHuman.has(c.id)).map(c => c.id);
    const cpuIndices = game.players[1].hand.map((c,i) => !oldCpu.has(c.id) ? i : -1).filter(i => i >= 0);
    const tableIds = game.table.filter(e => e.type === 'loose' && !oldTable.has(e.card.id)).map(e => e.card.id);
    pendingDeal = { humanIds, cpuIndices, tableIds };
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
      const key = node.dataset.action + ':' + node.dataset.id;
      const rect = node.getBoundingClientRect();
      if (rect.width && rect.height) positions.set(key, {x:rect.left+rect.width/2,y:rect.top+rect.height/2});
    });
    app.querySelectorAll('.opponent-hand .card-back').forEach((node,i)=>{
      const rect=node.getBoundingClientRect();
      if(rect.width && rect.height) positions.set('cpu-back:'+i,{x:rect.left+rect.width/2,y:rect.top+rect.height/2});
    });
    return positions;
  }
  function animateLayout(previous, motion = '', byComputer = false) {
    if (!previous || !motionAllowed() || !app.querySelectorAll) return;
    const nodes = [...app.querySelectorAll('[data-action="table"][data-id], [data-action="hand"][data-id]'),
      ...app.querySelectorAll('.opponent-hand .card-back')];
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
  // reaches them, their DOM destinations remain hidden but retain layout space.
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
    const human=(deal.humanIds||[]).map(id=>handCards.find(c=>c.dataset.cardId===id));
    const cpu=(deal.cpuIndices||[]).map(i=>backs[i]);
    for(let i=0;i<Math.max(human.length,cpu.length);i++){
      if(cpu[i]) items.push({node:cpu[i],faceUp:false});
      if(human[i]) items.push({node:human[i],faceUp:true});
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
    const measured=items.map(item=>({...item,rect:item.node.getBoundingClientRect()}));
    const flyOne=({node,faceUp,rect},index)=>new Promise(resolve=>{
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
              await run([{transform:end+' rotateY(0deg)'},{transform:end+' rotateY(90deg)'}],{duration:100,easing:'ease-in'});
              if(generation!==motionGeneration)return;
              const face=node.cloneNode(true);
              face.style.visibility='visible';
              face.style.width='100%';
              face.style.setProperty('height','100%','important');
              face.style.margin='0';
              ghost.replaceChildren(face);
              ghost.getAnimations().forEach(a=>a.cancel());
              await run([{transform:end+' rotateY(-90deg)'},{transform:end+' rotateY(0deg)'}],{duration:110,easing:'ease-out'});
            }
          }finally{done();}
        })();
    });
    const stockCount=app.querySelector('.draw-stock-count');
    if(stockCount?.animate)stockCount.animate([{scale:1.06},{scale:1}],{duration:250});
    return Promise.all(measured.map(flyOne)).then(()=>{});
  }
  // The engine changes turn when a move is committed, but the next player
  // is not visually on turn until all move and replacement-deal flights end.
  function turnBannerText() {
    if (turnInMotion || dealing || game.phase !== 'playing') return '';
    return game.turn === 0 ? 'Your turn' : "Opponent's turn";
  }
  function animateTurnMessage(previous) {
    if (!motionAllowed() || !app.querySelector) return;
    const node=app.querySelector('.turn-banner');
    if (!node || !node.animate) return;
    const next=node.textContent;
    if (previous && !next) {
      // The outgoing banner is no longer announced as a live turn.
      // Leave it visible just long enough for its own quick fade.
      node.textContent=previous.text;
      node.style.opacity='0';
      const fade=node.animate([{opacity:previous.opacity},{opacity:0}],
        {duration:140,easing:'ease-out'});
      fade.onfinish=()=>{if(node.isConnected)node.textContent='';};
    } else if (next && (!previous || previous.text!==next)) {
      node.animate([{opacity:0},{opacity:1}],{duration:180,easing:'ease-out'});
    }
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
    const from = byComputer
      ? app.querySelector('.opponent-hand .card-back:last-child')
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
    const playerCard = game.players[byComputer ? 1 : 0].hand.find(c => c.id === move.cardId);
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
    return {kind:move.kind,byComputer,tableRects,looseCardRects,played:{id:playerCard.id,rect:rect(from),html:byComputer?renderCard(playerCard):from.outerHTML},groups:groupRects,remainingCards};
  }
  function playMotion(snapshot, after) {
    if (!snapshot || !motionAllowed() || !document.body || !app.querySelector) { after(); return; }
    const generation = motionGeneration;
    const capture = snapshot.kind === 'capture';
    const destination = capture
      ? app.querySelector(snapshot.byComputer ? '.opponent-tag' : '.your-score-tag')
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
    let motionStart=document.timeline?.currentTime;
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
        {duration,delay,fill:'both',sync:snapshot.byComputer&&snapshot.kind==='trail',easing:'cubic-bezier(.2,.72,.25,1)'}).then(()=>{
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
      ],{duration,delay:options.delay||0,fill:'both',easing:'cubic-bezier(.2,.72,.25,1)'}).then(()=>{
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
      const easing='cubic-bezier(.2,.72,.25,1)';
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
      const pile=app.querySelector(snapshot.residueOwner===1 ? '.opponent-tag' : '.your-score-tag');
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
          const gatherDuration=snapshot.byComputer?390:340;
          const gatherAt=flipDuration+gatherDuration+(stack.length-1)*stagger;
          const collectAt=gatherAt+125;
          motionStart=document.timeline?.currentTime;
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
          motionStart=document.timeline?.currentTime;
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
            await moveBuildCard(piece,slotRect,snapshot.byComputer?365:310,delay);
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
          motionStart=document.timeline?.currentTime;
          const flights=ghosts.map((g,i)=>moveBuildCard(g,{
            left:landingCenter.x+i*3-landingRect.width/2,
            top:landingCenter.y+i*2-landingRect.height/2,
            width:landingRect.width,height:landingRect.height
          },snapshot.byComputer?610:490,flipDuration));
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
      checkpoint = saved.checkpoint || null;
      hasSavedMatch = true;
    }
  } catch (error) { /* local storage may be unavailable on file:// */ }
  if (!game) game = E.newMatch();
  try {
    const stored = JSON.parse(localStorage.getItem(CUSTOM_STORE) || 'null');
    if (stored && typeof stored === 'object') customRules = {...E.rulesFor('classic'),...stored};
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
  function prettySuit(card) { return { S: '♠', H: '♥', D: '♦', C: '♣' }[card.suit]; }
  function prettyRank(card) { return ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' })[card.rank] || card.rank; }
  function suitClass(card) { return isRed(card) ? 'red' : 'black'; }
  function renderCard(card, small = false, selected = false) {
    return `<span class="playing-card ${suitClass(card)} ${small ? 'mini' : ''} ${selected?'card-selected':''} ${card.rank === 10 ? 'ten-card' : ''} rank-${String(prettyRank(card)).toLowerCase()}" data-card-id="${card.id}" aria-label="${escapeHtml(E.cardName(card))}">
      <span class="card-corner"><b>${prettyRank(card)}</b><small>${prettySuit(card)}</small></span>
      <span class="card-big">${prettyRank(card)}</span>
    </span>`;
  }
  function renderBack() { return '<span class="card-back" aria-hidden="true"><span class="back-pattern"></span></span>'; }
  // Builds are numerical targets, even when a Royal rank (A/J/Q/K) supplies
  // that value. Leave the physical card's corner index unchanged, but show
  // the actual build total (1, 11, 12, 13, 14, etc.) on the black panel.
  function buildPanelValue(value) {
    return String(value);
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
    const ownerName = element.owner === 0 ? 'You' : 'Computer';
    const panelValue = buildPanelValue(element.value);
    const layers=cards.map((card,i)=>`<span class="build-layer${groupStarts.has(i)?' build-group-start':''}" style="--layer:${i}">${renderCard(card,false,selected)}${i===cards.length-1?`<span class="build-value ${selected?'card-selected':''}"><span class="build-value-owner">${ownerName}</span><strong class="build-value-number">${panelValue}</strong></span>`:''}</span>`).join('');
    return `<button type="button" class="build-item ${selected ? 'selected' : ''}" data-action="table" data-id="${element.id}" aria-pressed="${selected}" aria-label="Select ${element.groups.length>1?'multiple ':''}${element.value} build owned by ${element.owner === 0 ? 'you' : 'computer'}">
      <span class="build-pile" style="--layers:${cards.length}" aria-hidden="true">${layers}</span>
    </button>`;
  }
  function isHumanTurn() { return screen === 'game' && game.phase === 'playing' && game.turn === 0 && !busy; }
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
  function renderToolbar(active, computerScore = 0) {
    return `<header class="header game-toolbar" aria-label="Game controls">
      <div class="toolbar-left">
        <button class="game-back" data-action="home" aria-label="Return to main menu">×</button>
        <button class="game-help" data-action="menu" aria-label="Open game menu">☰</button>
      </div>
      <div class="opponent-tag" aria-label="Computer has ${computerScore} points">Computer · ${computerScore} pts</div>
      <div class="header-actions">
        <button class="game-help" data-action="hint" aria-label="Suggest a move" title="Hint" ${active?'':'disabled'}>✧</button>
        ${prefs.undo?`<button class="game-help" data-action="undo" aria-label="Undo previous move" title="Undo" ${checkpoint?'':'disabled'}>↶</button>`:''}
      </div>
    </header>`;
  }
  function renderHome() {
    return `<main class="launch-screen">
      <div class="launch-scroll">
        <div class="launch-brand">
          <div class="launch-logo-art" aria-hidden="true">
            <svg viewBox="0 0 290 174" xmlns="http://www.w3.org/2000/svg" role="img">
              <g transform="translate(52 28) rotate(-15 48 66)"><rect width="96" height="132" rx="5" fill="#fffdf6" stroke="#102b14" stroke-width="2"/><text x="9" y="28" font-size="25" fill="#151715" font-family="Georgia">2♠</text><text x="48" y="104" text-anchor="middle" font-size="76" fill="#151715" font-family="Georgia">2</text></g>
              <g transform="translate(159 29) rotate(15 48 66)"><rect width="96" height="132" rx="5" fill="#fffdf6" stroke="#102b14" stroke-width="2"/><text x="8" y="28" font-size="25" fill="#151715" font-family="Georgia">A♣</text><text x="48" y="104" text-anchor="middle" font-size="78" fill="#151715" font-family="Georgia">A</text></g>
              <g transform="translate(104 16)"><rect width="96" height="132" rx="5" fill="#fffdf6" stroke="#102b14" stroke-width="2"/><text x="8" y="28" font-size="23" fill="#d01d19" font-family="Georgia">10♦</text><text x="48" y="104" text-anchor="middle" font-size="65" fill="#d01d19" font-family="Georgia">10</text></g>
            </svg>
          </div>
          <h1>Cassino</h1><div class="gold-divider">◆</div><p>FISHING CARD GAMES · LAB</p>
        </div>
        <div class="launch-actions">
          ${hasSavedMatch ? `<button class="launch-primary" data-action="resume-game"><b>Resume Game</b><small>vs Computer · ${escapeHtml(game.rules.name)} · Hand ${game.round}</small></button>` : ''}
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
        <p class="launch-foot">Single-player prototype · v${APP_VERSION} · Offline-ready</p>
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
    else if(!controls){human.insertAdjacentHTML('beforebegin',controlsMarkup);}
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
      template.innerHTML=renderToolbar(isHumanTurn(),opponent().score);
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
      existingSettings.innerHTML = renderSettings();
      restoreVariationsScroll();
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
    const oldLayout=motionAllowed()?layoutPositions():null;
    const previousBanner=app.querySelector?.('.turn-banner[data-turn-visible="true"]');
    const previousTurn=previousBanner ? {text:previousBanner.textContent,
      opacity:Number(globalThis.getComputedStyle?.(previousBanner).opacity ?? 1)} : null;
    if (game.phase !== 'playing') resetSelection();
    if (pickedCard && !me().hand.some(c => c.id === pickedCard)) resetSelection();
    const active = isHumanTurn();
    // Never run a validator for an action the current selection cannot show.
    const capture = pickedTable.size ? actionReady('capture') : null;
    const trail = pickedTable.size ? null : actionReady('trail');
    buildOptions = active && pickedCard && pickedTable.size ? E.contextualBuildOptions(game,pickedCard,currentSelection()) : [];
    const canTrail = !!(trail && trail.ok && !pickedTable.size);
    const canCapture = !!(capture && capture.ok && pickedTable.size);
    const canBuild = buildOptions.length > 0;
    const visibleActionCount = Number(canTrail) + Number(canCapture) + Number(canBuild);
    const actionsMarkup=buildOptions.map((o,i)=>actionButton('build',o.label,o,i)).join('')+
      (canTrail?actionButton('trail','Trail'):'')+(canCapture?actionButton('capture','Capture cards'):'');
    const controlsMarkup=active && pickedCard && visibleActionCount
      ? `<section class="controls contextual-controls" aria-label="Legal moves"><div class="main-actions">${actionsMarkup}</div></section>`:'';
    if(mode==='selection'&&syncSelection(controlsMarkup,actionsMarkup)){
      animateLayout(oldLayout);
      return;
    }
    renderedActionMarkup=actionsMarkup;
    const phaseText = turnBannerText();
    const motion = lastMotion;
    lastMotion = '';
    app.innerHTML = `
      <div class="shell ${prefs.animations ? 'animations-on' : 'animations-off'}">
        ${renderToolbar(active,opponent().score)}
        <main class="felt" data-motion="${motion}">
          <div class="table-grain"></div>
          <div class="opponent-area">
            <div class="opponent-hand" aria-label="Computer has ${opponent().hand.length} hidden cards">${opponent().hand.map(() => renderBack()).join('')}</div>
          </div>
          <div class="table-area">
            <div class="table-stage"><div class="table-cards" aria-label="Loose table cards">${game.table.some(e => e.type === 'loose') ? game.table.filter(e => e.type === 'loose').map(entryMarkup).join('') : ''}</div>
            <div class="table-builds" aria-label="Builds on the table">${game.table.filter(e => e.type === 'build').map(entryMarkup).join('')}</div></div>
            <div class="turn-banner" data-turn-visible="${!!phaseText}" aria-live="polite" aria-hidden="${!phaseText}">${phaseText}</div>
          </div>
          ${controlsMarkup}
          <div class="human-area">
            <div class="player-caption sr-only"><b>Your hand</b></div>
            <div class="human-hand">${me().hand.map(card => `<button type="button" data-action="hand" data-id="${card.id}" class="hand-item ${pickedCard === card.id ? 'selected' : ''}" aria-pressed="${pickedCard === card.id}" aria-label="Play ${escapeHtml(E.cardName(card))}" ${active ? '' : 'disabled'}>${renderCard(card,false,pickedCard===card.id)}</button>`).join('')}</div>
            <div class="your-score-tag">You · ${me().score} pts</div>
          </div>
          ${toast ? `<p class="game-error" role="alert">${escapeHtml(toast)}</p>` : ''}
          <div class="game-stats"><span>Cards Captured <b>${me().captured.length}</b></span><span>Spades Captured <b>${me().captured.filter(c=>c.suit==='S').length}</b></span>
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
    hidePendingDealCards();
    animateLayout(oldLayout,motion,motion==='capture'&&game.turn===0);
    if (motion === 'deal' || motion === 'deal-hands') dealAnimation = animateNewDeal(motion === 'deal');
    animateTurnMessage(previousTurn);
  }
  const SETTING_INFO = {
    royal: ['Face Cards', 'With Royal face cards on, Jacks, Queens and Kings have numerical values 11, 12 and 13 and may participate in sums and builds. Otherwise they capture matching face cards only.'],
    royalAces: ['Aces', 'Royal Aces may count as either 1 or 14 in captures and builds. The game chooses a legal value for the move.'],
    royalBigLittle: ['2 and 10', 'Little Cassino (2♠) can count as 2 or 15; Big Cassino (10♦) can count as 10 or 16 in captures and builds.'],
    pirateCaptures: ['Captures', 'When enabled, you may capture loose cards and other builds while you still own a build. When off, you must first capture your own build.'],
    pirateBuilds: ['Builds', 'When enabled, you may start another independent build while you own one. Each separate build requires its own matching capture card in your hand, unless Build Obligation is off. A multiple build counts as one stack. Otherwise, resolve your current build first.'],
    allowTrailWithOwnBuild: ['Trails', 'Allows trailing a card onto the table while owning builds, as long as you retain a distinct matching capture card for each independent build (unless Build Obligation is off).'],
    buildObligation: ['Build Obligation', 'When on, keep a distinct matching capture card for each independent build. One card covers one multiple build. When off, you may build without holding the capture card. The Pirate switches separately control other moves while owning builds.'],
    drawMode: ['Draw', 'After every turn, the player who played draws a replacement card until the stock is exhausted, rather than waiting for all players to run out of cards.'],
    sweepCancel: ['Sweep', 'When a capture clears the table, award a sweep. At hand scoring, each side scores only the number of sweeps beyond the opponent’s sweep count.'],
    spadeScoring: ['Spade Scoring', 'Every spade captured earns one point, plus a bonus point for the Jack of spades, replacing the ordinary most-spades award.'],
    builds: ['Building', 'Allow single builds; with this switched off, players can only capture or trail.'],
    multipleBuilds: ['Multiple Builds', 'Allow two or more equal-valued combinations to be combined into a multiple build.'],
  };
  function variationRow(key, title) {
    const expanded = detailSetting === key;
    return `<div class="variation-row">
      <button type="button" class="var-info" data-action="info-setting" data-key="${key}" aria-label="Explain ${title}" aria-expanded="${expanded}">ⓘ</button>
      <span>${title}</span>
      <label class="var-toggle"><input type="checkbox" data-setting="${key}" ${(key==='buildObligation'?!draft.buildAnything:draft[key])?'checked':''} aria-label="${title}"><i></i></label>
      ${expanded?`<p class="inline-setting-info">${escapeHtml(SETTING_INFO[key][1])}</p>`:''}
    </div>`;
  }
  function renderSettings() {
    if (!draft) draft = { ...game.rules };
    const menu = [['classic','Original'],['royal','Royal'],['spade','Spade'],['royalSpade','Royal Spade'],['custom','Custom']];
    return `<div class="dialog-head"><div><h2>${settingsOrigin==='newgame'?'New Game':'Game Setup'}</h2></div><button data-action="close" class="icon-close" aria-label="Close">×</button></div>
      <div class="dialog-content variations-content unified-setup">
        <h3>PLAYERS</h3><div class="pill-row"><button class="pill-choice selected" aria-pressed="true" type="button">2</button><button class="pill-choice" disabled>3 <small>soon</small></button><button class="pill-choice" disabled>4 <small>soon</small></button></div>
        <h3>DIFFICULTY</h3><div class="pill-row diff-row">${[['casual','Easy'],['thoughtful','Medium'],['hard','Hard'],['expert','Expert']].map(([key,name])=>`<button class="pill-choice ${draft.difficulty===key?'selected':''}" data-action="setup-difficulty" data-value="${key}" aria-pressed="${draft.difficulty===key}">${name}</button>`).join('')}</div>
        <h3>VARIATION</h3><div class="pill-row preset-grid">${menu.map(([key,name])=>`<button class="pill-choice ${draftPreset===key?'selected':''}" data-action="preset-choice" data-value="${key}" aria-pressed="${draftPreset===key}">${name}</button>`).join('')}</div>
        <h3>ROYAL OPTIONS</h3><div class="variation-card">
          ${variationRow('royal','Face Cards')}
          ${variationRow('royalAces','Aces')}
          ${variationRow('royalBigLittle','2 and 10')}
        </div>
        <h3>PIRATE OPTIONS</h3><div class="variation-card">
          ${variationRow('pirateCaptures','Captures')}
          ${variationRow('pirateBuilds','Builds')}
          ${variationRow('allowTrailWithOwnBuild','Trails')}
        </div>
        <h3>OTHER OPTIONS</h3><div class="variation-card">
          ${variationRow('drawMode','Draw')}
          ${variationRow('sweepCancel','Sweep')}
        </div>
        <h3>CLASSIC SETTINGS</h3><div class="variation-card">
          ${variationRow('builds','Allow Building')}
          ${variationRow('multipleBuilds','Multiple Builds')}
          ${variationRow('buildObligation','Build Obligation')}
          ${variationRow('spadeScoring','Spade Scoring')}
        </div>
        <h3>MATCH SETTINGS</h3><label class="setting-select"><b>Winning score</b><select data-setting="winningScore">${[11,21,31,50,61].map(n=>`<option value="${n}" ${Number(draft.winningScore)===n?'selected':''}>${n} points</option>`).join('')}</select></label>
        ${settingsOrigin==='game'?'<p class="setting-warning">Starting with these rules replaces the current match.</p>':''}
      </div><div class="dialog-actions"><button data-action="close" class="action-btn">Cancel</button><button data-action="apply-settings" class="action-btn primary">Start Game</button></div>`;
  }
  function renderMenu() {
    return `<div class="dialog-head"><div><span class="eyebrow">CASSINO LAB</span><h2>Game menu</h2><p>Single-player · Hand ${game.round} · ${escapeHtml(game.rules.name)}</p></div><button data-action="close" class="icon-close" aria-label="Close menu">×</button></div>
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
      <h3>Your turn</h3><p>Play exactly one card from your hand. <b>Capture</b> selected loose cards whose values split into groups equal to your played card, or take a matching build. <b>Trail</b> to place your card loose on the table. <b>Build</b> to combine your played card with table cards for a later capture.</p>
      <h3>Making builds</h3><p>To create a build, keep another card with its announced value in your hand. A <b>single build</b> contains one group summing to that value. A <b>multiple build</b> has two or more such groups. You can add an equal-valued group to any build; you can raise a single build by contributing its increase from your hand. Multiple builds cannot be raised. Builds are indivisible and can only be captured at their announced value.</p>
      <p>In standard Cassino, you cannot trail while owning an active build, or play away its last matching capture card.</p>
      <h3>Scoring</h3><div class="rules-points"><span>Most cards</span><b>3</b><span>Most spades</span><b>${game.rules.spadeScoring ? 'Replaced' : '1'}</b><span>10♦ (Big Cassino)</span><b>2</b><span>2♠ (Little Cassino)</span><b>1</b><span>Each ace</span><b>1</b><span>Sweeps</span><b>${game.rules.sweepPoints ? '+'+game.rules.sweepPoints : '0'}</b></div>
      ${game.rules.spadeScoring ? '<p>Spade rules: every captured spade is worth 1, plus 1 extra for J♠.</p>' : ''}
      <h3>After the final deal</h3><p>The player who made the last actual capture receives all cards still on the table. The scoring bonuses are calculated and added to the match totals. Tied majorities earn no points.</p>
      <p class="source-note">Rules basis: <a href="https://www.pagat.com/fishing/casino.html" target="_blank" rel="noopener noreferrer">Pagat — Cassino</a>. House rules differ. This first release supports the two-player core and selected variations.</p>
      </div><div class="dialog-actions"><button data-action="close" class="action-btn primary">Back to game</button></div>`;
  }
  function renderHistory() {
    return `<div class="dialog-head"><div><span class="eyebrow">MATCH JOURNAL</span><h2>Move history</h2><p>Latest actions in this hand.</p></div><button data-action="close" class="icon-close">×</button></div>
      <div class="dialog-content">${game.log.length ? `<ol class="move-log">${game.log.slice().reverse().map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ol>` : '<p>No moves yet.</p>'}</div><div class="dialog-actions"><button data-action="close" class="action-btn primary">Close</button></div>`;
  }
  function renderRound() {
    if (!game.result) return '';
    const p = game.result.points;
    const scores = game.result.scores;
    const winner = game.result.winner;
    const ended = game.phase === 'gameOver';
    const sweepInfo = game.rules.sweepPoints ? `${game.rules.sweepPoints} each${game.rules.sweepCancel?', net':''}` : '0';
    const heads = [
      'Most cards (3)',game.rules.spadeScoring?'Spades (1 each)':'Most spades (1)',
      '10♦ · Big Cassino (2)','2♠ · Little Cassino (1)',
      'Aces (1–4)',`Sweeps (${sweepInfo})`,'This hand (total)'
    ];
    const keys = ['cards','spades','big','little','aces','sweeps','total'];
    const lead = p[0].total===p[1].total ? -1 : (p[0].total>p[1].total?0:1);
    const scoreCell=(key,player)=>{
      const value=p[player][key],other=p[1-player][key];
      return `<td class="${value>other?'round-leading':''}">${value>other?`<strong>${value}</strong>`:value}</td>`;
    };
    return `<div class="dialog-head"><div><span class="eyebrow">HAND ${game.result.finishedRound} COMPLETE</span><h2>${ended ? (winner === 0 ? 'You win the match!' : 'Computer wins the match') : 'Hand results'}</h2><p>${ended ? 'Match complete. Play another?' : 'Scores are added. Continue to the next hand.'}</p></div><button data-action="close" class="icon-close">×</button></div>
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
  function cancelComputerSearch(){
    if(activeBotSearch)activeBotSearch();
  }
  function requestAdvancedMove(state){
    const view=E.publicPosition(state);
    const fallback=E.quickLegalMove(state);
    // Reuse the exact inline engine shipped in the offline HTML. The worker
    // gets only the detached public position, never the real game state.
    const source=document.scripts?.[0]?.textContent;
    if(!source||typeof Worker!=='function'||typeof Blob!=='function'||!URL.createObjectURL)
      return Promise.resolve(fallback);
    return new Promise(resolve=>{
      let worker=null,url=null,timer=null,done=false;
      function finish(move){
        if(done)return;
        done=true;
        if(timer!==null)clearTimeout(timer);
        worker?.terminate();
        if(url)URL.revokeObjectURL(url);
        if(activeBotSearch===cancel)activeBotSearch=null;
        resolve(move);
      }
      const cancel=()=>finish(null);
      activeBotSearch=cancel;
      try {
        url=URL.createObjectURL(new Blob([source,
          "\\nself.onmessage=event=>{try{const result=self.CassinoEngine.analyzeComputerMove(event.data);self.postMessage({move:result.move});}catch(error){self.postMessage({error:String(error)});}};".replace('\\n','\n')
        ],{type:'text/javascript'}));
        worker=new Worker(url);
        worker.onmessage=event=>{
          const move=event.data?.move;
          finish(move&&E.validateAction(state,move).ok?move:fallback);
        };
        worker.onerror=()=>finish(fallback);
        timer=setTimeout(()=>finish(fallback),view.rules.difficulty==='expert'?2700:1800);
        worker.postMessage(view);
      }catch(_){finish(fallback);}
    });
  }
  function botTurn() {
    if (screen !== 'game' || busy || game.phase !== 'playing' || game.turn !== 1) return;
    busy = true;
    render();
    const startedGame=game,generation=motionGeneration;
    const stillCurrent=()=>screen==='game'&&busy&&game===startedGame&&generation===motionGeneration&&game.phase==='playing'&&game.turn===1;
    const fail=error=>{
      if(!stillCurrent())return;
      busy=false;turnInMotion=false;toast=`Computer move error: ${error.message}`;render();
    };
    let search=null;
    try{
      if(game.rules?.difficulty==='hard'||game.rules?.difficulty==='expert')
        search=requestAdvancedMove(game);
    }catch(error){fail(error);return;}
    const commitMove=move=>{
      if(!stillCurrent()||!move)return;
      try{
        const stockBefore = game.stock.length;
        const preHuman=game.players[0].hand.map(c=>c.id),preCpu=game.players[1].hand.map(c=>c.id);
        const before = takeMotionSnapshot(move, true);
        rememberStockOrigin();
        const outcome = E.applyAction(game, move);
        if (!outcome.ok) throw new Error(outcome.reason);
        turnInMotion = true;
        if (before) { before.finalHand = game.phase !== 'playing'; before.residueOwner=game.lastCapture; }
        const cardsDealt = stockBefore - game.stock.length;
        if(cardsDealt>0) collectDeal(preHuman,preCpu,game.table.filter(e=>e.type==='loose').map(e=>e.card.id));
        lastMotion = move.kind;
        sound(game.phase !== 'playing' ? 'score' : move.kind);
        persist(); render();
        playMotion(before, () => completeTurn(cardsDealt));
      }catch(error){fail(error);}
    };
    // Analysis overlaps the existing thinking pause, not card animation.
    pendingBot=setTimeout(()=>{
      pendingBot=null;
      if(!stillCurrent())return;
      if(search)search.then(commitMove,fail);
      else {try{commitMove(E.chooseComputerMove(game));}catch(error){fail(error);}}
    },1200);
  }
  function play(action) {
    if (!isHumanTurn()) return;
    const check = E.validateAction(game, action);
    if (!check.ok) { toast = check.reason; render(); return; }
    const before = takeMotionSnapshot(action, false);
    rememberStockOrigin();
    const stockBefore = game.stock.length;
    const preHuman=game.players[0].hand.map(c=>c.id),preCpu=game.players[1].hand.map(c=>c.id);
    checkpoint = JSON.stringify(game);
    const result = E.applyAction(game, action);
    if (!result.ok) { toast = result.reason; return render(); }
    turnInMotion = true;
    if (before) { before.finalHand = game.phase !== 'playing'; before.residueOwner=game.lastCapture; }
    const cardsDealt = stockBefore - game.stock.length;
    if(cardsDealt>0)collectDeal(preHuman,preCpu,game.table.filter(e=>e.type==='loose').map(e=>e.card.id));
    lastMotion = action.kind;
    sound(game.phase !== 'playing' ? 'score' : (action.kind === 'capture' && result.description.includes('sweep') ? 'sweep' : action.kind));
    toast = '';
    resetSelection();
    busy = true;
    persist(); render();
    playMotion(before, () => completeTurn(cardsDealt));
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
      // Render only once at the real start of the next turn so the incoming
      // banner fade isn't immediately destroyed by a second render.
      if (game.turn === 1 && game.phase === 'playing') botTurn();
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
    const generation=motionGeneration;
    Promise.resolve(dealAnimation).then(() => {
      if(screen!=='game'||generation!==motionGeneration)return;
      dealing=false;busy=false;turnInMotion=false;persist();
      if(game.turn===1)botTurn();else render();
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
    const generation=motionGeneration;
    Promise.resolve(dealAnimation).then(() => {
      if(screen!=='game'||generation!==motionGeneration)return;
      dealing=false;busy=false;turnInMotion=false;persist();
      if(game.turn===1)botTurn();else render();
    });
  }
  // All setup entry points share a single draft and scrollable dialog.
  function openSettings(origin = screen) {
    variationsScrollTop = 0; detailSetting = ''; settingsOrigin = origin;
    const difficulty = game.rules.difficulty || 'thoughtful';
    if (origin === 'newgame') {
      draftPreset = 'classic';
      draft = E.rulesFor('classic', {difficulty});
      customDraft = customRules ? {...customRules} : null;
    } else {
      draft = {...game.rules};
      draftPreset = Object.keys(E.PRESETS).find(key => {
        const preset = E.rulesFor(key);
        return Object.keys(E.DEFAULT_RULES).every(prop =>
          prop === 'name' || prop === 'difficulty' || preset[prop] === draft[prop]);
      }) || 'custom';
      customDraft = draftPreset === 'custom' ? {...draft} : customRules ? {...customRules} : null;
    }
    modal = 'settings'; render('overlay');
  }
  function selectVariation(key) {
    if (!Object.hasOwn(E.PRESETS,key) && key !== 'custom') return;
    if (key === draftPreset) return;
    const difficulty = draft.difficulty;
    if (draftPreset === 'custom') customDraft = {...draft};
    if (key === 'custom') {
      // Restore custom edits, or inherit the previewed preset on first use.
      draft = {...(customDraft || draft),name:'Custom Cassino',difficulty};
    } else {
      draft = E.rulesFor(key,{difficulty});
    }
    draftPreset = key;
    render('overlay');
  }
  function updateDraftSetting(prop, value) {
    // Keep the saved inverse flag for backwards compatibility, with one clear UI switch.
    if(prop==='buildObligation'){prop='buildAnything';value=!value;}
    if (!draft || !Object.hasOwn(E.DEFAULT_RULES,prop) ||
        prop === 'name' || prop === 'difficulty' || draft[prop] === value) return;
    const dependents = ['multipleBuilds','pirateBuilds','allowTrailWithOwnBuild','buildAnything'];
    // Presets are starting points. Editing one creates a Custom draft.
    // Enabling a dependent rule also enables its building prerequisite.
    if (value && dependents.includes(prop)) draft.builds = true;
    draft[prop] = value;
    if (prop === 'sweepCancel') draft.sweepPoints = value ? 1 : 0;
    if (prop === 'builds' && !value) {
      for (const dependent of dependents) draft[dependent] = false;
    }
    draftPreset = 'custom';
    draft.name = 'Custom Cassino';
    customDraft = {...draft};
    render('overlay');
  }
  app.addEventListener('change', ev => {
    const target = ev.target;
    if (!(target instanceof HTMLElement) || !target.dataset.setting || target.disabled || modal !== 'settings') return;
    const prop = target.dataset.setting;
    updateDraftSetting(prop,target.type === 'checkbox' ? target.checked :
      ['winningScore','sweepPoints'].includes(prop) ? Number(target.value) : target.value);
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
    if (action === 'resume-game') { screen='game'; modal=''; sound('tap'); if(game.turn===1 && game.phase==='playing') botTurn(); else {if(game.phase!=='playing')modal='round';render();} return; }
    if (action === 'setup-new-game') { sound('tap'); return openSettings('newgame'); }
    if (action === 'info-setting' && modal === 'settings') { detailSetting=detailSetting===node.dataset.key?'':node.dataset.key; render('overlay'); return; }
    if (action === 'preset-choice' && modal === 'settings') return selectVariation(node.dataset.value);
    if (action === 'setup-difficulty' && modal === 'settings') { draft.difficulty=node.dataset.value; render('overlay'); return; }
    if (action === 'menu') { modal = 'menu'; sound('tap'); render('overlay'); return; }
    if (action === 'settings') return openSettings(screen);
    if (action === 'rules' || action === 'history') { modal = action; render('overlay'); return; }
    if (action === 'toggle-sound') { prefs.sound = !prefs.sound; savePrefs(); if (prefs.sound) sound('tap'); render('overlay'); return; }
    if (action === 'toggle-animations') { prefs.animations = !prefs.animations; savePrefs(); render('overlay'); return; }
    if (action === 'toggle-undo') { prefs.undo = !prefs.undo; savePrefs(); render('overlay'); return; }
    if (action === 'close') { modal = ''; render('overlay'); applyPendingUpdate(); return; }
    if (action === 'new-match') return startNewMatch(game.rules, true);
    if (action === 'next-hand') return nextHand();
    if (action === 'undo') return undo();
    if (action === 'apply-settings' && modal === 'settings') {
      const nextRules = { ...draft, name: draftPreset==='custom'?'Custom Cassino':E.PRESETS[draftPreset].name };
      if (!nextRules.builds) { nextRules.multipleBuilds = false; nextRules.allowTrailWithOwnBuild = false; nextRules.buildAnything = false; nextRules.pirateBuilds = false; }
      if (screen === 'game' && game.phase === 'playing' && !confirm('Start a new match with these rules?')) return;
      if (draftPreset==='custom') {customRules = {...nextRules};saveCustomRules();}
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
