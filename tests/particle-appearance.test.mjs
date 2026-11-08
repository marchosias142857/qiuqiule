import test from 'node:test';
import assert from 'node:assert/strict';
import {PARTICLE_SHAPES,PARTICLE_BASE_ALPHA,particleAppearance,particleVisualStyle,drawParticleAppearance,
  drawParticleAppearanceCanvas} from '../dist/particle-appearance.js';

const near=(actual,expected,epsilon=1e-7)=>assert.ok(Math.abs(actual-expected)<=epsilon,`${actual} != ${expected}`);

test('seven supported contours remain bounded, area-centered and cached across colors',()=>{
  assert.deepEqual(PARTICLE_SHAPES.map(item=>item.id),['triangle','square','diamond','snowflake','sun','moon','star']);
  for(const{id}of PARTICLE_SHAPES){
    const style=particleVisualStyle(id),points=style.points;
    assert.ok(points instanceof Float32Array);assert.ok(points.length>=6&&points.length<=96);
    assert.ok(style.area>.6);assert.ok(style.extent<=1.3);assert.equal(style.orientation,'free');
    let area=0,xMoment=0,yMoment=0;
    for(let i=0;i<points.length;i+=2){
      const j=(i+2)%points.length,x=points[i],y=points[i+1],nx=points[j],ny=points[j+1],cross=x*ny-nx*y;
      area+=cross;xMoment+=(x+nx)*cross;yMoment+=(y+ny)*cross;
      assert.ok(Math.hypot(x,y)<=style.extent+1e-7);
    }
    near(xMoment/(3*area),0);near(yMoment/(3*area),0);
    assert.strictEqual(particleVisualStyle(id),style);assert.strictEqual(particleAppearance(id),particleAppearance(id));
  }
  assert.strictEqual(particleVisualStyle('unsupported'),particleVisualStyle('star'));
});

test('circle and filled angular shapes retain the approved optical compensation',()=>{
  const star=particleVisualStyle('star'),moon=particleVisualStyle('moon'),sun=particleVisualStyle('sun');
  near(star.area,1.05);near(moon.area,1.143179003855261);near(sun.area,3.0614673453665446);
  assert.equal(star.alphaScale,1);assert.equal(moon.alphaScale,1);assert.equal(sun.alphaScale,.9);
  assert.ok(moon.extent>1.25,'moon needs its true centered silhouette for wall clipping');
  for(const{id}of PARTICLE_SHAPES){const style=particleVisualStyle(id);near(style.sizeScale,(1/style.area)**.3);}
});

test('the simplified snowflake has six rounded spokes without forked side branches',()=>{
  const {points,extent}=particleVisualStyle('snowflake'),count=points.length/2;
  const c=.5,s=Math.sqrt(3)/2;
  for(let i=0;i<count;i++){
    const x=points[i*2],y=points[i*2+1];
    assert.ok(Array.from({length:count},(_,j)=>Math.hypot(points[j*2]-(x*c-y*s),points[j*2+1]-(x*s+y*c))).some(distance=>distance<1e-6));
  }
  let outerPeaks=0;
  for(let i=0;i<count;i++){
    const r=Math.hypot(points[i*2],points[i*2+1]);
    const before=(i+count-1)%count,after=(i+1)%count;
    if(r>Math.hypot(points[before*2],points[before*2+1])&&r>Math.hypot(points[after*2],points[after*2+1]))outerPeaks++;
  }
  assert.equal(outerPeaks,6,'each arm has one broad rounded tip, with no branch peaks');
  assert.ok(extent>1&&extent<1.1);
});

function graphics(){
  const calls=[];return {calls,fillStyle(...args){calls.push(['fillStyle',...args]);},beginPath(){calls.push(['beginPath']);},
    moveTo(...args){calls.push(['moveTo',...args]);},lineTo(...args){calls.push(['lineTo',...args]);},
    closePath(){calls.push(['closePath']);},fillPath(){calls.push(['fillPath']);},
    strokePath(){assert.fail('particles cannot have a stroke');}};
}
test('Phaser draws one compensated solid polygon without mutating cached geometry',()=>{
  for(const{id}of PARTICLE_SHAPES){
    const g=graphics(),style=particleVisualStyle(id),before=Array.from(style.points),rotation=.47,radius=9;
    drawParticleAppearance(g,{shape:id,x:15,y:23,radius,color:'#123456',alpha:.6,rotation});
    const fills=g.calls.filter(call=>call[0]==='fillStyle');assert.equal(fills.length,1);
    assert.equal(fills[0][1],0x123456);near(fills[0][2],.6*PARTICLE_BASE_ALPHA*style.alphaScale);
    const vertices=g.calls.filter(call=>call[0]==='moveTo'||call[0]==='lineTo');assert.equal(vertices.length,before.length/2);
    const scale=radius*style.sizeScale,c=Math.cos(rotation),s=Math.sin(rotation);
    vertices.forEach((value,i)=>{near(value[1],15+(before[i*2]*c-before[i*2+1]*s)*scale);near(value[2],23+(before[i*2]*s+before[i*2+1]*c)*scale);});
    assert.equal(g.calls.filter(call=>call[0]==='fillPath').length,1);assert.deepEqual(Array.from(style.points),before);
  }
  for(const options of [{radius:0},{radius:NaN},{radius:2,alpha:0},{radius:2,x:Infinity}]){
    const g=graphics();drawParticleAppearance(g,options);assert.deepEqual(g.calls,[]);
  }
});

test('Canvas showroom renderer preserves caller opacity and draws the same polygon',()=>{
  const stack=[],calls=[],ctx={globalAlpha:.8,fillStyle:'#abcdef',
    save(){stack.push([this.globalAlpha,this.fillStyle]);},restore(){[this.globalAlpha,this.fillStyle]=stack.pop();},
    translate(...args){calls.push(['translate',...args]);},rotate(...args){calls.push(['rotate',...args]);},
    beginPath(){},moveTo(...args){calls.push(['moveTo',...args]);},lineTo(...args){calls.push(['lineTo',...args]);},
    closePath(){},fill(){calls.push(['fill',this.fillStyle,this.globalAlpha]);}};
  drawParticleAppearanceCanvas(ctx,{shape:'sun',x:5,y:8,radius:10,color:0x123456,alpha:.5,rotation:.7});
  assert.deepEqual(calls[0],['translate',5,8]);assert.deepEqual(calls[1],['rotate',.7]);
  assert.deepEqual(calls.at(-1),['fill','#123456',.8*.5*.42*.9]);
  assert.equal(calls.filter(call=>call[0]==='moveTo'||call[0]==='lineTo').length,16);
  near(ctx.globalAlpha,.8);assert.equal(ctx.fillStyle,'#abcdef');
});
