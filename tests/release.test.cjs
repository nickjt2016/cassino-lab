const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
test('Published HTML contains exactly the tested engine, UI and styles', () => {
  const html = read('index.html');
  const styles = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.equal(styles, read('src/styles.css') + '\n' + read('src/compact.css') + '\n');
  assert.deepEqual(scripts, [read('src/engine.js') + '\n', read('src/app.js') + '\n']);
});
test('Release versions match', () => {
  const version = require('../package.json').version;
  assert.equal(JSON.parse(read('version.json')).version, version);
  assert.ok(read('src/app.js').includes("const APP_VERSION = '" + version + "';"));
  assert.ok(read('service-worker.js').includes('v' + version + '-'));
});
test('Both players use a single turn-completion path', () => {
  const app = read('src/app.js');
  assert.equal((app.match(/playMotion\(before, \(\) => completeTurn\(cardsDealt\)\)/g)||[]).length, 2);
  assert.doesNotMatch(app, /buildMenuOpen|moveAnnouncement|announcementTimer|bindSettings/);
  assert.match(app, /role="alert"/);
});
