import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Run the real entry module with DOM/audio boundaries stubbed; Phaser never boots.
const elements=new Map(),listeners=new Map();
function element(selector){
  if(elements.has(selector))return elements.get(selector);
  const classes=new Set();
  const e={hidden:false,inert:false,children:[],dataset:{},style:{setProperty(){},removeProperty(){}},
    classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){on?classes.add(x):classes.delete(x);}},
    setAttribute(){},addEventListener(){},replaceChildren(...children){this.children=children;}};
  elements.set(selector,e);return e;
}
globalThis.window={innerWidth:390,innerHeight:844,devicePixelRatio:2,addEventListener(){}};
globalThis.matchMedia=()=>({matches:false});
globalThis.document={readyState:'loading',hidden:false,hasFocus:()=>true,documentElement:element('html'),
  querySelector:element,
  querySelectorAll:selector=>selector==='.menu-panel'?['#settings-panel','#help-panel','#menu-transition-panel'].map(element):[],
  addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);}};
if(!globalThis.navigator)globalThis.navigator={};

const entry=new URL('../dist/game.js',import.meta.url);
const source=(await readFile(entry,'utf8')).replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${new URL(path,entry).href}'`);
// This adapter only exposes state to the test; it is not part of the shipped game.
const adapter=`
export function seedRestart(origin){
  world=new World(viewport.width,viewport.height);
  Object.assign(world,{stage:16,time:180,score:7650,target:9000,density:3,energy:4,breathTime:1,bank:2,pullStartSpeed:5});
  world.buffs={growth:2,energy:4,density:3,breath:1};world.player.r*=1.4;
  world.enemies.forEach(b=>{b.born=1;b.solid=true;});world.phase=origin==='over'?'over':'battle';
  scene={g:{clear(){this.cleared=true;}},effects:[{type:'old-particle'}],accumulator:.004,clock:180,hitSoundAt:179};
  screen='play';modal=origin;paused=true;result=origin==='over'?{clock:12}:null;
  uiAnchor=origin;releaseOverlay=1;pauseOnArrival=true;drag={dx:50,dy:20};transfer=null;controlFlight=null;
  $('#control-transfers').children=[{}];$('#ui-ball').hidden=false;$('#result-shadow').hidden=false;
  $('.result-actions').classList.add('arriving');$('#choice-labels').innerHTML='old reward';
  return world;
}
export function readRestart(){return {world,scene,screen,modal,paused,result,transfer,controlFlight,uiAnchor,releaseOverlay,pauseOnArrival,drag};}
`;
const app=await import('data:text/javascript;base64,'+Buffer.from(source+adapter).toString('base64'));

for(const origin of ['over','pause'])test(`${origin} restart discards old run and starts with invisible, non-solid newborn enemies`,()=>{
  const previous=app.seedRestart(origin);
  // Use the registered click handler, including its input/transition guards.
  for(const fn of listeners.get('click'))fn({target:{closest:()=>({dataset:{action:'restart'}})},detail:1});
  const s=app.readRestart(),w=s.world;
  assert.notEqual(w,previous);assert.equal(previous.pullStartSpeed,null);
  assert.equal(w.stage,1);assert.equal(w.score,0);assert.equal(w.target,140);assert.equal(w.time,0);
  assert.equal(w.spawnTimer,.45);assert.equal(w.breathTime,0);assert.equal(w.bank,0);assert.equal(w.pullStartSpeed,null);
  assert.deepEqual(w.buffs,{});assert.deepEqual(w.choices,[]);assert.equal(w.density,1);assert.equal(w.energy,1);
  assert.equal(w.player.r,w.unit);assert.equal(w.player.vx,0);assert.equal(w.player.vy,0);
  assert.equal(w.enemies.length,2);assert.ok(w.enemies.every(b=>b.born===0&&!b.solid));
  for(const key of ['modal','result','transfer','controlFlight','uiAnchor','drag'])assert.equal(s[key],null,key);
  assert.equal(s.screen,'play');assert.equal(s.paused,false);assert.equal(s.pauseOnArrival,false);assert.equal(s.releaseOverlay,0);
  assert.equal(s.scene.g.cleared,true);assert.deepEqual(s.scene.effects,[]);
  assert.equal(s.scene.accumulator,0);assert.equal(s.scene.clock,0);assert.equal(s.scene.hitSoundAt,0);
  assert.equal(element('#control-transfers').children.length,0);
  assert.equal(element('#ui-ball').hidden,true);assert.equal(element('#result-shadow').hidden,true);
  assert.equal(element('.result-actions').classList.contains('arriving'),false);
  assert.equal(element('#modal-layer').hidden,true);assert.equal(element('#hud').hidden,false);
  assert.equal(element('#score').textContent,'0000');assert.equal(element('#choice-labels').innerHTML,'');
});
