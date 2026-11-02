import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CampaignWorld} from '../dist/campaign.js';
import {skinContour,contourArea} from '../dist/skins.js';

// Run the real entry module and scene with DOM/audio/Phaser boundaries stubbed.
const elements=new Map(),listeners=new Map(),saved=new Map();
function element(selector){
  if(elements.has(selector))return elements.get(selector);
  const classes=new Set();
  const e={hidden:false,inert:false,children:[],dataset:{},style:{setProperty(){},removeProperty(){}},
    classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){on?classes.add(x):classes.delete(x);}},
    attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},addEventListener(){},focus(){},replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},
    firstElementChild:{style:{}},lastElementChild:{style:{}},
    querySelector:child=>element(selector+' '+child),
    getBoundingClientRect(){
      const [x,y,width,height]=selector==='#over-ball'?[96,320,72,72]:selector==='#pause-ball'?[110,200,64,64]:selector==='#skin-unlock-ball'?[141,370,108,108]:[0,0,390,844];
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
let createdElementCount=0;
globalThis.document={readyState:'loading',hidden:false,hasFocus:()=>true,documentElement:element('html'),createElement:tag=>element(`created-${tag}-${++createdElementCount}`),
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
  settings.expressions=false;boot();scene=game.scene;scene.g=graphics;scene.testLabels=[];
  scene.add={text(x,y,text,style){
    const label={x,y,text,style,visible:true,alpha:1,destroyed:false,
      setOrigin(){return this;},setScale(){return this;},setDepth(){return this;},
      setVisible(value){this.visible=value;return this;},setAlpha(value){this.alpha=value;return this;},
      setPosition(x,y){this.x=x;this.y=y;return this;},destroy(){this.destroyed=true;}};
    scene.testLabels.push(label);return label;
  }};
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
export const playerInk=()=>hex(settings.player);
export function setPlayerInk(value){const previous=settings.player;settings.player=value;return previous;}
export function recordTones(){
  const calls=[],original=sound.tone;sound.tone=(...args)=>calls.push(args);
  return {calls,restore(){sound.tone=original;}};
}
export function recordBossVictory(){
  const calls=[],original=sound.bossVictory;sound.bossVictory=(...args)=>calls.push(args);
  return {calls,restore(){sound.bossVictory=original;}};
}
export function openUnlockedSelection(unlocked,current=1){
  campaignProgress={completed:unlocked-1,unlocked};currentLevel=current;
  openLevels({...home.player});
  return selector;
}
export function seedSkins(raw=null,completed=0){
  skins=normalizeSkins(raw,completed);playerContour=skinContour(skins.enabled?skins.sides:0);
  skinTween=null;skinOverride=null;skinUnlock=null;lastUiPose=null;appearance=null;
  campaignProgress=normalizeProgress({completed});
}
export function readSkins(){return {skins,playerContour,skinOverride,skinTween,skinUnlock,lastUiPose,active:activeContour()};}
export function changeSkinEnabled(enabled){setSkinState(toggleSkins(skins,enabled));}
export function changeSkinSides(sides){setSkinState(selectSkin(skins,sides));}
export const advanceSkin=updateSkin;
export function bindPhotoRenderer(renderer){photoRenderer=renderer;}
export const applyAppearance=setAppearance;
export const hidePhotoForFrame=clearPhoto;
export function readAppearance(){return {appearance,appearanceUrl};}
`;
const app=await import('data:text/javascript;base64,'+Buffer.from(source+adapter).toString('base64'));

function clickRestart(){
  for(const fn of listeners.get('click'))fn({target:{closest:()=>({dataset:{action:'restart'}})},detail:1});
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('appearance replacement and removal invalidate cached images while ordinary frames only hide them',async t=>{
  const originalImage=globalThis.Image,calls=[];
  globalThis.Image=class{async decode(){}};
  const renderer={setImage:image=>calls.push(['image',image]),hide:()=>calls.push(['hide'])};
  app.bindPhotoRenderer(renderer);
  t.after(()=>{globalThis.Image=originalImage;app.bindPhotoRenderer(null);app.seedSkins();});
  await app.applyAppearance('data:image/png;base64,b2xk');
  const first=app.readAppearance().appearance;
  app.hidePhotoForFrame();app.hidePhotoForFrame();
  assert.equal(calls.filter(c=>c[0]==='image').length,1,'frame hiding must retain the image cache');
  await app.applyAppearance('data:image/png;base64,bmV3');
  assert.notEqual(app.readAppearance().appearance,first);
  assert.equal(calls.filter(c=>c[0]==='image').length,2);
  await app.applyAppearance(null);
  assert.deepEqual(app.readAppearance(),{appearance:null,appearanceUrl:null});
  assert.equal(calls.filter(c=>c[0]==='image').at(-1)[1],null,'removal must release renderer caches');
});
test('an older image decode cannot recreate the photo cache or saved image after removal',async t=>{
  const originalImage=globalThis.Image,calls=[];let decoded;
  globalThis.Image=class{decode(){return new Promise(resolve=>decoded=resolve);}};
  app.bindPhotoRenderer({setImage:image=>calls.push(image),hide(){}});
  t.after(()=>{globalThis.Image=originalImage;app.bindPhotoRenderer(null);app.seedSkins();saved.delete('qiuqiule-appearance');});
  const pending=app.applyAppearance('data:image/png;base64,b2xk',true);
  await app.applyAppearance(null,true);decoded();await pending;
  assert.deepEqual(calls,[null]);
  assert.deepEqual(app.readAppearance(),{appearance:null,appearanceUrl:null});
  assert.equal(JSON.parse(saved.get('qiuqiule-appearance')).image,null);
});
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
  let points=[],color,alpha,strokeColor,strokeAlpha,strokeWidth;
  const g={shapes:[],borders:[],clear(){this.shapes=[];this.borders=[];},fillStyle(c,a=1){color=c;alpha=a;},beginPath(){points=[];},
    lineStyle(width,c,a=1){strokeWidth=width;strokeColor=c;strokeAlpha=a;},
    strokePath(){this.shapes.push({type:'stroke',color:strokeColor,alpha:strokeAlpha,width:strokeWidth,points:[...points]});},
    strokeRoundedRect(x,y,width,height,r){this.borders.push({x,y,width,height,r});},
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
  assert.ok(position);
  const sx=scale?Number(scale[1]):1,sy=scale?Number(scale[2]):1,center={x:Number(position[1])+r,y:Number(position[2])+r};
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

const crownShapes=g=>{
  const p=app.readRestart().world?.player;if(!p)return [];
  return g.shapes.filter(shape=>{
    if(shape.type!=='path'||shape.color!==app.playerInk()||shape.points.length===193)return false;
    const bounds=outlineBounds(shape);
    return Math.abs(bounds.cx-p.x)<p.r*.1&&bounds.cy<p.y-p.r*.7&&bounds.cy>p.y-p.r*3;
  });
};
const playerEyes=(g,p)=>eyeShapes(g).filter(shape=>shape.type==='ellipse'&&Math.hypot(shape.x-p.x,shape.y-p.y)<p.r);
function bossScene(stage=5,width=390,height=844){
  const g=graphicsRecorder(),{world,scene}=app.seedRenderer(g,width,height,true);
  world.stage=stage;world.score=world.target;scene.update(0,1000/120);
  assert.equal(world.phase,'boss-entry');assert.ok(world.boss?.isBoss);
  return {g,world,scene};
}
function advanceToBoss(world,scene){
  for(let frame=0;world.phase==='boss-entry'&&frame<240;frame++)scene.update(0,1000/120);
  assert.equal(world.phase,'boss');assert.equal(world.boss.born,1);
}
function stunBoss(world,scene){
  for(let hit=0;!world.boss.stunned&&hit<100;hit++){
    world.damageBoss(world.baseSpeed);scene.update(0,0);
  }
  assert.equal(world.phase,'boss');assert.equal(world.boss.stunned,true);
  assert.ok(Number.isFinite(world.boss.hp)&&world.boss.hp>0);assert.equal(world.boss.defeated,false);
  assert.equal(world.boss.hp,world.boss.maxHp,'the shrinking hit that triggers stun does not consume the new health pool');
}
function defeatBoss(world,scene){
  for(let hit=0;world.phase==='boss'&&hit<100;hit++){
    world.damageBoss(world.baseSpeed);scene.update(0,0);
  }
  assert.equal(world.phase,'boss-celebrate');assert.equal(world.boss.defeated,true);assert.equal(world.boss.solid,false);
}
function bossSimulationSnapshot(world,scene){
  const p=world.player;
  return JSON.stringify({phase:world.phase,phaseTime:world.phaseTime,time:world.time,score:world.score,target:world.target,
    spawnTimer:world.spawnTimer,arenaBounds:world.arenaBounds,boss:world.boss,bossCelebration:world.bossCelebration,enemies:world.enemies,choices:world.choices,
    player:{x:p.x,y:p.y,vx:p.vx,vy:p.vy,r:p.r,squash:p.squash,angle:p.angle,roll:p.roll},
    effects:scene.effects.map(e=>({life:e.life,x:e.x,y:e.y}))});
}
const bossSpiralShapes=(g,b)=>g.shapes.filter(shape=>shape.type==='stroke'&&shape.points.length>10&&shape.points.every(point=>Math.hypot(point.x-b.x,point.y-b.y)<b.r));
const bossAngryShapes=(g,b)=>g.shapes.filter(shape=>shape.type==='path'&&shape.color===0x8b5444&&shape.points.every(point=>Math.hypot(point.x-b.x,point.y-b.y)<b.r));
function assertArenaBorder(g,world){
  assert.equal(g.borders.length,1);const drawn=g.borders[0],bounds=world.arenaBounds;
  // Preserve the established one-pixel optical outset around the collision box.
  near(drawn.x,bounds.left-1);near(drawn.y,bounds.top-1);
  near(drawn.width,bounds.width+2);near(drawn.height,bounds.height+2);
}

test('boss entry reaches a centered square in 0.85 seconds and its visible border agrees with every collision wall',()=>{
  for(const [width,height] of [[390,844],[844,390]]){
    const {g,world,scene}=bossScene(5,width,height),initial={...world.arenaBounds};
    assertArenaBorder(g,world);advanceScene(scene,.4);assert.equal(world.phase,'boss-entry');
    const middle={...world.arenaBounds};assertArenaBorder(g,world);
    near((middle.left+middle.right)/2,width/2);near((middle.top+middle.bottom)/2,height/2);
    assert.ok(middle.width<=initial.width&&middle.height<=initial.height);
    assert.ok(middle.width<initial.width||middle.height<initial.height);
    advanceScene(scene,.44);assert.equal(world.phase,'boss-entry');advanceScene(scene,.02);assert.equal(world.phase,'boss');
    const bounds=world.arenaBounds;near(bounds.width,bounds.height);
    near((bounds.left+bounds.right)/2,width/2);near((bounds.top+bounds.bottom)/2,height/2);assertArenaBorder(g,world);
    near(world.boss.initialRadius,world.unit*4.8);near(world.boss.minRadius,world.unit*2);near(world.boss.maxRadius,bounds.width*.375);
    const p=world.player;
    for(const side of ['left','right','top','bottom']){
      p.x=bounds.left+p.r+5;p.y=bounds.bottom-p.r-5;p.vx=p.vy=0;
      const horizontal=side==='left'||side==='right',coordinate=horizontal?'x':'y',velocity=horizontal?'vx':'vy';
      const inward=side==='left'||side==='top'?1:-1;
      p[coordinate]=bounds[side]+inward*(p.r-3);p[velocity]=-inward*100;
      world.wall(p);near(p[coordinate],bounds[side]+inward*p.r);assert.ok(p[velocity]*inward>0);
      scene.update(0,0);assertArenaBorder(g,world);
    }
    p.x=width/2;p.y=bounds.bottom-p.r-5;p.vx=world.unit*19;p.vy=0;
    const pointer=inputCanvas(width,height);pointer('pointerdown',p.x,p.y);
    assert.ok(app.readRestart().drag,'the boss ready-speed allowance permits a new pull while the player is still moving');
    pointer('pointercancel');
  }
});

test('reaching the boss minimum radius leaves a living stunned boss whose angry eyes gradually become spirals',()=>{
  const {g,world,scene}=bossScene();advanceToBoss(world,scene);const scoreBefore=world.score;
  assert.equal(bossSpiralShapes(g,world.boss).length,0);assert.equal(bossAngryShapes(g,world.boss).length,2);
  const horns=g.shapes.filter(shape=>shape.type==='path'&&shape.color===0xe88c72&&shape.points.length!==193);
  assert.equal(horns.length,2);
  assert.ok(horns.every(horn=>Math.max(...horn.points.map(point=>Math.hypot(point.x-world.boss.x,point.y-world.boss.y)))<world.boss.r*1.4),'larger horns remain cosmetic appendages within the intended outline');
  stunBoss(world,scene);
  const b=world.boss,hp=b.hp;near(b.r,world.unit*2);assert.equal(world.score-scoreBefore,500);
  assert.equal(scene.testLabels.filter(label=>label.text==='+500').length,0,'the minimum-size hit does not also award the kill');
  assert.equal(bossSpiralShapes(g,b).length,0,'stun entry retains the old eye shape on its first frame');
  advanceScene(scene,.12);assert.equal(world.phase,'boss');near(b.r,world.unit*2);assert.equal(b.hp,hp);
  const halfway=bossSpiralShapes(g,b);assert.equal(halfway.length,2);
  assert.ok(halfway.every(eye=>eye.alpha>0&&eye.alpha<1),'spirals fade in through a real intermediate state');
  const fading=bossAngryShapes(g,b);assert.equal(fading.length,2);assert.ok(fading.every(eye=>eye.alpha>0&&eye.alpha<1));
  advanceScene(scene,.13);const complete=bossSpiralShapes(g,b);assert.equal(complete.length,2);
  assert.ok(complete.every(eye=>Math.abs(eye.alpha-1)<1e-6));assert.equal(b.hp,hp);near(b.r,world.unit*2);
  assert.equal(bossAngryShapes(g,b).length,0,'the angry eyes fully disappear after the smooth handoff');
  let followupHits=0;
  while(world.phase==='boss'&&followupHits<3){
    world.damageBoss(world.baseSpeed);scene.update(0,0);followupHits++;
    if(followupHits===1){
      assert.equal(world.phase,'boss','the first normal follow-up impact must not kill the stunned boss');
      assert.ok(b.hp>0&&b.hp<hp);assert.equal(b.stunned,true);near(b.r,b.minRadius);
      assert.equal(bossSpiralShapes(g,b).length,2,'spiral eyes persist through a surviving follow-up impact');
      assert.equal(bossAngryShapes(g,b).length,0);assert.equal(world.score-scoreBefore,500);
    }
    assert.ok(!g.shapes.some(shape=>shape.type==='ellipse'&&[0xf9f8f0,0xffffff].includes(shape.color)&&shape.alpha>0),'stunned impacts retain the no-white-flash rendering');
  }
  assert.equal(followupHits,3,'the first boss takes three unbuffed base-speed follow-up impacts');
  assert.equal(world.phase,'boss-celebrate');assert.equal(world.score-scoreBefore,1000);
  const labels=scene.testLabels.map(label=>label.text);
  assert.deepEqual(labels,['+100','+100','+100','+100','+100','+500']);
  for(let repeated=0;repeated<3;repeated++){world.damageBoss(world.baseSpeed);scene.update(0,0);}
  assert.equal(world.score-scoreBefore,1000);assert.deepEqual(scene.testLabels.map(label=>label.text),labels,'segment and kill rewards are each dispatched only once');
});

test('boss defeat keeps the current velocity and slows smoothly for 0.8 seconds before spinning',()=>{
  const {world,scene}=bossScene();advanceToBoss(world,scene);stunBoss(world,scene);
  const p=world.player,bounds=world.arenaBounds;
  p.x=(bounds.left+bounds.right)/2;p.y=(bounds.top+bounds.bottom)/2;p.vx=100;p.vy=-20;
  const initialSpeed=Math.hypot(p.vx,p.vy),initial={x:p.x,y:p.y};
  defeatBoss(world,scene);
  near(Math.hypot(p.vx,p.vy),initialSpeed);near(p.x,initial.x);near(p.y,initial.y);
  let previous=initialSpeed;
  for(let frame=1;frame<=96;frame++){
    scene.update(0,1000/120);const speed=Math.hypot(p.vx,p.vy);
    assert.ok(speed<=previous+1e-8,'braking never adds speed');
    if(frame===1){assert.ok(speed>initialSpeed*.9,'the first frame does not abruptly cut velocity');assert.ok(p.x>initial.x&&p.y<initial.y);}
    if(frame<96)assert.ok(speed>0,'braking continues until its full duration');
    previous=speed;
  }
  near(previous,0);near(p.roll,0);advanceScene(scene,.05);assert.ok(p.roll>0);
});

test('the real scene renders the boss, routes its segment and defeat rewards, then offers the ordinary upgrade',()=>{
  for(const [stage,segmentValue,totalValue] of [[5,100,1000],[10,110,1100]]){
    const {g,world,scene}=bossScene(stage),scoreBefore=world.score;
    assert.deepEqual(world.choices,[]);assert.equal(element('#choice-labels').innerHTML,'');assert.equal(crownShapes(g).length,0);
    advanceToBoss(world,scene);
    assert.deepEqual(world.enemies,[]);assert.deepEqual(world.choices,[]);assert.equal(element('#choice-labels').innerHTML,'');
    assert.equal(g.shapes.filter(shape=>shape.type==='path'&&shape.color===0xe88c72&&shape.points.length===193).length,1,'the separate boss body reaches the real renderer');
    const boss=world.boss;world.damageBoss(world.baseSpeed);scene.update(0,0);
    assert.ok(!g.shapes.some(shape=>shape.type==='ellipse'&&[0xf9f8f0,0xffffff].includes(shape.color)&&shape.alpha>0&&Math.abs(shape.x-boss.x)<1e-6),'boss damage never paints a white flash over its body');
    defeatBoss(world,scene);
    assert.equal(g.shapes.filter(shape=>shape.type==='path'&&shape.color===0xe88c72&&shape.points.length===193).length,0,'the defeated boss does not remain as a solid or flashing ball');
    assert.equal(world.score-scoreBefore,totalValue);
    assert.deepEqual(scene.testLabels.map(label=>label.text),[...Array(5).fill('+'+segmentValue),'+'+segmentValue*5]);
    assert.ok(scene.testLabels.every(label=>label.style.fontFamily==='GameSans, sans-serif'));
    assert.equal(element('#score').textContent,String(world.score).padStart(4,'0'));
    assert.equal(Number(saved.get('qiuqiule-best')),world.score);
    assert.deepEqual(world.choices,[]);assert.equal(element('#choice-labels').innerHTML,'');
    advanceScene(scene,2.85);assert.equal(world.phase,'boss-celebrate');
    assert.deepEqual(world.choices,[]);assert.equal(element('#choice-labels').innerHTML,'');
    advanceScene(scene,.03);assert.equal(world.phase,'transition');assert.equal(world.choices.length,2);
    assert.ok(element('#choice-labels').innerHTML.includes('choice-label'),'the existing upgrade transition becomes visible only after the celebration');
    assert.equal(crownShapes(g).length,0);
    advanceScene(scene,.86);near(world.arenaBounds.width,world.width-32);near(world.arenaBounds.height,world.height-32);assertArenaBorder(g,world);
    advanceScene(scene,1.04);assert.equal(world.phase,'choose');assert.equal(world.ready,true);
    assert.ok(element('#choice-labels').innerHTML.includes('opacity:1'));
  }
});

test('boss collisions keep deformation, sound and scoring without white flashes while ordinary enemies retain their hit flash',()=>{
  const {g,world,scene}=bossScene();advanceToBoss(world,scene);
  const boss=world.boss,p=world.player,scoreBefore=world.score,radiusBefore=boss.r;
  const audio=app.recordTones();
  try{
    for(let hit=0;hit<40&&world.score===scoreBefore;hit++){
      p.x=boss.x;p.y=boss.y+boss.r+p.r-1;p.vx=0;p.vy=-world.baseSpeed*.5;
      world.collideBoss();scene.update(0,0);
      assert.ok(p.vy>0,'the real collision still rebounds the player');
      assert.ok(boss.squash>0&&p.squash>0,'the normal impact deformation remains active');
      assert.ok(!g.shapes.some(shape=>shape.type==='ellipse'&&[0xf9f8f0,0xffffff].includes(shape.color)&&shape.alpha>0),'boss hit feedback contains no white overlay');
    }
    assert.ok(boss.r<radiusBefore);assert.equal(world.score-scoreBefore,100);
    assert.ok(scene.testLabels.some(label=>label.text==='+100'));
    assert.ok(audio.calls.some(args=>args[0]>0&&args[1]>0&&args[2]==='triangle'),'boss impacts still dispatch their sound');
    const body=g.shapes.find(shape=>shape.type==='path'&&shape.color===0xe88c72&&shape.points.length===193);
    assert.ok(body);const bounds=outlineBounds(body);assert.ok(Math.abs(bounds.width-bounds.height)>1,'the renderer keeps the visible collision squash');
  }finally{audio.restore();}
  const ordinaryGraphics=graphicsRecorder(),ordinary=app.seedRenderer(ordinaryGraphics,390,844,true);
  const player=ordinary.world.player,enemy=ordinary.world.enemies[0],hp=enemy.hp;
  enemy.born=1;enemy.solid=true;enemy.x=player.x+player.r+enemy.r-1;enemy.y=player.y;enemy.vx=enemy.vy=0;
  player.vx=ordinary.world.unit*3;player.vy=0;
  ordinary.world.collide(player,enemy);ordinary.scene.update(0,0);
  assert.ok(enemy.hp<hp&&enemy.hp>0,'exercise a surviving ordinary-enemy impact');
  assert.ok(ordinaryGraphics.shapes.some(shape=>shape.type==='ellipse'&&shape.color===0xf9f8f0&&shape.alpha>0&&Math.abs(shape.x-enemy.x)<1e-6&&Math.abs(shape.y-enemy.y)<1e-6),'ordinary enemies retain their existing white hit effect');
});

test('boss entry, battle and celebration freeze through pause or backgrounding and resume from the same simulation pose',()=>{
  for(const phase of ['boss-entry','boss','stunned','boss-celebrate'])for(const interruption of ['pause','background']){
    const {g,world,scene}=bossScene();
    if(phase!=='boss-entry')advanceToBoss(world,scene);
    if(phase==='boss-celebrate'){defeatBoss(world,scene);advanceScene(scene,1.1);}
    else if(phase==='stunned'){stunBoss(world,scene);advanceScene(scene,.3);}
    else if(phase==='boss-entry')advanceScene(scene,.4);
    const before=bossSimulationSnapshot(world,scene),rollBefore=world.player.roll||0;
    const eyesBefore=playerEyes(g,world.player).map(({x,y,width,height})=>({x,y,width,height}));
    const spiralsBefore=phase==='stunned'?bossSpiralShapes(g,world.boss):null;
    const uiEyeRotation=()=>Number(/rotate\(([^r]+)rad\)/.exec(element('#ui-ball .ui-eyes').style.transform)[1]);
    if(interruption==='pause')clickAction('pause');
    else{
      document.hidden=true;
      for(const listener of listeners.get('visibilitychange'))listener();
    }
    try{
      assert.equal(app.readRestart().paused,true);assert.equal(app.readRestart().modal,'pause');
      near(uiEyeRotation(),rollBefore);app.advanceUi(0);near(uiEyeRotation(),rollBefore,'the first pause animation frame preserves the spinning face');
      advanceScene(scene,.75);
      assert.equal(bossSimulationSnapshot(world,scene),before,'neither the boss nor timed celebration can progress behind a pause overlay');
      assertArenaBorder(g,world);
      if(spiralsBefore)assert.deepEqual(bossSpiralShapes(g,world.boss),spiralsBefore,'stunned spiral geometry freezes with world time');
      assert.equal(crownShapes(g).length,0,'the detached pause player never leaves a crown floating in the arena');
      assert.ok(scene.testLabels.filter(label=>!label.destroyed).every(label=>!label.visible));
    }finally{
      document.hidden=false;
      if(interruption==='background')for(const listener of listeners.get('visibilitychange'))listener();
    }
    clickAction('resume');assert.equal(app.readRestart().paused,true);
    app.advanceUi(0);near(uiEyeRotation(),0);
    app.advanceUi(.65);assert.equal(app.readRestart().paused,false);
    near(Math.cos(uiEyeRotation()),Math.cos(rollBefore));near(Math.sin(uiEyeRotation()),Math.sin(rollBefore));
    assert.equal(bossSimulationSnapshot(world,scene),before,'the return flight itself does not advance gameplay');
    scene.update(0,0);assert.deepEqual(playerEyes(g,world.player).map(({x,y,width,height})=>({x,y,width,height})),eyesBefore,'the resumed canvas face retains its frozen orientation');
    const previousTime=world.time;advanceScene(scene,.05);assert.ok(world.time>previousTime);assert.equal(world.phase,phase==='stunned'?'boss':phase);
  }
});

test('restarting from any boss phase removes the boss, celebration, labels and crown before a fresh endless attempt',()=>{
  for(const phase of ['boss-entry','boss','stunned','boss-celebrate']){
    const {g,world,scene}=bossScene();
    if(phase!=='boss-entry')advanceToBoss(world,scene);
    if(phase==='boss-celebrate'){defeatBoss(world,scene);advanceScene(scene,1.1);assert.equal(crownShapes(g).length,1);}
    else if(phase==='stunned'){stunBoss(world,scene);advanceScene(scene,.3);}
    const oldLabels=[...scene.testLabels];
    clickAction('pause');app.advanceUi(.42);clickRestart();
    const state=app.readRestart(),fresh=state.world;
    assert.notEqual(fresh,world);assert.equal(fresh.phase,'battle');assert.equal(fresh.stage,1);assert.equal(fresh.score,0);
    assert.equal(fresh.boss,null);assert.ok(!fresh.player.roll);assert.deepEqual(fresh.choices,[]);assert.deepEqual(scene.effects,[]);
    assert.ok(oldLabels.every(label=>label.destroyed));assert.equal(element('#choice-labels').innerHTML,'');
    assert.equal(state.transfer.duration,.65);assert.equal(state.paused,true);
    app.advanceUi(.65);scene.update(0,0);
    assert.equal(app.readRestart().paused,false);assert.equal(crownShapes(g).length,0);assert.equal(fresh.time,0);
    near(fresh.arenaBounds.width,fresh.width-32);near(fresh.arenaBounds.height,fresh.height-32);assertArenaBorder(g,fresh);
  }
});

test('boss celebration renders an upright crown and player spin, with one fanfare after braking and no early reward controls',()=>{
  const {g,world,scene}=bossScene();advanceToBoss(world,scene);
  const audio=app.recordBossVictory();
  try{
    defeatBoss(world,scene);assert.equal(crownShapes(g).length,0);assert.equal(audio.calls.length,0);
    advanceScene(scene,.79);assert.equal(crownShapes(g).length,0);assert.equal(audio.calls.length,0);
    advanceScene(scene,.31);assert.equal(world.phase,'boss-celebrate');assert.equal(audio.calls.length,1);
    assert.equal(world.ready,false);assert.deepEqual(world.choices,[]);assert.equal(element('#choice-labels').innerHTML,'');
    const crown=crownShapes(g);assert.equal(crown.length,1);assert.ok(crown[0].points.length>50);
    const p=world.player,firstRoll=p.roll;assert.ok(firstRoll>0&&firstRoll<Math.PI*2);
    const bounds=outlineBounds(crown[0]);near(bounds.cx,p.x);assert.ok(bounds.cy<p.y-p.r);assert.ok(bounds.width>p.r&&bounds.width<2*p.r,'the narrower crown fits within the player diameter');
    const eyes=playerEyes(g,p);assert.equal(eyes.length,2);
    const ex=-p.r*.17+(p.lookX||0)*p.r,ey=-p.r*.07+(p.lookY||0)*p.r;
    near(eyes[0].x,p.x+ex*Math.cos(firstRoll)-ey*Math.sin(firstRoll));
    near(eyes[0].y,p.y+ex*Math.sin(firstRoll)+ey*Math.cos(firstRoll));
    const crownLocal=crown[0].points.map(point=>({x:point.x-p.x,y:point.y-p.y}));
    advanceScene(scene,.2);assert.ok(p.roll>firstRoll);
    const next=crownShapes(g);assert.equal(next.length,1);
    assertSameContour(next[0].points.map(point=>({x:point.x-p.x,y:point.y-p.y})),crownLocal);
    assert.equal(audio.calls.length,1,'spinning frames do not replay the fanfare');
    advanceScene(scene,.35);near(p.roll,Math.PI*2);
    const held=crownShapes(g)[0];assert.ok(held);near(held.alpha,1);assert.equal(held.color,0x252720);
    const previousColor=app.setPlayerInk('#205c67');
    try{
      scene.update(0,0);assert.equal(crownShapes(g)[0].color,0x205c67);
      assert.ok(g.shapes.some(shape=>shape.type==='path'&&shape.points.length===193&&shape.color===0x205c67),'crown and player share the customized color');
    }finally{app.setPlayerInk(previousColor);scene.update(0,0);}
    const holdStart=world.phaseTime;assert.ok(Math.abs(holdStart-1.65)<1/120+1e-8);
    for(let frame=0;frame<20;frame++){
      advanceScene(scene,.05);assert.equal(world.phase,'boss-celebrate');near(p.roll,Math.PI*2);
      const holding=crownShapes(g);assert.equal(holding.length,1);near(holding[0].alpha,1);
      assertSameContour(holding[0].points,held.points);assert.equal(element('#choice-labels').innerHTML,'');
    }
    advanceScene(scene,.05);assert.equal(world.phase,'boss-celebrate');assert.ok(crownShapes(g)[0].alpha<1&&crownShapes(g)[0].alpha>0);
    advanceScene(scene,.2);assert.equal(world.phase,'transition');assert.equal(crownShapes(g).length,0);assert.equal(audio.calls.length,1);
  }finally{audio.restore();}
});

test('campaign levels retain finite enemies and direct attribute upgrades without boss or crown scenes',()=>{
  for(const level of [5,10,50]){
    const g=graphicsRecorder(),{world,scene}=app.seedCampaignRenderer(g,390,844,level);
    world.stage=5;
    for(let kill=0;kill<world.config.upgradeEvery;kill++){
      let enemy=world.enemies.find(body=>body.hp>0);
      if(!enemy){world.spawnEnemy();enemy=world.enemies.find(body=>body.hp>0);}
      world.damage(enemy,1e6);scene.update(0,0);
    }
    assert.equal(world.mode,'campaign');assert.equal(world.phase,'battle');assert.equal(world.boss,null);
    assert.equal(world.kills,world.config.upgradeEvery);assert.equal(world.upgrades,1);assert.equal(world.score,0);
    assert.equal(world.totalEnemies,world.config.totalEnemies);assert.deepEqual(world.choices,[]);
    assert.equal(crownShapes(g).length,0);assert.equal(element('#choice-labels').innerHTML,'');
    assert.deepEqual(scene.testLabels.map(label=>label.text),['弹力 +14%']);
  }
});

function finishCampaign(world,scene){
  while(!world.completed){
    let enemy=world.enemies.find(body=>body.hp>0);
    if(!enemy){world.spawnEnemy();enemy=world.enemies.find(body=>body.hp>0);}
    assert.ok(enemy,'a real finite campaign enemy remains to be defeated');
    world.damage(enemy,1e6);
    scene.update(0,0);
    world.enemies=world.enemies.filter(body=>body.hp>0);
  }
  assert.equal(world.phase,'over');assert.equal(world.kills,world.totalEnemies);
}

test('real milestone wins save progress before the unlock scene, gate dismissal, restore the old skin and never reward a replay',()=>{
  try{
    let g=graphicsRecorder(),run=app.seedCampaignRenderer(g,390,844,10);
    app.seedSkins(null,9);
    const original=app.readSkins().playerContour;
    finishCampaign(run.world,run.scene);
    let state=app.readRestart(),skin=app.readSkins();
    assert.equal(state.result,null,'settlement does not appear before the reward animation');
    assert.equal(state.modal,'skin-unlock');assert.equal(state.paused,true);
    assert.equal(skin.skinUnlock.sides,6);assert.equal(skin.skinUnlock.ready,false);
    assert.equal(skin.skinUnlock.phase,'enter');assert.equal(element('#skin-unlock-continue').disabled,true);
    assert.deepEqual(JSON.parse(saved.get('qiuqiule-campaign')),{completed:10,unlocked:11});
    assert.deepEqual(JSON.parse(saved.get('qiuqiule-skins')),{enabled:false,sides:6,unlocked:6});
    assertSameContour(skin.active,original);
    clickAction('close');assert.equal(app.readSkins().skinUnlock.phase,'enter');assert.equal(app.readRestart().result,null);
    app.advanceUi(.8);
    assert.equal(app.readSkins().skinUnlock.ready,false);
    assert.notDeepEqual(app.readSkins().active,original,'the real animation reaches an intermediate skin');
    clickAction('close');assert.equal(app.readRestart().result,null,'an early tap cannot skip the reveal');
    app.advanceUi(.86);skin=app.readSkins();
    assert.equal(skin.skinUnlock.ready,true);assert.equal(element('#skin-unlock-continue').disabled,false);
    assertSameContour(skin.active,skinContour(6));
    assert.equal(element('#skin-unlock-title').style.opacity,1);
    const revealed=uiContours();
    clickAction('close');state=app.readRestart();skin=app.readSkins();
    assert.ok(state.result?.completed);assert.equal(state.result.percent,100);
    assert.equal(skin.skinUnlock.phase,'leave');assert.equal(state.transfer,null);
    assert.equal(skin.skins.enabled,false,'showing a reward never equips it');
    assert.equal(state.result.clock,0);
    app.advanceUi(0);assertSameContour(uiContours().body,revealed.body);
    app.advanceUi(.31);
    assert.notDeepEqual(app.readSkins().active,original);
    assert.notDeepEqual(app.readSkins().active,skinContour(6),'departure morphs back while moving');
    app.advanceUi(.31);state=app.readRestart();skin=app.readSkins();
    assert.equal(skin.skinUnlock,null);assert.equal(skin.skinOverride,null);
    assert.equal(state.uiAnchor,'over');assert.equal(state.controlFlight,null);
    assert.equal(element('#skin-unlock-panel').hidden,true);
    assertSameContour(skin.playerContour,original);
    assert.equal(element('#ui-ball .ui-body').style.display,'');
    near(uiContours().center.x,132);near(uiContours().center.y,356);

    // A retry uses the skin state earned above and routes directly to result.
    g=graphicsRecorder();run=app.seedCampaignRenderer(g,390,844,10);
    finishCampaign(run.world,run.scene);
    assert.equal(app.readSkins().skinUnlock,null);assert.ok(app.readRestart().result?.completed);
    assert.equal(app.readRestart().transfer.target,'over');
    assert.deepEqual(JSON.parse(saved.get('qiuqiule-campaign')),{completed:10,unlocked:11});

    // Milestone 20 previews seven sides but keeps an equipped six-sided skin.
    run=app.seedCampaignRenderer(graphicsRecorder(),390,844,20);
    app.seedSkins({enabled:true,sides:6,unlocked:6},19);
    const equipped=app.readSkins().playerContour;
    finishCampaign(run.world,run.scene);
    assert.equal(app.readSkins().skinUnlock.sides,7);assert.equal(app.readRestart().result,null);
    assert.deepEqual(JSON.parse(saved.get('qiuqiule-campaign')),{completed:20,unlocked:21});
    assert.deepEqual(JSON.parse(saved.get('qiuqiule-skins')),{enabled:true,sides:6,unlocked:7});
    app.advanceUi(1.66);assertSameContour(app.readSkins().active,skinContour(7));
    clickAction('close');app.advanceUi(.62);
    assert.equal(app.readSkins().skinUnlock,null);
    assert.deepEqual(app.readSkins().skins,{enabled:true,sides:6,unlocked:7});
    assertSameContour(app.readSkins().active,equipped);
    assert.equal(element('#ui-ball .ui-body').style.display,'none');
  }finally{app.seedSkins();}
});

test('the actual renderer uses six-sided skins everywhere without changing collision radii or mass',()=>{
  try{
    for(const mode of ['home','levels','endless','campaign']){
      const g=graphicsRecorder(),{scene,player}=pullScene(mode,g);
      app.seedSkins({enabled:false,sides:6,unlocked:6},10);
      const physical={r:player.r,mass:player.mass,density:player.density};
      scene.update(0,0);
      const circle=bodyShapes(g)[0].points;
      app.changeSkinEnabled(true);
      assertSameContour(app.readSkins().playerContour,skinContour(0));
      app.advanceSkin(.15);scene.update(0,0);
      const middle=bodyShapes(g)[0].points;
      app.advanceSkin(.15);scene.update(0,0);
      const polygon=bodyShapes(g)[0].points;
      assert.notDeepEqual(polygon,circle);assert.notDeepEqual(middle,circle);assert.notDeepEqual(middle,polygon);
      near(contourArea(polygon),Math.PI*player.r*player.r);
      assert.equal(polygon.length,193);assert.equal(eyeShapes(g).length,2);
      assert.deepEqual({r:player.r,mass:player.mass,density:player.density},physical);
      assert.deepEqual(JSON.parse(saved.get('qiuqiule-skins')),{enabled:true,sides:6,unlocked:6});
    }
  }finally{app.seedSkins();}
});

test('six-sided selection skin and rebound deformation stay continuous across the canvas-to-SVG transfer',()=>{
  try{
    for(const destination of ['level','home'])for(const rebound of [false,true]){
      const g=graphicsRecorder(),{selector,scene}=app.seedLevelRenderer(g,390,844,50),pointer=inputCanvas();
      app.seedSkins({enabled:true,sides:6,unlocked:6},49);
      const p=selector.player,physical={r:p.r,mass:p.mass};scene.update(0,0);
      if(rebound){
        pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+selector.maxPull,p.y);
        pointer('pointerup',p.x+selector.maxPull,p.y);advanceScene(scene,.82/12);
        assert.equal(selector.phase,'wobble');
      }else advanceScene(scene,.2);
      const rendered=bodyShapes(g)[0].points.slice(0,-1);
      const target=destination==='home'?selector.returnBall:selector.visibleBalls.find(b=>b.level===50);
      pointer('pointerdown',target.x,target.y);pointer('pointerup',target.x,target.y);scene.update(0,0);
      assert.ok(app.readRestart().transfer);
      assertSameContour(uiContours().body,rendered);
      app.advanceUi(0);assertSameContour(uiContours().body,rendered);
      let previous=normalizedContours(uiContours()).body;
      for(let frame=0;frame<130;frame++){
        app.advanceUi(.005);
        const next=normalizedContours(uiContours()).body;
        // The existing transfer performs a full turn: corresponding polygon
        // vertices move with that turn, unlike the old rotation-invariant ball.
        assertSameContour(next,previous,.14);previous=next;
      }
      assert.equal(app.readRestart().transfer,null);
      assert.deepEqual({r:p.r,mass:p.mass},physical,'visual transfers never resize the source collision body');
      assertSameContour(app.readSkins().active,skinContour(6));
    }
  }finally{app.seedSkins();}
});

test('actual wardrobe state changes preserve the selected side count while switched off and restore it when enabled',()=>{
  try{
    app.seedRenderer(graphicsRecorder());app.seedSkins({enabled:true,sides:6,unlocked:10},50);
    app.changeSkinSides(8);app.advanceSkin(.3);
    assertSameContour(app.readSkins().playerContour,skinContour(8));
    app.changeSkinEnabled(false);app.advanceSkin(.15);
    const intermediate=app.readSkins().playerContour;
    assert.notDeepEqual(intermediate,skinContour(8));assert.notDeepEqual(intermediate,skinContour(0));
    app.advanceSkin(.15);
    assert.deepEqual(JSON.parse(saved.get('qiuqiule-skins')),{enabled:false,sides:8,unlocked:10});
    assertSameContour(app.readSkins().playerContour,skinContour(0));
    app.changeSkinEnabled(true);app.advanceSkin(.3);
    assert.deepEqual(JSON.parse(saved.get('qiuqiule-skins')),{enabled:true,sides:8,unlocked:10});
    assertSameContour(app.readSkins().playerContour,skinContour(8));
  }finally{app.seedSkins();}
});
