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

export function pressureStyle(count,time,{juice=.6,reducedMotion=false}={}){
  const level=clamp((count-19)/9,0,1),frequency=count>=26?2.4:count>=24?1.2:0;
  const s=strength(juice),breathing=frequency>0&&s>0&&!reducedMotion;
  const wave=breathing?1-s*.2*(.5+.5*Math.cos(Math.max(0,time||0)*Math.PI*2*frequency)):1;
  const intensity=level*wave;
  return {alpha:.65+.35*intensity,width:reducedMotion?1:1+.5*intensity,mix:.4*intensity,
    frequency:breathing?frequency:0,warning:count>=20};
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

export function pressureLook(player,enemies,time){
  const alive=enemies.filter(body=>body.hp>0);
  if(alive.length<24)return null;
  const phase=((Math.max(0,time||0)%1.5)+1.5)%1.5;
  if(phase>=.36)return null;
  let nearest=null,distance=Infinity;
  for(const body of alive){
    const d=Math.hypot(body.x-player.x,body.y-player.y);
    if(d>1e-9&&d<distance){nearest=body;distance=d;}
  }
  if(!nearest)return null;
  const amount=.13*Math.sin(phase/.36*Math.PI);
  return {x:(nearest.x-player.x)/distance*amount,y:(nearest.y-player.y)/distance*amount};
}
