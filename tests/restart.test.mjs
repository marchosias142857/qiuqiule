import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Run the real entry module and scene with DOM/audio/Phaser boundaries stubbed.
const elements=new Map(),listeners=new Map(),saved=new Map();
function element(selector){
  if(elements.has(selector))return elements.get(selector);
  const classes=new Set();
  const e={hidden:false,inert:false,children:[],dataset:{},style:{setProperty(){},removeProperty(){}},
    classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){on?classes.add(x):classes.delete(x);}},
    attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},addEventListener(){},focus(){},replaceChildren(...children){this.children=children;},
    querySelector:child=>element(selector+' '+child),
    getBoundingClientRect(){
      const [x,y,width,height]=selector==='#over-ball'?[96,320,72,72]:selector==='#pause-ball'?[110,200,64,64]:[0,0,390,844];
      return {x,y,width,height,top:y,bottom:y+height,left:x,right:x+width};
    }};
  elements.set(selector,e);return e;
}
globalThis.window={innerWidth:390,innerHeight:844,devicePixelRatio:2,addEventListener(){}};
globalThis.localStorage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)};
globalThis.Phaser={AUTO:0,Scale:{NONE:0},Scene:class{constructor(){this.cameras={main:{setBackgroundColor(){}}};}},Game:class{constructor(config){this.scene=new config.scene();}}};
window.Phaser=globalThis.Phaser;
globalThis.matchMedia=()=>({matches:false});
globalThis.requestAnimationFrame=fn=>fn();
globalThis.document={readyState:'loading',hidden:false,hasFocus:()=>true,documentElement:element('html'),
  querySelector:element,
  querySelectorAll:selector=>selector==='.menu-panel'?['#settings-panel','#help-panel','#menu-transition-panel'].map(element):[],
  addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);}};
if(!globalThis.navigator)globalThis.navigator={};

const entry=new URL('../dist/game.js',import.meta.url);
const source=(await readFile(entry,'utf8')).replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${new URL(path,entry).href}'`);
// This adapter only exposes state to the test; it is not part of the shipped game.
const adapter=`
export function seedRestart(origin,mode='endless',level=1){
  selectedMode=mode;currentLevel=level;selector=null;trackPointer=null;
  world=mode==='campaign'?new CampaignWorld(viewport.width,viewport.height,level):new World(viewport.width,viewport.height);
  if(mode==='campaign'){world.kills=12;world.spawned=20;world.completed=origin==='over';campaignProgress={completed:level,unlocked:Math.min(100,level+1)};}
  Object.assign(world,{stage:16,time:180,score:7650,target:9000,density:3,energy:4,breathTime:1,bank:2,pullStartSpeed:5});
  world.buffs={growth:2,energy:4,density:3,breath:1};world.player.r*=1.4;
  world.enemies.forEach(b=>{b.born=1;b.solid=true;});world.phase=origin==='over'?'over':'battle';
  scene={g:{clear(){this.cleared=true;}},effects:[{type:'old-particle'}],accumulator:.004,clock:180,hitSoundAt:179};
  screen='play';modal=origin;paused=true;result=origin==='over'?{clock:12,bounceTime:.57}:null;
  uiAnchor=origin;releaseOverlay=1;pauseOnArrival=true;drag={dx:50,dy:20};transfer=null;controlFlight=null;
  $('#control-transfers').children=[{}];$('#ui-ball').hidden=false;$('#result-shadow').hidden=false;
  $('.result-actions').classList.add('arriving');$('#choice-labels').innerHTML='old reward';
  return world;
}
export const advanceUi=updateUiBall;
export const sourcePose=currentPlayerPose;
export function readRestart(){return {world,scene,screen,modal,paused,result,transfer,controlFlight,uiAnchor,releaseOverlay,pauseOnArrival,drag,selectedMode,currentLevel,campaignProgress,selector};}
export function seedRenderer(graphics,width=390,height=844,arena=false){
  selectedMode='endless';selector=null;trackPointer=null;menuTransition=null;
  viewport=displayMetrics(width,height,1);home=new HomeWorld(width,height,'endless');
  world=arena?new World(width,height):null;screen=arena?'play':'home';
  modal=null;paused=false;transfer=null;controlFlight=null;uiAnchor=null;result=null;drag=null;releaseOverlay=0;pauseOnArrival=false;homeReveal=1;
  settings.expressions=false;boot();scene=game.scene;scene.g=graphics;
  return {home,world,scene};
}
export function seedLevelRenderer(graphics,width=390,height=844){
  seedRenderer(graphics,width,height);selectedMode='campaign';
  selector=new LevelSelector(width,height,100);screen='levels';levelsReveal=1;
  return {selector,scene};
}
export function enterFromHome(){
  home.launchToPlay();while(home.phase==='flight')home.step(1/120);
  screen='entering';home.phaseTime=1.4;home.player.lookX=.1;home.player.lookY=-.08;
}
export const bindCanvas=bindInput;
export const readHome=()=>home;
export const expressionEnabled=()=>settings.expressions;
`;
const app=await import('data:text/javascript;base64,'+Buffer.from(source+adapter).toString('base64'));

function clickRestart(){
  for(const fn of listeners.get('click'))fn({target:{closest:()=>({dataset:{action:'restart'}})},detail:1});
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
for(const origin of ['over','pause'])test(`${origin} restart animates only the player while a fresh world waits`,()=>{
  const previous=app.seedRestart(origin),from=app.sourcePose();
  clickRestart();
  let s=app.readRestart();const w=s.world;
  assert.notEqual(w,previous);assert.equal(previous.pullStartSpeed,null);
  assert.equal(w.stage,1);assert.equal(w.score,0);assert.equal(w.target,140);assert.equal(w.time,0);
  assert.equal(w.spawnTimer,.45);assert.equal(w.breathTime,0);assert.equal(w.bank,0);assert.equal(w.pullStartSpeed,null);
  assert.deepEqual(w.buffs,{});assert.deepEqual(w.choices,[]);assert.equal(w.density,1);assert.equal(w.energy,1);
  assert.equal(w.player.r,w.unit);assert.equal(w.player.vx,0);assert.equal(w.player.vy,0);
  assert.equal(w.enemies.length,2);assert.ok(w.enemies.every(b=>b.born===0&&!b.solid));
  for(const key of ['modal','result','controlFlight','uiAnchor','drag'])assert.equal(s[key],null,key);
  assert.equal(s.screen,'play');assert.equal(s.paused,true);assert.equal(s.pauseOnArrival,false);assert.equal(s.releaseOverlay,0);
  assert.equal(s.scene.g.cleared,true);assert.deepEqual(s.scene.effects,[]);
  assert.equal(s.scene.accumulator,0);assert.equal(s.scene.clock,0);assert.equal(s.scene.hitSoundAt,0);
  assert.equal(element('#control-transfers').children.length,0);
  assert.equal(element('#ui-ball').hidden,false);assert.equal(element('#result-shadow').hidden,true);
  assert.equal(element('.result-actions').classList.contains('arriving'),false);
  assert.equal(element('#modal-layer').hidden,true);assert.equal(element('#hud').hidden,false);assert.equal(element('#hud').inert,true);
  assert.equal(element('#score').textContent,'0000');assert.equal(element('#choice-labels').innerHTML,'');
  assert.deepEqual(s.transfer.from,from);assert.equal(s.transfer.target,'arena');assert.equal(s.transfer.duration,.65);
  const startTransform=element('#ui-ball').style.transform;
  clickRestart();assert.equal(app.readRestart().world,w);
  app.advanceUi(.325);s=app.readRestart();
  assert.equal(s.paused,true);assert.equal(w.time,0);assert.equal(w.spawnTimer,.45);
  assert.ok(w.enemies.every(b=>b.born===0&&!b.solid));
  assert.notEqual(element('#ui-ball').style.transform,startTransform);
  const diameter=parseFloat(element('#ui-ball').style.width);
  assert.ok(diameter>2*w.unit&&diameter<2*from.r);
  app.advanceUi(.325);s=app.readRestart();
  assert.equal(s.transfer,null);assert.equal(s.controlFlight,null);assert.equal(s.paused,false);
  assert.equal(element('#hud').inert,false);assert.equal(w.time,0);assert.equal(w.spawnTimer,.45);
  near(parseFloat(element('#ui-ball').style.width),2*w.player.r);
  assert.ok(element('#ui-ball').style.transform.startsWith(`translate3d(${w.player.x-w.player.r}px,${w.player.y-w.player.r}px,0)`));
  assert.ok(w.enemies.every(b=>b.born===0&&!b.solid));
  app.advanceUi(1/120);assert.equal(element('#ui-ball').hidden,true);
  w.step(1/120);assert.ok(w.enemies.every(b=>b.born>0&&b.born<1&&!b.solid));
});

test('backgrounding during restart keeps the fresh world paused after arrival',()=>{
  app.seedRestart('over');clickRestart();document.hidden=true;
  try{
    app.advanceUi(.65);const s=app.readRestart();
    assert.equal(s.paused,true);assert.equal(s.modal,'pause');assert.equal(s.world.time,0);
    assert.equal(s.world.spawnTimer,.45);assert.ok(s.world.enemies.every(b=>b.born===0&&!b.solid));
    assert.equal(s.transfer.target,'pause');assert.equal(s.controlFlight,null);
  }finally{document.hidden=false;}
});

function graphicsRecorder(){
  let points=[],color,alpha;
  const g={shapes:[],clear(){this.shapes=[];},fillStyle(c,a=1){color=c;alpha=a;},beginPath(){points=[];},
    moveTo(x,y){points.push({x,y});},lineTo(x,y){points.push({x,y});},
    fillPath(){this.shapes.push({type:'path',color,alpha,points:[...points]});},
    fillEllipse(x,y,width,height){this.shapes.push({type:'ellipse',color,alpha,x,y,width,height});}};
  return new Proxy(g,{get:(target,key)=>key in target?target[key]:()=>{}});
}
const bodyShapes=g=>g.shapes.filter(s=>s.type==='path'&&s.color===0x252720&&s.alpha===1);
const eyeShapes=g=>g.shapes.filter(s=>s.color===0xf4f3eb&&s.alpha===.9);
function clickAction(action){for(const fn of listeners.get('click'))fn({target:{closest:()=>({dataset:{action}})},detail:1});}
function inputCanvas(width=390,height=844){
  const handlers=new Map();
  const canvas={addEventListener:(type,fn)=>handlers.set(type,fn),setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture(){},
    getBoundingClientRect:()=>({left:0,top:0,width,height})};
  app.bindCanvas(canvas);
  return (type,x=0,y=0)=>handlers.get(type)({pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y,timeStamp:0,preventDefault(){}});
}

test('home arrival paints the arena player on the handoff frame without advancing spawns',()=>{
  for(const [w,h] of [[390,844],[844,390],[1363,936]]){
    const g=graphicsRecorder(),{scene}=app.seedRenderer(g,w,h);
    app.enterFromHome();scene.update(0,10);
    assert.equal(app.readRestart().screen,'entering');assert.equal(bodyShapes(g).length,1);
    scene.update(0,50);
    const s=app.readRestart(),p=s.world.player,body=bodyShapes(g);
    assert.equal(s.screen,'play');assert.equal(body.length,1,'arrival must never leave an empty canvas frame');
    near(Math.min(...body[0].points.map(v=>v.x)),p.x-p.r);
    near(Math.max(...body[0].points.map(v=>v.x)),p.x+p.r);
    assert.equal(eyeShapes(g).length,2);assert.ok(p.lookX>0&&p.lookY<0,'preserve the gaze across the handoff');
    assert.equal(s.world.time,0);assert.equal(s.world.spawnTimer,.45);
    assert.ok(s.world.enemies.every(b=>b.born===0&&!b.solid));
    scene.update(0,1000/120);assert.equal(bodyShapes(g).length,1);
    assert.ok(s.world.enemies.every(b=>b.born>0&&b.born<1&&!b.solid));
  }
});

test('optional eyes persist through every home rebound frame and reset only at rest',()=>{
  const g=graphicsRecorder(),{home,scene}=app.seedRenderer(g),pointer=inputCanvas();
  pointer('pointerdown');pointer('pointermove',100,0);scene.update(0,1);
  assert.ok(eyeShapes(g).every(e=>e.type==='ellipse'),'disabled by default');
  clickAction('expressions');assert.equal(app.expressionEnabled(),true);
  assert.equal(element('#expressions-toggle').attributes['aria-checked'],'true');
  assert.equal(JSON.parse(saved.get('qiuqiule-settings')).expressions,true);
  scene.update(0,1);assert.equal(eyeShapes(g).length,2);assert.ok(eyeShapes(g).every(e=>e.type==='path'));
  pointer('pointerup',100,0);assert.equal(home.phase,'wobble');
  scene.update(0,0);assert.ok(eyeShapes(g).every(e=>e.type==='path'),'keep expression at the first zero crossing');
  for(let i=0;i<100;i++){
    scene.update(0,1000/120);
    assert.equal(eyeShapes(g).length,2);
    assert.ok(eyeShapes(g).every(e=>e.type===(home.phase==='wobble'?'path':'ellipse')));
  }
  assert.equal(home.phase,'idle');
  clickAction('expressions');assert.equal(JSON.parse(saved.get('qiuqiule-settings')).expressions,false);
});

test('successful home launches and arena shots restore normal eyes on release or cancellation',()=>{
  for(const arena of [false,true])for(const release of ['pointerup','pointercancel','lostpointercapture']){
    const g=graphicsRecorder(),{scene}=app.seedRenderer(g,390,844,arena),pointer=inputCanvas();
    clickAction('expressions');pointer('pointerdown');pointer('pointermove',0,-150);scene.update(0,1);
    assert.equal(eyeShapes(g).length,2);assert.ok(eyeShapes(g).every(e=>e.type==='path'));
    pointer(release,0,-150);scene.update(0,0);
    if(!arena&&release==='pointerup')assert.equal(app.readHome().phase,'flight');
    assert.equal(eyeShapes(g).length,2);assert.ok(eyeShapes(g).every(e=>e.type==='ellipse'));
  }
});

test('expression preference survives reloading the entry module',async()=>{
  saved.set('qiuqiule-settings',JSON.stringify({expressions:true}));
  const reloaded=await import('data:text/javascript;base64,'+Buffer.from(source+adapter+'\n// reload preference').toString('base64'));
  assert.equal(reloaded.expressionEnabled(),true);
  assert.equal(element('#expressions-toggle').attributes['aria-checked'],'true');
});


for(const origin of ['over','pause'])test(`campaign ${origin} restart preserves level and unlocks while resetting the attempt`,()=>{
  const previous=app.seedRestart(origin,'campaign',23),from=app.sourcePose();
  const unlockedBefore={...app.readRestart().campaignProgress};
  clickRestart();
  let state=app.readRestart();const w=state.world;
  assert.notEqual(w,previous);assert.equal(previous.pullStartSpeed,null);
  assert.equal(state.selectedMode,'campaign');assert.equal(state.currentLevel,23);
  assert.equal(w.mode,'campaign');assert.equal(w.level,23);
  assert.equal(w.kills,0);assert.equal(w.spawned,2);assert.equal(w.completed,false);
  assert.equal(w.time,0);assert.equal(w.score,0);assert.equal(w.stage,1);
  assert.equal(w.totalEnemies,w.config.totalEnemies);assert.equal(w.spawnTimer,w.config.spawnInterval);
  assert.equal(w.energy,w.config.playerEnergy);assert.equal(w.density,1);assert.equal(w.upgrades,0);
  assert.equal(w.player.r,w.unit);assert.equal(w.player.vx,0);assert.equal(w.player.vy,0);
  assert.deepEqual(w.buffs,{});assert.deepEqual(w.choices,[]);
  assert.deepEqual(state.campaignProgress,unlockedBefore,'retries retain permanent progress');
  assert.equal(state.controlFlight,null);assert.equal(state.paused,true);
  assert.deepEqual(state.transfer.from,from);assert.equal(state.transfer.target,'arena');
  assert.equal(element('#control-transfers').children.length,0);
  assert.equal(element('#hud').classList.contains('campaign'),true);
  assert.ok(w.enemies.every(b=>b.born===0&&!b.solid));
  const startTransform=element('#ui-ball').style.transform;
  app.advanceUi(.325);
  assert.notEqual(element('#ui-ball').style.transform,startTransform);
  assert.equal(w.time,0);assert.equal(w.spawnTimer,w.config.spawnInterval);
  assert.ok(w.enemies.every(b=>b.born===0&&!b.solid));
  app.advanceUi(.325);state=app.readRestart();
  assert.equal(state.paused,false);assert.equal(state.transfer,null);assert.equal(state.controlFlight,null);
  assert.equal(w.time,0);assert.ok(w.enemies.every(b=>b.born===0&&!b.solid));
  w.step(1/120);assert.ok(w.enemies.every(b=>b.born>0&&b.born<1&&!b.solid));
});

test('selection miss stays at its anchor and uses the same uninterrupted rebound expression as home',()=>{
  const g=graphicsRecorder(),{selector,scene}=app.seedLevelRenderer(g),pointer=inputCanvas();
  const p=selector.player,anchor={x:p.x,y:p.y};
  const b=selector.visibleBalls[0],d=Math.hypot(b.x-p.x,b.y-p.y);
  const end={x:p.x+(p.x-b.x)/d*7,y:p.y+(p.y-b.y)/d*7};
  clickAction('expressions');
  pointer('pointerdown',p.x,p.y);pointer('pointermove',end.x,end.y);scene.update(0,1);
  assert.equal(eyeShapes(g).length,2);assert.ok(eyeShapes(g).every(e=>e.type==='path'));
  pointer('pointerup',end.x,end.y);
  assert.equal(selector.phase,'wobble');
  scene.update(0,0);assert.equal(eyeShapes(g).length,2);
  assert.ok(eyeShapes(g).every(e=>e.type==='path'),'expression persists at initial zero displacement');
  for(let i=0;i<110;i++){
    scene.update(0,1000/120);
    near(p.x,anchor.x);near(p.y,anchor.y);
    assert.equal(app.readRestart().screen,'levels');
    assert.equal(eyeShapes(g).length,2);
    assert.ok(eyeShapes(g).every(e=>e.type===(selector.phase==='wobble'?'path':'ellipse')));
  }
  assert.equal(selector.phase,'idle');assert.equal(selector.action,null);
});

test('selection requires a body-start drag and restores normal eyes on a successful release or cancellation',()=>{
  for(const release of ['pointerup','pointercancel','lostpointercapture']){
    const g=graphicsRecorder(),{selector,scene}=app.seedLevelRenderer(g),pointer=inputCanvas();
    const p=selector.player,anchor={x:p.x,y:p.y};
    clickAction('expressions');
    pointer('pointerdown',25,100);pointer('pointermove',25,200);pointer('pointerup',25,200);scene.update(0,0);
    assert.equal(selector.phase,'idle');near(p.x,anchor.x);near(p.y,anchor.y);
    assert.equal(app.readRestart().drag,null,'blank space cannot start selection aiming');
    const b=selector.visibleBalls[0],d=Math.hypot(b.x-p.x,b.y-p.y);
    const end={x:p.x+(p.x-b.x)/d*selector.maxPull,y:p.y+(p.y-b.y)/d*selector.maxPull};
    pointer('pointerdown',p.x,p.y);pointer('pointermove',end.x,end.y);scene.update(0,1);
    assert.equal(eyeShapes(g).length,2);assert.ok(eyeShapes(g).every(e=>e.type==='path'));
    pointer(release,end.x,end.y);scene.update(0,0);
    assert.equal(selector.phase,release==='pointerup'?'flight':'idle');
    assert.equal(eyeShapes(g).length,2);assert.ok(eyeShapes(g).every(e=>e.type==='ellipse'));
    if(release!=='pointerup'){near(p.x,anchor.x);near(p.y,anchor.y);}
  }
});
