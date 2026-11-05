import {createSvgNode,isSvgMount} from './fixtures/svg-dom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CampaignWorld,LegacyCampaignWorld} from '../dist/campaign.js';
import {levelRecord} from '../dist/campaign-progress.js';
import {skinContour,contourArea} from '../dist/skins.js';
import {UPGRADE_DEFINITIONS,UPGRADES} from '../dist/upgrades.js';
import {impactShards} from '../dist/feedback.js';
import {BOSS_TIMING} from '../dist/physics.js';
import {companionGeometry,companionSvg} from '../dist/companions.js';
import {crownOutline} from '../dist/boss-visuals.js';

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
globalThis.document={createElementNS:createSvgNode,readyState:'loading',hidden:false,hasFocus:()=>true,documentElement:element('html'),createElement:tag=>element(`created-${tag}-${++createdElementCount}`),
  querySelector:element,
  querySelectorAll:selector=>selector==='.menu-panel'?['#settings-panel','#help-panel','#menu-transition-panel'].map(element):[],
  addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);}};
if(!globalThis.navigator)globalThis.navigator={};

const entry=new URL('../dist/game.js',import.meta.url);
const source=(await readFile(entry,'utf8')).replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${new URL(path,entry).href}'`);
// This adapter only exposes state to the test; it is not part of the shipped game.
const adapter=`
import {LegacyCampaignWorld as LegacyFixtureWorld} from '${new URL('../dist/classes/legacy.js',import.meta.url).href}';
export function seedRestart(origin,mode='endless',level=1){
  campaignOffer=null;pendingCampaignUpgrade=null;campaignAttemptId=null;campaignRecorded=false;
  aimMetrics=normalizeAimMetrics(null);runAimHoldDuration=1.2;
  endlessProgress=normalizeEndless(null,best);runDay=mode==='endless'?createEndlessRun('2030-01-01'):null;runNewRecord=false;recordPulse=recordCue=0;recordedStatsKey='';
  selectedMode=mode;currentLevel=level;selector=null;trackPointer=null;levelPointer=null;
  world=mode==='campaign'?new CampaignWorld(viewport.width,viewport.height,level):new World(viewport.width,viewport.height);
  if(mode==='campaign'){
    world.kills=12;world.spawned=20;world.completed=origin==='over';campaignProgress=normalizeProgress({completed:level,unlocked:Math.min(100,level+1)});
    if(origin==='over')campaignRecorded=true;
    else {campaignProgress=recordAttempt(campaignProgress,level);campaignAttemptId=levelRecord(campaignProgress,level).activeAttempt;}
  }
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
export function readRestart(){return {world,scene,screen,modal,paused,result,transfer,controlFlight,uiAnchor,releaseOverlay,pauseOnArrival,drag,selectedMode,currentLevel,campaignProgress,selector,levelPointer,choicePress,campaignOffer,campaignAttemptId,campaignRecorded};}
export function seedRenderer(graphics,width=390,height=844,arena=false){
  companionState=normalizeCompanionState(null);companionTween=null;companionClock=0;resetCompanionTrails();
  campaignOffer=null;pendingCampaignUpgrade=null;campaignAttemptId=null;campaignRecorded=false;$('#campaign-preflight').hidden=true;
  clearChoicePress();aimMetrics=normalizeAimMetrics(null);runAimHoldDuration=1.2;
  $('#feedback-demo').testViewport={width,height};
  // Legacy rendering fixtures isolate record celebration; the explicit progress
  // adapter below enables it for the new record and milestone scenarios.
  endlessProgress=normalizeEndless(null,best);runDay=createEndlessRun('2030-01-01');runBest=Number.MAX_SAFE_INTEGER;runNewRecord=false;recordPulse=recordCue=0;recordedStatsKey='';feedbackDemo=false;
  selectedMode='endless';selector=null;trackPointer=null;levelPointer=null;menuTransition=null;
  viewport=displayMetrics(width,height,1);home=new HomeWorld(width,height,'endless');
  world=arena?new World(width,height):null;screen=arena?'play':'home';
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
export function seedLevelRenderer(graphics,width=390,height=844,unlocked=100){
  seedRenderer(graphics,width,height);selectedMode='campaign';
  campaignProgress=normalizeProgress({completed:unlocked-1,unlocked});currentLevel=1;
  selector=new LevelSelector(width,height,unlocked);screen='levels';levelsReveal=1;
  return {selector,scene};
}
export function seedCampaignRenderer(graphics,width=390,height=844,level=1){
  seedRenderer(graphics,width,height,true);selectedMode='campaign';currentLevel=level;
  world=new CampaignWorld(width,height,level);
  campaignProgress=recordAttempt(normalizeProgress({completed:level-1,unlocked:level}),level);
  campaignAttemptId=levelRecord(campaignProgress,level).activeAttempt;
  return {world,scene};
}
// Exercise archived finite-enemy behavior explicitly; no registered level uses it.
export function seedLegacyRenderer(graphics,width=390,height=844,level=25){
  seedCampaignRenderer(graphics,width,height,level);world=new LegacyFixtureWorld(width,height,level);
  return {world,scene};
}
export function seedCampaignAttempt(raw=campaignProgress){
  campaignProgress=recordAttempt(normalizeProgress(raw),world.level);campaignAttemptId=levelRecord(campaignProgress,world.level).activeAttempt;campaignRecorded=false;
}
export function ensureCampaignScene(graphics){
  if(typeof scene.update==='function')return scene;
  boot();scene=game.scene;scene.g=graphics;
  scene.add={text(){return new Proxy({destroy(){}},{get:(target,key)=>target[key]||function(){return this;}});}};
  return scene;
}
export const showCampaignOffer=offerCampaign;
export const closeCampaignPreflight=closeCampaignOffer;
export const enterCampaign=enterLevel;
export const runCampaignTrial=startCampaignDemo;
export const installCampaignControls=installCampaignDemo;
export function setCampaignProgress(raw){campaignProgress=normalizeProgress(raw);return campaignProgress;}
export const saveCampaignCheckpoint=checkpointCampaign;
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
  for(const name of ['setCharge','stopCharge','impact','launch','wall','bossDefeat','rewardHit']){
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
export function openUnlockedSelection(unlocked,current=1){
  campaignProgress={completed:unlocked-1,unlocked};currentLevel=current;
  openLevels({...home.player});
  return selector;
}
export function seedSkins(raw=null,completed=0){
  skins=normalizeSkins(raw,completed);playerContour=skinContour(skins.enabled?{sides:skins.sides,variant:skins.variant}:0);
  skinTween=null;skinOverride=null;skinUnlock=null;lastUiPose=null;appearance=null;appearanceUrl=null;
  appearanceState=normalizeAppearanceState(null);appearanceTween=null;appearanceOverride=null;
  companionState=normalizeCompanionState(null);companionTween=null;companionClock=0;resetCompanionTrails();
  campaignProgress=normalizeProgress({completed});
}
export function readSkins(){return {skins,playerContour,skinOverride,skinTween,skinUnlock,lastUiPose,active:activeContour()};}
export function changeSkinEnabled(enabled){setSkinState(toggleSkins(skins,enabled));}
export function changeSkinSides(sides){setSkinState(selectSkin(skins,sides));}
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
export const hidePhotoForFrame=clearPhoto;
export function readAppearance(){return {appearance,appearanceUrl};}
export function seedAppearanceState(raw=null,{hasImage}={}){
  appearanceState=normalizeAppearanceState(raw,{hasImage});appearanceTween=null;appearanceOverride=null;
  return appearanceState;
}
export function readAppearancePresentation(){return {state:appearanceState,tween:appearanceTween,override:appearanceOverride,layers:appearanceLayers(),wardrobeTime};}
export const chooseAppearanceForTest=chooseAppearance;
export const grantAppearanceForTest=grantEndlessAppearance;
export const showResultForTest=openResult;
export function seedWardrobePresentation(time=.75){
  screen='home';modal='wardrobe';uiAnchor='wardrobe';transfer=null;skinUnlock=null;wardrobeTime=time;home.phase='external';
  return currentPlayerPose();
}
export function bindWardrobeControls(controls){const previous=wardrobeUi;wardrobeUi=controls;return ()=>{wardrobeUi=previous;};}
export const paintUiForTest=paintUiBall;
export const drawPlayerForTest=drawBall;
export function seedCompanions(raw=null,{best=0}={}){
  companionState=normalizeCompanionState(raw,{best});companionTween=null;companionClock=0;resetCompanionTrails();return companionState;
}
export function readCompanions(){return {state:companionState,tween:companionTween,clock:companionClock,layers:companionLayers()};}
export const readCompanionHistory=()=>structuredClone([...companionTrails.entries]);
export const chooseCompanionForTest=chooseCompanion;
export const advanceCompanions=updateCompanionVisual;
export const grantCompanionsForTest=grantEndlessCompanions;
export function recordCompanionDraws(){
  const original=drawPlayerCompanions,calls=[];
  drawPlayerCompanions=function(g,pose,alpha,contour,body){
    const first=g.shapes?.length||0,result=original(g,pose,alpha,contour,body);
    calls.push({pose:{...pose},alpha,contour:contour?.map(point=>({...point})),shapes:g.shapes?.slice(first)||[]});return result;
  };
  return {calls,restore(){drawPlayerCompanions=original;}};
}


export const startWithFont=bootWithFont;
export const renderLevelNumber=levelNumberPosition;
export function setNumberMeasureContext(context){numberMeasureContext=context;numberCenters.clear();}
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
        assert.equal(home.mode,mode);
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

test('level labels measure the normal UI face and remain centered by its actual glyph bounds',t=>{
  const context={measureText(text){
    assert.equal(this.font,'400 1000px GameSans, sans-serif');assert.equal(this.textAlign,'left');assert.equal(this.textBaseline,'alphabetic');
    assert.equal(text,'100');
    return {actualBoundingBoxLeft:7,actualBoundingBoxRight:1407,actualBoundingBoxAscent:710,actualBoundingBoxDescent:10};
  }};
  app.setNumberMeasureContext(context);t.after(()=>app.setNumberMeasureContext(null));
  const position=app.renderLevelNumber(100);
  near(position.x,-.7*.83);near(position.y,.35*.83);
});
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
  const campaign=app.readRestart().campaignOffer;
  if(campaign&&['campaign-upgrade','campaign-cancel','campaign-skip'].includes(action)){
    const scene=app.ensureCampaignScene(graphicsRecorder());
    for(let n=0;n<360&&(app.readRestart().transfer||app.readRestart().world?.phase!=='choose');n++)scene.update(0,1000/120);
    assert.equal(app.readRestart().world?.phase,'choose','wait for the real offer arrival and reward birth');
    for(const fn of listeners.get('click'))fn({target:{closest:()=>({dataset:{action,...dataset}})},detail:action==='campaign-upgrade'?0:1});
    for(let n=0;n<720&&(app.readRestart().world?.isCampaignOffer||action!=='campaign-upgrade'&&app.readRestart().transfer);n++)scene.update(0,1000/120);
    if(action==='campaign-upgrade')assert.ok(app.readRestart().world instanceof CampaignWorld,'keyboard selection launches, collides, confirms, then creates the campaign');
    return;
  }
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

test('selection hides guides, endless retains seven dots, and campaign draws its class guide with pull markers',()=>{
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
    assert.equal(dots.filter(d=>d.r===1.7).length,mode==='endless'?7:0);
    assert.equal(strokes.filter(w=>w===1.4).length,mode==='endless'?1:0);
    assert.equal(lines.length,mode==='levels'?0:1,'both battle modes retain the pointer-to-drag line');
    assert.equal(rings.filter(r=>r===4||r===8).length,mode==='levels'?0:2,'both battle modes retain the endpoint rings');
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
  if(mode==='campaign')assert.ok(active instanceof CampaignWorld||active instanceof LegacyCampaignWorld,'exercise real campaign rules and renderer');
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


for(const origin of ['over','pause'])test(`campaign ${origin} restart preserves migrated progress and waits for a new local upgrade`,()=>{
  const previous=app.seedRestart(origin,'campaign',21),from=app.sourcePose();
  const progressBefore={...app.readRestart().campaignProgress};
  clickRestart();
  let state=app.readRestart();
  assert.equal(state.drag,null);assert.equal(state.world,null);assert.equal(state.screen,'levels');
  assert.equal(state.selectedMode,'campaign');assert.equal(state.currentLevel,21);
  assert.deepEqual(state.transfer.from,from);assert.equal(state.transfer.target,'levels');
  assert.equal(state.controlFlight,null);
  app.advanceUi(.65);state=app.readRestart();assert.equal(state.campaignOffer.choices.length,2);
  assert.equal(levelRecord(state.campaignProgress,21).attempts,origin==='pause'?1:0,'preflight itself starts no new attempt');
  const chosen=state.campaignOffer.choices[0];clickAction('campaign-upgrade',{upgrade:chosen.id});
  state=app.readRestart();const w=state.world;
  assert.equal(element('#control-transfers').children.length,0);
  assert.notEqual(w,previous);assert.equal(w.mode,'campaign');assert.equal(w.level,21);assert.equal(w.config.classId,'wall');
  assert.equal(w.kills,0);assert.equal(w.completed,false);assert.equal(w.time,0);assert.equal(w.score,0);assert.equal(w.stage,1);
  assert.equal(w.shotsUsed,0);assert.equal(w.remaining,w.budget);assert.equal(w.upgradeId,chosen.id);
  assert.equal(w.player.r,w.unit*w.config.playerRadius);assert.equal(w.player.vx,0);assert.equal(w.player.vy,0);
  assert.deepEqual(w.buffs,{[chosen.id]:1});assert.deepEqual(w.choices,[]);
  assert.equal(state.campaignProgress.completed,progressBefore.completed,'retries retain confirmed historical completion');
  assert.equal(state.campaignProgress.unlocked,progressBefore.unlocked,'retries retain available levels');
  const record=levelRecord(state.campaignProgress,21);
  assert.equal(record.attempts,origin==='pause'?2:1);assert.equal(record.abandoned,origin==='pause'?1:0);
  assert.equal(record.rating,0,'historical clears cannot manufacture new scoring dots');
  assert.equal(state.controlFlight,null);assert.equal(state.paused,true);assert.equal(state.transfer.target,'arena');
  assert.equal(element('#hud').classList.contains('campaign'),true);
  const startTransform=element('#ui-ball').style.transform,geometry=w.statics.map(b=>({x:b.x,y:b.y,hp:b.hp}));
  app.advanceUi(.325);assert.notEqual(element('#ui-ball').style.transform,startTransform);
  assert.equal(w.time,0);assert.deepEqual(w.statics.map(b=>({x:b.x,y:b.y,hp:b.hp})),geometry);
  app.advanceUi(.325);state=app.readRestart();
  assert.equal(state.paused,false);assert.equal(state.transfer,null);assert.equal(state.controlFlight,null);
  assert.equal(w.time,0);w.step(1/120);assert.ok(w.time>0);
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
function assertStageProgress(world){
  const progress=element('#stage-progress');
  assert.equal(progress.children.filter(dot=>dot.className.startsWith('stage-dot')).length,10);
  assert.equal(progress.children.filter(dot=>dot.className==='stage-dot filled').length,Math.floor(Math.min(1,world.stageKills/world.killTarget)*10+1e-9));
  assert.equal(progress.attributes['aria-label'],`本阶段击杀 ${world.stageKills}，目标 ${world.killTarget}`);
}
test('stable HUD frames make no DOM writes and progress updates on the same frame',t=>{
  const {world}=app.seedRenderer(graphicsRecorder(),390,844,true);
  world.phase='battle';world.score=73;world.stageKills=0;app.resetScoreHud();
  const progress=element('#stage-progress'),score=element('#score'),goal=element('#campaign-goal'),rating=element('#campaign-rating-status');
  const dots=[...progress.children],writes=[];
  const watch=(node,property)=>{
    let value=node[property];
    Object.defineProperty(node,property,{configurable:true,get:()=>value,set(next){value=next;writes.push(property);}});
    t.after(()=>{delete node[property];node[property]=value;});
  };
  for(const [node,props] of [[score,['textContent']],[score.style,['transform','color']],[goal,['textContent','hidden']],
    [progress,['hidden','innerHTML']],[rating,['hidden','textContent']],[element('#hud').style,['opacity']]]){
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
  const campaign=app.seedCampaignRenderer(graphicsRecorder()).world;app.updateScoreHud();
  const campaignDots=[...progress.children];assert.equal(campaignDots.length,3);assert.match(progress.attributes['aria-label'],/通关可得 3 点/);
  for(const dot of campaignDots)watch(dot,'className');
  const title=t.mock.method(rating,'setAttribute');
  writes.length=0;attribute.mock.resetCalls();replace.mock.resetCalls();
  for(let frame=0;frame<60;frame++)app.updateScoreHud(1/60);
  assert.deepEqual(writes,[]);assert.equal(attribute.mock.callCount()+title.mock.callCount()+replace.mock.callCount(),0);
  campaign.shotsUsed=campaign.config.threePointShots+1;app.updateScoreHud();
  assert.deepEqual(progress.children,campaignDots);assert.equal(campaignDots[2].className,'stage-dot');assert.match(progress.attributes['aria-label'],/通关可得 2 点/);
  const endless=app.seedRenderer(graphicsRecorder(),390,844,true).world;endless.phase='battle';app.updateScoreHud();
  assertStageProgress(endless);assert.equal(progress.attributes.title,undefined);assert.equal(rating.hidden,true);
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

test('tapping a modern level offers two local upgrades before the unchanged player arrival animation',()=>{
  for(const [width,height] of [[390,844],[844,390]]){
    const {selector,scene}=app.seedLevelRenderer(graphicsRecorder(),width,height,50),pointer=inputCanvas(width,height);
    const target=selector.visibleBalls.find(b=>b.level===50),from={...selector.player};
    pointer('pointerdown',target.x,target.y);
    assert.equal(app.readRestart().screen,'levels');assert.equal(selector.action,null,'pressing alone never enters a level');
    pointer('pointerup',target.x,target.y);
    assert.deepEqual(selector.action,{type:'level',level:50});
    scene.update(0,0);
    let state=app.readRestart();
    assert.equal(state.screen,'play');assert.equal(state.world.isCampaignOffer,true);
    assert.deepEqual(state.transfer.from,from);
    assert.equal(state.campaignOffer.level,50);assert.equal(state.campaignOffer.choices.length,2);
    assert.equal(new Set(state.campaignOffer.choices.map(choice=>choice.id)).size,2);
    assert.equal(element('#campaign-preflight').hidden,false);
    assert.equal(levelRecord(state.campaignProgress,50).attempts,0,'viewing the choices is not a formal attempt');
    const upgrade=state.campaignOffer.choices[0];
    clickAction('campaign-upgrade',{upgrade:upgrade.id});
    state=app.readRestart();const world=state.world;
    assert.ok(world instanceof CampaignWorld);assert.equal(world.level,50);
    assert.equal(state.screen,'play');assert.equal(state.currentLevel,50);assert.equal(state.selectedMode,'campaign');
    assert.equal(state.paused,true);assert.equal(state.transfer.target,'arena');assert.equal(state.transfer.duration,.65);
    assert.equal(state.transfer.from.r,state.world.unit);assert.equal(state.drag,null);assert.equal(state.levelPointer,null);
    assert.equal(world.time,0);assert.equal(world.config.r,0);assert.equal(world.shotsUsed,0);
    assert.equal(state.campaignOffer,null);assert.equal(element('#campaign-preflight').hidden,true);
    app.advanceUi(.325);
    assert.equal(app.readRestart().paused,true);assert.equal(world.time,0);
    assert.equal(world.shotsUsed,0);
    app.advanceUi(.325);state=app.readRestart();
    assert.equal(state.transfer,null);assert.equal(state.paused,false);assert.equal(world.time,0);
    assert.equal(state.campaignProgress.completed,49);assert.equal(state.campaignProgress.unlocked,50);
    assert.equal(levelRecord(state.campaignProgress,50).attempts,1);
    assert.equal(levelRecord(state.campaignProgress,50).upgradeChoices[upgrade.id],1);
    world.step(1/120);assert.ok(world.time>0);
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
    const g=graphicsRecorder(),{selector,scene}=app.seedLevelRenderer(g,390,844,49),pointer=inputCanvas();
    scene.update(0,0);advanceScene(scene,Math.PI/(2*1.3));
    const p=selector.player,before=outlineBounds(bodyShapes(g)[0]);
    near(renderedHomeSquash(g,p),.035);near(p.squash,0,'breathing remains a render-only state');
    const target=destination==='home'?selector.returnBall:selector.visibleBalls.find(b=>b.level===49);
    pointer('pointerdown',target.x,target.y);pointer('pointerup',target.x,target.y);scene.update(0,0);
    if(destination==='level')assert.equal(app.readRestart().campaignOffer.level,49);
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
      }else {
        assert.deepEqual(frequencies,interaction==='locked'?[150]:[680]);
        if(interaction==='level'){
          clickAction('campaign-upgrade',{upgrade:app.readRestart().campaignOffer.choices[0].id});
          assert.deepEqual(audio.calls.map(args=>args[0]),[680,480,660,680,420],'offer birth/readiness precede collision-confirmed entry');
        }
      }
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
      assert.equal(state.screen,'play');assert.equal(state.world.isCampaignOffer,true);assert.equal(state.campaignOffer?.level,50);
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

test('all returns home keep the final overlay eyes identical to the resumed canvas face',()=>{
  try{
    for(const origin of ['settings','wardrobe','over','levels'])for(const sides of [0,6])for(const [width,height] of [[390,844],[844,390]]){
      const g=graphicsRecorder();
      const state=origin==='levels'?app.seedLevelRenderer(g,width,height):app.seedRenderer(g,width,height,origin==='over');
      app.seedSkins(sides?{enabled:true,sides:6,unlocked:6}:null,sides?10:0);
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
      }else{
        state.selector.player.lookX=.07;state.selector.player.lookY=-.05;
        clickAction('home');
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
  }finally{app.seedSkins();}
});
function assertSameContour(actual,expected,tolerance=1e-5){
  assert.equal(actual.length,expected.length,'retain corresponding contour points');
  for(let i=0;i<actual.length;i++)assert.ok(Math.hypot(actual[i].x-expected[i].x,actual[i].y-expected[i].y)<tolerance,`contour point ${i} changed at the handoff`);
}

test('selection clicks preserve rebound contours and relaxing eyes at the canvas-to-SVG handoff in both destinations',()=>{
  for(const destination of ['level','home'])for(const phase of ['positive','negative','relaxing']){
    const g=graphicsRecorder(),{selector,scene}=app.seedLevelRenderer(g,390,844,49),pointer=inputCanvas();
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
    const target=destination==='home'?selector.returnBall:selector.visibleBalls.find(b=>b.level===49);
    pointer('pointerdown',target.x,target.y);pointer('pointerup',target.x,target.y);scene.update(0,0);
    if(destination==='level')assert.equal(app.readRestart().campaignOffer.level,49);
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

test('archived LegacyCampaignWorld retains finite enemies and direct attribute upgrades without boss or crown scenes',()=>{
  for(const level of [5,9,49]){
    const g=graphicsRecorder(),{world,scene}=app.seedLegacyRenderer(g,390,844,level);
    world.stage=5;
    for(let kill=0;kill<world.config.upgradeEvery;kill++){
      let enemy=world.enemies.find(body=>body.hp>0);
      if(!enemy){world.spawnEnemy();enemy=world.enemies.find(body=>body.hp>0);}
      world.damage(enemy,1e6);scene.update(0,0);
    }
    assert.equal(world.mode,'campaign');assert.equal(world.phase,'battle');assert.equal(world.boss,null);
    assert.equal(world.kills,world.config.upgradeEvery);assert.equal(world.upgrades,1);assert.equal(world.score,0);
    assert.equal(world.totalEnemies,world.config.totalEnemies);assert.deepEqual(world.choices,[]);
    assert.equal(crownShapes(g).length,0);assert.equal(element('#choice-labels').children.length,0);
    assert.deepEqual(scene.testLabels.map(label=>label.text),['弹力 +14%']);
  }
});

function finishCampaign(world,scene){
  if(world.config.implemented){
    assert.equal(world.config.r,0,'this milestone helper exercises the real Peggle flow');
    assert.equal(world.shoot(-world.maxPull,0),true);
    const targets=world.statics.filter(pin=>pin.target),last=targets.at(-1);
    for(const target of targets.slice(0,-1))world.rules.onStaticHit(target,{normalSpeed:world.baseSpeed});
    Object.assign(world.player,{x:last.x,y:last.y+last.r+world.player.r+.5,vx:0,vy:-world.unit*20,feedbackFreeze:0});
    world.step(1/120);scene.update(0,0);
    assert.equal(world.phase,'campaign-celebrate','last target collision starts frenzy before any settlement');
    assert.equal(app.readRestart().result,null);assert.equal(app.readSkins().skinUnlock,null);
    advanceScene(scene,1);
    assert.equal(world.phase,'campaign-celebrate');assert.equal(app.readSkins().skinUnlock,null,'skin must wait for the full frenzy and remaining-ball count');
    for(let frame=0;frame<600&&world.phase!=='over';frame++)scene.update(0,1000/120);
    assert.equal(world.phase,'over');assert.equal(world.targetsRemaining,0);
    assert.equal(world.celebration.bonusRemaining,0);return;
  }
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
    app.seedCampaignAttempt();
    const original=app.readSkins().playerContour;
    finishCampaign(run.world,run.scene);
    let state=app.readRestart(),skin=app.readSkins();
    assert.equal(state.result,null,'settlement does not appear before the reward animation');
    assert.equal(state.modal,'skin-unlock');assert.equal(state.paused,true);
    assert.equal(skin.skinUnlock.sides,6);assert.equal(skin.skinUnlock.ready,false);
    assert.equal(skin.skinUnlock.phase,'enter');assert.equal(element('#skin-unlock-continue').disabled,true);
    let storedCampaign=JSON.parse(saved.get('qiuqiule-campaign'));
    assert.equal(storedCampaign.completed,10);assert.equal(storedCampaign.unlocked,11);
    assert.equal(levelRecord(storedCampaign,10).rating,3);assert.equal(levelRecord(storedCampaign,10).wins,1);
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
    storedCampaign=JSON.parse(saved.get('qiuqiule-campaign'));
    assert.equal(storedCampaign.completed,10);assert.equal(storedCampaign.unlocked,11);
    assert.equal(levelRecord(storedCampaign,10).rating,3);

    // Milestone 20 previews seven sides but keeps an equipped six-sided skin.
    run=app.seedCampaignRenderer(graphicsRecorder(),390,844,20);
    app.seedSkins({enabled:true,sides:6,unlocked:6},19);
    app.seedCampaignAttempt();
    const equipped=app.readSkins().playerContour;
    finishCampaign(run.world,run.scene);
    assert.equal(app.readSkins().skinUnlock.sides,7);assert.equal(app.readRestart().result,null);
    storedCampaign=JSON.parse(saved.get('qiuqiule-campaign'));
    assert.equal(storedCampaign.completed,20);assert.equal(storedCampaign.unlocked,21);
    assert.equal(levelRecord(storedCampaign,20).rating,3);
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
      const g=graphicsRecorder(),{selector,scene}=app.seedLevelRenderer(g,390,844,49),pointer=inputCanvas();
      app.seedSkins({enabled:true,sides:6,unlocked:6},49);
      const p=selector.player,physical={r:p.r,mass:p.mass};scene.update(0,0);
      if(rebound){
        pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x+selector.maxPull,p.y);
        pointer('pointerup',p.x+selector.maxPull,p.y);advanceScene(scene,.82/12);
        assert.equal(selector.phase,'wobble');
      }else advanceScene(scene,.2);
      const rendered=bodyShapes(g)[0].points.slice(0,-1);
      const target=destination==='home'?selector.returnBall:selector.visibleBalls.find(b=>b.level===49);
      pointer('pointerdown',target.x,target.y);pointer('pointerup',target.x,target.y);scene.update(0,0);
    if(destination==='level')assert.equal(app.readRestart().campaignOffer.level,49);
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

test('v7.2 real ordinary hits dispatch their graded sound and haptic while light hits paint no flash',t=>{
  const previousVibrate=navigator.vibrate,pulses=[];
  navigator.vibrate=value=>pulses.push(value);
  const audio=app.recordFeedbackAudio();
  t.after(()=>{audio.restore();if(previousVibrate===undefined)delete navigator.vibrate;else navigator.vibrate=previousVibrate;app.setFeedbackStrength(.6);});
  for(const [maxHp,tier] of [[10000,'light'],[500,'medium'],[150,'heavy']]){
    const {world,scene,g}=feedbackRun(app,.6);scene.clock=1;scene.hitSoundAt=0;
    audio.calls.length=0;pulses.length=0;
    const {enemy,hit}=gradedFeedbackContact(world,{maxHp});
    assert.equal(hit.hitTier,tier);assert.equal(hit.lethal,false);
    scene.update(0,0);
    const sounds=audio.calls.filter(call=>call.name==='impact');
    assert.equal(sounds.length,tier==='light'?0:1);
    assert.deepEqual(pulses,tier==='heavy'?[12]:[]);
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

test('campaign impacts keep their audio context while exterior walls use the shared low-speed gate',t=>{
  const g=graphicsRecorder(),{world,scene}=app.seedLegacyRenderer(g,390,844,1),audio=app.recordFeedbackAudio();
  app.setFeedbackStrength(.6);scene.clock=1;scene.hitSoundAt=0;
  t.after(()=>{audio.restore();app.setFeedbackStrength(.6);});
  const {enemy,hit}=gradedFeedbackContact(world,{maxHp:10000});
  assert.ok(hit.damage/hit.maxHp<.1);assert.ok(enemy.hitAlpha>0);
  scene.update(0,0);
  const impact=audio.calls.find(call=>call.name==='impact');assert.ok(impact);
  assert.equal(impact.args[0].kind,'hit');assert.notEqual(impact.args[0].endless,true);
  scene.clock+=.1;world.events=[];const p=world.player;
  Object.assign(p,{x:world.arenaBounds.left+p.r-.1,y:400,vx:-world.baseSpeed*.1,vy:0});
  world.wall(p);scene.update(0,0);
  assert.equal(audio.calls.filter(call=>call.name==='wall').length,0,'quiet campaign exterior contacts are silent');
  Object.assign(p,{x:world.arenaBounds.left+p.r-.1,y:400,vx:-world.baseSpeed*.5,vy:0});
  world.wall(p);scene.update(0,0);
  const wall=audio.calls.find(call=>call.name==='wall');assert.ok(wall);
  assert.notEqual(wall.args[1]?.endless,true);
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

test('tap, cancel, interruption, campaign and acceptance-demo gestures do not contaminate local aim calibration',t=>{
  const before=saved.get('qiuqiule-aim'),baseline={version:1,completedCount:3,samples:[.3,.4,.5]};
  t.after(()=>{if(before===undefined)saved.delete('qiuqiule-aim');else saved.set('qiuqiule-aim',before);document.hidden=false;app.seedRenderer(graphicsRecorder());app.setFeedbackStrength(.6);});
  for(const kind of ['tap','cancel','pause','background','demo','campaign']){
    const run=kind==='campaign'?app.seedCampaignRenderer(graphicsRecorder()):controlRun();
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

test('v7.11 restore defaults synchronizes preferences and persistence while preserving records, unlocks, photos and equipped cosmetics',async()=>{
  const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  assert.match(html,/data-action="restore-defaults"/);assert.doesNotMatch(html,/data-action="export(?:-aim)?"/);
  const defaults={player:'#252720',enemy:'#e88c72',bg:'#f4f3eb',sound:true,haptic:true,expressions:true,bgmVolume:.55,sfxVolume:.75,juice:.6};
  const prior=new Map(saved);
  try{
    for(const appearance of ['original','custom','big-eye'])await withReloadedEntry({player:'#8040a0',enemy:'#806040',bg:'#111111',sound:false,haptic:false,expressions:false,bgmVolume:.12,sfxVolume:.23,juice:.2},false,fresh=>{
      fresh.seedRenderer(graphicsRecorder());fresh.seedSkins({enabled:true,sides:8,unlocked:11},50);
      fresh.seedEndless({best:72000,maxStage:25,maxCombo:12});fresh.seedCompanions({selected:'moon-3',unlocked:9});
      fresh.seedAimStats({completedCount:30,samples:Array(30).fill(1.05)});
      const photos=fresh.recordCompositePhotos(true),image=fresh.readAppearance().appearance;
      fresh.seedAppearanceState({selected:appearance==='big-eye'?'custom':appearance,bigEyeUnlocked:true},{hasImage:true});
      if(appearance==='big-eye'){assert.equal(fresh.chooseAppearanceForTest('big-eye'),true);fresh.advanceSkin(.14);}
      const progress=structuredClone(fresh.readRestart().campaignProgress),skins=structuredClone(fresh.readSkins().skins),companions=structuredClone(fresh.readCompanions().state),endless=structuredClone(fresh.readEndless().progress),aim=structuredClone(fresh.readAimStats());
      saved.set('qiuqiule-appearance','data:image/png;base64,test-existing-photo');
      const preserved=new Map([...saved].filter(([key])=>!['qiuqiule-settings','qiuqiule-appearance-state'].includes(key)));
      let refreshed=0;const restoreWardrobe=fresh.bindWardrobeControls({refresh(){refreshed++;}});
      try{
        listeners.get('click').at(-1)({target:{closest:()=>({dataset:{action:'restore-defaults'}})},detail:1});
        assert.deepEqual(fresh.readFeedbackSettings(),defaults);assert.deepEqual(JSON.parse(saved.get('qiuqiule-settings')),defaults);
        for(const key of ['player','enemy','bg']){assert.equal(element('#'+key+'-color').value,defaults[key]);assert.equal(element('#'+key+'-hex').textContent,defaults[key].toUpperCase());}
        for(const key of ['sound','haptic','expressions'])assert.equal(element('#'+key+'-toggle').attributes['aria-checked'],'true');
        for(const [key,value]of [['bgm',55],['sfx',75]]){assert.equal(element('#'+key+'-volume').value,value);assert.equal(element('#'+key+'-value').value,value+'%');}
        assert.equal(element('#feedback-strength').value,60);assert.equal(element('#feedback-value').value,'60%');
        assert.equal(element('html').style['--ink'],'#252720');assert.equal(refreshed,1);
        assert.equal(fresh.readAppearancePresentation().tween,null,'an old color fade cannot resurrect a pre-reset preference');
        assert.equal(fresh.readAppearancePresentation().state.selected,appearance);assert.equal(fresh.readAppearance().appearance,image);
        assert.deepEqual(fresh.readRestart().campaignProgress,progress);assert.deepEqual(fresh.readSkins().skins,skins);
        assert.deepEqual(fresh.readCompanions().state,companions);assert.deepEqual(fresh.readEndless().progress,endless);assert.deepEqual(fresh.readAimStats(),aim);
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

test('archived campaign retains its readiness gate, captured-speed shot and full-speed simulation during drag',()=>{
  const g=graphicsRecorder(),{world,scene}=app.seedLegacyRenderer(g),pointer=inputCanvas(),p=world.player;
  world.enemies=[];world.spawnTimer=Infinity;app.setFeedbackStrength(1);
  p.vx=world.readySpeed*1.5;p.vy=0;pointer('pointerdown',p.x,p.y);assert.equal(app.readRestart().drag,null);
  p.vx=world.unit*4;const carried=p.vx,start={x:p.x,y:p.y};
  pointer('pointerdown',start.x,start.y);pointer('pointermove',start.x,start.y+world.maxPull*.5);advanceScene(scene,.2);
  near(scene.timeScale,1);near(world.time,.2);assert.ok(p.vx<carried*.2,'campaign keeps its original drag brake');
  pointer('pointerup',start.x,start.y+world.maxPull*.5);
  const launch=Math.min(world.unit*60,world.baseSpeed*.5*Math.sqrt(world.energy/world.density));
  near(p.vx,0);near(p.vy,-launch-carried);app.setFeedbackStrength(.6);
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

test('charge thresholds vibrate once per drag and cancellation immediately stops the charge sound',t=>{
  const {world}=feedbackRun(),pointer=inputCanvas(),audio=app.recordFeedbackAudio(),pulses=[];
  const previousVibrate=navigator.vibrate;
  navigator.vibrate=value=>pulses.push(value);
  t.after(()=>{audio.restore();if(previousVibrate===undefined)delete navigator.vibrate;else navigator.vibrate=previousVibrate;app.setFeedbackStrength(.6);});
  const p=world.player,move=amount=>pointer('pointermove',p.x+world.maxPull*amount,p.y);
  pointer('pointerdown',p.x,p.y);
  for(const amount of [.49,.5,.65,.8,.9,1,.4,.8,1])move(amount);
  assert.deepEqual(pulses,[6,8,12]);
  assert.equal(audio.calls.filter(c=>c.name==='setCharge').length,9);
  pointer('pointercancel');assert.equal(app.readRestart().drag,null);assert.equal(audio.calls.at(-1).name,'stopCharge');
  pointer('pointerdown',p.x,p.y);move(.5);assert.deepEqual(pulses,[6,8,12,6],'a fresh drag rearms the threshold');
  pointer('lostpointercapture');assert.equal(audio.calls.at(-1).name,'stopCharge');
  pointer('pointerdown',p.x,p.y);move(.8);pointer('pointerup',p.x+world.maxPull*.8,p.y);
  assert.equal(audio.calls.at(-1).name,'stopCharge','release stops the sustained tone before the launch event is played');
  assert.equal(world.events.filter(e=>e.type==='shoot').length,1,'cancellation never launches a ball');
});

test('real dragging leaves the border, canvas and collision bounds fixed while haptic and charge audio remain active',t=>{
  const {g,world,scene}=feedbackRun(),pointer=inputCanvas(),p=world.player,audio=app.recordFeedbackAudio(),pulses=[];
  world.enemies=[];const previousVibrate=navigator.vibrate;navigator.vibrate=value=>pulses.push(value);
  t.after(()=>{pointer('pointercancel');audio.restore();if(previousVibrate===undefined)delete navigator.vibrate;else navigator.vibrate=previousVibrate;app.setFeedbackStrength(.6);});
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
  assert.deepEqual(pulses,[6,8,12]);assert.equal(audio.calls.filter(c=>c.name==='setCharge').length,8);
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
  assert.equal(element('#stage-progress').hidden,true);near(scene.timeScale,1);
  advanceScene(scene,world.rewardTiming.transition-.01-world.phaseTime);assert.equal(world.phase,'transition');
  advanceScene(scene,.02);assert.equal(world.phase,'choose');assert.equal(world.choices.length,3);assert.equal(element('#score').textContent,'1395');
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
    levels:()=>app.openUnlockedSelection(100),
    restart:()=>clickRestart(),
    campaign:()=>app.runCampaignTrial(1,'density'),
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

test('injured endless bodies keep their display size through death and result transfers while campaign radii stay original',()=>{
  for(const mode of ['endless','campaign']){
    let g=graphicsRecorder(),run=mode==='campaign'?app.seedCampaignRenderer(g):app.seedRenderer(g,390,844,true),{world,scene}=run;
    app.setFeedbackStrength(1);world.enemies=[];world.spawnTimer=Infinity;world.floorTimer=Infinity;
    const enemy=rhythmEnemy(world,90,240),r=enemy.r;enemy.hp=enemy.maxHp*.5;scene.update(0,0);
    const ink=parseInt(app.readFeedbackSettings().enemy.slice(1),16),body=()=>g.shapes.find(shape=>shape.type==='path'&&shape.color===ink&&shape.points.length===193);
    near(outlineBounds(body()).width,2*r*(mode==='campaign'?1:.91));near(enemy.r,r);
    if(mode==='campaign')assert.equal(world.shoot(-7,0),true);
    world.damage(enemy,enemy.hp);world.enemies=[];scene.update(0,0);
    assert.equal(scene.impactGhosts.length,1);near(outlineBounds(body()).width,2*r*(mode==='campaign'?1:.82));near(enemy.r,r);
    g=graphicsRecorder();run=mode==='campaign'?app.seedCampaignRenderer(g):app.seedRenderer(g,390,844,true);({world,scene}=run);world.enemies=[];
    const source=rhythmEnemy(world,90,240);source.hp=source.maxHp*.5;
    world.phase='over';world.emit('over');scene.update(0,0);if(mode==='endless')scene.advanceEnding(.6);
    near(app.readRestart().controlFlight.items[0].from.r,source.r*(mode==='campaign'?1:.91));
    if(mode==='campaign'){assert.equal(element('#hud').hidden,true);assert.equal(element('#result-reason').hidden,false);}
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

test('the final legacy campaign kill clears its frozen target and zoom before the result transfer',()=>{
  const {world,scene}=app.seedLegacyRenderer(graphicsRecorder(),390,844,5);
  app.setFeedbackStrength(1);world.spawnTimer=Infinity;world.spawned=world.totalEnemies;world.kills=world.totalEnemies-1;
  const event=collideFeedbackEnemy(world);assert.ok(event.freezeDuration>0);
  assert.ok(world.events.some(e=>e.type==='over'),'the actual final kill emits the campaign completion event');
  scene.update(0,0);
  assert.ok(app.readRestart().result?.completed);assert.equal(app.readRestart().transfer.target,'over');
  assert.equal(scene.impactGhosts.length,0);assert.equal(scene.zoomPulse,null);assert.equal(scene.feedbackCamera,null);
  assert.equal(element('#game').style.transform,'none');
  app.advanceUi(.82);app.setFeedbackStrength(.6);
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

function upgradeRun(module=app,{width=390,height=844,strength=1,random=null,count=3}={}){
  const g=graphicsRecorder(),run=module.seedRenderer(g,width,height,true),{world,scene}=run;
  module.setFeedbackStrength(strength);world.enemies=[];world.events=[];
  if(random)world.random=random;
  world.spawnTimer=world.floorTimer=world.introTimer=Infinity;world.wave=null;world.fragmentQueue=[];
  world.gamblerRewardPending=count===5;
  world.beginUpgrade();scene.update(0,0);advanceScene(scene,world.rewardTiming.transition+.01);
  assert.equal(world.phase,'choose');
  return {g,...run,pointer:inputCanvas(width,height,module)};
}

test('a real reward long press shows its diagram after 300 ms while residual motion waits, then releases without selecting or shooting',t=>{
  const {world,scene,g,pointer}=upgradeRun(),choice=world.choices[0],p=world.player,events=observeWorldEvents(world);
  t.after(()=>{pointer('pointercancel');app.setFeedbackStrength(.6);});
  Object.assign(p,{x:choice.x-choice.r-p.r-8,y:choice.y,vx:200,vy:0});
  const original={x:p.x,y:p.y,vx:p.vx,time:world.feedbackTime},insideDiagram=shape=>shape.points?.length===96&&shape.color===0x252720&&Math.hypot(outlineBounds(shape).cx-choice.x,outlineBounds(shape).cy-choice.y)<choice.r;
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
    pointer('pointerdown',choice.x,choice.y);advanceScene(scene,.31);assert.equal(fresh.readRestart().choicePress.active,true);
    const diagram=()=>{
      const body=g.shapes.find(shape=>shape.type==='path'&&shape.points?.length===96&&Math.abs(outlineBounds(shape).cx-choice.x)<1&&outlineBounds(shape).width>choice.r*1.9);
      const cy=outlineBounds(body).cy;
      return g.shapes.filter(shape=>shape.points?.length===96&&shape.color===0x252720&&Math.hypot(outlineBounds(shape).cx-choice.x,outlineBounds(shape).cy-choice.y)<choice.r).map(shape=>shape.points.map(point=>({x:point.x-choice.x,y:point.y-cy})));
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

test('three and five real reward offers keep distinct eligible balls and select exactly one through physical contact',t=>{
  t.after(()=>{app.prepareNormalGame();app.setFeedbackStrength(.6);});
  for(const count of [3,5]){
    const g=graphicsRecorder();app.seedRenderer(g);app.runFeedbackDemo('choices-'+count);
    const {world,scene}=app.readRestart(),events=observeWorldEvents(world);scene.update(0,0);
    assert.equal(world.phase,'choose');assert.equal(world.choices.length,count);assert.equal(new Set(world.choices.map(choice=>choice.id)).size,count);
    if(count===5){
      assert.equal(world.choices.filter(choice=>choice.y<world.player.y).length,3,'gambler puts three offers above the actual player');
      assert.equal(world.choices.filter(choice=>choice.y>world.player.y).length,2,'gambler puts two offers below the actual player');
    }
    assert.equal(element('#choice-labels').children.filter(node=>node.className==='choice-label').length,count);
    assert.ok(world.choices.every(choice=>UPGRADES[choice.id]&&choice.rings==={regular:0,special:1,risk:2}[choice.kind]));
    const faces=world.choices.map(choice=>g.shapes.find(shape=>shape.type==='path'&&shape.points?.length===96&&Math.abs(outlineBounds(shape).cx-choice.x)<1&&Math.abs(outlineBounds(shape).cy-choice.y)<3&&outlineBounds(shape).width>choice.r*1.9));
    assert.ok(faces.every(Boolean));assert.equal(new Set(faces.map(shape=>shape.color)).size,1,'rarity uses outlines, not different reward colors');
    const choice=world.choices[0],before=world.buffs[choice.id]||0;
    Object.assign(world.player,{x:choice.x,y:choice.y,vx:0,vy:0});scene.update(0,1000/120);
    assert.equal(world.phase,'reward');assert.equal(world.buffs[choice.id],before+1);assert.equal(world.choices.length,0);
    assert.equal(events.filter(event=>event.type==='buff').length,1);assert.equal(world.pendingUpgradeBoost,true);
    advanceScene(scene,world.rewardTiming.rest+.01);assert.equal(world.phase,'battle');assert.equal(events.filter(event=>event.type==='buff').length,1);
    assert.equal(world.choices.length,0,'task 5 does not introduce a second reward round');
  }
});

test('gambler offers keep a three-above two-below formation around the player through actual viewport resize',t=>{
  const {world,scene,g,pointer}=upgradeRun(app,{count:5}),previous={width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio,add:window.addEventListener};let resize;
  window.addEventListener=(type,handler)=>{if(type==='resize')resize=handler;else previous.add(type,handler);};
  t.after(()=>{window.innerWidth=previous.width;window.innerHeight=previous.height;window.devicePixelRatio=previous.dpr;window.addEventListener=previous.add;app.setFeedbackStrength(.6);});
  app.mountSceneBoundary(pointer.canvas,g);const ids=world.choices.map(choice=>choice.id),events=observeWorldEvents(world);
  for(const [width,height] of [[390,844],[844,390],[320,568]]){
    window.innerWidth=width;window.innerHeight=height;resize();scene.update(0,0);
    const p=world.player,bounds=world.arenaBounds;
    near(p.x,width/2);near(p.y,world.choicePlayerY);assert.equal(world.phase,'choose');assert.deepEqual(world.choices.map(choice=>choice.id),ids);
    assert.equal(world.choices.filter(choice=>choice.y<p.y).length,3);assert.equal(world.choices.filter(choice=>choice.y>p.y).length,2);
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
  for(const count of [3,5]){
    const {world,scene}=upgradeRun(app,{count});contact(world,scene,`normal ${count}-offer reward`);
  }
  app.seedRenderer(graphicsRecorder(),390,844,true);app.seedEndless({maxStage:10,best:0});app.prepareNormalGame();app.setFeedbackStrength(1);
  {
    const {world,scene}=app.readRestart();
    waitForChoose(world,scene);contact(world,scene,'single starting reward');advanceScene(scene,world.rewardTiming.rest+.01);assert.equal(world.phase,'battle');
  }
  {
    const {world,scene}=bossScene(10);app.setFeedbackStrength(1);advanceToBoss(world,scene);world.gamblerRewardPending=true;defeatBoss(world,scene);
    for(let round=1;round<=2;round++){waitForChoose(world,scene);contact(world,scene,`Boss round ${round}`);advanceScene(scene,world.rewardTiming.rest+.01);}
  }
  for(const kind of ['choices-3','choices-5']){
    app.seedRenderer(graphicsRecorder());app.setFeedbackStrength(1);app.runFeedbackDemo(kind);
    const {world,scene}=app.readRestart();contact(world,scene,kind);
  }
});

test('a fully acquired upgrade pool skips the empty offer, keeps caps intact and starts the next ordinary stage',t=>{
  const {world,scene}=controlRun();t.after(()=>app.setFeedbackStrength(.6));
  for(const definition of UPGRADE_DEFINITIONS)for(let layer=0;layer<definition.maxStacks;layer++){
    if(definition.id==='gambler'&&world.nextGambler){
      // Consecutive Boss rewards cannot consume the second gambler stack;
      // finish a genuine stage boundary before acquiring that final layer.
      world.phase='reward';world.rewardSelectionsRemaining=1;world.finishRewardRound();
    }
    assert.equal(world.applyUpgrade(definition.id),true);
  }
  // All upgrade applications above are setup; there is no pending gambler reward
  // or score/visual bonus manufactured by inspecting the exhausted pool.
  world.nextGambler=false;world.gamblerRewardPending=false;
  const before=JSON.stringify(world.buffs),stage=world.stage;world.beginUpgrade();scene.update(0,0);
  assert.equal(world.phase,'reward');assert.deepEqual(world.choices,[]);assert.equal(element('#choice-labels').children.length,0);
  assert.equal(world.pendingUpgradeBoost,false);advanceScene(scene,world.rewardTiming.rest+.01);
  assert.equal(world.phase,'battle');assert.equal(world.stage,stage+1);assert.equal(JSON.stringify(world.buffs),before);
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

test('all upgrade and three/five-choice playgrounds keep initial bodies and reward labels above their visible controls',t=>{
  const panel=element('#feedback-demo'),previousRect=panel.getBoundingClientRect,previousHidden=panel.hidden;
  t.after(()=>{panel.getBoundingClientRect=previousRect;panel.hidden=previousHidden;app.seedRenderer(graphicsRecorder());app.prepareNormalGame();app.setFeedbackStrength(.6);});
  const kinds=['choices-3','choices-5',...UPGRADE_DEFINITIONS.map(definition=>'upgrade-'+definition.id)];
  for(const [width,height,top] of [[390,844,470],[320,667,290],[844,390,135],[320,568,180]])for(const kind of kinds){
    const g=graphicsRecorder();app.seedRenderer(g,width,height);panel.hidden=false;
    panel.getBoundingClientRect=()=>panel.classList.contains('demo-compact')
      ?{left:width/2-52,right:width/2+52,top:height-60,bottom:height-20,width:104,height:40}
      :{left:0,right:width,top,bottom:height,width,height:height-top};
    app.runFeedbackDemo(kind);const {world,scene}=app.readRestart(),bounds=world.arenaBounds,bodies=[world.player,...world.enemies,...world.choices];
    const visibleTop=panel.getBoundingClientRect().top;
    if(kind==='choices-5'||kind==='upgrade-gambler')assert.equal(panel.classList.contains('demo-compact'),true,'five offers expose only the compact menu button');
    else assert.equal(visibleTop,top,'other playgrounds retain the original full-control panel bounds');
    for(let index=0;index<bodies.length;index++){
      const body=bodies[index],label=`${kind} ${width}x${height}`;
      assert.ok(body.x-body.r>=bounds.left-1e-8&&body.x+body.r<=bounds.right+1e-8,label);
      assert.ok(body.y-body.r>=bounds.top-1e-8&&body.y+body.r<=visibleTop+1e-8,label);
      for(const other of bodies.slice(index+1))assert.ok(Math.hypot(body.x-other.x,body.y-other.y)>=body.r+other.r-1e-8,label);
    }
    for(const choice of world.choices){
      const outer=choice.r*(choice.rings===2?1.27:choice.rings===1?1.14:1),font=Math.max(9,Math.min(17,Math.floor(choice.labelWidth/choice.name.length*.9)));
      assert.ok(choice.x-outer>=bounds.left&&choice.x+outer<=bounds.right);
      assert.ok(choice.y-outer>=bounds.top&&choice.y+choice.r*(1+.14*choice.rings)+14+font<=visibleTop,`${kind} ${width}x${height}: rarity rings and one-line names stay above the visible controls (${choice.id}, top=${choice.y-outer}, bottom=${choice.y+choice.r*(1+.14*choice.rings)+14+font}, panel=${visibleTop})`);
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
  app.runFeedbackDemo('choices-5');assert.equal(panel.classList.contains('demo-compact'),true);near(panel.getBoundingClientRect().height,40);
  for(const handler of panel.listeners.get('click')||[])handler({target:{closest:()=>({dataset:{demo:'all-demos'}})}});
  assert.equal(panel.classList.contains('demo-compact'),false);assert.equal(panel.classList.contains('demo-flow'),false);
  const world=app.readRestart().world;assert.equal(world.phase,'choose');assert.equal(world.choices.length,5,'opening the menu does not replace the current offer');
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
  if(definition.id==='gambler'){assert.equal(world.choices.length,5);near(world.gamblerTargetMultiplier,1.5);assert.equal(world.gamblerRewardPending,false);}
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
  if(definition.id==='risk')assert.ok(kills.every(event=>event.value===Math.round(10*Math.min(event.combo,8)*(event.combo>=3?1.5:1)*(event.banked?1.5:1)*1.5)));
  if(kills.length){assert.ok(kills.every(event=>event.upgradeBoost===true));assert.ok(audio.calls.some(call=>call.name==='impact'&&call.args[0].kind==='kill'&&call.args[0].upgradeBoost));}
  if(world.phase==='choose'){
    const choice=world.choices[0];Object.assign(p,{x:choice.x,y:choice.y,vx:0,vy:0});scene.update(0,1000/120);advanceScene(scene,world.rewardTiming.rest+.01);
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

test('split children wait at the hard capacity, survive a pause, and fill newly opened slots without losing their parent profile',t=>{
  const {world,scene,enemy}=typedEnemyRun('split'),events=observeWorldEvents(world),parentHp=enemy.maxHp;
  t.after(()=>app.setFeedbackStrength(.6));
  for(let index=0;index<27;index++)rhythmEnemy(world,38+(index%7)*50,100+Math.floor(index/7)*100,{r:world.unit*.3,hp:10000});
  world.damage(enemy,enemy.hp+1);scene.update(0,1000/120);
  assert.equal(world.liveCount,28);assert.equal(world.fragmentQueue.length,2);
  assert.equal(world.enemies.filter(body=>body.enemyType==='fragment').length,1);
  clickAction('pause');scene.update(0,0);const snapshot=JSON.stringify({queue:world.fragmentQueue,time:world.feedbackTime});
  advanceScene(scene,.5);assert.equal(JSON.stringify({queue:world.fragmentQueue,time:world.feedbackTime}),snapshot);
  clickAction('resume');app.advanceUi(.42);
  const normals=world.enemies.filter(body=>!body.enemyType).slice(0,2);
  assert.equal(normals.length,2);for(const body of normals)world.damage(body,body.hp+1);
  scene.update(0,1000/120);
  const children=world.enemies.filter(body=>body.enemyType==='fragment');
  assert.equal(children.length,3);assert.equal(world.fragmentQueue.length,0);assert.equal(world.liveCount,28);
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

test('endless records retain reached stages without unlocking skins or changing campaign progress',()=>{
  const {world}=controlRun();app.seedEndless();app.seedSkins(null,0);
  const before={...app.readRestart().campaignProgress},original={...app.readSkins().skins};
  for(const stage of [5,10,15,20,25]){
    world.stage=world.maxStage=stage;app.updateScoreHud();assert.equal(JSON.parse(saved.get('qiuqiule-endless')).maxStage,stage);
    assert.deepEqual(app.readSkins().skins,original);assert.deepEqual(app.readRestart().campaignProgress,before);
  }
  app.changeSkinSides({sides:6,variant:true});assert.deepEqual(app.readSkins().skins,original);
  assert.equal(app.readSkins().skins.unlocked,0);app.seedSkins();
});

test('loading old endless variants removes them from storage and retains only owned campaign skins',async t=>{
  const priorSkins=saved.get('qiuqiule-skins'),priorCampaign=saved.get('qiuqiule-campaign');
  t.after(()=>{for(const [key,value] of [['qiuqiule-skins',priorSkins],['qiuqiule-campaign',priorCampaign]]){if(value===undefined)saved.delete(key);else saved.set(key,value);}});
  for(const [completed,selection,expected] of [
    [0,{enabled:true,sides:6,unlocked:0,variants:[6,7,8,9],variant:true},{enabled:false,sides:6,unlocked:0}],
    [10,{enabled:true,sides:6,unlocked:6,variants:[6],variant:true},{enabled:true,sides:6,unlocked:6}],
    [10,{enabled:true,sides:9,unlocked:6,variants:[9],variant:true},{enabled:true,sides:6,unlocked:6}],
  ]){
    saved.set('qiuqiule-skins',JSON.stringify(selection));saved.set('qiuqiule-campaign',JSON.stringify({completed,unlocked:completed+1}));
    await withReloadedEntry(null,false,fresh=>{
      assert.deepEqual(fresh.readSkins().skins,expected);assert.deepEqual(JSON.parse(saved.get('qiuqiule-skins')),expected);
    });
  }
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

test('Boss victory offers two independent physical choices, with gambler affecting only round one and stage advance after round two',()=>{
  for(const gambler of [false,true]){
    const {world,scene}=bossScene(10);advanceToBoss(world,scene);world.gamblerRewardPending=gambler;
    defeatBoss(world,scene);waitForChoose(world,scene);
    assert.equal(world.upgradeRound,1);assert.equal(world.upgradeRoundTotal,2);assert.equal(world.choices.length,gambler?5:3);
    const score=world.score,first=world.choices.find(choice=>choice.id!=='gambler');chooseByContact(world,scene,first);advanceScene(scene,world.rewardTiming.rest+.01);
    assert.equal(world.stage,10);assert.equal(world.rewardSelectionsRemaining,1);waitForChoose(world,scene);
    assert.equal(world.upgradeRound,2);assert.equal(world.choices.length,3);assert.equal(world.gamblerRewardPending,false);
    assert.ok(world.choices.every(choice=>(world.buffs[choice.id]||0)<choice.maxStacks));
    chooseByContact(world,scene);advanceScene(scene,world.rewardTiming.rest+.01);
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
  const g=graphicsRecorder();app.seedRenderer(g);app.seedEndless({best:777,maxStage:1,maxCombo:2});app.seedSkins();
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


test('real split balls inherit campaign polygons and migrated default circles while keeping only the main face',()=>{
  try{
    for(const selection of [{enabled:true,sides:8,unlocked:8},{enabled:true,sides:6,unlocked:0,variants:[6],variant:true}]){
      const g=graphicsRecorder();app.seedRenderer(g);app.seedSkins(selection);app.runFeedbackDemo('upgrade-split');
      const {world,scene}=app.readRestart();
      for(let frame=0;!world.auxiliaries.length&&frame<180;frame++)scene.update(0,1000/120);
      assert.equal(world.auxiliaries.length,2);
      for(const [index,body] of [world.player,...world.auxiliaries].entries())Object.assign(body,{x:80+index*100,y:400,vx:0,vy:0,squash:0,angle:0,roll:0,feedbackFreeze:0});
      scene.resetFeedback();scene.update(0,0);const active=app.readSkins().skins;const contour=active.enabled?skinContour(active.sides):Array.from({length:192},(_,i)=>({x:Math.cos(i/192*Math.PI*2),y:Math.sin(i/192*Math.PI*2)}));
      for(const body of [world.player,...world.auxiliaries]){
        const shape=g.shapes.find(shape=>shape.type==='path'&&shape.color===app.playerInk()&&shape.points?.length===193&&Math.hypot(outlineBounds(shape).cx-body.x,outlineBounds(shape).cy-body.y)<body.r*.1&&Math.abs(outlineBounds(shape).width/body.r-(Math.max(...contour.map(p=>p.x))-Math.min(...contour.map(p=>p.x))))<1e-6);
        assert.ok(shape,'each physical player ball has its own visible skin');
        near(shape.alpha,body.isAuxiliary?.6:1);
        const local=shape.points.slice(0,-1).map(point=>({x:(point.x-body.x)/body.r,y:(point.y-body.y)/body.r}));
        assertSameContour(local,contour);
        assert.equal(playerEyes(g,body).length,body.isAuxiliary?0:2);
      }
    }
  }finally{app.seedSkins();app.prepareNormalGame();}
});

test('real split photos use independent slots with the main photo retained and removed auxiliaries hidden on the next frame',()=>{
  const g=graphicsRecorder();app.seedRenderer(g);app.seedSkins({enabled:true,sides:6,unlocked:6});app.runFeedbackDemo('upgrade-split');
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
  }finally{photos.restore();app.seedSkins();app.prepareNormalGame();}
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
    const g=graphicsRecorder();app.seedRenderer(g);app.seedSkins({enabled:true,sides:8,unlocked:8});app.runFeedbackDemo('upgrade-split');
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
    }finally{photos.restore();app.seedSkins();}
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
        near(parseFloat(nodes[i].style.top),bounds.cy+choice.r*(1+.14*(choice.rings||0))+14);
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
  assert.equal(world.choices.length,kind==='gambler'?5:3);
  assertRewardEntry(world,scene,g,{fps});
  chooseByContact(world,scene);assert.equal(element('#choice-labels').children.length,0);
  advanceScene(scene,world.rewardTiming.rest+.01);assert.equal(world.phase,'battle');
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
    fresh.setFeedbackStrength(strength);fresh.seedSkins({enabled:true,sides:5,unlocked:8});
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
    }finally{photo.restore();fresh.seedSkins();}
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

function modernCampaignRun(level=1,width=390,height=844){
  const g=graphicsRecorder(),{scene}=app.seedLevelRenderer(g,width,height,level);
  app.enterCampaign(level);
  const offer=app.readRestart().campaignOffer,upgrade=offer.choices[0];
  clickAction('campaign-upgrade',{upgrade:upgrade.id});app.advanceUi(.65);
  return {g,scene,world:app.readRestart().world,upgrade};
}

test('task7 cancelling preflight never starts an attempt and its two choices exclude unrelated upgrades',()=>{
  const {scene}=app.seedLevelRenderer(graphicsRecorder(),390,844,1);
  const before=JSON.stringify(app.readRestart().campaignProgress),stored=saved.get('qiuqiule-campaign');
  app.enterCampaign(1);
  const offer=app.readRestart().campaignOffer;
  assert.equal(offer.choices.length,2);
  assert.ok(offer.choices.every(choice=>['rubber','energy','bank','density'].includes(choice.id)));
  assert.equal(element('#campaign-level-title').textContent,'1 · 破墙');
  assert.equal(element('#campaign-level-goal').textContent,`清空砖墙 · ${app.readRestart().world.config.budget} 发`);
  clickAction('campaign-cancel');scene.update(0,0);
  const state=app.readRestart();
  assert.equal(state.campaignOffer,null);assert.equal(state.selector.phase,'idle');
  assert.equal(state.world,null);assert.equal(state.screen,'levels');
  const record=levelRecord(state.campaignProgress,1);assert.equal(record.attempts,0);assert.deepEqual(record.offerChoices,offer.choices.map(c=>c.id));
  app.enterCampaign(1);assert.deepEqual(app.readRestart().campaignOffer.choices.map(c=>c.id),record.offerChoices);clickAction('campaign-cancel');
});

test('task7 modern restart records abandonment and reopens a fresh single-use two-choice offer',()=>{
  const {world,scene,upgrade}=modernCampaignRun(1);
  assert.equal(world.upgradeId,upgrade.id);assert.equal(world.shoot(0,world.maxPull),true);
  advanceScene(scene,.05);clickAction('pause');app.advanceUi(.42);
  clickRestart();
  let state=app.readRestart();assert.equal(state.screen,'levels');assert.equal(state.world,null);
  assert.equal(levelRecord(state.campaignProgress,1).attempts,1);
  assert.equal(levelRecord(state.campaignProgress,1).abandoned,1);
  assert.equal(levelRecord(state.campaignProgress,1).losses,0);
  app.advanceUi(.65);state=app.readRestart();assert.equal(state.campaignOffer.choices.length,2);
  const chosen=state.campaignOffer.choices[0];clickAction('campaign-upgrade',{upgrade:chosen.id});
  const next=app.readRestart().world;
  assert.notEqual(next,world);assert.equal(next.level,1);assert.equal(next.shotsUsed,0);
  assert.equal(next.remaining,next.budget);assert.equal(next.upgradeId,chosen.id);
  assert.deepEqual(next.buffs,{[chosen.id]:1});assert.equal(levelRecord(app.readRestart().campaignProgress,1).attempts,2);
  clickAction('campaign-upgrade',{upgrade:chosen.id});
  assert.equal(app.readRestart().world,next,'a stale second click cannot reselect or start another attempt');
  assert.equal(levelRecord(app.readRestart().campaignProgress,1).attempts,2);
});

test('task7 pause, background and orientation preserve a live shot and persist its abandonment checkpoint',t=>{
  const {world,scene,g,upgrade}=modernCampaignRun(10),pointer=inputCanvas();
  const previous={width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio,add:window.addEventListener};let resize;
  window.addEventListener=(type,handler)=>{if(type==='resize')resize=handler;else previous.add(type,handler);};
  t.after(()=>{window.innerWidth=previous.width;window.innerHeight=previous.height;window.devicePixelRatio=previous.dpr;window.addEventListener=previous.add;document.hidden=false;});
  app.mountSceneBoundary(pointer.canvas,g);
  assert.equal(world.shoot(world.maxPull,0),true);advanceScene(scene,.1);
  const used=world.shotsUsed,remaining=world.remaining,shotTime=world.shotTime;
  clickAction('pause');const elapsed=world.elapsed;app.advanceUi(.42);
  const attempt=app.readRestart().campaignAttemptId;
  advanceScene(scene,.3);near(world.elapsed,elapsed);near(world.shotTime,shotTime);
  document.hidden=true;for(const handler of listeners.get('visibilitychange'))handler();
  const checkpoint=levelRecord(JSON.parse(saved.get('qiuqiule-campaign')),10);
  near(checkpoint.activeElapsed,elapsed);assert.equal(checkpoint.activeAttempt,attempt);
  assert.equal(checkpoint.losses,0);assert.equal(checkpoint.abandoned,0);
  window.innerWidth=844;window.innerHeight=390;resize();
  assert.equal(world.width,844);assert.equal(world.height,390);
  assert.equal(world.shotsUsed,used);assert.equal(world.remaining,remaining);assert.equal(world.upgradeId,upgrade.id);
  document.hidden=false;for(const handler of listeners.get('visibilitychange'))handler();
  clickAction('resume');app.advanceUi(.42);advanceScene(scene,.05);
  assert.ok(world.elapsed>elapsed);assert.equal(app.readRestart().campaignAttemptId,attempt);
  assert.equal(world.shotsUsed,used);assert.equal(world.remaining,remaining);
});

test('task7 actual last-brick impact wins on the last budgeted launch before exhaustion can overwrite it',()=>{
  const {world,scene}=app.seedCampaignRenderer(graphicsRecorder(),390,844,1);
  world.remaining=1;world.shotsUsed=world.budget-1;world.enemies=[];
  assert.equal(world.shoot(0,world.maxPull),true);assert.equal(world.remaining,0);
  const bricks=world.statics.filter(body=>body.kind==='brick'),last=bricks.at(-1);
  for(const brick of bricks.slice(0,-1))while(brick.hp>0)world.rules.onStaticHit(brick,{normalSpeed:world.baseSpeed});
  Object.assign(world.player,{x:last.x,y:last.y+last.height/2+world.player.r+.5,vx:0,vy:-world.unit*20,feedbackFreeze:0});
  world.step(1/120);scene.update(0,0);
  assert.equal(last.hp,0);assert.equal(world.phase,'campaign-celebrate');assert.equal(world.completed,true);
  assert.equal(world.shotsUsed,world.budget);assert.equal(world.resultRating,1);
  for(let frame=0;frame<240&&world.phase!=='over';frame++)scene.update(0,1000/120);
  assert.equal(world.phase,'over');assert.equal(app.readRestart().result?.completed,true);
  const record=levelRecord(JSON.parse(saved.get('qiuqiule-campaign')),1);
  assert.equal(record.wins,1);assert.equal(record.losses,0);assert.equal(record.rating,1);
  assert.equal(element('#campaign-rating').attributes['aria-label'],'本关评分 1 点，共三点');
  scene.update(0,0);assert.equal(levelRecord(app.readRestart().campaignProgress,1).wins,1);
});

test('task7 genuine missed launches create losses and reveal skip only after three completed failed attempts',()=>{
  let {world,scene}=modernCampaignRun(1);
  for(let attempt=1;attempt<=3;attempt++){
    world.remaining=1;world.shotsUsed=world.budget-1;
    assert.equal(world.shoot(-7,0),true);
    // A low-power shot remains safely below the wall and settles naturally.
    for(let frame=0;frame<600&&world.phase!=='over';frame++)scene.update(0,1000/120);
    assert.equal(world.phase,'over');assert.equal(world.completed,false);
    assert.equal(levelRecord(app.readRestart().campaignProgress,1).failStreak,attempt);
    app.advanceUi(.82);clickRestart();app.advanceUi(.65);
    assert.equal(element('#campaign-skip').hidden,attempt<3);
    if(attempt<3){clickAction('campaign-upgrade',{upgrade:app.readRestart().campaignOffer.choices[0].id});app.advanceUi(.65);world=app.readRestart().world;}
  }
  clickAction('campaign-skip');
  const state=app.readRestart(),record=levelRecord(state.campaignProgress,1);
  assert.equal(state.campaignProgress.completed,0);assert.equal(state.campaignProgress.unlocked,2);
  assert.equal(record.skipped,true);assert.equal(record.rating,0);assert.equal(record.cleared,false);
});

test('task11 selection shows all new classes and migrated completions without inventing scoring dots',()=>{
  const {scene}=app.seedLevelRenderer(graphicsRecorder(),390,844,10);
  scene.update(0,0);
  const markup=element('#level-orbs').innerHTML;
  assert.doesNotMatch(markup,/旧版/);
  assert.equal(levelRecord(app.readRestart().campaignProgress,9).cleared,true);
  assert.equal(levelRecord(app.readRestart().campaignProgress,9).rating,0);
  assert.equal(levelRecord(app.readRestart().campaignProgress,10).cleared,false);
  assert.equal(levelRecord(app.readRestart().campaignProgress,10).rating,0);
});

test('v770 teaching repeats before first clear, including retries and later difficulties',()=>{
  const {world,scene}=modernCampaignRun(1);
  assert.equal(world.tutorialVisible,true);assert.equal(!!app.readRestart().campaignProgress.tutorials.wall,false);
  assert.equal(world.shoot(-7,0),true);assert.equal(world.tutorialVisible,false);
  advanceScene(scene,.05);clickAction('pause');app.advanceUi(.42);clickRestart();app.advanceUi(.65);
  clickAction('campaign-upgrade',{upgrade:app.readRestart().campaignOffer.choices[0].id});app.advanceUi(.65);
  assert.equal(app.readRestart().world.tutorialVisible,true,'an introduction is not a first clear');
  assert.equal(levelRecord(app.readRestart().campaignProgress,1).attempts,2);
  const later=modernCampaignRun(11);assert.equal(later.world.tutorialVisible,true,'a first clear remains necessary at higher difficulty');
});

test('task7 pause-home and pause-restart cannot bypass frenzy or its remaining-ball scoring before skin unlock',()=>{
  for(const action of ['home','restart']){
    app.seedSkins();
    const {world,scene}=modernCampaignRun(10);app.seedSkins(null,9);app.seedCampaignAttempt();
    world.shoot(-world.maxPull,0);
    const targets=world.statics.filter(pin=>pin.target),last=targets.at(-1);
    for(const pin of targets.slice(0,-1))world.rules.onStaticHit(pin,{normalSpeed:world.baseSpeed});
    Object.assign(world.player,{x:last.x,y:last.y+last.r+world.player.r+.5,vx:0,vy:-world.unit*20,feedbackFreeze:0});
    world.step(1/120);scene.update(0,0);assert.equal(world.phase,'campaign-celebrate');
    const score=world.score,bonus=world.celebration.bonusRemaining,elapsed=world.celebration.elapsed;
    clickAction('pause');app.advanceUi(.42);advanceScene(scene,.2);
    near(world.celebration.elapsed,elapsed);assert.equal(app.readSkins().skinUnlock,null);
    clickAction(action);assert.equal(app.readRestart().world,world);assert.equal(world.phase,'campaign-celebrate');
    assert.equal(app.readRestart().result,null);assert.equal(app.readSkins().skinUnlock,null);
    app.advanceUi(.42);
    for(let frame=0;frame<600&&world.phase!=='over';frame++)scene.update(0,1000/120);
    assert.equal(world.phase,'over');assert.equal(world.score,score+bonus*10);
    assert.equal(app.readSkins().skinUnlock.sides,6);
    const record=levelRecord(app.readRestart().campaignProgress,10);
    assert.equal(record.wins,1);assert.equal(record.losses,0);assert.equal(record.abandoned,0);
  }
  app.seedSkins();
});

test('task7 trial uses the full frenzy/result/restart path without touching formal progress or skins',()=>{
  app.seedRenderer(graphicsRecorder());app.seedSkins(null,0);
  const beforeProgress=JSON.stringify(app.readRestart().campaignProgress),beforeSkins=JSON.stringify(app.readSkins().skins);
  const savedProgress=saved.get('qiuqiule-campaign'),savedSkins=saved.get('qiuqiule-skins');
  app.runCampaignTrial(10,'energy');
  const state=app.readRestart(),world=state.world,scene=state.scene;
  assert.equal(app.isFeedbackDemo(),true);assert.equal(world.level,10);assert.equal(world.upgradeId,'energy');
  assert.equal(state.campaignAttemptId,null);assert.equal(element('#campaign-demo-panel').hidden,true);
  finishCampaign(world,scene);
  assert.equal(app.readSkins().skinUnlock,null);assert.equal(app.readRestart().result?.completed,true);
  assert.equal(JSON.stringify(app.readRestart().campaignProgress),beforeProgress);
  assert.equal(JSON.stringify(app.readSkins().skins),beforeSkins);
  assert.equal(saved.get('qiuqiule-campaign'),savedProgress);assert.equal(saved.get('qiuqiule-skins'),savedSkins);
  app.advanceUi(.82);clickRestart();
  const retry=app.readRestart().world;
  assert.notEqual(retry,world);assert.equal(retry.level,10);assert.equal(retry.upgradeId,'energy');
  assert.equal(retry.shotsUsed,0);assert.equal(retry.remaining,retry.budget);assert.equal(app.isFeedbackDemo(),true);
  assert.equal(saved.get('qiuqiule-campaign'),savedProgress);assert.equal(saved.get('qiuqiule-skins'),savedSkins);
});

test('task7 skipped milestone holes grant each exact base skin once when that milestone is truly won',()=>{
  try{
    app.seedSkins();let run=app.seedCampaignRenderer(graphicsRecorder(),390,844,20);
    app.seedSkins(null,9);app.seedCampaignAttempt({completed:9,unlocked:20});
    finishCampaign(run.world,run.scene);
    assert.equal(app.readSkins().skinUnlock.sides,7);
    const after20=app.readRestart().campaignProgress;
    assert.equal(after20.completed,9);assert.equal(after20.unlocked,21);
    assert.equal(levelRecord(after20,10).cleared,false);
    assert.deepEqual(app.readSkins().skins.owned,[7],'winning 20 must not silently grant the skipped level-10 hexagon');
    app.advanceUi(1.66);clickAction('close');app.advanceUi(.62);
    run=app.seedCampaignRenderer(graphicsRecorder(),390,844,10);app.seedCampaignAttempt(after20);
    finishCampaign(run.world,run.scene);
    assert.equal(app.readSkins().skinUnlock.sides,6,'returning to skipped 10 still awards its previously unowned polygon');
    assert.equal(levelRecord(app.readRestart().campaignProgress,10).cleared,true);
    assert.equal(levelRecord(app.readRestart().campaignProgress,20).cleared,true);
    assert.equal(app.readRestart().campaignProgress.completed,10,'the outstanding 11–19 gap stays incomplete');
    app.advanceUi(1.66);clickAction('close');app.advanceUi(.62);
    const retained=app.readRestart().campaignProgress;
    run=app.seedCampaignRenderer(graphicsRecorder(),390,844,10);app.seedCampaignAttempt(retained);
    finishCampaign(run.world,run.scene);
    assert.equal(app.readSkins().skinUnlock,null,'the already owned hexagon never repeats its first-unlock popup');
  }finally{app.seedSkins();}
});

const task8UpgradeIds=['density','rubber','bank','steady'];
const optionValues=selector=>[...element(selector).innerHTML.matchAll(/<option value="([^"]+)"/g)].map(match=>match[1]);
function changeCampaignDemoLevel(level){
  const select=element('#campaign-demo-level');select.id='campaign-demo-level';select.value=String(level);
  select.onchange?.({target:select});
  for(const handler of listeners.get('change')||[])handler({target:select});
}
function assertFiniteScene(g){
  for(const shape of g.shapes){
    assert.ok(Number.isFinite(shape.alpha),'shape alpha must be finite');
    if(shape.points)for(const point of shape.points)assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y),'no Infinity-HP body may produce NaN vertices');
    else for(const key of ['x','y','width','height','r'])if(key in shape)assert.ok(Number.isFinite(shape[key]),key);
  }
}

test('task8 all twenty pool/golf levels offer class-filtered upgrades, precise goals and usable budget HUDs',()=>{
  for(const r of [4,8])for(let k=0;k<10;k++){
    const level=10*k+r,{scene}=app.seedLevelRenderer(graphicsRecorder(),390,844,level);
    app.enterCampaign(level);let state=app.readRestart();const choices=state.campaignOffer.choices;
    assert.equal(choices.length,2);assert.equal(new Set(choices.map(choice=>choice.id)).size,2);
    assert.ok(choices.every(choice=>task8UpgradeIds.includes(choice.id)));
    assert.equal(element('#campaign-level-title').textContent,`${level} · ${r===4?'落袋':'推杆'}`);
    const goal=element('#campaign-level-goal').textContent;
    assert.match(goal,r===4?/清空目标球/:/标准杆/);
    clickAction('campaign-upgrade',{upgrade:choices[0].id});app.advanceUi(.65);state=app.readRestart();
    const world=state.world;assert.equal(world.config.r,r);assert.equal(world.config.k,k);
    assert.ok(goal.includes(`${world.budget} 发`));
    if(r===8)assert.ok(goal.includes(`标准杆 ${world.config.par}`));
    scene.update(0,0);const hud=element('#campaign-goal').textContent;
    assert.equal(element('#campaign-goal').hidden,false);assert.ok(hud.includes(`${world.remaining}/${world.budget}`));
    assert.match(hud,r===4?/球/:/标准杆/);
    assert.match(element('#stage-progress').attributes['aria-label'],/共三点/);assert.equal(element('#stage-progress').children.length,3);
    assert.equal(levelRecord(state.campaignProgress,level).attempts,1);
    assert.equal(levelRecord(state.campaignProgress,level).upgradeChoices[choices[0].id],1);
  }
});

test('task11 acceptance menu exposes all one hundred implemented levels with filtered upgrades',()=>{
  app.seedRenderer(graphicsRecorder());app.installCampaignControls();
  const expected=Array.from({length:100},(_,i)=>String(i+1));
  const actual=optionValues('#campaign-demo-level');
  assert.equal(element('#campaign-demo-level').value,'1');
  assert.equal(actual.length,100);assert.equal(new Set(actual).size,100);assert.deepEqual(actual,expected);
  for(const level of [1,2,3,4,5,6,7,8,9,10,92,93,94,95,96,97,98,99]){
    changeCampaignDemoLevel(level);
    const ids=optionValues('#campaign-demo-upgrade');
    assert.deepEqual(new Set(ids),new Set([5,6].includes(level%10)?['gravity','density','growth','pulse']:[3,4,7,8].includes(level%10)?task8UpgradeIds:[1,2].includes(level%10)?['rubber','energy','bank','density']:['rubber','energy','bank','pierce']));
    assert.ok(ids.includes(element('#campaign-demo-upgrade').value),'a changed class has a valid selected upgrade');
  }
  clickAction('campaign-demo-close');
});

test('task8 infinite-health pool targets and solid golf rails keep finite geometry after real collisions',()=>{
  for(const level of [4,94]){
    const g=graphicsRecorder(),{world,scene}=app.seedCampaignRenderer(g,390,844,level);
    app.setFeedbackStrength(1);scene.update(0,0);assertFiniteScene(g);
    assert.ok(world.enemies.length>0);const enemy=world.enemies[0],player=world.player;
    assert.equal(enemy.hp,Infinity);assert.equal(enemy.maxHp,Infinity);
    assert.equal(world.shoot(-world.maxPull,0),true);
    Object.assign(enemy,{x:player.x+player.r+enemy.r-.2,y:player.y,vx:0,vy:0,born:1,solid:true});
    player.vx=world.baseSpeed;player.vy=0;scene.update(0,1000/120);
    assert.equal(enemy.hp,Infinity,'ordinary collision cannot destroy a pocket ball or roaming obstacle');
    assertFiniteScene(g);
    assert.ok(g.shapes.some(shape=>shape.color===0xe88c72&&shape.alpha>0),'targets and obstacles remain visible');
  }
  for(const level of [18,98]){
    const g=graphicsRecorder(),{world,scene}=app.seedCampaignRenderer(g,390,844,level);
    assert.equal(world.enemies.length,0);assert.ok(world.statics.length>0);
    const obstacle=world.statics[0],player=world.player,count=world.statics.length;
    assert.ok(world.shoot(0,-world.maxPull));
    Object.assign(player,{x:obstacle.x,y:obstacle.y+obstacle.height/2+player.r+.1,vx:0,vy:-world.baseSpeed,feedbackFreeze:0,pendingVx:0,pendingVy:0});
    scene.update(0,1000/120);assertFiniteScene(g);assert.equal(world.statics.length,count);
    assert.ok(g.shapes.some(shape=>shape.type==='stroke'&&shape.color===app.playerInk()),'golf rails remain visibly outlined');
  }
  app.setFeedbackStrength(.6);
});

test('task8 restarting either class records one abandonment then reapplies just its new per-level upgrade',()=>{
  for(const level of [4,8]){
    const {world,scene,upgrade}=modernCampaignRun(level);
    assert.equal(world.upgradeId,upgrade.id);assert.equal(world.shoot(-7,0),true);
    advanceScene(scene,.05);clickAction('pause');app.advanceUi(.42);clickRestart();app.advanceUi(.65);
    let state=app.readRestart(),record=levelRecord(state.campaignProgress,level);
    assert.equal(record.attempts,1);assert.equal(record.abandoned,1);assert.equal(record.losses,0);
    assert.equal(state.campaignOffer.choices.length,2);
    const nextUpgrade=state.campaignOffer.choices[0];clickAction('campaign-upgrade',{upgrade:nextUpgrade.id});app.advanceUi(.65);
    state=app.readRestart();const next=state.world;
    assert.notEqual(next,world);assert.equal(next.level,level);assert.equal(next.shotsUsed,0);
    assert.equal(next.remaining,next.budget);assert.equal(next.upgradeId,nextUpgrade.id);
    assert.deepEqual(next.buffs,{[nextUpgrade.id]:1});assert.equal(levelRecord(state.campaignProgress,level).attempts,2);
  }
});

function placeAtZoneEntry(world,body,zone,speedUnits){
  const toward={x:world.width/2-zone.x,y:world.height/2-zone.y};
  const distance=Math.hypot(toward.x,toward.y),nx=distance>1e-8?toward.x/distance:1,ny=distance>1e-8?toward.y/distance:0;
  Object.assign(body,{x:zone.x+nx*(zone.r+.05),y:zone.y+ny*(zone.r+.05),
    vx:-nx*world.unit*speedUnits,vy:-ny*world.unit*speedUnits,feedbackFreeze:0,pendingVx:0,pendingVy:0});
}
function finishTask8Scene(world,scene){
  for(let frame=0;frame<600&&world.phase!=='over';frame++)scene.update(0,1000/120);
  assert.equal(world.phase,'over');assert.equal(world.completed,true);
}

test('task8 actual pool pocket crossings update score once, remove captured targets and prioritize last-budget victory',()=>{
  const {world,scene,g}=modernCampaignRun(4),audio=app.recordTones();
  try{
    world.remaining=1;world.shotsUsed=world.budget-1;
    assert.equal(world.shoot(-world.maxPull*.2,0),true);world.player.vx=world.player.vy=0;
    const pocket=world.zones.filter(zone=>zone.kind==='pocket').sort((a,b)=>Math.abs(a.y-world.height/2)-Math.abs(b.y-world.height/2))[0];
    assert.ok(pocket);assert.equal(world.zones.filter(zone=>zone.kind==='pocket').length,6);
    const targets=world.enemies.slice(),events=observeWorldEvents(world);
    for(const target of targets){
      placeAtZoneEntry(world,target,pocket,8);world.step(1/120);scene.update(0,0);
      assert.ok(target.captured||target.active===false||target.hp<=0,'target leaves active collision after its real pocket entry');
      assert.ok(!world.enemies.includes(target)||target.captured||target.active===false);
      assertFiniteScene(g);
    }
    assert.equal(world.remaining,0);assert.equal(world.completed,true);assert.equal(world.phase,'campaign-celebrate');
    assert.equal(events.filter(event=>event.type==='campaignPocket').length,targets.length);
    const pocketSounds=audio.calls.filter(args=>args[1]===.12&&args[3]===.035);
    assert.equal(pocketSounds.length,targets.length,'each real pocket emits one sound');
    const before=world.score;scene.update(0,0);assert.equal(world.score,before,'painting a captured target never re-awards points');
    finishTask8Scene(world,scene);assert.equal(app.readRestart().result?.completed,true);
    assert.equal(world.resultRating,1);const record=levelRecord(app.readRestart().campaignProgress,4);
    assert.equal(record.wins,1);assert.equal(record.losses,0);assert.equal(record.rating,1);
    assert.equal(app.readSkins().skinUnlock,null,'r4 is not a skin milestone');
  }finally{audio.restore();}
});

test('task8 real golf hole-in-one earns a result crown and one completion chord',()=>{
  app.seedSkins();const {world,scene,g}=modernCampaignRun(8);
  const audio=app.recordBossVictory();
  try{
    const hole=world.zones.find(zone=>zone.kind==='hole');assert.ok(hole);
    world.enemies=[];world.statics=[];
    assert.equal(world.shoot(-world.maxPull*.2,0),true);
    placeAtZoneEntry(world,world.player,hole,8);world.step(1/120);scene.update(0,0);
    assert.equal(world.phase,'campaign-celebrate');assert.equal(world.completed,true);
    assert.equal(world.golfHoleInOne,true);assert.equal(world.player.captured,true);
    assertFiniteScene(g);assert.equal(audio.calls.length,1);
    advanceScene(scene,.24);assert.equal(crownShapes(g).length,1,'the hole-in-one peak keeps its crown after the captured player disappears');
    finishTask8Scene(world,scene);app.advanceUi(.82);
    const state=app.readRestart();assert.equal(state.result.golfHoleInOne,true);
    assert.equal(element('#ui-ball .ui-result-crown').style.display,'');
    assert.equal(world.resultRating,3);assert.equal(levelRecord(state.campaignProgress,8).rating,3);
    scene.update(0,0);assert.equal(audio.calls.length,1,'the result does not play the peak chord again');
  }finally{audio.restore();app.seedSkins();}
});

test('task8 over-speed golf entry produces one rim cue and no clear before a later slow entry',()=>{
  const {world,scene,g}=modernCampaignRun(8),hole=world.zones.find(zone=>zone.kind==='hole');
  world.enemies=[];world.statics=[];const audio=app.recordTones(),events=observeWorldEvents(world);
  try{
    world.shoot(-world.maxPull,0);placeAtZoneEntry(world,world.player,hole,20);
    world.step(1/120);scene.update(0,0);
    assert.equal(world.completed,false);assert.equal(world.phase,'battle');assert.equal(!!world.player.captured,false);
    assert.equal(events.filter(event=>event.type==='campaignRim').length,1);
    assert.equal(audio.calls.filter(args=>args[0]===880&&args[1]===.07).length,1);
    scene.update(0,0);assert.equal(events.filter(event=>event.type==='campaignRim').length,1);
    assertFiniteScene(g);
    // Leave the zone before the next approach, then make a valid low-speed crossing.
    Object.assign(world.player,{x:world.width/2,y:world.height*.72,vx:0,vy:0});world.step(1/120);
    placeAtZoneEntry(world,world.player,hole,8);world.step(1/120);scene.update(0,0);
    assert.equal(world.completed,true);assert.equal(world.phase,'campaign-celebrate');
  }finally{audio.restore();}
});

test('task8 pause, background and both orientations preserve pool and moving-hole golf attempts',t=>{
  const previous={width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio,add:window.addEventListener};
  t.after(()=>{window.innerWidth=previous.width;window.innerHeight=previous.height;window.devicePixelRatio=previous.dpr;window.addEventListener=previous.add;document.hidden=false;});
  for(const level of [94,98]){
    const {world,scene,g,upgrade}=modernCampaignRun(level),pointer=inputCanvas();let resize;
    window.innerWidth=390;window.innerHeight=844;
    window.addEventListener=(type,handler)=>{if(type==='resize')resize=handler;else previous.add(type,handler);};
    app.mountSceneBoundary(pointer.canvas,g);
    assert.equal(world.shoot(-world.maxPull*.5,0),true);advanceScene(scene,.08);
    const remaining=world.remaining,used=world.shotsUsed,shotTime=world.shotTime,attempt=app.readRestart().campaignAttemptId;
    clickAction('pause');app.advanceUi(.42);const elapsed=world.elapsed,hole=world.zones.find(zone=>zone.kind==='hole');
    const par=world.config.par,holePosition=hole&&{x:hole.x,y:hole.y};advanceScene(scene,.4);
    near(world.elapsed,elapsed);near(world.shotTime,shotTime);
    if(hole)assert.deepEqual({x:hole.x,y:hole.y},holePosition,'moving hole freezes with pause');
    document.hidden=true;for(const handler of listeners.get('visibilitychange'))handler();
    const checkpoint=levelRecord(JSON.parse(saved.get('qiuqiule-campaign')),level);
    near(checkpoint.activeElapsed,elapsed);assert.equal(checkpoint.activeAttempt,attempt);assert.equal(checkpoint.losses,0);
    for(const [width,height] of [[844,390],[320,568],[390,844]]){
      window.innerWidth=width;window.innerHeight=height;resize();scene.update(0,0);
      assert.equal(world.width,width);assert.equal(world.height,height);assertFiniteScene(g);
      assert.equal(world.remaining,remaining);assert.equal(world.shotsUsed,used);assert.equal(world.upgradeId,upgrade.id);
      assert.ok(world.zones.every(zone=>Number.isFinite(zone.x)&&Number.isFinite(zone.y)&&zone.r>0));
      if(hole)assert.equal(world.config.par,par);
    }
    document.hidden=false;for(const handler of listeners.get('visibilitychange'))handler();
    clickAction('resume');app.advanceUi(.42);advanceScene(scene,.05);
    assert.ok(world.elapsed>elapsed);assert.equal(app.readRestart().campaignAttemptId,attempt);
    assert.equal(world.remaining,remaining);assert.equal(world.shotsUsed,used);
  }
});

test('task8 pool and golf failed launches enable a zero-rating skip only after three real losses',()=>{
  for(const level of [4,8]){
    let {world,scene}=modernCampaignRun(level);
    for(let attempt=1;attempt<=3;attempt++){
      world.remaining=1;world.shotsUsed=world.budget-1;assert.equal(world.shoot(-7,0),true);
      for(let frame=0;frame<600&&world.phase!=='over';frame++)scene.update(0,1000/120);
      assert.equal(world.phase,'over');assert.equal(world.completed,false);
      const record=levelRecord(app.readRestart().campaignProgress,level);
      assert.equal(record.losses,attempt);assert.equal(record.failStreak,attempt);assert.equal(record.rating,0);
      app.advanceUi(.82);clickRestart();app.advanceUi(.65);
      assert.equal(element('#campaign-skip').hidden,attempt<3);
      if(attempt<3){clickAction('campaign-upgrade',{upgrade:app.readRestart().campaignOffer.choices[0].id});app.advanceUi(.65);world=app.readRestart().world;}
    }
    clickAction('campaign-skip');const progress=app.readRestart().campaignProgress,record=levelRecord(progress,level);
    assert.equal(record.skipped,true);assert.equal(record.cleared,false);assert.equal(record.rating,0);
    assert.equal(progress.completed,level-1);assert.equal(progress.unlocked,level+1);
    assert.equal(levelRecord(progress,level-1).rating,0,'migrated earlier completions retain unknown ratings');
    app.advanceUi(.65);app.enterCampaign(level);
    assert.equal(app.readRestart().campaignOffer?.level,level,'a skipped stage remains selectable');
    clickAction('campaign-cancel');
  }
});

test('task8 shrinking golf capture draws one matching skin/photo and hides its original physical body',()=>{
  app.seedSkins({enabled:true,sides:8,unlocked:8});const {world,scene,g}=modernCampaignRun(8);
  const photo=app.recordPlayerPhoto();
  try{
    const hole=world.zones.find(zone=>zone.kind==='hole'),physicalRadius=world.player.r;
    world.enemies=[];world.statics=[];world.shoot(-world.maxPull*.2,0);
    placeAtZoneEntry(world,world.player,hole,8);world.step(1/120);scene.update(0,0);
    assert.equal(world.player.captured,true);assert.ok(world.golfCapture);
    photo.calls.length=0;g.clear();scene.drawArena();
    assert.equal(photo.calls.length,1,'the regular body is hidden while its capture snapshot is drawn once');
    assert.deepEqual(photo.calls[0].contour,app.readSkins().active);
    const first=photo.calls[0].pose;near(first.r,physicalRadius);
    world.feedbackTime=world.golfCapture.at+.11;photo.calls.length=0;g.clear();scene.drawArena();
    assert.equal(photo.calls.length,1);assert.ok(photo.calls[0].pose.r>0&&photo.calls[0].pose.r<first.r);
    assert.ok(photo.calls[0].options.alpha>0&&photo.calls[0].options.alpha<1);
    near(world.player.r,physicalRadius);assertFiniteScene(g);
    world.feedbackTime=world.golfCapture.at+.23;photo.calls.length=0;g.clear();scene.drawArena();
    assert.equal(photo.calls.length,0,'after the capture fade neither full-size nor duplicate photo survives');
    near(world.player.r,physicalRadius);
  }finally{photo.restore();app.seedSkins();}
});

test('task8 full pool and golf trial victories, result and restart leave formal records and skins untouched',()=>{
  for(const level of [4,8]){
    app.seedRenderer(graphicsRecorder());app.seedSkins({enabled:true,sides:6,unlocked:6},10);
    const initialProgress=JSON.stringify(app.readRestart().campaignProgress),initialSkins=JSON.stringify(app.readSkins().skins);
    const storedProgress=saved.get('qiuqiule-campaign'),storedSkins=saved.get('qiuqiule-skins');
    app.runCampaignTrial(level,'steady');let {world,scene}=app.readRestart();
    assert.equal(world.upgradeId,'steady');assert.equal(app.readRestart().campaignAttemptId,null);assert.equal(app.isFeedbackDemo(),true);
    world.shoot(-world.maxPull*.2,0);
    if(level===4){
      world.player.vx=world.player.vy=0;const pocket=world.zones.find(zone=>zone.kind==='pocket');
      for(const target of [...world.enemies]){placeAtZoneEntry(world,target,pocket,8);world.step(1/120);scene.update(0,0);}
    }else{
      world.enemies=[];world.statics=[];placeAtZoneEntry(world,world.player,world.zones.find(zone=>zone.kind==='hole'),8);
      world.step(1/120);scene.update(0,0);
    }
    finishTask8Scene(world,scene);assert.equal(app.readRestart().result?.completed,true);assert.equal(app.readSkins().skinUnlock,null);
    assert.equal(JSON.stringify(app.readRestart().campaignProgress),initialProgress);assert.equal(JSON.stringify(app.readSkins().skins),initialSkins);
    assert.equal(saved.get('qiuqiule-campaign'),storedProgress);assert.equal(saved.get('qiuqiule-skins'),storedSkins);
    app.advanceUi(.82);clickRestart();const retry=app.readRestart().world;
    assert.notEqual(retry,world);assert.equal(retry.level,level);assert.equal(retry.upgradeId,'steady');assert.equal(retry.shotsUsed,0);
    assert.equal(retry.remaining,retry.budget);assert.equal(app.isFeedbackDemo(),true);assert.equal(app.readRestart().campaignAttemptId,null);
    assert.equal(saved.get('qiuqiule-campaign'),storedProgress);assert.equal(saved.get('qiuqiule-skins'),storedSkins);
  }
  app.seedSkins();
});

const task9UpgradeIds=level=>level%10===2?['density','rubber','bank','steady']:['rubber','energy','bank','pierce'];





test('task11 remapping old unlocked stages to all new classes preserves historical clears without fabricated ratings',()=>{
  for(const raw of [100,{completed:99,unlocked:100}]){
    app.seedLevelRenderer(graphicsRecorder(),390,844,100);app.setCampaignProgress(raw);
    const initial=app.readRestart().campaignProgress;
    assert.equal(initial.completed,99);assert.equal(initial.unlocked,100);assert.equal(levelRecord(initial,100).cleared,false);
    for(const level of [2,3,5,6,7,9,92,93,95,96,97,99]){
      assert.equal(levelRecord(initial,level).cleared,true);assert.equal(levelRecord(initial,level).rating,0);
      app.enterCampaign(level);assert.equal(app.readRestart().campaignOffer.level,level);
      clickAction('campaign-cancel');
    }
    app.enterCampaign(6);clickAction('campaign-upgrade',{upgrade:app.readRestart().campaignOffer.choices[0].id});app.advanceUi(.65);
    const progress=app.readRestart().campaignProgress,record=levelRecord(progress,6);
    assert.equal(progress.completed,99);assert.equal(progress.unlocked,100);assert.equal(record.attempts,1);
    assert.equal(record.cleared,true);assert.equal(record.rating,0);assert.equal(record.firstClearTime,null);
    assert.equal(levelRecord(progress,2).attempts,0);assert.equal(levelRecord(progress,96).rating,0);
  }
});

test('task11 all one hundred implemented trials keep attempts, ratings, teaching and skins isolated through pause and restart',()=>{
  app.seedRenderer(graphicsRecorder());app.seedSkins({enabled:true,sides:8,unlocked:8},30);
  const progress=JSON.stringify(app.readRestart().campaignProgress),skins=JSON.stringify(app.readSkins().skins);
  const storedProgress=saved.get('qiuqiule-campaign'),storedSkins=saved.get('qiuqiule-skins');
  const levels=Array.from({length:100},(_,i)=>i+1);
  for(const level of levels){
    const upgrade=[5,6].includes(level%10)?'gravity':[3,4,7,8].includes(level%10)?'steady':'energy';
    app.runCampaignTrial(level,upgrade);let state=app.readRestart();const world=state.world;
    assert.equal(world.level,level);assert.equal(world.upgradeId,upgrade);assert.equal(state.campaignAttemptId,null);
    assert.equal(app.isFeedbackDemo(),true);world.shoot(-7,0);advanceScene(state.scene,.025);
    clickAction('pause');app.advanceUi(.42);app.saveCampaignCheckpoint();clickRestart();
    state=app.readRestart();assert.notEqual(state.world,world);assert.equal(state.world.level,level);
    assert.equal(state.world.shotsUsed,0);assert.equal(state.world.upgradeId,upgrade);assert.equal(state.campaignAttemptId,null);
    assert.equal(JSON.stringify(state.campaignProgress),progress);assert.equal(JSON.stringify(app.readSkins().skins),skins);
    assert.equal(saved.get('qiuqiule-campaign'),storedProgress);assert.equal(saved.get('qiuqiule-skins'),storedSkins);
  }
  app.seedSkins();
});



function nearestBowlingShot(world){
  const p=world.player,target=world.enemies.filter(pin=>pin.pinHP>0).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
  assert.ok(target);const dx=p.x-target.x,dy=p.y-target.y,d=Math.hypot(dx,dy);
  assert.equal(world.shoot(dx/d*world.maxPull,dy/d*world.maxPull),true);
}
function finishBowlingScene(world,scene){
  for(let frame=0;frame<7200&&world.phase!=='over';frame++){
    if(world.ready)nearestBowlingShot(world);
    scene.update(0,1000/120);
  }
  assert.equal(world.phase,'over');assert.equal(world.completed,true);
}

function hitCampaignStaticFromBelow(world,shape,actor=world.player){
  const edge=shape.shape==='rect'?shape.height/2:shape.r;
  Object.assign(actor,{x:shape.x,y:shape.y+edge+actor.r+.5,vx:0,vy:0,feedbackFreeze:0,pendingVx:0,pendingVy:0});
  // A separate outside step ends the previous contact; the following impact
  // goes through the actual swept/static collision loop.
  world.step(1/120);Object.assign(actor,{vx:0,vy:-20*world.unit,feedbackFreeze:0});world.step(1/120);
}
function preparePinballLastJackpot(world){
  const contact={normalSpeed:world.baseSpeed,nx:0,ny:1,impactVx:0,impactVy:-world.baseSpeed};
  if(!world.shotActive)assert.equal(world.shoot(-world.maxPull*.2,0),true);
  // This is an explicit last-object boundary fixture, not a playable route.
  // Earlier groups enter through the class rule so its private counters agree.
  for(let group=0;group<world.config.jackpotGoal;group++){
    for(const target of world.statics.filter(shape=>shape.kind==='pinball-target'&&shape.active&&!shape.dead))world.rules.onStaticHit(target,contact,world.player);
    const jackpot=world.statics.find(shape=>shape.kind==='jackpot');assert.ok(jackpot.active);
    const hits=group===world.config.jackpotGoal-1?2:3;
    for(let hit=0;hit<hits;hit++)world.rules.onStaticHit(jackpot,contact,world.player);
    if(group<world.config.jackpotGoal-1)world.rules.onTick(world.config.respawnDelay);
  }
  const last=world.statics.find(shape=>shape.kind==='jackpot');assert.equal(last.hp,1);return last;
}
function drainPinballBody(world,body=world.player){
  const drain=world.zones.find(zone=>zone.kind==='drain');assert.ok(drain);
  Object.assign(body,{x:drain.x,y:drain.y-drain.height/2-.25,vx:0,vy:world.unit*20,
    feedbackFreeze:0,pendingVx:0,pendingVy:0});
  world.step(1/120);
}















const task10Upgrades=['split','energy','breath','pulse'];







function lastBrickBoundary(world){
  // Prepare the last brick and final budgeted round only. The terminal hit is
  // still performed by a real emitted small ball through the collision loop.
  world.bricksBroken=world.config.goal-1;world.remaining=1;world.shotsUsed=world.budget-1;
  const last=world.statics.filter(body=>body.kind==='number-brick'&&!body.dead).sort((a,b)=>b.gridRow-a.gridRow)[0];
  assert.ok(last);last.hp=1;
  assert.equal(world.shoot(0,world.maxPull),true);assert.equal(world.remaining,0);
  assert.equal(world.phase,'battle');const actor=world.auxiliaries[0];assert.ok(actor?.isAuxiliary);
  hitCampaignStaticFromBelow(world,last,actor);return last;
}



function glassBoundaryRows(world,clock,misses){
  // Advance only the class clock for a declared deadline fixture. This does
  // not stand in for the separate ordinary-play route test.
  world.rules.onTick(clock-world.glassClock);
  const panes=world.statics.filter(body=>body.kind==='glass'&&!body.dead);
  assert.ok(panes.length>=misses+1);
  for(const pane of panes)Object.assign(pane,{active:false});
  for(const pane of panes.slice(0,misses))Object.assign(pane,{active:true,y:world.glassBoard.bottom-pane.r});
  const last=panes[misses];Object.assign(last,{active:true,y:world.glassBoard.top});
  world.rules.onAfterTick();return [last];
}

















const task11Upgrades=['gravity','density','growth','pulse'];

test('task11 all twenty merge levels use two local choices, first teaching and useful unlimited-launch HUDs',()=>{
  for(let k=0;k<10;k++)for(const r of [5,6]){
    const level=k*10+r,g=graphicsRecorder(),{scene}=app.seedLevelRenderer(g,390,844,level);
    const before=JSON.stringify(app.readRestart().campaignProgress),stored=saved.get('qiuqiule-campaign');
    app.enterCampaign(level);let state=app.readRestart();
    assert.equal(state.campaignOffer.level,level);assert.equal(state.campaignOffer.choices.length,2);
    assert.equal(new Set(state.campaignOffer.choices.map(choice=>choice.id)).size,2);
    assert.ok(state.campaignOffer.choices.every(choice=>task11Upgrades.includes(choice.id)));
    assert.equal(element('#campaign-level-title').textContent,`${level} · ${'合成'}`);
    const goal=element('#campaign-level-goal').textContent;
    assert.doesNotMatch(goal,/Infinity|NaN|undefined|余.*发/);
    assert.ok(goal.includes(String(2+Math.floor(k/3))));
    assert.match(goal,/最大|合成/);
    assert.equal((element('#campaign-upgrades').innerHTML.match(/<small>/g)||[]).length,2,'both offered upgrades explain their effect');
    const offered=app.readRestart().campaignOffer.choices.map(c=>c.id);clickAction('campaign-cancel');const cancelled=levelRecord(app.readRestart().campaignProgress,level);assert.equal(cancelled.attempts,0);assert.deepEqual(cancelled.offerChoices,offered);assert.deepEqual(app.readRestart().campaignProgress.tutorials,{});
    app.enterCampaign(level);const choice=app.readRestart().campaignOffer.choices[0];
    clickAction('campaign-upgrade',{upgrade:choice.id});app.advanceUi(.65);state=app.readRestart();const world=state.world;
    assert.equal(world.config.classId,'merge');assert.equal(world.config.k,k);assert.equal(world.config.implemented,true);
    assert.equal(world.budget,42);assert.ok(Number.isFinite(world.remaining));assert.equal(world.upgradeId,choice.id);
    assert.deepEqual(world.buffs,{[choice.id]:1});assert.equal(world.tutorialVisible,true);
    assert.equal(!!state.campaignProgress.tutorials[world.config.classId],false);
    scene.update(0,0);assertFiniteScene(g);const hud=element('#campaign-goal').textContent;
    assert.equal(element('#campaign-goal').hidden,false);assert.doesNotMatch(hud,/Infinity|NaN|undefined|余.*发/);
    assert.match(hud,/覆盖|合成|最大/);
    assert.doesNotMatch(element('#stage-progress').attributes['aria-label']||'',/Infinity|NaN|undefined/);
    const record=levelRecord(state.campaignProgress,level);
    assert.equal(record.attempts,1);assert.equal(record.upgradeChoices[choice.id],1);assert.equal(record.rating,0);
    const remaining=world.remaining;assert.equal(world.shoot(-7,0),true);assert.equal(world.remaining,remaining,'a launch consumes no pressure or time allowance');assert.equal(world.tutorialVisible,false);
    assert.equal(world.shotsUsed,1);scene.update(0,0);assertFiniteScene(g);
  }
});

test('task11 pause, background and rotation preserve merge pressure in the same attempt',t=>{
  const previous={width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio,add:window.addEventListener};
  t.after(()=>{window.innerWidth=previous.width;window.innerHeight=previous.height;window.devicePixelRatio=previous.dpr;window.addEventListener=previous.add;document.hidden=false;});
  const counters=world=>({shots:world.shotsUsed,remaining:world.remaining,mergeMade:world.mergeMade,mergeCount:world.mergeCount,
    mergeElapsed:world.mergeElapsed,mergeClock:world.mergeState?.elapsed,mergeClears:world.mergeClears,coverage:world.mergeCoverage,
    chainElapsed:world.chainState?.elapsed,removed:world.chainState?.cleared,maxChain:world.chainState?.maxChain,
    liveCount:world.chainState?.liveCount,headProgress:world.chainState?.headProgress});
  for(const level of [95,99])for(const [portraitWidth,portraitHeight] of [[390,844],[320,568]]){
    const {world,scene,g,upgrade}=modernCampaignRun(level,portraitWidth,portraitHeight),pointer=inputCanvas();let resize;
    window.innerWidth=portraitWidth;window.innerHeight=portraitHeight;
    window.addEventListener=(type,handler)=>{if(type==='resize')resize=handler;else previous.add(type,handler);};
    app.mountSceneBoundary(pointer.canvas,g);assert.equal(world.shoot(-7,0),true);advanceScene(scene,.05);
    clickAction('pause');app.advanceUi(.42);const before=counters(world),elapsed=world.elapsed,attempt=app.readRestart().campaignAttemptId;
    advanceScene(scene,.35);assert.deepEqual(counters(world),before);near(world.elapsed,elapsed);
    document.hidden=true;for(const handler of listeners.get('visibilitychange'))handler();
    const checkpoint=levelRecord(JSON.parse(saved.get('qiuqiule-campaign')),level);
    assert.equal(checkpoint.activeAttempt,attempt);near(checkpoint.activeElapsed,elapsed);assert.equal(checkpoint.losses,0);assert.equal(checkpoint.abandoned,0);
    for(const [width,height] of [[portraitHeight,portraitWidth],[portraitWidth,portraitHeight]]){
      window.innerWidth=width;window.innerHeight=height;resize();scene.update(0,0);assertFiniteScene(g);
      assert.equal(world.width,width);assert.equal(world.height,height);assert.equal(world.upgradeId,upgrade.id);
      const after=counters(world),expected={...before};
      for(const key of ['coverage','remaining','headProgress']){near(after[key]??0,expected[key]??0);delete after[key];delete expected[key];}
      assert.deepEqual(after,expected);
      assert.ok(world.campaignBodies.every(body=>[body.x,body.y,body.r,body.vx,body.vy].every(Number.isFinite)));
    }
    document.hidden=false;for(const handler of listeners.get('visibilitychange'))handler();clickAction('resume');app.advanceUi(.42);
    advanceScene(scene,.05);assert.ok(world.elapsed>elapsed);assert.equal(app.readRestart().campaignAttemptId,attempt);
    assert.ok(Number.isFinite(world.remaining));assert.equal(world.shotsUsed,before.shots);
  }
});

test('task11 restart removes a live merge and records abandonment before a fresh local choice',()=>{
  for(const level of [5,6]){
    const {world,scene}=modernCampaignRun(level);assert.equal(world.shoot(-7,0),true);advanceScene(scene,.05);
    clickAction('pause');app.advanceUi(.42);clickRestart();app.advanceUi(.65);
    let state=app.readRestart(),record=levelRecord(state.campaignProgress,level);
    assert.equal(state.world.isCampaignOffer,true);assert.equal(record.attempts,1);assert.equal(record.abandoned,1);assert.equal(record.losses,0);assert.equal(record.failStreak,0);
    assert.equal(state.campaignOffer.choices.length,2);assert.ok(state.campaignOffer.choices.every(choice=>task11Upgrades.includes(choice.id)));
    const choice=state.campaignOffer.choices[0];clickAction('campaign-upgrade',{upgrade:choice.id});app.advanceUi(.65);state=app.readRestart();
    assert.notEqual(state.world,world);assert.equal(state.world.level,level);assert.equal(state.world.shotsUsed,0);assert.equal(state.world.budget,42);assert.ok(Number.isFinite(state.world.remaining));
    assert.deepEqual(state.world.buffs,{[choice.id]:1});assert.equal(state.world.tutorialVisible,true);assert.equal(state.world.completed,false);
    assert.equal(state.world.mergeMade||state.world.chainState?.cleared||0,0);assert.equal(state.world.score,0);
    assert.equal(state.scene.effects.length,0);assert.equal(state.scene.impactGhosts.length,0);
    record=levelRecord(state.campaignProgress,level);assert.equal(record.attempts,2);assert.equal(record.rating,0);assert.equal(record.wins,0);
  }
});

function mergeBoundaryBall(world,level,x,y,velocity={}){
  const radius=[.55,.75,1,1.3,1.65][level-1],mass=.55**2*2**(level-1);
  const body=world.makeBody(x,y,radius*world.unit,mass/radius**2);
  Object.assign(body,{kind:'merge-ball',mergeLevel:level,mass,density:mass/radius**2,hp:Infinity,maxHp:Infinity,
    active:true,solid:true,born:1,drag:1.2,mergeAt:-Infinity,mergeChain:0,vx:0,vy:0,...velocity});
  world.enemies.push(body);return body;
}
function mergePressureBoundary(world,{finalMerge=false,elapsed=1}={}){
  // A declared near-terminal state checks ordering and save/UI integration.
  // Sixteen legal L4 radii cover 43.34% of the 14u square. The actual pair
  // collision below leaves >42% even after producing its L5 child.
  world.enemies=[];world.mergeElapsed=elapsed;world.elapsed=elapsed;world.time=elapsed;
  world.mergeSpawnClock=0;const b=world.arenaBounds,u=world.unit,cx=(b.left+b.right)/2,cy=(b.top+b.bottom)/2;
  for(let row=0;row<4;row++)for(let col=0;col<4;col++)mergeBoundaryBall(world,4,cx+(col-1.5)*2.7*u,cy+(row-1.5)*2.7*u);
  Object.assign(world.player,{x:b.left+world.player.r+.02*u,y:b.bottom-world.player.r-.02*u,vx:0,vy:0});
  if(finalMerge){
    world.mergeMade=world.config.targetMax-1;
    const [a,c]=world.enemies;c.x=a.x+a.r+c.r-.01*u;a.vx=3*u;
  }
  world.step(1/120);
}

test('task11 an actual last L4 merge wins before simultaneous full pressure and persists each timed rating once',()=>{
  for(const [elapsed,rating] of [[59,3],[89,2],[100,1]]){
    app.seedSkins();const {world,scene,g}=modernCampaignRun(5),events=observeWorldEvents(world);
    mergePressureBoundary(world,{finalMerge:true,elapsed});scene.update(0,0);
    assert.equal(world.mergeMade,world.config.targetMax);assert.equal(world.mergeCount,1);
    assert.ok(world.mergeCoverage>=world.config.coverageLimit,'victory ordering is tested while pressure also reaches its loss limit');
    assert.equal(world.completed,true);assert.equal(world.phase,'campaign-celebrate');assert.equal(world.resultRating,rating);
    assert.equal(events.filter(event=>event.type==='campaignMerge').length,1);assertFiniteScene(g);
    finishTask8Scene(world,scene);app.advanceUi(.82);
    const record=levelRecord(app.readRestart().campaignProgress,5);
    assert.equal(record.wins,1);assert.equal(record.losses,0);assert.equal(record.rating,rating);assert.equal(record.bestScore,world.score);
    assert.ok(record.firstClearTime>=elapsed);assert.equal(element('#campaign-rating').attributes['aria-label'],`本关评分 ${rating} 点，共三点`);
    assert.equal(app.readSkins().skinUnlock,null);assert.equal(app.readSkins().skins.unlocked,0);
    assert.equal(events.filter(event=>event.type==='over').length,1);scene.update(0,0);
    assert.equal(levelRecord(app.readRestart().campaignProgress,5).wins,1);
  }
});

test('task11 actual pressure failures reveal a zero-rating skip only after three completed losses',()=>{
  let {world,scene}=modernCampaignRun(5);
  for(let attempt=1;attempt<=3;attempt++){
    mergePressureBoundary(world);scene.update(0,0);
    assert.equal(world.phase,'over');assert.equal(world.completed,false);assert.ok(world.mergeCoverage>=.42);
    const record=levelRecord(app.readRestart().campaignProgress,5);
    assert.equal(record.losses,attempt);assert.equal(record.failStreak,attempt);assert.equal(record.abandoned,0);assert.equal(record.rating,0);
    app.advanceUi(.82);clickRestart();app.advanceUi(.65);assert.equal(element('#campaign-skip').hidden,attempt<3);
    if(attempt<3){clickAction('campaign-upgrade',{upgrade:app.readRestart().campaignOffer.choices[0].id});app.advanceUi(.65);world=app.readRestart().world;}
  }
  clickAction('campaign-skip');const state=app.readRestart(),record=levelRecord(state.campaignProgress,5);
  assert.equal(record.skipped,true);assert.equal(record.cleared,false);assert.equal(record.rating,0);
  assert.equal(state.campaignProgress.completed,4);assert.equal(state.campaignProgress.unlocked,6);
  app.advanceUi(.65);app.enterCampaign(5);assert.equal(app.readRestart().campaignOffer.level,5);clickAction('campaign-cancel');
});

function mergeClearBoundary(world){
  // Two legal maximum-size bodies touch through the real dynamic-contact path.
  world.enemies=[];const b=world.arenaBounds,x=(b.left+b.right)/2,y=(b.top+b.bottom)/2,r=1.65*world.unit;
  mergeBoundaryBall(world,5,x-r+.005*world.unit,y);mergeBoundaryBall(world,5,x+r-.005*world.unit,y);
  world.step(1/120);
}

test('task11 real maximum merges emit inward fragments once and retain 120 Hz real-time scheduling during slow motion',()=>{
  const {world,scene,g}=modernCampaignRun(5),events=observeWorldEvents(world),tones=app.recordTones();
  app.setFeedbackStrength(1);
  try{
    mergeClearBoundary(world);scene.update(0,0);const event=events.find(event=>event.type==='campaignMergeClear');
    assert.ok(event);assert.equal(world.mergeClears,1);assert.equal(world.mergeMade,0);assert.equal(world.score,500);
    assert.equal(events.filter(event=>event.type==='kill').length,0);assert.equal(scene.impactGhosts.length,0);
    const fragments=scene.effects.filter(effect=>effect.type==='shard');assert.ok(fragments.length>0&&fragments.length<=10);
    for(const fragment of fragments)assert.ok((event.x-fragment.x)*fragment.vx+(event.y-fragment.y)*fragment.vy>0,'merge fragments move into the shared centre');
    assert.ok([660,880,1100].every(frequency=>tones.calls.some(call=>call[0]===frequency)));
    assert.ok(scene.zoomPulse);near(world.presentationTimeScale,.3);
    const calls=[],step=world.step;world.step=function(dt,dragging,options){calls.push({dt,scale:options.timeScale});return step.call(this,dt,dragging,options);};
    advanceScene(scene,.05);assert.equal(calls.length,6,'slow motion still schedules six real ticks in 50 ms');
    calls.forEach(call=>{near(call.scale,.3);near(call.dt,.3/120);});
    assertFiniteScene(g);advanceScene(scene,.5);assert.equal(scene.effects.filter(effect=>effect.type==='shard').length,0);
    assert.equal(events.filter(event=>event.type==='campaignMergeClear').length,1);assert.equal(world.score,500);
  }finally{tones.restore();app.setFeedbackStrength(.6);}
});

test('task11 reduced-motion maximum merges retain sparse inward fragments and sound without camera or slow motion',async()=>{
  await withReloadedEntry({juice:1,expressions:false},true,fresh=>{
    const g=graphicsRecorder(),{world,scene}=fresh.seedCampaignRenderer(g,390,844,5),events=observeWorldEvents(world),tones=fresh.recordTones();
    fresh.setFeedbackStrength(1);
    try{
      mergeClearBoundary(world);scene.update(0,0);const event=events.find(event=>event.type==='campaignMergeClear');assert.ok(event);
      const fragments=scene.effects.filter(effect=>effect.type==='shard');assert.ok(fragments.length>0&&fragments.length<=4);
      for(const fragment of fragments)assert.ok((event.x-fragment.x)*fragment.vx+(event.y-fragment.y)*fragment.vy>0);
      assert.equal(events.filter(event=>event.type==='kill').length,0);assert.equal(world.presentationTimeScale,1);
      assert.equal(scene.zoomPulse,null);assert.equal(scene.feedbackCamera,null);assert.equal(element('#game').style.transform,'none');
      assert.ok(tones.calls.some(call=>call[0]===880));assertFiniteScene(g);
    }finally{tones.restore();}
  });
});

function chainDeadlineBoundary(world){
  // This explicit deadline fixture does not stand in for a full play route.
  // Advance the mode clock, then clear the visible queue through mode hit hooks
  // so the next real step tests survival at sixty seconds without a hole hit.
  assert.equal(world.shoot(-7,0),true);world.rules.onTick(59.99);
  world.elapsed=59.99;world.time=59.99;
  for(const bead of [...world.chainBeads])if(bead.active!==false&&!bead.dead)
    world.rules.onStaticHit(bead,{normalSpeed:world.baseSpeed,impactVx:0,impactVy:-world.baseSpeed,attacker:world.player});
  world.rules.onAfterTick();assert.equal(world.chainState.liveCount,0);
  assert.ok(world.chainState.cleared<world.config.goal,'this fixture reaches the timer route, not the removal goal');
  world.step(.02);
}



test('task11 merge trial terminal paths never save ratings, attempts, teaching or skins',()=>{
  for(const level of [5,6]){
    app.seedRenderer(graphicsRecorder());app.seedSkins({enabled:true,sides:8,unlocked:8},30);
    const progress=JSON.stringify(app.readRestart().campaignProgress),skins=JSON.stringify(app.readSkins().skins);
    const storedProgress=saved.get('qiuqiule-campaign'),storedSkins=saved.get('qiuqiule-skins');
    app.runCampaignTrial(level,'growth');const {world,scene}=app.readRestart();
    if(true)mergePressureBoundary(world,{finalMerge:true});else chainDeadlineBoundary(world);
    scene.update(0,0);finishTask8Scene(world,scene);assert.equal(app.readRestart().result?.completed,true);
    assert.equal(app.readSkins().skinUnlock,null);assert.equal(JSON.stringify(app.readRestart().campaignProgress),progress);
    assert.equal(JSON.stringify(app.readSkins().skins),skins);assert.equal(saved.get('qiuqiule-campaign'),storedProgress);assert.equal(saved.get('qiuqiule-skins'),storedSkins);
    app.advanceUi(.82);clickRestart();const state=app.readRestart();
    assert.notEqual(state.world,world);assert.equal(state.world.level,level);assert.equal(state.world.upgradeId,'growth');
    assert.equal(state.world.shotsUsed,0);assert.equal(state.campaignAttemptId,null);assert.equal(app.isFeedbackDemo(),true);
    assert.equal(saved.get('qiuqiule-campaign'),storedProgress);assert.equal(saved.get('qiuqiule-skins'),storedSkins);
  }
  app.seedSkins();
});



function seededCampaignRun(level,upgradeId,seed){
  const g=graphicsRecorder(),{scene}=app.seedLevelRenderer(g,390,844,level),random=Math.random;
  try{
    Math.random=()=> (task11Upgrades.indexOf(upgradeId)+.1)/task11Upgrades.length;app.enterCampaign(level);
    assert.ok(app.readRestart().campaignOffer.choices.some(choice=>choice.id===upgradeId));
    Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
    clickAction('campaign-upgrade',{upgrade:upgradeId});
  }finally{Math.random=random;}
  app.advanceUi(.65);return {g,scene,world:app.readRestart().world};
}



function chainCascadeBoundary(world){
  // Arrange a declared three-cascade boundary from legal bead sizes. The
  // separator is removed by an actual radial player collision, not a hook.
  const pattern=[0,0,1,1,0,0,2,0,1,0,1,2];assert.equal(world.chainBeads.length,pattern.length);
  world.chainBeads.forEach((bead,index)=>{
    const size=pattern[index];bead.sizeIndex=size;bead.r=[.6,.85,1.1][size]*world.unit;bead.mass=(bead.r/world.unit)**2;
  });
  world.rules.onTick(1/120);const target=world.chainBeads[6],track=world.chainTrack;
  assert.equal(target.active,true);assert.equal(world.shoot(-world.maxPull,0),true);
  const nx=(target.x-track.cx)/track.radius,ny=(target.y-track.cy)/track.radius,p=world.player;
  Object.assign(p,{x:target.x-nx*(target.r+p.r+.01*world.unit),y:target.y-ny*(target.r+p.r+.01*world.unit),
    vx:nx*world.unit*20,vy:ny*world.unit*20,feedbackFreeze:0});
  world.step(1/120);return target;
}



test('task11 a smaller physical viewport recomputes true merge pressure without settling during resize',t=>{
  const {world,scene,g}=modernCampaignRun(5),pointer=inputCanvas();
  const previous={width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio,add:window.addEventListener};let resize;
  t.after(()=>{window.innerWidth=previous.width;window.innerHeight=previous.height;window.devicePixelRatio=previous.dpr;window.addEventListener=previous.add;});
  window.innerWidth=390;window.innerHeight=844;
  window.addEventListener=(type,handler)=>{if(type==='resize')resize=handler;else previous.add(type,handler);};app.mountSceneBoundary(pointer.canvas,g);
  // A resize boundary only: fourteen legal L4 balls fit below 42% on the
  // original board. Cross-device area changes are distinct from rotation.
  world.enemies=[];const b=world.arenaBounds,u=world.unit,cx=(b.left+b.right)/2,cy=(b.top+b.bottom)/2;
  for(let index=0;index<14;index++)mergeBoundaryBall(world,4,cx+(index%4-1.5)*2.7*u,cy+(Math.floor(index/4)-1.5)*2.7*u);
  world.mergeMade=1;world.mergeElapsed=12;world.elapsed=12;world.time=12;world.rules.onAfterTick();
  assert.ok(world.mergeCoverage<.42);const bodies=new Map(world.campaignBodies.map(body=>[body.id,{r:body.r,mass:body.mass}]));
  window.innerWidth=320;window.innerHeight=568;resize();scene.update(0,0);
  assert.equal(world.phase,'battle');assert.equal(app.readRestart().result,null);assert.equal(world.mergeMade,1);near(world.mergeElapsed,12);
  assert.ok(world.mergeCoverage>.42);const area=world.enemies.reduce((sum,body)=>sum+Math.PI*body.r**2,0);
  near(world.mergeCoverage,area/(world.arenaBounds.width*world.arenaBounds.height));
  for(const body of world.campaignBodies){near(body.r,bodies.get(body.id).r*world.unit/u);near(body.mass,bodies.get(body.id).mass);}
  assert.equal(levelRecord(app.readRestart().campaignProgress,5).losses,0);assertFiniteScene(g);
  scene.update(0,1000/120);assert.equal(world.phase,'over');assert.equal(world.completed,false);
  assert.equal(levelRecord(app.readRestart().campaignProgress,5).losses,1);
});

test('task11 a full aimed merge run creates its maximum balls through real scene physics and saves its earned result',()=>{
  app.seedSkins();const {world,scene,g}=seededCampaignRun(5,'density',733),events=observeWorldEvents(world);app.setFeedbackStrength(.6);
  // Ordinary play from the untouched starting layout: push the largest live
  // body, preferring the nearest equal-level choice, with a full pull.
  for(let frame=0;frame<24000&&world.phase!=='over';frame++){
    if(world.ready){
      const p=world.player,target=world.enemies.filter(body=>body.active!==false&&body.hp>0)
        .sort((a,b)=>b.mergeLevel-a.mergeLevel||Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
      if(target){
        const angle=Math.atan2(target.y-p.y,target.x-p.x);
        assert.equal(world.shoot(-Math.cos(angle)*world.maxPull,-Math.sin(angle)*world.maxPull),true);
      }
    }
    scene.update(0,1000/120);
  }
  assert.equal(world.phase,'over');assert.equal(world.completed,true,JSON.stringify({state:world.mergeState,shots:world.shotsUsed}));
  assert.equal(world.mergeMade,world.config.targetMax);assert.ok(world.shotsUsed>1);assert.ok(world.mergeCount>5);
  assert.ok(events.some(event=>event.type==='campaignMerge'&&event.level===5));assert.equal(events.filter(event=>event.type==='over').length,1);
  assert.ok(world.mergeCoverage<world.config.coverageLimit);assertFiniteScene(g);
  const record=levelRecord(app.readRestart().campaignProgress,5);
  assert.equal(record.wins,1);assert.equal(record.losses,0);assert.equal(record.rating,world.resultRating);assert.equal(record.bestScore,world.score);
  assert.ok(record.firstClearTime>=world.mergeElapsed);assert.equal(app.readSkins().skinUnlock,null);assert.ok(element('#result-reason').textContent.startsWith(world.resultSummary));assert.match(element('#result-reason').textContent,/点/);
});


test('v7.9 endless appearance unlocks at 26767 without interrupting battle or Boss and ignores campaign/demo scores',t=>{
  const prior=saved.get('qiuqiule-appearance-state');
  t.after(()=>{app.seedSkins();if(prior===undefined)saved.delete('qiuqiule-appearance-state');else saved.set('qiuqiule-appearance-state',prior);});
  for(const phase of ['battle','boss']){
    const {world}=controlRun();app.seedEndless();app.seedSkins();app.seedAppearanceState();
    if(phase==='boss'){world.stage=5;world.beginBoss();world.phase='boss';world.events=[];}
    world.score=26766;app.updateScoreHud();assert.equal(app.readAppearancePresentation().state.bigEyeUnlocked,false);
    world.score=26767;app.updateScoreHud();
    const state=app.readAppearancePresentation().state;
    assert.equal(state.bigEyeUnlocked,true);assert.equal(state.pendingUnlock,true);assert.equal(state.selected,'original');
    assert.equal(app.readRestart().paused,false);assert.equal(app.readRestart().modal,null);assert.equal(world.phase,phase);
    assert.equal(app.readSkins().skinUnlock,null,'live scoring saves ownership but does not interrupt the current run');
    assert.equal(JSON.parse(saved.get('qiuqiule-appearance-state')).pendingUnlock,true);
    app.updateScoreHud();assert.deepEqual(app.readAppearancePresentation().state,state,'repeated HUD frames cannot re-award or auto-equip');
  }
  app.seedCampaignRenderer(graphicsRecorder(),390,844,10);app.seedSkins();app.seedAppearanceState();
  app.readRestart().world.score=99999;app.updateScoreHud();app.grantAppearanceForTest();
  assert.equal(app.readAppearancePresentation().state.bigEyeUnlocked,false,'campaign points cannot award the endless appearance');
  app.seedRenderer(graphicsRecorder());app.seedSkins();app.seedAppearanceState();app.runFeedbackDemo('steer');
  app.readRestart().world.score=99999;app.updateScoreHud();app.grantAppearanceForTest();
  assert.equal(app.readAppearancePresentation().state.bigEyeUnlocked,false,'trial scenes do not alter ownership');
});

test('v7.9 endless appearance reward uses the animated unlock route and returns to the equipped style only after dismissal',t=>{
  const {world}=controlRun();app.seedEndless();app.seedSkins({enabled:true,sides:6,unlocked:6},10);
  app.seedAppearanceState();
  const original=app.readSkins().playerContour,ink=app.playerInk();
  t.after(()=>{app.seedSkins();app.setPlayerInk('#252720');});
  world.score=26767;app.updateScoreHud();world.phase='over';app.showResultForTest();
  let state=app.readRestart(),reward=app.readSkins().skinUnlock;
  assert.equal(state.modal,'skin-unlock');assert.equal(state.paused,true);assert.equal(state.result,null);
  assert.equal(reward.appearance,'big-eye');assert.equal(reward.ready,false);
  clickAction('close');assert.equal(app.readSkins().skinUnlock.phase,'enter');assert.equal(app.readAppearancePresentation().state.pendingUnlock,true);
  app.advanceUi(.8);assert.equal(app.readSkins().skinUnlock.ready,false);
  const middle=app.readAppearancePresentation().layers;
  assert.ok(middle.some(layer=>layer.id==='big-eye'&&layer.weight>0&&layer.weight<1),'appearance fades into the shared reveal animation');
  app.advanceUi(.86);assert.equal(app.readSkins().skinUnlock.ready,true);
  assert.ok(app.readAppearancePresentation().layers.some(layer=>layer.id==='big-eye'&&layer.weight===1));
  assert.equal(app.readAppearancePresentation().state.selected,'original','preview never silently equips the reward');
  assert.equal(app.playerInk(),ink,'reward preview never overwrites the saved player color');
  clickAction('close');
  assert.equal(app.readSkins().skinUnlock.phase,'leave');assert.equal(app.readRestart().result.campaign,false);
  assert.equal(app.readAppearancePresentation().state.pendingUnlock,false);
  assert.equal(JSON.parse(saved.get('qiuqiule-appearance-state')).pendingUnlock,false);
  app.advanceUi(.62);
  assert.equal(app.readSkins().skinUnlock,null);assert.equal(app.readAppearancePresentation().override,null);
  assert.equal(app.readRestart().uiAnchor,'over');assertSameContour(app.readSkins().active,original);
  assert.ok(app.readAppearancePresentation().layers.every(layer=>layer.id==='original'));
  const earned={...app.readAppearancePresentation().state};
  const next=controlRun().world;app.seedAppearanceState(earned);next.score=30000;next.phase='over';app.showResultForTest();
  assert.equal(app.readSkins().skinUnlock,null,'later qualifying runs never replay an acknowledged unlock');
  assert.ok(app.readRestart().result);
});

test('v7.10 appearance fades preserve preview motion and restore the pre-Big Eye player color',t=>{
  app.seedRenderer(graphicsRecorder());app.seedSkins();app.seedAppearanceState({bigEyeUnlocked:true});
  const oldSettings=app.readFeedbackSettings();app.setPlayerInk('#405060');
  t.after(()=>{app.seedSkins();app.setPlayerInk(oldSettings.player);});
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

test('v7.9 wardrobe back consumes the gallery navigation before any ball transfer',t=>{
  app.seedRenderer(graphicsRecorder());app.seedSkins();app.seedWardrobePresentation(.4);
  const calls=[],restore=app.bindWardrobeControls({update:dt=>calls.push(['update',dt]),back:()=>{calls.push(['back']);return true;},cancelInteraction:()=>calls.push(['cancel'])});
  t.after(()=>{restore();app.seedSkins();});
  const before=app.sourcePose();clickAction('close');
  assert.equal(app.readRestart().modal,'wardrobe');assert.equal(app.readRestart().transfer,null);assert.deepEqual(app.sourcePose(),before);
  assert.deepEqual(calls,[['back']]);app.advanceSkin(.05);app.advanceUi(.05);
  assert.ok(calls.some(call=>call[0]==='update'&&call[1]===.05));near(app.readAppearancePresentation().wardrobeTime,.45);
});


test('v7.9 Big Eye renders one large circular pupil without expressions and never changes collision geometry',t=>{
  t.after(()=>{app.seedSkins();app.setPlayerInk('#252720');app.setExpressionEnabled(false);});
  for(const mode of ['home','levels','endless','campaign']){
    const g=graphicsRecorder(),{scene,active,player,pointer}=pullScene(mode,g);
    app.seedSkins({enabled:true,sides:6,unlocked:6});
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
  const g=graphicsRecorder(),{home}=app.seedRenderer(g);app.seedSkins();
  const oldInk=app.setPlayerInk('#405060'),photos=app.recordCompositePhotos(true);
  app.seedAppearanceState({selected:'custom',bigEyeUnlocked:true},{hasImage:true});
  const image=app.readAppearance().appearance,pose={x:100,y:200,r:30,squash:0};
  t.after(()=>{photos.restore();app.seedSkins();app.setPlayerInk(oldInk);});
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
  t.after(()=>{app.seedSkins();app.setPlayerInk(previous.player);app.setFeedbackStrength(previous.juice);});
  for(const phase of ['battle','boss']){
    const {world,scene,g,pointer}=controlRun(),p=world.player;
    app.seedSkins();app.seedAppearanceState({selected:'big-eye',bigEyeUnlocked:true});app.setPlayerInk('#b8db8a');
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
  app.seedRenderer(graphicsRecorder());app.seedSkins();app.seedAppearanceState({bigEyeUnlocked:true});
  app.bindPhotoRenderer({hide(){},setImage(){}});app.setPlayerInk('#405060');
  t.after(()=>{globalThis.Image=originalImage;app.bindPhotoRenderer(null);app.seedSkins();app.setPlayerInk(previous.player);for(const [key,value]of stored)value===undefined?saved.delete(key):saved.set(key,value);});
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


test('v7.10 formal endless scoring unlocks all nine companion milestones permanently without awarding campaign or trial scores',t=>{
  const key='qiuqiule-companions',prior=saved.get(key);
  t.after(()=>{app.seedCompanions();prior===undefined?saved.delete(key):saved.set(key,prior);});
  const {world}=controlRun();app.seedEndless();app.seedCompanions();
  world.score=7999;app.updateScoreHud();assert.equal(app.readCompanions().state.unlocked,0);
  for(let milestone=1;milestone<=9;milestone++){
    world.score=milestone*8000;app.updateScoreHud();
    assert.equal(app.readCompanions().state.unlocked,milestone);
    assert.equal(app.readCompanions().state.selected,null,'earning an orbit decoration must not auto-equip it');
    assert.equal(JSON.parse(saved.get(key)).unlocked,milestone);
    assert.equal(app.readRestart().paused,false);assert.equal(app.readRestart().modal,null);
  }
  world.score=1;app.updateScoreHud();assert.equal(app.readCompanions().state.unlocked,9);
  app.seedCompanions(JSON.parse(saved.get(key)));assert.equal(app.readCompanions().state.unlocked,9,'the persisted ownership restores independently of the current score');
  app.seedCampaignRenderer(graphicsRecorder());app.seedCompanions();app.readRestart().world.score=999999;app.updateScoreHud();app.grantCompanionsForTest();
  assert.equal(app.readCompanions().state.unlocked,0);
  app.seedRenderer(graphicsRecorder());app.seedCompanions();app.runFeedbackDemo('steer');app.readRestart().world.score=999999;app.updateScoreHud();app.grantCompanionsForTest();
  assert.equal(app.readCompanions().state.unlocked,0);
});

test('v7.10 companion equip, replacement and same-card removal fade from the current appearance without resetting the moving player',t=>{
  const key='qiuqiule-companions',prior=saved.get(key);
  t.after(()=>{app.seedCompanions();prior===undefined?saved.delete(key):saved.set(key,prior);});
  app.seedRenderer(graphicsRecorder());app.seedCompanions({unlocked:9});
  const player={...app.readHome().player},pose=app.seedWardrobePresentation(.73);
  assert.equal(app.chooseCompanionForTest('star-3'),true);assert.deepEqual(app.readHome().player,player);assert.deepEqual(app.sourcePose(),pose);
  assert.deepEqual(app.readCompanions().layers,[],'the newly selected companions begin at zero opacity');
  app.advanceCompanions(.09);const middle=app.readCompanions();
  assert.ok(middle.layers.some(layer=>layer.id==='star-3'&&layer.weight>0&&layer.weight<1));
  assert.equal(app.chooseCompanionForTest('moon-2'),true);assert.equal(app.readCompanions().clock,.09);
  assert.deepEqual(app.readCompanions().layers,middle.layers,'a fast replacement starts at the currently visible layer mix');
  app.advanceCompanions(.18);assert.deepEqual(app.readCompanions().layers,[{id:'moon-2',weight:1}]);
  assert.equal(app.chooseCompanionForTest('moon-2'),true);assert.equal(app.readCompanions().state.selected,null);
  assert.equal(JSON.parse(saved.get(key)).selected,null,'same-card unequip persists immediately');
  assert.ok(app.readCompanions().layers.length>0,'unequip leaves a short fade instead of abruptly disappearing');
  app.advanceCompanions(.18);assert.deepEqual(app.readCompanions().layers,[]);assert.equal(app.readCompanions().tween,null);
  assert.deepEqual(app.readHome().player,player);assert.deepEqual(app.sourcePose(),pose);
  app.advanceUi(.05);near(app.readAppearancePresentation().wardrobeTime,.78);
  app.seedCompanions({unlocked:1});assert.equal(app.chooseCompanionForTest('moon-1'),false);assert.equal(app.readCompanions().state.selected,null);
});

const physicalFields=body=>Object.fromEntries(['id','x','y','r','mass','density','vx','vy','hp','maxHp'].map(key=>[key,body[key]]));
function distanceToOutline(point,outline){
  return Math.min(...outline.map((a,i)=>{
    const b=outline[(i+1)%outline.length],dx=b.x-a.x,dy=b.y-a.y;
    const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy);
  }));
}
function assertOrbitMatchesBody(draw,g,id='star-3'){
  const body=g.shapes.find(shape=>shape.type==='path'&&shape.alpha===1&&shape.color===app.playerInk()&&shape.points.length===193);
  assert.ok(body,'the actual projected player body is present');
  assert.equal(draw.contour?.length,192,'the live outline is supplied to the companion renderer');
  draw.contour.forEach((point,i)=>{near(point.x,body.points[i].x);near(point.y,body.points[i].y);});
  const geometry=companionGeometry(id,draw.pose,app.readCompanions().clock,{contour:draw.contour});
  for(const satellite of geometry.satellites){
    const gap=distanceToOutline(satellite.center,draw.contour);
    assert.ok(Math.abs(gap-draw.pose.r*.5)<draw.pose.r*.025,`orbit gap ${gap} follows the current silhouette at radius ${draw.pose.r}`);
  }
}


test('v7.10 the real player renderer carries companions across all scenes while leaving bodies and auxiliary balls unchanged',t=>{
  const calls=app.recordCompanionDraws();t.after(()=>{calls.restore();app.seedSkins();app.seedCompanions();});
  for(const mode of ['home','levels','endless','campaign']){
    const g=graphicsRecorder(),{scene,active,player,pointer}=pullScene(mode,g);
    app.seedSkins({enabled:true,sides:6,unlocked:6});app.seedCompanions({unlocked:9,selected:'star-3'});
    const before=physicalFields(player),count=active.enemies?.length,aux=active.auxiliaries?.length;
    calls.calls.length=0;scene.update(0,0);
    assert.equal(calls.calls.length,1,mode+' renders the orbit once around its primary player');
    const draw=calls.calls[0];near(draw.pose.x,player.x);near(draw.pose.y,player.y);near(draw.pose.r,player.r);
    assert.ok(draw.shapes.length>0,mode+' paints companion shapes and tails');
    assertOrbitMatchesBody(draw,g);
    const points=draw.shapes.flatMap(shape=>shape.points||[]);
    assert.ok(points.length>0);assert.ok(points.every(point=>Math.hypot(point.x-player.x,point.y-player.y)<player.r*1.9));
    const start={x:player.x,y:player.y};pointer('pointerdown',start.x,start.y);pointer('pointermove',start.x+active.maxPull,start.y);
    calls.calls.length=0;scene.update(0,0);assert.equal(calls.calls.length,1);near(calls.calls[0].pose.r,player.r);
    assertOrbitMatchesBody(calls.calls[0],g);assert.notDeepEqual(calls.calls[0].contour,draw.contour,'full pulling updates the orbit from the visible outline');
    assert.deepEqual(physicalFields(player),before,'orbital decorations never stretch or mutate the collision body');
    assert.equal(active.enemies?.length,count);assert.equal(active.auxiliaries?.length,aux);pointer('pointercancel');
  }
  const {world}=controlRun();app.seedCompanions({unlocked:9,selected:'sun-3'});
  const auxiliary=world.makeBody(80,350,world.player.r*.7,world.player.density);
  Object.assign(auxiliary,{isPlayer:true,isAuxiliary:true,born:1,solid:true});
  const before=physicalFields(auxiliary);calls.calls.length=0;app.drawPlayerForTest(graphicsRecorder(),auxiliary,app.playerInk());
  assert.equal(calls.calls.length,0,'clones never acquire a second set of purely decorative companions');assert.deepEqual(physicalFields(auxiliary),before);
});

test('v7.10 detached UI companion paths track the visible outline through squash, pull, rotation, and continuous shape changes',t=>{
  app.seedRenderer(graphicsRecorder());app.seedSkins({enabled:true,sides:6,unlocked:15});app.seedCompanions({unlocked:9,selected:'moon-2'});
  t.after(()=>{app.seedCompanions();app.seedSkins();});
  const pose={x:100,y:200,r:30,squash:0,roll:0},original={...pose};
  app.paintUiForTest(pose);const node=element('#ui-companions'),markup=node.innerHTML;
  assert.equal(node.hidden,false);assert.match(markup,/<svg/);assert.match(markup,/<path/);
  assert.equal(node.style.width,'120px');assert.equal(node.style.transform,'translate3d(40px,140px,0)');
  app.paintUiForTest({...pose,x:111,y:193});
  assert.equal(node.innerHTML,markup,'translation follows the center without changing the local outline');
  assert.equal(node.style.transform,'translate3d(51px,133px,0)');
  for(const changes of [{squash:.4},{roll:1.7},{visualPull:{amount:1,angle:.8}}]){
    app.paintUiForTest({...pose,...changes});assert.notEqual(node.innerHTML,markup,'the orbit geometry follows '+Object.keys(changes)[0]);
    assert.equal(node.style.transform,'translate3d(40px,140px,0)','the independent container must not scale or rotate the already projected path again');
  }
  assert.deepEqual(pose,original);
  app.advanceCompanions(.1);app.paintUiForTest(pose);assert.notEqual(node.innerHTML,markup,'the shared orbit clock keeps the companions moving');
  const beforeMorph=node.innerHTML,clock=app.readCompanions().clock;
  app.changeSkinSides(9);app.advanceSkin(.15);app.paintUiForTest(pose);
  assert.notEqual(node.innerHTML,beforeMorph,'a partially morphed polygon updates its companion orbit in the same frame');
  assert.equal(app.readCompanions().clock,clock,'changing shapes does not restart or advance the orbit phase');
  app.chooseCompanionForTest('moon-2');app.advanceCompanions(.18);app.paintUiForTest(pose);assert.equal(node.hidden,true);
});

test('v7.10 companion drawing stays below the crown in both Canvas celebration and detached DOM presentation',async t=>{
  const recording=app.recordCompanionDraws();t.after(()=>{recording.restore();app.seedCompanions();app.seedSkins();});
  const {g,world,scene}=bossScene();app.seedSkins({enabled:true,sides:6,unlocked:6});app.seedCompanions({unlocked:9,selected:'star-3'});
  advanceToBoss(world,scene);defeatBoss(world,scene);advanceScene(scene,1.6);recording.calls.length=0;scene.update(0,0);
  assert.equal(world.phase,'boss-celebrate');assert.equal(recording.calls.length,1);
  const companionPaths=recording.calls[0].shapes;assert.ok(companionPaths.length>0);
  const crown=g.shapes.find(shape=>shape.type==='path'&&shape.color===app.playerInk()&&shape.points.length===crownOutline().length&&outlineBounds(shape).cy<world.player.y-world.player.r*.7);
  assert.ok(crown,'the real celebration crown is visible');
  const crownIndex=g.shapes.indexOf(crown);
  assert.ok(companionPaths.every(shape=>g.shapes.indexOf(shape)<crownIndex),'later crown fill occludes overlapping companion shapes and tails');
  const css=await readFile(new URL('../dist/style.css',import.meta.url),'utf8'),html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  const zIndex=id=>Number(/z-index\s*:\s*(\d+)/.exec(new RegExp('#'+id+'\\s*\\{([^}]+)\\}').exec(css)[1])[1]);
  assert.equal(zIndex('ui-companions'),39);assert.equal(zIndex('ui-ball'),40);
  assert.match(html,/<div id="ui-companions"[^>]*><\/div>\s*<div id="ui-ball"/,'companions remain a separate sibling below the ball/crown instead of inheriting its transforms');
});


test('v7.10 an unskinned UI ball gives the orbit its actual post-rotation CSS-squashed outline',t=>{
  app.seedRenderer(graphicsRecorder());app.seedSkins();app.seedCompanions({unlocked:9,selected:'moon-2'});
  t.after(()=>{app.seedCompanions();app.seedSkins();});
  const pose={x:100,y:200,r:30,squash:.2,roll:0,visualPull:{amount:.7,angle:.8}};
  app.paintUiForTest(pose);
  const transform=element('#ui-ball').style.transform,scale=/scale\(([^,]+),([^)]+)\)/.exec(transform);
  assert.ok(scale,'this fixture exercises the ordinary SVG plus CSS squash route');
  const [sx,sy]=scale.slice(1).map(Number),offset=pose.r*2;
  const contour=svgPolyline(uiNode('.ui-pull-outline')).slice(0,192).map(point=>({
    x:offset+(point.x-50)*pose.r/50*sx,y:offset+(point.y-50)*pose.r/50*sy,
  }));
  const expected=companionSvg('moon-2',{x:offset,y:offset,r:pose.r},app.readCompanions().clock,{color:app.playerInk(),alpha:1,contour});
  const numbers=markup=>[...markup.matchAll(/ d="([^"]+)"/g)].flatMap(match=>match[1].match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi).map(Number));
  const actualPoints=numbers(element('#ui-companions').innerHTML),expectedPoints=numbers(expected);
  assert.ok(actualPoints.length>0);assert.equal(actualPoints.length,expectedPoints.length);
  actualPoints.forEach((coordinate,index)=>assert.ok(Math.abs(coordinate-expectedPoints[index])<.03,'orbit SVG matches the actual screen-space body outline'));
});


test('v7.11 every appearance uses score ink for aim, stage dots and Boss awards on both background themes',async()=>{
  const css=await readFile(new URL('../dist/style.css',import.meta.url),'utf8');
  assert.match(css,/#stage-progress\{[^}]*color:var\(--ink\)/,'stage dots inherit the exact score-theme ink');
  for(const [bg,ink]of [['#f4f3eb',0x252720],['#121415',0xf0f2e8]])for(const appearance of ['original','custom','big-eye']){
    await withReloadedEntry({player:'#d98db7',bg,juice:1},false,fresh=>{
      const {world,scene,g,pointer}=controlRun(fresh),p=world.player;
      fresh.seedSkins();
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
    fresh.seedSkins();const photos=fresh.recordCompositePhotos(true);
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


test('v7.11 live companions keep their actual world displacement history rather than redrawing an orbit arc around the current player',t=>{
  const recording=app.recordCompanionDraws();t.after(()=>{recording.restore();app.seedSkins();app.seedCompanions();});
  const {world,scene,g}=controlRun(),p=world.player;
  app.seedSkins({enabled:true,sides:8,unlocked:8});app.seedCompanions({selected:'sun-1',unlocked:9});
  Object.assign(p,{x:180,y:600,vx:0,vy:-world.unit*35,feedbackFreeze:0});scene.update(0,0);
  const first=app.readCompanionHistory()[0][1].points[0];
  advanceScene(scene,.2);
  const history=app.readCompanionHistory();assert.deepEqual(history.map(([key])=>key),['sun-1:0']);
  const points=history[0][1].points,last=points.at(-1),draw=recording.calls.at(-1);
  assert.ok(points.length>10);assert.deepEqual(points[0],first,'moving the player cannot translate its already recorded satellite positions');
  assert.ok(first.y-last.y>50,'the sampled path includes the real center translation');
  const orbit=companionGeometry('sun-1',draw.pose,app.readCompanions().clock,{contour:draw.contour}).satellites[0];
  near(last.x,orbit.center.x);near(last.y,orbit.center.y);
  const ribbons=draw.shapes.filter(shape=>shape.type==='path'&&shape.alpha>0&&shape.alpha<=.26);
  assert.ok(ribbons.length>0);assert.ok(ribbons.flatMap(shape=>shape.points).every(point=>point.y>orbit.center.y),'an upward-moving player leaves the companion trail below the body, not on the old counterclockwise arc');
  const before=physicalFields(p),bodyCount=world.auxiliaries.length;
  g.clear();scene.drawArena();assert.deepEqual(physicalFields(p),before);assert.equal(world.auxiliaries.length,bodyCount);
});

test('v7.11 companion histories reset at pause, background, resizing, a new world and final unequip without connecting unrelated positions',t=>{
  const previous={width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio,add:window.addEventListener};
  t.after(()=>{window.innerWidth=previous.width;window.innerHeight=previous.height;window.devicePixelRatio=previous.dpr;window.addEventListener=previous.add;document.hidden=false;app.seedSkins();app.seedCompanions();});
  for(const reason of ['pause','background','resize','restart','unequip']){
    const {world,scene,g,pointer}=controlRun(),p=world.player;let resize;
    if(reason==='resize'){
      window.addEventListener=(type,handler)=>{if(type==='resize')resize=handler;else previous.add(type,handler);};
      app.mountSceneBoundary(pointer.canvas,g);
    }
    app.seedCompanions({selected:'moon-2',unlocked:9});Object.assign(p,{x:100,y:600,vx:world.unit*30,vy:0});
    advanceScene(scene,.1);assert.equal(app.readCompanionHistory().length,2);assert.ok(app.readCompanionHistory().every(([,entry])=>entry.points.length>3));
    if(reason==='pause')clickAction('pause');
    else if(reason==='background')document.hidden=true;
    else if(reason==='resize'){window.innerWidth=844;window.innerHeight=390;resize();}
    else if(reason==='restart')app.prepareNormalGame();
    else{app.chooseCompanionForTest('moon-2');app.advanceCompanions(.18);}
    scene.update(0,0);
    assert.ok(app.readCompanionHistory().every(([,entry])=>entry.points.length<=1),reason+' discards the previous path before painting again');
    if(['pause','background','unequip'].includes(reason))assert.equal(app.readCompanionHistory().length,0);
    document.hidden=false;window.innerWidth=previous.width;window.innerHeight=previous.height;window.addEventListener=previous.add;
  }
});

test('v7.11 Big Eye clone opacity multiplies the body and pupil through ordinary and fading renders',t=>{
  const g=graphicsRecorder(),{world}=controlRun();app.seedSkins();app.seedAppearanceState({selected:'big-eye',bigEyeUnlocked:true});
  t.after(()=>app.seedSkins());
  const clone={...world.player,isAuxiliary:true,born:1,squash:0,vx:0,vy:0};
  for(const alpha of [1,.5,.25]){
    g.clear();app.drawPlayerForTest(g,clone,app.playerInk(),alpha);
    assert.ok(g.shapes.some(shape=>shape.type==='triangle'));assert.ok(g.shapes.some(shape=>shape.type==='circle'&&shape.color===0));
    assert.ok(g.shapes.every(shape=>Math.abs(shape.alpha-alpha*.6)<1e-9));
  }
});

test('v7.11.2 companion tails grow with speed only while the player comet can be active in a live arena',t=>{
  t.after(()=>{app.seedSkins();app.seedCompanions();app.setFeedbackStrength(.6);});
  function extent(mode,speed,phase='battle'){
    const g=graphicsRecorder(),state=mode==='home'?app.seedRenderer(g):app.seedRenderer(g,390,844,true);
    const player=(state.world||state.home).player,unit=state.world?.unit||player.r;
    if(state.world)state.world.phase=phase;
    app.seedSkins();app.seedCompanions({selected:'sun-1',unlocked:9});app.setFeedbackStrength(1);
    Object.assign(player,{x:100,y:400,vx:unit*speed,vy:0,squash:0});
    for(let frame=0;frame<24;frame++){
      player.x+=4;app.advanceCompanions(1/60);g.clear();app.drawPlayerForTest(g,player,app.playerInk());
    }
    const history=app.readCompanionHistory()[0]?.[1];
    const head=history||companionGeometry('sun-1',player,app.readCompanions().clock).satellites[0].center;
    if(mode==='home')assert.equal(app.readCompanionHistory().length,0,'menus use orbit arcs without movement history');
    const tails=g.shapes.filter(shape=>shape.type==='path'&&shape.alpha>0&&shape.alpha<=.24);
    assert.ok(tails.length>0,mode+' draws its companion tail');
    return Math.max(...tails.flatMap(shape=>shape.points).map(p=>Math.hypot(p.x-head.x,p.y-head.y)))/player.r;
  }
  const slow=extent('play',19),threshold=extent('play',20),medium=extent('play',30),fast=extent('play',40);
  const sameLength=(a,b,label)=>assert.ok(Math.abs(a-b)<.01,label||'orbit deformation does not change the requested tail length');
  sameLength(slow,threshold);assert.ok(medium>threshold*1.5);assert.ok(fast>medium*1.3);
  sameLength(extent('play',80),fast);
  sameLength(extent('home',20),extent('home',40));
  sameLength(extent('play',40,'choose'),threshold,'upgrade selection keeps the ordinary orbit-tail length');
});

test('companion trail rollback keeps moving home and level players on orbit arcs without recording translation',t=>{
  t.after(()=>{app.seedSkins();app.seedCompanions();});
  for(const mode of ['home','levels']){
    const g=graphicsRecorder(),{player}=pullScene(mode,g);
    app.seedSkins();app.seedCompanions({selected:'moon-1',unlocked:9});
    Object.assign(player,{x:120,y:400,vx:0,vy:0,squash:0});
    for(let i=0;i<12;i++){
      player.y-=3;app.advanceCompanions(1/60);g.clear();app.drawPlayerForTest(g,player,app.playerInk());
      assert.deepEqual(app.readCompanionHistory(),[],mode+' never records non-gameplay displacement');
    }
    app.paintUiForTest({...player,y:player.y-3});
    assert.deepEqual(app.readCompanionHistory(),[],'the detached UI keeps an orbit preview rather than a translated trail');
  }
});
