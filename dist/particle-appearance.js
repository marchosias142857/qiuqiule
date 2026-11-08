const TAU=Math.PI*2;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const point=(x,y)=>({x,y});
const mixPoint=(a,b,t)=>point(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t);
export const PARTICLE_BASE_ALPHA=.42;
export const PARTICLE_SHAPES=Object.freeze([
  ['triangle','正三角形'],['square','正方形'],['diamond','菱形'],['snowflake','雪花'],
  ['sun','日'],['moon','月'],['star','星'],
].map(([id,label])=>Object.freeze({id,label,orientation:'free'})));
const names=new Set(PARTICLE_SHAPES.map(shape=>shape.id));
const styles=new Map(),appearances=new Map();
const colorNumber=value=>typeof value==='string'&&/^#[\da-f]{6}$/i.test(value)?parseInt(value.slice(1),16):
  Number.isFinite(value)?clamp(Math.round(value),0,0xffffff):0x252720;

function center(points,limit=Infinity){
  let area=0,xMoment=0,yMoment=0;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],cross=a.x*b.y-b.x*a.y;
    area+=cross;xMoment+=(a.x+b.x)*cross;yMoment+=(a.y+b.y)*cross;
  }
  const cx=xMoment/(3*area),cy=yMoment/(3*area);let extent=0;
  for(const p of points){p.x-=cx;p.y-=cy;extent=Math.max(extent,Math.hypot(p.x,p.y));}
  const scale=Math.min(1,limit/extent);
  if(scale<1)for(const p of points){p.x*=scale;p.y*=scale;}
  return points;
}

function roundedPolygon(vertices,cut){
  const points=[];
  for(let i=0;i<vertices.length;i++){
    const corner=vertices[i],start=mixPoint(corner,vertices[(i+vertices.length-1)%vertices.length],cut);
    const end=mixPoint(corner,vertices[(i+1)%vertices.length],cut);
    for(let step=0;step<=3;step++){
      const t=step/3,u=1-t;
      points.push(point(u*u*start.x+2*u*t*corner.x+t*t*end.x,u*u*start.y+2*u*t*corner.y+t*t*end.y));
    }
  }
  return points;
}

// These seven outlines are the final, approved particle silhouettes. All
// coordinates are local; shape drawing has no gameplay or scene dependency.
function outline(shape){
  if(shape==='sun')return Array.from({length:16},(_,i)=>point(Math.cos(i*TAU/16),Math.sin(i*TAU/16)));
  if(shape==='star'){
    const tips=[point(0,-1),point(1,0),point(0,1),point(-1,0)];
    const controls=[point(.12,-.12),point(.12,.12),point(-.12,.12),point(-.12,-.12)];
    return tips.flatMap((start,index)=>Array.from({length:4},(_,i)=>{
      const t=i/4,end=tips[(index+1)%4],control=controls[index],a=(1-t)**2,b=2*(1-t)*t;
      return point(a*start.x+b*control.x+t*t*end.x,a*start.y+b*control.y+t*t*end.y);
    }));
  }
  if(shape==='moon'){
    const offset=.45,innerRadius=.9,joinX=(1-innerRadius*innerRadius+offset*offset)/(2*offset);
    const joinY=Math.sqrt(1-joinX*joinX),outerStart=-Math.atan2(joinY,joinX);
    const innerStart=TAU-Math.atan2(joinY,joinX-offset);
    const outer=Array.from({length:13},(_,i)=>{
      const angle=outerStart-(TAU+outerStart*2)*i/12;return point(Math.cos(angle),Math.sin(angle));
    });
    const inner=Array.from({length:13},(_,i)=>{
      const angle=innerStart-(innerStart-Math.atan2(joinY,joinX-offset))*i/12;
      return point(offset+innerRadius*Math.cos(angle),innerRadius*Math.sin(angle));
    });
    return center([...outer,...inner.reverse()]);
  }
  let points;
  if(shape==='diamond')points=roundedPolygon([point(0,-1.12),point(.8,0),point(0,1.12),point(-.8,0)],.1);
  else if(shape==='square'){
    const half=Math.SQRT1_2;
    points=roundedPolygon([point(-half,-half),point(half,-half),point(half,half),point(-half,half)],.15);
  }else if(shape==='triangle')points=roundedPolygon(Array.from({length:3},(_,i)=>{
    const angle=-Math.PI/2+i*TAU/3;return point(1.1*Math.cos(angle),1.1*Math.sin(angle));
  }),.085);
  else{
    // Six simple spokes replace the small forked branches. Round caps and
    // gently rounded inner joins stay legible at particle size (48 vertices).
    const halfWidth=.14,capY=-.91,rootY=-.35;
    const cap=Array.from({length:5},(_,i)=>{
      const angle=Math.PI+i*Math.PI/4;
      return point(Math.cos(angle)*halfWidth,capY+Math.sin(angle)*halfWidth);
    });
    const root=point(halfWidth,rootY),join=point(halfWidth,-halfWidth*Math.sqrt(3));
    const nextRoot=point(-halfWidth*.5-rootY*Math.sqrt(3)/2,-halfWidth*Math.sqrt(3)/2+rootY*.5);
    const sector=[...cap,root,point((root.x+nextRoot.x)*.25+join.x*.5,(root.y+nextRoot.y)*.25+join.y*.5),nextRoot];
    points=[];
    for(let arm=0;arm<6;arm++){
      const angle=arm*Math.PI/3,c=Math.cos(angle),s=Math.sin(angle);
      for(const p of sector)points.push(point(p.x*c-p.y*s,p.x*s+p.y*c));
    }
  }
  return center(points,1.25);
}

export function particleAppearance(shape='star'){
  shape=names.has(shape)?shape:'star';
  if(!appearances.has(shape))appearances.set(shape,Object.freeze({shape,boundary:outline(shape),opacity:PARTICLE_BASE_ALPHA,orientation:'free'}));
  return appearances.get(shape);
}

/** Cached, read-only normalized polygons and optical area compensation. */
export function particleVisualStyle(shape='star'){
  shape=names.has(shape)?shape:'star';
  if(styles.has(shape))return styles.get(shape);
  const boundary=particleAppearance(shape).boundary,points=new Float32Array(boundary.length*2);
  for(let i=0;i<boundary.length;i++){points[i*2]=boundary[i].x;points[i*2+1]=boundary[i].y;}
  let twiceArea=0,perimeter=0,extent=0;
  for(let i=0;i<points.length;i+=2){
    const next=(i+2)%points.length,x=points[i],y=points[i+1],nx=points[next],ny=points[next+1];
    twiceArea+=x*ny-nx*y;perimeter+=Math.hypot(nx-x,ny-y);extent=Math.max(extent,Math.hypot(x,y));
  }
  const area=Math.abs(twiceArea)/2,circularity=4*Math.PI*area/(perimeter*perimeter);
  const result=Object.freeze({points,area,perimeter,circularity,sizeScale:(1/area)**.3,
    alphaScale:circularity>.85?.9:1,extent,orientation:'free'});
  styles.set(shape,result);return result;
}

/** Phaser Graphics: one solid face, no outline, glow, texture or gradient. */
export function drawParticleAppearance(g,{shape='star',x=0,y=0,radius,color=0x252720,alpha=1,rotation=0}){
  if(!Number.isFinite(radius)||radius<=0||!Number.isFinite(alpha)||alpha<=0||
    !Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(rotation))return;
  const style=particleVisualStyle(shape),points=style.points,scale=radius*style.sizeScale;
  const c=Math.cos(rotation)*scale,s=Math.sin(rotation)*scale;
  g.fillStyle(colorNumber(color),clamp(alpha,0,1)*PARTICLE_BASE_ALPHA*style.alphaScale);g.beginPath();
  g.moveTo(x+points[0]*c-points[1]*s,y+points[0]*s+points[1]*c);
  for(let i=2;i<points.length;i+=2)g.lineTo(x+points[i]*c-points[i+1]*s,y+points[i]*s+points[i+1]*c);
  g.closePath();g.fillPath();
}

export function drawParticleAppearanceCanvas(ctx,{shape='star',x=0,y=0,radius,color=0x252720,alpha=1,rotation=0}){
  if(!Number.isFinite(radius)||radius<=0||!Number.isFinite(alpha)||alpha<=0||
    !Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(rotation))return;
  const style=particleVisualStyle(shape),points=style.points,scale=radius*style.sizeScale;
  ctx.save();ctx.translate(x,y);ctx.rotate(rotation);
  ctx.globalAlpha*=clamp(alpha,0,1)*PARTICLE_BASE_ALPHA*style.alphaScale;
  ctx.fillStyle='#'+colorNumber(color).toString(16).padStart(6,'0');ctx.beginPath();
  ctx.moveTo(points[0]*scale,points[1]*scale);
  for(let i=2;i<points.length;i+=2)ctx.lineTo(points[i]*scale,points[i+1]*scale);
  ctx.closePath();ctx.fill();ctx.restore();
}

// Prewarm the seven immutable buffers once; the game loop never builds shapes.
for(const {id}of PARTICLE_SHAPES)particleVisualStyle(id);
