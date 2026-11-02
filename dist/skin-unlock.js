import {clamp,lerp} from './physics.js';
import {smooth as rawSmooth} from './motion.js';

export const UNLOCK_ENTER_DURATION=1.65;
export const UNLOCK_LEAVE_DURATION=.62;

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

// The home title is hand-drawn SVG, not a font. These matching round-ended
// monoline glyphs retain that lettering style without a system-font fallback.
export function unlockTitleMarkup(){
  const glyphs=[
    'M16 23H77V50H21M20 40V76Q20 87 32 87H77Q87 87 87 75',
    'M26 13L13 33M25 18H42L33 33M16 34H44V80Q44 89 34 85M16 34V63Q16 79 9 88M17 51H43M16 67H43M30 36V83M54 18H84Q85 39 76 39L70 36M66 19Q64 32 53 41M59 48L52 63M60 55H87M72 45V89M50 72H89',
    'M23 13L11 34M19 28H36M11 47H35M11 64H34M23 47V87L37 77M62 13V35M47 19L53 29M78 19L72 29M46 40H81V70M46 69V40M63 52V66Q61 79 43 88M67 75L85 88',
    'M49 13V51M22 37H84L75 49M22 37V59Q22 76 12 88M29 54H75Q64 78 31 89M36 60Q54 79 85 88',
    'M15 18H38V81Q38 90 28 85M15 18V62Q15 79 9 88M17 39H37M15 59H37M49 34H86M45 56H90M67 14V46Q67 73 46 89M67 57Q75 78 90 88',
    'M29 24L28 63M28 82L28 82.4'
  ];
  const widths=[92,98,98,98,98,44];
  let offset=0;
  const paths=glyphs.map((d,i)=>{const x=offset;offset+=widths[i];return `<path transform="translate(${x} 0)" d="${d}"/>`;});
  return `<svg viewBox="0 0 ${offset} 100" aria-hidden="true" focusable="false">${paths.join('')}</svg>`;
}

/** DOM is touched only when the app explicitly creates the panel. */
export function createUnlockPanel(doc=globalThis.document){
  const panel=doc.createElement('section');
  panel.id='skin-unlock-panel';panel.className='panel skin-unlock-panel';panel.hidden=true;
  panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
  panel.setAttribute('aria-labelledby','skin-unlock-title');
  panel.innerHTML=`<h2 id="skin-unlock-title" aria-label="已解锁皮肤！">${unlockTitleMarkup()}</h2><span id="skin-unlock-ball" class="ball-anchor" aria-hidden="true"></span><button id="skin-unlock-continue" type="button" class="skin-unlock-continue" aria-label="继续到结算界面" disabled></button>`;
  return panel;
}
