const ROOT = new URL('./',self.location).href;
const CACHE_PREFIX = 'qiuqiule-'+encodeURIComponent(new URL(ROOT).pathname)+'-';
const CACHE = CACHE_PREFIX+'v11.4.1-star-unlock-centered';
const urls = files => files.map(path => new URL(path,ROOT).href);
// Sites redirects index.html to the directory URL. Cache the canonical shell once;
// both home navigation paths below already resolve to this same cached response.
const CORE = urls(['./','./style.css','./game.js','./feedback.js','./border-bulge.js','./aim.js','./aim-metrics.js','./comet-trail.js','./trail-clip.js','./rhythm-feedback.js','./enemies.js','./enemy-render.js','./upgrades.js','./upgrade-render.js','./shockwave-render.js','./run-upgrades.js','./stage-hud.js','./physics.js','./home.js','./icons.js','./motion.js','./boss-visuals.js','./endless-progress.js','./run-save.js','./run-choice.js','./skins.js','./skin-render.js','./photo-renderer.js','./wardrobe.js','./wardrobe-showroom.js','./appearances.js','./big-eye.js','./star-trails.js','./particle-appearance.js','./star-particles.js','./skin-unlock.js','./skin-unlock.css','./audio.js','./music-player.js','./offline.js','./display.js','./vendor/phaser.min.js','./fonts/qiuqiule-ui.woff2']);
// Update these fingerprints when replacing a track; only identical cached audio may cross releases.
const MUSIC_DIGESTS = new Map([
  [new URL('./audio/boss.mp3',ROOT).href,'5d4e0fd3de4b403f764a8d64dc205bdbb7a59f841071e99b7ffd4338e0dc525d'],
  [new URL('./audio/endless.mp3',ROOT).href,'f06e05ee22385561fb0bb72359f46a0c10919f15e95c209e9b349fc7a9abbce1'],
]);
const MUSIC = [...MUSIC_DIGESTS.keys()];
// Immutable audio is shared across releases; the release cache holds only code
// and small assets. Content keys keep a changed mix from reusing stale bytes.
const MUSIC_CACHE = CACHE_PREFIX+'music-v1';
const MUSIC_KEYS = new Map([...MUSIC_DIGESTS].map(([url,digest])=>[url,url+'?sha256='+digest]));
async function validMusic(response,url){
  if(!response||response.status!==200||response.redirected||response.headers.has('content-range'))return false;
  const bytes=await response.clone().arrayBuffer();
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const hex=Array.from(hash,byte=>byte.toString(16).padStart(2,'0')).join('');
  return hex===MUSIC_DIGESTS.get(url);
}
const EXTRA = [...urls(['./manifest.webmanifest','./icon.svg','./icons/icon-192.png','./icons/icon-512.png']),...MUSIC];
const downloads = new Map();
let warming = null;
let musicClaimed = false;
// Bound music fetch/validation below the page's 20s deadline, including MP3 body/hash work.
// One budget covers both attempts so a failed connection cannot double it.
const MUSIC_FETCH_TIMEOUT_MS = 15000;

async function checkedFetch(url) {
  const controller=MUSIC_DIGESTS.has(url)?new AbortController():null;
  const timeoutError=controller?new Error('Music download timed out'):null;
  const options={cache:'reload',credentials:'same-origin',redirect:'error'};
  if(controller)options.signal=controller.signal;
  let timer;
  const deadline=controller?new Promise((_,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(timeoutError);},MUSIC_FETCH_TIMEOUT_MS);
  }):null;
  const work=(async()=>{
    let lastError;
    for(let attempt=0;attempt<2;attempt++){
      if(controller?.signal.aborted)throw timeoutError;
      try{
        const response=await fetch(url,options);
        if(controller?.signal.aborted)throw timeoutError;
        if(!response.ok||response.redirected)throw new Error('Resource unavailable');
        if(MUSIC_DIGESTS.has(url)&&!(await validMusic(response,url)))throw new Error('Incomplete or changed music response');
        const type=response.headers.get('content-type')||'',path=new URL(url).pathname;
        // Never cache an authentication page as a script or game shell.
        if(path.endsWith('.js')&&!/javascript/i.test(type))throw new Error('Wrong script response');
        if(path.endsWith('.css')&&!/text\/css/i.test(type))throw new Error('Wrong stylesheet response');
        if(url===ROOT||path.endsWith('/index.html')){
          if(!/text\/html/i.test(type)||!(await response.clone().text()).includes('id="game"'))throw new Error('Wrong game response');
        }else if(/text\/html/i.test(type))throw new Error('Unexpected sign-in page');
        if(controller?.signal.aborted)throw timeoutError;
        return response;
      }catch(error){
        if(controller?.signal.aborted)throw timeoutError;
        lastError=error;
      }
    }
    throw lastError;
  })();
  // Core installation keeps its existing behavior on slow connections.
  if(!deadline)return work;
  // Some network/body readers fail to settle on abort. The race still releases
  // downloads so a later request can retry; late work never reaches cache.put.
  try{return await Promise.race([work,deadline]);}finally{clearTimeout(timer);}
}
async function cachedAsset(cache,url){
  const key=MUSIC_KEYS.get(url)||url;
  if(MUSIC_KEYS.has(url))cache=await caches.open(MUSIC_CACHE);
  const cached=await cache.match(key);
  if(cached)return cached;
  if(!downloads.has(url)){
    const work=(async()=>{
      // A full shared cache can reject migration without making the surviving
      // legacy copy unusable offline. Playback may read it without another copy.
      const response=MUSIC_KEYS.has(url)?await legacyMusic(url)||await checkedFetch(url):await checkedFetch(url);
      // Playback can still use a network response if the device lacks cache space.
      try{await cache.put(key,response.clone());}catch{}
      return response;
    })().finally(()=>downloads.delete(url));
    downloads.set(url,work);
  }
  return (await downloads.get(url)).clone();
}

async function legacyMusic(url,oldNames){
  const names=oldNames||(await caches.keys()).filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE&&key!==MUSIC_CACHE);
  for(let i=names.length-1;i>=0;i--){
    const previous=await caches.open(names[i]),response=await previous.match(url);
    if(await validMusic(response,url))return response;
  }
  return null;
}
async function reuseMusic(oldNames){
  const cache=await caches.open(MUSIC_CACHE);
  await Promise.allSettled(MUSIC.map(async url=>{
    const key=MUSIC_KEYS.get(url);
    if(await cache.match(key))return;
    const response=await legacyMusic(url,oldNames);
    if(response)await cache.put(key,response);
  }));
}
async function removeLegacyMusic(oldNames){
  const shared=await caches.open(MUSIC_CACHE);
  // A failed migration/quota write leaves the old offline copy intact. This
  // runs after clients.claim, so open old game pages already use this worker.
  for(const url of MUSIC){
    if(!(await shared.match(MUSIC_KEYS.get(url))))continue;
    for(const name of oldNames){
      const previous=await caches.open(name);
      await previous.delete(url);
    }
  }
}
async function pruneSharedMusic(){
  const shared=await caches.open(MUSIC_CACHE),current=new Set(MUSIC_KEYS.values());
  const stale=(await shared.keys()).filter(request=>!current.has(request.url)&&new URL(request.url).searchParams.has('sha256'));
  if(!stale.length)return;
  // A replacement must be complete and verified before retiring any older mix.
  // Failed/quota-limited warmups retain those offline bytes for a later retry.
  for(const url of MUSIC)if(!(await validMusic(await shared.match(MUSIC_KEYS.get(url)),url)))return;
  // An active worker can restart without another activate event. Confirm the
  // client handoff again before a later warmup performs deferred cleanup.
  if(!musicClaimed){await self.clients.claim();musicClaimed=true;}
  await Promise.all(stale.map(request=>shared.delete(request)));
}
async function status(){
  const cache=await caches.open(CACHE);
  const stored=new Set((await cache.keys()).map(request=>request.url));
  const music=await caches.open(MUSIC_CACHE);
  const shared=new Set((await music.keys()).map(request=>request.url));
  const present=url=>MUSIC_KEYS.has(url)?shared.has(MUSIC_KEYS.get(url)):stored.has(url);
  return {type:'CACHE_READY',version:CACHE,ready:CORE.every(present),musicReady:MUSIC.every(present),extrasReady:EXTRA.every(present),cached:CORE.filter(present).length,total:CORE.length};
}
async function broadcast(data){
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of clients)client.postMessage(data);
}
async function warmExtras(){
  if(warming)return warming;
  warming=(async()=>{
    const cache=await caches.open(CACHE);
    await Promise.allSettled(EXTRA.map(url=>cachedAsset(cache,url)));
    await pruneSharedMusic().catch(()=>{});
    await broadcast(await status());
  })().finally(()=>{warming=null;});
  return warming;
}
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);let completed=0;
    const results=await Promise.allSettled(CORE.map(async url=>{
      await cache.put(url,await checkedFetch(url));completed++;
      await broadcast({type:'CACHE_PROGRESS',cached:completed,total:CORE.length});
    }));
    if(results.some(result=>result.status==='rejected')){
      await caches.delete(CACHE);
      await broadcast({type:'CACHE_FAILED'});
      throw new Error('Core cache incomplete');
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const old=(await caches.keys()).filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE&&key!==MUSIC_CACHE);
    if(old.length)await reuseMusic(old);
    await self.clients.claim();
    musicClaimed=true;
    await removeLegacyMusic(old);
    await pruneSharedMusic();
    // Keep one prior core generation. If migration lacked space, also retain
    // any older generation that still holds the only offline music copy.
    const shared=await caches.open(MUSIC_CACHE);
    for(const name of old.slice(0,-1)){
      const previous=await caches.open(name);let needed=false;
      for(const url of MUSIC)if(!(await shared.match(MUSIC_KEYS.get(url)))&&await previous.match(url)){needed=true;break;}
      if(!needed)await caches.delete(name);
    }
    await broadcast(await status());
  })());
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  const homePaths=[new URL(ROOT).pathname,new URL('index.html',ROOT).pathname];
  if(event.request.mode==='navigate'&&homePaths.includes(url.pathname)){
    event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(ROOT))||fetch(event.request)));
  }else if(CORE.includes(url.href)||EXTRA.includes(url.href)){
    event.respondWith(caches.open(CACHE).then(cache=>cachedAsset(cache,url.href)));
  }
  // Hosted sign-in, callback and sign-out navigations remain network-owned.
});
self.addEventListener('message',event=>{
  if(event.data?.type==='CHECK_CACHE')event.waitUntil((async()=>{
    const data=await status();if(event.ports[0])event.ports[0].postMessage(data);else event.source?.postMessage(data);
  })());
  if(event.data?.type==='WARM_CACHE')event.waitUntil(warmExtras());
});
