import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
const root=new URL('../dist/',import.meta.url);
const source=await readFile(new URL('sw.js',root),'utf8');
const musicFiles=['audio/endless.mp3','audio/boss.mp3'];
const authoredModules=['run-upgrades.js','stage-hud.js','companions.js','skin-unlock.js'];

function worker({failed=[],wrongType=[],partial=[],base='/'}={}){
  const handlers={},stores=new Map(),messages=[],requests=[];
  const failures=new Set(failed),wrong=new Set(wrongType);let offline=false,claimed=false,skipped=false;
  const key=url=>typeof url==='string'?url:url.url;
  const caches={
    async open(name){
      if(!stores.has(name))stores.set(name,new Map());const cache=stores.get(name);
      return {async put(url,response){cache.set(key(url),response.clone());},async match(url){return cache.get(key(url))?.clone();},async keys(){return Array.from(cache.keys(),url=>({url}));}};
    },
    async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);}
  };
  const self={location:new URL('https://game.example'+base+'sw.js'),addEventListener(type,callback){handlers[type]=callback;},async skipWaiting(){skipped=true;},
    clients:{async claim(){claimed=true;},async matchAll(){return [{postMessage(data){messages.push(data);}}];}}};
  const fetch=async(url,options)=>{
    const parsed=new URL(key(url));requests.push({path:parsed.pathname,options});
    if(offline||failures.has(parsed.pathname))throw new Error('network unavailable');
    if(partial.includes(parsed.pathname))return new Response('short slice',{status:206,headers:{'content-range':'bytes 100-110/1000','content-type':'audio/mpeg'}});
    if(wrong.has(parsed.pathname))return new Response('<html>Please sign in</html>',{headers:{'content-type':'text/html'}});
    const relative=parsed.pathname.slice(base.length);
    const body=await readFile(new URL(relative||'index.html',root));
    const type=parsed.pathname.endsWith('.js')?'text/javascript':parsed.pathname.endsWith('.css')?'text/css':!relative||parsed.pathname.endsWith('.html')?'text/html':'application/octet-stream';
    return new Response(body,{headers:{'content-type':type}});
  };
  vm.runInNewContext(source,{self,caches,fetch,URL,Promise,Error,crypto:webcrypto});
  return{stores,messages,requests,failures,setOffline(value=true){offline=value;},get claimed(){return claimed;},get skipped(){return skipped;},
    async event(name,data={}){let promise;handlers[name]({...data,waitUntil(p){promise=p;},respondWith(p){promise=p;}});return promise;},
    async status(){let reply;await this.event('message',{data:{type:'CHECK_CACHE'},ports:[{postMessage(data){reply=data;}}]});return reply;}};
}

test('manifest carries private-site credentials and all icons/engine exist locally',async()=>{
  const html=await readFile(new URL('index.html',root),'utf8');
  assert.match(html,/<link rel="manifest"[^>]*crossorigin="use-credentials"/);
  const manifest=JSON.parse(await readFile(new URL('manifest.webmanifest',root),'utf8'));
  assert.equal(manifest.orientation,'any');assert.equal(manifest.display,'standalone');
  for(const icon of manifest.icons)assert.ok((await stat(new URL(icon.src,root))).size>1000);
  assert.ok((await stat(new URL('vendor/phaser.min.js',root))).size>1000000);
});
test('core and warmed extras serve from cache with the network unavailable',async()=>{
  const w=worker();await w.event('install');await w.event('activate');
  await w.event('message',{data:{type:'WARM_CACHE'}});w.setOffline();
  for(const path of ['/','/?from=homescreen','/index.html']){
    const response=await w.event('fetch',{request:{method:'GET',url:'https://game.example'+path,mode:'navigate'}});
    assert.match(await response.text(),/id="game"/);
  }
  for(const asset of [...authoredModules,'game.js','physics.js','home.js','icons.js','motion.js','boss-visuals.js','audio.js','music-player.js','offline.js',...musicFiles,'display.js','style.css','fonts/qiuqiule-ui.woff2','vendor/phaser.min.js','icons/icon-192.png']){
    const response=await w.event('fetch',{request:{method:'GET',url:'https://game.example/'+asset,mode:'cors'}});assert.ok((await response.arrayBuffer()).byteLength>0);
  }
  const state=await w.status();assert.equal(state.ready,true);assert.equal(state.musicReady,true);
  assert.deepEqual(w.requests.filter(({path})=>path.endsWith('.mp3')).map(({path})=>path).sort(),musicFiles.map(file=>'/'+file).sort());
  assert.ok(w.requests.every(request=>request.options.credentials==='same-origin'&&request.options.redirect==='error'));
});
test('missing a required music player or progression module keeps the previous complete offline version',async()=>{
  for(const module of ['music-player.js',...authoredModules,'physics.js']){
    const w=worker({failed:[`/${module}`]});
    const previous=new Map([['https://game.example/',new Response('v6.6.0 complete')]]);
    w.stores.set('qiuqiule-%2F-v6.6.0-campaign-batch1-1',previous);
    await assert.rejects(w.event('install'),/Core cache incomplete/);
    assert.equal(w.skipped,false);assert.equal(w.stores.size,1);
    assert.equal(await w.stores.values().next().value.get('https://game.example/').text(),'v6.6.0 complete');
  }
});
test('failed music download cannot block offline game installation and can retry later',async()=>{
  const w=worker({failed:['/audio/endless.mp3']});await w.event('install');await w.event('activate');
  assert.equal(w.claimed,true);assert.equal(w.skipped,true);
  await w.event('message',{data:{type:'WARM_CACHE'}});let state=await w.status();
  assert.equal(state.ready,true);assert.equal(state.musicReady,false);assert.equal(state.extrasReady,false);
  assert.equal(w.requests.filter(r=>r.path==='/audio/boss.mp3').length,1);
  w.setOffline();const response=await w.event('fetch',{request:{method:'GET',url:'https://game.example/',mode:'navigate'}});
  assert.match(await response.text(),/id="game"/);
  w.setOffline(false);w.failures.clear();await w.event('message',{data:{type:'WARM_CACHE'}});
  state=await w.status();assert.equal(state.musicReady,true);assert.equal(state.extrasReady,true);
  assert.equal(w.requests.filter(r=>r.path==='/audio/boss.mp3').length,1);
});
test('a partial track cannot mark all music files as ready',async()=>{
  const partial=['/audio/boss.mp3'];
  const w=worker({partial});await w.event('install');await w.event('activate');
  await w.event('message',{data:{type:'WARM_CACHE'}});
  assert.equal((await w.status()).musicReady,false);
  partial.length=0;await w.event('message',{data:{type:'WARM_CACHE'}});
  assert.equal((await w.status()).musicReady,true);
});
test('partial core updates are discarded while the previous offline game survives',async()=>{
  const w=worker({failed:['/physics.js']});
  const previous=new Map([['https://game.example/',new Response('previous working game')]]);
  w.stores.set('qiuqiule-%2F-v1.4.0',previous);
  await assert.rejects(w.event('install'),/Core cache incomplete/);
  assert.equal(w.skipped,false);assert.equal(w.stores.size,1);
  assert.equal(await w.stores.get('qiuqiule-%2F-v1.4.0').get('https://game.example/').text(),'previous working game');
  assert.ok(w.messages.some(message=>message.type==='CACHE_FAILED'));
});
test('missing bundled font prevents replacing a working offline game',async()=>{
  const w=worker({failed:['/fonts/qiuqiule-ui.woff2']});
  const previous=new Map([['https://game.example/',new Response('previous working game')]]);
  w.stores.set('qiuqiule-%2F-v5.2.0-offline-1',previous);
  await assert.rejects(w.event('install'),/Core cache incomplete/);
  assert.equal(w.skipped,false);assert.equal(w.stores.size,1);
  assert.equal(await w.stores.get('qiuqiule-%2F-v5.2.0-offline-1').get('https://game.example/').text(),'previous working game');
});
test('HTML sign-in responses are rejected and hosted authentication routes are not intercepted',async()=>{
  for(const path of ['/','/game.js']){
    const w=worker({wrongType:[path]});await assert.rejects(w.event('install'),/Core cache incomplete/);assert.equal(w.skipped,false);
  }
  const w=worker();await w.event('install');await w.event('activate');w.setOffline();
  for(const path of ['/signin-with-chatgpt','/callback','/signout-with-chatgpt']){
    assert.equal(await w.event('fetch',{request:{method:'GET',url:'https://game.example'+path,mode:'navigate'}}),undefined);
  }
});
test('GitHub Pages repository subpaths keep assets scoped and preserve other repositories caches',async()=>{
  const w=worker({base:'/qiuqiule/'});
  w.stores.set('qiuqiule-%2Fother-game%2F-v1.0.0',new Map());
  await w.event('install');await w.event('activate');await w.event('message',{data:{type:'WARM_CACHE'}});
  assert.ok(w.requests.every(request=>request.path.startsWith('/qiuqiule/')));
  assert.ok(w.stores.has('qiuqiule-%2Fother-game%2F-v1.0.0'));
  w.setOffline();
  for(const path of ['/qiuqiule/','/qiuqiule/index.html','/qiuqiule/?from=homescreen']){
    const response=await w.event('fetch',{request:{method:'GET',url:'https://game.example'+path,mode:'navigate'}});
    assert.match(await response.text(),/id="game"/);
  }
  for(const asset of musicFiles){
    const music=await w.event('fetch',{request:{method:'GET',url:'https://game.example/qiuqiule/'+asset,mode:'cors'}});
    assert.equal((await music.arrayBuffer()).byteLength,(await stat(new URL(asset,root))).size);
  }
});

test('an upgrade reuses both current tracks but leaves retired campaign music behind',async()=>{
  const w=worker({base:'/qiuqiule/'}),origin='https://game.example/qiuqiule/';
  const paths=musicFiles.map(file=>origin+file);
  const buffers=await Promise.all(musicFiles.map(file=>readFile(new URL(file,root))));
  w.stores.set('qiuqiule-%2Fqiuqiule%2F-v8.3.0',new Map([[paths[0],new Response(buffers[0])],[origin+'audio/campaign.mp3',new Response('retired')]]));
  w.stores.set('qiuqiule-%2Fqiuqiule%2F-v8.4.0',new Map([[paths[0],new Response('wrong edition')],[paths[1],new Response(buffers[1])]]));
  await w.event('install');w.setOffline();await w.event('activate');
  const state=await w.status();assert.equal(state.musicReady,true);
  assert.equal(w.stores.get(state.version).has(origin+'audio/campaign.mp3'),false);
  for(const [i,url] of paths.entries()){
    const response=await w.event('fetch',{request:{method:'GET',url,mode:'cors'}});
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),buffers[i]);
  }
  assert.equal(w.requests.filter(r=>r.path.endsWith('.mp3')).length,0);
});

test('wrong audio at a familiar URL and valid audio from another game cannot migrate',async()=>{
  const w=worker(),url='https://game.example/'+musicFiles[0];
  w.stores.set('qiuqiule-%2F-v8.1.0',new Map([[url,new Response('old mix')]]));
  w.stores.set('qiuqiule-%2Fother%2F-v8.1.0',new Map([[url,new Response(await readFile(new URL(musicFiles[0],root)))]]));
  await w.event('install');await w.event('activate');w.setOffline();
  await assert.rejects(w.event('fetch',{request:{method:'GET',url,mode:'cors'}}),/network unavailable/);
  assert.equal((await w.status()).musicReady,false);
});

test('playback and background warmup retrieve each previously uncached track just once',async()=>{
  const w=worker(),url='https://game.example/'+musicFiles[0];
  await w.event('install');await w.event('activate');
  const playing=()=>w.event('fetch',{request:{method:'GET',url,mode:'cors'}});
  const [a,b]=await Promise.all([playing(),playing(),w.event('message',{data:{type:'WARM_CACHE'}})]);
  const expected=await readFile(new URL(musicFiles[0],root));
  for(const result of [a,b])assert.deepEqual(Buffer.from(await result.arrayBuffer()),expected);
  assert.equal(w.requests.filter(r=>r.path==='/'+musicFiles[0]).length,1);
  assert.equal((await w.status()).musicReady,true);
});

test('every relative module reachable from the shipped entrypoints is bundled and precached offline',async()=>{
  const html=await readFile(new URL('index.html',root),'utf8');
  const modules=new Set(),pending=[...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map(match=>match[1].replace(/^\.\//,''));
  while(pending.length){
    const path=pending.pop();if(modules.has(path))continue;modules.add(path);
    const code=await readFile(new URL(path,root),'utf8');
    for(const match of code.matchAll(/(?:import|export)\s+(?:[^'";]+?\s+from\s*)?['"](\.[^'"]+\.js)['"]/g)){
      const resolved=new URL(match[1],new URL(path,root));
      assert.ok(resolved.href.startsWith(root.href),'relative modules stay in the shipped directory');
      pending.push(resolved.href.slice(root.href.length));
    }
  }
  assert.ok(modules.has('game.js')&&modules.has('companions.js')&&modules.has('wardrobe.js'));
  assert.ok([...modules].every(path=>!/^campaign|^classes\/|^levels\.js$|^level-orbs\.js$/.test(path)));
  const w=worker();await w.event('install');await w.event('activate');w.setOffline();
  for(const path of modules){
    const response=await w.event('fetch',{request:{method:'GET',url:'https://game.example/'+path,mode:'cors'}});
    assert.ok(response,`${path} is available offline`);assert.ok((await response.text()).length>0);
  }
});
