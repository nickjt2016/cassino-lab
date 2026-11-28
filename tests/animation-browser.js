// A real-browser runner for deterministic visual positions. The sandboxed
// frame has an opaque origin: it cannot read or write the game's saved data.
(async()=>{
  const frame=document.getElementById('game'),output=document.getElementById('output');
  const command=(command,value)=>frame.contentWindow.postMessage({kind:'animation-audit-command',command,value},'*');
  addEventListener('message',event=>{
    if(event.source!==frame.contentWindow||event.data?.kind!=='animation-audit-result')return;
    output.textContent=JSON.stringify(event.data.result,null,2);
  });
  document.getElementById('size').addEventListener('change',event=>{
    const [width,height]=event.target.value.split('x');frame.style.width=width+'px';frame.style.height=height+'px';
  });
  document.getElementById('setup').onclick=()=>command('setup',document.getElementById('scenario').value);
  for(const name of ['run','run-paused','deal','resume','finish','modal','redraw','undo','inspect'])document.getElementById(name).onclick=()=>command(name);
  for(const button of document.querySelectorAll('[data-time]'))button.onclick=()=>command('seek',Number(button.dataset.time));
  try{
    const paths=['../src/styles.css','../src/compact.css','../src/engine.js','../src/app.js','animation-fixtures.js'];
    const [styles,compact,engine,app,fixtures]=await Promise.all(paths.map(async path=>{
      const response=await fetch(path,{cache:'no-store'});if(!response.ok)throw Error('Could not load '+path);return response.text();
    }));
    const marker='  render(); // The main menu';
    const index=app.indexOf(marker);if(index<0)throw Error('Game bootstrap marker changed; update this runner.');
    const closeScript='</scr'+'ipt>';
    frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+styles+'\n'+compact+'</style></head><body><div id="app"></div><script>'+engine+closeScript+'<script>'+app.slice(0,index)+fixtures+'\n})();'+closeScript+'</body></html>';
  }catch(error){output.textContent=String(error.stack||error);}
})();
