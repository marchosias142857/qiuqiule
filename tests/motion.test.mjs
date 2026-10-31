import test from 'node:test';
import assert from 'node:assert/strict';
import {faceTarget,smoothFace,transferPose} from '../dist/motion.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} ≠ ${b}`);
test('reversing a tiny rebound displacement cannot flip the eyes by a fixed amount',()=>{
  const body={vx:0,vy:0};let state={x:0,y:0},maxJump=0;
  for(let i=0;i<120;i++){
    const pull={dx:Math.sin(i/120*Math.PI*6)*100*(1-i/120)**2,dy:0};
    const next=smoothFace(state,faceTarget(body,pull,100),1/120);maxJump=Math.max(maxJump,Math.abs(next.x-state.x));state=next;
  }
  assert.ok(maxJump<.01);near(faceTarget(body,{dx:0,dy:0},100).x,0);
  assert.ok(Math.abs(faceTarget(body,{dx:.0001,dy:0},100).x-faceTarget(body,{dx:-.0001,dy:0},100).x)<.000001);
});
test('UI transfers preserve exact endpoints and ease position and size to rest',()=>{
  const a={x:100,y:200,r:40},b={x:500,y:600,r:19},start=transferPose(a,b,0),end=transferPose(a,b,1);
  near(start.x,a.x);near(start.y,a.y);near(start.r,a.r);near(end.x,b.x);near(end.y,b.y);near(end.r,b.r);
  const almost=transferPose(a,b,.999);assert.ok(Math.hypot(end.x-almost.x,end.y-almost.y)<.0001);assert.ok(Math.abs(end.r-almost.r)<.00001);
});

test('result bounce preserves its ground anchor and changes squash and shadow with height',async()=>{
  const {resultBounce}=await import('../dist/motion.js');const anchor={x:120,y:280,r:36};
  const ground=resultBounce(anchor,0),apex=resultBounce(anchor,.57),landing=resultBounce(anchor,1.18);
  near(ground.y,anchor.y);assert.ok(apex.y<ground.y-40);near(apex.shadowY,ground.shadowY);
  assert.ok(apex.shadowScale<ground.shadowScale&&apex.shadowOpacity<ground.shadowOpacity&&apex.shadowBlur>ground.shadowBlur);
  assert.ok(landing.squash<0);near(resultBounce(anchor,1.45).y,ground.y);
  assert.deepEqual(resultBounce(anchor,4,true),resultBounce(anchor,0,true));
});

test('strained eyes are moderately larger without shifting the eye centers',async()=>{
  const {strainedEyeOutline}=await import('../dist/motion.js');
  const left=strainedEyeOutline(-1),right=strainedEyeOutline(1);
  assert.equal(left.length,right.length);
  for(let i=0;i<left.length;i++){near(left[i].x,-right[i].x);near(left[i].y,right[i].y);}
  const xs=left.map(p=>p.x),ys=left.map(p=>p.y);
  const width=Math.max(...xs)-Math.min(...xs),height=Math.max(...ys)-Math.min(...ys);
  // Compare against the 2.2.0 footprint, rather than the spline's control points.
  assert.ok(width/.1056>=1.2&&width/.1056<=1.35);
  assert.ok(height/.1729>=1.2&&height/.1729<=1.35);
  near((Math.min(...xs)+Math.max(...xs))/2,0);
  near((Math.min(...ys)+Math.max(...ys))/2,0);
});

test('the entire strained-eye contour closes smoothly without cusps or crossings',async()=>{
  const {strainedEyeOutline}=await import('../dist/motion.js');
  const p=strainedEyeOutline(-1),n=p.length;
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  for(let i=0;i<n;i++){
    const a=p[(i+n-1)%n],b=p[i],c=p[(i+1)%n];
    assert.ok(Number.isFinite(b.x)&&Number.isFinite(b.y));
    const u={x:b.x-a.x,y:b.y-a.y},v={x:c.x-b.x,y:c.y-b.y};
    assert.ok(Math.hypot(u.x,u.y)>1e-6);
    // Includes the final-to-first join, every outer corner and the inner notch.
    const turn=Math.abs(Math.atan2(u.x*v.y-u.y*v.x,u.x*v.x+u.y*v.y));
    assert.ok(turn<Math.PI/36,`visible corner at sample ${i}: ${turn}`);
    for(let j=i+2;j<n;j++){
      if(i===0&&j===n-1)continue;
      const d=p[j],e=p[(j+1)%n];
      assert.ok(!(cross(b,c,d)*cross(b,c,e)<0&&cross(d,e,b)*cross(d,e,c)<0),`crossing at ${i},${j}`);
    }
  }
});
