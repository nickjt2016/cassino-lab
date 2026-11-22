/* Cassino Lab browser UI: all gameplay calls the shared rules engine. */
(function () {
  'use strict';
  const E = globalThis.CassinoEngine;
  if (!E) throw new Error('Cassino rules engine did not load.');
  const STORE = 'cassino-lab-v1';
  let game, checkpoint = null, pickedCard = null, pickedTable = new Set();
  let toast = '', modal = '', hint = null, busy = false, pendingBot = null;
  let draft = null, draftPreset = 'classic';
  let detailSetting = '';
  let variationsScrollTop = 0;
  let buildOptions = [], buildMenuOpen = false, lastMotion = '';
  let moveAnnouncement = ''; let announcementTimer = null;
  let screen = 'home';
  let hasSavedMatch = false;
  let setup = { difficulty: 'thoughtful', preset: 'classic' };
  let settingsOrigin = 'home';
  const CUSTOM_STORE = 'cassino-lab-custom-rules-v1';
  let customRules = null;

  const PREF_STORE = 'cassino-lab-prefs-v1';
  let prefs = { sound: true, animations: true };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREF_STORE) || '{}') }; } catch (_) {}
  let audioContext = null;
  const app = document.getElementById('app');
  function savePrefs() {
    try { localStorage.setItem(PREF_STORE, JSON.stringify(prefs)); } catch (_) {}
  }
  // Synthesized, original card-table Foley: a short dry click followed by a
  // quiet paper brush.  No audio samples from the reference app are reused.
  function sound(type = 'tap') {
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
        deal: [[0, .045, .05], [.075, .045, .05], [.15, .045, .05], [.225, .045, .05]],
      }[type] || [[0, .04, .045]];
      for (const [offset, volume, duration] of pattern) {
        const frames = Math.ceil(rate * duration);
        const buffer = audioContext.createBuffer(1, frames, rate);
        const channel = buffer.getChannelData(0);
        // Crisp attack + a decaying paper/riffle tail; intentionally subtle.
        for (let i = 0; i < frames; i++) {
          const t = i / rate;
          const body = Math.exp(-t * 72);
          const brush = Math.exp(-t * 21) * .29;
          channel[i] = (Math.random() * 2 - 1) * (body + brush);
        }
        const src = audioContext.createBufferSource(); src.buffer = buffer;
        const filter = audioContext.createBiquadFilter();
        filter.type = 'bandpass'; filter.frequency.value = type === 'tap' ? 1800 : 1050;
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
  function animateLayout(previous) {
    if (!previous || !motionAllowed() || !app.querySelectorAll) return;
    const nodes = [...app.querySelectorAll('[data-action="table"][data-id], [data-action="hand"][data-id]'),
      ...app.querySelectorAll('.opponent-hand .card-back')];
    let cpu=0;
    nodes.forEach(node => {
      const key = node.classList.contains('card-back') ? 'cpu-back:'+(cpu++) : node.dataset.action+':'+node.dataset.id;
      const from=previous.get(key);
      if(!from || !node.animate) return;
      const rect=node.getBoundingClientRect();
      const dx=from.x-(rect.left+rect.width/2), dy=from.y-(rect.top+rect.height/2);
      if(Math.abs(dx)<2 && Math.abs(dy)<2) return;
      node.animate([{translate:`${dx}px ${dy}px`},{translate:'0px 0px'}],
        {duration:420,easing:'cubic-bezier(.2,.8,.2,1)'});
    });
  }
  function animateNewDeal() {
    if (!motionAllowed() || !app.querySelectorAll) return;
    const stock = app.querySelector('.game-stats');
    if(!stock) return;
    const sr=stock.getBoundingClientRect();
    const start={x:sr.left+sr.width*.84,y:sr.top+sr.height/2};
    const cards=[...app.querySelectorAll('.opponent-hand .card-back'),
      ...app.querySelectorAll('.human-hand .playing-card')];
    cards.forEach((card,i)=>{
      if(!card.animate) return;
      const r=card.getBoundingClientRect();
      const dx=start.x-(r.left+r.width/2),dy=start.y-(r.top+r.height/2);
      card.animate([
        {translate:`${dx}px ${dy}px`,rotate:i%2?'7deg':'-7deg'},
        {translate:'0px 0px',rotate:'0deg'}
      ],{duration:540,delay:i*48,easing:'cubic-bezier(.2,.84,.22,1)',fill:'backwards'});
    });
  }
  function animateTurnMessage(previous) {
    if (!motionAllowed() || !app.querySelector || previous===null) return;
    const node=app.querySelector('.turn-banner');
    if (node && node.textContent!==previous && node.animate)
      node.animate([{opacity:.55,translate:'0px 5px'},{opacity:1,translate:'0px 0px'}],
        {duration:320,easing:'ease-out'});
  }
  function cancelMotion() {
    motionGeneration++;
    if (document.querySelectorAll) document.querySelectorAll('.card-flight').forEach(node => node.remove());
  }
  function takeMotionSnapshot(move, byComputer = false) {
    if (!motionAllowed() || !document.body || !app.querySelector) return null;
    const from = byComputer
      ? app.querySelector('.opponent-hand .card-back:last-child')
      : app.querySelector(`.hand-item[data-id="${move.cardId}"] .playing-card`);
    if (!from || !from.getBoundingClientRect) return null;
    const rect = node => {
      const r = node.getBoundingClientRect();
      return {left:r.left,top:r.top,width:r.width,height:r.height};
    };
    const playerCard = game.players[byComputer ? 1 : 0].hand.find(c => c.id === move.cardId);
    if (!playerCard) return null;
    const groupRects = (move.targetIds || []).map(id => {
      const node = Array.from(app.querySelectorAll('[data-action="table"]')).find(el => el.dataset.id === id);
      return node ? {rect:rect(node),html:node.querySelector('.playing-card')?.outerHTML || node.outerHTML} : null;
    }).filter(Boolean);
    return {kind:move.kind,byComputer,played:{rect:rect(from),html:renderCard(playerCard)},groups:groupRects};
  }
  function playMotion(snapshot, after) {
    if (!snapshot || !document.body || !app.querySelector) { after(); return; }
    const generation = motionGeneration;
    const capture = snapshot.kind === 'capture';
    const target = capture
      ? app.querySelector(snapshot.byComputer ? '.opponent-tag' : '.your-score-tag')
      : app.querySelector(`[data-action="table"][data-id="${game.table[game.table.length-1]?.id}"]`);
    if (!target || !target.getBoundingClientRect) { after(); return; }
    const targetRect = target.getBoundingClientRect();
    const center = r => ({x:r.left+r.width/2,y:r.top+r.height/2});
    const end = center(targetRect);
    // The final trail/build group must not appear before the flying card arrives.
    if (!capture) target.style.visibility = 'hidden';
    const tasks = [snapshot.played,...snapshot.groups];
    const duration = snapshot.byComputer ? 880 : 660;
    const animationPromises = tasks.map((piece,index) => new Promise(resolve => {
      const ghost = document.createElement('div');
      ghost.className = 'card-flight';
      ghost.innerHTML = piece.html;
      const start = piece.rect;
      Object.assign(ghost.style,{position:'fixed',pointerEvents:'none',zIndex:'80',
        left:start.left+'px',top:start.top+'px',width:start.width+'px',height:start.height+'px',
        margin:'0',padding:'0',transformOrigin:'center',willChange:'transform,opacity'});
      const inner = ghost.querySelector('.playing-card');
      if (inner) Object.assign(inner.style,{width:'100%',height:'100%',margin:'0'});
      document.body.appendChild(ghost);
      const c = center(start);
      const dx = end.x - c.x, dy = end.y - c.y;
      const scale = capture ? .53 : (snapshot.kind === 'build' ? .66 : (snapshot.byComputer ? Math.min(1.5, targetRect.width / Math.max(start.width,1)) : 1));
      // Captures travel from the table toward the appropriate captured pile.
      // Trails and builds slide directly to their new table location, opaque.
      const frames = [
        {transform:'translate(0px,0px) rotate(0deg) scale(1)',opacity:1,offset:0},
        {transform:`translate(${dx*.48}px,${dy*.48-11}px) rotate(${index%2 ? -3 : 3}deg) scale(${snapshot.byComputer && index === 0 ? 1.18 : 1.02})`,opacity:1,offset:.48},
        {transform:`translate(${dx*.83}px,${dy*.83-3}px) rotate(1deg) scale(${scale+.12})`,opacity:1,offset:.84},
        {transform:`translate(${dx}px,${dy}px) rotate(0deg) scale(${scale})`,opacity:capture?.04:1,offset:1}
      ];
      if (ghost.animate) {
        const animation=ghost.animate(frames,{duration,delay:index*62,fill:'forwards',easing:'cubic-bezier(.23,.68,.28,1)'});
        const finish=()=>{ghost.remove();resolve();};
        animation.onfinish=finish; animation.oncancel=finish;
      } else {ghost.remove();resolve();}
    }));
    Promise.all(animationPromises).then(() => {
      if(generation !== motionGeneration) return;
      if(!capture && target.isConnected) target.style.visibility = 'visible';
      after();
    });
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
  if (!customRules) customRules = {...E.rulesFor('classic'), name:'Custom Cassino'};
  function saveCustomRules() {
    try { localStorage.setItem(CUSTOM_STORE, JSON.stringify(customRules)); } catch (_) {}
  }
  function persist() {
    hasSavedMatch = true;
    try { localStorage.setItem(STORE, JSON.stringify({ game, checkpoint })); } catch (error) { /* optional persistence */ }
  }
  function me() { return game.players[0]; }
  function opponent() { return game.players[1]; }
  function isRed(card) { return card.suit === 'D' || card.suit === 'H'; }
  function prettySuit(card) { return { S: '♠', H: '♥', D: '♦', C: '♣' }[card.suit]; }
  function prettyRank(card) { return ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' })[card.rank] || card.rank; }
  function suitClass(card) { return isRed(card) ? 'red' : 'black'; }
  function renderCard(card, small = false) {
    return `<span class="playing-card ${suitClass(card)} ${small ? 'mini' : ''} ${card.rank === 10 ? 'ten-card' : ''}" aria-label="${escapeHtml(E.cardName(card))}">
      <span class="card-corner"><b>${prettyRank(card)}</b><small>${prettySuit(card)}</small></span>
      <span class="card-big">${prettyRank(card)}</span>
    </span>`;
  }
  function renderBack() { return '<span class="card-back" aria-hidden="true"><span class="back-pattern"></span></span>'; }
  function elCards(element) { return E.cardsInElement(element); }
  function entryMarkup(element) {
    const selected = pickedTable.has(element.id);
    if (element.type === 'loose') {
      return `<button type="button" class="table-item ${selected ? 'selected' : ''}" data-action="table" data-id="${element.id}" aria-pressed="${selected}" aria-label="Select ${escapeHtml(E.cardName(element.card))} on table">${renderCard(element.card)}</button>`;
    }
    const groups = element.groups.map(group => `<span class="build-group">${group.map(card => renderCard(card, true)).join('')}</span>`).join('<span class="group-plus">+</span>');
    const owner = element.owner === 0 ? 'YOU' : 'CPU';
    return `<button type="button" class="build-item ${selected ? 'selected' : ''}" data-action="table" data-id="${element.id}" aria-pressed="${selected}" aria-label="Select ${element.value} build owned by ${element.owner === 0 ? 'you' : 'computer'}">
      <span class="build-top"><b>${element.value}-BUILD</b><small>${element.groups.length > 1 ? 'MULTIPLE' : 'SINGLE'}</small><em class="${element.owner === 0 ? 'your-owner' : ''}">${owner}</em></span>
      <span class="build-groups">${groups}</span>
    </button>`;
  }
  function isHumanTurn() { return screen === 'game' && game.phase === 'playing' && game.turn === 0 && !busy; }
  function currentSelection() { return [...pickedTable]; }
  function actionReady(kind) {
    if (!isHumanTurn() || !pickedCard) return null;
    const move = { kind, cardId: pickedCard, targetIds: kind === 'trail' ? [] : currentSelection() };
    return E.validateAction(game, move);
  }
  function numberLabel(n, singular, plural) { return `${n} ${n === 1 ? singular : plural}`; }
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
        <p class="launch-foot">Single-player prototype · v0.4.3 · Offline-ready</p>
      </div>
      ${modal ? renderModal() : ''}
    </main>`;
  }
  function renderNewGame() {
    const diffButtons = [['casual','Easy'], ['thoughtful','Medium']];
    const presets = [['classic','Original'],['royal','Royal'],['custom','Custom']];
    return `<div class="dialog-head"><div><h2>New Game</h2><p class="gold-divider">◆</p></div><button data-action="close" class="icon-close" aria-label="Close">×</button></div>
      <div class="dialog-content newgame-settings">
        <h3>PLAYERS</h3><div class="pill-row"><button class="pill-choice selected">2</button><button class="pill-choice" disabled title="Coming later">3 <small>soon</small></button><button class="pill-choice" disabled title="Coming later">4 <small>soon</small></button></div>
        <h3>DIFFICULTY</h3><div class="pill-row diff-row">${diffButtons.map(([k,v])=>`<button class="pill-choice ${setup.difficulty===k?'selected':''}" data-action="setup-difficulty" data-value="${k}">${v}</button>`).join('')}<button class="pill-choice" disabled>Hard <small>soon</small></button><button class="pill-choice" disabled>Insane <small>soon</small></button></div>
        <h3>VARIATION</h3><div class="pill-row">${presets.map(([k,v])=>`<button class="pill-choice ${setup.preset===k?'selected':''}" data-action="setup-preset" data-value="${k}">${v}</button>`).join('')}</div>
        <p class="newgame-note">Original uses traditional Cassino rules. Royal gives numerical values to face cards. Tap Custom to open and edit your saved custom rules before playing.</p>
      </div>
      <div class="dialog-actions"><button data-action="close" class="action-btn">Cancel</button><button data-action="start-game" class="action-btn primary">Start Game</button></div>`;
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
  function render() {
    if (!app) return;
    const oldLayout = screen === 'game' && motionAllowed() ? layoutPositions() : null;
    const previousTurn = app.querySelector ? app.querySelector('.turn-banner')?.textContent ?? null : null;
    rememberVariationsScroll();
    if (screen === 'home') { app.innerHTML = renderHome(); restoreVariationsScroll(); return; }
    if (game.phase !== 'playing') { pickedCard = null; pickedTable.clear(); }
    if (pickedCard && !me().hand.some(c => c.id === pickedCard)) { pickedCard = null; pickedTable.clear(); }
    const active = isHumanTurn();
    const capture = actionReady('capture');
    const trail = actionReady('trail');
    buildOptions = active && pickedCard ? E.legalBuildOptions(game, pickedCard, currentSelection()) : [];
    const chosen = me().hand.find(c => c.id === pickedCard);
    const canTrail = !!(trail && trail.ok && !pickedTable.size);
    const canCapture = !!(capture && capture.ok && pickedTable.size);
    const canBuild = buildOptions.length > 0;
    const visibleActionCount = Number(canTrail) + Number(canCapture) + Number(canBuild);
    const phaseText = game.phase !== 'playing' ? 'Hand finished' : (hint && toast) || moveAnnouncement || (busy || game.turn === 1 ? 'Computer thinking…' : 'Your turn');
    const statusText = hint && toast ? toast : chosen
      ? `${E.cardName(chosen)} selected · ${numberLabel(pickedTable.size, 'table group', 'table groups')} selected`
      : pickedTable.size ? `${numberLabel(pickedTable.size, 'table card', 'table cards')} selected · choose a hand card` : 'Choose cards to build or capture.';
    const rules = game.rules;
    const motion = lastMotion;
    lastMotion = '';
    if (!buildOptions.length) buildMenuOpen = false;
    app.innerHTML = `
      <div class="shell ${prefs.animations ? 'animations-on' : 'animations-off'}">
        <header class="header">
          <button class="game-back" data-action="home" aria-label="Return to main menu">×</button>
          <div class="game-heading" aria-label="Cassino Lab"></div>
          <div class="header-actions"><button class="game-help" data-action="hint" aria-label="Suggest a move" title="Hint">✧</button><button class="game-help" data-action="undo" aria-label="Undo previous move" title="Undo">↶</button><button class="game-help" data-action="rules" aria-label="Rules">ⓘ</button><button class="game-help" data-action="menu" aria-label="Open game menu">☰</button></div>
        </header>

        <main class="felt" data-motion="${motion}">
          <div class="table-grain"></div>
          <div class="opponent-area">
            <div class="opponent-tag" aria-label="Computer has ${opponent().score} points">Computer · ${opponent().score} pts</div>
            <div class="opponent-hand" aria-label="Computer has ${opponent().hand.length} hidden cards">${opponent().hand.map(() => renderBack()).join('')}</div>
          </div>
          <div class="table-area">
            <div class="table-stage"><div class="table-cards ${game.table.length ? '' : 'empty-table'}" aria-label="Loose table cards">${game.table.some(e => e.type === 'loose') ? game.table.filter(e => e.type === 'loose').map(entryMarkup).join('') : (game.table.length ? '' : '<span class="table-empty">Table cleared</span>')}</div>
            <div class="table-builds" aria-label="Builds on the table">${game.table.filter(e => e.type === 'build').map(entryMarkup).join('')}</div></div>
            <div class="turn-banner" aria-live="polite">${phaseText}</div>
          </div>
          ${active && pickedCard && visibleActionCount ? `<section class="controls contextual-controls" aria-label="Legal moves">
            <div class="main-actions">
              ${buildOptions.map((o,i) => `<button class="action-btn build-main" data-action="build" data-index="${i}">${escapeHtml(o.label)}</button>`).join('')}
              ${canTrail ? '<button class="action-btn" data-action="trail">Trail</button>' : ''}
              ${canCapture ? '<button class="action-btn primary" data-action="capture">Capture cards</button>' : ''}
            </div>
          </section>` : ''}
          <div class="human-area">
            <div class="player-caption sr-only"><b>Your hand</b></div>
            <div class="human-hand">${me().hand.map(card => `<button type="button" data-action="hand" data-id="${card.id}" class="hand-item ${pickedCard === card.id ? 'selected' : ''}" aria-pressed="${pickedCard === card.id}" aria-label="Play ${escapeHtml(E.cardName(card))}" ${active ? '' : 'disabled'}>${renderCard(card)}</button>`).join('')}</div>
            <div class="your-score-tag">You · ${me().score} pts</div>
          </div>
          <div class="table-footer" aria-live="off"><span class="last-move">${escapeHtml(game.lastAction)}</span></div>
          <div class="game-stats"><span>Cards Captured <b>${me().captured.length}</b></span><span>Spades Captured <b>${me().captured.filter(c=>c.suit==='S').length}</b></span><span>Cards in Deck <b>${game.stock.length}</b></span></div>
        </main>
        <footer class="footer"><span>Single-player · Saves on this device · v0.4.3</span></footer>
      </div>
      ${modal ? renderModal() : ''}`;
    restoreVariationsScroll();
    bindSettings();
    animateLayout(oldLayout);
    if (motion === 'deal') animateNewDeal();
    animateTurnMessage(previousTurn);
  }
  function settingChecked(name) { return draft[name] ? 'checked' : ''; }
  function checkRow(name, title, desc, disabled = false) {
    return `<label class="setting-row ${disabled ? 'disabled' : ''}"><span><b>${title}</b><small>${desc}</small></span><input type="checkbox" data-setting="${name}" ${settingChecked(name)} ${disabled ? 'disabled' : ''}></label>`;
  }
  const SETTING_INFO = {
    royal: ['Face Cards', 'With Royal face cards on, Jacks, Queens and Kings have numerical values 11, 12 and 13 and may participate in sums and builds. Otherwise they capture matching face cards only.'],
    royalAces: ['Aces', 'Royal Aces may count as either 1 or 14 in captures and builds. The game chooses a legal value for the move.'],
    royalBigLittle: ['2 and 10', 'Little Cassino (2♠) can count as 2 or 15; Big Cassino (10♦) can count as 10 or 16 in captures and builds.'],
    pirateCaptures: ['Captures', 'When enabled, you may capture loose cards and other builds while you still own a build. When off, you must first capture your own build.'],
    pirateBuilds: ['Builds', 'When enabled, you may start another independent build while you own one. Otherwise, resolve your current build first.'],
    allowTrailWithOwnBuild: ['Trails', 'Allows trailing a card onto the table while owning a build, as long as you retain a hand card able to capture that build.'],
    buildAnything: ['Build To Anything', 'When enabled, build to any legal card value without holding a matching capture card. This experimental rule can leave a build vulnerable.'],
    drawMode: ['Draw', 'After every turn, the player who played draws a replacement card until the stock is exhausted, rather than waiting for all players to run out of cards.'],
    sweepCancel: ['Sweep', 'When a capture clears the table, award a sweep. At hand scoring, each side scores only the number of sweeps beyond the opponent’s sweep count.'],
    spadeScoring: ['Spade Scoring', 'Every spade captured earns one point, plus a bonus point for the Jack of spades, replacing the ordinary most-spades award.'],
    builds: ['Building', 'Allow single builds; with this switched off, players can only capture or trail.'],
    multipleBuilds: ['Multiple Builds', 'Allow two or more equal-valued combinations to be combined into a multiple build.'],
  };
  function variationRow(key, title, disabled = false, extra = '') {
    const checked = key === 'sweepCancel' ? !!draft.sweepCancel : !!draft[key];
    return `<div class="variation-row ${disabled ? 'disabled' : ''}">
      <button class="var-info" data-action="info-setting" data-key="${key}" aria-label="Explain ${title}">ⓘ</button>
      <span>${title}${disabled ? '<small>Coming later</small>' : ''}</span>
      <label class="var-toggle"><input type="checkbox" data-setting="${key}" ${checked?'checked':''} ${disabled?'disabled':''} ${extra} aria-label="${title}"><i></i></label>
    </div>`;
  }
  function renderSettings() {
    if (!draft) draft = { ...game.rules };
    const menu = [['classic','Original (Classic)'],['royal','Royal'],['spade','Spade'],['royalSpade','Royal Spade'],['custom','Custom']];
    return `<div class="dialog-head"><div><span class="eyebrow">CASSINO LAB</span><h2>Game Variations</h2><p>Choose a traditional preset or customize the rules for your next match.</p></div><button data-action="close" class="icon-close" aria-label="Close">×</button></div>
      <div class="dialog-content variations-content">
        <h3>PRESET VARIATIONS</h3><div class="variation-card preset-options">${menu.map(([key,name])=>`<button class="preset-choice" data-action="preset-choice" data-value="${key}"><span>${name}</span><b>${draftPreset===key?'◉':'◯'}</b></button>`).join('')}</div>
        <h3>ROYAL OPTIONS</h3><div class="variation-card">
          ${variationRow('royal','Face Cards')}
          ${variationRow('royalAces','Aces')}
          ${variationRow('royalBigLittle','2 and 10')}
        </div>
        <h3>PIRATE OPTIONS</h3><div class="variation-card">
          ${variationRow('pirateCaptures','Captures')}
          ${variationRow('pirateBuilds','Builds')}
          ${variationRow('allowTrailWithOwnBuild','Trails',!draft.builds)}
          ${variationRow('buildAnything','Build To Anything',!draft.builds)}
        </div>
        <h3>OTHER OPTIONS</h3><div class="variation-card">
          ${variationRow('drawMode','Draw')}
          ${variationRow('sweepCancel','Sweep')}
        </div>
        <h3>CLASSIC SETTINGS</h3><div class="variation-card">
          ${variationRow('builds','Allow Building')}
          ${variationRow('multipleBuilds','Multiple Builds',!draft.builds)}
          ${variationRow('spadeScoring','Spade Scoring')}
        </div>
        <h3>MATCH SETTINGS</h3><label class="setting-select"><b>Winning score</b><select data-setting="winningScore">${[11,21,31,50,61].map(n=>`<option value="${n}" ${Number(draft.winningScore)===n?'selected':''}>${n} points</option>`).join('')}</select></label>
        <label class="setting-select"><b>Computer difficulty</b><select data-setting="difficulty"><option value="casual" ${draft.difficulty==='casual'?'selected':''}>Easy</option><option value="thoughtful" ${draft.difficulty==='thoughtful'?'selected':''}>Medium</option></select></label>
        <p class="setting-warning">Switching options begins a new match. Custom combinations are experimental; use the ⓘ icons to read how each option changes legal moves.</p>
      </div><div class="dialog-actions"><button data-action="close" class="action-btn">${settingsOrigin === 'newgame' ? 'Back' : 'Cancel'}</button><button data-action="apply-settings" class="action-btn primary">${settingsOrigin === 'newgame' ? 'Start Game' : 'Start with these rules'}</button></div>`;
  }
  function renderSettingInfo() {
    const item=SETTING_INFO[detailSetting] || ['Game rule','Not yet documented.'];
    return `<div class="dialog-head"><div><h2>${escapeHtml(item[0])}</h2><p class="gold-divider">◆</p></div></div>
      <div class="dialog-content"><p class="setting-explainer">${escapeHtml(item[1])}</p></div>
      <div class="dialog-actions"><button class="action-btn primary" data-action="info-back">OK</button></div>`;
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
    const heads = ['Most cards','Spades','10♦','2♠','Aces','Sweeps','This hand'];
    const keys = ['cards','spades','big','little','aces','sweeps','total'];
    return `<div class="dialog-head"><div><span class="eyebrow">HAND ${game.result.finishedRound} COMPLETE</span><h2>${ended ? (winner === 0 ? 'You win the match!' : 'Computer wins the match') : 'Hand results'}</h2><p>${ended ? 'Match complete. Play another?' : 'Scores are added. Continue to the next hand.'}</p></div><button data-action="close" class="icon-close">×</button></div>
      <div class="dialog-content"><div class="results-scores"><div><small>YOU</small><b>${scores[0]}</b><span>+${p[0].total} this hand</span></div><div class="result-vs">VS</div><div><small>COMPUTER</small><b>${scores[1]}</b><span>+${p[1].total} this hand</span></div></div>
      <table class="result-table"><thead><tr><th>Category</th><th>You</th><th>Computer</th></tr></thead><tbody>${heads.map((name,i) => `<tr class="${i === heads.length-1 ? 'totals-row' : ''}"><td>${name}</td><td>${p[0][keys[i]]}</td><td>${p[1][keys[i]]}</td></tr>`).join('')}</tbody></table>
      <p class="smallnote">Cards captured: ${p[0].cardCount}–${p[1].cardCount}. Spades captured: ${p[0].spadeCount}–${p[1].spadeCount}.</p></div>
      <div class="dialog-actions"><button data-action="undo" class="action-btn" ${!checkpoint ? 'disabled' : ''}>Undo last turn</button><button data-action="${ended ? 'new-match' : 'next-hand'}" class="action-btn primary">${ended ? 'New match' : 'Next hand'} →</button></div>`;
  }
  function renderModal() {
    const body = modal === 'info' ? renderSettingInfo() : modal === 'newgame' ? renderNewGame() : modal === 'menu' ? renderMenu() : modal === 'settings' ? renderSettings() : modal === 'rules' ? renderRules() : modal === 'history' ? renderHistory() : renderRound();
    return `<div class="overlay" role="presentation"><section class="dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(modal)}">${body}</section></div>`;
  }
  function bindSettings() { /* delegated event listeners live on #app */ }
  function resetSelection() { pickedCard = null; pickedTable.clear(); hint = null; buildMenuOpen = false; }
  function botTurn() {
    if (screen !== 'game' || busy || game.phase !== 'playing' || game.turn !== 1) return;
    busy = true;
    render();
    pendingBot = setTimeout(() => {
      pendingBot = null;
      if (screen !== 'game' || !busy || game.phase !== 'playing' || game.turn !== 1) { busy = false; render(); return; }
      try {
        const move = E.chooseComputerMove(game);
        const before = takeMotionSnapshot(move, true);
        const outcome = E.applyAction(game, move);
        if (!outcome.ok) throw new Error(outcome.reason);
        lastMotion = move.kind;
        moveAnnouncement = outcome.description;
        if (announcementTimer !== null) clearTimeout(announcementTimer);
        // Keep the message readable after the cards have settled.
        announcementTimer = setTimeout(() => { announcementTimer=null; moveAnnouncement=''; if(screen==='game'&&game.phase==='playing') render(); }, 4000);
        sound(game.phase !== 'playing' ? 'score' : move.kind);
        persist(); render();
        playMotion(before, () => {
          if (screen !== 'game') return;
          busy = false;
          if (game.phase !== 'playing') modal = 'round';
          persist(); render();
          if (game.turn === 1 && game.phase === 'playing') botTurn();
        });
      } catch (error) {
        busy = false;
        toast = `Computer move error: ${error.message}`;
        render();
      }
    }, 1200);
  }
  function play(action) {
    if (!isHumanTurn()) return;
    const check = E.validateAction(game, action);
    if (!check.ok) { toast = check.reason; render(); return; }
    const before = takeMotionSnapshot(action, false);
    checkpoint = JSON.stringify(game);
    const result = E.applyAction(game, action);
    if (!result.ok) { toast = result.reason; return render(); }
    lastMotion = action.kind;
    sound(game.phase !== 'playing' ? 'score' : (action.kind === 'capture' && result.description.includes('sweep') ? 'sweep' : action.kind));
    toast = result.description;
    resetSelection();
    moveAnnouncement = result.description;
    busy = !!before;
    persist(); render();
    playMotion(before, () => {
      busy = false;
      if (game.phase !== 'playing') modal = 'round';
      persist(); render();
      if (game.turn === 1 && game.phase === 'playing') botTurn();
    });
  }
  function undo() {
    cancelMotion();
    if (!checkpoint) return;
    if (pendingBot !== null) { clearTimeout(pendingBot); pendingBot = null; }
    busy = false;
    game = JSON.parse(checkpoint);
    checkpoint = null;
    modal = '';
    toast = 'Turn undone. Choose another move.';
    sound('undo');
    resetSelection(); persist(); render();
  }
  function nextHand() {
    cancelMotion();
    const next = E.nextHand(game);
    if (!next) return;
    game = next; checkpoint = null; resetSelection(); toast = ''; modal = ''; lastMotion = 'deal';
    sound('tap'); persist(); render(); if (game.turn === 1) botTurn();
  }
  function startNewMatch(rules = game.rules, ask = true) {
    if (ask && game.phase === 'playing' && !confirm('Start a new match? Your current match will be replaced.')) return;
    if (pendingBot !== null) { clearTimeout(pendingBot); pendingBot = null; }
    cancelMotion();
    busy = false; game = E.newMatch(rules); checkpoint = null; modal = ''; toast = ''; lastMotion = 'deal';
    screen = 'game'; resetSelection(); draft = null; persist(); render();
    if (game.turn === 1) botTurn();
  }
  function openSettings(origin = screen) { variationsScrollTop = 0; settingsOrigin = origin;
    draft = { ...(origin === 'newgame' ? customRules : game.rules) }; draft.difficulty = origin === 'newgame' ? setup.difficulty : draft.difficulty;
    draftPreset = origin === 'newgame' ? 'custom' : Object.keys(E.PRESETS).find(k => {
    const a = E.PRESETS[k];
    return ['royal','spadeScoring','sweepPoints','builds','multipleBuilds','allowTrailWithOwnBuild','winningScore'].every(key => a[key] === game.rules[key]) && !['drawMode','sweepCancel','royalAces','royalBigLittle','pirateCaptures','pirateBuilds','buildAnything'].some(key => game.rules[key]);
  }) || 'custom'; modal = 'settings'; render(); }
  function parseSetting(name, raw) {
    if (['sweepPoints', 'winningScore'].includes(name)) return Number(raw);
    return raw;
  }
  app.addEventListener('change', ev => {
    const target = ev.target;
    if (!(target instanceof HTMLElement) || !target.dataset.setting || !draft) return;
    const prop = target.dataset.setting;
    if (prop === 'preset') {
      draftPreset = target.value;
      if (draftPreset !== 'custom') draft = { ...E.rulesFor(draftPreset), difficulty: draft.difficulty };
    } else {
      draft[prop] = target.type === 'checkbox' ? target.checked : parseSetting(prop, target.value);
      if (prop === 'sweepCancel') draft.sweepPoints = target.checked ? 1 : 0;
      draftPreset = 'custom';
      draft.name = 'Custom Cassino';
    }
    render();
  });
  app.addEventListener('click', event => {
    const node = event.target.closest('[data-action]');
    if (!node) return;
    const action = node.dataset.action;
    if (action === 'home') {
      cancelMotion();
      if (pendingBot !== null) { clearTimeout(pendingBot); pendingBot=null; }
      busy=false; modal=''; screen='home'; persist(); resetSelection(); sound('tap'); render(); return;
    }
    if (action === 'resume-game') { screen='game'; modal=''; sound('tap'); render(); if(game.turn===1 && game.phase==='playing') botTurn(); else if(game.phase!=='playing'){modal='round';render();} return; }
    if (action === 'setup-new-game') { setup = {difficulty:game.rules.difficulty||'thoughtful',preset:'classic'}; modal='newgame'; sound('tap'); render(); return; }
    if (action === 'info-setting') { detailSetting=node.dataset.key; modal='info'; render(); return; }
    if (action === 'info-back') { modal='settings'; render(); return; }
    if (action === 'preset-choice') {
      draftPreset=node.dataset.value;
      if (draftPreset!=='custom') draft={...E.rulesFor(draftPreset),difficulty:draft.difficulty};
      render(); return;
    }
    if (action === 'setup-difficulty') { setup.difficulty=node.dataset.value; render(); return; }
    if (action === 'setup-preset') {
      setup.preset = node.dataset.value;
      if (setup.preset === 'custom') return openSettings('newgame');
      render(); return;
    }
    if (action === 'start-game') {
      if (setup.preset === 'custom') return openSettings('newgame');
      startNewMatch(E.rulesFor(setup.preset,{difficulty:setup.difficulty}),false);return;
    }
    if (action === 'menu') { modal = 'menu'; sound('tap'); render(); return; }
    if (action === 'settings') return openSettings(screen);
    if (action === 'rules' || action === 'history') { modal = action; render(); return; }
    if (action === 'toggle-sound') { prefs.sound = !prefs.sound; savePrefs(); if (prefs.sound) sound('tap'); render(); return; }
    if (action === 'toggle-animations') { prefs.animations = !prefs.animations; savePrefs(); render(); return; }
    if (action === 'build-menu') {
      if (!isHumanTurn() || !buildOptions.length) return;
      if (buildOptions.length === 1) return play(buildOptions[0]);
      buildMenuOpen = !buildMenuOpen; sound('tap'); render(); return;
    }
    if (action === 'hide-builds') { buildMenuOpen = false; render(); return; }
    if (action === 'close') { modal = modal === 'settings' && settingsOrigin === 'newgame' ? 'newgame' : ''; render(); return; }
    if (action === 'new-match') return startNewMatch(game.rules, true);
    if (action === 'next-hand') return nextHand();
    if (action === 'undo') return undo();
    if (action === 'apply-settings') {
      const nextRules = { ...draft };
      if (draftPreset !== 'custom') nextRules.name = E.PRESETS[draftPreset].name;
      else {nextRules.name='Custom Cassino';customRules = {...nextRules};saveCustomRules();}
      if (!nextRules.builds) { nextRules.multipleBuilds = false; nextRules.allowTrailWithOwnBuild = false; nextRules.buildAnything = false; nextRules.pirateBuilds = false; }
      if (settingsOrigin === 'newgame') nextRules.difficulty = setup.difficulty;
      if (screen === 'game' && game.phase === 'playing' && !confirm('Start a new match with these rules?')) return;
      return startNewMatch(nextRules, false);
    }
    if (action === 'hand') {
      if (!isHumanTurn()) return;
      const id = node.dataset.id;
      if (pickedCard === id) { pickedCard = null; hint = null; buildMenuOpen = false; toast = ''; }
      else { pickedCard = id; hint = null; buildMenuOpen = false; toast = ''; }
      sound('tap'); return render();
    }
    if (action === 'table') {
      if (!isHumanTurn()) return;
      const id = node.dataset.id;
      if (pickedTable.has(id)) pickedTable.delete(id); else pickedTable.add(id);
      toast = ''; hint = null; buildMenuOpen = false; sound('tap'); return render();
    }
    if (action === 'clear') { resetSelection(); toast = ''; return render(); }
    if (action === 'trail' || action === 'capture') return play({ kind: action, cardId: pickedCard, targetIds: action === 'trail' ? [] : currentSelection() });
    if (action === 'build') return play(buildOptions[Number(node.dataset.index)]);
    if (action === 'hint') {
      if (!isHumanTurn()) return;
      const move = E.chooseComputerMove(game);
      pickedCard = move.cardId; pickedTable = new Set(move.targetIds || []);
      hint = move;
      toast = `Suggestion: ${E.explainMove(game, move)}`;
      return render();
    }
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && modal) { modal = ''; render(); }
    else if (ev.key.toLowerCase() === 'u' && !modal && checkpoint) undo();
  });
  render(); // The main menu is the entry point; the computer does not move until Resume/Start.
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
    // A new deployment becomes available on the same URL. Let the player
    // choose when to reload so an ongoing turn is not interrupted.
    const hadController = !!navigator.serviceWorker.controller;
    if (hadController) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (document.getElementById('update-notice')) return;
        const bar = document.createElement('div');
        bar.id = 'update-notice';
        bar.className = 'update-notice';
        bar.innerHTML = '<span>A new Cassino Lab version is ready.</span><button type="button">Update now</button>';
        bar.querySelector('button').addEventListener('click', () => {
          persist();
          location.reload();
        });
        document.body.appendChild(bar);
      });
    }
    navigator.serviceWorker.register('./service-worker.js')
      .then(registration => {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') registration.update().catch(() => {});
        });
      }).catch(() => {});
  }
})();
