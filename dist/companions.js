import {CometWorkspace,COMET_TRAIL} from './comet-trail.js';

const TAU=Math.PI*2;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
export const COMPANION_STATE_VERSION=2;
export const COMPANION_UNLOCK_STEP=5;
export const COMPANION_ORBIT={radius:1.5,size:.21,period:3.4,opacity:.60,tailOpacity:.24};
const names=['一','二','三'];
export const COMPANION_DEFINITIONS=Object.freeze(Array.from({length:9},(_,index)=>{
  const count=Math.floor(index/3)+1,shape=['sun','moon','star'][index%3];
  const label=['日','月','星'][index%3]+'·'+names[count-1];
  return Object.freeze({id:shape+'-'+count,label,name:label,shape,count,stage:(index+1)*COMPANION_UNLOCK_STEP});
}));

function object(raw){
  if(typeof raw==='string'){try{raw=JSON.parse(raw);}catch{return {};}}
  return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
}
function stageCount(stage){
  if(typeof stage!=='number'&&typeof stage!=='string')return 0;
  const value=Number(stage);
  return Number.isFinite(value)?clamp(Math.floor(value/COMPANION_UNLOCK_STEP),0,9):0;
}
export function normalizeCompanionState(raw,{highestStage=0}={}){
  const saved=object(raw),owned=clamp(Math.floor(finite(saved.unlocked)),0,9);
  const unlocked=Math.max(owned,stageCount(highestStage));
  const index=COMPANION_DEFINITIONS.findIndex(item=>item.id===saved.selected);
  const pending=new Set(Array.isArray(saved.pendingUnlocks)?saved.pendingUnlocks:[]);
  // v1 ownership already includes its score rewards. Preserve it without
  // replaying their celebrations; only newly earned stage rewards join the
  // durable queue. Loading or selecting a companion never acknowledges it.
  for(let i=owned;i<unlocked;i++)pending.add(COMPANION_DEFINITIONS[i].id);
  const pendingUnlocks=COMPANION_DEFINITIONS.slice(0,unlocked).filter(item=>pending.has(item.id)).map(item=>item.id);
  return {version:COMPANION_STATE_VERSION,unlocked,selected:index>=0&&index<unlocked?saved.selected:null,pendingUnlocks};
}
export function unlockCompanions(raw,highestStage){
  const before=normalizeCompanionState(raw),state=normalizeCompanionState(before,{highestStage});
  return {state,newlyUnlocked:COMPANION_DEFINITIONS.slice(before.unlocked,state.unlocked).map(item=>item.id)};
}
export function acknowledgeCompanionUnlock(raw,id){
  const state=normalizeCompanionState(raw);
  return {...state,pendingUnlocks:state.pendingUnlocks.filter(pending=>pending!==id)};
}
export function selectCompanion(raw,id){
  const state=normalizeCompanionState(raw);
  if(id===null)return {...state,selected:null};
  const index=COMPANION_DEFINITIONS.findIndex(item=>item.id===id);
  if(index<0||index>=state.unlocked)return state;
  return {...state,selected:state.selected===id?null:id};
}

function colorNumber(value){
  if(typeof value==='string'&&/^#[\da-f]{6}$/i.test(value))return parseInt(value.slice(1),16);
  return clamp(Math.round(finite(value,0x252720)),0,0xffffff);
}
function mixColor(a,b,weight){
  const channel=shift=>Math.round(((a>>shift)&255)*(1-weight)+((b>>shift)&255)*weight);
  return (channel(16)<<16)|(channel(8)<<8)|channel(0);
}
export function companionColors(value){
  const base=colorNumber(value);
  return {base,center:mixColor(base,0xffffff,.42),edge:mixColor(base,0,.2)};
}
const point=(x,y)=>({x,y});
const scale=(p,factor)=>point(p.x*factor,p.y*factor);
const lerpPoint=(a,b,t)=>point(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t);

function outline(shape){
  if(shape==='sun')return Array.from({length:16},(_,i)=>point(Math.cos(i*TAU/16),Math.sin(i*TAU/16)));
  // Four concave quadratic arcs give the four-point star a soft, compact body.
  const tips=[point(0,-1),point(1,0),point(0,1),point(-1,0)];
  const controls=[point(.12,-.12),point(.12,.12),point(-.12,.12),point(-.12,-.12)];
  return tips.flatMap((start,index)=>Array.from({length:4},(_,i)=>{
    const t=i/4,end=tips[(index+1)%4],control=controls[index],a=(1-t)**2,b=2*(1-t)*t;
    return point(a*start.x+b*control.x+t*t*end.x,a*start.y+b*control.y+t*t*end.y);
  }));
}

// Four geometric bands carry continuous endpoint colors in WebGL. The
// coverage is disjoint, so the original translucency is applied exactly once.
function bodyTemplate(shape){
  const bands=[];
  if(shape==='moon'){
    const offset=.45,innerRadius=.9,joinX=(1-innerRadius*innerRadius+offset*offset)/(2*offset);
    const joinY=Math.sqrt(1-joinX*joinX),outerStart=-Math.atan2(joinY,joinX);
    const innerStart=TAU-Math.atan2(joinY,joinX-offset);
    const outer=Array.from({length:13},(_,i)=>{
      const angle=outerStart-(TAU+outerStart*2)*i/12;
      return point(Math.cos(angle),Math.sin(angle));
    });
    const inner=Array.from({length:13},(_,i)=>{
      const angle=innerStart-(innerStart-Math.atan2(joinY,joinX-offset))*i/12;
      return point(offset+innerRadius*Math.cos(angle),innerRadius*Math.sin(angle));
    });
    for(let i=0;i<4;i++)bands.push({
      outer:outer.map((p,j)=>lerpPoint(p,inner[j],i/4)),
      inner:outer.map((p,j)=>lerpPoint(p,inner[j],(i+1)/4)),closed:false,
      brightness:Math.sin(Math.PI*(i+.5)/4),
      outerBrightness:Math.sin(Math.PI*i/4),innerBrightness:Math.sin(Math.PI*(i+1)/4),
    });
  }else{
    const points=outline(shape);
    for(let i=0;i<4;i++)bands.push({outer:points.map(p=>scale(p,(i+1)/4)),inner:points.map(p=>scale(p,i/4)),closed:true,brightness:1-(i+.5)/4,outerBrightness:1-(i+1)/4,innerBrightness:1-i/4});
  }
  if(shape==='moon'){
    // Center the crescent's filled area, so its actual body (not an invisible
    // parent circle) revolves around exactly the same player-centered orbit.
    const boundary=[...bands[0].outer,...bands.at(-1).inner.slice().reverse()];
    let area=0,cx=0,cy=0;
    boundary.forEach((p,i)=>{const q=boundary[(i+1)%boundary.length],cross=p.x*q.y-q.x*p.y;area+=cross;cx+=(p.x+q.x)*cross;cy+=(p.y+q.y)*cross;});
    cx/=3*area;cy/=3*area;
    for(const band of bands){band.outer=band.outer.map(p=>point(p.x-cx,p.y-cy));band.inner=band.inner.map(p=>point(p.x-cx,p.y-cy));}
  }
  return bands;
}
const templates=new Map(['sun','moon','star'].map(shape=>[shape,bodyTemplate(shape)]));
const trailLength=COMPANION_ORBIT.size*4.6,trailAngle=trailLength/COMPANION_ORBIT.radius;
const MAX_HISTORY_POINTS=96;
const trailTemplate=Array.from({length:8},(_,i)=>{
  const angle=-trailAngle*(1-i/7);
  return {x:Math.cos(angle)*COMPANION_ORBIT.radius,y:Math.sin(angle)*COMPANION_ORBIT.radius,age:(1-i/7)*.2};
});

/** Only in-play speed stretches the existing orbit tail. Use the player's
 * world-unit threshold, independent of the companion's own orbital speed. */
export function companionTrailLength(radius,{speed=0,unit=radius,inPlay=false}={}){
  const r=Math.max(0,finite(radius)),base=trailLength*r;
  if(!inPlay||!r)return base;
  const u=Number.isFinite(unit)&&unit>0?unit:r;
  const amount=clamp((Math.max(0,finite(speed))/u-COMET_TRAIL.startSpeed)/(COMET_TRAIL.fullSpeed-COMET_TRAIL.startSpeed),0,1);
  const growth=amount*amount*(3-2*amount);
  return base*(1+2*growth);
}

/** Actual rendered world positions, never relative-to-player orbit samples.
 * Explicit clear/retain hooks keep menu transfers and newly equipped bodies
 * from inheriting another object's trail. No physics object is retained. */
export class CompanionTrails {
  constructor(){this.entries=new Map();this.recycledPoints=[];}
  clear(){this.entries.clear();this.recycledPoints.length=0;}
  retain(keys){const living=new Set(keys);for(const key of this.entries.keys())if(!living.has(key))this.entries.delete(key);}
  retainIds(ids){const living=new Set(ids);for(const key of this.entries.keys())if(!living.has(key.slice(0,key.lastIndexOf(':'))))this.entries.delete(key);}
  sample(key,center,radius,time){
    if(!Number.isFinite(center?.x)||!Number.isFinite(center?.y)||!Number.isFinite(radius)||!Number.isFinite(time)||radius<=0){this.entries.delete(key);return [];}
    let entry=this.entries.get(key);
    const elapsed=entry?time-entry.time:0;
    if(!entry||elapsed<0||elapsed>.25||Math.hypot(center.x-entry.x,center.y-entry.y)>Math.max(radius,entry.r)*12||
      Math.abs(radius-entry.r)>Math.max(radius,entry.r)*.25){
      entry={x:center.x,y:center.y,r:radius,time,points:[{x:center.x,y:center.y,time}]};this.entries.set(key,entry);
    }else if(elapsed>0){
      // Preserve each observed turn and resample the travelled segments, so a
      // sparse frame never turns into a detached head or FPS-dependent length.
      const steps=Math.max(1,Math.ceil(elapsed*120));
      const points=entry.points;
      // New samples span at most .25 seconds. Only the old prefix can expire.
      let dropped=Math.max(0,points.length+steps-MAX_HISTORY_POINTS);
      while(dropped<points.length&&time-points[dropped].time>.5)dropped++;
      if(dropped){
        for(let i=0;i<dropped&&this.recycledPoints.length<MAX_HISTORY_POINTS;i++)this.recycledPoints.push(points[i]);
        points.copyWithin(0,dropped);
        points.length-=dropped;
      }
      for(let i=1;i<=steps;i++){
        const sample=this.recycledPoints.pop()||{};
        sample.x=entry.x+(center.x-entry.x)*i/steps;
        sample.y=entry.y+(center.y-entry.y)*i/steps;
        sample.time=entry.time+elapsed*i/steps;
        points.push(sample);
      }
      entry.x=center.x;entry.y=center.y;entry.r=radius;entry.time=time;
    }else if(Math.hypot(center.x-entry.x,center.y-entry.y)>1e-7){
      // Canvas/SVG handoffs can refine the pose twice within one frame. Move
      // just this frame's head, preserving older real positions and time.
      const head=entry.points.at(-1);
      Object.assign(head,{x:center.x,y:center.y,time});
      Object.assign(entry,{x:center.x,y:center.y,r:radius});
    }
    return entry.points.map(p=>({x:p.x,y:p.y,age:Math.max(0,time-p.time)}));
  }
}

// One band is completely clipped and copied back into world coordinates before
// the next begins. Input beyond the normal 96-sample game history uses a
// one-shot workspace, so oversized custom inputs don't grow the shared arrays.
class ClipWorkspace {
  constructor(){
    this.source=[];this.first=[];this.second=[];this.strips=[];this.polygons=[];
    this.points=[];this.used=0;
  }
  point(x,y){
    if(this.used>=512)return {x,y};
    const i=this.used++,p=this.points[i]??={};
    p.x=x;p.y=y;return p;
  }
}
const clipWorkspace=new ClipWorkspace();
const ribbonWorkspace=new CometWorkspace();

function clipHalfPlane(polygon,distance,result,work){
  if(!polygon.length){result.length=0;return result;}
  let count=0;
  let previous=polygon.at(-1),before=distance(previous);
  for(const current of polygon){
    const after=distance(current),inside=after<=1e-9,wasInside=before<=1e-9;
    if(inside!==wasInside){
      const t=before/(before-after);
      result[count++]=work.point(previous.x+(current.x-previous.x)*t,previous.y+(current.y-previous.y)*t);
    }
    if(inside)result[count++]=current;
    previous=current;before=after;
  }
  result.length=count;
  return result;
}
const areaTwice=polygon=>Math.abs(polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p.x*q.y-p.y*q.x;},0));

// Rejoin adjacent clipped strips before filling. Shared cut edges cancel, so
// the translucent ribbon has one continuous boundary and no strip seams.
function mergeStrips(polygons){
  if(polygons.length<2)return polygons;
  const precision=1e7,key=p=>Math.round(p.x*precision)+','+Math.round(p.y*precision),edges=[],horizontal=new Map();
  for(const polygon of polygons)polygon.forEach((a,i)=>{
    const b=polygon[(i+1)%polygon.length];
    if(Math.hypot(b.x-a.x,b.y-a.y)<1e-8)return;
    if(Math.abs(a.y-b.y)<1e-8){
      const yKey=Math.round(a.y*precision);
      if(!horizontal.has(yKey))horizontal.set(yKey,[]);
      horizontal.get(yKey).push({a,b});
    }else edges.push({a,b});
  });
  for(const group of horizontal.values()){
    const y=group[0].a.y,xs=[...new Set(group.flatMap(edge=>[Math.round(edge.a.x*precision),Math.round(edge.b.x*precision)]))].sort((a,b)=>a-b).map(x=>x/precision);
    for(let i=1;i<xs.length;i++){
      const x=(xs[i-1]+xs[i])/2;
      const winding=group.reduce((sum,{a,b})=>sum+(x>Math.min(a.x,b.x)-1e-9&&x<Math.max(a.x,b.x)+1e-9?Math.sign(b.x-a.x):0),0);
      if(winding)edges.push(winding>0?{a:point(xs[i-1],y),b:point(xs[i],y)}:{a:point(xs[i],y),b:point(xs[i-1],y)});
    }
  }
  const outgoing=new Map();
  edges.forEach((edge,index)=>{const k=key(edge.a);if(!outgoing.has(k))outgoing.set(k,[]);outgoing.get(k).push(index);});
  const used=new Set(),result=[];
  for(let i=0;i<edges.length;i++){
    if(used.has(i))continue;
    const polygon=[],start=key(edges[i].a);let index=i,closed=false;
    for(let step=0;step<=edges.length;step++){
      const edge=edges[index];used.add(index);polygon.push(edge.a);
      const end=key(edge.b);if(end===start){closed=true;break;}
      index=(outgoing.get(end)||[]).find(candidate=>!used.has(candidate));
      if(index===undefined)break;
    }
    // Numerical join failures must never invent a chord across the body.
    if(!closed)return polygons;
    if(polygon.length>=3&&areaTwice(polygon)>1e-9){
      const simplified=polygon.filter((p,j)=>{
        const a=polygon[(j+polygon.length-1)%polygon.length],b=polygon[(j+1)%polygon.length];
        return Math.abs((p.x-a.x)*(b.y-p.y)-(p.y-a.y)*(b.x-p.x))>1e-7;
      });
      result.push(simplified.length>=3?simplified:polygon);
    }
  }
  return result;
}

/** A rear shadow of the body's actual silhouette, expressed in instantaneous
 * travel coordinates. Every lateral strip ends at its first body intersection.
 * This also excludes the front when a reversal leaves old history ahead. It
 * works for the concave crescent, where painting a translucent body on top or
 * clipping against a bounding circle would leave visible ink or a gap. */
function rearClipper(boundary,center,direction){
  const dx=direction.x,dy=direction.y,nx=-dy,ny=dx;
  const project=p=>point((p.x-center.x)*dx+(p.y-center.y)*dy,(p.x-center.x)*nx+(p.y-center.y)*ny);
  const unproject=p=>point(center.x+p.x*dx+p.y*nx,center.y+p.x*dy+p.y*ny);
  const body=boundary.map(project),cuts=[...new Set(body.map(p=>p.y))].sort((a,b)=>a-b),rear=Math.min(...body.map(p=>p.x));
  const slices=[];
  for(let i=0;i<=cuts.length;i++){
    const low=i?cuts[i-1]:-Infinity,high=i<cuts.length?cuts[i]:Infinity;
    if(high-low<1e-8)continue;
    let slope=0,intercept=rear;
    if(Number.isFinite(low)&&Number.isFinite(high)){
      const middle=(low+high)/2;let first=Infinity;
      body.forEach((a,index)=>{
        const b=body[(index+1)%body.length];
        if(middle<Math.min(a.y,b.y)||middle>Math.max(a.y,b.y)||Math.abs(b.y-a.y)<1e-10)return;
        const k=(b.x-a.x)/(b.y-a.y),v=a.x+k*(middle-a.y);
        if(v<first){first=v;slope=k;intercept=a.x-k*a.y;}
      });
    }
    slices.push({low,high,slope,intercept});
  }
  return vertices=>{
    const work=vertices.length<=MAX_HISTORY_POINTS*4?clipWorkspace:new ClipWorkspace();
    const {source,first,second,strips,polygons}=work;
    work.used=0;
    let min=Infinity,max=-Infinity,polygonCount=0;
    for(let i=0;i<vertices.length;i++){
      const p=vertices[i];
      const x=(p.x-center.x)*dx+(p.y-center.y)*dy,y=(p.x-center.x)*nx+(p.y-center.y)*ny;
      source[i]=work.point(x,y);min=Math.min(min,y);max=Math.max(max,y);
    }
    source.length=vertices.length;
    for(const slice of slices){
      if(slice.low>max||slice.high<min)continue;
      let polygon=source;
      if(Number.isFinite(slice.low))polygon=clipHalfPlane(polygon,p=>slice.low-p.y,first,work);
      if(Number.isFinite(slice.high))polygon=clipHalfPlane(polygon,p=>p.y-slice.high,second,work);
      const intermediate=polygon===first?second:first;
      polygon=clipHalfPlane(polygon,p=>p.x-slice.slope*p.y-slice.intercept,intermediate,work);
      const strip=strips[polygonCount]??=[];
      polygon=clipHalfPlane(polygon,p=>p.x,strip,work);
      if(polygon.length>=3&&areaTwice(polygon)>1e-9)polygons[polygonCount++]=polygon;
    }
    polygons.length=polygonCount;
    return mergeStrips(polygons).map(polygon=>polygon.map(unproject));
  };
}

const ORBIT_SAMPLES=96,OFFSET=.5,CONTOUR_TOLERANCE=.004;
const orbitRays=Array.from({length:ORBIT_SAMPLES},(_,i)=>{
  const angle=i*TAU/ORBIT_SAMPLES-Math.PI/2;return point(Math.cos(angle),Math.sin(angle));
});
const orbitCache=new WeakMap();
function distanceSquaredToSegment(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/length,0,1):0;
  return (p.x-a.x-t*dx)**2+(p.y-a.y-t*dy)**2;
}
function simplifyChain(points,toleranceSquared){
  const keep=new Set([0,points.length-1]),stack=[[0,points.length-1]];
  while(stack.length){
    const [start,end]=stack.pop();let farthest=-1,distance=toleranceSquared;
    for(let i=start+1;i<end;i++){
      const d=distanceSquaredToSegment(points[i],points[start],points[end]);
      if(d>distance){distance=d;farthest=i;}
    }
    if(farthest>=0){keep.add(farthest);stack.push([start,farthest],[farthest,end]);}
  }
  return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
}
function simplifyContour(points){
  const middle=Math.floor(points.length/2),tolerance=CONTOUR_TOLERANCE**2;
  return [...simplifyChain(points.slice(0,middle+1),tolerance).slice(0,-1),
    ...simplifyChain([...points.slice(middle),points[0]],tolerance).slice(0,-1)];
}

/** A parallel curve is the outer envelope of the original edge capsules.
 * Intersecting each capsule with radial rays rounds convex joins and removes
 * concave offset loops automatically. Rendered ball contours are star-shaped
 * about their center; dilating them with a disc preserves that property.
 * This is a distance offset, not a scaled polygon. */
function contourOrbit(contour,center,r){
  if(!Array.isArray(contour)||contour.length<3)return null;
  const cached=orbitCache.get(contour);
  if(cached&&cached.x===center.x&&cached.y===center.y&&cached.r===r)return cached;
  const source=contour.filter(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y))
    .map(p=>point((p.x-center.x)/r,(p.y-center.y)/r));
  if(source.length<3)return null;
  const points=simplifyContour(source),vertices=points.map(p=>({...p,square:p.x*p.x+p.y*p.y}));
  if(points.length<3)return null;
  const edges=points.map((a,i)=>{
    const b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
    if(length<1e-10)return null;
    const tx=dx/length,ty=dy/length,nx=ty,ny=-tx;
    return {length,tx,ty,nx,ny,line:nx*a.x+ny*a.y,along:tx*a.x+ty*a.y};
  }).filter(Boolean);
  const path=orbitRays.map(ray=>{
    let reach=0;
    for(const vertex of vertices){
      const projection=vertex.x*ray.x+vertex.y*ray.y;
      const discriminant=OFFSET*OFFSET-vertex.square+projection*projection;
      if(discriminant>=0)reach=Math.max(reach,projection+Math.sqrt(discriminant));
    }
    for(const edge of edges){
      const denominator=edge.nx*ray.x+edge.ny*ray.y;
      if(Math.abs(denominator)<1e-10)continue;
      const alongRay=edge.tx*ray.x+edge.ty*ray.y;
      for(const side of [-1,1]){
        const t=(edge.line+side*OFFSET)/denominator;
        if(t<=reach)continue;
        const along=t*alongRay-edge.along;
        if(along>=-1e-9&&along<=edge.length+1e-9)reach=t;
      }
    }
    return point(center.x+ray.x*reach*r,center.y+ray.y*reach*r);
  });
  const distances=[0];
  path.forEach((p,i)=>{const next=path[(i+1)%path.length];distances.push(distances.at(-1)+Math.hypot(next.x-p.x,next.y-p.y));});
  if(!(distances.at(-1)>r))return null;
  const orbit={x:center.x,y:center.y,r,path,distances,length:distances.at(-1),offset:r*OFFSET,sourcePoints:points.length};
  orbitCache.set(contour,orbit);return orbit;
}
function atOrbitDistance(orbit,distance){
  const position=((distance%orbit.length)+orbit.length)%orbit.length;
  let low=0,high=orbit.path.length;
  while(low+1<high){const middle=(low+high)>>1;if(orbit.distances[middle]<=position)low=middle;else high=middle;}
  const length=orbit.distances[low+1]-orbit.distances[low];
  return lerpPoint(orbit.path[low],orbit.path[(low+1)%orbit.path.length],length?(position-orbit.distances[low])/length:0);
}

/** All coordinates are presentation-only. An optional already-deformed world
 * contour supplies a parallel orbit; no contour retains the circular preview. */
export function companionGeometry(id,pose={},time=0,options={}){
  const definition=COMPANION_DEFINITIONS.find(item=>item.id===id);
  const r=Math.max(0,finite(pose.r)),alpha=clamp(finite(options.alpha,1),0,1),center=point(finite(pose.x),finite(pose.y));
  const colors=companionColors(options.color),satellites=[];
  if(!definition||!r||!alpha)return {definition:definition||null,center,orbitRadius:r*COMPANION_ORBIT.radius,bodyRadius:r*COMPANION_ORBIT.size,satellites};
  // Keep this clock continuous when changing views or reduced-motion settings.
  // The orbit has no secondary bobbing, flashing or random movement.
  const phase=(finite(time)%COMPANION_ORBIT.period)/COMPANION_ORBIT.period*TAU-Math.PI/2;
  const contourPath=contourOrbit(options.contour,center,r);
  const length=companionTrailLength(r,options);
  for(let index=0;index<definition.count;index++){
    const angle=phase+index*TAU/definition.count,c=Math.cos(angle),s=Math.sin(angle);
    const distance=contourPath?contourPath.length*((phase+Math.PI/2)/TAU+index/definition.count):0;
    const orbit=contourPath?atOrbitDistance(contourPath,distance):point(center.x+c*r*COMPANION_ORBIT.radius,center.y+s*r*COMPANION_ORBIT.radius);
    const transformTrail=p=>point(center.x+(p.x*c-p.y*s)*r,center.y+(p.x*s+p.y*c)*r);
    const rotation=Math.atan2(orbit.y-center.y,orbit.x-center.x)+Math.PI/2,bc=Math.cos(rotation),bs=Math.sin(rotation);
    const transformBody=p=>point(orbit.x+(p.x*bc-p.y*bs)*r*COMPANION_ORBIT.size,orbit.y+(p.x*bs+p.y*bc)*r*COMPANION_ORBIT.size);
    const bands=templates.get(definition.shape).map(band=>({
      outer:band.outer.map(transformBody),inner:band.inner.map(transformBody),closed:band.closed,
      color:mixColor(colors.edge,colors.center,band.brightness),alpha:alpha*COMPANION_ORBIT.opacity,
      outerColor:mixColor(colors.edge,colors.center,band.outerBrightness),innerColor:mixColor(colors.edge,colors.center,band.innerBrightness),
    }));
    const boundary=definition.shape==='moon'?[...bands[0].outer,...bands.at(-1).inner.slice().reverse()]:bands.at(-1).outer;
    const points=options.trails?options.trails.sample(id+':'+index,orbit,r,finite(time)):
      contourPath?Array.from({length:8},(_,i)=>({...atOrbitDistance(contourPath,distance-length*(1-i/7)),age:(1-i/7)*.2})):
      trailTemplate.map(p=>{
        if(length===trailLength*r)return {...transformTrail(p),age:p.age};
        const a=-length/(r*COMPANION_ORBIT.radius)*p.age/.2;
        return {...transformTrail(point(Math.cos(a)*COMPANION_ORBIT.radius,Math.sin(a)*COMPANION_ORBIT.radius)),age:p.age};
      });
    let direction=point(-s,c);
    for(let i=points.length-2;i>=0;i--){
      const dx=orbit.x-points[i].x,dy=orbit.y-points[i].y,span=Math.hypot(dx,dy);
      if(span>1e-7){direction=point(dx/span,dy/span);break;}
    }
    const clip=rearClipper(boundary,orbit,direction),tail=[];
    // Rendering needs subpixel path accuracy, not every time sample. Simplify
    // only the ribbon input; history still retains all actual observed turns.
    const ribbonPoints=points.length>8?simplifyChain(points,(r*.005)**2):points;
    for(const band of ribbonWorkspace.bands(ribbonPoints,{length,width:r*COMPANION_ORBIT.size*.68})){
      for(const vertices of clip(band.vertices))tail.push({vertices,color:colors.base,
        alpha:alpha*COMPANION_ORBIT.tailOpacity*band.crossAlpha,region:band.region});
    }
    satellites.push({center:orbit,r:r*COMPANION_ORBIT.size,angle,rotation,direction,boundary,tailPoints:points,
      orbitDistance:contourPath?((distance%contourPath.length)+contourPath.length)%contourPath.length:null,bands,tail});
  }
  return {definition,center,orbitRadius:r*COMPANION_ORBIT.radius,bodyRadius:r*COMPANION_ORBIT.size,satellites,
    orbitPath:contourPath?.path||null,orbitLength:contourPath?.length||TAU*r*COMPANION_ORBIT.radius,
    orbitOffset:contourPath?.offset||r*OFFSET,orbitSourcePoints:contourPath?.sourcePoints||0};
}

function fillPolygon(g,vertices){
  g.beginPath();vertices.forEach((p,i)=>i?g.lineTo(p.x,p.y):g.moveTo(p.x,p.y));g.closePath();g.fillPath();
}
function triangle(g,a,b,c){
  if(typeof g.fillTriangle==='function')g.fillTriangle(a.x,a.y,b.x,b.y,c.x,c.y);
  else fillPolygon(g,[a,b,c]);
}
export function drawCompanions(g,id,pose,time,options={}){
  const geometry=companionGeometry(id,pose,time,options);
  for(const satellite of geometry.satellites){
    for(const pieces of tailGroups(satellite.tail)){
      g.fillStyle(pieces[0].color,pieces[0].alpha);g.beginPath();
      for(const band of pieces){band.vertices.forEach((p,i)=>i?g.lineTo(p.x,p.y):g.moveTo(p.x,p.y));g.closePath();}
      g.fillPath();
    }
    const gradient=typeof g.fillGradientStyle==='function'&&typeof g.fillTriangle==='function'
      &&g.scene?.sys?.game?.renderer?.type===2&&options.gradientSupported!==false;
    for(const band of satellite.bands){
      const count=band.outer.length-(band.closed?0:1);
      if(gradient){
        // Phaser's triangle uses TL, TR, BL for its three vertices. Batch the
        // two color patterns: eight state changes total, unchanged geometry.
        g.fillGradientStyle(band.outerColor,band.outerColor,band.innerColor,band.innerColor,band.alpha);
        for(let i=0;i<count;i++){
          const next=(i+1)%band.outer.length;
          triangle(g,band.outer[i],band.outer[next],band.inner[next]);
        }
        g.fillGradientStyle(band.outerColor,band.innerColor,band.innerColor,band.innerColor,band.alpha);
        for(let i=0;i<count;i++){
          const next=(i+1)%band.outer.length;
          triangle(g,band.outer[i],band.inner[next],band.inner[i]);
        }
      }else{
        // Canvas has no Graphics vertex gradient. Twenty-four disjoint thin
        // bands approximate it without stacking alpha or changing the outline.
        for(let slice=0;slice<6;slice++){
          const from=slice/6,to=(slice+1)/6;
          g.fillStyle(mixColor(band.outerColor,band.innerColor,(from+to)/2),band.alpha);
          for(let i=0;i<count;i++){
            const next=(i+1)%band.outer.length,a=lerpPoint(band.outer[i],band.inner[i],from),b=lerpPoint(band.outer[next],band.inner[next],from);
            const c=lerpPoint(band.outer[next],band.inner[next],to),d=lerpPoint(band.outer[i],band.inner[i],to);
            triangle(g,a,b,c);triangle(g,a,c,d);
          }
        }
      }
    }
    // Do not leave an interpolated fill active for the player or its crown.
    if(gradient)g.fillStyle(satellite.bands.at(-1).color,satellite.bands[0].alpha);
  }
  return geometry;
}

const numeric=value=>Number(value.toFixed(2));
const hex=value=>'#'+value.toString(16).padStart(6,'0');
const path=points=>points.map((p,i)=>`${i?'L':'M'}${numeric(p.x)} ${numeric(p.y)}`).join('')+'Z';
function tailGroups(tail){
  const groups=new Map();
  for(const band of tail){if(!groups.has(band.region))groups.set(band.region,[]);groups.get(band.region).push(band);}
  return [...groups.values()];
}
// Opaque nested fills are composited before applying the body's opacity.
// This prevents both alpha buildup and hairline gaps between tiny SVG rings.
function visitBodyPaths(satellite,write){
  const bands=satellite.bands,closed=bands[0].closed,levels=24;
  const colorAt=t=>{
    const position=clamp(t,0,1)*bands.length,index=Math.min(bands.length-1,Math.floor(position)),band=bands[index],fraction=position-index;
    return closed?mixColor(band.innerColor,band.outerColor,fraction):mixColor(band.outerColor,band.innerColor,fraction);
  };
  const outline=closed?bands.at(-1).outer:null,outer=bands[0].outer,inner=bands.at(-1).inner;
  for(let i=0;i<levels;i++){
    const depth=i/levels;
    const points=closed?outline.map(p=>lerpPoint(p,satellite.center,depth)):
      [...outer.map((p,j)=>lerpPoint(p,inner[j],depth/2)),...inner.map((p,j)=>lerpPoint(p,outer[j],depth/2)).reverse()];
    write(i,path(points),hex(colorAt(closed?1-depth:depth/2)));
  }
}
function visitTailPaths(satellite,write){
  const groups=tailGroups(satellite.tail);
  for(let i=0;i<groups.length;i++){
    const pieces=groups[i];
    write(i,pieces.map(band=>path(band.vertices)).join(''),hex(pieces[0].color),numeric(pieces[0].alpha));
  }
  return groups.length;
}
function geometrySvg(geometry){
  const markup=[];
  for(const satellite of geometry.satellites){
    visitTailPaths(satellite,(_,d,fill,opacity)=>markup.push(`<path d="${d}" fill="${fill}" opacity="${opacity}"/>`));
    markup.push(`<g opacity="${numeric(satellite.bands[0].alpha)}">`);
    visitBodyPaths(satellite,(_,d,fill)=>markup.push(`<path d="${d}" fill="${fill}"/>`));
    markup.push('</g>');
  }
  return markup.join('');
}
export function companionSvg(id,pose,time,options={}){
  return geometrySvg(companionGeometry(id,pose,time,options));
}

const svgNamespace='http://www.w3.org/2000/svg';
function svgChild(parent,index,tag){
  const existing=parent.children[index];
  if(existing)return existing;
  const node=document.createElementNS(svgNamespace,tag);
  parent.append(node);
  return node;
}
function setSvgAttribute(node,name,value){
  const text=String(value);
  if(node.getAttribute(name)!==text)node.setAttribute(name,text);
}
function trimSvgChildren(parent,count){
  while(parent.children.length>count)parent.removeChild(parent.children[parent.children.length-1]);
}

/** Keep live menu paths in place. Each satellite has a separate tail group so
 * a band disappearing at the clipped rear edge cannot replace its body. */
export function paintCompanionSvg(host,layers,pose,time,options={}){
  if(!layers.length){
    trimSvgChildren(host,0);
    return;
  }
  const svg=svgChild(host,0,'svg'),size=pose.r*4;
  setSvgAttribute(svg,'viewBox',`0 0 ${size} ${size}`);
  setSvgAttribute(svg,'aria-hidden','true');
  let drawn=0;
  for(const layer of layers){
    const geometry=companionGeometry(layer.id,pose,time,{...options,alpha:layer.weight});
    for(const satellite of geometry.satellites){
      const group=svgChild(svg,drawn++,'g');
      const tail=svgChild(group,0,'g'),body=svgChild(group,1,'g');
      const count=visitTailPaths(satellite,(i,d,fill,opacity)=>{
        const node=svgChild(tail,i,'path');
        setSvgAttribute(node,'d',d);
        setSvgAttribute(node,'fill',fill);
        setSvgAttribute(node,'opacity',opacity);
      });
      trimSvgChildren(tail,count);
      setSvgAttribute(body,'opacity',numeric(satellite.bands[0].alpha));
      visitBodyPaths(satellite,(i,d,fill)=>{
        const node=svgChild(body,i,'path');
        setSvgAttribute(node,'d',d);
        setSvgAttribute(node,'fill',fill);
      });
    }
  }
  trimSvgChildren(svg,drawn);
}
export function companionPreview(id,color='#252720'){
  const geometry=companionGeometry(id,{x:0,y:0,r:20},.39,{color});
  const points=geometry.satellites.flatMap(satellite=>[...satellite.tail.flatMap(band=>band.vertices),...satellite.bands.flatMap(band=>band.outer)]);
  if(!points.length)return '<svg viewBox="0 0 100 100" aria-hidden="true"></svg>';
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
  const size=Math.min(60/Math.max(1,right-left),52/Math.max(1,bottom-top));
  const dx=50-(left+right)*size/2,dy=59-(top+bottom)*size/2;
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><g transform="translate(${numeric(dx)} ${numeric(dy)}) scale(${numeric(size)})">${geometrySvg(geometry)}</g></svg>`;
}
