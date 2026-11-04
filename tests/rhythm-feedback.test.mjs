import test from 'node:test';
import assert from 'node:assert/strict';
import {clearingTimeScale,clearingZoom,pressureStyle,PressureWarning,PRESSURE_WARNING_COLOR,PRESSURE_RELEASE_DURATION,blendRgb,injuredEnemyScale,pressureLook} from '../dist/rhythm-feedback.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('clear slowdown holds for .35 real seconds and recovers linearly over .6 seconds',()=>{
  for(const time of [0,.1,.35])near(clearingTimeScale(time,{juice:1}),.3);
  near(clearingTimeScale(.65,{juice:1}),.65);near(clearingTimeScale(.95,{juice:1}),1);
  near(clearingTimeScale(4,{juice:1}),1);near(clearingTimeScale(0,{juice:.6}),.58);
  for(const time of [0,.2,.6,1]){
    assert.equal(clearingTimeScale(time,{juice:0}),1);
    assert.equal(clearingTimeScale(time,{juice:1,reducedMotion:true}),1);
  }
});

test('clear camera push stays within four percent and returns exactly to rest',()=>{
  near(clearingZoom(0,1),1);near(clearingZoom(.08,1),1.04);near(clearingZoom(.35,1),1.04);
  near(clearingZoom(.95,1),1);near(clearingZoom(.2,.6),1.024);
  for(let age=0;age<2;age+=.005){
    assert.ok(clearingZoom(age,1)>=1&&clearingZoom(age,1)<=1.04);
    assert.equal(clearingZoom(age,0),1);
  }
});

test('pressure starts at 24 of 28 with a separate red translucent overlay and moderate widths',()=>{
  assert.deepEqual(pressureStyle(23,0),{alpha:0,width:1,frequency:0,warning:false});
  assert.equal(pressureStyle(24,0).warning,true);
  assert.equal(pressureStyle(24,0).frequency,.8);assert.equal(pressureStyle(25,0).frequency,.8);
  assert.equal(pressureStyle(26,0).frequency,1.2);assert.equal(PRESSURE_WARNING_COLOR,0xd94f4f);
  for(const count of [24,26,28,40])for(const time of [0,.1,.2,.5]){
    const style=pressureStyle(count,time);
    assert.ok(style.alpha>0&&style.alpha<=.54);
    assert.ok(style.width>=2.2&&style.width<=3.2);
    assert.deepEqual(Object.keys(style).sort(),['alpha','frequency','warning','width']);
  }
  assert.equal(pressureStyle(NaN,0).alpha,0);assert.equal(pressureStyle(Infinity,0).alpha,0);
});

test('reduced motion and zero juice retain a static red capacity warning',()=>{
  for(const options of [{juice:0},{juice:1,reducedMotion:true}]){
    const style=pressureStyle(28,0,options);
    assert.deepEqual(pressureStyle(28,.371,options),style);
    assert.equal(style.frequency,0);assert.equal(style.alpha,.54);assert.equal(style.width,3.2);
  }
  assert.equal(blendRgb(0,0xffffff,0),0);assert.equal(blendRgb(0,0xffffff,1),0xffffff);
  assert.equal(blendRgb(0,0xffffff,.4),0x666666);
});

test('pressure entry is gradual, frequency changes preserve phase, and every breath phase releases continuously',()=>{
  for(const age of [.08,.25,.45,.7,1,1.3]){
    const warning=new PressureWarning();warning.step(26,0);assert.equal(warning.alpha,0);
    for(let t=0;t<age;t+=1/120)warning.step(26,1/120);
    const alpha=warning.alpha,width=warning.width,phase=warning.phase;
    assert.ok(alpha>0&&width>1);
    warning.step(24,0);near(warning.phase,phase);near(warning.alpha,alpha);
    warning.step(0,0);near(warning.alpha,alpha);near(warning.width,width);
    warning.step(0,PRESSURE_RELEASE_DURATION/2);near(warning.alpha,alpha/2);near(warning.width,1+(width-1)/2);
    warning.step(0,PRESSURE_RELEASE_DURATION/2);assert.equal(warning.alpha,0);assert.equal(warning.width,1);
    warning.step(0,10);assert.equal(warning.alpha,0);
  }
});

test('pressure exit is monotone and reentering during it preserves the last visible value',()=>{
  const warning=new PressureWarning();warning.step(28,.4);warning.step(0,0);
  let previous=warning.alpha;
  for(let i=0;i<12;i++){warning.step(0,1/60);assert.ok(warning.alpha<=previous&&warning.alpha>0);previous=warning.alpha;}
  const width=warning.width;warning.step(28,0);near(warning.alpha,previous);near(warning.width,width);
  warning.step(28,.3);assert.ok(warning.alpha>previous);
  warning.step(0,0);const start=warning.alpha;
  warning.step(0,NaN);near(warning.alpha,start);warning.step(0,-1);near(warning.alpha,start);
});

test('injury reduces drawing radius only and excludes campaign, player and Boss',()=>{
  const body=Object.freeze({r:20,hp:50,maxHp:100});
  near(injuredEnemyScale(body),.91);assert.equal(body.r,20);
  near(injuredEnemyScale({...body,hp:0}),.82);near(injuredEnemyScale({...body,hp:120}),1);
  assert.equal(injuredEnemyScale(body,false),1);
  assert.equal(injuredEnemyScale({...body,isBoss:true}),1);assert.equal(injuredEnemyScale({...body,isPlayer:true}),1);
  assert.equal(injuredEnemyScale({...body,maxHp:Infinity}),1);
});

test('pressure glance targets the closest living ball once per 1.5 seconds',()=>{
  const player={x:0,y:0},enemies=Array.from({length:24},(_,i)=>({x:20+i,y:0,hp:1}));
  enemies[5]={x:0,y:10,hp:1};
  const gaze=pressureLook(player,enemies,.18);near(gaze.x,0);near(gaze.y,.13);
  const again=pressureLook(player,enemies,1.68);near(again.x,gaze.x);near(again.y,gaze.y);
  assert.equal(pressureLook(player,enemies,.5),null);
  assert.equal(pressureLook(player,enemies.slice(0,23),.18),null);
  enemies[5].hp=0;assert.equal(pressureLook(player,enemies,.18),null);
});
