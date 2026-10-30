// Background-only cache preparation. The v1.4.0 game UI is unchanged.
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
if('serviceWorker' in navigator){
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
