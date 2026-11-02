import {World, BUFFS, clamp, ease, lerp} from './physics.js';
import {CampaignWorld,normalizeProgress,progressPercent} from './campaign.js';
import {LevelSelector,trackPath} from './levels.js';
import {displayMetrics, pointerPosition} from './display.js';
import {HomeWorld} from './home.js';
import {drawFunctionalBall,iconMarkup} from './icons.js';
import {smooth,pullBallPoint,faceTarget,pointerFaceTarget,smoothFace,transferPose,resultBounce,strainedEyeOutline,usesStrainedEyes,playerVisualState,relaxedEyeOutline} from './motion.js';
import {GameAudio,audioLevel} from './audio.js';
import {crownOutline,crownVisual,bossFacePose,bossAngryEyeOutline,bossSpiralEye,bossHornOutline} from './boss-visuals.js';
import {skinContour,morphSkinContour,normalizeSkins,unlockSkin,selectSkin,toggleSkins} from './skins.js';
import {projectSkinContour,paintRadiance,createRadianceCanvas,fitCrownToSkin} from './skin-render.js';
import {PhotoRenderer} from './photo-renderer.js';
import {initWardrobe,loadAppearance,saveAppearance} from './wardrobe.js';
import {unlockPose,unlockLeavePose,createUnlockPanel} from './skin-unlock.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const defaults = {player:'#252720', enemy:'#e88c72', bg:'#f4f3eb', sound:true, haptic:true, expressions:false, bgmVolume:.55, sfxVolume:.75};
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
const sound = new GameAudio();
let best = Number(storage.read('qiuqiule-best',0)) || 0;
let scene, game, world, drag = null, screen = 'home', paused = false, modal = null;
let transfer=null,uiAnchor=null,settingsOrigin='home',homeReveal=1,pauseOnArrival=false,releaseOverlay=0;
let result=null,controlFlight=null,menuTransition=null,selector=null,trackPointer=null,levelsReveal=1;
let levelPointer=null;
let campaignProgress=normalizeProgress(storage.read('qiuqiule-campaign',null));
let skins=normalizeSkins(storage.read('qiuqiule-skins',null),campaignProgress.completed);
let playerContour=skinContour(skins.enabled?skins.sides:0),skinTween=null,skinOverride=null;
let wardrobeUi=null,wardrobeTime=0,skinUnlock=null,appearance=null,appearanceUrl=null;
let photoCanvas=null,photoRenderer=null,glowCanvas=null,glowContext=null,lastUiPose=null;
let appearanceRevision=0;
let selectedMode=storage.read('qiuqiule-mode','campaign')==='endless'?'endless':'campaign';
let currentLevel=1;
const strainedEyes=[-1,1].map(strainedEyeOutline);
const relaxedEyes=strainedEyes.map(relaxedEyeOutline);
const playerVisuals=new WeakMap();
const crownPoints=crownOutline();
let viewport = displayMetrics(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
let home = new HomeWorld(viewport.width, viewport.height,selectedMode);
let lastScore = -1, lastPhase = '';
let toastTimer;
let homePlayColor = 0x9b89c5;
let homeSoundColor = 0xe88c72;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  $('meta[name=theme-color]').content = settings.bg;
  document.documentElement.style.colorScheme=dark?'dark':'light';
  for (const key of ['player','enemy','bg']) {$('#'+key+'-color').value=settings[key];$('#'+key+'-hex').textContent=settings[key].toUpperCase();}
  $$('.palette').forEach(b=>b.classList.toggle('active',['player','enemy','bg'].every(k=>settings[k]===palettes[b.dataset.palette][k])));
  syncAudioSettings();
  $('#haptic-toggle').setAttribute('aria-checked',String(settings.haptic));
  $('#expressions-toggle').setAttribute('aria-checked',String(settings.expressions));
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
function cancelDrag(){drag=null;levelPointer=null;world?.cancelPull();if(trackPointer!==null){trackPointer=null;selector?.cancelTrack();}}
function setSkinState(next){
  skins=next;storage.write('qiuqiule-skins',skins);
  skinTween={from:playerContour,to:skinContour(skins.enabled?skins.sides:0),elapsed:0};
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
  if(glowCanvas)glowCanvas.hidden=true;
}
function drawPlayerPhoto(contour,pose,ui=false){
  if(!appearance||!photoRenderer||wardrobeUi?.isCropping?.())return;
  photoCanvas.style.zIndex=ui?'40':'3';
  const clip=ui&&uiAnchor==='wardrobe'&&!transfer
    ?$('#wardrobe-panel .wardrobe-body').getBoundingClientRect():null;
  photoRenderer.draw(contour,pose,{scale:Math.min(viewport.scale,3),clip});
}
async function setAppearance(url,persist=false,revision=++appearanceRevision){
  let image=null;
  if(url){image=new Image();image.src=url;await image.decode();}
  if(revision!==appearanceRevision)return;
  if(persist)await saveAppearance(url);
  if(revision!==appearanceRevision)return;
  appearance=image;appearanceUrl=url;photoRenderer?.setImage(image);
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
}
function showPanel(name){
  resetMenuTransition();cancelDrag();modal=name;paused=screen==='play';
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
  if(anchor==='arena')return {...world.player};
  if(anchor==='home')return {...home.layout.player};
  const box=$('#'+anchor+'-ball').getBoundingClientRect();
  return {x:box.x+box.width/2,y:box.y+box.height/2,r:box.width/2};
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
function currentPlayerPose(){return skinUnlock&&lastUiPose?{...lastUiPose}:uiAnchor==='wardrobe'?resultBounce(anchorPose('wardrobe'),wardrobeTime,reducedMotion):uiAnchor==='over'?resultBounce(anchorPose('over'),result?.bounceTime||0,reducedMotion):uiAnchor?anchorPose(uiAnchor):screen==='home'?{...home.player}:screen==='levels'?selectionPlayerPose():{...world.player};}
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
  eyes.style.transform=`${visual&&!skinned?`scale(${1/(1-sq)},${1/(1+sq*.7)}) `:skinned&&!visual?`scale(${1-sq},${1+sq*.7}) `:''}translate(${(p.lookX||0)*50}px,${(p.lookY||0)*50}px) rotate(${p.roll||0}rad)`;
  eyes.style.opacity=visual?'.9':'';
  eyes.style.display=appearance?'none':'';
  if(wardrobeUi?.isCropping?.())el.hidden=true;
}
function movePlayer(from,target,duration,done){
  cancelDrag();transfer={from:{...from},target,duration:reducedMotion?Math.min(duration,.25):duration,elapsed:0,done,revealHome:screen==='home'&&homeReveal<1&&target==='home'};
  paintUiBall(from);syncInputs();
}
function updateUiBall(dt){
  updateMenuTransition(dt);
  $('#result-shadow').hidden=true;
  if(skinUnlock){updateSkinUnlock(dt);return;}
  if(result){
    result.clock+=dt;
    if(result.campaign){
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
    pose.lookX=(move.from.lookX||0)*(1-smooth(progress));pose.lookY=(move.from.lookY||0)*(1-smooth(progress));
    paintUiBall(pose);$('#ui-ball').dataset.state='moving';
    if(move.revealHome)homeReveal=smooth(progress);
    if(progress===1){
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
    $('#control-transfers').append(el);return {...item,el};
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
    el.style.background=mixColor(item.fromColor,item.toColor,t);
    el.firstElementChild.style.opacity=item.appear?t:item.persist?1:1-t;
    el.firstElementChild.style.transform=`rotate(${(1-t)*-.3}rad)`;
    if(item.nextIcon)el.lastElementChild.style.opacity=t;
  }
  if(progress===1){controlFlight=null;flight.done?.();$('#control-transfers').replaceChildren();syncInputs();}
}
function openResult(){
  if(!world||result||skinUnlock)return;
  const fromPause=modal==='pause',from=currentPlayerPose();
  const sources=fromPause?['restart','home'].map(id=>{
    const box=$('#pause-panel .'+id+'-ball').getBoundingClientRect();
    return {x:box.x+box.width/2,y:box.y+box.height/2,r:box.width/2};
  }):world.enemies.slice(0,2).map(b=>({...b,r:Math.max(1,b.r*ease(b.born))}));
  cancelDrag();world.phase='over';world.choices=[];updateChoices();
  const campaign=world.mode==='campaign';
  if(!campaign){best=Math.max(best,world.score);storage.write('qiuqiule-best',best);}
  if(campaign&&world.completed){
    const unlocked=unlockSkin(skins,world.level);
    skins=unlocked.state;storage.write('qiuqiule-skins',skins);wardrobeUi?.refresh();
    campaignProgress=normalizeProgress({completed:Math.max(campaignProgress.completed,world.level),unlocked:Math.max(campaignProgress.unlocked,Math.min(100,world.level+1))});
    storage.write('qiuqiule-campaign',campaignProgress);
    if(unlocked.rewardSides){beginSkinUnlock(from,sources,unlocked.rewardSides);return;}
  }
  presentResult(from,fromPause,sources);
}
function presentResult(from,fromPause,sources,duration=.82){
  const campaign=world.mode==='campaign';
  $('#over-panel').classList.toggle('campaign',campaign);
  const levelsWrap=$('.result-levels-wrap');levelsWrap.hidden=!campaign;
  $('#final-score').style.transform='scale(1)';
  $('#final-score').textContent=campaign?'0%':pad(world.score);
  result={clock:0,bounceTime:0,campaign,percent:campaign?progressPercent(world.kills,world.totalEnemies):0,completed:!!world.completed,displayed:0,lastTone:0,sourceIds:fromPause?[]:sources.map(b=>b.id)};
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
  const from={...world.player};paused=true;showPanel('pause');movePlayer(from,'pause',.42);
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
function clearEffects(){for(const e of scene.effects)e.label?.destroy();scene.effects=[];}
function prepareGame(){
  // A new run owns no animation, particle, input or clock state from the old run.
  cancelDrag();result=null;transfer=null;controlFlight=null;uiAnchor=null;
  skinUnlock=null;skinOverride=null;clearPhoto();
  releaseOverlay=0;pauseOnArrival=false;
  $('#control-transfers').replaceChildren();$('#ui-ball').hidden=true;$('#result-shadow').hidden=true;
  $('.result-actions').classList.remove('arriving');
  scene.g.clear();clearEffects();scene.accumulator=0;scene.clock=0;scene.hitSoundAt=0;
  world=selectedMode==='campaign'?new CampaignWorld(viewport.width,viewport.height,currentLevel):new World(viewport.width,viewport.height);screen='play';
  clearTimeout(toastTimer);$('#toast').classList.remove('show');
  lastScore=-1;lastPhase='';
  trackPointer=null;$('#levels-view').setAttribute('hidden','');
  $('#hud').classList.toggle('campaign',selectedMode==='campaign');
  $('#home').hidden=true;$('#home').style.opacity=1;$('#hud').hidden=false;$('#hud').style.opacity=1;
  $('.pause-button').disabled=false;updateHud();
}
function syncMode(){
  selectedMode=home.mode;storage.write('qiuqiule-mode',selectedMode);
  $('#home-mode').setAttribute('aria-label',selectedMode==='campaign'?'当前闯关模式，撞击切换为无尽模式':'当前无尽模式，撞击切换为闯关模式');
  $('#home-play').setAttribute('aria-label',selectedMode==='campaign'?'撞击开始球进入选关':'撞击开始球进入无尽模式');
}
function openLevels(from=currentPlayerPose()){
  if(transfer||controlFlight)return;
  hidePanel();selectedMode='campaign';screen='levels';world=null;result=null;drag=null;trackPointer=null;levelPointer=null;paused=false;
  selector=new LevelSelector(viewport.width,viewport.height,campaignProgress.unlocked);
  $('#home').hidden=true;$('#hud').hidden=true;$('#choice-labels').innerHTML='';
  $('#levels-view').removeAttribute('hidden');levelsReveal=0;clearEffects();
  rebuildLevels();movePlayer(from,'levels',.65);
  $('#level-announcement').textContent=`已解锁 ${campaignProgress.unlocked} 关。点击关卡小球进入，点击下方返回球回到主页，沿圆环滑动浏览。`;
}
function enterLevel(level){
  if(level>campaignProgress.unlocked||transfer||controlFlight)return;
  currentLevel=level;selectedMode='campaign';
  const from=selectionPlayerPose();prepareGame();paused=true;
  movePlayer(from,'arena',.65,finishArenaArrival);tone(420,.24,'sine',.055,1.7);
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
    numberMeasureContext.font='500 1000px BallScore, sans-serif';
    numberMeasureContext.textAlign='left';numberMeasureContext.textBaseline='alphabetic';
    const m=numberMeasureContext.measureText(String(level));
    numberCenters.set(level,{x:(m.actualBoundingBoxLeft-m.actualBoundingBoxRight)/2000,y:(m.actualBoundingBoxAscent-m.actualBoundingBoxDescent)/2000});
  }
  const center=numberCenters.get(level)||{x:-String(level).length*.25,y:.34};
  return `<text x="${center.x*size}" y="${center.y*size}" font-size="${size}">${level}</text>`;
}
document.fonts?.ready.then(()=>numberCenters.clear());
function renderLevels(){
  const sphere=(b,content,color)=>`<g transform="translate(${b.x} ${b.y}) scale(${b.r*(b.sx||1)} ${b.r*(b.sy||1)})"><circle r="1" fill="${color}"/>${content}</g>`;
  const icon=type=>iconMarkup(type).replace('<svg ','<svg x="-1" y="-1" width="2" height="2" ');
  $('#level-orbs').innerHTML=selector.visibleBalls.map(b=>sphere(b,b.unlocked?levelNumberMarkup(b.level):icon('lock'),b.unlocked?'#9b89c5':'#b6bdb0')).join('');
  $('#level-return').innerHTML=sphere(selector.layout.returnBall,icon('home'),'#91b8c7');
  $('#levels-view').style.opacity=smooth(levelsReveal);
}
function startGame(){
  hidePanel();prepareGame();paused=false;syncInputs();tone(280,.12,'sine',.04,1.5);
}
function restartGame(){
  if(transfer||controlFlight||!scene)return;
  const from=currentPlayerPose();
  hidePanel();prepareGame();paused=true;
  movePlayer(from,'arena',.65,finishArenaArrival);
}
function showHome(){
  if(transfer||controlFlight)return;
  const from=currentPlayerPose();hidePanel();screen='home';cancelDrag();world=null;paused=false;result=null;
  $('#control-transfers').replaceChildren();$('#result-shadow').hidden=true;
  home=new HomeWorld(viewport.width,viewport.height,selectedMode);homeReveal=0;
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

function updateChoices(){
  const active=world.phase==='transition'||world.phase==='choose';
  $('#choice-labels').innerHTML=active?world.choices.map(c=>`<div class="choice-label" style="left:${c.x}px;top:${c.y+c.r+14}px;opacity:${world.phase==='transition'?.4:1}"><h3>${c.name}</h3></div>`).join(''):'';
}
function updateHud(){
  if(!world)return;
  if(world.mode!=='campaign'&&world.score!==lastScore){lastScore=world.score;$('#score').textContent=pad(world.score);}
  if(lastPhase!==world.phase){lastPhase=world.phase;updateChoices();}
}

function polygon(graphics,x,y,r,sides,rotation,color,alpha=1){
  graphics.fillStyle(color,alpha);graphics.beginPath();
  for(let i=0;i<sides;i++){const a=rotation+i*Math.PI*2/sides;const px=x+Math.cos(a)*r,py=y+Math.sin(a)*r;i?graphics.lineTo(px,py):graphics.moveTo(px,py);}
  graphics.closePath();graphics.fillPath();
}
function ring(g,x,y,r,color,alpha=1,width=1,start=0,end=Math.PI*2){g.lineStyle(width,color,alpha);g.beginPath();g.arc(x,y,r,start,end);g.strokePath();}

function drawDragGuide(g,p){
  if(!drag)return;
  const distance=Math.hypot(drag.dx,drag.dy);
  if(distance<=3)return;
  const power=clamp(distance/(screen==='levels'?selector.maxPull:world.maxPull),0,1);
  const nx=-drag.dx/distance,ny=-drag.dy/distance;
  const color=hex(settings.player);
  for(let i=1;i<=7;i++){
    const d=p.r+12+i*(8+power*8);
    g.fillStyle(color,.36*(1-i/9));
    g.fillCircle(p.x+nx*d,p.y+ny*d,1.7);
  }
  if(screen!=='levels'){
    const tip=p.r+12+7*(8+power*8);
    const ax=p.x+nx*tip,ay=p.y+ny*tip;
    g.lineStyle(1.4,color,.35);g.beginPath();
    g.moveTo(ax-nx*6-ny*4,ay-ny*6+nx*4);
    g.lineTo(ax,ay);g.lineTo(ax-nx*6+ny*4,ay-ny*6-nx*4);g.strokePath();
  }
  const pull=Math.min(distance,screen==='levels'?selector.maxPull:world.maxPull);
  const tx=drag.x+drag.dx/distance*pull,ty=drag.y+drag.dy/distance*pull;
  g.lineStyle(1,color,.12);g.lineBetween(drag.x,drag.y,tx,ty);
  ring(g,drag.x,drag.y,4,color,.17,1);
  ring(g,tx,ty,8,color,.17,1);
}

function drawBoss(g,b,alpha=1){
  const pose=bossFacePose({entryTime:world.phase==='boss-entry'?world.phaseTime:Infinity,
    stunned:b.stunned,stunnedTime:b.stunnedTime||0,time:b.stunnedTime||0,reducedMotion});
  const r=b.r*pose.scale,opacity=alpha*pose.alpha;
  if(r<.3||opacity<=0)return;
  const color=hex(settings.enemy);
  // Precompose 40% black over 60% body color so overlapping spiral caps stay uniform.
  const eyeChannel=shift=>Math.round(((color>>shift)&255)*.6);
  const face=(eyeChannel(16)<<16)|(eyeChannel(8)<<8)|eyeChannel(0);
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

function drawBall(g,b,color,alpha=1,pull=null,birth=null){
  const born=birth?.scale??(b.isPlayer?1:ease(b.born));
  const r=b.r*born;
  if(r<.3)return;
  const angle=pull?Math.atan2(pull.dy,pull.dx):b.angle;
  const amount=pull?clamp(Math.hypot(pull.dx,pull.dy)/(screen==='home'?home.maxPull:(screen==='levels'?selector.maxPull:(world?.maxPull||150))),0,1):0;
  const cos=Math.cos(angle),sin=Math.sin(angle);
  const phase=screen==='home'?home.phase:screen==='levels'?selector.phase:null;
  let visual;
  if(b.isPlayer){
    visual=playerVisualState(playerVisuals.get(b),{phase,
      strained:usesStrainedEyes(settings.expressions,drag,phase),expressions:settings.expressions,
      pulling:!!pull,dt:scene?.frameDt??1/60});
    playerVisuals.set(b,visual);
  }
  // Restart breathing at the round rebound/overlay endpoint, independently of
  // the old breathing phase and the clock driving the other home animations.
  const menuPlayer=b.isPlayer&&(screen==='home'||screen==='levels');
  const breathing=screen==='home'?home.animate:!reducedMotion;
  const squash=pull?0:menuPlayer&&phase==='idle'
    ?breathing?Math.sin(visual.idleAge*1.3)*.035:0:b.squash;
  if(visual){
    visual.renderedSquash=squash;
    visual.renderedPull=pull?{amount,angle}:null;
  }
  g.fillStyle(color,alpha*(birth?.alpha??born));g.beginPath();
  const segments=192;
  const roll=b.roll??(world?.phase==='transition'?Math.PI*2*ease(world.phaseTime/1.45):0);
  const skinPose={x:b.x,y:b.y,r,squash,deformAngle:angle,pullAmount:amount,roll};
  if(b.isPlayer&&usesSkinContour()){
    const points=projectSkinContour(activeContour(),skinPose);
    [...points,points[0]].forEach((point,i)=>i?g.lineTo(point.x,point.y):g.moveTo(point.x,point.y));
  }else for(let i=0;i<=segments;i++){
    const t=i/segments*Math.PI*2,ct=Math.cos(t),st=Math.sin(t);
    // Home, selection, both battle modes and rebound share the same smooth join.
    const point=pullBallPoint(ct,st,amount);
    const lx=r*point.x*(1-squash),ly=r*point.y*(1+squash*.7);
    const x=b.x+lx*cos-ly*sin,y=b.y+lx*sin+ly*cos;
    i?g.lineTo(x,y):g.moveTo(x,y);
  }
  g.closePath();g.fillPath();
  if(b.isPlayer){
    if(appearance){drawPlayerPhoto(activeContour(),skinPose);return;}
    const face=isDark(settings.player)?0xf4f3eb:0x252720;
    const onScreen=levelPointer&&levelPointer.x>=0&&levelPointer.x<=viewport.width&&levelPointer.y>=0&&levelPointer.y<=viewport.height;
    const target=screen==='levels'?pointerFaceTarget(b,onScreen?levelPointer:null)
      :faceTarget(b,pull,screen==='home'?home.maxPull:(world?.maxPull||150));
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
          const px=b.x+x*rc-y*rs,py=b.y+x*rs+y*rc;
          j?g.lineTo(px,py):g.moveTo(px,py);
        });
        g.closePath();g.fillPath();
      }else g.fillEllipse(b.x+ex*rc-ey*rs,b.y+ex*rs+ey*rc,r*.105,r*.19,64);
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
    if(paused||modal||transfer||controlFlight||!e.isPrimary||e.button>0)return;
    const point=position(e);
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
    if(screen==='play'&&!world.beginPull())return;
    unlockAudio();
    drag={id:e.pointerId,x:point.x,y:point.y,dx:0,dy:0};canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove',e=>{
    if(screen==='levels'&&levelPointer?.id===e.pointerId){
      const p=position(e);moveLevelPointer(p);
      if(trackPointer===e.pointerId&&levelPointer.moved)selector.moveTrack(p.x,p.y,e.timeStamp/1000);
      if(drag?.id===e.pointerId){drag.dx=p.x-drag.x;drag.dy=p.y-drag.y;}
      e.preventDefault();return;
    }
    if(!drag||drag.id!==e.pointerId)return;
    const p=position(e);drag.dx=p.x-drag.x;drag.dy=p.y-drag.y;e.preventDefault();
  });
  canvas.addEventListener('pointerup',e=>{
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
    if(!paused&&!modal){
      if(screen==='home'&&home.shoot(drag.dx,drag.dy)){tone(220+home.power*190,.15,'sine',.045,.4);vibrate(9);}
      else if(screen==='play'&&world)world.shoot(drag.dx,drag.dy);
    }
    cancelDrag();if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
  });
  const cancelPointer=e=>{
    if(e.pointerId===drag?.id||e.pointerId===levelPointer?.id||e.pointerId===trackPointer)cancelDrag();
  };
  canvas.addEventListener('pointercancel',cancelPointer);
  canvas.addEventListener('lostpointercapture',cancelPointer);
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
}

function boot(){
  if(!window.Phaser){toast('引擎未能加载，请联网刷新后重试');return;}
  class BallScene extends Phaser.Scene {
    constructor(){super('BallScene');this.accumulator=0;this.effects=[];this.clock=0;this.hitSoundAt=0;}
    create(){
      scene=this;
      initializeSkins();
      this.textures.addCanvas('skin-radiance',createRadianceCanvas(document));
      this.radiance=this.add.image(0,0,'skin-radiance').setVisible(false);
      this.g=this.add.graphics();this.cameras.main.setBackgroundColor(settings.bg);bindInput(this.game.canvas);
      const resize=()=>{
        const next=displayMetrics(window.innerWidth,window.innerHeight,window.devicePixelRatio||1);
        const geometryChanged=next.width!==viewport.width||next.height!==viewport.height;
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
        if(geometryChanged){cancelDrag();if(selector){selector.resize(viewport.width,viewport.height);if(screen==='levels')rebuildLevels();}home.resize(viewport.width,viewport.height);if(world){world.resize(viewport.width,viewport.height);updateChoices();}}
        layoutHomeControl();
        if(['settings','help','menu-transition'].includes(modal))fitMenuHeight();
      };
      resize();
      window.addEventListener('resize',resize);
      this.events.once('shutdown',()=>{window.removeEventListener('resize',resize);photoRenderer?.dispose();});
    }

    particles(e,color,count=7){
      for(let i=0;i<count;i++){
        const angle=i/count*Math.PI*2+Math.random()*.4,spd=(30+Math.random()*80)*(e.r/24);
        const r=e.r*(.22+Math.random()*.17);
        this.effects.push({type:'shard',x:e.x+Math.cos(angle)*e.r*.3,y:e.y+Math.sin(angle)*e.r*.3,vx:Math.cos(angle)*spd+(e.vx||0)*.08,vy:Math.sin(angle)*spd+(e.vy||0)*.08,r,angle,spin:(Math.random()-.5)*8,life:0,total:.5+Math.random()*.22,color,sides:3+Math.floor(Math.random()*2)});
      }
    }
    handleEvents(){
      for(const e of world.events.splice(0)){
        if(e.type==='shoot'){tone(220+e.power*190,.19,'sine',.07,.35);vibrate(9);}
        if(e.type==='wall'){
          if(this.clock-this.hitSoundAt>.07){tone(100+e.power*80,.07,'sine',.035);this.hitSoundAt=this.clock;}
        }
        if(e.type==='hit'){
          if(this.clock-this.hitSoundAt>.05){tone(180,.08,'triangle',.04,.4);this.hitSoundAt=this.clock;}
          if(e.power>.35)vibrate(12);
        }
        if(e.type==='kill'){
          this.particles(e,hex(settings.enemy));
          if(world.mode!=='campaign'&&world.score>best){best=world.score;storage.write('qiuqiule-best',best);}
          tone(500+Math.random()*120,.13,'sine',.06,1.5);vibrate(15);
        }
        if(e.type==='shatter')this.particles(e,hex(settings.enemy),5);
        if(e.type==='bossEntry'){cancelDrag();tone(260,.35,'sine',.045,1.5);}
        if(e.type==='bossReady')tone(520,.14,'triangle',.035,1.15);
        if(e.type==='bossHit'){
          tone(260+Math.min(1,e.power||0)*220,.095,'triangle',.045,1.3);vibrate(9);
        }
        if(e.type==='bossScore'||e.type==='bossDefeated'){
          if(world.score>best){best=world.score;storage.write('qiuqiule-best',best);}
          const label=this.add.text(e.x,e.y,'+'+e.value,{fontFamily:'GameSans, sans-serif',fontSize:e.type==='bossDefeated'?'22px':'18px',color:settings.player,fontStyle:'bold'}).setOrigin(.5).setScale(viewport.scale);
          const labelY=e.type==='bossDefeated'?e.y+(e.r||world.player.r)+24:e.y-(e.r||world.player.r)-12;
          this.effects.push({type:'label',label,life:0,total:1,x:e.x,y:labelY});
          if(e.type==='bossScore'){tone(600+(e.segment||0)*90,.13,'sine',.045,1.25);vibrate(10);}
          else{cancelDrag();this.particles(e,hex(settings.enemy),12);vibrate([12,25,18]);}
        }
        if(e.type==='bossCelebrate')sound.bossVictory();
        if(e.type==='upgrade'){cancelDrag();tone(480,.25,'sine',.05,1.5);}
        if(e.type==='choiceReady')tone(660,.13,'sine',.035,1.2);
        if(e.type==='buff'){
          this.particles(e,hex(e.buff.color),10);
          tone(700,.3,'sine',.06,1.5);vibrate([12,30,12]);
        }
        if(e.type==='campaignBuff'){
          const label=this.add.text(e.x??world.player.x,e.y??world.player.y,e.label,{fontFamily:'GameSans, sans-serif',fontSize:'15px',color:settings.player,fontStyle:'bold'}).setOrigin(.5).setScale(viewport.scale);
          this.effects.push({type:'label',label,life:0,total:1.15,x:e.x??world.player.x,y:(e.y??world.player.y)-world.player.r-10});
          tone(700,.2,'sine',.045,1.4);vibrate(10);
        }
        if(e.type==='over'){
          openResult();tone(160,.4,'sine',.06,.4);vibrate([20,40,30]);
        }
      }
    }
    drawBorder(bounds=null){
      const g=this.g,w=viewport.width,h=viewport.height;
      const border=isDark(settings.bg)?0x636f64:0xc8ccbd;
      const full={left:16,top:16,right:w-16,bottom:h-16};
      const frame=bounds||full,returning=result?smooth(result.clock/.65):0;
      const x=lerp(frame.left,full.left,returning)-1,y=lerp(frame.top,full.top,returning)-1;
      const right=lerp(frame.right,full.right,returning)+1,bottom=lerp(frame.bottom,full.bottom,returning)+1;
      g.lineStyle(1,border,.65);g.strokeRoundedRect(x,y,right-x,bottom-y,22);
    }
    drawHome(){
      const g=this.g,fade=home.fade*homeReveal,t=reducedMotion?0:home.clock;
      this.drawBorder();
      const {player:anchor,base,orbitCenter}=home.layout;
      const orbit=Math.min(base*2.65,viewport.height*.30);
      const line=isDark(settings.bg)?0x637068:0xb8bead;
      ring(g,orbitCenter.x,orbitCenter.y,orbit,line,.35*fade,1);
      ring(g,orbitCenter.x,orbitCenter.y,orbit*.69,line,.17*fade,1);
      for(let i=0;i<13;i++){
        const u=i/12,px=anchor.x-base*2.45+u*base*1.55,py=anchor.y+base*1.3-u*u*base*.87;
        g.fillStyle(line,(.18+u*.35)*fade);g.fillCircle(px,py,1.5+u*.5);
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
        $('#choice-labels').innerHTML='';$('.pause-button').disabled=true;
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
      const p=world.player;
      if(world.boss&&!world.boss.defeated){
        const b=world.boss,alpha=result?1-smooth(result.clock/.65):1;
        drawBoss(g,b,alpha);
      }
      for(const b of world.enemies){
        if(result?.sourceIds.includes(b.id))continue;
        const alpha=result?1-smooth(result.clock/.65):1;
        drawBall(g,b,hex(settings.enemy),alpha);
        if(result)continue;
        if(b.hit>.01){g.fillStyle(isDark(settings.enemy)?0xffffff:0xf9f8f0,b.hit*.5);g.fillEllipse(b.x,b.y,b.r*1.7,b.r*1.7,128);}
      }
      for(const c of world.choices){
        const appear=ease(c.born),r=c.r*appear;
        if(r<1)continue;
        const bob=world.phase==='choose'&&!reducedMotion?Math.sin(this.clock*2+c.x)*2:0;
        g.fillStyle(hex(c.color),appear);g.fillEllipse(c.x,c.y+bob,r*2,r*2,192);
        polygon(g,c.x,c.y+bob,r*.27,c.sides,c.sides===4?Math.PI/4:-Math.PI/2,c.sides===4?0x573d30:0x293629,appear);
      }
      if(!detached()){drawDragGuide(g,p);drawBall(g,p,hex(settings.player),1,drag);}
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
      if(!detached()&&world.mode==='campaign'&&p.hit>.01){g.fillStyle(isDark(settings.player)?0xffffff:0xf9f8f0,p.hit*.5);g.fillEllipse(p.x,p.y,p.r*1.7,p.r*1.7,128);}
      for(const e of this.effects){
        if(e.type==='label'){e.label.setVisible(!modal).setPosition(e.x*viewport.scale,(e.y-e.life*32)*viewport.scale).setAlpha(1-e.life/e.total);continue;}
        const t=e.life/e.total;
        polygon(g,e.x,e.y,e.r*(1-t*.3),e.sides,e.angle,e.color,(1-t*t)*(result?1-smooth(result.clock/.65):1));
      }
    }
    update(_,delta){
      const dt=Math.min(delta/1000,.05);this.frameDt=dt;this.clock+=dt;this.g.clear();
      clearPhoto();updateSkin(dt);this.radiance?.setVisible(false);
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
        if(!detached())drawBall(this.g,selector.player,hex(settings.player),1,drag||selector.pull);
        else playerVisuals.delete(selector.player);
        updateUiBall(dt);
        return;
      }
      if(!world)return;
      if(!paused){
        this.accumulator+=dt;
        while(this.accumulator>=1/120){world.step(1/120,!!drag);this.accumulator-=1/120;if(world.phase==='over')break;}
        this.handleEvents();
        if(drag&&!world.ready)cancelDrag();
        for(const e of this.effects){e.life+=dt;if(e.type==='shard'){e.x+=e.vx*dt;e.y+=e.vy*dt;e.angle+=e.spin*dt;}}
        this.effects=this.effects.filter(e=>{if(e.life>=e.total){e.label?.destroy();return false;}return true;}).slice(-160);
      }else this.accumulator=0;
      this.drawArena();updateHud();updateUiBall(dt);
    }
  }
  game=new Phaser.Game({type:Phaser.AUTO,parent:'game',backgroundColor:settings.bg,scale:{mode:Phaser.Scale.NONE,width:viewport.bufferWidth,height:viewport.bufferHeight,zoom:1/viewport.scale,autoRound:false},scene:BallScene,render:{antialias:true,antialiasGL:true,transparent:false,roundPixels:false},input:{activePointers:2},audio:{noAudio:true},fps:{target:60,forceSetTimeOut:false},banner:false});
}

// Programmatic menu focus must not leave a touch/mouse halo on round buttons.
document.addEventListener('pointerdown',()=>{document.documentElement.dataset.inputMode='pointer';},{capture:true});
document.addEventListener('keydown',e=>{
  if(!e.metaKey&&!e.ctrlKey&&!e.altKey)document.documentElement.dataset.inputMode='keyboard';
},{capture:true});

document.addEventListener('click',e=>{
  if(skinUnlock){if(skinUnlock.ready)dismissSkinUnlock();return;}
  const button=e.target.closest('[data-action]');if(!button||transfer||controlFlight)return;
  unlockAudio();tone(680,.035,'sine',.02,1.15);
  const action=button.dataset.action;
  if(action.startsWith('home-')&&e.detail===0&&screen==='home'&&!modal)home.launchTo(action==='home-launch'?'play':action.slice(5));
  if(action==='levels'&&modal==='over')openLevels();
  if(action==='restart')restartGame();
  if(action==='home'){if(modal==='pause')openResult();else showHome();}
  if(action==='pause')openPause();
  if(action==='resume')resumeGame();
  if(action==='close')closePanel();
  if(action==='settings')openSettings();
  if(action==='help')openHelp();
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
document.addEventListener('keydown',e=>{
  if(transfer||controlFlight){if(e.key==='Escape')e.preventDefault();return;}
  if(e.key==='Escape'){
    if(modal&&modal!=='over')closePanel();else if(screen==='play'&&world.phase!=='over')setPanel('pause');
  }
  if(e.key==='Tab'&&modal){
    const elements=[...$('#'+modal+'-panel').querySelectorAll('button,input')],first=elements[0],last=elements.at(-1);
    if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}
    else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}
  }
});
function pauseForInterruption(){
  cancelDrag();
  if(screen!=='play'||modal||world?.phase==='over')return;
  if(transfer)pauseOnArrival=true;else openPause();
}
document.addEventListener('visibilitychange',()=>{sound.setHidden(document.hidden);if(document.hidden)pauseForInterruption();});
window.addEventListener('pagehide',()=>sound.setHidden(true));
window.addEventListener('pageshow',()=>sound.setHidden(document.hidden));
window.addEventListener('blur',pauseForInterruption);
$('#buff-guide').innerHTML=BUFFS.map(b=>`<article class="buff-explanation"><span aria-hidden="true">${b.sides===3?'△':b.sides===4?'□':'⬠'}</span><div><h3>${b.name}<small>${b.short}</small></h3><p>${b.detail}${b.id==='growth'?'':b.kind==='special'?' 每种特殊能力只能获得一次。':' 可叠加。'}</p></div></article>`).join('');
$$('[data-icon]').forEach(button=>button.innerHTML=iconMarkup(button.dataset.icon));
applyTheme();syncMode();layoutHomeControl();
if(document.readyState==='complete')boot();else window.addEventListener('load',boot,{once:true});
