const ROOT = new URL('./',self.location).href;
const CACHE_PREFIX = 'qiuqiule-'+encodeURIComponent(new URL(ROOT).pathname)+'-';
const CACHE = CACHE_PREFIX+'v2.2.5-github-offline-1';
const urls = files => files.map(path => new URL(path,ROOT).href);
const CORE = urls(['./','./index.html','./style.css','./game.js','./physics.js','./home.js','./icons.js','./motion.js','./audio.js','./offline.js','./display.js','./vendor/phaser.min.js']);
const EXTRA = urls(['./fonts/fredoka-latin-500-normal.woff2','./manifest.webmanifest','./icon.svg','./icons/icon-192.png','./icons/icon-512.png','./audio/light-bounce.mp3']);
const MUSIC = new URL('./audio/light-bounce.mp3',ROOT).href;
let warming = null;

async function checkedFetch(url) {
  let lastError;
  for(let attempt=0;attempt<2;attempt++){
    try{
      const response=await fetch(url,{cache:'reload',credentials:'same-origin',redirect:'error'});
      if(!response.ok||response.redirected)throw new Error('Resource unavailable');
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
async function status(){
  const cache=await caches.open(CACHE);
  const core=await Promise.all(CORE.map(url=>cache.match(url)));
  const extras=await Promise.all(EXTRA.map(url=>cache.match(url)));
  return {type:'CACHE_READY',version:CACHE,ready:core.every(Boolean),musicReady:!!(await cache.match(MUSIC)),extrasReady:extras.every(Boolean),cached:core.filter(Boolean).length,total:CORE.length};
}
async function broadcast(data){
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of clients)client.postMessage(data);
}
async function warmExtras(){
  if(warming)return warming;
  warming=(async()=>{
    const cache=await caches.open(CACHE);
    await Promise.allSettled(EXTRA.map(async url=>{
      if(await cache.match(url))return;
      await cache.put(url,await checkedFetch(url));
      await broadcast(await status());
    }));
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
    event.respondWith(caches.open(CACHE).then(async cache=>{
      const cached=await cache.match(url.href);if(cached)return cached;
      const response=await checkedFetch(url.href);await cache.put(url.href,response.clone());return response;
    }));
  }
  // Hosted sign-in, callback and sign-out navigations remain network-owned.
});
self.addEventListener('message',event=>{
  if(event.data?.type==='CHECK_CACHE')event.waitUntil((async()=>{
    const data=await status();if(event.ports[0])event.ports[0].postMessage(data);else event.source?.postMessage(data);
  })());
  if(event.data?.type==='WARM_CACHE')event.waitUntil(warmExtras());
});
