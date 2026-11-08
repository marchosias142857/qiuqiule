import test from 'node:test';
import assert from 'node:assert/strict';
import {projectSkinContour,transformSkinPoint} from '../dist/skin-render.js';
import {skinContour} from '../dist/skins.js';

test('borrowed contour buffers preserve exact projection and point identities across changing poses',()=>{
  const contour=skinContour(0),before=structuredClone(contour),output=[];
  const first=projectSkinContour(contour,{r:20},output),identities=first.slice();
  for(let frame=0;frame<120;frame++){
    const pose={x:frame*1.3,y:180-frame*.7,r:14+frame%21,roll:frame*.13,
      squash:Math.sin(frame)*.2,deformAngle:frame*.03,pullAmount:frame%11/10,
      flightStretch:frame%7*.02,flightAngle:frame*.07};
    assert.equal(projectSkinContour(contour,pose,output),output);
    assert.deepEqual(output,contour.map(point=>transformSkinPoint(point,pose)));
    for(let i=0;i<output.length;i++)assert.equal(output[i],identities[i]);
  }
  assert.deepEqual(contour,before,'render scratch never modifies source geometry');
});

test('standalone projections remain owned snapshots, and independent body buffers cannot alias',()=>{
  const contour=skinContour(0),one=[],two=[];
  const snapshot=projectSkinContour(contour,{x:10,r:17}),before=structuredClone(snapshot);
  projectSkinContour(contour,{x:10,r:17},one);
  projectSkinContour(contour,{x:80,r:25},two);
  for(let i=0;i<contour.length;i++){
    assert.notEqual(one[i],two[i]);assert.notEqual(snapshot[i],one[i]);
  }
  projectSkinContour(contour,{x:1000,pullAmount:1,r:27},one);
  assert.deepEqual(snapshot,before);
  assert.deepEqual(two,projectSkinContour(contour,{x:80,r:25}));
  projectSkinContour(contour.slice(0,32),{r:10},one);
  assert.equal(one.length,32);
  projectSkinContour(contour,{r:10},one);
  assert.equal(one.length,contour.length);assert.ok(one.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
});
