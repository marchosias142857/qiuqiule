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
