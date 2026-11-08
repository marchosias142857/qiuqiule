const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=value=>Number.isFinite(value);

// A small presentation-only ribbon, sampled from real simulated positions.
// Distances are CSS-space game units; neither DPR nor the aim time scale alters
// the speed threshold. World-time ageing makes the ribbon slow with the ball.
export const COMET_TRAIL={startSpeed:20,endSpeed:18,fullSpeed:40,lifetime:.22,maxPoints:48};
const SAMPLE_SECONDS=1/120;

// Shared length growth, independent of feedback opacity and body radius.
// Decorations should follow this curve instead of duplicating speed gates.
export function cometGrowth(speed,unit){
  const amount=clamp((speed/Math.max(1e-6,unit)-COMET_TRAIL.endSpeed)/(COMET_TRAIL.fullSpeed-COMET_TRAIL.endSpeed),0,1);
  return amount*amount*(3-2*amount);
}

export function cometProfile(speed,radius,unit,strength=1){
  const gain=clamp(strength,0,1),growth=cometGrowth(speed,unit);
  // The first radius is covered by the ball. Grow the visible part from its
  // rear edge, rather than hiding the entire low-speed tail inside the body.
  const maximum=Math.min(radius*7,unit*8);
  return {length:radius+Math.max(0,maximum-radius)*growth,width:radius*.68,
    alpha:.24*gain*Math.sqrt(growth)};
}

function vertex(x=0,y=0){return {x,y};}

function setVertex(out,x,y,bounds){
  out.x=bounds?clamp(x,bounds.left,bounds.right):x;
  out.y=bounds?clamp(y,bounds.top,bounds.bottom):y;
}

// Walk the corner-cutting samples backwards, stopping at the requested length.
// The original pass emitted the oldest point, .25/.75 of each span, then the head.
function buildRibbon(points,{length,width,bounds=null},sections,segments){
  if(!(length>0)||!(width>0)||points.length<2)return 0;
  const head=points[points.length-1];
  const first=sections[0]??={};
  first.x=head.x;first.y=head.y;first.age=head.age;first.distance=0;
  let count=1,distance=0;
  for(let index=2*points.length-2;index>=0&&distance<length;index--){
    let x=points[0].x,y=points[0].y,age=points[0].age;
    if(index>0){
      const edge=Math.floor((index-1)/2),t=index%2?.25:.75;
      const a=points[edge],b=points[edge+1];
      x=a.x+(b.x-a.x)*t;y=a.y+(b.y-a.y)*t;age=a.age+(b.age-a.age)*t;
    }
    const newer=sections[count-1],span=Math.hypot(x-newer.x,y-newer.y);
    if(span<1e-6)continue;
    const take=Math.min(span,length-distance),mix=take/span;
    distance+=take;
    const section=sections[count++]??={};
    section.x=newer.x+(x-newer.x)*mix;section.y=newer.y+(y-newer.y)*mix;
    section.age=newer.age+(age-newer.age)*mix;section.distance=distance;
  }
  if(count<2||distance<.5)return 0;
  const visibleLength=Math.min(length,distance);
  const opacity=clamp(1-head.age/COMET_TRAIL.lifetime,0,1);
  for(let i=0;i<count;i++){
    const point=sections[i],before=sections[Math.max(0,i-1)],after=sections[Math.min(count-1,i+1)];
    let dx=after.x-before.x,dy=after.y-before.y;
    // At a complete reversal, use this segment rather than a zero tangent.
    if(Math.hypot(dx,dy)<1e-6){dx=point.x-before.x;dy=point.y-before.y;}
    if(Math.hypot(dx,dy)<1e-6){dx=after.x-point.x;dy=after.y-point.y;}
    const span=Math.max(1e-6,Math.hypot(dx,dy)),t=clamp(point.distance/visibleLength,0,1);
    point.nx=-dy/span;point.ny=dx/span;point.half=width*(.2+.8*(1-t)**.75);
    if(i===0)continue;
    const segment=segments[i-1]??={outer:[vertex(),vertex(),vertex(),vertex()],opacity,start:vertex(),end:vertex()};
    const [a,b,c,d]=segment.outer;
    setVertex(a,before.x+before.nx*before.half,before.y+before.ny*before.half,bounds);
    setVertex(b,point.x+point.nx*point.half,point.y+point.ny*point.half,bounds);
    setVertex(c,point.x-point.nx*point.half,point.y-point.ny*point.half,bounds);
    setVertex(d,before.x-before.nx*before.half,before.y-before.ny*before.half,bounds);
    setVertex(segment.start,before.x,before.y);setVertex(segment.end,point.x,point.y);
    segment.opacity=opacity;segment.startWidth=before.half;segment.endWidth=point.half;
  }
  return count-1;
}

// Standalone callers own these results, even when they keep multiple frames.
export function cometRibbon(points,options={}){
  const ribbon=[];
  buildRibbon(points,options,[],ribbon);
  return ribbon;
}

// The sides carry the ink while the center remains almost clear. Feather the
// outermost edges instead of adding outlines, blur textures or background paint.
// Each band owns its width: adjacent alpha bands do not stack over the center.
export const COMET_CROSS_SECTION=Object.freeze([
  [0,.05,.08],[.05,.12,.4],[.12,.26,1],[.26,.4,.36],[.4,.6,.06],
  [.6,.74,.36],[.74,.88,1],[.88,.95,.4],[.95,1,.08]
].map(([from,to,alpha])=>Object.freeze({from,to,alpha})));

function interpolateInto(out,left,right,t){
  out.x=left.x+(right.x-left.x)*t;
  out.y=left.y+(right.y-left.y)*t;
}

function buildBands(ribbon,count,bands,storage){
  const vertexCount=2*(count+1);
  for(let index=0;index<COMET_CROSS_SECTION.length;index++){
    const band=COMET_CROSS_SECTION[index];
    const output=bands[index]??={vertices:[],opacity:ribbon[0].opacity,crossAlpha:band.alpha,region:index};
    output.opacity=ribbon[0].opacity;
    const vertices=output.vertices;
    // A shorter frame may shrink the public polygon. Keep the bounded scratch
    // points separately so they can be reused when a longer frame follows.
    const slots=storage?(storage[index]??=[]):vertices;
    vertices.length=vertexCount;
    for(let i=0;i<=count;i++){
      const outer=ribbon[Math.max(0,i-1)].outer;
      const left=outer[i?1:0],right=outer[i?2:3],back=vertexCount-1-i;
      const from=slots[i]??=vertex(),to=slots[back]??=vertex();
      interpolateInto(from,left,right,band.from);
      interpolateInto(to,left,right,band.to);
      vertices[i]=from;vertices[back]=to;
    }
  }
  return bands;
}

export function cometBands(ribbon){
  return ribbon.length?buildBands(ribbon,ribbon.length,[],null):[];
}

const NO_BANDS=Object.freeze([]);
// Live histories are bounded; external paths may use the same workspace.
// Larger external inputs still render fully, without keeping a larger buffer.
const MAX_WORKSPACE_SAMPLES=96;
export class CometWorkspace {
  constructor(){this.sections=[];this.segments=[];this.output=[];this.vertices=[];}
  /** The returned bands are borrowed until the next call on this workspace. */
  bands(points,options={}){
    if(points.length>MAX_WORKSPACE_SAMPLES)return cometBands(cometRibbon(points,options));
    const count=buildRibbon(points,options,this.sections,this.segments);
    return count?buildBands(this.segments,count,this.output,this.vertices):NO_BANDS;
  }
}

function fillRibbon(graphics,vertices,color,alpha){
  if(!(alpha>.0001))return;
  graphics.fillStyle(color,alpha);graphics.beginPath();
  vertices.forEach((point,index)=>index?graphics.lineTo(point.x,point.y):graphics.moveTo(point.x,point.y));
  graphics.closePath();graphics.fillPath();
}

export class CometTrails {
  constructor(){this.entries=new Map();this.workspace=null;this.generation=0;}
  clear(){this.entries.clear();this.workspace=null;}
  /** Borrowed read-only state, valid until the next step/clear. Mileage is
   * sampled world travel; resets are identified by a new generation. */
  getState(body){return this.entries.get(body)||null;}
  /** Sample the same quarter/three-quarter corner-cutting centerline used by
   * buildRibbon. Insufficient history is explicit: never stack at its tail.
   * The caller owns `out`, so repeated particle births need no sample objects. */
  sample(body,backwardDistance,out={}){
    const trail=this.entries.get(body),points=trail?.points;
    out.valid=false;out.available=0;out.generation=trail?.generation??-1;
    if(!points?.length||!finite(backwardDistance)||backwardDistance<0)return out;
    let x=points[points.length-1].x,y=points[points.length-1].y,distance=0;
    for(let index=2*points.length-2;index>=0;index--){
      let px=points[0].x,py=points[0].y;
      if(index>0){
        const edge=Math.floor((index-1)/2),t=index%2?.25:.75;
        const a=points[edge],b=points[edge+1];
        px=a.x+(b.x-a.x)*t;py=a.y+(b.y-a.y)*t;
      }
      const dx=x-px,dy=y-py,span=Math.hypot(dx,dy);
      if(span<1e-6)continue;
      if(distance+span>=backwardDistance-1e-8){
        const take=clamp(backwardDistance-distance,0,span);
        out.x=x-dx*take/span;out.y=y-dy*take/span;
        out.nx=dx/span;out.ny=dy/span;out.available=backwardDistance;
        out.valid=true;return out;
      }
      distance+=span;x=px;y=py;
    }
    out.available=distance;return out;
  }
  step(bodies,dt,{unit=1,enabled=true}={}){
    if(!enabled){this.clear();return;}
    // A hidden-tab time gap does not describe a traversable flight path.
    if(finite(dt)&&dt>.1)this.clear();
    const elapsed=clamp(finite(dt)?dt:0,0,.05);
    // Ordinary play supplies one player and at most two clones.
    const living=Array.isArray(bodies)&&bodies.length<=3?null:new Set(bodies);
    for(const [body,trail] of this.entries){
      if(!(living?living.has(body):bodies.includes(body)))this.entries.delete(body);
      // A restored map may contain generations newer than this instance.
      // Observe every retained entry before assigning any new generation.
      else if(Number.isSafeInteger(trail.generation)&&trail.generation>this.generation)this.generation=trail.generation;
    }
    for(const body of bodies){
      if(!body||!finite(body.x)||!finite(body.y)||!finite(body.r)||!finite(body.vx)||!finite(body.vy)||body.r<=0){this.entries.delete(body);continue;}
      const speed=Math.hypot(body.vx,body.vy),speedUnits=speed/Math.max(1e-6,unit);
      let trail=this.entries.get(body);
      if(!trail){trail={points:[],active:false,lastX:body.x,lastY:body.y,lastSpeed:speed,sampleAge:0,liveHead:null,lastDx:0,lastDy:0,hasSample:false,generation:++this.generation,mileage:0,frameDistance:0};this.entries.set(body,trail);}
      // Older run snapshots already own a valid thin ribbon, but predate the
      // particle sampler's metadata. Keep that ribbon and start fresh mileage.
      if(!Number.isSafeInteger(trail.generation)||trail.generation<1)trail.generation=++this.generation;
      if(!finite(trail.mileage)||trail.mileage<0)trail.mileage=0;
      if(!finite(trail.frameDistance)||trail.frameDistance<0)trail.frameDistance=0;
      const moved=Math.hypot(body.x-trail.lastX,body.y-trail.lastY);
      const discontinuity=moved>Math.max(body.r*4,Math.max(speed,trail.lastSpeed)*elapsed*2.5+unit)||(elapsed===0&&moved>1e-6);
      if(discontinuity){
        trail.points.length=0;trail.liveHead=null;trail.sampleAge=0;trail.lastDx=trail.lastDy=0;trail.hasSample=false;
        trail.generation=++this.generation;trail.mileage=0;
      }
      trail.frameDistance=discontinuity?0:moved;trail.mileage+=trail.frameDistance;
      let retained=0;
      for(const point of trail.points){
        point.age+=elapsed;
        if(point.age<=COMET_TRAIL.lifetime)trail.points[retained++]=point;
        else if(point===trail.liveHead)trail.liveHead=null;
      }
      trail.points.length=retained;
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
          const point=trail.liveHead||{};
          if(!trail.liveHead)trail.points.push(point);
          point.x=body.x;point.y=body.y;point.age=0;
          trail.hasSample=true;
          if(!last||turning||trail.sampleAge>=SAMPLE_SECONDS-1e-10){
            trail.liveHead=null;trail.sampleAge=0;
          }else trail.liveHead=point;
          if(trail.points.length>COMET_TRAIL.maxPoints){
            trail.points.copyWithin(0,trail.points.length-COMET_TRAIL.maxPoints);
            trail.points.length=COMET_TRAIL.maxPoints;
          }
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
      const workspace=this.workspace??=new CometWorkspace();
      for(const band of workspace.bands(trail.points,{...profile,bounds})){
        fillRibbon(graphics,band.vertices,color,profile.alpha*band.opacity*band.crossAlpha);
      }
    }
  }
}
