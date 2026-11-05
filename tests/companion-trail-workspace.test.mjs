import test from 'node:test';
import assert from 'node:assert/strict';
import {CompanionTrails,companionGeometry} from '../dist/companions.js';

test('high-frequency history rollover preserves handed-out positions and the exact 96 newest samples',()=>{
  const history=new CompanionTrails(),early=history.sample('sun-1:0',{x:0,y:0},20,0);
  let current;
  // An exact binary interval triggers the 96 point cap before the age cutoff.
  for(let tick=1;tick<=350;tick++)current=history.sample('sun-1:0',{x:tick,y:-tick},20,tick/256);
  assert.deepEqual(early,[{x:0,y:0,age:0}]);
  assert.deepEqual(current,Array.from({length:96},(_,i)=>({x:255+i,y:-255-i,age:(95-i)/256})));
  current[95].x=-999;
  assert.equal(history.sample('sun-1:0',{x:350,y:-350},20,350/256).at(-1).x,350);
});

test('saved satellite geometry owns every tail after another shape, layer, and world use the workspaces',()=>{
  const history=new CompanionTrails(),options={trails:history,inPlay:true,unit:20,speed:800};
  let original;
  for(let frame=0;frame<=22;frame++){
    original=companionGeometry('moon-3',{x:80+frame*6,y:90-frame,r:20},frame/60,options);
  }
  assert.ok(original.satellites.every(satellite=>satellite.tail.length>0));
  const saved=structuredClone(original);
  for(let frame=23;frame<=38;frame++){
    const pose={x:212-(frame-22)*12,y:68+frame-22,r:20};
    companionGeometry('star-2',pose,frame/60,options);
    companionGeometry('moon-3',pose,frame/60,{...options,alpha:.4});
  }
  history.clear();
  companionGeometry('sun-1',{x:5,y:9,r:33},0);
  assert.deepEqual(original,saved);
});
