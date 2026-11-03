import test from 'node:test';
import assert from 'node:assert/strict';
import {crownOutline,crownVisual,bossAngryEyeOutline,bossHornOutline,bossHornCurves,bossSpiralEye,bossFacePose} from '../dist/boss-visuals.js';
import {BOSS_TIMING} from '../dist/physics.js';

const near=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<tolerance,`${a} ≠ ${b}`);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const vector=(a,b)=>({x:b.x-a.x,y:b.y-a.y});
const turn=(u,v)=>Math.abs(Math.atan2(u.x*v.y-u.y*v.x,u.x*v.x+u.y*v.y));
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const spinEnd=BOSS_TIMING.brake+BOSS_TIMING.spin;
const fadeStart=spinEnd+BOSS_TIMING.hold,celebrationEnd=fadeStart+BOSS_TIMING.fade;
const area=points=>points.reduce((sum,p,i)=>{
  const q=points[(i+1)%points.length];return sum+(p.x*q.y-p.y*q.x)/2;
},0);
function assertSimple(points){
  const n=points.length;
  for(let i=0;i<n;i++)for(let j=i+2;j<n;j++){
    if(i===0&&j===n-1)continue;
    const a=points[i],b=points[(i+1)%n],c=points[j],d=points[(j+1)%n];
    const crosses=cross(a,b,c)*cross(a,b,d)<-1e-14&&cross(c,d,a)*cross(c,d,b)<-1e-14;
    assert.ok(!crosses,`outline edges ${i} and ${j} intersect`);
  }
}

test('the crown has three rounded peaks, mirrored sides and a reusable radius',()=>{
  const points=crownOutline(),n=points.length;
  assert.ok(n>=72&&n<=150);
  assert.notDeepEqual(points[0],points.at(-1),'closePath supplies the closing edge');
  const peaks=points.filter((p,i)=>p.y<-1.4&&p.y<points[(i+n-1)%n].y&&p.y<=points[(i+1)%n].y);
  assert.equal(peaks.length,3);
  assert.ok(peaks[0].x<-.8&&peaks[2].x>.8);
  const width=Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x));
  assert.ok(width>1.7&&width<1.8,'the crown should be about 18% narrower than the former 2.12-radius footprint');
  near(peaks[1].x,0);
  assert.ok(peaks[1].y<peaks[0].y-.2&&peaks[1].y<peaks[2].y-.2);
  for(const p of points){
    assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
    assert.ok(points.some(q=>Math.abs(q.x+p.x)<1e-9&&Math.abs(q.y-p.y)<1e-9));
  }
  for(const radius of [18,34,57.8]){
    const scaled=crownOutline(radius);
    for(let i=0;i<n;i++){near(scaled[i].x,points[i].x*radius);near(scaled[i].y,points[i].y*radius);}
  }
  const copy=crownOutline();copy[0].x=100;
  assert.notEqual(crownOutline()[0].x,100,'a caller cannot mutate the shared template');
});

test('all seven original corners are rounded and curve joins preserve their tangents',()=>{
  const points=crownOutline(),n=points.length;
  const width=.82,baseY=-Math.sqrt(1.18**2-(.9*width)**2);
  const oldCorners=[[-.9*width,baseY],[-1.08*width,-1.65],[-.47*width,-1.35],[0,-1.95],[.47*width,-1.35],[1.08*width,-1.65],[.9*width,baseY]];
  for(const [x,y] of oldCorners){
    assert.ok(Math.min(...points.map(p=>distance(p,{x,y})))>.02,'an original sharp vertex survived');
  }
  let straightJoins=0,arcJoins=0;
  for(let i=0;i<n;i++){
    const a=points[(i+n-1)%n],p=points[i],b=points[(i+1)%n];
    const change=turn(vector(a,p),vector(p,b));
    assert.ok(distance(a,p)>1e-5,'duplicate points produce a degenerate segment');
    assert.ok(change<.30,'a cusp or sharp corner remains');
    if(distance(a,p)>.3||distance(p,b)>.3){
      // Secants approximate the common analytic tangent at each line/curve join.
      assert.ok(change<.04,'a rounded section does not meet its straight edge smoothly');
      straightJoins++;
    }
    const onArc=q=>Math.abs(Math.hypot(q.x,q.y)-1.18)<1e-10;
    if(onArc(p)&&(!onArc(a)||!onArc(b))){
      assert.ok(change<.02,'a bottom corner does not meet the circle tangentially');
      arcJoins++;
    }
  }
  assert.equal(straightJoins,12);
  assert.equal(arcJoins,2);
});

test('the bottom follows the player-centered circle and leaves a gap throughout entry',()=>{
  const points=crownOutline();
  const bottom=points.filter(p=>Math.abs(Math.hypot(p.x,p.y)-1.18)<1e-10);
  assert.ok(bottom.length>=30,'the bottom must preserve a substantial true circular arc');
  assert.ok(Math.min(...bottom.map(p=>p.x))<-.6&&Math.max(...bottom.map(p=>p.x))>.6);
  assert.ok(bottom.some(p=>Math.abs(p.x)<1e-10&&Math.abs(p.y+1.18)<1e-10));
  for(const p of points)assert.ok(Math.hypot(p.x,p.y)>=1.18-1e-10);
  for(let i=0;i<=100;i++){
    const {scale}=crownVisual(BOSS_TIMING.brake+.20*i/100);
    for(const p of points){
      const x=p.x*scale,y=-1.45+(p.y+1.45)*scale;
      assert.ok(Math.hypot(x,y)>1.16,'entry scaling should not push the crown into the player');
    }
  }
});

test('the closed crown outline never crosses itself',()=>{
  assertSimple(crownOutline());
});

test('celebration waits for braking, enters during the spin, holds and fades out',()=>{
  for(const time of [-1,0,.4,BOSS_TIMING.brake])assert.equal(crownVisual(time).alpha,0);
  for(let i=0;i<=100;i++)assert.deepEqual(crownVisual(spinEnd+BOSS_TIMING.hold*i/100),{scale:1,alpha:1});
  for(const time of [celebrationEnd,celebrationEnd+1,10])assert.deepEqual(crownVisual(time),{scale:1,alpha:0});
  let previousAlpha=0,previousScale=.55;
  for(let i=0;i<=100;i++){
    const visual=crownVisual(BOSS_TIMING.brake+.20*i/100);
    assert.ok(visual.alpha>=previousAlpha&&visual.alpha<=1);
    assert.ok(visual.scale>=previousScale&&visual.scale<=1);
    previousAlpha=visual.alpha;previousScale=visual.scale;
  }
  previousAlpha=1;
  for(let i=0;i<=100;i++){
    const {alpha,scale}=crownVisual(fadeStart+BOSS_TIMING.fade*i/100);
    assert.ok(alpha<=previousAlpha&&alpha>=0);near(scale,1);previousAlpha=alpha;
  }
});

test('entry and exit meet their holds with continuous speed and acceleration',()=>{
  const h=1e-5;
  for(const reduced of [false,true])for(const boundary of [BOSS_TIMING.brake,BOSS_TIMING.brake+.2,fadeStart,celebrationEnd]){
    const a=crownVisual(boundary-h,reduced),b=crownVisual(boundary,reduced),c=crownVisual(boundary+h,reduced);
    for(const key of ['scale','alpha']){
      assert.ok(Math.abs((c[key]-a[key])/(2*h))<1e-4,`${key} speed jumps at ${boundary}`);
      assert.ok(Math.abs((c[key]-2*b[key]+a[key])/(h*h))<.03,`${key} acceleration jumps at ${boundary}`);
    }
  }
});

test('reduced motion uses opacity only without changing celebration timing',()=>{
  for(let i=0;i<=300;i++){
    const time=i/100,normal=crownVisual(time),reduced=crownVisual(time,true);
    assert.equal(reduced.scale,1);near(reduced.alpha,normal.alpha);
  }
});

test('angry eyes are mirrored minor circular segments with four rounded chord ends',()=>{
  const left=bossAngryEyeOutline(-1),right=bossAngryEyeOutline(1);
  assert.ok(left.length>=50);assert.equal(left.length,right.length);
  for(const p of left)assert.ok(right.some(q=>Math.abs(q.x+p.x)<1e-9&&Math.abs(q.y-p.y)<1e-9));
  for(const side of [-1,1]){
    const points=bossAngryEyeOutline(side),n=points.length;assertSimple(points);
    // Less than half of the original circle: this is a filled bow-shaped eye.
    assert.ok(Math.abs(area(points))>.02&&Math.abs(area(points))<Math.PI*.16**2/2);
    const longEdges=[];
    for(let i=0;i<n;i++){
      const a=points[(i+n-1)%n],p=points[i],b=points[(i+1)%n];
      const change=turn(vector(a,p),vector(p,b));
      assert.ok(change<.3,'the eye has a sharp endpoint');
      if(distance(p,b)>.2)longEdges.push([p,b]);
      if(distance(a,p)>.2||distance(p,b)>.2)assert.ok(change<.05,'a lid endpoint does not meet its round fillet smoothly');
    }
    assert.equal(longEdges.length,1,'each eye should have one cut lid, not a separate eyebrow');
    const [a,b]=longEdges[0],slope=(b.y-a.y)/(b.x-a.x);
    assert.ok(side*slope<-.3,'the lid must slope down toward the nose');
    const neutral=bossAngryEyeOutline(side,1,0),center={x:side*.29,y:-.08};
    const lidY=.035-(.16+.035)/2;
    const onCircle=neutral.filter(p=>Math.abs(Math.hypot(p.x-center.x,p.y-center.y+(.16+.035)/2)-.16)<1e-9);
    assert.ok(onCircle.length>=30,'the curved side should preserve a genuine circular arc');
    assert.ok(neutral.every(p=>p.y-center.y>=lidY-1e-10));
  }
});

test('larger gently curved horns stay rounded, mirrored and attached to the ball',()=>{
  const left=bossHornOutline(-1),right=bossHornOutline(1);
  assert.equal(left.length,right.length);
  for(let i=0;i<left.length;i++){near(left[i].x,-right[i].x);near(left[i].y,right[i].y);}
  for(const points of [left,right]){
    assertSimple(points);
    const radii=points.map(p=>Math.hypot(p.x,p.y));
    assert.ok(Math.min(...radii)<1,'the base should blend into the ball');
    assert.ok(Math.max(...radii)>1.35&&Math.max(...radii)<1.39,'horn protrusion should be about .37 radii');
    for(let i=0;i<points.length;i++){
      const a=points[(i+points.length-1)%points.length],p=points[i],b=points[(i+1)%points.length];
      if(Math.hypot(p.x,p.y)>1)assert.ok(turn(vector(a,p),vector(p,b))<.20,'a visible horn has a pointed or faceted tip');
    }
  }
  for(const side of [-1,1]){
    const absent=bossHornOutline(side,0),tiny=bossHornOutline(side,1e-5);
    assert.ok(absent.every(p=>distance(p,absent[0])<1e-10));
    assert.ok(tiny.every(p=>distance(p,absent[0])<5e-6),'growth must start continuously from the attached base');
  }
});

test('the two horn sides bow the same way and meet a small rounded tip tangentially',()=>{
  const velocity=(arc,end)=>end
    ?{x:3*(arc.end.x-arc.control2.x),y:3*(arc.end.y-arc.control2.y)}
    :{x:3*(arc.control1.x-arc.start.x),y:3*(arc.control1.y-arc.start.y)};
  const acceleration=(arc,end)=>end
    ?{x:6*(arc.end.x-2*arc.control2.x+arc.control1.x),y:6*(arc.end.y-2*arc.control2.y+arc.control1.y)}
    :{x:6*(arc.control2.x-2*arc.control1.x+arc.start.x),y:6*(arc.control2.y-2*arc.control1.y+arc.start.y)};
  const curvature=(v,a)=>(v.x*a.y-v.y*a.x)/Math.hypot(v.x,v.y)**3;
  for(const side of [-1,1]){
    const arcs=bossHornCurves(side),[outer,cap,inner]=arcs;
    assert.deepEqual(arcs.map(a=>a.role),['outer','tip','inner']);
    const innerUp={start:inner.end,control1:inner.control2,control2:inner.control1,end:inner.start};
    for(const end of [false,true]){
      const ko=curvature(velocity(outer,end),acceleration(outer,end));
      const ki=curvature(velocity(innerUp,end),acceleration(innerUp,end));
      assert.ok(ko*ki>0,'both sides must bend the same way from root to tip, forming a crescent rather than a leaf');
    }
    for(let i=0;i<2;i++){
      const a=arcs[i],b=arcs[i+1];
      near(a.end.x,b.start.x);near(a.end.y,b.start.y);
      const va=velocity(a,true),vb=velocity(b,false);
      assert.ok(Math.hypot(va.x,va.y)>0,'a zero tangent would hide a cusp');
      near(va.x/Math.hypot(va.x,va.y),vb.x/Math.hypot(vb.x,vb.y));
      near(va.y/Math.hypot(va.x,va.y),vb.y/Math.hypot(vb.x,vb.y));
    }
    assert.ok(Math.hypot(outer.start.x,outer.start.y)<1&&Math.hypot(inner.end.x,inner.end.y)<1,'the closing root edge must remain hidden inside the ball');
    assert.ok(distance(cap.start,cap.end)<.06,'the rounded cap should remain a small part of the horn');
    for(let i=0;i<=100;i++){
      const t=i/100,u=1-t;
      const v={x:3*u*u*(cap.control1.x-cap.start.x)+6*u*t*(cap.control2.x-cap.control1.x)+3*t*t*(cap.end.x-cap.control2.x),
        y:3*u*u*(cap.control1.y-cap.start.y)+6*u*t*(cap.control2.y-cap.control1.y)+3*t*t*(cap.end.y-cap.control2.y)};
      const a={x:6*u*(cap.control2.x-2*cap.control1.x+cap.start.x)+6*t*(cap.end.x-2*cap.control2.x+cap.control1.x),
        y:6*u*(cap.control2.y-2*cap.control1.y+cap.start.y)+6*t*(cap.end.y-2*cap.control2.y+cap.control1.y)};
      assert.ok(1/Math.abs(curvature(v,a))>.015,'the tip must not contain a sharp curvature spike');
    }
  }
});

test('the displayed horn follows its two primary curves and short rounded cap',()=>{
  const evaluate=(arc,t)=>{
    const u=1-t,weights=[u**3,3*u*u*t,3*u*t*t,t**3],p={x:0,y:0};
    [arc.start,arc.control1,arc.control2,arc.end].forEach((q,i)=>{p.x+=q.x*weights[i];p.y+=q.y*weights[i];});
    return p;
  };
  for(const side of [-1,1])for(const growth of [.2,1]){
    const arcs=bossHornCurves(side,growth),points=bossHornOutline(side,growth);
    assert.equal(points.length,185);
    let offset=0;
    for(const arc of arcs){
      const steps=arc.role==='tip'?24:80;
      for(let sample=0;sample<=steps;sample++){
        const expected=evaluate(arc,sample/steps),actual=points[offset+sample];
        near(actual.x,expected.x);near(actual.y,expected.y);
      }
      offset+=steps;
    }
  }
});

test('horns taper from a broad root to a lightly outward tip without curling back',()=>{
  const evaluate=(arc,t)=>{
    const u=1-t,weights=[u**3,3*u*u*t,3*u*t*t,t**3],p={x:0,y:0};
    [arc.start,arc.control1,arc.control2,arc.end].forEach((q,i)=>{p.x+=q.x*weights[i];p.y+=q.y*weights[i];});
    return p;
  };
  for(const side of [-1,1]){
    const up=Math.sqrt(1-.62**2),radial={x:side*.62,y:-up},tangent={x:side*up,y:.62};
    const points=bossHornOutline(side).map(p=>({x:p.x*tangent.x+p.y*tangent.y,y:p.x*radial.x+p.y*radial.y-.985}));
    const tip=points.reduce((highest,p)=>p.y>highest.y?p:highest);
    assert.ok(tip.x>.04&&tip.x<.09,'the tip should bend outward only slightly');
    assert.ok(tip.x/tip.y<.25,'the tip should not form a sideways hook');
    for(const growth of [.1,.25,.5,.75,1]){
      const arcs=bossHornCurves(side,growth);
      const edges=[t=>evaluate(arcs[0],t),t=>evaluate(arcs[2],1-t)];
      // Start at the actual unit-circle intersection, not a guessed height:
      // sparse slices above the seam can miss a leaf-shaped bulge near its root.
      const entries=edges.map(edge=>{
        let low=0,high=1;
        assert.ok(Math.hypot(edge(low).x,edge(low).y)<1);
        assert.ok(Math.hypot(edge(high).x,edge(high).y)>1);
        for(let i=0;i<50;i++){
          const middle=(low+high)/2,p=edge(middle);
          if(Math.hypot(p.x,p.y)<1)low=middle;else high=middle;
        }
        return high;
      });
      const local=bossHornOutline(side,growth).map(p=>({x:p.x*tangent.x+p.y*tangent.y,y:p.x*radial.x+p.y*radial.y}));
      const start=Math.min(...entries.map((t,i)=>{const p=edges[i](t);return p.x*radial.x+p.y*radial.y;}));
      const top=Math.max(...local.map(p=>p.y));
      let previousWidth=Infinity;
      for(let i=0;i<160;i++){
        const height=start+(top-start)*i/160,intersections=[];
        for(let j=0;j<local.length;j++){
          const a=local[j],b=local[(j+1)%local.length];
          if((a.y<height&&b.y>=height)||(b.y<height&&a.y>=height))intersections.push(a.x+(b.x-a.x)*(height-a.y)/(b.y-a.y));
        }
        assert.equal(intersections.length,2,'the crescent should not fold back across its height');
        const width=Math.max(...intersections)-Math.min(...intersections);
        assert.ok(width<previousWidth+1e-12,'the visible horn must be widest at the circle junction, with no middle bulge');
        previousWidth=width;
      }
    }
  }
});

test('spiral eyes share winding with the right eye flipped about its own center',()=>{
  for(const angle of [0,.7,2.5,Math.PI*2]){
    const left=bossSpiralEye(-1,angle),right=bossSpiralEye(1,angle);
    assert.equal(left.length,81);
    for(let i=0;i<left.length;i++){near(left[i].x+.58,right[i].x);near(left[i].y,right[i].y);}
    assert.ok(left.some((p,i)=>Math.abs(p.x+right[i].x)>.01),'the stunned face must not be axially symmetric');
    for(const side of [-1,1]){
      const points=bossSpiralEye(side,angle),center={x:side*.29,y:-.08};
      near(distance(points[0],center),.012);near(distance(points.at(-1),center),.136);
      for(let i=1;i<points.length;i++)assert.ok(distance(points[i],center)>distance(points[i-1],center));
    }
  }
  const before=bossSpiralEye(-1,Math.PI*2-1e-5),after=bossSpiralEye(-1,0);
  for(let i=0;i<before.length;i++)assert.ok(distance(before[i],after[i])<2e-6,'rotation must have no wrap-around jump');
});

test('boss entry grows the body before opening angry eyes and growing the horns',()=>{
  const initial=bossFacePose({entryTime:0});
  for(const key of ['alpha','scale','eyeOpen','anger','angryAlpha','spiralAlpha','hornScale'])assert.equal(initial[key],0);
  const almostBody=bossFacePose({entryTime:.5});
  assert.ok(almostBody.scale>.95&&almostBody.alpha>.95);assert.equal(almostBody.eyeOpen,0);assert.equal(almostBody.hornScale,0);
  const body=bossFacePose({entryTime:.6});near(body.scale,1);near(body.alpha,1);
  const final=bossFacePose({entryTime:BOSS_TIMING.entry});
  for(const key of ['alpha','scale','eyeOpen','anger','angryAlpha','angryScale','hornScale'])near(final[key],1);
  near(final.spiralAlpha,0);
  assert.deepEqual(final,bossFacePose(),'entry must meet the active boss pose without a jump');
  for(const boundary of [0,.5,.55,.6,.7,BOSS_TIMING.entry]){
    const a=bossFacePose({entryTime:boundary-1e-6}),b=bossFacePose({entryTime:boundary+1e-6});
    for(const key of ['alpha','scale','eyeOpen','anger','hornScale'])assert.ok(Math.abs(a[key]-b[key])<.00003);
  }
});

test('stunned eyes blend continuously instead of replacing the angry pose in one frame',()=>{
  const initial=bossFacePose(),start=bossFacePose({stunned:true,stunnedTime:0});
  assert.deepEqual(start,initial);
  let previous=0;
  for(let i=0;i<=100;i++){
    const p=bossFacePose({stunned:true,stunnedTime:.24*i/100});
    assert.ok(p.spiralAlpha>=previous&&p.spiralAlpha<=1);previous=p.spiralAlpha;
    near(p.angryAlpha+p.spiralAlpha,1);assert.ok(p.angryScale>=.8&&p.angryScale<=1);
    near(p.hornScale,1);near(p.alpha,1);near(p.scale,1);
  }
  const middle=bossFacePose({stunned:true,stunnedTime:.12});
  near(middle.angryAlpha,.5);near(middle.spiralAlpha,.5);near(middle.angryScale,.9);
  const end=bossFacePose({stunned:true,stunnedTime:.24});near(end.angryAlpha,0);near(end.spiralAlpha,1);
  assert.deepEqual(end,bossFacePose({stunned:true,stunnedTime:10}));
  const paused={stunned:true,stunnedTime:.12,time:17.3};
  assert.deepEqual(bossFacePose(paused),bossFacePose(paused),'render calls must not advance simulation time');
  near(bossFacePose({...paused,reducedMotion:true}).spiralTurn,0);
});
