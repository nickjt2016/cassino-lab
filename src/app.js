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

  const PREF_STORE = 'cassino-lab-prefs-v1';
  let prefs = { sound: true, animations: true };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREF_STORE) || '{}') }; } catch (_) {}
  let audioContext = null;
  const app = document.getElementById('app');
  function savePrefs() {
    try { localStorage.setItem(PREF_STORE, JSON.stringify(prefs)); } catch (_) {}
  }
  function sound(type = 'tap') {
    if (!prefs.sound) return;
    try {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) return;
      if (!audioContext) audioContext = new Audio();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      const now = audioContext.currentTime;
      const patterns = {
        tap: [[550, .018, .045]],
        trail: [[400, .035, .08], [510, .115, .07]],
        build: [[420, .025, .09], [620, .135, .14]],
        capture: [[720, .025, .075], [510, .095, .11]],
        sweep: [[530, .02, .10], [690, .11, .10], [930, .22, .2]],
        score: [[525, .025, .13], [785, .18, .2]],
        undo: [[490, .02, .10], [360, .14, .12]]
      };
      (patterns[type] || patterns.tap).forEach(([hz, offset, duration]) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = type === 'capture' ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(hz, now + offset);
        gain.gain.setValueAtTime(.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(.065, now + offset + .012);
        gain.gain.exponentialRampToValueAtTime(.0001, now + offset + duration);
        osc.connect(gain); gain.connect(audioContext.destination);
        osc.start(now + offset); osc.stop(now + offset + duration + .015);
      });
    } catch (_) { /* Audio is optional on restricted browsers. */ }
  }
  // Fly the actual played card and affected table groups toward their destinations.
  // Animations are decorative; the rules engine remains authoritative.
  function animateMove(kind, byComputer = false, move = null) {
    if (!prefs.animations || !document.body ||
      (globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    const from = byComputer
      ? app.querySelector('.opponent-hand .card-back:last-child')
      : app.querySelector('.hand-item.selected .playing-card');
    const destination = kind === 'capture'
      ? app.querySelector(byComputer ? '.opponent-tag' : '.your-score-tag')
      : (kind === 'build' ? app.querySelector('.table-builds') : app.querySelector('.table-cards'));
    const intermediate = app.querySelector('.table-stage') || app.querySelector('.table-area');
    if (!from || !destination || !intermediate || !from.getBoundingClientRect) return;
    const played = move && game.players[byComputer ? 1 : 0].hand.find(c => c.id === move.cardId);
    const duration = byComputer ? 820 : 610;
    const center = rect => ({x:rect.left + rect.width/2, y:rect.top + rect.height/2});
    const goal = center(destination.getBoundingClientRect());
    const mid = center(intermediate.getBoundingClientRect());
    function fly(source, destinationPoint, face = null, via = null, stagger = 0) {
      if (!source || !source.getBoundingClientRect) return;
      const start = source.getBoundingClientRect();
      if (!start.width || !start.height) return;
      const ghost = face ? document.createElement('div') : source.cloneNode(true);
      if (face) ghost.innerHTML = renderCard(face);
      ghost.className += ' move-ghost';
      Object.assign(ghost.style, {
        position:'fixed',pointerEvents:'none',zIndex:'65',
        left:start.left+'px',top:start.top+'px',width:start.width+'px',height:start.height+'px',margin:'0',
        transformOrigin:'center',willChange:'transform, opacity'
      });
      const inner=ghost.querySelector('.playing-card');
      if(inner) Object.assign(inner.style,{width:'100%',height:'100%',margin:'0'});
      document.body.appendChild(ghost);
      const fromCenter=center(start);
      const to=(point,rot=0,scale=1)=>`translate(${point.x-fromCenter.x}px,${point.y-fromCenter.y}px) rotate(${rot}deg) scale(${scale})`;
      const frames=via ? [
        {transform:to(fromCenter),opacity:1,offset:0},
        {transform:to({x:(fromCenter.x+via.x)/2,y:(fromCenter.y+via.y)/2-18},-6,1.02),opacity:1,offset:.28},
        {transform:to(via,3,1),opacity:1,offset:.55},
        {transform:to(destinationPoint,5,.52),opacity:.1,offset:1}
      ] : [
        {transform:to(fromCenter),opacity:1},
        {transform:to({x:(fromCenter.x+destinationPoint.x)/2,y:(fromCenter.y+destinationPoint.y)/2-18},-4,1.05),opacity:1,offset:.53},
        {transform:to(destinationPoint,5,.66),opacity:.1}
      ];
      if (ghost.animate) {
        const anim=ghost.animate(frames,{duration,delay:stagger,easing:'cubic-bezier(.25,.75,.25,1)'});
        anim.onfinish=()=>ghost.remove(); anim.oncancel=()=>ghost.remove();
      } else ghost.remove();
    }
    fly(from,goal,byComputer?played:null,kind==='capture'?mid:null);
    if(move && (kind==='capture' || kind==='build')) {
      const tableDestination=kind==='capture'?goal:mid;
      for(const [index,id] of (move.targetIds||[]).entries()) {
        const tableNode=Array.from(app.querySelectorAll('[data-action="table"]')).find(x=>x.dataset.id===id);
        if(tableNode) fly(tableNode,tableDestination,null,null,index*65);
      }
    }
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
  function renderBack() { return '<span class="card-back" aria-hidden="true"><span class="back-pattern">✦</span></span>'; }
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
          <div class="launch-fan" aria-hidden="true">
            <span class="fan-card fan-left">${renderCard({rank:2,suit:'S'})}</span>
            <span class="fan-card fan-middle">${renderCard({rank:10,suit:'D'})}</span>
            <span class="fan-card fan-right">${renderCard({rank:1,suit:'C'})}</span>
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
        <p class="launch-foot">Single-player prototype · v0.4.0 · Offline-ready</p>
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
        <p class="newgame-note">Original uses traditional Cassino rules. Royal gives numerical values to face cards. Custom uses your current rule settings.</p>
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
      : 'Choose a card from your hand, then choose table cards.';
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
        <footer class="footer"><span>Single-player · Saves on this device · v0.4.0</span></footer>
      </div>
      ${modal ? renderModal() : ''}`;
    restoreVariationsScroll();
    bindSettings();
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
      </div><div class="dialog-actions"><button data-action="close" class="action-btn">Cancel</button><button data-action="apply-settings" class="action-btn primary">Start with these rules</button></div>`;
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
        animateMove(move.kind, true, move);
        const outcome = E.applyAction(game, move);
        if (!outcome.ok) throw new Error(outcome.reason);
        lastMotion = move.kind;
        moveAnnouncement = outcome.description;
        if (announcementTimer !== null) clearTimeout(announcementTimer);
        announcementTimer = setTimeout(() => { announcementTimer = null; moveAnnouncement = ''; if(screen === 'game' && game.phase === 'playing') render(); }, 2400);
        sound(game.phase !== 'playing' ? 'score' : move.kind);
      } catch (error) {
        toast = `Computer move error: ${error.message}`;
      }
      busy = false;
      if (game.phase !== 'playing') modal = 'round';
      persist(); render();
      if (game.turn === 1 && game.phase === 'playing') botTurn();
    }, 1500);
  }
  function play(action) {
    if (!isHumanTurn()) return;
    const check = E.validateAction(game, action);
    if (!check.ok) { toast = check.reason; render(); return; }
    checkpoint = JSON.stringify(game);
    animateMove(action.kind, false, action);
    const result = E.applyAction(game, action);
    if (!result.ok) { toast = result.reason; return render(); }
    lastMotion = action.kind;
    sound(game.phase !== 'playing' ? 'score' : (action.kind === 'capture' && result.description.includes('sweep') ? 'sweep' : action.kind));
    toast = result.description;
    resetSelection();
    moveAnnouncement = '';
    if (game.phase !== 'playing') modal = 'round';
    persist(); render();
    if (game.turn === 1 && game.phase === 'playing') botTurn();
  }
  function undo() {
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
    const next = E.nextHand(game);
    if (!next) return;
    game = next; checkpoint = null; resetSelection(); toast = ''; modal = ''; lastMotion = 'deal';
    sound('tap'); persist(); render(); if (game.turn === 1) botTurn();
  }
  function startNewMatch(rules = game.rules, ask = true) {
    if (ask && game.phase === 'playing' && !confirm('Start a new match? Your current match will be replaced.')) return;
    if (pendingBot !== null) { clearTimeout(pendingBot); pendingBot = null; }
    busy = false; game = E.newMatch(rules); checkpoint = null; modal = ''; toast = ''; lastMotion = 'deal';
    screen = 'game'; resetSelection(); draft = null; persist(); render();
    if (game.turn === 1) botTurn();
  }
  function openSettings() { variationsScrollTop = 0; draft = { ...game.rules }; draftPreset = Object.keys(E.PRESETS).find(k => {
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
    if (action === 'setup-preset') { setup.preset=node.dataset.value; render(); return; }
    if (action === 'start-game') {
      const rules = setup.preset==='custom' ? { ...game.rules,difficulty:setup.difficulty } : E.rulesFor(setup.preset,{difficulty:setup.difficulty});
      startNewMatch(rules,false);return;
    }
    if (action === 'menu') { modal = 'menu'; sound('tap'); render(); return; }
    if (action === 'settings') return openSettings();
    if (action === 'rules' || action === 'history') { modal = action; render(); return; }
    if (action === 'toggle-sound') { prefs.sound = !prefs.sound; savePrefs(); if (prefs.sound) sound('tap'); render(); return; }
    if (action === 'toggle-animations') { prefs.animations = !prefs.animations; savePrefs(); render(); return; }
    if (action === 'build-menu') {
      if (!isHumanTurn() || !buildOptions.length) return;
      if (buildOptions.length === 1) return play(buildOptions[0]);
      buildMenuOpen = !buildMenuOpen; sound('tap'); render(); return;
    }
    if (action === 'hide-builds') { buildMenuOpen = false; render(); return; }
    if (action === 'close') { modal = ''; render(); return; }
    if (action === 'new-match') return startNewMatch(game.rules, true);
    if (action === 'next-hand') return nextHand();
    if (action === 'undo') return undo();
    if (action === 'apply-settings') {
      const nextRules = { ...draft };
      if (draftPreset !== 'custom') nextRules.name = E.PRESETS[draftPreset].name;
      if (!nextRules.builds) { nextRules.multipleBuilds = false; nextRules.allowTrailWithOwnBuild = false; nextRules.buildAnything = false; nextRules.pirateBuilds = false; }
      if (screen === 'game' && game.phase === 'playing' && !confirm('Start a new match with these rules?')) return;
      return startNewMatch(nextRules, false);
    }
    if (action === 'hand') {
      if (!isHumanTurn()) return;
      const id = node.dataset.id;
      if (pickedCard === id) { resetSelection(); toast = ''; } else { pickedCard = id; pickedTable.clear(); hint = null; buildMenuOpen = false; toast = ''; }
      sound('tap'); return render();
    }
    if (action === 'table') {
      if (!isHumanTurn() || !pickedCard) { toast = 'Choose a card from your hand first.'; render(); return; }
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
