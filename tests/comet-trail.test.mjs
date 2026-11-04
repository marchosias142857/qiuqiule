import test from 'node:test';
import assert from 'node:assert/strict';
import {CometTrails,COMET_TRAIL,cometProfile,cometRibbon,cometBands,COMET_CROSS_SECTION} from '../dist/comet-trail.js';

const ball=()=>({x:100,y:100,r:10,vx:400,vy:0});
const advance=(trails,body,frames=24,dt=1/120)=>{
  for(let i=0;i<frames;i++){body.x+=body.vx*dt;body.y+=body.vy*dt;trails.step([body],dt,{unit:10});}
};
const graphics=()=>({fills:[],vertices:[],fillStyle(color,alpha){this.fills.push({color,alpha});},beginPath(){},moveTo(x,y){this.vertices.push({x,y});},lineTo(x,y){this.vertices.push({x,y});},closePath(){},fillPath(){}});

test('a comet starts only at high speed and its capped length grows with actual speed',()=>{
  const trails=new CometTrails(),body=ball(),g=graphics();body.vx=190;
  advance(trails,body);trails.draw(g,[body],0x123456,{unit:10});
  assert.equal(g.fills.length,0);
  body.vx=400;advance(trails,body);trails.draw(g,[body],0x123456,{unit:10,strength:.6});
  assert.ok(g.fills.length>0);assert.ok(g.fills.every(fill=>fill.color===0x123456&&fill.alpha>0&&fill.alpha<.15));
  const medium=cometProfile(280,10,10),fast=cometProfile(400,10,10),extreme=cometProfile(100000,10,10);
  assert.ok(medium.length<fast.length);assert.equal(fast.length,70);assert.equal(extreme.length,fast.length);
  assert.equal(cometProfile(400,40,10).length,80,'large players do not leave screen-length tails');
});

test('speed just above the threshold reveals a short tail beyond the rear of the ball',()=>{
  const trails=new CometTrails(),body=ball(),g=graphics();body.vx=220;
  advance(trails,body);const profile=cometProfile(body.vx,body.r,10,.6);
  assert.ok(profile.length>body.r&&profile.length<body.r*2,'visible length grows from the rear edge, not from the ball center');
  trails.draw(g,[body],0x123456,{unit:10,strength:.6});
  assert.ok(g.vertices.some(point=>point.x<body.x-body.r-1),'a low-speed tail is not buried inside the ball');
  assert.ok(g.fills.some(fill=>fill.alpha>.03),'low-speed opacity remains perceptible while still subdued');
});

test('the 20/18 speed hysteresis avoids restarting samples around the entry threshold',()=>{
  const trails=new CometTrails(),body=ball();body.vx=200;advance(trails,body,1);
  assert.equal(trails.entries.get(body).active,true);
  body.vx=190;advance(trails,body,1);assert.equal(trails.entries.get(body).active,true);
  body.vx=179;advance(trails,body,1);assert.equal(trails.entries.get(body).active,false);
  body.vx=190;advance(trails,body,1);assert.equal(trails.entries.get(body).active,false);
});

test('the rounded ribbon follows bends, remains inside the wall and ends with a visible flat cut',()=>{
  const points=[{x:10,y:10,age:.1},{x:50,y:10,age:.05},{x:50,y:50,age:0}];
  const bounds={left:5,top:5,right:55,bottom:55};
  const ribbon=cometRibbon(points,{length:80,width:8,bounds});
  assert.ok(ribbon.length>2,'the corner is smoothly subdivided rather than one bent triangle');
  let distance=0;for(const segment of ribbon){
    distance+=Math.hypot(segment.end.x-segment.start.x,segment.end.y-segment.start.y);
    for(const point of segment.outer)assert.ok(point.x>=5&&point.x<=55&&point.y>=5&&point.y<=55);
  }
  assert.ok(distance<=80+1e-8);
  const tail=ribbon.at(-1);assert.ok(tail.endWidth>0&&tail.endWidth<ribbon[0].startWidth);
  assert.ok(tail.opacity>=.28,'the truncated end retains some transparency rather than vanishing to a point');
  assert.notDeepEqual(tail.outer[1],tail.outer[2],'the tail is a finite-width cross-section');
});

test('the tail uses darker side bands and a transparent center without painting a background color',()=>{
  const profile=cometProfile(400,10,10),ribbon=cometRibbon([{x:0,y:30,age:.15},{x:70,y:30,age:0}],profile),bands=cometBands(ribbon);
  assert.ok(bands.length>0);
  for(let i=0;i<bands.length;i+=COMET_CROSS_SECTION.length){
    const cross=bands.slice(i,i+COMET_CROSS_SECTION.length);
    assert.ok(cross[2].crossAlpha>cross[3].crossAlpha&&cross[3].crossAlpha>cross[4].crossAlpha,'ink fades inward toward the center');
    assert.ok(cross[2].crossAlpha>cross[1].crossAlpha&&cross[1].crossAlpha>cross[0].crossAlpha,'the outermost edge is feathered');
    assert.equal(cross[2].crossAlpha,cross[6].crossAlpha,'both sides have the same depth');
    assert.ok(cross[4].crossAlpha<=cross[2].crossAlpha*.1,'the middle stays distinctly lighter');
  }
  for(let i=1;i<COMET_CROSS_SECTION.length;i++)assert.equal(COMET_CROSS_SECTION[i-1].to,COMET_CROSS_SECTION[i].from,'bands partition the width without overlapping');
  const trails=new CometTrails(),body=ball(),g=graphics();advance(trails,body);trails.draw(g,[body],0x123456,{unit:10,strength:1});
  assert.ok(g.fills.every(fill=>fill.color===0x123456),'no background-colored cover or white highlight');
  assert.ok(g.fills.some(fill=>fill.alpha<.015)&&g.fills.some(fill=>fill.alpha>.1));
  assert.equal(g.fills.length,9,'each transverse band is one continuous polygon, with no longitudinal alpha seams');
  assert.ok(bands.every(band=>band.opacity===bands[0].opacity),'opacity cannot jump across longitudinal segments');
});

test('render cadence cannot change trajectory samples or consume visual state',()=>{
  const run=drawEvery=>{
    const trails=new CometTrails(),body=ball(),g=graphics();
    for(let i=0;i<120;i++){
      if(i===60){body.vx=0;body.vy=400;}
      advance(trails,body,1);if(i%drawEvery===0)trails.draw(g,[body],0x123456,{unit:10});
    }
    const before=structuredClone(trails.entries.get(body).points);
    for(let i=0;i<5;i++)trails.draw(g,[body],0x123456,{unit:10});
    assert.deepEqual(trails.entries.get(body).points,before);
    return before;
  };
  assert.deepEqual(run(1),run(2),'120fps and 60fps drawing use the same 120Hz physics trail');
});

test('frozen contact and stopped movement do not continuously renew a stale tail',()=>{
  const trails=new CometTrails(),body=ball();advance(trails,body);
  assert.ok(trails.entries.get(body).points.length>2);
  body.feedbackFreeze=1;
  for(let i=0;i<6;i++)trails.step([body],.05,{unit:10});
  assert.equal(trails.entries.get(body).points.length,0);
  body.feedbackFreeze=0;advance(trails,body,10);
  for(let i=0;i<6;i++)trails.step([body],.05,{unit:10});
  assert.ok(trails.entries.get(body).points.length<=1,'an unmoving ball never leaves a visible streak even if it still stores velocity');
});

test('teleports, absent auxiliaries and disabled feedback cannot connect stale history',()=>{
  const trails=new CometTrails(),body=ball(),aux={...ball(),x:150,r:6};
  for(let i=0;i<20;i++){body.x+=4;aux.x+=4;trails.step([body,aux],.01,{unit:10});}
  assert.equal(trails.entries.size,2);
  body.x+=2000;trails.step([body],1/120,{unit:10});
  assert.equal(trails.entries.size,1);assert.equal(trails.entries.get(body).points.length,1);
  trails.step([body],1/120,{unit:10,enabled:false});assert.equal(trails.entries.size,0);
  trails.step([body],1/120,{unit:10});assert.equal(trails.entries.get(body).points.length,1);
  trails.clear();assert.equal(trails.entries.size,0);
});

test('long high-speed sequences keep bounded memory and reject nonfinite body state',()=>{
  const trails=new CometTrails(),body=ball();body.vx=100000;
  advance(trails,body,5000,.001);
  const points=trails.entries.get(body).points;
  assert.ok(points.length<=COMET_TRAIL.maxPoints);assert.ok(points.every(point=>point.age<=COMET_TRAIL.lifetime));
  body.x=NaN;trails.step([body],.01,{unit:10});assert.equal(trails.entries.size,0);
});

test('slow physics steps retain the same full tail while its live head follows every new position',()=>{
  const lengths=[];
  for(const scale of [.3,.6,1]){
    const trails=new CometTrails(),body=ball(),dt=scale/120,profile=cometProfile(body.vx,body.r,10);
    trails.step([body],0,{unit:10});
    for(let frame=0;frame<Math.ceil(.3/dt);frame++){
      advance(trails,body,1,dt);
      const points=trails.entries.get(body).points;
      assert.equal(points.at(-1).x,body.x,`${scale}x head follows the current frame`);
      assert.equal(points.at(-1).y,body.y);
      assert.equal(points.at(-1).age,0);
      assert.ok(points.length<=COMET_TRAIL.maxPoints);
    }
    const points=trails.entries.get(body).points,ribbon=cometRibbon(points,profile);
    lengths.push(ribbon.reduce((total,segment)=>total+Math.hypot(segment.end.x-segment.start.x,segment.end.y-segment.start.y),0));
    assert.ok(Math.abs(lengths.at(-1)-profile.length)<1e-8,'denser slow steps cannot truncate the tail through the point cap');
    assert.ok(points.length<=30,'history density follows world time rather than real physics ticks');
    const before=structuredClone(points),g=graphics();
    for(let frame=0;frame<4;frame++)trails.draw(g,[body],0x123456,{unit:10});
    assert.deepEqual(points,before,'drawing does not update the head or consume history');
  }
  assert.ok(Math.max(...lengths)-Math.min(...lengths)<1e-8);
});

test('a reversal between world-time samples pins the previous live head and stays inside the wall',()=>{
  const trails=new CometTrails(),body={...ball(),x:97,y:40},dt=.3/120;
  trails.step([body],0,{unit:10});advance(trails,body,2,dt);
  const corner={x:body.x,y:body.y};body.vx=-400;advance(trails,body,1,dt);
  const points=trails.entries.get(body).points;
  assert.ok(points.some(point=>point.x===corner.x&&point.y===corner.y),'a mutable head cannot erase the last position before a bounce');
  assert.equal(points.at(-1).x,body.x);
  const bounds={left:0,top:0,right:109,bottom:100};
  for(const segment of cometRibbon(points,{...cometProfile(400,10,10),bounds})){
    for(const point of segment.outer)assert.ok(point.x>=bounds.left&&point.x<=bounds.right&&point.y>=bounds.top&&point.y<=bounds.bottom);
  }
});

test('small slow steps never renew a frozen or stationary live head',()=>{
  for(const frozen of [true,false]){
    const trails=new CometTrails(),body=ball(),dt=.3/120;
    advance(trails,body,83,dt);
    assert.ok(trails.entries.get(body).liveHead,'the fixture stops between retained samples');
    body.feedbackFreeze=frozen?1:0;
    for(let frame=0;frame<100;frame++)trails.step([body],dt,{unit:10});
    assert.equal(trails.entries.get(body).points.length,0);
    assert.equal(trails.entries.get(body).liveHead,null);
  }
});
