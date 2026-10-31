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

// A periodic cubic B-spline rounds all six corners, including the inner notch.
// Its position, tangent and curvature agree at every join and at the closing seam.
export function strainedEyeOutline(side) {
  const vertices=[[-.06,-.095],[.06,0],[-.06,.095],[-.06,.038],[.004,0],[-.06,-.038]];
  const controls=vertices.flatMap((v,i)=>{
    const prev=vertices[(i+5)%6],next=vertices[(i+1)%6];
    return [prev,next].map(neighbor=>v.map((n,k)=>lerp(n,neighbor[k],.28)));
  });
  const points=[],n=controls.length;
  for(let i=0;i<n;i++){
    for(let j=0;j<32;j++){
      const t=j/32,t2=t*t,t3=t2*t;
      const weights=[(1-3*t+3*t2-t3)/6,(4-6*t2+3*t3)/6,(1+3*t+3*t2-3*t3)/6,t3/6];
      const value=[0,0];
      for(let k=0;k<4;k++){
        const p=controls[(i+k-1+n)%n];
        value[0]+=p[0]*weights[k];value[1]+=p[1]*weights[k];
      }
      points.push({x:value[0],y:value[1]});
    }
  }
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  // About 25% larger than 2.2.0, with the same eye centers in home and battle.
  return points.map(p=>({
    x:-side*(p.x-(minX+maxX)/2)*.135/(maxX-minX),
    y:(p.y-(minY+maxY)/2)*.215/(maxY-minY)
  }));
}
