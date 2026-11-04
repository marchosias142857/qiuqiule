const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
export const AIM_HOLD_SECONDS=1.2;
export const AIM_CALIBRATED_HOLD_SECONDS=.9;
export const AIM_RECOVERY_SECONDS=.5;
export const aimMinimumScale=(reducedMotion=false)=>reducedMotion?.6:.3;

// Geometry only: callers decide which modes use the moving-ball guide.
// Every point and the arrow describe the next launch, including while the ball
// is moving quickly in a different direction. Keep one continuous guide.
export function aimGuide({player,drag,maxPull,baseAlpha=.36}){
  const dx=drag?.dx||0,dy=drag?.dy||0,distance=Math.hypot(dx,dy);
  if(!player||!Number.isFinite(distance)||distance<=3)return {points:[],arrow:null};
  const power=clamp(distance/Math.max(1,finite(maxPull,90)),0,1);
  const nx=-dx/distance,ny=-dy/distance;
  const alpha=clamp(finite(baseAlpha,.36),0,1);
  const points=Array.from({length:7},(_,index)=>{
    const i=index+1,d=player.r+12+i*(8+power*8);
    return {x:player.x+nx*d,y:player.y+ny*d,
      r:1.7,alpha:alpha*(1-i/9),direction:'aim'};
  });
  const tip={x:points[6].x,y:points[6].y};
  return {points,arrow:{tip,
    left:{x:tip.x-nx*6-ny*4,y:tip.y-ny*6+nx*4},
    right:{x:tip.x-nx*6+ny*4,y:tip.y-ny*6-nx*4},alpha:.35,width:1.4}};
}

// All timestamps are seconds on one monotonic real-time clock. No timers or
// physics dt are used: a long frame cannot extend the slow-aim allowance.
export class AimGesture {
  constructor({x=0,y=0,startedAt=0,holdDuration=AIM_HOLD_SECONDS,reducedMotion=false}={}){
    this.x=finite(x,0);this.y=finite(y,0);
    this.startX=this.x;this.startY=this.y;
    this.startedAt=finite(startedAt,0);this.now=this.startedAt;
    // The aiming allowance is a gameplay rule, independent of visual juice.
    // Snapshot it for the gesture; calibration only changes a later run.
    this.holdDuration=holdDuration===AIM_CALIBRATED_HOLD_SECONDS?holdDuration:AIM_HOLD_SECONDS;
    this.reducedMotion=!!reducedMotion;
    this.activatedAt=null;this.finished=false;
  }

  move(x,y,now){
    if(!this.finished){this.x=finite(x,this.x);this.y=finite(y,this.y);}
    return this.sample(now);
  }

  sample(now,{reducedMotion}={}){
    this.now=Math.max(this.now,finite(now,this.now));
    if(typeof reducedMotion==='boolean')this.reducedMotion=reducedMotion;
    const dx=this.x-this.startX,dy=this.y-this.startY,distance=Math.hypot(dx,dy);
    if(!this.finished&&this.activatedAt===null){
      // A hold may have activated between frames. Record the exact deadline,
      // while an early movement activates at its observed pointer timestamp.
      if(this.now>=this.startedAt+.12)this.activatedAt=this.startedAt+.12;
      else if(distance>=6)this.activatedAt=this.now;
    }
    const active=!this.finished&&this.activatedAt!==null;
    let scale=1;
    if(active){
      const elapsed=Math.max(0,this.now-this.activatedAt);
      const remaining=1-clamp((elapsed-this.holdDuration)/AIM_RECOVERY_SECONDS,0,1);
      scale=1-(1-aimMinimumScale(this.reducedMotion))*remaining;
    }
    return {active,scale,dx,dy,distance};
  }

  release(x,y,now){
    const state=this.move(x,y,now),shouldShoot=state.active&&state.distance>=6;
    const elapsed=state.active?Math.max(0,this.now-this.activatedAt):0;
    const slowSeconds=Math.min(elapsed,this.holdDuration+AIM_RECOVERY_SECONDS);
    this.finished=true;
    return {...state,active:false,scale:1,shouldShoot,slowSeconds};
  }

  cancel(){
    this.finished=true;
    return this.sample(this.now);
  }
}
