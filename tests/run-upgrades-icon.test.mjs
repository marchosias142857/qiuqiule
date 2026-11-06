import test from 'node:test';
import assert from 'node:assert/strict';
import {iconGeometry,iconMarkup} from '../dist/icons.js';

test('the run-upgrades control has three separate, vertically stacked upward chevrons',()=>{
  const {fills,strokes,width}=iconGeometry('upgrades');assert.equal(fills.length,0);assert.equal(strokes.length,3);
  let bottom=-Infinity;
  for(const points of strokes){
    assert.equal(points.length,3);assert.equal(points[0][1],points[2][1]);assert.ok(points[1][1]<points[0][1]);
    assert.equal(points[1][0],0);assert.equal(points[0][0],-points[2][0]);assert.ok(points[1][1]>bottom);bottom=points[0][1];
    assert.ok(points.every(([x,y])=>Math.hypot(x,y)+width/2<1));
  }
  const markup=iconMarkup('upgrades');assert.equal((markup.match(/<path /g)||[]).length,3);assert.match(markup,/stroke-linecap="round"/);
});
