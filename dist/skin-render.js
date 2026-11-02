import {pullBallPoint} from './motion.js';

const TAU=Math.PI*2;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

// The same map is used by the body boundary and every pixel-mesh vertex. Roll
// belongs to the skin; impact and drag deformation stay in their world axis.
export function transformSkinPoint(point,pose={}){
  const roll=pose.roll||0,rc=Math.cos(roll),rs=Math.sin(roll);
  const x=point.x*rc-point.y*rs,y=point.x*rs+point.y*rc;
  const angle=pose.deformAngle??pose.angle??0,c=Math.cos(angle),s=Math.sin(angle);
  let lx=x*c+y*s,ly=-x*s+y*c;
  const radius=Math.hypot(lx,ly),amount=clamp(pose.pullAmount||0,0,1);
  if(amount&&radius>1e-12){
    const pulled=pullBallPoint(lx/radius,ly/radius,amount);
    lx=pulled.x*radius;ly=pulled.y*radius;
  }
  const squash=pose.squash||0;
  lx*=1-squash;ly*=1+squash*.7;
  const r=pose.r??1;
  return {x:(pose.x||0)+(lx*c-ly*s)*r,y:(pose.y||0)+(lx*s+ly*c)*r};
}

export function projectSkinContour(contour,pose={}){
  return contour.map(point=>transformSkinPoint(point,pose));
}

export function contourPath(ctx,points){
  ctx.beginPath();
  points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
  ctx.closePath();
}

// A radial fan exactly reproduces the homogeneous interior extension of the
// boundary deformation. Unlike a masked stationary image, its centre, texture
// and edge all stretch together. No extra radial rings are needed.
export function photoMesh(contour,pose={}){
  const center=transformSkinPoint({x:0,y:0},pose);
  const projected=projectSkinContour(contour,pose);
  return contour.map((p,i)=>({
    source:[{x:0,y:0},p,contour[(i+1)%contour.length]],
    target:[center,projected[i],projected[(i+1)%projected.length]]
  }));
}

// Offset all three edge lines, then intersect adjacent lines. Expanding each
// vertex away from the centroid leaves almost no sideways overlap on the long,
// narrow radial fan edges; a true edge offset gives every seam full coverage.
export function expandTriangleClip(points,distance,miterLimit=4){
  const [a,b,c]=points;
  const winding=Math.sign((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))||1;
  const normals=points.map((p,i)=>{
    const q=points[(i+1)%3],dx=q.x-p.x,dy=q.y-p.y,length=Math.hypot(dx,dy)||1;
    return {x:dy/length*winding,y:-dx/length*winding};
  });
  return points.flatMap((p,i)=>{
    const before=normals[(i+2)%3],after=normals[i];
    const factor=distance/Math.max(1e-12,1+before.x*after.x+before.y*after.y);
    const dx=(before.x+after.x)*factor,dy=(before.y+after.y)*factor;
    // A radial wedge's apex is extremely acute. An unbounded mitre can reach
    // across the player's centre and paint this wedge's affine texture into
    // unrelated wedges. Bevel only that corner; both long edges keep their
    // exact offset and therefore retain antialias coverage along their length.
    if(Math.hypot(dx,dy)>distance*miterLimit)return [
      {x:p.x+before.x*distance,y:p.y+before.y*distance},
      {x:p.x+after.x*distance,y:p.y+after.y*distance}
    ];
    return [{x:p.x+dx,y:p.y+dy}];
  });
}

function drawTriangle(ctx,image,source,target,seam){
  const sx1=source[1].x-source[0].x,sy1=source[1].y-source[0].y;
  const sx2=source[2].x-source[0].x,sy2=source[2].y-source[0].y;
  const dx1=target[1].x-target[0].x,dy1=target[1].y-target[0].y;
  const dx2=target[2].x-target[0].x,dy2=target[2].y-target[0].y;
  const det=sx1*sy2-sx2*sy1;
  if(Math.abs(det)<1e-10)return;
  const a=(dx1*sy2-dx2*sy1)/det,b=(dy1*sy2-dy2*sy1)/det;
  const c=(dx2*sx1-dx1*sx2)/det,d=(dy2*sx1-dy1*sx2)/det;
  const e=target[0].x-a*source[0].x-c*source[0].y;
  const f=target[0].y-b*source[0].x-d*source[0].y;
  // The exact outer contour clip prevents the enlarged fan triangles leaking
  // outside the skin. Acute centre corners are bevelled, never long mitres.
  const clip=expandTriangleClip(target,seam);
  ctx.save();contourPath(ctx,clip);ctx.clip();
  ctx.transform(a,b,c,d,e,f);ctx.drawImage(image,0,0);ctx.restore();
}

/** Draw into a CSS-coordinate Canvas2D context (a DPR transform is supported).
 * Images are already square-cropped by the wardrobe; the full square covers
 * the smallest centred square containing the skin, then is clipped to it. */
export function paintPhoto(ctx,image,contour,pose={},options={}){
  const width=image?.naturalWidth||image?.videoWidth||image?.width;
  const height=image?.naturalHeight||image?.videoHeight||image?.height;
  if(!width||!height||contour.length<3)return false;
  const extent=Math.max(...contour.map(p=>Math.max(Math.abs(p.x),Math.abs(p.y))));
  if(!Number.isFinite(extent)||extent<=0)return false;
  const points=projectSkinContour(contour,pose),alpha=clamp(options.alpha??1,0,1);
  ctx.save();ctx.globalAlpha*=alpha;ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';contourPath(ctx,points);ctx.clip();
  if(!(pose.pullAmount>1e-6)){
    const origin=transformSkinPoint({x:0,y:0},pose);
    const right=transformSkinPoint({x:1,y:0},pose),down=transformSkinPoint({x:0,y:1},pose);
    ctx.transform(right.x-origin.x,right.y-origin.y,down.x-origin.x,down.y-origin.y,origin.x,origin.y);
    ctx.drawImage(image,-extent,-extent,extent*2,extent*2);
  }else{
    const seam=options.seam??.75;
    // The fallback renderer may use a lighter interior mesh. Keep the exact
    // full-resolution boundary clip and original image extent above.
    for(const triangle of photoMesh(options.meshContour||contour,pose)){
      const source=triangle.source.map(p=>({x:(p.x/extent+1)*width/2,y:(p.y/extent+1)*height/2}));
      drawTriangle(ctx,image,source,triangle.target,seam);
    }
  }
  ctx.restore();return true;
}

function topAt(points,x){
  let y=Infinity;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];
    if(x<Math.min(a.x,b.x)-1e-9||x>Math.max(a.x,b.x)+1e-9)continue;
    if(Math.abs(a.x-b.x)<1e-10){y=Math.min(y,a.y,b.y);continue;}
    const t=clamp((x-a.x)/(b.x-a.x),0,1);y=Math.min(y,a.y+(b.y-a.y)*t);
  }
  return y;
}

/** Adapt the original crown's lower arc to a parallel outward offset of the
 * skin's top edge. Pass unit-radius, already-rolled contour points. Upper peaks
 * retain the existing silhouette; its lower rounded corners warp continuously. */
export function fitCrownToSkin(crown,contour,gap=.18){
  if(contour.length<3)return crown.map(p=>({...p}));
  const radii=contour.map(p=>Math.hypot(p.x,p.y));
  if(Math.max(...radii)-Math.min(...radii)<1e-7)return crown.map(p=>({...p}));
  const area=contour.reduce((sum,p,i)=>{const q=contour[(i+1)%contour.length];return sum+p.x*q.y-p.y*q.x;},0);
  const winding=Math.sign(area)||1;
  const parallel=contour.map((p,i)=>{
    const a=contour[(i+contour.length-1)%contour.length],b=contour[(i+1)%contour.length];
    const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
    return {x:p.x+dy/length*gap*winding,y:p.y-dx/length*gap*winding};
  });
  return crown.map(p=>{
    const skinY=topAt(parallel,p.x),originalY=-Math.sqrt(Math.max(0,(1+gap)**2-p.x*p.x));
    const t=clamp((p.y+1.52)/.23,0,1),weight=t*t*(3-2*t);
    return {x:p.x,y:p.y+(Number.isFinite(skinY)?skinY-originalY:0)*weight};
  });
}

/** Soft, centre-anchored yellow-white beams. Render behind the player. */
export function paintRadiance(ctx,{x=0,y=0,r=40,time=0,alpha=1,reducedMotion=false,rotation}={}){
  if(r<=0||alpha<=0)return;
  const breathing=reducedMotion?1:.88+.12*Math.sin(time*2.5);
  ctx.save();ctx.translate(x,y);ctx.rotate(rotation??(reducedMotion?0:time*.19));
  ctx.globalAlpha*=clamp(alpha,0,1)*breathing;
  const halo=ctx.createRadialGradient(0,0,r*.55,0,0,r*3.25);
  halo.addColorStop(0,'rgba(255,255,241,0)');halo.addColorStop(.17,'rgba(255,250,210,.27)');
  halo.addColorStop(.49,'rgba(255,242,174,.12)');halo.addColorStop(1,'rgba(255,248,212,0)');
  ctx.fillStyle=halo;ctx.beginPath();ctx.arc(0,0,r*3.25,0,TAU);ctx.fill();
  const gradient=ctx.createRadialGradient(0,0,r*.65,0,0,r*3.12);
  gradient.addColorStop(0,'rgba(255,255,244,0)');gradient.addColorStop(.18,'rgba(255,255,237,.36)');
  gradient.addColorStop(.5,'rgba(255,244,189,.27)');gradient.addColorStop(.82,'rgba(255,240,168,.08)');
  gradient.addColorStop(1,'rgba(255,245,197,0)');
  ctx.fillStyle=gradient;ctx.shadowColor='rgba(255,244,192,.15)';ctx.shadowBlur=r*.13;
  for(let i=0;i<18;i++){
    const turn=i/18*TAU,half=i%2?.044:.075,outer=r*(i%2?2.7:3.12),inner=r*.78;
    ctx.save();ctx.rotate(turn);ctx.beginPath();ctx.moveTo(inner,-inner*half*.5);
    ctx.lineTo(outer,-outer*half);ctx.quadraticCurveTo(outer*1.025,0,outer,outer*half);
    ctx.lineTo(inner,inner*half*.5);ctx.closePath();ctx.fill();ctx.restore();
  }
  ctx.restore();
}

/** One static texture for Phaser; animate sprite rotation/opacity afterwards.
 * The returned canvas uses a 3.5-radius half-extent, so sprite display size is
 * playerRadius * 7. Keeping generation outside the frame loop is intentional. */
export function createRadianceCanvas(ownerDocument=document,size=640){
  const canvas=ownerDocument.createElement('canvas');canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d');
  if(ctx)paintRadiance(ctx,{x:size/2,y:size/2,r:size/7,alpha:1,reducedMotion:true});
  return canvas;
}
