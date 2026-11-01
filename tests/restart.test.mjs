import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CampaignWorld} from '../dist/campaign.js';

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
  selectedMode=mode;currentLevel=level;selector=null;trackPointer=null;levelPointer=null;
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
export function readRestart(){return {world,scene,screen,modal,paused,result,transfer,controlFlight,uiAnchor,releaseOverlay,pauseOnArrival,drag,selectedMode,currentLevel,campaignProgress,selector,levelPointer};}
export function seedRenderer(graphics,width=390,height=844,arena=false){
  selectedMode='endless';selector=null;trackPointer=null;levelPointer=null;menuTransition=null;
  viewport=displayMetrics(width,height,1);home=new HomeWorld(width,height,'endless');
  world=arena?new World(width,height):null;screen=arena?'play':'home';
  modal=null;paused=false;transfer=null;controlFlight=null;uiAnchor=null;result=null;drag=null;releaseOverlay=0;pauseOnArrival=false;homeReveal=1;
  settings.expressions=false;boot();scene=game.scene;scene.g=graphics;
  return {home,world,scene};
}
export function seedLevelRenderer(graphics,width=390,height=844,unlocked=100){
  seedRenderer(graphics,width,height);selectedMode='campaign';
  campaignProgress={completed:unlocked-1,unlocked};currentLevel=1;
  selector=new LevelSelector(width,height,unlocked);screen='levels';levelsReveal=1;
  return {selector,scene};
}
export function seedCampaignRenderer(graphics,width=390,height=844,level=23){
  seedRenderer(graphics,width,height,true);selectedMode='campaign';currentLevel=level;
  world=new CampaignWorld(width,height,level);
  return {world,scene};
}
export function enterFromHome(){
  home.launchToPlay();while(home.phase==='flight')home.step(1/120);
  screen='entering';home.phaseTime=1.4;home.player.lookX=.1;home.player.lookY=-.08;
}
export const bindCanvas=bindInput;
export const readHome=()=>home;
export const expressionEnabled=()=>settings.expressions;
export function recordTones(){
  const calls=[],original=sound.tone;sound.tone=(...args)=>calls.push(args);
  return {calls,restore(){sound.tone=original;}};
}
export function openUnlockedSelection(unlocked,current=1){
  campaignProgress={completed:unlocked-1,unlocked};currentLevel=current;
  openLevels({...home.player});
  return selector;
}
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
  return (type,x=0,y=0,options={})=>handlers.get(type)({pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y,timeStamp:0,preventDefault(){},...options});
}

test('entering selection focuses the highest unlocked level even after replaying an earlier level',()=>{
  for(const [width,height] of [[390,844],[844,390],[1363,936]]){
    app.seedRenderer(graphicsRecorder(),width,height);
    const selector=app.openUnlockedSelection(50,2),l=selector.layout;
    const balls=selector.visibleBalls.filter(b=>b.fullyVisible);
    const highest=balls.find(b=>b.level===50);
    assert.ok(highest,'highest unlocked level must be visible on entry');
    assert.ok(highest.x<=l.cx+1e-7);
    const distance=b=>Math.hypot(b.x-l.cx,b.y-(l.cy-l.radius));
    assert.ok(balls.every(b=>distance(highest)<=distance(b)+1e-7));
    assert.equal(selector.offset,selector.snapTarget);
  }
});

test('selection removes every drag guide while both battle modes retain their original guides',()=>{
  for(const mode of ['levels','endless','campaign']){
    const g=graphicsRecorder(),strokes=[],dots=[],lines=[],rings=[];
    let width;
    g.lineStyle=w=>{width=w;};g.strokePath=()=>strokes.push(width);
    g.fillCircle=(x,y,r)=>dots.push({x,y,r});
    g.lineBetween=(...points)=>lines.push(points);g.arc=(x,y,r)=>rings.push(r);
    const state=mode==='levels'?app.seedLevelRenderer(g):mode==='campaign'?app.seedCampaignRenderer(g):app.seedRenderer(g,390,844,true);
    const p=mode==='levels'?state.selector.player:state.world.player;
    const pointer=inputCanvas();
    pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+80,p.y+20);
    state.scene.update(0,0);
    assert.equal(dots.filter(d=>d.r===1.7).length,mode==='levels'?0:7);
    assert.equal(strokes.filter(w=>w===1.4).length,mode==='levels'?0:1);
    assert.equal(lines.length,mode==='levels'?0:1,'selection has no pointer-to-drag line');
    assert.equal(rings.filter(r=>r===4||r===8).length,mode==='levels'?0:2,'selection has no endpoint rings');
    pointer('pointercancel');
  }
});

function assertSmoothPulledBody(g,body,pull,maxPull){
  const shapes=bodyShapes(g);
  assert.equal(shapes.length,1,'the actual scene must draw exactly one player outline');
  const points=shapes[0].points;
  assert.equal(points.length,193,'retain the existing 192-segment contour');
  const amount=Math.min(1,Math.hypot(pull.dx,pull.dy)/maxPull);
  const angle=Math.atan2(pull.dy,pull.dx),cos=Math.cos(angle),sin=Math.sin(angle);
  const local=points.map(v=>({
    x:((v.x-body.x)*cos+(v.y-body.y)*sin)/body.r,
    y:(-(v.x-body.x)*sin+(v.y-body.y)*cos)/body.r,
  }));
  near(local[0].x,1+.95*amount);near(local[0].y,0);
  near(local[192].x,local[0].x);near(local[192].y,local[0].y);
  for(let i=48;i<=144;i++){
    near(local[i].x,Math.cos(i/192*Math.PI*2));
    near(local[i].y,Math.sin(i/192*Math.PI*2));
  }
  for(const join of [48,144]){
    const a={x:local[join].x-local[join-1].x,y:local[join].y-local[join-1].y};
    const b={x:local[join+1].x-local[join].x,y:local[join+1].y-local[join].y};
    const turn=Math.atan2(Math.abs(a.x*b.y-a.y*b.x),a.x*b.x+a.y*b.y);
    // A discretised circle already turns 2pi/192 between adjacent edges.
    // Allow a small deformation-dependent difference, but reject the former
    // roughly 8.5-degree extra corner, including at small rebound amplitudes.
    assert.ok(turn<Math.PI*2/192+.01*amount+1e-7,`hemisphere join ${join} has a visible corner: ${turn} rad`);
  }
}

function pullScene(mode,g,width=390,height=844){
  const state=mode==='levels'?app.seedLevelRenderer(g,width,height):
    mode==='campaign'?app.seedCampaignRenderer(g,width,height):
    app.seedRenderer(g,width,height,mode==='endless');
  const active=mode==='levels'?state.selector:mode==='home'?state.home:state.world;
  if(mode==='campaign')assert.ok(active instanceof CampaignWorld,'exercise real campaign rules and renderer');
  return {scene:state.scene,active,player:active.player,pointer:inputCanvas(width,height)};
}

test('real drag input draws smooth hemisphere joins in home, selection, endless and campaign at every direction',()=>{
  for(const mode of ['home','levels','endless','campaign']){
    for(const [width,height] of [[390,844],[844,390]]){
      for(let direction=0;direction<8;direction++)for(const amount of [.3,1]){
        const g=graphicsRecorder(),{scene,active,player,pointer}=pullScene(mode,g,width,height);
        const angle=direction*Math.PI/4,dx=Math.cos(angle)*active.maxPull*amount,dy=Math.sin(angle)*active.maxPull*amount;
        pointer('pointerdown',player.x,player.y);
        pointer('pointermove',player.x+dx,player.y+dy);scene.update(0,0);
        const pull=app.readRestart().drag;assert.ok(pull,'input must reach the real scene drag state');
        assertSmoothPulledBody(g,player,pull,active.maxPull);
        pointer('pointercancel');
      }
    }
  }
});

test('home and selection rebounds preserve smooth joins when the pulled hemisphere reverses direction',()=>{
  // These weak horizontal/vertical shots cannot reach a control. Each real
  // rebound reverses its pull, so the samples cover all four cardinal sides.
  for(const mode of ['home','levels'])for(const direction of [0,6]){
    const g=graphicsRecorder(),{scene,active,player,pointer}=pullScene(mode,g);
    const angle=direction*Math.PI/4,dx=Math.cos(angle)*7,dy=Math.sin(angle)*7;
    pointer('pointerdown',player.x,player.y);
    pointer('pointermove',player.x+dx,player.y+dy);
    pointer('pointerup',player.x+dx,player.y+dy);
    assert.equal(active.phase,'wobble',`${mode} direction ${direction}: a weak release starts the actual rebound`);
    const sides=new Set(),sampleFrames=new Set([5,20,38,62]);
    for(let frame=1;frame<=100;frame++){
      scene.update(0,1000/120);
      if(sampleFrames.has(frame)){
        assert.ok(active.pull);
        sides.add(Math.sign(active.pull.dx*dx+active.pull.dy*dy));
        assertSmoothPulledBody(g,player,active.pull,active.maxPull);
      }
    }
    assert.deepEqual(sides,new Set([-1,1]),'inspect both oscillation directions');
    assert.equal(active.phase,'idle');
  }
});

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

test('optional eyes persist through every home rebound frame and relax after rest',()=>{
  const g=graphicsRecorder(),{home,scene}=app.seedRenderer(g),pointer=inputCanvas();
  pointer('pointerdown');pointer('pointermove',100,0);scene.update(0,1);
  assert.ok(eyeShapes(g).every(e=>e.type==='ellipse'),'disabled by default');
  clickAction('expressions');assert.equal(app.expressionEnabled(),true);
  assert.equal(element('#expressions-toggle').attributes['aria-checked'],'true');
  assert.equal(JSON.parse(saved.get('qiuqiule-settings')).expressions,true);
  scene.update(0,1);assert.equal(eyeShapes(g).length,2);assert.ok(eyeShapes(g).every(e=>e.type==='path'));
  pointer('pointerup',100,0);assert.equal(home.phase,'wobble');
  scene.update(0,0);assert.ok(eyeShapes(g).every(e=>e.type==='path'),'keep expression at the first zero crossing');
  for(let i=0;i<120;i++){
    scene.update(0,1000/120);
    assert.equal(eyeShapes(g).length,2);
    if(home.phase==='wobble')assert.ok(eyeShapes(g).every(e=>e.type==='path'));
  }
  assert.equal(home.phase,'idle');
  assert.ok(eyeShapes(g).every(e=>e.type==='ellipse'),'normal ellipses return after the short relaxation');
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
  for(let i=0;i<120;i++){
    scene.update(0,1000/120);
    near(p.x,anchor.x);near(p.y,anchor.y);
    assert.equal(app.readRestart().screen,'levels');
    assert.equal(eyeShapes(g).length,2);
    if(selector.phase==='wobble')assert.ok(eyeShapes(g).every(e=>e.type==='path'));
  }
  assert.equal(selector.phase,'idle');assert.equal(selector.action,null);
  assert.ok(eyeShapes(g).every(e=>e.type==='ellipse'),'normal ellipses return after the short relaxation');
});

function advanceScene(scene,seconds){
  while(seconds>.05){scene.update(0,50);seconds-=.05;}
  if(seconds>1e-12)scene.update(0,seconds*1000);
}
function outlineBounds(shape){
  if(shape.type==='ellipse')return {cx:shape.x,cy:shape.y,width:shape.width,height:shape.height};
  const xs=shape.points.map(p=>p.x),ys=shape.points.map(p=>p.y);
  const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  return {cx:(x0+x1)/2,cy:(y0+y1)/2,width:x1-x0,height:y1-y0};
}
function centredEye(shape){
  assert.equal(shape.type,'path');const bounds=outlineBounds(shape);
  return shape.points.map(p=>({x:p.x-bounds.cx,y:p.y-bounds.cy}));
}
function renderedHomeSquash(g,player){
  const shape=bodyShapes(g)[0];assert.ok(shape);
  const tip=shape.points[0],angle=player.angle;
  return 1-((tip.x-player.x)*Math.cos(angle)+(tip.y-player.y)*Math.sin(angle))/player.r;
}
function assertBreathingRestarts(g,home,scene){
  near(renderedHomeSquash(g,home.player),0);
  let elapsed=0;
  // Continue beyond the old .16-second transition through a complete positive
  // and negative breathing cycle. The visual phase must never rejoin home.clock.
  for(const time of [.01,.08,.16,.5,Math.PI/(2*1.3),Math.PI/1.3,Math.PI*1.5/1.3,Math.PI*2/1.3]){
    advanceScene(scene,time-elapsed);elapsed=time;
    near(renderedHomeSquash(g,home.player),Math.sin(time*1.3)*.035);
    near(home.player.squash,Math.sin(home.clock*1.3)*.035);
    assert.equal(home.phase,'idle');assert.equal(home.ready,true);
  }
}

test('real rebound handoff keeps its final eye shape, then relaxes without delaying readiness or changing the player',()=>{
  for(const mode of ['home','levels'])for(const expressions of [false,true]){
    const g=graphicsRecorder(),{scene,active,player,pointer}=pullScene(mode,g);
    if(mode==='home')active.clock=Math.PI/(2*1.3)-.82;
    if(expressions)clickAction('expressions');
    const anchor={x:player.x,y:player.y,r:player.r};
    pointer('pointerdown',player.x,player.y);pointer('pointermove',player.x+7,player.y);scene.update(0,0);
    pointer('pointerup',player.x+7,player.y);scene.update(0,0);
    assert.equal(active.phase,'wobble');assert.equal(active.ready,false);
    advanceScene(scene,.819);
    assert.equal(active.phase,'wobble');assert.equal(active.ready,false);
    const beforeEyes=eyeShapes(g),beforeBody=outlineBounds(bodyShapes(g)[0]);
    assert.ok(beforeEyes.every(e=>e.type===(expressions?'path':'ellipse')));
    scene.update(0,1.0000001);
    assert.equal(active.phase,'idle','the original 0.82-second rebound still ends on time');
    assert.equal(active.ready,true,'visual relaxation never delays the next drag');
    near(player.x,anchor.x);near(player.y,anchor.y);near(player.r,anchor.r);
    const firstEyes=eyeShapes(g),firstBody=outlineBounds(bodyShapes(g)[0]);
    assert.ok(Math.abs(firstBody.width-beforeBody.width)<.001);
    assert.ok(Math.abs(firstBody.height-beforeBody.height)<.001);
    if(expressions){
      for(let eye=0;eye<2;eye++){
        const a=centredEye(beforeEyes[eye]),b=centredEye(firstEyes[eye]);
        assert.equal(a.length,b.length);
        a.forEach((p,i)=>{near(p.x,b[i].x);near(p.y,b[i].y);});
      }
    }else assert.ok(firstEyes.every(e=>e.type==='ellipse'));
    near(renderedHomeSquash(g,player),0);
    advanceScene(scene,.06);
    const middleEyes=eyeShapes(g);
    if(expressions){
      assert.ok(middleEyes.every(e=>e.type==='path'));
      const initial=outlineBounds(firstEyes[0]),middle=outlineBounds(middleEyes[0]);
      assert.ok(middle.width<initial.width&&middle.width>player.r*.105*.9,'eyes visibly pass through an intermediate shape');
    }else assert.ok(middleEyes.every(e=>e.type==='ellipse'));
    near(renderedHomeSquash(g,player),Math.sin(.06*1.3)*.035);
    if(mode==='home')near(player.squash,Math.sin(active.clock*1.3)*.035);
    else near(player.squash,0);
    advanceScene(scene,.059);
    const almostNormal=eyeShapes(g).map(outlineBounds);
    advanceScene(scene,.0011);
    const normal=eyeShapes(g);
    assert.ok(normal.every(e=>e.type==='ellipse'),'relaxation ends at the original normal ellipses after 0.12 seconds');
    normal.forEach((eye,i)=>{
      near(eye.width,player.r*.105);near(eye.height,player.r*.19);
      assert.ok(Math.abs(almostNormal[i].width-eye.width)<.001);
      assert.ok(Math.abs(almostNormal[i].height-eye.height)<.001);
    });
    advanceScene(scene,.04);
    near(renderedHomeSquash(g,player),Math.sin(.1601*1.3)*.035);
    near(player.x,anchor.x);near(player.y,anchor.y);near(player.r,anchor.r);
    assert.equal(active.ready,true);
  }
});

test('home breathing restarts a complete independent cycle after cancellation and a functional-ball return',()=>{
  for(const origin of ['cancel','return']){
    const g=graphicsRecorder(),{scene,home}=app.seedRenderer(g),pointer=inputCanvas();
    home.clock=Math.PI/(2*1.3);const anchor={...home.layout.player};
    if(origin==='cancel'){
      pointer('pointerdown',home.player.x,home.player.y);pointer('pointermove',home.player.x+7,home.player.y);scene.update(0,0);
      pointer('pointercancel');scene.update(0,0);
      assert.equal(home.phase,'idle');assert.equal(home.ready,true);
    }else{
      const target=home.targets.find(b=>b.id==='mode'),p=home.player;
      const d=Math.hypot(target.x-p.x,target.y-p.y);
      const dx=(p.x-target.x)/d*home.maxPull,dy=(p.y-target.y)/d*home.maxPull;
      pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+dx,p.y+dy);pointer('pointerup',p.x+dx,p.y+dy);
      assert.equal(home.phase,'flight');
      let frames=0;while(home.phase==='flight'&&frames++<240)scene.update(0,1000/120);
      assert.equal(home.phase,'returning');
      home.clock=Math.PI/(2*1.3);
      advanceScene(scene,.679-home.phaseTime);
      assert.equal(home.phase,'returning');assert.equal(home.ready,false);
      const before=outlineBounds(bodyShapes(g)[0]);
      scene.update(0,1.0000001);
      assert.equal(home.phase,'idle');assert.equal(home.ready,true);
      const after=outlineBounds(bodyShapes(g)[0]);
      assert.ok(Math.abs(after.width-before.width)<.001);assert.ok(Math.abs(after.height-before.height)<.001);
    }
    assertBreathingRestarts(g,home,scene);
    near(home.player.x,anchor.x);near(home.player.y,anchor.y);near(home.player.r,anchor.r);
    assert.equal(home.ready,true);
  }
});

test('different previous home clocks produce the same breathing cycle and a second rebound restarts it again',()=>{
  let reference=null;
  for(const clock of [0,.7,3.4,10.2]){
    const g=graphicsRecorder(),{scene,home}=app.seedRenderer(g),pointer=inputCanvas();
    const player=home.player,anchor={x:player.x,y:player.y,r:player.r};
    home.clock=clock;
    const rebound=()=>{
      pointer('pointerdown',player.x,player.y);pointer('pointermove',player.x+7,player.y);scene.update(0,0);
      pointer('pointerup',player.x+7,player.y);scene.update(0,0);
      assert.equal(home.phase,'wobble');assert.equal(home.ready,false);
      const previousClock=home.clock;
      advanceScene(scene,.819);
      assert.equal(home.phase,'wobble');assert.equal(home.ready,false);
      const simulationSquash=player.squash;
      scene.update(0,1.0000001);
      assert.equal(home.phase,'idle');assert.equal(home.ready,true);
      near(home.clock,previousClock+.8200000001);
      near(player.squash,simulationSquash);
      near(player.x,anchor.x);near(player.y,anchor.y);near(player.r,anchor.r);
      near(renderedHomeSquash(g,player),0);
    };
    rebound();
    const samples=[renderedHomeSquash(g,player)];let elapsed=0;
    for(const time of [.12,.4,1.3,2.7]){
      advanceScene(scene,time-elapsed);elapsed=time;
      const squash=renderedHomeSquash(g,player);samples.push(squash);
      near(squash,Math.sin(time*1.3)*.035);
      near(player.squash,Math.sin(home.clock*1.3)*.035);
    }
    if(reference)samples.forEach((value,i)=>near(value,reference[i]));else reference=samples;
    assert.ok(Math.abs(samples.at(-1))>.005,'start the second rebound from a nonzero visual breathing phase');
    rebound();
    advanceScene(scene,.12);
    near(renderedHomeSquash(g,player),Math.sin(.12*1.3)*.035);
    near(player.squash,Math.sin(home.clock*1.3)*.035);
    near(player.x,anchor.x);near(player.y,anchor.y);near(player.r,anchor.r);
    assert.equal(home.phase,'idle');assert.equal(home.ready,true);
  }
});

test('selection requires a body-start drag and only rebounds on release while cancellation restores normal eyes',()=>{
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
    assert.equal(selector.phase,release==='pointerup'?'wobble':'idle');
    assert.equal(eyeShapes(g).length,2);assert.ok(eyeShapes(g).every(e=>e.type===(release==='pointerup'?'path':'ellipse')));
    near(p.x,anchor.x);near(p.y,anchor.y);
    assert.equal(selector.action,null);assert.equal(app.readRestart().screen,'levels');
  }
});

test('tapping an unlocked ball enters its real campaign through the unchanged player arrival animation',()=>{
  for(const [width,height] of [[390,844],[844,390]]){
    const {selector,scene}=app.seedLevelRenderer(graphicsRecorder(),width,height,50),pointer=inputCanvas(width,height);
    const target=selector.visibleBalls.find(b=>b.level===50),from={...selector.player};
    pointer('pointerdown',target.x,target.y);
    assert.equal(app.readRestart().screen,'levels');assert.equal(selector.action,null,'pressing alone never enters a level');
    pointer('pointerup',target.x,target.y);
    assert.deepEqual(selector.action,{type:'level',level:50});
    scene.update(0,0);
    let state=app.readRestart();const world=state.world;
    assert.ok(world instanceof CampaignWorld);assert.equal(world.level,50);
    assert.equal(state.screen,'play');assert.equal(state.currentLevel,50);assert.equal(state.selectedMode,'campaign');
    assert.equal(state.paused,true);assert.equal(state.transfer.target,'arena');assert.equal(state.transfer.duration,.65);
    assert.deepEqual(state.transfer.from,from);assert.equal(state.drag,null);assert.equal(state.levelPointer,null);
    assert.equal(world.time,0);assert.ok(world.enemies.every(b=>b.born===0&&!b.solid));
    app.advanceUi(.325);
    assert.equal(app.readRestart().paused,true);assert.equal(world.time,0);
    assert.ok(world.enemies.every(b=>b.born===0&&!b.solid));
    app.advanceUi(.325);state=app.readRestart();
    assert.equal(state.transfer,null);assert.equal(state.paused,false);assert.equal(world.time,0);
    assert.deepEqual(state.campaignProgress,{completed:49,unlocked:50});
    world.step(1/120);assert.ok(world.enemies.every(b=>b.born>0&&!b.solid));
  }
});

test('tapping the return ball carries the selector player home, including during a rebound',()=>{
  for(const rebound of [false,true]){
    const {selector,scene}=app.seedLevelRenderer(graphicsRecorder(),390,844,50),pointer=inputCanvas();
    const p=selector.player,target=selector.returnBall;
    if(rebound){
      pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+80,p.y);pointer('pointerup',p.x+80,p.y);
      scene.update(0,100);assert.equal(selector.phase,'wobble');
    }
    const from={...p};
    pointer('pointerdown',target.x,target.y);pointer('pointerup',target.x,target.y);
    assert.deepEqual(selector.action,{type:'home'});scene.update(0,0);
    let state=app.readRestart();
    assert.equal(state.screen,'home');assert.equal(state.world,null);assert.equal(state.levelPointer,null);
    assert.equal(state.transfer.target,'home');assert.equal(state.transfer.duration,.65);
    for(const key of ['x','y','r'])near(state.transfer.from[key],from[key]);
    app.advanceUi(.65);state=app.readRestart();
    assert.equal(state.transfer,null);assert.equal(state.paused,false);assert.equal(app.readHome().ready,true);
  }
});

test('selection taps preserve the visible breathing peak through the first transfer frame and smoothly release it',()=>{
  for(const destination of ['level','home']){
    const g=graphicsRecorder(),{selector,scene}=app.seedLevelRenderer(g,390,844,50),pointer=inputCanvas();
    scene.update(0,0);advanceScene(scene,Math.PI/(2*1.3));
    const p=selector.player,before=outlineBounds(bodyShapes(g)[0]);
    near(renderedHomeSquash(g,p),.035);near(p.squash,0,'breathing remains a render-only state');
    const target=destination==='home'?selector.returnBall:selector.visibleBalls.find(b=>b.level===50);
    pointer('pointerdown',target.x,target.y);pointer('pointerup',target.x,target.y);scene.update(0,0);
    const state=app.readRestart();assert.ok(state.transfer);
    assert.equal(state.transfer.target,destination==='home'?'home':'arena');assert.equal(state.transfer.duration,.65);
    near(state.transfer.from.squash,.035);near(state.transfer.from.visualSquash,.035);
    const uiShape=()=>{
      const ball=element('#ui-ball'),match=/scale\(([^,]+),([^\)]+)\)/.exec(ball.style.transform);
      assert.ok(match);const diameter=parseFloat(ball.style.width);
      return {width:diameter*Number(match[1]),height:diameter*Number(match[2]),squash:1-Number(match[1])};
    };
    const first=uiShape();near(first.width,before.width);near(first.height,before.height);near(first.squash,.035);
    app.advanceUi(0);near(uiShape().squash,.035,'the first animation update must not snap the body round');
    let previous=first.squash,previousCarry=.035;
    for(let frame=1;frame<=650;frame++){
      app.advanceUi(.001);
      const visible=uiShape().squash,progress=frame/650;
      const eased=progress**3*(10-15*progress+6*progress**2);
      const inherited=visible-Math.sin(Math.PI*eased)*.12;
      assert.ok(Math.abs(visible-previous)<.002,'every transfer frame remains continuous');
      assert.ok(inherited>=-1e-9&&inherited<=previousCarry+1e-9,'the inherited breathing shape gently decays');
      if(frame===325){near(visible,.1375);near(inherited,.0175);}
      previous=visible;previousCarry=inherited;
    }
    near(uiShape().squash,0);assert.equal(app.readRestart().transfer,null);
    assert.equal(app.readRestart().screen,destination==='home'?'home':'play');
    near(p.squash,0);
  }
});

test('locked ball taps provide feedback without creating a campaign or leaving selection',()=>{
  const {selector,scene}=app.seedLevelRenderer(graphicsRecorder(),390,844,50),pointer=inputCanvas();
  const locked=selector.visibleBalls.find(b=>b.fullyVisible&&!b.unlocked);
  assert.ok(locked);pointer('pointerdown',locked.x,locked.y);pointer('pointerup',locked.x,locked.y);
  assert.equal(selector.hitTimes.get(locked.level),selector.clock);
  assert.deepEqual(selector.events,[{type:'locked',level:locked.level}]);
  scene.update(0,0);const state=app.readRestart();
  assert.equal(state.screen,'levels');assert.equal(state.world,null);assert.equal(state.transfer,null);
  assert.equal(selector.action,null);assert.equal(selector.phase,'idle');assert.equal(selector.ready,true);
  assert.equal(element('#level-announcement').textContent,'先通过前一关，即可解锁。');
});

test('selection dispatches the intended tap, entry and locked sounds while orbit swipes never play a tap',()=>{
  for(const interaction of ['level','home','locked','swipe']){
    const {selector,scene}=app.seedLevelRenderer(graphicsRecorder(),390,844,50),pointer=inputCanvas();
    const target=interaction==='home'?selector.returnBall:selector.visibleBalls.find(b=>b.level===(interaction==='locked'?51:50));
    const audio=app.recordTones();
    try{
      pointer('pointerdown',target.x,target.y,{timeStamp:100});
      if(interaction==='swipe'){
        const other=selector.visibleBalls.find(b=>b.level===49);
        pointer('pointermove',other.x,other.y,{timeStamp:200});pointer('pointerup',other.x,other.y,{timeStamp:250});
      }else pointer('pointerup',target.x,target.y,{timeStamp:150});
      scene.update(0,0);
      const frequencies=audio.calls.map(args=>args[0]);
      if(interaction==='swipe'){
        assert.ok(frequencies.length>0,'the real orbit movement emits its scrolling feedback');
        assert.ok(!frequencies.includes(680),'scrolling never emits the activation sound');
      }else assert.deepEqual(frequencies,interaction==='level'?[680,420]:interaction==='home'?[680]:[150]);
    }finally{audio.restore();}
  }
});

test('selection taps require one target and at most eight pixels of movement throughout the gesture',()=>{
  for(const gesture of ['exact-eight','over-eight','excursion','different-target','blank-start','cancel','lost-capture','track-swipe']){
    const {selector,scene}=app.seedLevelRenderer(graphicsRecorder(),390,844,50),pointer=inputCanvas();
    const target=selector.visibleBalls.find(b=>b.level===50),other=selector.visibleBalls.find(b=>b.level===49);
    const offset=selector.offset;
    const start=gesture==='blank-start'?{x:target.x,y:target.y+target.r+12}:target;
    pointer('pointerdown',start.x,start.y,{timeStamp:100});
    if(gesture==='excursion'){
      pointer('pointermove',target.x+12,target.y,{timeStamp:150});
      pointer('pointermove',target.x,target.y,{timeStamp:200});
    }
    if(gesture==='track-swipe'){
      pointer('pointermove',other.x,other.y,{timeStamp:200});
      assert.notEqual(selector.offset,offset,'the gesture genuinely scrolls the orbit');
    }
    const end=gesture==='different-target'?other:gesture==='exact-eight'?{x:target.x+8,y:target.y}:
      gesture==='over-eight'?{x:target.x+8.01,y:target.y}:target;
    const release=gesture==='cancel'?'pointercancel':gesture==='lost-capture'?'lostpointercapture':'pointerup';
    pointer(release,end.x,end.y,{timeStamp:250});scene.update(0,0);
    const state=app.readRestart();
    assert.equal(state.levelPointer,null);assert.equal(state.drag,null);
    if(gesture==='exact-eight'){
      assert.equal(state.screen,'play');assert.ok(state.world instanceof CampaignWorld);assert.equal(state.world.level,50);
    }else{
      assert.equal(state.screen,'levels',gesture);assert.equal(state.world,null,gesture);assert.equal(state.transfer,null,gesture);
      assert.equal(selector.action,null,gesture);assert.equal(selector.trackDrag,null,gesture);
      advanceScene(scene,.3);assert.equal(app.readRestart().screen,'levels','inertia or snap never activates a ball');
    }
  }
});

test('every central-ball pull direction and strength rebounds in place without activating a target',()=>{
  for(let direction=0;direction<8;direction++)for(const strength of [7,45,250]){
    const {selector,scene}=app.seedLevelRenderer(graphicsRecorder(),390,844,50),pointer=inputCanvas();
    const p=selector.player,anchor={x:p.x,y:p.y,r:p.r},angle=direction*Math.PI/4;
    const end={x:p.x+Math.cos(angle)*strength,y:p.y+Math.sin(angle)*strength};
    pointer('pointerdown',p.x,p.y);pointer('pointermove',end.x,end.y);pointer('pointerup',end.x,end.y);
    assert.equal(selector.phase,'wobble');assert.equal(selector.ready,false);
    advanceScene(scene,.819);assert.equal(selector.phase,'wobble');
    scene.update(0,1.0000001);assert.equal(selector.phase,'idle');assert.equal(selector.ready,true);
    for(const key of ['x','y','r'])near(p[key],anchor[key]);
    assert.equal(selector.action,null);assert.equal(app.readRestart().screen,'levels');assert.equal(app.readRestart().world,null);
  }
});

function renderedGaze(g,player){
  const eyes=eyeShapes(g);assert.equal(eyes.length,2);assert.ok(eyes.every(e=>e.type==='ellipse'));
  return {x:((eyes[0].x+eyes[1].x)/2-player.x)/player.r,
    y:((eyes[0].y+eyes[1].y)/2-player.y)/player.r+.07};
}

function uiNode(className){
  const node=[...elements].find(([selector])=>selector.startsWith('#ui-ball ')&&selector.endsWith(' '+className))?.[1];
  assert.ok(node,`the rendered UI ball includes ${className}`);return node;
}
function svgPolyline(node){
  const d=node.attributes.d;assert.ok(d,'the visible SVG path must contain its contour');
  assert.ok(!/[ACQSTHV]/i.test(d),'these contours are explicitly sampled polygons');
  const numbers=d.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi).map(Number);
  assert.equal(numbers.length%2,0);
  return Array.from({length:numbers.length/2},(_,i)=>({x:numbers[i*2],y:numbers[i*2+1]}));
}
function uiContours(){
  const ball=element('#ui-ball'),diameter=parseFloat(ball.style.width),r=diameter/2;
  const position=/translate3d\(([^p]+)px,([^p]+)px,0\)/.exec(ball.style.transform);
  const scale=/scale\(([^,]+),([^\)]+)\)/.exec(ball.style.transform);
  assert.ok(position&&scale);
  const sx=Number(scale[1]),sy=Number(scale[2]),center={x:Number(position[1])+r,y:Number(position[2])+r};
  const toScreen=p=>({x:center.x+(p.x-50)*r/50*sx,y:center.y+(p.y-50)*r/50*sy});
  const eyeTransforms=[...uiNode('.ui-eyes').style.transform.matchAll(/([a-z]+)\(([^\)]+)\)/gi)].reverse();
  const transformEye=point=>{
    let x=point.x-50,y=point.y-50;
    for(const [,operation,args] of eyeTransforms){
      const values=args.split(',').map(parseFloat);
      if(operation==='scale'){x*=values[0];y*=values[1]??values[0];}
      else if(operation==='translate'){x+=values[0];y+=values[1]||0;}
      else if(operation==='rotate'){
        const angle=values[0],cos=Math.cos(angle),sin=Math.sin(angle);
        [x,y]=[x*cos-y*sin,x*sin+y*cos];
      }else assert.fail(`unsupported eye transform ${operation}`);
    }
    return toScreen({x:x+50,y:y+50});
  };
  const pull=uiNode('.ui-pull-outline'),eyePaths=uiNode('.ui-eye-paths');
  const body=pull.style.display==='none'
    ?Array.from({length:193},(_,i)=>toScreen({x:50+50*Math.cos(i/192*Math.PI*2),y:50+50*Math.sin(i/192*Math.PI*2)}))
    :svgPolyline(pull).map(toScreen);
  const eyes=eyePaths.style.display==='none'
    ?[41.5,58.5].map(cx=>Array.from({length:384},(_,i)=>transformEye({x:cx+2.625*Math.cos(i/384*Math.PI*2),y:46.5+4.75*Math.sin(i/384*Math.PI*2)})))
    :['.ui-eye-left','.ui-eye-right'].map(className=>svgPolyline(uiNode(className)).map(transformEye));
  return {body,eyes,center,r,eyePathsVisible:eyePaths.style.display!=='none',pullVisible:pull.style.display!=='none'};
}
function normalizedContours(shape){
  const normalize=points=>points.map(p=>({x:(p.x-shape.center.x)/shape.r,y:(p.y-shape.center.y)/shape.r}));
  return {body:normalize(shape.body),eyes:shape.eyes.map(normalize),eyePathsVisible:shape.eyePathsVisible,pullVisible:shape.pullVisible};
}
function assertSameContour(actual,expected,tolerance=1e-5){
  assert.equal(actual.length,expected.length,'retain corresponding contour points');
  for(let i=0;i<actual.length;i++)assert.ok(Math.hypot(actual[i].x-expected[i].x,actual[i].y-expected[i].y)<tolerance,`contour point ${i} changed at the handoff`);
}

test('selection clicks preserve rebound contours and relaxing eyes at the canvas-to-SVG handoff in both destinations',()=>{
  for(const destination of ['level','home'])for(const phase of ['positive','negative','relaxing']){
    const g=graphicsRecorder(),{selector,scene}=app.seedLevelRenderer(g,390,844,50),pointer=inputCanvas();
    const p=selector.player;clickAction('expressions');scene.update(0,0);
    pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+selector.maxPull,p.y);scene.update(0,0);
    pointer('pointerup',p.x+selector.maxPull,p.y);
    if(phase==='relaxing'){
      advanceScene(scene,.819);scene.update(0,1.0000001);advanceScene(scene,.06);
      assert.equal(selector.phase,'idle');
    }else{
      advanceScene(scene,phase==='positive'?.82/4:.82/12);
      assert.equal(selector.phase,'wobble');assert.equal(Math.sign(selector.pull.dx),phase==='positive'?1:-1);
    }
    const body=bodyShapes(g)[0].points,eyes=eyeShapes(g);
    assert.equal(eyes.length,2);assert.ok(eyes.every(e=>e.type==='path'));
    const target=destination==='home'?selector.returnBall:selector.visibleBalls.find(b=>b.level===50);
    pointer('pointerdown',target.x,target.y);pointer('pointerup',target.x,target.y);scene.update(0,0);
    const transfer=app.readRestart().transfer;assert.ok(transfer);assert.equal(transfer.duration,.65);
    if(phase==='relaxing')assert.ok(transfer.from.visualEyeMix>0&&transfer.from.visualEyeMix<1);
    else{
      near(transfer.from.visualEyeMix,1);assert.ok(transfer.from.visualPull.amount>0);
      assert.equal(Math.sign(Math.cos(transfer.from.visualPull.angle)),phase==='positive'?1:-1);
    }
    let ui=uiContours();assertSameContour(ui.body,body);
    ui.eyes.forEach((eye,i)=>assertSameContour(eye,eyes[i].points));
    app.advanceUi(0);ui=uiContours();assertSameContour(ui.body,body);
    ui.eyes.forEach((eye,i)=>assertSameContour(eye,eyes[i].points));
    let previous=normalizedContours(ui);
    for(let frame=1;frame<=130;frame++){
      app.advanceUi(.005);ui=uiContours();const next=normalizedContours(ui);
      if(previous.pullVisible&&!next.pullVisible)previous.body.forEach(point=>assert.ok(Math.abs(Math.hypot(point.x,point.y)-1)<.001));
      else assertSameContour(next.body,previous.body,.035);
      if(previous.eyePathsVisible&&next.eyePathsVisible)next.eyes.forEach((eye,i)=>assertSameContour(eye,previous.eyes[i],.06));
      else if(previous.eyePathsVisible){
        // Changing the final path back to the original ellipse must happen
        // only once the sampled outline already lies on that ellipse.
        previous.eyes.forEach((eye,i)=>eye.forEach(point=>{
          const x=(point.x-(i? .17:-.17))/.0525,y=(point.y+.07)/.095;
          assert.ok(Math.abs(x*x+y*y-1)<.01);
        }));
      }
      previous=next;
    }
    assert.equal(app.readRestart().transfer,null);assert.equal(app.readRestart().screen,destination==='home'?'home':'play');
    const final=normalizedContours(ui);
    final.body.forEach(point=>near(Math.hypot(point.x,point.y),1));
    final.eyes.forEach((eye,i)=>eye.forEach(point=>{
      const x=(point.x-(i? .17:-.17))/.0525,y=(point.y+.07)/.095;
      near(x*x+y*y,1);
    }));
  }
});

test('selection eyes follow only a held screen pointer and smoothly change direction, enter the body and recenter',()=>{
  for(const release of ['pointerup','pointercancel','lostpointercapture']){
    const g=graphicsRecorder(),{selector,scene}=app.seedLevelRenderer(g),pointer=inputCanvas();
    const p=selector.player,right={x:p.x+p.r*2,y:p.y},left={x:p.x-p.r*2,y:p.y};
    scene.update(0,0);
    pointer('pointermove',right.x,right.y);advanceScene(scene,.2);
    near(renderedGaze(g,p).x,0);near(renderedGaze(g,p).y,0);assert.equal(app.readRestart().levelPointer,null);
    pointer('pointerdown',right.x,right.y);
    near(renderedGaze(g,p).x,0,'pointer events do not jump the rendered face');
    scene.update(0,16);const first=renderedGaze(g,p).x;assert.ok(first>0&&first<.02);
    advanceScene(scene,.3);const following=renderedGaze(g,p).x;assert.ok(following>first&&following<.08);
    pointer('pointermove',left.x,left.y);near(renderedGaze(g,p).x,following);
    scene.update(0,16);const changing=renderedGaze(g,p).x;assert.ok(changing<following&&changing>-following);
    advanceScene(scene,.3);assert.ok(renderedGaze(g,p).x<0);
    pointer('pointermove',p.x,p.y);const beforeInside=renderedGaze(g,p).x;
    scene.update(0,16);const inside=renderedGaze(g,p).x;
    assert.ok(inside<0&&inside>beforeInside,'entering the ball eases toward neutral instead of snapping');
    advanceScene(scene,.6);assert.ok(Math.abs(renderedGaze(g,p).x)<.0001);
    pointer('pointermove',right.x,right.y);advanceScene(scene,.3);
    const beforeRelease=renderedGaze(g,p).x;assert.ok(beforeRelease>.01);
    pointer(release,right.x,right.y);near(renderedGaze(g,p).x,beforeRelease);
    assert.equal(app.readRestart().levelPointer,null);scene.update(0,16);
    const returning=renderedGaze(g,p).x;assert.ok(returning>0&&returning<beforeRelease);
    advanceScene(scene,.6);assert.ok(Math.abs(renderedGaze(g,p).x)<.0001);
    pointer('pointermove',left.x,left.y);advanceScene(scene,.2);assert.ok(Math.abs(renderedGaze(g,p).x)<.0001);
    assert.equal(app.readRestart().screen,'levels');assert.equal(selector.action,null);
  }
});

test('selection gaze stays within the radial limit, follows the finger during a body pull and ignores unrelated cancellation',()=>{
  const g=graphicsRecorder(),{selector,scene}=app.seedLevelRenderer(g),pointer=inputCanvas();
  const p=selector.player;
  pointer('pointerdown',p.x,p.y);pointer('pointermove',385,5);advanceScene(scene,.5);
  let gaze=renderedGaze(g,p);assert.ok(gaze.x>0&&gaze.y<0,'body pulls look toward the finger rather than opposite the pull');
  assert.ok(Math.hypot(gaze.x,gaze.y)<=.08);near(gaze.x,p.lookX);near(gaze.y,p.lookY);
  pointer('pointercancel',0,0,{pointerId:2});assert.ok(app.readRestart().levelPointer);assert.ok(app.readRestart().drag);
  pointer('pointermove',400,5);const before=Math.hypot(gaze.x,gaze.y);scene.update(0,16);
  gaze=renderedGaze(g,p);assert.ok(Math.hypot(gaze.x,gaze.y)<before,'a captured pointer outside the screen eases back');
  pointer('pointercancel');assert.equal(app.readRestart().levelPointer,null);assert.equal(app.readRestart().drag,null);
  advanceScene(scene,.7);gaze=renderedGaze(g,p);assert.ok(Math.hypot(gaze.x,gaze.y)<.0001);
});

test('home and selection share the same complete independent breathing cycle and selection restarts it after every rebound',()=>{
  let reference;
  for(const mode of ['home','levels']){
    const g=graphicsRecorder(),{active,player,scene,pointer}=pullScene(mode,g);
    active.clock=3.4;scene.update(0,0);
    const anchor={x:player.x,y:player.y,r:player.r},samples=[];let elapsed=0;
    for(const time of [0,.16,.5,1.3,2.7,Math.PI*2/1.3]){
      advanceScene(scene,time-elapsed);elapsed=time;
      const squash=renderedHomeSquash(g,player);samples.push(squash);near(squash,Math.sin(time*1.3)*.035);
      if(mode==='levels')near(player.squash,0);
    }
    if(reference)samples.forEach((value,i)=>near(value,reference[i]));else reference=samples;
    for(let repeat=0;repeat<2;repeat++){
      advanceScene(scene,.5);
      pointer('pointerdown',player.x,player.y);pointer('pointermove',player.x+7,player.y);scene.update(0,0);
      pointer('pointerup',player.x+7,player.y);advanceScene(scene,.819);scene.update(0,1.0000001);
      near(renderedHomeSquash(g,player),0);assert.equal(active.ready,true);
      advanceScene(scene,.3);near(renderedHomeSquash(g,player),Math.sin(.3*1.3)*.035);
      for(const key of ['x','y','r'])near(player[key],anchor[key]);
      if(mode==='levels')near(player.squash,0);
    }
  }
});
