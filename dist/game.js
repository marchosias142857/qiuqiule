import {World, BUFFS, clamp, ease} from './physics.js';
import {displayMetrics, pointerPosition} from './display.js';
import {HomeWorld} from './home.js';
import {drawFunctionalBall,iconMarkup} from './icons.js';
import {smooth,faceTarget,smoothFace,transferPose,resultBounce,strainedEyeOutline,usesStrainedEyes} from './motion.js';
import {GameAudio,audioLevel} from './audio.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const defaults = {player:'#252720', enemy:'#e88c72', bg:'#f4f3eb', sound:true, haptic:true, expressions:false, bgmVolume:.55, sfxVolume:.75};
const palettes = {classic:{player:'#252720',enemy:'#e88c72',bg:'#f4f3eb'},night:{player:'#c9e88b',enemy:'#b2a2dc',bg:'#22272b'},pool:{player:'#205c67',enemy:'#eea752',bg:'#e7f2ee'}};
const hex = v => parseInt(v.slice(1), 16);
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
let result=null,controlFlight=null,menuTransition=null;
const strainedEyes=[-1,1].map(strainedEyeOutline);
let viewport = displayMetrics(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
let home = new HomeWorld(viewport.width, viewport.height);
let lastScore = -1, lastPhase = '';
let toastTimer;
let homePlayColor = 0x9b89c5;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function isDark(color) {const n=hex(color);return ((n>>16)*.299+((n>>8)&255)*.587+(n&255)*.114)<135;}
function applyTheme() {
  const dark = isDark(settings.bg);
  // Keep the start ball distinct even when player/enemy colors are customized.
  const used=[hex(settings.player),hex(settings.enemy),0xc4dc86,0xb4ced4,hex(settings.bg)];
  const candidates=[0x9b89c5,0xb87859,0x548b88,0xba738d];
  const separation=color=>Math.min(...used.map(other=>[16,8,0].reduce((sum,shift)=>sum+(((color>>shift)&255)-((other>>shift)&255))**2,0)));
  homePlayColor=candidates.find(color=>separation(color)>=70**2)??candidates.sort((a,b)=>separation(b)-separation(a))[0];
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
function cancelDrag(){drag=null;world?.cancelPull();}
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
function hidePanel(){resetMenuTransition();modal=null;$('#modal-layer').hidden=true;syncInputs();}
function setPanel(name){if(name==='pause')openPause();else showPanel(name);}
function anchorPose(anchor){
  if(anchor==='arena')return {...world.player};
  if(anchor==='home')return {...home.layout.player};
  const box=$('#'+anchor+'-ball').getBoundingClientRect();
  return {x:box.x+box.width/2,y:box.y+box.height/2,r:box.width/2};
}
function currentPlayerPose(){return uiAnchor==='over'?resultBounce(anchorPose('over'),result?.bounceTime||0,reducedMotion):uiAnchor?anchorPose(uiAnchor):screen==='home'?{...home.player}:{...world.player};}
function detached(){return !!transfer||!!uiAnchor||['pause','settings','help'].includes(modal);}
function paintUiBall(p){
  const el=$('#ui-ball'),sq=p.squash||0;
  el.hidden=false;el.style.width=el.style.height=p.r*2+'px';
  el.style.transform=`translate3d(${p.x-p.r}px,${p.y-p.r}px,0) scale(${1-sq},${1+sq*.7})`;
  el.querySelector('.ui-eyes').style.transform=`translate(${(p.lookX||0)*50}px,${(p.lookY||0)*50}px) rotate(${p.roll||0}rad)`;
}
function movePlayer(from,target,duration,done){
  cancelDrag();transfer={from:{...from},target,duration:reducedMotion?Math.min(duration,.25):duration,elapsed:0,done,revealHome:screen==='home'&&homeReveal<1&&target==='home'};
  paintUiBall(from);syncInputs();
}
function updateUiBall(dt){
  updateMenuTransition(dt);
  $('#result-shadow').hidden=true;
  if(result)result.clock+=dt;
  if(transfer){
    const move=transfer;move.elapsed+=dt;
    const progress=clamp(move.elapsed/move.duration,0,1),pose=transferPose(move.from,anchorPose(move.target),progress);
    pose.lookX=(move.from.lookX||0)*(1-smooth(progress));pose.lookY=(move.from.lookY||0)*(1-smooth(progress));
    paintUiBall(pose);$('#ui-ball').dataset.state='moving';
    if(move.revealHome)homeReveal=smooth(progress);
    if(progress===1){
      transfer=null;uiAnchor=['pause','settings','over'].includes(move.target)?move.target:null;
      move.done?.();if(!uiAnchor&&!transfer)releaseOverlay=1;syncInputs();
      if(modal&&!transfer)$('#'+modal+'-panel').querySelector('button')?.focus({preventScroll:true});
    }
  }
  if(!transfer){
    $('#ui-ball').dataset.state=uiAnchor||'hidden';
    if(uiAnchor){
      const pose=anchorPose(uiAnchor),panel=$('#'+uiAnchor+'-panel').getBoundingClientRect();
      if(uiAnchor==='over'&&result){
        result.bounceTime+=dt;
        const bouncing=resultBounce(pose,result.bounceTime,reducedMotion);
        paintUiBall(bouncing);
        const shadow=$('#result-shadow');shadow.hidden=false;
        shadow.style.width=pose.r*1.75+'px';shadow.style.height=pose.r*.25+'px';
        shadow.style.transform=`translate3d(${pose.x-pose.r*.875}px,${bouncing.shadowY}px,0) scale(${bouncing.shadowScale},${bouncing.shadowScale})`;
        shadow.style.opacity=bouncing.shadowOpacity;shadow.style.filter=`blur(${bouncing.shadowBlur}px)`;
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
function flyControls(items,duration,done){
  $('#control-transfers').replaceChildren();
  controlFlight={items:items.map(item=>{
    const el=document.createElement('div');el.className='control-transfer';el.innerHTML=iconMarkup(item.icon)+(item.nextIcon?iconMarkup(item.nextIcon):'');
    $('#control-transfers').append(el);return {...item,el};
  }),elapsed:0,duration:reducedMotion?Math.min(.25,duration):duration,done};
  updateControlFlight(0);syncInputs();
}
function updateControlFlight(dt){
  if(!controlFlight)return;
  const flight=controlFlight;flight.elapsed+=dt;
  const progress=clamp(flight.elapsed/flight.duration,0,1),t=smooth(progress);
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
  if(!world||result)return;
  const fromPause=modal==='pause',from=currentPlayerPose();
  const sources=fromPause?['restart','home'].map(id=>{
    const box=$('#pause-panel .'+id+'-ball').getBoundingClientRect();
    return {x:box.x+box.width/2,y:box.y+box.height/2,r:box.width/2};
  }):world.enemies.slice(0,2).map(b=>({...b,r:Math.max(1,b.r*ease(b.born))}));
  cancelDrag();world.phase='over';world.choices=[];updateChoices();
  best=Math.max(best,world.score);storage.write('qiuqiule-best',best);
  $('#final-score').textContent=pad(world.score);
  result={clock:0,bounceTime:0,sourceIds:fromPause?[]:sources.map(b=>b.id)};
  $('#hud').hidden=true;
  showPanel('over');$('.result-actions').classList.add('arriving');
  movePlayer(from,'over',.82);
  flyControls(['restart','home'].map((id,i)=>({
    from:sources[i]||from,to:()=>controlPose(id),icon:id,
    fromColor:fromPause?(i?'#91b8c7':'#e88c72'):settings.enemy,
    toColor:i?'#91b8c7':'#e88c72',appear:!fromPause,persist:fromPause
  })),.82,()=>$('.result-actions').classList.remove('arriving'));
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
  if(modal==='menu-transition'){menuTransition=null;showPanel('settings');uiAnchor='settings';paintUiBall(anchorPose('settings'));return;}
  if(modal==='help'){transitionMenu('settings');return;}
  if(modal==='pause'){resumeGame();return;}
  if(modal==='settings'){
    const from=anchorPose('settings');
    if(settingsOrigin==='pause'){showPanel('pause');movePlayer(from,'pause',.5);}
    else{hidePanel();home.reset();movePlayer(from,'home',.5);}
  }
}
function prepareGame(){
  // A new run owns no animation, particle, input or clock state from the old run.
  cancelDrag();result=null;transfer=null;controlFlight=null;uiAnchor=null;
  releaseOverlay=0;pauseOnArrival=false;
  $('#control-transfers').replaceChildren();$('#ui-ball').hidden=true;$('#result-shadow').hidden=true;
  $('.result-actions').classList.remove('arriving');
  scene.g.clear();scene.effects=[];scene.accumulator=0;scene.clock=0;scene.hitSoundAt=0;
  world=new World(viewport.width,viewport.height);screen='play';
  clearTimeout(toastTimer);$('#toast').classList.remove('show');
  lastScore=-1;lastPhase='';
  $('#home').hidden=true;$('#home').style.opacity=1;$('#hud').hidden=false;$('#hud').style.opacity=1;
  $('.pause-button').disabled=false;updateHud();
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
  home=new HomeWorld(viewport.width,viewport.height);homeReveal=0;
  $('#home').hidden=false;$('#home').style.opacity=0;$('#hud').hidden=true;$('#hud').style.opacity=1;
  layoutHomeControl();scene.effects=[];
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
  if(world.score!==lastScore){lastScore=world.score;$('#score').textContent=pad(world.score);}
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
  const power=clamp(distance/world.maxPull,0,1);
  const nx=-drag.dx/distance,ny=-drag.dy/distance;
  const color=hex(settings.player);
  for(let i=1;i<=7;i++){
    const d=p.r+12+i*(8+power*8);
    g.fillStyle(color,.36*(1-i/9));
    g.fillCircle(p.x+nx*d,p.y+ny*d,1.7);
  }
  const tip=p.r+12+7*(8+power*8);
  const ax=p.x+nx*tip,ay=p.y+ny*tip;
  g.lineStyle(1.4,color,.35);g.beginPath();
  g.moveTo(ax-nx*6-ny*4,ay-ny*6+nx*4);
  g.lineTo(ax,ay);g.lineTo(ax-nx*6+ny*4,ay-ny*6-nx*4);g.strokePath();
  const pull=Math.min(distance,world.maxPull);
  const tx=drag.x+drag.dx/distance*pull,ty=drag.y+drag.dy/distance*pull;
  g.lineStyle(1,color,.12);g.lineBetween(drag.x,drag.y,tx,ty);
  ring(g,drag.x,drag.y,4,color,.17,1);
  ring(g,tx,ty,8,color,.17,1);
}

function drawBall(g,b,color,alpha=1,pull=null){
  const born=b.isPlayer?1:ease(b.born);
  const r=b.r*born;
  if(r<.3)return;
  const angle=pull?Math.atan2(pull.dy,pull.dx):b.angle;
  const amount=pull?clamp(Math.hypot(pull.dx,pull.dy)/(screen==='home'?home.maxPull:(world?.maxPull||150)),0,1):0;
  const cos=Math.cos(angle),sin=Math.sin(angle);
  const squash=pull?0:b.squash;
  g.fillStyle(color,alpha*born);g.beginPath();
  const segments=192;
  for(let i=0;i<=segments;i++){
    const t=i/segments*Math.PI*2,ct=Math.cos(t),st=Math.sin(t);
    // Only the hemisphere facing the drag stretches; the far hemisphere stays round.
    const extension=ct>0?amount*.95*Math.pow(ct,2):0;
    let lx=r*(ct+extension)*(1-squash),ly=r*st*(1+squash*.7);
    if(pull&&ct>0)ly*=1-amount*.15*ct;
    const x=b.x+lx*cos-ly*sin,y=b.y+lx*sin+ly*cos;
    i?g.lineTo(x,y):g.moveTo(x,y);
  }
  g.closePath();g.fillPath();
  if(b.isPlayer){
    const face=isDark(settings.player)?0xf4f3eb:0x252720;
    const faceOffset=smoothFace({x:b.lookX||0,y:b.lookY||0},faceTarget(b,pull,screen==='home'?home.maxPull:(world?.maxPull||150)),scene?.frameDt||1/60);
    b.lookX=faceOffset.x;b.lookY=faceOffset.y;
    const lookX=faceOffset.x*r,lookY=faceOffset.y*r;
    g.fillStyle(face,alpha*.9);
    const roll=b.roll??(world?.phase==='transition'?Math.PI*2*ease(world.phaseTime/1.45):0);
    const rc=Math.cos(roll),rs=Math.sin(roll);
    const strained=usesStrainedEyes(settings.expressions,drag,screen==='home'?home.phase:null);
    for(const [i,eye] of [-1,1].entries()){
      const ex=eye*r*.17+lookX,ey=-r*.07+lookY;
      if(strained){
        g.beginPath();
        strainedEyes[i].forEach((point,j)=>{
          const x=ex+point.x*r,y=ey+point.y*r;
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
  canvas.addEventListener('pointerdown',e=>{
    if(paused||modal||transfer||controlFlight||!e.isPrimary||e.button>0)return;
    const active=screen==='home'?home:screen==='play'?world:null;
    if(!active?.ready)return;
    if(screen==='play'&&!world.beginPull())return;
    unlockAudio();
    const point=position(e);drag={id:e.pointerId,x:point.x,y:point.y,dx:0,dy:0};canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove',e=>{
    if(!drag||drag.id!==e.pointerId)return;
    const p=position(e);drag.dx=p.x-drag.x;drag.dy=p.y-drag.y;e.preventDefault();
  });
  canvas.addEventListener('pointerup',e=>{
    if(!drag||drag.id!==e.pointerId)return;
    const p=position(e);drag.dx=p.x-drag.x;drag.dy=p.y-drag.y;
    if(!paused&&!modal){
      if(screen==='home'&&home.shoot(drag.dx,drag.dy)){tone(220+home.power*190,.15,'sine',.045,.4);vibrate(9);}
      else if(screen==='play'&&world)world.shoot(drag.dx,drag.dy);
    }
    cancelDrag();if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointercancel',cancelDrag);
  canvas.addEventListener('lostpointercapture',cancelDrag);
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
}

function boot(){
  if(!window.Phaser){toast('引擎未能加载，请联网刷新后重试');return;}
  class BallScene extends Phaser.Scene {
    constructor(){super('BallScene');this.accumulator=0;this.effects=[];this.clock=0;this.hitSoundAt=0;}
    create(){
      scene=this;this.g=this.add.graphics();this.cameras.main.setBackgroundColor(settings.bg);bindInput(this.game.canvas);
      const resize=()=>{
        const next=displayMetrics(window.innerWidth,window.innerHeight,window.devicePixelRatio||1);
        const geometryChanged=next.width!==viewport.width||next.height!==viewport.height;
        if(transfer&&geometryChanged){transfer.from.x*=next.width/viewport.width;transfer.from.y*=next.height/viewport.height;transfer.from.r*=Math.min(next.width,next.height)/Math.min(viewport.width,viewport.height);}
        if(controlFlight&&geometryChanged)for(const item of controlFlight.items){item.from.x*=next.width/viewport.width;item.from.y*=next.height/viewport.height;item.from.r*=Math.min(next.width,next.height)/Math.min(viewport.width,viewport.height);}
        viewport=next;
        this.scale.setZoom(1/viewport.scale);
        this.scale.resize(viewport.bufferWidth,viewport.bufferHeight);
        this.game.canvas.style.width=viewport.width+'px';
        this.game.canvas.style.height=viewport.height+'px';
        this.g.setScale(viewport.scale);
        this.cameras.main.setSize(viewport.bufferWidth,viewport.bufferHeight);
        if(geometryChanged){cancelDrag();home.resize(viewport.width,viewport.height);if(world){world.resize(viewport.width,viewport.height);updateChoices();}}
        layoutHomeControl();
        if(['settings','help','menu-transition'].includes(modal))fitMenuHeight();
      };
      resize();
      window.addEventListener('resize',resize);
      this.events.once('shutdown',()=>window.removeEventListener('resize',resize));
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
          if(world.score>best){best=world.score;storage.write('qiuqiule-best',best);}
          tone(500+Math.random()*120,.13,'sine',.06,1.5);vibrate(15);
        }
        if(e.type==='shatter')this.particles(e,hex(settings.enemy),5);
        if(e.type==='upgrade'){cancelDrag();tone(480,.25,'sine',.05,1.5);}
        if(e.type==='choiceReady')tone(660,.13,'sine',.035,1.2);
        if(e.type==='buff'){
          this.particles(e,hex(e.buff.color),10);
          tone(700,.3,'sine',.06,1.5);vibrate([12,30,12]);
        }
        if(e.type==='over'){
          openResult();tone(160,.4,'sine',.06,.4);vibrate([20,40,30]);
        }
      }
    }
    drawBorder(){
      const g=this.g,w=viewport.width,h=viewport.height;
      const border=isDark(settings.bg)?0x636f64:0xc8ccbd;
      g.lineStyle(1,border,.65);g.strokeRoundedRect(15,15,w-30,h-30,22);
    }
    drawHome(){
      const g=this.g,fade=home.fade*homeReveal,t=reducedMotion?0:home.clock;
      this.drawBorder();
      const {player:anchor,base}=home.layout;
      const orbit=Math.min(base*2.65,viewport.height*.30);
      const line=isDark(settings.bg)?0x637068:0xb8bead;
      ring(g,anchor.x+base*.4,anchor.y,orbit,line,.35*fade,1);
      ring(g,anchor.x+base*.4,anchor.y,orbit*.69,line,.17*fade,1);
      for(let i=0;i<13;i++){
        const u=i/12,px=anchor.x-base*2.45+u*base*1.55,py=anchor.y+base*1.3-u*u*base*.87;
        g.fillStyle(line,(.18+u*.35)*fade);g.fillCircle(px,py,1.5+u*.5);
      }
      const b=home.layout.others[2];
      drawBall(g,{...b,y:b.y+Math.sin(t*.85+b.seed)*base*.1,angle:t*.2,squash:Math.sin(t+b.seed)*.025},0xb4ced4,fade);
      const colors={play:homePlayColor,sound:hex(settings.enemy),settings:0xc4dc86};
      for(const c of home.targets){
        if(controlFlight&&['play','settings'].includes(c.id))continue;
        drawFunctionalBall(g,c,colors[c.id],c.id,fade,c.id==='sound'&&!settings.sound);
      }
      if(!detached())drawBall(g,home.player,hex(settings.player),1,drag||home.pull);
    }
    updateHome(dt){
      const before=home.phase;
      if(!modal&&!transfer)home.step(dt,!reducedMotion);
      if(home.action){
        const action=home.action;home.action=null;
        if(action==='sound'){settings.sound=!settings.sound;applyTheme();tone(540,.09,'sine',.04,1.3);vibrate(10);}
        if(action==='settings')openSettings();
      }
      layoutHomeControl();
      if(before!=='entering'&&home.phase==='entering'){
        screen='entering';cancelDrag();syncInputs();
        $('#hud').hidden=false;$('#hud').style.opacity=0;$('#score').textContent='0000';
        $('#choice-labels').innerHTML='';$('.pause-button').disabled=true;
        tone(420,.24,'sine',.055,1.7);vibrate(15);
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
      const g=this.g;this.drawBorder();
      const p=world.player;
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
      for(const e of this.effects){
        const t=e.life/e.total;
        polygon(g,e.x,e.y,e.r*(1-t*.3),e.sides,e.angle,e.color,(1-t*t)*(result?1-smooth(result.clock/.65):1));
      }
    }
    update(_,delta){
      const dt=Math.min(delta/1000,.05);this.frameDt=dt;this.clock+=dt;this.g.clear();
      if(screen==='home'||screen==='entering'){this.updateHome(dt);updateUiBall(dt);return;}
      if(!world)return;
      if(!paused){
        this.accumulator+=dt;
        while(this.accumulator>=1/120){world.step(1/120,!!drag);this.accumulator-=1/120;if(world.phase==='over')break;}
        this.handleEvents();
        if(drag&&!world.ready)cancelDrag();
        for(const e of this.effects){e.life+=dt;if(e.type==='shard'){e.x+=e.vx*dt;e.y+=e.vy*dt;e.angle+=e.spin*dt;}}
        this.effects=this.effects.filter(e=>e.life<e.total).slice(-160);
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
  const button=e.target.closest('[data-action]');if(!button||transfer||controlFlight)return;
  unlockAudio();tone(680,.035,'sine',.02,1.15);
  const action=button.dataset.action;
  if(action.startsWith('home-')&&e.detail===0&&screen==='home'&&!modal)home.launchTo(action==='home-launch'?'play':action.slice(5));
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
applyTheme();layoutHomeControl();
if(document.readyState==='complete')boot();else window.addEventListener('load',boot,{once:true});

if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
