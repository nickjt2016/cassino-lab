const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/compact.css'), 'utf8');

test('Royal build panels always show the numerical target', () => {
  const first = app.indexOf('  function buildPanelValue(');
  const last = app.indexOf('  function entryMarkup(', first);
  assert.ok(first >= 0 && last > first);
  const make = new Function(app.slice(first, last) + '; return buildPanelValue;');
  const label = make();
  for (const value of [1, 9, 10, 11, 12, 13, 14, 15, 16])
    assert.equal(label(value), String(value));
  assert.equal(label(9,-9),'-9','signed builds retain their actual announced target');
});

test('The build panel stops below the top rank and suit, covering the bottom 77%', () => {
  assert.match(css, /height:77%!important;/);
  assert.match(css, /min-height:77%!important;/);
  assert.match(css, /\.build-pile \.build-layer:last-child \.playing-card \.card-corner/);
  assert.match(css, /z-index:11/);
  assert.match(app, /class="build-value-owner"/);
  assert.match(app, /class="build-value-number"/);
});

test('The visual stock is only in the Cards in Deck HUD, not on the table', () => {
  assert.equal((app.match(/class="draw-stock /g)||[]).length, 1);
  const stock = app.indexOf('class="draw-stock ');
  const stats = app.lastIndexOf('class="game-stats"', stock);
  const tableStage = app.lastIndexOf('class="table-stage"', stock);
  assert.ok(stats > tableStage && stats < stock);
  assert.match(app, /class="deck-stat"/);
  assert.match(app, /class="draw-stock-count"/);
});

test('Physical deal animation measures the moved stock location', () => {
  assert.match(app, /function rememberStockOrigin\(\)/);
  assert.ok(app.includes("querySelector('.draw-stock .stock-back')"));
  assert.ok(app.includes("const deck=app.querySelector?.('.draw-stock .stock-back')"));
  assert.match(app, /pendingStockOrigin \|\| \(deckRect/);
  assert.match(app, /ghost\.innerHTML=renderBack\(\)/);
});

test('Table lane no longer reserves room for a left stock pile', () => {
  assert.match(css, /--stock-lane:0px!important/);
  assert.match(css, /left:0!important/);
  assert.match(css, /width:calc\(100% - var\(--build-lane\)\)!important/);
});
