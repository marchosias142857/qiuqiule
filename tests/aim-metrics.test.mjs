import test from 'node:test';
import assert from 'node:assert/strict';
import {AimGesture} from '../dist/aim.js';
import {normalizeAimMetrics,recordAimDuration,aimMetricsReport,aimHoldDuration,AIM_SAMPLE_LIMIT,AIM_CALIBRATION_SAMPLES} from '../dist/aim-metrics.js';

const recordMany=(samples,raw=null)=>samples.reduce((state,seconds)=>recordAimDuration(state,seconds),raw);

test('empty, malformed and legacy local samples repair to a finite bounded report',()=>{
  for(const raw of [null,undefined,'broken','null',[],0,{samples:null},{samples:[NaN,Infinity,-1,10,'1',null]}]){
    assert.deepEqual(normalizeAimMetrics(raw),{version:1,completedCount:0,samples:[]});
    assert.equal(aimHoldDuration(raw),1.2);
    assert.equal(aimMetricsReport(raw).medianSeconds,null);
  }
  const source={completedCount:2.8,samples:[0,.5,1.7]},original=JSON.stringify(source);
  assert.deepEqual(normalizeAimMetrics(JSON.stringify(source)),{version:1,completedCount:3,samples:[0,.5,1.7]});
  assert.equal(JSON.stringify(source),original,'repair never mutates storage input');
});

test('calibration requires twenty samples and a median strictly above nine tenths',()=>{
  let state=recordMany(Array(AIM_CALIBRATION_SAMPLES-1).fill(1));
  assert.equal(aimHoldDuration(state),1.2);
  state=recordAimDuration(state,1);
  assert.equal(aimHoldDuration(state),.9);
  assert.equal(aimMetricsReport(state).medianSeconds,1);
  assert.equal(aimHoldDuration(recordMany(Array(20).fill(.9))),1.2);
  assert.equal(aimHoldDuration(recordMany(Array(20).fill(.900001))),.9);
  const even=recordMany([...Array(10).fill(.6),...Array(10).fill(1.4)]);
  assert.equal(aimMetricsReport(even).medianSeconds,1);
  assert.equal(aimHoldDuration(even),.9);
});

test('only the latest sixty valid samples determine a later run and never the current gesture',()=>{
  let state=recordMany(Array(AIM_SAMPLE_LIMIT).fill(1.2));
  const current=new AimGesture({holdDuration:aimHoldDuration(state)});current.move(8,0,0);
  state=recordMany(Array(AIM_SAMPLE_LIMIT).fill(.2),state);
  const report=aimMetricsReport(state);
  assert.equal(report.completedCount,120);assert.equal(report.sampleCount,60);
  assert.equal(report.samples.length,60);assert.equal(report.medianSeconds,.2);
  assert.equal(report.nextHoldSeconds,1.2);
  assert.equal(current.holdDuration,.9,'calibration cannot mutate an existing gesture');
  assert.ok(Math.abs(current.sample(1.15).scale-.65)<1e-9);
  assert.equal(new AimGesture({holdDuration:report.nextHoldSeconds}).holdDuration,1.2);
});

test('duration collection rejects invalid values, keeps quick flicks and survives JSON export',()=>{
  const state=recordMany([0,.2,.8,1.4,1.7]);
  for(const value of [undefined,null,'0.5',-1,2,NaN,Infinity])assert.deepEqual(recordAimDuration(state,value),state);
  const exported=JSON.parse(JSON.stringify(aimMetricsReport(state)));
  assert.equal(exported.sampleCount,5);assert.equal(exported.completedCount,5);
  assert.equal(exported.medianSeconds,.8);assert.equal(exported.recoverySeconds,.5);
  assert.equal(exported.nextHoldSeconds,1.2);assert.equal(exported.samples[0],0);
  exported.samples.push(1.1);
  assert.equal(state.samples.length,5,'export owns a separate sample array');
});

test('oversized local history and lifetime counts stay bounded',()=>{
  const repaired=normalizeAimMetrics({completedCount:Infinity,samples:[...Array(1000).fill(.1),...Array(60).fill(.8)]});
  assert.equal(repaired.samples.length,60);assert.ok(repaired.samples.every(value=>value===.8));
  assert.equal(repaired.completedCount,60);
  const saturated=recordAimDuration({completedCount:Number.MAX_VALUE,samples:[]},.5);
  assert.equal(saturated.completedCount,Number.MAX_SAFE_INTEGER);
  assert.equal(JSON.stringify(saturated).includes('null'),false);
});
