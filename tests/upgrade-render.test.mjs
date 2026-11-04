import test from 'node:test';
import assert from 'node:assert/strict';
import {UPGRADE_DEFINITIONS} from '../dist/upgrades.js';
import {upgradePreviewGeometry,drawUpgradeBall,drawAuxiliaryBall} from '../dist/upgrade-render.js';
import {transformSkinPoint} from '../dist/skin-render.js';
import {skinContour} from '../dist/skins.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function recorder(){
  let points=[],style={};const shapes=[];
  return {shapes,fillStyle(color,alpha){style={color,alpha};},lineStyle(width,color,alpha){style={width,color,alpha};},
    beginPath(){points=[];},moveTo(x,y){points.push({x,y});},lineTo(x,y){points.push({x,y});},closePath(){},
    fillPath(){shapes.push({type:'fill',...style,points});},strokePath(){shapes.push({type:'stroke',...style,points});}};
}

test('all eighteen previews use distinct text-free diagrams entirely inside their reward ball',()=>{
  const signatures=new Set();
  for(const upgrade of UPGRADE_DEFINITIONS){
    for(const time of [0,.4,1,2.4])for(const shape of upgradePreviewGeometry(upgrade.id,time)){
      assert.ok(['dot','ring','line'].includes(shape.type));
      if(shape.points)for(const point of shape.points)assert.ok(Math.hypot(point.x,point.y)<=.8);
      else assert.ok(Math.hypot(shape.x,shape.y)+shape.r<=.8,upgrade.id);
    }
    signatures.add(JSON.stringify(upgradePreviewGeometry(upgrade.id,0)));
  }
  assert.equal(signatures.size,18);
});

test('reward rarity is exactly zero, one or two theme-colored outline rings with no text or extra colors',()=>{
  for(const rings of [0,1,2]){
    const g=recorder(),choice={id:'energy',x:50,y:80,r:30,born:.5,rings};
    drawUpgradeBall(g,choice,0xc4dc86);
    assert.equal(g.shapes.length,1+rings);assert.equal(g.shapes[0].type,'fill');
    const r=30*(1-.5**3);near(g.shapes[0].points[0].x,50+r);
    g.shapes.forEach(shape=>assert.equal(shape.color,0xc4dc86));
    g.shapes.slice(1).forEach((shape,i)=>{assert.equal(shape.type,'stroke');near(shape.width,1);near(shape.points[0].x,50+r*(1.14+i*.13));});
  }
});

test('the gambler preview places three offers above and two below its central player',()=>{
  const geometry=upgradePreviewGeometry('gambler'),player=geometry.find(shape=>shape.type==='dot'),offers=geometry.filter(shape=>shape.type==='ring');
  assert.equal(offers.length,5);assert.equal(offers.filter(offer=>offer.y<player.y).length,3);assert.equal(offers.filter(offer=>offer.y>player.y).length,2);
  for(const offer of offers)assert.ok(Math.hypot(offer.x-player.x,offer.y-player.y)>offer.r+player.r);
  for(let i=0;i<offers.length;i++)for(let j=i+1;j<offers.length;j++)assert.ok(Math.hypot(offers[i].x-offers[j].x,offers[i].y-offers[j].y)>offers[i].r+offers[j].r);
});

test('preview adds small balls and dotted trajectories and becomes static under reduced motion',()=>{
  const choice={id:'split',x:80,y:120,r:36,born:1,rings:1},plain=recorder(),preview=recorder();
  drawUpgradeBall(plain,choice,0xc4dc86);drawUpgradeBall(preview,choice,0xc4dc86,{preview:true,time:.7});
  assert.ok(preview.shapes.length>plain.shapes.length+10);
  for(const shape of preview.shapes.slice(plain.shapes.length))for(const p of shape.points)assert.ok(Math.hypot(p.x-choice.x,p.y-choice.y)<choice.r);
  const first=recorder(),later=recorder();
  drawUpgradeBall(first,{...choice,id:'energy'},0xc4dc86,{preview:true,reducedMotion:true,time:0});
  drawUpgradeBall(later,{...choice,id:'energy'},0xc4dc86,{preview:true,reducedMotion:true,time:20});
  assert.deepEqual(first.shapes,later.shapes);
});

test('auxiliary balls render one player-colored contour without eyes and preserve the physics radius',()=>{
  const b={x:20,y:40,r:14,born:1,angle:.4,squash:.2,isPlayer:true,isAuxiliary:true},before=structuredClone(b),g=recorder();
  drawAuxiliaryBall(g,b,0x252720,.8);assert.equal(g.shapes.length,1);assert.equal(g.shapes[0].type,'fill');
  assert.equal(g.shapes[0].color,0x252720);near(g.shapes[0].alpha,.8);assert.deepEqual(b,before);
  const expected=transformSkinPoint(skinContour(0)[0],{...b,roll:0,deformAngle:b.angle});
  near(g.shapes[0].points[0].x,expected.x);near(g.shapes[0].points[0].y,expected.y);
});

test('auxiliary helper accepts the current player polygon and rounder variant with the complete body pose',()=>{
  const body={x:110,y:160,r:16,born:1,angle:.3,roll:1.1,squash:.24,isPlayer:true,isAuxiliary:true};
  for(const selection of [6,15,{sides:7,variant:true}]){
    const contour=skinContour(selection),g=recorder();
    const pose={flightStretch:.1,flightAngle:.7};
    drawAuxiliaryBall(g,body,0x4499cc,.6,{contour,pose});
    assert.equal(g.shapes.length,1,'no eye shapes or extra rings are added');
    assert.equal(g.shapes[0].points.length,contour.length);
    for(let i=0;i<contour.length;i++){
      const expected=transformSkinPoint(contour[i],{...body,deformAngle:body.angle,...pose});
      near(g.shapes[0].points[i].x,expected.x);near(g.shapes[0].points[i].y,expected.y);
    }
  }
});
