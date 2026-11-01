import {clamp,lerp} from './physics.js';
import {contactDistance} from './home.js';
import {smooth} from './motion.js';

const TAU=Math.PI*2;
const START=Math.PI*2/3;
const SPAN=Math.PI*5/3;
const point=(cx,cy,r,a)=>({x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r});
const angleOnTrack=(x,y,l)=>((Math.atan2(y-l.cy,x-l.cx)-l.startAngle)%TAU+TAU)%TAU;


// Earliest contact of the player's moving disc with a clipped ball's straight
// end-cap. The segment's radius-expanded capsule includes both rounded ends.
function capsuleContact(player,nx,ny,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
  const endpoint=v=>Math.hypot(player.x-v.x,player.y-v.y)<=player.r?0:contactDistance(player,{...v,r:0},nx,ny);
  let first=Math.min(endpoint(a),endpoint(b));
  if(len<1e-8)return first;
  const ux=dx/len,uy=dy/len,px=player.x-a.x,py=player.y-a.y;
  const across=ux*py-uy*px,along=ux*px+uy*py,velocity=ux*ny-uy*nx;
  if(Math.abs(across)<=player.r&&along>=0&&along<=len)return 0;
  if(Math.abs(velocity)>1e-9){
    for(const side of [-1,1]){
      const distance=(side*player.r-across)/velocity;
      const position=along+distance*(nx*ux+ny*uy);
      if(distance>=0&&position>=0&&position<=len)first=Math.min(first,distance);
    }
  }
  return first;
}

export function levelLayout(width,height){
  const short=Math.min(width,height),unit=clamp(short*.047,18,34),ballRadius=unit*1.7;
  const outer=Math.min(290,short/2-28);
  const inner=outer-ballRadius*2-16;
  const radius=(inner+outer)/2;
  // Widen the rail with the larger balls, then reduce the number of slots.
  // Chord spacing keeps neighboring circles apart, including on small phones.
  const separation=2*Math.asin(Math.min(.99,(ballRadius+11)/radius));
  const count=clamp(Math.floor(SPAN/separation),3,13);
  const cx=width/2,cy=height/2,stepAngle=SPAN/count;
  return {width,height,cx,cy,inner,outer,radius,unit,ballRadius,count,stepAngle,
    startAngle:START,endAngle:START+SPAN,corner:Math.min(8,(outer-inner)/4),
    returnBall:{...point(cx,cy,radius,Math.PI/2),r:ballRadius,id:'home',sx:1,sy:1}};
}

// Four circular fillets are tangent to both their radial end cap and circle.
// This same closed outline is used for the border and for clipping all balls.
export function trackPath(l){
  const {cx,cy,inner:ri,outer:ro,corner:c,startAngle:a,endAngle:b}=l;
  const od=Math.asin(c/(ro-c)),id=Math.asin(c/(ri+c));
  const oq=Math.sqrt((ro-c)**2-c*c),iq=Math.sqrt((ri+c)**2-c*c);
  const p=(r,t)=>{const v=point(cx,cy,r,t);return `${v.x.toFixed(5)} ${v.y.toFixed(5)}`;};
  return `M ${p(ro,a+od)} A ${ro} ${ro} 0 1 1 ${p(ro,b-od)} A ${c} ${c} 0 0 1 ${p(oq,b)} L ${p(iq,b)} A ${c} ${c} 0 0 1 ${p(ri,b-id)} A ${ri} ${ri} 0 1 0 ${p(ri,a+id)} A ${c} ${c} 0 0 1 ${p(iq,a)} L ${p(oq,a)} A ${c} ${c} 0 0 1 ${p(ro,a+od)} Z`;
}

export class LevelSelector{
  constructor(width,height,unlocked=1,focusLevel=1){
    this.width=width;this.height=height;this.layout=levelLayout(width,height);
    this.unlocked=clamp(Math.floor(Number(unlocked)||1),1,100);
    this.offset=clamp(Math.floor(Number(focusLevel)||1)-1-Math.floor(this.layout.count/2),0,this.maxOffset);
    this.velocity=0;this.snapTarget=this.offset;this.trackDrag=null;
    this.clock=0;this.events=[];this.action=null;this.phase='idle';this.phaseTime=0;
    this.direction={x:0,y:1};this.power=0;this.target=null;this.remaining=0;this.speed=0;this.lastTick=Math.round(this.offset);this.hitTimes=new Map();
    this.player={x:width/2,y:height/2,r:this.layout.ballRadius,isPlayer:true,born:1,solid:true,vx:0,vy:0,angle:0,squash:0,roll:0,lookX:0,lookY:0};
  }
  get maxOffset(){return 100-this.layout.count;}
  get maxPull(){return clamp(Math.min(this.width,this.height)*.25,90,170);}
  get ready(){return this.phase==='idle'&&!this.trackDrag;}
  get pull(){
    if(this.phase!=='wobble')return null;
    const t=this.phaseTime/.82;
    const wave=Math.sin(t*Math.PI*6)*(1-t)**2*this.power*.8;
    return {dx:this.direction.x*wave*this.maxPull,dy:this.direction.y*wave*this.maxPull};
  }
  get returnBall(){return this.layout.returnBall;}
  get visibleBalls(){
    const l=this.layout,balls=[];
    // Slots remain tied to the global list: no wrapping, duplicate IDs, 0 or 101.
    const first=Math.max(1,Math.floor(this.offset)),last=Math.min(100,Math.ceil(this.offset+l.count+1));
    for(let level=first;level<=last;level++){
      const t=(level-.5-this.offset)*l.stepAngle;
      const margin=Math.asin(l.ballRadius/l.radius);
      if(t<-margin||t>SPAN+margin)continue;
      const hit=this.hitTimes.get(level),age=hit===undefined?10:this.clock-hit;
      const squash=age<.5?Math.sin(age*28)*Math.exp(-age*9)*.13:0;
      balls.push({id:level,level,...point(l.cx,l.cy,l.radius,l.startAngle+t),r:l.ballRadius,
        angle:l.startAngle+t,unlocked:level<=this.unlocked,sx:1+squash,sy:1-squash,
        fullyVisible:t>=margin&&t<=SPAN-margin});
    }
    return balls;
  }
  isTrackPoint(x,y){
    const l=this.layout,r=Math.hypot(x-l.cx,y-l.cy),a=angleOnTrack(x,y,l);
    return r>=l.inner&&r<=l.outer&&a<=SPAN;
  }
  isPlayerPoint(x,y){return Math.hypot(x-this.player.x,y-this.player.y)<=this.player.r;}
  startTrack(x,y,time=0){
    if(this.phase!=='idle'||!this.isTrackPoint(x,y))return false;
    const l=this.layout,angle=Math.atan2(y-l.cy,x-l.cx);
    this.trackDrag={x,y,time,lastTime:time,raw:this.offset,startOffset:this.offset,tx:-Math.sin(angle),ty:Math.cos(angle),samples:[{time,value:this.offset}]};
    this.velocity=0;this.snapTarget=null;return true;
  }
  moveTrack(x,y,time=0){
    const d=this.trackDrag;if(!d)return false;
    // A phone-like swipe is projected onto the tangent fixed at gesture start.
    // Its radial line therefore divides clockwise from counter-clockwise input,
    // even if the pointer later crosses the centre or leaves the annular track.
    const travel=(x-d.x)*d.tx+(y-d.y)*d.ty;
    d.raw=d.startOffset-travel/(this.layout.radius*this.layout.stepAngle);
    const rubber=v=>.9*v/(.9+v);
    this.offset=d.raw<0?-rubber(-d.raw):d.raw>this.maxOffset?this.maxOffset+rubber(d.raw-this.maxOffset):d.raw;
    d.lastTime=time;d.samples.push({time,value:this.offset});
    while(d.samples.length>2&&d.samples[1].time<time-.09)d.samples.shift();
    this.emitTick();return true;
  }
  endTrack(time=0){
    const d=this.trackDrag;if(!d)return false;
    const first=d.samples[0],last=d.samples.at(-1),elapsed=last.time-first.time;
    this.velocity=time-d.lastTime>.11||elapsed<=.003?0:clamp((last.value-first.value)/elapsed,-55,55);
    this.trackDrag=null;
    this.snapTarget=Math.abs(this.velocity)<1.5?clamp(Math.round(this.offset),0,this.maxOffset):null;
    return true;
  }
  cancelTrack(){
    this.trackDrag=null;this.velocity=0;this.snapTarget=clamp(Math.round(this.offset),0,this.maxOffset);
  }
  emitTick(){
    const tick=clamp(Math.round(this.offset),0,this.maxOffset);
    if(tick!==this.lastTick){this.lastTick=tick;this.events.push({type:'tick',index:tick});}
  }
  shoot(dx,dy){
    const distance=Math.hypot(dx,dy);
    if(!this.ready||distance<6)return false;
    this.power=clamp(distance/this.maxPull,0,1);
    this.direction={x:-dx/distance,y:-dy/distance};
    const speed=this.layout.unit*40*this.power;
    const candidates=[this.returnBall,...this.visibleBalls].map(target=>{
      let travel=contactDistance(this.player,target,this.direction.x,this.direction.y);
      if(target.id!=='home'){
        if(Number.isFinite(travel)){
          const px=this.player.x+this.direction.x*travel,py=this.player.y+this.direction.y*travel;
          const dx=px-target.x,dy=py-target.y,d=Math.hypot(dx,dy);
          if(!this.isTrackPoint(target.x+dx/d*target.r,target.y+dy/d*target.r))travel=Infinity;
        }
        // All balls clear the inner/outer circles by 8px. Partial clipping can
        // therefore only expose a chord on one of the two radial end-caps.
        for(const angle of [this.layout.startAngle,this.layout.endAngle]){
          const ux=Math.cos(angle),uy=Math.sin(angle);
          const dx=target.x-this.layout.cx,dy=target.y-this.layout.cy;
          const along=dx*ux+dy*uy,across=ux*dy-uy*dx;
          if(along<=0||Math.abs(across)>=target.r)continue;
          const half=Math.sqrt(target.r*target.r-across*across);
          const a=point(this.layout.cx,this.layout.cy,along-half,angle);
          const b=point(this.layout.cx,this.layout.cy,along+half,angle);
          travel=Math.min(travel,capsuleContact(this.player,this.direction.x,this.direction.y,a,b));
        }
      }
      return {target,distance:travel};
    }).sort((a,b)=>a.distance-b.distance);
    this.target=candidates[0].target;this.remaining=candidates[0].distance;
    this.phaseTime=0;
    this.cancelTrack();
    const reachable=speed*(1-Math.exp(-.6*1.6))/.6;
    if(!Number.isFinite(this.remaining)||this.remaining>reachable){
      this.phase='wobble';this.player.vx=this.player.vy=0;
    }else{
      this.phase='flight';this.speed=speed;
      this.player.angle=Math.atan2(dy,dx);this.player.squash=-.25*this.power;
    }
    this.events.push({type:'shoot',power:this.power});return true;
  }
  resetPlayer(){
    this.phase='idle';this.phaseTime=0;this.target=null;
    Object.assign(this.player,{x:this.layout.cx,y:this.layout.cy,r:this.layout.ballRadius,vx:0,vy:0,squash:0,roll:0});
  }
  resize(width,height){
    const focus=this.offset+this.layout.count/2;
    this.width=width;this.height=height;this.layout=levelLayout(width,height);
    this.offset=clamp(Math.round(focus-this.layout.count/2),0,this.maxOffset);this.lastTick=this.offset;
    this.cancelTrack();
    this.action=null;this.resetPlayer();
  }
  step(dt,dragging=false){
    dt=clamp(dt,0,.1);this.clock+=dt;
    const n=Math.max(1,Math.ceil(dt*120)),h=dt/n;
    for(let i=0;i<n;i++){
      // Freeze the rendered rail during the predicted flight and return.
      if(this.phase==='idle'&&!dragging||this.phase==='wobble')this.stepTrack(h);
      this.stepPlayer(h);
    }
    this.emitTick();
  }
  stepTrack(dt){
    if(this.trackDrag)return;
    const outside=this.offset<0||this.offset>this.maxOffset;
    if(outside)this.snapTarget=clamp(this.offset,0,this.maxOffset);
    if(this.snapTarget!==null){
      const error=this.snapTarget-this.offset;
      this.velocity+=(220*error-27*this.velocity)*dt;
      this.offset+=this.velocity*dt;
      if(Math.abs(error)<.0001&&Math.abs(this.velocity)<.002){this.offset=this.snapTarget;this.velocity=0;}
    }else{
      this.velocity*=Math.exp(-4.4*dt);this.offset+=this.velocity*dt;
      if(Math.abs(this.velocity)<.45)this.snapTarget=clamp(Math.round(this.offset),0,this.maxOffset);
    }
  }
  stepPlayer(dt){
    const p=this.player,l=this.layout;
    this.phaseTime+=dt;
    if(this.phase==='idle'){p.squash=0;return;}
    if(this.phase==='wobble'){
      if(this.phaseTime>=.82)this.resetPlayer();
      return;
    }
    if(this.phase==='flight'){
      const travel=this.speed*(1-Math.exp(-.6*dt))/.6;
      const move=Math.min(travel,this.remaining);
      p.x+=this.direction.x*move;p.y+=this.direction.y*move;
      this.remaining-=move;this.speed*=Math.exp(-.6*dt);
      p.vx=this.direction.x*this.speed;p.vy=this.direction.y*this.speed;
      p.squash*=Math.exp(-dt*10);
      if(this.remaining<=.001){
        p.vx=p.vy=0;this.phaseTime=0;
        const b=this.target;
        if(b.id==='home'||b.unlocked){
          this.phase='external';this.action=b.id==='home'?{type:'home'}:{type:'level',level:b.level};
        }else{
          this.phase='returning';this.from={x:p.x,y:p.y,r:p.r};
          this.hitTimes.set(b.level,this.clock);this.events.push({type:'locked',level:b.level});
        }
      }
      return;
    }
    if(this.phase==='returning'){
      const t=smooth(this.phaseTime/.68);
      p.x=lerp(this.from.x,l.cx,t);p.y=lerp(this.from.y,l.cy,t);
      p.squash=Math.sin(this.phaseTime*14)*.15*(1-t);p.roll=Math.sin(Math.PI*t)*.5;
      if(this.phaseTime>=.68)this.resetPlayer();
    }
  }
}
