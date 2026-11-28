const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');

function rect(left, top, width, height) {
  return {left, top, width, height, right:left+width, bottom:top+height};
}

function classList(...initial) {
  const values = new Set(initial);
  return {
    contains:value=>values.has(value),
    add:(...names)=>names.forEach(name=>values.add(name)),
    remove:(...names)=>names.forEach(name=>values.delete(name)),
    toggle(name, force) {
      const selected = force ?? !values.has(name);
      if (selected) values.add(name); else values.delete(name);
      return selected;
    }
  };
}

function style() {
  return {setProperty(name,value){this[name]=String(value);},
    getPropertyValue(name){return this[name]||'';},
    removeProperty(name){delete this[name];}};
}

function makeNode({action, id, box, seat, index=0, hidden=false}) {
  const node = {
    dataset:action ? {action,id} : {},
    classList:classList(action==='table'?'table-item':action==='hand'?'hand-item':'card-back'),
    style:style(), isConnected:true, calls:[],
    getBoundingClientRect:()=>({...box}),
    setBox(next){box=next;},
    getAnimations:()=>[],
    querySelector:()=>null,
    querySelectorAll:()=>[],
    closest:selector=>selector.includes('data-cpu-seat') ? seat : null,
    animate(frames,options) {
      const animation = {cancelled:false,cancel(){this.cancelled=true;}, finished:Promise.resolve()};
      this.calls.push({frames,options,animation});
      return animation;
    }
  };
  if (action) {
    const face = {dataset:{cardId:id},style:{visibility:hidden?'hidden':''},
      getBoundingClientRect:()=>({...box}),querySelector:()=>null,querySelectorAll:()=>[],parentElement:node};
    node.querySelector = selector=>selector.includes('.playing-card')?face:null;
  }
  if (seat) {
    node.parentElement=seat.hand;
    node.dataset.auditIndex=String(index);
  }
  return node;
}

function makeSeat(seatNumber, boxes) {
  const seat={dataset:{cpuSeat:String(seatNumber)},classList:classList('multi-cpu-seat')};
  seat.hand={dataset:{},classList:classList('opponent-hand','multi-seat-hand'),parentElement:seat,
    closest:()=>seat,querySelectorAll:()=>seat.backs};
  seat.backs=boxes.map((box,index)=>makeNode({box,seat,index}));
  seat.querySelectorAll=()=>seat.backs;
  seat.querySelector=selector=>selector.includes('opponent-hand')?seat.hand:null;
  return seat;
}

function harness(playerCount=2, options={}) {
  let cards=[], seats=[];
  const allBacks=()=>seats.flatMap(seat=>seat.backs);
  const app={
    querySelectorAll(selector) {
      if(selector.includes('data-action'))return cards;
      const exactSeat=selector.match(/data-cpu-seat=["']?(\d+)/);
      if(exactSeat)return seats.find(seat=>seat.dataset.cpuSeat===exactSeat[1])?.backs||[];
      if(selector.includes('.card-back'))return allBacks();
      if(selector.includes('data-cpu-seat'))return seats;
      if(selector.includes('.opponent-hand'))return seats.map(seat=>seat.hand);
      return [];
    },
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  };
  const start=source.indexOf('  function layoutPositions(');
  const end=source.indexOf('  // Dealt cards',start);
  assert.ok(start>=0&&end>start,'extract the actual layout snapshot and playback functions');
  const functions=new Function('app','game','motionAllowed','getComputedStyle','document',
    source.slice(start,end)+';return {layoutPositions,animateLayout};')(
      app,{players:Array.from({length:playerCount},()=>({}))},()=>options.motion!==false,
      node=>({transform:'none',translate:'none',scale:'none',getPropertyValue:name=>node.style?.getPropertyValue?.(name)||''}),
      options.document
    );
  return {...functions,setBoard(nextCards=[],nextSeats=[]){cards=nextCards;seats=nextSeats;}};
}

function numericPair(value, fallback) {
  if(value==null||value==='none')return fallback;
  const values=String(value).trim().split(/[ ,]+/).map(parseFloat);
  return [values[0],values[1]??values[0]];
}

function displayedRect(box, frame) {
  let translation=numericPair(frame.translate,[0,0]);
  let scale=numericPair(frame.scale,[1,1]);
  if(frame.transform) {
    const translate=frame.transform.match(/translate\(([^)]+)\)/);
    const resize=frame.transform.match(/scale\(([^)]+)\)/);
    if(translate)translation=numericPair(translate[1],[0,0]);
    if(resize)scale=numericPair(resize[1],[1,1]);
  }
  const width=box.width*scale[0],height=box.height*scale[1];
  return rect(box.left+box.width/2+translation[0]-width/2,
    box.top+box.height/2+translation[1]-height/2,width,height);
}

function approximately(actual, expected, message) {
  for(const key of ['left','top','width','height'])
    assert.ok(Math.abs(actual[key]-expected[key])<1e-6,
      message+' '+key+': expected '+expected[key]+', received '+actual[key]);
}

test('A surviving table card starts at its old rectangle and lands at its new size',()=>{
  const h=harness();
  const before=rect(100,240,60,84),after=rect(160,290,45,63);
  h.setBoard([makeNode({action:'table',id:'survivor',box:before})]);
  const previous=h.layoutPositions(),saved=previous.get('table:survivor');
  assert.equal(saved.width,before.width);
  assert.equal(saved.height,before.height);
  const survivor=makeNode({action:'table',id:'survivor',box:after});
  h.setBoard([survivor]);
  h.animateLayout(previous,'capture',false);
  assert.equal(survivor.calls.length,1);
  const {frames,options}=survivor.calls[0];
  approximately(displayedRect(after,frames[0]),before,'first animation frame');
  approximately(displayedRect(after,frames.at(-1)),after,'final animation frame');
  assert.equal(options.delay,160,'retain the human capture gap-closing delay');
  assert.ok(options.fill==='backwards'||options.fill==='both','keep the old rectangle visible during delay');
});

test('A card whose center stays fixed still animates a size change',()=>{
  const h=harness();
  const before=rect(120,200,60,84),after=rect(125,207,50,70);
  h.setBoard([makeNode({action:'table',id:'centered',box:before})]);
  const previous=h.layoutPositions();
  const survivor=makeNode({action:'table',id:'centered',box:after});
  h.setBoard([survivor]);h.animateLayout(previous,'build');
  assert.equal(survivor.calls.length,1,'zero translation must not suppress resizing');
  approximately(displayedRect(after,survivor.calls[0].frames[0]),before,'size-only starting frame');
  approximately(displayedRect(after,survivor.calls[0].frames.at(-1)),after,'size-only ending frame');
});

test('Multiplayer back snapshots are keyed by seat and follow survivors when another seat plays',()=>{
  const h=harness(4);
  const oldSeats=[
    makeSeat(1,[rect(10,20,18,26),rect(23,20,18,26)]),
    makeSeat(2,[rect(100,20,18,26),rect(113,20,18,26)]),
    makeSeat(3,[rect(200,20,18,26)])
  ];
  h.setBoard([],oldSeats);
  const previous=h.layoutPositions();
  for(const seat of oldSeats)for(const [index,back] of seat.backs.entries()) {
    const key='cpu-back:'+seat.dataset.cpuSeat+':'+index;
    const saved=previous.get(key);
    assert.ok(saved,'snapshot missing '+key);
    assert.equal(saved.width,back.getBoundingClientRect().width);
    assert.equal(saved.height,back.getBoundingClientRect().height);
  }
  // Seat 1 loses its last card. The flattened array index of every later
  // seat changes, so keys must not accidentally match the previous seat.
  const newSeats=[
    makeSeat(1,[rect(20,20,18,26)]),
    makeSeat(2,[rect(103,20,18,26),rect(116,20,18,26)]),
    makeSeat(3,[rect(203,20,18,26)])
  ];
  h.setBoard([],newSeats);h.animateLayout(previous,'trail',true);
  for(const seat of newSeats)for(const [index,back] of seat.backs.entries()) {
    assert.equal(back.calls.length,1,'seat '+seat.dataset.cpuSeat+' back '+index+' animates');
    const old=oldSeats.find(oldSeat=>oldSeat.dataset.cpuSeat===seat.dataset.cpuSeat).backs[index];
    approximately(displayedRect(back.getBoundingClientRect(),back.calls[0].frames[0]),
      old.getBoundingClientRect(),'seat '+seat.dataset.cpuSeat+' back '+index);
  }
});

test('Two-player back keys remain compatible and hidden incoming hand cards are excluded',()=>{
  const h=harness(2),seat=makeSeat(1,[rect(20,20,34,48)]);
  h.setBoard([
    makeNode({action:'hand',id:'existing',box:rect(40,500,60,84)}),
    makeNode({action:'hand',id:'incoming',box:rect(105,500,60,84),hidden:true})
  ],[seat]);
  const previous=h.layoutPositions();
  assert.ok(previous.has('cpu-back:0'));
  assert.ok(previous.has('hand:existing'));
  assert.equal(previous.has('hand:incoming'),false,'incoming deals have no visible source rectangle');
});

test('Loose-card gaps stay constant across former six, ten and eighteen card thresholds',()=>{
  const start=source.indexOf('  function rowPlan(');
  const end=source.indexOf('  function gameSeatColor(',start);
  assert.ok(start>=0&&end>start);
  const {rowPlan,cardRowStyle}=new Function(source.slice(start,end)+';return {rowPlan,cardRowStyle};')();
  const counts=[1,4,6,7,10,11,18,19,30,54];
  const gap=rowPlan(counts[0],true).gap;
  assert.ok(gap>0);
  for(const count of counts) {
    const plan=rowPlan(count,true);
    assert.equal(plan.gap,gap,'gap changed at '+count+' loose cards');
    assert.equal(plan.portraitCols,4);
    assert.equal(plan.portraitRows,Math.ceil(count/4));
    const rendered=cardRowStyle(count,true).match(/--multi-gap:([\d.]+)px/);
    assert.ok(rendered);
    assert.equal(Number(rendered[1]),gap,'the same gap reaches actual rendered CSS');
  }
});

function makeBuild(id, cardBoxes, {collapsed=false,box}={}) {
  const layers=cardBoxes.map(({id,box})=>{
    const layer=makeNode({box});
    layer.classList=classList('build-layer');
    layer.innerHTML='<span class="playing-card" data-card-id="'+id+'"></span>';
    const face={dataset:{cardId:id},style:style(),getBoundingClientRect:()=>layer.getBoundingClientRect()};
    layer.querySelector=selector=>selector.includes('playing-card')?face:null;
    return layer;
  });
  const natural=box||rect(cardBoxes[0].box.left,cardBoxes[0].box.top,cardBoxes[0].box.width,
    cardBoxes.at(-1).box.bottom-cardBoxes[0].box.top);
  const build=makeNode({action:'table',id,box:natural});
  build.classList=classList('build-item',...(collapsed?['is-collapsed']:[]));
  const summary=makeNode({box:natural});
  summary.outerHTML='<span class="build-summary">Build 10</span>';
  summary.cloneNode=()=>({style:style(),outerHTML:summary.outerHTML,querySelectorAll:()=>[]});
  summary.querySelectorAll=()=>[];
  build.layers=layers;build.summary=summary;
  build.querySelector=selector=>selector.includes('build-summary')?summary:null;
  build.querySelectorAll=selector=>selector.includes('build-layer')?layers:[];
  return build;
}

function flightDocument() {
  const effects=[],created=[];
  const createElement=()=>{
    const element={style:style(),children:[],className:'',innerHTML:'',removed:false,
      appendChild(child){this.children.push(child);child.parentElement=this;},
      remove(){this.removed=true;if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);},
      querySelector:()=>null,
      animate(frames,options){
        let resolve,reject;
        const effect={frames,options,finished:new Promise((yes,no)=>{resolve=yes;reject=no;}),
          finish:()=>resolve(),cancel:()=>reject(new Error('cancelled'))};
        effects.push(effect);return effect;
      }
    };
    created.push(element);return element;
  };
  const body=createElement();
  return {body,createElement,effects,created};
}

test('Expanded build survivors retain their own card rectangles as stack spacing changes',()=>{
  const h=harness();
  const before=[{id:'S3',box:rect(220,110,60,84)},{id:'D7',box:rect(220,135,60,84)}];
  h.setBoard([makeBuild('build',before)]);
  const previous=h.layoutPositions();
  const next=makeBuild('build',[{id:'S3',box:rect(145,100,60,84)},{id:'D7',box:rect(145,118,60,84)}]);
  h.setBoard([next]);h.animateLayout(previous,'build');
  assert.equal(next.calls.length,0,'animate card layers rather than distorting the whole ribbon');
  for(const [i,layer] of next.layers.entries()){
    assert.equal(layer.calls.length,1);
    approximately(displayedRect(layer.getBoundingClientRect(),layer.calls[0].frames[0]),before[i].box,'build layer '+i);
    approximately(displayedRect(layer.getBoundingClientRect(),layer.calls[0].frames.at(-1)),layer.getBoundingClientRect(),'build landing '+i);
  }
});

test('A folding build retains every visible source card until the summary is ready',async()=>{
  const document=flightDocument(),h=harness(2,{document});
  const before=[{id:'S3',box:rect(220,110,60,84)},{id:'D7',box:rect(220,135,60,84)}];
  h.setBoard([makeBuild('build',before)]);
  const previous=h.layoutPositions(),target=rect(250,210,48,48/.715);
  const next=makeBuild('build',before,{collapsed:true,box:target});
  h.setBoard([next]);h.animateLayout(previous,'capture');
  assert.equal(next.style.visibility,'hidden','the final black summary cannot jump over the moving cards');
  const shell=document.body.children[0];
  assert.ok(shell);
  const ghosts=shell.children.filter(node=>node.className.includes('card-flight'));
  assert.equal(ghosts.length,before.length);
  for(const [i,ghost] of ghosts.entries()){
    const effect=document.effects[i];
    const ghostBox=rect(parseFloat(ghost.style.left),parseFloat(ghost.style.top),parseFloat(ghost.style.width),parseFloat(ghost.style.height));
    approximately(displayedRect(ghostBox,effect.frames[0]),before[i].box,'fold source '+i);
    approximately(displayedRect(ghostBox,effect.frames.at(-1)),target,'fold destination '+i);
    for(const frame of effect.frames)assert.notEqual(frame.opacity,0,'folding cards stay visible');
  }
  document.effects.forEach(effect=>effect.finish());
  await Promise.allSettled(document.effects.map(effect=>effect.finished));
  await Promise.resolve();
  assert.equal(next.style.visibility,'');
  assert.equal(shell.removed,true);
});

test('Cancelled fold cleanup does not forget a replacement reflow animation',async()=>{
  const document=flightDocument(),h=harness(2,{document});
  const before=[{id:'S3',box:rect(220,110,60,84)},{id:'D7',box:rect(220,135,60,84)}];
  h.setBoard([makeBuild('build',before)]);
  const expanded=h.layoutPositions(),target=rect(250,210,48,48/.715);
  const next=makeBuild('build',before,{collapsed:true,box:target});
  h.setBoard([next]);h.animateLayout(expanded,'capture');
  const folded=h.layoutPositions();
  const shifted=rect(230,210,48,48/.715);
  next.setBox(shifted);next.summary.setBox(shifted);
  h.animateLayout(folded,'build');
  assert.equal(next.calls.length,1);
  const replacement=next.calls[0].animation;
  await Promise.allSettled(document.effects.map(effect=>effect.finished));
  await Promise.resolve();
  // Another reflow must still cancel the currently tracked animation.
  const current=h.layoutPositions();
  h.animateLayout(current,'build');
  assert.equal(replacement.cancelled,true,'old fold cleanup discarded the new active animation');
  assert.ok(document.body.children.every(node=>node.removed),'cancelled folding ghosts are removed');
});

test('Reduced motion immediately uses the final layout without hiding builds or creating flights',()=>{
  const document=flightDocument(),h=harness(2,{document,motion:false});
  const before=[{id:'S3',box:rect(220,110,60,84)},{id:'D7',box:rect(220,135,60,84)}];
  h.setBoard([makeBuild('build',before)]);
  const previous=h.layoutPositions();
  const next=makeBuild('build',before,{collapsed:true,box:rect(250,210,48,48/.715)});
  h.setBoard([next]);h.animateLayout(previous,'capture');
  assert.equal(next.calls.length,0);
  assert.notEqual(next.style.visibility,'hidden');
  assert.equal(document.body.children.length,0);
  assert.equal(document.effects.length,0);
});
