import test from 'node:test';
import assert from 'node:assert/strict';
import {displayMetrics,pointerPosition} from '../dist/display.js';

test('Retina mobile canvas uses native high-density pixels without enlarging world units',()=>{
  const v=displayMetrics(390,844,3);assert.equal(v.width,390);assert.equal(v.height,844);
  assert.equal(v.bufferWidth,1170);assert.equal(v.bufferHeight,2532);assert.equal(v.scale,3);
  const point=pointerPosition(210,430,{left:15,top:8,width:390,height:844},v);
  assert.deepEqual(point,{x:195,y:422});
});
test('desktop supersampling and orientation changes preserve pointer scale',()=>{
  const desktop=displayMetrics(1363,936,1);assert.equal(desktop.bufferWidth,2726);assert.equal(desktop.bufferHeight,1872);
  const landscape=displayMetrics(844,390,3);assert.equal(landscape.bufferWidth,2532);assert.equal(landscape.bufferHeight,1170);
  assert.deepEqual(pointerPosition(422,195,{left:0,top:0,width:844,height:390},landscape),{x:422,y:195});
});
test('large screens bound render memory while preserving sharpness and geometry',()=>{
  const v=displayMetrics(3840,2160,3);assert.ok(v.bufferWidth*v.bufferHeight<12_010_000);assert.ok(v.bufferWidth<=8192);
  assert.equal(v.width,3840);assert.equal(v.height,2160);
});
