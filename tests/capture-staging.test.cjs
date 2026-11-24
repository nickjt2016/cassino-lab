const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/compact.css'), 'utf8');

test('turn banner only uses the two requested phrases', () => {
  assert.match(app, /const phaseText = game\.turn === 0 \? 'Your turn' : "Opponent's turn";/);
  assert.doesNotMatch(app, /message\.textContent=\`Remaining cards collected/);
  assert.doesNotMatch(app, /phaseText = [^\n]*Computer thinking/);
});

test('capture landing is player-front and mirrored CPU-front, not the score badge', () => {
  assert.match(app, /const captureFront = capture && feltRectForCapture/);
  assert.match(app, /feltRectForCapture\.height\*\(snapshot\.byComputer \? 0\.24 : 0\.72\)/);
  assert.match(app, /const frontPositions=stack\.map/);
  const gather = app.indexOf('const collected=ghosts.slice(1)');
  const land = app.indexOf('move(entry,frontPositions[i],390', gather);
  const finish = app.indexOf('move(entry,end,280',land);
  assert.ok(gather >= 0 && land > gather && finish > land);
});

test('capturing card is topmost; every build card is collected individually', () => {
  assert.match(app, /snapshot\.groups\.flatMap\(group =>/);
  assert.match(app, /group\.cards && group\.cards\.length \? group\.cards : \[group\]/);
  assert.match(app, /i===0 \? 1000 : 105\+i/);
  assert.match(app, /const collected=ghosts\.slice\(1\)/);
  assert.match(app, /await Promise\.all\(collected\.map/);
});

test('whole stack remains card-sized until it is moved in front of the player', () => {
  assert.match(app, /scale:tableWidth\/Math\.max\(entry\.rect\.width,1\)/);
  assert.match(app, /setTimeout\(resolve,125\)/);
  assert.match(app, /scale:\.32,fade:true/);
});

test('build pile shoulder rank and suit share the same baseline', () => {
  const section = css.slice(css.indexOf('/* v0.5.11'));
  assert.match(section, /align-items:baseline/);
  assert.match(section, /flex:0 0 1\.35em/);
  assert.match(section, /font-variant-numeric:tabular-nums/);
  assert.match(section, /card-corner small/);
});
