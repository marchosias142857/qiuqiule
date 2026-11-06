const ROOT = new URL('./',self.location).href;
const CACHE_PREFIX = 'qiuqiule-'+encodeURIComponent(new URL(ROOT).pathname)+'-';
const CACHE = CACHE_PREFIX+'v8.1.1';
const urls = files => files.map(path => new URL(path,ROOT).href);
const CORE = urls(['./','./index.html','./style.css','./game.js','./feedback.js','./border-bulge.js','./aim.js','./aim-metrics.js','./comet-trail.js','./rhythm-feedback.js','./enemies.js','./enemy-render.js','./upgrades.js','./upgrade-render.js','./physics.js','./campaign.js','./campaign-aim.js','./campaign-offer.js','./classes/wall-levels.js','./classes/pool-levels.js','./classes/merge-levels.js','./classes/golf-levels.js','./classes/peggle-levels.js','./campaign-layout.js','./campaign-collision.js','./campaign-progress.js','./campaign-render.js','./classes/legacy.js','./classes/wall.js','./classes/peggle.js','./classes/pool.js','./classes/golf.js','./classes/bowling.js','./classes/pinball.js','./classes/bricks.js','./classes/glass.js','./classes/merge.js','./classes/chain.js','./levels.js','./level-orbs.js','./home.js','./icons.js','./motion.js','./boss-visuals.js','./endless-progress.js','./skins.js','./skin-render.js','./photo-renderer.js','./wardrobe.js','./appearances.js','./big-eye.js','./companions.js','./skin-unlock.js','./skin-unlock.css','./audio.js','./music-player.js','./offline.js','./display.js','./vendor/phaser.min.js','./fonts/qiuqiule-ui.woff2']);
// Update these fingerprints when replacing a track; only identical cached audio may cross releases.
const MUSIC_DIGESTS = new Map([
  [new URL('./audio/endless.mp3',ROOT).href,'f06e05ee22385561fb0bb72359f46a0c10919f15e95c209e9b349fc7a9abbce1'],
  [new URL('./audio/campaign.mp3',ROOT).href,'ecefee7b7748aca146c9ed1903a8a92c306b47f45f4177b857a67c66b91bb3ac'],
]);
const MUSIC = [...MUSIC_DIGESTS.keys()];
const EXTRA = [...urls(['./manifest.webmanifest','./icon.svg','./icons/icon-192.png','./icons/icon-512.png']),...MUSIC];
const downloads = new Map();
let warming = null;

async function checkedFetch(url) {
  let lastError;
  for(let attempt=0;attempt<2;attempt++){
    try{
      const response=await fetch(url,{cache:'reload',credentials:'same-origin',redirect:'error'});
      if(!response.ok||response.redirected)throw new Error('Resource unavailable');
      if(MUSIC.includes(url)&&(response.status!==200||response.headers.has('content-range')||response.headers.get('content-length')==='0'))throw new Error('Incomplete music response');
      const type=response.headers.get('content-type')||'',path=new URL(url).pathname;
      // Never cache an authentication page as a script or game shell.
      if(path.endsWith('.js')&&!/javascript/i.test(type))throw new Error('Wrong script response');
      if(path.endsWith('.css')&&!/text\/css/i.test(type))throw new Error('Wrong stylesheet response');
      if(url===ROOT||path.endsWith('/index.html')){
        if(!/text\/html/i.test(type)||!(await response.clone().text()).includes('id="game"'))throw new Error('Wrong game response');
      }else if(/text\/html/i.test(type))throw new Error('Unexpected sign-in page');
      return response;
    }catch(error){lastError=error;}
  }
  throw lastError;
}
async function cachedAsset(cache,url){
  const cached=await cache.match(url);
  if(cached)return cached;
  if(!downloads.has(url)){
    const work=checkedFetch(url).then(async response=>{
      // Playback can still use a network response if the device lacks cache space.
      try{await cache.put(url,response.clone());}catch{}
      return response;
    }).finally(()=>downloads.delete(url));
    downloads.set(url,work);
  }
  return (await downloads.get(url)).clone();
}

async function reuseMusic(cache,oldNames){
  // The previous worker retains up to two generations. Migrate local bytes before cleanup.
  const prior=await Promise.all(oldNames.slice(-2).reverse().map(name=>caches.open(name)));
  await Promise.allSettled(MUSIC.map(async url=>{
    if(await cache.match(url))return;
    for(const previous of prior){
      const response=await previous.match(url);
      if(!response||response.status!==200||response.redirected||response.headers.has('content-range'))continue;
      const bytes=await response.clone().arrayBuffer();
      const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
      const hex=Array.from(hash,byte=>byte.toString(16).padStart(2,'0')).join('');
      if(hex!==MUSIC_DIGESTS.get(url))continue;
      await cache.put(url,response);
      return;
    }
  }));
}
async function status(){
  const cache=await caches.open(CACHE);
  const stored=new Set((await cache.keys()).map(request=>request.url));
  const present=url=>stored.has(url);
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
    const old=(await caches.keys()).filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE);
    if(old.length)await reuseMusic(await caches.open(CACHE),old);
    // Failed updates never remove the working game; keep one previous generation.
    await Promise.all(old.slice(0,-1).map(key=>caches.delete(key)));
    await self.clients.claim();
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
