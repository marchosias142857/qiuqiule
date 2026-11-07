import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../dist/physics.js';
import {createEndlessRun, captureEndlessRun, restoreEndlessRun} from '../dist/endless-progress.js';
import {RUN_SAVE_KEY, createRunSnapshot, restoreRunSnapshot, createRunSaveStore} from '../dist/run-save.js';

function fresh({seed=2030, initial=true}={}) {
  const runDay=createEndlessRun('2026-11-06',seed);
  return {runDay,world:new World(390,844,runDay.random,{spawnInitial:initial})};
}
const roundTrip=state=>restoreRunSnapshot(JSON.stringify(createRunSnapshot(state)));
function assertSame(first,second) {
  assert.deepEqual(createRunSnapshot(first),createRunSnapshot(second));
}
function tick(state,frames=120) {
  for(let i=0;i<frames;i++){
    if(i%50===0&&state.world.ready){state.world.beginPull();state.world.shoot(70,-100);}
    state.world.step(1/120,false,{timeScale:1});
  }
}
function memoryStorage() {
  const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}
function field(raw,key) {
  return raw.data.nodes.find(node=>node.t==='world').v.find(pair=>pair[0]===key);
}

test('run RNG capture resumes the next number without consuming or reseeding the stream',()=>{
  const run=createEndlessRun('2026-11-06',0xffffffff);
  for(let i=0;i<981;i++)run.random();
  const raw=captureEndlessRun(run),copy=restoreEndlessRun(JSON.parse(JSON.stringify(raw)));
  assert.equal(copy.key,run.key);assert.equal(copy.seed,run.seed);assert.ok(Object.isFrozen(copy));
  assert.equal(copy.random.getState(),run.random.getState());
  assert.deepEqual(Array.from({length:500},()=>copy.random()),Array.from({length:500},()=>run.random()));
  for(const bad of [{...raw,state:-1},{...raw,seed:NaN},{...raw,key:'2026-02-30'},{...raw,state:4294967296}])assert.throws(()=>restoreEndlessRun(bad));
});

test('snapshot restores every World field with live methods without constructing another world',()=>{
  const original=fresh();tick(original,240);
  original.world.events.push({type:'pending-event',nested:{optional:undefined,negativeZero:-0}});
  const before=original.runDay.random.getState(),copy=roundTrip(original);
  assert.ok(copy.world instanceof World);assert.notEqual(copy.world,original.world);
  assert.equal(original.runDay.random.getState(),before);assert.equal(copy.runDay.random.getState(),before);
  assert.equal(copy.world.random,copy.runDay.random);assertSame(original,copy);
  tick(original,360);tick(copy,360);assertSame(original,copy);
});

test('active shot aliases, Sets, Maps, cycles and scene body references survive JSON',()=>{
  const original=fresh();original.world.beginPull();original.world.shoot(90,-120);
  const shot=original.world.activeShot;
  assert.equal(original.world.shotHistory.at(-1),shot);
  original.world.seenEnemyKills.add('split');
  original.extra={body:original.world.player,world:original.world,shot,
    trails:new Map([[original.world.player,{points:[{x:1,y:2}],remaining:Infinity}]]),flags:new Set(['a','b'])};
  original.extra.self=original.extra;
  const copy=roundTrip(original);
  assert.equal(copy.world.activeShot,copy.world.shotHistory.at(-1));
  assert.equal(copy.extra.shot,copy.world.activeShot);assert.equal(copy.extra.body,copy.world.player);
  assert.equal(copy.extra.world,copy.world);assert.equal(copy.extra.self,copy.extra);
  assert.equal(copy.extra.trails.get(copy.world.player).remaining,Infinity);
  assert.deepEqual([...copy.extra.flags],['a','b']);assert.deepEqual([...copy.world.seenEnemyKills],['split']);
  assert.equal(copy.world.player.hp,Infinity);assertSame(original,copy);
});

test('starting upgrade transition and all subsequent choices restore their exact offers and timers',()=>{
  const original=fresh({initial:false});original.world.beginStartingUpgrades();original.world.step(.37);
  assert.equal(original.world.phase,'transition');
  let copy=roundTrip(original);assertSame(original,copy);
  assert.equal(copy.world.spawnTimer,Infinity);assert.equal(copy.world.floorTimer,Infinity);assert.equal(copy.world.introTimer,Infinity);
  for(let i=0;i<400&&original.world.phase==='transition';i++){original.world.step(1/120);copy.world.step(1/120);}
  assert.equal(original.world.phase,'choose');assertSame(original,copy);
  copy=roundTrip(original);assertSame(original,copy);
  original.world.choose(original.world.choices[0]);copy.world.choose(copy.world.choices[0]);assert.equal(original.world.phase,'reward');assertSame(original,copy);
  const rewarded=roundTrip(original);original.world.step(.2);rewarded.world.step(.2);assertSame(original,rewarded);
});

test('pending mother children, family pressure, wave plans and in-flight buffs retain future behavior',()=>{
  const original=fresh();const w=original.world;
  w.stage=w.maxStage=26;w.buffs={split:1,boomerang:1,bank:1,frenzy:2,breath:1};
  w.wave=w.makePlannedCluster(5);w.wave.timer=-.03;
  w.floorCluster=w.makePlannedCluster(3);w.floorCluster.index=1;
  w.fragmentQueue.push({x:w.player.x,y:w.player.y,maxHp:124,density:1.1,splitFamilyId:95,clusterId:96,distanceUnits:2,angle:.8});
  w.beginPull();w.shoot(40,-100);w.spawnAuxiliaries();w.auxiliaries[0].pendingVx=17;w.auxiliaries[0].feedbackFreeze=.03;
  w.seenEnemyKills.add('heavy');w.breathTime=.7;w.pulseCooldown=-4.2;w.stepSerial=87;
  const copy=roundTrip(original);assertSame(original,copy);
  assert.equal(copy.world.pressureCount,w.pressureCount);
  tick(original,160);tick(copy,160);assertSame(original,copy);
});

test('a clearing sweep resumes at its saved radius without re-counting kills or losing pending events',()=>{
  const original=fresh();const w=original.world;
  w.beginClearing();w.step(.03);const copy=roundTrip(original);
  assert.equal(copy.world.phase,'clearing');assert.deepEqual(copy.world.clearing,w.clearing);assertSame(original,copy);
  tick(original,240);tick(copy,240);assertSame(original,copy);
});

test('Boss entry, active contacts and celebration preserve Infinity and phase-specific timing',()=>{
  const original=fresh();const w=original.world;w.stage=w.maxStage=5;w.beginBoss();w.step(.2);
  let copy=roundTrip(original);assert.equal(copy.world.boss.mass,Infinity);assert.equal(copy.world.boss.hp,Infinity);
  assertSame(original,copy);w.step(.7);copy.world.step(.7);assert.equal(w.phase,'boss');assertSame(original,copy);
  w.boss.contacts.add(w.player.id);w.boss.scoredSegments=2;w.boss.stunnedTime=.4;
  copy=roundTrip(original);assert.ok(copy.world.boss.contacts instanceof Set);assertSame(original,copy);
  w.boss.stunned=true;w.boss.hp=.1;w.boss.r=w.boss.minRadius;
  w.defeatBoss();assert.equal(w.phase,'boss-celebrate');w.step(.08);
  copy=roundTrip(original);assertSame(original,copy);
  tick(original,600);tick(copy,600);assertSame(original,copy);
});

test('draw preparation never changes source ownership or data and rejects untracked RNG and transient menus',()=>{
  const original=fresh();const snapshot=createRunSnapshot(original);
  const before=JSON.stringify(snapshot);const copy=restoreRunSnapshot(snapshot);
  copy.world.player.x+=20;copy.world.seenEnemyKills.add('test');
  assert.equal(JSON.stringify(snapshot),before);assert.notEqual(original.world.player.x,copy.world.player.x);
  original.world.random=Math.random;assert.throws(()=>createRunSnapshot(original));
  original.world.random=original.runDay.random;original.world.isRunChoice=true;assert.throws(()=>createRunSnapshot(original));
  delete original.world.isRunChoice;original.world.phase='over';assert.throws(()=>createRunSnapshot(original));
});

test('bad version, truncated references, invalid geometry and prototype keys cannot become a live world',()=>{
  const baseline=createRunSnapshot(fresh());
  const malformed=[null,undefined,'{broken',{},[],{...baseline,version:99}];
  const mutate=fn=>{const raw=structuredClone(baseline);fn(raw);malformed.push(raw);};
  mutate(raw=>field(raw,'score')[1]={n:'+'});
  mutate(raw=>field(raw,'width')[1]=0);
  mutate(raw=>field(raw,'phase')[1]='over');
  mutate(raw=>raw.data.nodes.find(node=>node.t==='world').v.push(['step',42]));
  mutate(raw=>raw.data.nodes[0].v.push(['__proto__',{r:0}]));
  mutate(raw=>raw.data.root={r:999999});
  mutate(raw=>raw.data.nodes.pop());
  mutate(raw=>raw.data.nodes.find(node=>node.t==='world').v=raw.data.nodes.find(node=>node.t==='world').v.filter(([key])=>key!=='enemies'));
  for(const name of ['shotHistory','events','choices','fragmentQueue'])mutate(raw=>raw.data.nodes[field(raw,name)[1].r].v.push(null));
  for(const raw of malformed)assert.equal(restoreRunSnapshot(raw),null);
  assert.equal({}.polluted,undefined);
  const original=fresh();original.extra={bad:NaN};assert.throws(()=>createRunSnapshot(original));
  original.extra={callback(){}};assert.throws(()=>createRunSnapshot(original));
  original.extra={date:new Date()};assert.throws(()=>createRunSnapshot(original));
});

test('persistent slot is atomic, survives a fresh reader and consumes only when removal succeeds',()=>{
  const storage=memoryStorage(),store=createRunSaveStore(storage),snapshot=createRunSnapshot(fresh());
  assert.equal(store.read(),null);assert.equal(store.write(snapshot),true);
  assert.deepEqual(createRunSaveStore(storage).read(),snapshot);
  assert.equal(store.write({bad:true}),false);assert.deepEqual(store.read(),snapshot);
  const previous=storage.values.get(RUN_SAVE_KEY);storage.setItem=()=>{throw Error('quota');};
  assert.equal(store.write(createRunSnapshot(fresh({seed:90}))),false);assert.equal(storage.values.get(RUN_SAVE_KEY),previous);
  storage.removeItem=()=>{throw Error('blocked');};assert.equal(store.remove(),false);assert.deepEqual(store.read(),snapshot);
  storage.removeItem=key=>storage.values.delete(key);assert.equal(store.remove(),true);assert.equal(store.read(),null);
});

test('unsupported, corrupt or unavailable storage stays safe without deleting its previous bytes',()=>{
  const storage=memoryStorage();storage.values.set(RUN_SAVE_KEY,'not a snapshot');
  assert.equal(createRunSaveStore(storage).read(),null);assert.equal(storage.values.get(RUN_SAVE_KEY),'not a snapshot');
  const blocked={getItem(){throw Error('denied');},setItem(){throw Error('denied');},removeItem(){throw Error('denied');}};
  const snapshot=createRunSnapshot(fresh());
  for(const input of [undefined,null,{},blocked]){
    const store=createRunSaveStore(input);assert.equal(store.read(),null);assert.equal(store.write(snapshot),false);assert.equal(store.remove(),false);
  }
});

test('forced ending writes an unrestorable marker when deletion fails but replacement succeeds',()=>{
  const storage=memoryStorage(),store=createRunSaveStore(storage),snapshot=createRunSnapshot(fresh());
  assert.equal(store.write(snapshot),true);
  storage.removeItem=()=>{throw Error('delete unavailable');};
  assert.equal(store.invalidate(),true);assert.equal(store.read(),null);
  const marker=storage.values.get(RUN_SAVE_KEY);
  assert.equal(JSON.parse(marker).format,'qiuqiule-run-ended');
  assert.equal(restoreRunSnapshot(marker),null);assert.equal(restoreRunSnapshot(JSON.parse(marker)),null);
  assert.equal(store.write(JSON.parse(marker)),false);
  assert.equal(store.write(snapshot),true);assert.deepEqual(store.read(),snapshot);
});

test('forced ending reports failure and preserves existing bytes when both storage writes fail',()=>{
  const storage=memoryStorage(),store=createRunSaveStore(storage),snapshot=createRunSnapshot(fresh());
  assert.equal(store.write(snapshot),true);const before=storage.values.get(RUN_SAVE_KEY);
  storage.removeItem=()=>{throw Error('delete unavailable');};storage.setItem=()=>{throw Error('write unavailable');};
  assert.equal(store.invalidate(),false);assert.equal(storage.values.get(RUN_SAVE_KEY),before);assert.deepEqual(store.read(),snapshot);
  for(const input of [undefined,null,{}])assert.equal(createRunSaveStore(input).invalidate(),false);
});

test('forced ending uses normal removal when available',()=>{
  const storage=memoryStorage(),store=createRunSaveStore(storage);assert.equal(store.write(createRunSnapshot(fresh())),true);
  storage.setItem=()=>{throw Error('must not write a marker after successful deletion');};
  assert.equal(store.invalidate(),true);assert.equal(store.read(),null);assert.equal(storage.values.has(RUN_SAVE_KEY),false);
});
