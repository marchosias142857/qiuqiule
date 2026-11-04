const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=value=>Number.isFinite(value);

// A small presentation-only ribbon, sampled from real simulated positions.
// Distances are CSS-space game units; neither DPR nor the aim time scale alters
// the speed threshold. World-time ageing makes the ribbon slow with the ball.
export const COMET_TRAIL={startSpeed:20,endSpeed:18,fullSpeed:40,lifetime:.22,maxPoints:48};
const SAMPLE_SECONDS=1/120;

export function cometProfile(speed,radius,unit,strength=1){
  const amount=clamp((speed/Math.max(1e-6,unit)-COMET_TRAIL.endSpeed)/(COMET_TRAIL.fullSpeed-COMET_TRAIL.endSpeed),0,1);
  const gain=clamp(strength,0,1),growth=amount*amount*(3-2*amount);
  // The first radius is covered by the ball. Grow the visible part from its
  // rear edge, rather than hiding the entire low-speed tail inside the body.
  const maximum=Math.min(radius*7,unit*8);
  return {length:radius+Math.max(0,maximum-radius)*growth,width:radius*.68,
    alpha:.24*gain*Math.sqrt(growth)};
}

const bounded=(point,bounds)=>bounds?{
  x:clamp(point.x,bounds.left,bounds.right),y:clamp(point.y,bounds.top,bounds.bottom)
}:point;

// Trim by travelled distance, not sample count: a faster ball earns a longer
// tapered tail without leaving an arbitrary number of detached ghost balls.
export function cometRibbon(points,{length,width,bounds=null}={}){
  if(!(length>0)||!(width>0)||points.length<2)return [];
  // One corner-cutting pass stays inside the sampled path's convex hull. It
  // rounds a bounce without spline overshoot through the wall, and does not
  // depend on how often the presentation frame happens to be drawn.
  const rounded=[points[0]],mixPoint=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,age:a.age+(b.age-a.age)*t});
  for(let i=1;i<points.length;i++)rounded.push(mixPoint(points[i-1],points[i],.25),mixPoint(points[i-1],points[i],.75));
  rounded.push(points[points.length-1]);
  const path=[{...rounded[rounded.length-1],distance:0}];
  let distance=0;
  for(let i=rounded.length-2;i>=0&&distance<length;i--){
    const newer=path[path.length-1],older=rounded[i],span=Math.hypot(older.x-newer.x,older.y-newer.y);
    if(span<1e-6)continue;
    const take=Math.min(span,length-distance),mix=take/span;
    distance+=take;
    path.push({x:newer.x+(older.x-newer.x)*mix,y:newer.y+(older.y-newer.y)*mix,
      age:newer.age+(older.age-newer.age)*mix,distance});
  }
  if(path.length<2||distance<.5)return [];
  // The requested comet has its narrow tip cut off: preserve an open-looking,
  // flat nonzero-width end, with no outline and no round end cap.
  const visibleLength=Math.min(length,distance);
  const sections=path.map((point,i)=>{
    const before=path[Math.max(0,i-1)],after=path[Math.min(path.length-1,i+1)];
    let dx=after.x-before.x,dy=after.y-before.y;
    // At a complete reversal, use this segment rather than a zero tangent.
    if(Math.hypot(dx,dy)<1e-6){dx=point.x-before.x;dy=point.y-before.y;}
    if(Math.hypot(dx,dy)<1e-6){dx=after.x-point.x;dy=after.y-point.y;}
    const span=Math.max(1e-6,Math.hypot(dx,dy)),t=clamp(point.distance/visibleLength,0,1);
    const half=width*(.2+.8*(1-t)**.75);
    return {...point,t,nx:-dy/span,ny:dx/span,half};
  });
  return sections.slice(1).map((end,i)=>{
    const start=sections[i];
    const vertices=factor=>[
      bounded({x:start.x+start.nx*start.half*factor,y:start.y+start.ny*start.half*factor},bounds),
      bounded({x:end.x+end.nx*end.half*factor,y:end.y+end.ny*end.half*factor},bounds),
      bounded({x:end.x-end.nx*end.half*factor,y:end.y-end.ny*end.half*factor},bounds),
      bounded({x:start.x-start.nx*start.half*factor,y:start.y-start.ny*start.half*factor},bounds)
    ];
    return {outer:vertices(1),opacity:clamp(1-path[0].age/COMET_TRAIL.lifetime,0,1),
      start:{x:start.x,y:start.y},end:{x:end.x,y:end.y},startWidth:start.half,endWidth:end.half};
  });
}

// The sides carry the ink while the center remains almost clear. Feather the
// outermost edges instead of adding outlines, blur textures or background paint.
// Each band owns its width: adjacent alpha bands do not stack over the center.
export const COMET_CROSS_SECTION=Object.freeze([
  [0,.05,.08],[.05,.12,.4],[.12,.26,1],[.26,.4,.36],[.4,.6,.06],
  [.6,.74,.36],[.74,.88,1],[.88,.95,.4],[.95,1,.08]
].map(([from,to,alpha])=>Object.freeze({from,to,alpha})));

export function cometBands(ribbon){
  if(!ribbon.length)return [];
  // Each transverse band is one continuous polygon along the whole curve.
  // Width does the comet taper; no longitudinal alpha buckets can leave tiny
  // crosswise seams, and the cost stays at nine fills per ball.
  const interpolate=(left,right,t)=>({x:left.x+(right.x-left.x)*t,y:left.y+(right.y-left.y)*t});
  return COMET_CROSS_SECTION.map((band,index)=>{
    const start=ribbon[0].outer,edge=t=>[interpolate(start[0],start[3],t),...ribbon.map(({outer})=>interpolate(outer[1],outer[2],t))];
    return {vertices:[...edge(band.from),...edge(band.to).reverse()],
      opacity:ribbon[0].opacity,crossAlpha:band.alpha,region:index};
  });
}

function fillRibbon(graphics,vertices,color,alpha){
  if(!(alpha>.0001))return;
  graphics.fillStyle(color,alpha);graphics.beginPath();
  vertices.forEach((point,index)=>index?graphics.lineTo(point.x,point.y):graphics.moveTo(point.x,point.y));
  graphics.closePath();graphics.fillPath();
}

export class CometTrails {
  constructor(){this.entries=new Map();}
  clear(){this.entries.clear();}
  step(bodies,dt,{unit=1,enabled=true}={}){
    if(!enabled){this.clear();return;}
    const elapsed=clamp(finite(dt)?dt:0,0,.05),living=new Set(bodies);
    for(const body of this.entries.keys())if(!living.has(body))this.entries.delete(body);
    for(const body of bodies){
      if(![body?.x,body?.y,body?.r,body?.vx,body?.vy].every(finite)||body.r<=0){this.entries.delete(body);continue;}
      const speed=Math.hypot(body.vx,body.vy),speedUnits=speed/Math.max(1e-6,unit);
      let trail=this.entries.get(body);
      if(!trail){trail={points:[],active:false,lastX:body.x,lastY:body.y,lastSpeed:speed,sampleAge:0,liveHead:null,lastDx:0,lastDy:0,hasSample:false};this.entries.set(body,trail);}
      const moved=Math.hypot(body.x-trail.lastX,body.y-trail.lastY);
      if(moved>Math.max(body.r*4,Math.max(speed,trail.lastSpeed)*elapsed*2.5+unit)){
        trail.points=[];trail.liveHead=null;trail.sampleAge=0;trail.lastDx=trail.lastDy=0;trail.hasSample=false;
      }
      for(const point of trail.points)point.age+=elapsed;
      trail.points=trail.points.filter(point=>point.age<=COMET_TRAIL.lifetime);
      if(trail.liveHead&&!trail.points.includes(trail.liveHead))trail.liveHead=null;
      trail.sampleAge=Math.min(SAMPLE_SECONDS,trail.sampleAge+elapsed);
      trail.active=trail.active?speedUnits>=COMET_TRAIL.endSpeed:speedUnits>=COMET_TRAIL.startSpeed;
      if(trail.active&&!(body.feedbackFreeze>0)){
        const last=trail.points[trail.points.length-1];
        if(!trail.hasSample||moved>1e-6){
          const dx=body.x-trail.lastX,dy=body.y-trail.lastY,previousSpan=Math.hypot(trail.lastDx,trail.lastDy);
          const turning=moved>1e-6&&previousSpan>1e-6&&(dx*trail.lastDx+dy*trail.lastDy)/(moved*previousSpan)<.95;
          // Keep a world-time-spaced history even when slow motion produces
          // several tiny physics steps per sample. Only the live head follows
          // every step, so it stays attached without crowding out the tail.
          // A change of direction pins the previous head before following the
          // new segment; corner rounding therefore stays inside the path.
          if(turning)trail.liveHead=null;
          const point=trail.liveHead||{x:body.x,y:body.y,age:0};
          if(!trail.liveHead)trail.points.push(point);
          Object.assign(point,{x:body.x,y:body.y,age:0});
          trail.hasSample=true;
          if(!last||turning||trail.sampleAge>=SAMPLE_SECONDS-1e-10){
            trail.liveHead=null;trail.sampleAge=0;
          }else trail.liveHead=point;
          if(trail.points.length>COMET_TRAIL.maxPoints)trail.points.splice(0,trail.points.length-COMET_TRAIL.maxPoints);
          if(moved>1e-6){trail.lastDx=dx;trail.lastDy=dy;}
        }
      }
      trail.lastX=body.x;trail.lastY=body.y;trail.lastSpeed=speed;
    }
  }
  draw(graphics,bodies,color,{unit=1,strength=1,bounds=null}={}){
    if(!(strength>0))return;
    for(const body of bodies){
      const trail=this.entries.get(body);if(!trail?.active)continue;
      const profile=cometProfile(Math.hypot(body.vx,body.vy),body.r,unit,strength);
      for(const band of cometBands(cometRibbon(trail.points,{...profile,bounds}))){
        fillRibbon(graphics,band.vertices,color,profile.alpha*band.opacity*band.crossAlpha);
      }
    }
  }
}
