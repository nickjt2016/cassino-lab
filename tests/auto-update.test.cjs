const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const current = require('../package.json').version;
const next = current.replace(/\d+$/, value => String(Number(value) + 1));
const start = appSource.indexOf("  const APP_VERSION = '" + current + "';");
const end = appSource.indexOf("  let hasSavedMatch = false;", start);
assert.ok(start >= 0 && end > start, 'automatic update logic should be present');
const updateCode = appSource.slice(start, end);

function makeHarness({latest = next, offline = false} = {}) {
  let reloads = 0;
  const stored = new Map();
  const services = {
    location: {protocol:'https:', reload() {reloads++;}},
    sessionStorage: {
      getItem(key) { return stored.get(key) || null; },
      setItem(key, value) { stored.set(key, value); }
    },
    fetch: async () => {
      if (offline) throw Error('Offline');
      return {ok:true, json:async () => ({version:latest})};
    }
  };
  const context = vm.createContext({services});
  vm.runInContext(`
    let screen='home',modal='',busy=false,dealing=false;
    const {location,sessionStorage,fetch}=services;
    ${updateCode}
    globalThis.updateTestApi = {
      check:checkForAppUpdate,
      apply:applyPendingUpdate,
      setState:(nextScreen,nextModal='',nextBusy=false,nextDealing=false)=>{
        screen=nextScreen;modal=nextModal;busy=nextBusy;dealing=nextDealing;
      }
    };
  `, context);
  return {api:context.updateTestApi, count:()=>reloads};
}

test('new release auto-loads from the main menu without confirmation', async () => {
  const h = makeHarness();
  await h.api.check();
  assert.equal(h.count(), 1);
  h.api.apply();
  assert.equal(h.count(), 1, 'must not reload in a loop');
});

test('active game is never interrupted; update installs at the menu', async () => {
  const h = makeHarness();
  h.api.setState('game');
  await h.api.check();
  assert.equal(h.count(), 0);
  h.api.setState('home');
  h.api.apply();
  assert.equal(h.count(), 1);
});

test('open New Game dialog defers a release until the menu is clear', async () => {
  const h = makeHarness();
  h.api.setState('home','newgame');
  await h.api.check();
  assert.equal(h.count(), 0);
  h.api.setState('home');
  h.api.apply();
  assert.equal(h.count(), 1);
});

test('up-to-date installs do not reload', async () => {
  const h = makeHarness({latest:current});
  await h.api.check();
  assert.equal(h.count(), 0);
});

test('offline launch continues without forcing a reload', async () => {
  const h = makeHarness({offline:true});
  await h.api.check();
  assert.equal(h.count(), 0);
});

test('startup and foreground both trigger a check, with no update prompt', () => {
  assert.match(appSource, /window.addEventListener\('online', checkForAppUpdate\)/);
  assert.match(appSource, /navigator.serviceWorker.addEventListener\('controllerchange', checkForAppUpdate\)/);
  assert.match(appSource, /document.visibilityState === 'visible'/);
  assert.doesNotMatch(appSource, /update-notice/);
});
