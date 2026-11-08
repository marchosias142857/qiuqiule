import {CometTrails,cometProfile,cometGrowth} from './comet-trail.js';
import {drawParticleAppearance,particleVisualStyle} from './particle-appearance.js';
import {resolveStarTrailShape} from './star-trails.js';

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
const sizeAt=t=>t<.15?.7+.3*smooth(t/.15):t<=.4?1:1-.5*smooth((t-.4)/.6);
const GOLDEN_STEP=.618033988749895;
const speedOpacity=speedUnits=>smooth((speedUnits-27)/6);

export const STAR_PARTICLE_LIMITS=Object.freeze({startGrowth:.57,endGrowth:.37,spacing:3,rate:28,emissionScale:1.1,main:12,total:24,lifetime:[.30,.40],longitudinalDrag:10,lateralDrag:2.5});

/** Presentation-only particles. The independent PRNG never changes a run's
 * game randomness. A supplied CometTrails must be stepped before this system. */
export class StarParticles{
  constructor({seed=0x51a7cafe}={}){
    this.seed=seed>>>0;this.shapeSeed=(seed^0x6d2b79f5)>>>0;this.clock=0;this.particles=[];
    this.free=Array.from({length:STAR_PARTICLE_LIMITS.total},()=>({}));
    this.trackers=new Map();this.bounds=null;this.fallbackTrails=null;
    this.sampleResult={};this.boundPosition={};this.drawPosition={};this.emissionCount=0;
  }
  get count(){return this.particles.length;}
  clear(){
    while(this.particles.length)this.free.push(this.particles.pop());
    this.trackers.clear();this.clock=0;this.fallbackTrails?.clear();
  }
  random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  shapeRandom(){this.shapeSeed=(Math.imul(this.shapeSeed,1664525)+1013904223)>>>0;return this.shapeSeed/4294967296;}
  newTracker(b,state){return{x:b.x,y:b.y,generation:state.generation,active:false,phase:0,spacing:0,jitter:.65+.7*this.random(),lateralPhase:this.random()};}
  advanceParticle(p,dt){
    p.age+=dt;
    const forwardDecay=Math.exp(-STAR_PARTICLE_LIMITS.longitudinalDrag*dt),sideDecay=Math.exp(-STAR_PARTICLE_LIMITS.lateralDrag*dt);
    const forwardTravel=p.forward*(1-forwardDecay)/STAR_PARTICLE_LIMITS.longitudinalDrag;
    const sideTravel=p.lateral*(1-sideDecay)/STAR_PARTICLE_LIMITS.lateralDrag;
    p.x+=p.nx*forwardTravel-p.ny*sideTravel;p.y+=p.ny*forwardTravel+p.nx*sideTravel;
    p.forward*=forwardDecay;p.lateral*=sideDecay;
    p.vx=p.nx*p.forward-p.ny*p.lateral;p.vy=p.ny*p.forward+p.nx*p.lateral;
    p.rotation+=p.spin*dt;
  }
  clampedPosition(p,out){
    const bounds=this.bounds;out.x=p.x;out.y=p.y;if(!bounds)return out;
    const style=particleVisualStyle(p.shape),radius=p.r*sizeAt(clamp(p.age/p.life,0,1))*style.sizeScale*style.extent;
    const xInset=Math.min(radius,Math.max(0,(bounds.right-bounds.left)/2));
    const yInset=Math.min(radius,Math.max(0,(bounds.bottom-bounds.top)/2));
    const left=bounds.left+xInset,right=bounds.right-xInset,top=bounds.top+yInset,bottom=bounds.bottom-yInset;
    out.x=clamp(p.x,left,right);out.y=clamp(p.y,top,bottom);return out;
  }
  constrainParticle(p){
    const position=this.clampedPosition(p,this.boundPosition);
    let changed=false;
    if((position.x>p.x&&p.vx<0)||(position.x<p.x&&p.vx>0)){p.vx=0;changed=true;}
    if((position.y>p.y&&p.vy<0)||(position.y<p.y&&p.vy>0)){p.vy=0;changed=true;}
    p.x=position.x;p.y=position.y;
    if(changed){p.forward=p.vx*p.nx+p.vy*p.ny;p.lateral=-p.vx*p.ny+p.vy*p.nx;}
  }
  distanceOpacity(p,state,currentLength){
    const distance=Math.max(0,state.mileage-p.birthMileage+p.backDistance);
    const length=Math.min(p.birthTrailLength,currentLength);
    return length>0?1-smooth((distance-1.3*length)/(.7*length)):0;
  }
  step(bodies,dt,{unit=18,bounds=null,enabled=true,strength=.6,trails=null,shape='star'}={}){
    if(!enabled||!(strength>0)||!resolveStarTrailShape(shape,0)){this.clear();return;}
    if(!Number.isFinite(dt)||dt<0)return;
    // Clones intentionally retain only their ordinary thin trail.
    const living=(bodies||[]).filter(b=>b&&b.isPlayer===true&&!b.isAuxiliary&&b.hp>0&&b.active!==false&&!b.captured&&Number.isFinite(b.x)&&Number.isFinite(b.y)&&Number.isFinite(b.r)&&b.r>0);
    this.bounds=bounds;unit=Math.max(.001,unit);strength=clamp(strength,0,1);
    if(!trails){trails=this.fallbackTrails??=new CometTrails();trails.step(living,dt,{unit});}
    if(dt>.1){this.clear();return;}
    const startTime=this.clock;this.clock+=dt;
    // All particles of an emitter share its current speed and trail length.
    // Refresh once per step, including below the particle emission threshold.
    for(const b of living){
      const track=this.trackers.get(b);if(!track)continue;
      const speed=Math.hypot(b.vx||0,b.vy||0);
      track.currentLength=cometProfile(speed,b.r,unit,strength).length;
      track.currentOpacity=speedOpacity(speed/unit);
    }
    let keep=0;
    for(const p of this.particles){
      const state=trails.getState(p.owner);
      if(!state||state.generation!==p.generation||!living.includes(p.owner)){this.free.push(p);continue;}
      const track=this.trackers.get(p.owner);
      this.advanceParticle(p,dt);
      // Deceleration dims the whole existing string, not just future births.
      // Acceleration replenishes it with new particles without reviving old ink.
      p.opacity=Math.min(p.opacity,track.currentOpacity);
      p.distanceOpacity=Math.min(p.distanceOpacity,this.distanceOpacity(p,state,track.currentLength));
      this.constrainParticle(p);
      if(p.age>=p.life||p.opacity<=0||p.distanceOpacity<=0)this.free.push(p);else this.particles[keep++]=p;
    }
    this.particles.length=keep;
    for(const b of this.trackers.keys())if(!living.includes(b))this.trackers.delete(b);
    for(const b of living){
      const state=trails.getState(b);if(!state){this.trackers.delete(b);continue;}
      let track=this.trackers.get(b);
      if(!track||track.generation!==state.generation){this.trackers.set(b,this.newTracker(b,state));continue;}
      const dx=b.x-track.x,dy=b.y-track.y,moved=Math.hypot(dx,dy),speed=Math.hypot(b.vx||0,b.vy||0);
      const growth=cometGrowth(speed,unit);
      // Independent hysteresis follows the thin trail's length curve: about
      // 30u/s on and 27u/s off today. Existing particles keep fading naturally.
      track.active=track.active?growth>=STAR_PARTICLE_LIMITS.endGrowth:growth>=STAR_PARTICLE_LIMITS.startGrowth;
      // A render-only sample must not reset the partially travelled interval.
      if(dt===0){track.x=b.x;track.y=b.y;continue;}
      if(!track.active||b.feedbackFreeze>1e-8||moved<1e-7){
        track.phase=0;track.spacing=0;track.x=b.x;track.y=b.y;continue;
      }
      // Above the gate, use the same spacing at every speed. Only opacity
      // handles the 27–33u/s transition; feedback scaling and rate cap remain.
      const density=(.65+.35*strength)*STAR_PARTICLE_LIMITS.emissionScale;
      const rate=STAR_PARTICLE_LIMITS.rate*density,baseSpacing=STAR_PARTICLE_LIMITS.spacing*b.r/Math.max(.05,density);
      // Randomize only the distance requirement. Applying jitter after max()
      // would let short intervals break the time budget at high speed.
      const rateSpacing=moved/(dt*Math.max(.01,rate));
      let offset=0;
      while(offset<moved-1e-9){
        const spacing=Math.max(baseSpacing*track.jitter,rateSpacing);
        track.spacing=spacing;
        const required=(1-track.phase)*spacing,remaining=moved-offset;
        if(required>remaining+1e-8){track.phase=clamp(track.phase+remaining/spacing,0,1);break;}
        offset=Math.min(moved,offset+required);track.phase=0;
        const fraction=clamp(offset/moved,0,1),at=startTime+dt*fraction;
        const backDistance=b.r*(1.05+this.random()*.35);
        const origin=trails.sample(b,backDistance+moved*(1-fraction),this.sampleResult);
        const ownerCount=this.particles.reduce((n,p)=>n+Number(p.owner===b),0);
        if(origin.valid&&this.free.length&&ownerCount<STAR_PARTICLE_LIMITS.main){
          track.lateralPhase=(track.lateralPhase+GOLDEN_STEP)%1;
          const side=((track.lateralPhase*2-1)*.4+(this.random()-.5)*.1)*b.r;
          const inherit=.2+this.random()*.1,p=this.free.pop();
          const radius=b.r*(.14+this.random()*.06)*1.84;
          const sideSign=Math.abs(side)<.05*b.r?(this.random()<.5?-1:1):(side<0?-1:1);
          const sideSpeed=sideSign*b.r*(.8+.6*this.random());
          Object.assign(p,{shape:resolveStarTrailShape(shape,this.shapeRandom()),owner:b,generation:state.generation,x:origin.x-origin.ny*side,y:origin.y+origin.nx*side,
            nx:origin.nx,ny:origin.ny,forward:speed*inherit,lateral:sideSpeed,
            vx:origin.nx*speed*inherit-origin.ny*sideSpeed,vy:origin.ny*speed*inherit+origin.nx*sideSpeed,
            r:radius,age:0,life:STAR_PARTICLE_LIMITS.lifetime[0]+this.random()*(STAR_PARTICLE_LIMITS.lifetime[1]-STAR_PARTICLE_LIMITS.lifetime[0]),
            rotation:(this.random()-.5)*Math.PI*.4,spin:(this.random()-.5)*.6,
            opacity:track.currentOpacity,distanceOpacity:1,bornAt:at,sequence:++this.emissionCount,
            birthMileage:state.mileage-moved*(1-fraction),backDistance,birthSide:side,lateralPhase:track.lateralPhase,
            birthTrailLength:track.currentLength});
          p.birthRotation=p.rotation;
          this.advanceParticle(p,Math.max(0,this.clock-at));
          p.distanceOpacity=this.distanceOpacity(p,state,track.currentLength);this.constrainParticle(p);
          if(p.age>=p.life||p.opacity<=0||p.distanceOpacity<=0)this.free.push(p);else this.particles.push(p);
        }
        // Invalid history / full pool consumes the event too. There is never a
        // backlog to burst after a freeze, a reset or an available pool slot.
        track.jitter=.65+.7*this.random();
      }
      track.x=b.x;track.y=b.y;
    }
  }
  /** Render immutable birth shapes through the game's existing Graphics layer.
   * Collision-safe footprint clamping supplies the clip without a Canvas or
   * per-particle display object; drawing never changes the simulation. */
  draw(graphics,color,{strength=.6}={}){
    if(!(strength>0))return;
    for(const p of this.particles){
      const position=this.clampedPosition(p,this.drawPosition);
      const t=clamp(p.age/p.life,0,1),appear=smooth(t/.15),fade=t<.35?1:1-((t-.35)/.65)**1.35;
      drawParticleAppearance(graphics,{shape:p.shape,x:position.x,y:position.y,radius:p.r*sizeAt(t),color,
        alpha:appear*fade*p.distanceOpacity*clamp(strength,0,1)*p.opacity,rotation:p.rotation});
    }
  }
}
