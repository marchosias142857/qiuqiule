import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
const root=new URL('../dist/',import.meta.url);
const source=await readFile(new URL('sw.js',root),'utf8');
const musicFiles=['audio/endless.mp3','audio/boss.mp3'];
const authoredModules=['run-upgrades.js','stage-hud.js','star-trails.js','star-particles.js','particle-appearance.js','skin-unlock.js'];

function worker({failed=[],wrongType=[],partial=[],redirects={},base='/',stores=new Map(),denySharedWrites=false,claimFails=false,code=source,assetBodies={},fetchOverride=null,timers={setTimeout,clearTimeout}}={}){
  const handlers={},messages=[],requests=[];
  const failures=new Set(failed),wrong=new Set(wrongType);let offline=false,claimed=false,skipped=false;
  const key=url=>typeof url==='string'?url:url.url;
  const caches={
    async open(name){
      if(!stores.has(name))stores.set(name,new Map());const cache=stores.get(name);
      return {async put(url,response){if(denySharedWrites&&name.endsWith('-music-v1'))throw Error('quota exceeded');cache.set(key(url),response.clone());},async match(url){return cache.get(key(url))?.clone();},async delete(url){return cache.delete(key(url));},async keys(){return Array.from(cache.keys(),url=>({url}));}};
    },
    async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);}
  };
  const self={location:new URL('https://game.example'+base+'sw.js'),addEventListener(type,callback){handlers[type]=callback;},async skipWaiting(){skipped=true;},
    clients:{async claim(){if(claimFails)throw Error('claim failed');claimed=true;},async matchAll(){return [{postMessage(data){messages.push(data);}}];}}};
  const fetch=async(url,options)=>{
    const parsed=new URL(key(url));requests.push({path:parsed.pathname,options});
    const overridden=fetchOverride?.(parsed,options);
    if(overridden!==undefined)return overridden;
    if(offline||failures.has(parsed.pathname))throw new Error('network unavailable');
    if(redirects[parsed.pathname]){
      // Real hosting canonicalizes index.html and redirects unauthenticated assets.
      // Fetch with redirect:error rejects before exposing either redirect response.
      if(options?.redirect==='error')throw new TypeError('Redirect disallowed');
      const response=new Response('<html>redirect destination</html>',{headers:{'content-type':'text/html'}});
      Object.defineProperty(response,'redirected',{value:true});
      Object.defineProperty(response,'url',{value:new URL(redirects[parsed.pathname],parsed).href});
      return response;
    }
    if(partial.includes(parsed.pathname))return new Response('short slice',{status:206,headers:{'content-range':'bytes 100-110/1000','content-type':'audio/mpeg'}});
    if(wrong.has(parsed.pathname))return new Response('<html>Please sign in</html>',{headers:{'content-type':'text/html'}});
    const relative=parsed.pathname.slice(base.length);
    const body=assetBodies[relative]??await readFile(new URL(relative||'index.html',root));
    const type=parsed.pathname.endsWith('.js')?'text/javascript':parsed.pathname.endsWith('.css')?'text/css':!relative||parsed.pathname.endsWith('.html')?'text/html':'application/octet-stream';
    return new Response(body,{headers:{'content-type':type}});
  };
  vm.runInNewContext(code,{self,caches,fetch,URL,Promise,Error,crypto:webcrypto,AbortController,setTimeout:timers.setTimeout,clearTimeout:timers.clearTimeout});
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

function manualTimers(){
  const active=new Map();let sequence=0;
  return {active,setTimeout(callback,delay){const id=++sequence;active.set(id,{callback,delay});return id;},clearTimeout(id){active.delete(id);},
    expire(){for(const {callback} of [...active.values()])callback();}};
}
const settleWorker=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};

test('a slow core script keeps its original fetch lifetime without the music deadline',async()=>{
  const timers=manualTimers();let finishScript,scriptOptions;
  const pending=new Promise(resolve=>{finishScript=resolve;});
  const w=worker({timers,fetchOverride(parsed,options){
    if(parsed.pathname==='/game.js'){scriptOptions=options;return pending;}
  }});
  const installing=w.event('install');await settleWorker();
  assert.equal(timers.active.size,0,'core resources do not allocate music timeout timers');
  assert.equal(scriptOptions.signal,undefined,'core cancellation behavior stays unchanged');
  timers.expire();await settleWorker();assert.equal(w.skipped,false);
  finishScript(new Response(await readFile(new URL('game.js',root)),{headers:{'content-type':'text/javascript'}}));
  await installing;assert.equal(w.skipped,true);
  assert.equal(w.requests.filter(request=>request.path==='/game.js').length,1);
});

test('a stalled shared music download times out before the page and later retries recover',async()=>{
  const timers=manualTimers(),url='https://game.example/audio/endless.mp3';
  let finishStalled,first=true,signal;
  const stalled=new Promise(resolve=>{finishStalled=resolve;});
  const w=worker({timers,fetchOverride(parsed,options){
    if(parsed.pathname==='/audio/endless.mp3'&&first){first=false;signal=options.signal;return stalled;}
  }});
  await w.event('install');await w.event('activate');
  const playing=()=>w.event('fetch',{request:{method:'GET',url,mode:'cors'}});
  const a=assert.rejects(playing(),/timed out/),b=assert.rejects(playing(),/timed out/);
  await settleWorker();
  assert.equal(w.requests.filter(request=>request.path==='/audio/endless.mp3').length,1,'concurrent callers share the same download');
  assert.equal(timers.active.size,1,'one deadline covers the whole shared request');
  assert.ok([...timers.active.values()][0].delay<20000,'the worker releases before the audio caller gives up');
  timers.expire();await Promise.all([a,b]);assert.equal(signal.aborted,true);assert.equal(timers.active.size,0);
  const recovered=await playing(),expected=await readFile(new URL('audio/endless.mp3',root));
  assert.deepEqual(Buffer.from(await recovered.arrayBuffer()),expected);
  finishStalled(new Response('late stale response'));
  await settleWorker();w.setOffline();
  const cached=await playing();assert.deepEqual(Buffer.from(await cached.arrayBuffer()),expected);
  assert.equal(w.requests.filter(request=>request.path==='/audio/endless.mp3').length,2,'late timed-out work neither retries nor replaces the successful response');
});

test('the music deadline also covers a body that stalls after successful response headers',async()=>{
  const timers=manualTimers(),url='https://game.example/audio/endless.mp3';
  let body,first=true,signal;
  const w=worker({timers,fetchOverride(parsed,options){
    if(parsed.pathname!=='/audio/endless.mp3'||!first)return;
    first=false;signal=options.signal;
    return new Response(new ReadableStream({start(controller){body=controller;}}),{headers:{'content-type':'audio/mpeg'}});
  }});
  await w.event('install');await w.event('activate');
  const playing=()=>w.event('fetch',{request:{method:'GET',url,mode:'cors'}});
  const timedOut=assert.rejects(playing(),/timed out/);await settleWorker();
  assert.equal(timers.active.size,1);timers.expire();await timedOut;assert.equal(signal.aborted,true);
  const recovered=await playing(),expected=await readFile(new URL('audio/endless.mp3',root));
  assert.deepEqual(Buffer.from(await recovered.arrayBuffer()),expected);
  body.enqueue(new TextEncoder().encode('late incomplete MP3'));body.close();await settleWorker();w.setOffline();
  assert.deepEqual(Buffer.from(await (await playing()).arrayBuffer()),expected);
  assert.equal(w.requests.filter(request=>request.path==='/audio/endless.mp3').length,2);
  assert.equal(timers.active.size,0);
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
for(const base of ['/','/qiuqiule/']){
  test(`canonical index redirect at ${base} does not block installation or offline entry`,async()=>{
    const index=base+'index.html';
    const w=worker({base,redirects:{[index]:base}});
    await w.event('install');await w.event('activate');
    assert.equal(w.skipped,true);assert.equal(w.claimed,true);
    assert.equal((await w.status()).ready,true);
    assert.equal(w.requests.some(request=>request.path===index),false,'only the canonical game shell needs downloading');
    const requestCount=w.requests.length;w.setOffline();
    for(const path of [base,index,base+'?from=homescreen',index+'?from=homescreen']){
      const response=await w.event('fetch',{request:{method:'GET',url:'https://game.example'+path,mode:'navigate'}});
      assert.match(await response.text(),/id="game"/);
    }
    assert.equal(w.requests.length,requestCount,'both entry aliases are entirely local');
  });
}
test('authentication redirects still reject installation and preserve the prior offline game',async()=>{
  for(const path of ['/','/game.js']){
    const w=worker({redirects:{[path]:'/signin-with-chatgpt'}});
    w.stores.set('qiuqiule-%2F-v10.0.5',new Map([['https://game.example/',new Response('previous working game')]]));
    await assert.rejects(w.event('install'),/Core cache incomplete/);
    assert.equal(w.skipped,false);assert.equal(w.claimed,false);assert.equal(w.stores.size,1);
    assert.equal(await w.stores.get('qiuqiule-%2F-v10.0.5').get('https://game.example/').text(),'previous working game');
    const attempts=w.requests.filter(request=>request.path===path);
    assert.equal(attempts.length,2);assert.ok(attempts.every(request=>request.options.redirect==='error'));
  }
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
  assert.ok(modules.has('game.js')&&['star-trails.js','star-particles.js','particle-appearance.js'].every(file=>modules.has(file))&&modules.has('wardrobe.js'));
  assert.ok([...modules].every(path=>!/^campaign|^classes\/|^levels\.js$|^level-orbs\.js$/.test(path)));
  const w=worker();await w.event('install');await w.event('activate');w.setOffline();
  for(const path of modules){
    const response=await w.event('fetch',{request:{method:'GET',url:'https://game.example/'+path,mode:'cors'}});
    assert.ok(response,`${path} is available offline`);assert.ok((await response.text()).length>0);
  }
});

test('verified migration keeps one MP3 copy across releases and retains the preceding game core',async()=>{
  const w=worker(),origin='https://game.example/',old='qiuqiule-%2F-v11.3.1';
  const buffers=await Promise.all(musicFiles.map(file=>readFile(new URL(file,root))));
  const previous=new Map([[origin,new Response('previous working game')]]);
  for(const [i,file] of musicFiles.entries())previous.set(origin+file,new Response(buffers[i]));
  w.stores.set(old,previous);
  await w.event('install');w.setOffline();await w.event('activate');
  const state=await w.status();
  assert.equal(state.musicReady,true);assert.ok(w.stores.has(old));
  assert.equal(await previous.get(origin).clone().text(),'previous working game');
  let bytes=0,copies=0;
  for(const cache of w.stores.values())for(const [url,response] of cache){
    if(new URL(url).pathname.endsWith('.mp3')){copies++;bytes+=(await response.clone().arrayBuffer()).byteLength;}
  }
  assert.equal(copies,2);assert.equal(bytes,buffers.reduce((sum,buffer)=>sum+buffer.byteLength,0));
  for(const file of musicFiles)assert.equal(previous.has(origin+file),false);
  const next=worker({stores:w.stores,code:source.replace(/const CACHE = [^\n]+/,"const CACHE = CACHE_PREFIX+'test-next-release';")});
  await next.event('install');next.setOffline();await next.event('activate');
  assert.equal((await next.status()).musicReady,true);
  assert.ok(next.stores.has(state.version),'the preceding core stays available');
  assert.equal(next.requests.filter(request=>request.path.endsWith('.mp3')).length,0,'unchanged music never redownloads');
  assert.equal([...next.stores.values()].flatMap(cache=>[...cache.keys()]).filter(url=>new URL(url).pathname.endsWith('.mp3')).length,2);
});

test('a failed shared-cache write retains and serves the only legacy music offline',async()=>{
  const w=worker({denySharedWrites:true}),origin='https://game.example/';
  const old='qiuqiule-%2F-v11.2.0',previous=new Map();
  const buffers=await Promise.all(musicFiles.map(file=>readFile(new URL(file,root))));
  for(const [i,file] of musicFiles.entries())previous.set(origin+file,new Response(buffers[i]));
  w.stores.set(old,previous);
  w.stores.set('qiuqiule-%2F-v11.3.1',new Map([[origin,new Response('newer core')]]));
  await w.event('install');w.setOffline();await w.event('activate');
  assert.equal(w.claimed,true);assert.ok(w.stores.has(old),'quota failure must not evict the only playable copy');
  for(const [i,file] of musicFiles.entries()){
    const response=await w.event('fetch',{request:{method:'GET',url:origin+file,mode:'cors'}});
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),buffers[i]);
    assert.ok(previous.has(origin+file));
  }
  assert.equal(w.requests.filter(request=>request.path.endsWith('.mp3')).length,0);
});

test('a failed client handoff never removes music or cores still used by the previous worker',async()=>{
  const w=worker({claimFails:true}),origin='https://game.example/';
  const buffers=await Promise.all(musicFiles.map(file=>readFile(new URL(file,root))));
  for(const version of ['11.2.0','11.3.1']){
    const previous=new Map([[origin,new Response('previous game')]]);
    for(const [i,file] of musicFiles.entries())previous.set(origin+file,new Response(buffers[i]));
    w.stores.set('qiuqiule-%2F-v'+version,previous);
  }
  await w.event('install');await assert.rejects(w.event('activate'),/claim failed/);
  for(const version of ['11.2.0','11.3.1']){
    const previous=w.stores.get('qiuqiule-%2F-v'+version);assert.ok(previous?.has(origin));
    for(const file of musicFiles)assert.ok(previous.has(origin+file));
  }
});

test('replacing music retires obsolete shared hashes only after the complete replacement is cached',async()=>{
  const w=worker();await w.event('install');await w.event('activate');await w.event('message',{data:{type:'WARM_CACHE'}});
  const original=await readFile(new URL(musicFiles[0],root)),nextBytes=Buffer.concat([original,Buffer.from('replacement fixture')]);
  const previousHash=createHash('sha256').update(original).digest('hex'),nextHash=createHash('sha256').update(nextBytes).digest('hex');
  const code=source.replace(previousHash,nextHash).replace(/const CACHE = [^\n]+/,"const CACHE = CACHE_PREFIX+'music-replacement';");
  const shared=w.stores.get('qiuqiule-%2F-music-v1');
  const oldKeys=[...shared.keys()];
  const replacement=worker({stores:w.stores,code,assetBodies:{[musicFiles[0]]:nextBytes},failed:['/'+musicFiles[0]]});
  await replacement.event('install');await replacement.event('activate');
  await replacement.event('message',{data:{type:'WARM_CACHE'}});
  assert.deepEqual([...shared.keys()],oldKeys,'an unavailable replacement must keep the old offline bytes');
  replacement.failures.clear();await replacement.event('message',{data:{type:'WARM_CACHE'}});
  assert.equal((await replacement.status()).musicReady,true);
  assert.equal(shared.size,2,'old fingerprint copies cannot accumulate with successful replacements');
  assert.ok([...shared.keys()].some(key=>key.endsWith(nextHash)));
  assert.ok(![...shared.keys()].some(key=>key.endsWith(previousHash)));
  replacement.setOffline();
  const response=await replacement.event('fetch',{request:{method:'GET',url:'https://game.example/'+musicFiles[0],mode:'cors'}});
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),nextBytes);
});

test('replacement quota failure preserves both legacy copies and existing shared hashes',async()=>{
  const w=worker();await w.event('install');await w.event('activate');await w.event('message',{data:{type:'WARM_CACHE'}});
  const original=await readFile(new URL(musicFiles[0],root)),nextBytes=Buffer.concat([original,Buffer.from('replacement fixture')]);
  const previousHash=createHash('sha256').update(original).digest('hex'),nextHash=createHash('sha256').update(nextBytes).digest('hex');
  const code=source.replace(previousHash,nextHash).replace(/const CACHE = [^\n]+/,"const CACHE = CACHE_PREFIX+'quota-replacement';");
  const shared=w.stores.get('qiuqiule-%2F-music-v1'),oldKeys=[...shared.keys()];
  const legacy=new Map([['https://game.example/'+musicFiles[0],new Response(nextBytes)]]);
  w.stores.set('qiuqiule-%2F-prior-mix',legacy);
  const replacement=worker({stores:w.stores,code,denySharedWrites:true,assetBodies:{[musicFiles[0]]:nextBytes}});
  await replacement.event('install');await replacement.event('activate');await replacement.event('message',{data:{type:'WARM_CACHE'}});
  assert.deepEqual([...shared.keys()],oldKeys);
  assert.ok(legacy.has('https://game.example/'+musicFiles[0]));
  replacement.setOffline();
  const response=await replacement.event('fetch',{request:{method:'GET',url:'https://game.example/'+musicFiles[0],mode:'cors'}});
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),nextBytes);
});
