import {clamp, ease, lerp} from './physics.js';
import {smooth} from './motion.js';

// Shared geometry for the drawing, hit prediction, keyboard target and rotation.
export function homeLayout(width, height) {
  const portrait = width <= height;
  const r = Math.min(86, width * (portrait ? .125 : .065), height * (portrait ? .085 : .13));
  const player = {x: width * (portrait ? .5 : .66), y: height * (portrait ? .48 : .57), r: r * .84};
  const play = {x: width * (portrait ? .5 : .27), y: height * (portrait ? .79 : .57), r: r * 1.2};
  const offsets = portrait ? [[1.65,-1.55,.66], [2.05,.75,.88], [-.8,-2.05,.25]] : [[1.5,-1.5,.66], [1.9,.95,.88], [-.55,-1.9,.25]];
  return {portrait, base: r, player, play, others: offsets.map(([x,y,size],i)=>({x:player.x+x*r,y:player.y+y*r,r:r*size,seed:i+1,born:1,angle:0,squash:0}))};
}

// Distance to first contact along a straight launch. A miss never moves the center.
export function contactDistance(player, target, nx, ny) {
  const dx=target.x-player.x, dy=target.y-player.y, radius=player.r+target.r;
  const along=dx*nx+dy*ny;
  const perpendicular2=Math.max(0,dx*dx+dy*dy-along*along);
  if(along<=0 || perpendicular2>radius*radius)return Infinity;
  return Math.max(0,along-Math.sqrt(radius*radius-perpendicular2));
}

export class HomeWorld {
  constructor(width,height) {
    this.width=width;this.height=height;this.layout=homeLayout(width,height);
    this.player={...this.layout.player,isPlayer:true,vx:0,vy:0,angle:0,squash:0,roll:0};
    this.phase='idle';this.phaseTime=0;this.clock=0;
    this.direction={x:0,y:1};this.power=0;this.action=null;this.animate=true;
  }
  get targets(){
    const t=this.animate?this.clock:0,b=this.layout.base;
    return [
      {...this.layout.play,r:this.layout.play.r*(1+Math.sin(t*1.7)*.018),id:'play'},
      ...this.layout.others.slice(0,2).map((c,i)=>({...c,y:c.y+Math.sin(t*.85+c.seed)*b*.1,id:i?'settings':'sound'}))
    ].map(c=>{
      const hit=this.contactAction===c.id&&this.phase==='returning'?Math.sin(this.phaseTime*15)*Math.exp(-this.phaseTime*7)*.10:0;
      return {...c,sx:1+hit,sy:1-hit};
    });
  }
  reset(){
    this.phase='idle';this.phaseTime=0;this.contactAction=null;
    Object.assign(this.player,this.layout.player,{vx:0,vy:0,squash:0,roll:0});
  }
  get maxPull(){return clamp(Math.min(this.width,this.height)*.25,90,170);}
  get ready(){return this.phase==='idle';}
  get fade(){return this.phase==='entering'?1-ease(this.phaseTime/1.1):this.phase==='done'?0:1;}
  get hudOpacity(){return this.phase==='entering'?ease((this.phaseTime-.15)/1.05):this.phase==='done'?1:0;}
  get pull(){
    if(this.phase!=='wobble')return null;
    const t=this.phaseTime/.82;
    const wave=Math.sin(t*Math.PI*6)*(1-t)**2*this.power*.8;
    return {dx:this.direction.x*wave*this.maxPull,dy:this.direction.y*wave*this.maxPull};
  }
  shoot(dx,dy){
    const distance=Math.hypot(dx,dy);
    if(!this.ready || distance<6)return false;
    this.power=clamp(distance/this.maxPull,0,1);
    this.direction={x:-dx/distance,y:-dy/distance};
    const speed=clamp(Math.min(this.width,this.height)*.047,18,34)*40*this.power;
    const candidates=this.targets.map(target=>({target,distance:contactDistance(this.player,target,this.direction.x,this.direction.y)})).sort((a,b)=>a.distance-b.distance);
    this.target=candidates[0].target;this.remaining=candidates[0].distance;
    this.phaseTime=0;
    // Match the arena's drag loss; require a finite, timely arrival before committing.
    const reachable=speed*(1-Math.exp(-.6*1.6))/.6;
    if(!Number.isFinite(this.remaining)||this.remaining>reachable){this.phase='wobble';return true;}
    this.phase='flight';this.speed=speed;
    this.player.angle=Math.atan2(dy,dx);this.player.squash=-.25*this.power;
    return true;
  }
  launchTo(id){const p=this.player,c=this.targets.find(c=>c.id===id),d=Math.hypot(c.x-p.x,c.y-p.y);return this.shoot((p.x-c.x)/d*this.maxPull,(p.y-c.y)/d*this.maxPull);}
  launchToPlay(){return this.launchTo('play');}
  resize(width,height){
    const rx=width/this.width,ry=height/this.height,oldR=this.layout.player.r;
    this.width=width;this.height=height;this.layout=homeLayout(width,height);
    if(this.phase==='entering'){
      this.from.x*=rx;this.from.y*=ry;this.from.r*=this.layout.player.r/oldR;
      this.placeEntering();
    }else if(this.phase!=='done'){
      this.phase='idle';this.phaseTime=0;
      Object.assign(this.player,this.layout.player,{vx:0,vy:0,squash:0,roll:0});
    }
  }
  placeEntering(){
    const t=ease(this.phaseTime/1.45),p=this.player;
    p.x=lerp(this.from.x,this.width*.5,t);p.y=lerp(this.from.y,this.height*.62,t);
    p.r=lerp(this.from.r,clamp(Math.min(this.width,this.height)*.047,18,34),t);
    p.angle=Math.atan2(this.height*.62-this.from.y,this.width*.5-this.from.x);
    p.squash=Math.sin(this.phaseTime*13)*.14*(1-t);p.roll=t*Math.PI*2;
  }
  step(dt,animate=true){
    this.animate=animate;
    if(this.phase==='idle'||this.phase==='wobble')this.clock+=animate?dt:0;
    this.phaseTime+=dt;
    const p=this.player;
    if(this.phase==='idle'){p.squash=animate?Math.sin(this.clock*1.3)*.035:0;return;}
    if(this.phase==='wobble'){
      if(this.phaseTime>=.82){this.phase='idle';this.phaseTime=0;}
      return;
    }
    if(this.phase==='flight'){
      const travel=this.speed*(1-Math.exp(-.6*dt))/.6;
      const move=Math.min(travel,this.remaining);
      p.x+=this.direction.x*move;p.y+=this.direction.y*move;
      this.remaining-=move;this.speed*=Math.exp(-.6*dt);
      p.vx=this.direction.x*this.speed;p.vy=this.direction.y*this.speed;p.squash*=Math.exp(-dt*10);
      if(this.remaining<=.001){
        this.contactAction=this.target.id;this.phaseTime=0;this.from={x:p.x,y:p.y,r:p.r};
        p.vx=p.vy=0;
        this.phase=this.target.id==='play'?'entering':this.target.id==='sound'?'returning':'external';
        if(this.target.id!=='play')this.action=this.target.id;
      }
      return;
    }
    if(this.phase==='returning'){
      const t=smooth(this.phaseTime/.68),anchor=this.layout.player;
      p.x=lerp(this.from.x,anchor.x,t);p.y=lerp(this.from.y,anchor.y,t);
      p.squash=Math.sin(this.phaseTime*14)*.15*(1-t);p.roll=Math.sin(Math.PI*t)*.5;
      if(this.phaseTime>=.68)this.reset();
      return;
    }
    if(this.phase==='entering'){
      this.placeEntering();
      if(this.phaseTime>=1.45){this.phase='done';p.squash=0;p.roll=0;}
    }
  }
}
