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
  const APP_VERSION = '0.8.6';
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
    const ownerName = element.owner === 0 ? 'You' : 'Computer';
    const panelValue = buildPanelValue(element.value,element.signedValue);
    const layers=cards.map((card,i)=>`<span class="build-layer${groupStarts.has(i)?' build-group-start':''}" style="--layer:${i}">${renderCard(card,false,selected)}${i===cards.length-1?`<span class="build-value ${selected?'card-selected':''}"><span class="build-value-owner">${ownerName}</span><strong class="build-value-number">${panelValue}</strong></span>`:''}</span>`).join('');
    return `<button type="button" class="build-item ${selected ? 'selected' : ''}" data-action="table" data-id="${element.id}" aria-pressed="${selected}" aria-label="Select ${element.groups.length>1?'multiple ':''}${element.signedValue??element.value} build${element.signedValue<0?' (capture value '+element.value+')':''} owned by ${element.owner === 0 ? 'you' : 'computer'}">
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
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" role="img" aria-label="Fishing Lab emblem"><rect width="192" height="192" rx="37" fill="#143c33"/><g transform="rotate(-17 72 95)"><rect x="31" y="26" width="80" height="132" rx="10" fill="#204f42" stroke="#d9b96b" stroke-width="3"/><path d="M71 54c-8 9-17 15-17 23a10 10 0 0 0 17 7l-3 9h6l-3-9a10 10 0 0 0 17-7c0-8-9-14-17-23Z" fill="#e4c680"/></g><g transform="rotate(12 115 97)"><rect x="70" y="24" width="91" height="140" rx="10" fill="#fff9ea" stroke="#d9b96b" stroke-width="3"/><path d="M85 35l6 9-6 9-6-9Z M145 135l6 9-6 9-6-9Z" fill="#aa3d36"/><path d="M80 95c15-20 38-22 52-8l18-12v40l-18-12c-14 14-37 12-52-8Z" fill="#24634f"/><path d="M109 82l7-14 10 17M108 107l8 13 10-17" fill="#24634f"/><circle cx="95" cy="92" r="4" fill="#f0ce78"/><path d="M104 94c7-5 17-5 24 0" fill="none" stroke="#f0ce78" stroke-width="2.8" stroke-linecap="round"/></g></svg>
          </div>
          <h1>Fishing Lab</h1><div class="gold-divider">◆</div><p>FISHING CARD GAMES</p>
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
    const oldHandScroll=app.querySelector?.('.human-hand')?.scrollLeft||0;
    const oldLayout=mode!=='selection'&&motionAllowed()?layoutPositions():null;
    const previousBanner=mode==='selection'?null:app.querySelector?.('.turn-banner[data-turn-visible="true"]');
    const previousTurn=previousBanner ? {text:previousBanner.textContent,
      opacity:Number(globalThis.getComputedStyle?.(previousBanner).opacity ?? 1)} : null;
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
      (canTrail?actionButton('trail','Trail'):'')+(canCapture?actionButton('capture','Capture cards'):'');
    const controlsMarkup=active && pickedCard && visibleActionCount
      ? `<section class="controls contextual-controls" aria-label="Legal moves"><div class="main-actions">${actionsMarkup}</div></section>`:'';
    // Selection lift is a CSS-only transform, not a change in layout.
    // Do not layer a second FLIP animation on top or measure a transient
    // hover/selection position as if it were a new table slot.
    if(mode==='selection'&&syncSelection(controlsMarkup,actionsMarkup))return;
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
            <div class="opponent-hand${opponent().hand.length>5?' wide-hand':''}" style="--hand-count:${Math.max(1,opponent().hand.length)}" aria-label="Computer has ${opponent().hand.length} hidden cards">${opponent().hand.map(() => renderBack()).join('')}</div>
          </div>
          <div class="table-area">
            <div class="table-stage"><div class="table-cards" aria-label="Table cards">${game.table.some(e => e.type === 'loose') ? game.table.filter(e => e.type === 'loose').map(entryMarkup).join('') : ''}</div>
            <div class="table-builds" aria-label="Builds on the table">${game.table.filter(e => e.type === 'build').map(entryMarkup).join('')}</div></div>
            <div class="turn-banner" data-turn-visible="${!!phaseText}" aria-live="polite" aria-hidden="${!phaseText}">${phaseText}</div>
          </div>
          ${controlsMarkup}
          <div class="human-area">
            <div class="player-caption sr-only"><b>Your hand</b></div>
            <div class="human-hand${me().hand.length>5?' wide-hand':''}">${me().hand.map(card => `<button type="button" data-action="hand" data-id="${card.id}" class="hand-item ${pickedCard === card.id ? 'selected' : ''}" aria-pressed="${pickedCard === card.id}" aria-label="Play ${escapeHtml(E.cardName(card))}" ${active ? '' : 'disabled'}>${renderCard(card,false,pickedCard===card.id)}</button>`).join('')}</div>
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
    const currentHand=app.querySelector?.('.human-hand');if(currentHand)currentHand.scrollLeft=oldHandScroll;
    hidePendingDealCards();
    animateLayout(oldLayout,motion,motion==='capture'&&(game.lastActor??(1-game.turn))===1);
    if (motion === 'deal' || motion === 'deal-hands') dealAnimation = animateNewDeal(motion === 'deal');
    animateTurnMessage(previousTurn);
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
      "Cancel opposing sweeps one for one; only the excess sweeps score."
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
  function helpFor(key,options=[]){
    if(key==='scoreMode')return E.scoreHelp(draft);
    if(key==='playerCount')return [2,3,4,5,6].map(n=>[n+' players',n===2?'You and one computer opponent.':'You and '+(n-1)+' computer seats. Layout preview until multiplayer gameplay is implemented.']);
    if(key==='teamMode')return options.map(([mode,label])=>[label,mode==='freeForAll'?'Every player competes independently.':mode==='pairs'?(draft.playerCount===2?'Both players are one pair; there is no opposing team. This layout cannot start a competitive game.':'Teams of two, seated opposite each other when possible. '+(draft.playerCount/2)+' teams compete.'):'Two teams of three. Teammates alternate around the table.']);
    if(OPTION_HELP[key])return OPTION_HELP[key];
    if(key==='handSize')return [['1 to '+handMaximum(),'Drag the stepped slider or type a whole number into the value box. Maximum = deck size divided by player count, rounded down. Starting table cards can impose a tighter legal limit; the compatibility check catches that.'],['All cards at start','The slider has no effect in this dealing mode.']];
    if(key==='jokerValue')return options.map(n=>[String(n),'Both identical jokers have numerical capture and build value '+n+'.']);
    if(key==='initialTableSize')return options.map(([n,label])=>[label,n===0?'The table starts empty.':'Place '+n+' table cards on the table before the first turn.']);
    if(key==='sweepPoints')return options.map(n=>[String(n),n===0?'Sweeps earn no points.':'Each eligible sweep earns '+n+' point'+(n===1?'':'s')+'.']);
    if(key==='winningScore')return options.map(([n,label])=>[label,'Win at the end of a deal when you have at least '+n+' points and lead the opponent.']);
    if(key==='matchDeals')return options.map(([n,label])=>[label,n===0?'Continue until a player reaches the winning score and leads.':'Play exactly '+n+' deal'+(n===1?'':'s')+'; the higher cumulative score wins.']);
    return [['Explanation',RULE_HELP[key]||SETTING_INFO[key]?.[1]||'']];
  }
  function ruleInfo(key,title){
    return '<button type="button" class="var-info rules-info" data-action="info-setting" data-key="'+key+'" aria-label="Explain '+escapeHtml(title)+'" aria-expanded="'+(detailSetting===key)+'">ⓘ</button>';
  }
  function ruleExplanation(key,options=[]){
    if(detailSetting!==key)return '';
    return '<div class="inline-setting-info rule-option-help">'+helpFor(key,options).map(([label,description])=>'<p><b>'+escapeHtml(label)+'</b> — '+escapeHtml(description)+'</p>').join('')+'</div>';
  }
  function ruleSwitch(key,title,disabled=false,hint=''){
    disabled=disabled||!!draft.presetBlocker;
    const checked=key==='buildObligation'?!draft.buildAnything:!!draft[key];
    return '<div class="rules-setting rules-switch'+(disabled?' is-inactive':'')+'"><div class="rules-setting-label"><span class="rules-label">'+escapeHtml(title)+'</span>'+
      (hint?'<small>'+escapeHtml(hint)+'</small>':'')+'</div>'+ruleInfo(key,title)+
      '<label class="var-toggle"><input type="checkbox" data-setting="'+key+'" '+(checked?'checked ':'')+(disabled?'disabled ':'')+'aria-label="'+escapeHtml(title)+'"><i></i></label>'+
      ruleExplanation(key)+'</div>';
  }
  function ruleValue(key){
    if(key==='faceMode')return !draft.royal?'classic':draft.faceValues==='extended'?'extended':draft.faceValues==='italian'?'italian':'royal';
    if(key==='scoreMode')return draft.scoreProfile==='cassino'&&draft.spadeScoring?'spade':draft.scoreProfile;
    if(key==='aceMode')return draft.royalAces?14:(draft.aceValue||1);
    if(key==='independentBuilds')return !draft.pirateBuilds||draft.buildLimit==='1'?'1':draft.buildLimit;
    return draft[key];
  }
  function ruleSelect(key,title,options,disabled=false,hint=''){
    disabled=disabled||!!draft.presetBlocker;
    const value=ruleValue(key);
    return '<div class="rules-setting rules-select'+(disabled?' is-inactive':'')+'"><label class="rules-setting-label" for="rule-'+key+'"><span class="rules-label">'+escapeHtml(title)+'</span>'+
      (hint?'<small>'+escapeHtml(hint)+'</small>':'')+'</label>'+ruleInfo(key,title)+
      '<select id="rule-'+key+'" data-setting="'+key+'" aria-label="'+escapeHtml(title)+'" '+(disabled?'disabled':'')+'>'+
      options.map(option=>{const pair=Array.isArray(option)?option:[option,option];return '<option value="'+escapeHtml(pair[0])+'" '+(String(value)===String(pair[0])?'selected':'')+'>'+escapeHtml(pair[1])+'</option>';}).join('')+
      '</select>'+ruleExplanation(key,options)+'</div>';
  }
  function ruleGroup(title,content){
    return '<h4 class="rules-subheading">'+title+'</h4><div class="rules-group">'+content+'</div>';
  }
  function effectiveDraftRules(){
    const r=E.normalizeRules(draft);
    // Keep preferences in the editor; deactivate only when exporting to the engine.
    if(!r.builds){
      for(const key of ['additiveBuilding','negativeBuilds','colorArithmetic','multipleBuilds','buildAnything','allowTrailWithOwnBuild','pirateBuilds','pirateCaptures','subtractiveBuilds','singleCardBuild','mergeSameValue','absorbMatching','tableOnlyBuild','additiveBuilds'])r[key]=false;
      if(r.pileAccess==='build')r.pileAccess='none';
      if(r.pileAccess==='both')r.pileAccess='capture';
    }
    if(!r.subtractiveBuilds)r.negativeBuilds=false;
    if(!r.multipleBuilds){r.mergeSameValue=false;r.absorbMatching=false;}
    if(!r.additiveCapture)r.additiveBuilds=false;
    if(!r.sweepPoints)r.sweepCancel=false;
    return r;
  }
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
    const locked=disabled||!!draft.presetBlocker||!vals.length;
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
  const TEAM_LABELS={freeForAll:'Free for all',pairs:'Pairs',triples:'Triples'};
  function playerTeamOptions(count){return E.teamModesFor(count).map(mode=>[mode,TEAM_LABELS[mode]]);}
  function playerSetupSummary(rules=draft){
    return rules.playerCount+' players · '+TEAM_LABELS[rules.teamMode];
  }
  function playerHeader(rules=draft){
    return 'FISHING LAB · '+rules.playerCount+' PLAYERS · '+(rules.playerCount===2&&rules.teamMode==='freeForAll'?'VS COMPUTER':'SETUP PREVIEW');
  }
  function playerCountSetting(){
    const n=draft.playerCount,disabled=!!draft.presetBlocker;
    return '<div class="rules-setting hand-slider-setting player-count-setting'+(disabled?' is-inactive':'')+'"><label class="rules-setting-label" for="rule-playerCount"><span class="rules-label">Number of players</span></label>'+ruleInfo('playerCount','Number of players')+
      '<output class="player-count-number" id="player-count-output" for="rule-playerCount">'+n+'</output>'+
      '<div class="hand-slider-control player-count-control"><input id="rule-playerCount" type="range" data-setting="playerCount" min="2" max="6" step="1" value="'+n+'" '+(disabled?'disabled':'')+' aria-label="Number of players">'+
      '<div class="player-count-ticks" aria-hidden="true">'+[2,3,4,5,6].map(v=>'<span class="'+(v===n?'active':'')+'" data-player-tick="'+v+'"><i></i><b>'+v+'</b></span>').join('')+'</div></div>'+
      ruleExplanation('playerCount')+'</div>';
  }
  function seatingDiagram(rules=draft){
    const n=rules.playerCount,mode=rules.teamMode,seats=E.seatAssignments(n,mode);
    const colors=['#346da8','#ac4847','#367c55'];
    const free=mode==='freeForAll';
    const fillFor=s=>free?(s.human?colors[0]:'#777b73'):colors[s.team];
    const labels=seats.map(s=>(s.human?'You':'CPU '+s.seat)+(free?'':', team '+(s.team+1)));
    const groups=seats.map(s=>{
      const angle=2*Math.PI*s.seat/n;
      const x=160-114*Math.sin(angle),y=108+78*Math.cos(angle);
      const xPos=x.toFixed(2),yPos=y.toFixed(2),label=s.human?'You':'CPU '+s.seat;
      return '<g class="setup-seat'+(s.human?' human-seat':'')+'" data-seat="'+s.seat+'" data-team="'+(s.team===null?'none':s.team)+'" data-seat-x="'+xPos+'" data-seat-y="'+yPos+'" transform="translate('+xPos+' '+yPos+')"><title>'+escapeHtml(labels[s.seat])+(s.human?' (south seat)':'')+'</title>'+
        '<rect x="-28" y="-16" width="56" height="32" rx="9" fill="'+fillFor(s)+'" stroke="'+(s.human?'#193b60':'#fffaf1')+'" stroke-width="'+(s.human?2.5:2)+'"/>'+
        '<text x="0" y="4" text-anchor="middle" fill="#ffffff" font-size="10.5" font-weight="700">'+label+'</text></g>';
    }).join('');
    const legend=free?
      '<span><i style="background:'+colors[0]+'"></i>You</span><span><i style="background:#777b73"></i>Individual opponents</span>':
      Array.from({length:n/(mode==='pairs'?2:3)},(_,i)=>'<span><i style="background:'+colors[i]+'"></i>'+(i===0?'Your team':'Team '+(i+1))+'</span>').join('');
    const notice=n===2&&mode==='pairs'?'One pair, no opposing team. Select Free for all to play.':n>2?'Seating preview — multiplayer gameplay is not implemented yet.':'';
    return '<div class="setup-table-figure"><svg viewBox="0 0 320 214" class="setup-table-svg" role="img" aria-labelledby="setup-table-title setup-table-desc">'+
      '<title id="setup-table-title">'+escapeHtml(playerSetupSummary(rules))+' seating</title><desc id="setup-table-desc">You sit at the south seat. '+escapeHtml(labels.join('; '))+'.</desc>'+
      '<ellipse cx="160" cy="108" rx="82" ry="48" fill="#b59b63"/><ellipse cx="160" cy="108" rx="78" ry="44" fill="#1b593e" stroke="#d4bb82" stroke-width="1.5"/>'+
      '<ellipse cx="160" cy="108" rx="71" ry="37" fill="none" stroke="#8baf91" stroke-width=".8" stroke-dasharray="2.5 3" opacity=".6"/>'+
      '<text x="160" y="105" fill="#eae7d2" font-size="10" font-weight="700" text-anchor="middle" letter-spacing="1.1">TABLE</text>'+
      '<text x="160" y="120" fill="#c6ddc3" font-size="10" text-anchor="middle">'+n+' seats</text>'+groups+'</svg>'+
      '<div class="setup-seat-legend">'+legend+'</div>'+(notice?'<p class="setup-preview-note">'+escapeHtml(notice)+'</p>':'')+'</div>';
  }
  function playerSetupContent(){
    return '<div class="rules-group player-setup-group">'+playerCountSetting()+
      ruleSelect('teamMode','Teams',playerTeamOptions(draft.playerCount))+
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
  function forcedSetting(){return ruleSelect('forcedCapture','Compulsory captures',[['optional','Optional'],['faces','Face cards only'],['direct','Direct matches'],['all','Any legal match']]);}
  function renderPresetPicker(){
    const chosen=E.PRESET_CATALOG.find(p=>p.id===draftPreset),groups=[...new Set(E.PRESET_CATALOG.map(p=>p.group))];
    const options=groups.map(group=>'<optgroup label="'+escapeHtml(group)+'">'+E.PRESET_CATALOG.filter(p=>p.group===group).map(p=>'<option value="'+p.id+'" '+(draftPreset===p.id?'selected':'')+'>'+escapeHtml(p.name+(p.status==='preview'?' — preview':''))+'</option>').join('')+'</optgroup>').join('');
    return '<div class="preset-picker"><label for="variation-picker" class="rules-main-label">Game variation</label><select id="variation-picker" data-setting="preset" aria-label="Game variation"><option value="custom" '+(draftPreset==='custom'?'selected':'')+'>Custom rules</option>'+options+'</select>'+
      '<p class="preset-description">'+escapeHtml(chosen?chosen.note:'Your own combination of fishing-game mechanics.')+'</p>'+
      (draft.presetBlocker?'<div class="preset-preview-note" role="note"><b>Research preview — not playable yet</b><p>'+escapeHtml(draft.presetBlocker)+'</p>'+
      (chosen?.partial?'<button type="button" class="rules-reset" data-action="use-partial-preset">Use available mechanics as Custom</button>':'')+'</div>':'')+'</div>';
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
    return '<p class="rules-description">Test 10 seeded CPU-versus-CPU deals with the current rules. Failures retain the seed, board and move log. Passing is not proof of universal playability.</p>'+
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
      ruleSwitch('singleCardBuild','Allow single hand card builds',!building)+
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
    const turnContent='<p class="rules-description">Play one hand card per action. The opponent normally plays next.</p><div class="rules-group">'+
      ruleSwitch('extraAfterSweep','Extra turn after opponent sweep')+'</div>';
    const scoreContent='<div class="rules-group">'+ruleSelect('scoreMode','Scoring system',[['cassino','Classic Cassino'],['spade','Spade Cassino'],['wippen','Wippen'],['diloti','Diloti'],['kontsina','Kontsina'],['tablic','Tablić / Tabinet'],['scopa','Scopa']])+
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
    if(/capture method|compulsory direct/i.test(message))return 'capture';
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
    if(screen!=='game'||game.phase!=='playing'||game.turn!==1)return null;
    if(preparedBotTurn?.state===game&&preparedBotTurn.generation===motionGeneration&&
       preparedBotTurn.moveNumber===game.moveNumber)return preparedBotTurn;
    cancelComputerSearch();
    const prepared={state:game,generation:motionGeneration,moveNumber:game.moveNumber,promise:null,error:null};
    try{prepared.promise=requestAdvancedMove(game);}
    catch(error){prepared.error=error;prepared.promise=Promise.resolve(null);}
    preparedBotTurn=prepared;
    return prepared;
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
    const prepared=prepareComputerTurn();
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
        if (before) { before.finalHand = game.phase !== 'playing'; before.residueOwner=game.rules.residueOwner==='dealer'?game.dealer:game.lastCapture; }
        const cardsDealt = stockBefore - game.stock.length;
        if(cardsDealt>0) collectDeal(preHuman,preCpu,game.table.filter(e=>e.type==='loose').map(e=>e.card.id));
        lastMotion = move.kind;
        sound(game.phase !== 'playing' ? 'score' : move.kind);
        persist(); render();
        playMotion(before, () => completeTurn(cardsDealt));
      }catch(error){fail(error);}
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
    checkpoint = JSON.stringify(game);
    const result = E.applyAction(game, action);
    if (!result.ok) { toast = result.reason; return render(); }
    turnInMotion = true;
    if (before) { before.finalHand = game.phase !== 'playing'; before.residueOwner=game.rules.residueOwner==='dealer'?game.dealer:game.lastCapture; }
    const cardsDealt = stockBefore - game.stock.length;
    if(cardsDealt>0)collectDeal(preHuman,preCpu,game.table.filter(e=>e.type==='loose').map(e=>e.card.id));
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
    prepareComputerTurn();
    const generation=motionGeneration;
    Promise.resolve(dealAnimation).then(() => {
      if(screen!=='game'||generation!==motionGeneration)return;
      dealing=false;busy=false;turnInMotion=false;persist();
      if(game.turn===1)botTurn();else render();
    });
  }
  // All setup entry points share a single draft and scrollable dialog.
  function openSettings(origin = screen) {
    variationsScrollTop = 0; detailSetting = ''; settingsOrigin = origin; rulesSection=''; rulesIssuesOpen=false; labResult=null; difficultyInfoOpen=false; valueCardKey='S1';valuePickerOpen=false;deckChecklistScroll=0;
    const difficulty = game.rules.difficulty || 'thoughtful';
    if (origin === 'newgame') {
      draftPreset = 'classic';
      draft = E.rulesFor('classic', {difficulty});
      customDraft = customRules ? {...customRules} : null;
    } else {
      draft = E.normalizeRules(game.rules);
      draftPreset = Object.keys(E.PRESETS).sort((x,y)=>Number(E.PRESETS[y].name===draft.name)-Number(E.PRESETS[x].name===draft.name)).find(key => {
        const preset = E.rulesFor(key);
        return Object.keys(E.DEFAULT_RULES).every(prop =>
          prop === 'name' || prop === 'difficulty' || JSON.stringify(preset[prop]) === JSON.stringify(draft[prop]));
      }) || 'custom';
      customDraft = draftPreset === 'custom' ? {...draft} : customRules ? {...customRules} : null;
    }
    modal = 'settings'; render('overlay');
  }
  function selectVariation(key) {
    if (!Object.hasOwn(E.PRESETS,key) && key !== 'custom') return;
    if (key === draftPreset) return;
    labResult=null; rulesIssuesOpen=false;valuePickerOpen=false;deckChecklistScroll=0;
    const difficulty = draft.difficulty;
    if (draftPreset === 'custom') customDraft = {...draft};
    if (key === 'custom') {
      // Restore custom edits, or inherit the previewed preset on first use.
      draft = {...(customDraft || (draft.presetBlocker?E.rulesFor('classic'):draft)),name:'Custom Fishing',difficulty,presetBlocker:''};
    } else {
      draft = E.rulesFor(key,{difficulty});
    }
    draft=E.normalizeRules(draft);fitBuildBounds();draftPreset = key;
    render('overlay');
  }
  function commitDraftEdit(){
    draft=E.normalizeRules(draft);fitBuildBounds();
    draftPreset='custom';draft.name='Custom Fishing';customDraft={...draft};
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
  function updateDraftSetting(prop,value){
    if(!draft||draft.presetBlocker)return;
    if(prop==='playerCount'){
      if(![2,3,4,5,6].includes(value)||draft.playerCount===value)return;
      draft.playerCount=value;
      if(!E.teamModesFor(value).includes(draft.teamMode))draft.teamMode='freeForAll';
      fitHandSize();commitDraftEdit();return;
    }
    if(prop==='teamMode'){
      if(!E.teamModesFor(draft.playerCount).includes(value)||draft.teamMode===value)return;
      draft.teamMode=value;commitDraftEdit();return;
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
    if(draft.customizeCardValues&&['faceMode','aceMode','royalBigLittle','jokerValue'].includes(prop))return;
    if(prop==='handSize'&&(!Number.isInteger(value)||value<1||value>handMaximum()))return;
    if(prop==='buildRange'&&!['all','9-13','10-13','custom'].includes(value))return;
    if(['buildMin','buildMax'].includes(prop)&&(!draft.builds||draft.buildRange!=='custom'||!buildBoundChoices(prop).includes(value)))return;
    if(String(ruleValue(prop))===String(value))return;
    if(prop==='faceMode'){
      if(!['classic','royal','extended','italian'].includes(value))return;
      draft.royal=value!=='classic';
      draft.faceValues=value==='classic'||value==='royal'?'standard':value;
    }else if(prop==='scoreMode'){
      if(!['cassino','spade','wippen','diloti','kontsina','tablic','scopa'].includes(value))return;
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
    draftPreset='custom';draft.name='Custom Fishing';customDraft={...draft};labResult=null;
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
    if(!draft||draft.presetBlocker||!draft.builds||draft.buildRange!=='custom'||!['buildMin','buildMax'].includes(key)||!buildBoundChoices(key).includes(value))return false;
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
    if(target?.dataset?.setting==='playerCount'){
      // Preview every slider step without replacing the active range input.
      // The change event commits the configuration and revalidates dealing.
      const n=Number(target.value);
      if(![2,3,4,5,6].includes(n)||draft.presetBlocker)return;
      const allowed=E.teamModesFor(n),mode=allowed.includes(draft.teamMode)?draft.teamMode:'freeForAll';
      const preview={...draft,playerCount:n,teamMode:mode};
      const output=app.querySelector('#player-count-output');if(output)output.textContent=String(n);
      for(const tick of app.querySelectorAll('[data-player-tick]'))tick.classList.toggle('active',Number(tick.dataset.playerTick)===n);
      const select=app.querySelector('#rule-teamMode');
      if(select)select.innerHTML=playerTeamOptions(n).map(([value,label])=>'<option value="'+value+'" '+(value===mode?'selected':'')+'>'+label+'</option>').join('');
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
      if(target?.dataset?.setting==='handSizeText'){ev.preventDefault();finishHandSizeText(target);target.blur();}
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
    if (action === 'resume-game') { screen='game'; modal=''; sound('tap'); if(game.turn===1 && game.phase==='playing') botTurn(); else {if(game.phase!=='playing')modal='round';render();} return; }
    if (action === 'setup-new-game') { sound('tap'); return openSettings('newgame'); }
    if (action === 'info-setting' && modal === 'settings') { detailSetting=detailSetting===node.dataset.key?'':node.dataset.key; render('overlay'); return; }
    if(action==='difficulty-info'&&modal==='settings'){difficultyInfoOpen=!difficultyInfoOpen;render('overlay');return;}
    if(modal==='settings'&&(action==='deck-all'||action==='deck-none'))return updateDeckCards(action==='deck-all'?E.allCards().map(c=>c.id):[]);
    if(modal==='settings'&&action==='toggle-value-picker'){if(draft.customizeCardValues&&E.makeDeck(draft).length){valuePickerOpen=!valuePickerOpen;render('overlay');}return;}
    if(modal==='settings'&&action==='value-card'){if(draft.customizeCardValues&&E.makeDeck(draft).some(c=>E.cardKey(c)===node.dataset.value)){valueCardKey=node.dataset.value;valuePickerOpen=false;render('overlay');}return;}
    if(action==='use-partial-preset'&&modal==='settings'){
      const p=E.PRESET_CATALOG.find(x=>x.id===draftPreset);
      if(!p?.partial||!draft.presetBlocker)return;
      draft=E.normalizeRules({...draft,presetBlocker:'',name:'Custom Fishing'});
      draftPreset='custom';customDraft={...draft};labResult=null;rulesIssuesOpen=false;render('overlay');return;
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
    if (action === 'toggle-undo') { prefs.undo = !prefs.undo; savePrefs(); render('overlay'); return; }
    if (action === 'close') { modal = ''; render('overlay'); applyPendingUpdate(); return; }
    if (action === 'new-match') return startNewMatch(game.rules, true);
    if (action === 'next-hand') return nextHand();
    if (action === 'undo') return undo();
    if (action === 'apply-settings' && modal === 'settings') {
      const nextRules={...effectiveDraftRules(),name:draftPreset==='custom'?'Custom Fishing':E.PRESETS[draftPreset].name};
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
