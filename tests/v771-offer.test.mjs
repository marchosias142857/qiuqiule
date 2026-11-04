import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CampaignWorld,LegacyCampaignWorld} from '../dist/campaign.js';
import {levelRecord} from '../dist/campaign-progress.js';
import {skinContour,contourArea} from '../dist/skins.js';
import {UPGRADE_DEFINITIONS,UPGRADES} from '../dist/upgrades.js';
import {impactShards} from '../dist/feedback.js';
import {BOSS_TIMING} from '../dist/physics.js';
import {CampaignOfferWorld} from '../dist/campaign-offer.js';
import {levelConfig,campaignUpgradeChoices} from '../dist/campaign.js';

// Run the real entry module and scene with DOM/audio/Phaser boundaries stubbed.
const elements=new Map(),listeners=new Map(),windowListeners=new Map(),saved=new Map();
function element(selector){
  if(elements.has(selector))return elements.get(selector);
  const classes=new Set();
  const e={hidden:false,inert:false,children:[],dataset:{},listeners:new Map(),style:{setProperty(){},removeProperty(){}},
    classList:{add:(...names)=>names.forEach(x=>classes.add(x)),remove:(...names)=>names.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle(x,on){on?classes.add(x):classes.delete(x);}},
    attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);},focus(){},replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},
    firstElementChild:{style:{}},lastElementChild:{style:{}},
    querySelector:child=>element(selector+' '+child),
    getBoundingClientRect(){
      if(selector==='#feedback-demo'&&classes.has('demo-compact')){
        const {width,height}=this.testViewport||{width:window.innerWidth,height:window.innerHeight};
        return {x:width/2-52,y:height-60,left:width/2-52,right:width/2+52,top:height-60,bottom:height-20,width:104,height:40};
      }
      const [x,y,width,height]=selector==='#over-ball'?[96,320,72,72]:selector==='#pause-ball'?[110,200,64,64]:selector==='#skin-unlock-ball'?[141,370,108,108]:[0,0,390,844];
      return {x,y,width,height,top:y,bottom:y+height,left:x,right:x+width};
    }};
  elements.set(selector,e);return e;
}
globalThis.window={innerWidth:390,innerHeight:844,devicePixelRatio:2,
  addEventListener(type,fn){if(!windowListeners.has(type))windowListeners.set(type,[]);windowListeners.get(type).push(fn);},
  removeEventListener(type,fn){windowListeners.set(type,(windowListeners.get(type)||[]).filter(handler=>handler!==fn));}};
globalThis.localStorage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)};
globalThis.Phaser={AUTO:0,Scale:{NONE:0},Scene:class{constructor(){this.cameras={main:{setBackgroundColor(){}}};}},Game:class{constructor(config){this.scene=new config.scene();}}};
window.Phaser=globalThis.Phaser;
globalThis.matchMedia=()=>({matches:false});
globalThis.getComputedStyle=()=>({paddingTop:'0',paddingBottom:'0',borderTopWidth:'0',borderBottomWidth:'0',marginBottom:'0'});
globalThis.requestAnimationFrame=fn=>fn();
let createdElementCount=0;
globalThis.document={readyState:'loading',hidden:false,hasFocus:()=>true,documentElement:element('html'),createElement:tag=>element(`created-${tag}-${++createdElementCount}`),
  querySelector:element,
  querySelectorAll:selector=>selector==='.menu-panel'?['#settings-panel','#help-panel','#menu-transition-panel'].map(element):[],
  addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);}};
if(!globalThis.navigator)globalThis.navigator={};

const entry=new URL('../dist/game.js',import.meta.url);
const source=(await readFile(entry,'utf8')).replace('const reducedMotion','let reducedMotion').replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${new URL(path,entry).href}'`);
// This adapter only exposes state to the test; it is not part of the shipped game.
const adapter=`
export function setup(level=1,width=390,height=844,motion=false){
  viewport=displayMetrics(width,height,1);selectedMode='campaign';currentLevel=level;
  campaignOffer=null;pendingCampaignUpgrade=null;campaignAttemptId=null;campaignRecorded=false;
  transfer=null;controlFlight=null;uiAnchor=null;modal=null;paused=false;result=null;feedbackDemo=false;drag=null;choicePress=null;
  reducedMotion=motion;settings.expressions=false;settings.juice=0;skinUnlock=null;releaseOverlay=0;pauseOnArrival=false;
  campaignProgress=normalizeProgress({version:3,unlocked:100,completed:0});
  selector=new LevelSelector(width,height,100);home=new HomeWorld(width,height,'campaign');screen='levels';world=null;
  boot();scene=game.scene;scene.g=new Proxy({clear(){}},{get:(target,key)=>target[key]||(()=>{})});
  scene.add={text(){return new Proxy({destroy(){}},{get:(target,key)=>target[key]||function(){return this;}});}};
  return state();
}
export function state(){return {world,scene,screen,modal,paused,transfer,uiAnchor,campaignOffer,campaignAttemptId,campaignProgress,result};}
export const offer=offerCampaign;
export const bind=bindInput;
export const cancel=leaveCampaignOffer;
export const restart=restartGame;
export const pause=openPause;
export const resume=resumeGame;
export const homeScreen=showHome;
export const checkpoint=checkpointCampaign;
export function markResult(outcome){world.completed=outcome==='win';world.phase='over';saveCampaignResult(outcome);}
export function tick(dt=1/60){scene.update((scene.inputClock+dt)*1000,dt*1000);return state();}
export function resize(width,height){viewport=displayMetrics(width,height,1);world.resize(width,height);}
`;
const app=await import('data:text/javascript;base64,'+Buffer.from(source+adapter).toString('base64'));
function advance(seconds){for(let n=0;n<Math.ceil(seconds*60);n++)app.tick();return app.state();}
function canvasInput(){
  const handlers=new Map(),captures=new Set(),canvas={addEventListener:(name,fn)=>handlers.set(name,fn),getBoundingClientRect:()=>({left:0,top:0,width:390,height:844}),
    setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id)};
  app.bind(canvas);
  return (type,x,y)=>handlers.get(type)({clientX:x,clientY:y,pointerId:1,isPrimary:true,button:0,timeStamp:app.state().scene.inputClock*1000,preventDefault(){}});
}
function action(action,upgrade,detail=1){for(const fn of listeners.get('click'))fn({detail,target:{closest:()=>({dataset:{action,upgrade}})}});}
function physicalChoice(index=0){
  const {world}=app.state(),choice=world.choices[index],input=canvasInput(),p=world.player;
  const dx=p.x-choice.x,dy=p.y-choice.y,length=Math.hypot(dx,dy);
  input('pointerdown',p.x,p.y);input('pointermove',p.x+dx/length*world.maxPull,p.y+dy/length*world.maxPull);
  input('pointerup',p.x+dx/length*world.maxPull,p.y+dy/length*world.maxPull);
  return choice.id;
}

test('both reward choices are reached by normal physical shooting across all five modes and viewport shapes',()=>{
  for(const level of [1,3,5,7,9])for(const [width,height] of [[390,844],[844,390],[320,568],[1024,768]])for(const choiceIndex of [0,1]){
    const w=new CampaignOfferWorld(width,height,levelConfig(level),campaignUpgradeChoices(level,()=>.3));
    const candidates=w.choices.map(c=>c.id);assert.equal(w.mode,'campaign');assert.equal(w.choose(w.choices[choiceIndex]),false);
    for(let t=0;t<1.3;t+=1/120)w.step(1/120);
    assert.equal(w.phase,'choose');const c=w.choices[choiceIndex],dx=w.player.x-c.x,dy=w.player.y-c.y,d=Math.hypot(dx,dy);
    w.beginPull();assert.ok(w.shoot(dx/d*w.maxPull,dy/d*w.maxPull));
    assert.equal(w.selectedUpgrade,null,'a launch itself cannot apply the buff');
    for(let t=0;t<3;t+=1/120)w.step(1/120);
    assert.equal(w.selectedUpgrade,candidates[choiceIndex],`${level} ${width} ${choiceIndex}`);
    assert.equal(w.phase,'offer-complete');assert.equal(w.enemies.length,0);assert.equal(w.score,0);assert.equal(w.totalKills,0);
    assert.equal(w.events.filter(e=>e.type==='buff').length,1);assert.equal(w.events.filter(e=>e.type==='campaignOfferComplete').length,1);
  }
});

test('actual Scene uses physical dragging, delays the attempt until collision confirmation and scales into the real level',()=>{
  app.setup();const beforeEndless=saved.get('qiuqiule-endless');app.offer(1);
  let state=app.state();assert.ok(state.world.isCampaignOffer);assert.equal(state.campaignAttemptId,null);
  const offerRadius=state.world.player.r;advance(2.1);const selected=physicalChoice(1);
  assert.equal(app.state().campaignAttemptId,null);
  for(let n=0;n<150&&app.state().world.isCampaignOffer;n++)app.tick();
  state=app.state();assert.ok(!state.world.isCampaignOffer);assert.equal(state.world.upgradeId,selected);assert.ok(state.campaignAttemptId);
  assert.ok(state.transfer);assert.equal(state.transfer.from.r,offerRadius);assert.equal(state.transfer.target,'arena');
  advance(.8);assert.equal(app.state().paused,false);assert.equal(app.state().transfer,null);
  assert.equal(saved.get('qiuqiule-endless'),beforeEndless);
});

test('reward labels and tapped reward balls never bypass collision; keyboard activation launches rather than selects',()=>{
  app.setup();app.offer(3);advance(2.1);const before=app.state().world,c=before.choices[0];
  action('campaign-upgrade',c.id,1);assert.equal(before.selectedUpgrade,null);assert.equal(before.player.vx,0);
  const input=canvasInput();input('pointerdown',c.x,c.y);input('pointerup',c.x,c.y);assert.equal(before.selectedUpgrade,null);
  action('campaign-upgrade',c.id,0);assert.equal(before.selectedUpgrade,null);assert.ok(Math.hypot(before.player.vx,before.player.vy)>0);
  advance(2);assert.equal(app.state().world.upgradeId,c.id);
});

test('cancel breathes out, creates no attempt and reopening retains the exact two candidates',()=>{
  app.setup();app.offer(5);advance(2.1);const w=app.state().world,ids=w.choices.map(c=>c.id);
  app.cancel();app.tick();assert.equal(w.phase,'offer-exit');assert.ok(w.choices[0].born>0&&w.choices[0].born<1);
  assert.equal(app.state().screen,'play');advance(1.1);assert.equal(app.state().screen,'levels');
  assert.equal(app.state().campaignAttemptId,null);assert.equal(levelRecord(app.state().campaignProgress,5).attempts,0);
  app.offer(5);assert.deepEqual(app.state().world.choices.map(c=>c.id),ids);
});

test('pause, background and restart preserve frozen offer state and never write abandonment',()=>{
  app.setup();app.offer(7);advance(2.1);let state=app.state();const ids=state.world.choices.map(c=>c.id),clock=state.world.phaseTime;
  app.pause();advance(.7);assert.equal(app.state().modal,'pause');advance(.6);assert.equal(app.state().world.phaseTime,clock);
  app.restart();advance(2.6);state=app.state();assert.ok(state.world.isCampaignOffer);assert.deepEqual(state.world.choices.map(c=>c.id),ids);
  assert.equal(levelRecord(state.campaignProgress,7).attempts,0);assert.equal(levelRecord(state.campaignProgress,7).abandoned,0);
  document.hidden=true;for(const fn of listeners.get('visibilitychange'))fn();advance(.7);document.hidden=false;
  assert.equal(app.state().modal,'pause');app.resume();advance(.6);assert.equal(app.state().paused,false);
});

test('home from offer pause returns the same player through a continuous transfer without a results screen',()=>{
  app.setup();app.offer(9);advance(2.1);app.pause();advance(.7);action('home');advance(1.6);
  const state=app.state();assert.equal(state.screen,'home');assert.equal(state.world,null);assert.equal(state.result,null);assert.equal(state.modal,null);
  assert.equal(levelRecord(state.campaignProgress,9).attempts,0);
});

test('a real failed run clears retained offers while manual restart retains candidates and failure count',()=>{
  app.setup();app.offer(1);advance(2.1);const ids=app.state().world.choices.map(c=>c.id);physicalChoice();advance(2);
  app.restart();advance(2.7);assert.deepEqual(app.state().world.choices.map(c=>c.id),ids);
  physicalChoice();advance(2);app.markResult('loss');let record=levelRecord(app.state().campaignProgress,1);
  assert.deepEqual(record.offerChoices,[]);assert.equal(record.failStreak,1);
  app.restart();advance(2.7);assert.ok(app.state().world.isCampaignOffer);assert.equal(levelRecord(app.state().campaignProgress,1).failStreak,1);
});

test('rotation and reduced motion retain valid reward targets, candidates and collision-only completion',()=>{
  app.setup(100,390,844,true);app.offer(100);advance(.4);app.resize(844,390);advance(1.5);
  let w=app.state().world;assert.ok(w.isCampaignOffer);assert.equal(w.phase,'choose');
  for(const c of w.choices){assert.ok(c.x-c.r>w.arenaBounds.left);assert.ok(c.y-c.r>w.arenaBounds.top);}
  const id=w.choices[1].id;assert.ok(w.launchTo(id));advance(2);assert.equal(app.state().world.level,100);assert.equal(app.state().world.upgradeId,id);
});

test('early entry cancellation and confirmation cancellation never brighten the offer or jump floating labels',()=>{
  for(const phase of ['transition','reward']){
    const w=new CampaignOfferWorld(390,844,levelConfig(1),campaignUpgradeChoices(1,()=>.3));
    if(phase==='transition')w.step(.09);
    else{
      for(let t=0;t<1.8;t+=1/120)w.step(1/120);
      w.launchTo(w.choices[0].id);
      for(let n=0;n<300&&w.phase==='choose';n++)w.step(1/120);
      w.step(.1);
    }
    const before=w.presentationAlpha,phaseTime=w.phaseTime,bob=w.choices[0].departureBob||0;
    assert.ok(before>0&&before<1);assert.equal(w.leave(),true);assert.equal(w.presentationAlpha,before);
    if(phase==='reward'){
      const t=Math.min(1,phaseTime/.22);assert.ok(Math.abs(w.choices[0].departureBob-bob*(1-t*t*(3-2*t)))<1e-10);
    }
    let previous=before;
    for(let n=0;n<23;n++){w.step(.01);assert.ok(w.presentationAlpha<=previous+1e-10);previous=w.presentationAlpha;}
    assert.equal(w.presentationAlpha,0);
  }
});

test('offer to square campaign and restart to selection interpolate every border frame without changing collision bounds',()=>{
  for(const [width,height] of [[390,844],[844,390]]){
    app.setup(5,width,height);app.offer(5);advance(2.1);
    const offer=app.state().world;offer.launchTo(offer.choices[0].id);
    const samples=[];
    for(let n=0;n<300&&app.state().world.isCampaignOffer;n++){samples.push({...app.state().scene.lastBorder});app.tick();}
    const {world,scene}=app.state(),bounds={...world.arenaBounds};
    assert.ok(scene.campaignFrameTransfer);assert.ok(scene.campaignArrival);assert.equal(scene.campaignArrival.elapsed,1/60);
    let previous=scene.lastBorder;
    for(let n=0;n<42;n++){
      app.tick();const current=scene.lastBorder;
      for(const key of ['left','top','right','bottom'])assert.ok(Math.abs(current[key]-previous[key])<22,`${width} entry ${n} ${key} ${current[key]} <- ${previous[key]}`);
      assert.deepEqual(world.arenaBounds,bounds,'frame animation never moves any collision wall');previous=current;
    }
    assert.equal(scene.campaignFrameTransfer,null);assert.equal(scene.campaignArrival,null);
    assert.ok(Math.abs(scene.lastBorder.top-(bounds.top-1))<1e-8);
    const initial={...scene.lastBorder};app.restart();app.tick();
    for(const key of ['left','top','right','bottom'])assert.ok(Math.abs(scene.lastBorder[key]-initial[key])<1e-8,`restart first ${key}`);
    previous=scene.lastBorder;
    for(let n=0;n<38;n++){
      app.tick();for(const key of ['left','top','right','bottom'])assert.ok(Math.abs(scene.lastBorder[key]-previous[key])<22,`restart ${key}`);
      previous={...scene.lastBorder};
    }
  }
});

test('leaving a flying offer brakes its momentum smoothly before the menu transfer',()=>{
  const w=new CampaignOfferWorld(390,844,levelConfig(3),campaignUpgradeChoices(3,()=>.3));
  for(let t=0;t<1.3;t+=1/120)w.step(1/120);
  w.shoot(-w.maxPull,0);const x=w.player.x,speed=Math.hypot(w.player.vx,w.player.vy);
  w.leave();assert.equal(Math.hypot(w.player.vx,w.player.vy),speed);
  w.step(.001);assert.ok(w.player.x>x);assert.ok(Math.hypot(w.player.vx,w.player.vy)>speed*.97);
  const first=Math.hypot(w.player.vx,w.player.vy);w.step(.1);assert.ok(Math.hypot(w.player.vx,w.player.vy)<first*.3);
});
