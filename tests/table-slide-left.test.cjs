const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'src/app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'src/compact.css'),'utf8');

test('Loose row remains left anchored when a build is made or removed',()=>{
  const rules=css.slice(css.indexOf('/* v0.5.10'));
  assert.match(rules,/\.table-stage:not\(:has\(\.table-builds:not\(:empty\)\)\) \.table-cards/);
  assert.match(rules,/justify-content:flex-start!important/);
  assert.match(rules,/flex-wrap:wrap!important/);
});

test('Each survivor slides to its newly vacated slot using its stable table id',()=>{
  assert.match(app,/node\.dataset\.action\+':'\+node\.dataset\.id/);
  assert.match(app,/const from=previous\.get\(key\)/);
  assert.match(app,/const isTableCard = node\.dataset\.action === 'table'/);
  assert.match(app,/duration:isTableCard \? 355 : 420/);
  assert.match(app,/translate:\`\$\{dx\}px \$\{dy\}px\`/);
});

test('A new build remains on the right and does not force the table to recenter',()=>{
  assert.match(css,/\.table-stage \.table-builds:not\(:empty\)/);
  assert.match(css,/right:2px!important/);
  const lastRule=css.slice(css.indexOf('/* v0.5.10'));
  assert.doesNotMatch(lastRule,/justify-content:center/);
});
