import test from 'node:test';
import assert from 'node:assert/strict';
import {pullBallPoint} from '../dist/motion.js';
import {crownOutline} from '../dist/boss-visuals.js';
import {transformSkinPoint,projectSkinContour,photoMesh,expandTriangleClip,paintPhoto,fitCrownToSkin,paintRadiance,createRadianceCanvas} from '../dist/skin-render.js';

const near=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const circle=Array.from({length:192},(_,i)=>({x:Math.cos(i/192*Math.PI*2),y:Math.sin(i/192*Math.PI*2)}));

test('flight stretch lengthens along velocity and preserves area at every heading',()=>{
  const area=points=>Math.abs(points.reduce((sum,p,i)=>{
    const q=points[(i+1)%points.length];return sum+p.x*q.y-p.y*q.x;
  },0)/2);
  const base={x:203,y:97,r:29,roll:.53,pullAmount:.9,deformAngle:1.1,squash:.18};
  const baseline=projectSkinContour(circle,base),before=area(baseline);
  for(const flightAngle of [0,.4,Math.PI/2,2.7])for(const flightStretch of [.01,.06,.12]){
    const p={...base,flightAngle,flightStretch},after=projectSkinContour(circle,p);
    near(area(after),before,1e-8);
    for(let i=0;i<baseline.length;i++){
      const c=Math.cos(flightAngle),s=Math.sin(flightAngle);
      const a={x:baseline[i].x-base.x,y:baseline[i].y-base.y};
      const b={x:after[i].x-base.x,y:after[i].y-base.y};
      near(b.x*c+b.y*s,(a.x*c+a.y*s)*(1+flightStretch));
      near(-b.x*s+b.y*c,(-a.x*s+a.y*c)/(1+flightStretch));
    }
  }
  assert.deepEqual(projectSkinContour(circle,{...base,flightStretch:0,flightAngle:2.1}),baseline);
  assert.deepEqual(projectSkinContour(circle,{...base,flightStretch:-.1}),baseline);
  assert.deepEqual(projectSkinContour(circle,{...base,flightStretch:2}),projectSkinContour(circle,{...base,flightStretch:.12}));
});

test('circle deformation is the existing pull map in every direction and size',()=>{
  for(const angle of [-2.7,0,.6,2.2])for(const amount of [0,.3,1])for(const t of [-2,-.3,0,1.4]){
    const pose={x:120,y:230,r:37,deformAngle:angle,pullAmount:amount,squash:0};
    const p=transformSkinPoint({x:Math.cos(t+angle),y:Math.sin(t+angle)},pose);
    const expected=pullBallPoint(Math.cos(t),Math.sin(t),amount);
    near(p.x,pose.x+pose.r*(expected.x*Math.cos(angle)-expected.y*Math.sin(angle)));
    near(p.y,pose.y+pose.r*(expected.x*Math.sin(angle)+expected.y*Math.cos(angle)));
  }
});

test('photo interior follows drag instead of leaving the image fixed under a mask',()=>{
  const pose={x:30,y:80,r:40,pullAmount:1,deformAngle:0};
  const center=transformSkinPoint({x:0,y:0},pose);
  const edge=transformSkinPoint({x:1,y:0},pose);
  const interior=transformSkinPoint({x:.5,y:0},pose);
  near(interior.x-center.x,(edge.x-center.x)*.5);
  assert.ok(interior.x>30+40*.5*1.8,'pixels halfway to the dragged edge must visibly stretch');
  const back=transformSkinPoint({x:-.5,y:0},pose);
  near(back.x,10);near(back.y,80);
});

test('photo mesh and skin contour share every edge and remain continuous at all seams',()=>{
  const pose={x:200,y:140,r:58,pullAmount:.8,deformAngle:2.1,roll:.7,squash:-.12,flightStretch:.12,flightAngle:-.6};
  const contour=circle.map(p=>({x:p.x*1.05,y:p.y*.95}));
  const boundary=projectSkinContour(contour,pose),mesh=photoMesh(contour,pose);
  assert.equal(mesh.length,contour.length);
  for(let i=0;i<mesh.length;i++){
    assert.deepEqual(mesh[i].target[1],boundary[i]);
    assert.deepEqual(mesh[i].target[2],mesh[(i+1)%mesh.length].target[1]);
    assert.deepEqual(mesh[i].source[2],mesh[(i+1)%mesh.length].source[1]);
    const [a,b,c]=mesh[i].target;
    assert.ok((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)>0,'no texture triangle folds over');
  }
});

test('narrow texture wedges overlap along shared edges without long mitres crossing the centre',()=>{
  const poses=[
    {x:0,y:0,r:18,pullAmount:1,deformAngle:0},
    {x:87,y:125,r:67,pullAmount:.75,deformAngle:2.4,roll:.5,squash:-.18}
  ];
  const margin=.75;
  const contains=(polygon,p)=>polygon.every((a,i)=>{
    const b=polygon[(i+1)%polygon.length];
    return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)>=-1e-8;
  });
  const segmentDistance=(p,a,b)=>{
    const dx=b.x-a.x,dy=b.y-a.y;
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));
    return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
  };
  for(const pose of poses)for(const triangle of photoMesh(circle,pose)){
    const expanded=expandTriangleClip(triangle.target,margin);
    assert.ok(expanded.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
    assert.ok(expanded.length>=4&&expanded.length<=6,'acute radial apex should become a bevel');
    for(const p of triangle.target)assert.ok(contains(expanded,p),'the full original triangle remains covered');
    for(const p of expanded){
      const distance=Math.min(...triangle.target.map((a,i)=>segmentDistance(p,a,triangle.target[(i+1)%3])));
      assert.ok(distance<=4*margin+1e-8,'texture clips must never reach far into unrelated wedges');
    }
    for(let i=0;i<3;i++){
      const a=triangle.target[i],b=triangle.target[(i+1)%3],length=Math.hypot(b.x-a.x,b.y-a.y);
      const midpoint={x:(a.x+b.x)/2+(b.y-a.y)/length*margin,y:(a.y+b.y)/2-(b.x-a.x)/length*margin};
      assert.ok(contains(expanded,midpoint),'each shared edge midpoint has the full antialias margin');
    }
  }
});

test('rolling rotates the texture before the unchanged world-oriented drag map',()=>{
  const turned=transformSkinPoint({x:1,y:0},{roll:Math.PI/2,pullAmount:1,deformAngle:Math.PI/2});
  near(turned.x,0);near(turned.y,1.95);
  const center=transformSkinPoint({x:0,y:0},{x:11,y:22,roll:2.3,pullAmount:1,squash:.2});
  assert.deepEqual(center,{x:11,y:22});
});

test('circle keeps the original crown, while a changed top contour moves the lower rim only',()=>{
  const original=crownOutline();
  assert.deepEqual(fitCrownToSkin(original,circle),original);
  const wider=circle.map(p=>({x:p.x*1.1,y:p.y/1.1}));
  const fitted=fitCrownToSkin(original,wider);
  const apex=original.reduce((best,p,i)=>p.y<original[best].y?i:best,0);
  assert.deepEqual(fitted[apex],original[apex]);
  const bottom=original.findIndex(p=>Math.abs(p.x)<1e-8&&Math.abs(p.y+1.18)<1e-8);
  assert.ok(bottom>=0);
  near(fitted[bottom].y,-1/1.1-.18,1e-5);
  assert.ok(fitted[bottom].y>original[bottom].y+.07);
  assert.ok(fitted.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
});

function mockContext(){
  const calls=[];
  const ctx={calls,globalAlpha:1,
    save(){calls.push(['save']);},restore(){calls.push(['restore']);},beginPath(){},closePath(){},
    moveTo(){},lineTo(){},clip(){},drawImage(...args){calls.push(['drawImage',...args]);},
    transform(...args){assert.ok(args.every(Number.isFinite));calls.push(['transform',...args]);},
    translate(...args){calls.push(['translate',...args]);},rotate(...args){calls.push(['rotate',...args]);},
    arc(){},fill(){},quadraticCurveTo(){},createRadialGradient(){return {addColorStop(){}};}
  };return ctx;
}

test('photo painting accepts DPR transforms, uses an affine fast path and rejects undecoded images',()=>{
  const ctx=mockContext(),image={width:512,height:512};
  assert.equal(paintPhoto(ctx,{},circle,{}),false);
  assert.equal(ctx.calls.length,0);
  assert.equal(paintPhoto(ctx,image,circle,{x:70,y:80,r:35,roll:.3,squash:.1}),true);
  assert.equal(ctx.calls.filter(c=>c[0]==='drawImage').length,1);
  assert.equal(ctx.calls.filter(c=>c[0]==='save').length,ctx.calls.filter(c=>c[0]==='restore').length);
  const pulled=mockContext();paintPhoto(pulled,image,circle,{x:70,y:80,r:35,pullAmount:.8});
  assert.ok(pulled.calls.filter(c=>c[0]==='drawImage').length>1);
  assert.equal(pulled.calls.filter(c=>c[0]==='save').length,pulled.calls.filter(c=>c[0]==='restore').length);
});

test('flight deformation keeps the Canvas photo affine path aligned to the exact contour',()=>{
  const ctx=mockContext(),pose={x:70,y:80,r:35,roll:.3,squash:.1,flightStretch:.12,flightAngle:1.4};
  paintPhoto(ctx,{width:512,height:512},circle,pose);
  const [name,a,b,c,d,e,f]=ctx.calls.find(call=>call[0]==='transform');
  assert.equal(name,'transform');
  assert.equal(ctx.calls.filter(call=>call[0]==='drawImage').length,1,'flight alone must retain the one-draw fast path');
  near(a*d-b*c,pose.r**2*(1-pose.squash)*(1+.7*pose.squash));
  for(const point of circle){
    const exact=transformSkinPoint(point,pose);
    near(a*point.x+c*point.y+e,exact.x);near(b*point.x+d*point.y+f,exact.y);
  }
});

test('radiance stays centred on the player and can be generated once for a sprite',()=>{
  const ctx=mockContext();paintRadiance(ctx,{x:17,y:29,r:30,time:2});
  assert.deepEqual(ctx.calls.find(c=>c[0]==='translate'),['translate',17,29]);
  const canvas={getContext:()=>mockContext()};
  const texture=createRadianceCanvas({createElement:type=>{assert.equal(type,'canvas');return canvas;}},640);
  assert.equal(texture.width,640);assert.equal(texture.height,640);
  assert.equal(ctx.calls.filter(c=>c[0]==='save').length,ctx.calls.filter(c=>c[0]==='restore').length);
});
