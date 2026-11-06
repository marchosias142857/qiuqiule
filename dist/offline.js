// APKs already contain every asset. Leave their startup I/O to the game/music;
// only web/PWA installs need a second offline copy and music warm-cache work.
const nativeApp=window.Capacitor?.isNativePlatform?.()===true;
let registration,starting=false,retryTimer;
function retryLater(){
  clearTimeout(retryTimer);
  if(navigator.onLine)retryTimer=setTimeout(()=>start(true),30000);
}
function check(warm=false){
  const worker=navigator.serviceWorker.controller||registration?.active;
  if(!worker)return;
  worker.postMessage({type:'CHECK_CACHE'});
  if(warm&&navigator.onLine)worker.postMessage({type:'WARM_CACHE'});
}
function watch(worker){
  worker?.addEventListener('statechange',()=>{
    if(worker.state==='activated')check(true);
    if(worker.state==='redundant')retryLater();
  });
}
async function start(force=false){
  if(starting||!window.isSecureContext||!('serviceWorker' in navigator))return;
  starting=true;
  try{
    registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
    registration.addEventListener('updatefound',()=>watch(registration.installing));
    watch(registration.installing);check(true);
    if(force&&navigator.onLine)await registration.update();
  }catch{retryLater();}finally{starting=false;}
}
if(nativeApp&&'serviceWorker' in navigator){
  // Retire a registration left by an older APK, without reloading a live game
  // or touching settings/scores. Existing clients detach on their next launch.
  const scope=new URL('./',import.meta.url).href;
  navigator.serviceWorker.getRegistration(scope).then(previous=>{
    if(previous?.scope===scope)return previous.unregister();
  }).catch(()=>{});
}else if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('message',event=>{
    if(event.data?.type==='CACHE_FAILED')retryLater();
    if(event.data?.type==='CACHE_READY'){
      if(event.data.ready&&event.data.extrasReady)clearTimeout(retryTimer);else retryLater();
    }
  });
  navigator.serviceWorker.addEventListener('controllerchange',()=>check(true));
  window.addEventListener('online',()=>start(true));
  window.addEventListener('pageshow',()=>check(true));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)check(true);});
  if(document.readyState==='complete')start();else window.addEventListener('load',()=>start(),{once:true});
}
