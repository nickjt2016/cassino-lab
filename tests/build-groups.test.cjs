const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../src/engine.js');
const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../src/compact.css'),'utf8');
const card=id=>({id,suit:id[0],rank:Number(id.slice(1))});
test('Divider marks the first card of each subsequent group, not every card',()=>{
  const start=app.indexOf('  function renderCard('),end=app.indexOf('  function isHumanTurn(',start);
  const render=new Function('E',`
    const pickedTable=new Set(), escapeHtml=String, suitClass=()=>'', prettyRank=c=>c.rank,prettySuit=c=>c.suit;
    ${app.slice(start,end)}
    return entryMarkup;
  `)(E);
  const groups=[[card('C4'),card('D4'),card('H2')],[card('S10')],[card('H5'),card('D5')]];
  const element={type:'build',id:'b1',owner:0,value:10,groups};
  const starts=[...render(element).matchAll(/class="build-layer build-group-start" style="--layer:(\d+)"/g)].map(m=>Number(m[1]));
  assert.deepEqual(starts,[3,4]);
  assert.doesNotMatch(render({...element,groups:[groups[0]]}),/build-group-start/);
  assert.match(css,/\.build-layer\.build-group-start::after,\s*\.card-flight\.build-group-start::after/);
  const rule=css.match(/\.card-flight\.build-group-start::after\s*\{([^}]+)\}/)[1];
  assert.match(rule,/top:0;left:4px;right:4px;height:1px/);
  assert.match(rule,/linear-gradient\(to right,\s*transparent 0px,#605a51 5px,#605a51 calc\(100% - 5px\),transparent 100%\)/);
  assert.doesNotMatch(rule,/border:|border-radius:|mask|linear-gradient\(to bottom/);
  assert.match(css,/\.playing-card:not\(\.mini\)\s*\{[^}]*border-radius:2px;[^}]*border:1px solid #c8c8c8/);
  assert.match(css,/\.playing-card\.card-selected\s*\{[^}]*border-color:#d6a526/);
});
test('Toolbar puts score in freed center space between the two control clusters',()=>{
  const start=app.indexOf('  function renderToolbar('),end=app.indexOf('  function renderHome(',start);
  const render=new Function('prefs','checkpoint',app.slice(start,end)+';return renderToolbar;')({undo:true},'saved');
  const html=render(true,12);
  const left=html.slice(html.indexOf('class="toolbar-left"'),html.indexOf('class="opponent-tag"'));
  const right=html.slice(html.indexOf('class="header-actions"'));
  assert.match(left,/data-action="home"[\s\S]*data-action="menu"/);
  assert.match(right,/data-action="hint"[\s\S]*data-action="undo"/);
  assert.match(html,/Computer · 12 pts/);
  assert.equal((app.match(/class="opponent-tag"/g)||[]).length,1);
});
test('New and extended builds fade the new panel only after the cards land',()=>{
  const start=app.indexOf("} else if(snapshot.kind === 'build' && !snapshot.finalHand)");
  const build=app.slice(start,app.indexOf('          // Computer trails:',start));
  const land=build.indexOf('await Promise.all(buildGhosts.map');
  const hide=build.indexOf("if(label)label.style.opacity='0'");
  const reveal=build.indexOf("destination.style.visibility='visible'");
  const fade=build.indexOf('animate(label,[{opacity:0},{opacity:1}]');
  const wait=build.indexOf('await Promise.all(panelFades)');
  assert.ok(land>=0&&hide>land&&reveal>hide&&fade>reveal&&wait>fade);
  assert.doesNotMatch(build,/translateY\(8px\)/);
  assert.match(app,/anchor\.ghost\.insertAdjacentHTML\('beforeend',existingBuild\.label\.html\)/);
  assert.match(build,/const delay=existingIds\.has\(piece\.id\)\?0/);
  assert.match(build,/oldLayer\.appendChild\(retainedPanel\)/);
  assert.ok(build.indexOf('animate(retainedPanel,[{opacity:1},{opacity:0}]')>reveal);
});
