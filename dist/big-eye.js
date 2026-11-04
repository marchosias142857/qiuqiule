import {projectSkinContour} from './skin-render.js';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
export const BIG_EYE_RADIUS_RATIO=1/1.95;
export const BIG_EYE_DEFAULT_COLOR='#b8db8a';

function colorNumber(value){
  if(typeof value==='string'&&/^#[\da-f]{6}$/i.test(value))return parseInt(value.slice(1),16);
  return clamp(Math.round(finite(value,0xb8db8a)),0,0xffffff);
}
function mixColor(a,b,weight){
  const channel=shift=>Math.round(((a>>shift)&255)*(1-weight)+((b>>shift)&255)*weight);
  return (channel(16)<<16)|(channel(8)<<8)|channel(0);
}
export function bigEyeColors(color=BIG_EYE_DEFAULT_COLOR){
  const base=colorNumber(color);
  return {center:mixColor(base,0xffffff,.38),base,edge:mixColor(base,0,.24)};
}

function segmentDistance(point,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;
  const t=length2?clamp(((point.x-a.x)*dx+(point.y-a.y)*dy)/length2,0,1):0;
  return Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy);
}

// A moving circle first touches a segment's radius-expanded capsule at either
// one of its two parallel sides or an endpoint circle. Taking the first event
// handles concave pulled polygons too; infinite-edge half-planes would not.
function tangentTravel(outline,origin,direction,radius){
  let limit=Infinity;
  const epsilon=1e-8*Math.max(1,radius);
  for(let i=0;i<outline.length;i++){
    const a=outline[i],b=outline[(i+1)%outline.length];
    const ex=b.x-a.x,ey=b.y-a.y,length=Math.hypot(ex,ey);
    if(length>epsilon){
      const nx=-ey/length,ny=ex/length;
      const initial=(origin.x-a.x)*nx+(origin.y-a.y)*ny;
      const speed=direction.x*nx+direction.y*ny;
      if(Math.abs(speed)>1e-12){
        for(const side of [-1,1]){
          const t=(side*radius-initial)/speed;
          if(t< -epsilon||t>=limit)continue;
          const x=origin.x+direction.x*t-a.x,y=origin.y+direction.y*t-a.y;
          const along=(x*ex+y*ey)/(length*length);
          if(along>=-1e-9&&along<=1+1e-9)limit=Math.max(0,t);
        }
      }
    }
    const ox=origin.x-a.x,oy=origin.y-a.y;
    const projection=ox*direction.x+oy*direction.y;
    const discriminant=projection*projection-(ox*ox+oy*oy-radius*radius);
    if(discriminant>=0){
      const root=Math.sqrt(discriminant);
      for(const t of [-projection-root,-projection+root]){
        if(t>=-epsilon&&t<limit)limit=Math.max(0,t);
      }
    }
  }
  return Number.isFinite(limit)?limit:0;
}

/** Presentation-only geometry. Gaze is in the existing unit-radius lookX/Y
 * convention. Pulling overrides it continuously and is exactly tangent at
 * full pull, opposite the dragged tail, matching the ordinary launch gaze. */
export function bigEyeGeometry(contour,pose={},options={}){
  const center={x:finite(pose.x),y:finite(pose.y)};
  const bodyRadius=Math.max(0,finite(pose.r,1));
  if(!Array.isArray(contour)||contour.length<3||!bodyRadius)return {outline:[],center,eye:{...center,r:0},tangentDistance:0};
  const amount=clamp(finite(options.pullAmount,finite(pose.pullAmount)),0,1);
  const angle=finite(options.deformAngle,finite(pose.deformAngle,finite(pose.angle)));
  const outline=projectSkinContour(contour,{...pose,x:center.x,y:center.y,r:bodyRadius,pullAmount:amount,deformAngle:angle});
  const clearance=Math.min(...outline.map((point,i)=>segmentDistance(center,point,outline[(i+1)%outline.length])));
  const radius=Math.min(bodyRadius*BIG_EYE_RADIUS_RATIO,clearance*(1-1e-9));
  const roll=finite(pose.roll),c=Math.cos(roll),s=Math.sin(roll);
  const lookX=finite(options.lookX,finite(pose.lookX)),lookY=finite(options.lookY,finite(pose.lookY));
  let dx=(lookX*c-lookY*s)*bodyRadius*2.8;
  let dy=(lookX*s+lookY*c)*bodyRadius*2.8;
  if(amount){
    const pullDirection={x:-Math.cos(angle),y:-Math.sin(angle)};
    const pullTravel=tangentTravel(outline,center,pullDirection,radius);
    dx=dx*(1-amount)+pullDirection.x*pullTravel*amount;
    dy=dy*(1-amount)+pullDirection.y*pullTravel*amount;
  }
  const distance=Math.hypot(dx,dy);
  if(distance<1e-12)return {outline,center,eye:{...center,r:radius},tangentDistance:0};
  const direction={x:dx/distance,y:dy/distance};
  const limit=tangentTravel(outline,center,direction,radius),travel=Math.min(distance,limit);
  return {outline,center,eye:{x:center.x+direction.x*travel,y:center.y+direction.y*travel,r:radius},tangentDistance:limit};
}

function triangle(g,a,b,c){
  if(typeof g.fillTriangle==='function')g.fillTriangle(a.x,a.y,b.x,b.y,c.x,c.y);
  else{g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.lineTo(c.x,c.y);g.closePath();g.fillPath();}
}

/** The WebGL fan uses one triangle per contour edge and interpolated vertex
 * colors, so its gradient is smooth and its alpha is applied exactly once.
 * Canvas uses disjoint bands instead of translucent nested fills. */
export function drawBigEye(g,contour,pose={},options={}){
  const geometry=bigEyeGeometry(contour,pose,options),{outline,center,eye}=geometry;
  const alpha=clamp(finite(options.alpha,1),0,1);
  if(!outline.length||!alpha)return false;
  const colors=bigEyeColors(options.color);
  const gradient=typeof g.fillGradientStyle==='function'&&typeof g.fillTriangle==='function'
    &&g.scene?.sys?.game?.renderer?.type!==1&&options.gradientSupported!==false;
  if(gradient){
    g.fillGradientStyle(colors.center,colors.edge,colors.edge,colors.edge,alpha);
    for(let i=0;i<outline.length;i++)triangle(g,center,outline[i],outline[(i+1)%outline.length]);
  }else{
    const bands=16;
    for(let ring=0;ring<bands;ring++){
      const inner=ring/bands,outer=(ring+1)/bands;
      g.fillStyle(mixColor(colors.center,colors.edge,(inner+outer)/2),alpha);
      for(let i=0;i<outline.length;i++){
        const a=outline[i],b=outline[(i+1)%outline.length];
        const at=factor=>({x:center.x+(a.x-center.x)*factor,y:center.y+(a.y-center.y)*factor});
        const bt=factor=>({x:center.x+(b.x-center.x)*factor,y:center.y+(b.y-center.y)*factor});
        const ai=at(inner),ao=at(outer),bo=bt(outer);
        triangle(g,ai,ao,bo);
        if(ring)triangle(g,ai,bo,bt(inner));
      }
    }
  }
  g.fillStyle(0x000000,alpha);g.fillCircle(eye.x,eye.y,eye.r);
  return geometry;
}
