// Presentation state only: scoring, launch energy and stage rules live in World.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const feedbackStrength=value=>Number.isFinite(value)?clamp(value,0,1):.6;

export function chargeFeedback(mask,amount){
  let next=mask||0;const pulses=[];
  [.5,.8,1].forEach((threshold,i)=>{
    if(amount+1e-8>=threshold&&!(next&(1<<i))){next|=1<<i;pulses.push([6,8,12][i]);}
  });
  return {mask:next,pulses};
}

export class ScoreFeedback {
  constructor(){this.reset(0);}
  reset(value){this.from=this.value=this.target=value;this.age=1;}
  set(value,animate=true){
    if(value===this.target)return;
    if(!animate||value<this.target){this.reset(value);return;}
    this.from=this.value;this.target=value;this.age=0;
  }
  step(dt,animate=true){
    if(!animate){this.reset(this.target);return {value:this.target,scale:1};}
    this.age+=Math.max(0,dt);
    const t=clamp(this.age/.25,0,1);
    this.value=this.from+(this.target-this.from)*(1-(1-t)**3);
    return {value:t===1?this.target:Math.floor(this.value),scale:this.age<.16?1+.18*Math.sin(Math.PI*this.age/.16):1};
  }
}

export function impactShards(event,color,{count=7,strength=.6,reducedMotion=false,countScale=1}={}){
  const s=feedbackStrength(strength),level=clamp((event.feedbackLevel||1)-1,0,7);
  const boost=event.type==='kill'&&event.upgradeBoost&&s>0&&!reducedMotion?2:0;
  const baseAmount=Math.max(3,Math.round((count+2*level)*(.4+.6*s)))+boost;
  const scale=Number.isFinite(countScale)?Math.max(0,countScale):1;
  // Scale the already strength-adjusted ordinary count, not its unrounded
  // input, so Boss-to-enemy proportions stay consistent at every setting.
  const amount=reducedMotion?Math.min(5,count):Math.min(120,Math.max(3,Math.round(baseAmount*scale)));
  const radius=event.r||12,hasContact=Number.isFinite(event.contactX)&&Number.isFinite(event.contactY);
  const speed=event.impactSpeed??Math.hypot(event.impactVx||0,event.impactVy||0);
  const axis=Math.atan2(event.ny??0,event.nx??1),spread=hasContact?Math.PI*.8:Math.PI*2;
  return Array.from({length:amount},(_,i)=>{
    // Fixed fan: impact direction and energy, never a random feedback intensity.
    const angle=axis+((i+.5)/amount-.5)*spread;
    const travel=(30+(i%3)*17)*(radius/24)+Math.min(220,speed*.12);
    const motion=reducedMotion?.3:1;
    return {type:'shard',x:hasContact?event.contactX:event.x+Math.cos(angle)*radius*.2,
      y:hasContact?event.contactY:event.y+Math.sin(angle)*radius*.2,
      vx:(Math.cos(angle)*travel+(event.impactVx??event.vx??0)*.35)*motion,
      vy:(Math.sin(angle)*travel+(event.impactVy??event.vy??0)*.35)*motion,
      r:radius*(.18+(i%3)*.035),angle,spin:reducedMotion?0:(i%2?1:-1)*(2+i%3),
      life:0,total:reducedMotion?.3:.5+(i%3)*.06,color,sides:3+i%2};
  });
}

// Merge particles converge on the mass centroid; no kill fan or gameplay impulse.
export function mergeShards(event,color,{strength=.6,reducedMotion=false}={}){
  const amount=reducedMotion?4:Math.round(6+4*feedbackStrength(strength));
  const origins=event.origins?.length?event.origins:[{x:event.x,y:event.y,r:event.r||12}];
  return Array.from({length:amount},(_,i)=>{
    const origin=origins[i%origins.length],angle=i*Math.PI*2/amount;
    const x=origin.x+Math.cos(angle)*origin.r*.8,y=origin.y+Math.sin(angle)*origin.r*.8;
    const total=.25,motion=reducedMotion?.2:1;
    return {type:'shard',x,y,vx:(event.x-x)/total*motion,vy:(event.y-y)/total*motion,
      r:origin.r*.12,angle,spin:0,life:0,total,color,sides:3+i%2};
  });
}

export function impactZoom(age,peak){
  if(age>=.28||age<0)return 1;
  const t=age<.08?age/.08:1-(age-.08)/.2;
  return 1+peak*t*t*(3-2*t);
}
