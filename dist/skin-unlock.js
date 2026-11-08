import {clamp,lerp} from './physics.js';
import {smooth as rawSmooth,transferPose} from './motion.js';
import {cometProfile} from './comet-trail.js';

export const UNLOCK_ENTER_DURATION=1.65;
export const UNLOCK_LEAVE_DURATION=.62;
export const UNLOCK_SWITCH_DURATION=.36;

const elapsedSeconds=value=>Number.isFinite(value)?Math.max(0,value):0;
const smooth=value=>clamp(rawSmooth(value),0,1);
const backOut=t=>{
  t=clamp(t,0,1)-1;
  return 1+2.25*t*t*t+1.25*t*t;
};

function movePose(from,to,t,arc=true){
  const progress=smooth(t),dx=to.x-from.x,dy=to.y-from.y,distance=Math.hypot(dx,dy);
  const bend=arc?Math.sin(Math.PI*progress)*Math.min(20,distance*.055):0;
  const pose={
    x:lerp(from.x,to.x,progress)-(distance?dy/distance*bend:0),
    y:lerp(from.y,to.y,progress)+(distance?dx/distance*bend:0),
    r:lerp(from.r,to.r,progress),
    squash:(from.squash||0)*(1-progress),
    lookX:(from.lookX||0)*(1-progress),lookY:(from.lookY||0)*(1-progress)
  };
  if(from.visualPull)pose.visualPull={amount:from.visualPull.amount*(1-progress),angle:from.visualPull.angle};
  if(from.visualEyeMix!==undefined)pose.visualEyeMix=from.visualEyeMix*(1-progress);
  return pose;
}

/** Presentation sampling only: neither unlocks a skin nor changes a body. */
export function unlockPose({elapsed=0,from,to,reducedMotion=false}){
  const time=elapsedSeconds(elapsed),duration=reducedMotion?.56:UNLOCK_ENTER_DURATION;
  const enter=smooth(time/(reducedMotion?.22:.48));
  const spin=smooth((time-(reducedMotion?.14:.32))/(reducedMotion?.22:1.00));
  const morph=smooth((time-(reducedMotion?.18:.62))/(reducedMotion?.20:.58));
  const pose=movePose(from,to,time/(reducedMotion?.24:.48),!reducedMotion);
  const pop=reducedMotion?0:Math.sin(Math.PI*clamp((time-.94)/.44,0,1))*.16;
  pose.r*=1+pop;
  // Three full turns preserve the starting orientation at the resting endpoint.
  const rotation=(from.roll||0)+(reducedMotion?0:Math.PI*6*spin);
  pose.roll=rotation;
  return {
    pose,morph,rotation,
    panelScale:reducedMotion?1:.68+.32*backOut(time/.48),
    panelAlpha:enter,
    titleAlpha:smooth((time-(reducedMotion?.22:.48))/(reducedMotion?.12:.16)),
    glowAlpha:smooth((time-(reducedMotion?.38:1.28))/(reducedMotion?.18:.34)),
    ready:time>=duration
  };
}

/** The caller supplies the exact visible pose captured on the dismiss tap. */
export function unlockLeavePose({elapsed=0,from,to,reducedMotion=false}){
  const time=elapsedSeconds(elapsed),duration=reducedMotion?.28:UNLOCK_LEAVE_DURATION;
  const progress=clamp(time/duration,0,1),t=smooth(progress);
  const pose=movePose(from,to,progress,!reducedMotion);
  const rotation=(from.roll||0)+(reducedMotion?0:Math.PI*2*t);
  pose.roll=rotation;
  return {
    pose,morph:1-smooth(progress),rotation,
    panelScale:1-.06*smooth(time/(reducedMotion?.20:.24)),
    panelAlpha:1-smooth(time/(reducedMotion?.20:.24)),
    titleAlpha:1-smooth(time/(reducedMotion?.12:.15)),
    glowAlpha:1-smooth(time/(reducedMotion?.12:.16)),
    ready:false,done:progress===1
  };
}

/** Keep the same ball and panel while the caller blends consecutive rewards. */
export function unlockSwitchPose({elapsed=0,from,to=from,reducedMotion=false}){
  const time=elapsedSeconds(elapsed),duration=reducedMotion?.20:UNLOCK_SWITCH_DURATION;
  const titleSwapAt=reducedMotion?.06:.12,progress=clamp(time/duration,0,1);
  const switched=time>=titleSwapAt;
  const pose=movePose(from,to,progress,false);
  pose.roll=from.roll||0;
  return {
    pose,morph:smooth(progress),rotation:pose.roll,
    panelScale:1,panelAlpha:1,glowAlpha:1,
    titleAlpha:switched?smooth((time-titleSwapAt)/(duration-titleSwapAt)):1-smooth(time/titleSwapAt),
    switched,ready:progress===1,done:progress===1
  };
}

/** Center the complete resting ribbon and ball, reserving room for the whole
 * ball at its left-hand approach stop as well as the final composition. */
export function unlockStarTrailGeometry({left,width,y}){
  const ratio=cometProfile(33,1,1,.6).length;
  const inset=Math.min(28,Math.max(18,width*.08));
  const r=Math.max(1,Math.min(38,(width-2*inset)/(ratio+3))),length=ratio*r;
  const center=left+width/2,finish={x:center+(length-r)/2,y,r};
  return {start:{...finish,x:finish.x-length},finish,length,glow:{x:center,y,r},inset};
}

/** Star rewards use the wardrobe's approach, ribbon reveal and retraction.
 * Transfer roll belongs to the moving ball; the settled preview never spins. */
export function unlockStarTrailPose({elapsed=0,from,to,geometry,phase='enter',reducedMotion=false,panelAlreadyVisible=false}){
  const time=elapsedSeconds(elapsed),start=geometry?.start||to||from,finish=geometry?.finish||to||start;
  if(phase==='switch'){
    const progress=clamp(time/.18,0,1),t=smooth(progress);
    // Normally from already equals finish. Only a resized layout moves the
    // existing composition, with no new approach, roll or expression change.
    const pose={...from,x:lerp(from.x,finish.x,t),y:lerp(from.y,finish.y,t),r:lerp(from.r,finish.r,t)};
    return {pose,morph:t,rotation:pose.roll||0,panelAlpha:1,panelScale:1,titleAlpha:1,glowAlpha:1,
      trailProgress:1,trailAlpha:1,ready:progress===1,done:progress===1,switched:true};
  }
  if(phase==='leave'){
    const retractDuration=reducedMotion?.12:.18,returnDuration=reducedMotion?.22:.32;
    const retracted=smooth(time/retractDuration),progress=time>=retractDuration+returnDuration?1:clamp((time-retractDuration)/returnDuration,0,1),t=smooth(progress);
    const pose=time<=retractDuration?{...from}:transferPose({...from,visualSquash:from.squash||0},to,progress);
    return {pose,morph:1-t,rotation:pose.roll||0,panelAlpha:1-t,panelScale:1,titleAlpha:1-t,glowAlpha:1-retracted,
      trailProgress:1-retracted,trailAlpha:1-retracted,ready:false,done:progress===1,switched:true};
  }
  const approachDuration=reducedMotion?.16:.28,drawDuration=reducedMotion?.16:.26;
  const approach=clamp(time/approachDuration,0,1),progress=time>=approachDuration+drawDuration?1:clamp((time-approachDuration)/drawDuration,0,1),t=smooth(progress);
  const arrival=transferPose({...from,visualSquash:from.squash||0},start,approach);
  const pose=time<=approachDuration?arrival:{...arrival,x:lerp(start.x,finish.x,t),y:finish.y,r:finish.r,
    squash:(arrival.squash||0)*(1-t)+(reducedMotion?0:Math.sin(Math.PI*t)*.06)};
  const panelAlpha=panelAlreadyVisible?1:smooth(approach);
  return {pose,morph:t,rotation:pose.roll||0,panelAlpha,panelScale:1,titleAlpha:panelAlpha,glowAlpha:t,
    trailProgress:t,trailAlpha:1,ready:progress===1,done:false,switched:true};
}

// Real bundled GameSans ink bounds at 1000 px, excluding advance whitespace.
// Both reward headings use five CJK glyphs and the full-width punctuation.
export function unlockTitleMarkup(kind='appearance'){
  const title=kind==='star-trail'?'已获得星迹！':'已解锁外观！';
  return `<svg viewBox="113 -797 5151 893" aria-hidden="true" focusable="false"><text x="0" y="0">${title}</text></svg>`;
}

/** DOM is touched only when the app explicitly creates the panel. */
export function createUnlockPanel(doc=globalThis.document){
  const panel=doc.createElement('section');
  panel.id='skin-unlock-panel';panel.className='panel skin-unlock-panel';panel.hidden=true;
  panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
  panel.setAttribute('aria-labelledby','skin-unlock-title');
  panel.innerHTML=`<h2 id="skin-unlock-title" aria-label="已解锁外观！">${unlockTitleMarkup()}</h2><span id="skin-unlock-ball" class="ball-anchor" aria-hidden="true"></span><button id="skin-unlock-continue" type="button" class="skin-unlock-continue" aria-label="继续" disabled></button>`;
  return panel;
}
