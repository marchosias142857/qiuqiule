import {World, clamp, ease, lerp} from './physics.js';

import {displayMetrics, pointerPosition} from './display.js';
import {HomeWorld} from './home.js';
import {drawFunctionalBall,iconMarkup} from './icons.js';
import {smooth,pullBallPoint,faceTarget,smoothFace,transferPose,resultBounce,strainedEyeOutline,usesStrainedEyes,playerVisualState,relaxedEyeOutline} from './motion.js';
import {GameAudio,audioLevel} from './audio.js';
import {feedbackStrength,hitFeedbackTier,ScoreFeedback,impactShards,impactZoom} from './feedback.js';
import {CometTrails,cometProfile} from './comet-trail.js';
import {WardrobeShowroom} from './wardrobe-showroom.js';
import {wallBulgeSpec,wallBulgeHeight,buildBulgedBorder} from './border-bulge.js';
import {AimGesture,aimGuide,aimMinimumScale} from './aim.js';
import {normalizeAimMetrics,recordAimDuration,aimMetricsReport,aimHoldDuration} from './aim-metrics.js';
import {clearingTimeScale,clearingZoom,PressureWarning,PRESSURE_WARNING_COLOR,blendRgb,injuredEnemyScale,pressureLook} from './rhythm-feedback.js';
import {drawEnemyBall,isSpecialEnemy,enemyTransferMarkup,enemyBodyColor,enemyDetailColor} from './enemy-render.js';
import {ENEMY_TYPES} from './enemies.js';
import {UPGRADES,UPGRADE_DEFINITIONS} from './upgrades.js';
import {drawUpgradeBall,upgradeAppearance,upgradeIconMarkup} from './upgrade-render.js';
import {runUpgradeEntries} from './run-upgrades.js';
import {SHOCKWAVE_DURATION,shockwaveFrame} from './shockwave-render.js';
import {StageHud} from './stage-hud.js';
import {normalizeEndless,createEndlessRun,recordEndlessRun} from './endless-progress.js';
import {createRunSnapshot,restoreRunSnapshot,createRunSaveStore} from './run-save.js';
import {RunChoiceWorld} from './run-choice.js';
import {crownOutline,crownVisual,bossFacePose,bossAngryEyeOutline,bossSpiralEye,bossHornOutline} from './boss-visuals.js';
import {skinContour,skinPoint} from './skins.js';
import {projectSkinContour,paintRadiance,createRadianceCanvas,fitCrownToSkin} from './skin-render.js';
import {PhotoRenderer,AuxiliaryPhotoPool} from './photo-renderer.js';
import {initWardrobe,loadAppearance,saveAppearance} from './wardrobe.js';
import {normalizeAppearanceState,unlockAppearance,selectAppearance,changeAppearance,appearanceFeedbackColor,acknowledgeAppearanceUnlock,BIG_EYE_DEFAULT_COLOR} from './appearances.js';
import {bigEyeGeometry,bigEyeColors,drawBigEye} from './big-eye.js';
import {normalizeStarTrailState,unlockStarTrails,acknowledgeStarTrailUnlock,selectStarTrail} from './star-trails.js';
import {StarParticles} from './star-particles.js';
import {unlockPose,unlockLeavePose,unlockSwitchPose,unlockStarTrailPose,unlockStarTrailGeometry,unlockTitleMarkup,createUnlockPanel} from './skin-unlock.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const defaults = {player:'#252720', enemy:'#e88c72', bg:'#f4f3eb', sound:true, expressions:true, bgmVolume:.55, sfxVolume:.75,juice:.6};
const palettes = {classic:{player:'#252720',enemy:'#e88c72',bg:'#f4f3eb'},night:{player:'#c9e88b',enemy:'#b2a2dc',bg:'#22272b'},pool:{player:'#205c67',enemy:'#eea752',bg:'#e7f2ee'}};
const hex = v => parseInt(v.slice(1), 16);
function lightenColor(color,amount){
  const channel=shift=>Math.round(((color>>shift)&255)*(1-amount)+255*amount);
  return (channel(16)<<16)|(channel(8)<<8)|channel(0);
}
const pad = v => String(Math.floor(v)).padStart(4,'0');
const storage = {read(key, fallback){try{return JSON.parse(localStorage.getItem(key)) ?? fallback;}catch{return fallback;}},write(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}};
const saved = storage.read('qiuqiule-settings',{});
const settings = {...defaults};
for (const key of ['player','enemy','bg']) if (/^#[0-9a-f]{6}$/i.test(saved[key])) settings[key] = saved[key];
for (const key of ['sound','expressions']) if (typeof saved[key] === 'boolean') settings[key] = saved[key];
for (const key of ['bgmVolume','sfxVolume']) settings[key] = audioLevel(saved[key],defaults[key]);
settings.juice=feedbackStrength(saved.juice);
const sound = new GameAudio();
let endlessProgress=normalizeEndless(storage.read('qiuqiule-endless',null),storage.read('qiuqiule-best',0));
let aimMetrics=normalizeAimMetrics(storage.read('qiuqiule-aim',null));
let runAimHoldDuration=aimHoldDuration(aimMetrics);
let best=endlessProgress.best;
let runDay=null,runNewRecord=false,recordPulse=0,recordCue=0,recordedStatsKey='';
let scene, game, world, drag = null, screen = 'home', paused = false, modal = null;
let transfer=null,uiAnchor=null,settingsOrigin='home',homeReveal=1,pauseOnArrival=false,releaseOverlay=0;
let result=null,controlFlight=null,menuTransition=null;
const runSaveStore=createRunSaveStore({getItem:key=>localStorage.getItem(key),
  setItem:(key,value)=>localStorage.setItem(key,value),removeItem:key=>localStorage.removeItem(key)});
let pendingRunSnapshot=null,resumeSlowRemaining=0,restoredView=null;
let scoreRevealTime=1.2;

let choicePress=null;
let choiceLabels=[];
let resultBlankPointer=null;

// Shape selection was retired. Previously saved polygon choices never enter
// the live renderer; custom photos and expressions share this circle contour.
let playerContour=skinContour(0),skinOverride=null;
let wardrobeUi=null,wardrobeTime=0,skinUnlock=null,appearance=null,appearanceUrl=null,appearanceLoading=true;
let photoCanvas=null,photoRenderer=null,auxiliaryPhotos=null,glowCanvas=null,glowContext=null,lastUiPose=null;
const savedAppearanceState=storage.read('qiuqiule-appearance-state',null);
let appearanceState=normalizeAppearanceState(savedAppearanceState,{best});
let appearanceTween=null,appearanceOverride=null;
let appearanceRevision=0,appearanceRequest=0;
let starTrailState=normalizeStarTrailState(storage.read('qiuqiule-star-trails',null),{highestStage:endlessProgress.maxStage});
let starTrailTween=null,starTrailOverride=null;
let wardrobeShowcase=null;
const wardrobeShowroom=new WardrobeShowroom();
const unlockShowroom=new WardrobeShowroom();

const strainedEyes=[-1,1].map(strainedEyeOutline);
const relaxedEyes=strainedEyes.map(relaxedEyeOutline);
const playerVisuals=new WeakMap();
// Each live player/clone owns one borrowed frame outline. Weak keys release
// it with the body; clipping and the body fill consume the same exact points.
const playerOutlines=new WeakMap();
const ballSegments=192;
const ballCircleX=new Float64Array(ballSegments+1),ballCircleY=new Float64Array(ballSegments+1);
for(let i=0;i<=ballSegments;i++){
  // Keep the separately sampled final vertex, including its round-off at 2π.
  const angle=i/ballSegments*Math.PI*2;
  ballCircleX[i]=Math.cos(angle);ballCircleY[i]=Math.sin(angle);
}
const crownPoints=crownOutline();
let viewport = displayMetrics(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
let home = new HomeWorld(viewport.width, viewport.height);
let lastScore = -1;
let toastTimer;
let homePlayColor = 0x9b89c5;
let homeSoundColor = 0xe88c72;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const scoreFeedback=new ScoreFeedback();
let feedbackDemo=false;
let runBest=best;

function isDark(color) {const n=hex(color);return ((n>>16)*.299+((n>>8)&255)*.587+(n&255)*.114)<135;}
// Gameplay information shares the score's ink, independent of body appearance.
function themeInkColor(){return isDark(settings.bg)?0xf0f2e8:0x252720;}
function applyTheme() {
  const dark = isDark(settings.bg);
  homeSoundColor=lightenColor(hex(settings.enemy),.18);
  // Keep the start ball distinct even when player/enemy colors are customized.
  const used=[hex(settings.player),homeSoundColor,0xc4dc86,0xb4ced4,hex(settings.bg)];
  const candidates=[0x9b89c5,0xb87859,0x548b88,0xba738d];
  const separation=color=>Math.min(...used.map(other=>[16,8,0].reduce((sum,shift)=>sum+(((color>>shift)&255)-((other>>shift)&255))**2,0)));
  homePlayColor=lightenColor(candidates.find(color=>separation(color)>=70**2)??candidates.sort((a,b)=>separation(b)-separation(a))[0],.08);
  document.documentElement.style.setProperty('--play-ball','#'+homePlayColor.toString(16).padStart(6,'0'));
  document.documentElement.style.setProperty('--face',isDark(settings.player)?'#f4f3eb':'#252720');
  const vars = {bg:settings.bg,player:settings.player,enemy:settings.enemy,ink:'#'+themeInkColor().toString(16).padStart(6,'0'),muted:dark?'#a3ada4':'#818479',line:dark?'#454e49':'#dcded3',panel:dark?'#2c3335':'#fbfbf6','on-ink':dark?'#252720':'#fffef8'};
  for (const [key,value] of Object.entries(vars)) document.documentElement.style.setProperty('--'+key,value);
  for(const effect of scene?.effects||[])if(effect.type==='label')effect.label.setColor?.(vars.ink);
  $$('[data-upgrade-kind]').forEach(node=>node.innerHTML=upgradeIconMarkup(node.dataset.upgradeKind,hex(settings.bg)));
  $('meta[name=theme-color]').content = settings.bg;
  document.documentElement.style.colorScheme=dark?'dark':'light';
  for (const key of ['player','enemy','bg']) {$('#'+key+'-color').value=settings[key];$('#'+key+'-hex').textContent=settings[key].toUpperCase();}
  $$('.palette').forEach(b=>b.classList.toggle('active',['player','enemy','bg'].every(k=>settings[k]===palettes[b.dataset.palette][k])));
  syncAudioSettings();
  $('#expressions-toggle').setAttribute('aria-checked',String(settings.expressions));
  syncFeedbackSettings();
  storage.write('qiuqiule-settings',settings);
  if (scene) scene.cameras.main.setBackgroundColor(settings.bg);
}

// Settings reset changes preferences only; ownership and run progress remain intact.
function restoreDefaultSettings(){
  Object.assign(settings,defaults);
  appearanceTween=null;
  if(appearanceState.selected==='big-eye'){
    appearanceState={...appearanceState,previousPlayerColor:defaults.player};
    persistAppearanceState();
  }
  applyTheme();wardrobeUi?.refresh();toast('已恢复默认设置');
}

function toast(message,force=false) {
  if(!force&&screen==='play'&&!modal&&!world?.isRunChoice)return;
  clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('show');
  toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2400);
}
function syncAudioSettings(){
  sound.setLevels(settings);
  $('#sound-toggle').setAttribute('aria-checked',String(settings.sound));
  $('#home-sound').setAttribute('aria-label',settings.sound?'撞击红球静音':'撞击红球开启声音');
  for(const key of ['bgm','sfx']){
    const value=Math.round(settings[key+'Volume']*100),input=$('#'+key+'-volume');
    input.value=value;input.style.setProperty('--volume',value+'%');
    input.setAttribute('aria-valuetext',value===0?'静音':value+'%');
    $('#'+key+'-value').value=value+'%';
  }
}
function unlockAudio(){if(sound.needsUnlock)sound.unlock();}
function tone(...args){sound.tone(...args);}
function clearChoicePress(){const press=choicePress;choicePress=null;if(press?.canvas.hasPointerCapture(press.id))press.canvas.releasePointerCapture(press.id);}
function updateChoicePress(now=scene?.inputClock||0){
  if(!choicePress)return;
  if(paused||modal||screen!=='play'||world?.phase!=='choose'||!world.choices.some(c=>c.id===choicePress.choiceId)){clearChoicePress();return;}
  choicePress.active ||= now-choicePress.startedAt>=.3-1e-9;
}
function cancelDrag(){resultBlankPointer=null;clearChoicePress();sound.stopCharge();drag?.aim?.cancel();drag=null;world?.cancelPull();if(scene)scene.timeScale=1;}
function aimInputTime(event){
  const clock=scene?.inputClock||0,stamp=Number(event?.timeStamp)/1000;
  if(drag?.aim&&Number.isFinite(stamp)&&Number.isFinite(drag.startStamp))return Math.max(clock,drag.aim.startedAt+Math.max(0,stamp-drag.startStamp));
  const sinceFrame=stamp-scene?.frameStamp;
  return clock+(Number.isFinite(sinceFrame)&&sinceFrame>=0&&sinceFrame<.25?sinceFrame:0);
}
function updateAim(now=scene?.inputClock||0){
  if(!drag?.aim){if(scene)scene.timeScale=resumeSlowRemaining>0?aimMinimumScale(reducedMotion):1;return null;}
  if(paused||modal||screen!=='play'||!world?.continuousControl){cancelDrag();return null;}
  const state=drag.aim.sample(now,{reducedMotion});
  if(state.active&&drag.pending){
    if(!world.beginPull()){cancelDrag();return null;}
    drag.pending=false;
    resumeSlowRemaining=0;
  }
  if(scene)scene.timeScale=state.active?state.scale:resumeSlowRemaining>0?aimMinimumScale(reducedMotion):1;
  return state;
}
function aimStatistics(){
  return {...aimMetricsReport(aimMetrics),currentRunHoldSeconds:screen==='play'?runAimHoldDuration:null};
}
function recordAimGesture(released){
  if(feedbackDemo||!released?.shouldShoot)return;
  aimMetrics=recordAimDuration(aimMetrics,released.slowSeconds);
  storage.write('qiuqiule-aim',aimMetrics);
}
function syncFeedbackSettings(){
  const value=Math.round(settings.juice*100),input=$('#feedback-strength');
  if(input){input.value=value;input.style.setProperty('--volume',value+'%');input.setAttribute('aria-valuetext',value+'%');}
  const output=$('#feedback-value');if(output)output.value=value+'%';
  world?.setFeedbackOptions({strength:settings.juice,reducedMotion});
  if(!settings.juice){
    sound.stopCharge();const ending=scene?.ending;scene?.resetFeedback?.();
    if(ending){scene.ending=ending;scene.timeScale=1;}
  }
}
function updateChargeFeedback(){
  if(!drag||drag.pending||screen!=='play'||paused||modal||!world||!settings.juice){sound.stopCharge();return;}
  const amount=clamp(Math.hypot(drag.dx,drag.dy)/world.maxPull,0,1);
  sound.setCharge(amount);
}
// Star trails decorate the main player without entering the simulation.
function starTrailLayers(){
  if(starTrailOverride)return starTrailOverride;
  if(!starTrailTween)return starTrailState.selected?[{id:starTrailState.selected,weight:1}]:[];
  const t=smooth(clamp(starTrailTween.elapsed/.18,0,1));
  const layers=starTrailTween.from.map(layer=>({...layer,weight:layer.weight*(1-t)}));
  if(starTrailTween.to)layers.push({id:starTrailTween.to,weight:t});
  const weights=new Map();
  for(const layer of layers)weights.set(layer.id,(weights.get(layer.id)||0)+layer.weight);
  return [...weights].filter(([,weight])=>weight>1e-7).map(([id,weight])=>({id,weight}));
}
function chooseStarTrail(id){
  const next=selectStarTrail(starTrailState,id);
  if(next.selected===starTrailState.selected)return false;
  const from=starTrailLayers();
  starTrailState=next;starTrailTween={from,to:next.selected,elapsed:0};
  scene?.starParticles?.clear();
  storage.write('qiuqiule-star-trails',starTrailState);wardrobeUi?.refresh();return true;
}
function updateStarTrailVisual(dt){
  const elapsed=Math.max(0,Number.isFinite(dt)?dt:0);
  if(starTrailTween){starTrailTween.elapsed+=elapsed;if(starTrailTween.elapsed>=.18)starTrailTween=null;}
}
function grantEndlessStarTrails(){
  if(!world||feedbackDemo)return false;
  const highestStage=Math.max(endlessProgress.maxStage||1,world.stage||1,world.maxStage||1);
  const unlocked=unlockStarTrails(starTrailState,highestStage);
  if(!unlocked.newlyUnlocked.length)return false;
  starTrailState=unlocked.state;storage.write('qiuqiule-star-trails',starTrailState);wardrobeUi?.refresh();return true;
}
function paintUiStarTrails(p){
  const el=$('#ui-star-trails'),reward=skinUnlock,frame=reward?.starFrame;
  if(!el)return;
  el.hidden=!frame||!(frame.trailProgress>0)||wardrobeUi?.isCropping?.()===true||!(p.r>0);
  if(el.hidden)return;
  const size=p.r*4,offset=p.r*2;
  el.style.width=el.style.height=size+'px';
  el.style.transform=`translate3d(${p.x-offset}px,${p.y-offset}px,0)`;
  el.style.clipPath='none';
  unlockShowroom.paint(el,{pose:{x:offset,y:offset,r:p.r},length:reward.starGeometry.length*frame.trailProgress,
    alpha:frame.trailAlpha,color:playerFeedbackColor(),layers:starTrailLayers()});
}

function wardrobePreviewGeometry(){
  const box=$('#wardrobe-panel .wardrobe-preview').getBoundingClientRect(),anchor=$('#wardrobe-ball').getBoundingClientRect();
  const ratio=cometProfile(33,1,1,.6).length;
  const r=Math.min(anchor.width/2,Math.max(1,(box.width-32)/(ratio+1.8)));
  const length=ratio*r;
  const x=box.left+box.width/2+(length-r)/2-.35*r;
  const y=clamp(anchor.y+anchor.height/2,box.top+r+8,box.bottom-r-8);
  const finish={x,y,r},start={x:x-length,y,r};
  return {start,finish,length};
}
function wardrobeShowcasePose(){
  const state=wardrobeShowcase,{start,finish}=wardrobePreviewGeometry();
  const t=state?.phase==='draw'?smooth(clamp(state.elapsed/(reducedMotion?.16:.26),0,1)):1;
  const from=state?.from||{};
  return {...from,x:lerp(start.x,finish.x,t),y:finish.y,r:finish.r,
    squash:(from.squash||0)*(1-t)+(reducedMotion?0:Math.sin(Math.PI*t)*.06)};
}
function paintWardrobeShowroom(p){
  const el=$('#wardrobe-showroom'),state=wardrobeShowcase;
  if(!el)return;
  const visible=modal==='wardrobe'&&state&&state.phase!=='approach'&&!wardrobeUi?.isCropping?.();
  el.hidden=!visible;if(!visible)return;
  const {length}=wardrobePreviewGeometry(),progress=state.phase==='draw'?smooth(clamp(state.elapsed/(reducedMotion?.16:.26),0,1)):
    state.phase==='retract'?1-smooth(clamp(state.elapsed/(reducedMotion?.12:.18),0,1)):1;
  const offset=p.r*2,box=$('#wardrobe-panel .wardrobe-preview').getBoundingClientRect();
  el.style.width=el.style.height=p.r*4+'px';
  el.style.transform=`translate3d(${p.x-offset}px,${p.y-offset}px,0)`;
  el.style.clipPath=`inset(${box.top-p.y+offset}px ${p.x+offset-box.right}px ${p.y+offset-box.bottom}px ${box.left-p.x+offset}px)`;
  wardrobeShowroom.paint(el,{pose:{x:offset,y:offset,r:p.r},length:length*progress,
    alpha:state.phase==='retract'?progress:1,color:playerFeedbackColor(),layers:starTrailLayers()});
}
function navigateWardrobePreview(from,to,commit){
  if(to==='star-trail'){
    const pose=currentPlayerPose();wardrobeShowroom.reset();
    wardrobeShowcase={phase:'approach',elapsed:0,from:{...pose}};commit();
    movePlayer({...pose,visualSquash:pose.squash||0},'wardrobe-start',reducedMotion?.16:.28,()=>{
      uiAnchor='wardrobe';wardrobeShowcase={phase:'draw',elapsed:0,from:{...lastUiPose}};
      wardrobeShowroom.step(0,{radius:lastUiPose.r,layers:starTrailLayers(),reducedMotion});
    });return;
  }
  if(from==='star-trail'&&wardrobeShowcase){
    wardrobeShowcase={...wardrobeShowcase,phase:'retract',elapsed:0,done:pose=>{
      commit();wardrobeTime=0;
      movePlayer({...pose,visualSquash:pose.squash||0},'wardrobe',reducedMotion?.22:.32,()=>{wardrobeTime=0;});
    }};syncInputs();return;
  }
  commit();
}
function stepWardrobeShowcase(dt){
  const state=wardrobeShowcase;if(!state||state.phase==='approach')return;
  const elapsed=document.hidden||wardrobeUi?.isCropping?.()?0:Math.max(0,dt);
  if(state.phase!=='idle')state.elapsed+=elapsed;
  const pose=wardrobeShowcasePose();
  wardrobeShowroom.step(elapsed,{radius:pose.r,layers:starTrailLayers(),reducedMotion});
  paintUiBall(pose);$('#ui-ball').dataset.state='wardrobe';
  if(state.phase==='draw'&&state.elapsed>=(reducedMotion?.16:.26)){
    state.phase='idle';state.elapsed=0;syncInputs();$('#wardrobe-back').focus?.({preventScroll:true});
  }else if(state.phase==='retract'&&state.elapsed>=(reducedMotion?.12:.18)){
    wardrobeShowcase=null;wardrobeShowroom.reset();$('#wardrobe-showroom').hidden=true;
    state.done?.(pose);
  }
}

function appearanceLayers(){
  if(appearanceOverride)return appearanceOverride;
  if(!appearanceTween)return [{id:appearanceState.selected==='custom'&&!appearance?'original':appearanceState.selected,color:hex(settings.player),weight:1}];
  const t=smooth(clamp(appearanceTween.elapsed/.28,0,1));
  return [...appearanceTween.from.map(layer=>({...layer,weight:layer.weight*(1-t)})),{...appearanceTween.to,weight:t}].filter(layer=>layer.weight>1e-7);
}
function appearanceLayer(id,layers=appearanceLayers()){
  let weight=0,color=hex(settings.player);
  for(const layer of layers)if(layer.id===id&&layer.weight>0){color=weight?blendRgb(color,layer.color,layer.weight/(weight+layer.weight)):layer.color;weight+=layer.weight;}
  return {weight,color};
}
function persistAppearanceState(){storage.write('qiuqiule-appearance-state',appearanceState);}
function playerFeedbackColor(){
  let color=hex(settings.player),weight=0;
  for(const layer of appearanceLayers()){
    const ink=appearanceFeedbackColor(layer.color,settings.bg,layer.id);
    color=weight?blendRgb(color,ink,layer.weight/(weight+layer.weight)):ink;
    weight+=layer.weight;
  }
  return color;
}
function chooseAppearance(id){
  const next=changeAppearance(appearanceState,id,{hasImage:!!appearanceUrl||appearanceLoading,playerColor:settings.player});
  if(!next.changed){if(id===appearanceState.selected)persistAppearanceState();return false;}
  const from=appearanceLayers().map(layer=>({...layer}));
  appearanceState=next.state;
  if(settings.player!==next.playerColor){settings.player=next.playerColor;applyTheme();}
  appearanceTween={from,to:{id,color:hex(settings.player),weight:1},elapsed:0};
  persistAppearanceState();wardrobeUi?.refresh();return true;
}
function grantEndlessAppearance(){
  if(!world||feedbackDemo)return false;
  const unlocked=unlockAppearance(appearanceState,world.score);
  if(!unlocked.newlyUnlocked)return false;
  appearanceState=unlocked.state;persistAppearanceState();wardrobeUi?.refresh();return true;
}
function activeContour(){return skinOverride||playerContour;}
function usesSkinContour(){return !!(appearance||skinOverride||appearanceLayers().some(layer=>layer.id==='big-eye'));}
function updateSkin(dt){
  if(appearanceTween&&!(appearanceTween.to.id==='custom'&&!appearance)){
    appearanceTween.elapsed+=dt;if(appearanceTween.elapsed>=.28)appearanceTween=null;
  }
  wardrobeUi?.update?.(dt);
}
function clearPhoto(){
  photoRenderer?.hide();
  auxiliaryPhotos?.hide();
  if(glowCanvas)glowCanvas.hidden=true;
  const starTrails=$('#ui-star-trails');if(starTrails)starTrails.hidden=true;
  const showroom=$('#wardrobe-showroom');if(showroom)showroom.hidden=true;
}
function releaseUnlockGlow(){
  if(!glowCanvas)return;
  glowCanvas.hidden=true;
  if(glowCanvas.width!==1)glowCanvas.width=1;
  if(glowCanvas.height!==1)glowCanvas.height=1;
}
function drawPlayerPhoto(contour,pose,ui=false,auxiliarySlot=null,alpha=1,baseColor=hex(settings.player)){
  if(!appearance||!photoRenderer||wardrobeUi?.isCropping?.())return false;
  if(auxiliarySlot===null)photoCanvas.style.zIndex=ui?'40':'3';
  const camera=!ui&&screen==='play'?scene?.feedbackCamera:null;
  if(camera&&camera.zoom!==1)pose={...pose,x:camera.x+(pose.x-camera.x)*camera.zoom,y:camera.y+(pose.y-camera.y)*camera.zoom,r:pose.r*camera.zoom};
  const options={scale:Math.min(viewport.scale,3),clip:null,alpha,baseColor};
  if(auxiliarySlot!==null)return auxiliaryPhotos?.draw(auxiliarySlot,contour,pose,options)===true;
  return photoRenderer.draw(contour,pose,options)===true;
}
async function setAppearance(url,persist=false,revision=null){
  // A replacement only retires startup hydration after it is saved. If decode
  // or storage fails, the old saved picture can still finish loading normally.
  const request=revision===null?++appearanceRequest:null;
  const current=()=>request===null?revision===appearanceRevision:request===appearanceRequest;
  let image=null;
  if(url){image=new Image();image.src=url;await image.decode();}
  if(!current())return;
  if(persist)await saveAppearance(url);
  if(!current())return;
  if(request!==null)appearanceRevision++;
  appearance=image;appearanceUrl=url;appearanceLoading=false;photoRenderer?.setImage(image);auxiliaryPhotos?.setImage(image);
  if(persist){
    if(image){chooseAppearance('custom');appearanceTween=null;}
    else if(appearanceState.selected==='custom'){appearanceState=selectAppearance(appearanceState,'original',{hasImage:false});appearanceTween=null;}
    persistAppearanceState();
  }
  if(!image)clearPhoto();
  wardrobeUi?.refresh();
}
function initializeSkins(){
  const panel=createUnlockPanel(document);$('#modal-layer').append(panel);
  panel.addEventListener('click',dismissSkinUnlock);
  photoCanvas=document.createElement('canvas');photoCanvas.id='player-photo';
  photoCanvas.setAttribute('aria-hidden','true');
  Object.assign(photoCanvas.style,{position:'fixed',left:'0',top:'0',pointerEvents:'none',zIndex:'3'});
  photoCanvas.width=photoCanvas.height=1;photoCanvas.hidden=true;
  document.body.append(photoCanvas);photoRenderer=new PhotoRenderer(photoCanvas);
  auxiliaryPhotos?.dispose();
  auxiliaryPhotos=new AuxiliaryPhotoPool(document,{before:photoCanvas,maxPixels:512,maxSlots:20});
  auxiliaryPhotos.setImage(appearance);
  scene?.events?.once('shutdown',()=>auxiliaryPhotos?.dispose());
  glowCanvas=document.createElement('canvas');glowCanvas.id='skin-radiance';releaseUnlockGlow();
  glowCanvas.setAttribute('aria-hidden','true');
  Object.assign(glowCanvas.style,{position:'fixed',pointerEvents:'none',zIndex:'35'});
  document.body.append(glowCanvas);glowContext=glowCanvas.getContext('2d');
  wardrobeUi=initWardrobe({getState:()=>({image:appearanceUrl,imageLoading:appearanceLoading,appearanceId:appearanceState.selected,appearanceUnlocked:appearanceState.bigEyeUnlocked,starTrailId:starTrailState.selected,starTrailUnlocked:starTrailState.unlocked,playerColor:settings.player,best,highestStage:endlessProgress.maxStage}),
    onAppearance:chooseAppearance,onStarTrail:chooseStarTrail,onNavigate:navigateWardrobePreview,
    onImage:url=>setAppearance(url,true),onError:message=>toast(message)});
  storage.write('qiuqiule-star-trails',starTrailState);
  const revision=appearanceRevision;
  loadAppearance().then(async url=>{if(revision!==appearanceRevision)return;appearanceUrl=url;wardrobeUi?.refresh();await setAppearance(url,false,revision);if(revision!==appearanceRevision)return;
    const latest=storage.read('qiuqiule-appearance-state',savedAppearanceState);
    appearanceState=normalizeAppearanceState(latest,{best,hasImage:!!appearance});persistAppearanceState();wardrobeUi?.refresh();}).catch(()=>{if(revision!==appearanceRevision)return;appearanceLoading=false;wardrobeUi?.refresh();toast('图片暂时无法读取，请重新选取');});
}
function fitMenuHeight(){
  const panel=$('#settings-panel'),hidden=panel.hidden;
  if(hidden)panel.classList.add('menu-measure');
  const css=getComputedStyle(panel),heading=panel.querySelector('.settings-heading'),body=panel.querySelector('.menu-body');
  const hs=getComputedStyle(heading),bs=getComputedStyle(body);
  const height=panel.querySelector('.menu-content').getBoundingClientRect().height+heading.getBoundingClientRect().height
    +[css.paddingTop,css.paddingBottom,css.borderTopWidth,css.borderBottomWidth,hs.marginBottom,bs.paddingTop,bs.paddingBottom].reduce((n,v)=>n+parseFloat(v),0);
  $('#modal-layer').style.setProperty('--menu-height',Math.ceil(height)+'px');
  if(hidden)panel.classList.remove('menu-measure');
}
function resetMenuTransition(){
  menuTransition=null;$('#modal-layer').classList.remove('menu-switching');
  $$('.menu-panel').forEach(p=>{p.inert=false;p.style.removeProperty('opacity');});
}
function transitionMenu(target){
  const from=modal;
  if(!['settings','help'].includes(from)||from===target)return;
  if(reducedMotion){showPanel(target);uiAnchor=target;paintUiBall(anchorPose(target));return;}
  showPanel('menu-transition');
  menuTransition={from,target,elapsed:0};
  $('#modal-layer').classList.add('menu-switching');
  for(const name of [from,target]){
    const panel=$('#'+name+'-panel');panel.inert=true;panel.style.opacity=name===from?'1':'0';
  }
  $('#'+from+'-panel').hidden=false;
  uiAnchor='menu-transition';paintUiBall(anchorPose(uiAnchor));
}
function updateMenuTransition(dt){
  if(!menuTransition)return;
  const move=menuTransition;move.elapsed+=dt;
  const duration=.12,oldPanel=$('#'+move.from+'-panel'),newPanel=$('#'+move.target+'-panel');
  if(move.elapsed<duration){oldPanel.style.opacity=1-smooth(move.elapsed/duration);return;}
  oldPanel.hidden=true;newPanel.hidden=false;
  newPanel.style.opacity=smooth((move.elapsed-duration)/duration);
  if(move.elapsed<duration*2)return;
  const target=move.target;showPanel(target,{fade:false});uiAnchor=target;paintUiBall(anchorPose(target));
}
function syncInputs(){
  const moving=!!transfer||!!controlFlight||!!wardrobeShowcase&&wardrobeShowcase.phase!=='idle';
  $('#modal-layer').inert=moving;
  $('#home').inert=!!modal||moving||screen==='entering';
  $('#hud').inert=!!modal||moving||screen==='entering';
  ;
}
function showPanel(name,{fade=true}={}){
  resetMenuTransition();cancelDrag();sound.clearEnd();modal=name;paused=screen==='play';
  $('#settings-panel').classList.toggle('panel-fade-in',name==='settings'&&fade);
  if(name==='pause'){
    const available=screen==='play';
    $('#pause-upgrades').hidden=!available;$('#pause-panel').classList.toggle('with-run-upgrades',available);
  }
  if(scene?.wallFlashes)scene.wallFlashes=scene.wallFlashes.filter(flash=>!flash.bossDefeat);
  $('#modal-layer').hidden=false;
  $$('.panel').forEach(p=>{p.hidden=p.id!==name+'-panel';});
  if(['settings','help','menu-transition'].includes(name))fitMenuHeight();
  syncInputs();
  requestAnimationFrame(()=>{if(modal===name&&!transfer)$('#'+name+'-panel').querySelector('button:not([hidden])')?.focus({preventScroll:true});});
}
function hidePanel(){resetMenuTransition();wardrobeUi?.cancelInteraction();if(modal==='wardrobe'){wardrobeShowcase=null;wardrobeShowroom.reset();$('#wardrobe-showroom').hidden=true;}modal=null;$('#modal-layer').hidden=true;syncInputs();}
function setPanel(name){if(name==='pause')openPause();else showPanel(name);}
function anchorPose(anchor){
  if(anchor==='wardrobe-start')return wardrobePreviewGeometry().start;
  if(anchor==='wardrobe-trail')return wardrobePreviewGeometry().finish;
  if(anchor==='arena')return arenaPlayerPose();
  if(anchor==='home')return {...home.layout.player};
  const box=$('#'+anchor+'-ball').getBoundingClientRect();
  return {x:box.x+box.width/2,y:box.y+box.height/2,r:box.width/2};
}
function rewardPlayerPose(body){
  // The upgrade and wall correction apply to collisions immediately. Only
  // their painted size/offset blend, using resize-safe units and a paused clock.
  const growth=world&&scene?.rewardVisuals?.world===world&&body===world.player?scene.rewardVisuals.growth:null;
  if(!growth)return body;
  const t=smooth((world.feedbackTime-growth.at)/.2);
  return {x:body.x+(growth.x||0)*world.unit*(1-t),y:body.y+(growth.y||0)*world.unit*(1-t),r:body.r*lerp(growth.from,1,t)};
}
function arenaPlayerPose(){
  const p={...world.player};
  {
    Object.assign(p,rewardPlayerPose(world.player));
    if(world.phase==='transition')p.roll=world.player.roll??Math.PI*2*world.rewardMoveProgress;
  }
  return p;
}

function resultHasCrown(){return !!result&&(result.bossKills>0||result.maxCombo>=6);}
function resultCrownOpacity(){return resultHasCrown()?smooth(((result.crownAge||0)-.08)/.32):0;}
function currentPlayerPose(){return transfer&&lastUiPose?{...lastUiPose}:wardrobeShowcase?(wardrobeShowcase.phase==='approach'&&lastUiPose?{...lastUiPose}:wardrobeShowcasePose()):skinUnlock&&lastUiPose?{...lastUiPose}:uiAnchor==='wardrobe'?resultBounce(anchorPose('wardrobe'),wardrobeTime,reducedMotion):uiAnchor==='over'?{...resultBounce(anchorPose('over'),result?.bounceTime||0,reducedMotion),visualCrownAlpha:resultCrownOpacity()}:uiAnchor?anchorPose(uiAnchor):screen==='home'?{...home.player}:arenaPlayerPose();}
function detached(){return !!skinUnlock||!!transfer||!!uiAnchor||['pause','settings','help','wardrobe','run-upgrades'].includes(modal);}
function paintUiBall(p){
  lastUiPose={...p};
  const el=$('#ui-ball'),sq=p.squash||0;
  const layers=appearanceLayers(),original=appearanceLayer('original',layers),bigEye=appearanceLayer('big-eye',layers),custom=appearanceLayer('custom',layers);
  el.hidden=false;el.style.width=el.style.height=p.r*2+'px';
  el.style.clipPath='none';
  // Only the showroom ribbon is clipped. Keep the shared ball whole during
  // travel, squash and bounce, including its first frame back in the wardrobe.
  el.style.transform=`translate3d(${p.x-p.r}px,${p.y-p.r}px,0) scale(${1-sq},${1+sq*.7})`;
  const body=el.querySelector('.ui-body'),contour=el.querySelector('.ui-pull-outline');
  const amount=p.visualPull?.amount||0,angle=p.visualPull?.angle||0;
  const skinned=usesSkinContour();
  const skinPose=skinned||bigEye.weight>0?{x:50,y:50,r:50,pullAmount:amount,deformAngle:angle,roll:p.roll||0,squash:sq}:null;
  const skinOutline=skinned?projectSkinContour(activeContour(),skinPose):null;
  const skinPath=skinOutline?skinOutline.map((q,i)=>`${i?'L':'M'}${q.x} ${q.y}`).join(' ')+' Z':null;
  body.style.display=skinned||amount>0?'none':'';contour.style.display=skinned||amount>0?'':'none';
  if(skinned){
    el.style.transform=`translate3d(${p.x-p.r}px,${p.y-p.r}px,0)`;
    contour.setAttribute('d',skinPath);
  }else if(amount>0){
    const cos=Math.cos(angle),sin=Math.sin(angle),points=[];
    for(let i=0;i<=ballSegments;i++){
      const q=pullBallPoint(ballCircleX[i],ballCircleY[i],amount);
      points.push(`${i?'L':'M'}${50+50*(q.x*cos-q.y*sin)} ${50+50*(q.x*sin+q.y*cos)}`);
    }
    contour.setAttribute('d',points.join(' ')+' Z');
  }
  if(appearance&&custom.weight>0){
    // The photo and outline share the same nonlinear pull; the photo is never
    // a rigid image hidden behind a separately stretching mask.
    drawPlayerPhoto(activeContour(),{x:p.x,y:p.y,r:p.r,squash:sq,pullAmount:amount,deformAngle:angle,roll:p.roll||0},true,null,custom.weight,custom.color);
  }
  const eyes=el.querySelector('.ui-eyes'),normal=el.querySelector('.ui-normal-eyes'),paths=el.querySelector('.ui-eye-paths');
  const mix=clamp(p.visualEyeMix||0,0,1),visual=p.visualEyeMix!==undefined;
  normal.style.display=mix>0?'none':'';paths.style.display=mix>0?'':'none';
  if(mix>0){
    for(const [i,side] of [-1,1].entries()){
      const points=strainedEyes[i].map((point,j)=>{
        const relaxed=relaxedEyes[i][j];
        return `${j?'L':'M'}${50+side*8.5+50*(relaxed.x+(point.x-relaxed.x)*mix)} ${46.5+50*(relaxed.y+(point.y-relaxed.y)*mix)}`;
      });
      el.querySelector(i?'.ui-eye-right':'.ui-eye-left').setAttribute('d',points.join(' ')+' Z');
    }
  }
  // Canvas breathing deforms the body only. Cancel the overlay body's scale
  // for captured selection eyes, then retain the existing gaze/roll transform.
  eyes.style.transform=`${visual&&!skinned?`scale(${1/(1-sq)},${1/(1+sq*.7)}) `:skinned&&!visual?`scale(${1-sq},${1+sq*.7}) `:''}rotate(${p.roll||0}rad) translate(${(p.lookX||0)*50}px,${(p.lookY||0)*50}px)`;
  eyes.style.opacity='.9';
  eyes.style.display=original.weight>0?'':'none';
  const ordinaryColor='#'+original.color.toString(16).padStart(6,'0');
  body.style.fill=contour.style.fill=ordinaryColor;
  eyes.style.fill=isDark(ordinaryColor)?'#f4f3eb':'#252720';
  const bigGroup=el.querySelector('.ui-big-eye');
  bigGroup.style.display=bigEye.weight>0?'':'none';
  if(bigEye.weight>0){
    if(!original.weight){body.style.display='none';contour.style.display='none';}
    const geometry=bigEyeGeometry(activeContour(),skinPose,{lookX:p.lookX||0,lookY:p.lookY||0,projectedOutline:skinOutline});
    const colors=bigEyeColors(bigEye.color),toHex=color=>'#'+color.toString(16).padStart(6,'0');
    el.querySelector('.ui-big-eye-center').setAttribute('stop-color',toHex(colors.center));
    el.querySelector('.ui-big-eye-edge').setAttribute('stop-color',toHex(colors.edge));
    const shape=el.querySelector('.ui-big-eye-body');
    shape.setAttribute('d',geometry.outline===skinOutline?skinPath:geometry.outline.map((point,i)=>`${i?'L':'M'}${point.x} ${point.y}`).join(' ')+' Z');
    const pupil=el.querySelector('.ui-big-eye-pupil');pupil.setAttribute('cx',geometry.eye.x);pupil.setAttribute('cy',geometry.eye.y);pupil.setAttribute('r',geometry.eye.r);
    bigGroup.style.opacity=String(bigEye.weight/(original.weight+bigEye.weight));
  }

  const resultCrown=el.querySelector('.ui-result-crown');
  if(resultCrown){
    const settled=uiAnchor==='over'&&!transfer&&!skinUnlock;
    const alpha=p.visualCrownAlpha??(settled?resultCrownOpacity():0);
    const visible=alpha>0||settled&&resultHasCrown();
    resultCrown.style.display=visible?'':'none';
    resultCrown.style.opacity=String(alpha);
    if(visible){
      const points=fitCrownToSkin(crownPoints,activeContour()).map(point=>({x:50+point.x*35,y:50+(-1+(point.y+1)*.7)*50}));
      resultCrown.setAttribute('d',points.map((point,i)=>`${i?'L':'M'}${point.x} ${point.y}`).join(' ')+' Z');
    }
  }
  if(wardrobeUi?.isCropping?.())el.hidden=true;
  paintUiStarTrails(p);
  paintWardrobeShowroom(p);
}
function movePlayer(from,target,duration,done){
  cancelDrag();transfer={from:{...from},target,duration:reducedMotion?Math.min(duration,.25):duration,elapsed:0,done,revealHome:screen==='home'&&homeReveal<1&&target==='home'};
  paintUiBall(from);syncInputs();
}
function updateUiBall(dt){
  const entryPhase=wardrobeShowcase?.phase;
  if(document.hidden&&wardrobeShowcase){if(lastUiPose)paintUiBall(lastUiPose);return;}
  let completedTransfer=false;
  // Start the crown clock only on frames already settled at the result anchor.
  // The incoming flight's final dt must not consume the fade before first paint.
  if(result&&uiAnchor==='over'&&!transfer&&!skinUnlock)result.crownAge=(result.crownAge||0)+dt;

  updateMenuTransition(dt);
  $('#result-shadow').hidden=true;
  if(skinUnlock){updateSkinUnlock(dt);return;}
  if(result){
    result.clock+=dt;

  }
  if(transfer){
    const move=transfer;move.elapsed+=dt;
    const progress=clamp(move.elapsed/move.duration,0,1),pose=transferPose(move.from,anchorPose(move.target),progress);
    if(move.from.visualCrownAlpha!==undefined)pose.visualCrownAlpha=move.from.visualCrownAlpha*(1-smooth(move.elapsed/.18));
    paintUiBall(pose);$('#ui-ball').dataset.state='moving';
    if(move.revealHome)homeReveal=smooth(progress);
    if(progress===1){
      completedTransfer=true;
      // Home retains the gaze from the launch that opened a menu. The overlay
      // has eased to its neutral anchor; resume the canvas from that exact gaze.
      if(move.target==='home')Object.assign(home.player,{lookX:pose.lookX,lookY:pose.lookY});
      transfer=null;uiAnchor=['pause','settings','over','wardrobe','run-upgrades'].includes(move.target)?move.target:null;
      move.done?.();if(!uiAnchor&&!transfer)releaseOverlay=1;syncInputs();
      if(modal&&!transfer)$('#'+modal+'-panel').querySelector('button:not([hidden])')?.focus({preventScroll:true});
    }
  }
  if(wardrobeShowcase){
    stepWardrobeShowcase(entryPhase===wardrobeShowcase.phase?dt:0);
    updateControlFlight(dt);return;
  }
  if(!transfer){
    $('#ui-ball').dataset.state=uiAnchor||'hidden';
    if(uiAnchor){
      const pose=anchorPose(uiAnchor),panel=$('#'+uiAnchor+'-panel').getBoundingClientRect();
      if(uiAnchor==='over'&&result||uiAnchor==='wardrobe'){
        if(uiAnchor==='wardrobe'){if(!completedTransfer)wardrobeTime+=dt;}else result.bounceTime+=dt;
        const bouncing=resultBounce(pose,uiAnchor==='wardrobe'?wardrobeTime:result.bounceTime,reducedMotion);
        paintUiBall(bouncing);
        const shadow=$('#result-shadow');shadow.hidden=false;
        shadow.style.width=pose.r*1.75+'px';shadow.style.height=pose.r*.25+'px';
        shadow.style.transform=`translate3d(${pose.x-pose.r*.875}px,${bouncing.shadowY}px,0) scale(${bouncing.shadowScale},${bouncing.shadowScale})`;
        shadow.style.opacity=bouncing.shadowOpacity;shadow.style.filter=`blur(${bouncing.shadowBlur}px)`;
        if(wardrobeUi?.isCropping?.())shadow.hidden=true;
      }else if(pose.y-pose.r>=panel.top&&pose.y+pose.r<=panel.bottom)paintUiBall(pose);else $('#ui-ball').hidden=true;
    }
    else if(releaseOverlay>0)releaseOverlay--;
    else $('#ui-ball').hidden=true;
  }
  updateControlFlight(dt);
  if($('#ui-ball').hidden){const starTrails=$('#ui-star-trails');if(starTrails)starTrails.hidden=true;}
}

function controlPose(id){
  const box=$('#result-'+id).getBoundingClientRect();
  return {x:box.x+box.width/2,y:box.y+box.height/2,r:box.width/2};
}
function mixColor(a,b,t){
  const aa=hex(a),bb=hex(b),channel=shift=>Math.round(((aa>>shift)&255)*(1-t)+((bb>>shift)&255)*t);
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}
function flyControls(items,duration,done,onProgress){
  $('#control-transfers').replaceChildren();
  controlFlight={items:items.map(item=>{
    const el=document.createElement('div');el.className='control-transfer';el.innerHTML=iconMarkup(item.icon)+(item.nextIcon?iconMarkup(item.nextIcon):'');
    const carriesEnemy=item.appear&&isSpecialEnemy(item.from);
    if(carriesEnemy)el.innerHTML+=enemyTransferMarkup(item.from,hex(item.fromColor),{unit:item.from.renderUnit,player:world?.player});
    $('#control-transfers').append(el);return {...item,el,enemySource:carriesEnemy?el.lastElementChild:null};
  }),elapsed:0,duration:reducedMotion?Math.min(.25,duration):duration,done,onProgress};
  updateControlFlight(0);syncInputs();
}
function updateControlFlight(dt){
  if(!controlFlight)return;
  const flight=controlFlight;flight.elapsed+=dt;
  const progress=flight.elapsed+1e-9>=flight.duration?1:clamp(flight.elapsed/flight.duration,0,1),t=smooth(progress);
  flight.onProgress?.(progress);
  for(const item of flight.items){
    const pose=transferPose(item.from,item.to(),progress),el=item.el;
    el.style.width=el.style.height=pose.r*2+'px';
    el.style.transform=`translate3d(${pose.x-pose.r}px,${pose.y-pose.r}px,0) scale(${1-pose.squash},${1+pose.squash*.7})`;
    const fromColor=item.enemySource?'#'+enemyBodyColor(item.from,hex(item.fromColor)).toString(16).padStart(6,'0'):item.fromColor;
    const color=mixColor(fromColor,item.toColor,t);
    el.style.background=item.enemySource?color.replace('rgb(','rgba(').replace(')',`,${t})`):color;
    if(item.enemySource)item.enemySource.style.opacity=1-t;
    el.firstElementChild.style.opacity=item.appear?t:item.persist?1:1-t;
    el.firstElementChild.style.transform=`rotate(${(1-t)*-.3}rad)`;
    if(item.nextIcon)el.lastElementChild.style.opacity=t;
  }
  if(progress===1){controlFlight=null;flight.done?.();$('#control-transfers').replaceChildren();syncInputs();}
}
function openResult(view=null){
  if(!world||result||skinUnlock)return;
  if(world.isRunChoice){showHome();return;}
  if(world.phase==='over'){
    if(!runSaveStore.invalidate())toast('进度存储暂不可用，本局结算未能写入',true);
    pendingRunSnapshot=null;
  }else if(!discardRunSave()){toast('未能清除存档，请稍后再结算',true);return;}
  resumeSlowRemaining=0;
  scene.resetFeedback?.();
  const fromPause=modal==='pause',from=view?.player||currentPlayerPose();
  const sources=fromPause?[]:(view?.enemies||world.enemies).slice(0,2).map(b=>{
    const size=ease(b.born)*injuredEnemyScale(b,true);return {...b,r:Math.max(1,b.r*size),renderUnit:world.unit*size};
  });
  if(world.phase!=='over')sound.setMusicScene('resultEndless');
  cancelDrag();world.phase='over';world.choices=[];updateChoices();saveEndlessProgress();
  const rewards=feedbackDemo?[]:[...(appearanceState.pendingUnlock?[{kind:'appearance',id:'big-eye'}]:[]),
    ...starTrailState.pendingUnlocks.map(id=>({kind:'star-trail',id}))];
  if(rewards.length){beginSkinUnlock(from,sources,rewards,fromPause,view);return;}
  presentResult(from,fromPause,sources,.4,view);
}
function presentResult(from,fromPause,sources,duration=.4,view=null){
  $('#final-score').style.transform='scale(1)';$('#final-score').textContent=pad(world.score);$('#final-score').style.color='';
  const combo=Math.max(world.maxCombo||0,world.shotKills||0),stage=Math.max(world.maxStage||0,world.stage||1);
  const peak=$('#result-peak'),records=$('#result-records');
  if(peak){peak.hidden=false;peak.innerHTML=`<span>最大连击 <b>${combo}</b></span><span>到达阶段 <b>${stage}</b></span>`;}
  if(records){records.hidden=feedbackDemo;records.textContent=feedbackDemo?'':`历史最佳${best}`;}
  result={clock:0,bounceTime:0,crownAge:0,maxCombo:combo,maxStage:stage,bossKills:Math.max(0,world.bossKills||0),sceneBodies:view,sourceIds:fromPause?[]:sources.map(b=>b.id)};
  $('#hud').hidden=true;showPanel('over');$('.result-actions').classList.toggle('arriving',!fromPause);movePlayer(from,'over',duration);
  // Voluntary settlement reveals the real controls with the panel's own fade.
  if(fromPause)return;
  flyControls(['restart','home'].map((id,i)=>({
    from:sources[i]||from,to:()=>controlPose(id),icon:id,
    fromColor:settings.enemy,
    toColor:i?'#91b8c7':'#e88c72',appear:true,persist:false
  })),duration,()=>$('.result-actions').classList.remove('arriving'));
}

function unlockAnchor(){
  const panel=$('#skin-unlock-panel'),previous=panel.style.transform;
  panel.style.transform='translate(-50%,-50%)';
  const pose=anchorPose('skin-unlock');panel.style.transform=previous;return pose;
}
function unlockStarGeometry(){
  const panel=$('#skin-unlock-panel'),previous=panel.style.transform;
  panel.style.transform='translate(-50%,-50%)';
  const box=panel.getBoundingClientRect(),anchor=anchorPose('skin-unlock');
  panel.style.transform=previous;
  return unlockStarTrailGeometry({left:box.left,width:box.width,y:anchor.y});
}
function blendUnlockLayers(from,to,amount){
  const layers=new Map();
  for(const layer of [...from.map(item=>({...item,weight:item.weight*(1-amount)})),...to.map(item=>({...item,weight:item.weight*amount}))]){
    const key=`${layer.id}:${layer.color??''}`,previous=layers.get(key);
    if(previous)previous.weight+=layer.weight;else layers.set(key,layer);
  }
  return [...layers.values()].filter(layer=>layer.weight>1e-7);
}
function setUnlockTitle(kind){
  const title=$('#skin-unlock-title');if(title.dataset.kind===kind)return;
  title.dataset.kind=kind;title.innerHTML=unlockTitleMarkup(kind);title.setAttribute('aria-label',kind==='star-trail'?'已获得星迹！':'已解锁外观！');
}
function beginSkinUnlock(from,sources,rewards,fromPause=false,view=null){
  if(!rewards.length)return;
  cancelDrag();transfer=null;uiAnchor=null;paused=true;unlockShowroom.reset();
  const originalAppearance=appearanceLayers().map(layer=>({...layer})),originalStarTrails=starTrailLayers().map(layer=>({...layer}));
  skinUnlock={elapsed:0,phase:'enter',from:{...from},sources,fromPause,view,queue:rewards,index:0,ready:false,
    originalAppearance,originalStarTrails,fromAppearance:originalAppearance,fromStarTrails:originalStarTrails};
  setUnlockTitle(rewards[0].kind);$('#hud').hidden=true;showPanel('skin-unlock');$('#skin-unlock-continue').disabled=true;updateSkinUnlock(0);
}
function dismissSkinUnlock(){
  if(!skinUnlock?.ready||skinUnlock.phase==='leave')return;
  const reward=skinUnlock,current=reward.queue[reward.index];
  if(current.kind==='appearance'){appearanceState=acknowledgeAppearanceUnlock(appearanceState);persistAppearanceState();}
  else{starTrailState=acknowledgeStarTrailUnlock(starTrailState,current.id);storage.write('qiuqiule-star-trails',starTrailState);}
  reward.fromAppearance=appearanceLayers().map(layer=>({...layer}));reward.fromStarTrails=starTrailLayers().map(layer=>({...layer}));
  reward.from={...lastUiPose};reward.fromKind=current.kind;reward.elapsed=0;reward.ready=false;$('#skin-unlock-continue').disabled=true;
  if(reward.index+1<reward.queue.length){reward.index++;reward.phase='switch';updateSkinUnlock(0);return;}
  reward.phase='leave';
  if(current.kind==='star-trail'){updateSkinUnlock(0);return;}
  presentResult(reward.from,reward.fromPause,reward.sources,reducedMotion?.28:.62,reward.view);
  transfer=null;uiAnchor=null;$('#skin-unlock-panel').hidden=false;syncInputs();
}
function updateSkinUnlock(dt){
  if(document.hidden)return;
  const reward=skinUnlock;reward.elapsed+=dt;
  const leaving=reward.phase==='leave',switching=reward.phase==='switch',current=reward.queue[reward.index];
  const star=current.kind==='star-trail',starSwitch=star&&switching&&reward.fromKind==='star-trail';
  const retractDuration=reducedMotion?.12:.18;
  if(star&&leaving&&!reward.resultStarted&&reward.elapsed>=retractDuration){
    reward.resultStarted=true;
    presentResult(reward.from,reward.fromPause,reward.sources,reducedMotion?.22:.32,reward.view);
    transfer=null;uiAnchor=null;$('#skin-unlock-panel').hidden=false;syncInputs();
  }
  if(star)reward.starGeometry=unlockStarGeometry();
  const frame=star?unlockStarTrailPose({elapsed:reward.elapsed,from:reward.from,
    to:leaving&&reward.resultStarted?anchorPose('over'):reward.from,geometry:reward.starGeometry,
    phase:leaving?'leave':starSwitch?'switch':'enter',panelAlreadyVisible:switching,reducedMotion}):
    (leaving?unlockLeavePose:switching?unlockSwitchPose:unlockPose)({elapsed:reward.elapsed,from:reward.from,
      to:leaving?anchorPose('over'):unlockAnchor(),reducedMotion});
  reward.starFrame=star?frame:null;
  const targetAppearance=leaving?reward.originalAppearance:current.kind==='appearance'?[{id:current.id,color:hex(BIG_EYE_DEFAULT_COLOR),weight:1}]:reward.originalAppearance;
  const targetStarTrails=leaving?[]:current.kind==='star-trail'?[{id:current.id,weight:1}]:reward.originalStarTrails;
  const blend=leaving?1-frame.morph:frame.morph;
  appearanceOverride=blendUnlockLayers(reward.fromAppearance,targetAppearance,blend);
  starTrailOverride=star&&!leaving&&!starSwitch?targetStarTrails:blendUnlockLayers(reward.fromStarTrails,targetStarTrails,blend);
  if(!switching||frame.switched)setUnlockTitle(current.kind);
  const panel=$('#skin-unlock-panel');panel.style.opacity=frame.panelAlpha;panel.style.transform=`translate(-50%,-50%) scale(${frame.panelScale})`;
  if(star)unlockShowroom.step(dt,{radius:frame.pose.r,reducedMotion});
  $('#skin-unlock-title').style.opacity=frame.titleAlpha;paintUiBall(frame.pose);
  if(glowContext&&frame.glowAlpha>0){
    const center=star?reward.starGeometry.glow:frame.pose;
    const r=center.r,size=Math.ceil(r*7),scale=Math.min(viewport.scale,3),pixels=Math.ceil(size*scale);glowCanvas.hidden=false;
    if(glowCanvas.width!==pixels)glowCanvas.width=pixels;if(glowCanvas.height!==pixels)glowCanvas.height=pixels;
    glowContext.setTransform(1,0,0,1,0,0);glowContext.clearRect(0,0,pixels,pixels);
    Object.assign(glowCanvas.style,{width:size+'px',height:size+'px',left:(center.x-size/2)+'px',top:(frame.pose.y-size/2)+'px'});
    glowContext.setTransform(scale,0,0,scale,0,0);paintRadiance(glowContext,{x:size/2,y:size/2,r,time:scene?.clock||0,alpha:frame.glowAlpha,reducedMotion});
  }else if(star||leaving)releaseUnlockGlow();
  if(!leaving&&frame.ready&&!reward.ready){reward.ready=true;$('#skin-unlock-continue').disabled=false;$('#skin-unlock-continue').focus({preventScroll:true});tone(880,.3,'sine',.055,1.5);}
  if(leaving){
    updateControlFlight(star?Math.min(dt,Math.max(0,reward.elapsed-retractDuration)):dt);
    if(frame.done){skinUnlock=null;skinOverride=null;appearanceOverride=null;starTrailOverride=null;unlockShowroom.reset();uiAnchor='over';panel.hidden=true;paintUiBall(anchorPose('over'));syncInputs();}
  }
}

function openPause(){
  if(transfer||modal||screen!=='play'||!world||world.phase==='over')return;
  if(world.isRunChoice){showHome();return;}
  const from=arenaPlayerPose();paused=true;showPanel('pause');
  if(!saveCurrentRun())toast('进度未能保存，请保持本页并继续游戏');
  movePlayer(from,'pause',.42);
}
function renderRunUpgrades(){
  const entries=runUpgradeEntries(world),list=$('#run-upgrades-list');
  list.replaceChildren(...entries.map(entry=>{
    const item=document.createElement('li'),icon=document.createElement('span'),body=document.createElement('div');
    const heading=document.createElement('h3'),name=document.createElement('span'),count=document.createElement('span'),description=document.createElement('p');
    item.className='run-upgrade-entry';item.dataset.upgradeId=entry.id;
    icon.className='run-upgrade-icon';icon.setAttribute('aria-hidden','true');icon.innerHTML=upgradeIconMarkup(entry.kind,hex(settings.bg));
    body.className='run-upgrade-copy';name.textContent=entry.name;
    count.className='run-upgrade-count';count.textContent=`${entry.stacks} ${entry.id==='gambler'?'次':'层'}`;
    heading.append(name,count);description.textContent=entry.summary;body.append(heading,description);item.append(icon,body);
    return item;
  }));
  $('#run-upgrades-empty').hidden=entries.length>0;
  $('#run-upgrades-body').scrollTop=0;
}
function openRunUpgrades(){
  if(transfer||controlFlight||modal!=='pause'||screen!=='play'||!world)return;
  const from=currentPlayerPose();renderRunUpgrades();showPanel('run-upgrades');movePlayer(from,'run-upgrades',.42);
}
function openSettings(){
  if(transfer||modal==='settings')return;
  settingsOrigin=modal==='pause'?'pause':'home';
  const from=currentPlayerPose();
  if(settingsOrigin==='home')home.phase='external';
  showPanel('settings');movePlayer(from,'settings',.5);
}
function openWardrobe(){
  if(transfer||modal)return;
  const from=currentPlayerPose();home.phase='external';wardrobeTime=0;wardrobeShowcase=null;wardrobeShowroom.reset();
  wardrobeUi?.resetNavigation?.();wardrobeUi?.refresh();showPanel('wardrobe');movePlayer(from,'wardrobe',.5);
}
function openHelp(){if(transfer||menuTransition)return;transitionMenu('help');}
function finishArenaArrival(resuming=false){
  if(restoredView){restoreRunView(restoredView);restoredView=null;}
  if(resuming)resumeSlowRemaining=1;
  if(scene)scene.timeScale=resumeSlowRemaining>0?aimMinimumScale(reducedMotion):1;
  paused=false;
  if(pauseOnArrival||document.hidden){pauseOnArrival=false;openPause();}
}
function resumeGame(){
  if(transfer||modal!=='pause')return;
  if(!discardRunSave()){toast('未能清除暂停存档，请稍后重试');return;}
  const from=anchorPose('pause');hidePanel();paused=true;
  movePlayer(from,'arena',.42,finishArenaArrival);
}
function closePanel(){
  if(transfer||wardrobeShowcase&&wardrobeShowcase.phase!=='idle')return;
  if(skinUnlock){dismissSkinUnlock();return;}
  if(modal==='wardrobe'){
    if(wardrobeUi?.back?.())return;
    const from=currentPlayerPose();from.visualSquash=from.squash||0;
    wardrobeUi?.cancelInteraction();hidePanel();home.reset();movePlayer(from,'home',.5);return;
  }
  if(modal==='menu-transition'){menuTransition=null;showPanel('settings',{fade:false});uiAnchor='settings';paintUiBall(anchorPose('settings'));return;}
  if(modal==='help'){transitionMenu('settings');return;}
  if(modal==='run-upgrades'){
    const from=currentPlayerPose();showPanel('pause');movePlayer(from,'pause',.42);return;
  }
  if(modal==='pause'){resumeGame();return;}
  if(modal==='settings'){
    const from=anchorPose('settings');
    if(settingsOrigin==='pause'){showPanel('pause');movePlayer(from,'pause',.5);}
    else{hidePanel();home.reset();movePlayer(from,'home',.5);}
  }
}
function clearEffects(){for(const e of scene.effects)e.label?.destroy();scene.effects=[];scene.resetFeedback?.();}
const runSceneFields=['accumulator','timeSlices','clock','hitSoundAt','wallFlashes','wallBulges','bulgeWorld','impactGhosts',
  'zoomPulse','upgradeCue','feedbackCamera','blinkUntil','rescueUntil','firstTypeUntil','rewardVisuals','lastBorder','trailPhase','trailWorld'];
function captureRunView(){
  const state={};for(const key of runSceneFields)if(scene[key]!==undefined)state[key]=scene[key];
  if(state.rewardVisuals?.world!==world)state.rewardVisuals=null;
  return {runBest,runNewRecord,recordPulse,recordCue,recordedStatsKey,runAimHoldDuration,resumeSlowRemaining,
    scene:state,scoreFeedback:{...scoreFeedback},stageHud:{...stageHud},
    pressureWarning:{...scene.pressureWarning},cometEntries:scene.cometTrails?.entries||new Map(),
    bodyVisuals:[world.player,...world.auxiliaries,...world.enemies,world.boss].filter(Boolean)
      .filter(body=>playerVisuals.has(body)).map(body=>[body,{...playerVisuals.get(body)}]),
    effects:(scene.effects||[]).map(effect=>{
      const {label,...data}=effect;
      return label?{...data,labelText:String(label.text??''),labelFontSize:label.style?.fontSize||'18px'}:data;
    })};
}
function restoreRunView(extra){
  for(const key of runSceneFields)if(extra.scene?.[key]!==undefined)scene[key]=extra.scene[key];
  if(extra.scoreFeedback)Object.assign(scoreFeedback,extra.scoreFeedback);
  if(extra.stageHud)Object.assign(stageHud,extra.stageHud);
  if(extra.pressureWarning)Object.assign(scene.pressureWarning,extra.pressureWarning);
  if(extra.cometEntries instanceof Map&&scene.cometTrails)scene.cometTrails.entries=extra.cometEntries;
  scene.starParticles?.clear();
  for(const [body,visual] of extra.bodyVisuals||[])playerVisuals.set(body,visual);
  for(const effect of scene.effects||[])effect.label?.destroy();
  scene.effects=(extra.effects||[]).map(effect=>{
    const {labelText,labelFontSize,...data}=effect;
    if(data.type==='label')data.label=scene.add.text(data.x,data.y,labelText||'',{fontFamily:'GameSans, sans-serif',
      fontSize:labelFontSize||'18px',color:'#'+themeInkColor().toString(16).padStart(6,'0'),fontStyle:'normal'}).setOrigin(.5).setScale(viewport.scale);
    return data;
  });
}
function saveCurrentRun(){
  if(!world||world.isRunChoice||feedbackDemo||screen!=='play'||world.phase==='over'||result||scene?.ending)return false;
  try{
    cancelDrag();
    const snapshot=createRunSnapshot({world,runDay,extra:restoredView||captureRunView()});
    if(!runSaveStore.write(snapshot))return false;
    pendingRunSnapshot=snapshot;return true;
  }catch{return false;}
}
function discardRunSave(){
  const hadSave=!!pendingRunSnapshot||!!runSaveStore.read();
  const removed=runSaveStore.remove();
  if(!removed&&hadSave)return false;
  pendingRunSnapshot=null;return true;
}
function leaveGame(){
  if(transfer||controlFlight||modal!=='pause'||!world||world.isRunChoice)return;
  if(!saveCurrentRun()){toast('进度未能保存，请保持本页并继续游戏');return;}
  showHome();
}
function prepareGame({demo=false,restored=null,revealScore=false}={}){
  scoreRevealTime=revealScore?0:1.2;
  $('#score').style.opacity=revealScore?0:1;
  cancelDrag();feedbackDemo=demo;runBest=best;runNewRecord=false;recordPulse=recordCue=0;recordedStatsKey='';result=null;transfer=null;controlFlight=null;uiAnchor=null;
  resumeSlowRemaining=0;restoredView=null;
  skinUnlock=null;skinOverride=null;appearanceOverride=null;starTrailOverride=null;unlockShowroom.reset();releaseUnlockGlow();clearPhoto();releaseOverlay=0;pauseOnArrival=false;
  $('#control-transfers').replaceChildren();$('#ui-ball').hidden=true;$('#ui-star-trails').hidden=true;$('#result-shadow').hidden=true;$('.result-actions').classList.remove('arriving');
  scene.g.clear();clearEffects();scene.rewardVisuals=null;scene.accumulator=0;scene.timeSlices=[];scene.clock=0;scene.hitSoundAt=0;
  runDay=restored?.runDay||createEndlessRun();runAimHoldDuration=demo?1.2:aimHoldDuration(aimMetrics);
  world=restored?.world||new World(viewport.width,viewport.height,runDay.random,{spawnInitial:demo});screen='play';
  if(restored){
    const extra=restored.extra;
    runBest=extra.runBest??best;runNewRecord=!!extra.runNewRecord;recordPulse=extra.recordPulse||0;recordCue=extra.recordCue||0;
    recordedStatsKey=extra.recordedStatsKey||'';runAimHoldDuration=extra.runAimHoldDuration===.9?.9:1.2;
    restoredView=extra;
    if(world.width!==viewport.width||world.height!==viewport.height){
      const rx=viewport.width/world.width,ry=viewport.height/world.height,oldUnit=world.unit;
      world.resize(viewport.width,viewport.height);const k=world.unit/oldUnit;
      for(const effect of extra.effects||[]){effect.x*=rx;effect.y*=ry;if(effect.r)effect.r*=k;if(effect.vx)effect.vx*=k;if(effect.vy)effect.vy*=k;}
      // Resizing already changes arena geometry; rebuild geometry-dependent
      // decorations instead of applying the old viewport's border or trails.
      Object.assign(extra.scene||{}, {lastBorder:undefined,wallBulges:[],bulgeWorld:null,impactGhosts:[],zoomPulse:null,feedbackCamera:null,trailWorld:null});
      extra.cometEntries=new Map();extra.bodyVisuals=[];
    }
  }
  sound.setMusicScene(['boss-entry','boss'].includes(world.phase)?'boss':'endless',{resetPreparation:true});
  sound.prepareBossMusic();
  if(!demo&&!restored)world.beginStartingUpgrades();world.setFeedbackOptions({strength:settings.juice,reducedMotion});scoreFeedback.reset(world.score);
  clearTimeout(toastTimer);$('#toast').classList.remove('show');lastScore=-1;
  $('#home').hidden=true;$('#home').style.opacity=1;$('#hud').hidden=false;$('#hud').style.opacity=1;$('.pause-button').hidden=false;$('.pause-button').disabled=false;updateHud();
}

function saveEndlessProgress(){
  if(!world||world.isRunChoice||feedbackDemo)return;
  grantEndlessAppearance();grantEndlessStarTrails();
  const stage=Math.max(world.stage||1,world.maxStage||1),combo=Math.max(world.maxCombo||0,world.shotKills||0);
  const key=[world.score,stage,combo,runDay?.key].join(':');if(key===recordedStatsKey)return;recordedStatsKey=key;
  endlessProgress=recordEndlessRun(endlessProgress,{score:world.score,stage,maxCombo:combo,dateKey:runDay?.key});
  best=endlessProgress.best;storage.write('qiuqiule-best',best);storage.write('qiuqiule-endless',endlessProgress);
}

function startGame(){
  pendingRunSnapshot=runSaveStore.read();
  if(pendingRunSnapshot){showRunChoice();return;}
  hidePanel();prepareGame();paused=false;syncInputs();tone(280,.12,'sine',.04,1.5);
}
function showRunChoice(){
  const from={...home.player};
  hidePanel();cancelDrag();clearEffects();scene.rewardVisuals=null;clearChoiceLabels();resetStageHud();
  transfer=null;controlFlight=null;uiAnchor=null;restoredView=null;resumeSlowRemaining=0;result=null;feedbackDemo=false;
  world=new RunChoiceWorld(viewport.width,viewport.height,{from});screen='play';paused=false;
  scene.accumulator=0;scene.timeSlices=[];
  $('#ui-ball').hidden=true;$('#ui-star-trails').hidden=true;$('#home').hidden=true;$('#hud').hidden=false;$('#hud').style.opacity=1;
  $('.pause-button').hidden=true;$('.pause-button').disabled=true;sound.setMusicScene('endless');
  updateHud();syncInputs();
}
function continueSavedRun(){
  const snapshot=pendingRunSnapshot||runSaveStore.read(),restored=restoreRunSnapshot(snapshot);
  if(!restored){toast('这份进度无法读取，请开始新的一局');return false;}
  const from=currentPlayerPose();
  if(!discardRunSave()){toast('未能清除暂停存档，请稍后重试');return false;}
  hidePanel();prepareGame({restored,revealScore:true});paused=true;
  movePlayer(from,'arena',.42,()=>finishArenaArrival(true));return true;
}
function chooseRun(id){
  if(id==='continue-run')return continueSavedRun();
  if(id!=='new-run')return false;
  if(!discardRunSave()){toast('未能清除暂停存档，请稍后重试');return false;}
  const from=currentPlayerPose();hidePanel();prepareGame({revealScore:true});paused=true;
  movePlayer(from,'arena',.4,finishArenaArrival);return true;
}
function restartGame(){
  if(transfer||controlFlight||!scene||skinUnlock)return;
  if(!discardRunSave()){toast('未能清除暂停存档，请稍后重试');return;}
  const from=currentPlayerPose();hidePanel();prepareGame();paused=true;movePlayer(from,'arena',.4,finishArenaArrival);
}
function showHome(){
  if(transfer||controlFlight||skinUnlock)return;
  const from=currentPlayerPose();hidePanel();unlockShowroom.reset();screen='home';cancelDrag();world=null;paused=false;result=null;feedbackDemo=false;resetStageHud();
  resumeSlowRemaining=0;restoredView=null;clearChoiceLabels();$('.pause-button').hidden=false;
  $('#control-transfers').replaceChildren();$('#result-shadow').hidden=true;sound.setMusicScene('home');
  home=new HomeWorld(viewport.width,viewport.height);homeReveal=0;
  $('#home').hidden=false;$('#home').style.opacity=0;$('#hud').hidden=true;$('#hud').style.opacity=1;layoutHomeControl();clearEffects();
  movePlayer(from,'home',.65,()=>{homeReveal=1;});
}
function layoutHomeControl(){
  for(const c of home.targets){
    const button=$('#home-'+c.id);
    Object.assign(button.style,{left:(c.x-c.r)+'px',top:(c.y-c.r)+'px',width:(c.r*2)+'px',height:(c.r*2)+'px'});
  }
}

function clearChoiceLabels(){
  choiceLabels=[];$('#choice-labels').replaceChildren();
}
function choiceBob(c){

  // Start at rest and use the choice clock so pausing also freezes the float.
  return world.phase==='choose'&&!reducedMotion?Math.sin(world.phaseTime*2+c.x)*2*smooth(world.phaseTime/.4):0;
}
function updateChoices(){
  const active=world.phase==='transition'||world.phase==='choose',container=$('#choice-labels');
  if(!active){if(choiceLabels.length||container.children.length)clearChoiceLabels();return;}
  // Keep the same text nodes across transition -> choose. Replacing them here
  // used to skip the CSS fade and jump straight from 40% to full opacity.
  if(choiceLabels.length!==world.choices.length||choiceLabels.some((label,i)=>label.choice!==world.choices[i])){
    choiceLabels=world.choices.map(choice=>{
      const node=document.createElement('div'),title=document.createElement('h3');
      node.className='choice-label';title.textContent=choice.name;node.append(title);

      return {choice,node,title};
    });
    container.replaceChildren(...choiceLabels.map(label=>label.node));
  }
  for(const {choice:c,node,title} of choiceLabels){
    const width=c.labelWidth||Math.max(76,Math.min(160,c.r*3));
    const font=Math.max(9,Math.min(17,Math.floor(width/Math.max(1,c.name.length)*.9)));
    Object.assign(node.style,{left:c.x+'px',top:(c.y+choiceBob(c)+c.r+14)+'px',
      width:width+'px',opacity:String(ease(c.born??1))});
    Object.assign(title.style,{fontSize:font+'px',whiteSpace:'nowrap'});
  }
}

function setHudText(element,text){
  if(element.textContent!==text)element.textContent=text;
}
function setHudAttribute(element,name,value){
  if(element.getAttribute(name)!==value)element.setAttribute(name,value);
}
function setHudScore(value,scale){
  const score=$('#score'),transform=`scale(${scale})`;
  setHudText(score,pad(value));
  if(score.style.transform!==transform)score.style.transform=transform;
  if(score.style.color)score.style.color='';
}
let lastDotFill=-1;
const stageHud=new StageHud();
function resetStageHud(){stageHud.reset($('#stage-progress'),$('#stage-caption'));}
function updateStageDots(progress,count,filled){
  const dots=progress.children;
  if(dots.length!==count){
    const next=Array.from({length:count},(_,i)=>{
      const dot=document.createElement('i');
      dot.className=i<filled?'stage-dot filled':'stage-dot';
      dot.setAttribute('aria-hidden','true');
      return dot;
    });
    progress.replaceChildren(...next);
  }else if(lastDotFill!==filled){
    for(let i=0;i<count;i++){
      const className=i<filled?'stage-dot filled':'stage-dot';
      if(dots[i].className!==className)dots[i].className=className;
    }
  }
  lastDotFill=filled;
}
function updateHud(dt=0,uiDt=dt){
  if(!world){resetStageHud();return;}
  $('#score').hidden=!!world.isRunChoice;
  if(world.isRunChoice){resetStageHud();updateChoices();return;}
  if(scoreRevealTime<1.2){
    scoreRevealTime=Math.min(1.2,scoreRevealTime+uiDt);
    $('#score').style.opacity=ease((scoreRevealTime-.15)/1.05);
  }
  grantEndlessAppearance();grantEndlessStarTrails();
  if(!feedbackDemo&&!runNewRecord&&world.score>runBest){runNewRecord=true;recordPulse=.2;recordCue=.1;tone(660,.09,'sine',.04,1.1);}
  const previousCue=recordCue;recordCue=Math.max(0,recordCue-dt);if(previousCue>0&&recordCue===0)tone(880,.12,'sine',.04,1.1);
  recordPulse=Math.max(0,recordPulse-dt);const animate=!reducedMotion&&settings.juice>0;
  scoreFeedback.set(world.score,lastScore>=0&&animate);lastScore=world.score;
  const display=scoreFeedback.step(dt,animate),recordScale=recordPulse>0&&animate?1+.3*Math.sin((1-recordPulse/.2)*Math.PI):1;
  setHudScore(display.value,Math.max(display.scale,recordScale));saveEndlessProgress();
  const progress=$('#stage-progress');
  if(progress){
    if(progress.getAttribute('title')!==null)progress.removeAttribute('title');
    const visible=!scene?.ending&&['battle','clearing'].includes(world.phase)&&Number.isFinite(world.killTarget);
    stageHud.update(progress,$('#stage-caption'),{owner:world,mode:'endless',visible,stage:world.stage,dt:uiDt});
    if(visible){const ratio=clamp((world.stageKills||0)/world.killTarget,0,1);updateStageDots(progress,10,Math.floor(ratio*10+1e-9));setHudAttribute(progress,'aria-label',`本阶段击杀 ${world.stageKills||0}，目标 ${world.killTarget}`);}
  }
  updateChoices();
}

function polygon(graphics,x,y,r,sides,rotation,color,alpha=1){
  graphics.fillStyle(color,alpha);graphics.beginPath();
  for(let i=0;i<sides;i++){const a=rotation+i*Math.PI*2/sides;const px=x+Math.cos(a)*r,py=y+Math.sin(a)*r;i?graphics.lineTo(px,py):graphics.moveTo(px,py);}
  graphics.closePath();graphics.fillPath();
}
function ring(g,x,y,r,color,alpha=1,width=1,start=0,end=Math.PI*2){g.lineStyle(width,color,alpha);g.beginPath();g.arc(x,y,r,start,end);g.strokePath();}

function confineVisualBody(body,geometry){
  const left=geometry.left+body.r,right=geometry.right-body.r,top=geometry.top+body.r,bottom=geometry.bottom-body.r;
  if(body.x<left||body.x>right){body.x=clamp(body.x,left,right);body.vx*=-1;}
  if(body.y<top||body.y>bottom){body.y=clamp(body.y,top,bottom);body.vy*=-1;}
  const corner=Math.max(0,(geometry.cornerRadius||0)-body.r);
  if(!corner)return;
  const cx=clamp(body.x,left+corner,right-corner),cy=clamp(body.y,top+corner,bottom-corner);
  const dx=body.x-cx,dy=body.y-cy,distance=Math.hypot(dx,dy);
  if(distance>corner){
    const nx=dx/distance,ny=dy/distance,outward=body.vx*nx+body.vy*ny;
    body.x=cx+nx*corner;body.y=cy+ny*corner;
    if(outward>0){body.vx-=2*outward*nx;body.vy-=2*outward*ny;}
  }
}

function drawDragGuide(g,p){
  if(!drag||drag.pending)return;
  const distance=Math.hypot(drag.dx,drag.dy);
  if(distance<=3)return;
  const color=themeInkColor();
  const guide=aimGuide({player:p,drag,maxPull:world.maxPull});
  for(const point of guide.points){g.fillStyle(color,point.alpha);g.fillCircle(point.x,point.y,point.r);}
  if(guide.arrow){const a=guide.arrow;g.lineStyle(a.width,color,a.alpha);g.beginPath();g.moveTo(a.left.x,a.left.y);g.lineTo(a.tip.x,a.tip.y);g.lineTo(a.right.x,a.right.y);g.strokePath();}
  const pull=Math.min(distance,world.maxPull);
  const tx=drag.x+drag.dx/distance*pull,ty=drag.y+drag.dy/distance*pull;
  g.lineStyle(1,color,.12);g.lineBetween(drag.x,drag.y,tx,ty);
  ring(g,drag.x,drag.y,4,color,.17,1);ring(g,tx,ty,8,color,.17,1);
}

function drawBoss(g,b,alpha=1){
  const pose=bossFacePose({entryTime:world.phase==='boss-entry'?(b.entryElapsed??world.phaseTime):Infinity,
    stunned:b.stunned,stunnedTime:b.stunnedTime||0,time:b.stunnedTime||0,reducedMotion});
  const r=b.r*pose.scale,opacity=alpha*pose.alpha;
  if(r<.3||opacity<=0)return;
  const color=hex(settings.enemy);
  // Precompose 40% black over 60% body color so overlapping spiral caps stay uniform.
  const face=enemyDetailColor(color);
  const cos=Math.cos(b.angle),sin=Math.sin(b.angle),squash=b.squash||0;
  // Keep the face upright while sharing the body's impact deformation.
  const project=point=>{
    const lx=(point.x*cos+point.y*sin)*(1-squash);
    const ly=(-point.x*sin+point.y*cos)*(1+squash*.7);
    return {x:b.x+(lx*cos-ly*sin)*r,y:b.y+(lx*sin+ly*cos)*r};
  };
  const path=(points,fillColor,pathAlpha,stroke=0)=>{
    if(pathAlpha<=0||points.length<2)return;
    if(stroke)g.lineStyle(stroke,fillColor,pathAlpha);else g.fillStyle(fillColor,pathAlpha);
    g.beginPath();
    points.forEach((point,i)=>{const p=project(point);i?g.lineTo(p.x,p.y):g.moveTo(p.x,p.y);});
    if(stroke){
      g.strokePath();g.fillStyle(fillColor,pathAlpha);
      for(const point of [points[0],points[points.length-1]]){const p=project(point);g.fillCircle(p.x,p.y,stroke/2);}
    }else{g.closePath();g.fillPath();}
  };
  for(const side of [-1,1])path(bossHornOutline(side,pose.hornScale),color,opacity);
  drawBall(g,b,color,alpha,null,{scale:pose.scale,alpha:pose.alpha});
  const eyeScale=1.2;
  for(const side of [-1,1]){
    const scaleEye=(point,scale)=>({x:side*.29+(point.x-side*.29)*scale,
      y:-.08+(point.y+.08)*scale});
    if(pose.angryAlpha>0){
      const eye=bossAngryEyeOutline(side,pose.eyeOpen,pose.anger).map(point=>scaleEye(point,eyeScale*pose.angryScale));
      path(eye,face,opacity*pose.angryAlpha);
    }
    if(pose.spiralAlpha>0)path(bossSpiralEye(side,pose.spiralTurn).map(point=>scaleEye(point,eyeScale)),face,opacity*pose.spiralAlpha,Math.max(.8,r*.025)*eyeScale);
  }
}

function updatePlayerGaze(b,pull){

  let target=faceTarget(b,pull,screen==='home'?home.maxPull:(world?.maxPull||150));
  if(screen==='play'&&world?.phase==='battle'&&settings.expressions&&!paused&&!modal&&!pull){
    target=pressureLook(b,world.enemies,world.feedbackTime??world.time,world.pressureCount)||target;
  }

  const faceOffset=smoothFace({x:b.lookX||0,y:b.lookY||0},target,scene?.frameDt??1/60);
  b.lookX=faceOffset.x;b.lookY=faceOffset.y;
  return faceOffset;
}

function drawPlayerEyes(g,b,{r,visualX,visualY,roll,visual,alpha,pull,color,faceOffset}){
    if(b.isAuxiliary)return;
    const face=isDark('#'+color.toString(16).padStart(6,'0'))?0xf4f3eb:0x252720;
    if(screen==='play'&&scene?.ending){
      g.lineStyle(Math.max(1,r*.045),face,alpha*.9);
      for(const side of [-1,1]){
        const x=visualX+side*r*.17,y=visualY-r*.07,d=r*.065;
        g.lineBetween(x-d,y-d,x+d,y+d);g.lineBetween(x-d,y+d,x+d,y-d);
      }
      return;
    }

    const lookX=faceOffset.x*r,lookY=faceOffset.y*r;
    g.fillStyle(face,alpha*.9);
    const rc=Math.cos(roll),rs=Math.sin(roll);
    for(const [i,eye] of [-1,1].entries()){
      const ex=eye*r*.17+lookX,ey=-r*.07+lookY;
      if(visual.eyeMix>0){
        g.beginPath();
        strainedEyes[i].forEach((point,j)=>{
          const normal=relaxedEyes[i][j],mix=visual.eyeMix;
          const x=ex+(normal.x+(point.x-normal.x)*mix)*r;
          const y=ey+(normal.y+(point.y-normal.y)*mix)*r;
          const px=visualX+x*rc-y*rs,py=visualY+x*rs+y*rc;
          j?g.lineTo(px,py):g.moveTo(px,py);
        });
        g.closePath();g.fillPath();
      }else {
        const surprised=screen==='play'&&settings.expressions&&Math.max(scene?.rescueUntil||0,scene?.firstTypeUntil||0)>(world?.feedbackTime??world?.time??Infinity);
        const blink=!surprised&&screen==='play'&&scene?.blinkUntil>scene.clock&&!reducedMotion?.25:1;
        const open=surprised?1.3:1;
        g.fillEllipse(visualX+ex*rc-ey*rs,visualY+ex*rs+ey*rc,r*.105*open,r*.19*blink*open,64);
      }
    }
}

// One projected outline owns both the translucent clone fill and its trail cut.
// Keep the original-circle and appearance-contour branches exactly in sync.
function ballRenderGeometry(b,skinPose,pull=null,owner=b){
  const {x:visualX,y:visualY,r,squash,deformAngle:angle,pullAmount:amount}=skinPose;
  const cos=Math.cos(angle),sin=Math.sin(angle);
  const flight=b.isPlayer&&screen==='play'&&['battle','boss-entry','boss'].includes(world?.phase)&&!pull&&!reducedMotion;
  const flightStart=world&&scene?.rewardVisuals?.world===world?scene.rewardVisuals.flightAt:null;
  // Re-enter the existing flight deformation softly after the shorter reward
  // rest, without changing any stretch during ordinary combat.
  const flightBlend=flightStart!=null?smooth((world.feedbackTime-flightStart)/.2):1;
  const flightStretch=flight?.12*clamp(Math.hypot(b.vx,b.vy)/(world.baseSpeed||1),0,1)*settings.juice*flightBlend:0;
  const flightAngle=flight?Math.atan2(b.vy,b.vx):0;
  Object.assign(skinPose,{flightStretch,flightAngle});
  const fc=Math.cos(flightAngle),fs=Math.sin(flightAngle),fx=1+flightStretch;
  const skinned=b.isPlayer&&usesSkinContour();
  // Keep the player contour deformation identical across appearances.
  let playerPoints=null;
  if(b.isPlayer){
    playerPoints=playerOutlines.get(owner);
    if(!playerPoints){playerPoints=[];playerOutlines.set(owner,playerPoints);}
    if(skinned)projectSkinContour(activeContour(),skinPose,playerPoints);
    else{
      playerPoints.length=ballSegments;
      for(let i=0;i<ballSegments;i++){
        let ux=ballCircleX[i],uy=ballCircleY[i];
        if(amount!==0){const point=pullBallPoint(ux,uy,amount);ux=point.x;uy=point.y;}
        const lx=r*ux*(1-squash),ly=r*uy*(1+squash*.7);
        const wx=lx*cos-ly*sin,wy=lx*sin+ly*cos;
        const along=(wx*fc+wy*fs)*fx,across=(-wx*fs+wy*fc)/fx;
        const point=playerPoints[i]??={};
        point.x=visualX+along*fc-across*fs;point.y=visualY+along*fs+across*fc;
      }
    }
  }
  return {skinPose,playerPoints};
}

function drawBall(g,b,color,alpha=1,pull=null,birth=null,photoSlot=null,preparedGeometry=null){
  // Apply once at the common visual entry point, including photo/capture fades.
  if(b.isAuxiliary)alpha*=.6;
  const born=birth?.scale??(b.isPlayer?1:ease(b.born));
  const rewardPose=rewardPlayerPose(b),visualX=rewardPose.x,visualY=rewardPose.y,r=rewardPose.r*born;
  if(r<.3)return;
  const angle=pull?Math.atan2(pull.dy,pull.dx):b.angle;
  const amount=pull?clamp(Math.hypot(pull.dx,pull.dy)/(screen==='home'?home.maxPull:(world?.maxPull||150)),0,1):0;
  const cos=Math.cos(angle),sin=Math.sin(angle);
  const phase=screen==='home'?home.phase:null;
  let visual;
  if(b.isPlayer&&!b.isAuxiliary){
    visual=playerVisualState(playerVisuals.get(b),{phase,
      strained:usesStrainedEyes(settings.expressions,drag?.pending?null:drag,phase),expressions:settings.expressions,
      pulling:!!pull,dt:scene?.frameDt??1/60});
    playerVisuals.set(b,visual);
    if(pull&&screen==='play'&&settings.expressions){
      const slowWeight=drag?.aim?clamp((1-(scene?.timeScale??1))/(1-aimMinimumScale(reducedMotion)),0,1):1;
      visual.eyeMix=amount*slowWeight;
    }
    // Combo counts survive release and cancelled pulls; they must not hold the
    // pull expression after input ends. Kill feedback keeps its brief blink.
    if(screen==='play'&&settings.expressions&&Math.max(scene?.rescueUntil||0,scene?.firstTypeUntil||0)>(world.feedbackTime??world.time))visual.eyeMix=0;
  }
  // Restart breathing at the round rebound/overlay endpoint, independently of
  // the old breathing phase and the clock driving the other home animations.
  const menuPlayer=b.isPlayer&&!b.isAuxiliary&&screen==='home';
  const breathing=screen==='home'?home.animate:!reducedMotion;
  const squash=pull?0:menuPlayer&&phase==='idle'
    ?breathing?Math.sin(visual.idleAge*1.3)*.035:0:b.squash;
  if(visual){
    visual.renderedSquash=squash;
    visual.renderedPull=pull?{amount,angle}:null;
  }
  // Keep eyes, custom contours and photos on the same eased turn as reward
  // placement; the ready-state pose is the identical completed full turn.
  const roll=b.roll??(world?.phase==='transition'?Math.PI*2*world.rewardMoveProgress:0);
  let skinPose={x:visualX,y:visualY,r,squash,deformAngle:angle,pullAmount:amount,roll};
  const geometry=preparedGeometry||ballRenderGeometry(b,skinPose,pull);
  skinPose=geometry.skinPose;
  const playerPoints=geometry.playerPoints;
  const {flightAngle,flightStretch}=skinPose;
  const fc=Math.cos(flightAngle),fs=Math.sin(flightAngle),fx=1+flightStretch;
  g.fillStyle(color,alpha*(birth?.alpha??born));g.beginPath();
  if(playerPoints){
    const points=playerPoints;
    g.moveTo(points[0].x,points[0].y);
    for(let i=1;i<points.length;i++)g.lineTo(points[i].x,points[i].y);
    g.lineTo(points[0].x,points[0].y);
  }else for(let i=0;i<=ballSegments;i++){
    // Home, battle and rebound share the same smooth join.
    let ux=ballCircleX[i],uy=ballCircleY[i];
    if(amount!==0){const point=pullBallPoint(ux,uy,amount);ux=point.x;uy=point.y;}
    const lx=r*ux*(1-squash),ly=r*uy*(1+squash*.7);
    const wx=lx*cos-ly*sin,wy=lx*sin+ly*cos;
    const along=(wx*fc+wy*fs)*fx,across=(-wx*fs+wy*fc)/fx;
    const x=visualX+along*fc-across*fs,y=visualY+along*fs+across*fc;
    i?g.lineTo(x,y):g.moveTo(x,y);
  }
  g.closePath();
  if(!b.isPlayer){g.fillPath();return;}
  const layers=appearanceLayers(),original=appearanceLayer('original',layers),bigEye=appearanceLayer('big-eye',layers),custom=appearanceLayer('custom',layers);
  const faceOffset=b.isAuxiliary?{x:0,y:0}:updatePlayerGaze(b,pull);
  const bodyAlpha=alpha*(birth?.alpha??born);
  if(original.weight>0){
    g.fillStyle(original.color,bodyAlpha);g.fillPath();
    drawPlayerEyes(g,b,{r,visualX,visualY,roll,visual,alpha,pull,color:original.color,faceOffset});
  }
  if(bigEye.weight>0){
    const weight=bigEye.weight/(original.weight+bigEye.weight);
    drawBigEye(g,activeContour(),skinPose,{color:bigEye.color,alpha:bodyAlpha*weight,lookX:faceOffset.x,lookY:faceOffset.y,projectedOutline:playerPoints});
  }
  const photoDrawn=custom.weight>0&&appearance&&drawPlayerPhoto(activeContour(),skinPose,false,photoSlot,bodyAlpha*custom.weight,custom.color);
  if(!original.weight&&!bigEye.weight&&!photoDrawn){g.fillStyle(color,bodyAlpha);g.fillPath();}

}

function bindInput(canvas){
  const position=e=>pointerPosition(e.clientX,e.clientY,canvas.getBoundingClientRect(),viewport);

  canvas.addEventListener('pointerdown',e=>{
    if(choicePress){if(e.pointerId!==choicePress.id)clearChoicePress();return;}
    if(paused||modal||transfer||controlFlight||drag||!e.isPrimary||e.button>0)return;
    const point=position(e);
    if(screen==='play'&&world?.phase==='choose'){
      const choice=world.choices.find(c=>Math.hypot(point.x-c.x,point.y-c.y)<=c.r*ease(c.born??1));
      if(choice){
        choicePress={id:e.pointerId,choiceId:choice.id,x:point.x,y:point.y,startedAt:aimInputTime(e),startStamp:Number(e.timeStamp)/1000,active:false,canvas};
        if(scene){scene.accumulator=0;scene.timeSlices=[];scene.timeScale=1;}
        canvas.setPointerCapture(e.pointerId);e.preventDefault();return;
      }
    }

    const active=screen==='home'?home:screen==='play'?world:null;
    if(!active?.ready)return;
    const continuous=screen==='play'&&world.continuousControl;
    if(screen==='play'&&!continuous&&!world.beginPull())return;
    unlockAudio();
    const startedAt=aimInputTime(e);
    drag={id:e.pointerId,x:point.x,y:point.y,dx:0,dy:0};
    if(continuous){drag.pending=true;drag.startStamp=Number(e.timeStamp)/1000;drag.aim=new AimGesture({x:point.x,y:point.y,startedAt,holdDuration:runAimHoldDuration,reducedMotion});}
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove',e=>{
    if(choicePress?.id===e.pointerId){
      const p=position(e);
      if(Math.hypot(p.x-choicePress.x,p.y-choicePress.y)>8)clearChoicePress();
      else updateChoicePress(Math.max(scene?.inputClock||0,choicePress.startedAt+Math.max(0,Number(e.timeStamp)/1000-choicePress.startStamp)));
      e.preventDefault();return;
    }

    if(!drag||drag.id!==e.pointerId)return;
    const p=position(e);drag.dx=p.x-drag.x;drag.dy=p.y-drag.y;
    if(screen==='play'&&!drag.aim&&resumeSlowRemaining>0&&Math.hypot(drag.dx,drag.dy)>=6){resumeSlowRemaining=0;scene.timeScale=1;}
    if(drag.aim){const now=aimInputTime(e);drag.aim.move(p.x,p.y,now);updateAim(now);}
    updateChargeFeedback();e.preventDefault();
  });
  canvas.addEventListener('pointerup',e=>{
    if(choicePress?.id===e.pointerId){clearChoicePress();e.preventDefault();return;}

    if(!drag||drag.id!==e.pointerId)return;
    const p=position(e);drag.dx=p.x-drag.x;drag.dy=p.y-drag.y;
    if(screen==='play'&&!drag.aim&&resumeSlowRemaining>0&&Math.hypot(drag.dx,drag.dy)>=6){resumeSlowRemaining=0;scene.timeScale=1;}
    let shouldShoot=true,releasedAim=null;
    if(drag.aim){
      const now=aimInputTime(e);drag.aim.move(p.x,p.y,now);updateAim(now);
      if(!drag)return;
      releasedAim=drag.aim.release(p.x,p.y,now);shouldShoot=releasedAim.shouldShoot;
    }
    if(!paused&&!modal){
      if(screen==='home'&&home.shoot(drag.dx,drag.dy)){tone(220+home.power*190,.15,'sine',.045,.4);}
      else if(screen==='play'&&world&&shouldShoot&&world.shoot(drag.dx,drag.dy))recordAimGesture(releasedAim);
    }
    cancelDrag();if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
  });
  const cancelPointer=e=>{
    if(e.pointerId===choicePress?.id)clearChoicePress();
    if(e.pointerId===drag?.id)cancelDrag();
  };
  canvas.addEventListener('pointercancel',cancelPointer);
  canvas.addEventListener('lostpointercapture',cancelPointer);
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
}

function boot(){
  if(!window.Phaser){toast('引擎未能加载，请联网刷新后重试');return;}
  class BallScene extends Phaser.Scene {
    constructor(){super('BallScene');this.accumulator=0;this.timeSlices=[];this.effects=[];this.clock=0;this.inputClock=0;this.frameStamp=null;this.timeScale=1;this.hitSoundAt=0;this.wallFlashes=[];this.wallBulges=[];this.bulgeWorld=null;this.impactGhosts=[];this.zoomPulse=null;this.upgradeCue=0;this.feedbackCamera=null;this.blinkUntil=0;this.rescueUntil=0;this.firstTypeUntil=0;this.ending=null;this.pressureWarning=new PressureWarning();this.cometTrails=new CometTrails();this.starParticles=new StarParticles();this.trailWorld=null;this.trailPhase='';}
    create(){
      scene=this;
      initializeSkins();
      this.textures.addCanvas('skin-radiance',createRadianceCanvas(document));
      this.radiance=this.add.image(0,0,'skin-radiance').setVisible(false);
      this.g=this.add.graphics();this.cameras.main.setBackgroundColor(settings.bg);bindInput(this.game.canvas);
      const resize=()=>{
        const next=displayMetrics(window.innerWidth,window.innerHeight,window.devicePixelRatio||1);
        const geometryChanged=next.width!==viewport.width||next.height!==viewport.height;
        const ending=this.ending,oldWidth=viewport.width,oldHeight=viewport.height,oldUnit=world?.unit;
        if(geometryChanged&&this.lastBorder){
          const rx=next.width/viewport.width,ry=next.height/viewport.height,k=Math.min(next.width,next.height)/Math.min(viewport.width,viewport.height);
          for(const frame of [this.lastBorder]){
            frame.left*=rx;frame.right*=rx;frame.top*=ry;frame.bottom*=ry;frame.cornerRadius*=k;
            if(frame.gap){frame.gap.left*=rx;frame.gap.right*=rx;}
          }
        }
        if(transfer&&geometryChanged){transfer.from.x*=next.width/viewport.width;transfer.from.y*=next.height/viewport.height;transfer.from.r*=Math.min(next.width,next.height)/Math.min(viewport.width,viewport.height);}
        if(skinUnlock&&geometryChanged){skinUnlock.from.x*=next.width/viewport.width;skinUnlock.from.y*=next.height/viewport.height;skinUnlock.from.r*=Math.min(next.width,next.height)/Math.min(viewport.width,viewport.height);}
        if(controlFlight&&geometryChanged)for(const item of controlFlight.items){item.from.x*=next.width/viewport.width;item.from.y*=next.height/viewport.height;item.from.r*=Math.min(next.width,next.height)/Math.min(viewport.width,viewport.height);}
        viewport=next;
        this.scale.setZoom(1/viewport.scale);
        this.scale.resize(viewport.bufferWidth,viewport.bufferHeight);
        this.game.canvas.style.width=viewport.width+'px';
        this.game.canvas.style.height=viewport.height+'px';
        this.g.setScale(viewport.scale);
        this.cameras.main.setSize(viewport.bufferWidth,viewport.bufferHeight);
        if(geometryChanged){cancelDrag();this.resetFeedback();home.resize(viewport.width,viewport.height);if(world){world.resize(viewport.width,viewport.height);updateChoices();}}
        if(geometryChanged)fitDemoOffer();
        if(geometryChanged&&ending&&world){
          const ratio=world.unit/oldUnit,bounds=world.arenaBounds;
          for(const body of [ending.player,...ending.enemies,...ending.auxiliaries,ending.boss].filter(Boolean)){
            body.r*=ratio;body.vx*=ratio;body.vy*=ratio;
            body.x=clamp(body.x*viewport.width/oldWidth,bounds.left+body.r,bounds.right-body.r);
            body.y=clamp(body.y*viewport.height/oldHeight,bounds.top+body.r,bounds.bottom-body.r);
            if(!body.isBoss)confineVisualBody(body,world.arenaGeometry||bounds);
          }
          this.ending=ending;ending.resumePending=true;this.timeScale=reducedMotion||!settings.juice?1:.25;
        }
        layoutHomeControl();
        if(['settings','help','menu-transition'].includes(modal))fitMenuHeight();
      };
      resize();
      window.addEventListener('resize',resize);
      this.events.once('shutdown',()=>{clearChoicePress();window.removeEventListener('resize',resize);sound.clearEnd();sound.stopCharge();photoRenderer?.dispose();unlockShowroom.reset();releaseUnlockGlow();});
      if(new URLSearchParams(window.location?.search||'').get('feedback-demo')==='1')installFeedbackDemo();

    }

    particles(e,color,count=7,countScale=1){
      this.effects.push(...impactShards(e,color,{count,countScale,strength:settings.juice,reducedMotion}));
      let remaining=120;
      this.effects=this.effects.reverse().filter(item=>item.type!=='shard'||remaining-->0).reverse();
    }

    resetFeedback(){
      clearChoicePress();
      this.ending=null;
      this.cometTrails.clear();this.starParticles.clear();this.trailWorld=null;this.trailPhase='';
      this.wallFlashes=[];this.impactGhosts=[];this.zoomPulse=null;this.upgradeCue=0;this.feedbackCamera=null;this.blinkUntil=0;this.rescueUntil=0;this.firstTypeUntil=0;
      this.effects=this.effects.filter(effect=>effect.type!=='shockwave');
      this.wallBulges=[];this.bulgeWorld=null;
      sound.clearEnd();
      $('#game').style.transform='none';
    }
    trailsEnabled(){
      return screen==='play'&&!paused&&!modal&&!document.hidden&&!choicePress&&!this.ending&&!result&&!reducedMotion&&settings.juice>0&&
        ['battle','boss-entry','boss'].includes(world?.phase);
    }
    updateTrails(dt=0){
      if(!this.trailsEnabled()){this.cometTrails.clear();this.starParticles.clear();this.trailWorld=null;this.trailPhase='';return;}
      if(this.trailWorld!==world||this.trailPhase!==world.phase){this.cometTrails.clear();this.starParticles.clear();this.trailWorld=world;this.trailPhase=world.phase;}
      this.cometTrails.step([world.player,...(world.auxiliaries||[])].filter(body=>!body.captured&&body.active!==false&&body.hp>0),dt,{unit:world.unit});
      if(dt>0)this.starParticles.step([world.player],dt,{unit:world.unit,bounds:world.arenaBounds,enabled:!!starTrailState.selected,strength:settings.juice,trails:this.cometTrails,shape:starTrailState.selected});
    }
    beginEnding(){
      if(this.ending||result)return;
      if(runSaveStore.invalidate())pendingRunSnapshot=null;
      else toast('进度存储暂不可用，本局结算未能写入',true);
      resumeSlowRemaining=0;
      cancelDrag();this.resetFeedback();
      for(const effect of this.effects)effect.label?.destroy();this.effects=[];
      this.ending={age:0,suspended:document.hidden||!document.hasFocus(),resumePending:false,player:{...world.player},enemies:world.enemies.map(body=>({...body})),
        auxiliaries:(world.auxiliaries||[]).map(body=>({...body})),boss:world.boss?{...world.boss}:null};
      this.accumulator=0;this.timeSlices=[];this.timeScale=reducedMotion||!settings.juice?1:.25;
      $('.pause-button').disabled=true;saveEndlessProgress();
    }
    advanceEnding(dt){
      const ending=this.ending;if(!ending)return;
      if(ending.suspended||document.hidden||paused)return;
      if(ending.resumePending){ending.resumePending=false;return;}
      const elapsed=Math.min(Math.max(0,dt),Math.max(0,.6-ending.age));ending.age+=elapsed;
      if(!reducedMotion&&settings.juice){
        const geometry=world.arenaGeometry||world.arenaBounds,step=elapsed*.25;
        for(const body of [ending.player,...ending.enemies,...ending.auxiliaries]){
          body.x+=body.vx*step;body.y+=body.vy*step;body.squash*=Math.exp(-step*13);
          confineVisualBody(body,geometry);
        }
      }
      if(ending.age>=.6-1e-9){this.ending=null;this.rescaleTimeSlices(1);openResult(ending);}
    }
    rescaleTimeSlices(scale){
      // Pending slices describe future time after an in-step phase change.
      // Preserve their real duration when the clear wave takes over or ends.
      for(const slice of this.timeSlices){slice.world= slice.world/slice.scale*scale;slice.scale=scale;}
      this.accumulator=this.timeSlices.reduce((sum,slice)=>sum+slice.world/slice.scale,0);
      this.timeScale=scale;
    }
    pulseZoom(e){
      const rewardTransition=world.phase==='transition'&&world.phaseTime<.28;
      if(reducedMotion||!settings.juice||paused||modal||(!['battle','boss-entry','boss'].includes(world.phase)&&!rewardTransition))return;
      const level=Math.min(3,Math.max(0,(e.feedbackLevel||1)-1));
      this.zoomPulse={age:0,x:e.contactX??e.x,y:e.contactY??e.y,peak:(.02+level*.0033)*settings.juice,rewardTransition};
    }
    queueWallBulge(event){
      // Only the main player's real outside wall contacts deform the visual frame.
      if(event.surface!=='arena'||event.auxiliary||event.bodyId!==world?.player?.id||screen!=='play'||result||this.ending)return;
      const spec=wallBulgeSpec({...event,unit:world.unit,strength:settings.juice,reducedMotion});
      if(!spec)return;
      if(this.bulgeWorld!==world){this.wallBulges=[];this.bulgeWorld=world;}
      const side=event.nx<0?'left':event.nx>0?'right':event.ny<0?'top':'bottom';
      const index=this.wallBulges.findIndex(bulge=>bulge.side===side),old=this.wallBulges[index];
      const clock=world.borderTime||0;
      const oldAge=old?old.age+(old.fresh?0:Math.max(0,clock-old.lastClock)):0;
      const current=old?Math.abs(wallBulgeHeight({...old,age:oldAge})):0;
      const limit=2*spec.halfWidth*Math.tan(Math.PI/18)/Math.PI;
      const bulge={...event,...spec,side,peak:Math.min(limit,Math.max(spec.peak,current)),age:0,fresh:true,lastClock:clock};
      if(index<0)this.wallBulges.push(bulge);else this.wallBulges[index]=bulge;
    }
    updateWallBulges(){
      if(this.bulgeWorld!==world||screen!=='play'||result||this.ending||!settings.juice){this.wallBulges=[];this.bulgeWorld=world;return;}
      const clock=world?.borderTime||0;
      for(const bulge of this.wallBulges||[]){
        // New impacts retain their complete peak through the first actual draw.
        if(!bulge.fresh&&!paused&&!modal&&!document.hidden&&!choicePress)bulge.age+=Math.max(0,clock-bulge.lastClock);
        bulge.lastClock=clock;
      }
      this.wallBulges=(this.wallBulges||[]).filter(bulge=>bulge.age<bulge.duration);
    }
    updateFeedback(dt){
      this.updateWallBulges();
      if(paused||modal||document.hidden||screen!=='play')this.wallFlashes=this.wallFlashes.filter(flash=>!flash.bossDefeat);
      const zoomPhase=['battle','boss-entry','boss','clearing'].includes(world?.phase)||(world?.phase==='transition'&&this.zoomPulse?.rewardTransition);
      if(paused||modal||screen!=='play'||!zoomPhase||reducedMotion||!settings.juice){
        this.zoomPulse=null;this.feedbackCamera=null;$('#game').style.transform='none';
      }else if(this.zoomPulse){
        const pulse=this.zoomPulse;pulse.age+=dt;
        const duration=pulse.kind==='clear'?.95:.28;
        const zoom=pulse.kind==='clear'?clearingZoom(pulse.age,settings.juice):impactZoom(pulse.age,pulse.peak);
        this.feedbackCamera={x:pulse.x,y:pulse.y,zoom};
        $('#game').style.transformOrigin=`${pulse.x}px ${pulse.y}px`;
        $('#game').style.transform=`scale(${zoom})`;
        if(pulse.age>=duration){this.zoomPulse=null;this.feedbackCamera=null;$('#game').style.transform='none';}
      }
      if(screen!=='play'||world?.phase!=='transition')this.upgradeCue=0;
      if(paused)return;

      if(this.upgradeCue>0){
        this.upgradeCue=Math.max(0,this.upgradeCue-dt);
        if(this.upgradeCue<=1e-8){this.upgradeCue=0;tone(480,.25,'sine',.05,1.5);}
      }
      for(const flash of this.wallFlashes)flash.life+=dt;
      this.wallFlashes=this.wallFlashes.filter(flash=>flash.life<(flash.duration||.12));
      for(const ghost of this.impactGhosts){
        ghost.life=Math.max(0,(world.feedbackTime??world.time)-ghost.startedAt);
        if(ghost.life>=ghost.total)this.particles(ghost.event,enemyBodyColor(ghost.body,hex(settings.enemy)));
      }
      this.impactGhosts=this.impactGhosts.filter(ghost=>ghost.life<ghost.total);
    }
    shakenBody(body){
      if(paused||modal||reducedMotion||!settings.juice||!(body.feedbackFreeze>0))return body;
      const magnitude=(body.isBoss?2:1.5)*settings.juice;
      return {...body,x:body.x+Math.sin(this.clock*155+body.id)*magnitude,
        y:body.y+Math.sin(this.clock*121+body.id)*magnitude*.45};
    }
    handleEvents(){
      const events=world.events.splice(0);
      const endless=true;
      const finalKill=events.some(e=>e.type==='kill')&&events.some(e=>e.type==='upgrade');
      const bossDefeated=events.some(e=>e.type==='bossDefeated');
      for(const e of events){
        if(e.type==='runChoice'){
          cancelDrag();this.particles(e,e.choice.color);sound.rewardHit({strength:settings.juice,power:e.power??.5});
        }
        if(e.type==='runChoiceReady'){
          if(!chooseRun(e.choiceId))showRunChoice();
          return;
        }
        if(e.type==='shoot'){sound.launch(e.power);}
        if(e.type==='wall'){
          const audible=audioLevel(e.power,.5)>=.25;
          if(audible&&this.clock-this.hitSoundAt>.07){sound.wall(e.power,{endless});this.hitSoundAt=this.clock;}
          this.queueWallBulge(e);
        }
        if(e.type==='shockwave'){
          sound.shockwave({hit:e.hits>0,strength:settings.juice});
          if(settings.juice){
            this.effects.push({type:'shockwave',x:e.x,y:e.y,r:e.r,life:0,total:reducedMotion?.32:SHOCKWAVE_DURATION,color:hex(settings.player)});
          }
        }
        if(e.type==='hit'&&!e.lethal&&e.source!=='shockwave'){
          const hitTier=hitFeedbackTier(e);
          if(hitTier!=='light'&&this.clock-this.hitSoundAt>.05){sound.impact({kind:'hit',power:e.power,strength:settings.juice,endless,hitTier});this.hitSoundAt=this.clock;}
        }
        if(e.type==='kill'){
          if(endless&&e.value>0)scoreFeedback.noteKill(e.combo,world.comboCap);
          if(e.bodySnapshot&&e.freezeDuration>0)this.impactGhosts.push({event:e,body:e.bodySnapshot,life:0,total:e.freezeDuration,startedAt:e.feedbackTime??world.feedbackTime??world.time});
          else this.particles(e,enemyBodyColor(e,hex(settings.enemy)));
          sound.impact({kind:'kill',level:Math.max(0,(e.feedbackLevel||1)-1),power:e.power??e.impactSpeed/world.baseSpeed,strength:settings.juice,upgradeBoost:!!e.upgradeBoost,endless,frenzy:endless&&!!world.buffs.frenzy});
          this.hitSoundAt=this.clock;this.blinkUntil=this.clock+.075;if(e.source!=='shockwave')this.pulseZoom(e);
        }
        if(e.type==='clearingStart'){
          cancelDrag();this.rescaleTimeSlices(clearingTimeScale(world.clearing?.elapsed||0,{juice:settings.juice,reducedMotion}));
          sound.clearStart({strength:settings.juice});
          if(!reducedMotion&&settings.juice)this.zoomPulse={kind:'clear',age:0,x:e.x,y:e.y,rewardTransition:true};
        }
        if(e.type==='clearKill'){
          this.particles(e,enemyBodyColor(e,hex(settings.enemy)));
          sound.impact({kind:'kill',level:Math.max(0,(e.feedbackLevel||1)-1),power:e.power??.65,strength:settings.juice});
          this.blinkUntil=this.clock+.075;
        }
        if(e.type==='clearingEnd'){
          sound.clearEnd();this.rescaleTimeSlices(1);
          if(this.zoomPulse?.kind==='clear')this.zoomPulse.rewardTransition=true;
        }
        if(e.type==='rescue'){
          this.rescueUntil=(world.feedbackTime??world.time)+.4;
          tone(440,.18,'sine',.035,1.4);
        }
        if(e.type==='shieldBreak'){
          this.particles(e,hex(settings.enemy),5);
          if(e.source!=='shockwave')sound.impact({kind:'hit',power:.45,strength:settings.juice});
        }
        if(e.type==='firstTypeKill')this.firstTypeUntil=(world.feedbackTime??world.time)+.3;
        if(e.type==='shatter')this.particles(e,enemyBodyColor(e,hex(settings.enemy)),5);
        if(e.type==='bossEntry'){sound.setMusicScene('boss');tone(260,.35,'sine',.045,1.5);}
        if(e.type==='bossReady')tone(520,.14,'triangle',.035,1.15);
        if(e.type==='bossHit'&&!bossDefeated&&e.source!=='shockwave'){
          sound.impact({kind:'boss',power:e.power,strength:settings.juice});
        }
        if(e.type==='bossStunned'&&!reducedMotion&&settings.juice)this.wallFlashes.push({...e,boss:true,life:0});
        if(e.type==='bossScore'||e.type==='bossDefeated'){
          const label=this.add.text(e.x,e.y,'+'+e.value,{fontFamily:'GameSans, sans-serif',fontSize:e.type==='bossDefeated'?'22px':'18px',color:'#'+themeInkColor().toString(16).padStart(6,'0'),fontStyle:'normal'}).setOrigin(.5).setScale(viewport.scale);
          const labelY=e.type==='bossDefeated'?e.y+(e.r||world.player.r)+24:e.y-(e.r||world.player.r)-12;
          this.effects.push({type:'label',label,life:0,total:.6,x:e.x,y:labelY});
          if(e.type==='bossScore'){tone(600+(e.segment||0)*90,.13,'sine',.045,1.25);}
          else{
            sound.setMusicScene('endless');
            cancelDrag();this.particles(e,hex(settings.enemy),7,e.r/(e.referenceRadius||world.unit*.8));sound.bossDefeat({strength:settings.juice});
            if(settings.juice)this.wallFlashes.push({bossDefeat:true,life:0,duration:.18});
            if(world.bossVictorySlowTime>0)this.rescaleTimeSlices(reducedMotion||!settings.juice?1:.25);
          }
        }
        if(e.type==='bossCelebrate')sound.bossVictory();
        if(e.type==='upgrade'){
          cancelDrag();
          this.rewardVisuals={world};
          fitDemoOffer();
          if(finalKill)this.upgradeCue=.16;else tone(480,.25,'sine',.05,1.5);
        }
        if(e.type==='choiceReady'){fitDemoOffer();tone(660,.13,'sine',.035,1.2);}
        if(e.type==='buff'){
          if(endless&&e.playerRadiusBefore<world.player.r){
            this.rewardVisuals={world,growth:{from:e.playerRadiusBefore/world.player.r,at:e.feedbackTime,
              x:(e.playerGrowthOffset?.x||0)/world.unit,y:(e.playerGrowthOffset?.y||0)/world.unit}};
          }
          // Every collectible reward uses the same contact-directed shard
          // recipe as an enemy kill, without emitting a kill or changing score.
          this.particles(e,e.buff.color?hex(e.buff.color):upgradeAppearance(e.buff,hex(settings.bg)).color);
          sound.rewardHit({strength:settings.juice,power:e.power??.5});
        }

        if(e.type==='stage'&&endless){
          // Prepare the next Boss from the start of the run and again after
          // each encounter, rather than waiting for its fifth-stage battle.
          sound.prepareBossMusic();
          if(this.rewardVisuals?.world!==world)this.rewardVisuals={world};
          this.rewardVisuals.flightAt=e.feedbackTime;
        }

        if(e.type==='over'){
          sound.setMusicScene('failedEndless');this.beginEnding();tone(160,.4,'sine',.06,.4);
        }
      }
    }
    drawBorder(bounds=null){
      const g=this.g,w=viewport.width,h=viewport.height;
      const border=isDark(settings.bg)?0x636f64:0xc8ccbd;
      const full={left:16,top:16,right:w-16,bottom:h-16};
      const frame=bounds||full,geometry=bounds&&screen==='play'?world?.arenaGeometry:null,returning=result?smooth(result.clock/.65):0;
      const blend=(geometry?.blend||0)*(1-returning),margin=1-blend;
      let x=lerp(frame.left,full.left,returning)-margin,y=lerp(frame.top,full.top,returning)-margin;
      let right=lerp(frame.right,full.right,returning)+margin,bottom=lerp(frame.bottom,full.bottom,returning)+margin;
      let corner=clamp(lerp(geometry?.visualCornerRadius??22,22,returning),0,Math.min(right-x,bottom-y)/2);
      const bossPulse=screen==='play'&&!result&&!this.ending&&settings.juice?this.wallFlashes.find(flash=>flash.bossDefeat):null;
      const bossFade=bossPulse?clamp(1-bossPulse.life/bossPulse.duration,0,1):0;
      const bossOffset=bossPulse&&!reducedMotion?5*settings.juice*Math.sin(Math.PI*2*18*bossPulse.life)*bossFade*bossFade:0;
      // Move the actual visible frame, not a second outline over a still frame.
      // These offsets never enter arenaBounds or the collision simulation.
      const gap=null;

      const outline={left:x,top:y,right,bottom,cornerRadius:corner};
      this.lastBorder={...outline};
      const bulges=screen==='play'&&!result&&!this.ending&&settings.juice&&this.bulgeWorld===world?
        (this.wallBulges||[]).map(bulge=>({...bulge,height:wallBulgeHeight(bulge)})):[];
      const deformed=bulges.some(bulge=>Math.abs(bulge.height)>1e-9)?buildBulgedBorder(outline,gap,bulges):null;
      const stroke=(dx=0,dy=0,outset=0)=>{
        if(deformed){
          const shape=outset?buildBulgedBorder({left:x-outset,top:y-outset,right:right+outset,bottom:bottom+outset,cornerRadius:Math.max(0,corner+outset)},gap,bulges):deformed;
          for(const path of shape.paths){
            if(!path.points.length)continue;
            g.beginPath();
            path.points.forEach((point,i)=>i?g.lineTo(point.x+bossOffset+dx,point.y+dy):g.moveTo(point.x+bossOffset+dx,point.y+dy));
            if(path.closed)g.closePath();
            g.strokePath();
          }
          return;
        }

        g.strokeRoundedRect(x+bossOffset+dx-outset,y+dy-outset,right-x+outset*2,bottom-y+outset*2,Math.max(0,corner+outset));
      };
      g.lineStyle(1+(reducedMotion?1.5:1)*bossFade*settings.juice,border,Math.min(1,.65+.35*bossFade*settings.juice));stroke();
      if(bulges.length)for(const bulge of this.wallBulges){bulge.fresh=false;bulge.lastClock=world.borderTime||0;}
      const warning=()=>{
        const {alpha,width}=this.pressureWarning;
        if(alpha<=0)return;
        // Two translucent strokes sit on the original path. Their extra width
        // is paint only; arenaBounds and all collision radii stay untouched.
        g.lineStyle(width+4,PRESSURE_WARNING_COLOR,alpha*.18);stroke();
        g.lineStyle(width,PRESSURE_WARNING_COLOR,alpha);stroke();
      };
      if(this.ending){g.lineStyle(1.5,blendRgb(border,hex(settings.enemy),.4),1);stroke();warning();return;}
      if(screen!=='play'||result||!settings.juice){warning();return;}
      for(const flash of this.wallFlashes){
        if(flash.bossDefeat)continue;
        if(flash.boss){
          if(!reducedMotion&&flash.life<.05){const push=2*settings.juice*Math.sin(flash.life/.05*Math.PI);g.lineStyle(1,border,.65);stroke(0,0,push);}
          continue;
        }

      }
      warning();
    }
    drawHome(){
      const g=this.g,fade=home.fade*homeReveal,t=reducedMotion?0:home.clock;
      this.drawBorder();
      const {player:anchor,base,orbitCenter}=home.layout;
      const orbit=Math.min(base*2.65,viewport.height*.30);
      const line=isDark(settings.bg)?0x637068:0xb8bead;
      ring(g,orbitCenter.x,orbitCenter.y,orbit,line,.35*fade,1);
      ring(g,orbitCenter.x,orbitCenter.y,orbit*.69,line,.17*fade,1);
      // Preserve the arc; match the last two edge gaps along the tangent to the resting skin.
      const trailBend=1.3*1.55/(2*2.45-1.55);
      const trailCount=15,dotRadius=1.5,dotGrowth=.5;
      const skinEdge=skinPoint(Math.atan2(1.3-trailBend,-.9),activeContour());
      const playerEdge=anchor.r*Math.hypot(skinEdge.x,skinEdge.y);
      const tangentLength=base*Math.hypot(1.55,2*trailBend),joinRadius=base*Math.hypot(.9,1.3-trailBend);
      const trailEnd=(trailCount-1)*(joinRadius+tangentLength-playerEdge+dotRadius)
        /(trailCount*tangentLength-dotGrowth*(trailCount-2));
      for(let i=0;i<trailCount;i++){
        const u=i*trailEnd/(trailCount-1),bend=u<=1?u*u:2*u-1;
        const px=anchor.x-base*2.45+u*base*1.55,py=anchor.y+base*1.3-bend*base*trailBend;
        g.fillStyle(line,(.18+u*.35)*fade);g.fillCircle(px,py,dotRadius+u*dotGrowth);
      }

      const colors={play:homePlayColor,sound:homeSoundColor,settings:0xc4dc86,wardrobe:0xe5c684};
      for(const c of home.targets){
        if(controlFlight&&['play','settings'].includes(c.id))continue;
        drawFunctionalBall(g,c,colors[c.id],c.id,fade,c.id==='sound'&&!settings.sound);
      }
      if(!detached())drawBall(g,home.player,hex(settings.player),1,drag||home.pull);
      else playerVisuals.delete(home.player);
    }
    updateHome(dt){
      const before=home.phase;
      if(!modal&&!transfer)home.step(dt,!reducedMotion);
      if(home.action){
        const action=home.action;home.action=null;
        if(action==='sound'){settings.sound=!settings.sound;applyTheme();tone(540,.09,'sine',.04,1.3);}

        if(action==='settings')openSettings();
        if(action==='wardrobe')openWardrobe();
      }
      layoutHomeControl();
      if(before!=='entering'&&home.phase==='entering'){
        screen='entering';cancelDrag();syncInputs();
        sound.setMusicScene('endless');
        pendingRunSnapshot=runSaveStore.read();
        $('.pause-button').hidden=!!pendingRunSnapshot;
        $('#score').hidden=!!pendingRunSnapshot;$('#score').style.opacity=1;
        $('#hud').hidden=false;$('#hud').style.opacity=0;$('#score').textContent='0000';
        clearChoiceLabels();$('.pause-button').disabled=true;
        tone(420,.24,'sine',.055,1.7);
      }
      if(screen==='entering'){
        $('#home').style.opacity=home.fade;$('#hud').style.opacity=home.hudOpacity;
      }
      if(screen==='home')$('#home').style.opacity=homeReveal;
      if(home.phase==='done'){

        const {lookX,lookY}=home.player;
        startGame();
        Object.assign(world.player,{lookX,lookY});
        if(document.hidden||!document.hasFocus())setPanel('pause');
        // prepareGame clears the graphics: paint the arena in this same frame.
        this.drawArena();
      }else this.drawHome();
    }
    drawArena(){
      const g=this.g;this.drawBorder(world.arenaBounds);
      const view=this.ending||result?.sceneBodies,p=view?.player||world.player,boss=view?.boss||world.boss;
      const arrival=1;
      // Resolve hit-stop displacement once: the cut and the later body fill must
      // use the very same frame, including velocity stretch and impact squash.
      const auxiliaryFrames=(view?.auxiliaries||world.auxiliaries||[])
        .filter(body=>body.active!==false&&body.hp>0&&!body.captured).map(source=>{
          const body=this.shakenBody(source);
          const skinPose={x:body.x,y:body.y,r:body.r,squash:body.squash,
            deformAngle:body.angle,pullAmount:0,roll:body.roll??(world.phase==='transition'?Math.PI*2*world.rewardMoveProgress:0)};
          return {source,body,geometry:ballRenderGeometry(body,skinPose,null,source)};
        });

      const trailBodies=[world.player,...(world.auxiliaries||[])].filter(body=>!body.captured&&body.active!==false&&body.hp>0);
      if(this.trailsEnabled()&&trailBodies.length){
        this.cometTrails.draw(g,trailBodies,playerFeedbackColor(),{unit:world.unit,strength:settings.juice,bounds:world.arenaBounds,
          clipOutline:body=>auxiliaryFrames.find(frame=>frame.source===body)?.geometry.playerPoints});
        this.starParticles.draw(g,playerFeedbackColor(),{strength:settings.juice});
      }else{this.cometTrails.clear();this.starParticles.clear();}
      if(boss&&!boss.defeated){
        const b=boss,alpha=result?1-smooth(result.clock/.65):1;
        drawBoss(g,this.shakenBody(b),alpha);
      }
      for(const b of view?.enemies||world.enemies){
        if(result?.sourceIds.includes(b.id))continue;
        const pose={body:b,alpha:1,hidden:false};
        if(pose.hidden)continue;
        const alpha=(result?1-smooth(result.clock/.65):1)*pose.alpha*arrival;
        const size=injuredEnemyScale(b,true);
        const body=this.shakenBody({...pose.body,r:pose.body.r*size});
        const special=isSpecialEnemy(body);
        if(special)drawEnemyBall(g,body,hex(settings.enemy),{alpha,unit:world.unit*size,player:p,
          flashAlpha:!result&&b.hit>.01?b.hit*(b.hitAlpha??.5):0,flashColor:isDark(settings.enemy)?0xffffff:0xf9f8f0});
        else{
          drawBall(g,body,hex(settings.enemy),alpha);

          if(!result&&b.hit>.01){g.fillStyle(isDark(settings.enemy)?0xffffff:0xf9f8f0,b.hit*(b.hitAlpha??.5));g.fillEllipse(body.x,body.y,body.r*1.7,body.r*1.7,128);}
        }
      }
      for(const ghost of this.impactGhosts){
        const size=injuredEnemyScale(ghost.body,true);
        const body=this.shakenBody({...ghost.body,r:ghost.body.r*size,feedbackFreeze:ghost.total-ghost.life});
        if(isSpecialEnemy(body))drawEnemyBall(g,body,hex(settings.enemy),{unit:world.unit*size,player:p,
          flashAlpha:.15+.25*settings.juice,flashColor:isDark(settings.enemy)?0xffffff:0xf9f8f0});
        else{
          drawBall(g,body,hex(settings.enemy));
          g.fillStyle(isDark(settings.enemy)?0xffffff:0xf9f8f0,.15+.25*settings.juice);
          g.fillEllipse(body.x,body.y,body.r*1.7,body.r*1.7,64);
        }
      }
      for(const c of world.choices){
        const appear=ease(c.born),r=c.r*appear;
        if(r<1)continue;
        const bob=choiceBob(c);
        if(c.runChoice){drawFunctionalBall(g,{...c,y:c.y+bob,r},c.color,c.icon,appear);continue;}
        drawUpgradeBall(g,{...c,y:c.y+bob},hex(settings.bg),{preview:choicePress?.active&&choicePress.choiceId===c.id,
          time:Math.max(0,this.inputClock-(choicePress?.startedAt||0)-.3),reducedMotion:reducedMotion||!settings.juice});
      }
      let photoSlot=0;
      for(const {body,geometry} of auxiliaryFrames){
        drawBall(g,body,hex(settings.player),(result?1-smooth(result.clock/.65):1)*arrival,null,null,photoSlot++,geometry);
      }
      if(!detached()){
        const pose={body:p,alpha:1,hidden:false};
        if(!pose.hidden){drawDragGuide(g,pose.body);drawBall(g,pose.body,hex(settings.player),pose.alpha,drag?.pending?null:drag);}

      }

      if(!detached()&&world.phase==='boss-celebrate'){
        const crown=crownVisual(world.phaseTime,reducedMotion);
        if(this.radiance){
          this.radiance.setVisible(crown.alpha>0).setPosition(p.x*viewport.scale,p.y*viewport.scale)
            .setDisplaySize(p.r*7*viewport.scale,p.r*7*viewport.scale)
            .setRotation(reducedMotion?0:this.clock*.19).setAlpha(crown.alpha*(reducedMotion?1:.88+.12*Math.sin(this.clock*2.5)));
        }
        if(crown.alpha>0){
          g.fillStyle(hex(settings.player),crown.alpha);g.beginPath();
          const rotated=projectSkinContour(activeContour(),{roll:p.roll||0});
          fitCrownToSkin(crownPoints,rotated).forEach((point,i)=>{
            const x=p.x+point.x*p.r*crown.scale;
            // Scale around an anchor above the head so the small entering crown
            // keeps a gap instead of growing through the player's body.
            const y=p.y+((point.y+1.45)*crown.scale-1.45)*p.r;
            i?g.lineTo(x,y):g.moveTo(x,y);
          });
          g.closePath();g.fillPath();
        }
      }

      for(const e of this.effects){
        if(e.type==='label'){e.label.setVisible(!modal).setPosition(e.x*viewport.scale,(e.y-e.life*32)*viewport.scale).setAlpha(1-e.life/e.total);continue;}
        const t=e.life/e.total;
        if(e.type==='shockwave'){
          const frame=shockwaveFrame(e.life,e.r,settings.juice,reducedMotion);
          for(const front of frame.rings)ring(g,e.x,e.y,front.r,e.color,front.alpha,front.width);
          continue;
        }
        if(e.type==='upgrade-wave'){
          ring(g,e.x,e.y,e.r*(reducedMotion?1:.55+.45*smooth(t)),e.color,(1-t)*.18*settings.juice,1);continue;
        }
        polygon(g,e.x,e.y,e.r*(1-t*.3),e.sides,e.angle,e.color,(1-t*t)*(result?1-smooth(result.clock/.65):1));
      }
    }
    update(time,delta){
      const realDt=Math.max(0,delta/1000),dt=Math.min(realDt,.05);
      this.inputClock+=realDt;this.frameStamp=Number.isFinite(time)?time/1000:null;
      this.frameDt=dt;this.clock+=dt;this.g.clear();
      const pressureActive=screen==='play'&&!paused&&!modal&&!result&&!this.ending&&world?.phase==='battle';
      this.pressureWarning.step(pressureActive?world.pressureCount:0,dt,{juice:settings.juice,reducedMotion});
      clearPhoto();updateSkin(dt);updateStarTrailVisual(dt);this.radiance?.setVisible(false);
      this.updateTrails();
      if(screen==='home'||screen==='entering'){this.updateHome(dt);updateUiBall(dt);return;}

      if(!world)return;
      if(this.ending){this.advanceEnding(realDt);this.drawArena();updateHud(dt);updateUiBall(dt);return;}
      updateChoicePress();const pending=drag?.pending;updateAim();
      if(world.phase==='clearing')this.timeScale=Math.min(this.timeScale,clearingTimeScale(world.clearing?.elapsed||0,{juice:settings.juice,reducedMotion}));

      if(world.bossVictorySlowTime>0)this.timeScale=Math.min(this.timeScale,reducedMotion||!settings.juice?1:.25);
      if(pending&&drag&&!drag.pending)updateChargeFeedback();
      if(!paused&&!choicePress){
        const frameWorld=world;
        this.handleEvents();
        if(world!==frameWorld){this.drawArena();updateHud(0);updateUiBall(0);return;}
        if(this.ending){this.drawArena();updateHud(dt);updateUiBall(dt);return;}
        const timeScale=this.timeScale;
        if(dt>0){this.accumulator+=dt;this.timeSlices.push({world:dt*timeScale,scale:timeScale});}
        while(this.accumulator>=1/120-1e-12&&!paused){
          // Tick at 120 Hz of real time even during slow motion. Accumulating
          // scaled time instead would drop a 0.3x aim to 36 position updates/s.
          // Retain each fraction's rate across releases so feedback holds keep
          // their real duration while movement advances by scaled world time.
          let remaining=1/120,worldStep=0;
          while(remaining>1e-12&&this.timeSlices.length){
            const slice=this.timeSlices[0],take=Math.min(remaining,slice.world/slice.scale);
            worldStep+=take*slice.scale;remaining-=take;slice.world-=take*slice.scale;
            if(slice.world<1e-12)this.timeSlices.shift();
          }
          const stepScale=worldStep/(1/120);
          const phaseBeforeStep=world.phase;
          world.step(worldStep,!!drag&&!drag.pending,{timeScale:stepScale});
          this.updateTrails(worldStep);
          this.accumulator=Math.max(0,this.accumulator-1/120);this.handleEvents();if(world!==frameWorld||world.phase==='over')break;
          if(world.bossVictorySlowTime>0){
            this.rescaleTimeSlices(Math.min(resumeSlowRemaining>0?aimMinimumScale(reducedMotion):1,reducedMotion||!settings.juice?1:.25));
          }else if(world.phase==='clearing'){
            this.rescaleTimeSlices(Math.min(resumeSlowRemaining>0?aimMinimumScale(reducedMotion):1,clearingTimeScale(world.clearing?.elapsed||0,{juice:settings.juice,reducedMotion})));
          }else if(phaseBeforeStep==='clearing'||timeScale!==1&&!world.continuousControl&&resumeSlowRemaining<=0){
            // A simulated phase change happens inside this frame. Its remaining
            // real time belongs to the normal-speed reward or Boss entrance.
            this.rescaleTimeSlices(resumeSlowRemaining>0?aimMinimumScale(reducedMotion):1);
          }
        }
        if(world!==frameWorld){this.drawArena();updateHud(0);updateUiBall(0);return;}
        if(resumeSlowRemaining>0&&!document.hidden){
          resumeSlowRemaining=Math.max(0,resumeSlowRemaining-realDt);
          if(resumeSlowRemaining<=1e-9){resumeSlowRemaining=0;if(!drag?.aim) this.timeScale=1;}
        }
        if(drag&&!world.ready)cancelDrag();
        for(const e of this.effects){e.life+=dt;if(e.type==='shard'){e.x+=e.vx*dt;e.y+=e.vy*dt;e.angle+=e.spin*dt;}}
        this.effects=this.effects.filter(e=>{if(e.life>=e.total){e.label?.destroy();return false;}return true;});
      }else if(choicePress){this.accumulator=0;this.timeSlices=[];}

      this.updateFeedback(dt);this.drawArena();updateHud(paused?0:dt,dt);updateUiBall(dt);
    }
  }
  game=new Phaser.Game({type:Phaser.AUTO,parent:'game',backgroundColor:settings.bg,scale:{mode:Phaser.Scale.NONE,width:viewport.bufferWidth,height:viewport.bufferHeight,zoom:1/viewport.scale,autoRound:false},scene:BallScene,render:{antialias:true,antialiasGL:true,transparent:false,roundPixels:false},input:{activePointers:2},audio:{noAudio:true},fps:{target:60,forceSetTimeOut:false},banner:false});
}

// A link-only acceptance playground. It uses real World collisions and never
// saves its score or progression; the normal home screen has no extra controls.
function installFeedbackDemo(){
  if($('#feedback-demo'))return;
  const panel=document.createElement('section');panel.id='feedback-demo';panel.className='feedback-demo';
  panel.setAttribute('aria-label','打击反馈试玩');
  panel.innerHTML='<div class="demo-title">打击反馈试玩 <span>选择场景，可继续拖拽弹射</span></div><div class="demo-actions"><button data-demo="steer">高速转向</button><button data-demo="light">轻击</button><button data-demo="medium">普通命中</button><button data-demo="heavy">重击</button><button data-demo="kill">击杀</button><button data-demo="multi">连续击杀</button><button data-demo="reward">连锁清场</button><button data-demo="rescue">压力保命</button><button data-demo="danger">危险宽限</button><button data-demo="boss">Boss</button><button data-demo="home">返回游戏</button><button data-demo="all-demos">试玩菜单</button></div><div class="volume-row"><div><label for="demo-strength">反馈强度</label><output id="demo-value">60%</output></div><input id="demo-strength" type="range" min="0" max="100" step="10" value="60" aria-label="试玩反馈强度"></div>';
  const typeOptions=['ring','heavy','split','walker','magnet','shield','leader'].map(type=>`<option value="${type}">${ENEMY_TYPES[type].name}</option>`).join('');
  panel.innerHTML+=`<div class="demo-enemy"><label for="demo-enemy-type">敌球类型</label><select id="demo-enemy-type">${typeOptions}</select><button type="button" data-demo="enemy-type">试玩敌球</button></div>`;
  const upgradeOptions=UPGRADE_DEFINITIONS.map(upgrade=>`<option value="upgrade-${upgrade.id}">${upgrade.name}</option>`).join('');
  panel.innerHTML+=`<div class="demo-enemy"><label for="demo-upgrade-type">强化试玩</label><select id="demo-upgrade-type"><option value="choices-3">奖励三选一</option><option value="choices-double">连续两轮三选一</option>${upgradeOptions}</select><button type="button" data-demo="upgrade-type">试玩强化</button></div>`;
  panel.innerHTML+='<div class="demo-enemy demo-endless"><label for="demo-endless-type">无尽进程</label><select id="demo-endless-type"><option value="boss-inflation">方场膨胀Boss</option><option value="boss-rewards">Boss末杀与双重奖励</option><option value="ending">结局镜头</option><option value="starting-1">一次起步强化</option><option value="all-demos">全部试玩场景</option></select><button type="button" data-demo="endless-type">试玩进程</button></div>';
  document.body.append(panel);
  const slider=panel.querySelector('#demo-strength'),output=panel.querySelector('#demo-value');
  slider.value=Math.round(settings.juice*100);output.value=slider.value+'%';slider.style.setProperty('--volume',output.value);
  slider.addEventListener('input',()=>{
    settings.juice=feedbackStrength(Number(slider.value)/100);output.value=slider.value+'%';slider.style.setProperty('--volume',output.value);
    syncFeedbackSettings();storage.write('qiuqiule-settings',settings);
  });
  panel.addEventListener('click',event=>{
    let kind=event.target.closest('[data-demo]')?.dataset.demo;if(!kind)return;
    if(kind==='home'){panel.hidden=true;feedbackDemo=false;showHome();return;}
    if(kind==='enemy-type')kind='type-'+panel.querySelector('#demo-enemy-type').value;
    if(kind==='upgrade-type')kind=panel.querySelector('#demo-upgrade-type').value;
    if(kind==='endless-type')kind=panel.querySelector('#demo-endless-type').value;
    if(kind==='all-demos'){panel.classList.remove('demo-flow','demo-compact');return;}
    startFeedbackDemo(kind);
  });
}
function startFeedbackDemo(kind){
  unlockAudio();hidePanel();prepareGame({demo:true});
  feedbackDemo=true;paused=false;world.enemies=[];world.events=[];world.spawnTimer=Infinity;world.floorTimer=Infinity;world.introTimer=Infinity;world.wave=null;
  const hints={steer:'球在飞行时也能拖拽；轻点不会发射',reward:'最后一杀引发碎裂波，清场后选择强化',rescue:'触顶后有0.8秒宽限，本局首次自动清除三个名额，同族子球一并清除',danger:'保命已用完；新球出现触顶后，及时击杀可以挽回'};
  const type=kind.startsWith('type-')?kind.slice(5):null;
  const typeHints={ring:'空心环很轻；试着将它弹开',heavy:'重球更难推动；碰撞时注意反弹',split:'击碎后分成三颗子球，可继续清理',walker:'游走球会持续移动；拖拽瞄准它',magnet:'靠近磁球会被吸引，击碎后邻球散开',shield:'第一击破盾，之后才能伤到球体',leader:'周围球向簇长聚拢，击碎后散开'};
  const hint=$('#feedback-demo .demo-title span');if(hint)hint.textContent=typeHints[type]||hints[kind]||'选择场景，可继续拖拽弹射';
  const p=world.player,u=world.unit;
  $('#feedback-demo')?.classList.toggle('demo-flow',kind==='boss'||kind.startsWith('boss-')||kind==='ending'||kind.startsWith('starting-'));
  $('#feedback-demo')?.classList.toggle('demo-compact',kind==='choices-double'||kind==='upgrade-gambler');
  p.x=viewport.width*.24;p.y=viewport.height*.46;p.vx=p.vy=0;p.born=1;p.solid=true;
  if(kind==='boss'||kind.startsWith('boss-')||kind==='ending'||kind.startsWith('starting-')){startEndlessDemo(kind);return;}
  if(kind.startsWith('upgrade-')||kind.startsWith('choices-')){startUpgradeDemo(kind);return;}
  const add=(x,y,hp=19,density=.8,r=u*.85)=>{
    const b=world.makeBody(x,y,r,density);Object.assign(b,{hp,maxHp:hp,born:1,solid:true,vx:0,vy:0});world.enemies.push(b);return b;
  };
  const middle=viewport.width*.52;
  if(type&&ENEMY_TYPES[type]?.spawnable){
    world.stage=ENEMY_TYPES[type].stage;world.stageKills=0;
    const panel=$('#feedback-demo'),rect=panel&&!panel.hidden?panel.getBoundingClientRect():null,bounds=world.arenaBounds;
    const bottom=rect?.height>0&&rect.top>bounds.top?Math.min(bounds.bottom,rect.top):bounds.bottom;
    const top=Math.min(bounds.top+u*5,bottom-u*5),middleY=clamp(lerp(top,bottom-u*2,.5),bounds.top+u*3,bottom-u*2);
    p.x=bounds.left+bounds.width*.25;p.y=middleY;
    const targetX=type==='magnet'?p.x+u*3:bounds.left+bounds.width*.65;
    const place=(enemyType,x,y)=>{
      const enemy=world.spawnEnemy(null,enemyType);
      if(enemy)Object.assign(enemy,{x,y,born:1,solid:true,...(enemyType==='walker'?{}:{vx:0,vy:0})});
      return enemy;
    };
    const target=place(type,targetX,middleY);
    if(type==='magnet'){
      if(bottom-bounds.top<u*7)place('normal',targetX+u*2.5,middleY);
      else place('normal',targetX,Math.max(bounds.top+u*1.3,middleY-u*2.5));
    }
    if(type==='leader'&&target){
      let positions;
      if(bottom-bounds.top<u*9){
        const left=bounds.left+u*1.2,right=bounds.right-u*1.2;
        p.x=left;target.x=lerp(left,right,.5);
        positions=[.25,.75,1].map(t=>({x:lerp(left,right,t),y:middleY}));
      }else positions=[-Math.PI/2,0,Math.PI/2].map(turn=>({x:target.x+Math.cos(turn)*u*2.5,y:target.y+Math.sin(turn)*u*2.5}));
      for(const point of positions){
        const neighbour=place('normal',point.x,point.y);
        if(neighbour)neighbour.clusterId=target.clusterId;
      }
    }
    if(!['walker','magnet','leader'].includes(type))world.shoot(-world.maxPull*(['ring','heavy'].includes(type)?.65:1),0);
    updateHud();return;
  }
  if(kind==='rescue'||kind==='danger'){
    const panel=$('#feedback-demo'),rect=panel&&!panel.hidden?panel.getBoundingClientRect():null;
    const bounds=world.arenaBounds,gap=Math.max(4,u*.35);
    const bottom=rect?.height>0&&rect.top>bounds.top?Math.min(bounds.bottom,rect.top):bounds.bottom;
    p.x=viewport.width*.5;p.y=bottom-p.r*2;
    const radius=Math.min(u*.7,(bounds.width-gap*8)/14,Math.max(1,(bottom-bounds.top-p.r*3-gap*6)/8));
    const gridEnd=p.y-p.r-radius-gap;
    const gridStart=Math.max(bounds.top+radius+gap,Math.min(bounds.top+u*5,gridEnd-3*(radius*2+gap)));
    const count=kind==='rescue'?28:27;
    for(let i=0;i<count;i++)add(lerp(bounds.left+radius+gap,bounds.right-radius-gap,(i%7)/6),lerp(gridStart,gridEnd,Math.floor(i/7)/3),19,.8,radius);
    world.saveUsed=kind==='danger';world.overTimer=0;
    if(kind==='danger')world.spawnTimer=.8;
    updateHud();return;
  }
  if(kind==='steer'){
    for(const [x,y] of [[.48,.28],[.72,.48],[.35,.65]])add(viewport.width*x,viewport.height*y,10000,1,u*.85);
    p.vx=world.baseSpeed;p.vy=-world.baseSpeed*.2;return;
  }
  if(kind==='multi'){
    for(let i=0;i<3;i++)add(middle+i*u*1.7,p.y,1,.12,u*.65);
  }else add(middle,p.y,kind==='light'?2000:kind==='medium'?600:kind==='heavy'?180:19);
  // This independent ball visibly keeps moving during another pair's hit-stop.
  const witness=add(viewport.width*.65,Math.max(90,p.y-u*5),10000,.8,u*.7);witness.vx=-u*1.5;
  if(kind==='reward'){
    world.stageKills=world.killTarget-1;
    for(const [x,y] of [[.2,.2],[.42,.25],[.76,.24],[.2,.72],[.48,.76],[.78,.68],[.83,.49]])add(viewport.width*x,viewport.height*y);
  }
  world.shoot(-world.maxPull,0);
}

function startEndlessDemo(kind){
  const p=world.player,u=world.unit,hint=$('#feedback-demo .demo-title span');
  if(kind.startsWith('starting-')){
    world.beginStartingUpgrades();
    if(hint)hint.textContent='只从常规强化中选择；完成后从第一阶段开始';
    updateChoices();updateHud();return;
  }
  if(kind==='ending'){
    world.stage=world.maxStage=12;world.maxCombo=7;world.score=460;world.saveUsed=true;world.overTimer=.79;
    for(let i=0;i<28;i++){
      const b=world.makeBody(viewport.width*(.12+(i%7)*.125),viewport.height*(.16+Math.floor(i/7)*.15),u*.7,.8);
      Object.assign(b,{born:1,solid:true,hp:19,maxHp:19,enemyType:'normal'});world.enemies.push(b);
    }
    p.x=viewport.width*.5;p.y=viewport.height*.75;p.vx=u*5;p.vy=-u;
    if(hint)hint.textContent='结尾镜头后，点击结算空白处可快速重开';
    updateHud();return;
  }
  const victory=kind==='boss-rewards';world.stage=world.maxStage=5;
  if(victory){
    world.beginBoss();Object.assign(p,world.bossPlayerAnchor());p.born=1;p.solid=true;
    Object.assign(world.boss,{r:world.boss.minRadius,hp:1,maxHp:1,stunned:true});
    world.shoot(0,world.maxPull);
  }else{
    const panel=$('#feedback-demo'),rect=panel&&!panel.hidden?panel.getBoundingClientRect():null,bounds=world.arenaBounds;
    const bottom=rect?.height>0&&rect.top>bounds.top?Math.min(bounds.bottom,rect.top):bounds.bottom;
    p.x=bounds.left+bounds.width*.22;p.y=clamp((bounds.top+bottom)*.48,bounds.top+u*3,bottom-u*3);
    world.stageKills=world.killTarget-1;
    for(const [x,y] of [[.5,0],[.67,-2.7],[.84,2.7]]){
      const enemy=world.spawnEnemy(null,'normal');
      if(enemy)Object.assign(enemy,{x:bounds.left+bounds.width*x,y:clamp(p.y+y*u,bounds.top+u*1.5,bottom-u*1.5),hp:1,maxHp:1,vx:0,vy:0,born:1,solid:true});
    }
    world.shoot(-world.maxPull,0);
  }
  if(hint)hint.textContent=victory?'最后一击让边框震动；胜利后连续选择两次强化':'清空场地后，在正方形边界内挑战膨胀Boss';
  updateHud();
}

function fitDemoOffer(){
  const panel=$('#feedback-demo');
  if(!feedbackDemo||(!panel?.classList.contains('demo-flow')&&!panel?.classList.contains('demo-compact'))||!['transition','choose'].includes(world?.phase))return;
  panel.classList.toggle('demo-compact',world.choices.length>3||world.upgradeRoundTotal>1);
  const rect=!panel.hidden?panel.getBoundingClientRect():null,bounds=world.arenaBounds,u=world.unit,p=world.player;
  const bottom=rect?.height>0&&rect.top>bounds.top?Math.min(bounds.bottom,rect.top):bounds.bottom;
  world.layoutChoices(world.choices.length>3?{top:bounds.top+8,bottom:bottom-8}:{top:bounds.top+u*3,bottom:bottom-u*4});
  if(world.choices.length<=3)world.choicePlayerY=bottom-p.r*2;
  if(world.phase==='choose'){
    p.x=viewport.width*.5;p.y=world.choicePlayerY;p.vx=p.vy=0;
    if(world.choices.length<=3&&viewport.width>viewport.height&&world.choices.some(c=>Math.hypot(p.x-c.x,p.y-c.y)<p.r+c.r+8)){
      p.x=bounds.left+p.r*1.5;p.y=Math.max(bounds.top+p.r*2,(bounds.top+bottom)*.55);
    }
  }
  updateChoices();
}

function startUpgradeDemo(kind){
  const id=kind.startsWith('upgrade-')?kind.slice(8):null,definition=UPGRADES[id],p=world.player,u=world.unit;
  const acquire=upgrade=>{
    world.phase='choose';
    world.choose({...UPGRADES[upgrade],x:p.x,y:p.y,r:u*2,born:1});
    // Finish the same reward rest used by ordinary play.
    for(let i=0;i<125&&world.phase==='reward';i++)world.step(1/120);
  };
  if(id==='overspeed')for(let i=0;i<4;i++)acquire('energy');
  if(definition)acquire(id);
  if(kind==='choices-double')acquire('gambler');
  world.enemies=[];world.auxiliaries=[];world.fragmentQueue=[];world.events=[];
  world.score=0;world.stageKills=0;world.spawnTimer=world.floorTimer=world.introTimer=Infinity;world.wave=null;
  const panel=$('#feedback-demo'),rect=panel&&!panel.hidden?panel.getBoundingClientRect():null,bounds=world.arenaBounds;
  const bottom=rect?.height>0&&rect.top>bounds.top?Math.min(bounds.bottom,rect.top):bounds.bottom;
  const hint=$('#feedback-demo .demo-title span');
  if(kind.startsWith('choices-')||id==='gambler'){
    world.beginUpgrade();
    for(let i=0;i<240&&world.phase==='transition';i++)world.step(1/120);
    world.layoutChoices(world.choices.length>3?{top:bounds.top+8,bottom:bottom-8}:{top:bounds.top+u*3,bottom:bottom-u*4});
    p.x=viewport.width*.5;p.y=world.choices.length>3?world.choicePlayerY:bottom-p.r*2;p.vx=p.vy=0;p.born=1;p.solid=true;
    if(world.choices.length<=3&&viewport.width>viewport.height&&world.choices.some(c=>Math.hypot(p.x-c.x,p.y-c.y)<p.r+c.r+8)){
      p.x=bounds.left+p.r*1.5;p.y=Math.max(bounds.top+p.r*2,(bounds.top+bottom)*.55);
    }
    world.events=[];
    if(hint)hint.textContent=(world.upgradeRoundTotal>1?'连续两轮三选一；':'')+'长按球看示意，拖拽玩家撞球选择';
    updateChoices();updateHud();return;
  }
  const middleY=clamp((bounds.top+bottom)*.52,bounds.top+u*3,bottom-u*3);
  p.x=bounds.left+bounds.width*.2;p.y=middleY;p.vx=p.vy=0;p.born=1;p.solid=true;
  const place=(x,y)=>{
    const enemy=world.spawnEnemy(null,'normal');
    if(enemy)Object.assign(enemy,{x,y,vx:0,vy:0,born:1,solid:true});
    return enemy;
  };
  const targetX=bounds.left+bounds.width*.5;
  if(id==='gravity'){
    p.x=bounds.left+bounds.width*.42;
    const compact=bottom-bounds.top<u*8,spread=compact?.5:.8,distance=compact?4:3.4;
    if(compact)p.y=(bounds.top+bottom)/2;
    for(const angle of [-spread,0,spread])place(p.x+Math.cos(angle)*u*distance,p.y+Math.sin(angle)*u*distance);
  }else if(id==='shockwave'){
    if(bottom-bounds.top<u*8)p.y=bounds.top+p.r*1.5;
    for(const side of [bounds.left+u*1.5,bounds.right-u*1.5])place(side,p.y+u*2.3);
  }else{
    place(targetX,p.y);
    if(['split','pulse','magnet'].includes(id))for(const side of [-1,1])place(targetX+u*2.5,p.y+side*u*1.9);
    else for(let i=1;i<=2;i++)place(targetX+u*2.3*i,p.y);
  }
  if(['breath','frenzy'].includes(id))world.spawnTimer=.45;
  if(id!=='gravity')world.shoot(world.maxPull*(['bank','boomerang','shockwave'].includes(id)?1:-1),0);
  const hints={energy:'强化后的这一发更快；可继续拖拽发射',overspeed:'弹性已达4层；这一发能越过原来的速度上限',density:'重量级碰撞更有分量；继续试着撞开敌球',rubber:'碰撞后保留更多速度，可连续弹射',growth:'玩家已经大一圈，伤害也提高了10%',magnet:'击杀后快速牵引敌球，优先前方路线；最多同时牵引两颗',pierce:'撞击后仍沿原方向，试着穿过一排',pulse:'重击会震伤附近敌球并将它们推开',bank:'先撞墙，下一次撞击更有力量',gravity:'附近敌球正向玩家聚拢，可继续拖拽发射',breath:'击杀后刷新会短暂放慢',split:'这一发首杀后会分出两颗辅助球',penetration:'这一发首杀后恢复出手速度',boomerang:'撞墙后0.8秒，球会加速30%',shockwave:'每第2次撞墙会释放冲击波',frenzy:'每波更多球；同一发超过6连击后，每次连击增加15%伤害，单层最多60%'};
  if(hint)hint.textContent=hints[id]||'选择场景，可继续拖拽弹射';
  updateHud();
}

// Safari can withhold activation from a drag. Keep listening for a normal tap
// and for gestures after an interruption; once running this is just a state check.
for(const type of ['pointerup','touchend','click','keydown']){
  document.addEventListener(type,unlockAudio,{capture:true,passive:true});
}

// Programmatic menu focus must not leave a touch/mouse halo on round buttons.
document.addEventListener('pointerdown',event=>{
  document.documentElement.dataset.inputMode='pointer';
  const interactive=event.target?.closest?.('button,a,input,select,textarea,[role="button"]');
  resultBlankPointer=event.isPrimary!==false&&!(event.button>0)&&modal==='over'&&result&&!transfer&&!controlFlight&&!interactive
    ?{id:event.pointerId,x:event.clientX||0,y:event.clientY||0}:null;
},{capture:true});
document.addEventListener('pointermove',event=>{
  if(resultBlankPointer&&event.pointerId===resultBlankPointer.id&&Math.hypot((event.clientX||0)-resultBlankPointer.x,(event.clientY||0)-resultBlankPointer.y)>8)resultBlankPointer=null;
},{capture:true});
document.addEventListener('pointercancel',()=>{resultBlankPointer=null;},{capture:true});
document.addEventListener('keydown',e=>{
  if(!e.metaKey&&!e.ctrlKey&&!e.altKey)document.documentElement.dataset.inputMode='keyboard';
},{capture:true});

document.addEventListener('click',e=>{
  const blankReady=!!resultBlankPointer;resultBlankPointer=null;
  if(skinUnlock){if(skinUnlock.ready)dismissSkinUnlock();return;}
  const button=e.target.closest('[data-action]');
  if(!button){if(blankReady&&modal==='over'&&result&&!transfer&&!controlFlight)restartGame();return;}
  if(transfer||controlFlight)return;
  unlockAudio();tone(680,.035,'sine',.02,1.15);
  const action=button.dataset.action;
  if(action.startsWith('home-')&&e.detail===0&&screen==='home'&&!modal)home.launchTo(action==='home-launch'?'play':action.slice(5));
  if(action==='restart')restartGame();
  if(action==='leave')leaveGame();
  if(action==='home'){if(modal==='pause')openResult();else showHome();}
  if(action==='pause')openPause();
  if(action==='run-upgrades')openRunUpgrades();
  if(action==='resume')resumeGame();
  if(action==='close')closePanel();
  if(action==='settings')openSettings();
  if(action==='help')openHelp();
  if(action==='restore-defaults')restoreDefaultSettings();
  if(action==='sound'){settings.sound=!settings.sound;applyTheme();}
  if(action==='expressions'){settings.expressions=!settings.expressions;applyTheme();}
});

$$('[data-palette]').forEach(button=>button.addEventListener('click',()=>{Object.assign(settings,palettes[button.dataset.palette]);applyTheme();}));
for(const key of ['player','enemy','bg'])$('#'+key+'-color').addEventListener('input',e=>{settings[key]=e.target.value;applyTheme();});
for(const key of ['bgm','sfx']){
  const input=$('#'+key+'-volume');
  input.addEventListener('input',()=>{
    settings[key+'Volume']=Number(input.value)/100;
    syncAudioSettings();storage.write('qiuqiule-settings',settings);unlockAudio();
  });
  if(key==='sfx')input.addEventListener('change',()=>tone(420,.12,'sine',.06,1.1));
}
$('#feedback-strength')?.addEventListener('input',e=>{
  settings.juice=feedbackStrength(Number(e.target.value)/100);syncFeedbackSettings();storage.write('qiuqiule-settings',settings);
});
document.addEventListener('keydown',e=>{
  if(transfer||controlFlight){if(e.key==='Escape')e.preventDefault();return;}
  if(e.key==='Escape'){

    if(modal&&modal!=='over')closePanel();else if(screen==='play'&&world.phase!=='over')setPanel('pause');
  }
  if(e.key==='Tab'&&modal){
    const elements=[...$('#'+modal+'-panel').querySelectorAll('button,input')].filter(element=>!element.hidden&&!element.disabled),first=elements[0],last=elements.at(-1);
    if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}
    else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}
  }
});
function pauseForInterruption(){

  cancelDrag();
  if(world?.isRunChoice&&screen==='play'){paused=true;return;}
  if(scene?.wallFlashes)scene.wallFlashes=scene.wallFlashes.filter(flash=>!flash.bossDefeat);
  if(scene?.ending){scene.ending.suspended=true;scene.ending.resumePending=true;return;}
  if(screen!=='play'||world?.phase==='over')return;
  if(modal){saveCurrentRun();return;}
  if(transfer){paused=true;pauseOnArrival=true;saveCurrentRun();}else openPause();
}
function resumeEnding(){
  if(!document.hidden&&document.hasFocus()&&world?.isRunChoice&&!modal)paused=false;
  if(scene?.ending&&!document.hidden&&document.hasFocus()){scene.ending.suspended=false;scene.ending.resumePending=true;scene.timeScale=reducedMotion||!settings.juice?1:.25;}
}
// Start fading before pagehide when the browser announces a document departure.
// A cancelled navigation keeps the current page and its music position.
window.navigation?.addEventListener('navigate',event=>{
  if(event.destination.sameDocument||event.downloadRequest!=null||event.defaultPrevented)return;
  sound.setHidden(true);
  event.signal.addEventListener('abort',()=>{if(!document.hidden)sound.setHidden(false);},{once:true});
});
document.addEventListener('visibilitychange',()=>{sound.setHidden(document.hidden);if(document.hidden)pauseForInterruption();else resumeEnding();});
window.addEventListener('pagehide',()=>{sound.setHidden(true);pauseForInterruption();});
window.addEventListener('beforeunload',pauseForInterruption);
window.addEventListener('pageshow',()=>{sound.setHidden(document.hidden);resumeEnding();});
window.addEventListener('blur',pauseForInterruption);
window.addEventListener('focus',resumeEnding);
$('#buff-guide').innerHTML=UPGRADE_DEFINITIONS.map(b=>`<article class="buff-explanation"><span aria-hidden="true" data-upgrade-kind="${b.kind}">${upgradeIconMarkup(b,hex(settings.bg))}</span><div><h3>${b.name}<small>${b.short}</small></h3><p>${b.detail}</p></div></article>`).join('');
$$('[data-icon]').forEach(button=>button.innerHTML=iconMarkup(button.dataset.icon));
applyTheme();sound.setMusicScene('home');
sound.setHidden(document.hidden);
if(!document.hidden)sound.tryAutoplay();
layoutHomeControl();
async function bootWithFont(){
  // Canvas and Phaser retain metrics from the first draw. Load the same face
  // used by the DOM before creating the scene so numbers never start in a fallback.
  try{
    await document.fonts?.load?.('400 16px GameSans','球球了0123456789');
    await document.fonts?.ready;
  }catch{
    // Font failures and older WebViews still get a playable game.
  }
  boot();
}
if(document.readyState==='complete')bootWithFont();else window.addEventListener('load',bootWithFont,{once:true});
