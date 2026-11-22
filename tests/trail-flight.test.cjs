const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');

test('opponent trail ends at the exact face-up table card dimensions', () => {
  assert.match(app, /await flipComputerCard\(\)/);
  assert.match(app, /const landingCard=destination\.querySelector\('\.playing-card'\)/);
  assert.match(app, /const probe=document\.createElement\('span'\)/);
  assert.match(app, /const landingCenter=destination\.matches/);
  assert.match(app, /scale:landingRect\.width\/Math\.max\(1,g\.rect\.width\)/);
  assert.match(app, /scaleY:landingRect\.height\/Math\.max\(1,g\.rect\.height\)/);
  assert.match(app, /const finish=`translate\(\$\{dx\}px,\$\{dy\}px\) scale\(\$\{scale\}, \$\{scaleY\}\)`/);
});
