import {clamp,lerp} from './physics.js';
export const smooth = t => { t=clamp(t,0,1);return t*t*t*(10+t*(-15+6*t)); };
export function faceTarget(body,pull,maxPull){
  return pull?{x:-clamp(pull.dx/maxPull,-1,1)*.1,y:-clamp(pull.dy/maxPull,-1,1)*.1}:{x:clamp(body.vx/500,-.15,.15),y:clamp(body.vy/500,-.15,.15)};
}
export function smoothFace(current,target,dt){
  const k=1-Math.exp(-Math.min(dt,.05)*20);
  return {x:lerp(current.x,target.x,k),y:lerp(current.y,target.y,k)};
}
export function transferPose(from,to,progress){
  const t=smooth(progress),dx=to.x-from.x,dy=to.y-from.y,d=Math.hypot(dx,dy);
  const arc=Math.sin(Math.PI*t)*Math.min(26,d*.07);
  return {x:lerp(from.x,to.x,t)-(d?dy/d*arc:0),y:lerp(from.y,to.y,t)+(d?dx/d*arc:0),r:lerp(from.r,to.r,t),roll:t*Math.PI*2,squash:Math.sin(Math.PI*t)*.12};
}

// Ballistic flight followed by a short, damped landing; shadow follows height.
export function resultBounce(anchor, seconds, reducedMotion = false) {
  const period = 1.45, flight = 1.14;
  const t = reducedMotion ? 0 : Math.max(0, seconds) % period;
  const u = Math.min(1, t / flight);
  const height = reducedMotion ? 0 : 4 * u * (1 - u);
  const landing = t > flight ? Math.sin((t-flight)/(period-flight)*Math.PI*2)
    * Math.exp(-(t-flight)*12) : 0;
  const squash = reducedMotion ? 0 : (t > flight ? -.22*landing : .085*Math.abs(Math.sin(u*Math.PI*2)));
  return {...anchor,y:anchor.y-anchor.r*1.18*height,squash,
    shadowY:anchor.y+anchor.r*.94,shadowScale:1-.38*height,
    shadowOpacity:.19-.11*height,shadowBlur:2+4*height};
}
