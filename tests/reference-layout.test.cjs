const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root=path.join(__dirname,'..');
const css=fs.readFileSync(path.join(root,'src/compact.css'),'utf8');
const app=fs.readFileSync(path.join(root,'src/app.js'),'utf8');

test('Reference stage keeps stock, loose cards and builds in separate lanes',()=>{
  assert.match(css,/--stock-lane:clamp\(39px,12vw,53px\)/);
  assert.match(css,/--build-lane:clamp\(74px,20\.5vw,98px\)/);
  assert.match(css,/\.table-stage:has\(\.table-builds:not\(:empty\)\) \.table-cards/);
  assert.match(css,/position:absolute!important;\s*left:var\(--stock-lane\)!important/);
  assert.match(css,/\.table-stage \.table-builds:not\(:empty\) \{/);
  assert.match(css,/right:2px!important/);
});

test('Four loose cards have predictable row slots even with a build',()=>{
  assert.match(css,/flex:0 0 calc\(\(100% - 3\*clamp\(4px,1\.4vw,8px\) - 8px\)\/4\)/);
  assert.match(css,/max-width:68px/);
  assert.match(css,/justify-content:flex-start/);
});

test('Reference-style build animation shows real card layers and final owner/value panel',()=>{
  assert.match(app,/const layers=cards\.map\(\(card,i\)=>/);
  assert.match(app,/class="build-value-owner"/);
  assert.match(app,/class="build-value-number"/);
  assert.match(app,/await Promise\.all\(buildGhosts\.map/);
  assert.match(app,/const label=destination\.querySelector\('\.build-value'\)/);
});

test('Legal moves remain contextual; capture cards gather before moving as a stack',()=>{
  assert.match(app,/active && pickedCard && visibleActionCount/);
  assert.match(app,/captureTrack\(entry,frontPositions\[i\]/);
  assert.match(app,/const stack=ghosts\.map/);
  assert.match(app,/await flipComputerCard\(\)/);
  assert.match(app,/if\(capture\)/);
});

test('Unified setup and exit confirmation are preserved',()=>{
  assert.match(app,/return openSettings\('newgame'\)/);
  assert.doesNotMatch(app,/overlay\.classList\.add\('modal-stack'\)/);
  assert.match(app,/function showExitConfirm\(\)/);
  assert.match(app,/function cancelExit\(\)/);
  assert.match(app,/function exitGameToMenu\(\)/);
});

test('In-game settings is simplified and Exit to menu is the final footer action',()=>{
 const source=app.slice(app.indexOf('  function renderCpuPlaytestOptions()'),app.indexOf('  function renderRules()'));
 const render=new Function('prefs',source+'return renderMenu;')({sound:true,undo:true});
 const html=render();
 assert.match(html,/<h2>Settings<\/h2>/);
 assert.doesNotMatch(html,/Single-player|Hand 1|Classic Casino|data-action="(?:rules|settings|toggle-animations)"/i);
 assert.match(html,/data-action="new-match"[^>]*>[\s\S]*?Restart game/);
 assert.match(html,/<div class="dialog-actions"><button data-action="home" class="action-btn primary">Exit to menu<\/button><\/div>$/);
 assert.doesNotMatch(app,/data-action="rules" class="launch-tile"/);
 assert.match(app,/action === 'toggle-animations' && screen === 'home'/);
 assert.match(app,/action === 'settings' && screen === 'home'/);
});
test('Exit confirmation supports restart, keep playing and save-and-exit',()=>{
 const source=app.slice(app.indexOf('  function renderExitConfirm()'),app.indexOf('  function renderDialogBody()'));
 const html=new Function(source+'return renderExitConfirm;')()();
 assert.match(html,/data-action="new-match"[^>]*>Restart game<\/button>/);
 assert.match(html,/data-action="cancel-exit"[^>]*>Keep playing<\/button>/);
 assert.match(html,/data-action="confirm-exit"[^>]*>Exit to menu<\/button>/);
 assert.match(app,/if \(action === 'new-match'\) return startNewMatch\(game.rules, true\)/);
 assert.match(app,/confirm\('Start a new match\? Your current match will be replaced\.'\)/);
});
