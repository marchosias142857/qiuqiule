import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=(await readFile(new URL('../dist/offline.js',import.meta.url),'utf8'))
  .replaceAll('import.meta.url',JSON.stringify('https://localhost/offline.js'));
async function boot({native=false,scope='https://localhost/',reject=false,worker=true}={}){
  const calls=[],listeners=[];
  const serviceWorker={
    async getRegistration(url){calls.push(['lookup',url]);if(reject)throw Error('unavailable');return {scope,async unregister(){calls.push(['unregister']);}};},
    async register(url,options){calls.push(['register',url,options]);return {active:{postMessage(message){calls.push(['message',message.type]);}},addEventListener(){}};},
    addEventListener(type){listeners.push(type);}
  };
  const window={isSecureContext:true,addEventListener(type){listeners.push(type);},...(native?{Capacitor:{isNativePlatform:()=>true}}:{})};
  const document={readyState:'complete',addEventListener(type){listeners.push(type);}};
  vm.runInNewContext(source,{window,document,navigator:{onLine:true,...(worker?{serviceWorker}:{})},URL,setTimeout,clearTimeout});
  await new Promise(resolve=>setImmediate(resolve));
  return {calls,listeners};
}
test('native startup retires only its previous worker and performs no second asset/music warm-up',async()=>{
  const result=await boot({native:true});
  assert.deepEqual(result.calls,[['lookup','https://localhost/'],['unregister']]);
  assert.deepEqual(result.listeners,[]);
});
test('native worker cleanup tolerates absent support, lookup errors and other scopes',async()=>{
  assert.deepEqual((await boot({native:true,worker:false})).calls,[]);
  for(const options of [{reject:true},{scope:'https://localhost/other/'}]){
    const result=await boot({native:true,...options});
    assert.deepEqual(result.calls,[['lookup','https://localhost/']]);
  }
});
test('web/PWA still registers and warms the normal offline cache',async()=>{
  const result=await boot();
  assert.equal(result.calls[0][0],'register');
  assert.equal(result.calls[0][1],'./sw.js');
  assert.equal(result.calls[0][2].updateViaCache,'none');
  assert.deepEqual(result.calls.slice(1),[['message','CHECK_CACHE'],['message','WARM_CACHE']]);
  assert.ok(result.listeners.includes('online'));
  assert.ok(result.listeners.includes('visibilitychange'));
});
