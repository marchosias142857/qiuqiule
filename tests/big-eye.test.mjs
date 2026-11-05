import test from 'node:test';
import assert from 'node:assert/strict';
import {skinContour} from '../dist/skins.js';
import {projectSkinContour} from '../dist/skin-render.js';
import {BIG_EYE_RADIUS_RATIO,bigEyeColors,bigEyeGeometry,drawBigEye} from '../dist/big-eye.js';

const near=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const segmentDistance=(p,a,b)=>{
  const dx=b.x-a.x,dy=b.y-a.y;
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
};
const clearance=({outline,eye})=>Math.min(...outline.map((a,i)=>segmentDistance(eye,a,outline[(i+1)%outline.length])));

test('one centered black eye has precisely 1/1.95 of the base diameter',()=>{
  for(const sides of [0,6,9,15])for(const r of [17,38,80]){
    const geometry=bigEyeGeometry(skinContour(sides),{x:123,y:456,r});
    near(geometry.eye.x,123);near(geometry.eye.y,456);
    near(geometry.eye.r/r,BIG_EYE_RADIUS_RATIO);near(geometry.eye.r/r,1/1.95);
    assert.ok(clearance(geometry)>=geometry.eye.r);
  }
});

test('ordinary gaze has a larger offset and clamps inside the actual contour',()=>{
  const contour=skinContour(6),pose={x:17,y:28,r:30,roll:.4};
  const small=bigEyeGeometry(contour,pose,{lookX:.05,lookY:0});
  near(Math.hypot(small.eye.x-pose.x,small.eye.y-pose.y),.05*pose.r*2.8);
  for(const lookX of [-100,-.2,0,.2,100])for(const lookY of [-100,0,100]){
    const geometry=bigEyeGeometry(contour,pose,{lookX,lookY});
    assert.ok(clearance(geometry)>=geometry.eye.r-1e-7);
  }
});

test('full pull makes the circular eye tangent to circular and concave pulled polygon boundaries',()=>{
  for(const sides of [0,6,7,10,15])for(const angle of [-2.4,-.7,0,.6,2.1])for(const roll of [0,.31]){
    const pose={x:130,y:210,r:31,pullAmount:1,deformAngle:angle,roll,squash:.09,flightStretch:.08,flightAngle:.9};
    const geometry=bigEyeGeometry(skinContour(sides),pose,{lookX:1,lookY:-.8});
    assert.deepEqual(geometry.outline,projectSkinContour(skinContour(sides),pose));
    near(clearance(geometry),geometry.eye.r,1e-6);
    const dx=geometry.eye.x-pose.x,dy=geometry.eye.y-pose.y;
    assert.ok(dx*(-Math.cos(angle))+dy*(-Math.sin(angle))>0);
    near(dx*Math.sin(angle)-dy*Math.cos(angle),0,1e-6);
  }
});

test('every partial pull remains inside, and geometry never mutates bodies or contours',()=>{
  for(const sides of [0,6,11,15])for(const amount of [0,.01,.2,.5,.8,.999,1]){
    const pose=Object.freeze({x:43,y:61,r:25,pullAmount:amount,deformAngle:1.3,roll:.73,squash:.2});
    const options=Object.freeze({lookX:-.15,lookY:.15});
    const contour=skinContour(sides),geometry=bigEyeGeometry(contour,pose,options);
    assert.ok(clearance(geometry)>=geometry.eye.r-1e-6);
    assert.ok([geometry.eye.x,geometry.eye.y,geometry.eye.r].every(Number.isFinite));
  }
  assert.equal(bigEyeGeometry(skinContour(),{r:0}).eye.r,0);
});

test('radial colors preserve the selected hue while brightening center and darkening edge',()=>{
  for(const color of [0,0xffffff,0xb9df9b,0x005bff,0xe88c72]){
    const colors=bigEyeColors(color);assert.equal(colors.base,color);
    for(const shift of [16,8,0]){
      assert.ok(((colors.center>>shift)&255)>=((color>>shift)&255));
      assert.ok(((colors.edge>>shift)&255)<=((color>>shift)&255));
    }
    assert.deepEqual(bigEyeColors('#'+color.toString(16).padStart(6,'0')),colors);
  }
});

test('Big Eye shares the projected outline only when its normalized pose matches',()=>{
  const contour=skinContour(8);
  const pose={x:23,y:71,r:19,roll:.7,pullAmount:.8,deformAngle:-.4,flightStretch:.1,flightAngle:2.3};
  const projectedOutline=projectSkinContour(contour,pose);
  const shared=bigEyeGeometry(contour,pose,{lookY:.13,projectedOutline});
  assert.strictEqual(shared.outline,projectedOutline);
  assert.deepEqual(shared,bigEyeGeometry(contour,pose,{lookY:.13}));
  for(const [source,options] of [
    [pose,{pullAmount:1}],[pose,{deformAngle:2}],
    [{...pose,r:Infinity},{}],[{...pose,x:Infinity},{}],[{...pose,r:0},{}]
  ]){
    const raw=projectSkinContour(contour,source);
    const geometry=bigEyeGeometry(contour,source,{...options,projectedOutline:raw});
    assert.notStrictEqual(geometry.outline,raw);
    assert.deepEqual(geometry,bigEyeGeometry(contour,source,options));
  }
});

test('WebGL gradient is one non-overlapping radial fan and one pure-black circular pupil',()=>{
  const calls=[],g={fillGradientStyle(...args){calls.push(['gradient',...args]);},fillTriangle(...args){calls.push(['triangle',...args]);},
    fillStyle(...args){calls.push(['fill',...args]);},fillCircle(...args){calls.push(['eye',...args]);}};
  const contour=skinContour(8),pose={x:160,y:270,r:32,pullAmount:.8,deformAngle:-.5};
  const geometry=drawBigEye(g,contour,pose,{color:0xb9df9b,alpha:.3});
  assert.equal(calls.filter(c=>c[0]==='triangle').length,contour.length);
  const gradient=calls[0],colors=bigEyeColors(0xb9df9b);
  assert.deepEqual(gradient,['gradient',colors.center,colors.edge,colors.edge,colors.edge,.3]);
  assert.deepEqual(calls.at(-2),['fill',0,.3]);
  assert.deepEqual(calls.at(-1),['eye',geometry.eye.x,geometry.eye.y,geometry.eye.r]);
  for(const call of calls.filter(c=>c[0]==='triangle')){near(call[1],pose.x);near(call[2],pose.y);}
});

test('Canvas fallback bands have no overdraw, preserving appearance-fade opacity',()=>{
  let color,alpha;const triangles=[],g={fillStyle(c,a){color=c;alpha=a;},fillTriangle(...p){triangles.push({color,alpha,p});},fillCircle(){}};
  const contour=skinContour(6),geometry=drawBigEye(g,contour,{r:20},{alpha:.27});
  const area=p=>Math.abs(p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a.x*b.y-a.y*b.x;},0))/2;
  const filled=triangles.reduce((sum,{p})=>sum+area([{x:p[0],y:p[1]},{x:p[2],y:p[3]},{x:p[4],y:p[5]}]),0);
  near(filled,area(geometry.outline),1e-6);
  assert.ok(triangles.every(t=>t.alpha===.27));
  assert.equal(drawBigEye(g,contour,{r:20},{alpha:0}),false);
});
