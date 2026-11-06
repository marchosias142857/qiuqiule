import test from 'node:test';
import assert from 'node:assert/strict';
import {UPGRADE_DEFINITIONS} from '../dist/upgrades.js';
import {upgradePreviewGeometry,drawUpgradeBall,drawAuxiliaryBall,upgradeAppearance,upgradeIconMarkup} from '../dist/upgrade-render.js';
import {transformSkinPoint} from '../dist/skin-render.js';
import {skinContour} from '../dist/skins.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function recorder(){
  let points=[],style={};const shapes=[];
  return {shapes,fillStyle(color,alpha){style={color,alpha};},lineStyle(width,color,alpha){style={width,color,alpha};},
    beginPath(){points=[];},moveTo(x,y){points.push({x,y});},lineTo(x,y){points.push({x,y});},closePath(){},
    fillPath(){shapes.push({type:'fill',...style,points});},strokePath(){shapes.push({type:'stroke',...style,points});}};
}

test('all current upgrade previews use distinct text-free diagrams entirely inside their reward ball',()=>{
  const signatures=new Set();
  for(const upgrade of UPGRADE_DEFINITIONS){
    for(const time of [0,.4,1,2.4])for(const shape of upgradePreviewGeometry(upgrade.id,time)){
      assert.ok(['dot','ring','line'].includes(shape.type));
      if(shape.points)for(const point of shape.points)assert.ok(Math.hypot(point.x,point.y)<=.8);
      else assert.ok(Math.hypot(shape.x,shape.y)+shape.r<=.8,upgrade.id);
    }
    signatures.add(JSON.stringify(upgradePreviewGeometry(upgrade.id,0)));
  }
  assert.equal(signatures.size,UPGRADE_DEFINITIONS.length);
});

test('reward categories share the original collision radius and enter together with distinct colors and interior polygons',()=>{
  const colors=new Set();
  for(const [kind,sides] of [['regular',3],['special',4],['risk',5]]){
    for(const born of [0,.001,.15,.5,1]){
      const g=recorder(),choice={id:'energy',x:50,y:80,r:30,born,kind},before=structuredClone(choice);
      drawUpgradeBall(g,choice,0xf4f3eb,{alpha:.6});
      assert.deepEqual(choice,before);
      const appear=1-(1-born)**3,r=30*appear;
      if(r<1){assert.equal(g.shapes.length,0);continue;}
      assert.equal(g.shapes.length,2);assert.ok(g.shapes.every(s=>s.type==='fill'));
      const [body,mark]=g.shapes;
      colors.add(body.color);near(body.alpha,.6*appear);near(mark.alpha,body.alpha);
      near(body.points[0].x,choice.x+r);assert.equal(mark.points.length,sides);
      assert.notEqual(mark.color,body.color);
      for(const point of mark.points)assert.ok(Math.hypot(point.x-choice.x,point.y-choice.y)<r*.4);
      const edges=mark.points.map((p,i)=>Math.hypot(p.x-mark.points[(i+1)%sides].x,p.y-mark.points[(i+1)%sides].y));
      edges.forEach(edge=>near(edge,edges[0]));
    }
  }
  assert.equal(colors.size,3);
});

test('reward guide and balls use the same category colors, including a background close to the default ball color',()=>{
  for(const kind of ['regular','special','risk']){
    const basic=upgradeAppearance(kind);
    for(const background of [0xffffff,0, basic.color]){
      const appearance=upgradeAppearance({kind},background),g=recorder();
      drawUpgradeBall(g,{kind,x:0,y:0,r:20,born:1},background);
      assert.equal(g.shapes[0].color,appearance.color);assert.equal(g.shapes[1].color,appearance.ink);
      if(background===basic.color)assert.notEqual(appearance.color,background);
      const markup=upgradeIconMarkup(kind,background);
      assert.match(markup,new RegExp('fill="#'+appearance.color.toString(16).padStart(6,'0')+'"'));
      assert.equal((markup.match(/<circle/g)||[]).length,1);assert.equal((markup.match(/<polygon/g)||[]).length,1);
      assert.equal(markup.match(/points="([^"]+)"/)[1].split(' ').length,appearance.sides);
    }
  }
});

test('the gambler preview shows two successive groups of three offers',()=>{
  const geometry=upgradePreviewGeometry('gambler'),player=geometry.find(shape=>shape.type==='dot'),offers=geometry.filter(shape=>shape.type==='ring');
  assert.equal(offers.length,6);assert.equal(offers.filter(offer=>offer.y<player.y).length,3);assert.equal(offers.filter(offer=>offer.y>player.y).length,3);
  for(const offer of offers)assert.ok(Math.hypot(offer.x-player.x,offer.y-player.y)>offer.r+player.r);
  for(let i=0;i<offers.length;i++)for(let j=i+1;j<offers.length;j++)assert.ok(Math.hypot(offers[i].x-offers[j].x,offers[i].y-offers[j].y)>offers[i].r+offers[j].r);
});

test('preview adds small balls and dotted trajectories and becomes static under reduced motion',()=>{
  const choice={id:'split',x:80,y:120,r:36,born:1,rings:1},plain=recorder(),preview=recorder();
  drawUpgradeBall(plain,choice,0xf4f3eb);drawUpgradeBall(preview,choice,0xf4f3eb,{preview:true,time:.7});
  assert.ok(preview.shapes.length>plain.shapes.length+10);
  for(const shape of preview.shapes.slice(plain.shapes.length))for(const p of shape.points)assert.ok(Math.hypot(p.x-choice.x,p.y-choice.y)<choice.r);
  const first=recorder(),later=recorder();
  drawUpgradeBall(first,{...choice,id:'energy'},0xf4f3eb,{preview:true,reducedMotion:true,time:0});
  drawUpgradeBall(later,{...choice,id:'energy'},0xf4f3eb,{preview:true,reducedMotion:true,time:20});
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
