import test from 'node:test';
import assert from 'node:assert/strict';
import {cropSourceRect,loadAppearance,saveAppearance} from '../dist/wardrobe.js';
import {HomeWorld,homeLayout} from '../dist/home.js';
import {iconGeometry} from '../dist/icons.js';

test('image crops retain the maximum square and cannot expose empty edges',()=>{
  assert.deepEqual(cropSourceRect(1200,800),{x:200,y:0,side:800});
  assert.deepEqual(cropSourceRect(800,1200),{x:0,y:200,side:800});
  assert.deepEqual(cropSourceRect(900,900),{x:0,y:0,side:900});
  for(const [width,height] of [[1200,800],[800,1200],[900,900]]){
    for(const zoom of [.1,1,2,4,9])for(const panX of [-20,0,20])for(const panY of [-20,0,20]){
      const crop=cropSourceRect(width,height,zoom,panX,panY);
      assert.ok(crop.x>=0&&crop.y>=0&&crop.x+crop.side<=width&&crop.y+crop.side<=height);
      assert.ok(crop.side>=Math.min(width,height)/4&&crop.side<=Math.min(width,height));
    }
  }
});
test('wardrobe is the largest of the three home controls and remains directly reachable',()=>{
  for(const [width,height] of [[320,568],[390,844],[844,390],[1363,936],[768,1024]]){
    const layout=homeLayout(width,height),[settings,wardrobe,sound]=layout.others;
    assert.equal(layout.others.length,3);
    assert.ok(wardrobe.r>settings.r&&settings.r>sound.r);
    const world=new HomeWorld(width,height);world.launchTo('wardrobe');
    assert.ok(world.targets.every(target=>target.id!=='mode'));
    assert.equal(world.target.id,'wardrobe',`${width}x${height}: wardrobe route is blocked`);
    for(let i=0;i<300&&world.phase==='flight';i++)world.step(1/120);
    assert.equal(world.action,'wardrobe');assert.equal(world.phase,'external');
  }
});
test('hanger geometry is rounded and contained in its control ball',()=>{
  const geometry=iconGeometry('wardrobe');assert.ok(geometry.strokes.length>=2);
  for(const point of geometry.strokes.flat())assert.ok(Math.hypot(...point)<.75);
  assert.ok(geometry.strokes.some(points=>points.length>60));
});

function appearanceStorage(t,{image=null,fallback=null,failWrites=false,failFallback=false,failReads=false}={}){
  const key='qiuqiule-appearance',local=new Map();if(fallback!==null)local.set(key,fallback);
  const state={image,failWrites,reads:0};
  const previous=Object.fromEntries(['indexedDB','localStorage'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  t.after(()=>{for(const [name,descriptor] of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:name=>local.get(name)??null,
    setItem(name,value){if(failFallback)throw new Error('Storage full');local.set(name,value);},
    removeItem:name=>local.delete(name)
  }});
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open(){
    const request={result:{close(){},transaction(){
      const tx={error:new Error('IndexedDB write failed'),objectStore(){return {
        get(){
          state.reads++;const result={result:state.image,error:failReads?new Error('IndexedDB read failed'):null};
          queueMicrotask(()=>{if(failReads)result.onerror();else result.onsuccess();tx.oncomplete?.();});return result;
        },
        put(value){queueMicrotask(()=>{if(state.failWrites)tx.onerror();else{state.image=value;tx.oncomplete();}});},
        delete(){queueMicrotask(()=>{if(state.failWrites)tx.onerror();else{state.image=null;tx.oncomplete();}});}
      };}};return tx;
    }}};
    queueMicrotask(()=>request.onsuccess());return request;
  }}});
  return {state,local,key};
}
const oldImage='data:image/png;base64,b2xk',newImage='data:image/png;base64,bmV3';

test('a successfully saved fallback image wins over an older IndexedDB image after reload',async t=>{
  const {state}=appearanceStorage(t,{image:oldImage,failWrites:true});
  await saveAppearance(newImage);
  assert.equal(state.image,oldImage);
  assert.equal(await loadAppearance(),newImage);
  assert.equal(state.reads,0);
});
test('deleting with IndexedDB unavailable leaves a tombstone so the old image cannot return',async t=>{
  const {state,local,key}=appearanceStorage(t,{image:oldImage,failWrites:true});
  await saveAppearance(null);
  assert.equal(state.image,oldImage);assert.notEqual(local.get(key),undefined);
  assert.equal(await loadAppearance(),null);
  state.failWrites=false;
  assert.equal(await loadAppearance(),null,'A recovered database must still respect the deletion');
  await saveAppearance(newImage);
  assert.equal(local.has(key),false,'A successful IndexedDB save clears the fallback');
  assert.equal(await loadAppearance(),newImage);
});
test('legacy raw data URL fallbacks remain readable and migrate on the next successful write',async t=>{
  const {local,key}=appearanceStorage(t,{image:oldImage,fallback:newImage});
  assert.equal(await loadAppearance(),newImage);
  await saveAppearance(null);
  assert.equal(local.has(key),false);assert.equal(await loadAppearance(),null);
});
test('failed database and fallback writes report failure without claiming the old image was removed',async t=>{
  appearanceStorage(t,{image:oldImage,failWrites:true,failFallback:true});
  await assert.rejects(saveAppearance(null),/图片未能保存/);
  assert.equal(await loadAppearance(),oldImage);
});

test('startup strict reads distinguish a storage failure from an absent saved image',async t=>{
  appearanceStorage(t,{image:oldImage,failReads:true});
  await assert.rejects(loadAppearance({strict:true}),/IndexedDB read failed/);
  assert.equal(await loadAppearance(),null,'ordinary callers retain the existing best-effort read contract');
});

test('startup strict reads still accept a genuinely absent image and an authoritative fallback',async t=>{
  const {local,key}=appearanceStorage(t);
  assert.equal(await loadAppearance({strict:true}),null);
  local.set(key,JSON.stringify({version:1,image:oldImage}));
  assert.equal(await loadAppearance({strict:true}),oldImage);
  local.set(key,JSON.stringify({version:1,image:null}));
  assert.equal(await loadAppearance({strict:true}),null);
});
