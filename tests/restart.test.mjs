import {createSvgNode,isSvgMount} from './fixtures/svg-dom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {skinContour} from '../dist/skins.js';
import {UPGRADE_DEFINITIONS,UPGRADES} from '../dist/upgrades.js';
import {impactShards} from '../dist/feedback.js';
import {World,BOSS_TIMING} from '../dist/physics.js';
import {GameAudio} from '../dist/audio.js';
import {crownOutline} from '../dist/boss-visuals.js';
import {upgradeAppearance} from '../dist/upgrade-render.js';
import {loadAppearance} from '../dist/wardrobe.js';

// Run the real entry module and scene with DOM/audio/Phaser boundaries stubbed.
const elements=new Map(),listeners=new Map(),windowListeners=new Map(),saved=new Map();
function element(selector){
  if(elements.has(selector))return elements.get(selector);
  if(isSvgMount(selector)){const mount=createSvgNode('http://www.w3.org/2000/svg','g');elements.set(selector,mount);return mount;}
  const classes=new Set();
  const e={hidden:false,inert:false,children:[],dataset:{},listeners:new Map(),style:{setProperty(name,value){this[name]=value;},removeProperty(name){delete this[name];}},
    classList:{add:(...names)=>names.forEach(x=>classes.add(x)),remove:(...names)=>names.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle(x,on){on?classes.add(x):classes.delete(x);}},
    attributes:{},setAttribute(k,v){this.attributes[k]=v;},getAttribute(k){return this.attributes[k]??null;},removeAttribute(k){delete this.attributes[k];},addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);},focus(){},replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},
    firstElementChild:{style:{}},lastElementChild:{style:{}},
    querySelector:child=>element(selector+' '+child),
    getBoundingClientRect(){
      if(selector==='#feedback-demo'&&classes.has('demo-compact')){
        const {width,height}=this.testViewport||{width:window.innerWidth,height:window.innerHeight};
        return {x:width/2-52,y:height-60,left:width/2-52,right:width/2+52,top:height-60,bottom:height-20,width:104,height:40};
      }
      if(selector==='#wardrobe-panel .wardrobe-preview'){
        const width=Math.min(window.innerWidth-48,416),height=150,left=(window.innerWidth-width)/2,top=120;
        return {x:left,y:top,left,right:left+width,top,bottom:top+height,width,height};
      }
      const [x,y,width,height]=selector==='#over-ball'?[96,320,72,72]:selector==='#pause-ball'?[110,200,64,64]:selector==='#run-upgrades-ball'?[68,132,42,42]:selector==='#skin-unlock-ball'?[141,370,108,108]:[0,0,390,844];
      return {x,y,width,height,top:y,bottom:y+height,left:x,right:x+width};
    }};
  if(selector==='#result-reason'){e.hidden=true;e.textContent='';}
  elements.set(selector,e);return e;
}
globalThis.window={innerWidth:390,innerHeight:844,devicePixelRatio:2,
  addEventListener(type,fn){if(!windowListeners.has(type))windowListeners.set(type,[]);windowListeners.get(type).push(fn);},
  removeEventListener(type,fn){windowListeners.set(type,(windowListeners.get(type)||[]).filter(handler=>handler!==fn));}};
// Reuse the window-listener fixture so fresh game instances also isolate navigation handlers.
window.navigation={addEventListener:(type,fn)=>window.addEventListener('navigation:'+type,fn)};
globalThis.localStorage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
globalThis.Phaser={AUTO:0,Scale:{NONE:0},Scene:class{constructor(){this.cameras={main:{setBackgroundColor(){}}};}},Game:class{constructor(config){this.scene=new config.scene();}}};
window.Phaser=globalThis.Phaser;
globalThis.matchMedia=()=>({matches:false});
globalThis.getComputedStyle=()=>({paddingTop:'0',paddingBottom:'0',borderTopWidth:'0',borderBottomWidth:'0',marginBottom:'0'});
globalThis.requestAnimationFrame=fn=>fn();
let createdElementCount=0;
globalThis.document={createElementNS:createSvgNode,readyState:'loading',hidden:false,hasFocus:()=>true,documentElement:element('html'),createElement:tag=>element(`created-${tag}-${++createdElementCount}`),
  querySelector:element,
  querySelectorAll:selector=>selector==='.menu-panel'?['#settings-panel','#help-panel','#menu-transition-panel'].map(element):[],
  addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);}};
if(!globalThis.navigator)globalThis.navigator={};

const entry=new URL('../dist/game.js',import.meta.url);
const source=(await readFile(entry,'utf8')).replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${new URL(path,entry).href}'`);
// This adapter only exposes state to the test; it is not part of the shipped game.
const adapter=`
export function seedRestart(origin){
  aimMetrics=normalizeAimMetrics(null);runAimHoldDuration=1.2;
  endlessProgress=normalizeEndless(null,best);runDay=createEndlessRun('2030-01-01');runNewRecord=false;recordPulse=recordCue=0;recordedStatsKey='';
  world=new World(viewport.width,viewport.height,runDay.random);
  Object.assign(world,{stage:16,time:180,score:7650,stageKills:32,density:3,energy:4,breathTime:1,bank:2,pullStartSpeed:5});
  world.buffs={growth:2,energy:4,density:3,breath:1};world.player.r*=1.4;
  world.enemies.forEach(b=>{b.born=1;b.solid=true;});world.phase=origin==='over'?'over':'battle';
  scene={g:{clear(){this.cleared=true;}},effects:[{type:'old-particle'}],accumulator:.004,clock:180,hitSoundAt:179};
  screen='play';modal=origin;paused=true;result=origin==='over'?{clock:12,bounceTime:.57}:null;
  uiAnchor=origin;releaseOverlay=1;pauseOnArrival=true;drag={dx:50,dy:20};transfer=null;controlFlight=null;
  $('#control-transfers').children=[{}];$('#ui-ball').hidden=false;$('#result-shadow').hidden=false;
  $('.result-actions').classList.add('arriving');$('#choice-labels').replaceChildren(document.createElement('div'));
  return world;
}
export const advanceUi=updateUiBall;
export const sourcePose=currentPlayerPose;
export function readRestart(){return {world,scene,screen,modal,paused,result,transfer,controlFlight,uiAnchor,releaseOverlay,pauseOnArrival,drag,choicePress};}
export function seedRenderer(graphics,width=390,height=844,arena=false,keepSave=false){
  if(!keepSave&&typeof runSaveStore!=='undefined')runSaveStore.remove();
  if(typeof pendingRunSnapshot!=='undefined')pendingRunSnapshot=null;
  if(typeof restoredView!=='undefined')restoredView=null;
  if(typeof resumeSlowRemaining!=='undefined')resumeSlowRemaining=0;
  starTrailState=normalizeStarTrailState({unlocked:9});starTrailTween=null;starTrailOverride=null;starTrailClock=0;scene?.starParticles?.clear();
  clearChoicePress();aimMetrics=normalizeAimMetrics(null);runAimHoldDuration=1.2;
  $('#feedback-demo').testViewport={width,height};
  // Generic rendering fixtures already own star trails and isolate celebrations.
  // Progression tests explicitly seed empty ownership and enable record effects.
  endlessProgress=normalizeEndless(null,best);runDay=createEndlessRun('2030-01-01');runBest=Number.MAX_SAFE_INTEGER;runNewRecord=false;recordPulse=recordCue=0;recordedStatsKey='';feedbackDemo=false;
  menuTransition=null;wardrobeShowcase=null;
  viewport=displayMetrics(width,height,1);home=new HomeWorld(width,height);
  world=arena?new World(width,height,runDay.random):null;screen=arena?'play':'home';
  modal=null;paused=false;transfer=null;controlFlight=null;uiAnchor=null;result=null;drag=null;releaseOverlay=0;pauseOnArrival=false;homeReveal=1;
  settings.expressions=false;boot();scene=game.scene;scene.g=graphics;scene.testLabels=[];
  scene.add={text(x,y,text,style){
    const label={x,y,text,style,visible:true,alpha:1,destroyed:false,
      setOrigin(x,y=x){this.origin={x,y};return this;},setScale(value){this.scale=value;return this;},setDepth(value){this.depth=value;return this;},
      setVisible(value){this.visible=value;return this;},setAlpha(value){this.alpha=value;return this;},
      setText(value){this.text=String(value);return this;},setFontSize(value){this.style.fontSize=value;return this;},
      setColor(value){this.style.color=value;return this;},setStyle(value){Object.assign(this.style,value);return this;},
      setPosition(x,y){this.x=x;this.y=y;return this;},destroy(){this.destroyed=true;}};
    scene.testLabels.push(label);return label;
  }};
  return {home,world,scene};
}
export function enterFromHome(){
  home.launchToPlay();while(home.phase==='flight')home.step(1/120);
  screen='entering';home.phaseTime=1.4;home.player.lookX=.1;home.player.lookY=-.08;
}
export const bindCanvas=bindInput;
export const readHome=()=>home;
export const expressionEnabled=()=>settings.expressions;
export const setExpressionEnabled=value=>{settings.expressions=value;};
export const playerInk=()=>hex(settings.player);
export const feedbackInk=()=>playerFeedbackColor();
export function setPlayerInk(value){const previous=settings.player;settings.player=value;return previous;}
export function recordTones(){
  const calls=[],original=sound.tone;sound.tone=(...args)=>calls.push(args);
  return {calls,restore(){sound.tone=original;}};
}
export function recordBossVictory(){
  const calls=[],original=sound.bossVictory;sound.bossVictory=(...args)=>calls.push(args);
  return {calls,restore(){sound.bossVictory=original;}};
}
export function recordFeedbackAudio(){
  const calls=[],originals={};
  for(const name of ['setCharge','stopCharge','impact','launch','wall','bossDefeat','rewardHit','shockwave']){
    originals[name]=sound[name];sound[name]=(...args)=>calls.push({name,args});
  }
  return {calls,restore(){Object.assign(sound,originals);}};
}
export function recordClearAudio(){
  const calls=[],originals={};
  for(const name of ['clearStart','clearEnd']){originals[name]=sound[name];sound[name]=(...args)=>calls.push({name,args});}
  return {calls,restore(){Object.assign(sound,originals);}};
}
export function setFeedbackStrength(value){settings.juice=value;syncFeedbackSettings();}
export const readFeedbackSettings=()=>({...settings});
export function resetScoreHud(){lastScore=-1;scoreFeedback.reset(world.score);updateHud();}
export const updateScoreHud=updateHud;
export const runFeedbackDemo=startFeedbackDemo;
export const installDemoControls=installFeedbackDemo;
export const isFeedbackDemo=()=>feedbackDemo;
export const prepareNormalGame=prepareGame;
export const readAimStats=aimStatistics;
export function seedAimStats(raw,{hold=1.2}={}){aimMetrics=normalizeAimMetrics(raw);runAimHoldDuration=hold;}
export function seedBest(value){const previous=best;best=value;endlessProgress=normalizeEndless({...endlessProgress,best:value,daily:[]});return previous;}
export function seedEndless(raw=null,{date='2030-01-01',recordEffects=true}={}){endlessProgress=normalizeEndless(raw);best=endlessProgress.best;runBest=recordEffects?best:Number.MAX_SAFE_INTEGER;runDay=createEndlessRun(date);runNewRecord=false;recordPulse=recordCue=0;recordedStatsKey='';}
export function readEndless(){return {progress:endlessProgress,runDay,runBest,runNewRecord,recordPulse,recordCue};}
export const saveEndless=saveEndlessProgress;
export function seedCircle(){
  playerContour=skinContour(0);skinOverride=null;skinUnlock=null;wardrobeShowcase=null;lastUiPose=null;appearance=null;appearanceUrl=null;appearanceLoading=false;
  appearanceState=normalizeAppearanceState(null);appearanceTween=null;appearanceOverride=null;
  starTrailState=normalizeStarTrailState({unlocked:9});starTrailTween=null;starTrailOverride=null;starTrailClock=0;scene?.starParticles?.clear();
}
export function readPlayerShape(){return {playerContour,skinOverride,skinUnlock,lastUiPose,active:activeContour()};}
export const advanceSkin=updateSkin;
export function bindPhotoRenderer(renderer){photoRenderer=renderer;}
export function recordPlayerPhoto(){
  const previous={appearance,photoCanvas,photoRenderer,appearanceState,appearanceTween,appearanceOverride},calls=[];
  appearance={};appearanceState=normalizeAppearanceState({selected:'custom'},{hasImage:true});appearanceTween=null;appearanceOverride=null;photoCanvas={style:{}};
  photoRenderer={hide(){},draw(contour,pose,options){calls.push({contour,pose:{...pose},options});}};
  return {calls,restore(){({appearance,photoCanvas,photoRenderer,appearanceState,appearanceTween,appearanceOverride}=previous);}};
}
export function recordCompositePhotos(success){
  const previous={appearance,photoCanvas,photoRenderer,auxiliaryPhotos,appearanceState,appearanceTween,appearanceOverride},main=[],aux=[],hidden=[],visible=new Set();
  appearance={};appearanceState=normalizeAppearanceState({selected:'custom'},{hasImage:true});appearanceTween=null;appearanceOverride=null;photoCanvas={style:{}};
  photoRenderer={hide(){visible.delete('main');},draw(contour,pose,options){main.push({contour,pose:{...pose},options});visible.add('main');return success;},setImage(){}};
  auxiliaryPhotos={hide(){hidden.push(true);for(const slot of visible)if(typeof slot==='number')visible.delete(slot);},draw(slot,contour,pose,options){aux.push({slot,contour,pose:{...pose},options});visible.add(slot);return success;},setImage(){},dispose(){for(const slot of visible)if(typeof slot==='number')visible.delete(slot);}};
  return {main,aux,hidden,visible,restore(){({appearance,photoCanvas,photoRenderer,auxiliaryPhotos,appearanceState,appearanceTween,appearanceOverride}=previous);}};
}
export function mountSceneBoundary(canvas,graphics){
  const originalSkins=initializeSkins,originalCreate=document.createElement;
  initializeSkins=()=>{};
  document.createElement=tag=>tag==='canvas'?{getContext:()=>null}:originalCreate(tag);
  scene.game={canvas};scene.textures={addCanvas(){}};
  scene.scale={setZoom(){},resize(){}};scene.events={once(){}};
  scene.add.graphics=()=>graphics;scene.add.image=()=>({setVisible(){return this;}});
  scene.cameras.main.setSize=()=>{};
  try{scene.create();}finally{initializeSkins=originalSkins;document.createElement=originalCreate;}
}
export function mountInitialScene(canvas,graphics){
  scene=game.scene;scene.add={};
  mountSceneBoundary(canvas,graphics);
  return {world,home,scene};
}
export const applyAppearance=setAppearance;
export function hydrateAppearanceForTest(url){appearanceLoading=true;return setAppearance(url,false,appearanceRevision);}
export const imageIsLoadingForTest=()=>appearanceLoading;
export const hidePhotoForFrame=clearPhoto;
export function readAppearance(){return {appearance,appearanceUrl};}
export function seedAppearanceState(raw=null,{hasImage}={}){
  appearanceLoading=false;appearanceState=normalizeAppearanceState(raw,{hasImage});appearanceTween=null;appearanceOverride=null;
  return appearanceState;
}
export function readAppearancePresentation(){return {state:appearanceState,tween:appearanceTween,override:appearanceOverride,layers:appearanceLayers(),wardrobeTime,wardrobeShowcase};}
export const chooseAppearanceForTest=chooseAppearance;
export const grantAppearanceForTest=grantEndlessAppearance;
export const showResultForTest=openResult;
export function seedWardrobePresentation(time=.75){
  screen='home';modal='wardrobe';uiAnchor='wardrobe';transfer=null;skinUnlock=null;wardrobeShowcase=null;wardrobeTime=time;home.phase='external';
  return currentPlayerPose();
}
export const openWardrobeForTest=openWardrobe;
export const navigateWardrobeForTest=navigateWardrobePreview;
export const readShowcaseForTest=()=>({state:wardrobeShowcase,pose:currentPlayerPose(),lastUiPose,start:anchorPose('wardrobe-start'),end:anchorPose('wardrobe-trail')});
export function bindWardrobeControls(controls){const previous=wardrobeUi;wardrobeUi=controls;return ()=>{wardrobeUi=previous;};}
export const paintUiForTest=paintUiBall;
export const drawPlayerForTest=drawBall;
export function seedStarTrails(raw=null,{highestStage=0}={}){
  starTrailState=normalizeStarTrailState(raw,{highestStage});starTrailTween=null;starTrailOverride=null;starTrailClock=0;scene?.starParticles?.clear();return starTrailState;
}
export function readStarTrails(){return {state:starTrailState,tween:starTrailTween,clock:starTrailClock,layers:starTrailLayers()};}
export const chooseStarTrailForTest=chooseStarTrail;
export const advanceStarTrails=updateStarTrailVisual;
export const grantStarTrailsForTest=grantEndlessStarTrails;



export const startWithFont=bootWithFont;
export const saveRunForTest=()=>saveCurrentRun();
export const leaveRunForTest=()=>leaveGame();
export const continueRunForTest=()=>continueSavedRun();
export const chooseRunForTest=id=>chooseRun(id);
export const showRunChoiceForTest=()=>showRunChoice();
export const savedRunForTest=()=>runSaveStore.read();
export const decodedRunForTest=()=>restoreRunSnapshot(runSaveStore.read());
export const removeRunForTest=()=>runSaveStore.remove();
export const resumeSecondsForTest=()=>resumeSlowRemaining;
export function seedRunMetadataForTest(){
  runBest=2400;runNewRecord=true;recordPulse=.21;recordCue=.16;recordedStatsKey='saved-stats-key';runAimHoldDuration=.9;
}
export const readRunMetadataForTest=()=>({runBest,runNewRecord,recordPulse,recordCue,recordedStatsKey,runAimHoldDuration});

`;
const app=await import('data:text/javascript;base64,'+Buffer.from(source+adapter).toString('base64'));

function clickRestart(){
  for(const fn of listeners.get('click'))fn({target:{closest:()=>({dataset:{action:'restart'}})},detail:1});
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('public bootstrap waits for the normal UI font before creating the first game scene',async t=>{
  const oldFonts=document.fonts,OriginalGame=Phaser.Game;let created=0,finishLoad,finishReady;
  Phaser.Game=class extends OriginalGame{constructor(config){super(config);created++;}};
  document.fonts={
    load(font,text){
      assert.equal(font,'400 16px GameSans');assert.match(text,/球/);assert.match(text,/0123456789/);
      return new Promise(resolve=>finishLoad=resolve);
    },
    ready:new Promise(resolve=>finishReady=resolve)
  };
  t.after(()=>{Phaser.Game=OriginalGame;if(oldFonts===undefined)delete document.fonts;else document.fonts=oldFonts;});
  const starting=app.startWithFont();
  await Promise.resolve();assert.equal(created,0,'no canvas text can be drawn before the face loads');
  finishLoad([]);await Promise.resolve();assert.equal(created,0,'layout also waits for the font set to settle');
  finishReady();await starting;assert.equal(created,1);
});

test('font loading failure or a WebView without FontFaceSet still starts the game',async t=>{
  const oldFonts=document.fonts,OriginalGame=Phaser.Game;let created=0;
  Phaser.Game=class extends OriginalGame{constructor(config){super(config);created++;}};
  t.after(()=>{Phaser.Game=OriginalGame;if(oldFonts===undefined)delete document.fonts;else document.fonts=oldFonts;});
  document.fonts={load:()=>Promise.reject(new Error('font unavailable')),ready:Promise.resolve()};
  await app.startWithFont();assert.equal(created,1);
  delete document.fonts;
  await app.startWithFont();assert.equal(created,2);
});

test('cold home bootstrap renders its first frames before any gameplay world or reward state exists',async()=>{
  const previousMode=saved.get('qiuqiule-mode');
  try{
    for(const mode of ['campaign','endless'])for(const reduced of [false,true]){
      saved.set('qiuqiule-mode',JSON.stringify(mode));
      await withReloadedEntry(null,reduced,async fresh=>{
        assert.equal(fresh.readRestart().world,undefined);
        assert.equal(fresh.readRestart().scene,undefined);
        await fresh.startWithFont();
        const graphics=graphicsRecorder(),canvas={style:{},addEventListener(){}};
        const {world,home,scene}=fresh.mountInitialScene(canvas,graphics);
        assert.equal(world,undefined,'startup must not be replaced by a null-world renderer fixture');
        assert.equal(scene.rewardVisuals,undefined);
        assert.equal(home.mode,'endless');assert.deepEqual(home.targets.map(target=>target.id),['play','settings','wardrobe','sound']);
        for(const stamp of [0,1000/60,2000/60]){
          assert.doesNotThrow(()=>scene.update(stamp,1000/60));
          assert.ok(bodyShapes(graphics).length>0,'the player must be drawn on the fresh homepage');
          assert.ok(graphics.borders.length>0);
          assert.ok(graphics.shapes.length>20,'the functional balls and their icons must render too');
        }
        assert.equal(fresh.readRestart().world,undefined,'rendering home must not start a game');
      });
    }
  }finally{
    if(previousMode===undefined)saved.delete('qiuqiule-mode');else saved.set('qiuqiule-mode',previousMode);
  }
});

test('the public home exposes only play, settings, wardrobe and sound, and its play route always starts endless',async()=>{
  const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  assert.doesNotMatch(html,/id="home-mode"|data-action="(?:mode|home-mode)"|id="levels-view"|id="campaign-preflight"/);
  for(const [width,height] of [[390,844],[844,390],[320,568]]){
    const {scene,home}=app.seedRenderer(graphicsRecorder(),width,height);
    assert.deepEqual(home.targets.map(target=>target.id),['play','settings','wardrobe','sound']);
    assert.equal(home.layout.others.length,3);assert.equal(home.launchTo('mode'),false);
    home.launchToPlay();advanceScene(scene,3);
    const {world,screen}=app.readRestart();assert.equal(screen,'play');assert.ok(world instanceof World);
    assert.equal(world.stage,1);assert.equal(world.startingUpgrades,true);assert.equal(world.choices.length,3);
  }
});

test('appearance replacement and removal invalidate cached images while ordinary frames only hide them',async t=>{
  const originalImage=globalThis.Image,calls=[];
  globalThis.Image=class{async decode(){}};
  const renderer={setImage:image=>calls.push(['image',image]),hide:()=>calls.push(['hide'])};
  app.bindPhotoRenderer(renderer);
  t.after(()=>{globalThis.Image=originalImage;app.bindPhotoRenderer(null);app.seedCircle();});
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
  t.after(()=>{globalThis.Image=originalImage;app.bindPhotoRenderer(null);app.seedCircle();saved.delete('qiuqiule-appearance');});
  const pending=app.applyAppearance('data:image/png;base64,b2xk',true);
  await app.applyAppearance(null,true);decoded();await pending;
  assert.deepEqual(calls,[null]);
  assert.deepEqual(app.readAppearance(),{appearance:null,appearanceUrl:null});
  assert.equal(JSON.parse(saved.get('qiuqiule-appearance')).image,null);
});
test('a failed replacement cannot cancel startup decoding of the existing saved custom image',async t=>{
  const originalImage=globalThis.Image,stored=new Map(saved),setItem=localStorage.setItem;
  t.after(()=>{globalThis.Image=originalImage;localStorage.setItem=setItem;app.bindPhotoRenderer(null);app.seedCircle();saved.clear();for(const [key,value]of stored)saved.set(key,value);});
  for(const failure of ['decode','storage']){
    const oldUrl='data:image/png;base64,b2xk',replacement='data:image/png;base64,bmV3';let finishOld;
    globalThis.Image=class{decode(){if(this.src===oldUrl)return new Promise(resolve=>finishOld=resolve);if(failure==='decode')return Promise.reject(Error('invalid image'));return Promise.resolve();}};
    app.seedRenderer(graphicsRecorder());app.seedCircle();app.seedAppearanceState({selected:'custom'},{hasImage:true});app.bindPhotoRenderer({setImage(){},hide(){}});
    saved.set('qiuqiule-appearance',JSON.stringify({version:1,image:oldUrl}));const pending=app.hydrateAppearanceForTest(oldUrl);
    if(failure==='storage')localStorage.setItem=()=>{throw Error('quota full');};
    await assert.rejects(app.applyAppearance(replacement,true));localStorage.setItem=setItem;
    finishOld();await pending;
    assert.equal(app.readAppearance().appearanceUrl,oldUrl);assert.ok(app.readAppearance().appearance);
    assert.equal(app.readAppearancePresentation().state.selected,'custom');assert.equal(await loadAppearance(),oldUrl);assert.equal(app.imageIsLoadingForTest(),false);
  }
});

test('an explicit original choice during startup image loading survives its late decode and keeps the custom image available',async t=>{
  const originalImage=globalThis.Image,stored=new Map(saved);let finish,decodes=0;
  globalThis.Image=class{decode(){decodes++;return new Promise(resolve=>finish=resolve);}};
  t.after(()=>{globalThis.Image=originalImage;app.bindPhotoRenderer(null);app.seedCircle();saved.clear();for(const [key,value]of stored)saved.set(key,value);});
  app.seedRenderer(graphicsRecorder());app.seedCircle();app.seedAppearanceState({selected:'custom'},{hasImage:true});app.bindPhotoRenderer({setImage(){},hide(){}});
  const url='data:image/png;base64,b2xk',pending=app.hydrateAppearanceForTest(url);
  assert.equal(app.chooseAppearanceForTest('original'),true);finish();await pending;app.advanceSkin(.3);
  assert.equal(app.readAppearancePresentation().state.selected,'original');assert.equal(JSON.parse(saved.get('qiuqiule-appearance-state')).selected,'original');
  const image=app.readAppearance().appearance;assert.ok(image);assert.equal(app.readAppearance().appearanceUrl,url);assert.equal(app.imageIsLoadingForTest(),false);
  assert.equal(app.chooseAppearanceForTest('custom'),true);assert.equal(app.readAppearance().appearance,image);assert.equal(decodes,1);
});

for(const origin of ['over','pause'])test(`${origin} restart animates only the player while a fresh world waits`,()=>{
  const previous=app.seedRestart(origin),from=app.sourcePose();
  clickRestart();
  let s=app.readRestart();const w=s.world;
  assert.notEqual(w,previous);assert.equal(previous.pullStartSpeed,null);
  assert.equal(w.stage,1);assert.equal(w.score,0);assert.equal(w.killTarget,14);assert.equal(w.stageKills,0);assert.equal(w.time,0);
  assert.equal(w.spawnTimer,Infinity);assert.equal(w.breathTime,0);assert.equal(w.bank,0);assert.equal(w.pullStartSpeed,null);
  assert.equal(w.saveUsed,false);assert.equal(w.overTimer,0);
  assert.deepEqual(w.buffs,{});assert.equal(w.choices.length,3);assert.ok(w.choices.every(choice=>choice.kind==='regular'));assert.equal(w.density,1);assert.equal(w.energy,1);
  assert.equal(w.player.r,w.unit);assert.equal(w.player.vx,0);assert.equal(w.player.vy,0);
  assert.equal(w.enemies.length,0);assert.equal(w.startingUpgrades,true);assert.equal(w.rewardSelectionsRemaining,1);
  for(const key of ['modal','result','controlFlight','uiAnchor','drag'])assert.equal(s[key],null,key);
  assert.equal(s.screen,'play');assert.equal(s.paused,true);assert.equal(s.pauseOnArrival,false);assert.equal(s.releaseOverlay,0);
  assert.equal(s.scene.g.cleared,true);assert.deepEqual(s.scene.effects,[]);
  assert.equal(s.scene.accumulator,0);assert.equal(s.scene.clock,0);assert.equal(s.scene.hitSoundAt,0);
  assert.equal(element('#control-transfers').children.length,0);
  assert.equal(element('#ui-ball').hidden,false);assert.equal(element('#result-shadow').hidden,true);
  assert.equal(element('.result-actions').classList.contains('arriving'),false);
  assert.equal(element('#modal-layer').hidden,true);assert.equal(element('#hud').hidden,false);assert.equal(element('#hud').inert,true);
  assert.equal(element('#score').textContent,'0000');assert.ok(element('#choice-labels').children.some(node=>node.className==='choice-label'));
  assert.deepEqual(s.transfer.from,from);assert.equal(s.transfer.target,'arena');assert.equal(s.transfer.duration,.4);
  const startTransform=element('#ui-ball').style.transform;
  clickRestart();assert.equal(app.readRestart().world,w);
  app.advanceUi(.2);s=app.readRestart();
  assert.equal(s.paused,true);assert.equal(w.time,0);assert.equal(w.spawnTimer,Infinity);
  assert.ok(w.enemies.every(b=>b.born===0&&!b.solid));
  assert.notEqual(element('#ui-ball').style.transform,startTransform);
  const diameter=parseFloat(element('#ui-ball').style.width);
  assert.ok(diameter>2*w.unit&&diameter<2*from.r);
  app.advanceUi(.2);s=app.readRestart();
  assert.equal(s.transfer,null);assert.equal(s.controlFlight,null);assert.equal(s.paused,false);
  assert.equal(element('#hud').inert,false);assert.equal(w.time,0);assert.equal(w.spawnTimer,Infinity);
  near(parseFloat(element('#ui-ball').style.width),2*w.player.r);
  assert.ok(element('#ui-ball').style.transform.startsWith(`translate3d(${w.player.x-w.player.r}px,${w.player.y-w.player.r}px,0)`));
  assert.ok(w.enemies.every(b=>b.born===0&&!b.solid));
  app.advanceUi(1/120);assert.equal(element('#ui-ball').hidden,true);
  w.step(1/120);assert.equal(w.phase,'transition');assert.equal(w.enemies.length,0);
});

test('backgrounding during restart keeps the fresh world paused after arrival',()=>{
  app.seedRestart('over');clickRestart();document.hidden=true;
  try{
    app.advanceUi(.65);const s=app.readRestart();
    assert.equal(s.paused,true);assert.equal(s.modal,'pause');assert.equal(s.world.time,0);
    assert.equal(s.world.spawnTimer,Infinity);assert.ok(s.world.enemies.every(b=>b.born===0&&!b.solid));
    assert.equal(s.transfer.target,'pause');assert.equal(s.controlFlight,null);
  }finally{document.hidden=false;}
});

function graphicsRecorder(){
  let points=[],color,alpha,strokeColor,strokeAlpha,strokeWidth;
  const g={shapes:[],borders:[],lines:[],clear(){this.shapes=[];this.borders=[];this.lines=[];},fillStyle(c,a=1){color=c;alpha=a;},beginPath(){points=[];},
    lineStyle(width,c,a=1){strokeWidth=width;strokeColor=c;strokeAlpha=a;},
    strokePath(){this.shapes.push({type:'stroke',color:strokeColor,alpha:strokeAlpha,width:strokeWidth,points:[...points]});},
    strokeRoundedRect(x,y,width,height,r){this.borders.push({x,y,width,height,r,strokeWidth,strokeColor,strokeAlpha});},
    lineBetween(x1,y1,x2,y2){this.lines.push({x1,y1,x2,y2,width:strokeWidth,color:strokeColor,alpha:strokeAlpha});},
    moveTo(x,y){points.push({x,y});},lineTo(x,y){points.push({x,y});},
    fillPath(){this.shapes.push({type:'path',color,alpha,points:[...points]});},
    fillTriangle(x1,y1,x2,y2,x3,y3){this.shapes.push({type:'triangle',color,alpha,points:[{x:x1,y:y1},{x:x2,y:y2},{x:x3,y:y3}]});},
    fillEllipse(x,y,width,height){this.shapes.push({type:'ellipse',color,alpha,x,y,width,height});},
    fillCircle(x,y,r){this.shapes.push({type:'circle',color,alpha,x,y,r});}};
  return new Proxy(g,{get:(target,key)=>key in target?target[key]:()=>{}});
}
const bodyShapes=g=>g.shapes.filter(s=>s.type==='path'&&s.color===0x252720&&s.alpha===1);
const eyeShapes=g=>g.shapes.filter(s=>s.color===0xf4f3eb&&s.alpha===.9);
function clickAction(action,dataset={}){
  for(const fn of listeners.get('click'))fn({target:{closest:()=>({dataset:{action,...dataset}})},detail:1});
}
function inputCanvas(width=390,height=844,module=app){
  const handlers=new Map(),captured=new Set(),captures=[],releases=[];
  const canvas={style:{},addEventListener:(type,fn)=>handlers.set(type,fn),
    setPointerCapture(id){captured.add(id);captures.push(id);},hasPointerCapture:id=>captured.has(id),releasePointerCapture(id){captured.delete(id);releases.push(id);},
    getBoundingClientRect:()=>({left:0,top:0,width,height})};
  module.bindCanvas(canvas);
  const pointer=(type,x=0,y=0,options={})=>{
    if(type==='lostpointercapture')captured.delete(options.pointerId??1);
    handlers.get(type)({pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y,timeStamp:0,preventDefault(){},...options});
  };
  return Object.assign(pointer,{canvas,captured,captures,releases});
}

test('endless aiming retains seven guide dots, its drag line and endpoint rings',()=>{
  const g=graphicsRecorder(),strokes=[],dots=[],lines=[],rings=[];let width;
  g.lineStyle=w=>{width=w;};g.strokePath=()=>strokes.push(width);
  g.fillCircle=(x,y,r)=>dots.push({x,y,r});g.lineBetween=(...points)=>lines.push(points);g.arc=(x,y,r)=>rings.push(r);
  const {world,scene}=app.seedRenderer(g,390,844,true),p=world.player,pointer=inputCanvas();
  pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+80,p.y+20);scene.update(0,0);
  assert.equal(dots.filter(d=>d.r===1.7).length,7);assert.equal(strokes.filter(w=>w===1.4).length,1);
  assert.equal(lines.length,1);assert.equal(rings.filter(r=>r===4||r===8).length,2);pointer('pointercancel');
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
  const state=app.seedRenderer(g,width,height,mode==='endless');
  const active=mode==='home'?state.home:state.world;
  return {scene:state.scene,active,player:active.player,pointer:inputCanvas(width,height)};
}

test('real drag input draws smooth hemisphere joins in home and endless at every direction',()=>{
  for(const mode of ['home','endless']){
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

test('home rebounds preserve smooth joins when the pulled hemisphere reverses direction',()=>{
  // These weak horizontal/vertical shots cannot reach a control. Each real
  // rebound reverses its pull, so the samples cover all four cardinal sides.
  for(const mode of ['home'])for(const direction of [0,6]){
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
    assert.equal(s.world.time,0);assert.equal(s.world.spawnTimer,Infinity);
    assert.ok(s.world.enemies.every(b=>b.born===0&&!b.solid));
    scene.update(0,1000/120);assert.equal(bodyShapes(g).length,1);
    assert.ok(s.world.enemies.every(b=>b.born>0&&b.born<1&&!b.solid));
  }
});

test('optional eyes persist through every home rebound frame and relax after rest',()=>{
  const g=graphicsRecorder(),{home,scene}=app.seedRenderer(g),pointer=inputCanvas();
  pointer('pointerdown');pointer('pointermove',100,0);scene.update(0,1);
  assert.ok(eyeShapes(g).every(e=>e.type==='ellipse'),'the fixture explicitly disables expressions');
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

test('endless eyes stay released after real combo kills without erasing the combo',t=>{
  const {g,world,scene}=feedbackRun(),pointer=inputCanvas();
  t.after(()=>app.setFeedbackStrength(.6));app.setExpressionEnabled(true);
  pointer('pointerdown');pointer('pointermove',0,-150);scene.update(0,1);
  assert.equal(eyeShapes(g).length,2);assert.ok(eyeShapes(g).every(eye=>eye.type==='path'));
  pointer('pointerup',0,-150);assert.equal(app.readRestart().drag,null);
  let previousScore=world.score;
  for(let kills=1;kills<=5;kills++){
    world.feedbackStep(world.player,.1,1);
    const {kill}=gradedFeedbackContact(world,{hp:1});assert.equal(kill.combo,kills);
    scene.update(0,0);
    assert.equal(world.shotKills,kills);assert.ok(world.score>previousScore);previousScore=world.score;
    assert.equal(eyeShapes(g).length,2);
    assert.ok(eyeShapes(g).every(eye=>eye.type==='ellipse'),`released eyes after ${kills} real kills`);
  }
  // Rendering a later frame must not restore the stale combo expression.
  world.feedbackTime+=30;scene.clock+=30;scene.update(0,0);
  assert.equal(world.shotKills,5);assert.equal(world.score,previousScore);
  assert.ok(eyeShapes(g).every(eye=>eye.type==='ellipse'));
});

test('endless combo kills during a pull cannot leave strained eyes after cancellation or a tap',t=>{
  t.after(()=>app.setFeedbackStrength(.6));
  for(const release of ['pointercancel','lostpointercapture','pointerup']){
    const {g,world,scene}=feedbackRun(),pointer=inputCanvas();app.setExpressionEnabled(true);
    pointer('pointerdown');pointer('pointermove',0,-150);scene.update(0,1);
    for(let n=0;n<4;n++){
      world.feedbackStep(world.player,.1,1);
      const {kill}=gradedFeedbackContact(world,{hp:1});assert.equal(kill.combo,n+1);
    }
    scene.update(0,0);assert.ok(eyeShapes(g).every(eye=>eye.type==='path'),'a held pull still strains');
    // Returning to the pointer origin makes pointerup a cancelled short pull;
    // unlike a successful shot, none of these exits resets the combo counter.
    pointer(release,0,0);scene.update(0,0);
    assert.equal(app.readRestart().drag,null);assert.equal(world.shotKills,4);
    assert.equal(eyeShapes(g).length,2);assert.ok(eyeShapes(g).every(eye=>eye.type==='ellipse'),release);
  }
});

test('endless released combo eyes stay normal across battle and boss phases',()=>{
  for(const phase of ['battle','boss-entry','boss']){
    const g=graphicsRecorder(),{world,scene}=app.seedRenderer(g,390,844,true);
    app.setExpressionEnabled(true);world.phase=phase;world.shotKills=4;
    scene.update(0,0);
    assert.equal(eyeShapes(g).length,2);assert.ok(eyeShapes(g).every(eye=>eye.type==='ellipse'),phase);
  }
});

test('expression preference survives reloading the entry module',async()=>{
  saved.set('qiuqiule-settings',JSON.stringify({expressions:true}));
  const originalListeners=new Map([...listeners].map(([type,handlers])=>[type,[...handlers]]));
  try{
    const reloaded=await import('data:text/javascript;base64,'+Buffer.from(source+adapter+'\n// reload preference').toString('base64'));
    assert.equal(reloaded.expressionEnabled(),true);
    assert.equal(element('#expressions-toggle').attributes['aria-checked'],'true');
  }finally{
    // A browser reload replaces the old document and its listeners as well.
    listeners.clear();for(const [type,handlers] of originalListeners)listeners.set(type,handlers);
  }
});


function advanceScene(scene,seconds){
  while(seconds>.05){scene.update(0,50);seconds-=.05;}
  if(seconds>1e-12)scene.update(0,seconds*1000);
}
function assertStageProgress(world){
  const progress=element('#stage-progress');
  assert.equal(progress.children.filter(dot=>dot.className.startsWith('stage-dot')).length,10);
  assert.equal(progress.children.filter(dot=>dot.className==='stage-dot filled').length,Math.floor(Math.min(1,world.stageKills/world.killTarget)*10+1e-9));
  assert.equal(progress.attributes['aria-label'],`本阶段击杀 ${world.stageKills}，目标 ${world.killTarget}`);
}
test('stable HUD frames make no DOM writes and progress updates on the same frame',t=>{
  const {world}=app.seedRenderer(graphicsRecorder(),390,844,true);
  world.phase='battle';world.score=73;world.stageKills=0;app.resetScoreHud();
  const progress=element('#stage-progress'),score=element('#score');
  const dots=[...progress.children],writes=[];
  const watch=(node,property)=>{
    let value=node[property];
    Object.defineProperty(node,property,{configurable:true,get:()=>value,set(next){value=next;writes.push(property);}});
    t.after(()=>{delete node[property];node[property]=value;});
  };
  for(const [node,props] of [[score,['textContent']],[score.style,['transform','color']],
    [progress,['hidden','innerHTML']],[element('#hud').style,['opacity']]]){
    for(const property of props)watch(node,property);
  }
  for(const dot of dots)watch(dot,'className');
  const attribute=t.mock.method(progress,'setAttribute'),remove=t.mock.method(progress,'removeAttribute'),replace=t.mock.method(progress,'replaceChildren');
  for(let frame=0;frame<60;frame++)app.updateScoreHud(1/60);
  assert.deepEqual(writes,[]);assert.equal(attribute.mock.callCount()+remove.mock.callCount()+replace.mock.callCount(),0);
  world.stageKills=1;app.updateScoreHud();
  assert.deepEqual(writes,[]);assert.equal(attribute.mock.callCount(),1,'same fill count, new accessible label');assertStageProgress(world);
  world.stageKills=2;app.updateScoreHud();
  assert.deepEqual(writes,['className']);assert.equal(replace.mock.callCount(),0);assertStageProgress(world);
  dots.forEach((dot,i)=>{assert.equal(dot,progress.children[i]);assert.equal(dot.attributes['aria-hidden'],'true');});
  score.textContent='0000';score.style.color='red';score.style.transform='scale(2)';app.updateScoreHud();
  assert.equal(score.textContent,'0073');assert.equal(score.style.color,'');assert.equal(score.style.transform,'scale(1)');
  assertStageProgress(world);
});
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
  for(const mode of ['home'])for(const expressions of [false,true]){
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

test('home breathing restarts a complete independent cycle after cancellation and a functional-ball return',t=>{
  const soundBefore=app.readFeedbackSettings().sound;t.after(()=>{if(app.readFeedbackSettings().sound!==soundBefore)clickAction('sound');});
  for(const origin of ['cancel','return']){
    const g=graphicsRecorder(),{scene,home}=app.seedRenderer(g),pointer=inputCanvas();
    home.clock=Math.PI/(2*1.3);const anchor={...home.layout.player};
    if(origin==='cancel'){
      pointer('pointerdown',home.player.x,home.player.y);pointer('pointermove',home.player.x+7,home.player.y);scene.update(0,0);
      pointer('pointercancel');scene.update(0,0);
      assert.equal(home.phase,'idle');assert.equal(home.ready,true);
    }else{
      const target=home.targets.find(b=>b.id==='sound'),p=home.player;
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
test('all returns home keep the final overlay eyes identical to the resumed canvas face',()=>{
  try{
    for(const origin of ['settings','wardrobe','over'])for(const [width,height] of [[390,844],[844,390]]){
      const g=graphicsRecorder();
      const state=app.seedRenderer(g,width,height,origin==='over');
      app.seedCircle();
      const {scene}=state;
      if(origin==='settings'||origin==='wardrobe'){
        state.home.launchTo(origin);
        for(let i=0;!app.readRestart().modal&&i<240;i++)scene.update(0,1000/120);
        assert.equal(app.readRestart().modal,origin);
        assert.ok(Math.hypot(state.home.player.lookX,state.home.player.lookY)>.01,'retain a real non-neutral launch gaze behind the menu');
        app.advanceUi(.5);clickAction('close');
      }else if(origin==='over'){
        clickAction('pause');app.advanceUi(.42);
        clickAction('home');app.advanceUi(.82);
        assert.equal(app.readRestart().modal,'over');clickAction('home');
      }
      assert.equal(app.readRestart().transfer.target,'home');
      app.advanceUi(app.readRestart().transfer.duration);
      const ui=uiContours(),endEyes=ui.eyes.map(points=>outlineBounds({points}));
      const alpha=Number(uiNode('.ui-eyes').style.opacity);
      assert.equal(app.readRestart().transfer,null);
      scene.update(0,0);
      const canvas=eyeShapes(g);assert.equal(canvas.length,2);
      canvas.forEach((eye,i)=>{
        const actual=outlineBounds(eye),expected=endEyes[i];
        for(const key of ['cx','cy','width','height'])near(actual[key],expected[key]);
        near(eye.alpha,alpha);
      });
      assert.equal(element('#ui-ball').hidden,true,'only the resumed canvas is visible');
      near(app.readHome().player.lookX,0);near(app.readHome().player.lookY,0);
    }
  }finally{app.seedCircle();}
});
function assertSameContour(actual,expected,tolerance=1e-5){
  assert.equal(actual.length,expected.length,'retain corresponding contour points');
  for(let i=0;i<actual.length;i++)assert.ok(Math.hypot(actual[i].x-expected[i].x,actual[i].y-expected[i].y)<tolerance,`contour point ${i} changed at the handoff`);
}

test('home keeps its complete independent breathing cycle and restarts it after every rebound',()=>{
  let reference;
  for(const mode of ['home']){
    const g=graphicsRecorder(),{active,player,scene,pointer}=pullScene(mode,g);
    active.clock=3.4;scene.update(0,0);
    const anchor={x:player.x,y:player.y,r:player.r},samples=[];let elapsed=0;
    for(const time of [0,.16,.5,1.3,2.7,Math.PI*2/1.3]){
      advanceScene(scene,time-elapsed);elapsed=time;
      const squash=renderedHomeSquash(g,player);samples.push(squash);near(squash,Math.sin(time*1.3)*.035);

    }
    if(reference)samples.forEach((value,i)=>near(value,reference[i]));else reference=samples;
    for(let repeat=0;repeat<2;repeat++){
      advanceScene(scene,.5);
      pointer('pointerdown',player.x,player.y);pointer('pointermove',player.x+7,player.y);scene.update(0,0);
      pointer('pointerup',player.x+7,player.y);advanceScene(scene,.819);scene.update(0,1.0000001);
      near(renderedHomeSquash(g,player),0);assert.equal(active.ready,true);
      advanceScene(scene,.3);near(renderedHomeSquash(g,player),Math.sin(.3*1.3)*.035);
      for(const key of ['x','y','r'])near(player[key],anchor[key]);

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
  world.stage=stage;world.stageKills=world.killTarget;
  for(let frame=0;['battle','clearing'].includes(world.phase)&&frame<1200;frame++)scene.update(0,1000/120);
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
  return JSON.stringify({phase:world.phase,phaseTime:world.phaseTime,time:world.time,score:world.score,killTarget:world.killTarget,stageKills:world.stageKills,
    spawnTimer:world.spawnTimer,arenaBounds:world.arenaBounds,boss:world.boss,bossCelebration:world.bossCelebration,enemies:world.enemies,choices:world.choices,
    player:{x:p.x,y:p.y,vx:p.vx,vy:p.vy,r:p.r,squash:p.squash,angle:p.angle,roll:p.roll},
    effects:scene.effects.map(e=>({life:e.life,x:e.x,y:e.y}))});
}
const bossSpiralShapes=(g,b)=>g.shapes.filter(shape=>shape.type==='stroke'&&shape.points.length>10&&shape.points.every(point=>Math.hypot(point.x-b.x,point.y-b.y)<b.r));
const bossAngryShapes=(g,b)=>g.shapes.filter(shape=>shape.type==='path'&&shape.color===0x8b5444&&shape.points.every(point=>Math.hypot(point.x-b.x,point.y-b.y)<b.r));
function assertArenaBorder(g,world){
  assert.equal(g.borders.length,1);const drawn=g.borders[0],bounds=world.arenaBounds;
  // The ordinary optical outset fades away as the Boss frame reaches its square bounds.
  const margin=1-world.arenaGeometry.blend;
  near(drawn.x,bounds.left-margin);near(drawn.y,bounds.top-margin);
  near(drawn.width,bounds.width+2*margin);near(drawn.height,bounds.height+2*margin);
  near(drawn.r,world.arenaGeometry.visualCornerRadius);
}

test('boss entry reaches a centered square in 0.85 seconds and its border agrees with axis-aligned walls',()=>{
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
    assert.equal(world.arenaGeometry.shape,'square');assert.equal(world.arenaGeometry.cornerRadius,0);
    const cases=[
      {x:bounds.left+p.r-3,y:height/2,vx:-100,vy:30,expectedX:bounds.left+p.r,expectedY:height/2,outX:98.5,outY:30},
      {x:bounds.right-p.r+3,y:height/2,vx:100,vy:30,expectedX:bounds.right-p.r,expectedY:height/2,outX:-98.5,outY:30},
      {x:width/2,y:bounds.top+p.r-3,vx:30,vy:-100,expectedX:width/2,expectedY:bounds.top+p.r,outX:30,outY:98.5},
      {x:width/2,y:bounds.bottom-p.r+3,vx:30,vy:100,expectedX:width/2,expectedY:bounds.bottom-p.r,outX:30,outY:-98.5},
      {x:bounds.left+p.r-3,y:bounds.top+p.r-3,vx:-100,vy:-100,expectedX:bounds.left+p.r,expectedY:bounds.top+p.r,outX:98.5,outY:98.5}
    ];
    for(const sample of cases){
      Object.assign(p,sample);world.wall(p);near(p.x,sample.expectedX);near(p.y,sample.expectedY);near(p.vx,sample.outX);near(p.vy,sample.outY);
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
  const expectedHits=Math.ceil(hp/Math.round(.5*world.player.mass*(world.baseSpeed/world.unit)**2*.31));let followupHits=0;
  while(world.phase==='boss'&&followupHits<expectedHits){
    world.damageBoss(world.baseSpeed);scene.update(0,0);followupHits++;
    if(followupHits===1){
      assert.equal(world.phase,'boss','the first normal follow-up impact must not kill the stunned boss');
      assert.ok(b.hp>0&&b.hp<hp);assert.equal(b.stunned,true);near(b.r,b.minRadius);
      assert.equal(bossSpiralShapes(g,b).length,2,'spiral eyes persist through a surviving follow-up impact');
      assert.equal(bossAngryShapes(g,b).length,0);assert.equal(world.score-scoreBefore,500);
    }
    assert.ok(!g.shapes.some(shape=>shape.type==='ellipse'&&[0xf9f8f0,0xffffff].includes(shape.color)&&shape.alpha>0),'stunned impacts retain the no-white-flash rendering');
  }
  assert.equal(followupHits,expectedHits,'the fixed stun-health snapshot requires exactly the calculated number of real impacts');
  assert.equal(world.phase,'boss-celebrate');assert.equal(world.score-scoreBefore,1000);
  const labels=scene.testLabels.map(label=>label.text);
  assert.deepEqual(labels,['+100','+100','+100','+100','+100','+500']);
  for(let repeated=0;repeated<3;repeated++){world.damageBoss(world.baseSpeed);scene.update(0,0);}
  assert.equal(world.score-scoreBefore,1000);assert.deepEqual(scene.testLabels.map(label=>label.text),labels,'segment and kill rewards are each dispatched only once');
});

test('boss defeat preserves velocity through the new half-second slow segment before its original 0.8-second braking and spin',()=>{
  const {world,scene}=bossScene();advanceToBoss(world,scene);stunBoss(world,scene);
  const p=world.player,bounds=world.arenaBounds;
  p.x=(bounds.left+bounds.right)/2;p.y=(bounds.top+bounds.bottom)/2;p.vx=100;p.vy=-20;
  const initialSpeed=Math.hypot(p.vx,p.vy),initial={x:p.x,y:p.y};
  defeatBoss(world,scene);
  near(Math.hypot(p.vx,p.vy),initialSpeed);near(p.x,initial.x);near(p.y,initial.y);
  assert.equal(world.bossVictorySlowTime,.5);
  while(world.bossVictorySlowTime>1e-8)scene.update(0,1000/120);
  assert.equal(world.bossVictorySlowTime,0,'the slow segment must end exactly so the scene cannot retain quarter speed');
  const brakingStart={x:p.x,y:p.y};near(p.vx,100);near(p.vy,-20);near(world.phaseTime,0);
  let previous=initialSpeed;
  for(let frame=1;frame<=96;frame++){
    scene.update(0,1000/120);const speed=Math.hypot(p.vx,p.vy);
    assert.ok(speed<=previous+1e-8,'braking never adds speed');
    if(frame===1){assert.ok(speed>initialSpeed*.9,'the first braking frame does not abruptly cut velocity');assert.ok(p.x>brakingStart.x&&p.y<brakingStart.y);}
    if(frame<96)assert.ok(speed>0,'braking continues until its full duration');
    previous=speed;
  }
  near(previous,0);near(p.roll,0);advanceScene(scene,.05);assert.ok(p.roll>0);
});

test('the real scene clears ordinary enemies before each fixed inflation Boss and keeps segment rewards and double offers',()=>{
  for(const [stage,segmentValue,totalValue,type] of [[5,100,1000,'inflation'],[10,110,1100,'inflation'],[15,120,1200,'inflation']]){
    const {g,world,scene}=bossScene(stage),scoreBefore=world.score;
    const retained=world.enemies.map(body=>body.id);assert.equal(retained.length,0);assert.equal(world.boss.bossType,type);
    assert.deepEqual(world.choices,[]);assert.equal(element('#choice-labels').children.length,0);assert.equal(crownShapes(g).length,0);
    advanceToBoss(world,scene);
    assert.deepEqual(world.enemies.map(body=>body.id),retained);assert.deepEqual(world.choices,[]);assert.equal(element('#choice-labels').children.length,0);
    assert.ok(g.shapes.some(shape=>shape.points?.length>90&&Math.abs(outlineBounds(shape).cx-world.boss.x)<2&&Math.abs(outlineBounds(shape).cy-world.boss.y)<2),'the separate boss body reaches the real renderer');
    const boss=world.boss;world.damageBoss(world.baseSpeed);scene.update(0,0);
    assert.ok(!g.shapes.some(shape=>shape.type==='ellipse'&&[0xf9f8f0,0xffffff].includes(shape.color)&&shape.alpha>0&&Math.abs(shape.x-boss.x)<1e-6),'boss damage never paints a white flash over its body');
    defeatBoss(world,scene);
    assert.equal(world.boss.defeated,true);assert.ok(!g.shapes.some(shape=>shape.color===0xe88c72&&shape.points?.length>90&&outlineBounds(shape).width>world.unit*5),'the defeated boss does not remain as a large solid or flashing ball');
    assert.equal(world.score-scoreBefore,totalValue);
    assert.deepEqual(scene.testLabels.map(label=>label.text),[...Array(5).fill('+'+segmentValue),'+'+segmentValue*5]);
    assert.ok(scene.testLabels.every(label=>label.style.fontFamily==='GameSans, sans-serif'&&label.style.fontStyle==='normal'));
    // Task 1 intentionally animates the visible score for up to 250 ms while
    // the canonical score and saved best update on the collision frame.
    advanceScene(scene,.25);
    assert.equal(element('#score').textContent,String(world.score).padStart(4,'0'));
    assert.equal(Number(saved.get('qiuqiule-best')),world.score);
    assert.deepEqual(world.choices,[]);assert.equal(element('#choice-labels').children.length,0);
    advanceScene(scene,.5+BOSS_TIMING.brake+BOSS_TIMING.spin+BOSS_TIMING.hold+BOSS_TIMING.fade-.27);assert.equal(world.phase,'boss-celebrate');
    assert.deepEqual(world.choices,[]);assert.equal(element('#choice-labels').children.length,0);
    advanceScene(scene,.03);assert.equal(world.phase,'transition');assert.equal(world.choices.length,3);
    assert.equal(world.rewardSelectionsRemaining,2);assert.deepEqual(world.enemies,[],'remaining enemies are removed without score before the rewards');
    assert.ok(element('#choice-labels').children.some(node=>node.className==='choice-label'),'the existing upgrade transition becomes visible only after the celebration');
    assert.equal(crownShapes(g).length,0);
    advanceScene(scene,.86);near(world.arenaBounds.width,world.width-32);near(world.arenaBounds.height,world.height-32);assertArenaBorder(g,world);
    advanceScene(scene,1.04);assert.equal(world.phase,'choose');assert.equal(world.ready,true);
    assert.ok(element('#choice-labels').children.length>0&&element('#choice-labels').children.every(node=>node.style.opacity==='1'));
  }
});

test('boss collisions keep deformation, sound and scoring without white flashes while ordinary enemies retain their hit flash',()=>{
  const {g,world,scene}=bossScene();advanceToBoss(world,scene);
  const boss=world.boss,p=world.player,scoreBefore=world.score,radiusBefore=boss.r;
  const audio=app.recordFeedbackAudio();
  try{
    for(let hit=0;hit<40&&world.score===scoreBefore;hit++){
      if(hit){Object.assign(p,{x:world.arenaBounds.left+p.r+2,y:world.arenaBounds.bottom-p.r-2,vx:0,vy:0});advanceScene(scene,.16);}
      p.x=boss.x;p.y=boss.y+boss.r+p.r-1;p.vx=0;p.vy=-world.baseSpeed*.5;
      world.collideBoss();scene.update(0,0);
      assert.ok(p.vy>0,'the real collision still rebounds the player');
      assert.ok(boss.squash>0&&p.squash>0,'the normal impact deformation remains active');
      assert.ok(!g.shapes.some(shape=>shape.type==='ellipse'&&[0xf9f8f0,0xffffff].includes(shape.color)&&shape.alpha>0&&Math.hypot(shape.x-boss.x,shape.y-boss.y)<1),'boss hit feedback contains no white overlay');
    }
    assert.ok(boss.r<radiusBefore);assert.equal(world.score-scoreBefore,100);
    assert.ok(scene.testLabels.some(label=>label.text==='+100'));
    assert.ok(audio.calls.some(call=>call.name==='impact'&&call.args[0].kind==='boss'&&call.args[0].power>0),'boss impacts still dispatch their layered sound');
    const body=g.shapes.find(shape=>shape.type==='path'&&shape.color===0xe88c72&&shape.points.length===193);
    assert.ok(body);const bounds=outlineBounds(body);assert.ok(Math.abs(bounds.width-bounds.height)>1,'the renderer keeps the visible collision squash');
  }finally{audio.restore();}
  const ordinaryGraphics=graphicsRecorder(),ordinary=app.seedRenderer(ordinaryGraphics,390,844,true);
  const player=ordinary.world.player,enemy=ordinary.world.enemies[0],hp=enemy.hp;
  enemy.born=1;enemy.solid=true;enemy.x=player.x+player.r+enemy.r-1;enemy.y=player.y;enemy.vx=enemy.vy=0;
  player.vx=ordinary.world.unit*8;player.vy=0;
  ordinary.world.collide(player,enemy);ordinary.scene.update(0,0);
  assert.ok(enemy.hp<hp&&enemy.hp>0,'exercise a surviving ordinary-enemy impact');
  assert.ok(ordinaryGraphics.shapes.some(shape=>shape.type==='ellipse'&&shape.color===0xf9f8f0&&shape.alpha>0&&Math.abs(shape.x-enemy.x)<1e-6&&Math.abs(shape.y-enemy.y)<1e-6),'ordinary enemies with a meaningful surviving hit retain their existing white hit effect');
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
    if(phase==='boss-celebrate'){defeatBoss(world,scene);advanceScene(scene,1.6);assert.equal(crownShapes(g).length,1);}
    else if(phase==='stunned'){stunBoss(world,scene);advanceScene(scene,.3);}
    const oldLabels=[...scene.testLabels];
    clickAction('pause');app.advanceUi(.42);clickRestart();
    const state=app.readRestart(),fresh=state.world;
    assert.notEqual(fresh,world);assert.equal(fresh.phase,'transition');assert.equal(fresh.startingUpgrades,true);assert.equal(fresh.stage,1);assert.equal(fresh.score,0);
    assert.equal(fresh.boss,null);assert.ok(!fresh.player.roll);assert.equal(fresh.choices.length,3);assert.ok(fresh.choices.every(choice=>choice.kind==='regular'));assert.deepEqual(scene.effects,[]);
    assert.ok(oldLabels.every(label=>label.destroyed));assert.ok(element('#choice-labels').children.some(node=>node.className==='choice-label'));
    assert.equal(state.transfer.duration,.4);assert.equal(state.paused,true);
    app.advanceUi(.4);scene.update(0,0);
    assert.equal(app.readRestart().paused,false);assert.equal(crownShapes(g).length,0);assert.equal(fresh.time,0);
    near(fresh.arenaBounds.width,fresh.width-32);near(fresh.arenaBounds.height,fresh.height-32);assertArenaBorder(g,fresh);
  }
});

test('boss celebration renders an upright crown and player spin, with one fanfare after braking and no early reward controls',()=>{
  const {g,world,scene}=bossScene();advanceToBoss(world,scene);
  const audio=app.recordBossVictory();
  try{
    defeatBoss(world,scene);assert.equal(crownShapes(g).length,0);assert.equal(audio.calls.length,0);
    advanceScene(scene,.5);assert.equal(crownShapes(g).length,0);assert.equal(audio.calls.length,0);near(world.bossVictorySlowTime,0);
    advanceScene(scene,.79);assert.equal(crownShapes(g).length,0);assert.equal(audio.calls.length,0);
    advanceScene(scene,.31);assert.equal(world.phase,'boss-celebrate');assert.equal(audio.calls.length,1);
    assert.equal(world.ready,false);assert.deepEqual(world.choices,[]);assert.equal(element('#choice-labels').children.length,0);
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
    for(let frame=0;frame<Math.round(BOSS_TIMING.hold/.05);frame++){
      advanceScene(scene,.05);assert.equal(world.phase,'boss-celebrate');near(p.roll,Math.PI*2);
      const holding=crownShapes(g);assert.equal(holding.length,1);near(holding[0].alpha,1);
      assertSameContour(holding[0].points,held.points);assert.equal(element('#choice-labels').children.length,0);
    }
    advanceScene(scene,.05);assert.equal(world.phase,'boss-celebrate');assert.ok(crownShapes(g)[0].alpha<1&&crownShapes(g)[0].alpha>0);
    advanceScene(scene,.2);assert.equal(world.phase,'transition');assert.equal(crownShapes(g).length,0);assert.equal(audio.calls.length,1);
  }finally{audio.restore();}
});

test('the actual home and endless renderer keeps the default circular player without changing collision radii or mass',()=>{
  try{
    for(const mode of ['home','endless']){
      const g=graphicsRecorder(),{scene,player}=pullScene(mode,g);app.seedCircle();
      const physical={r:player.r,mass:player.mass,density:player.density};
      Object.assign(player,{squash:0,angle:0,roll:0,vx:0,vy:0});scene.update(0,0);
      assertSameContour(app.readPlayerShape().playerContour,skinContour(0));
      const shape=bodyShapes(g)[0];assert.equal(shape.points.length,193);assert.equal(eyeShapes(g).length,2);
      const bounds=outlineBounds(shape);near(bounds.width,2*player.r);near(bounds.height,2*player.r);
      assert.deepEqual({r:player.r,mass:player.mass,density:player.density},physical);
    }
  }finally{app.seedCircle();}
});
function feedbackRun(module=app,strength=1){
  const g=graphicsRecorder(),run=module.seedRenderer(g,390,844,true);
  module.setFeedbackStrength(strength);module.resetScoreHud();
  run.world.spawnTimer=Infinity;run.world.floorTimer=Infinity;run.world.wave=null;run.world.introTimer=Infinity;run.world.fragmentQueue=[];
  return {g,...run};
}
function collideFeedbackEnemy(world){
  const p=world.player,enemy=world.enemies[0];
  world.enemies=[enemy];Object.assign(enemy,{born:1,solid:true,hp:1,x:p.x+p.r+enemy.r-.5,y:p.y,vx:0,vy:0});
  p.vx=world.baseSpeed;p.vy=0;world.step(1/120);
  const event=world.events.find(e=>e.type==='kill');assert.ok(event,'the real physics collision must kill the target');
  return event;
}
function gradedFeedbackContact(world,{maxHp=10000,hp=maxHp}={}){
  const p=world.player,b=world.makeBody(220,400,world.unit,.8);
  Object.assign(b,{born:1,solid:true,hp,maxHp,enemyType:'normal'});
  world.enemies=[b];world.events=[];
  Object.assign(p,{x:b.x-b.r-p.r+.1,y:b.y,vx:world.baseSpeed*.75,vy:0});
  world.collide(p,b);
  return {enemy:b,hit:world.events.find(e=>e.type==='hit'),kill:world.events.find(e=>e.type==='kill')};
}

test('a real shockwave dispatches one hit-aware cue and two fronts without a border highlight or dotted afterimage',t=>{
  const {g,world,scene}=feedbackRun(),audio=app.recordFeedbackAudio(),p=world.player;
  t.after(()=>{audio.restore();app.setFeedbackStrength(.6);});
  const target=world.makeBody(world.arenaBounds.left+p.r+world.unit*2,400,world.unit,.8);
  Object.assign(target,{hp:10000,maxHp:10000,born:1,solid:true,enemyType:'normal'});world.enemies=[target];world.events=[];
  Object.assign(p,{x:world.arenaBounds.left+p.r,y:400,vx:0,vy:0});
  world.releaseShockwave(p,{contactX:world.arenaBounds.left,contactY:p.y,nx:-1,ny:0});scene.handleEvents();
  assert.ok(target.hp<10000);assert.deepEqual(audio.calls.filter(call=>call.name==='shockwave').map(call=>call.args[0]),[{hit:true,strength:1}]);
  assert.equal(audio.calls.filter(call=>call.name==='impact').length,0);assert.equal(scene.zoomPulse,null);
  const wave=scene.effects.find(effect=>effect.type==='shockwave');assert.ok(wave);near(wave.r,world.unit*4);near(wave.total,.39);assert.equal(wave.color,app.playerInk());
  assert.equal(scene.wallFlashes.length,0);
  g.clear();scene.drawBorder(world.arenaBounds);
  assert.equal(g.borders.length,1,'the ordinary outline is drawn once, never flashed as a whole');
  assert.equal(g.shapes.filter(shape=>shape.type==='stroke'&&shape.color===app.playerInk()).length,0);
  near(g.borders[0].strokeWidth,1);near(g.borders[0].strokeAlpha,.65);
  const arcs=[];g.arc=(x,y,r)=>arcs.push({x,y,r});
  for(const [age,count] of [[0,1],[.069,1],[.07,2],[.2,2],[.32,1],[.389,1],[.39,0],[.4,0],[.59,0]]){
    wave.life=age;arcs.length=0;g.clear();scene.drawArena();
    const fronts=arcs.filter(arc=>arc.x===wave.x&&arc.y===wave.y&&arc.r>=wave.r*.35);
    assert.equal(fronts.length,count,`the wave draws ${count} fronts at ${age} s`);
    assert.equal(g.shapes.filter(shape=>shape.type==='circle'&&shape.color===wave.color&&shape.r===1.5).length,0,'no range dots are drawn at any age');
    assert.equal(scene.wallFlashes.length,0);
  }
  scene.handleEvents();assert.equal(audio.calls.filter(call=>call.name==='shockwave').length,1,'redrawing cannot replay the wave');
  scene.resetFeedback();assert.equal(scene.effects.filter(effect=>effect.type==='shockwave').length,0);
});

test('reduced-motion shockwave has one fixed fade and no border flash',async()=>{
  await withReloadedEntry({juice:1},true,fresh=>{
    const {world,scene}=feedbackRun(fresh),audio=fresh.recordFeedbackAudio();
    try{
      world.enemies=[];world.events=[];world.releaseShockwave(world.player,{contactX:world.arenaBounds.left,contactY:400,nx:-1,ny:0});scene.handleEvents();
      const wave=scene.effects.find(effect=>effect.type==='shockwave');assert.ok(wave);near(wave.total,.32);
      assert.equal(scene.wallFlashes.length,0);assert.equal(world.player.feedbackFreeze||0,0);assert.equal(scene.zoomPulse,null);
      assert.deepEqual(audio.calls.filter(call=>call.name==='shockwave').map(call=>call.args[0]),[{hit:false,strength:1}]);
    }finally{audio.restore();}
  });
});

test('real ordinary hits dispatch their graded sound while light hits paint no flash',t=>{
  const audio=app.recordFeedbackAudio();
  t.after(()=>{audio.restore();app.setFeedbackStrength(.6);});
  for(const [maxHp,tier] of [[10000,'light'],[500,'medium'],[150,'heavy']]){
    const {world,scene,g}=feedbackRun(app,.6);scene.clock=1;scene.hitSoundAt=0;
    audio.calls.length=0;
    const {enemy,hit}=gradedFeedbackContact(world,{maxHp});
    assert.equal(hit.hitTier,tier);assert.equal(hit.lethal,false);
    scene.update(0,0);
    const sounds=audio.calls.filter(call=>call.name==='impact');
    assert.equal(sounds.length,tier==='light'?0:1);
    assert.equal(scene.effects.filter(effect=>effect.type==='shard').length,0);
    assert.equal(scene.impactGhosts.length,0);
    if(tier==='light'){
      near(scene.hitSoundAt,0);
      assert.ok(!g.shapes.some(shape=>shape.type==='ellipse'&&shape.color===0xf9f8f0&&shape.alpha>0&&Math.abs(shape.x-enemy.x)<1e-6));
    }else{
      assert.equal(sounds[0].args[0].kind,'hit');assert.equal(sounds[0].args[0].endless,true);assert.equal(sounds[0].args[0].hitTier,tier);
      near(scene.hitSoundAt,scene.clock);
    }
  }
});

test('v7.8 quiet wall contacts have no flash or bulge and cannot suppress an immediate meaningful hit',t=>{
  const {world,scene}=feedbackRun(app,.6),p=world.player,audio=app.recordFeedbackAudio();
  t.after(()=>{audio.restore();app.setFeedbackStrength(.6);});
  scene.clock=1;scene.hitSoundAt=0;world.events=[];
  Object.assign(p,{x:world.arenaBounds.left+p.r-.1,y:400,vx:-world.baseSpeed*.249,vy:0});
  world.wall(p);scene.update(0,0);
  assert.equal(audio.calls.filter(call=>call.name==='wall').length,0);
  near(scene.hitSoundAt,0);assert.equal(scene.wallFlashes.length,0);assert.equal(scene.wallBulges.length,0);
  gradedFeedbackContact(world,{maxHp:500});scene.update(0,0);
  assert.equal(audio.calls.filter(call=>call.name==='impact').length,1);
  assert.equal(audio.calls.find(call=>call.name==='impact').args[0].hitTier,'medium');
  scene.clock+=.1;world.events=[];
  Object.assign(p,{x:world.arenaBounds.left+p.r-.1,y:400,vx:-world.baseSpeed*.25,vy:0});
  world.wall(p);scene.update(0,0);
  const wall=audio.calls.find(call=>call.name==='wall');
  assert.ok(wall);near(wall.args[0],.25);assert.deepEqual(wall.args[1],{endless:true});
});

test('v7.2 direct kills keep old squash blink and default hold while passing the endless musical context',t=>{
  const audio=app.recordFeedbackAudio();t.after(()=>{audio.restore();app.setFeedbackStrength(.6);});
  for(const frenzy of [false,true]){
    const {world,scene}=feedbackRun(app,.6);scene.clock=1;scene.hitSoundAt=0;audio.calls.length=0;
    if(frenzy)world.buffs.frenzy=1;
    const {hit,kill}=gradedFeedbackContact(world,{maxHp:10000,hp:1});
    assert.equal(hit.lethal,true);assert.ok(hit.damage/hit.maxHp<.1);
    assert.ok(world.player.squash>0&&kill.bodySnapshot.squash>0,'the excluded squash-removal change is not applied');
    near(kill.freezeDuration,.048);
    scene.update(0,0);
    const sounds=audio.calls.filter(call=>call.name==='impact');
    assert.equal(sounds.length,1);assert.equal(sounds[0].args[0].kind,'kill');
    assert.equal(sounds[0].args[0].endless,true);assert.equal(sounds[0].args[0].frenzy,frenzy);
    near(scene.blinkUntil-scene.clock,.075,'the existing blink is not replaced by a new eighty-millisecond squint');
  }
});

function fireElementInput(selector,value){
  const target=element(selector);target.value=value;
  for(const handler of target.listeners.get('input')||[])handler({target});
}
let reloadSerial=0;
async function withReloadedEntry(config,reduced,callback){
  const previousSettings=saved.get('qiuqiule-settings'),previousMedia=globalThis.matchMedia;
  const documentListeners=new Map([...listeners].map(([type,handlers])=>[type,[...handlers]]));
  const previousWindowListeners=new Map([...windowListeners].map(([type,handlers])=>[type,[...handlers]]));
  const elementListeners=new Map([...elements].map(([selector,node])=>[selector,new Map([...node.listeners].map(([type,handlers])=>[type,[...handlers]]))]));
  if(config===null)saved.delete('qiuqiule-settings');else saved.set('qiuqiule-settings',JSON.stringify(config));
  globalThis.matchMedia=()=>({matches:reduced});
  try{
    const fresh=await import('data:text/javascript;base64,'+Buffer.from(source+adapter+'\n// feedback reload '+JSON.stringify(config)+' '+reduced+' '+(++reloadSerial)).toString('base64'));
    await callback(fresh);
  }finally{
    globalThis.matchMedia=previousMedia;
    if(previousSettings===undefined)saved.delete('qiuqiule-settings');else saved.set('qiuqiule-settings',previousSettings);
    listeners.clear();for(const [type,handlers] of documentListeners)listeners.set(type,handlers);
    windowListeners.clear();for(const [type,handlers] of previousWindowListeners)windowListeners.set(type,handlers);
    for(const [selector,node] of elements)node.listeners=elementListeners.get(selector)||new Map();
    app.seedRenderer(graphicsRecorder());app.setFeedbackStrength(.6);
  }
}

function controlRun(module=app,strength=1){
  const run=feedbackRun(module,strength);
  run.world.enemies=[];run.world.events=[];
  return {...run,pointer:inputCanvas(390,844,module)};
}

test('endless battle and Boss accept moving input with their distinct redirect and bounded additive release rules',()=>{
  for(const phase of ['battle','boss']){
    const {world,scene,pointer}=controlRun(),p=world.player;
    if(phase==='boss'){world.stage=5;world.beginBoss();world.phase='boss';world.events=[];}
    p.vx=world.baseSpeed*.8;p.vy=0;
    const speed=Math.hypot(p.vx,p.vy),start={x:p.x,y:p.y};
    pointer('pointerdown',start.x,start.y);
    assert.ok(app.readRestart().drag,'a speed above the old readiness threshold still accepts a gesture');
    pointer('pointermove',start.x,start.y+world.maxPull*.5);scene.update(0,0);
    assert.equal(app.readRestart().drag.pending,false);near(scene.timeScale,.3);
    near(p.vx,speed);near(p.vy,0,'starting the aim does not catch or brake the player');
    pointer('pointerup',start.x,start.y+world.maxPull*.5);
    near(p.vx,0);near(p.vy,phase==='boss'?-(world.baseSpeed*.5+Math.min(speed,world.readySpeed)):-speed);
    assert.equal(world.events.filter(e=>e.type==='shoot').length,1);
    assert.equal(app.readRestart().drag,null);near(scene.timeScale,1);
  }
  app.setFeedbackStrength(.6);
});

test('pending endless taps do not slow, charge or shoot and exact movement or hold thresholds activate aim',t=>{
  const audio=app.recordFeedbackAudio();t.after(()=>{audio.restore();app.setFeedbackStrength(.6);});
  {
    const {world,scene,pointer}=controlRun(),p=world.player;
    pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+5.9,p.y);
    advanceScene(scene,.119);near(scene.timeScale,1);assert.equal(app.readRestart().drag.pending,true);
    assert.equal(audio.calls.filter(c=>c.name==='setCharge').length,0);
    pointer('pointerup',p.x+5.9,p.y);scene.update(0,0);
    assert.equal(world.events.filter(e=>e.type==='shoot').length,0);assert.equal(app.readRestart().drag,null);
    assert.equal(audio.calls.filter(c=>c.name==='launch').length,0);
  }
  for(const trigger of ['distance','hold']){
    const {scene,pointer,world}=controlRun(),p=world.player;
    pointer('pointerdown',p.x,p.y);
    if(trigger==='distance')pointer('pointermove',p.x+6,p.y);else advanceScene(scene,.12);
    scene.update(0,0);assert.equal(app.readRestart().drag.pending,false);near(scene.timeScale,.3);
    pointer('pointercancel');near(scene.timeScale,1);
  }
});

test('one endless pointer owns aim while secondary touches and another primary device cannot replace or cancel it',()=>{
  const {world,scene,pointer}=controlRun(),p=world.player;
  pointer('pointerdown',p.x,p.y,{pointerType:'touch'});
  pointer('pointermove',p.x+30,p.y,{pointerType:'touch'});scene.update(0,0);
  const active=app.readRestart().drag;
  for(const options of [{pointerId:2,isPrimary:false,pointerType:'touch'},{pointerId:3,isPrimary:true,pointerType:'mouse'}]){
    pointer('pointerdown',10,10,options);pointer('pointermove',150,100,options);
    pointer('pointerup',150,100,options);pointer('pointercancel',0,0,options);pointer('lostpointercapture',0,0,options);
    assert.equal(app.readRestart().drag,active);assert.equal(active.id,1);near(active.dx,30);near(scene.timeScale,.3);
  }
  assert.deepEqual(pointer.captures,[1]);assert.equal(world.events.filter(e=>e.type==='shoot').length,0);
  pointer('pointerup',p.x+30,p.y,{pointerType:'touch'});
  assert.equal(world.events.filter(e=>e.type==='shoot').length,1);assert.deepEqual(pointer.releases,[1]);
  app.setFeedbackStrength(.6);
});

test('endless slow aim uses real elapsed time and expires after its hold and recovery windows',()=>{
  for(const [strength,minimum] of [[0,.3],[.6,.3],[1,.3]]){
    const {world,scene,pointer}=controlRun(app,strength),p=world.player;
    pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+40,p.y);scene.update(0,0);
    near(scene.timeScale,minimum);advanceScene(scene,.6);
    assert.ok(Math.abs(world.time-.6*minimum)<1/120+1e-8,'only simulation time is scaled');
    near(scene.inputClock,.6);near(scene.clock,.6);
    pointer('pointermove',p.x+60,p.y+10);advanceScene(scene,.6);near(scene.timeScale,minimum);
    advanceScene(scene,.25);near(scene.timeScale,(1+minimum)/2);
    advanceScene(scene,.251);near(scene.timeScale,1);
    pointer('pointermove',p.x+80,p.y);scene.update(0,0);near(scene.timeScale,1,'moving after expiry does not rearm slow time');
    assert.ok(app.readRestart().drag,'the expired slow window does not prevent continued aim');
    pointer('pointercancel');near(scene.timeScale,1);
  }
  app.setFeedbackStrength(.6);
});

test('zero feedback keeps independent 0.3 aim time and reduced motion retains gentler 0.6 aim time',async()=>{
  for(const [strength,reduced] of [[0,false],[1,true],[0,true]])await withReloadedEntry({juice:strength,expressions:true},reduced,fresh=>{
    for(const phase of ['battle','boss']){
      const {world,scene,pointer}=controlRun(fresh,strength),p=world.player,minimum=reduced?.6:.3;
      if(phase==='boss'){world.stage=5;world.beginBoss();advanceToBoss(world,scene);world.events=[];}
      p.vx=world.baseSpeed*.8;p.vy=0;
      const startTime=world.time;
      pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x,p.y+40);scene.update(0,0);
      assert.equal(fresh.readRestart().drag.pending,false);near(scene.timeScale,minimum);
      advanceScene(scene,.1);assert.ok(Math.abs(world.time-startTime-.1*minimum)<1/120+1e-8);
      const speed=Math.hypot(p.vx,p.vy),drag=fresh.readRestart().drag;
      pointer('pointerup',drag.x,drag.y+40);near(p.vx,0);
      if(phase==='battle')near(p.vy,-speed);else assert.ok(p.vy<0,'Boss retains its bounded additive launch rule');
      near(scene.timeScale,1);
    }
  });
});

test('changing visual feedback strength during an active aim never changes its independent slow-time envelope',t=>{
  const {world,scene,pointer}=controlRun(app,.6),p=world.player;
  t.after(()=>{pointer('pointercancel');app.setFeedbackStrength(.6);});
  pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+40,p.y);advanceScene(scene,.4);near(scene.timeScale,.3);
  app.setFeedbackStrength(0);scene.update(0,0);near(scene.timeScale,.3);
  app.setFeedbackStrength(1);advanceScene(scene,.8);near(scene.timeScale,.3);
  app.setFeedbackStrength(.2);advanceScene(scene,.25);near(scene.timeScale,.65);
  advanceScene(scene,.251);near(scene.timeScale,1);
});

test('completed real aiming samples persist locally and median calibration applies only when the next run begins',t=>{
  const before=saved.get('qiuqiule-aim'),{world,scene,pointer}=controlRun(app,0),p=world.player;
  t.after(()=>{if(before===undefined)saved.delete('qiuqiule-aim');else saved.set('qiuqiule-aim',before);app.seedRenderer(graphicsRecorder());app.setFeedbackStrength(.6);});
  for(let shot=0;shot<20;shot++){
    Object.assign(p,{x:195,y:600,vx:0,vy:0,feedbackFreeze:0});
    pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+40,p.y);advanceScene(scene,1.05);
    near(scene.timeScale,.3);pointer('pointerup',235,600);
    assert.equal(app.readAimStats().sampleCount,shot+1);
  }
  const report=app.readAimStats(),stored=JSON.parse(saved.get('qiuqiule-aim'));
  near(report.medianSeconds,1.05);assert.equal(report.completedCount,20);assert.equal(report.samples.length,20);
  near(report.nextHoldSeconds,.9);near(report.currentRunHoldSeconds,1.2);
  assert.deepEqual(stored.samples,report.samples);assert.equal(stored.completedCount,20);
  Object.assign(p,{x:195,y:600,vx:0,vy:0});pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+40,p.y);
  advanceScene(scene,1.15);near(scene.timeScale,.3,'calibration does not shorten the current run');pointer('pointercancel');
  app.prepareNormalGame();const next=app.readRestart().world;finishStartingChoice(next,scene);next.enemies=[];next.spawnTimer=next.floorTimer=next.introTimer=Infinity;next.wave=null;
  near(app.readAimStats().currentRunHoldSeconds,.9);
  pointer('pointerdown',next.player.x,next.player.y);pointer('pointermove',next.player.x+40,next.player.y);
  advanceScene(scene,.9);near(scene.timeScale,.3);advanceScene(scene,.25);near(scene.timeScale,.65);advanceScene(scene,.251);near(scene.timeScale,1);
  pointer('pointercancel');assert.equal(app.readAimStats().sampleCount,20,'cancelled calibration checks are not recorded');
});

test('tap, cancel, interruption and acceptance-demo gestures do not contaminate local aim calibration',t=>{
  const before=saved.get('qiuqiule-aim'),baseline={version:1,completedCount:3,samples:[.3,.4,.5]};
  t.after(()=>{if(before===undefined)saved.delete('qiuqiule-aim');else saved.set('qiuqiule-aim',before);document.hidden=false;app.seedRenderer(graphicsRecorder());app.setFeedbackStrength(.6);});
  for(const kind of ['tap','cancel','pause','background','demo']){
    const run=controlRun();
    app.seedAimStats(baseline);saved.set('qiuqiule-aim',JSON.stringify(baseline));
    if(kind==='demo')app.runFeedbackDemo('steer');
    const {world,scene}=app.readRestart(),pointer=inputCanvas(),p=world.player;world.enemies=[];world.spawnTimer=world.floorTimer=world.introTimer=Infinity;world.wave=null;
    p.vx=p.vy=0;const start={x:p.x,y:p.y};pointer('pointerdown',start.x,start.y);
    if(kind!=='tap')pointer('pointermove',start.x+40,start.y);
    advanceScene(scene,kind==='tap'?.05:.3);
    if(kind==='cancel')pointer('pointercancel');
    else if(kind==='pause')clickAction('pause');
    else if(kind==='background'){document.hidden=true;for(const handler of listeners.get('visibilitychange'))handler();document.hidden=false;}
    pointer('pointerup',start.x+(kind==='tap'?0:40),start.y);
    assert.deepEqual(app.readAimStats().samples,baseline.samples,kind);assert.equal(saved.get('qiuqiule-aim'),JSON.stringify(baseline),kind);
  }
});

test('legacy vibration settings migrate without losing preferences or vibrating during a shot and heavy hit',async t=>{
  const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  assert.doesNotMatch(html,/haptic-toggle|data-action="haptic"|轻触[震振]动|手机[震振]动/);
  const vibrationCalls=[],previous=Object.getOwnPropertyDescriptor(navigator,'vibrate');
  Object.defineProperty(navigator,'vibrate',{configurable:true,value:pattern=>{vibrationCalls.push(pattern);return true;}});
  t.after(()=>{if(previous)Object.defineProperty(navigator,'vibrate',previous);else delete navigator.vibrate;});
  const preferences={player:'#8040a0',enemy:'#806040',bg:'#111111',sound:true,expressions:false,bgmVolume:.12,sfxVolume:.23,juice:.8};
  for(const haptic of [true,false])await withReloadedEntry({...preferences,haptic},false,fresh=>{
    assert.deepEqual(fresh.readFeedbackSettings(),preferences);
    assert.deepEqual(JSON.parse(saved.get('qiuqiule-settings')),preferences);
    const {world,scene,pointer}=controlRun(fresh,preferences.juice),p=world.player,audio=fresh.recordFeedbackAudio();
    try{
      pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+world.maxPull,p.y);pointer('pointerup',p.x+world.maxPull,p.y);
      assert.ok(world.events.some(e=>e.type==='shoot'));scene.update(0,0);
      assert.ok(audio.calls.some(c=>c.name==='setCharge'&&c.args[0]>.99));
      assert.ok(audio.calls.some(c=>c.name==='launch'));
      advanceScene(scene,.1);
      const {hit}=gradedFeedbackContact(world,{maxHp:150});assert.equal(hit?.hitTier,'heavy');
      scene.update(0,0);
      assert.ok(audio.calls.some(c=>c.name==='impact'&&c.args[0].hitTier==='heavy'));
      assert.deepEqual(vibrationCalls,[],`legacy haptic=${haptic}`);
    }finally{audio.restore();}
  });
});

test('v7.11 restore defaults synchronizes preferences and persistence while preserving records, unlocks, photos and equipped cosmetics',async()=>{
  const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  assert.match(html,/data-action="restore-defaults"/);assert.doesNotMatch(html,/data-action="export(?:-aim)?"/);
  const defaults={player:'#252720',enemy:'#e88c72',bg:'#f4f3eb',sound:true,expressions:true,bgmVolume:.55,sfxVolume:.75,juice:.6};
  const prior=new Map(saved);
  try{
    for(const appearance of ['original','custom','big-eye'])await withReloadedEntry({player:'#8040a0',enemy:'#806040',bg:'#111111',sound:false,expressions:false,bgmVolume:.12,sfxVolume:.23,juice:.2},false,fresh=>{
      fresh.seedRenderer(graphicsRecorder());fresh.seedCircle();
      fresh.seedEndless({best:72000,maxStage:25,maxCombo:12});fresh.seedStarTrails({selected:'star',unlocked:9});
      fresh.seedAimStats({completedCount:30,samples:Array(30).fill(1.05)});
      const photos=fresh.recordCompositePhotos(true),image=fresh.readAppearance().appearance;
      fresh.seedAppearanceState({selected:appearance==='big-eye'?'custom':appearance,bigEyeUnlocked:true},{hasImage:true});
      if(appearance==='big-eye'){assert.equal(fresh.chooseAppearanceForTest('big-eye'),true);fresh.advanceSkin(.14);}
      const starTrails=structuredClone(fresh.readStarTrails().state),endless=structuredClone(fresh.readEndless().progress),aim=structuredClone(fresh.readAimStats());
      saved.set('qiuqiule-appearance','data:image/png;base64,test-existing-photo');
      const preserved=new Map([...saved].filter(([key])=>!['qiuqiule-settings','qiuqiule-appearance-state'].includes(key)));
      let refreshed=0;const restoreWardrobe=fresh.bindWardrobeControls({refresh(){refreshed++;}});
      try{
        listeners.get('click').at(-1)({target:{closest:()=>({dataset:{action:'restore-defaults'}})},detail:1});
        assert.deepEqual(fresh.readFeedbackSettings(),defaults);assert.deepEqual(JSON.parse(saved.get('qiuqiule-settings')),defaults);
        for(const key of ['player','enemy','bg']){assert.equal(element('#'+key+'-color').value,defaults[key]);assert.equal(element('#'+key+'-hex').textContent,defaults[key].toUpperCase());}
        for(const key of ['sound','expressions'])assert.equal(element('#'+key+'-toggle').attributes['aria-checked'],'true');
        for(const [key,value]of [['bgm',55],['sfx',75]]){assert.equal(element('#'+key+'-volume').value,value);assert.equal(element('#'+key+'-value').value,value+'%');}
        assert.equal(element('#feedback-strength').value,60);assert.equal(element('#feedback-value').value,'60%');
        assert.equal(element('html').style['--ink'],'#252720');assert.equal(refreshed,1);
        assert.equal(fresh.readAppearancePresentation().tween,null,'an old color fade cannot resurrect a pre-reset preference');
        assert.equal(fresh.readAppearancePresentation().state.selected,appearance);assert.equal(fresh.readAppearance().appearance,image);
        assert.deepEqual(fresh.readStarTrails().state,starTrails);assert.deepEqual(fresh.readEndless().progress,endless);assert.deepEqual(fresh.readAimStats(),aim);
        assert.deepEqual(new Map([...saved].filter(([key])=>!['qiuqiule-settings','qiuqiule-appearance-state'].includes(key))),preserved);
        if(appearance==='big-eye'){
          assert.equal(fresh.readAppearancePresentation().state.previousPlayerColor,defaults.player);
          assert.equal(fresh.chooseAppearanceForTest('original'),true);assert.equal(fresh.playerInk(),0x252720,'unloading Big Eye cannot undo a later settings reset');
        }
      }finally{restoreWardrobe();photos.restore();}
    });
  }finally{saved.clear();for(const [key,value]of prior)saved.set(key,value);}
});

test('slow aim preserves immediate pointer contours, normal HUD timing and a photo draw on every frame',t=>{
  const {g,world,scene,pointer}=controlRun(),p=world.player;let photo;
  t.after(()=>{pointer('pointercancel');photo?.restore();app.setFeedbackStrength(.6);});
  pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+world.maxPull*.5,p.y);scene.update(0,0);
  assertSmoothPulledBody(g,p,app.readRestart().drag,world.maxPull);
  pointer('pointermove',p.x,p.y-world.maxPull);scene.update(0,0);
  assertSmoothPulledBody(g,p,app.readRestart().drag,world.maxPull);
  photo=app.recordPlayerPhoto();scene.update(0,0);
  const previousPhotos=photo.calls.length;
  pointer('pointermove',p.x-world.maxPull,p.y);scene.update(0,0);
  assert.equal(photo.calls.length,previousPhotos+1,'a zero-step pointer frame still repaints the photo');
  const pose=photo.calls.at(-1).pose;near(pose.x,p.x);near(pose.y,p.y);near(pose.pullAmount,1);
  world.score=40;scene.update(0,0);assert.notEqual(element('#score').textContent,'0040');
  const simulationStart=world.time;advanceScene(scene,.25);
  assert.equal(element('#score').textContent,'0040');near(scene.clock,.25);
  assert.ok(world.time-simulationStart<.1,'HUD completes in real time while the simulation remains slowed');
  assert.ok(photo.calls.length>=previousPhotos+6);
});

test('cancelling or interrupting endless aim clears slow time and charge before any delayed release',t=>{
  const audio=app.recordFeedbackAudio();t.after(()=>{audio.restore();app.setFeedbackStrength(.6);document.hidden=false;});
  for(const reason of ['pointercancel','lostpointercapture','pause','background','pagehide','blur','phase','restart']){
    const {world,scene,pointer}=controlRun(),p=world.player,events=observeWorldEvents(world);
    pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+world.maxPull*.8,p.y);scene.update(0,0);near(scene.timeScale,.3);
    if(reason==='pause'||reason==='restart'){clickAction('pause');if(reason==='restart'){app.advanceUi(.42);clickRestart();}}
    else if(reason==='background'){
      document.hidden=true;for(const handler of listeners.get('visibilitychange'))handler();document.hidden=false;
    }else if(reason==='pagehide'||reason==='blur'){
      for(const handler of windowListeners.get(reason))handler();
      if(reason==='pagehide')for(const handler of windowListeners.get('pageshow'))handler();
    }else if(reason==='phase'){world.beginUpgrade();scene.update(0,0);}
    else pointer(reason);
    assert.equal(app.readRestart().drag,null,reason);near(scene.timeScale,1);
    assert.equal(audio.calls.at(-1).name,'stopCharge',reason);
    pointer('pointerup',p.x+world.maxPull*.8,p.y);scene.update(0,0);
    assert.equal(events.filter(e=>e.type==='shoot').length,0,reason);
  }
});

test('a real viewport resize cancels endless aim while a pixel-density-only update keeps the gesture',t=>{
  const {g,world,scene,pointer}=controlRun(),p=world.player;
  const previous={width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio,add:window.addEventListener};let resize;
  window.addEventListener=(type,handler)=>{if(type==='resize')resize=handler;else previous.add(type,handler);};
  t.after(()=>{window.innerWidth=previous.width;window.innerHeight=previous.height;window.devicePixelRatio=previous.dpr;window.addEventListener=previous.add;app.setFeedbackStrength(.6);});
  app.mountSceneBoundary(pointer.canvas,g);assert.equal(typeof resize,'function');
  pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+40,p.y);scene.update(0,0);near(scene.timeScale,.3);
  const gesture=app.readRestart().drag;
  window.devicePixelRatio=3;resize();assert.equal(app.readRestart().drag,gesture);
  window.innerWidth=844;window.innerHeight=390;resize();
  assert.equal(app.readRestart().drag,null);near(scene.timeScale,1);assert.equal(world.width,844);assert.equal(world.height,390);
  pointer('pointerup',p.x+40,p.y);assert.equal(world.events.filter(e=>e.type==='shoot').length,0);
});

test('endless battle and Boss guides turn all seven dots with rapid input at every travel speed',t=>{
  t.after(()=>app.setFeedbackStrength(.6));
  const turns=[[0,1],[1,0],[-1,0],[0,-1],[-.6,.8]];
  for(const phase of ['battle','boss'])for(const units of [0,19.999,20,20.001,40]){
    const {g,world,scene,pointer}=controlRun(),p=world.player;
    if(phase==='boss'){world.stage=5;world.beginBoss();world.phase='boss';world.events=[];}
    p.vx=units*world.unit;p.vy=0;
    const start={x:p.x,y:p.y},incoming={vx:p.vx,vy:p.vy};
    pointer('pointerdown',start.x,start.y,{timeStamp:1000});
    for(const [turn,[dx,dy]] of turns.entries()){
      pointer('pointermove',start.x+dx*world.maxPull,start.y+dy*world.maxPull,{timeStamp:1004+turn*4});
      scene.update(0,0);
      const dots=g.shapes.filter(shape=>shape.type==='circle'&&shape.r===1.7);
      assert.equal(dots.length,7,`${phase} at ${units} units/s, turn ${turn}`);
      for(const [index,dot] of dots.entries()){
        const distance=p.r+12+(index+1)*16;
        near(dot.x,p.x-dx*distance);near(dot.y,p.y-dy*distance);
        near(dot.alpha,.36*(1-(index+1)/9));
      }
      const arrow=g.shapes.find(shape=>shape.type==='stroke'&&shape.width===1.4);
      assert.ok(arrow);near(arrow.points[1].x,dots[6].x);near(arrow.points[1].y,dots[6].y);
      const base={x:(arrow.points[0].x+arrow.points[2].x)/2,y:(arrow.points[0].y+arrow.points[2].y)/2};
      near(arrow.points[1].x-base.x,-dx*6);near(arrow.points[1].y-base.y,-dy*6);
      near(p.vx,incoming.vx);near(p.vy,incoming.vy,'aiming must not redirect the moving ball before release');
    }
    const [dx,dy]=turns.at(-1);
    pointer('pointerup',start.x+dx*world.maxPull,start.y+dy*world.maxPull,{timeStamp:1024});
    const speed=Math.hypot(p.vx,p.vy);
    assert.ok(speed>0);near(p.vx/speed,-dx);near(p.vy/speed,-dy,'release follows the entire displayed guide');
    assert.equal(world.events.filter(e=>e.type==='shoot').length,1);
    assert.equal(app.readRestart().drag,null);
  }
});

test('slow aim expires across a stalled frame while simulation keeps its bounded real-time tick',()=>{
  const {world,scene,pointer}=controlRun(),p=world.player,calls=[],step=world.step;
  world.step=function(dt,dragging,options){calls.push({dt,dragging,options});return step.call(this,dt,dragging,options);};
  pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+30,p.y);scene.update(0,0);
  advanceScene(scene,.05);assert.equal(calls.length,6);calls.forEach(call=>near(call.dt,.3/120));
  assert.ok(calls.every(call=>Math.abs(call.options.timeScale-.3)<1e-8));
  scene.update(0,2000);near(scene.timeScale,1);assert.ok(scene.inputClock>=2.05-1e-8);
  assert.equal(calls.length,12,'a stalled frame caps catch-up at six real ticks');
  for(const call of calls){near(call.dt/call.options.timeScale,1/120);assert.ok(call.dt<=1/120+1e-12);}
  pointer('pointercancel');app.setFeedbackStrength(.6);
});

test('a kill during slow aim releases its frozen target in real time and emits its shards once',t=>{
  const {world,scene}=feedbackRun(),pointer=inputCanvas(),p=world.player;
  const audio=app.recordFeedbackAudio(),shards=[],particles=scene.particles;
  scene.particles=function(event,...args){shards.push(event);return particles.call(this,event,...args);};
  t.after(()=>{pointer('pointercancel');audio.restore();app.setFeedbackStrength(.6);});
  pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x,p.y+40);scene.update(0,0);near(scene.timeScale,.3);
  const event=collideFeedbackEnemy(world),start=world.time;scene.update(0,0);
  assert.ok(Number.isFinite(event.feedbackTime));assert.equal(scene.impactGhosts.length,1);
  advanceScene(scene,.05);assert.equal(scene.impactGhosts.length,1);
  advanceScene(scene,.05);assert.equal(scene.impactGhosts.length,0);
  assert.ok(world.time-start<.05,'the hold expires before eighty milliseconds of slowed world time');
  assert.equal(shards.filter(e=>e===event).length,1);assert.equal(audio.calls.filter(c=>c.name==='impact'&&c.args[0].kind==='kill').length,1);
  advanceScene(scene,.1);assert.equal(shards.filter(e=>e===event).length,1);
});

test('normal and reduced-motion slow aim move and paint on every 30, 60 and 120 Hz frame',async()=>{
  for(const reduced of [false,true])await withReloadedEntry({juice:.6,expressions:false},reduced,fresh=>{
    for(const hz of [30,60,120])for(const aiming of [false,true]){
      const {world,scene,pointer,g}=controlRun(fresh,.6),p=world.player;
      Object.assign(p,{x:100,y:400,vx:world.unit*4,vy:0});
      const enemy=world.makeBody(250,550,world.unit,.8);
      Object.assign(enemy,{hp:100,maxHp:100,born:1,solid:true,vx:-world.unit*2,vy:0});world.enemies=[enemy];
      const auxiliary=world.makeBody(100,680,world.unit*.5,1);
      Object.assign(auxiliary,{isAuxiliary:true,hp:Infinity,born:1,solid:true,vx:world.unit*12,vy:0});world.auxiliaries=[auxiliary];
      if(aiming){pointer('pointerdown',100,400);pointer('pointermove',100,440);}
      const minimum=aiming?(reduced?.6:.3):1,start=world.time,steps=[],step=world.step;
      world.step=function(dt,dragging,options){steps.push({dt,scale:options.timeScale});return step.call(this,dt,dragging,options);};
      let previousX=p.x,previousEnemyX=enemy.x,previousAuxX=auxiliary.x,previousPaintX=null;
      for(let frame=1;frame<=hz;frame++){
        scene.update(frame*1000/hz,1000/hz);
        assert.ok(p.x>previousX,`${hz} Hz, ${minimum}x: player cannot repeat a stationary frame`);
        assert.ok(enemy.x<previousEnemyX,`${hz} Hz, ${minimum}x: enemies must also move every frame`);
        assert.ok(world.auxiliaries.includes(auxiliary)&&auxiliary.x>previousAuxX,'split balls keep the same continuous cadence');
        const painted=bodyShapes(g).at(-1);assert.ok(painted?.points.length>10,'the real draw path paints the player');
        const paintX=(Math.min(...painted.points.map(point=>point.x))+Math.max(...painted.points.map(point=>point.x)))/2;
        if(previousPaintX!==null)assert.ok(paintX>previousPaintX,'the rendered ball advances with physics');
        previousX=p.x;previousEnemyX=enemy.x;previousAuxX=auxiliary.x;previousPaintX=paintX;
      }
      assert.equal(steps.length,120,'slow motion keeps the same update count as normal speed');
      near(world.time-start,minimum);near(world.feedbackTime,1);near(scene.accumulator,0);
      steps.forEach(call=>{near(call.dt,minimum/120);near(call.dt/call.scale,1/120);});
      pointer('pointercancel');
    }
  });
});

test('real frame remainders conserve feedback time across slow and normal aim, including a freeze across release',t=>{
  const {world,scene}=feedbackRun(),pointer=inputCanvas(),p=world.player,enemy=world.enemies[0];
  world.enemies=[enemy];world.events=[];
  const shards=[],particles=scene.particles;
  scene.particles=function(event,...args){shards.push(event);return particles.call(this,event,...args);};
  t.after(()=>{pointer('pointercancel');app.setFeedbackStrength(.6);});
  let budget=0,kill,shot;
  const frame=milliseconds=>{
    budget+=milliseconds/1000;scene.update(0,milliseconds);
    const pendingReal=scene.timeSlices.reduce((sum,slice)=>sum+slice.world/slice.scale,0);
    near(scene.accumulator,pendingReal);near(world.feedbackTime+pendingReal,budget);
    assert.ok(scene.timeSlices.every(slice=>slice.world>0&&slice.scale>0&&Number.isFinite(slice.world/slice.scale)));
    if(shot)near(p.feedbackFreeze,Math.max(0,shot.freezeDuration-(world.feedbackTime-shot.feedbackTime)));
    if(kill){
      const stillHeld=world.feedbackTime-kill.feedbackTime<kill.freezeDuration-1e-10;
      assert.equal(scene.impactGhosts.some(ghost=>ghost.event===kill),stillHeld,'the held target expires on conserved real feedback time');
      assert.equal(shards.filter(event=>event===kill).length,stillHeld?0:1);
    }
  };
  const begin=()=>{
    const start={x:p.x,y:p.y};pointer('pointerdown',start.x,start.y);pointer('pointermove',start.x,start.y+40);
    near(scene.timeScale,.3);return start;
  };
  frame(7);assert.equal(world.feedbackTime,0);assert.ok(scene.timeSlices.some(slice=>slice.scale===1));
  const start=begin();
  Object.assign(enemy,{born:1,solid:true,hp:1,x:p.x+p.r+enemy.r-.5,y:p.y,vx:0,vy:0});p.vx=world.baseSpeed;p.vy=0;
  frame(17);assert.equal(scene.impactGhosts.length,1);kill=scene.impactGhosts[0].event;
  assert.ok(scene.timeSlices.some(slice=>Math.abs(slice.scale-.3)<1e-8),'a real slowed frame leaves a fraction to cross the release');
  pointer('pointerup',start.x,start.y+40);near(scene.timeScale,1);shot=world.events.find(event=>event.type==='shoot');assert.ok(shot);
  frame(6);assert.ok(p.feedbackFreeze>0);frame(11);assert.ok(p.feedbackFreeze>0);
  begin();frame(23);assert.equal(p.feedbackFreeze,0,'the release hold expires while the next aim is already slow');
  pointer('pointercancel');frame(8);
  for(const milliseconds of [4,7,12,9])frame(milliseconds);
  assert.equal(scene.impactGhosts.length,0);assert.equal(shards.filter(event=>event===kill).length,1);
  shot=null;
  for(let cycle=0;cycle<4;cycle++){
    frame(7);const next=begin();frame(17);
    pointer('pointerup',next.x,next.y+40);frame(9);
  }
  frame(50);
  assert.ok(scene.timeSlices.every(slice=>slice.scale===1),'normal frames eventually consume every historical slow slice');
  assert.ok(budget-world.feedbackTime<1/120+1e-8,'only the current unconsumed fixed-step fraction remains');
});

test('a real slow final kill passes through clearing and restores later steps in its frame to normal transition time',t=>{
  const {world,scene}=feedbackRun(),pointer=inputCanvas(),p=world.player,enemy=world.enemies[0],steps=[],step=world.step;
  t.after(()=>{pointer('pointercancel');app.setFeedbackStrength(.6);});
  world.enemies=[enemy];world.events=[];world.stageKills=world.killTarget-1;world.score=130;
  world.feedbackFreezeUsed=.25;app.resetScoreHud();
  world.step=function(dt,dragging,options){
    const record={before:this.phase,scale:options.timeScale,dt};steps.push(record);
    const result=step.call(this,dt,dragging,options);record.after=this.phase;record.feedbackAfter=this.feedbackTime;return result;
  };
  pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x,p.y+40);scene.update(0,7);
  assert.equal(steps.length,0);assert.ok(scene.timeSlices.length>0,'the fixture creates its slow remainder through a real frame');
  Object.assign(enemy,{born:1,solid:true,hp:1,x:p.x+p.r+enemy.r-.5,y:p.y,vx:0,vy:0});p.vx=world.baseSpeed;p.vy=0;
  scene.update(0,50);
  assert.ok(steps.some(record=>record.before==='battle'&&record.after==='clearing'));
  const crossing=steps.findIndex(record=>record.before==='clearing'&&record.after==='transition');
  assert.ok(crossing>=0);near(steps[crossing].scale,.3);
  const later=steps.slice(crossing+1);assert.ok(later.length>=1,'the kill frame has budget for further real transition steps');
  assert.ok(later.every(record=>record.before==='transition'&&Math.abs(record.scale-1)<1e-12&&Math.abs(record.dt-1/120)<1e-12));
  assert.equal(app.readRestart().drag,null);near(scene.timeScale,1);assert.equal(world.score,140);
  assert.ok(scene.timeSlices.every(slice=>slice.scale===1));
  near(world.feedbackTime+scene.timeSlices.reduce((sum,slice)=>sum+slice.world/slice.scale,0),.057);
  const deadline=steps[crossing].feedbackAfter+world.rewardTiming.transition;
  advanceScene(scene,deadline-.057-.002);assert.equal(world.phase,'transition','the ordinary transition finishes before showing choices');
  advanceScene(scene,1/120+.004);assert.equal(world.phase,'choose');assert.equal(world.choices.length,3);
  assert.ok(element('#choice-labels').children.length>0&&element('#choice-labels').children.every(node=>node.style.opacity==='1'));
});

test('charge sound follows the current pull and stops immediately on cancellation or release',t=>{
  const {world}=feedbackRun(),pointer=inputCanvas(),audio=app.recordFeedbackAudio();
  t.after(()=>{audio.restore();app.setFeedbackStrength(.6);});
  const p=world.player,move=amount=>pointer('pointermove',p.x+world.maxPull*amount,p.y);
  pointer('pointerdown',p.x,p.y);
  const amounts=[.49,.5,.65,.8,.9,1,.4,.8,1];
  for(const amount of amounts)move(amount);
  const chargeCalls=audio.calls.filter(c=>c.name==='setCharge');
  assert.equal(chargeCalls.length,amounts.length);
  chargeCalls.forEach((call,index)=>near(call.args[0],amounts[index]));
  pointer('pointercancel');assert.equal(app.readRestart().drag,null);assert.equal(audio.calls.at(-1).name,'stopCharge');
  pointer('pointerdown',p.x,p.y);move(.5);assert.equal(audio.calls.at(-1).name,'setCharge');near(audio.calls.at(-1).args[0],.5);
  pointer('lostpointercapture');assert.equal(audio.calls.at(-1).name,'stopCharge');
  pointer('pointerdown',p.x,p.y);move(.8);pointer('pointerup',p.x+world.maxPull*.8,p.y);
  assert.equal(audio.calls.at(-1).name,'stopCharge','release stops the sustained tone before the launch event is played');
  assert.equal(world.events.filter(e=>e.type==='shoot').length,1,'cancellation never launches a ball');
});

test('real dragging leaves the border, canvas and collision bounds fixed while charge audio remains active',t=>{
  const {g,world,scene}=feedbackRun(),pointer=inputCanvas(),p=world.player,audio=app.recordFeedbackAudio();
  world.enemies=[];
  t.after(()=>{pointer('pointercancel');audio.restore();app.setFeedbackStrength(.6);});
  scene.update(0,0);const resting={...g.borders[0]},bounds={...world.arenaBounds},canvasTransform=element('#game').style.transform;
  const physical={x:p.x,y:p.y,r:p.r,vx:p.vx,vy:p.vy};
  pointer('pointerdown',p.x,p.y);
  for(const amount of [.49,.5,.79,.8,.99,1,.4,1]){
    pointer('pointermove',p.x+world.maxPull*amount,p.y);advanceScene(scene,.05);
    assert.equal(g.borders.length,1);assert.deepEqual(g.borders[0],resting,'crossing charge thresholds never moves or duplicates the border');
    assert.deepEqual(world.arenaBounds,bounds);assert.equal(element('#game').style.transform,canvasTransform);
    assert.deepEqual({x:p.x,y:p.y,r:p.r,vx:p.vx,vy:p.vy},physical);
    assert.equal(scene.zoomPulse,null);assert.equal(scene.feedbackCamera,null);
  }
  assert.equal(audio.calls.filter(c=>c.name==='setCharge').length,8);
  pointer('pointercancel');assert.equal(audio.calls.at(-1).name,'stopCharge');
  advanceScene(scene,.2);assert.deepEqual(g.borders[0],resting);
  p.x=bounds.left+p.r+.25;p.y=world.height*.5;p.vx=-world.unit*5;p.vy=0;world.step(1/120,false);
  assert.ok(p.vx>0);near(p.x-p.r,bounds.left);assert.deepEqual(world.arenaBounds,bounds);
});

test('a lethal physics contact plays one kill sound, holds its target, then emits directional shards once',t=>{
  const {g,world,scene}=feedbackRun(),audio=app.recordFeedbackAudio();
  t.after(()=>{audio.restore();app.setFeedbackStrength(.6);});
  const event=collideFeedbackEnemy(world);
  assert.ok(world.events.some(e=>e.type==='hit'&&e.lethal),'the event queue includes the associated lethal hit');
  scene.update(0,0);
  assert.deepEqual(audio.calls.filter(c=>c.name==='impact').map(c=>c.args[0].kind),['kill']);
  assert.equal(scene.impactGhosts.length,1);assert.equal(scene.effects.filter(e=>e.type==='shard').length,0);
  assert.ok(g.shapes.some(s=>s.type==='path'&&s.color===0xe88c72),'the frozen target is still drawn');
  advanceScene(scene,event.freezeDuration-.001);
  assert.equal(scene.impactGhosts.length,1);assert.equal(scene.effects.filter(e=>e.type==='shard').length,0);
  // The scene ticks every 1/120 real seconds; cross one physical tick rather
  // than assuming a 2 ms render frame must have advanced the world clock.
  scene.update(0,1000/120);
  assert.equal(scene.impactGhosts.length,0);
  const shards=scene.effects.filter(e=>e.type==='shard');assert.ok(shards.length>=3);
  for(const shard of shards){near(shard.x,event.contactX);near(shard.y,event.contactY);assert.ok(shard.vx*event.nx+shard.vy*event.ny>0);}
  scene.update(0,0);assert.equal(scene.effects.filter(e=>e.type==='shard').length,shards.length,'an expired ghost cannot emit twice');
  assert.deepEqual(audio.calls.filter(c=>c.name==='impact').map(c=>c.args[0].kind),['kill']);
});

function triggerLastEndlessKill(module=app,{strength=1,exhausted=false}={}){
  const run=feedbackRun(module,strength),{world,scene}=run;
  world.stageKills=world.killTarget-1;world.score=130;module.resetScoreHud();
  if(exhausted){world.feedbackFreezeUsed=.25;world.player.feedbackFreeze=0;}
  const shardCalls=[],particles=scene.particles;
  scene.particles=function(event,...args){shardCalls.push(event);return particles.call(this,event,...args);};
  const event=collideFeedbackEnemy(world);
  assert.equal(world.phase,'clearing','the real threshold collision begins clearing before scene feedback is handled');
  assert.equal(world.stageKills,world.killTarget);assert.equal(world.score,140);assert.ok(world.events.some(e=>e.type==='clearingStart'));
  return {...run,event,shardCalls};
}

test('the last endless kill keeps its sound and held target while its clear zoom completes through the reward transition',t=>{
  const audio=app.recordFeedbackAudio(),tones=app.recordTones();
  t.after(()=>{audio.restore();tones.restore();app.setFeedbackStrength(.6);});
  const {world,scene,event,shardCalls}=triggerLastEndlessKill();scene.update(0,0);
  assert.deepEqual(audio.calls.filter(c=>c.name==='impact').map(c=>c.args[0].kind),['kill']);
  assert.equal(scene.impactGhosts.length,1);assert.equal(shardCalls.length,0);
  assert.equal(scene.zoomPulse.kind,'clear','the final impact starts the stronger clear envelope');
  assert.equal(tones.calls.filter(args=>args[0]===480).length,0,'the upgrade tone must not cover the kill attack');
  advanceScene(scene,.08);near(scene.feedbackCamera.zoom,1.04);
  assert.equal(world.phase,'clearing');assert.equal(tones.calls.filter(args=>args[0]===480).length,0);
  scene.update(0,1000/120);
  assert.equal(world.phase,'transition');assert.equal(scene.impactGhosts.length,0);assert.equal(shardCalls.filter(e=>e===event).length,1);
  assert.equal(tones.calls.filter(args=>args[0]===480).length,1,'upgrade sound follows only after clearing and the last hold finish');
  advanceScene(scene,.87);assert.equal(scene.zoomPulse,null);assert.equal(scene.feedbackCamera,null);assert.equal(element('#game').style.transform,'none');
  assert.equal(shardCalls.filter(e=>e===event).length,1);assert.deepEqual(audio.calls.filter(c=>c.name==='impact').map(c=>c.args[0].kind),['kill']);
  advanceScene(scene,world.rewardTiming.transition-world.phaseTime+.02);
  assert.equal(world.phase,'choose');assert.equal(world.ready,true);assert.equal(world.choices.length,3);
  assert.ok(element('#choice-labels').children.length>0&&element('#choice-labels').children.every(node=>node.style.opacity==='1'));
  const choice=world.choices[0];world.player.x=choice.x;world.player.y=choice.y;world.player.vx=world.player.vy=0;
  scene.update(0,1000/120);assert.equal(world.phase,'reward','the visible reward ball is still selectable');
  advanceScene(scene,world.rewardTiming.rest+.01);assert.equal(world.phase,'battle');assert.equal(world.stage,2);assert.equal(world.enemies.length,7);assert.equal(world.stageKills,0);
  assert.equal(tones.calls.filter(args=>args[0]===480).length,1,'leaving the reward transition cannot replay its cue');
});

test('a final kill with exhausted freeze budget still emits its shards, kill sound and full clear zoom',t=>{
  const audio=app.recordFeedbackAudio();t.after(()=>{audio.restore();app.setFeedbackStrength(.6);});
  const {world,scene,event,shardCalls}=triggerLastEndlessKill(app,{exhausted:true});
  assert.equal(event.freezeDuration,0);scene.update(0,0);
  assert.equal(scene.impactGhosts.length,0);assert.equal(shardCalls.filter(e=>e===event).length,1);
  assert.deepEqual(audio.calls.filter(c=>c.name==='impact').map(c=>c.args[0].kind),['kill']);
  advanceScene(scene,.08);near(scene.feedbackCamera.zoom,1.04);assert.equal(world.phase,'transition');
  advanceScene(scene,.871);assert.equal(scene.zoomPulse,null);assert.equal(shardCalls.filter(e=>e===event).length,1);
});

test('last-kill reward transitions still suppress zoom at zero strength and under reduced motion',async()=>{
  for(const reduced of [false,true])await withReloadedEntry({juice:reduced?1:0,expressions:false},reduced,fresh=>{
    const {world,scene,event,shardCalls}=triggerLastEndlessKill(fresh,{strength:reduced?1:0});scene.update(0,0);
    assert.equal(scene.zoomPulse,null);advanceScene(scene,.3);
    assert.equal(scene.feedbackCamera,null);assert.equal(element('#game').style.transform,'none');
    assert.equal(scene.impactGhosts.length,0);assert.equal(shardCalls.filter(e=>e===event).length,1);
    advanceScene(scene,world.rewardTiming.transition-world.phaseTime+.02);assert.equal(world.phase,'choose');assert.equal(world.choices.length,3);
  });
});

test('the last-kill clearing pauses its upgrade cue and restarting discards the unfinished clear',t=>{
  const tones=app.recordTones();t.after(()=>{tones.restore();app.setFeedbackStrength(.6);});
  let run=triggerLastEndlessKill();run.scene.update(0,0);advanceScene(run.scene,.05);
  clickAction('pause');advanceScene(run.scene,.5);assert.equal(tones.calls.filter(args=>args[0]===480).length,0);
  clickAction('resume');app.advanceUi(.42);advanceScene(run.scene,.12);
  assert.equal(tones.calls.filter(args=>args[0]===480).length,1);
  run=triggerLastEndlessKill();run.scene.update(0,0);
  clickAction('pause');app.advanceUi(.42);clickRestart();app.advanceUi(.65);advanceScene(run.scene,.3);
  assert.equal(tones.calls.filter(args=>args[0]===480).length,2,'only the new starting choice adds a cue; the abandoned clearing cue cannot leak');
});

function rhythmEnemy(world,x,y,{hp=1000,r=world.unit*.7}={}){
  const body=world.makeBody(x,y,r,.8);
  Object.assign(body,{hp,maxHp:hp,born:1,solid:true,vx:0,vy:0});world.enemies.push(body);return body;
}
function pressureRun(count,module=app,strength=1){
  const run=controlRun(module,strength),{world}=run;
  Object.assign(world.player,{x:world.width/2,y:world.height-70,vx:0,vy:0});
  for(let i=0;i<count;i++)rhythmEnemy(world,50+i%5*58,100+Math.floor(i/5)*96);
  return run;
}
function clearingRun(module=app,strength=1){
  const run=controlRun(module,strength),{world,scene}=run;
  world.stageKills=world.killTarget-1;
  const last=rhythmEnemy(world,100,250,{hp:1});rhythmEnemy(world,320,730);
  world.damage(last,2);scene.update(0,1000/120);
  assert.equal(world.phase,'clearing');return run;
}

test('a real endless opening has six clustered balls, waits two intervals, then delivers its scheduled wave and floor refills',()=>{
  let g=graphicsRecorder(),{world,scene}=app.seedRenderer(g,390,844,true);app.setFeedbackStrength(0);
  const opening=new Set(world.enemies.map(body=>body.id)),events=observeWorldEvents(world);
  assert.equal(opening.size,6);assert.equal(new Set(world.enemies.map(body=>body.clusterId)).size,1);
  scene.update(0,0);assertStageProgress(world);assert.equal(element('#stage-progress').hidden,false);
  advanceScene(scene,3.99);assert.equal(world.enemies.length,6);
  advanceScene(scene,.02);assert.equal(world.enemies.length,7);
  advanceScene(scene,.28);assert.equal(world.enemies.length,7);
  advanceScene(scene,.02);assert.equal(world.enemies.length,8);
  advanceScene(scene,.61);assert.equal(world.enemies.length,10);
  const wave=events.filter(event=>event.type==='spawn'&&!opening.has(event.bodyId));
  assert.equal(wave.length,4);assert.equal(new Set(wave.map(event=>event.clusterId)).size,1);
  for(const event of wave){const body=world.enemies.find(enemy=>enemy.id===event.bodyId);assert.ok(Math.hypot(event.x-body.clusterX,event.y-body.clusterY)<=world.unit*2.5+1e-6);}
  g=graphicsRecorder();({world,scene}=app.seedRenderer(g,390,844,true));app.setFeedbackStrength(0);
  for(const body of world.enemies.slice(0,4))world.damage(body,1000);
  scene.update(0,1000/120);assert.equal(world.liveCount,3,'the floor starts replenishing immediately');
  advanceScene(scene,.13);assert.equal(world.liveCount,3);
  advanceScene(scene,.02);assert.equal(world.liveCount,4);
  advanceScene(scene,.31);assert.equal(world.liveCount,6);assert.equal(world.stageKills,4);
  assertStageProgress(world);app.setFeedbackStrength(.6);
});

test('a complete real kill batch carries its surplus through ordered fixed-score clearing and the ordinary reward flow',t=>{
  const {world,scene}=controlRun(),audio=app.recordClearAudio(),events=observeWorldEvents(world);
  t.after(()=>{audio.restore();app.setFeedbackStrength(.6);});
  const targets=Array.from({length:15},()=>rhythmEnemy(world,120,420,{hp:1}));
  const survivors=[[145,420],[220,420],[300,700]].map(([x,y])=>rhythmEnemy(world,x,y));
  assert.equal(world.shoot(0,-world.maxPull),true);
  for(let index=0;index<13;index++)world.damage(targets[index],2);
  scene.update(0,0);assert.equal(world.phase,'battle');assert.equal(world.stageKills,13);assertStageProgress(world);
  world.damage(targets[13],2);assert.ok(world.pendingClearing);world.damage(targets[14],2);
  assert.equal(world.stageKills,15);assert.equal(world.score,1365,'single-shot combo caps at eight while third-kill bonus continues');
  let budget=0,sawExpiredGhost=false;
  for(let frame=0;frame<600&&world.phase!=='transition';frame++){
    scene.update(0,1000/120);budget+=1/120;
    near(world.feedbackTime+scene.timeSlices.reduce((sum,slice)=>sum+slice.world/slice.scale,0),budget);
    if(world.phase==='clearing'){
      assert.equal(world.stageKills,15);assert.equal(world.stageKillCarry,1);assert.equal(world.shotKills,15);
      assertStageProgress(world);
      if(budget>.2){assert.equal(scene.impactGhosts.length,0);sawExpiredGhost=true;}
    }
  }
  assert.ok(sawExpiredGhost,'last-hit holds end while the outward wave is still travelling');
  assert.equal(world.phase,'transition');assert.equal(world.clearing,null);assert.equal(world.score,1395);
  const cleared=events.filter(event=>event.type==='clearKill');
  assert.deepEqual(cleared.map(event=>event.bodyId),survivors.map(body=>body.id));
  assert.ok(cleared.every(event=>event.value===10&&event.freezeDuration===0));
  assert.deepEqual(cleared.map(event=>event.feedbackLevel),[16,17,18]);
  assert.equal(events.filter(event=>event.type==='clearingStart').length,1);assert.equal(events.filter(event=>event.type==='clearingEnd').length,1);
  assert.equal(events.filter(event=>event.type==='upgrade').length,1);assert.equal(audio.calls.filter(call=>call.name==='clearStart').length,1);
  assert.equal(element('#stage-progress').hidden,false,'the completed stage dots begin a continuous fade at the reward boundary');
  assert.ok(Number(element('#stage-progress').style.opacity)>0&&Number(element('#stage-progress').style.opacity)<=1);near(scene.timeScale,1);
  advanceScene(scene,world.rewardTiming.transition-.01-world.phaseTime);assert.equal(world.phase,'transition');
  advanceScene(scene,.02);assert.equal(world.phase,'choose');assert.equal(world.choices.length,3);assert.equal(element('#score').textContent,'1395');
  assert.equal(element('#stage-progress').hidden,true);assert.equal(element('#stage-caption').hidden,true);
  const choice=world.choices[0];Object.assign(world.player,{x:choice.x,y:choice.y,vx:0,vy:0});scene.update(0,1000/120);
  assert.equal(world.phase,'reward');advanceScene(scene,world.rewardTiming.rest-.01);assert.equal(world.phase,'reward');advanceScene(scene,.02);
  assert.equal(world.phase,'battle');assert.equal(world.stage,2);assert.equal(world.killTarget,18);assert.equal(world.stageKills,1);assert.equal(world.stageKillCarry,0);
  assert.equal(world.enemies.length,7);assertStageProgress(world);
  assert.ok(world.spawnTimer>2*world.spawnInterval-.04&&world.spawnTimer<=2*world.spawnInterval);
});

test('red pressure is layered above the unchanged original border and cannot move collision walls',async()=>{
  const geometry=border=>({x:border.x,y:border.y,width:border.width,height:border.height,r:border.r});
  for(const [strength,reduced] of [[1,false],[0,false],[1,true]])await withReloadedEntry({juice:strength,expressions:false},reduced,fresh=>{
    const {world,scene,g}=pressureRun(23,fresh,strength),bounds={...world.arenaBounds};scene.update(0,0);
    const original=geometry(g.borders[0]),base={...g.borders[0]};assert.equal(g.borders.length,1);
    for(let count=24;count<=26;count++){
      rhythmEnemy(world,50+(count-1)%5*58,100+Math.floor((count-1)/5)*96);advanceScene(scene,.35);
      assert.equal(g.borders.length,3);assert.deepEqual(g.borders[0],base,'base color, opacity and width remain intact');
      for(const overlay of g.borders.slice(1)){
        assert.deepEqual(geometry(overlay),original);assert.equal(overlay.strokeColor,0xd94f4f);
        assert.ok(overlay.strokeAlpha>0&&overlay.strokeAlpha<=.54);
      }
      assert.ok(g.borders[2].strokeWidth>2&&g.borders[2].strokeWidth<=3.2);assert.deepEqual(world.arenaBounds,bounds);
    }
    advanceScene(scene,3);const warning={...g.borders[2]};advanceScene(scene,.18);
    assert.deepEqual(g.borders[0],base);assert.deepEqual(world.arenaBounds,bounds);
    if(strength===0||reduced)near(g.borders[2].strokeAlpha,warning.strokeAlpha);
    else assert.ok(Math.abs(g.borders[2].strokeAlpha-warning.strokeAlpha)>.001);
    Object.assign(world.player,{x:bounds.left+world.player.r-1,y:world.height-70,vx:-100,vy:0});world.wall(world.player);
    near(world.player.x-world.player.r,bounds.left);assert.ok(world.player.vx>0);assert.deepEqual(world.arenaBounds,bounds);
  });
});

test('the actual red border uses one slot per split family until its final child dies',t=>{
  const {world,scene,g}=pressureRun(24);
  t.after(()=>{app.seedRenderer(graphicsRecorder());app.setFeedbackStrength(.6);});
  const family=world.enemies.slice(0,3),familyId=family[0].id;
  for(const child of family)Object.assign(child,{enemyType:'fragment',splitFamilyId:familyId});
  assert.equal(world.liveCount,24);assert.equal(world.pressureCount,22);
  advanceScene(scene,.35);assert.equal(scene.pressureWarning.active,false);
  assert.ok(g.borders.every(border=>border.strokeColor!==0xd94f4f));
  for(let i=0;i<2;i++)rhythmEnemy(world,50+i*58,700);
  advanceScene(scene,.35);assert.equal(world.pressureCount,24);assert.equal(scene.pressureWarning.active,true);
  for(const child of family.slice(0,2)){
    world.damage(child,child.hp+1);scene.handleEvents();advanceScene(scene,.1);
    assert.equal(world.pressureCount,24);assert.equal(scene.pressureWarning.active,true);
  }
  world.damage(family[2],family[2].hp+1);scene.handleEvents();advanceScene(scene,.7);
  assert.equal(world.pressureCount,23);assert.equal(scene.pressureWarning.active,false);
  assert.equal(scene.pressureWarning.alpha,0);
});

test('red warning breathes out continuously across real phase, menu and World replacement transitions',t=>{
  t.after(()=>{document.hidden=false;app.setFeedbackStrength(.6);});
  const transitions={
    'below threshold':({world})=>{world.enemies.splice(0,3);},
    clearing:({world})=>world.beginClearing(),
    reward:({world})=>world.beginUpgrade(),
    Boss:({world})=>world.beginBoss(),
    pause:()=>clickAction('pause'),
    settings:()=>{clickAction('pause');app.advanceUi(.42);clickAction('settings');},
    home:()=>clickAction('home'),
    restart:()=>clickRestart(),
    ending:({world})=>world.endRun('capacity'),
    background:()=>{document.hidden=true;for(const handler of listeners.get('visibilitychange'))handler();}
  };
  for(const [name,transition] of Object.entries(transitions)){
    const run=pressureRun(26),{scene,g}=run;advanceScene(scene,.42);
    const before=scene.pressureWarning.alpha;assert.ok(before>.1,name);
    transition(run);scene.update(0,0);
    near(scene.pressureWarning.alpha,before);assert.ok(g.borders.some(border=>border.strokeColor===0xd94f4f),name+' keeps its last red frame');
    if(name!=='ending')scene.resetFeedback();
    near(scene.pressureWarning.alpha,before);
    advanceScene(scene,.325);near(scene.pressureWarning.alpha,before/2);
    assert.ok(g.borders.some(border=>border.strokeColor===0xd94f4f),name+' has a visible half breath');
    if(name==='ending'){
      advanceScene(scene,.3);assert.equal(app.readRestart().modal,'over');assert.ok(app.readRestart().result);
      assert.ok(scene.pressureWarning.alpha>0,'the last breath survives the actual result transition');
      assert.ok(g.borders.some(border=>border.strokeColor===0xd94f4f));advanceScene(scene,.035);
    }else advanceScene(scene,.335);
    assert.equal(scene.pressureWarning.alpha,0,name+' finishes the breath');
    assert.ok(g.borders.every(border=>border.strokeColor!==0xd94f4f));
    document.hidden=false;
  }
});

test('pressure rendering never advances its envelope and a restarted run does not inherit the old warning condition',()=>{
  const {scene,world,g}=pressureRun(26);advanceScene(scene,.42);
  const before={alpha:scene.pressureWarning.alpha,phase:scene.pressureWarning.phase};
  for(let i=0;i<5;i++)scene.drawBorder(world.arenaBounds);
  near(scene.pressureWarning.alpha,before.alpha);near(scene.pressureWarning.phase,before.phase);
  clickRestart();const fresh=app.readRestart().world;assert.notEqual(fresh,world);scene.update(0,0);
  near(scene.pressureWarning.alpha,before.alpha);advanceScene(scene,.7);
  assert.equal(scene.pressureWarning.alpha,0);assert.ok(fresh.liveCount<24);assert.ok(g.borders.every(border=>border.strokeColor!==0xd94f4f));
  app.setFeedbackStrength(.6);
});

test('capacity grace uses active real time, rescues the oldest three once, and a second timeout ends with only the best-score caption',t=>{
  const {world,scene,pointer}=pressureRun(28),events=observeWorldEvents(world),oldest=world.enemies.slice(0,3).map(body=>body.id);
  t.after(()=>{pointer('pointercancel');document.hidden=false;app.setFeedbackStrength(.6);});
  for(let shot=0;shot<3;shot++){world.shoot(0,-world.maxPull);world.player.vx=world.player.vy=0;}
  advanceScene(scene,.79);assert.equal(world.saveUsed,false);assert.equal(world.phase,'battle');
  const p=world.player;pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+40,p.y);advanceScene(scene,.05);
  assert.equal(world.saveUsed,true);assert.equal(world.liveCount,25);assert.equal(world.score,0);assert.equal(world.stageKills,0);
  const rescue=events.filter(event=>event.type==='rescue');assert.equal(rescue.length,1);assert.deepEqual(rescue[0].bodyIds,oldest);
  assert.ok(oldest.every(id=>!world.enemies.some(body=>body.id===id)));assert.ok(scene.rescueUntil>world.feedbackTime);
  pointer('pointercancel');clickAction('pause');scene.update(0,0);
  const pausedTime=world.feedbackTime,rescueUntil=scene.rescueUntil;advanceScene(scene,.6);near(world.feedbackTime,pausedTime);near(scene.rescueUntil,rescueUntil);
  clickAction('resume');app.advanceUi(.42);advanceScene(scene,.41);assert.ok(world.feedbackTime>=scene.rescueUntil);
  for(let index=0;index<3;index++)rhythmEnemy(world,50+index*58,100);
  advanceScene(scene,.79);assert.equal(world.phase,'battle');advanceScene(scene,.02);
  assert.equal(world.phase,'over');assert.equal(world.deathReason,'capacity');assert.equal(events.filter(event=>event.type==='rescue').length,1);
  assert.ok(scene.ending);assert.equal(app.readRestart().modal,null);advanceScene(scene,.61);
  assert.equal(app.readRestart().modal,'over');assert.equal(element('#result-reason').hidden,true);
  assert.equal(element('#result-reason').textContent,'');
  assert.equal(scene.rescueUntil,0);assert.equal(scene.zoomPulse,null);assert.equal(scene.impactGhosts.length,0);
});

test('clearing pauses safely through menus and backgrounding, then restart removes all old rhythm state',t=>{
  const audio=app.recordClearAudio();t.after(()=>{audio.restore();document.hidden=false;app.setFeedbackStrength(.6);});
  for(const interruption of ['pause','pagehide']){
    const {world,scene}=clearingRun();advanceScene(scene,.05);
    if(interruption==='pause')clickAction('pause');else for(const handler of windowListeners.get('pagehide'))handler();
    scene.update(0,0);const frozen=JSON.stringify({time:world.time,feedbackTime:world.feedbackTime,clearing:world.clearing,score:world.score});
    advanceScene(scene,.5);assert.equal(JSON.stringify({time:world.time,feedbackTime:world.feedbackTime,clearing:world.clearing,score:world.score}),frozen);
    assert.equal(scene.zoomPulse,null);assert.equal(element('#game').style.transform,'none');assert.equal(audio.calls.at(-1).name,'clearEnd');
    clickAction('resume');app.advanceUi(.42);advanceScene(scene,.05);assert.equal(world.phase,'clearing');assert.ok(world.feedbackTime>JSON.parse(frozen).feedbackTime);
    clickAction('pause');app.advanceUi(.42);clickRestart();const fresh=app.readRestart().world;
    assert.notEqual(fresh,world);assert.equal(fresh.clearing,null);assert.equal(fresh.pendingClearing,null);assert.equal(fresh.stageKills,0);
    assert.equal(fresh.saveUsed,false);assert.equal(fresh.overTimer,0);assert.equal(scene.rescueUntil,0);assert.equal(scene.impactGhosts.length,0);
    assert.deepEqual(scene.timeSlices,[]);assert.equal(element('#stage-progress').hidden,true);
    app.advanceUi(.65);advanceScene(scene,.1);assert.equal(fresh.score,0);assert.equal(fresh.enemies.length,0);assert.equal(fresh.startingUpgrades,true);assert.equal(fresh.rewardSelectionsRemaining,1);
    if(interruption==='pagehide')for(const handler of windowListeners.get('pageshow'))handler();
  }
});

test('resizing during clearing maps the wave and clears stale feedback without changing the earned score',t=>{
  const {world,scene,g,pointer}=clearingRun(),previous={width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio,add:window.addEventListener};let resize;
  window.addEventListener=(type,handler)=>{if(type==='resize')resize=handler;else previous.add(type,handler);};
  t.after(()=>{window.innerWidth=previous.width;window.innerHeight=previous.height;window.devicePixelRatio=previous.dpr;window.addEventListener=previous.add;app.setFeedbackStrength(.6);});
  app.mountSceneBoundary(pointer.canvas,g);advanceScene(scene,.04);
  const before={...world.clearing},score=world.score;assert.ok(scene.zoomPulse);assert.ok(scene.impactGhosts.length>0);
  window.innerWidth=844;window.innerHeight=390;resize();
  assert.equal(world.phase,'clearing');near(world.clearing.x,before.x*844/390);near(world.clearing.y,before.y*390/844);
  near(world.clearing.elapsed,before.elapsed);assert.equal(world.score,score);
  assert.equal(scene.zoomPulse,null);assert.equal(scene.impactGhosts.length,0);assert.equal(scene.rescueUntil,0);assert.equal(element('#game').style.transform,'none');
  for(let frame=0;world.phase==='clearing'&&frame<600;frame++)scene.update(0,1000/120);
  assert.equal(world.phase,'transition');assert.equal(world.score,score+10);
});

test('injured endless bodies keep their display size through death and result transfers',()=>{
  for(const mode of ['endless']){
    let g=graphicsRecorder(),run=app.seedRenderer(g,390,844,true),{world,scene}=run;
    app.setFeedbackStrength(1);world.enemies=[];world.spawnTimer=Infinity;world.floorTimer=Infinity;
    const enemy=rhythmEnemy(world,90,240),r=enemy.r;enemy.hp=enemy.maxHp*.5;scene.update(0,0);
    const ink=parseInt(app.readFeedbackSettings().enemy.slice(1),16),body=()=>g.shapes.find(shape=>shape.type==='path'&&shape.color===ink&&shape.points.length===193);
    near(outlineBounds(body()).width,2*r*.91);near(enemy.r,r);
    world.damage(enemy,enemy.hp);world.enemies=[];scene.update(0,0);
    assert.equal(scene.impactGhosts.length,1);near(outlineBounds(body()).width,2*r*.82);near(enemy.r,r);
    g=graphicsRecorder();run=app.seedRenderer(g,390,844,true);({world,scene}=run);world.enemies=[];
    const source=rhythmEnemy(world,90,240);source.hp=source.maxHp*.5;
    world.phase='over';world.emit('over');scene.update(0,0);if(mode==='endless')scene.advanceEnding(.6);
    near(app.readRestart().controlFlight.items[0].from.r,source.r*.91);
  }
  app.setFeedbackStrength(.6);
});

test('score HUD merges consecutive awards, reaches their exact sum within 250 ms, and resets on restart',()=>{
  const {world,scene}=feedbackRun();world.enemies=[];
  world.score=10;scene.update(0,0);assert.equal(element('#score').textContent,'0000');
  advanceScene(scene,.08);
  const before=Number(element('#score').textContent);assert.ok(before>0&&before<10);
  near(Number(/scale\(([^)]+)\)/.exec(element('#score').style.transform)[1]),1.18);
  world.score=35;scene.update(0,0);assert.equal(Number(element('#score').textContent),before,'a new award continues from the displayed value');
  advanceScene(scene,.25);assert.equal(element('#score').textContent,'0035');assert.equal(element('#score').style.transform,'scale(1)');
  clickAction('pause');app.advanceUi(.42);clickRestart();
  assert.equal(element('#score').textContent,'0000');assert.equal(element('#score').style.transform,'scale(1)');
  app.advanceUi(.65);advanceScene(scene,.3);assert.equal(element('#score').textContent,'0000','old pending score cannot reappear');
  app.setFeedbackStrength(.6);
});

test('v7.4 score HUD uses real kill combos and the ordinary or frenzy cap for its pop',t=>{
  t.after(()=>app.setFeedbackStrength(.6));
  for(const [combo,frenzy,peak] of [[1,false,1.22],[2,false,1.26],[3,false,1.30],[8,false,1.50],[12,false,1.50],[12,true,1.66],[20,true,1.66]]){
    const {world,scene}=feedbackRun();world.enemies=[];world.events=[];world.shotKills=combo-1;
    if(frenzy)world.buffs.frenzy=1;
    const victim=rhythmEnemy(world,70,180,{hp:1});world.damage(victim,1);
    const kill=world.events.find(e=>e.type==='kill');assert.equal(kill.combo,combo);
    scene.update(0,0);advanceScene(scene,.08);
    near(Number(/scale\(([^)]+)\)/.exec(element('#score').style.transform)[1]),peak);
    advanceScene(scene,.17);assert.equal(Number(element('#score').textContent),world.score);assert.equal(element('#score').style.transform,'scale(1)');
  }
});

test('v7.4 score HUD combines a same-frame kill batch but clear and Boss awards keep their ordinary pop',t=>{
  t.after(()=>app.setFeedbackStrength(.6));
  const {world,scene}=feedbackRun();world.enemies=[];world.events=[];
  for(let i=0;i<3;i++)world.damage(rhythmEnemy(world,70+i*60,180,{hp:1}),1);
  assert.equal(world.score,75);scene.update(0,0);advanceScene(scene,.08);
  const scale=()=>Number(/scale\(([^)]+)\)/.exec(element('#score').style.transform)[1]);
  near(scale(),1.30);scene.update(0,0);advanceScene(scene,.04);near(scale(),1+.30*Math.sin(Math.PI*.12/.16));
  advanceScene(scene,.13);assert.equal(element('#score').textContent,'0075');
  world.shotKills=12;
  for(const type of ['clearKill','bossScore','bossDefeated']){
    const value=type==='clearKill'?10:100;world.score+=value;
    world.emit(type,{x:70,y:180,r:world.unit,value,combo:12,segment:1,feedbackLevel:1,power:.5});
    scene.update(0,0);advanceScene(scene,.08);near(scale(),1.18,`${type} must not inherit the shot's combo`);
    advanceScene(scene,.17);assert.equal(Number(element('#score').textContent),world.score);
  }
});

test('v7.4 score HUD discards late kill cues already synced before events and does not retain them across restart',t=>{
  t.after(()=>app.setFeedbackStrength(.6));
  const {world,scene}=feedbackRun();world.enemies=[];world.events=[];world.shotKills=11;world.buffs.frenzy=1;
  world.damage(rhythmEnemy(world,70,180,{hp:1}),1);
  app.updateScoreHud();scene.handleEvents();app.updateScoreHud();app.updateScoreHud(.25);
  world.score+=10;app.updateScoreHud();app.updateScoreHud(.08);
  near(Number(/scale\(([^)]+)\)/.exec(element('#score').style.transform)[1]),1.18);
  world.damage(rhythmEnemy(world,140,180,{hp:1}),1);scene.handleEvents();
  clickAction('pause');app.advanceUi(.42);clickRestart();app.advanceUi(.65);
  const restarted=app.readRestart().world;restarted.enemies=[];restarted.spawnTimer=restarted.floorTimer=Infinity;
  restarted.score=10;app.updateScoreHud();app.updateScoreHud(.08);
  near(Number(/scale\(([^)]+)\)/.exec(element('#score').style.transform)[1]),1.18);
});

test('v7.4 score HUD keeps high-combo scores exact without scaling under disabled or reduced feedback',async()=>{
  for(const reduced of [false,true])await withReloadedEntry({juice:reduced?1:0,expressions:false},reduced,fresh=>{
    const {world,scene}=feedbackRun(fresh,reduced?1:0);world.enemies=[];world.events=[];world.shotKills=11;world.buffs.frenzy=1;
    world.damage(rhythmEnemy(world,70,180,{hp:1}),1);scene.update(0,0);advanceScene(scene,.08);
    assert.equal(Number(element('#score').textContent),world.score);assert.equal(element('#score').style.transform,'scale(1)');
  });
});

test('a 50 ms frame paints the frozen target before shattering and pause keeps its pose completely still',()=>{
  const {g,world,scene}=feedbackRun(app,.6),p=world.player,enemy=world.enemies[0];
  world.enemies=[enemy];Object.assign(enemy,{born:1,solid:true,hp:1,x:p.x+p.r+enemy.r-.5,y:p.y,vx:0,vy:0});
  p.vx=world.baseSpeed;p.vy=0;scene.update(0,50);
  assert.equal(scene.impactGhosts.length,1,'a 48 ms hold created during the frame must survive its first draw');
  assert.equal(scene.effects.filter(e=>e.type==='shard').length,0);
  assert.ok(g.shapes.some(s=>s.type==='path'&&s.color===0xe88c72));
  const ghost=scene.impactGhosts[0],body={...ghost.body,feedbackFreeze:.05};
  assert.notEqual(scene.shakenBody(body),body,'the active hold is allowed to shake before pausing');
  clickAction('pause');const age=ghost.life;
  assert.equal(scene.shakenBody(body),body,'pausing suppresses the visual shake immediately');
  advanceScene(scene,.5);assert.equal(ghost.life,age);assert.equal(scene.shakenBody(body),body);
  clickAction('resume');app.advanceUi(.42);advanceScene(scene,.02);
  assert.equal(scene.impactGhosts.length,0);assert.ok(scene.effects.some(e=>e.type==='shard'));
});

test('impact zoom peaks after 80 ms and clears on pause, resume, restart and its normal 280 ms expiry',()=>{
  const {world,scene}=feedbackRun();world.enemies=[];
  const event={x:world.player.x,y:world.player.y,contactX:120,contactY:300,feedbackLevel:1};
  scene.pulseZoom(event);advanceScene(scene,.08);
  near(scene.feedbackCamera.zoom,1.02);assert.equal(element('#game').style.transformOrigin,'120px 300px');
  clickAction('pause');scene.update(0,0);
  assert.equal(scene.zoomPulse,null);assert.equal(scene.feedbackCamera,null);assert.equal(element('#game').style.transform,'none');
  app.advanceUi(.42);clickAction('resume');app.advanceUi(.42);scene.update(0,0);
  assert.equal(element('#game').style.transform,'none');assert.equal(scene.zoomPulse,null);
  scene.pulseZoom({...event,feedbackLevel:4});advanceScene(scene,.08);assert.ok(scene.feedbackCamera.zoom>1.029);
  advanceScene(scene,.201);assert.equal(scene.zoomPulse,null);assert.equal(element('#game').style.transform,'none');
  scene.pulseZoom(event);advanceScene(scene,.04);clickAction('pause');app.advanceUi(.42);clickRestart();
  assert.equal(scene.zoomPulse,null);assert.equal(scene.feedbackCamera,null);assert.equal(element('#game').style.transform,'none');
  app.advanceUi(.65);app.setFeedbackStrength(.6);
});

test('wall feedback deforms one unchanged-color outline and recovers within 180 ms',()=>{
  const {g,world,scene}=feedbackRun();world.enemies=[];
  const p=world.player;p.x=world.arenaBounds.left+p.r-1;p.y=world.height*.5;p.vx=-world.baseSpeed;p.vy=0;
  world.wall(p);p.vx=p.vy=0;scene.update(0,0);
  assert.equal(scene.wallFlashes.length,0);assert.equal(scene.wallBulges.length,1);assert.equal(g.lines.length,0);
  const borderStrokes=()=>g.shapes.filter(shape=>shape.type==='stroke'&&shape.color===0xc8ccbd);
  assert.equal(borderStrokes().length,1);const first=borderStrokes()[0];near(first.width,1);near(first.alpha,.65);
  const peakX=Math.min(...first.points.map(point=>point.x));assert.ok(peakX<scene.lastBorder.left-1);
  assert.equal(g.borders.length,0,'the bulged outline replaces the original straight outline');
  advanceScene(scene,.06);assert.equal(scene.wallBulges.length,1);assert.equal(borderStrokes().length,1);
  const fading=borderStrokes()[0];near(fading.width,1);near(fading.alpha,.65);
  assert.ok(Math.min(...fading.points.map(point=>point.x))>peakX);
  advanceScene(scene,.131);assert.ok(world.borderTime>=.18);assert.equal(scene.wallBulges.length,0);assert.equal(g.lines.length,0);assert.equal(g.borders.length,1);
  app.setFeedbackStrength(.6);
});

test('feedback slider clamps and persists its value while zero immediately clears the active zoom and charge',t=>{
  const {world,scene}=feedbackRun(),audio=app.recordFeedbackAudio();
  t.after(()=>{audio.restore();fireElementInput('#feedback-strength','60');});
  scene.pulseZoom({x:world.player.x,y:world.player.y});scene.updateFeedback(.04);
  fireElementInput('#feedback-strength','35');
  assert.equal(app.readFeedbackSettings().juice,.35);assert.equal(world.feedbackOptions.strength,.35);
  assert.equal(JSON.parse(saved.get('qiuqiule-settings')).juice,.35);assert.equal(element('#feedback-value').value,'35%');
  fireElementInput('#feedback-strength','200');assert.equal(app.readFeedbackSettings().juice,1);
  fireElementInput('#feedback-strength','-10');assert.equal(app.readFeedbackSettings().juice,0);
  assert.equal(world.feedbackOptions.strength,0);assert.equal(scene.zoomPulse,null);assert.equal(element('#game').style.transform,'none');
  assert.equal(audio.calls.at(-1).name,'stopCharge');
});

test('new installs default to expressions and 60% feedback while saved false and strength survive reload',async()=>{
  await withReloadedEntry(null,false,fresh=>{
    assert.equal(fresh.readFeedbackSettings().expressions,true);assert.equal(fresh.readFeedbackSettings().juice,.6);
  });
  await withReloadedEntry({expressions:false,juice:.35},false,fresh=>{
    assert.equal(fresh.readFeedbackSettings().expressions,false);assert.equal(fresh.readFeedbackSettings().juice,.35);
    assert.equal(element('#feedback-strength').value,35);assert.equal(element('#expressions-toggle').attributes['aria-checked'],'false');
  });
});

test('reduced-motion real rendering keeps border motion subtle and remains free of zoom or score scaling',async()=>{
  await withReloadedEntry({juice:1,expressions:false},true,fresh=>{
    const {g,world,scene}=feedbackRun(fresh),p=world.player;
    assert.equal(world.feedbackOptions.reducedMotion,true);
    const event=collideFeedbackEnemy(world);assert.ok(event.freezeDuration>0&&event.freezeDuration<=.05);
    scene.update(0,0);assert.equal(scene.zoomPulse,null);assert.equal(element('#game').style.transform,'none');
    const ghost=scene.impactGhosts[0],frozen={...ghost.body,feedbackFreeze:.05};assert.equal(scene.shakenBody(frozen),frozen,'reduced motion never shakes target positions');
    world.score=25;scene.update(0,0);assert.equal(element('#score').textContent,'0025');assert.equal(element('#score').style.transform,'scale(1)');
    world.emit('wall',{surface:'arena',bodyId:p.id,power:1,x:world.arenaBounds.left,y:world.height*.5,nx:-1,ny:0});scene.handleEvents();
    g.clear();scene.drawBorder(world.arenaBounds);assert.equal(g.lines.length,0);assert.equal(g.borders.length,0);
    const border=g.shapes.find(shape=>shape.type==='stroke'&&shape.color===0xc8ccbd);assert.ok(border);near(border.width,1);near(border.alpha,.65);
    near(scene.lastBorder.left-Math.min(...border.points.map(point=>point.x)),world.unit*(.14*5/6)*.5,.03);
    const position={x:p.x,y:p.y};p.feedbackFreeze=0;p.vx=world.baseSpeed;p.vy=0;
    advanceScene(scene,.06);assert.equal(scene.feedbackCamera,null);assert.equal(element('#game').style.transform,'none');
    assert.ok(p.x>position.x,'reduced motion retains regular world simulation');
  });
});

function observeWorldEvents(world){
  const events=[...world.events],emit=world.emit;
  world.emit=function(type,data={}){events.push({type,...data});return emit.call(this,type,data);};
  return events;
}
function assertFiniteDemoFrame(world,scene,g){
  for(const body of [world.player,...(world.auxiliaries||[]),...world.enemies,world.boss].filter(Boolean)){
    for(const key of ['x','y','vx','vy','r','angle','squash'])assert.ok(Number.isFinite(body[key]),`body ${body.id} ${key} must remain finite`);
  }
  for(const effect of scene.effects)for(const key of ['x','y','life','total'])assert.ok(Number.isFinite(effect[key]),`effect ${key}`);
  for(const shape of g.shapes){
    for(const point of shape.points||[])assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y),'rendered contour must remain finite');
    if(shape.type==='ellipse')for(const key of ['x','y','width','height'])assert.ok(Number.isFinite(shape[key]),`ellipse ${key}`);
    if(shape.type==='circle')for(const key of ['x','y','r'])assert.ok(Number.isFinite(shape[key]),`circle ${key}`);
  }
  assert.doesNotMatch(element('#game').style.transform||'',/NaN|Infinity/);
  assert.doesNotMatch(element('#score').textContent||'',/NaN|Infinity/);
}

function typedEnemyRun(type,module=app,strength=1){
  const run=controlRun(module,strength),{world}=run;world.stage=16;
  const enemy=world.spawnEnemy(null,type);assert.ok(enemy,`the real spawner creates ${type}`);
  Object.assign(enemy,{x:90,y:240,born:1,solid:true,vx:0,vy:0,angle:0,squash:0});
  world.events=[];
  return {...run,enemy};
}

function upgradeRun(module=app,{width=390,height=844,strength=1,random=null,rounds=1}={}){
  const g=graphicsRecorder(),run=module.seedRenderer(g,width,height,true),{world,scene}=run;
  module.setFeedbackStrength(strength);world.enemies=[];world.events=[];
  if(random)world.random=random;
  world.spawnTimer=world.floorTimer=world.introTimer=Infinity;world.wave=null;world.fragmentQueue=[];
  world.gamblerRewardPending=rounds===2;
  world.beginUpgrade();scene.update(0,0);advanceScene(scene,world.rewardTiming.transition+.01);
  assert.equal(world.phase,'choose');
  return {g,...run,pointer:inputCanvas(width,height,module)};
}

test('a real reward long press shows its diagram after 300 ms while residual motion waits, then releases without selecting or shooting',t=>{
  const {world,scene,g,pointer}=upgradeRun(),choice=world.choices[0],p=world.player,events=observeWorldEvents(world);
  t.after(()=>{pointer('pointercancel');app.setFeedbackStrength(.6);});
  Object.assign(p,{x:choice.x-choice.r-p.r-8,y:choice.y,vx:200,vy:0});
  const ink=upgradeAppearance(choice,parseInt(app.readFeedbackSettings().bg.slice(1),16)).ink;
  const original={x:p.x,y:p.y,vx:p.vx,time:world.feedbackTime},insideDiagram=shape=>shape.points?.length===96&&shape.color===ink&&Math.hypot(outlineBounds(shape).cx-choice.x,outlineBounds(shape).cy-choice.y)<choice.r;
  pointer('pointerdown',choice.x,choice.y);assert.ok(app.readRestart().choicePress);assert.equal(app.readRestart().drag,null);assert.equal(world.pullStartSpeed,null);
  advanceScene(scene,.299);assert.equal(app.readRestart().choicePress.active,false);assert.equal(g.shapes.filter(insideDiagram).length,0);
  advanceScene(scene,.002);assert.equal(app.readRestart().choicePress.active,true);assert.ok(g.shapes.some(insideDiagram));
  advanceScene(scene,.6);assert.deepEqual({x:p.x,y:p.y,vx:p.vx,time:world.feedbackTime},original);
  assert.equal(world.phase,'choose');assert.deepEqual(scene.timeSlices,[]);assert.equal(scene.accumulator,0);
  pointer('pointerup',choice.x,choice.y);assert.equal(app.readRestart().choicePress,null);assert.equal(app.readRestart().drag,null);
  assert.equal(world.phase,'choose');assert.equal(events.filter(event=>['shoot','buff'].includes(event.type)).length,0);
  Object.assign(p,{x:world.width*.5,y:world.height*.72,vx:0,vy:0});advanceScene(scene,.05);
  near(world.feedbackTime-original.time,.05);assert.equal(g.shapes.filter(insideDiagram).length,0,'release removes the preview without replaying its held time');
  Object.assign(p,{x:choice.x,y:choice.y});scene.update(0,1000/120);
  assert.equal(world.phase,'reward');assert.equal(events.filter(event=>event.type==='buff').length,1,'normal physical contact remains the selection action');
});

test('reward preview cancellation swallows delayed releases and preserves the primary gesture boundary',t=>{
  t.after(()=>{document.hidden=false;app.setFeedbackStrength(.6);});
  for(const reason of ['move','secondary','pointercancel','lostpointercapture','pause','pagehide','phase']){
    const {world,scene,pointer}=upgradeRun(),choice=world.choices[0],events=observeWorldEvents(world);
    pointer('pointerdown',choice.x,choice.y);advanceScene(scene,.31);assert.equal(app.readRestart().choicePress.active,true,reason);
    if(reason==='move')pointer('pointermove',choice.x+9,choice.y);
    else if(reason==='secondary')pointer('pointerdown',choice.x,choice.y,{pointerId:2,isPrimary:false});
    else if(reason==='pause')clickAction('pause');
    else if(reason==='pagehide')for(const handler of windowListeners.get('pagehide'))handler();
    else if(reason==='phase'){world.phase='reward';scene.update(0,0);}
    else pointer(reason,choice.x,choice.y);
    assert.equal(app.readRestart().choicePress,null,reason);
    pointer('pointerup',choice.x+40,choice.y);pointer('pointerup',choice.x,choice.y,{pointerId:2,isPrimary:false});
    assert.equal(app.readRestart().drag,null,reason);assert.equal(events.filter(event=>['shoot','buff'].includes(event.type)).length,0,reason);
    if(reason==='pause'||reason==='pagehide'){
      app.advanceUi(.42);clickRestart();app.advanceUi(.65);pointer('pointerup',choice.x+80,choice.y);
      const fresh=app.readRestart();assert.equal(fresh.choicePress,null);assert.equal(fresh.world.score,0);assert.equal(fresh.world.activeShot,null);
    }
    if(reason==='pagehide')for(const handler of windowListeners.get('pageshow'))handler();
  }
});

test('reward previews remain available and static at zero strength and with reduced motion',async()=>{
  for(const [strength,reduced] of [[0,false],[1,true]])await withReloadedEntry({juice:strength,expressions:true},reduced,fresh=>{
    const {world,scene,g,pointer}=upgradeRun(fresh,{strength}),choice=world.choices[0];
    const ink=upgradeAppearance(choice,parseInt(fresh.readFeedbackSettings().bg.slice(1),16)).ink;
    pointer('pointerdown',choice.x,choice.y);advanceScene(scene,.31);assert.equal(fresh.readRestart().choicePress.active,true);
    const diagram=()=>{
      const body=g.shapes.find(shape=>shape.type==='path'&&shape.points?.length===96&&Math.abs(outlineBounds(shape).cx-choice.x)<1&&outlineBounds(shape).width>choice.r*1.9);
      const cy=outlineBounds(body).cy;
      return g.shapes.filter(shape=>shape.points?.length===96&&shape.color===ink&&Math.hypot(outlineBounds(shape).cx-choice.x,outlineBounds(shape).cy-choice.y)<choice.r).map(shape=>shape.points.map(point=>({x:point.x-choice.x,y:point.y-cy})));
    };
    const original=diagram();assert.ok(original.length>0);advanceScene(scene,.4);const later=diagram();assert.equal(later.length,original.length);
    later.forEach((contour,index)=>assertSameContour(contour,original[index]));
    pointer('pointerup',choice.x,choice.y);assert.equal(fresh.readRestart().choicePress,null);assert.equal(world.phase,'choose');
  });
});

test('resizing clears a held reward preview and its capture without selecting, shooting or losing the offer',t=>{
  const {world,scene,g,pointer}=upgradeRun(),previous={width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio,add:window.addEventListener};let resize;
  window.addEventListener=(type,handler)=>{if(type==='resize')resize=handler;else previous.add(type,handler);};
  t.after(()=>{window.innerWidth=previous.width;window.innerHeight=previous.height;window.devicePixelRatio=previous.dpr;window.addEventListener=previous.add;app.setFeedbackStrength(.6);});
  app.mountSceneBoundary(pointer.canvas,g);const choice=world.choices[0],ids=world.choices.map(item=>item.id),events=observeWorldEvents(world);
  pointer('pointerdown',choice.x,choice.y);advanceScene(scene,.31);assert.equal(app.readRestart().choicePress.active,true);
  window.innerWidth=844;window.innerHeight=390;resize();
  assert.equal(app.readRestart().choicePress,null);assert.equal(pointer.captured.size,0);assert.deepEqual(scene.timeSlices,[]);
  pointer('pointerup',choice.x+50,choice.y);scene.update(0,0);
  assert.equal(world.phase,'choose');assert.deepEqual(world.choices.map(item=>item.id),ids);assert.equal(world.score,0);
  assert.equal(events.filter(event=>['shoot','buff'].includes(event.type)).length,0);
  for(const body of [world.player,...world.choices]){
    assert.ok(body.x-body.r>=world.arenaBounds.left&&body.x+body.r<=world.arenaBounds.right);
    assert.ok(body.y-body.r>=world.arenaBounds.top&&body.y+body.r<=world.arenaBounds.bottom);
  }
});

test('ordinary and gambler rewards keep distinct eligible three-ball offers and select once in each round',t=>{
  t.after(()=>{app.prepareNormalGame();app.setFeedbackStrength(.6);});
  for(const [kind,rounds] of [['choices-3',1],['choices-double',2]]){
    const g=graphicsRecorder();app.seedRenderer(g);app.runFeedbackDemo(kind);
    const {world,scene}=app.readRestart(),events=observeWorldEvents(world),stage=world.stage;scene.update(0,0);
    assert.equal(world.upgradeRoundTotal,rounds);
    for(let round=1;round<=rounds;round++){
      waitForChoose(world,scene);scene.update(0,0);
      assert.equal(world.choices.length,3);assert.equal(new Set(world.choices.map(choice=>choice.id)).size,3);
      assert.equal(element('#choice-labels').children.filter(node=>node.className==='choice-label').length,3);
      assert.ok(world.choices.every(choice=>UPGRADES[choice.id]&&choice.id!=='risk'));
      const faces=world.choices.map(choice=>g.shapes.find(shape=>shape.type==='path'&&shape.points?.length===96&&Math.abs(outlineBounds(shape).cx-choice.x)<1&&Math.abs(outlineBounds(shape).cy-choice.y)<3&&outlineBounds(shape).width>choice.r*1.9));
      assert.ok(faces.every(Boolean));assert.equal(new Set(faces.map(shape=>shape.color)).size,new Set(world.choices.map(choice=>choice.kind)).size);
      const choice=world.choices.find(item=>item.id!=='gambler'),before=world.buffs[choice.id]||0;
      Object.assign(world.player,{x:choice.x,y:choice.y,vx:0,vy:0});scene.update(0,1000/120);
      assert.equal(world.phase,'reward');assert.equal(world.buffs[choice.id],before+1);assert.equal(world.choices.length,0);
      assert.equal(events.filter(event=>event.type==='buff').length,round);assert.equal(world.pendingUpgradeBoost,true);
      advanceScene(scene,world.rewardTiming.rest+.01);
      if(round<rounds){assert.equal(world.phase,'transition');assert.equal(world.stage,stage);assert.equal(world.enemies.length,0);}
    }
    assert.equal(world.phase,'battle');assert.equal(world.stage,stage+1);assert.equal(world.choices.length,0);
  }
});

test('gambler keeps its three-ball offer and two pending rounds through actual viewport resize',t=>{
  const {world,scene,g,pointer}=upgradeRun(app,{rounds:2}),previous={width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio,add:window.addEventListener};let resize;
  window.addEventListener=(type,handler)=>{if(type==='resize')resize=handler;else previous.add(type,handler);};
  t.after(()=>{window.innerWidth=previous.width;window.innerHeight=previous.height;window.devicePixelRatio=previous.dpr;window.addEventListener=previous.add;app.setFeedbackStrength(.6);});
  app.mountSceneBoundary(pointer.canvas,g);const ids=world.choices.map(choice=>choice.id),events=observeWorldEvents(world);
  for(const [width,height] of [[390,844],[844,390],[320,568]]){
    window.innerWidth=width;window.innerHeight=height;resize();scene.update(0,0);
    const p=world.player,bounds=world.arenaBounds;
    near(p.x,width/2);near(p.y,world.choicePlayerY);assert.equal(world.phase,'choose');assert.deepEqual(world.choices.map(choice=>choice.id),ids);
    assert.equal(world.choices.length,3);assert.equal(world.rewardSelectionsRemaining,2);assert.equal(world.upgradeRound,1);
    for(const choice of world.choices){
      assert.ok(choice.x-choice.r>=bounds.left&&choice.x+choice.r<=bounds.right);
      assert.ok(choice.y-choice.r>=bounds.top&&choice.y+choice.r+24<=bounds.bottom);
      assert.ok(Math.hypot(choice.x-p.x,choice.y-p.y)>choice.r+p.r+4,'offers leave space for the player and a launch');
    }
    assert.equal(events.filter(event=>event.type==='buff').length,0,'resizing cannot select a reward');
  }
});

test('every physical reward route produces one crisp hit and directional enemy-style fragments without scoring an enemy kill',t=>{
  const audio=app.recordFeedbackAudio(),tones=app.recordTones();
  t.after(()=>{audio.restore();tones.restore();app.prepareNormalGame();app.setFeedbackStrength(.6);});
  const contact=(world,scene,context)=>{
    assert.equal(world.phase,'choose',context);const choice=world.choices.find(choice=>choice.id!=='gambler')||world.choices[0],p=world.player;
    const score=world.score,kills=world.stageKills,events=observeWorldEvents(world),beforeCount=world.buffs[choice.id]||0;
    scene.effects=[];scene.impactGhosts=[];world.events=[];audio.calls.length=0;tones.calls.length=0;
    Object.assign(p,{x:choice.x-choice.r-p.r+.2,y:choice.y,vx:world.unit*12,vy:0,feedbackFreeze:0});
    world.step(1/120);const event=events.find(item=>item.type==='buff');assert.ok(event,context);scene.update(0,0);
    assert.equal(world.phase,'reward');assert.equal(world.buffs[choice.id],beforeCount+1);assert.equal(world.score,score);assert.equal(world.stageKills,kills);
    assert.equal(events.filter(item=>item.type==='kill').length,0,'rewards never count as enemy kills');
    assert.equal(audio.calls.filter(call=>call.name==='rewardHit').length,1,context);
    assert.equal(audio.calls.filter(call=>call.name==='impact').length,0,'the new cue must not be doubled by an enemy impact sound');
    assert.equal(tones.calls.filter(call=>call[0]===700).length,0,'the former long reward tone must not overlap the crisp cue');
    const shards=scene.effects.filter(effect=>effect.type==='shard');assert.equal(shards.length,7,'first-hit reward fragments use the same seven-shard fan as a normal enemy');
    assert.ok(Number.isFinite(event.contactX)&&Number.isFinite(event.contactY));
    for(const shard of shards){near(shard.x,event.contactX);near(shard.y,event.contactY);assert.ok([3,4,5].includes(shard.sides));assert.ok(shard.vx>0);assert.ok(shard.total>=.5&&shard.total<=.62);}
    scene.update(0,0);assert.equal(audio.calls.filter(call=>call.name==='rewardHit').length,1,'redrawing cannot replay the reward');
    return choice;
  };
  for(const rounds of [1,2]){
    const {world,scene}=upgradeRun(app,{rounds});
    for(let round=1;round<=rounds;round++){waitForChoose(world,scene);contact(world,scene,`reward ${round} of ${rounds}`);advanceScene(scene,world.rewardTiming.rest+.01);}
  }
  app.seedRenderer(graphicsRecorder(),390,844,true);app.seedEndless({maxStage:10,best:0});app.prepareNormalGame();app.setFeedbackStrength(1);
  {
    const {world,scene}=app.readRestart();
    waitForChoose(world,scene);contact(world,scene,'single starting reward');advanceScene(scene,world.rewardTiming.rest+.01);assert.equal(world.phase,'battle');
  }
  {
    const {world,scene}=bossScene(10);app.setFeedbackStrength(1);advanceToBoss(world,scene);world.gamblerRewardPending=true;defeatBoss(world,scene);
    for(let round=1;round<=3;round++){waitForChoose(world,scene);contact(world,scene,`Boss round ${round}`);advanceScene(scene,world.rewardTiming.rest+.01);}
  }
  for(const kind of ['choices-3','choices-double']){
    app.seedRenderer(graphicsRecorder());app.setFeedbackStrength(1);app.runFeedbackDemo(kind);
    const {world,scene}=app.readRestart();contact(world,scene,kind);
  }
});

test('late builds still receive a visible, selectable basic reward after finite upgrades are complete',t=>{
  const {world,scene}=controlRun();t.after(()=>app.setFeedbackStrength(.6));
  for(const definition of UPGRADE_DEFINITIONS)for(let layer=0;layer<Math.min(definition.maxStacks,12);layer++){
    if(definition.id==='gambler'&&world.nextGambler){
      world.phase='reward';world.rewardSelectionsRemaining=1;world.finishRewardRound();
    }
    assert.equal(world.applyUpgrade(definition.id),true);
  }
  world.nextGambler=false;world.gamblerRewardPending=false;
  world.stage=26;world.upgradeContext=null;world.beginUpgrade();scene.update(0,0);
  assert.equal(world.phase,'transition');assert.equal(world.choices.length,3);
  assert.equal(element('#choice-labels').children.length,3);
  const choice=world.choices.find(item=>item.kind==='regular'),before=world.buffs[choice.id];
  assert.ok(['energy','density','overspeed'].includes(choice.id));
  waitForChoose(world,scene);
  Object.assign(world.player,{x:choice.x,y:choice.y,vx:0,vy:0});scene.update(0,1000/120);
  assert.equal(world.buffs[choice.id],before+1);assert.equal(world.phase,'reward');
  advanceScene(scene,world.rewardTiming.rest+.01);
  assert.equal(world.phase,'battle');assert.equal(world.stage,27);
  assert.ok(world.enemies.length>=world.floorCount);assert.ok(world.enemies.length<=28);
});

test('an acquired upgrade boosts exactly the next real shot while taps, cancellations and later shots preserve the intended feedback budget',t=>{
  const {world,scene,pointer}=upgradeRun(app,{random:()=>0}),choice=world.choices.find(item=>item.id==='energy'),audio=app.recordFeedbackAudio(),events=observeWorldEvents(world);
  t.after(()=>{audio.restore();pointer('pointercancel');app.setFeedbackStrength(.6);});assert.ok(choice);
  Object.assign(world.player,{x:choice.x,y:choice.y,vx:0,vy:0});scene.update(0,1000/120);advanceScene(scene,world.rewardTiming.rest+.01);
  world.enemies=[];world.spawnTimer=world.floorTimer=world.introTimer=Infinity;world.wave=null;
  assert.equal(world.pendingUpgradeBoost,true);assert.equal(world.shotUpgradeBoost,false);
  const p=world.player,gesture=release=>{const x=p.x,y=p.y;pointer('pointerdown',x,y);pointer('pointermove',x-world.maxPull,y);pointer(release,x-world.maxPull,y);};
  pointer('pointerdown',p.x,p.y);pointer('pointerup',p.x,p.y);gesture('pointercancel');
  assert.equal(world.pendingUpgradeBoost,true);assert.equal(world.shotUpgradeBoost,false);assert.equal(events.filter(event=>event.type==='shoot').length,0);
  gesture('pointerup');assert.equal(world.pendingUpgradeBoost,false);assert.equal(world.shotUpgradeBoost,true);advanceScene(scene,.04);
  rhythmEnemy(world,100,200,{hp:1});collideFeedbackEnemy(world);scene.update(0,0);p.vx=p.vy=0;
  assert.equal(events.filter(event=>event.type==='kill').at(-1).upgradeBoost,true);
  advanceScene(scene,.1);assert.equal(scene.effects.filter(effect=>effect.type==='shard').length,9,'the first boosted kill has the ordinary seven fragments plus two');
  const killAudio=()=>audio.calls.filter(call=>call.name==='impact'&&call.args[0].kind==='kill');
  assert.equal(killAudio().at(-1).args[0].upgradeBoost,true);
  pointer('pointerdown',p.x,p.y);pointer('pointerup',p.x,p.y);assert.equal(world.shotUpgradeBoost,true,'a tap does not end the current shot');
  advanceScene(scene,.65);gesture('pointerup');assert.equal(world.shotUpgradeBoost,false);advanceScene(scene,.04);
  rhythmEnemy(world,100,200,{hp:1});collideFeedbackEnemy(world);scene.update(0,0);p.vx=p.vy=0;advanceScene(scene,.1);
  assert.equal(events.filter(event=>event.type==='kill').at(-1).upgradeBoost,false);assert.equal(killAudio().at(-1).args[0].upgradeBoost,false);
  assert.equal(scene.effects.filter(effect=>effect.type==='shard').length,7,'the following real shot returns to ordinary fragments');
});

test('a boosted stage-ending kill does not raise the following automatic clearing sounds',t=>{
  const {world,scene}=upgradeRun(app,{random:()=>0}),choice=world.choices.find(item=>item.id==='energy'),audio=app.recordFeedbackAudio();
  t.after(()=>{audio.restore();app.setFeedbackStrength(.6);});
  Object.assign(world.player,{x:choice.x,y:choice.y,vx:0,vy:0});scene.update(0,1000/120);advanceScene(scene,world.rewardTiming.rest+.01);
  world.enemies=[];world.spawnTimer=world.floorTimer=world.introTimer=Infinity;world.wave=null;world.stageKills=world.killTarget-1;
  const p=world.player;Object.assign(p,{x:100,y:400,vx:0,vy:0});world.shoot(-world.maxPull,0);advanceScene(scene,.04);
  const target=rhythmEnemy(world,0,0,{hp:1});Object.assign(target,{x:p.x+p.r+target.r-.5,y:p.y});rhythmEnemy(world,310,700);
  const events=observeWorldEvents(world);scene.update(0,1000/120);
  assert.equal(world.phase,'clearing');assert.equal(events.filter(event=>event.type==='kill').length,1);
  assert.equal(events.find(event=>event.type==='kill').upgradeBoost,true);
  for(let frame=0;frame<600&&world.phase==='clearing';frame++)scene.update(0,1000/120);
  assert.equal(world.phase,'transition');const clear=events.filter(event=>event.type==='clearKill');assert.equal(clear.length,1);assert.equal(clear[0].upgradeBoost,undefined);
  const sounds=audio.calls.filter(call=>call.name==='impact'&&call.args[0].kind==='kill');
  assert.equal(sounds.length,2);assert.equal(sounds[0].args[0].upgradeBoost,true);assert.equal(sounds[1].args[0].upgradeBoost,undefined);
});

test('real split auxiliaries render without extra eyes, share kill credit, pause together and disappear on a deliberate new shot',t=>{
  const g=graphicsRecorder();app.seedRenderer(g);app.runFeedbackDemo('upgrade-split');const {world,scene}=app.readRestart(),events=observeWorldEvents(world),pointer=inputCanvas();
  const previousSaved=saved.get('qiuqiule-best');t.after(()=>{pointer('pointercancel');if(previousSaved===undefined)saved.delete('qiuqiule-best');else saved.set('qiuqiule-best',previousSaved);app.prepareNormalGame();app.setFeedbackStrength(.6);});
  for(let frame=0;frame<180&&!world.auxiliaries.length;frame++)scene.update(0,1000/120);
  assert.equal(world.auxiliaries.length,2);const [child]=world.auxiliaries,p=world.player;
  assert.ok(world.auxiliaries.every(body=>body.isAuxiliary&&body.isPlayer));near(child.r,.7*world.unit);
  const faces=eyeShapes(g);assert.equal(faces.length,2,'only the main player retains a face');
  assert.equal(g.shapes.filter(shape=>shape.type==='path'&&shape.color===app.playerInk()&&shape.points?.length===193).length,3,'main and both auxiliary balls share the same contour renderer');
  clickAction('pause');scene.update(0,0);const paused=JSON.stringify(world.auxiliaries);advanceScene(scene,.5);assert.equal(JSON.stringify(world.auxiliaries),paused);
  clickAction('resume');app.advanceUi(.42);advanceScene(scene,.15);
  world.enemies=[];Object.assign(p,{x:world.width*.75,y:world.height*.78,vx:0,vy:0});
  const target=rhythmEnemy(world,130,300,{hp:1});Object.assign(child,{x:target.x-child.r-target.r+.5,y:target.y,vx:world.baseSpeed*.6,vy:0,feedbackFreeze:0,feedbackFreezeTotal:0});
  const before=world.score,stageKills=world.stageKills;scene.update(0,1000/120);
  const kill=events.filter(event=>event.type==='kill').at(-1);assert.equal(kill.auxiliary,true);assert.equal(kill.upgradeBoost,true);
  assert.equal(world.score,before+kill.value);assert.equal(world.stageKills,stageKills+1);assert.equal(saved.get('qiuqiule-best'),previousSaved,'auxiliary scores also respect the demo record boundary');
  const count=world.auxiliaries.length;pointer('pointerdown',p.x,p.y);pointer('pointerup',p.x,p.y);assert.equal(world.auxiliaries.length,count);
  pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x-50,p.y);pointer('pointerup',p.x-50,p.y);
  assert.equal(world.auxiliaries.length,0);assert.equal(world.shotUpgradeBoost,false);
});

test('all upgrade and single/double-round playgrounds keep initial bodies and reward labels above their visible controls',t=>{
  const panel=element('#feedback-demo'),previousRect=panel.getBoundingClientRect,previousHidden=panel.hidden;
  t.after(()=>{panel.getBoundingClientRect=previousRect;panel.hidden=previousHidden;app.seedRenderer(graphicsRecorder());app.prepareNormalGame();app.setFeedbackStrength(.6);});
  const kinds=['choices-3','choices-double',...UPGRADE_DEFINITIONS.map(definition=>'upgrade-'+definition.id)];
  for(const [width,height,top] of [[390,844,470],[320,667,290],[844,390,135],[320,568,180]])for(const kind of kinds){
    const g=graphicsRecorder();app.seedRenderer(g,width,height);panel.hidden=false;
    panel.getBoundingClientRect=()=>panel.classList.contains('demo-compact')
      ?{left:width/2-52,right:width/2+52,top:height-60,bottom:height-20,width:104,height:40}
      :{left:0,right:width,top,bottom:height,width,height:height-top};
    app.runFeedbackDemo(kind);const {world,scene}=app.readRestart(),bounds=world.arenaBounds,bodies=[world.player,...world.enemies,...world.choices];
    const visibleTop=panel.getBoundingClientRect().top;
    if(kind==='choices-double'||kind==='upgrade-gambler')assert.equal(panel.classList.contains('demo-compact'),true,'successive rewards expose only the compact menu button');
    else assert.equal(visibleTop,top,'other playgrounds retain the original full-control panel bounds');
    for(let index=0;index<bodies.length;index++){
      const body=bodies[index],label=`${kind} ${width}x${height}`;
      assert.ok(body.x-body.r>=bounds.left-1e-8&&body.x+body.r<=bounds.right+1e-8,label);
      assert.ok(body.y-body.r>=bounds.top-1e-8&&body.y+body.r<=visibleTop+1e-8,label);
      for(const other of bodies.slice(index+1))assert.ok(Math.hypot(body.x-other.x,body.y-other.y)>=body.r+other.r-1e-8,label);
    }
    for(const choice of world.choices){
      const outer=choice.r,font=Math.max(9,Math.min(17,Math.floor(choice.labelWidth/choice.name.length*.9)));
      assert.ok(choice.x-outer>=bounds.left&&choice.x+outer<=bounds.right);
      assert.ok(choice.y-outer>=bounds.top&&choice.y+choice.r+14+font<=visibleTop,`${kind} ${width}x${height}: reward bodies and one-line names stay above the visible controls (${choice.id}, top=${choice.y-outer}, bottom=${choice.y+choice.r+14+font}, panel=${visibleTop})`);
      assert.ok(choice.x-choice.labelWidth/2>=bounds.left&&choice.x+choice.labelWidth/2<=bounds.right);
    }
    scene.update(0,0);assertFiniteDemoFrame(world,scene,g);
  }
});

test('the gambler playground compacts its controls and its menu button restores the complete demo menu',t=>{
  app.seedRenderer(graphicsRecorder());
  const panel=element('#feedback-demo'),originalQuery=document.querySelector,originalCreate=document.createElement,originalBody=document.body,originalListeners=new Map(panel.listeners);
  let created=false;document.querySelector=selector=>selector==='#feedback-demo'&&!created?null:originalQuery(selector);
  document.createElement=tag=>{if(tag==='section'){created=true;return panel;}return originalCreate(tag);};
  document.body={append(node){assert.equal(node,panel);}};
  t.after(()=>{document.querySelector=originalQuery;document.createElement=originalCreate;if(originalBody===undefined)delete document.body;else document.body=originalBody;panel.listeners=originalListeners;panel.classList.remove('demo-flow','demo-compact');app.seedRenderer(graphicsRecorder());app.prepareNormalGame();});
  app.installDemoControls();assert.equal(created,true);assert.match(panel.innerHTML,/data-demo="all-demos">试玩菜单/);
  app.runFeedbackDemo('choices-double');assert.equal(panel.classList.contains('demo-compact'),true);near(panel.getBoundingClientRect().height,40);
  for(const handler of panel.listeners.get('click')||[])handler({target:{closest:()=>({dataset:{demo:'all-demos'}})}});
  assert.equal(panel.classList.contains('demo-compact'),false);assert.equal(panel.classList.contains('demo-flow'),false);
  const world=app.readRestart().world;assert.equal(world.phase,'choose');assert.equal(world.choices.length,3,'opening the menu does not replace the current offer');assert.equal(world.upgradeRoundTotal,2);
});

for(const definition of UPGRADE_DEFINITIONS)test(`the real ${definition.id} upgrade playground exercises its effect and keeps score and progression isolated`,t=>{
  const g=graphicsRecorder();app.seedRenderer(g);app.setFeedbackStrength(.6);
  const previousBest=app.seedBest(0),previousSaved=saved.get('qiuqiule-best');saved.set('qiuqiule-best','0');
  const progressBefore=saved.get('qiuqiule-campaign'),skinsBefore=saved.get('qiuqiule-skins'),audio=app.recordFeedbackAudio();
  t.after(()=>{audio.restore();app.seedBest(previousBest);if(previousSaved===undefined)saved.delete('qiuqiule-best');else saved.set('qiuqiule-best',previousSaved);app.prepareNormalGame();app.setFeedbackStrength(.6);});
  app.runFeedbackDemo('upgrade-'+definition.id);const {world,scene}=app.readRestart(),events=observeWorldEvents(world),p=world.player;
  assert.equal(app.isFeedbackDemo(),true);assert.equal(world.buffs[definition.id],1);
  if(definition.id==='energy')near(world.energy,1.3);
  if(definition.id==='overspeed'){assert.equal(world.buffs.energy,4);near(world.launchCap,world.unit*68);assert.ok(Math.hypot(p.vx,p.vy)>world.unit*60);}
  if(definition.id==='density')near(world.density,1.35);
  if(definition.id==='growth')near(p.r,world.unit*1.2);
  if(definition.id==='frenzy'){assert.equal(world.waveSize,6);assert.equal(world.comboCap,12);}
  if(definition.id==='gambler'){assert.equal(world.choices.length,3);assert.equal(world.upgradeRoundTotal,2);near(world.gamblerTargetMultiplier,1.5);assert.equal(world.gamblerRewardPending,false);}
  const target=world.enemies[0],startDistance=target?Math.hypot(target.x-p.x,target.y-p.y):Infinity;
  let minDistance=startDistance,maxAuxiliaries=0,magnetSeen=false,breathSeen=false,boomerangSeen=false;
  for(let frame=0;frame<720;frame++){
    scene.update(0,1000/120);assertFiniteDemoFrame(world,scene,g);assert.ok(world.liveCount<=28);
    maxAuxiliaries=Math.max(maxAuxiliaries,world.auxiliaries.length);magnetSeen ||= !!world.magnetPull;breathSeen ||= world.breathTime>0;boomerangSeen ||= p.boomerangTime>0;
    if(target)minDistance=Math.min(minDistance,Math.hypot(target.x-p.x,target.y-p.y));
  }
  const kills=events.filter(event=>event.type==='kill');
  if(definition.id==='gravity')assert.ok(minDistance<startDistance-world.unit,'stationary enemies actually approach the player');
  else if(definition.id==='gambler')assert.equal(world.phase,'choose');
  else assert.ok(kills.length>0,`${definition.id} must produce a real enemy kill in its prepared scene`);
  if(definition.id==='magnet')assert.equal(magnetSeen,true);
  if(definition.id==='pulse')assert.ok(events.some(event=>event.type==='pulse'));
  if(definition.id==='bank')assert.ok(events.some(event=>event.type==='wall'&&event.bank>0));
  if(definition.id==='breath')assert.equal(breathSeen,true);
  if(definition.id==='split'){assert.equal(maxAuxiliaries,2);assert.equal(events.filter(event=>event.type==='playerSplit').length,1);}
  if(definition.id==='boomerang')assert.equal(boomerangSeen,true);
  if(definition.id==='shockwave')assert.ok(events.some(event=>event.type==='shockwave'));
  if(kills.length){assert.ok(kills.every(event=>event.upgradeBoost===true));assert.ok(audio.calls.some(call=>call.name==='impact'&&call.args[0].kind==='kill'&&call.args[0].upgradeBoost));}
  for(let round=0;round<3&&['choose','transition'].includes(world.phase);round++){
    waitForChoose(world,scene);const choice=world.choices.find(item=>item.id!=='gambler');Object.assign(p,{x:choice.x,y:choice.y,vx:0,vy:0});scene.update(0,1000/120);advanceScene(scene,world.rewardTiming.rest+.01);
  }
  if(world.score===0){collideFeedbackEnemy(world);scene.update(0,0);}
  assert.ok(world.score>0);assert.equal(saved.get('qiuqiule-best'),'0');assert.equal(saved.get('qiuqiule-campaign'),progressBefore);assert.equal(saved.get('qiuqiule-skins'),skinsBefore);
  clickAction('pause');app.advanceUi(.42);clickAction('home');app.advanceUi(.82);
  assert.equal(app.readRestart().modal,'over');assert.equal(saved.get('qiuqiule-best'),'0');
  clickRestart();app.advanceUi(.65);assert.equal(app.isFeedbackDemo(),false);assert.equal(app.readRestart().world.score,0);
});

test('enemy variants and fragments keep their colors, silhouettes and physical bodies through real arena and ghost rendering',t=>{
  t.after(()=>app.setFeedbackStrength(.6));
  for(const type of ['ring','heavy','split','walker','magnet','shield','leader','fragment']){
    const {world,scene,g,enemy}=typedEnemyRun(type),baseInk=parseInt(app.readFeedbackSettings().enemy.slice(1),16);
    const ink=type==='fragment'?[16,8,0].reduce((color,shift)=>color|(Math.round(((baseInk>>shift)&255)*.7)<<shift),0):baseInk;
    enemy.hp=enemy.maxHp*.5;
    const physical={x:enemy.x,y:enemy.y,r:enemy.r,mass:enemy.mass},shapeAtEnemy=shape=>shape.points?.length===128&&Math.hypot(outlineBounds(shape).cx-enemy.x,outlineBounds(shape).cy-enemy.y)<1;
    scene.update(0,0);
    const shapes=g.shapes.filter(shapeAtEnemy),strokes=shapes.filter(shape=>shape.type==='stroke'),fills=shapes.filter(shape=>shape.type==='path');
    assert.deepEqual({x:enemy.x,y:enemy.y,r:enemy.r,mass:enemy.mass},physical);
    assert.equal(strokes.length,{ring:1,heavy:1,split:0,walker:0,magnet:2,shield:1,leader:0,fragment:0}[type],type);
    assert.equal(fills.length,{ring:0,heavy:1,split:1,walker:1,magnet:0,shield:1,leader:2,fragment:1}[type],type);
    const contour=shapes.find(shape=>shape.color===ink&&shape.type===(['ring','magnet'].includes(type)?'stroke':'path'));
    if(type==='ring'){
      assert.equal(contour.width,3);near(outlineBounds(contour).width+contour.width,enemy.r*2*.91+1.5,'the thicker ring grows inward and preserves its previous outer edge');
    }else near(outlineBounds(contour).width,enemy.r*2*.91);
    if(type==='shield')near(outlineBounds(strokes[0]).width,(enemy.r+.3*world.unit)*2*.91);
    if(type==='walker')assert.equal(g.shapes.filter(shape=>shape.type==='path'&&shape.points.length===32).length,2,'only the walker has its own paired eyes');
    // Break the shield through real damage before the separate lethal impact.
    if(enemy.shield)world.damage(enemy,1);
    world.damage(enemy,enemy.hp+1);world.enemies=[];scene.update(0,0);
    assert.equal(scene.impactGhosts.length,1,type);assert.equal(scene.impactGhosts[0].body.enemyType,type);
    const ghostContours=g.shapes.filter(shape=>shape.points?.length===128&&shape.color===ink);
    assert.ok(ghostContours.length>0,type);
    assert.equal(ghostContours.some(shape=>shape.type==='path'),!['ring','magnet'].includes(type),`${type} retains its hollow/solid silhouette when killed`);
    near(enemy.r,physical.r);near(enemy.mass,physical.mass);
    advanceScene(scene,.15);assert.equal(scene.impactGhosts.length,0);assert.ok(scene.effects.some(effect=>effect.type==='shard'));
    if(type==='fragment')assert.ok(scene.effects.filter(effect=>effect.type==='shard').every(effect=>effect.color===ink),'fragment shards keep the darker body color');
  }
});

test('a real shield contact breaks only the visual ring and the next contact kills once with the correct feedback',t=>{
  const {world,scene,g,enemy}=typedEnemyRun('shield'),events=observeWorldEvents(world),audio=app.recordFeedbackAudio(),p=world.player;
  t.after(()=>{audio.restore();app.setFeedbackStrength(.6);});
  Object.assign(enemy,{hp:20,maxHp:20});const radius=enemy.r;
  const contact=()=>{Object.assign(p,{x:100,y:400,vx:world.baseSpeed,vy:0});Object.assign(enemy,{x:p.x+p.r+enemy.r-3,y:p.y,vx:0,vy:0});world.step(1/120);scene.update(0,0);};
  world.shoot(-world.maxPull,0);advanceScene(scene,.04);contact();
  assert.equal(enemy.shield,false);assert.equal(enemy.hp,20);assert.equal(enemy.r,radius);
  assert.equal(world.score,0);assert.equal(world.stageKills,0);assert.equal(world.activeShot.hits,1);
  assert.equal(events.filter(event=>event.type==='shieldBreak').length,1);assert.equal(events.filter(event=>event.type==='hit').length,0);
  assert.equal(scene.impactGhosts.length,0);assert.equal(scene.effects.filter(effect=>effect.type==='shard').length,5);
  assert.equal(enemy.hit,0);assert.equal(enemy.feedbackFreeze,0);assert.equal(p.feedbackFreeze,0);
  assert.ok(!g.shapes.some(shape=>shape.type==='stroke'&&shape.points?.length===128),'the broken shield contour is gone');
  assert.deepEqual(audio.calls.filter(call=>call.name==='impact').map(call=>call.args[0].kind),['hit']);
  contact();
  assert.equal(events.filter(event=>event.type==='shieldBreak').length,1);assert.equal(events.filter(event=>event.type==='kill').length,1);
  assert.equal(events.filter(event=>event.type==='firstTypeKill').length,1);assert.equal(world.score,20);assert.equal(world.stageKills,1);
  assert.deepEqual(audio.calls.filter(call=>call.name==='impact').map(call=>call.args[0].kind),['hit','kill']);
  assert.equal(scene.impactGhosts.length,1);assert.equal(scene.impactGhosts[0].body.shield,false);
});

test('first-type surprise uses 300 ms of active time once per type and still appears on the stage-ending kill',t=>{
  const {world,scene,g,enemy}=typedEnemyRun('ring'),events=observeWorldEvents(world),p=world.player;
  t.after(()=>app.setFeedbackStrength(.6));clickAction('expressions');scene.update(0,0);
  const ordinary=playerEyes(g,p).map(shape=>({width:shape.width,height:shape.height}));assert.equal(ordinary.length,2);
  const kill=body=>{world.damage(body,body.hp+1);world.enemies=world.enemies.filter(item=>item.hp>0);scene.update(0,0);};
  kill(enemy);near(scene.firstTypeUntil-world.feedbackTime,.3);
  const enlarged=playerEyes(g,p);assert.equal(enlarged.length,2);
  enlarged.forEach((shape,index)=>{near(shape.width,ordinary[index].width*1.3);near(shape.height,ordinary[index].height*1.3);});
  assert.equal(scene.testLabels.length,0,'type recognition is an expression, not new text');
  clickAction('pause');scene.update(0,0);const frozenTime=world.feedbackTime,deadline=scene.firstTypeUntil;
  advanceScene(scene,.6);near(world.feedbackTime,frozenTime);near(scene.firstTypeUntil,deadline);
  clickAction('resume');app.advanceUi(.42);advanceScene(scene,.31);assert.ok(world.feedbackTime>=deadline);
  const another=world.spawnEnemy(null,'ring');Object.assign(another,{born:1,solid:true});kill(another);
  near(scene.firstTypeUntil,deadline);assert.equal(events.filter(event=>event.type==='firstTypeKill').length,1);
  const heavy=world.spawnEnemy(null,'heavy');Object.assign(heavy,{x:100,y:260,born:1,solid:true});
  rhythmEnemy(world,320,730);world.stageKills=world.killTarget-1;
  world.damage(heavy,heavy.hp+1);scene.update(0,1000/120);
  assert.equal(world.phase,'clearing');assert.equal(events.filter(event=>event.type==='firstTypeKill').length,2);
  assert.equal(playerEyes(g,p).length,2,'the first-type surprise stays visible when the kill also starts clearing');
  assert.ok(playerEyes(g,p).every(shape=>shape.width>p.r*.105*1.2));
  clickAction('pause');app.advanceUi(.42);clickRestart();assert.equal(scene.firstTypeUntil,0);
  assert.equal(app.readRestart().world.seenEnemyKills.size,0);
});

test('first-type expressions respect their own toggle while remaining readable at zero strength and reduced motion',async()=>{
  for(const [strength,reduced,expressions] of [[0,false,true],[1,true,true],[1,false,false]])await withReloadedEntry({juice:strength,expressions},reduced,fresh=>{
    const {world,scene,g,enemy}=typedEnemyRun('ring',fresh,strength);
    fresh.setExpressionEnabled(expressions);
    world.damage(enemy,enemy.hp+1);world.enemies=[];scene.update(0,0);
    const eyes=playerEyes(g,world.player);assert.equal(eyes.length,2);
    eyes.forEach(eye=>near(eye.width,world.player.r*.105*(expressions?1.3:1)));
    if(strength===0||reduced)assert.equal(scene.zoomPulse,null);
  });
});

test('hollow and fragment result transfers preserve their appearance before fading into the menu control',t=>{
  t.after(()=>app.setFeedbackStrength(.6));
  for(const type of ['ring','magnet','fragment']){
    const {world,scene,enemy}=typedEnemyRun(type);enemy.hp=enemy.maxHp*.5;
    world.phase='over';world.emit('over');scene.update(0,0);scene.advanceEnding(.6);
    const item=app.readRestart().controlFlight.items[0];assert.equal(item.from.enemyType,type);
    near(item.from.r,enemy.r*.91);assert.ok(item.enemySource);
    if(type==='fragment'){
      assert.match(item.el.innerHTML,/fill="#a26250"/);
      assert.equal(item.el.style.background,'rgba(162,98,80,0)','the color transition starts at the fragment tone');
    }else{assert.match(item.el.innerHTML,/fill="none"/);assert.match(item.el.innerHTML,/stroke=/);}
    assert.match(item.el.style.background,/,0\)$/);assert.equal(item.enemySource.style.opacity,1);
    app.advanceUi(.2);assert.ok(item.enemySource.style.opacity>0&&item.enemySource.style.opacity<1);
    assert.doesNotMatch(item.el.style.background,/,0\)$/);
  }
});

test('locally delayed split children retain their family slot through pause and keep their parent profile after space opens',t=>{
  const {world,scene,enemy}=typedEnemyRun('split'),events=observeWorldEvents(world),parentHp=enemy.maxHp;
  t.after(()=>app.setFeedbackStrength(.6));
  const safe=world.safeSpawnPosition;let spaceOpen=false,childBirths=0;
  t.mock.method(world,'safeSpawnPosition',function(...args){
    if(args[3]?.localOnly&&!spaceOpen&&childBirths>=1)return null;
    const result=safe.apply(this,args);if(args[3]?.localOnly&&result)childBirths++;
    return result;
  });
  for(let index=0;index<27;index++)rhythmEnemy(world,38+(index%7)*50,100+Math.floor(index/7)*100,{r:world.unit*.3,hp:10000});
  world.damage(enemy,enemy.hp+1);scene.update(0,1000/120);
  assert.equal(world.liveCount,28);assert.equal(world.pressureCount,28);assert.equal(world.fragmentQueue.length,2);
  assert.equal(world.enemies.filter(body=>body.enemyType==='fragment').length,1);
  clickAction('pause');scene.update(0,0);const snapshot=JSON.stringify({queue:world.fragmentQueue,time:world.feedbackTime});
  advanceScene(scene,.5);assert.equal(JSON.stringify({queue:world.fragmentQueue,time:world.feedbackTime}),snapshot);
  clickAction('resume');app.advanceUi(.42);
  const normals=world.enemies.filter(body=>!body.enemyType).slice(0,2);
  assert.equal(normals.length,2);for(const body of normals)world.damage(body,body.hp+1);
  spaceOpen=true;
  scene.update(0,1000/120);
  const children=world.enemies.filter(body=>body.enemyType==='fragment');
  assert.equal(children.length,3);assert.equal(world.fragmentQueue.length,0);assert.equal(world.liveCount,28);
  assert.equal(world.pressureCount,26,'the two later child births reuse their existing family slot');
  for(const child of children){near(child.r,world.unit*.6);near(child.maxHp,parentHp*.3);assert.equal(child.value,5);}
  assert.equal(events.filter(event=>event.type==='spawn'&&event.enemyType==='fragment').length,3);
  assert.equal(events.filter(event=>event.type==='firstTypeKill').length,1);assert.equal(world.stageKills,3);
  clickAction('pause');app.advanceUi(.42);clickRestart();const next=app.readRestart().world;
  assert.deepEqual(next.fragmentQueue,[]);assert.equal(next.seenEnemyKills.size,0);assert.equal(next.stageKills,0);
});

test('enemy playground targets remain above the panel without overlapping on tall and short touch viewports',t=>{
  const panel=element('#feedback-demo'),previousRect=panel.getBoundingClientRect,previousHidden=panel.hidden;
  t.after(()=>{panel.getBoundingClientRect=previousRect;panel.hidden=previousHidden;app.seedRenderer(graphicsRecorder());app.prepareNormalGame();app.setFeedbackStrength(.6);});
  for(const [width,height,top] of [[390,844,500],[320,667,320],[844,390,135],[320,568,180]])for(const type of ['ring','heavy','split','walker','magnet','shield','leader']){
    const g=graphicsRecorder();app.seedRenderer(g,width,height);panel.hidden=false;
    panel.getBoundingClientRect=()=>({left:0,right:width,top,bottom:height,width,height:height-top});
    app.runFeedbackDemo('type-'+type);const {world,scene}=app.readRestart(),bounds=world.arenaBounds,bodies=[world.player,...world.enemies];
    for(let index=0;index<bodies.length;index++){
      const body=bodies[index];assert.ok(body.x-body.r>=bounds.left-1e-8&&body.x+body.r<=bounds.right+1e-8,`${type} fits the walls at ${width}x${height}`);
      assert.ok(body.y-body.r>=bounds.top-1e-8&&body.y+body.r<=top+1e-8,`${type} is visible above the panel at ${width}x${height}`);
      for(const other of bodies.slice(index+1))assert.ok(Math.hypot(body.x-other.x,body.y-other.y)>=body.r+other.r-1e-8,`${type} starts without overlap at ${width}x${height}`);
    }
    scene.update(0,0);assertFiniteDemoFrame(world,scene,g);
  }
});

for(const type of ['ring','heavy','split','walker','magnet','shield','leader'])test(`the real ${type} enemy playground uses live type behavior and isolates all score and progression`,t=>{
  const g=graphicsRecorder();app.seedRenderer(g);app.setFeedbackStrength(.6);
  const previousBest=app.seedBest(0),previousSaved=saved.get('qiuqiule-best');saved.set('qiuqiule-best','0');
  const progressBefore=saved.get('qiuqiule-campaign'),skinsBefore=saved.get('qiuqiule-skins');
  t.after(()=>{app.seedBest(previousBest);if(previousSaved===undefined)saved.delete('qiuqiule-best');else saved.set('qiuqiule-best',previousSaved);app.prepareNormalGame();app.setFeedbackStrength(.6);});
  app.runFeedbackDemo('type-'+type);const {world,scene}=app.readRestart(),events=observeWorldEvents(world),target=world.enemies.find(body=>body.enemyType===type);
  assert.ok(target);assert.equal(app.isFeedbackDemo(),true);assert.equal(world.mode==='campaign',false);assert.equal(world.continuousControl,true);assert.equal(world.introTimer,Infinity);
  assert.equal(world.stage,{ring:3,heavy:6,split:8,walker:10,magnet:13,shield:16,leader:12}[type]);
  const start={x:target.x,y:target.y,px:world.player.x,py:world.player.y};
  if(type==='walker')near(Math.hypot(target.vx,target.vy),world.unit*2);
  if(type==='leader')assert.equal(world.enemies.filter(body=>body.clusterId===target.clusterId).length,4);
  for(let frame=0;frame<360;frame++){scene.update(0,1000/120);assertFiniteDemoFrame(world,scene,g);assert.ok(world.liveCount<=28);}
  if(['ring','heavy','split'].includes(type))assert.ok(events.some(event=>event.type==='hit'&&event.enemyType===type),'the real prearranged launch reaches its typed target');
  if(type==='shield')assert.equal(events.filter(event=>event.type==='shieldBreak').length,1);
  if(type==='walker')assert.ok(Math.hypot(target.x-start.x,target.y-start.y)>world.unit,'walker moves without a player shot');
  if(type==='magnet')assert.ok(world.player.x>start.px,'the stationary demo player is pulled toward the nearby magnet');
  // Preserve real HP in the initial scene, then explicitly finish a genuine
  // typed kill so score isolation cannot pass just because the score stayed 0.
  if(target.hp>0){if(target.shield)world.damage(target,1);world.damage(target,target.hp+1);scene.update(0,0);}
  assert.ok(world.score>0);assert.equal(saved.get('qiuqiule-best'),'0');
  assert.equal(saved.get('qiuqiule-campaign'),progressBefore);assert.equal(saved.get('qiuqiule-skins'),skinsBefore);
  clickAction('pause');app.advanceUi(.42);clickAction('home');app.advanceUi(.82);
  assert.equal(app.readRestart().modal,'over');assert.equal(saved.get('qiuqiule-best'),'0');
  clickRestart();app.advanceUi(.65);assert.equal(app.isFeedbackDemo(),false);assert.equal(app.readRestart().world.score,0);
  assert.equal(saved.get('qiuqiule-best'),'0');
});

for(const kind of ['light','medium','heavy','kill','multi','boss','reward','steer','rescue','danger'])test(`the real ${kind} acceptance demo runs for three seconds with valid feedback and never saves its score`,t=>{
  const g=graphicsRecorder();app.seedRenderer(g);app.setFeedbackStrength(.6);
  const previousBest=app.seedBest(0),previousSaved=saved.get('qiuqiule-best');saved.set('qiuqiule-best','0');
  const progressBefore=saved.get('qiuqiule-campaign'),skinsBefore=saved.get('qiuqiule-skins');
  const audio=app.recordFeedbackAudio();
  t.after(()=>{
    audio.restore();app.seedBest(previousBest);
    if(previousSaved===undefined)saved.delete('qiuqiule-best');else saved.set('qiuqiule-best',previousSaved);
    app.prepareNormalGame();app.setFeedbackStrength(.6);
  });
  app.runFeedbackDemo(kind);const {world,scene}=app.readRestart(),events=observeWorldEvents(world);
  assert.equal(app.isFeedbackDemo(),true);assert.equal(app.readRestart().paused,false);assert.equal(app.readRestart().screen,'play');
  if(kind==='steer'){
    const p=world.player,pointer=inputCanvas(),start={x:p.x,y:p.y},speed=Math.hypot(p.vx,p.vy);
    near(p.vx,world.baseSpeed);near(p.vy,-world.baseSpeed*.2);
    assert.ok(speed>world.readySpeed);assert.equal(world.enemies.length,3);assert.ok(world.enemies.every(enemy=>enemy.hp===10000));
    pointer('pointerdown',start.x,start.y);pointer('pointermove',start.x,start.y+world.maxPull);scene.update(0,0);
    assert.equal(app.readRestart().drag.pending,false);near(scene.timeScale,.3);
    pointer('pointercancel');pointer('pointerup',start.x,start.y+world.maxPull);
    assert.equal(app.readRestart().drag,null);near(scene.timeScale,1);near(Math.hypot(p.vx,p.vy),speed);
    assert.equal(events.filter(e=>e.type==='shoot').length,0,'cancelling the moving-ball demo never releases a shot');
    pointer('pointerdown',start.x,start.y);pointer('pointermove',start.x,start.y+world.maxPull);pointer('pointerup',start.x,start.y+world.maxPull);
    assert.equal(app.readRestart().drag,null);near(scene.timeScale,1);near(p.vx,0);near(p.vy,-speed);
    assert.equal(events.filter(e=>e.type==='shoot').length,1,'a deliberate release redirects exactly once');
    assert.equal(audio.calls.at(-1).name,'stopCharge');
  }
  let firstContactAudio=null;
  for(let frame=0;frame<360;frame++){
    scene.update(0,1000/120);assertFiniteDemoFrame(world,scene,g);
    if(firstContactAudio===null&&events.some(event=>event.type==='hit'))firstContactAudio=audio.calls.filter(call=>call.name==='impact'&&call.args[0].kind==='hit');
    if(kind==='boss'&&world.boss)assert.ok(!g.shapes.some(shape=>shape.type==='ellipse'&&[0xf9f8f0,0xffffff].includes(shape.color)&&shape.alpha>0&&Math.hypot(shape.x-world.boss.x,shape.y-world.boss.y)<world.boss.r*.5),'the boss itself never receives a white overlay; pre-Boss ordinary targets keep their existing feedback');
  }
  const hits=events.filter(e=>e.type==='hit'),kills=events.filter(e=>e.type==='kill');
  if(['light','medium','heavy'].includes(kind)){
    assert.ok(hits.length>0,'the pre-arranged launch reaches its target');
    assert.equal(hits[0].lethal,false);assert.ok(hits[0].damage>0&&hits[0].damage<hits[0].maxHp);
    if(kind==='light'){
      assert.ok(hits[0].damage<hits[0].maxHp*.1);assert.equal(hits[0].freezeDuration,0);
      assert.equal(hits[0].hitTier,'light');
      assert.equal(firstContactAudio.length,0,'the first real light contact is silent');
    }else if(kind==='medium'){
      assert.ok(hits[0].damage>=hits[0].maxHp*.1&&hits[0].damage<hits[0].maxHp*.3);assert.equal(hits[0].freezeDuration,0);
      assert.equal(hits[0].hitTier,'medium');
      assert.equal(firstContactAudio[0]?.args[0].hitTier,'medium');
    }else{
      assert.ok(hits[0].damage>=hits[0].maxHp*.3);assert.ok(hits[0].freezeDuration>0);
    }
  }else if(kind==='kill')assert.ok(kills.length>=1);
  else if(kind==='multi')assert.ok(kills.length>=2,'continuous-kill demo must actually demonstrate multiple kills without extra input');
  else if(kind==='reward'){
    assert.equal(kills.length,1,'the automatic launch performs the threshold kill exactly once');
    assert.equal(events.filter(e=>e.type==='clearKill').length,8);assert.equal(world.score,90);
    assert.equal(world.stageKills,world.killTarget);assert.equal(events.filter(e=>e.type==='upgrade').length,1);
    assert.equal(world.phase,'choose','the final-kill demo reaches its ordinary reward choices within three seconds');
    assert.equal(world.ready,true);assert.equal(world.choices.length,3);
    assert.ok(element('#choice-labels').children.length>0&&element('#choice-labels').children.every(node=>node.style.opacity==='1'));
  }
  else if(kind==='steer'){
    assert.equal(world.phase,'battle');assert.equal(kills.length,0,'the sturdy demo targets remain available for repeated practice');
    // Make a real collision lethal so the record-isolation assertion exercises
    // an actual positive award instead of merely checking the initial zero.
    world.player.x=world.width*.25;world.player.y=world.height*.5;
    collideFeedbackEnemy(world);scene.update(0,0);assert.ok(world.score>0);
  }
  else if(kind==='rescue'){
    assert.equal(world.phase,'battle');assert.equal(world.saveUsed,true);assert.equal(world.liveCount,25);
    assert.equal(world.score,0);assert.equal(world.stageKills,0);
    assert.equal(events.filter(event=>event.type==='rescue').length,1);
    assert.equal(events.filter(event=>event.type==='shatter'&&event.source==='rescue').length,3);
    world.damage(world.enemies[0],1000);scene.update(0,0);assert.equal(world.score,10);
  }
  else if(kind==='danger'){
    assert.equal(world.phase,'over');assert.equal(world.deathReason,'capacity');assert.equal(app.readRestart().modal,'over');
    assert.equal(events.filter(event=>event.type==='over').length,1);assert.equal(events.filter(event=>event.type==='rescue').length,0);
    assert.equal(element('#result-reason').hidden,true,'playground results do not present a personal record claim');
  }
  else{
    assert.ok(events.some(e=>e.type==='bossHit'&&e.power>0));assert.ok(world.boss.r<events.find(event=>event.type==='bossEntry').r);assert.equal(events.filter(event=>event.type==='clearKill').length,2);assert.equal(world.enemies.length,0);
    assert.ok(audio.calls.some(c=>c.name==='impact'&&c.args[0].kind==='boss'),'the automatic boss hit dispatches the proper impact sound');
    // Exercise a real segment reward too, to verify the boss-score persistence
    // branch even when the three-second automatic launch only shrinks it once.
    for(let i=0;i<30&&world.boss.scoredSegments===0;i++)world.damageBoss(world.baseSpeed);
    scene.update(0,0);assert.ok(world.boss.scoredSegments>0);assert.ok(world.score>30);
  }
  assert.equal(saved.get('qiuqiule-best'),'0');
  assert.equal(saved.get('qiuqiule-campaign'),progressBefore);assert.equal(saved.get('qiuqiule-skins'),skinsBefore);
  if(world.score>0){
    clickAction('pause');app.advanceUi(.42);clickAction('home');
    assert.equal(app.readRestart().modal,'over','the ordinary pause-to-results route is exercised');
    assert.equal(saved.get('qiuqiule-best'),'0','the result path also keeps demo records isolated');
    app.advanceUi(.82);clickRestart();app.advanceUi(.65);
    assert.equal(app.isFeedbackDemo(),false,'an ordinary restart exits the playground');
    assert.equal(app.readRestart().world.score,0);assert.equal(saved.get('qiuqiule-best'),'0');
    if(kind==='reward'){
      const normal=app.readRestart();finishStartingChoice(normal.world,normal.scene);normal.world.spawnTimer=Infinity;normal.world.floorTimer=Infinity;
      collideFeedbackEnemy(normal.world);normal.scene.update(0,0);
      assert.equal(saved.get('qiuqiule-best'),'10','the new ordinary run resumes real record saving');
    }
  }
});

test('pressure playgrounds keep their seven-column layout and player above the controls on phone and desktop',t=>{
  const panel=element('#feedback-demo'),previousRect=panel.getBoundingClientRect,previousHidden=panel.hidden;
  t.after(()=>{panel.getBoundingClientRect=previousRect;panel.hidden=previousHidden;app.seedRenderer(graphicsRecorder());app.prepareNormalGame();app.setFeedbackStrength(.6);});
  for(const [width,height,top] of [[390,844,594],[1364,936,725]])for(const kind of ['rescue','danger']){
    const g=graphicsRecorder();app.seedRenderer(g,width,height);app.setFeedbackStrength(.6);
    panel.hidden=false;panel.getBoundingClientRect=()=>({left:0,right:width,top,bottom:height,width,height:height-top});
    app.runFeedbackDemo(kind);const {world,scene}=app.readRestart(),p=world.player,bounds=world.arenaBounds,events=observeWorldEvents(world);
    assert.ok(p.y+p.r<=top-p.r+1e-8,'the player retains a full radius of clearance above the visible panel');
    assert.equal(world.enemies.length,kind==='rescue'?28:27);
    assert.equal(new Set(world.enemies.map(body=>body.x)).size,7);assert.equal(new Set(world.enemies.map(body=>body.y)).size,4);
    const bodies=[p,...world.enemies];
    for(let index=0;index<bodies.length;index++){
      const body=bodies[index];
      assert.ok(body.x-body.r>=bounds.left-1e-8&&body.x+body.r<=bounds.right+1e-8);
      assert.ok(body.y-body.r>=bounds.top-1e-8&&body.y+body.r<=Math.min(bounds.bottom,top)+1e-8);
      for(const other of bodies.slice(index+1))assert.ok(Math.hypot(body.x-other.x,body.y-other.y)>=body.r+other.r-1e-8,'the laid-out balls start without overlap');
    }
    scene.update(0,0);assertFiniteDemoFrame(world,scene,g);
    advanceScene(scene,kind==='rescue'?.82:1.62);
    if(kind==='rescue'){
      assert.equal(world.phase,'battle');assert.equal(world.saveUsed,true);assert.equal(world.liveCount,25);
      assert.equal(events.filter(event=>event.type==='rescue').length,1);
    }else{
      assert.equal(world.phase,'over');assert.equal(world.deathReason,'capacity');assert.equal(events.filter(event=>event.type==='over').length,1);
    }
  }
});

test('returning home or preparing a real run exits the acceptance demo and restores ordinary scoring',()=>{
  const previousBest=app.seedBest(0),previousSaved=saved.get('qiuqiule-best');
  try{
    app.seedRenderer(graphicsRecorder());app.runFeedbackDemo('kill');
    clickAction('home');assert.equal(app.isFeedbackDemo(),false);assert.equal(app.readRestart().screen,'home');assert.equal(app.readRestart().world,null);
    app.advanceUi(.65);app.runFeedbackDemo('multi');assert.equal(app.isFeedbackDemo(),true);
    app.prepareNormalGame();assert.equal(app.isFeedbackDemo(),false);
    const {world,scene}=app.readRestart();finishStartingChoice(world,scene);world.spawnTimer=Infinity;world.floorTimer=Infinity;world.wave=null;
    collideFeedbackEnemy(world);scene.update(0,0);
    assert.ok(world.score>0);assert.equal(Number(saved.get('qiuqiule-best')),world.score,'a subsequent real run saves its real score again');
  }finally{
    app.seedBest(previousBest);if(previousSaved===undefined)saved.delete('qiuqiule-best');else saved.set('qiuqiule-best',previousSaved);
    app.prepareNormalGame();app.setFeedbackStrength(.6);
  }
});

// Task 6 exercises the actual entry scene and event routing; only DOM/Phaser
// surfaces and the starting position of each reproducible scenario are mocked.
function documentPointer(type,options={}){
  const event={pointerId:91,isPrimary:true,button:0,clientX:20,clientY:20,detail:1,target:{closest:()=>null},preventDefault(){},...options};
  for(const handler of listeners.get(type)||[])handler(event);
}
function endingRun(module=app,strength=.6){
  const run=feedbackRun(module,strength),{world,scene}=run;
  module.seedEndless({best:1000},{recordEffects:true});
  Object.assign(world,{score:460,maxCombo:7,maxStage:12,shotHistory:Array.from({length:3},()=>({time:world.feedbackTime,hits:0}))});
  Object.assign(world.player,{vx:world.unit*5,vy:-world.unit,born:1,solid:true});
  world.endRun('capacity');scene.update(0,0);
  assert.ok(scene.ending);assert.equal(module.readRestart().result,null);
  return run;
}
function chooseByContact(world,scene,choice=world.choices[0]){
  assert.equal(world.phase,'choose');assert.ok(choice);
  const count=world.buffs[choice.id]||0;
  Object.assign(world.player,{x:choice.x,y:choice.y,vx:0,vy:0,feedbackFreeze:0});
  scene.update(0,1000/120);
  assert.equal(world.phase,'reward');assert.equal(world.buffs[choice.id],count+1);
  return choice.id;
}
function waitForChoose(world,scene){
  for(let frame=0;world.phase!=='choose'&&frame<1000;frame++)scene.update(0,1000/120);
  assert.equal(world.phase,'choose');
}

function finishStartingChoice(world,scene){
  assert.equal(world.startingUpgrades,true);assert.equal(world.rewardSelectionsRemaining,1);
  waitForChoose(world,scene);chooseByContact(world,scene,world.choices.find(choice=>choice.id!=='growth'));
  advanceScene(scene,world.rewardTiming.rest+.01);assert.equal(world.phase,'battle');assert.equal(world.startingUpgrades,false);
}

test('the real endless failure freezes gameplay, animates only its snapshot and shows ordered result statistics before a 400 ms blank restart',()=>{
  const {world,scene}=endingRun(),snapshot=scene.ending;
  const actual={x:world.player.x,y:world.player.y,time:world.time,feedbackTime:world.feedbackTime,score:world.score,enemies:world.enemies.length};
  let steps=0;const original=world.step.bind(world);world.step=(...args)=>{steps++;return original(...args);};
  advanceScene(scene,.3);near(snapshot.age,.3);assert.notEqual(snapshot.player.x,actual.x);
  assert.equal(steps,0);assert.deepEqual({x:world.player.x,y:world.player.y,time:world.time,feedbackTime:world.feedbackTime,score:world.score,enemies:world.enemies.length},actual);
  documentPointer('pointerdown');documentPointer('click');assert.equal(app.readRestart().world,world,'ending cannot be skipped by blank clicks');
  advanceScene(scene,.3);assert.equal(scene.ending,null);
  let state=app.readRestart();assert.equal(state.modal,'over');assert.equal(state.transfer.duration,.4);
  assert.equal(state.result.maxCombo,7);assert.equal(state.result.maxStage,12);
  assert.match(element('#result-peak').innerHTML,/最大连击.*7.*到达阶段.*12/);
  assert.equal(element('#result-records').textContent,'历史最佳1000');assert.equal(element('#result-records').hidden,false);
  assert.equal(element('#result-reason').textContent,'');
  documentPointer('pointerdown');documentPointer('click');assert.equal(app.readRestart().transfer.target,'over','flight cannot be restarted early');
  app.advanceUi(.4);assert.equal(app.readRestart().transfer,null);assert.equal(element('#ui-ball .ui-result-crown').style.display,'','six-combo crowns remain available without a Boss victory');
  documentPointer('click');assert.equal(app.readRestart().world,world,'late release without a fresh result press cannot restart');
  for(const options of [{isPrimary:false},{button:2}]){documentPointer('pointerdown',options);documentPointer('click');assert.equal(app.readRestart().world,world);}
  documentPointer('pointerdown');documentPointer('pointermove',{clientX:40});documentPointer('click');assert.equal(app.readRestart().world,world);
  documentPointer('pointerdown');documentPointer('pointercancel');documentPointer('click');assert.equal(app.readRestart().world,world);
  documentPointer('pointerdown');documentPointer('click');state=app.readRestart();assert.notEqual(state.world,world);assert.equal(state.transfer.duration,.4);
  const fresh=state.world;documentPointer('click');assert.equal(app.readRestart().world,fresh,'one accepted click starts exactly one new run');
  app.advanceUi(.4);assert.equal(app.readRestart().transfer,null);assert.equal(fresh.score,0);assert.equal(fresh.startingUpgrades,true);assert.equal(fresh.rewardSelectionsRemaining,1,'quick restart always offers one starting choice');
});

test('result crowns begin transparent at arrival and fade in during settled time, including reduced motion',async()=>{
  for(const reduced of [false,true])await withReloadedEntry({juice:.6},reduced,fresh=>{
    const {scene}=endingRun(fresh);advanceScene(scene,.61);
    const crown=element('#ui-ball .ui-result-crown');
    assert.equal(crown.style.display,'none','no crown travels into the result');
    fresh.advanceUi(.82);
    assert.equal(fresh.readRestart().transfer,null);assert.equal(crown.style.display,'');
    near(Number(crown.style.opacity),0,'even a large arrival frame starts transparent');
    fresh.advanceUi(.08);near(Number(crown.style.opacity),0);
    fresh.advanceUi(.16);assert.ok(Number(crown.style.opacity)>0&&Number(crown.style.opacity)<1);
    const middle=Number(crown.style.opacity);fresh.advanceUi(0);near(Number(crown.style.opacity),middle);
    fresh.advanceUi(.16);near(Number(crown.style.opacity),1);
    fresh.advanceUi(1.45);near(Number(crown.style.opacity),1,'later result bounces never restart the fade');
  });
});

test('leaving a crowned result fades from the displayed opacity through restart and home transfers',t=>{
  t.after(()=>app.setFeedbackStrength(.6));
  for(const age of [.24,.5])for(const action of ['restart','home']){
    const {scene}=endingRun();advanceScene(scene,.61);app.advanceUi(.4);app.advanceUi(age);
    const crown=element('#ui-ball .ui-result-crown'),before=Number(crown.style.opacity);
    assert.ok(before>0);
    clickAction(action);assert.ok(app.readRestart().transfer);assert.equal(app.readRestart().result,null);
    near(Number(crown.style.opacity),before,'capture the visible crown before clearing result state');
    app.advanceUi(.09);assert.ok(Number(crown.style.opacity)>0&&Number(crown.style.opacity)<before);
    app.advanceUi(.09);near(Number(crown.style.opacity),0);assert.equal(crown.style.display,'none');
    app.advanceUi(.65);assert.equal(app.readRestart().transfer,null);assert.equal(crown.style.display,'none');
  }
});

test('ending blur, pagehide and visibility suspension preserve active time and discard the entire returning frame',()=>{
  const oldHidden=document.hidden,oldFocus=document.hasFocus;
  try{
    for(const interruption of ['blur','pagehide','hidden']){
      document.hidden=false;document.hasFocus=()=>true;
      const {world,scene}=endingRun();advanceScene(scene,.2);const ending=scene.ending,pose={...ending.player};
      if(interruption==='hidden'){document.hidden=true;for(const fn of listeners.get('visibilitychange'))fn();}
      else for(const fn of windowListeners.get(interruption))fn();
      scene.update(0,5000);near(ending.age,.2);near(ending.player.x,pose.x);assert.equal(app.readRestart().modal,null);
      if(interruption==='hidden'){document.hidden=false;for(const fn of listeners.get('visibilitychange'))fn();}
      else for(const fn of windowListeners.get(interruption==='blur'?'focus':'pageshow'))fn();
      scene.update(0,5000);near(ending.age,.2);assert.equal(app.readRestart().world,world);
      advanceScene(scene,.39);assert.equal(app.readRestart().result,null);
      advanceScene(scene,.02);assert.equal(app.readRestart().modal,'over');assert.equal(world.score,460);
    }
  }finally{document.hidden=oldHidden;document.hasFocus=oldFocus;}
});

test('resizing during the ending maps its snapshot, preserves its age and reaches results without advancing the failed world',t=>{
  const {g,world,scene}=endingRun(),pointer=inputCanvas();
  const previous={width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio,add:window.addEventListener};let resize;
  window.addEventListener=(type,handler)=>{if(type==='resize')resize=handler;else previous.add(type,handler);};
  t.after(()=>{window.innerWidth=previous.width;window.innerHeight=previous.height;window.devicePixelRatio=previous.dpr;window.addEventListener=previous.add;});
  app.mountSceneBoundary(pointer.canvas,g);advanceScene(scene,.2);
  const ending=scene.ending,old={x:ending.player.x,y:ending.player.y,r:ending.player.r,unit:world.unit,time:world.time};
  window.innerWidth=844;window.innerHeight=390;resize();
  assert.equal(scene.ending,ending);near(ending.age,.2);near(ending.player.r,old.r*world.unit/old.unit);
  const bounds=world.arenaBounds;assert.ok(ending.player.x-ending.player.r>=bounds.left&&ending.player.x+ending.player.r<=bounds.right);
  assert.ok(ending.player.y-ending.player.r>=bounds.top&&ending.player.y+ending.player.r<=bounds.bottom);
  scene.update(0,5000);near(ending.age,.2);near(world.time,old.time);
  advanceScene(scene,.41);assert.equal(app.readRestart().modal,'over');assert.equal(world.score,460);assert.equal(app.readRestart().result.maxCombo,7);
});

test('zero strength and reduced motion keep the full ending duration with a static snapshot',async()=>{
  for(const [strength,reduced] of [[0,false],[1,true]])await withReloadedEntry({juice:strength},reduced,fresh=>{
    const {world,scene}=endingRun(fresh,strength),pose={...scene.ending.player};
    advanceScene(scene,.59);near(scene.ending.player.x,pose.x);near(scene.ending.player.y,pose.y);near(scene.timeScale,1);
    assert.equal(fresh.readRestart().result,null);advanceScene(scene,.02);
    assert.equal(fresh.readRestart().modal,'over');assert.equal(world.score,460);
  });
  const {world,scene}=endingRun();advanceScene(scene,.2);const ending=scene.ending,pose={...ending.player};
  app.setFeedbackStrength(0);assert.equal(scene.ending,ending);near(ending.age,.2);
  advanceScene(scene,.39);near(ending.player.x,pose.x);near(ending.player.y,pose.y);
  advanceScene(scene,.02);assert.equal(app.readRestart().modal,'over');assert.equal(world.score,460);app.setFeedbackStrength(.6);
});

test('a new record compares against the starting best, celebrates once and persists stage, combo and the captured day',t=>{
  const {world,scene}=controlRun();app.seedEndless({best:100},{date:'2030-01-01'});
  const tones=app.recordTones();t.after(()=>tones.restore());
  world.score=100;app.updateScoreHud();assert.equal(app.readEndless().runNewRecord,false);
  world.score=101;world.maxCombo=6;app.updateScoreHud();assert.equal(app.readEndless().runNewRecord,true);
  assert.deepEqual(tones.calls.map(call=>call[0]),[660]);app.updateScoreHud(.1);
  near(Number(element('#score').style.transform.match(/scale\(([^)]+)/)[1]),1.3);assert.deepEqual(tones.calls.map(call=>call[0]),[660,880]);
  world.score=120;world.stage=4;world.maxStage=4;app.updateScoreHud(.2);
  assert.deepEqual(tones.calls.map(call=>call[0]),[660,880]);assert.equal(element('#score').style.color,'');
  const stored=JSON.parse(saved.get('qiuqiule-endless'));
  assert.equal(stored.best,120);assert.equal(stored.maxStage,4);assert.equal(stored.maxCombo,6);
  assert.deepEqual(stored.daily.find(day=>day.key==='2030-01-01'),{key:'2030-01-01',best:120,maxStage:4,maxCombo:6});
  assert.equal(app.readEndless().runBest,100);world.stageKills=7;scene.update(0,0);assertStageProgress(world);
});

test('endless records retain reached stages while the player keeps its circular geometry',()=>{
  const {world}=controlRun();app.seedEndless();app.seedCircle();const original=app.readPlayerShape().playerContour;
  for(const stage of [5,10,15,20,25]){
    world.stage=world.maxStage=stage;app.updateScoreHud();assert.equal(JSON.parse(saved.get('qiuqiule-endless')).maxStage,stage);
    assert.equal(app.readPlayerShape().playerContour,original);assertSameContour(original,skinContour(0));
    assert.equal(app.readRestart().modal,null,'milestones do not interrupt live play');
  }
  app.seedCircle();
});
test('old campaign and polygon saves cannot replace the default circular player or restore a removed mode',async()=>{
  const prior=new Map(saved);
  try{
    for(const sides of [6,9,15]){
      saved.set('qiuqiule-skins',JSON.stringify({enabled:true,sides,unlocked:15,variants:[sides],variant:true}));
      saved.set('qiuqiule-campaign',JSON.stringify({completed:100,unlocked:100}));saved.set('qiuqiule-mode',JSON.stringify('campaign'));
      await withReloadedEntry(null,false,fresh=>{
        assertSameContour(fresh.readPlayerShape().playerContour,skinContour(0));
        const {scene}=fresh.seedRenderer(graphicsRecorder());fresh.prepareNormalGame();
        const state=fresh.readRestart();assert.equal(state.screen,'play');assert.equal(state.world.stage,1);
        assert.equal(state.world.startingUpgrades,true);assert.equal(state.world.choices.length,3);assert.ok(state.world instanceof World);
        scene.update(0,0);assertSameContour(fresh.readPlayerShape().playerContour,skinContour(0));
      });
    }
  }finally{saved.clear();for(const [key,value]of prior)saved.set(key,value);}
});
test('every normal fresh game offers exactly one regular starting choice regardless of its historical stage',()=>{
  for(const maxStage of [0,4,5,10,25,1000]){
    const rounds=1;
    app.seedRenderer(graphicsRecorder(),390,844,true);app.seedEndless({maxStage,best:0});app.prepareNormalGame();
    const {world,scene}=app.readRestart(),events=observeWorldEvents(world);
    assert.equal(world.score,0);assert.equal(world.stage,1);
    assert.equal(world.startingUpgrades,true);assert.equal(world.rewardSelectionsRemaining,rounds);assert.equal(world.enemies.length,0);
    for(let round=1;round<=rounds;round++){
      waitForChoose(world,scene);assert.equal(world.upgradeRound,round);assert.equal(world.choices.length,3);
      assert.ok(world.choices.every(choice=>choice.kind==='regular'&&(world.buffs[choice.id]||0)<choice.maxStacks));
      advanceScene(scene,2);assert.equal(world.enemies.length,0);assert.equal(world.stage,1,'choosing is player controlled, never automatic');
      chooseByContact(world,scene);advanceScene(scene,world.rewardTiming.rest+.01);
      if(round<rounds){assert.equal(world.phase,'transition');assert.equal(world.stage,1);assert.equal(world.enemies.length,0);}
    }
    assert.equal(world.phase,'battle');assert.equal(world.startingUpgrades,false);assert.equal(world.enemies.length,6);
    assert.equal(world.score,0);assert.equal(world.stageKills,0);assert.ok(world.time<.02,'time spent selecting cannot increase stage-one stats');
    assert.equal(world.pendingUpgradeBoost,true);assert.equal(events.filter(event=>event.type==='buff').length,rounds);
  }
});

test('Boss victory gives two physical reward rounds, or three with gambler, and advances only after the last choice',()=>{
  for(const gambler of [false,true]){
    const {world,scene}=bossScene(10);advanceToBoss(world,scene);world.gamblerRewardPending=gambler;
    defeatBoss(world,scene);waitForChoose(world,scene);
    const rounds=gambler?3:2,score=world.score;assert.equal(world.upgradeRoundTotal,rounds);
    for(let round=1;round<=rounds;round++){
      waitForChoose(world,scene);assert.equal(world.upgradeRound,round);assert.equal(world.choices.length,3);
      assert.equal(world.rewardSelectionsRemaining,rounds-round+1);assert.equal(world.gamblerRewardPending,false);
      assert.ok(world.choices.every(choice=>(world.buffs[choice.id]||0)<choice.maxStacks));
      chooseByContact(world,scene,world.choices.find(choice=>choice.id!=='gambler'));advanceScene(scene,world.rewardTiming.rest+.01);
      if(round<rounds){assert.equal(world.stage,10);assert.equal(world.phase,'transition');assert.equal(world.enemies.length,0);}
    }
    assert.equal(world.stage,11);assert.equal(world.phase,'battle');assert.equal(world.rewardSelectionsRemaining,0);assert.equal(world.score,score);
    assert.equal(world.boss,null);assert.ok(world.enemies.length>=world.floorCount);assert.equal(world.pendingUpgradeBoost,true);
  }
});

test('same-time restarts randomize gameplay while records stay on the opening date across midnight',t=>{
  let nextSeed=900; t.mock.method(globalThis.crypto,'getRandomValues',array=>{array[0]=nextSeed++;return array;});
  const OriginalDate=globalThis.Date;let now='2030-01-01T12:00:00';
  class FakeDate extends OriginalDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return new OriginalDate(now).getTime();}}
  globalThis.Date=FakeDate;
  try{
    app.seedRenderer(graphicsRecorder(),390,844,true);app.seedEndless();app.prepareNormalGame();
    const beginBattle=()=>{const {world,scene}=app.readRestart();waitForChoose(world,scene);chooseByContact(world,scene,world.choices.find(choice=>choice.id!=='growth'));advanceScene(scene,world.rewardTiming.rest+.01);assert.equal(world.phase,'battle');};
    beginBattle();
    const first=app.readRestart().world,key=app.readEndless().runDay.key,seed=app.readEndless().runDay.seed;
    const bodyState=world=>world.enemies.map(({x,y,r,hp,enemyType})=>({x,y,r,hp,enemyType}));const firstBodies=bodyState(first);
    app.prepareNormalGame();beginBattle();assert.equal(app.readEndless().runDay.key,key);assert.notEqual(app.readEndless().runDay.seed,seed);assert.notDeepEqual(bodyState(app.readRestart().world),firstBodies);
    now='2030-01-02T12:00:00';app.readRestart().world.score=13;app.updateScoreHud();
    assert.equal(app.readEndless().runDay.key,key);assert.equal(JSON.parse(saved.get('qiuqiule-endless')).daily.find(day=>day.key===key).best,13);
    app.prepareNormalGame();beginBattle();assert.equal(app.readEndless().runDay.key,'2030-01-02');assert.notEqual(app.readEndless().runDay.seed,seed);
    assert.notDeepEqual(bodyState(app.readRestart().world),firstBodies);
  }finally{globalThis.Date=OriginalDate;}
});

for(const kind of ['boss-inflation','boss-rewards','ending','starting-1'])test(`task-six playground ${kind} runs through the actual scene and isolates all records and unlocks`,()=>{
  const g=graphicsRecorder();app.seedRenderer(g);app.seedEndless({best:777,maxStage:1,maxCombo:2});app.seedCircle();
  const stored=new Map(saved);app.runFeedbackDemo(kind);const {world,scene}=app.readRestart(),events=observeWorldEvents(world);
  assert.equal(app.isFeedbackDemo(),true);assert.equal(app.readRestart().screen,'play');
  const originalEnemies=world.enemies.map(body=>body.id);
  for(let frame=0;frame<960;frame++){scene.update(0,1000/120);assertFiniteDemoFrame(world,scene,g);}
  if(kind.startsWith('boss-')&&kind!=='boss-rewards'){
    assert.equal(world.boss.bossType,kind.slice(5));assert.equal(world.phase,'boss');assert.equal(originalEnemies.length,3);assert.equal(events.filter(event=>event.type==='clearKill').length,2);assert.equal(events.filter(event=>event.type==='clearingStart').length,1);assert.equal(world.enemies.length,0);
    assert.ok(events.some(event=>event.type==='bossHit'));
  }else if(kind==='boss-rewards'){
    assert.equal(world.phase,'choose');assert.equal(world.rewardSelectionsRemaining,2);assert.equal(world.upgradeRound,1);assert.equal(world.choices.length,3);
    chooseByContact(world,scene);waitForChoose(world,scene);assert.equal(world.upgradeRound,2);assert.equal(world.choices.length,3);
  }else if(kind==='ending'){
    assert.equal(world.phase,'over');assert.equal(app.readRestart().modal,'over');assert.equal(app.readRestart().result.maxCombo,7);
    assert.equal(element('#result-records').hidden,true);assert.equal(element('#result-reason').hidden,true);
  }else{
    assert.equal(world.startingUpgrades,true);assert.equal(world.upgradeRoundTotal,1);assert.equal(world.choices.length,3);
    assert.ok(world.choices.every(choice=>choice.kind==='regular'));assert.equal(world.enemies.length,0);
  }
  assert.deepEqual(saved,stored,'demo state must not persist best, daily stats, milestones, campaign progress or skins');
});


test('real split balls keep the circular player outline while only the main ball has a face',()=>{
  try{
    {
      const g=graphicsRecorder();app.seedRenderer(g);app.seedCircle();app.runFeedbackDemo('upgrade-split');
      const {world,scene}=app.readRestart();
      for(let frame=0;!world.auxiliaries.length&&frame<180;frame++)scene.update(0,1000/120);
      assert.equal(world.auxiliaries.length,2);
      for(const [index,body] of [world.player,...world.auxiliaries].entries())Object.assign(body,{x:80+index*100,y:400,vx:0,vy:0,squash:0,angle:0,roll:0,feedbackFreeze:0});
      scene.resetFeedback();scene.update(0,0);const contour=Array.from({length:192},(_,i)=>({x:Math.cos(i/192*Math.PI*2),y:Math.sin(i/192*Math.PI*2)}));
      for(const body of [world.player,...world.auxiliaries]){
        const shape=g.shapes.find(shape=>shape.type==='path'&&shape.color===app.playerInk()&&shape.points?.length===193&&Math.hypot(outlineBounds(shape).cx-body.x,outlineBounds(shape).cy-body.y)<body.r*.1&&Math.abs(outlineBounds(shape).width/body.r-(Math.max(...contour.map(p=>p.x))-Math.min(...contour.map(p=>p.x))))<1e-6);
        assert.ok(shape,'each physical player ball has its own visible skin');
        near(shape.alpha,body.isAuxiliary?.6:1);
        const local=shape.points.slice(0,-1).map(point=>({x:(point.x-body.x)/body.r,y:(point.y-body.y)/body.r}));
        assertSameContour(local,contour);
        assert.equal(playerEyes(g,body).length,body.isAuxiliary?0:2);
      }
    }
  }finally{app.seedCircle();app.prepareNormalGame();}
});

test('real split photos use independent slots with the main photo retained and removed auxiliaries hidden on the next frame',()=>{
  const g=graphicsRecorder();app.seedRenderer(g);app.seedCircle();app.runFeedbackDemo('upgrade-split');
  const {world,scene}=app.readRestart();for(let frame=0;!world.auxiliaries.length&&frame<180;frame++)scene.update(0,1000/120);
  assert.equal(world.auxiliaries.length,2);for(const body of [world.player,...world.auxiliaries])body.feedbackFreeze=0;scene.resetFeedback();const photos=app.recordCompositePhotos();
  try{
    scene.update(0,0);assert.equal(photos.main.length,1);assert.deepEqual(photos.aux.map(call=>call.slot),[0,1]);
    assert.deepEqual([...photos.visible].sort(),[0,1,'main']);
    for(const [index,body] of world.auxiliaries.entries()){
      const draw=photos.aux[index];near(draw.pose.x,body.x);near(draw.pose.y,body.y);near(draw.pose.r,body.r);
      assertSameContour(draw.contour,photos.main[0].contour);assert.equal(draw.options.baseColor,photos.main[0].options.baseColor);
      assert.equal(draw.options.alpha,.6);assert.equal(playerEyes(g,body).length,0);
    }
    near(photos.main[0].pose.x,world.player.x);near(photos.main[0].pose.r,world.player.r);assert.equal(eyeShapes(g).length,0,'photo mode never adds canvas eyes');
    world.clearAuxiliaries();scene.update(0,0);
    assert.equal(photos.main.length,2,'the main photo still draws after split cleanup');assert.equal(photos.aux.length,2,'expired auxiliaries never draw again');
    assert.deepEqual([...photos.visible],['main']);assert.ok(photos.hidden.length>=2);
  }finally{photos.restore();app.seedCircle();app.prepareNormalGame();}
});


function finalBossCollision(module=app,strength=.6){
  const run=feedbackRun(module,strength),{world,scene}=run;world.stage=5;world.beginBoss();advanceScene(scene,.86);
  assert.equal(world.phase,'boss');scene.resetFeedback();world.events=[];
  Object.assign(world.boss,{r:world.boss.minRadius,stunned:true,hp:1,maxHp:1,feedbackFreeze:0});
  const p=world.player,b=world.boss;Object.assign(p,{x:b.x,y:b.y+b.r+p.r-.1,vx:0,vy:-world.baseSpeed,feedbackFreeze:0});
  const events=observeWorldEvents(world);
  world.collideBoss();assert.equal(world.phase,'boss-celebrate');assert.equal(world.bossKills,1);assert.equal(world.hasDefeatedBoss,true);scene.update(0,0);
  return {...run,events};
}

test('a real Boss final collision triggers one heavy sound and a 180 ms border-only pulse with immutable square, ball and HUD geometry',t=>{
  const audio=app.recordFeedbackAudio();t.after(()=>{audio.restore();app.setFeedbackStrength(.6);});
  const {world,scene,g}=finalBossCollision(),circle={...world.arenaGeometry},pose={x:world.player.x,y:world.player.y,r:world.player.r};
  const hud=element('#hud').style.transform,scoreTransform=element('#score').style.transform;
  assert.equal(audio.calls.filter(call=>call.name==='bossDefeat').length,1);
  assert.equal(audio.calls.filter(call=>call.name==='impact'&&call.args[0].kind==='boss').length,0,'the same final contact must not also play its ordinary Boss-hit sound');
  assert.equal(scene.wallFlashes.filter(flash=>flash.bossDefeat).length,1);assert.equal(g.borders.length,1);
  const baseline={...g.borders[0]};scene.updateFeedback(.025);g.clear();scene.drawArena();
  assert.ok(baseline.height<world.height-32,'the pulse belongs to the contracted Boss square');assert.equal(g.borders.length,1,'no static duplicate hides the shaking frame');
  const offset=5*.6*Math.sin(Math.PI*2*18*.025)*(1-.025/.18)**2;
  near(g.borders[0].x-baseline.x,offset);assert.ok(Math.abs(offset)>.1);
  for(const key of ['y','width','height','r'])near(g.borders[0][key],baseline[key]);
  assert.deepEqual(world.arenaGeometry,circle);assert.deepEqual({x:world.player.x,y:world.player.y,r:world.player.r},pose);
  assert.equal(element('#hud').style.transform,hud);assert.equal(element('#score').style.transform,scoreTransform);assert.equal(element('#game').style.transform,'none');
  scene.updateFeedback(.156);g.clear();scene.drawArena();assert.equal(g.borders.length,1);assert.equal(scene.wallFlashes.filter(flash=>flash.bossDefeat).length,0);
  for(const key of ['x','y','width','height','r'])near(g.borders[0][key],baseline[key]);
  assert.equal(audio.calls.filter(call=>call.name==='bossDefeat').length,1);
  for(const reason of ['pause','pagehide']){
    const run=finalBossCollision();assert.ok(run.scene.wallFlashes.some(flash=>flash.bossDefeat));
    if(reason==='pause')clickAction('pause');else for(const fn of windowListeners.get('pagehide'))fn();
    run.scene.update(0,0);assert.equal(run.scene.wallFlashes.some(flash=>flash.bossDefeat),false);
    app.advanceUi(.42);clickRestart();assert.equal(app.readRestart().scene.wallFlashes.some(flash=>flash.bossDefeat),false);
    if(reason==='pagehide')for(const fn of windowListeners.get('pageshow'))fn();
  }
});

test('Boss final border feedback is disabled at zero and stays on the original square with reduced motion',async()=>{
  for(const [strength,reduced] of [[0,false],[1,true]])await withReloadedEntry({juice:strength},reduced,fresh=>{
    const {world,scene,g}=finalBossCollision(fresh,strength),geometry={...world.arenaGeometry};
    scene.updateFeedback(.025);g.clear();scene.drawArena();assert.equal(g.borders.length,1);const pulse={...g.borders[0]};
    assert.deepEqual(world.arenaGeometry,geometry);scene.updateFeedback(.16);assert.equal(scene.wallFlashes.filter(flash=>flash.bossDefeat).length,0);
    g.clear();scene.drawArena();const base=g.borders[0];
    for(const key of ['x','y','width','height','r'])near(pulse[key],base[key]);
    if(strength)assert.ok(pulse.strokeWidth>base.strokeWidth);else near(pulse.strokeWidth,base.strokeWidth);
  });
});

test('a real Boss victory gives a low-combo result its crown and the next run clears only that run-specific award',()=>{
  const {world,scene}=finalBossCollision();assert.ok(world.maxCombo<6);world.endRun('capacity');scene.update(0,0);advanceScene(scene,.61);app.advanceUi(.4);
  const result=app.readRestart().result;assert.equal(result.bossKills,1);assert.ok(result.maxCombo<6);assert.equal(element('#ui-ball .ui-result-crown').style.display,'');
  clickRestart();app.advanceUi(.4);const fresh=app.readRestart().world;assert.equal(fresh.bossKills,0);assert.equal(fresh.hasDefeatedBoss,false);
  fresh.endRun('capacity');scene.update(0,0);advanceScene(scene,.61);app.advanceUi(.4);
  assert.equal(app.readRestart().result.bossKills,0);assert.ok(app.readRestart().result.maxCombo<6);assert.equal(element('#ui-ball .ui-result-crown').style.display,'none');
});


test('successful photo rendering paints each main or fading auxiliary body once, while unavailable photo rendering keeps the graphics fallback',()=>{
  for(const success of [true,false,undefined]){
    const g=graphicsRecorder();app.seedRenderer(g);app.seedCircle();app.runFeedbackDemo('upgrade-split');
    const {world,scene}=app.readRestart();for(let frame=0;!world.auxiliaries.length&&frame<180;frame++)scene.update(0,1000/120);
    assert.equal(world.auxiliaries.length,2);for(const body of [world.player,...world.auxiliaries])body.feedbackFreeze=0;scene.resetFeedback();
    const photos=app.recordCompositePhotos(success),bodyFills=()=>g.shapes.filter(shape=>shape.type==='path'&&shape.color===app.playerInk()&&shape.points?.length===193);
    try{
      scene.update(0,0);assert.equal(photos.main.length,1);assert.equal(photos.aux.length,2);
      assert.equal(bodyFills().length,success===true?0:3,'only an explicit renderer success replaces the main and auxiliary graphics fills');
      assert.equal(photos.main[0].options.alpha,1);assert.ok(photos.aux.every(call=>call.options.alpha===.6));
      world.endRun('capacity');scene.update(0,0);scene.advanceEnding(.6);
      const result=app.readRestart().result;assert.equal(result.sceneBodies.auxiliaries.length,2);result.clock=.65*.5;
      photos.aux.length=0;g.clear();scene.drawArena();assert.equal(photos.aux.length,2);assert.ok(photos.aux.every(call=>Math.abs(call.options.alpha-.3)<1e-9));
      const fills=bodyFills();assert.equal(fills.length,success===true?0:2,'half-transparent photo auxiliaries must not receive a second colored fill below the photo');
      if(success!==true)assert.ok(fills.every(shape=>Math.abs(shape.alpha-.3)<1e-9));
    }finally{photos.restore();app.seedCircle();}
  }
});

const cometShapes=(g,module=app)=>g.shapes.filter(shape=>shape.type==='path'&&shape.color===module.playerInk()&&shape.points.length>=4&&shape.alpha>0&&shape.alpha<1);

test('the actual scene draws a short transparent comet behind fast players, lengthens it with speed and omits enemy trails',t=>{
  const lengths=[];t.after(()=>app.setFeedbackStrength(.6));
  for(const speed of [19,25,40]){
    const {world,scene,g}=controlRun(),p=world.player;
    Object.assign(p,{x:80,y:600,vx:speed*world.unit,vy:0});advanceScene(scene,.2);
    const ribbons=cometShapes(g),entry=scene.cometTrails.entries.get(p);
    if(speed===19){assert.equal(ribbons.length,0);assert.equal(entry.active,false);continue;}
    assert.ok(ribbons.length>0);assert.equal(entry.active,true);assert.ok(entry.points.length<=48);
    const vertices=ribbons.flatMap(shape=>shape.points);assert.ok(vertices.every(point=>point.x<=p.x+1e-8),'the trail stays behind a right-moving player');
    assert.ok(ribbons.every(shape=>shape.alpha<=.24),'the body remains visually stronger than its translucent trail');
    lengths.push(p.x-Math.min(...vertices.map(point=>point.x)));
    assert.ok(lengths.at(-1)<=p.r*7+1,'the comet never becomes a full-screen motion path');
    const bodyIndex=g.shapes.findIndex(shape=>shape.type==='path'&&shape.alpha===1&&shape.color===app.playerInk()&&shape.points.length===193);
    assert.ok(g.shapes.indexOf(ribbons.at(-1))<bodyIndex,'the opaque player is drawn over the comet');
    const enemy=world.spawnEnemy(null,'normal');Object.assign(enemy,{x:100,y:200,vx:40*world.unit,vy:0,born:1,solid:true});
    advanceScene(scene,.05);assert.equal(scene.cometTrails.entries.has(enemy),false,'ordinary enemies do not fill the arena with trails');
    p.vx=17*world.unit;scene.update(0,0);assert.equal(cometShapes(g).length,0,'a slowing player loses its comet');
  }
  assert.ok(lengths[1]>lengths[0]*2,'the high-speed comet is visibly longer than the threshold-level comet');
});

test('Boss play and split auxiliaries share comet rendering, and independent aim slows trail ageing with world motion',t=>{
  t.after(()=>app.setFeedbackStrength(.6));
  {
    const {world,scene,g}=bossScene();app.setFeedbackStrength(1);advanceToBoss(world,scene);scene.resetFeedback();
    const p=world.player,b=world.arenaBounds;Object.assign(p,{x:b.left+60,y:b.bottom-p.r-20,vx:world.unit*35,vy:0,feedbackFreeze:0});
    advanceScene(scene,.12);assert.ok(cometShapes(g).length>0,'the square Boss arena uses the same speed presentation');
  }
  {
    const {world,scene,g,pointer}=controlRun(),p=world.player;
    const aux=world.makeBody(80,350,p.r*.55,p.density);Object.assign(aux,{isAuxiliary:true,born:1,solid:true,vx:world.unit*40,vy:0});world.auxiliaries=[aux];
    Object.assign(p,{x:80,y:600,vx:world.unit*40,vy:0});
    pointer('pointerdown',80,600);pointer('pointermove',80,640);advanceScene(scene,.5);near(scene.timeScale,.3);
    for(const body of [p,aux]){
      const trail=scene.cometTrails.entries.get(body);assert.equal(trail.active,true);assert.ok(trail.points.length>4);
      assert.ok(Math.max(...trail.points.map(point=>point.age))<.16,'history ages by simulated time, not half a second of real aim time');
    }
    assert.ok(cometShapes(g).some(shape=>outlineBounds(shape).cy<400),'the auxiliary gets a smaller tail in its own position');
    world.auxiliaries=[];scene.update(0,0);assert.equal(scene.cometTrails.entries.has(aux),false);pointer('pointercancel');
  }
});

test('comets are cleared across pause, background, rewards, ending, resize and fresh runs with no streak between positions',t=>{
  const previous={width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio,add:window.addEventListener};
  t.after(()=>{window.innerWidth=previous.width;window.innerHeight=previous.height;window.devicePixelRatio=previous.dpr;window.addEventListener=previous.add;document.hidden=false;app.seedRenderer(graphicsRecorder());app.setFeedbackStrength(.6);});
  for(const reason of ['pause','background','reward','ending','resize','restart']){
    const {world,scene,g,pointer}=controlRun(),p=world.player;let resize;
    window.addEventListener=(type,handler)=>{if(type==='resize')resize=handler;else previous.add(type,handler);};
    if(reason==='resize')app.mountSceneBoundary(pointer.canvas,g);
    Object.assign(p,{x:80,y:600,vx:world.unit*35,vy:0});advanceScene(scene,.12);assert.ok(cometShapes(g).length>0,reason);
    if(reason==='pause')clickAction('pause');
    else if(reason==='background'){document.hidden=true;for(const handler of listeners.get('visibilitychange'))handler();}
    else if(reason==='reward')world.beginUpgrade();
    else if(reason==='ending')world.endRun('capacity');
    else if(reason==='resize'){window.innerWidth=844;window.innerHeight=390;resize();}
    else app.prepareNormalGame();
    scene.update(0,0);assert.equal(cometShapes(g).length,0,reason);
    assert.ok([...scene.cometTrails.entries.values()].every(entry=>entry.points.length<=1),'no historical segment can connect different phases or viewports');
    document.hidden=false;window.innerWidth=previous.width;window.innerHeight=previous.height;
  }
});

test('zero visual feedback and reduced motion suppress comets while keeping the independent aim assist',async()=>{
  for(const [strength,reduced] of [[0,false],[1,true]])await withReloadedEntry({juice:strength},reduced,fresh=>{
    const {world,scene,g,pointer}=controlRun(fresh,strength),p=world.player;Object.assign(p,{x:80,y:600,vx:world.unit*40,vy:0});
    pointer('pointerdown',80,600);pointer('pointermove',80,640);advanceScene(scene,.2);
    near(scene.timeScale,reduced?.6:.3);assert.equal(cometShapes(g,fresh).length,0);assert.equal(scene.cometTrails.entries.size,0);pointer('pointercancel');
  });
});

// v6.5.6: inspect the actual DOM nodes and painted circles on both sides of
// transition -> choose, where replacing labels previously bypassed the fade.
function assertRewardEntry(world,scene,g,{fps=60,reduced=false}={}){
  scene.update(0,0);
  const nodes=[...element('#choice-labels').children],choices=[...world.choices];
  assert.equal(nodes.length,choices.length);assert.ok(nodes.length>0);
  const titles=nodes.map(node=>node.children[0]),fonts=titles.map(title=>title.style.fontSize);
  const widths=nodes.map(node=>node.style.width),radii=choices.map(choice=>choice.r);
  let previous=nodes.map(node=>Number(node.style.opacity)),previousFrame=null,sawPartial=false,crossed=false;
  assert.ok(previous.every(alpha=>alpha<.04),'each new offer starts transparent');
  for(let frame=0;frame<fps*2.5;frame++){
    const before=world.phase;scene.update(0,1000/fps);
    assert.deepEqual(element('#choice-labels').children,nodes,'keep the exact same nodes throughout entrance and ready state');
    const circles=[];
    for(const [i,choice] of choices.entries()){
      assert.equal(nodes[i].children[0],titles[i]);assert.equal(titles[i].style.fontSize,fonts[i]);
      assert.equal(nodes[i].style.width,widths[i]);assert.equal(choice.r,radii[i],'visual entry never changes collision radius');
      const alpha=Number(nodes[i].style.opacity);
      assert.ok(Number.isFinite(alpha)&&alpha>=previous[i]-1e-10&&alpha<=1);
      assert.ok(alpha-previous[i]<=3/world.rewardTiming.bornDuration/fps+1e-8,'opacity follows the same continuous birth easing at the faster tempo');
      if(alpha>.05&&alpha<.95)sawPartial=true;
      const shape=g.shapes.find(shape=>shape.type==='path'&&shape.points.length===96&&Math.abs(outlineBounds(shape).cx-choice.x)<1e-6);
      if(shape){
        const bounds=outlineBounds(shape);near(shape.alpha,alpha);
        near(bounds.width,2*choice.r*alpha);circles.push(bounds);
        near(parseFloat(nodes[i].style.top),bounds.cy+choice.r+14);
        if(reduced)near(bounds.cy,choice.y);
      }
      previous[i]=alpha;
    }
    if(before==='transition'&&world.phase==='choose'){
      crossed=true;assert.equal(circles.length,choices.length);
      circles.forEach((circle,i)=>{near(circle.width,previousFrame[i].width);assert.ok(Math.abs(circle.cy-previousFrame[i].cy)<.06,'floating begins without a position pop');});
    }
    previousFrame=circles;
  }
  assert.ok(crossed&&sawPartial);assert.equal(world.phase,'choose');
  assert.ok(nodes.every(node=>node.style.opacity==='1'));
  return nodes;
}

for(const [kind,fps] of [['starting',120],['ordinary',60],['gambler',30]])test(`${kind} rewards fade without font or size jumps at ${fps} fps and still select by collision`,()=>{
  const g=graphicsRecorder(),{world,scene}=app.seedRenderer(g,390,844,true);
  world.events=[];
  if(kind==='starting')world.beginStartingUpgrades();
  else{world.gamblerRewardPending=kind==='gambler';world.beginUpgrade();}
  const rounds=kind==='gambler'?2:1;assert.equal(world.upgradeRoundTotal,rounds);
  for(let round=1;round<=rounds;round++){
    assert.equal(world.choices.length,3);assertRewardEntry(world,scene,g,{fps});
    chooseByContact(world,scene,world.choices.find(choice=>choice.id!=='gambler'));assert.equal(element('#choice-labels').children.length,0);
    advanceScene(scene,world.rewardTiming.rest+.01);assert.equal(world.phase,round<rounds?'transition':'battle');
  }
});

test('both real Boss reward rounds restart their entrance cleanly and stay continuous at selection time',()=>{
  const {g,world,scene}=bossScene();advanceToBoss(world,scene);defeatBoss(world,scene);
  for(let frame=0;world.phase!=='transition'&&frame<1200;frame++)scene.update(0,1000/120);
  assert.equal(world.phase,'transition');assert.equal(world.rewardSelectionsRemaining,2);
  const first=assertRewardEntry(world,scene,g);chooseByContact(world,scene);
  assert.equal(element('#choice-labels').children.length,0);
  for(let frame=0;world.phase!=='transition'&&frame<240;frame++)scene.update(0,1000/120);
  assert.equal(world.phase,'transition');assert.equal(world.rewardSelectionsRemaining,1);
  const second=assertRewardEntry(world,scene,g);
  assert.ok(second.every(node=>!first.includes(node)),'new offer receives fresh labels, with no old fully opaque text');
  chooseByContact(world,scene);advanceScene(scene,world.rewardTiming.rest+.01);assert.equal(world.phase,'battle');
});

test('reward text stays in sync during pause, resume and resize without rebuilding its labels',()=>{
  const g=graphicsRecorder(),{world,scene}=app.seedRenderer(g,390,844,true);
  world.beginUpgrade();advanceScene(scene,.7);
  const nodes=[...element('#choice-labels').children],alphas=nodes.map(node=>node.style.opacity),born=world.choices.map(choice=>choice.born);
  clickAction('pause');advanceScene(scene,.8);
  assert.deepEqual(nodes.map(node=>node.style.opacity),alphas);assert.deepEqual(world.choices.map(choice=>choice.born),born);
  world.resize(844,390);scene.update(0,0);
  assert.deepEqual(element('#choice-labels').children,nodes);assert.deepEqual(nodes.map(node=>node.style.opacity),alphas);
  nodes.forEach((node,i)=>near(parseFloat(node.style.left),world.choices[i].x));
  clickAction('resume');app.advanceUi(.42);waitForChoose(world,scene);advanceScene(scene,.45);
  assert.deepEqual(element('#choice-labels').children,nodes);assert.ok(nodes.every(node=>node.style.opacity==='1'));
  clickAction('pause');scene.update(0,0);const tops=nodes.map(node=>node.style.top);
  advanceScene(scene,.8);assert.deepEqual(nodes.map(node=>node.style.top),tops,'idle float freezes with the game');
  clickAction('resume');app.advanceUi(.42);chooseByContact(world,scene);assert.equal(element('#choice-labels').children.length,0);
});

test('reduced motion retains a continuous reward fade with no idle floating',async()=>{
  await withReloadedEntry({juice:.6,expressions:false},true,fresh=>{
    const g=graphicsRecorder(),{world,scene}=fresh.seedRenderer(g,390,844,true);
    world.beginStartingUpgrades();assertRewardEntry(world,scene,g,{reduced:true});
  });
});

test('reward placement, full player turn and label poses meet both shortened boundaries without a visible jump',async()=>{
  for(const [strength,reduced] of [[.6,false],[0,false],[.6,true]])await withReloadedEntry({juice:strength},reduced,fresh=>{
    const g=graphicsRecorder(),{world,scene}=fresh.seedRenderer(g,390,844,true),p=world.player;
    fresh.setFeedbackStrength(strength);fresh.seedCircle();
    Object.assign(p,{x:80,y:420,vx:0,vy:0,squash:.08,angle:1.1});
    world.beginUpgrade();scene.update(0,0);
    const nodes=[...element('#choice-labels').children],titles=nodes.map(node=>node.children[0]),fonts=titles.map(node=>node.style.fontSize);
    const photo=fresh.recordPlayerPhoto(),epoch=world.feedbackTime;
    const sample=elapsed=>{
      world.step(Math.max(0,epoch+elapsed-world.feedbackTime));photo.calls.length=0;scene.update(0,0);
      const pose=photo.calls.at(-1).pose;
      assert.deepEqual(element('#choice-labels').children,nodes);titles.forEach((title,i)=>assert.equal(title.style.fontSize,fonts[i]));
      return {...pose,labels:nodes.map(node=>({top:parseFloat(node.style.top),alpha:Number(node.style.opacity)}))};
    };
    const joined=(a,b)=>{
      for(const key of ['x','y','r','squash'])assert.ok(Math.abs(a[key]-b[key])<1e-5,`${key} remains continuous`);
      assert.ok(Math.abs(Math.sin(a.roll)-Math.sin(b.roll))<1e-5&&Math.abs(Math.cos(a.roll)-Math.cos(b.roll))<1e-5,'the full turn and ready-state orientation match');
      a.labels.forEach((label,i)=>{near(label.alpha,b.labels[i].alpha);assert.ok(Math.abs(label.top-b.labels[i].top)<1e-5);});
    };
    try{
      const moving=sample(.43);near(moving.roll,2*Math.PI*world.rewardMoveProgress);assert.ok(moving.roll>0&&moving.roll<2*Math.PI);
      clickAction('pause');near(fresh.readRestart().transfer.from.roll,moving.roll);near(fresh.readRestart().transfer.from.r,moving.r);
      fresh.advanceUi(.42);const pausedAt=world.feedbackTime;advanceScene(scene,.3);near(world.feedbackTime,pausedAt);
      clickAction('resume');fresh.advanceUi(.42);const resumed=sample(.43);near(resumed.roll,moving.roll);near(resumed.r,moving.r);
      joined(sample(world.rewardTiming.move-1e-6),sample(world.rewardTiming.move+1e-6));
      const before=sample(world.rewardTiming.transition-1e-6);assert.equal(world.phase,'transition');
      const after=sample(world.rewardTiming.transition+1e-6);assert.equal(world.phase,'choose');joined(before,after);
      assert.ok(after.labels.every(label=>label.alpha===1));near(after.squash,0);
    }finally{photo.restore();fresh.seedCircle();}
  });
});

test('growth acquisition eases only the visible radius and preserves it through pause, resume and resize',()=>{
  const {world,scene}=upgradeRun(),p=world.player,choice=world.choices[0],oldRadius=p.r;
  choice.id='growth';const photo=app.recordPlayerPhoto();
  const radius=()=>{photo.calls.length=0;scene.update(0,0);return photo.calls.at(-1).pose.r;};
  try{
    chooseByContact(world,scene,choice);near(p.r,oldRadius*1.2);
    const first=radius();assert.ok(Math.abs(first-oldRadius)<.002,'the collision applies the physical growth without popping the rendered size');
    advanceScene(scene,.08);const middle=radius();assert.ok(middle>oldRadius&&middle<p.r);
    clickAction('pause');near(app.readRestart().transfer.from.r,middle);app.advanceUi(.42);
    const at=world.feedbackTime;advanceScene(scene,.4);near(world.feedbackTime,at);
    clickAction('resume');app.advanceUi(.42);near(radius(),middle);
    const ratio=radius()/p.r;world.resize(844,390);near(radius()/p.r,ratio);
    advanceScene(scene,.13);near(radius(),p.r);assert.equal(world.phase,'reward');
  }finally{photo.restore();app.setFeedbackStrength(.6);}
});

test('growth at a wall or corner carries the rendered center continuously while the larger collision body fits immediately',()=>{
  for(const side of ['left','top','corner']){
    const {world,scene}=upgradeRun(),p=world.player,choice=world.choices[0],bounds=world.arenaBounds,oldRadius=p.r;
    choice.id='growth';Object.assign(p,{x:side==='top'?world.width/2:bounds.left+p.r,y:side==='left'?world.height/2:bounds.top+p.r,vx:0,vy:0,squash:0,feedbackFreeze:0});
    const distance=p.r+choice.r-.00001,diagonal=side==='corner'?Math.SQRT1_2:1;
    Object.assign(choice,{x:p.x+(side==='top'?0:distance*diagonal),y:p.y+(side==='left'?0:distance*diagonal)});
    const photo=app.recordPlayerPhoto(),pose=()=>{photo.calls.length=0;scene.update(0,0);return photo.calls.at(-1).pose;};
    try{
      const before=pose();world.step(1e-7);const selected=pose();assert.equal(world.phase,'reward');
      near(p.r,oldRadius*1.2);assert.ok(p.x>=bounds.left+p.r&&p.y>=bounds.top+p.r,'the actual collision body fits on the selection frame');
      for(const key of ['x','y','r'])near(selected[key],before[key]);
      world.step(1e-7);const after=pose();for(const key of ['x','y','r'])near(after[key],selected[key]);
      world.step(.1);const middle=pose();assert.ok(middle.r>oldRadius&&middle.r<p.r);
      if(side!=='top')assert.ok(middle.x>before.x&&middle.x<p.x);
      if(side!=='left')assert.ok(middle.y>before.y&&middle.y<p.y);
      clickAction('pause');const from=app.readRestart().transfer.from;for(const key of ['x','y','r'])near(from[key],middle[key]);
      app.advanceUi(.42);clickAction('resume');app.advanceUi(.42);const resumed=pose();for(const key of ['x','y','r'])near(resumed[key],middle[key]);
      const carry={x:(middle.x-p.x)/world.unit,y:(middle.y-p.y)/world.unit,r:middle.r/p.r};
      world.resize(844,390);const resized=pose();near((resized.x-p.x)/world.unit,carry.x);near((resized.y-p.y)/world.unit,carry.y);near(resized.r/p.r,carry.r);
      world.step(.100001);const final=pose();for(const key of ['x','y','r'])near(final[key],p[key]);
    }finally{photo.restore();app.setFeedbackStrength(.6);}
  }
});

test('a fast player resumes flight stretch smoothly at the exact reward-to-battle boundary',async()=>{
  for(const [strength,reduced] of [[.6,false],[0,false],[.6,true]])await withReloadedEntry({juice:strength},reduced,fresh=>{
    const {world,scene}=upgradeRun(fresh,{strength}),choice=world.choices.find(c=>c.id!=='growth'),p=world.player;
    const photo=fresh.recordPlayerPhoto();
    const pose=()=>{photo.calls.length=0;scene.update(0,0);return photo.calls.at(-1).pose;};
    try{
      chooseByContact(world,scene,choice);world.step(world.rewardTiming.rest-world.phaseTime-1e-6);
      Object.assign(p,{x:world.width/2,y:world.height/2,vx:world.baseSpeed*.7,vy:0,squash:0});
      const before=pose();near(before.flightStretch,0);assert.equal(world.phase,'reward');
      world.step(2e-6);const after=pose();assert.equal(world.phase,'battle');
      assert.ok(after.flightStretch<1e-8,'the first battle pose cannot jump to full velocity stretch');
      assert.ok(Math.hypot(after.x-before.x,after.y-before.y)<world.baseSpeed*2e-6+.00001,'only the two microseconds of physical travel move the player');near(after.r,before.r);
      world.step(.1);const middle=pose();
      if(strength&&!reduced)assert.ok(middle.flightStretch>0&&middle.flightStretch<.12*strength);else near(middle.flightStretch,0);
      world.step(.11);const completed=pose();
      near(completed.flightStretch,reduced?0:.12*Math.min(1,Math.hypot(p.vx,p.vy)/world.baseSpeed)*strength);
    }finally{photo.restore();}
  });
});

test('the final Boss collision sprays proportionally more enemy shards from its actual contact with the incoming direction',t=>{
  t.after(()=>app.setFeedbackStrength(.6));
  for(const strength of [.6,1]){
    const {world,scene,events}=finalBossCollision(app,strength);
    const kills=events.filter(event=>event.type==='bossDefeated');assert.equal(kills.length,1);
    const event=kills[0],shards=scene.effects.filter(effect=>effect.type==='shard');
    near(event.r/world.unit,2);near(event.referenceRadius/world.unit,.8);
    const ordinary=impactShards({...event,type:'kill',r:event.referenceRadius},0xe88c72,{strength});
    assert.equal(shards.length,Math.round(ordinary.length*(event.r/event.referenceRadius)));
    assert.ok(shards.length>ordinary.length);
    near(event.nx,0);near(event.ny,-1);near(event.impactVx,0);near(event.impactVy,-world.baseSpeed);
    assert.ok(event.contactY>event.y,'contact is on the lower side hit by the upward launch');
    for(const shard of shards){
      near(shard.x,event.contactX);near(shard.y,event.contactY);assert.ok(shard.vy<0,'all fragments fan along the killing hit');
      assert.equal(shard.color,0xe88c72);assert.ok(shard.total>=.5&&shard.total<=.62);
    }
    assert.ok(shards.some(shard=>shard.vx<0)&&shards.some(shard=>shard.vx>0));
    scene.update(0,0);assert.equal(scene.effects.filter(effect=>effect.type==='shard').length,shards.length,'each defeat emits only one spray');
    advanceScene(scene,.65);assert.equal(scene.effects.filter(effect=>effect.type==='shard').length,0,'victory slow motion does not retain particles indefinitely');
  }
});
test('endless appearance unlocks at 233333 without interrupting battle or Boss and ignores demo scores',t=>{
  const prior=saved.get('qiuqiule-appearance-state');
  t.after(()=>{app.seedCircle();if(prior===undefined)saved.delete('qiuqiule-appearance-state');else saved.set('qiuqiule-appearance-state',prior);});
  for(const phase of ['battle','boss']){
    const {world}=controlRun();app.seedEndless();app.seedCircle();app.seedAppearanceState();
    if(phase==='boss'){world.stage=5;world.beginBoss();world.phase='boss';world.events=[];}
    world.score=233332;app.updateScoreHud();assert.equal(app.readAppearancePresentation().state.bigEyeUnlocked,false);
    world.score=233333;app.updateScoreHud();
    const state=app.readAppearancePresentation().state;
    assert.equal(state.bigEyeUnlocked,true);assert.equal(state.pendingUnlock,true);assert.equal(state.selected,'original');
    assert.equal(app.readRestart().paused,false);assert.equal(app.readRestart().modal,null);assert.equal(world.phase,phase);
    assert.equal(app.readPlayerShape().skinUnlock,null,'live scoring saves ownership but does not interrupt the current run');
    assert.equal(JSON.parse(saved.get('qiuqiule-appearance-state')).pendingUnlock,true);
    app.updateScoreHud();assert.deepEqual(app.readAppearancePresentation().state,state,'repeated HUD frames cannot re-award or auto-equip');
  }
  app.seedRenderer(graphicsRecorder());app.seedCircle();app.seedAppearanceState();app.runFeedbackDemo('steer');
  app.readRestart().world.score=999999;app.updateScoreHud();app.grantAppearanceForTest();
  assert.equal(app.readAppearancePresentation().state.bigEyeUnlocked,false,'trial scenes do not alter ownership');
});

test('v7.9 endless appearance reward uses the animated unlock route and returns to the equipped style only after dismissal',t=>{
  const {world}=controlRun();app.seedEndless();app.seedCircle();
  app.seedAppearanceState();
  const original=app.readPlayerShape().playerContour,ink=app.playerInk();
  t.after(()=>{app.seedCircle();app.setPlayerInk('#252720');});
  world.score=233333;app.updateScoreHud();world.phase='over';app.showResultForTest();
  let state=app.readRestart(),reward=app.readPlayerShape().skinUnlock;
  assert.equal(state.modal,'skin-unlock');assert.equal(state.paused,true);assert.equal(state.result,null);
  assert.deepEqual(reward.queue,[{kind:'appearance',id:'big-eye'}]);assert.equal(reward.ready,false);
  clickAction('close');assert.equal(app.readPlayerShape().skinUnlock.phase,'enter');assert.equal(app.readAppearancePresentation().state.pendingUnlock,true);
  app.advanceUi(.8);assert.equal(app.readPlayerShape().skinUnlock.ready,false);
  const middle=app.readAppearancePresentation().layers;
  assert.ok(middle.some(layer=>layer.id==='big-eye'&&layer.weight>0&&layer.weight<1),'appearance fades into the shared reveal animation');
  app.advanceUi(.86);assert.equal(app.readPlayerShape().skinUnlock.ready,true);
  assert.ok(app.readAppearancePresentation().layers.some(layer=>layer.id==='big-eye'&&layer.weight===1));
  assert.equal(app.readAppearancePresentation().state.selected,'original','preview never silently equips the reward');
  assert.equal(app.playerInk(),ink,'reward preview never overwrites the saved player color');
  clickAction('close');
  assert.equal(app.readPlayerShape().skinUnlock.phase,'leave');assert.ok(app.readRestart().result);
  assert.equal(app.readAppearancePresentation().state.pendingUnlock,false);
  assert.equal(JSON.parse(saved.get('qiuqiule-appearance-state')).pendingUnlock,false);
  app.advanceUi(.62);
  assert.equal(app.readPlayerShape().skinUnlock,null);assert.equal(app.readAppearancePresentation().override,null);
  assert.equal(app.readRestart().uiAnchor,'over');assertSameContour(app.readPlayerShape().active,original);
  assert.ok(app.readAppearancePresentation().layers.every(layer=>layer.id==='original'));
  const earned={...app.readAppearancePresentation().state};
  const next=controlRun().world;app.seedAppearanceState(earned);next.score=300000;next.phase='over';app.showResultForTest();
  assert.equal(app.readPlayerShape().skinUnlock,null,'later qualifying runs never replay an acknowledged unlock');
  assert.ok(app.readRestart().result);
});

test('a queued appearance and three stage star trails require one ready acknowledgement each and restore the equipped photo and star trail',t=>{
  const stored=new Map(saved),{world}=controlRun();app.seedEndless();app.seedCircle();
  app.seedStarTrails({unlocked:1,selected:'triangle'});
  const photo=app.recordCompositePhotos(true),image=app.readAppearance().appearance,originalInk=app.playerInk();
  t.after(()=>{photo.restore();app.seedCircle();document.hidden=false;saved.clear();for(const [key,value]of stored)saved.set(key,value);});
  Object.assign(world,{score:233333,stage:20,maxStage:20});app.updateScoreHud();
  assert.equal(app.readRestart().modal,null);assert.deepEqual(app.readStarTrails().state.pendingUnlocks,['square','diamond','snowflake']);
  world.phase='over';app.showResultForTest();
  const reward=app.readPlayerShape().skinUnlock,queue=[{kind:'appearance',id:'big-eye'},...['square','diamond','snowflake'].map(id=>({kind:'star-trail',id}))];
  assert.deepEqual(reward.queue,queue);assert.equal(reward.index,0);assert.equal(app.readRestart().result,null);
  const escape=()=>{for(const handler of listeners.get('keydown'))handler({key:'Escape',preventDefault(){}});};
  clickAction('close');escape();assert.equal(reward.index,0);assert.equal(app.readAppearancePresentation().state.pendingUnlock,true);
  documentPointer('pointerdown');documentPointer('click');clickRestart();clickAction('home');
  assert.equal(app.readRestart().world,world);assert.equal(app.readPlayerShape().skinUnlock,reward);assert.equal(app.readRestart().result,null,'background and result controls cannot bypass queued rewards');
  app.advanceUi(.8);const frozen={elapsed:reward.elapsed,pose:app.sourcePose()};
  document.hidden=true;for(const handler of listeners.get('visibilitychange'))handler();app.advanceUi(5);
  assert.equal(reward.elapsed,frozen.elapsed);assert.deepEqual(app.sourcePose(),frozen.pose);assert.equal(reward.ready,false);
  document.hidden=false;for(const handler of listeners.get('visibilitychange'))handler();app.advanceUi(.86);
  for(let index=0;index<queue.length;index++){
    assert.equal(reward.index,index);assert.equal(reward.ready,true);assert.equal(app.readRestart().result,null);assert.equal(app.readRestart().controlFlight,null);
    assert.equal(element('#skin-unlock-title').dataset.kind,queue[index].kind);
    assert.equal(app.readAppearancePresentation().state.selected,'custom');assert.equal(app.readStarTrails().state.selected,'triangle');
    assert.equal(app.readAppearance().appearance,image);assert.equal(app.playerInk(),originalInk);
    if(queue[index].kind==='star-trail')assert.deepEqual(app.readStarTrails().layers,[{id:queue[index].id,weight:1}]);
    clickAction('close');
    const pending=JSON.parse(saved.get('qiuqiule-star-trails')).pendingUnlocks;
    assert.deepEqual(pending,queue.slice(Math.max(1,index+1)).map(item=>item.id));
    assert.equal(JSON.parse(saved.get('qiuqiule-appearance-state')).pendingUnlock,false);
    if(index+1<queue.length){
      assert.equal(reward.phase,'switch');assert.equal(reward.index,index+1);assert.equal(reward.ready,false);assert.equal(app.readRestart().result,null);
      clickAction('close');escape();assert.equal(reward.index,index+1,'rapid repeated input cannot acknowledge an unshown reward');
      app.advanceUi(.18);assert.equal(reward.ready,false);assert.equal(app.readRestart().result,null);
      app.advanceUi(.18);assert.equal(reward.ready,true);
    }
  }
  assert.equal(reward.phase,'leave');assert.ok(app.readRestart().result);
  const preview=element('#ui-star-trails'),opacity=()=>Math.max(0,...preview.querySelectorAll('path').map(path=>Number(path.getAttribute('opacity'))));
  const initialAlpha=opacity();assert.ok(initialAlpha>0);
  app.advanceUi(.31);near(app.readStarTrails().layers[0].weight,.5);
  assert.ok(Math.abs(opacity()/initialAlpha-.5)<.001,'the reward preview fades halfway during the return flight');
  assert.equal(app.readStarTrails().state.selected,'triangle','returning cannot equip the newly awarded preview');
  app.advanceUi(.30);assert.ok(opacity()<initialAlpha*.002,'the last visible reward frame is already almost transparent');
  app.advanceUi(.01);
  assert.equal(app.readPlayerShape().skinUnlock,null);assert.equal(app.readRestart().modal,'over');assert.equal(preview.hidden,true);
  assert.deepEqual(app.readStarTrails().layers,[{id:'triangle',weight:1}]);
  assert.ok(app.readAppearancePresentation().layers.every(layer=>layer.id==='custom'));assert.equal(app.readAppearance().appearance,image);
  assert.deepEqual(app.readStarTrails().state.pendingUnlocks,[]);assert.equal(app.readStarTrails().state.selected,'triangle');
});

test('reloading after one star trail acknowledgement preserves every unseen reward and never replays the acknowledged item',async t=>{
  const stored=new Map(saved),{world}=controlRun();app.seedEndless();app.seedCircle();app.seedStarTrails();
  t.after(()=>{app.seedCircle();saved.clear();for(const [key,value]of stored)saved.set(key,value);});
  world.stage=world.maxStage=15;app.updateScoreHud();world.phase='over';app.showResultForTest();app.advanceUi(1.65);clickAction('close');
  const pending=['square','diamond'];assert.deepEqual(app.readStarTrails().state.pendingUnlocks,pending);
  assert.equal(app.readRestart().result,null);assert.equal(app.readPlayerShape().skinUnlock.ready,false);
  await withReloadedEntry(null,false,fresh=>{
    const restored=fresh.readStarTrails().state;assert.equal(restored.unlocked,3);assert.deepEqual(restored.pendingUnlocks,pending);
    const {world:next}=fresh.seedRenderer(graphicsRecorder(),390,844,true);fresh.seedCircle();fresh.seedStarTrails(restored);fresh.seedEndless({maxStage:15});
    next.phase='over';fresh.showResultForTest();
    assert.deepEqual(fresh.readPlayerShape().skinUnlock.queue,pending.map(id=>({kind:'star-trail',id})));
    assert.equal(fresh.readPlayerShape().skinUnlock.ready,false);assert.equal(fresh.readRestart().result,null);
    assert.deepEqual(JSON.parse(saved.get('qiuqiule-star-trails')).pendingUnlocks,pending,'restoring or showing a reward never acknowledges it');
  });
});

test('star trail reward transitions keep one visible player through rotation and reduced motion without advancing or replacing the queue',async()=>{
  for(const reduced of [false,true])await withReloadedEntry({juice:.6},reduced,fresh=>{
    const originalWindow={width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio,add:window.addEventListener};let resize;
    window.innerWidth=390;window.innerHeight=844;window.devicePixelRatio=1;
    window.addEventListener=(type,handler)=>{if(type==='resize')resize=handler;else originalWindow.add(type,handler);};
    const g=graphicsRecorder(),{world,scene}=fresh.seedRenderer(g,390,844,true);fresh.seedCircle();fresh.seedEndless();fresh.seedStarTrails({unlocked:1,selected:'triangle'});
    const photos=fresh.recordCompositePhotos(true),image=fresh.readAppearance().appearance,pointer=inputCanvas(390,844,fresh);
    try{
      fresh.mountSceneBoundary(pointer.canvas,g);world.stage=world.maxStage=15;fresh.updateScoreHud();world.phase='over';fresh.showResultForTest();
      const reward=fresh.readPlayerShape().skinUnlock,expected=reward.queue.map(item=>item.id),time=world.time;
      fresh.advanceUi(reduced?.56:1.65);assert.equal(reward.ready,true);
      const before=fresh.sourcePose();clickAction('close');const after=fresh.sourcePose();
      for(const key of ['x','y','r'])near(after[key],before[key]);
      assert.equal(reward.phase,'switch');assert.equal(reward.index,1);assert.equal(reward.ready,false);
      fresh.advanceUi(reduced?.1:.18);const age=reward.elapsed;
      window.innerWidth=844;window.innerHeight=390;resize();fresh.advanceUi(0);
      assert.equal(fresh.readPlayerShape().skinUnlock,reward);assert.equal(reward.elapsed,age);assert.deepEqual(reward.queue.map(item=>item.id),expected);
      assert.equal(element('#ui-ball').hidden,false);near(Number(element('#skin-unlock-panel').style.opacity),1);
      assert.ok(['x','y','r'].every(key=>Number.isFinite(fresh.sourcePose()[key])));assert.equal(fresh.readRestart().result,null);
      assert.equal(fresh.readAppearance().appearance,image);assert.equal(fresh.readStarTrails().state.selected,'triangle');assert.equal(world.time,time);
      fresh.advanceUi(reduced?.1:.18);assert.equal(reward.ready,true);clickAction('close');fresh.advanceUi(reduced?.28:.62);
      assert.equal(fresh.readPlayerShape().skinUnlock,null);assert.equal(fresh.readRestart().modal,'over');assert.equal(fresh.readAppearance().appearance,image);
      assert.deepEqual(fresh.readStarTrails().layers,[{id:'triangle',weight:1}]);assert.equal(world.time,time);
    }finally{photos.restore();window.innerWidth=originalWindow.width;window.innerHeight=originalWindow.height;window.devicePixelRatio=originalWindow.dpr;window.addEventListener=originalWindow.add;}
  });
});

test('switching original, Big Eye and custom retains the saved image and reuses its decoded photo until explicit replacement',async t=>{
  const stored=new Map(saved),originalImage=globalThis.Image;let decodes=0;
  globalThis.Image=class{async decode(){decodes++;}};
  app.seedRenderer(graphicsRecorder());app.seedCircle();app.seedAppearanceState({bigEyeUnlocked:true});app.bindPhotoRenderer({setImage(){},hide(){}});
  t.after(()=>{globalThis.Image=originalImage;app.bindPhotoRenderer(null);app.seedCircle();saved.clear();for(const [key,value]of stored)saved.set(key,value);});
  const firstUrl='data:image/png;base64,Zmlyc3Q=';await app.applyAppearance(firstUrl,true);const image=app.readAppearance().appearance;
  for(const id of ['original','custom','big-eye','original','custom']){
    assert.equal(app.chooseAppearanceForTest(id),true);app.advanceSkin(.3);
    assert.equal(app.readAppearance().appearance,image);assert.equal(app.readAppearance().appearanceUrl,firstUrl);
    assert.equal(await loadAppearance(),firstUrl);assert.equal(app.readAppearancePresentation().state.selected,id);assert.equal(decodes,1);
  }
  const secondUrl='data:image/png;base64,c2Vjb25k';await app.applyAppearance(secondUrl,true);
  assert.notEqual(app.readAppearance().appearance,image);assert.equal(decodes,2);assert.equal(await loadAppearance(),secondUrl);
  assert.equal(app.readAppearancePresentation().state.selected,'custom');
  await withReloadedEntry(null,false,async fresh=>{
    fresh.bindPhotoRenderer({setImage(){},hide(){}});await fresh.applyAppearance(await loadAppearance());
    assert.equal(fresh.readAppearancePresentation().state.selected,'custom');assert.equal(fresh.readAppearance().appearanceUrl,secondUrl);
    assert.ok(fresh.readAppearancePresentation().layers.every(layer=>layer.id==='custom'));
  });
});

test('v7.10 appearance fades preserve preview motion and restore the pre-Big Eye player color',t=>{
  app.seedRenderer(graphicsRecorder());app.seedCircle();app.seedAppearanceState({bigEyeUnlocked:true});
  const oldSettings=app.readFeedbackSettings();app.setPlayerInk('#405060');
  t.after(()=>{app.seedCircle();app.setPlayerInk(oldSettings.player);});
  const before=app.seedWardrobePresentation(.73),homeBefore={...app.readHome().player};
  assert.equal(app.chooseAppearanceForTest('big-eye'),true);
  const presentation=app.readAppearancePresentation();
  assert.equal(presentation.wardrobeTime,.73);assert.deepEqual(app.sourcePose(),before);
  assert.deepEqual(app.readHome().player,homeBefore,'selecting an appearance never resets motion or velocity');
  assert.equal(app.playerInk(),0xb8db8a);
  const settings=app.readFeedbackSettings();assert.equal(settings.enemy,oldSettings.enemy);assert.equal(settings.bg,oldSettings.bg);
  assert.equal(presentation.state.selected,'big-eye');assert.ok(presentation.tween);
  app.advanceSkin(.14);const middle=app.readAppearancePresentation().layers;
  assert.ok(middle.some(layer=>layer.id==='original'&&layer.weight>0));assert.ok(middle.some(layer=>layer.id==='big-eye'&&layer.weight>0));
  near(middle.reduce((sum,layer)=>sum+layer.weight,0),1);
  const halfway=app.sourcePose();assert.equal(app.chooseAppearanceForTest('original'),true);
  assert.deepEqual(app.sourcePose(),halfway,'rapid replacement starts from the visible pose');
  near(app.readAppearancePresentation().layers.reduce((sum,layer)=>sum+layer.weight,0),1);
  app.advanceSkin(.28);assert.equal(app.readAppearancePresentation().tween,null);
  assert.ok(app.readAppearancePresentation().layers.every(layer=>layer.id==='original'));
  assert.equal(app.playerInk(),0x405060,'leaving Big Eye restores the exact color captured before equipping it');
  app.advanceUi(.05);near(app.readAppearancePresentation().wardrobeTime,.78);
  assert.notDeepEqual(app.sourcePose(),before,'the existing bounce clock continues through the change');
});

test('v11.3.1 selecting a saved custom photo fades in over the existing original or Big Eye appearance',async t=>{
  const stored=new Map(saved),originalImage=globalThis.Image,oldInk=app.playerInk();let decodes=0;
  globalThis.Image=class{async decode(){decodes++;}};
  t.after(()=>{globalThis.Image=originalImage;app.seedCircle();app.setPlayerInk('#'+oldInk.toString(16).padStart(6,'0'));saved.clear();for(const [key,value]of stored)saved.set(key,value);});
  for(const source of ['original','big-eye']){
    app.seedRenderer(graphicsRecorder());app.seedCircle();app.setPlayerInk('#405060');
    const photos=app.recordCompositePhotos(true);
    try{
      app.seedAppearanceState({selected:'original',bigEyeUnlocked:true},{hasImage:true});
      const url='data:image/png;base64,c2F2ZWQ=';await app.applyAppearance(url,true);
      const image=app.readAppearance().appearance,decodeCount=decodes;
      app.chooseAppearanceForTest(source);app.advanceSkin(.28);
      const pose=app.seedWardrobePresentation(.73),homeBefore={...app.readHome().player};
      assert.equal(app.chooseAppearanceForTest('custom'),true);
      assert.ok(app.readAppearancePresentation().tween,'the saved photo takes the same fade route as the other appearances');
      assert.deepEqual(app.readAppearancePresentation().layers.map(({id,weight})=>({id,weight})),[{id:source,weight:1}]);
      app.paintUiForTest(pose);assert.equal(photos.main.length,0,'the first frame still shows the prior appearance without a photo flash');
      assert.equal(uiNode(source==='original'?'.ui-eyes':'.ui-big-eye').style.display,'');
      app.advanceSkin(.14);app.paintUiForTest(pose);
      near(photos.main.at(-1).options.alpha,.5);assert.equal(photos.main.at(-1).options.baseColor,0x405060);
      near(app.readAppearancePresentation().layers.find(layer=>layer.id===source).weight,.5);
      app.advanceSkin(.14);app.paintUiForTest(pose);
      near(photos.main.at(-1).options.alpha,1);assert.equal(app.readAppearancePresentation().tween,null);
      assert.deepEqual(app.readAppearancePresentation().layers.map(({id,weight})=>({id,weight})),[{id:'custom',weight:1}]);
      assert.deepEqual(app.sourcePose(),pose);assert.deepEqual(app.readHome().player,homeBefore);
      near(app.readAppearancePresentation().wardrobeTime,.73);
      assert.equal(app.readAppearance().appearance,image);assert.equal(decodes,decodeCount,'equipping reuses the already decoded saved image');
      assert.equal(await loadAppearance(),url);assert.equal(app.playerInk(),0x405060);
    }finally{photos.restore();app.seedCircle();}
  }
});

test('v11.3.1 a rapid saved-photo fade reversal starts from the visible mixture without a flash',async t=>{
  const stored=new Map(saved),originalImage=globalThis.Image,oldInk=app.playerInk();let decodes=0;
  globalThis.Image=class{async decode(){decodes++;}};
  app.seedRenderer(graphicsRecorder());app.seedCircle();app.setPlayerInk('#405060');
  const photos=app.recordCompositePhotos(true);
  t.after(()=>{photos.restore();globalThis.Image=originalImage;app.seedCircle();app.setPlayerInk('#'+oldInk.toString(16).padStart(6,'0'));saved.clear();for(const [key,value]of stored)saved.set(key,value);});
  app.seedAppearanceState({selected:'original',bigEyeUnlocked:true},{hasImage:true});
  await app.applyAppearance('data:image/png;base64,c2F2ZWQ=',true);
  const image=app.readAppearance().appearance;
  app.chooseAppearanceForTest('original');app.advanceSkin(.28);
  const pose=app.seedWardrobePresentation(.4);
  app.chooseAppearanceForTest('custom');app.advanceSkin(.1);app.paintUiForTest(pose);
  const first=app.readAppearancePresentation().layers.map(layer=>({...layer})),alpha=photos.main.at(-1).options.alpha;
  assert.ok(alpha>0&&alpha<1);
  app.chooseAppearanceForTest('big-eye');app.paintUiForTest(pose);
  assert.deepEqual(app.readAppearancePresentation().layers,first);near(photos.main.at(-1).options.alpha,alpha);
  app.advanceSkin(.08);const second=app.readAppearancePresentation().layers.map(layer=>({...layer}));
  app.chooseAppearanceForTest('custom');assert.deepEqual(app.readAppearancePresentation().layers,second);
  const tween=app.readAppearancePresentation().tween;
  assert.equal(app.chooseAppearanceForTest('custom'),false);assert.equal(app.readAppearancePresentation().tween,tween,'reselecting does not restart the active fade');
  app.advanceSkin(.28);app.paintUiForTest(pose);near(photos.main.at(-1).options.alpha,1);
  assert.equal(app.readAppearance().appearance,image);assert.equal(decodes,1);assert.deepEqual(app.sourcePose(),pose);
});

test('v11.3.1 a saved-photo fade waits for slow startup decoding before consuming its transition time',async t=>{
  const stored=new Map(saved),originalImage=globalThis.Image;let finishDecode,decodes=0;
  globalThis.Image=class{decode(){decodes++;return new Promise(resolve=>finishDecode=resolve);}};
  app.seedRenderer(graphicsRecorder());app.seedCircle();const photos=app.recordCompositePhotos(true);
  t.after(()=>{photos.restore();globalThis.Image=originalImage;app.seedCircle();saved.clear();for(const [key,value]of stored)saved.set(key,value);});
  await app.applyAppearance(null);app.seedAppearanceState({selected:'original',bigEyeUnlocked:true},{hasImage:true});
  const pose=app.seedWardrobePresentation(.4),url='data:image/png;base64,c2F2ZWQ=';
  saved.set('qiuqiule-appearance',JSON.stringify({version:1,image:url}));
  const pending=app.hydrateAppearanceForTest(url);
  assert.equal(app.imageIsLoadingForTest(),true);assert.equal(app.chooseAppearanceForTest('custom'),true);
  app.advanceSkin(.5);app.paintUiForTest(pose);
  near(app.readAppearancePresentation().tween.elapsed,0);
  assert.deepEqual(app.readAppearancePresentation().layers.map(({id,weight})=>({id,weight})),[{id:'original',weight:1}]);
  assert.equal(photos.main.length,0,'waiting leaves the old appearance fully visible');
  finishDecode();await pending;app.paintUiForTest(pose);
  assert.equal(app.imageIsLoadingForTest(),false);assert.equal(photos.main.length,0,'decoding does not skip the first fade frame');
  app.advanceSkin(.14);app.paintUiForTest(pose);near(photos.main.at(-1).options.alpha,.5);
  app.advanceSkin(.14);app.paintUiForTest(pose);near(photos.main.at(-1).options.alpha,1);
  assert.equal(app.readAppearancePresentation().tween,null);assert.equal(app.readAppearance().appearanceUrl,url);assert.equal(decodes,1);
  assert.deepEqual(app.sourcePose(),pose);assert.equal(await loadAppearance(),url);
});

test('v7.9 wardrobe back consumes the gallery navigation before any ball transfer',t=>{
  app.seedRenderer(graphicsRecorder());app.seedCircle();app.seedWardrobePresentation(.4);
  const calls=[],restore=app.bindWardrobeControls({update:dt=>calls.push(['update',dt]),back:()=>{calls.push(['back']);return true;},cancelInteraction:()=>calls.push(['cancel'])});
  t.after(()=>{restore();app.seedCircle();});
  const before=app.sourcePose();clickAction('close');
  assert.equal(app.readRestart().modal,'wardrobe');assert.equal(app.readRestart().transfer,null);assert.deepEqual(app.sourcePose(),before);
  assert.deepEqual(calls,[['back']]);app.advanceSkin(.05);app.advanceUi(.05);
  assert.ok(calls.some(call=>call[0]==='update'&&call[1]===.05));near(app.readAppearancePresentation().wardrobeTime,.45);
});


test('v7.9 Big Eye renders one large circular pupil without expressions and never changes collision geometry',t=>{
  t.after(()=>{app.seedCircle();app.setPlayerInk('#252720');app.setExpressionEnabled(false);});
  for(const mode of ['home','endless']){
    const g=graphicsRecorder(),{scene,active,player,pointer}=pullScene(mode,g);
    app.seedCircle();
    app.seedAppearanceState({selected:'big-eye',bigEyeUnlocked:true});app.setPlayerInk('#b8db8a');app.setExpressionEnabled(true);
    const physical={x:player.x,y:player.y,r:player.r,mass:player.mass,density:player.density,vx:player.vx,vy:player.vy};
    scene.update(0,0);
    let pupils=g.shapes.filter(shape=>shape.type==='circle'&&shape.color===0x000000&&Math.abs(shape.r-player.r/1.95)<1e-6);
    assert.equal(pupils.length,1,mode+' has exactly one black round pupil');
    assert.equal(eyeShapes(g).length,0,'normal expressive eyes must not be layered over the new appearance');
    const start={x:player.x,y:player.y};
    pointer('pointerdown',start.x,start.y);pointer('pointermove',start.x+active.maxPull,start.y);scene.update(0,0);
    pupils=g.shapes.filter(shape=>shape.type==='circle'&&shape.color===0x000000&&Math.abs(shape.r-player.r/1.95)<1e-6);
    assert.equal(pupils.length,1,mode+' keeps the same round pupil while fully pulling');
    assert.ok(pupils[0].x<player.x-player.r*.35,'full drag looks toward the launch side with increased displacement');
    assert.equal(g.shapes.filter(shape=>shape.type==='ellipse'&&shape.color===0x252720).length,0,'pulling never creates normal paired eyes');
    assert.deepEqual({x:player.x,y:player.y,r:player.r,mass:player.mass,density:player.density,vx:player.vx,vy:player.vy},physical);
    pointer('pointercancel');
  }
});

test('v7.9 transparent custom photos retain their captured base color throughout a Big Eye crossfade',t=>{
  const g=graphicsRecorder(),{home}=app.seedRenderer(g);app.seedCircle();
  const oldInk=app.setPlayerInk('#405060'),photos=app.recordCompositePhotos(true);
  app.seedAppearanceState({selected:'custom',bigEyeUnlocked:true},{hasImage:true});
  const image=app.readAppearance().appearance,pose={x:100,y:200,r:30,squash:0};
  t.after(()=>{photos.restore();app.seedCircle();app.setPlayerInk(oldInk);});
  app.paintUiForTest(pose);assert.equal(photos.main.at(-1).options.baseColor,0x405060);
  assert.equal(app.chooseAppearanceForTest('big-eye'),true);assert.equal(app.playerInk(),0xb8db8a);
  for(const step of [0,.14]){
    app.advanceSkin(step);
    app.paintUiForTest(pose);
    assert.equal(photos.main.at(-1).options.baseColor,0x405060,'the old UI photo cannot immediately adopt the new green base');
    app.drawPlayerForTest(g,home.player,app.playerInk());
    assert.equal(photos.main.at(-1).options.baseColor,0x405060,'the canvas photo uses the same captured old base during a menu transfer');
    assert.equal(app.readAppearance().appearance,image,'crossfading does not replace or decode the cached image');
  }
  near(photos.main.at(-1).options.alpha,.5);
  app.advanceSkin(.14);const calls=photos.main.length;
  app.paintUiForTest(pose);app.drawPlayerForTest(g,home.player,app.playerInk());
  assert.equal(photos.main.length,calls,'the completed fade stops drawing the old photo');
});


test('v7.10 Big Eye keeps a visible same-hue comet and seven-point aim guide in the actual battle and Boss scene',t=>{
  const previous=app.readFeedbackSettings();
  t.after(()=>{app.seedCircle();app.setPlayerInk(previous.player);app.setFeedbackStrength(previous.juice);});
  for(const phase of ['battle','boss']){
    const {world,scene,g,pointer}=controlRun(),p=world.player;
    app.seedCircle();app.seedAppearanceState({selected:'big-eye',bigEyeUnlocked:true});app.setPlayerInk('#b8db8a');
    if(phase==='boss'){world.stage=5;world.beginBoss();world.phase='boss';world.events=[];}
    const b=world.arenaBounds;
    Object.assign(p,{x:b.left+40,y:b.bottom-p.r-20,vx:world.unit*35,vy:0,feedbackFreeze:0});
    advanceScene(scene,.12);
    const ink=app.feedbackInk(),trail=scene.cometTrails.entries.get(p);
    assert.notEqual(ink,app.playerInk(),'the light green body must not make low-opacity feedback disappear against a light background');
    assert.equal(trail.active,true);assert.ok(trail.points.length>4);
    const ribbons=g.shapes.filter(shape=>shape.type==='path'&&shape.color===ink&&shape.alpha>0&&shape.alpha<1&&shape.points.length>=4);
    assert.equal(ribbons.length,9,'the existing nine-band comet reaches the actual renderer for Big Eye');
    const start={x:p.x,y:p.y},physical={vx:p.vx,vy:p.vy,r:p.r,mass:p.mass};
    pointer('pointerdown',start.x,start.y);pointer('pointermove',start.x,start.y+world.maxPull);scene.update(0,0);
    const dots=g.shapes.filter(shape=>shape.type==='circle'&&shape.r===1.7);
    assert.equal(dots.length,7);assert.ok(dots.every(dot=>dot.color===0x252720&&dot.alpha>0));
    for(const [i,dot]of dots.entries()){near(dot.x,p.x);near(dot.y,p.y-p.r-12-(i+1)*16);}
    const arrow=g.shapes.find(shape=>shape.type==='stroke'&&shape.width===1.4);
    assert.ok(arrow);assert.equal(arrow.color,0x252720);near(arrow.points[1].x,dots[6].x);near(arrow.points[1].y,dots[6].y);
    assert.deepEqual({vx:p.vx,vy:p.vy,r:p.r,mass:p.mass},physical,'contrast repair does not alter launch or collision properties');
    pointer('pointercancel');
  }
});

test('v7.10 leaving Big Eye through a new custom photo restores color without replacing unrelated settings',async t=>{
  const originalImage=globalThis.Image,previous=app.readFeedbackSettings(),stored=new Map(['qiuqiule-settings','qiuqiule-appearance-state','qiuqiule-appearance'].map(key=>[key,saved.get(key)]));
  globalThis.Image=class{async decode(){}};
  app.seedRenderer(graphicsRecorder());app.seedCircle();app.seedAppearanceState({bigEyeUnlocked:true});
  app.bindPhotoRenderer({hide(){},setImage(){}});app.setPlayerInk('#405060');
  t.after(()=>{globalThis.Image=originalImage;app.bindPhotoRenderer(null);app.seedCircle();app.setPlayerInk(previous.player);for(const [key,value]of stored)value===undefined?saved.delete(key):saved.set(key,value);});
  assert.equal(app.chooseAppearanceForTest('big-eye'),true);
  assert.equal(app.chooseAppearanceForTest('big-eye'),false,'reselecting the active appearance cannot overwrite its saved prior color');
  assert.equal(app.readAppearancePresentation().state.previousPlayerColor,'#405060');
  app.setPlayerInk('#123456');
  await app.applyAppearance('data:image/png;base64,bmV3',true);
  assert.equal(app.readAppearancePresentation().state.selected,'custom');assert.equal(app.playerInk(),0x405060);
  assert.equal(JSON.parse(saved.get('qiuqiule-settings')).player,'#405060');
  assert.equal(app.readFeedbackSettings().enemy,previous.enemy);assert.equal(app.readFeedbackSettings().bg,previous.bg);
  assert.equal(app.readAppearance().appearanceUrl,'data:image/png;base64,bmV3');
  assert.equal(app.chooseAppearanceForTest('big-eye'),true);app.advanceSkin(.1);
  assert.equal(app.chooseAppearanceForTest('original'),true);app.advanceSkin(.28);
  assert.equal(app.playerInk(),0x405060,'a later rapid equip/unequip cycle captures the restored original color again');
});


test('formal endless stages unlock all nine star trail milestones permanently without awarding score-only or trial milestones',t=>{
  const key='qiuqiule-star-trails',prior=saved.get(key);
  t.after(()=>{app.seedCircle();prior===undefined?saved.delete(key):saved.set(key,prior);});
  const {world}=controlRun();app.seedEndless();app.seedStarTrails();
  world.score=999999;world.stage=world.maxStage=4;app.updateScoreHud();assert.equal(app.readStarTrails().state.unlocked,0,'score no longer earns star trails');
  for(let milestone=1;milestone<=9;milestone++){
    world.stage=world.maxStage=milestone*5;app.updateScoreHud();
    const state=app.readStarTrails().state;assert.equal(state.unlocked,milestone);assert.equal(state.pendingUnlocks.length,milestone);
    assert.equal(state.selected,null,'earning a star trail must not auto-equip it');
    assert.equal(JSON.parse(saved.get(key)).unlocked,milestone);
    assert.equal(app.readRestart().paused,false);assert.equal(app.readRestart().modal,null);
  }
  world.stage=world.maxStage=1;world.score=1;app.updateScoreHud();assert.equal(app.readStarTrails().state.unlocked,9);
  app.seedStarTrails(JSON.parse(saved.get(key)));assert.equal(app.readStarTrails().state.unlocked,9,'saved ownership restores independently of the current stage');
  app.seedRenderer(graphicsRecorder());app.seedStarTrails();app.runFeedbackDemo('steer');
  Object.assign(app.readRestart().world,{score:999999,stage:99,maxStage:99});app.updateScoreHud();app.grantStarTrailsForTest();
  assert.equal(app.readStarTrails().state.unlocked,0);assert.deepEqual(app.readStarTrails().state.pendingUnlocks,[]);
});
test('star trail equip, replacement and same-card removal fade from the current appearance without resetting the moving player',t=>{
  const key='qiuqiule-star-trails',prior=saved.get(key);
  t.after(()=>{app.seedStarTrails();prior===undefined?saved.delete(key):saved.set(key,prior);});
  app.seedRenderer(graphicsRecorder());app.seedStarTrails({unlocked:9});
  const player={...app.readHome().player},pose=app.seedWardrobePresentation(.73);
  assert.equal(app.chooseStarTrailForTest('galaxy'),true);assert.deepEqual(app.readHome().player,player);assert.deepEqual(app.sourcePose(),pose);
  assert.deepEqual(app.readStarTrails().layers,[],'the newly selected star trails begin at zero opacity');
  app.advanceStarTrails(.09);const middle=app.readStarTrails();
  assert.ok(middle.layers.some(layer=>layer.id==='galaxy'&&layer.weight>0&&layer.weight<1));
  assert.equal(app.chooseStarTrailForTest('triple'),true);assert.equal(app.readStarTrails().clock,.09);
  assert.deepEqual(app.readStarTrails().layers,middle.layers,'a fast replacement starts at the currently visible layer mix');
  app.advanceStarTrails(.18);assert.deepEqual(app.readStarTrails().layers,[{id:'triple',weight:1}]);
  assert.equal(app.chooseStarTrailForTest('triple'),true);assert.equal(app.readStarTrails().state.selected,null);
  assert.equal(JSON.parse(saved.get(key)).selected,null,'same-card unequip persists immediately');
  assert.ok(app.readStarTrails().layers.length>0,'unequip leaves a short fade instead of abruptly disappearing');
  app.advanceStarTrails(.18);assert.deepEqual(app.readStarTrails().layers,[]);assert.equal(app.readStarTrails().tween,null);
  assert.deepEqual(app.readHome().player,player);assert.deepEqual(app.sourcePose(),pose);
  app.advanceUi(.05);near(app.readAppearancePresentation().wardrobeTime,.78);
  app.seedStarTrails({unlocked:1});assert.equal(app.chooseStarTrailForTest('square'),false);assert.equal(app.readStarTrails().state.selected,null);
});

const physicalFields=body=>Object.fromEntries(['id','x','y','r','mass','density','vx','vy','hp','maxHp'].map(key=>[key,body[key]]));
function primeStarTrail(world,scene,{id='galaxy',module=app}={}){
  module.seedStarTrails({unlocked:9,selected:id});
  const p=world.player;world.phase='battle';
  Object.assign(p,{x:80,y:600,vx:world.unit*40,vy:0,feedbackFreeze:0});
  scene.updateTrails(0);
  for(let frame=0;frame<24;frame++){p.x+=p.vx/120;scene.updateTrails(1/120);}
  assert.ok(scene.starParticles.count>0,'the real scene emits the equipped trail at high speed');
  return p;
}

test('star trails render between thin trails and bodies without changing physics or creating clone particles',t=>{
  const {world,scene,g}=controlRun(),p=primeStarTrail(world,scene);
  t.after(()=>{app.seedCircle();app.setFeedbackStrength(.6);});
  const auxiliary=world.makeBody(80,350,p.r*.7,p.density);
  Object.assign(auxiliary,{isPlayer:true,isAuxiliary:true,born:1,solid:true,hp:1,vx:world.unit*40,vy:0});world.auxiliaries=[auxiliary];
  for(let frame=0;frame<12;frame++){p.x+=p.vx/120;auxiliary.x+=auxiliary.vx/120;scene.updateTrails(1/120);}
  assert.ok(scene.cometTrails.entries.has(auxiliary),'clones still keep their ordinary thin trail');
  assert.ok(scene.starParticles.particles.every(particle=>particle.owner===p));
  const before=[physicalFields(p),physicalFields(auxiliary)],count=world.enemies.length,draw=scene.starParticles.draw.bind(scene.starParticles);
  let first,last;
  scene.starParticles.draw=(...args)=>{first=g.shapes.length;draw(...args);last=g.shapes.length;};
  g.clear();scene.drawArena();
  assert.ok(last>first,'the scene draws the current particle string');
  assert.ok(first>0,'thin trail polygons are drawn first');
  const playerIndex=g.shapes.findIndex(shape=>shape.type==='path'&&shape.alpha===1&&shape.points.length===193&&shape.color===app.playerInk());
  assert.ok(playerIndex>=last,'the player occludes any overlapping particles');
  assert.deepEqual([physicalFields(p),physicalFields(auxiliary)],before);assert.equal(world.enemies.length,count);
  const particles=scene.starParticles.particles.map(({owner,...particle})=>({...particle}));
  scene.drawArena();assert.deepEqual(scene.starParticles.particles.map(({owner,...particle})=>({...particle})),particles,'redrawing never advances or mutates particles');
});

test('star trail particles reset at pause, background, resizing, a new world, reward selection and unequip',t=>{
  const previous={width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio,add:window.addEventListener};
  t.after(()=>{Object.assign(window,{innerWidth:previous.width,innerHeight:previous.height,devicePixelRatio:previous.dpr,addEventListener:previous.add});document.hidden=false;app.seedCircle();app.setFeedbackStrength(.6);});
  for(const reason of ['pause','background','resize','restart','reward','unequip']){
    const {world,scene,g,pointer}=controlRun();let resize;
    if(reason==='resize'){
      window.addEventListener=(type,handler)=>{if(type==='resize')resize=handler;else previous.add(type,handler);};
      app.mountSceneBoundary(pointer.canvas,g);
    }
    primeStarTrail(world,scene,{id:'moon'});
    if(reason==='pause')clickAction('pause');
    else if(reason==='background')document.hidden=true;
    else if(reason==='resize'){window.innerWidth=844;window.innerHeight=390;resize();}
    else if(reason==='restart')app.prepareNormalGame();
    else if(reason==='reward')world.phase='choose';
    else{app.chooseStarTrailForTest('moon');app.advanceStarTrails(.18);}
    scene.update(0,0);
    assert.equal(scene.starParticles.count,0,reason+' removes the old string');
    assert.equal(scene.starParticles.free.length,24,reason+' returns every particle to the bounded pool');
    document.hidden=false;window.innerWidth=previous.width;window.innerHeight=previous.height;window.addEventListener=previous.add;
  }
});

function showroomFrame(){
  const host=element('#wardrobe-showroom'),svg=host.querySelector('svg'),mask=host.querySelector('mask'),rect=mask?.querySelector('rect');
  const group=host.querySelectorAll('g').find(node=>node.getAttribute('mask'));
  return {host,svg,width:Number(rect?.getAttribute('width')||0),alpha:Number(group?.getAttribute('opacity')||0),visible:!host.hidden&&svg?.getAttribute('visibility')==='visible'};
}
function samePose(a,b){for(const key of ['x','y','r','squash','lookX','lookY'])near(a?.[key]||0,b?.[key]||0);const angle=(a?.roll||0)-(b?.roll||0);near(Math.sin(angle),0);near(Math.cos(angle),1);}
function enterTrailGallery(module=app,{reduced=false,commit=()=>{}}={}){
  module.navigateWardrobeForTest('main','star-trail',commit);
  module.advanceUi(reduced?.16:.28);module.advanceUi(reduced?.16:.26);
  assert.equal(module.readShowcaseForTest().state?.phase,'idle');
}

test('the moving trail showroom is confined to the star-trail gallery while other wardrobe pages keep their bounce',t=>{
  app.seedRenderer(graphicsRecorder());app.seedCircle();app.seedStarTrails({unlocked:9,selected:'galaxy'});
  const restore=app.bindWardrobeControls({update(){},back:()=>false,cancelInteraction(){},refresh(){}});t.after(()=>{restore();app.seedCircle();});
  const homePose={x:100,y:200,r:30};app.paintUiForTest(homePose);
  assert.equal(element('#ui-star-trails').hidden,true);assert.equal(element('#wardrobe-showroom').hidden,true);
  const main=app.seedWardrobePresentation(.4);app.advanceUi(.05);
  assert.notDeepEqual(app.sourcePose(),main,'the main page keeps its original bounce');
  assert.equal(element('#wardrobe-showroom').hidden,true);assert.equal(element('#ui-star-trails').hidden,true);
  let appearanceCommits=0;app.navigateWardrobeForTest('main','appearance',()=>appearanceCommits++);
  assert.equal(appearanceCommits,1);assert.equal(app.readShowcaseForTest().state,null);app.advanceUi(.05);
  assert.equal(element('#wardrobe-showroom').hidden,true,'the appearance page has no decorative trail');
  app.navigateWardrobeForTest('appearance','main',()=>{});enterTrailGallery();
  const fixed=app.sourcePose(),physical={...app.readHome().player};
  for(let i=0;i<30;i++)app.advanceUi(1/60);
  samePose(app.sourcePose(),fixed);assert.deepEqual(app.readHome().player,physical);assert.equal(element('#result-shadow').hidden,true);
  assert.equal(showroomFrame().visible,true);assert.ok(showroomFrame().width>fixed.r*3);
  assert.equal(element('#ui-star-trails').hidden,true,'the acquisition overlay does not leak into the gallery');
  const paths=element('#wardrobe-showroom').querySelectorAll('path').filter(path=>path.getAttribute('display')!=='none');
  assert.ok(paths.length>0,'the renderer displays the real thin trail and particle paths');
});

test('star-trail gallery entry and exit preserve the visible pose and complete drawing or retraction before the next movement',t=>{
  app.seedRenderer(graphicsRecorder());app.seedCircle();app.seedStarTrails({unlocked:9,selected:'galaxy'});app.seedWardrobePresentation(.4);
  const restore=app.bindWardrobeControls({update(){},back:()=>false,cancelInteraction(){},refresh(){}});t.after(()=>{restore();app.seedCircle();});
  app.advanceUi(0);const initial=app.readShowcaseForTest().lastUiPose,commits=[];
  app.navigateWardrobeForTest('main','star-trail',()=>commits.push('star-trail'));
  assert.deepEqual(commits,['star-trail']);assert.equal(app.readShowcaseForTest().state.phase,'approach');
  assert.equal(app.readRestart().transfer.target,'wardrobe-start');samePose(app.readRestart().transfer.from,initial);
  clickAction('close');for(const fn of listeners.get('keydown'))fn({key:'Escape',preventDefault(){}});
  assert.equal(app.readShowcaseForTest().state.phase,'approach');assert.equal(app.readRestart().transfer.target,'wardrobe-start');
  app.advanceUi(.28);assert.equal(app.readRestart().transfer,null);assert.equal(app.readShowcaseForTest().state.phase,'draw');
  samePose(app.readShowcaseForTest().lastUiPose,app.readShowcaseForTest().start);
  assert.equal(showroomFrame().visible,false,'the trail has zero length when the ball first arrives at its start');
  app.advanceUi(.13);const middle=showroomFrame(),middlePose=app.readShowcaseForTest().lastUiPose;
  assert.ok(middle.visible&&middle.width>0);assert.ok(middlePose.x>app.readShowcaseForTest().start.x&&middlePose.x<app.readShowcaseForTest().end.x);
  clickAction('close');assert.equal(app.readShowcaseForTest().state.phase,'draw','repeated close input cannot cut off drawing');
  app.advanceUi(.13);assert.equal(app.readShowcaseForTest().state.phase,'idle');
  const idle=app.readShowcaseForTest().lastUiPose,full=showroomFrame();samePose(idle,app.readShowcaseForTest().end);assert.ok(full.width>middle.width);
  app.navigateWardrobeForTest('star-trail','main',()=>commits.push('main'));
  assert.equal(app.readShowcaseForTest().state.phase,'retract');assert.equal(app.readRestart().transfer,null);assert.deepEqual(commits,['star-trail']);
  app.advanceUi(.09);const shrinking=showroomFrame();samePose(app.readShowcaseForTest().lastUiPose,idle);
  assert.ok(shrinking.width>0&&shrinking.width<full.width);assert.ok(shrinking.alpha>0&&shrinking.alpha<full.alpha);
  assert.deepEqual(commits,['star-trail'],'content cannot switch while the old trail is still retracting');
  app.advanceUi(.09);assert.deepEqual(commits,['star-trail','main']);assert.equal(showroomFrame().visible,false);
  assert.equal(app.readRestart().transfer.target,'wardrobe');samePose(app.readRestart().transfer.from,idle);
  const departure=app.readShowcaseForTest().lastUiPose;samePose(departure,idle);
  app.advanceUi(.16);assert.equal(app.readRestart().transfer.target,'wardrobe');
  const returning=app.readShowcaseForTest().lastUiPose;
  assert.deepEqual(app.sourcePose(),returning,'a pose query midway through the return matches the currently visible ball');
  assert.notDeepEqual(returning,departure,'the assertion samples a moving return frame rather than an endpoint');
  app.advanceUi(.16);assert.equal(app.readRestart().transfer,null);assert.equal(app.readShowcaseForTest().state,null);
  const returned=app.readShowcaseForTest().lastUiPose;samePose(returned,app.sourcePose());assert.equal(element('#wardrobe-showroom').hidden,true);
  app.advanceUi(.05);assert.notDeepEqual(app.sourcePose(),returned,'only after returning to the center does the ordinary bounce resume');
  assert.equal(app.readStarTrails().state.selected,'galaxy');
});

test('the whole wardrobe ball stays unclipped through every showcase phase and both bounce handoffs',t=>{
  const anchors=['#wardrobe-panel .wardrobe-preview','#wardrobe-panel .wardrobe-body','#wardrobe-ball'].map(element);
  const previousRects=anchors.map(node=>node.getBoundingClientRect);
  const rect=(x,y,width,height)=>({x,y,width,height,left:x,right:x+width,top:y,bottom:y+height});
  anchors[0].getBoundingClientRect=()=>rect(75,540,240,110);
  anchors[1].getBoundingClientRect=()=>rect(75,200,240,450);
  anchors[2].getBoundingClientRect=()=>rect(157,558,76,76);
  const restore=app.bindWardrobeControls({update(){},back:()=>false,cancelInteraction(){},refresh(){}});
  t.after(()=>{anchors.forEach((node,i)=>{node.getBoundingClientRect=previousRects[i];});restore();app.seedCircle();});
  for(const custom of [false,true]){
    app.seedRenderer(graphicsRecorder());app.seedCircle();app.seedStarTrails({unlocked:9,selected:'galaxy'});
    const photos=custom?app.recordCompositePhotos(true):null;
    try{
      app.seedWardrobePresentation(.27);app.advanceUi(0);
      const bounced={...app.readShowcaseForTest().lastUiPose};
      assert.ok(bounced.squash>0,'the handoff starts with nonzero bounce deformation');
      const assertWholeBall=label=>{
        assert.equal(element('#ui-ball').hidden,false,label);
        assert.equal(element('#ui-ball').style.clipPath,'none',`${label}: the shared ball must not inherit the panel crop`);
        if(photos)assert.equal(photos.main.at(-1)?.options.clip,null,`${label}: the custom-photo surface has the same uncropped boundary`);
      };
      assertWholeBall('mid-bounce');
      app.navigateWardrobeForTest('main','star-trail',()=>{});
      samePose(app.readShowcaseForTest().lastUiPose,bounced);
      samePose(app.readRestart().transfer.from,bounced);
      near(app.readRestart().transfer.from.visualSquash,bounced.squash);
      app.advanceUi(0);samePose(app.readShowcaseForTest().lastUiPose,bounced);
      assertWholeBall('zero-time approach handoff');
      const advanceFlight=label=>{
        let frame=0;
        while(app.readRestart().transfer){
          const move=app.readRestart().transfer;
          app.advanceUi(Math.min(.02,move.duration-move.elapsed));assertWholeBall(`${label} ${frame++}`);
        }
      };
      advanceFlight('approach');
      // The leftmost position is intentionally close to the preview edge;
      // clipping the shared ball to that rectangle used to remove its left side.
      const start=app.readShowcaseForTest().lastUiPose;
      assert.ok(start.x-start.r<anchors[0].getBoundingClientRect().left);
      while(app.readShowcaseForTest().state.phase==='draw'){
        app.advanceUi(Math.min(.02,.26-app.readShowcaseForTest().state.elapsed));assertWholeBall('drawing');
      }
      assert.equal(app.readShowcaseForTest().state.phase,'idle');
      const fixed={...app.readShowcaseForTest().lastUiPose};
      app.navigateWardrobeForTest('star-trail','main',()=>{});
      while(app.readShowcaseForTest().state?.phase==='retract'){
        app.advanceUi(Math.min(.02,.18-app.readShowcaseForTest().state.elapsed));assertWholeBall('retract');samePose(app.readShowcaseForTest().lastUiPose,fixed);
      }
      assert.equal(app.readRestart().transfer.target,'wardrobe');
      advanceFlight('return');
      assert.equal(app.readRestart().transfer,null);
      const landed={...app.readShowcaseForTest().lastUiPose};samePose(landed,app.sourcePose());near(landed.squash,0);
      app.advanceUi(.27);assertWholeBall('resumed bounce');
      samePose(app.readShowcaseForTest().lastUiPose,bounced);
      assert.equal(element('#wardrobe-showroom').hidden,true);
    }finally{photos?.restore();}
  }
});

test('star-trail gallery transition freezes in background and resizing preserves its current phase',t=>{
  const previous={width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio,add:window.addEventListener};let resize;
  window.innerWidth=390;window.innerHeight=844;window.devicePixelRatio=1;
  window.addEventListener=(type,handler)=>{if(type==='resize')resize=handler;else previous.add(type,handler);};
  const {scene,g}=controlRun(),pointer=inputCanvas();app.mountSceneBoundary(pointer.canvas,g);app.seedCircle();app.seedStarTrails({unlocked:9,selected:'moon'});app.seedWardrobePresentation();
  const restore=app.bindWardrobeControls({update(){},cancelInteraction(){},refresh(){}});
  t.after(()=>{restore();Object.assign(window,{innerWidth:previous.width,innerHeight:previous.height,devicePixelRatio:previous.dpr,addEventListener:previous.add});document.hidden=false;app.seedCircle();});
  app.navigateWardrobeForTest('main','star-trail',()=>{});app.advanceUi(.28);app.advanceUi(.1);
  const phase=app.readShowcaseForTest().state.phase,elapsed=app.readShowcaseForTest().state.elapsed,pose={...app.readShowcaseForTest().lastUiPose};
  document.hidden=true;app.advanceUi(2);assert.equal(app.readShowcaseForTest().state.phase,phase);near(app.readShowcaseForTest().state.elapsed,elapsed);samePose(app.readShowcaseForTest().lastUiPose,pose);
  document.hidden=false;window.innerWidth=844;window.innerHeight=390;resize();app.advanceUi(0);
  assert.equal(app.readShowcaseForTest().state.phase,phase);near(app.readShowcaseForTest().state.elapsed,elapsed);
  assert.ok(['x','y','r'].every(key=>Number.isFinite(app.sourcePose()[key])));
  app.advanceUi(.16);assert.equal(app.readShowcaseForTest().state.phase,'idle');
  const box=element('#wardrobe-panel .wardrobe-preview').getBoundingClientRect(),fixed=app.sourcePose();
  assert.ok(fixed.x-fixed.r>=box.left&&fixed.x+fixed.r<=box.right);assert.ok(fixed.y-fixed.r>=box.top&&fixed.y+fixed.r<=box.bottom);
});

test('reduced-motion gallery uses the same ordered phases and crop return does not replay the showcase entry',async()=>{
  await withReloadedEntry({juice:.6},true,fresh=>{
    fresh.seedRenderer(graphicsRecorder());fresh.seedCircle();fresh.seedStarTrails({unlocked:9,selected:'galaxy'});fresh.seedWardrobePresentation();
    let cropping=false;const restore=fresh.bindWardrobeControls({update(){},refresh(){},cancelInteraction(){},isCropping:()=>cropping});
    try{
      let commits=0;enterTrailGallery(fresh,{reduced:true,commit:()=>commits++});assert.equal(commits,1);
      const fixed=fresh.sourcePose(),markup=element('#wardrobe-showroom').innerHTML;
      fresh.advanceUi(.1);samePose(fresh.sourcePose(),fixed);assert.equal(element('#wardrobe-showroom').innerHTML,markup,'reduced-motion preview remains still');
      cropping=true;fresh.advanceUi(.05);assert.equal(element('#wardrobe-showroom').hidden,true);
      cropping=false;fresh.advanceUi(.05);assert.equal(fresh.readShowcaseForTest().state.phase,'idle');samePose(fresh.sourcePose(),fixed);assert.equal(showroomFrame().visible,true);
      fresh.navigateWardrobeForTest('star-trail','main',()=>commits++);fresh.advanceUi(.06);assert.equal(commits,1);samePose(fresh.sourcePose(),fixed);
      fresh.advanceUi(.06);assert.equal(commits,2);assert.equal(fresh.readRestart().transfer.target,'wardrobe');
      fresh.advanceUi(.22);assert.equal(fresh.readRestart().transfer,null);assert.equal(fresh.readShowcaseForTest().state,null);assert.equal(element('#wardrobe-showroom').hidden,true);
    }finally{restore();fresh.seedCircle();}
  });
});

test('v7.11 every appearance uses score ink for aim, stage dots and Boss awards on both background themes',async()=>{
  const css=await readFile(new URL('../dist/style.css',import.meta.url),'utf8');
  assert.match(css,/#stage-progress\{[^}]*color:var\(--ink\)/,'stage dots inherit the exact score-theme ink');
  for(const [bg,ink]of [['#f4f3eb',0x252720],['#121415',0xf0f2e8]])for(const appearance of ['original','custom','big-eye']){
    await withReloadedEntry({player:'#d98db7',bg,juice:1},false,fresh=>{
      const {world,scene,g,pointer}=controlRun(fresh),p=world.player;
      fresh.seedCircle();
      const photos=appearance==='custom'?fresh.recordCompositePhotos(true):null;
      fresh.seedAppearanceState({selected:appearance,bigEyeUnlocked:true},{hasImage:appearance==='custom'});
      try{
        Object.assign(p,{x:180,y:550,vx:world.unit*25,vy:0});
        pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x,p.y+world.maxPull);scene.update(0,0);
        const dots=g.shapes.filter(shape=>shape.type==='circle'&&shape.r===1.7);
        assert.equal(dots.length,7);assert.ok(dots.every(dot=>dot.color===ink),appearance+' guide follows score ink, not the body palette');
        assert.equal(g.shapes.find(shape=>shape.type==='stroke'&&shape.width===1.4)?.color,ink);
        pointer('pointercancel');
        fresh.seedEndless({best:1});world.score=100;fresh.updateScoreHud();
        assert.equal(fresh.readEndless().runNewRecord,true);assert.equal(element('#score').style.color,'','new-record animation cannot recolor the score independently');
        assert.equal(element('html').style['--ink'],'#'+ink.toString(16).padStart(6,'0'));
        world.events.push({type:'bossScore',x:p.x,y:p.y,value:100,segment:1,r:world.unit*2},{type:'bossDefeated',x:p.x,y:p.y,value:500,r:world.unit*2});
        scene.update(0,0);
        const label=scene.testLabels.find(label=>label.text==='+100');
        assert.ok(label);assert.equal(label.style.color,'#'+ink.toString(16).padStart(6,'0'));
        assert.equal(scene.testLabels.find(label=>label.text==='+500')?.style.color,label.style.color);
        if(photos)assert.ok(photos.main.length>0,'a successful photo draw coexists with the aim feedback');
      }finally{photos?.restore();}
    });
  }
});

test('v7.11 custom photo skins retain contrast-safe comets and aim feedback even when their saved player color matches the background',async()=>{
  for(const [bg,ink]of [['#f4f3eb',0x252720],['#121415',0xf0f2e8]])await withReloadedEntry({player:bg,bg,juice:1},false,fresh=>{
    const {world,scene,g,pointer}=controlRun(fresh),p=world.player;
    fresh.seedCircle();const photos=fresh.recordCompositePhotos(true);
    try{
      Object.assign(p,{x:80,y:600,vx:world.unit*35,vy:0});advanceScene(scene,.12);
      const trailInk=fresh.feedbackInk(),history=scene.cometTrails.entries.get(p);
      assert.notEqual(trailInk,fresh.playerInk(),'the photo inherits a readable trail instead of an invisible saved palette color');
      assert.equal(history.active,true);assert.ok(history.points.length>4);
      const ribbons=g.shapes.filter(shape=>shape.type==='path'&&shape.color===trailInk&&shape.alpha>0&&shape.alpha<1&&shape.points.length>=4);
      assert.equal(ribbons.length,9);assert.ok(photos.main.length>0);
      const physical={x:p.x,y:p.y,vx:p.vx,vy:p.vy,r:p.r,mass:p.mass};
      pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x,p.y+world.maxPull);scene.update(0,0);
      const dots=g.shapes.filter(shape=>shape.type==='circle'&&shape.r===1.7);
      assert.equal(dots.length,7);assert.ok(dots.every(dot=>dot.color===ink));
      assert.deepEqual({x:p.x,y:p.y,vx:p.vx,vy:p.vy,r:p.r,mass:p.mass},physical);
      pointer('pointercancel');
    }finally{photos.restore();}
  });
});


test('v7.11 Big Eye clone opacity multiplies the body and pupil through ordinary and fading renders',t=>{
  const g=graphicsRecorder(),{world}=controlRun();app.seedCircle();app.seedAppearanceState({selected:'big-eye',bigEyeUnlocked:true});
  t.after(()=>app.seedCircle());
  const clone={...world.player,isAuxiliary:true,born:1,squash:0,vx:0,vy:0};
  for(const alpha of [1,.5,.25]){
    g.clear();app.drawPlayerForTest(g,clone,app.playerInk(),alpha);
    assert.ok(g.shapes.some(shape=>shape.type==='triangle'));assert.ok(g.shapes.some(shape=>shape.type==='circle'&&shape.color===0));
    assert.ok(g.shapes.every(shape=>Math.abs(shape.alpha-alpha*.6)<1e-9));
  }
});

test('the actual stage route prepares the upcoming Boss early and resets preparation on restart',t=>{
  const prepared=[],scenes=[];
  t.mock.method(GameAudio.prototype,'prepareBossMusic',()=>prepared.push(true));
  t.mock.method(GameAudio.prototype,'setMusicScene',(name,options)=>scenes.push({name,options}));
  const {world,scene}=feedbackRun();
  t.after(()=>{app.seedRenderer(graphicsRecorder());app.setFeedbackStrength(.6);});
  world.events=[];
  for(const previous of [3,4,8,9,43,44]){
    const before=prepared.length;
    world.stage=previous;world.startingUpgrades=false;world.rewardSelectionsRemaining=1;
    world.finishRewardRound();scene.handleEvents();
    assert.equal(world.phase,'battle');
    assert.equal(prepared.length-before,1);
    assert.equal(scenes.length,0,'preparation must not switch the regular battle soundtrack');
    scene.handleEvents();assert.equal(prepared.length-before,1,'a redraw does not prepare twice');
  }
  const beforeRestart=prepared.length;
  clickAction('pause');app.advanceUi(.5);clickRestart();
  assert.deepEqual(scenes.at(-1),{name:'endless',options:{resetPreparation:true}});
  assert.equal(prepared.length,beforeRestart+1,'a fresh run prepares its first Boss before the starting reward is chosen');
});

test('Boss entry selects its track, pause menus preserve it, and victory returns to endless before rewards',t=>{
  const calls=[];
  t.mock.method(GameAudio.prototype,'setMusicScene',name=>calls.push(name));
  const {scene,home}=app.seedRenderer(graphicsRecorder());
  home.launchToPlay();advanceScene(scene,3);
  assert.equal(app.readRestart().screen,'play');
  assert.equal(calls.at(0),'endless');
  assert.ok(calls.every(name=>name==='endless'));
  const {world}=app.readRestart();
  const beforeBoss=calls.length;
  world.stage=5;world.beginBoss();scene.handleEvents();
  assert.deepEqual(calls.slice(beforeBoss),['boss']);
  const duringBoss=calls.length;
  clickAction('pause');app.advanceUi(.5);clickAction('settings');app.advanceUi(.5);
  clickAction('close');app.advanceUi(.5);clickAction('run-upgrades');app.advanceUi(.5);clickAction('close');app.advanceUi(.5);
  clickAction('resume');app.advanceUi(.5);
  assert.equal(calls.length,duringBoss,'pause, settings, inventory and resume do not restart or replace Boss music');
  world.defeatBoss();scene.handleEvents();assert.deepEqual(calls.slice(beforeBoss),['boss','endless']);
  world.beginBoss();scene.handleEvents();world.endRun('boss');scene.handleEvents();
  advanceScene(scene,1.2);assert.deepEqual(calls.slice(beforeBoss),['boss','endless','boss','failedEndless']);
  assert.equal(app.readRestart().modal,'over');
  clickRestart();assert.equal(calls.at(-1),'endless');
  const regular=endingRun();advanceScene(regular.scene,1.2);
  assert.equal(calls.at(-1),'failedEndless');
  clickAction('home');assert.equal(calls.at(-1),'home');
});

test('Boss music follows direct demos and is replaced immediately on an active Boss restart or voluntary exit',t=>{
  const calls=[];t.mock.method(GameAudio.prototype,'setMusicScene',name=>calls.push(name));
  t.after(()=>{app.seedRenderer(graphicsRecorder());app.setFeedbackStrength(.6);});
  app.seedRenderer(graphicsRecorder());app.runFeedbackDemo('boss-rewards');
  let {world,scene}=app.readRestart();scene.handleEvents();
  assert.equal(world.phase,'boss-entry');assert.deepEqual(calls.slice(-2),['endless','boss'],'a demo that begins directly at Boss entry uses the same event route');
  clickAction('pause');app.advanceUi(.5);clickRestart();assert.equal(calls.at(-1),'endless');app.advanceUi(.5);
  ({world,scene}=app.readRestart());world.stage=5;world.beginBoss();scene.handleEvents();assert.equal(calls.at(-1),'boss');
  clickAction('pause');app.advanceUi(.5);clickAction('home');assert.equal(calls.at(-1),'resultEndless');
  app.advanceUi(1);clickAction('home');assert.equal(calls.at(-1),'home');
});

test('a rapid Boss entry, defeat and failure batch finishes on the failure mix and keeps its entry and defeat cues',t=>{
  const calls=[];t.mock.method(GameAudio.prototype,'setMusicScene',name=>calls.push(name));
  const {world,scene}=feedbackRun(),audio=app.recordFeedbackAudio(),tones=app.recordTones();
  t.after(()=>{audio.restore();tones.restore();app.seedRenderer(graphicsRecorder());app.setFeedbackStrength(.6);});
  world.events=[];world.stage=5;world.beginBoss();world.defeatBoss();world.endRun('boss');scene.handleEvents();
  assert.deepEqual(calls,['boss','endless','failedEndless']);assert.equal(world.phase,'over');
  assert.equal(tones.calls.filter(args=>args[0]===260).length,1);
  assert.equal(audio.calls.filter(call=>call.name==='bossDefeat').length,1);
  scene.handleEvents();assert.deepEqual(calls,['boss','endless','failedEndless'],'a redraw cannot replay stale Boss events');
});

test('voluntary endless exit selects its result mix and returning home restores the menu mix',t=>{
  const calls=[];t.mock.method(GameAudio.prototype,'setMusicScene',name=>calls.push(name));
  app.seedRenderer(graphicsRecorder(),390,844,true);clickAction('pause');app.advanceUi(1);clickAction('home');
  assert.equal(calls.at(-1),'resultEndless');app.advanceUi(1);clickAction('home');assert.equal(calls.at(-1),'home');
});
test('leaving the web page fades early and cancelling the navigation restores the visible game',t=>{
  const calls=[];
  t.mock.method(GameAudio.prototype,'setHidden',hidden=>calls.push(hidden));
  const navigate=windowListeners.get('navigation:navigate')[0];
  const controller=new AbortController();
  const event={destination:{sameDocument:false},signal:controller.signal,downloadRequest:null};
  navigate({...event,destination:{sameDocument:true}});
  navigate({...event,downloadRequest:''});
  navigate({...event,defaultPrevented:true});
  assert.deepEqual(calls,[]);
  navigate(event);
  assert.deepEqual(calls,[true]);
  controller.abort();
  assert.deepEqual(calls,[true,false]);
});

test('a visible home attempts autoplay before any gesture using the restored audio preferences',async t=>{
  const attempts=[];
  t.mock.method(GameAudio.prototype,'tryAutoplay',function(){
    attempts.push({scene:this.musicScene,sound:this.enabled,bgmVolume:this.bgmVolume,sfxVolume:this.sfxVolume});
  });
  const wasHidden=document.hidden;
  t.after(()=>{document.hidden=wasHidden;});
  document.hidden=false;
  for(const [config,expected] of [
    [null,{sound:true,bgmVolume:.55,sfxVolume:.75}],
    [{sound:false,bgmVolume:.32,sfxVolume:.46},{sound:false,bgmVolume:.32,sfxVolume:.46}],
    [{sound:true,bgmVolume:0,sfxVolume:.6},{sound:true,bgmVolume:0,sfxVolume:.6}]
  ]){
    attempts.length=0;
    await withReloadedEntry(config,false,()=>{
      assert.deepEqual(attempts,[{scene:'home',...expected}]);
    });
  }
  attempts.length=0;document.hidden=true;
  await withReloadedEntry(null,false,()=>{
    assert.deepEqual(attempts,[]);
    document.hidden=false;
    listeners.get('visibilitychange').at(-1)();
    assert.deepEqual(attempts,[{scene:'home',sound:true,bgmVolume:.55,sfxVolume:.75}]);
  });
});

test('a blocked drag leaves global audio retries available on ordinary taps and after interruptions',async t=>{
  const page=new EventTarget(),registered=new Set();
  const gestures=['pointerup','touchend','click','keydown'];
  const addListener=document.addEventListener;
  t.mock.method(document,'addEventListener',function(type,handler,options){
    addListener.call(this,type,handler,options);
    // Canvas handlers may stop bubbling. Only document capture listeners see these gestures.
    if(gestures.includes(type)&&(options===true||options?.capture)){
      registered.add(type);
      page.addEventListener(type,handler,options);
    }
  });
  let locked=true,gestureAllowed=false;
  t.mock.method(GameAudio.prototype,'tryAutoplay',()=>{});
  t.mock.getter(GameAudio.prototype,'needsUnlock',()=>locked);
  const unlock=t.mock.method(GameAudio.prototype,'unlock',()=>{if(gestureAllowed)locked=false;});
  await withReloadedEntry(null,false,()=>{
    assert.deepEqual(registered,new Set(gestures));
    const release=type=>page.dispatchEvent(new Event(type));
    release('pointerup');
    assert.equal(unlock.mock.callCount(),1);
    gestureAllowed=true;
    release('pointerup');
    assert.equal(unlock.mock.callCount(),2,'a later pointer release can retry after a drag was denied');
    for(const type of ['touchend','click','keydown']){
      const previous=unlock.mock.callCount();
      release(type);
      assert.equal(unlock.mock.callCount(),previous,'a running session ignores '+type);
      locked=true;
      release(type);
      assert.equal(unlock.mock.callCount(),previous+1,type+' can recover an interrupted session');
      assert.equal(locked,false);
    }
  });
});

function inventoryText(node){return [node.textContent||'',...(node.children||[]).map(inventoryText)].join(' ');}
function inventoryWorldSnapshot(world){return JSON.stringify({stage:world.stage,time:world.time,phase:world.phase,buffs:world.buffs,player:world.player,enemies:world.enemies,stageKills:world.stageKills,score:world.score});}

test('endless run inventory carries the real player out and back while every combat state remains paused',t=>{
  const {world,scene}=feedbackRun();world.buffs={energy:8,frenzy:3,gambler:4,risk:9};world.nextGambler=true;
  const original=inventoryWorldSnapshot(world);
  t.after(()=>{app.seedRenderer(graphicsRecorder());app.setFeedbackStrength(.6);});
  clickAction('pause');app.advanceUi(.42);
  assert.equal(element('#pause-upgrades').hidden,false);assert.equal(element('#pause-panel').classList.contains('with-run-upgrades'),true);
  const pausePose={...app.readPlayerShape().lastUiPose};clickAction('run-upgrades');
  let state=app.readRestart();assert.equal(state.modal,'run-upgrades');assert.equal(state.paused,true);assert.equal(state.transfer.target,'run-upgrades');
  near(state.transfer.from.x,pausePose.x);near(state.transfer.from.y,pausePose.y);near(state.transfer.from.r,pausePose.r);
  assert.equal(element('#modal-layer').inert,true);clickAction('close');assert.equal(app.readRestart().transfer.target,'run-upgrades','a repeated click cannot reverse an unfinished flight');
  app.advanceUi(.21);const midway=app.readPlayerShape().lastUiPose;assert.notEqual(midway.x,pausePose.x);assert.notEqual(midway.r,pausePose.r);
  app.advanceUi(.21);state=app.readRestart();assert.equal(state.transfer,null);assert.equal(state.uiAnchor,'run-upgrades');assert.equal(element('#ui-ball').hidden,false);assert.equal(element('#ui-ball').dataset.state,'run-upgrades');
  const settled={...app.readPlayerShape().lastUiPose};near(settled.x,89);near(settled.y,153);near(settled.r,21);
  const rows=element('#run-upgrades-list').children;assert.deepEqual(rows.map(row=>row.dataset.upgradeId),['energy','gambler','frenzy']);
  assert.match(inventoryText(rows[0]),/弹性十足.*8 层/);assert.match(inventoryText(rows[1]),/赌徒.*4 次.*下阶段/);assert.match(inventoryText(rows[2]),/狂潮.*3 层.*180%/);
  assert.equal(element('#run-upgrades-empty').hidden,true);
  element('#run-upgrades-body').scrollTop=250;advanceScene(scene,.5);
  assert.deepEqual(app.readPlayerShape().lastUiPose,settled,'scrolling the list cannot move its fixed player anchor');
  assert.equal(inventoryWorldSnapshot(world),original,'the overlay never advances combat, rewards, counters or upgrades');
  for(const handler of listeners.get('keydown'))handler({key:'Escape',preventDefault(){}});
  state=app.readRestart();assert.equal(state.modal,'pause');assert.equal(state.transfer.target,'pause');assert.equal(state.paused,true);
  near(state.transfer.from.x,settled.x);near(state.transfer.from.y,settled.y);app.advanceUi(.42);
  assert.equal(app.readRestart().uiAnchor,'pause');assert.equal(app.readRestart().paused,true);assert.equal(inventoryWorldSnapshot(world),original);
  clickAction('resume');assert.equal(app.readRestart().paused,true);app.advanceUi(.42);assert.equal(app.readRestart().paused,false);
});

test('run inventory refreshes its acquired entries and empty state without duplicating rows or changing the run',t=>{
  const {world}=feedbackRun();world.buffs={};
  t.after(()=>{app.seedRenderer(graphicsRecorder());app.setFeedbackStrength(.6);});
  clickAction('pause');app.advanceUi(.42);clickAction('run-upgrades');app.advanceUi(.42);
  assert.equal(element('#run-upgrades-list').children.length,0);assert.equal(element('#run-upgrades-empty').hidden,false);
  clickAction('close');app.advanceUi(.42);world.buffs={density:9,gambler:2};world.nextGambler=false;world.gamblerRewardPending=false;world.gamblerTargetMultiplier=1;
  clickAction('run-upgrades');app.advanceUi(.42);
  const rows=element('#run-upgrades-list').children;assert.equal(rows.length,2);assert.equal(element('#run-upgrades-empty').hidden,true);
  assert.match(inventoryText(rows[0]),/重量级.*9 层.*初始/);assert.match(inventoryText(rows[1]),/赌徒.*2 次.*已兑现/);
  element('#run-upgrades-body').scrollTop=200;clickAction('close');app.advanceUi(.42);clickAction('run-upgrades');app.advanceUi(.42);
  assert.equal(element('#run-upgrades-list').children.length,2);assert.equal(element('#run-upgrades-body').scrollTop,0);
  assert.equal(app.readRestart().world,world);assert.equal(app.readRestart().paused,true);
});

const RUN_SAVE_KEY='qiuqiule-run-save';
function runSimulationState(world){const {random,...state}=world;return structuredClone(state);}
function persistenceRun(module=app){
  const run=feedbackRun(module,.6),{world,scene}=run;
  Object.assign(world,{stage:23,maxStage:23,score:8765,stageKills:11,stageKillCarry:2,saveUsed:true,overTimer:.27,breathTime:.4,pulseCooldown:.18});
  world.buffs={energy:4,density:2,frenzy:2,penetration:1};
  Object.assign(world.player,{x:91.25,y:267.5,vx:27.125,vy:-31.75,feedbackFreeze:.017,pendingVx:1.25,pendingVy:-.75});
  world.enemies.forEach((body,index)=>Object.assign(body,{born:1,solid:true,hp:31+index,maxHp:94+index,vx:index*.3,vy:-index*.4}));
  world.events=[];scene.accumulator=.003;scene.timeSlices=[{world:.003,scale:1}];
  module.seedRunMetadataForTest();return run;
}
function finishPausedTransfer(module=app){module.advanceUi(.7);}
function finishResumeTransfer(module=app){if(module.readRestart().transfer)module.advanceUi(.7);}
function latestAction(action){listeners.get('click').at(-1)({target:{closest:()=>({dataset:{action}})},detail:1});}

test('v10.1 pause swaps settlement and rounded leave controls without retaining a pause restart action',async()=>{
  const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  const pause=html.slice(html.indexOf('id="pause-panel"'),html.indexOf('</section>',html.indexOf('id="pause-panel"')));
  assert.doesNotMatch(pause,/data-action="restart"/);
  assert.ok(pause.indexOf('data-action="home"')<pause.indexOf('data-action="leave"'));
  assert.match(pause,/data-icon="leave"/);assert.match(pause,/暂离/);assert.match(pause,/结算/);
});

test('star trail particles are presentation state and never enter resumable run snapshots',t=>{
  const prior=saved.get(RUN_SAVE_KEY),{world,scene}=controlRun();primeStarTrail(world,scene);
  t.after(()=>{app.seedCircle();app.setFeedbackStrength(.6);prior===undefined?saved.delete(RUN_SAVE_KEY):saved.set(RUN_SAVE_KEY,prior);});
  const before=runSimulationState(world);assert.equal(app.saveRunForTest(),true);
  const checkpoint=app.decodedRunForTest();assert.ok(checkpoint);assert.deepEqual(runSimulationState(checkpoint.world),before);
  const serialized=JSON.stringify(app.savedRunForTest());
  assert.doesNotMatch(serialized,/starParticles|birthMileage|birthTrailLength|lateralPhase/,'no particle pool or transient emission phase is serialized');
});

test('v10.1 a fresh home and an already settled run never produce a resumable save',()=>{
  app.seedRenderer(graphicsRecorder());assert.equal(app.savedRunForTest(),null);
  assert.equal(app.saveRunForTest(),false);assert.equal(saved.has(RUN_SAVE_KEY),false);
  const {world}=persistenceRun();world.phase='over';
  assert.equal(app.saveRunForTest(),false);assert.equal(saved.has(RUN_SAVE_KEY),false);
});

test('v10.1 pause saves the complete current run and ordinary resume consumes that checkpoint',()=>{
  const {world}=persistenceRun();clickAction('pause');
  assert.ok(saved.has(RUN_SAVE_KEY));assert.ok(app.savedRunForTest());
  const before=runSimulationState(world);finishPausedTransfer();clickAction('resume');
  assert.equal(saved.has(RUN_SAVE_KEY),false);assert.equal(app.savedRunForTest(),null);
  finishResumeTransfer();assert.equal(app.readRestart().paused,false);
  assert.deepEqual(runSimulationState(world),before);
  world.player.x+=13;clickAction('pause');assert.ok(saved.has(RUN_SAVE_KEY),'a later pause writes a new checkpoint');
});

test('v10.1 every interruption route saves before leaving, including while a pause transfer is unfinished',()=>{
  for(const kind of ['blur','pagehide','visibilitychange']){
    const {world}=persistenceRun();
    if(kind==='visibilitychange'){document.hidden=true;listeners.get(kind).forEach(fn=>fn());document.hidden=false;}
    else windowListeners.get(kind).forEach(fn=>fn());
    assert.ok(saved.has(RUN_SAVE_KEY),kind);assert.ok(app.savedRunForTest(),kind);assert.equal(app.readRestart().paused,true,kind);
    const before=runSimulationState(world);
    windowListeners.get('pagehide').forEach(fn=>fn());
    assert.ok(app.savedRunForTest(),'pagehide retains a checkpoint even with its pause flight/modal active');
    assert.deepEqual(runSimulationState(world),before);
  }
});

test('v10.1 leaving preserves the paused run and returns home without settlement or a new game',()=>{
  const {world}=persistenceRun();clickAction('pause');finishPausedTransfer();
  const before=runSimulationState(world);clickAction('leave');
  assert.ok(saved.has(RUN_SAVE_KEY));assert.equal(app.readRestart().screen,'home');assert.equal(app.readRestart().result,null);
  assert.deepEqual(runSimulationState(world),before);assert.notEqual(world.phase,'over');
  app.advanceUi(.7);assert.equal(app.readRestart().world,null);
});

test('v10.1 starting with a save enters the two-ball choice without overwriting the old world',()=>{
  const {world}=persistenceRun();clickAction('pause');finishPausedTransfer();clickAction('leave');app.advanceUi(.7);
  const stored=saved.get(RUN_SAVE_KEY),original=runSimulationState(world);
  const home=app.readHome(),scene=app.readRestart().scene;home.launchToPlay();advanceScene(scene,3);
  const choice=app.readRestart().world;
  assert.equal(choice.isRunChoice,true);assert.deepEqual(choice.choices.map(c=>c.id),['new-run','continue-run']);
  assert.deepEqual(choice.choices.map(c=>c.name),['新的一局','继续上局']);
  assert.equal(saved.get(RUN_SAVE_KEY),stored);assert.deepEqual(runSimulationState(world),original);
  document.hidden=true;listeners.get('visibilitychange').forEach(fn=>fn());document.hidden=false;
  windowListeners.get('pagehide').forEach(fn=>fn());
  assert.equal(saved.get(RUN_SAVE_KEY),stored,'a temporary choice scene never replaces the real run');
});

test('v10.1 choosing a new run discards the old checkpoint and begins exactly one starting reward round',()=>{
  persistenceRun();clickAction('pause');finishPausedTransfer();clickAction('leave');app.advanceUi(.7);
  app.showRunChoiceForTest();
  const {world:menu,scene}=app.readRestart();advanceScene(scene,1.3);
  const choice=menu.choices.find(item=>item.id==='new-run');
  Object.assign(menu.player,{x:choice.x-choice.r-menu.player.r+.1,y:choice.y,vx:menu.baseSpeed,vy:0});
  advanceScene(scene,.5);
  const {world}=app.readRestart();assert.notEqual(world.isRunChoice,true);assert.equal(saved.has(RUN_SAVE_KEY),false);
  assert.equal(world.stage,1);assert.equal(world.score,0);assert.equal(world.startingUpgrades,true);
  assert.equal(world.rewardSelectionsRemaining,1);assert.deepEqual(world.buffs,{});assert.equal(world.choices.length,3);
});

test('v10.1 continue restores exact simulation state, run metadata and substep time before physics resumes',()=>{
  const {world,scene}=persistenceRun();
  const mother=world.enemies[0];Object.assign(mother,{enemyType:'split',splitFamilyId:mother.id,hp:0});
  world.enemyDeath(mother);world.enemies=world.enemies.filter(body=>body.hp>0);world.events=[];
  assert.equal(world.fragmentQueue.length,3,'exercise the real mother split queue schema');
  const shot={time:world.feedbackTime,hits:2};world.activeShot=shot;world.shotHistory=[shot];
  world.seenEnemyKills=new Set(['split','ring','magnet']);
  clickAction('pause');const before=runSimulationState(world),metadata=app.readRunMetadataForTest();finishPausedTransfer();
  clickAction('leave');app.advanceUi(.7);const nextRandom=Array.from({length:16},()=>world.random());
  assert.equal(app.continueRunForTest(),true);
  const restored=app.readRestart().world;
  assert.notEqual(restored,world);assert.deepEqual(runSimulationState(restored),before);
  assert.equal(restored.activeShot,restored.shotHistory[0]);assert.ok(restored.seenEnemyKills instanceof Set);
  assert.deepEqual(Array.from({length:16},()=>restored.random()),nextRandom,'future random draws continue at the captured state');
  const afterMetadata=app.readRunMetadataForTest();
  assert.deepEqual({...afterMetadata,recordedStatsKey:metadata.recordedStatsKey},metadata);
  assert.equal(afterMetadata.recordedStatsKey,[before.score,before.maxStage,before.maxCombo,'2030-01-01'].join(':'));
  finishResumeTransfer();near(scene.accumulator,.003);assert.deepEqual(scene.timeSlices,[{world:.003,scale:1}]);
  assert.equal(saved.has(RUN_SAVE_KEY),false);near(app.resumeSecondsForTest(),1);near(scene.timeScale,.3);
});

test('v10.1 a fresh page can discover the checkpoint and restore Boss state without rerolling or awarding rewards',async()=>{
  const {world}=persistenceRun();world.stage=world.maxStage=10;world.beginBoss();world.phase='boss';world.arenaBlend=1;
  world.boss.born=1;world.boss.stunned=true;world.boss.stunnedHp=123.5;world.boss.stunnedTime=.45;world.boss.contacts=new Set([world.player.id]);world.events=[];
  clickAction('pause');const before=runSimulationState(world);assert.ok(app.savedRunForTest(),'Boss pause creates a valid checkpoint');finishPausedTransfer();clickAction('leave');app.advanceUi(.7);
  assert.ok(app.savedRunForTest(),'Boss checkpoint survives leaving');
  await withReloadedEntry(null,false,async fresh=>{
    await fresh.startWithFont();const scene=fresh.mountInitialScene({style:{},addEventListener(){}},graphicsRecorder()).scene;
    assert.ok(fresh.savedRunForTest());fresh.showRunChoiceForTest();assert.equal(fresh.readRestart().world.isRunChoice,true);
    assert.equal(fresh.continueRunForTest(),true);assert.deepEqual(runSimulationState(fresh.readRestart().world),before);
    const restored=fresh.readRestart().world;assert.equal(restored.boss.contacts.has(restored.player.id),true);
    finishResumeTransfer(fresh);assert.equal(restored.phase,'boss');assert.equal(restored.score,before.score);
    assert.ok(scene);assert.equal(saved.has(RUN_SAVE_KEY),false);
  });
});

test('v10.1 restored entry slow motion lasts one active second and pauses its allowance with the game',()=>{
  persistenceRun();clickAction('pause');finishPausedTransfer();clickAction('leave');app.advanceUi(.7);app.continueRunForTest();finishResumeTransfer();
  const {scene,world}=app.readRestart();world.enemies=[];world.fragmentQueue=[];world.player.vx=world.player.vy=0;
  advanceScene(scene,.45);near(scene.timeScale,.3);near(app.resumeSecondsForTest(),.55);
  clickAction('pause');advanceScene(scene,2);near(app.resumeSecondsForTest(),.55);
  finishPausedTransfer();clickAction('resume');finishResumeTransfer();advanceScene(scene,.54);near(scene.timeScale,.3);
  advanceScene(scene,.02);near(app.resumeSecondsForTest(),0);near(scene.timeScale,1);
});

test('v10.1 an actual pull seamlessly takes over entry slow motion while a quick tap leaves it intact',()=>{
  persistenceRun();clickAction('pause');finishPausedTransfer();clickAction('leave');app.advanceUi(.7);app.continueRunForTest();finishResumeTransfer();
  const {scene,world}=app.readRestart(),pointer=inputCanvas(),p=world.player;world.enemies=[];world.fragmentQueue=[];p.vx=p.vy=0;
  pointer('pointerdown',p.x,p.y);advanceScene(scene,.05);pointer('pointerup',p.x,p.y);scene.update(0,0);
  assert.ok(app.resumeSecondsForTest()>.9);near(scene.timeScale,.3);
  pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+20,p.y);scene.update(0,0);
  near(app.resumeSecondsForTest(),0);near(scene.timeScale,.3);assert.equal(app.readRestart().drag.pending,false);
  advanceScene(scene,.3);near(scene.timeScale,.3,'gesture keeps its own independent slow-time budget');
  pointer('pointercancel');scene.update(0,0);near(scene.timeScale,1);
});

test('v10.1 reduced-motion restoration uses the same 0.6 scale as reduced-motion aiming',async()=>{
  persistenceRun();clickAction('pause');finishPausedTransfer();clickAction('leave');app.advanceUi(.7);
  await withReloadedEntry(null,true,async fresh=>{
    await fresh.startWithFont();const {scene}=fresh.mountInitialScene({style:{},addEventListener(){}},graphicsRecorder());
    fresh.continueRunForTest();finishResumeTransfer(fresh);near(scene.timeScale,.6);
    advanceScene(scene,.5);near(scene.timeScale,.6);
  });
});

test('v10.1 settlement and actual failure remove the checkpoint and interruptions cannot resurrect it',()=>{
  for(const reason of ['settlement','failure']){
    const {world,scene}=persistenceRun();clickAction('pause');finishPausedTransfer();assert.ok(saved.has(RUN_SAVE_KEY));
    if(reason==='settlement')clickAction('home');
    else {clickAction('resume');finishResumeTransfer();world.phase='over';world.emit('over');scene.handleEvents();}
    assert.equal(saved.has(RUN_SAVE_KEY),false,reason);
    windowListeners.get('pagehide').forEach(fn=>fn());assert.equal(saved.has(RUN_SAVE_KEY),false,reason);
  }
});

test('v10.1 failed checkpoint writes keep the player in the current paused run',t=>{
  const {world}=persistenceRun();const original=localStorage.setItem;
  t.mock.method(localStorage,'setItem',function(key,value){if(key===RUN_SAVE_KEY)throw Error('Quota exceeded');return original.call(this,key,value);});
  clickAction('pause');finishPausedTransfer();clickAction('leave');
  assert.equal(app.readRestart().screen,'play');assert.equal(app.readRestart().modal,'pause');assert.equal(app.readRestart().world,world);
  assert.equal(app.readRestart().paused,true);assert.equal(saved.has(RUN_SAVE_KEY),false);
  assert.match(element('#toast').textContent,/保存|存储/);
});


test('v10.1 restored clearing keeps entry slow motion through its first simulation frame',()=>{
  const {world,scene}=persistenceRun();
  world.stageKills=world.killTarget;world.beginClearing();world.events=[];world.clearing.elapsed=.1;
  clickAction('pause');finishPausedTransfer();clickAction('leave');app.advanceUi(.7);
  assert.equal(app.continueRunForTest(),true);finishResumeTransfer();
  assert.equal(app.readRestart().world.phase,'clearing');near(scene.timeScale,.3);near(app.resumeSecondsForTest(),1);
  scene.update(0,1);
  assert.equal(app.readRestart().world.phase,'clearing');near(scene.timeScale,.3);near(app.resumeSecondsForTest(),.999);
});

test('v10.1 a new run saves before its first event drain without retaining the previous reward world',()=>{
  const {world:oldWorld,scene}=persistenceRun();
  scene.rewardVisuals={world:oldWorld,flightAt:oldWorld.feedbackTime};
  clickAction('pause');finishPausedTransfer();clickAction('leave');app.advanceUi(.7);
  app.showRunChoiceForTest();assert.equal(app.chooseRunForTest('new-run'),true);
  const current=app.readRestart().world;
  assert.notEqual(current,oldWorld);assert.equal(current.startingUpgrades,true);
  assert.ok(current.events.some(event=>event.type==='upgrade'),'the opening reward event has not yet drained');
  windowListeners.get('pagehide').forEach(fn=>fn());
  const decoded=app.decodedRunForTest();assert.ok(decoded);
  assert.equal(decoded.world.score,0);assert.equal(decoded.world.startingUpgrades,true);
  assert.deepEqual(runSimulationState(decoded.world),runSimulationState(current));
  assert.notEqual(scene.rewardVisuals?.world,oldWorld);
});

test('v10.1 pagehide during saved-run arrival re-saves the exact restored world before gameplay starts',()=>{
  persistenceRun();clickAction('pause');finishPausedTransfer();clickAction('leave');app.advanceUi(.7);
  assert.equal(app.continueRunForTest(),true);
  const state=app.readRestart(),before=runSimulationState(state.world);
  assert.equal(state.transfer.target,'arena');assert.equal(saved.has(RUN_SAVE_KEY),false);
  windowListeners.get('pagehide').forEach(fn=>fn());
  const decoded=app.decodedRunForTest();assert.ok(decoded);assert.deepEqual(runSimulationState(decoded.world),before);
  assert.equal(app.readRestart().pauseOnArrival,true);finishResumeTransfer();
  assert.equal(app.readRestart().paused,true);assert.equal(app.readRestart().modal,'pause');
  assert.deepEqual(runSimulationState(app.readRestart().world),before);
});

test('v10.1 pagehide refreshes the checkpoint from a settings subpage of the pause menu',t=>{
  const {world}=persistenceRun();clickAction('pause');finishPausedTransfer();clickAction('settings');app.advanceUi(.6);
  assert.equal(app.readRestart().modal,'settings');assert.equal(app.readRestart().paused,true);
  const before=runSimulationState(world),original=localStorage.setItem,writes=[];
  t.mock.method(localStorage,'setItem',function(key,value){writes.push(key);return original.call(this,key,value);});
  windowListeners.get('pagehide').forEach(fn=>fn());
  assert.ok(writes.includes(RUN_SAVE_KEY));assert.equal(app.readRestart().modal,'settings');
  const decoded=app.decodedRunForTest();assert.ok(decoded);assert.deepEqual(runSimulationState(decoded.world),before);
});

test('v10.1 pulling in a restored reward choice ends the entry allowance without granting combat aim slow motion',()=>{
  const {world,scene}=persistenceRun();world.beginStartingUpgrades();
  for(let step=0;step<200&&world.phase!=='choose';step++)world.step(1/120);
  assert.equal(world.phase,'choose');world.events=[];
  clickAction('pause');finishPausedTransfer();clickAction('leave');app.advanceUi(.7);
  assert.equal(app.continueRunForTest(),true);finishResumeTransfer();
  const restored=app.readRestart().world,pointer=inputCanvas(),p=restored.player;
  near(app.resumeSecondsForTest(),1);near(scene.timeScale,.3);
  pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+20,p.y);scene.update(0,0);
  assert.ok(app.readRestart().drag);near(app.resumeSecondsForTest(),0);near(scene.timeScale,1);
  assert.equal(restored.phase,'choose');assert.equal(restored.choices.length,3);
  pointer('pointercancel');
});

test('v10.1 failed checkpoint deletion keeps voluntary settlement in pause until it can safely retry',t=>{
  const {world}=persistenceRun();clickAction('pause');finishPausedTransfer();
  const before=runSimulationState(world),original=localStorage.removeItem;
  const removal=t.mock.method(localStorage,'removeItem',()=>{throw Error('Storage removal unavailable');});
  clickAction('home');
  assert.equal(app.readRestart().modal,'pause');assert.equal(app.readRestart().paused,true);assert.equal(app.readRestart().result,null);
  assert.deepEqual(runSimulationState(world),before);assert.ok(app.savedRunForTest());
  assert.match(element('#toast').textContent,/存档|结算/);
  removal.mock.restore();assert.equal(localStorage.removeItem,original);
  clickAction('home');assert.equal(world.phase,'over');assert.equal(app.savedRunForTest(),null);
});

test('v10.1 automatic failure invalidates an undeletable checkpoint and still reaches settlement',t=>{
  const {world,scene}=persistenceRun();assert.equal(app.saveRunForTest(),true);
  assert.ok(app.savedRunForTest());
  t.mock.method(localStorage,'removeItem',()=>{throw Error('Storage removal unavailable');});
  world.phase='over';world.emit('over');scene.handleEvents();
  assert.equal(app.savedRunForTest(),null);
  assert.equal(JSON.parse(saved.get(RUN_SAVE_KEY)).format,'qiuqiule-run-ended');
  assert.ok(scene.ending);advanceScene(scene,.61);
  assert.equal(app.readRestart().modal,'over');assert.ok(app.readRestart().result);
  assert.equal(app.savedRunForTest(),null);
  windowListeners.get('pagehide').forEach(fn=>fn());assert.equal(app.savedRunForTest(),null);
});
