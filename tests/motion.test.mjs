import test from 'node:test';
import assert from 'node:assert/strict';
import {faceTarget,pointerFaceTarget,smoothFace,transferPose,pullBallPoint,playerVisualState,strainedEyeOutline,relaxedEyeOutline} from '../dist/motion.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} ≠ ${b}`);
const pullPoint=(t,amount)=>pullBallPoint(Math.cos(t),Math.sin(t),amount);

test('held-finger gaze stays subtle, points toward the finger and is continuous at the ball edge',()=>{
  const body={x:200,y:300,r:30};
  assert.deepEqual(pointerFaceTarget(body,null),{x:0,y:0});
  assert.deepEqual(pointerFaceTarget(body,{x:205,y:295}),{x:0,y:0});
  assert.deepEqual(pointerFaceTarget(body,{x:230,y:300}),{x:0,y:0});
  assert.ok(pointerFaceTarget(body,{x:230.00001,y:300}).x<1e-7);
  for(let i=0;i<8;i++){
    const angle=i*Math.PI/4,dx=Math.cos(angle),dy=Math.sin(angle);
    let previous=0;
    for(const distance of [31,60,120,1000,1e6]){
      const target=pointerFaceTarget(body,{x:body.x+dx*distance,y:body.y+dy*distance});
      const amount=Math.hypot(target.x,target.y);
      assert.ok(amount>=previous&&amount<=.080000001);previous=amount;
      near(target.x/amount,dx);near(target.y/amount,dy);
    }
  }
  const target=pointerFaceTarget(body,{x:600,y:300}),first=smoothFace({x:0,y:0},target,1/60);
  assert.ok(first.x>0&&first.x<target.x*.5,'the first frame must not snap to the finger');
  let gaze=first;
  for(let i=0;i<45;i++)gaze=smoothFace(gaze,target,1/60);
  near(gaze.x,target.x);
  const released=smoothFace(gaze,pointerFaceTarget(body,null),1/60);
  assert.ok(released.x>0&&released.x<gaze.x,'release returns smoothly rather than snapping');
  assert.deepEqual(smoothFace(gaze,target,0),gaze);
});

test('pull contour joins the round hemisphere with matching position, tangent and curvature',()=>{
  const h=1e-4;
  for(const amount of [.01,.25,.5,.75,1])for(const t of [Math.PI/2,Math.PI*1.5]){
    const p=pullPoint(t,amount);
    near(p.x,Math.cos(t));near(p.y,Math.sin(t));
    for(const side of [-1,1]){
      const points=[0,1,2,3].map(i=>pullPoint(t+side*i*h,amount));
      for(const [axis,first,second] of [['x',-Math.sin(t),-Math.cos(t)],['y',Math.cos(t),-Math.sin(t)]]){
        const v=points.map(q=>q[axis]);
        const tangent=(-3*v[0]+4*v[1]-v[2])/(2*side*h);
        const curvature=(2*v[0]-5*v[1]+4*v[2]-v[3])/(h*h);
        assert.ok(Math.abs(tangent-first)<1e-5,`tangent jump at ${t}, ${axis}, ${amount}`);
        assert.ok(Math.abs(curvature-second)<1e-3,`curvature jump at ${t}, ${axis}, ${amount}`);
      }
    }
  }
});

test('pull keeps the back hemisphere, round rest shape and reach with a three-percent narrower full tip',()=>{
  for(const amount of [0,.25,.5,.75,1]){
    for(let i=0;i<=200;i++){
      const t=Math.PI/2+i/200*Math.PI,p=pullPoint(t,amount);
      near(p.x,Math.cos(t));near(p.y,Math.sin(t));
      const rest=pullPoint(t*2,0);near(rest.x,Math.cos(t*2));near(rest.y,Math.sin(t*2));
    }
    const tip=pullPoint(0,amount);near(tip.x,1+.95*amount);near(tip.y,0);
  }
  // The full-pull tangent narrows by exactly 3% while the forward extension
  // and second derivative stay fixed. Its curvature remains finite and round.
  const h=1e-4,left=pullPoint(-h,1),tip=pullPoint(0,1),right=pullPoint(h,1);
  const dy=(right.y-left.y)/(2*h),ddx=(right.x-2*tip.x+left.x)/(h*h);
  near(dy,.85*.97);
  assert.ok(Math.abs(-ddx/(dy*dy)-4.01384083045/(.97*.97))<1e-5);
});

test('full-charge tip narrowing eases in only above eighty percent without a contour jump',()=>{
  const t=.3,ct=Math.cos(t),st=Math.sin(t),oldY=amount=>st*(1-.15*amount*ct**3);
  for(const amount of [0,.2,.5,.8])near(pullBallPoint(ct,st,amount).y,oldY(amount));
  for(const amount of [.85,.9,.95,1])assert.ok(pullBallPoint(ct,st,amount).y<oldY(amount));
  const h=1e-5;
  for(const amount of [.8,1]){
    const before=pullBallPoint(ct,st,amount-h),at=pullBallPoint(ct,st,amount),after=pullBallPoint(ct,st,amount+h);
    assert.ok(Math.abs((at.y-before.y)/h-(after.y-at.y)/h)<1e-4,'charge boundary has no tangent snap');
  }
});

test('the pull outline stays symmetric and strictly convex throughout its range',()=>{
  const count=720;
  for(let step=0;step<=100;step++){
    const amount=step/100,points=Array.from({length:count},(_,i)=>pullPoint(i/count*Math.PI*2,amount));
    for(let i=0;i<count;i++){
      const prev=points[(i+count-1)%count],p=points[i],next=points[(i+1)%count];
      const reflected=points[(count-i)%count];near(p.x,reflected.x);near(p.y,-reflected.y);
      const ux=p.x-prev.x,uy=p.y-prev.y,vx=next.x-p.x,vy=next.y-p.y;
      assert.ok(ux*vy-uy*vx>0,`shoulder dent or fold at pull ${amount}, sample ${i}`);
      assert.ok(p.x>=-1-1e-9&&p.x<=1+.95*amount+1e-9);
    }
  }
});

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

test('UI transfers carry gaze continuously to the destination rather than resetting it before handoff',()=>{
  const from={x:100,y:200,r:40,lookX:.13,lookY:-.08},to={x:300,y:500,r:30,lookX:-.07,lookY:.1};
  for(const destination of [to,{x:to.x,y:to.y,r:to.r}]){
    const start=transferPose(from,destination,0),end=transferPose(from,destination,1);
    near(start.lookX,from.lookX);near(start.lookY,from.lookY);
    near(end.lookX,destination.lookX||0);near(end.lookY,destination.lookY||0);
    const almost=transferPose(from,destination,.999);
    assert.ok(Math.hypot(end.lookX-almost.lookX,end.lookY-almost.lookY)<1e-7);
    const middle=transferPose(from,destination,.5);
    near(middle.lookX,(from.lookX+(destination.lookX||0))/2);
    near(middle.lookY,(from.lookY+(destination.lookY||0))/2);
  }
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
  assert.ok(height/.17176>=1.2&&height/.17176<=1.35);
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

test('rebound eye relaxation keeps the handoff frame and settles without extending game phases',()=>{
  for(const step of [1/120,1/60,1/30]){
    let v=playerVisualState(undefined,{phase:'wobble',strained:true,expressions:true,pulling:true,dt:step});
    v=playerVisualState(v,{phase:'idle',strained:false,expressions:true,pulling:false,dt:step});
    assert.equal(v.eyeMix,1);assert.equal(v.idleAge,0);
    for(let t=step;t<.12-1e-9;t+=step){
      const next=playerVisualState(v,{phase:'idle',strained:false,expressions:true,pulling:false,dt:step});
      assert.ok(next.eyeMix<v.eyeMix&&next.eyeMix>0);v=next;
    }
    for(let i=0;i<3;i++)v=playerVisualState(v,{phase:'idle',strained:false,expressions:true,pulling:false,dt:step});
    assert.equal(v.eyeMix,0);
  }
  const rebound=playerVisualState(undefined,{phase:'wobble',strained:true,expressions:true,pulling:true,dt:0});
  for(const phase of ['flight','external',null]){
    const v=playerVisualState(rebound,{phase,strained:false,expressions:true,pulling:false,dt:0});
    assert.equal(v.eyeMix,0,'successful launches still restore the ordinary eyes immediately');
  }
  const disabled=playerVisualState(rebound,{phase:'idle',strained:false,expressions:false,pulling:false,dt:0});
  assert.equal(disabled.eyeMix,0,'turning expressions off takes effect immediately');
});

test('relaxing eye contours preserve mirror symmetry and reach the exact original ellipse without folds',()=>{
  const outlines=[-1,1].map(strainedEyeOutline),normal=outlines.map(relaxedEyeOutline);
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  for(let step=0;step<=20;step++){
    const mix=step/20;
    const contours=outlines.map((points,side)=>points.map((p,i)=>({
      x:normal[side][i].x+(p.x-normal[side][i].x)*mix,
      y:normal[side][i].y+(p.y-normal[side][i].y)*mix,
    })));
    const [left,right]=contours;
    for(let i=0;i<left.length;i++){
      near(left[i].x,-right[i].x);near(left[i].y,right[i].y);
      if(step===0)near((left[i].x/.0525)**2+(left[i].y/.095)**2,1);
    }
    for(const p of contours)for(let i=0;i<p.length;i++){
      const a=p[i],b=p[(i+1)%p.length];
      for(let j=i+2;j<p.length;j++){
        if(i===0&&j===p.length-1)continue;
        const c=p[j],d=p[(j+1)%p.length];
        assert.ok(!(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0),`eye folds at blend ${mix}`);
      }
    }
  }
});
