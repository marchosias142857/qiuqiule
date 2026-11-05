import test from 'node:test';
import assert from 'node:assert/strict';
import {CometWorkspace,cometRibbon,cometBands} from '../dist/comet-trail.js';

const path=(count,dx=0)=>Array.from({length:count},(_,i)=>({x:i*4+dx,y:Math.sin(i*.4)*12,age:(count-1-i)*.001}));
const options={length:10000,width:5};
const owned=points=>cometBands(cometRibbon(points,options));

test('shrinking and regrowing a drawn trail reuses point storage while independent snapshots keep their original coordinates',()=>{
  const scratch=new CometWorkspace(),points=path(48);
  const snapshot=owned(points),expected=structuredClone(snapshot);
  const long=scratch.bands(points,options);
  assert.deepEqual(long,expected);
  const originalTip=long[0].vertices.at(-1);
  const short=scratch.bands(path(4,300),options);
  assert.equal(short,long);
  assert.deepEqual(short,owned(path(4,300)));
  assert.deepEqual(scratch.bands([],options),[]);
  const renewed=scratch.bands(path(48,600),options);
  assert.equal(renewed[0].vertices.at(-1),originalTip);
  assert.deepEqual(renewed,owned(path(48,600)));
  assert.deepEqual(snapshot,expected);
});

test('an oversized trail is rendered in full without retaining or replacing a normal trail workspace',()=>{
  const scratch=new CometWorkspace(),ordinary=path(96),extra=path(120);
  const regular=scratch.bands(ordinary,options),length=regular[0].vertices.length;
  const extended=scratch.bands(extra,options);
  assert.ok(extended[0].vertices.length>length);
  assert.deepEqual(extended,owned(extra));
  assert.equal(regular[0].vertices.length,length);
  assert.equal(scratch.bands(ordinary,options),regular);
  assert.deepEqual(extended,owned(extra));
});
