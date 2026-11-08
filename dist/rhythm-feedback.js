const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const strength=value=>Number.isFinite(value)?clamp(value,0,1):.6;

export function clearingTimeScale(elapsed,{juice=.6,reducedMotion=false}={}){
  if(reducedMotion)return 1;
  const remaining=1-clamp((Math.max(0,elapsed||0)-.35)/.6,0,1);
  return 1-.7*strength(juice)*remaining;
}

export function clearingZoom(elapsed,juice=.6){
  const age=Math.max(0,elapsed||0);
  const amount=age<.08?age/.08:age<.35?1:1-clamp((age-.35)/.6,0,1);
  const eased=amount*amount*(3-2*amount);
  return 1+.04*strength(juice)*eased;
}

export const PRESSURE_WARNING_COLOR=0xd94f4f;
export const PRESSURE_RELEASE_DURATION=.65;
const smooth=value=>{const t=clamp(value,0,1);return t*t*(3-2*t);};

// This describes a translucent red overlay, never the underlying arena frame.
export function pressureStyle(count,time,{juice=.6,reducedMotion=false}={}){
  const warning=Number.isFinite(count)&&count>=24,level=clamp((count-24)/4,0,1);
  const frequency=warning&&strength(juice)>0&&!reducedMotion?(count>=26?1.2:.8):0;
  const wave=frequency? .48+.52*(.5-.5*Math.cos(Math.max(0,time||0)*Math.PI*2*frequency)):1;
  return {alpha:warning?(.36+.18*level)*wave:0,width:warning?2.2+level:1,frequency,warning};
}

// Scene-owned presentation: a new World, feedback reset or menu cannot erase
// the last visible warning. Releasing it finishes a cosine-shaped breath out.
export class PressureWarning {
  constructor(){this.alpha=0;this.width=1;this.phase=0;this.level=0;this.active=false;this.entry=null;this.release=null;}
  step(count,dt,options={}){
    const seconds=Number.isFinite(dt)?Math.max(0,dt):0,profile=pressureStyle(count,0,options);
    if(profile.warning){
      if(!this.active){this.entry={age:0,alpha:this.alpha,width:this.width};this.release=null;this.phase=0;}
      this.active=true;
      this.level+=(clamp((count-24)/4,0,1)-this.level)*(1-Math.exp(-seconds/.18));
      this.phase=(this.phase+seconds*profile.frequency)%1;
      const wave=profile.frequency? .48+.52*(.5-.5*Math.cos(this.phase*Math.PI*2)):1;
      const alpha=(.36+.18*this.level)*wave,width=2.2+this.level;
      if(this.entry){
        this.entry.age+=seconds;const t=smooth(this.entry.age/.3);
        this.alpha=this.entry.alpha+(alpha-this.entry.alpha)*t;this.width=this.entry.width+(width-this.entry.width)*t;
        if(t===1)this.entry=null;
      }else{this.alpha=alpha;this.width=width;}
    }else{
      if(this.active){this.release={age:0,alpha:this.alpha,width:this.width};this.entry=null;}
      this.active=false;
      if(this.release){
        this.release.age+=seconds;const t=clamp(this.release.age/PRESSURE_RELEASE_DURATION,0,1),fade=.5+.5*Math.cos(Math.PI*t);
        this.alpha=this.release.alpha*fade;this.width=1+(this.release.width-1)*fade;
        if(t===1){this.alpha=0;this.width=1;this.release=null;this.level=0;}
      }
    }
    return this;
  }
}

export function blendRgb(from,to,amount){
  const t=clamp(amount,0,1);
  const channel=shift=>Math.round(((from>>shift)&255)*(1-t)+((to>>shift)&255)*t);
  return channel(16)<<16|channel(8)<<8|channel(0);
}

export function injuredEnemyScale(body,endless=true){
  if(!endless||body.isPlayer||body.isBoss||!Number.isFinite(body.maxHp)||!(body.maxHp>0))return 1;
  return .82+.18*clamp(body.hp/body.maxHp,0,1);
}

export function pressureLook(player,enemies,time,count){
  if(count!=null&&count<24)return null;
  const phase=((Math.max(0,time||0)%1.5)+1.5)%1.5;
  if(phase>=.36)return null;
  let nearest=null,distance=Infinity,alive=0;
  for(const body of enemies){
    if(!(body.hp>0))continue;
    alive++;
    const d=Math.hypot(body.x-player.x,body.y-player.y);
    if(d>1e-9&&d<distance){nearest=body;distance=d;}
  }
  if((count??alive)<24||!nearest)return null;
  const amount=.13*Math.sin(phase/.36*Math.PI);
  return {x:(nearest.x-player.x)/distance*amount,y:(nearest.y-player.y)/distance*amount};
}
