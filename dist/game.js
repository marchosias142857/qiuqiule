import {World, clamp, ease, lerp} from './physics.js';
import {CampaignOfferWorld} from './campaign-offer.js';
import {drawCampaignAim} from './campaign-aim.js';
import {CampaignWorld,normalizeProgress,progressPercent,levelConfig,campaignUpgradeChoices,campaignUpgradePool} from './campaign.js';
import {levelRecord,recordAttempt,recordResult,recordCheckpoint,recordOffers,recoverInterruptedAttempts,canSkip,skipLevel} from './campaign-progress.js';
import {drawCampaign,campaignBodyVisual,campaignCaptureVisuals,campaignTextVisuals,campaignBorderGap,drawCampaignBorder,campaignFailureFeedback,drawCampaignBodyDetails} from './campaign-render.js';
import {LevelSelector,trackPath} from './levels.js';
import {displayMetrics, pointerPosition} from './display.js';
import {HomeWorld} from './home.js';
import {drawFunctionalBall,iconMarkup} from './icons.js';
import {smooth,pullBallPoint,faceTarget,pointerFaceTarget,smoothFace,transferPose,resultBounce,strainedEyeOutline,usesStrainedEyes,playerVisualState,relaxedEyeOutline} from './motion.js';
import {GameAudio,audioLevel} from './audio.js';
import {feedbackStrength,hitFeedbackTier,chargeFeedback,ScoreFeedback,impactShards,mergeShards,impactZoom} from './feedback.js';
import {CometTrails} from './comet-trail.js';
import {wallBulgeSpec,wallBulgeHeight,buildBulgedBorder} from './border-bulge.js';
import {AimGesture,aimGuide,aimMinimumScale} from './aim.js';
import {normalizeAimMetrics,recordAimDuration,aimMetricsReport,aimHoldDuration} from './aim-metrics.js';
import {clearingTimeScale,clearingZoom,PressureWarning,PRESSURE_WARNING_COLOR,blendRgb,injuredEnemyScale,pressureLook} from './rhythm-feedback.js';
import {drawEnemyBall,isSpecialEnemy,enemyTransferMarkup,enemyBodyColor,enemyDetailColor} from './enemy-render.js';
import {ENEMY_TYPES} from './enemies.js';
import {UPGRADES,UPGRADE_DEFINITIONS} from './upgrades.js';
import {drawUpgradeBall} from './upgrade-render.js';
import {normalizeEndless,createEndlessRun,recordEndlessRun} from './endless-progress.js';
import {crownOutline,crownVisual,bossFacePose,bossAngryEyeOutline,bossSpiralEye,bossHornOutline} from './boss-visuals.js';
import {skinContour,skinPoint,morphSkinContour,normalizeSkins,unlockSkin,selectSkin,toggleSkins} from './skins.js';
import {projectSkinContour,paintRadiance,createRadianceCanvas,fitCrownToSkin} from './skin-render.js';
import {PhotoRenderer,AuxiliaryPhotoPool} from './photo-renderer.js';
import {initWardrobe,loadAppearance,saveAppearance} from './wardrobe.js';
import {unlockPose,unlockLeavePose,createUnlockPanel} from './skin-unlock.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const defaults = {player:'#252720', enemy:'#e88c72', bg:'#f4f3eb', sound:true, haptic:true, expressions:true, bgmVolume:.55, sfxVolume:.75,juice:.6};
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
for (const key of ['sound','haptic','expressions']) if (typeof saved[key] === 'boolean') settings[key] = saved[key];
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
let result=null,controlFlight=null,menuTransition=null,selector=null,trackPointer=null,levelsReveal=1;
let levelPointer=null;
let campaignOffer=null,pendingCampaignUpgrade=null,campaignAttemptId=null,campaignRecorded=false;
let choicePress=null;
let choiceLabels=[];
let resultBlankPointer=null;
let campaignProgress=recoverInterruptedAttempts(normalizeProgress(storage.read('qiuqiule-campaign',null)));
storage.write('qiuqiule-campaign',campaignProgress);
const savedSkins=storage.read('qiuqiule-skins',null);
let skins=normalizeSkins(savedSkins,campaignProgress.completed);
if(savedSkins&&typeof savedSkins==='object'&&('variant' in savedSkins||'variants' in savedSkins))storage.write('qiuqiule-skins',skins);
let playerContour=skinContour(skins.enabled?skins:0),skinTween=null,skinOverride=null;
let wardrobeUi=null,wardrobeTime=0,skinUnlock=null,appearance=null,appearanceUrl=null;
let photoCanvas=null,photoRenderer=null,auxiliaryPhotos=null,glowCanvas=null,glowContext=null,lastUiPose=null;
let appearanceRevision=0;
let selectedMode=storage.read('qiuqiule-mode','campaign')==='endless'?'endless':'campaign';
let currentLevel=1;
const strainedEyes=[-1,1].map(strainedEyeOutline);
const relaxedEyes=strainedEyes.map(relaxedEyeOutline);
const playerVisuals=new WeakMap();
const crownPoints=crownOutline();
let viewport = displayMetrics(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
let home = new HomeWorld(viewport.width, viewport.height,selectedMode);
let lastScore = -1;
let toastTimer;
let homePlayColor = 0x9b89c5;
let homeSoundColor = 0xe88c72;
let rewardColor=0xc4dc86;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const scoreFeedback=new ScoreFeedback();
let feedbackDemo=false;
let runBest=best;

function isDark(color) {const n=hex(color);return ((n>>16)*.299+((n>>8)&255)*.587+(n&255)*.114)<135;}
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
  const vars = {bg:settings.bg,player:settings.player,enemy:settings.enemy,ink:dark?'#f0f2e8':'#252720',muted:dark?'#a3ada4':'#818479',line:dark?'#454e49':'#dcded3',panel:dark?'#2c3335':'#fbfbf6','on-ink':dark?'#252720':'#fffef8'};
  for (const [key,value] of Object.entries(vars)) document.documentElement.style.setProperty('--'+key,value);
  const accent=getComputedStyle(document.documentElement).getPropertyValue?.('--accent')?.trim();
  if(/^#[0-9a-f]{6}$/i.test(accent||''))rewardColor=hex(accent);
  $('meta[name=theme-color]').content = settings.bg;
  document.documentElement.style.colorScheme=dark?'dark':'light';
  for (const key of ['player','enemy','bg']) {$('#'+key+'-color').value=settings[key];$('#'+key+'-hex').textContent=settings[key].toUpperCase();}
  $$('.palette').forEach(b=>b.classList.toggle('active',['player','enemy','bg'].every(k=>settings[k]===palettes[b.dataset.palette][k])));
  syncAudioSettings();
  $('#haptic-toggle').setAttribute('aria-checked',String(settings.haptic));
  $('#expressions-toggle').setAttribute('aria-checked',String(settings.expressions));
  syncFeedbackSettings();
  storage.write('qiuqiule-settings',settings);
  if (scene) scene.cameras.main.setBackgroundColor(settings.bg);
}

function toast(message) {
  if(screen==='play'&&!modal)return;
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
function unlockAudio(){sound.unlock();}
function tone(...args){sound.tone(...args);}
function vibrate(duration){if(settings.haptic&&navigator.vibrate)navigator.vibrate(duration);}
function clearChoicePress(){const press=choicePress;choicePress=null;if(press?.canvas.hasPointerCapture(press.id))press.canvas.releasePointerCapture(press.id);}
function updateChoicePress(now=scene?.inputClock||0){
  if(!choicePress)return;
  if(paused||modal||screen!=='play'||world?.phase!=='choose'||!world.choices.some(c=>c.id===choicePress.choiceId)){clearChoicePress();return;}
  choicePress.active ||= now-choicePress.startedAt>=.3-1e-9;
}
function cancelDrag(){resultBlankPointer=null;clearChoicePress();sound.stopCharge();drag?.aim?.cancel();drag=null;levelPointer=null;world?.cancelPull();if(scene)scene.timeScale=1;if(trackPointer!==null){trackPointer=null;selector?.cancelTrack();}}
function aimInputTime(event){
  const clock=scene?.inputClock||0,stamp=Number(event?.timeStamp)/1000;
  if(drag?.aim&&Number.isFinite(stamp)&&Number.isFinite(drag.startStamp))return Math.max(clock,drag.aim.startedAt+Math.max(0,stamp-drag.startStamp));
  const sinceFrame=stamp-scene?.frameStamp;
  return clock+(Number.isFinite(sinceFrame)&&sinceFrame>=0&&sinceFrame<.25?sinceFrame:0);
}
function updateAim(now=scene?.inputClock||0){
  if(!drag?.aim){if(scene)scene.timeScale=1;return null;}
  if(paused||modal||screen!=='play'||!world?.continuousControl){cancelDrag();return null;}
  const state=drag.aim.sample(now,{reducedMotion});
  if(state.active&&drag.pending){
    if(!world.beginPull()){cancelDrag();return null;}
    drag.pending=false;
  }
  if(scene)scene.timeScale=state.scale;
  return state;
}
function aimStatistics(){
  return {...aimMetricsReport(aimMetrics),currentRunHoldSeconds:screen==='play'&&world?.mode!=='campaign'?runAimHoldDuration:null};
}
function recordAimGesture(released){
  if(feedbackDemo||world?.mode==='campaign'||!released?.shouldShoot)return;
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
  const crossed=chargeFeedback(drag.feedbackMask,amount);drag.feedbackMask=crossed.mask;
  // One pointer move can cross several levels; play the strongest immediately.
  if(crossed.pulses.length)vibrate(crossed.pulses.at(-1));
  sound.setCharge(amount);
}
function setSkinState(next){
  skins=next;storage.write('qiuqiule-skins',skins);
  skinTween={from:playerContour,to:skinContour(skins.enabled?skins:0),elapsed:0};
  wardrobeUi?.refresh();
}
function activeContour(){return skinOverride||playerContour;}
function usesSkinContour(){return !!(appearance||skins.enabled||skinTween||skinOverride);}
function updateSkin(dt){
  if(!skinTween)return;
  skinTween.elapsed+=dt;
  const t=clamp(skinTween.elapsed/(reducedMotion?.12:.3),0,1);
  playerContour=morphSkinContour(skinTween.from,skinTween.to,smooth(t));
  if(t===1)skinTween=null;
}
function clearPhoto(){
  photoRenderer?.hide();
  auxiliaryPhotos?.hide();
  if(glowCanvas)glowCanvas.hidden=true;
}
function drawPlayerPhoto(contour,pose,ui=false,auxiliarySlot=null,alpha=1){
  if(!appearance||!photoRenderer||wardrobeUi?.isCropping?.())return false;
  if(auxiliarySlot===null)photoCanvas.style.zIndex=ui?'40':'3';
  const clip=ui&&uiAnchor==='wardrobe'&&!transfer
    ?$('#wardrobe-panel .wardrobe-body').getBoundingClientRect():null;
  const camera=!ui&&screen==='play'?scene?.feedbackCamera:null;
  if(camera&&camera.zoom!==1)pose={...pose,x:camera.x+(pose.x-camera.x)*camera.zoom,y:camera.y+(pose.y-camera.y)*camera.zoom,r:pose.r*camera.zoom};
  const options={scale:Math.min(viewport.scale,3),clip,alpha,baseColor:hex(settings.player)};
  if(auxiliarySlot!==null)return auxiliaryPhotos?.draw(auxiliarySlot,contour,pose,options)===true;
  return photoRenderer.draw(contour,pose,options)===true;
}
async function setAppearance(url,persist=false,revision=++appearanceRevision){
  let image=null;
  if(url){image=new Image();image.src=url;await image.decode();}
  if(revision!==appearanceRevision)return;
  if(persist)await saveAppearance(url);
  if(revision!==appearanceRevision)return;
  appearance=image;appearanceUrl=url;photoRenderer?.setImage(image);auxiliaryPhotos?.setImage(image);
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
  glowCanvas=document.createElement('canvas');glowCanvas.id='skin-radiance';glowCanvas.hidden=true;
  glowCanvas.setAttribute('aria-hidden','true');
  Object.assign(glowCanvas.style,{position:'fixed',pointerEvents:'none',zIndex:'35'});
  document.body.append(glowCanvas);glowContext=glowCanvas.getContext('2d');
  wardrobeUi=initWardrobe({getState:()=>({...skins,image:appearanceUrl}),
    onToggle:value=>setSkinState(toggleSkins(skins,value)),
    onSides:value=>setSkinState(selectSkin(skins,value)),
    onImage:url=>setAppearance(url,true),onError:message=>toast(message)});
  storage.write('qiuqiule-skins',skins);
  const revision=appearanceRevision;
  loadAppearance().then(url=>{if(revision===appearanceRevision)return setAppearance(url,false,revision);}).catch(()=>toast('图片暂时无法读取，请重新选取'));
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
  const target=move.target;showPanel(target);uiAnchor=target;paintUiBall(anchorPose(target));
}
function syncInputs(){
  const moving=!!transfer||!!controlFlight;
  $('#modal-layer').inert=moving;
  $('#home').inert=!!modal||moving||screen==='entering';
  $('#hud').inert=!!modal||moving||screen==='entering';
  $('#campaign-preflight').inert=!!modal||moving;
}
function showPanel(name){
  resetMenuTransition();cancelDrag();sound.clearEnd();modal=name;paused=screen==='play';
  if(scene?.wallFlashes)scene.wallFlashes=scene.wallFlashes.filter(flash=>!flash.bossDefeat);
  $('#modal-layer').hidden=false;
  $$('.panel').forEach(p=>{p.hidden=p.id!==name+'-panel';});
  if(['settings','help','menu-transition'].includes(name))fitMenuHeight();
  syncInputs();
  requestAnimationFrame(()=>{if(modal===name&&!transfer)$('#'+name+'-panel').querySelector('button')?.focus({preventScroll:true});});
}
function hidePanel(){resetMenuTransition();wardrobeUi?.cancelInteraction();modal=null;$('#modal-layer').hidden=true;syncInputs();}
function setPanel(name){if(name==='pause')openPause();else showPanel(name);}
function anchorPose(anchor){
  if(anchor==='levels')return {...selector.player};
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
  if(world.mode!=='campaign'||world.isCampaignOffer){
    Object.assign(p,rewardPlayerPose(world.player));
    if(world.phase==='transition')p.roll=world.player.roll??Math.PI*2*world.rewardMoveProgress;
  }
  return p;
}
function selectionPlayerPose(){
  const p={...selector.player},visual=playerVisuals.get(selector.player);
  // activateAt has already changed the model phase. Preserve the contour and
  // eyes from the last painted frame instead of re-reading the stopped rebound.
  if(visual){
    p.squash=visual.renderedSquash??0;
    p.visualSquash=p.squash;
    if(visual.renderedPull)p.visualPull={...visual.renderedPull};
    p.visualEyeMix=visual.eyeMix;
  }
  return p;
}
function resultHasCrown(){return !!result&&(result.campaign?result.golfHoleInOne:result.bossKills>0||result.maxCombo>=6);}
function resultCrownOpacity(){return resultHasCrown()?smooth(((result.crownAge||0)-.08)/.32):0;}
function currentPlayerPose(){return skinUnlock&&lastUiPose?{...lastUiPose}:uiAnchor==='wardrobe'?resultBounce(anchorPose('wardrobe'),wardrobeTime,reducedMotion):uiAnchor==='over'?{...resultBounce(anchorPose('over'),result?.bounceTime||0,reducedMotion),visualCrownAlpha:resultCrownOpacity()}:uiAnchor?anchorPose(uiAnchor):screen==='home'?{...home.player}:screen==='levels'?selectionPlayerPose():arenaPlayerPose();}
function detached(){return !!skinUnlock||!!transfer||!!uiAnchor||['pause','settings','help','wardrobe'].includes(modal);}
function paintUiBall(p){
  lastUiPose={...p};
  const el=$('#ui-ball'),sq=p.squash||0;
  el.hidden=false;el.style.width=el.style.height=p.r*2+'px';
  el.style.clipPath='none';
  if(uiAnchor==='wardrobe'&&!transfer){
    const box=$('#wardrobe-panel .wardrobe-body').getBoundingClientRect();
    el.style.clipPath=`inset(${box.top-p.y+p.r}px ${p.x+p.r-box.right}px ${p.y+p.r-box.bottom}px ${box.left-p.x+p.r}px)`;
  }
  el.style.transform=`translate3d(${p.x-p.r}px,${p.y-p.r}px,0) scale(${1-sq},${1+sq*.7})`;
  const body=el.querySelector('.ui-body'),contour=el.querySelector('.ui-pull-outline');
  const amount=p.visualPull?.amount||0,angle=p.visualPull?.angle||0;
  const skinned=usesSkinContour();
  body.style.display=skinned||amount>0?'none':'';contour.style.display=skinned||amount>0?'':'none';
  if(skinned){
    el.style.transform=`translate3d(${p.x-p.r}px,${p.y-p.r}px,0)`;
    const points=projectSkinContour(activeContour(),{x:50,y:50,r:50,pullAmount:amount,deformAngle:angle,roll:p.roll||0,squash:sq});
    contour.setAttribute('d',points.map((q,i)=>`${i?'L':'M'}${q.x} ${q.y}`).join(' ')+' Z');
  }else if(amount>0){
    const cos=Math.cos(angle),sin=Math.sin(angle),points=[];
    for(let i=0;i<=192;i++){
      const t=i/192*Math.PI*2,q=pullBallPoint(Math.cos(t),Math.sin(t),amount);
      points.push(`${i?'L':'M'}${50+50*(q.x*cos-q.y*sin)} ${50+50*(q.x*sin+q.y*cos)}`);
    }
    contour.setAttribute('d',points.join(' ')+' Z');
  }
  if(appearance){
    // The photo and outline share the same nonlinear pull; the photo is never
    // a rigid image hidden behind a separately stretching mask.
    drawPlayerPhoto(activeContour(),{x:p.x,y:p.y,r:p.r,squash:sq,pullAmount:amount,deformAngle:angle,roll:p.roll||0},true);
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
  eyes.style.display=appearance?'none':'';
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
}
function movePlayer(from,target,duration,done){
  cancelDrag();transfer={from:{...from},target,duration:reducedMotion?Math.min(duration,.25):duration,elapsed:0,done,revealHome:screen==='home'&&homeReveal<1&&target==='home'};
  if(scene?.lastBorder&&(world?.mode==='campaign'||screen==='levels'||screen==='home'&&selectedMode==='campaign'&&scene.lastBorder.campaign)){
    scene.campaignFrameTransfer={from:{...scene.lastBorder,gap:scene.lastBorder.gap?{...scene.lastBorder.gap}:null},elapsed:0,duration:transfer.duration};
  }
  paintUiBall(from);syncInputs();
}
function updateUiBall(dt){
  // Start the crown clock only on frames already settled at the result anchor.
  // The incoming flight's final dt must not consume the fade before first paint.
  if(result&&uiAnchor==='over'&&!transfer&&!skinUnlock)result.crownAge=(result.crownAge||0)+dt;
  if(scene?.campaignArrival){scene.campaignArrival.elapsed+=dt;if(scene.campaignArrival.elapsed>=scene.campaignArrival.duration)scene.campaignArrival=null;}
  if(scene?.campaignFrameTransfer){
    scene.campaignFrameTransfer.elapsed+=dt;
    if(scene.campaignFrameTransfer.elapsed>=scene.campaignFrameTransfer.duration)scene.campaignFrameTransfer=null;
  }
  updateMenuTransition(dt);
  $('#result-shadow').hidden=true;
  if(skinUnlock){updateSkinUnlock(dt);return;}
  if(result){
    result.clock+=dt;
    if(result.campaign&&!result.modernCampaign){
      const t=clamp((result.clock-.18)/.95,0,1),value=Math.round(result.percent*ease(t));
      if(value!==result.displayed){
        $('#final-score').textContent=value+'%';result.displayed=value;
        if(result.clock-result.lastTone>.045){tone(260+value*5,.055,'sine',.022,1.08);result.lastTone=result.clock;}
      }
      const grow=result.completed?smooth(clamp((result.clock-1.13)/.23,0,1)):0;
      $('#final-score').style.transform=`scale(${1+grow*.24})`;
      if(t===1&&result.completed&&!result.celebrated){result.celebrated=true;tone(880,.24,'sine',.05,1.5);vibrate([12,30,18]);}
    }
  }
  if(transfer){
    const move=transfer;move.elapsed+=dt;
    const progress=clamp(move.elapsed/move.duration,0,1),pose=transferPose(move.from,anchorPose(move.target),progress);
    if(move.from.visualCrownAlpha!==undefined)pose.visualCrownAlpha=move.from.visualCrownAlpha*(1-smooth(move.elapsed/.18));
    paintUiBall(pose);$('#ui-ball').dataset.state='moving';
    if(move.revealHome)homeReveal=smooth(progress);
    if(progress===1){
      // Home retains the gaze from the launch that opened a menu. The overlay
      // has eased to its neutral anchor; resume the canvas from that exact gaze.
      if(move.target==='home')Object.assign(home.player,{lookX:pose.lookX,lookY:pose.lookY});
      transfer=null;uiAnchor=['pause','settings','over','wardrobe'].includes(move.target)?move.target:null;
      move.done?.();if(!uiAnchor&&!transfer)releaseOverlay=1;syncInputs();
      if(modal&&!transfer)$('#'+modal+'-panel').querySelector('button')?.focus({preventScroll:true});
    }
  }
  if(!transfer){
    $('#ui-ball').dataset.state=uiAnchor||'hidden';
    if(uiAnchor){
      const pose=anchorPose(uiAnchor),panel=$('#'+uiAnchor+'-panel').getBoundingClientRect();
      if(uiAnchor==='over'&&result||uiAnchor==='wardrobe'){
        if(uiAnchor==='wardrobe')wardrobeTime+=dt;else result.bounceTime+=dt;
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
    const carriesEnemy=item.appear&&world?.mode!=='campaign'&&isSpecialEnemy(item.from);
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
  if(world?.isCampaignOffer){leaveCampaignOffer('home');return;}
  if(!world||result||skinUnlock)return;
  if(world.phase==='campaign-celebrate'){if(modal==='pause')resumeGame();return;}
  scene.resetFeedback?.();
  const fromPause=modal==='pause',from=view?.player||currentPlayerPose();
  const sources=fromPause?['restart','home'].map(id=>{
    const box=$('#pause-panel .'+id+'-ball').getBoundingClientRect();
    return {x:box.x+box.width/2,y:box.y+box.height/2,r:box.width/2};
  }):(view?.enemies||world.enemies).slice(0,2).map(b=>{
    const size=ease(b.born)*injuredEnemyScale(b,world.mode!=='campaign');
    return {...b,r:Math.max(1,b.r*size),renderUnit:world.unit*size};
  });
  const abandoned=world.phase!=='over'&&!world.completed;
  saveCampaignResult(abandoned?'abandon':world.completed?'win':'loss');
  cancelDrag();world.phase='over';world.choices=[];updateChoices();
  const campaign=world.mode==='campaign';
  saveEndlessProgress();
  if(campaign&&world.completed&&!feedbackDemo){
    const unlocked=unlockSkin(skins,world.level);
    skins=unlocked.state;storage.write('qiuqiule-skins',skins);wardrobeUi?.refresh();

    if(unlocked.rewardSides){beginSkinUnlock(from,sources,unlocked.rewardSides);return;}
  }
  presentResult(from,fromPause,sources,campaign?.82:.4,view);
  if(campaign&&feedbackDemo&&campaignDemoEnabled)$('#campaign-demo-panel').hidden=false;
}
function presentResult(from,fromPause,sources,duration=.82,view=null){
  const campaign=world.mode==='campaign';
  $('#over-panel').classList.toggle('campaign',campaign);
  const levelsWrap=$('.result-levels-wrap');levelsWrap.hidden=!campaign;
  $('#final-score').style.transform='scale(1)';
  const modernCampaign=campaign&&world.config?.implemented;
  $('#final-score').textContent=campaign&&!modernCampaign?'0%':pad(world.score);
  const rating=$('#campaign-rating');
  if(rating){rating.hidden=!modernCampaign;rating.innerHTML=Array.from({length:3},(_,i)=>`<i class="rating-dot${i<(world.resultRating||0)?' filled':''}"></i>`).join('');rating.setAttribute('aria-label',`本关评分 ${world.resultRating||0} 点，共三点`);}
  $('#final-score').style.color=!campaign&&!feedbackDemo&&world.score>runBest?'var(--player)':'';
  const combo=Math.max(world.maxCombo||0,world.shotKills||0),stage=Math.max(world.maxStage||0,world.stage||1);
  const peak=$('#result-peak'),records=$('#result-records');
  if(peak){peak.hidden=campaign;peak.innerHTML=campaign?'':`<span>最大连击 <b>${combo}</b></span><span>到达阶段 <b>${stage}</b></span>`;}
  if(records){
    records.hidden=campaign||feedbackDemo;
    records.textContent=campaign||feedbackDemo?'':`历史最佳${best}`;
  }
  const reason=$('#result-reason');
  if(reason){
    reason.textContent=modernCampaign?[world.resultSummary,world.completed?`${world.resultRating}点 · ${world.ratingStatus?.summary||''}`:levelRecord(campaignProgress,world.level).lastOutcome==='abandon'?'本轮结束 · 失败次数保留':campaignFailureFeedback(world.failureReason||world.lastFailureReason||'budget').label].filter(Boolean).join(' · '):'';reason.hidden=!modernCampaign;
  }
  const chapter=$('#campaign-chapter');
  if(chapter){
    chapter.hidden=!modernCampaign;
    if(modernCampaign){
      const start=Math.floor((world.level-1)/10)*10+1;
      chapter.innerHTML=Array.from({length:10},(_,i)=>{
        const number=start+i,record=levelRecord(campaignProgress,number);
        return `<span class="chapter-cell${record.rating?' filled':''}${number===world.level?' current':''}" title="${number}关 · ${record.rating||0}点" aria-label="${number}关，${record.rating||0}点">${number}</span>`;
      }).join('');
      chapter.setAttribute('aria-label',`第 ${Math.floor((world.level-1)/10)+1} 章评分回顾`);
    }else chapter.innerHTML='';
  }
  result={clock:0,bounceTime:0,crownAge:0,campaign,modernCampaign,golfHoleInOne:!!world.golfHoleInOne&&!!world.completed,maxCombo:combo,maxStage:stage,bossKills:Math.max(0,world.bossKills||0),sceneBodies:view,percent:campaign?world.percent:0,completed:!!world.completed,displayed:0,lastTone:0,sourceIds:fromPause?[]:sources.map(b=>b.id)};
  $('#hud').hidden=true;
  showPanel('over');$('.result-actions').classList.add('arriving');
  movePlayer(from,'over',duration);
  flyControls(['restart','home'].map((id,i)=>({
    from:sources[i]||from,to:()=>controlPose(id),icon:id,
    fromColor:fromPause?(i?'#91b8c7':'#e88c72'):settings.enemy,
    toColor:i?'#91b8c7':'#e88c72',appear:!fromPause,persist:fromPause
  })),duration,()=>$('.result-actions').classList.remove('arriving'),
    campaign?opacity=>{levelsWrap.style.opacity=opacity;}:null);
}

function unlockAnchor(){
  const panel=$('#skin-unlock-panel'),previous=panel.style.transform;
  panel.style.transform='translate(-50%,-50%)';
  const pose=anchorPose('skin-unlock');panel.style.transform=previous;return pose;
}
function beginSkinUnlock(from,sources,sides){
  cancelDrag();transfer=null;uiAnchor=null;paused=true;
  skinUnlock={elapsed:0,phase:'enter',from:{...from},sources,sides,original:playerContour,ready:false};
  $('#hud').hidden=true;showPanel('skin-unlock');
  $('#skin-unlock-continue').disabled=true;
  updateSkinUnlock(0);
}
function dismissSkinUnlock(){
  if(!skinUnlock?.ready||skinUnlock.phase==='leave')return;
  const reward=skinUnlock;reward.phase='leave';reward.elapsed=0;reward.from={...lastUiPose};reward.ready=false;
  presentResult(reward.from,false,reward.sources,reducedMotion?.28:.62);
  transfer=null;uiAnchor=null;$('#skin-unlock-panel').hidden=false;
  $('#skin-unlock-continue').disabled=true;syncInputs();
}
function updateSkinUnlock(dt){
  const reward=skinUnlock;reward.elapsed+=dt;
  const leaving=reward.phase==='leave';
  const frame=(leaving?unlockLeavePose:unlockPose)({elapsed:reward.elapsed,from:reward.from,
    to:leaving?anchorPose('over'):unlockAnchor(),reducedMotion});
  skinOverride=morphSkinContour(reward.original,reward.sides,frame.morph);
  const panel=$('#skin-unlock-panel');
  panel.style.opacity=frame.panelAlpha;
  panel.style.transform=`translate(-50%,-50%) scale(${frame.panelScale})`;
  $('#skin-unlock-title').style.opacity=frame.titleAlpha;
  paintUiBall(frame.pose);
  if(glowContext&&frame.glowAlpha>0){
    const r=frame.pose.r,size=Math.ceil(r*7),scale=Math.min(viewport.scale,3);
    glowCanvas.hidden=false;glowCanvas.width=Math.ceil(size*scale);glowCanvas.height=Math.ceil(size*scale);
    Object.assign(glowCanvas.style,{width:size+'px',height:size+'px',left:(frame.pose.x-size/2)+'px',top:(frame.pose.y-size/2)+'px'});
    glowContext.setTransform(scale,0,0,scale,0,0);
    paintRadiance(glowContext,{x:size/2,y:size/2,r,time:scene?.clock||0,alpha:frame.glowAlpha,reducedMotion});
  }
  if(!leaving&&frame.ready&&!reward.ready){
    reward.ready=true;$('#skin-unlock-continue').disabled=false;
    $('#skin-unlock-continue').focus({preventScroll:true});tone(880,.3,'sine',.055,1.5);
  }
  if(leaving){
    updateControlFlight(dt);
    if(frame.done){
      skinUnlock=null;skinOverride=null;uiAnchor='over';panel.hidden=true;
      if(glowCanvas)glowCanvas.hidden=true;paintUiBall(anchorPose('over'));syncInputs();
    }
  }
}

function openPause(){
  if(transfer||modal||screen!=='play'||!world||world.phase==='over')return;
  checkpointCampaign();const from=arenaPlayerPose();paused=true;showPanel('pause');movePlayer(from,'pause',.42);
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
  const from=currentPlayerPose();home.phase='external';wardrobeTime=0;
  wardrobeUi?.refresh();showPanel('wardrobe');movePlayer(from,'wardrobe',.5);
}
function openHelp(){if(transfer||menuTransition)return;transitionMenu('help');}
function finishArenaArrival(){
  paused=false;
  if(pauseOnArrival||document.hidden){pauseOnArrival=false;openPause();}
}
function resumeGame(){
  if(transfer||modal!=='pause')return;
  const from=anchorPose('pause');hidePanel();paused=true;
  movePlayer(from,'arena',.42,finishArenaArrival);
}
function closePanel(){
  if(transfer)return;
  if(skinUnlock){dismissSkinUnlock();return;}
  if(modal==='wardrobe'){
    const from=currentPlayerPose();from.visualSquash=from.squash||0;
    wardrobeUi?.cancelInteraction();hidePanel();home.reset();movePlayer(from,'home',.5);return;
  }
  if(modal==='menu-transition'){menuTransition=null;showPanel('settings');uiAnchor='settings';paintUiBall(anchorPose('settings'));return;}
  if(modal==='help'){transitionMenu('settings');return;}
  if(modal==='pause'){resumeGame();return;}
  if(modal==='settings'){
    const from=anchorPose('settings');
    if(settingsOrigin==='pause'){showPanel('pause');movePlayer(from,'pause',.5);}
    else{hidePanel();home.reset();movePlayer(from,'home',.5);}
  }
}
function clearEffects(){for(const e of scene.effects)e.label?.destroy();scene.effects=[];scene.resetFeedback?.();}
function prepareGame({demo=false}={}){
  // A new run clears gameplay feedback, input and clocks. The scene-owned red
  // warning independently finishes its breath out over the arriving screen.
  closeCampaignOffer(false);cancelDrag();feedbackDemo=demo;campaignRecorded=false;campaignAttemptId=null;runBest=best;runNewRecord=false;recordPulse=recordCue=0;recordedStatsKey='';result=null;transfer=null;controlFlight=null;uiAnchor=null;
  skinUnlock=null;skinOverride=null;clearPhoto();
  releaseOverlay=0;pauseOnArrival=false;
  $('#control-transfers').replaceChildren();$('#ui-ball').hidden=true;$('#result-shadow').hidden=true;
  $('.result-actions').classList.remove('arriving');
  scene.g.clear();clearEffects();scene.accumulator=0;scene.timeSlices=[];scene.clock=0;scene.hitSoundAt=0;
  runDay=selectedMode==='endless'?createEndlessRun():null;
  // Calibration is applied between runs, never halfway through aiming or a Boss.
  runAimHoldDuration=demo?1.2:aimHoldDuration(aimMetrics);
  const starting=selectedMode==='endless'&&!demo?1:0;
  world=selectedMode==='campaign'?new CampaignWorld(viewport.width,viewport.height,currentLevel,Math.random,{upgradeId:pendingCampaignUpgrade,tutorialSeen:!!campaignProgress.tutorials?.[levelConfig(currentLevel).classId]}):new World(viewport.width,viewport.height,runDay.random,{spawnInitial:starting===0});screen='play';
  if(world.mode==='campaign'&&!demo){
    campaignProgress=recordAttempt(campaignProgress,currentLevel,{upgradeId:pendingCampaignUpgrade,tutorialKey:world.config?.implemented?world.config.classId:null,offerChoices:levelRecord(campaignProgress,currentLevel).offerChoices});
    campaignAttemptId=levelRecord(campaignProgress,currentLevel).activeAttempt;
    storage.write('qiuqiule-campaign',campaignProgress);
  }
  pendingCampaignUpgrade=null;
  if(starting)world.beginStartingUpgrades();
  world.setFeedbackOptions({strength:settings.juice,reducedMotion});scoreFeedback.reset(0);
  clearTimeout(toastTimer);$('#toast').classList.remove('show');
  lastScore=-1;
  trackPointer=null;$('#levels-view').setAttribute('hidden','');$('#level-skip').hidden=true;
  $('#hud').classList.toggle('campaign',selectedMode==='campaign');
  $('#hud').classList.toggle('campaign-modern',!!world.config?.implemented);
  $('#home').hidden=true;$('#home').style.opacity=1;$('#hud').hidden=false;$('#hud').style.opacity=1;
  $('.pause-button').disabled=false;updateHud();
}
function checkpointCampaign(){
  if(!world||world.mode!=='campaign'||world.isCampaignOffer||feedbackDemo||campaignRecorded||!campaignAttemptId)return;
  campaignProgress=recordCheckpoint(campaignProgress,world.level,{elapsed:world.elapsed||world.time,progress:world.percent/100,summary:world.resultSummary||`${world.percent}%`,attemptId:campaignAttemptId});
  storage.write('qiuqiule-campaign',campaignProgress);
}
function saveCampaignResult(outcome){
  if(!world||world.mode!=='campaign'||world.isCampaignOffer||feedbackDemo||campaignRecorded)return;
  campaignRecorded=true;
  campaignProgress=recordResult(campaignProgress,world.level,{outcome,rating:world.resultRating||0,score:world.score,
    elapsed:world.elapsed||world.time,progress:world.percent/100,summary:world.resultSummary||`${world.percent}%`,legacy:!world.config?.implemented,attemptId:campaignAttemptId,tutorialKey:world.config?.classId});
  storage.write('qiuqiule-campaign',campaignProgress);
}
function saveEndlessProgress(){
  if(!world||world.mode==='campaign'||feedbackDemo)return;
  const stage=Math.max(world.stage||1,world.maxStage||1),combo=Math.max(world.maxCombo||0,world.shotKills||0);
  const key=[world.score,stage,combo,runDay?.key].join(':');if(key===recordedStatsKey)return;recordedStatsKey=key;
  endlessProgress=recordEndlessRun(endlessProgress,{score:world.score,stage,maxCombo:combo,dateKey:runDay?.key});
  best=endlessProgress.best;storage.write('qiuqiule-best',best);storage.write('qiuqiule-endless',endlessProgress);
}
function syncMode(){
  selectedMode=home.mode;storage.write('qiuqiule-mode',selectedMode);
  $('#home-mode').setAttribute('aria-label',selectedMode==='campaign'?'当前闯关模式，撞击切换为无尽模式':'当前无尽模式，撞击切换为闯关模式');
  $('#home-play').setAttribute('aria-label',selectedMode==='campaign'?'撞击开始球进入选关':'撞击开始球进入无尽模式');
}
function openLevels(from=currentPlayerPose()){
  if(transfer||controlFlight)return;
  saveCampaignResult(world?.completed?'win':'abandon');closeCampaignOffer(false);feedbackDemo=false;
  hidePanel();selectedMode='campaign';screen='levels';world=null;result=null;drag=null;trackPointer=null;levelPointer=null;paused=false;
  selector=new LevelSelector(viewport.width,viewport.height,campaignProgress.unlocked);
  $('#home').hidden=true;$('#hud').hidden=true;clearChoiceLabels();
  $('#levels-view').removeAttribute('hidden');levelsReveal=0;clearEffects();
  rebuildLevels();movePlayer(from,'levels',.65);
  $('#campaign-note').hidden=false;
  $('#level-announcement').textContent=`已解锁 ${campaignProgress.unlocked} 关。点击关卡小球进入，点击下方返回球回到主页，沿圆环滑动浏览。`;
}
function enterLevel(level){
  if(level>campaignProgress.unlocked||transfer||controlFlight||campaignOffer)return;
  currentLevel=level;selectedMode='campaign';
  if(levelConfig(level).implemented){offerCampaign(level);return;}
  launchCampaignLevel(null);
}
function campaignUpgradeIcon(id){
  if(id==='steady')return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19L19 5" fill="none" stroke="#fff9ec" stroke-width="1.5" stroke-dasharray="1 4" stroke-linecap="round"/><circle cx="5" cy="19" r="3" fill="#fff9ec"/><circle cx="19" cy="5" r="3" fill="none" stroke="#fff9ec" stroke-width="1.5"/></svg>';
  if(id==='density')return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="#fff9ec"/><circle cx="12" cy="12" r="9.5" fill="none" stroke="#fff9ec" stroke-width="1.5"/></svg>';
  if(id==='gravity')return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="#fff9ec"/><g fill="none" stroke="#fff9ec" stroke-width="1.2"><path d="M3 12h4m10 0h4M12 3v4m0 10v4"/><circle cx="12" cy="12" r="9" stroke-dasharray="1 4"/></g></svg>';
  if(id==='growth')return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="#fff9ec"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
  if(id==='split')return '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="#fff9ec"><circle cx="8" cy="12" r="4.5"/><circle cx="17" cy="7" r="2.7"/><circle cx="17" cy="17" r="2.7"/></g></svg>';
  if(id==='breath')return '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="#fff9ec" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></g></svg>';
  if(id==='pulse')return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.5" fill="#fff9ec"/><g fill="none" stroke="#fff9ec" stroke-width="1.2"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="9"/></g></svg>';
  return iconMarkup(id==='energy'?'play':id==='bank'?'restart':id==='pierce'?'flag':'infinity');
}
function campaignPreflightRating(config){
  if(config.classId==='merge')return `三点 ≤ ${config.threePointTime} 秒 · 两点 ≤ ${config.twoPointTime} 秒`;
  if(config.classId==='peggle')return `通关余 ${config.threePointRemaining??3} 发得三点 · 余 ${config.twoPointRemaining??1} 发得两点`;
  const metric=config.classId==='pool'?'发数＋自己落袋次数':config.classId==='golf'?'杆数':'发数';
  return `${metric}：三点 ≤ ${config.threePointShots??config.par-1} · 两点 ≤ ${config.twoPointShots??config.par}`;
}
function offerCampaign(level,from=currentPlayerPose()){
  if(level>campaignProgress.unlocked)return;
  currentLevel=level;const config=levelConfig(level);
  const pool=campaignUpgradePool(level),offered=levelRecord(campaignProgress,level).offerChoices||[];
  const retained=offered.map(id=>pool.find(choice=>choice.id===id)).filter(Boolean);
  const choices=retained.length===2?retained:campaignUpgradeChoices(level);
  campaignProgress=recordOffers(campaignProgress,level,choices.map(choice=>choice.id));
  storage.write('qiuqiule-campaign',campaignProgress);
  campaignOffer={level,choices};
  if(selector)selector.phase='external';cancelDrag();hidePanel();
  world=new CampaignOfferWorld(viewport.width,viewport.height,config,choices);
  world.setFeedbackOptions({strength:settings.juice,reducedMotion});
  screen='play';paused=true;result=null;campaignAttemptId=null;campaignRecorded=false;feedbackDemo=false;
  uiAnchor=null;releaseOverlay=0;pauseOnArrival=false;
  clearEffects();clearChoiceLabels();scene.accumulator=0;scene.timeSlices=[];scene.timeScale=1;
  $('#levels-view').setAttribute('hidden','');$('#level-skip').hidden=true;
  $('#home').hidden=true;$('#hud').hidden=false;$('#hud').style.opacity=1;
  $('#hud').classList.add('campaign','campaign-offer');$('#hud').classList.remove('campaign-modern');
  $('.pause-button').disabled=false;
  $('#campaign-preflight').hidden=false;$('#campaign-note').hidden=true;
  $('#campaign-level-title').textContent=`${level} · ${config.name}`;
  $('#campaign-layout-name').textContent=config.layoutName||'';
  $('#campaign-layout-lesson').textContent=config.lesson||config.layoutLesson||config.layoutDescription||'';
  const goal=config.r===1?'清空砖墙':config.r===0?'清空实心目标钉':config.r===4?'清空目标球':config.r===2?`${config.rounds} 轮 · 击倒 ${config.requiredPins} 瓶`:config.r===6?`击破 ${config.jackpotGoal} 个大奖`:`标准杆 ${config.par}`;
  $('#campaign-level-goal').textContent=config.r===5?`合成 ${config.goal} 个最大球 · 覆盖率低于 42%`:config.r===9?`消除 ${config.goal} 颗或坚持 60 秒`:config.r===3?`击碎 ${config.goal} 块砖 · ${config.budget} 回合`:config.r===7?`坚持 60 秒 · 可漏 ${config.budget} 颗`:`${goal} · ${config.budget} ${config.r===6?'球':'发'}`;
  const ratingGuide=$('#campaign-level-rating');if(ratingGuide)ratingGuide.textContent=campaignPreflightRating(config);
  // Accessible keyboard controls launch the actual ball; pointer taps on text
  // never select a buff. Visible labels are attached to the physical rewards.
  $('#campaign-upgrades').innerHTML=campaignOffer.choices.map(c=>`<button data-action="campaign-upgrade" data-upgrade="${c.id}" class="campaign-upgrade" aria-label="发射小球撞击${c.name}，${c.short}，仅本关有效"><span>${c.name}</span><small>${c.short}</small></button>`).join('');
  const skip=$('#campaign-skip');skip.hidden=!canSkip(campaignProgress,level);
  updateHud();movePlayer(from,'arena',.65,finishArenaArrival);
}
function closeCampaignOffer(reset=true){
  campaignOffer=null;$('#campaign-preflight').hidden=true;$('#campaign-preflight').style.opacity='';$('#hud').classList.remove('campaign-offer');
  if(reset&&selector)selector.phase='idle';
  if(screen==='levels')$('#campaign-note').hidden=false;
}
function leaveCampaignOffer(target='levels'){
  if(!campaignOffer||!world?.isCampaignOffer||transfer||controlFlight)return;
  const from=currentPlayerPose();hidePanel();paused=false;uiAnchor=null;
  // A menu exit first rejoins the still-frozen offer body, then lets the
  // reward labels and icons breathe out together on the selection clock.
  const finish=()=>{world.leave(target);finishArenaArrival();};
  if(Math.hypot(from.x-world.player.x,from.y-world.player.y)>1){paused=true;movePlayer(from,'arena',.3,finish);}
  else finish();
}
function finishCampaignOfferAction(){
  const action=campaignOffer?.action;if(!action)return false;
  const from=currentPlayerPose(),level=currentLevel;
  if(action.type==='choose')launchCampaignLevel(action.upgradeId);
  else if(action.target==='home'){closeCampaignOffer(false);showHome();}
  else if(action.target==='restart'){closeCampaignOffer(false);offerCampaign(level,from);}
  else openLevels(from);
  return true;
}
function launchCampaignLevel(upgradeId){
  if(currentLevel>campaignProgress.unlocked)return;
  const from=world?.isCampaignOffer?currentPlayerPose():selectionPlayerPose();pendingCampaignUpgrade=upgradeId;closeCampaignOffer(false);
  prepareGame();paused=true;$('#campaign-note').hidden=true;
  movePlayer(from,'arena',.65,finishArenaArrival);
  scene.campaignArrival={world,elapsed:0,duration:transfer.duration};tone(420,.24,'sine',.055,1.7);
}
function rebuildLevels(){
  const svg=$('#levels-view');svg.setAttribute('viewBox',`0 0 ${viewport.width} ${viewport.height}`);
  svg.innerHTML=`<defs><clipPath id="level-track-clip"><path d="${trackPath(selector.layout)}"/></clipPath></defs><path d="${trackPath(selector.layout)}" fill="none" stroke="var(--ink)" stroke-opacity=".26" stroke-width="1.3"/><g id="level-orbs" clip-path="url(#level-track-clip)"></g><g id="level-return"></g>`;
}
const numberCenters=new Map();
let numberMeasureContext=null;
function levelNumberMarkup(level){
  // Center the visible glyph ink, not the font's asymmetric ascent/descent box.
  const size=level===100?.83:.94;
  if(!numberMeasureContext)numberMeasureContext=document.createElement?.('canvas')?.getContext?.('2d');
  if(!numberCenters.has(level)&&numberMeasureContext){
    numberMeasureContext.font='400 1000px GameSans, sans-serif';
    numberMeasureContext.textAlign='left';numberMeasureContext.textBaseline='alphabetic';
    const m=numberMeasureContext.measureText(String(level));
    numberCenters.set(level,{x:(m.actualBoundingBoxLeft-m.actualBoundingBoxRight)/2000,y:(m.actualBoundingBoxAscent-m.actualBoundingBoxDescent)/2000});
  }
  const center=numberCenters.get(level)||{x:-String(level).length*.25,y:.34};
  return `<text x="${center.x*size}" y="${center.y*size}" font-size="${size}">${level}</text>`;
}
document.fonts?.ready?.then(()=>numberCenters.clear());
function renderLevels(){
  const sphere=(b,content,color)=>`<g transform="translate(${b.x} ${b.y}) scale(${b.r*(b.sx||1)} ${b.r*(b.sy||1)})"><circle r="1" fill="${color}"/>${content}</g>`;
  const icon=type=>iconMarkup(type).replace('<svg ','<svg x="-1" y="-1" width="2" height="2" ');
  $('#level-orbs').innerHTML=selector.visibleBalls.map(b=>{
    const c=levelConfig(b.level),record=levelRecord(campaignProgress,b.level);
    const dots=record.rating?Array.from({length:3},(_,i)=>`<circle cx="${(i-1)*.19}" cy=".64" r=".045" fill="currentColor" opacity="${i<record.rating?1:.25}"/>`).join(''):'';
    const marker=record.rating===3?'<circle r=".91" fill="none" stroke="currentColor" stroke-width=".018"/>':'';
    const hard=c.implemented&&c.k>=6?'<circle r=".85" fill="none" stroke="currentColor" stroke-opacity=".45" stroke-width=".035"/>':'';
    const legacy=!c.implemented&&b.unlocked?'<text y=".65" style="text-anchor:middle" font-size=".19">旧版</text>':'';
    const skipped=record.skipped&&!record.cleared?'<path d="M-.13 .65h.26m-.09-.08 .09 .08-.09 .08" stroke="currentColor" stroke-width=".03" fill="none"/>':'';
    return sphere(b,b.unlocked?levelNumberMarkup(b.level)+dots+marker+hard+legacy+skipped:icon('lock'),b.unlocked?'#9b89c5':'#b6bdb0');
  }).join('');
  $('#level-return').innerHTML=sphere(selector.layout.returnBall,icon('home'),'#91b8c7');
  const skipButton=$('#level-skip'),skipLevelNumber=canSkip(campaignProgress,currentLevel)?currentLevel:campaignProgress.unlocked;
  const skipBall=selector.visibleBalls.find(b=>b.level===skipLevelNumber&&b.fullyVisible);
  skipButton.hidden=!!campaignOffer||!skipBall||!canSkip(campaignProgress,skipLevelNumber);
  if(!skipButton.hidden){skipButton.dataset.level=String(skipLevelNumber);Object.assign(skipButton.style,{left:(skipBall.x+skipBall.r*.5)+'px',top:(skipBall.y+skipBall.r*.55)+'px'});}

  $('#levels-view').style.opacity=smooth(levelsReveal)*(campaignOffer?.18:1);
}
function startGame(){
  hidePanel();prepareGame();paused=false;syncInputs();tone(280,.12,'sine',.04,1.5);
}
function restartGame(){
  if(transfer||controlFlight||!scene)return;
  if(world?.isCampaignOffer){leaveCampaignOffer('restart');return;}
  if(world?.phase==='campaign-celebrate'){if(modal==='pause')resumeGame();return;}
  if(feedbackDemo&&world?.config?.implemented){startCampaignDemo(world.level,world.upgradeId);return;}
  const from=currentPlayerPose(),duration=world?.mode==='campaign'?.65:.4;
  if(world?.mode==='campaign'&&world.config?.implemented){
    saveCampaignResult(world.completed?'win':world.phase==='over'?'loss':'abandon');
    const level=currentLevel;openLevels(from);
    if(transfer)transfer.done=()=>offerCampaign(level);else offerCampaign(level);
    return;
  }
  saveCampaignResult(world?.completed?'win':'abandon');
  hidePanel();prepareGame();paused=true;
  movePlayer(from,'arena',duration,finishArenaArrival);
}
function showHome(){
  if(transfer||controlFlight)return;
  if(campaignOffer&&world?.isCampaignOffer){leaveCampaignOffer('home');return;}
  saveCampaignResult(world?.completed?'win':'abandon');closeCampaignOffer(false);$('#campaign-note').hidden=true;$('#level-skip').hidden=true;
  const from=currentPlayerPose();hidePanel();screen='home';cancelDrag();world=null;paused=false;result=null;feedbackDemo=false;
  $('#control-transfers').replaceChildren();$('#result-shadow').hidden=true;
  home=new HomeWorld(viewport.width,viewport.height,selectedMode);homeReveal=0;
  if(campaignDemoEnabled)$('#campaign-demo-panel').hidden=false;
  $('#levels-view').setAttribute('hidden','');trackPointer=null;
  $('#home').hidden=false;$('#home').style.opacity=0;$('#hud').hidden=true;$('#hud').style.opacity=1;
  layoutHomeControl();clearEffects();
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
  if(world.isCampaignOffer&&['reward','offer-exit'].includes(world.phase))return (c.departureBob||0)*(1-smooth(world.phaseTime/.22));
  // Start at rest and use the choice clock so pausing also freezes the float.
  return world.phase==='choose'&&!reducedMotion?Math.sin(world.phaseTime*2+c.x)*2*smooth(world.phaseTime/.4):0;
}
function updateChoices(){
  const active=world.phase==='transition'||world.phase==='choose'||world.isCampaignOffer&&world.choices.length>0,container=$('#choice-labels');
  if(!active){if(choiceLabels.length||container.children.length)clearChoiceLabels();return;}
  // Keep the same text nodes across transition -> choose. Replacing them here
  // used to skip the CSS fade and jump straight from 40% to full opacity.
  if(choiceLabels.length!==world.choices.length||choiceLabels.some((label,i)=>label.choice!==world.choices[i])){
    choiceLabels=world.choices.map(choice=>{
      const node=document.createElement('div'),title=document.createElement('h3');
      node.className='choice-label';title.textContent=choice.name;node.append(title);
      if(world.isCampaignOffer){const description=document.createElement('small');description.textContent=choice.short;node.append(description);}
      return {choice,node,title};
    });
    container.replaceChildren(...choiceLabels.map(label=>label.node));
  }
  for(const {choice:c,node,title} of choiceLabels){
    const width=c.labelWidth||Math.max(76,Math.min(160,c.r*3));
    const font=Math.max(9,Math.min(17,Math.floor(width/Math.max(1,c.name.length)*.9)));
    Object.assign(node.style,{left:c.x+'px',top:(c.y+choiceBob(c)+c.r*(1+.14*(c.rings||0))+14)+'px',
      width:world.mode!=='campaign'||world.isCampaignOffer?width+'px':'',opacity:String(ease(c.born??1))});
    Object.assign(title.style,{fontSize:world.mode!=='campaign'||world.isCampaignOffer?font+'px':'',whiteSpace:world.mode!=='campaign'||world.isCampaignOffer?'nowrap':''});
  }
}
function campaignHudRating(world){
  const config=world.config,used=world.shotsUsed||0;
  let summary='',threshold='';
  if(config.classId==='pool'){
    const scratches=world.poolScratches||0;
    summary=`评分${used+scratches} · 自己落袋${scratches}次`;threshold=`三点≤${config.threePointShots}`;
  }else if(config.classId==='merge'){
    summary=`${Math.ceil(world.mergeElapsed||0)}秒`;threshold=`三点≤${config.threePointTime}秒`;
  }else if(config.classId==='golf'){
    summary=`已用${used}杆`;threshold=`三点≤${config.threePointShots}杆`;
  }else if(config.classId==='peggle'){
    summary=`连弹${world.maxCombo||0}`;threshold=`三点余≥${config.threePointRemaining??3}发`;
  }else{
    summary=`已发${used}发`;threshold=`三点≤${config.threePointShots}发`;
  }
  return `${summary} · ${world.tutorialVisible?`建议拉距 ${Math.round(world.tutorialPullRatio*100)}%`:threshold}`;
}
function updateHud(dt=0){
  if(world?.isCampaignOffer){$('#campaign-preflight').style.opacity=String(world.presentationAlpha);updateChoices();return;}
  if(!world)return;
  if(world.mode!=='campaign'){
    if(!feedbackDemo&&!runNewRecord&&world.score>runBest){runNewRecord=true;recordPulse=.2;recordCue=.1;tone(660,.09,'sine',.04,1.1);}
    const previousCue=recordCue;recordCue=Math.max(0,recordCue-dt);if(previousCue>0&&recordCue===0)tone(880,.12,'sine',.04,1.1);
    recordPulse=Math.max(0,recordPulse-dt);
    const animate=!reducedMotion&&settings.juice>0;
    // Consume this frame's kill cue even if an earlier HUD sync already showed
    // the same score; it must not leak into a later clear or Boss award.
    scoreFeedback.set(world.score,lastScore>=0&&animate);lastScore=world.score;
    const display=scoreFeedback.step(dt,animate);
    const recordScale=recordPulse>0&&animate?1+.3*Math.sin((1-recordPulse/.2)*Math.PI):1;
    $('#score').textContent=pad(display.value);$('#score').style.transform=`scale(${Math.max(display.scale,recordScale)})`;
    $('#score').style.color=runNewRecord?'var(--player)':'';saveEndlessProgress();
  }
  if(world.mode==='campaign'&&world.config?.implemented){
    $('#hud').style.opacity=scene?.campaignArrival?.world===world?smooth(scene.campaignArrival.elapsed/scene.campaignArrival.duration):1;
    $('#score').textContent=pad(world.score);$('#score').style.transform='scale(1)';$('#score').style.color='';
  }
  const goal=$('#campaign-goal');
  const budgetRemaining=world.celebration?.kind==='peggle'&&world.celebration.elapsed>=world.celebration.duration?world.celebration.bonusRemaining:world.remaining;
  if(goal){
    goal.hidden=!world.config?.implemented;
    const label=world.config?.r===8?`标准杆 ${world.config.par} · ${world.shotsUsed} 杆`:world.config?.r===2?`第 ${world.bowlingRound}/${world.config.rounds} 轮 · 瓶 ${world.bowlingPinsDown}/${world.config.requiredPins}`:world.config?.r===6?`大奖 ${world.pinballJackpots}/${world.config.jackpotGoal}`:`${world.config?.r===1?'砖':world.config?.r===4?'球':'钉'} ${world.targetsRemaining??world.rules?.progress?.()?.remaining??0}`;
    goal.textContent=world.config?.r===5?`合成 ${world.mergeState?.produced??0}/${world.config.goal} · 覆盖 ${Math.floor((world.mergeState?.coverage??0)*100)}%/42%`:world.config?.r===9?`消除 ${world.chainState?.cleared??0}/${world.config.goal} · 余 ${Math.ceil(world.chainState?.remainingTime??60)} 秒`:world.config?.r===3?`砖 ${world.bricksBroken}/${world.config.goal} · 球 ${world.bricksBallCount}/${world.config.ballCap} · 余 ${budgetRemaining}/${world.budget} 回合`:world.config?.r===7?`余 ${Math.ceil(world.glassState?.remainingTime??60)} 秒 · 漏 ${world.glassState?.misses??0}/${world.budget} 颗`:world.config?.implemented?`${label} · 余 ${budgetRemaining}/${world.budget} ${world.config?.r===6?'球':'发'}`:'';
  }
  const progress=$('#stage-progress');
  if(progress){
    if(world.mode!=='campaign')progress.removeAttribute('title');
    const visible=world.mode!=='campaign'&&['battle','clearing'].includes(world.phase)&&Number.isFinite(world.killTarget);
    const campaign=world.mode==='campaign'&&world.config?.implemented;
    progress.hidden=!visible&&!campaign;
    if(campaign){
      const rating=world.ratingStatus||{rating:0,summary:'',three:'',two:''};
      progress.innerHTML=Array.from({length:3},(_,i)=>`<i class="stage-dot${i<rating.rating?' filled':''}" aria-hidden="true"></i>`).join('');
      progress.setAttribute('aria-label',`通关可得 ${rating.rating} 点，共三点。${rating.summary}；${rating.three}；${rating.two}`);
      progress.setAttribute('title',`${rating.three}；${rating.two}；完成目标才计评分`);
    }
    if(visible){
      const ratio=clamp((world.stageKills||0)/world.killTarget,0,1),lit=Math.floor(ratio*10+1e-9);
      progress.innerHTML=Array.from({length:10},(_,i)=>`<i class="stage-dot${i<lit?' filled':''}" aria-hidden="true"></i>`).join('');
      progress.setAttribute('aria-label',`本阶段击杀 ${world.stageKills||0}，目标 ${world.killTarget}`);
    }
  }
  const ratingStatus=$('#campaign-rating-status');
  if(ratingStatus){
    const campaign=world.mode==='campaign'&&world.config?.implemented;
    ratingStatus.hidden=!campaign;
    if(campaign){
      const status=world.ratingStatus||{};
      ratingStatus.textContent=campaignHudRating(world);
      ratingStatus.setAttribute('title',`${status.summary||''}；${status.three||''}；${status.two||''}；完成目标才计评分`);
    }
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
  const color=hex(settings.player);
  if(screen==='play'&&world.mode==='campaign'&&world.config?.implemented&&!world.isCampaignOffer){
    drawCampaignAim(g,world,drag,{player:p,color});
  }else if(screen==='play'&&world.continuousControl){
    const guide=aimGuide({player:p,drag,maxPull:world.maxPull});
    for(const point of guide.points){g.fillStyle(color,point.alpha);g.fillCircle(point.x,point.y,point.r);}
    if(guide.arrow){const a=guide.arrow;g.lineStyle(a.width,color,a.alpha);g.beginPath();g.moveTo(a.left.x,a.left.y);g.lineTo(a.tip.x,a.tip.y);g.lineTo(a.right.x,a.right.y);g.strokePath();}
  }else{
    const power=clamp(distance/(screen==='levels'?selector.maxPull:world.maxPull),0,1);
    const nx=-drag.dx/distance,ny=-drag.dy/distance;
    for(let i=1;i<=7;i++){
      const d=p.r+12+i*(8+power*8);
      g.fillStyle(color,.36*(1-i/9));g.fillCircle(p.x+nx*d,p.y+ny*d,1.7);
    }
    if(screen!=='levels'){
      const tip=p.r+12+7*(8+power*8),ax=p.x+nx*tip,ay=p.y+ny*tip;
      g.lineStyle(1.4,color,.35);g.beginPath();g.moveTo(ax-nx*6-ny*4,ay-ny*6+nx*4);
      g.lineTo(ax,ay);g.lineTo(ax-nx*6+ny*4,ay-ny*6-nx*4);g.strokePath();
    }
  }
  const pull=Math.min(distance,screen==='levels'?selector.maxPull:world.maxPull);
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
    const eye=bossAngryEyeOutline(side,pose.eyeOpen,pose.anger).map(point=>scaleEye(point,eyeScale*pose.angryScale));
    path(eye,face,opacity*pose.angryAlpha);
    path(bossSpiralEye(side,pose.spiralTurn).map(point=>scaleEye(point,eyeScale)),face,opacity*pose.spiralAlpha,Math.max(.8,r*.025)*eyeScale);
  }
}

function drawBall(g,b,color,alpha=1,pull=null,birth=null,photoSlot=null){
  const born=birth?.scale??(b.isPlayer?1:ease(b.born));
  const rewardPose=rewardPlayerPose(b),visualX=rewardPose.x,visualY=rewardPose.y,r=rewardPose.r*born;
  if(r<.3)return;
  const angle=pull?Math.atan2(pull.dy,pull.dx):b.angle;
  const amount=pull?clamp(Math.hypot(pull.dx,pull.dy)/(screen==='home'?home.maxPull:(screen==='levels'?selector.maxPull:(world?.maxPull||150))),0,1):0;
  const cos=Math.cos(angle),sin=Math.sin(angle);
  const phase=screen==='home'?home.phase:screen==='levels'?selector.phase:null;
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
    if(screen==='play'&&world?.mode!=='campaign'&&settings.expressions&&Math.max(scene?.rescueUntil||0,scene?.firstTypeUntil||0)>(world.feedbackTime??world.time))visual.eyeMix=0;
  }
  // Restart breathing at the round rebound/overlay endpoint, independently of
  // the old breathing phase and the clock driving the other home animations.
  const menuPlayer=b.isPlayer&&!b.isAuxiliary&&(screen==='home'||screen==='levels');
  const breathing=screen==='home'?home.animate:!reducedMotion;
  const squash=pull?0:menuPlayer&&phase==='idle'
    ?breathing?Math.sin(visual.idleAge*1.3)*.035:0:b.squash;
  if(visual){
    visual.renderedSquash=squash;
    visual.renderedPull=pull?{amount,angle}:null;
  }
  g.fillStyle(color,alpha*(birth?.alpha??born));g.beginPath();
  const segments=192;
  // Keep eyes, custom contours and photos on the same eased turn as reward
  // placement; the ready-state pose is the identical completed full turn.
  const roll=b.roll??(world?.phase==='transition'?Math.PI*2*world.rewardMoveProgress:0);
  const skinPose={x:visualX,y:visualY,r,squash,deformAngle:angle,pullAmount:amount,roll};
  const flight=b.isPlayer&&screen==='play'&&['battle','boss-entry','boss'].includes(world?.phase)&&!pull&&!reducedMotion;
  const flightStart=world&&scene?.rewardVisuals?.world===world?scene.rewardVisuals.flightAt:null;
  // Re-enter the existing flight deformation softly after the shorter reward
  // rest, without changing any stretch during ordinary combat.
  const flightBlend=flightStart!=null?smooth((world.feedbackTime-flightStart)/.2):1;
  const flightStretch=flight?.12*clamp(Math.hypot(b.vx,b.vy)/(world.baseSpeed||1),0,1)*settings.juice*flightBlend:0;
  const flightAngle=flight?Math.atan2(b.vy,b.vx):0;
  Object.assign(skinPose,{flightStretch,flightAngle});
  const fc=Math.cos(flightAngle),fs=Math.sin(flightAngle),fx=1+flightStretch;
  if(b.isPlayer&&usesSkinContour()){
    const points=projectSkinContour(activeContour(),skinPose);
    [...points,points[0]].forEach((point,i)=>i?g.lineTo(point.x,point.y):g.moveTo(point.x,point.y));
  }else for(let i=0;i<=segments;i++){
    const t=i/segments*Math.PI*2,ct=Math.cos(t),st=Math.sin(t);
    // Home, selection, both battle modes and rebound share the same smooth join.
    const point=pullBallPoint(ct,st,amount);
    const lx=r*point.x*(1-squash),ly=r*point.y*(1+squash*.7);
    const wx=lx*cos-ly*sin,wy=lx*sin+ly*cos;
    const along=(wx*fc+wy*fs)*fx,across=(-wx*fs+wy*fc)/fx;
    const x=visualX+along*fc-across*fs,y=visualY+along*fs+across*fc;
    i?g.lineTo(x,y):g.moveTo(x,y);
  }
  g.closePath();
  // The photo surface already composites the same opaque player base before
  // applying alpha. Painting it here too would double that base while fading.
  const photoDrawn=b.isPlayer&&appearance&&drawPlayerPhoto(activeContour(),skinPose,false,photoSlot,alpha*(birth?.alpha??born));
  if(!photoDrawn)g.fillPath();
  if(b.isPlayer){
    if(appearance)return;
    if(b.isAuxiliary)return;
    const face=isDark(settings.player)?0xf4f3eb:0x252720;
    if(screen==='play'&&(scene?.ending||world?.config?.r===7&&settings.expressions&&world.glassMissUntil>world.feedbackTime)){
      g.lineStyle(Math.max(1,r*.045),face,alpha*.9);
      for(const side of [-1,1]){
        const x=visualX+side*r*.17,y=visualY-r*.07,d=r*.065;
        g.lineBetween(x-d,y-d,x+d,y+d);g.lineBetween(x-d,y+d,x+d,y-d);
      }
      return;
    }
    if(screen==='play'&&world?.mode==='campaign'&&[4,8].includes(world?.config?.r)&&settings.expressions&&(b.campaignSquintUntil||0)>world.feedbackTime){
      g.lineStyle(Math.max(1,r*.055),face,alpha*.9);
      for(const side of [-1,1]){
        const x=visualX+side*r*.17,y=visualY-r*.07,d=r*.075;
        g.lineBetween(x+side*d,y-d,x-side*d,y);
        g.lineBetween(x-side*d,y,x+side*d,y+d);
      }
      return;
    }
    const onScreen=levelPointer&&levelPointer.x>=0&&levelPointer.x<=viewport.width&&levelPointer.y>=0&&levelPointer.y<=viewport.height;
    let target=screen==='levels'?pointerFaceTarget(b,onScreen?levelPointer:null)
      :faceTarget(b,pull,screen==='home'?home.maxPull:(world?.maxPull||150));
    if(screen==='play'&&world?.mode!=='campaign'&&world?.phase==='battle'&&settings.expressions&&!paused&&!modal&&!pull){
      target=pressureLook(b,world.enemies,world.feedbackTime??world.time)||target;
    }
    if(screen==='play'&&world?.config?.implemented&&world.tutorialVisible&&world.tutorialLookTime<1&&!pull){target=pointerFaceTarget(b,world.teachingTarget||world.tutorialTarget)||target;}
    const faceOffset=smoothFace({x:b.lookX||0,y:b.lookY||0},target,scene?.frameDt??1/60);
    b.lookX=faceOffset.x;b.lookY=faceOffset.y;
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
}

function bindInput(canvas){
  const position=e=>pointerPosition(e.clientX,e.clientY,canvas.getBoundingClientRect(),viewport);
  const moveLevelPointer=point=>{
    levelPointer.x=point.x;levelPointer.y=point.y;
    if(Math.hypot(point.x-levelPointer.startX,point.y-levelPointer.startY)>8)levelPointer.moved=true;
  };
  canvas.addEventListener('pointerdown',e=>{
    if(choicePress){if(e.pointerId!==choicePress.id)clearChoicePress();return;}
    if(paused||modal||transfer||controlFlight||drag||levelPointer||trackPointer!==null||!e.isPrimary||e.button>0)return;
    const point=position(e);
    if(screen==='play'&&(world?.mode!=='campaign'||world?.isCampaignOffer)&&world?.phase==='choose'){
      const choice=world.choices.find(c=>Math.hypot(point.x-c.x,point.y-c.y)<=c.r*ease(c.born??1));
      if(choice){
        choicePress={id:e.pointerId,choiceId:choice.id,x:point.x,y:point.y,startedAt:aimInputTime(e),startStamp:Number(e.timeStamp)/1000,active:false,canvas};
        if(scene){scene.accumulator=0;scene.timeSlices=[];scene.timeScale=1;}
        canvas.setPointerCapture(e.pointerId);e.preventDefault();return;
      }
    }
    if(screen==='levels'){
      if(levelPointer||!['idle','wobble'].includes(selector.phase))return;
      unlockAudio();
      const target=selector.targetAt(point.x,point.y);
      levelPointer={id:e.pointerId,x:point.x,y:point.y,startX:point.x,startY:point.y,targetId:target?.id??null,moved:false};
      if(selector.ready&&selector.isPlayerPoint(point.x,point.y)){
        drag={id:e.pointerId,x:point.x,y:point.y,dx:0,dy:0};
      }else if(selector.isTrackPoint(point.x,point.y)&&selector.startTrack(point.x,point.y,e.timeStamp/1000))trackPointer=e.pointerId;
      // Blank space is captured too, solely for the held-finger gaze.
      canvas.setPointerCapture(e.pointerId);e.preventDefault();return;
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
    if(screen==='levels'&&levelPointer?.id===e.pointerId){
      const p=position(e);moveLevelPointer(p);
      if(trackPointer===e.pointerId&&levelPointer.moved)selector.moveTrack(p.x,p.y,e.timeStamp/1000);
      if(drag?.id===e.pointerId){drag.dx=p.x-drag.x;drag.dy=p.y-drag.y;}
      e.preventDefault();return;
    }
    if(!drag||drag.id!==e.pointerId)return;
    const p=position(e);drag.dx=p.x-drag.x;drag.dy=p.y-drag.y;
    if(drag.aim){const now=aimInputTime(e);drag.aim.move(p.x,p.y,now);updateAim(now);}
    updateChargeFeedback();e.preventDefault();
  });
  canvas.addEventListener('pointerup',e=>{
    if(choicePress?.id===e.pointerId){clearChoicePress();e.preventDefault();return;}
    if(screen==='levels'&&levelPointer?.id===e.pointerId){
      const p=position(e);moveLevelPointer(p);
      const gesture=levelPointer;
      if(trackPointer===e.pointerId){
        if(gesture.moved)selector.moveTrack(p.x,p.y,e.timeStamp/1000);
        selector.endTrack(e.timeStamp/1000);trackPointer=null;
      }
      if(!paused&&!modal&&!transfer&&!controlFlight){
        if(drag?.id===e.pointerId){
          if(selector.shoot(p.x-drag.x,p.y-drag.y)){tone(330,.15,'sine',.045,.4);vibrate(9);}
        }else if(!gesture.moved&&gesture.targetId!==null&&selector.targetAt(p.x,p.y)?.id===gesture.targetId){
          selector.activateAt(p.x,p.y);
        }
      }
      cancelDrag();if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
      e.preventDefault();return;
    }
    if(!drag||drag.id!==e.pointerId)return;
    const p=position(e);drag.dx=p.x-drag.x;drag.dy=p.y-drag.y;
    let shouldShoot=true,releasedAim=null;
    if(drag.aim){
      const now=aimInputTime(e);drag.aim.move(p.x,p.y,now);updateAim(now);
      if(!drag)return;
      releasedAim=drag.aim.release(p.x,p.y,now);shouldShoot=releasedAim.shouldShoot;
    }
    if(!paused&&!modal){
      if(screen==='home'&&home.shoot(drag.dx,drag.dy)){tone(220+home.power*190,.15,'sine',.045,.4);vibrate(9);}
      else if(screen==='play'&&world&&shouldShoot&&world.shoot(drag.dx,drag.dy))recordAimGesture(releasedAim);
    }
    cancelDrag();if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
  });
  const cancelPointer=e=>{
    if(e.pointerId===choicePress?.id)clearChoicePress();
    if(e.pointerId===drag?.id||e.pointerId===levelPointer?.id||e.pointerId===trackPointer)cancelDrag();
  };
  canvas.addEventListener('pointercancel',cancelPointer);
  canvas.addEventListener('lostpointercapture',cancelPointer);
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
}

function boot(){
  if(!window.Phaser){toast('引擎未能加载，请联网刷新后重试');return;}
  class BallScene extends Phaser.Scene {
    constructor(){super('BallScene');this.accumulator=0;this.timeSlices=[];this.effects=[];this.clock=0;this.inputClock=0;this.frameStamp=null;this.timeScale=1;this.hitSoundAt=0;this.wallFlashes=[];this.wallBulges=[];this.bulgeWorld=null;this.impactGhosts=[];this.zoomPulse=null;this.upgradeCue=0;this.feedbackCamera=null;this.blinkUntil=0;this.rescueUntil=0;this.firstTypeUntil=0;this.ending=null;this.pressureWarning=new PressureWarning();this.cometTrails=new CometTrails();this.trailWorld=null;this.trailPhase='';this.campaignLabels=new Map();this.labelWorld=null;this.campaignNotes=[];this.campaignFailure=null;this.campaignPressure=0;}
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
          for(const frame of [this.lastBorder,this.campaignFrameTransfer?.from].filter(Boolean)){
            frame.left*=rx;frame.right*=rx;frame.top*=ry;frame.bottom*=ry;frame.cornerRadius*=k;
            if(frame.gap){frame.gap.left*=rx;frame.gap.right*=rx;}
          }
        }
        if(transfer&&geometryChanged){transfer.from.x*=next.width/viewport.width;transfer.from.y*=next.height/viewport.height;transfer.from.r*=Math.min(next.width,next.height)/Math.min(viewport.width,viewport.height);}
        if(skinUnlock&&geometryChanged){skinUnlock.from.x*=next.width/viewport.width;skinUnlock.from.y*=next.height/viewport.height;skinUnlock.from.r*=Math.min(next.width,next.height)/Math.min(viewport.width,viewport.height);}
        if(controlFlight&&geometryChanged)for(const item of controlFlight.items){item.from.x*=next.width/viewport.width;item.from.y*=next.height/viewport.height;item.from.r*=Math.min(next.width,next.height)/Math.min(viewport.width,viewport.height);}
        if(next.scale!==viewport.scale)this.clearCampaignLabels();
        viewport=next;
        this.scale.setZoom(1/viewport.scale);
        this.scale.resize(viewport.bufferWidth,viewport.bufferHeight);
        this.game.canvas.style.width=viewport.width+'px';
        this.game.canvas.style.height=viewport.height+'px';
        this.g.setScale(viewport.scale);
        this.cameras.main.setSize(viewport.bufferWidth,viewport.bufferHeight);
        if(geometryChanged){cancelDrag();this.resetFeedback();if(selector){selector.resize(viewport.width,viewport.height);if(screen==='levels')rebuildLevels();}home.resize(viewport.width,viewport.height);if(world){world.resize(viewport.width,viewport.height);updateChoices();}}
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
      this.events.once('shutdown',()=>{clearChoicePress();this.clearCampaignLabels();window.removeEventListener('resize',resize);sound.clearEnd();sound.stopCharge();photoRenderer?.dispose();});
      if(new URLSearchParams(window.location?.search||'').get('feedback-demo')==='1')installFeedbackDemo();
      if(new URLSearchParams(window.location?.search||'').get('campaign-demo')==='1')installCampaignDemo();
    }

    particles(e,color,count=7,countScale=1){
      this.effects.push(...impactShards(e,color,{count,countScale,strength:settings.juice,reducedMotion}));
      let remaining=120;
      this.effects=this.effects.reverse().filter(item=>item.type!=='shard'||remaining-->0).reverse();
    }
    clearCampaignLabels(){
      for(const node of this.campaignLabels.values())node.destroy();
      this.campaignLabels.clear();this.labelWorld=null;
    }
    drawCampaignLabels(theme){
      if(this.labelWorld!==world){this.clearCampaignLabels();this.labelWorld=world;}
      const live=new Set();
      for(const label of campaignTextVisuals(world,theme)){
        live.add(label.id);let node=this.campaignLabels.get(label.id);
        const color='#'+label.color.toString(16).padStart(6,'0');
        if(!node){
          node=this.add.text(0,0,label.text,{fontFamily:'GameSans, sans-serif',fontSize:label.size+'px',color,fontStyle:'normal',resolution:viewport.scale}).setOrigin(.5);
          node.campaignText=label.text;node.campaignSize=label.size;node.campaignColor=color;
          this.campaignLabels.set(label.id,node);
        }
        if(node.campaignText!==label.text){node.setText(label.text);node.campaignText=label.text;}
        if(node.campaignSize!==label.size){node.setFontSize(label.size);node.campaignSize=label.size;}
        if(node.campaignColor!==color){node.setColor(color);node.campaignColor=color;}
        node.setPosition(label.x*viewport.scale,label.y*viewport.scale).setScale(viewport.scale).setAlpha(label.alpha).setVisible(true);
      }
      for(const [id,node] of this.campaignLabels)if(!live.has(id)){node.destroy();this.campaignLabels.delete(id);}
    }
    resetFeedback(){
      clearChoicePress();this.clearCampaignLabels();
      this.ending=null;this.campaignNotes=[];
      this.cometTrails.clear();this.trailWorld=null;this.trailPhase='';
      this.wallFlashes=[];this.impactGhosts=[];this.zoomPulse=null;this.upgradeCue=0;this.feedbackCamera=null;this.blinkUntil=0;this.rescueUntil=0;this.firstTypeUntil=0;
      this.wallBulges=[];this.bulgeWorld=null;
      sound.clearEnd();
      $('#game').style.transform='none';
    }
    trailsEnabled(){
      return screen==='play'&&!paused&&!modal&&!document.hidden&&!choicePress&&!this.ending&&!result&&!reducedMotion&&settings.juice>0&&
        ['battle','boss-entry','boss'].includes(world?.phase);
    }
    updateTrails(dt=0){
      if(!this.trailsEnabled()){this.cometTrails.clear();this.trailWorld=null;this.trailPhase='';return;}
      if(this.trailWorld!==world||this.trailPhase!==world.phase){this.cometTrails.clear();this.trailWorld=world;this.trailPhase=world.phase;}
      this.cometTrails.step([world.player,...(world.auxiliaries||[])].filter(body=>!body.captured&&body.active!==false&&body.hp>0),dt,{unit:world.unit});
    }
    beginEnding(){
      if(this.ending||result)return;
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
      const zoomPhase=['battle','boss-entry','boss','clearing','campaign-celebrate'].includes(world?.phase)||(world?.phase==='transition'&&this.zoomPulse?.rewardTransition);
      if(paused||modal||screen!=='play'||!zoomPhase||reducedMotion||!settings.juice){
        this.zoomPulse=null;this.feedbackCamera=null;$('#game').style.transform='none';
      }else if(this.zoomPulse){
        const pulse=this.zoomPulse;pulse.age+=dt;
        const duration=pulse.kind==='campaign'?pulse.duration:pulse.kind==='clear'?.95:.28;
        const zoom=pulse.kind==='campaign'?1+pulse.peak*Math.sin(Math.PI*clamp(pulse.age/duration,0,1)):pulse.kind==='clear'?clearingZoom(pulse.age,settings.juice):impactZoom(pulse.age,pulse.peak);
        this.feedbackCamera={x:pulse.x,y:pulse.y,zoom};
        $('#game').style.transformOrigin=`${pulse.x}px ${pulse.y}px`;
        $('#game').style.transform=`scale(${zoom})`;
        if(pulse.age>=duration){this.zoomPulse=null;this.feedbackCamera=null;$('#game').style.transform='none';}
      }
      if(screen!=='play'||world?.phase!=='transition')this.upgradeCue=0;
      if(paused)return;
      if(!document.hidden&&screen==='play'&&world?.config?.task===11){
        for(const note of this.campaignNotes)note.wait-=dt;
        for(const note of this.campaignNotes)if(note.wait<=0)tone(note.frequency,.12,'sine',.035,1.1);
        this.campaignNotes=this.campaignNotes.filter(note=>note.wait>0);
      }
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
      const endless=world.mode!=='campaign';
      const finalKill=events.some(e=>e.type==='kill')&&events.some(e=>e.type==='upgrade');
      const bossDefeated=events.some(e=>e.type==='bossDefeated');
      for(const e of events){
        if(e.type==='shoot'){sound.launch(e.power);vibrate(9);}
        if(e.type==='wall'){
          const audible=(e.surface==='arena'||endless)?audioLevel(e.power,.5)>=.25:true;
          if(audible&&this.clock-this.hitSoundAt>.07){sound.wall(e.power,{endless});this.hitSoundAt=this.clock;}
          this.queueWallBulge(e);
        }
        if(e.type==='shockwave'&&settings.juice){
          this.effects.push({type:'upgrade-wave',x:e.x,y:e.y,r:e.r,life:0,total:.25,color:hex(settings.player)});
        }
        if(e.type==='hit'&&!e.lethal){
          const hitTier=endless?hitFeedbackTier(e):'heavy';
          if(hitTier!=='light'&&this.clock-this.hitSoundAt>.05){sound.impact({kind:'hit',power:e.power,strength:settings.juice,endless,hitTier});this.hitSoundAt=this.clock;}
          if(hitTier==='heavy'&&e.power>.35)vibrate(12);
        }
        if(e.type==='kill'){
          if(endless&&e.value>0)scoreFeedback.noteKill(e.combo,world.comboCap);
          if(e.bodySnapshot&&e.freezeDuration>0)this.impactGhosts.push({event:e,body:e.bodySnapshot,life:0,total:e.freezeDuration,startedAt:e.feedbackTime??world.feedbackTime??world.time});
          else this.particles(e,enemyBodyColor(e,hex(settings.enemy)));
          sound.impact({kind:'kill',level:Math.max(0,(e.feedbackLevel||1)-1),power:e.power??e.impactSpeed/world.baseSpeed,strength:settings.juice,upgradeBoost:!!e.upgradeBoost,endless,frenzy:endless&&!!world.buffs.frenzy});vibrate(15);
          this.hitSoundAt=this.clock;this.blinkUntil=this.clock+.075;this.pulseZoom(e);
        }
        if(e.type==='clearingStart'){
          cancelDrag();this.rescaleTimeSlices(clearingTimeScale(world.clearing?.elapsed||0,{juice:settings.juice,reducedMotion}));
          sound.clearStart({strength:settings.juice});
          if(!reducedMotion&&settings.juice)this.zoomPulse={kind:'clear',age:0,x:e.x,y:e.y,rewardTransition:true};
          if(settings.juice)vibrate([12,30,18]);
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
          tone(440,.18,'sine',.035,1.4);vibrate([8,24,12]);
        }
        if(e.type==='shieldBreak'){
          this.particles(e,hex(settings.enemy),5);
          sound.impact({kind:'hit',power:.45,strength:settings.juice});
        }
        if(e.type==='firstTypeKill')this.firstTypeUntil=(world.feedbackTime??world.time)+.3;
        if(e.type==='shatter')this.particles(e,enemyBodyColor(e,hex(settings.enemy)),5);
        if(e.type==='bossEntry'){tone(260,.35,'sine',.045,1.5);}
        if(e.type==='bossReady')tone(520,.14,'triangle',.035,1.15);
        if(e.type==='bossHit'&&!bossDefeated){
          sound.impact({kind:'boss',power:e.power,strength:settings.juice});vibrate(9);
        }
        if(e.type==='bossStunned'&&!reducedMotion&&settings.juice)this.wallFlashes.push({...e,boss:true,life:0});
        if(e.type==='bossScore'||e.type==='bossDefeated'){
          const label=this.add.text(e.x,e.y,'+'+e.value,{fontFamily:'GameSans, sans-serif',fontSize:e.type==='bossDefeated'?'22px':'18px',color:settings.player,fontStyle:'normal'}).setOrigin(.5).setScale(viewport.scale);
          const labelY=e.type==='bossDefeated'?e.y+(e.r||world.player.r)+24:e.y-(e.r||world.player.r)-12;
          this.effects.push({type:'label',label,life:0,total:.6,x:e.x,y:labelY});
          if(e.type==='bossScore'){tone(600+(e.segment||0)*90,.13,'sine',.045,1.25);vibrate(10);}
          else{
            cancelDrag();this.particles(e,hex(settings.enemy),7,e.r/(e.referenceRadius||world.unit*.8));sound.bossDefeat({strength:settings.juice});
            if(settings.juice)this.wallFlashes.push({bossDefeat:true,life:0,duration:.18});
            if(world.bossVictorySlowTime>0)this.rescaleTimeSlices(reducedMotion||!settings.juice?1:.25);vibrate([12,25,18]);
          }
        }
        if(e.type==='bossCelebrate')sound.bossVictory();
        if(e.type==='upgrade'){
          cancelDrag();
          if(endless||world.isCampaignOffer)this.rewardVisuals={world};
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
          this.particles(e,e.buff.color?hex(e.buff.color):rewardColor);
          sound.rewardHit({strength:settings.juice,power:e.power??.5});vibrate([12,30,12]);
        }
        if(world.isCampaignOffer&&e.type==='campaignOfferComplete'){
          campaignOffer.action={type:'choose',upgradeId:e.upgradeId};paused=true;
        }
        if(world.isCampaignOffer&&e.type==='campaignOfferExit'){
          campaignOffer.action={type:'exit',target:e.target};paused=true;
        }
        if(e.type==='stage'&&endless){
          if(this.rewardVisuals?.world!==world)this.rewardVisuals={world};
          this.rewardVisuals.flightAt=e.feedbackTime;
        }
        if(e.type==='campaignPeak'){
          cancelDrag();this.rescaleTimeSlices(world.presentationTimeScale||1);sound.bossVictory();
          if(!reducedMotion&&settings.juice)this.zoomPulse={kind:'campaign',age:0,duration:e.duration||1.2,peak:(e.zoom||.06)*settings.juice,x:e.x,y:e.y};
        }
        if(e.type==='campaignSlow')this.rescaleTimeSlices(world.presentationTimeScale||1);
        if(e.type==='campaignMerge'||e.type==='campaignMergeClear'){
          this.effects.push(...mergeShards(e,hex(settings.enemy),{strength:settings.juice,reducedMotion}));
          let remaining=120;this.effects=this.effects.reverse().filter(item=>item.type!=='shard'||remaining-->0).reverse();
          tone(440*2**((Math.min(12,(e.level||1)+(e.chain||1))-1)/12),.12,'sine',.03,1.1);
          if(e.type==='campaignMergeClear'){
            for(const n of [660,880,1100])tone(n,.18,'sine',.025,1.05);
            if(!reducedMotion&&settings.juice)this.zoomPulse={kind:'campaign',age:0,duration:.4,peak:.06*settings.juice,x:e.x,y:e.y};
          }
        }
        if(e.type==='campaignMergeChain'){
          const start=Math.max(.07,...this.campaignNotes.map(note=>note.wait+.07));
          [660,880,1100].forEach((frequency,i)=>this.campaignNotes.push({wait:start+i*.07,frequency}));
          this.campaignNotes=this.campaignNotes.slice(-12);
        }
        if(e.type==='campaignChainMatch'){
          const wait=Math.max(0,...this.campaignNotes.map(note=>note.wait+.07));
          this.campaignNotes.push({wait,frequency:440*2**(Math.min(12,e.level||1)/12)});
          this.campaignNotes=this.campaignNotes.slice(-12);
        }
        if(e.type==='pulse'&&world.config?.task===11&&settings.juice)this.effects.push({type:'upgrade-wave',x:e.x,y:e.y,r:e.r,life:0,total:.25,color:hex(settings.player)});
        if(e.type==='campaignChainClear')this.wallFlashes.push({life:0,duration:.2,shockwave:true});
        if(e.type==='campaignBrickHit')tone(440*2**((Math.min(16,e.note||1)-1)/12),.065,'sine',.022,1.1);
        if(e.type==='campaignBrickPlus'&&e.added>0)tone(880,.12,'sine',.035,1.3);
        if(e.type==='campaignBrickRows')this.wallFlashes.push({life:0,duration:.25,shockwave:true});
        if(e.type==='campaignGlassHit')tone(660*2**(Math.min(16,e.combo||1)/12),.075,'triangle',.022,1.15);
        if(e.type==='campaignGlassMiss'){tone(220,.12,'sine',.03,.7);this.wallFlashes.push({life:0,duration:.3,shockwave:true});}
        if(e.type==='campaignGlassMulti')for(const n of [660,880,1100].slice(0,e.count))tone(n,.12,'sine',.025,1.1);
        if(e.type==='campaignGlassRush')tone(880,.14,'sine',.025,1.2);
        if(e.type==='campaignPocket'&&!e.player)tone(440*2**(Math.min(12,e.combo||1)/12),.12,'sine',.035,1.1);
        if(e.type==='campaignScratch')tone(220,.15,'sine',.03,.7);
        if(e.type==='campaignRim'||e.type==='campaignPocketReject')tone(880,.07,'sine',.025,.8);
        if(e.type==='campaignBumperHit'){
          sound.impact({kind:'hit',level:Math.min(12,(e.combo||1)-1),power:.55,strength:settings.juice});
          tone(440*2**(Math.min(12,e.combo||1)/12),.07,'sine',.025,1.12);
        }
        if(e.type==='campaignBumperRun')this.wallFlashes.push({life:0,duration:.25,shockwave:true});
        if(e.type==='campaignStrike'||e.type==='campaignJackpot'){
          for(const [i,n] of [660,880,1100].entries())tone(n,.12+i*.04,'sine',.03,1.05);
        }
        if(e.type==='campaignDrain')tone(220,.15,'sine',.03,.7);
        if(e.type==='campaignBallSave')tone(660,.14,'sine',.03,1.25);
        if(e.type==='campaignPegHit'){
          sound.impact({kind:'hit',level:Math.min(12,(e.combo||1)-1),power:.6,strength:settings.juice});
          tone(440*2**(Math.min(12,e.combo||1)/12),.08,'sine',.025,1.1);
        }
        if(['campaignSkill','campaignCombo','campaignPegRun'].includes(e.type))for(const [i,n] of [660,880,990].entries())tone(n,.12+i*.03,'sine',.025,1.05);
        if(e.type==='campaignBonus')tone(500+(e.index||0)*65,.1,'sine',.025,1.15);
        if(e.type==='campaignFreeBall'){for(const n of [660,880,1100])tone(n,.16,'sine',.022,1.04);}
        if(e.type==='campaignBuff'){
          const label=this.add.text(e.x??world.player.x,e.y??world.player.y,e.label,{fontFamily:'GameSans, sans-serif',fontSize:'15px',color:settings.player,fontStyle:'normal'}).setOrigin(.5).setScale(viewport.scale);
          this.effects.push({type:'label',label,life:0,total:1.15,x:e.x??world.player.x,y:(e.y??world.player.y)-world.player.r-10});
          tone(700,.2,'sine',.045,1.4);vibrate(10);
        }
        if(world.mode==='campaign'&&e.type==='campaignLaunchEnd'&&e.reason==='timeout')tone(180,.09,'sine',.018,.8);
        if(world.mode==='campaign'&&e.type==='campaignFail'){
          const cue=campaignFailureFeedback(e.reason);this.campaignFailure={...cue,life:0};
          tone(cue.frequency,.25,'sine',.045,.6);vibrate(cue.reason==='budget'?12:[12,30,12]);
        }
        if(e.type==='over'){
          if(world.mode==='campaign'){this.resetFeedback();openResult();}else this.beginEnding();
          if(!world.completed&&world.mode!=='campaign'){tone(160,.4,'sine',.06,.4);vibrate([20,40,30]);}
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
      const physicalGap=bounds&&screen==='play'?campaignBorderGap(world):null;
      let gap=physicalGap&&returning<.999?{left:lerp(physicalGap.left,(x+right)/2,returning),right:lerp(physicalGap.right,(x+right)/2,returning)}:null;
      const frameMove=this.campaignFrameTransfer;
      if(frameMove){
        const t=smooth(frameMove.elapsed/frameMove.duration),from=frameMove.from;
        x=lerp(from.left,x,t);y=lerp(from.top,y,t);right=lerp(from.right,right,t);bottom=lerp(from.bottom,bottom,t);corner=lerp(from.cornerRadius,corner,t);
        if(from.gap||gap){
          const a=from.gap||{left:(gap.left+gap.right)/2,right:(gap.left+gap.right)/2};
          const b=gap||{left:(a.left+a.right)/2,right:(a.left+a.right)/2};
          const nextGap={left:lerp(a.left,b.left,t),right:lerp(a.right,b.right,t)};
          gap=nextGap.right-nextGap.left>1e-6?nextGap:null;
        }
      }
      const outline={left:x,top:y,right,bottom,cornerRadius:corner};
      this.lastBorder={...outline,gap:gap?{...gap}:null,campaign:world?.mode==='campaign'||screen==='levels'};
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
        if(gap&&drawCampaignBorder(g,outline,gap,{dx:bossOffset+dx,dy,outset}))return;
        g.strokeRoundedRect(x+bossOffset+dx-outset,y+dy-outset,right-x+outset*2,bottom-y+outset*2,Math.max(0,corner+outset));
      };
      g.lineStyle(1+(reducedMotion?1.5:1)*bossFade*settings.juice,border,Math.min(1,.65+.35*bossFade*settings.juice));stroke();
      if(bulges.length)for(const bulge of this.wallBulges){bulge.fresh=false;bulge.lastClock=world.borderTime||0;}
      const warning=()=>{
        if(world?.mode==='campaign'||screen!=='play'){
          const pressure=this.campaignPressure||0;
          if(pressure>1e-5){
            const breath=reducedMotion?.6:.45+.55*(.5-.5*Math.cos(this.clock*Math.PI*2/1.8));
            g.lineStyle(2+pressure*1.5,PRESSURE_WARNING_COLOR,pressure*breath*.6);stroke();
          }
          const cue=this.campaignFailure;
          if(cue){
            const t=clamp(cue.life/cue.duration,0,1),fade=reducedMotion?Math.sin(Math.PI*t):Math.pow(Math.sin(Math.PI*cue.pulses*t),2)*(1-t*.4);
            g.lineStyle(1.5+fade*1.7,cue.color,fade*.75*settings.juice);stroke();
          }
        }
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
        const fade=1-flash.life/(flash.duration||.12);
        if(flash.bossDefeat)continue;
        if(flash.shockwave){
          g.lineStyle(reducedMotion?1:1+1.5*fade*settings.juice,border,.65+.35*fade*settings.juice);
          stroke();continue;
        }
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

      const colors={play:homePlayColor,sound:homeSoundColor,settings:0xc4dc86,wardrobe:0xe5c684,mode:0xb4ced4};
      for(const c of home.targets){
        if(controlFlight&&['play','settings'].includes(c.id))continue;
        drawFunctionalBall(g,c,colors[c.id],c.id==='mode'?(home.mode==='campaign'?'flag':'infinity'):c.id,fade,c.id==='sound'&&!settings.sound);
      }
      if(!detached())drawBall(g,home.player,hex(settings.player),1,drag||home.pull);
      else playerVisuals.delete(home.player);
    }
    updateHome(dt){
      const before=home.phase;
      if(!modal&&!transfer)home.step(dt,!reducedMotion);
      if(home.action){
        const action=home.action;home.action=null;
        if(action==='sound'){settings.sound=!settings.sound;applyTheme();tone(540,.09,'sine',.04,1.3);vibrate(10);}
        if(action==='mode'){syncMode();tone(610,.12,'sine',.04,1.3);vibrate(10);}
        if(action==='settings')openSettings();
        if(action==='wardrobe')openWardrobe();
      }
      layoutHomeControl();
      if(before!=='entering'&&home.phase==='entering'){
        screen='entering';cancelDrag();syncInputs();
        $('#hud').hidden=home.mode==='campaign';$('#hud').classList.remove('campaign');$('#hud').style.opacity=0;$('#score').textContent='0000';
        clearChoiceLabels();$('.pause-button').disabled=true;
        tone(420,.24,'sine',.055,1.7);vibrate(15);
      }
      if(screen==='entering'){
        $('#home').style.opacity=home.fade;$('#hud').style.opacity=home.hudOpacity;
      }
      if(screen==='home')$('#home').style.opacity=homeReveal;
      if(home.phase==='done'){
        if(home.mode==='campaign'){openLevels({...home.player});this.drawBorder();renderLevels();return;}
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
      const arrival=this.campaignArrival?.world===world?smooth(this.campaignArrival.elapsed/this.campaignArrival.duration):1;
      const campaignTheme={enemyColor:hex(settings.enemy),playerColor:hex(settings.player),inkColor:isDark(settings.bg)?0xf0f2e8:0x252720,bgColor:hex(settings.bg),alpha:(result?1-smooth(result.clock/.65):1)*arrival,reducedMotion,strength:settings.juice,showTutorial:!paused&&!modal,dragging:!!drag};
      if(world.config?.implemented)drawCampaign(g,world,campaignTheme);
      this.drawCampaignLabels(campaignTheme);
      const trailBodies=[world.player,...(world.auxiliaries||[])].filter(body=>!body.captured&&body.active!==false&&body.hp>0);
      if(this.trailsEnabled()&&trailBodies.length)this.cometTrails.draw(g,trailBodies,hex(settings.player),{unit:world.unit,strength:settings.juice,bounds:world.arenaBounds});
      else this.cometTrails.clear();
      if(boss&&!boss.defeated){
        const b=boss,alpha=result?1-smooth(result.clock/.65):1;
        drawBoss(g,this.shakenBody(b),alpha);
      }
      for(const b of view?.enemies||world.enemies){
        if(result?.sourceIds.includes(b.id))continue;
        const pose=world.config?.implemented?campaignBodyVisual(world,b,{reducedMotion}):{body:b,alpha:1,hidden:false};
        if(pose.hidden)continue;
        const alpha=(result?1-smooth(result.clock/.65):1)*pose.alpha*arrival;
        const size=injuredEnemyScale(b,world.mode!=='campaign');
        const body=this.shakenBody({...pose.body,r:pose.body.r*size});
        const special=(world.mode!=='campaign'||[2,8].includes(world.config?.r))&&isSpecialEnemy(body);
        if(special)drawEnemyBall(g,body,hex(settings.enemy),{alpha,unit:world.unit*size,player:p,
          flashAlpha:!result&&b.hit>.01?b.hit*(b.hitAlpha??.5):0,flashColor:isDark(settings.enemy)?0xffffff:0xf9f8f0});
        else{
          drawBall(g,body,hex(settings.enemy),alpha);
          if(world.mode==='campaign')drawCampaignBodyDetails(g,world,body,{enemyColor:hex(settings.enemy),bgColor:hex(settings.bg),alpha});
          if(!result&&b.hit>.01){g.fillStyle(isDark(settings.enemy)?0xffffff:0xf9f8f0,b.hit*(b.hitAlpha??.5));g.fillEllipse(body.x,body.y,body.r*1.7,body.r*1.7,128);}
        }
      }
      for(const ghost of this.impactGhosts){
        const size=injuredEnemyScale(ghost.body,world.mode!=='campaign');
        const body=this.shakenBody({...ghost.body,r:ghost.body.r*size,feedbackFreeze:ghost.total-ghost.life});
        if(world.mode!=='campaign'&&isSpecialEnemy(body))drawEnemyBall(g,body,hex(settings.enemy),{unit:world.unit*size,player:p,
          flashAlpha:.15+.25*settings.juice,flashColor:isDark(settings.enemy)?0xffffff:0xf9f8f0});
        else{
          drawBall(g,body,hex(settings.enemy));
          g.fillStyle(isDark(settings.enemy)?0xffffff:0xf9f8f0,.15+.25*settings.juice);
          g.fillEllipse(body.x,body.y,body.r*1.7,body.r*1.7,64);
        }
      }
      for(const c of world.choices){
        const appear=ease(c.born),r=c.r*appear;
        if(r<1||world.isCampaignOffer&&c.selected)continue;
        const bob=choiceBob(c);
        if(world.mode!=='campaign'||world.isCampaignOffer)drawUpgradeBall(g,{...c,y:c.y+bob},rewardColor,{preview:choicePress?.active&&choicePress.choiceId===c.id,
          time:Math.max(0,this.inputClock-(choicePress?.startedAt||0)-.3),reducedMotion:reducedMotion||!settings.juice});
        else{
          g.fillStyle(hex(c.color),appear);g.fillEllipse(c.x,c.y+bob,r*2,r*2,192);
          polygon(g,c.x,c.y+bob,r*.27,c.sides,c.sides===4?Math.PI/4:-Math.PI/2,c.sides===4?0x573d30:0x293629,appear);
        }
      }
      let photoSlot=0;
      for(const auxiliary of view?.auxiliaries||world.auxiliaries||[]){
        if(auxiliary.active===false||auxiliary.hp<=0)continue;
        const pose=world.config?.implemented?campaignBodyVisual(world,auxiliary,{reducedMotion}):{body:auxiliary,alpha:1,hidden:auxiliary.captured};
        if(!pose.hidden)drawBall(g,this.shakenBody(pose.body),hex(settings.player),pose.alpha*(result?1-smooth(result.clock/.65):1)*arrival,null,null,photoSlot++);
      }
      if(!detached()){
        const pose=world.config?.implemented?campaignBodyVisual(world,p,{reducedMotion}):{body:p,alpha:1,hidden:false};
        if(!pose.hidden){drawDragGuide(g,pose.body);drawBall(g,pose.body,hex(settings.player),pose.alpha,drag?.pending?null:drag);}
        if(world.config?.implemented&&!result)for(const capture of campaignCaptureVisuals(world,{reducedMotion})){
          drawBall(g,capture.body,hex(capture.player?settings.player:settings.enemy),capture.alpha,null,null,capture.auxiliary?photoSlot++:null);
          if(!capture.player)drawCampaignBodyDetails(g,world,capture.body,{enemyColor:hex(settings.enemy),bgColor:hex(settings.bg),alpha:capture.alpha});
        }
      }
      const campaignCrown=world.bowlingCrown||world.pinballCrown;
      const crownAge=campaignCrown?(world.feedbackTime-campaignCrown.at):Infinity;
      const temporaryCrown=!!campaignCrown&&world.config?.task===9&&crownAge>=0&&crownAge<campaignCrown.duration;
      const golfCrown=world.phase==='campaign-celebrate'&&world.golfHoleInOne;
      if(!detached()&&(temporaryCrown&&!p.captured||world.phase==='boss-celebrate'||golfCrown)){
        const shortAge=golfCrown?world.celebration.elapsed:crownAge,shortDuration=golfCrown?world.celebration.duration:campaignCrown?.duration;
        const crown=temporaryCrown||golfCrown?{scale:reducedMotion?1:.55+.45*smooth(shortAge/.16),alpha:smooth(shortAge/.1)*(1-smooth((shortAge-shortDuration+.18)/.18))}:crownVisual(world.phaseTime,reducedMotion);
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
      if(!detached()&&world.mode==='campaign'&&!p.captured&&p.hit>.01){g.fillStyle(isDark(settings.player)?0xffffff:0xf9f8f0,p.hit*.5);g.fillEllipse(p.x,p.y,p.r*1.7,p.r*1.7,128);}
      for(const e of this.effects){
        if(e.type==='label'){e.label.setVisible(!modal).setPosition(e.x*viewport.scale,(e.y-e.life*32)*viewport.scale).setAlpha(1-e.life/e.total);continue;}
        const t=e.life/e.total;
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
      const pressureActive=screen==='play'&&!paused&&!modal&&!result&&!this.ending&&world?.mode!=='campaign'&&world?.phase==='battle';
      this.pressureWarning.step(pressureActive?world.enemies.filter(body=>body.hp>0).length:0,dt,{juice:settings.juice,reducedMotion});
      // Campaign overlays breathe out independently while changing screens.
      const campaignTarget=screen==='play'&&!result&&world?.mode==='campaign'?(world.mergeWarning||0)*settings.juice:0;
      this.campaignPressure=(this.campaignPressure||0)+(campaignTarget-(this.campaignPressure||0))*(1-Math.exp(-dt/.18));
      if(this.campaignFailure){this.campaignFailure.life+=dt;if(this.campaignFailure.life>=this.campaignFailure.duration)this.campaignFailure=null;}
      clearPhoto();updateSkin(dt);this.radiance?.setVisible(false);
      if(screen!=='play'&&this.campaignLabels.size)this.clearCampaignLabels();
      this.updateTrails();
      if(screen==='home'||screen==='entering'){this.updateHome(dt);updateUiBall(dt);return;}
      if(screen==='levels'){
        levelsReveal=Math.min(1,levelsReveal+dt/.5);
        if(!transfer)selector.step(dt,!!drag);
        for(const e of selector.events.splice(0)){
          if(e.type==='tick'||e.type==='scroll'){tone(360+(Math.abs(selector.offset)%8)*35,.04,'sine',.018,1.1);}
          if(e.type==='tap'){tone(680,.06,'sine',.04,1.15);vibrate(8);}
          if(e.type==='locked'){tone(150,.10,'sine',.03,.8);vibrate(8);$('#level-announcement').textContent='先通过前一关，即可解锁。';}
        }
        // Capture the last visible breathing pose before painting an external
        // state, so a click never inserts a round-ball frame before the transfer.
        if(selector.action&&!transfer){
          const action=selector.action;selector.action=null;
          if(action.type==='home')showHome();else if(action.type==='level')enterLevel(action.level);
          if(screen==='home')this.drawHome();else if(screen==='play')this.drawArena();
          updateUiBall(dt);return;
        }
        this.drawBorder();renderLevels();
        if(!campaignOffer&&!detached())drawBall(this.g,selector.player,hex(settings.player),1,drag||selector.pull);
        else playerVisuals.delete(selector.player);
        updateUiBall(dt);
        return;
      }
      if(!world)return;
      if(this.ending){this.advanceEnding(realDt);this.drawArena();updateHud(dt);updateUiBall(dt);return;}
      updateChoicePress();const pending=drag?.pending;updateAim();
      if(world.phase==='clearing')this.timeScale=clearingTimeScale(world.clearing?.elapsed||0,{juice:settings.juice,reducedMotion});
      if(world.config?.implemented)this.timeScale=world.presentationTimeScale||1;
      if(world.bossVictorySlowTime>0)this.timeScale=reducedMotion||!settings.juice?1:.25;
      if(pending&&drag&&!drag.pending)updateChargeFeedback();
      if(!paused&&!choicePress){
        this.handleEvents();
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
          this.accumulator=Math.max(0,this.accumulator-1/120);this.handleEvents();if(world.phase==='over')break;
          if(world.config?.implemented){
            this.rescaleTimeSlices(world.presentationTimeScale||1);
          }else if(world.bossVictorySlowTime>0){
            this.rescaleTimeSlices(reducedMotion||!settings.juice?1:.25);
          }else if(world.phase==='clearing'){
            this.rescaleTimeSlices(clearingTimeScale(world.clearing?.elapsed||0,{juice:settings.juice,reducedMotion}));
          }else if(phaseBeforeStep==='clearing'||timeScale!==1&&!world.continuousControl){
            // A simulated phase change happens inside this frame. Its remaining
            // real time belongs to the normal-speed reward or Boss entrance.
            this.rescaleTimeSlices(1);
          }
        }
        if(drag&&!world.ready)cancelDrag();
        for(const e of this.effects){e.life+=dt;if(e.type==='shard'){e.x+=e.vx*dt;e.y+=e.vy*dt;e.angle+=e.spin*dt;}}
        this.effects=this.effects.filter(e=>{if(e.life>=e.total){e.label?.destroy();return false;}return true;});
      }else{this.accumulator=0;this.timeSlices=[];}
      if(finishCampaignOfferAction()){
        if(screen==='levels'){this.drawBorder();renderLevels();}
        else if(screen==='home')this.drawHome();else this.drawArena();
        updateUiBall(dt);return;
      }
      this.updateFeedback(dt);this.drawArena();updateHud(paused?0:dt);updateUiBall(dt);
    }
  }
  game=new Phaser.Game({type:Phaser.AUTO,parent:'game',backgroundColor:settings.bg,scale:{mode:Phaser.Scale.NONE,width:viewport.bufferWidth,height:viewport.bufferHeight,zoom:1/viewport.scale,autoRound:false},scene:BallScene,render:{antialias:true,antialiasGL:true,transparent:false,roundPixels:false},input:{activePointers:2},audio:{noAudio:true},fps:{target:60,forceSetTimeOut:false},banner:false});
}

let campaignDemoEnabled=false;
function installCampaignDemo(){
  campaignDemoEnabled=true;
  $('#campaign-demo-level').innerHTML=Array.from({length:100},(_,i)=>i+1).filter(level=>levelConfig(level).implemented).map(level=>`<option value="${level}">${level} · ${levelConfig(level).name}</option>`).join('');
  $('#campaign-demo-level').value='1';
  $('#campaign-demo-level').onchange=updateCampaignDemoUpgrades;
  updateCampaignDemoUpgrades();
  $('#campaign-demo-panel').hidden=false;
}
function updateCampaignDemoUpgrades(){
  const select=$('#campaign-demo-upgrade'),pool=campaignUpgradePool(Number($('#campaign-demo-level').value)||1),previous=select.value;
  select.innerHTML=pool.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  select.value=pool.some(c=>c.id===previous)?previous:pool[0]?.id||'';
}
function startCampaignDemo(level=1,upgradeId='energy'){
  if(!levelConfig(level).implemented)return;
  const previousMode=selectedMode;selectedMode='campaign';currentLevel=level;pendingCampaignUpgrade=upgradeId;
  hidePanel();prepareGame({demo:true});selectedMode=previousMode;paused=false;
  $('#campaign-demo-panel').hidden=true;$('#campaign-note').hidden=true;
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
  panel.innerHTML+=`<div class="demo-enemy"><label for="demo-upgrade-type">强化试玩</label><select id="demo-upgrade-type"><option value="choices-3">奖励三选一</option><option value="choices-5">奖励五选一</option>${upgradeOptions}</select><button type="button" data-demo="upgrade-type">试玩强化</button></div>`;
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
  unlockAudio();const previousMode=selectedMode;selectedMode='endless';hidePanel();prepareGame({demo:true});selectedMode=previousMode;
  feedbackDemo=true;paused=false;world.enemies=[];world.events=[];world.spawnTimer=Infinity;world.floorTimer=Infinity;world.introTimer=Infinity;world.wave=null;
  const hints={steer:'球在飞行时也能拖拽；轻点不会发射',reward:'最后一杀引发碎裂波，清场后选择强化',rescue:'触顶后有0.8秒宽限，本局首次自动击碎三颗',danger:'保命已用完；新球出现触顶后，及时击杀可以挽回'};
  const type=kind.startsWith('type-')?kind.slice(5):null;
  const typeHints={ring:'空心环很轻；试着将它弹开',heavy:'重球更难推动；碰撞时注意反弹',split:'击碎后分成三颗子球，可继续清理',walker:'游走球会持续移动；拖拽瞄准它',magnet:'靠近磁球会被吸引，击碎后邻球散开',shield:'第一击破盾，之后才能伤到球体',leader:'周围球向簇长聚拢，击碎后散开'};
  const hint=$('#feedback-demo .demo-title span');if(hint)hint.textContent=typeHints[type]||hints[kind]||'选择场景，可继续拖拽弹射';
  const p=world.player,u=world.unit;
  $('#feedback-demo')?.classList.toggle('demo-flow',kind==='boss'||kind.startsWith('boss-')||kind==='ending'||kind.startsWith('starting-'));
  $('#feedback-demo')?.classList.toggle('demo-compact',kind==='choices-5'||kind==='upgrade-gambler');
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
  panel.classList.toggle('demo-compact',world.choices.length===5);
  const rect=!panel.hidden?panel.getBoundingClientRect():null,bounds=world.arenaBounds,u=world.unit,p=world.player;
  const bottom=rect?.height>0&&rect.top>bounds.top?Math.min(bounds.bottom,rect.top):bounds.bottom;
  world.layoutChoices(world.choices.length===5?{top:bounds.top+8,bottom:bottom-8}:{top:bounds.top+u*3,bottom:bottom-u*4});
  if(world.choices.length!==5)world.choicePlayerY=bottom-p.r*2;
  if(world.phase==='choose'){
    p.x=viewport.width*.5;p.y=world.choicePlayerY;p.vx=p.vy=0;
    if(world.choices.length!==5&&viewport.width>viewport.height&&world.choices.some(c=>Math.hypot(p.x-c.x,p.y-c.y)<p.r+c.r+8)){
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
  if(kind==='choices-5')acquire('gambler');
  world.enemies=[];world.auxiliaries=[];world.fragmentQueue=[];world.events=[];
  world.score=0;world.stageKills=0;world.spawnTimer=world.floorTimer=world.introTimer=Infinity;world.wave=null;
  const panel=$('#feedback-demo'),rect=panel&&!panel.hidden?panel.getBoundingClientRect():null,bounds=world.arenaBounds;
  const bottom=rect?.height>0&&rect.top>bounds.top?Math.min(bounds.bottom,rect.top):bounds.bottom;
  const hint=$('#feedback-demo .demo-title span');
  if(kind.startsWith('choices-')||id==='gambler'){
    world.beginUpgrade();
    for(let i=0;i<240&&world.phase==='transition';i++)world.step(1/120);
    world.layoutChoices(world.choices.length===5?{top:bounds.top+8,bottom:bottom-8}:{top:bounds.top+u*3,bottom:bottom-u*4});
    p.x=viewport.width*.5;p.y=world.choices.length===5?world.choicePlayerY:bottom-p.r*2;p.vx=p.vy=0;p.born=1;p.solid=true;
    if(world.choices.length!==5&&viewport.width>viewport.height&&world.choices.some(c=>Math.hypot(p.x-c.x,p.y-c.y)<p.r+c.r+8)){
      p.x=bounds.left+p.r*1.5;p.y=Math.max(bounds.top+p.r*2,(bounds.top+bottom)*.55);
    }
    world.events=[];
    if(hint)hint.textContent='长按球看示意；松开后拖拽玩家撞球选择';
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
  if(['breath','risk','frenzy'].includes(id))world.spawnTimer=.45;
  if(id!=='gravity')world.shoot(world.maxPull*(['bank','boomerang','shockwave'].includes(id)?1:-1),0);
  const hints={energy:'强化后的这一发更快；可继续拖拽发射',overspeed:'弹性已满层；这一发能越过原来的速度上限',density:'重量级碰撞更有分量；继续试着撞开敌球',rubber:'碰撞后保留更多速度，可连续弹射',growth:'玩家已经大一圈，伤害也提高了10%',magnet:'击杀后，最近的敌球会被拉近',pierce:'撞击后仍沿原方向，试着穿过一排',pulse:'重击会震伤附近敌球并将它们推开',bank:'先撞墙，下一次撞击更有力量',gravity:'附近敌球正向玩家聚拢，可继续拖拽发射',breath:'击杀后刷新会短暂放慢',split:'这一发首杀后会分出两颗辅助球',penetration:'这一发第一次击杀后保持速度',boomerang:'撞墙后0.8秒，球会加速30%',shockwave:'每第2次撞墙会释放冲击波',risk:'新生敌球HP更高，实际得分也会增加',frenzy:'每波更多球，连击还能继续增长'};
  if(hint)hint.textContent=hints[id]||'选择场景，可继续拖拽弹射';
  updateHud();
}

function exportAimStatistics(){
  const link=document.createElement('a');
  link.href='data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(aimStatistics(),null,2));
  link.download='qiuqiule-aim-v7.8.1.json';
  document.body.append(link);link.click();link.remove();
}

// Programmatic menu focus must not leave a touch/mouse halo on round buttons.
document.addEventListener('pointerdown',event=>{
  document.documentElement.dataset.inputMode='pointer';
  const interactive=event.target?.closest?.('button,a,input,select,textarea,[role="button"]');
  resultBlankPointer=event.isPrimary!==false&&!(event.button>0)&&modal==='over'&&world?.mode!=='campaign'&&result&&!transfer&&!controlFlight&&!interactive
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
  if(!button){if(blankReady&&modal==='over'&&world?.mode!=='campaign'&&result&&!transfer&&!controlFlight)restartGame();return;}
  if(transfer||controlFlight)return;
  unlockAudio();tone(680,.035,'sine',.02,1.15);
  const action=button.dataset.action;
  if(action.startsWith('home-')&&e.detail===0&&screen==='home'&&!modal)home.launchTo(action==='home-launch'?'play':action.slice(5));
  if(action==='campaign-upgrade'&&e.detail===0&&campaignOffer&&!paused&&!modal)world.launchTo(button.dataset.upgrade);
  if(action==='campaign-cancel'&&!paused&&!modal)leaveCampaignOffer();
  if(action==='campaign-demo-start')startCampaignDemo(Number($('#campaign-demo-level').value),$('#campaign-demo-upgrade').value);
  if(action==='campaign-demo-close'){$('#campaign-demo-panel').hidden=true;campaignDemoEnabled=false;}
  if(action==='campaign-skip-level'&&screen==='levels'&&canSkip(campaignProgress,Number(button.dataset.level))){
    campaignProgress=skipLevel(campaignProgress,Number(button.dataset.level));storage.write('qiuqiule-campaign',campaignProgress);
    selector.unlocked=campaignProgress.unlocked;$('#level-announcement').textContent='已跳过，可随时返回挑战；本关不计评分。';
  }

  if(action==='campaign-skip'&&campaignOffer&&canSkip(campaignProgress,currentLevel)){
    campaignProgress=skipLevel(campaignProgress,currentLevel);storage.write('qiuqiule-campaign',campaignProgress);
    leaveCampaignOffer();selector.unlocked=campaignProgress.unlocked;$('#level-announcement').textContent='已跳过，可随时返回挑战；本关不计评分。';
  }
  if(action==='levels'&&modal==='over')openLevels();
  if(action==='restart')restartGame();
  if(action==='home'){if(world?.isCampaignOffer)leaveCampaignOffer('home');else if(modal==='pause')openResult();else showHome();}
  if(action==='pause')openPause();
  if(action==='resume')resumeGame();
  if(action==='close')closePanel();
  if(action==='settings')openSettings();
  if(action==='help')openHelp();
  if(action==='export-aim')exportAimStatistics();
  if(action==='export-campaign'){const link=document.createElement('a');link.href='data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(campaignProgress,null,2));link.download='qiuqiule-campaign-v7.8.1.json';document.body.append(link);link.click();link.remove();}
  if(action==='sound'){settings.sound=!settings.sound;applyTheme();}
  if(action==='haptic'){settings.haptic=!settings.haptic;applyTheme();vibrate(10);}
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
    if(campaignOffer&&!modal){leaveCampaignOffer();return;}
    if(modal&&modal!=='over')closePanel();else if(screen==='play'&&world.phase!=='over')setPanel('pause');
  }
  if(e.key==='Tab'&&modal){
    const elements=[...$('#'+modal+'-panel').querySelectorAll('button,input')],first=elements[0],last=elements.at(-1);
    if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}
    else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}
  }
});
function pauseForInterruption(){
  checkpointCampaign();
  cancelDrag();
  if(scene?.wallFlashes)scene.wallFlashes=scene.wallFlashes.filter(flash=>!flash.bossDefeat);
  if(scene?.ending){scene.ending.suspended=true;scene.ending.resumePending=true;return;}
  if(screen!=='play'||modal||world?.phase==='over')return;
  if(transfer)pauseOnArrival=true;else openPause();
}
function resumeEnding(){if(scene?.ending&&!document.hidden&&document.hasFocus()){scene.ending.suspended=false;scene.ending.resumePending=true;scene.timeScale=reducedMotion||!settings.juice?1:.25;}}
document.addEventListener('visibilitychange',()=>{sound.setHidden(document.hidden);if(document.hidden)pauseForInterruption();else resumeEnding();});
window.addEventListener('pagehide',()=>{sound.setHidden(true);pauseForInterruption();});
window.addEventListener('pageshow',()=>{sound.setHidden(document.hidden);resumeEnding();});
window.addEventListener('blur',pauseForInterruption);
window.addEventListener('focus',resumeEnding);
function buffGuideIcon(rings=0){
  const outlines=Array.from({length:clamp(rings,0,2)},(_,i)=>`<circle cx="12" cy="12" r="${7.5+i*3}" fill="none" stroke="currentColor" stroke-width="1"/>`).join('');
  return `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/>${outlines}</svg>`;
}
$('#buff-guide').innerHTML=UPGRADE_DEFINITIONS.map(b=>`<article class="buff-explanation"><span aria-hidden="true">${buffGuideIcon(b.rings)}</span><div><h3>${b.name}<small>${b.short}</small></h3><p>${b.detail}</p></div></article>`).join('');
$$('[data-icon]').forEach(button=>button.innerHTML=iconMarkup(button.dataset.icon));
applyTheme();syncMode();layoutHomeControl();
async function bootWithFont(){
  // Canvas and Phaser retain metrics from the first draw. Load the same face
  // used by the DOM before creating the scene so numbers never start in a fallback.
  try{
    await document.fonts?.load?.('400 16px GameSans','球球了0123456789');
    await document.fonts?.ready;
  }catch{
    // Font failures and older WebViews still get a playable game.
  }
  numberCenters.clear();boot();
}
if(document.readyState==='complete')bootWithFont();else window.addEventListener('load',bootWithFont,{once:true});
