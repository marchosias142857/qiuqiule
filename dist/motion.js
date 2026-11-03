import {clamp,lerp} from './physics.js';
export const smooth = t => { t=clamp(t,0,1);return t*t*t*(10+t*(-15+6*t)); };

// Unit-radius contour in drag-local coordinates. Both weights and their first
// two derivatives vanish at the hemisphere joins, matching the untouched circle
// in position, tangent and curvature. The (2-front) factor keeps the original
// tip's curvature as well as its 95% extension, without making it sharper.
export function pullBallPoint(ct,st,amount){
  const front=Math.max(0,ct),weight=front*front*front;
  return {x:ct+.95*amount*weight*(2-front),y:st*(1-.15*amount*weight)};
}

export function faceTarget(body,pull,maxPull){
  return pull?{x:-clamp(pull.dx/maxPull,-1,1)*.1,y:-clamp(pull.dy/maxPull,-1,1)*.1}:{x:clamp(body.vx/500,-.15,.15),y:clamp(body.vy/500,-.15,.15)};
}
// A subtle radial gaze, continuous at the player's edge and bounded even when
// the finger is far away. The caller smooths changes, including release to zero.
export function pointerFaceTarget(body,point){
  if(!point)return {x:0,y:0};
  const dx=point.x-body.x,dy=point.y-body.y,distance=Math.hypot(dx,dy);
  if(distance<=body.r)return {x:0,y:0};
  const amount=.08*(1-Math.exp(-(distance-body.r)/Math.max(1,body.r*4)));
  return {x:dx/distance*amount,y:dy/distance*amount};
}
export function smoothFace(current,target,dt){
  const k=1-Math.exp(-Math.min(dt,.05)*20);
  return {x:lerp(current.x,target.x,k),y:lerp(current.y,target.y,k)};
}
export function transferPose(from,to,progress){
  const t=smooth(progress),dx=to.x-from.x,dy=to.y-from.y,d=Math.hypot(dx,dy);
  const arc=Math.sin(Math.PI*t)*Math.min(26,d*.07);
  const pose={x:lerp(from.x,to.x,t)-(d?dy/d*arc:0),y:lerp(from.y,to.y,t)+(d?dx/d*arc:0),r:lerp(from.r,to.r,t),roll:lerp(from.roll||0,to.roll||0,t)+t*Math.PI*2,squash:Math.sin(Math.PI*t)*.12+(from.visualSquash||0)*(1-t),
    lookX:lerp(from.lookX||0,to.lookX||0,t),lookY:lerp(from.lookY||0,to.lookY||0,t)};
  if(from.visualPull)pose.visualPull={amount:from.visualPull.amount*(1-t),angle:from.visualPull.angle};
  if(from.visualEyeMix!==undefined)pose.visualEyeMix=from.visualEyeMix*(1-t);
  return pose;
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

// Keep the expression through every zero crossing of the home rebound.
export function usesStrainedEyes(enabled,drag,homePhase){
  return !!enabled && (homePhase==='wobble' || !!drag && Math.hypot(drag.dx,drag.dy)>0);
}

// Presentation-only state: game phases, readiness and body properties are never
// changed. A completed rebound keeps its last eye shape on the handoff frame,
// then relaxes it; other releases retain their immediate normal expression.
export function playerVisualState(previous,{phase,strained,expressions,pulling,dt}){
  const elapsed=Math.max(0,Math.min(dt,.05));
  const idle=phase==='idle'&&!pulling;
  // A fresh visual breathing cycle begins at rest; never inherit the world's
  // clock or the squash retained before a drag. Let the full cycle keep running.
  const idleAge=idle&&previous?.phase==='idle'&&!previous.pulling
    ?previous.idleAge+elapsed:0;
  let eyeAge=.12;
  if(expressions&&idle&&!strained){
    if(previous?.phase==='wobble'&&previous.eyeMix>0)eyeAge=0;
    else eyeAge=Math.min(.12,(previous?.eyeAge??.12)+elapsed);
  }
  return {phase,pulling,idleAge,eyeAge,eyeMix:strained?1:1-smooth(eyeAge/.12)};
}

// Corresponding points on the original normal eye, aligned to the strained
// outline's winding and best-fitting phase. This avoids twisting either eye
// while its concave contour relaxes, and preserves the original ellipse size.
export function relaxedEyeOutline(outline){
  const n=outline.length,rx=.105/2,ry=.19/2;
  const area=outline.reduce((sum,p,i)=>{
    const q=outline[(i+1)%n];return sum+p.x*q.y-p.y*q.x;
  },0);
  const direction=Math.sign(area)||1;
  let a=0,b=0;
  for(let i=0;i<n;i++){
    const t=direction*i/n*Math.PI*2,c=Math.cos(t),s=Math.sin(t),p=outline[i];
    a+=rx*p.x*c+ry*p.y*s;b+=-rx*p.x*s+ry*p.y*c;
  }
  const phase=Math.atan2(b,a);
  return outline.map((_,i)=>{
    const t=direction*i/n*Math.PI*2+phase;
    return {x:rx*Math.cos(t),y:ry*Math.sin(t)};
  });
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
