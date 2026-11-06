import test from 'node:test';
import assert from 'node:assert/strict';
import {unlockPose,unlockLeavePose,unlockSwitchPose,unlockTitleMarkup,createUnlockPanel,UNLOCK_ENTER_DURATION,UNLOCK_LEAVE_DURATION,UNLOCK_SWITCH_DURATION} from '../dist/skin-unlock.js';

const from={x:62,y:440,r:19,roll:.25,squash:.12,lookX:.1,visualPull:{amount:.6,angle:.3},visualEyeMix:1};
const to={x:195,y:440,r:48};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('skin reveal preserves the starting ball and moves concurrently with the popup',()=>{
  const first=unlockPose({elapsed:0,from,to});
  for(const key of ['x','y','r','roll','squash','lookX'])close(first.pose[key],from[key]);
  assert.equal(first.panelAlpha,0);assert.equal(first.titleAlpha,0);assert.equal(first.glowAlpha,0);assert.equal(first.morph,0);
  const mid=unlockPose({elapsed:.24,from,to});
  assert.ok(mid.pose.x>from.x&&mid.pose.x<to.x);
  assert.ok(mid.panelAlpha>0&&mid.panelAlpha<1);
  assert.equal(mid.titleAlpha,0);assert.equal(mid.glowAlpha,0);assert.equal(mid.ready,false);
});

test('skin reveal completes three turns, rounds out its elastic pop, and holds until input',()=>{
  let largest=0;
  for(let elapsed=0;elapsed<UNLOCK_ENTER_DURATION;elapsed+=1/120){
    const state=unlockPose({elapsed,from,to});largest=Math.max(largest,state.pose.r);
    for(const key of ['panelAlpha','titleAlpha','glowAlpha','morph'])assert.ok(state[key]>=0&&state[key]<=1,key);
    if(state.glowAlpha>0)assert.equal(state.morph,1);
  }
  assert.ok(largest>to.r*1.1);
  const end=unlockPose({elapsed:UNLOCK_ENTER_DURATION,from,to});
  for(const key of ['x','y','r'])close(end.pose[key],to[key]);
  close(end.rotation-from.roll,6*Math.PI);assert.equal(end.morph,1);assert.equal(end.ready,true);assert.equal(end.glowAlpha,1);
  assert.deepEqual(unlockPose({elapsed:30,from,to}),end);
});

test('dismissal starts at the exact captured pose, restores old skin, and removes light quickly',()=>{
  const reveal=unlockPose({elapsed:2,from,to}),destination={x:130,y:370,r:36};
  const first=unlockLeavePose({elapsed:0,from:reveal.pose,to:destination});
  for(const key of ['x','y','r','roll'])close(first.pose[key],reveal.pose[key]);
  assert.equal(first.morph,1);assert.equal(first.glowAlpha,1);
  const early=unlockLeavePose({elapsed:.2,from:reveal.pose,to:destination});
  assert.equal(early.glowAlpha,0);assert.ok(early.morph>0&&early.morph<1);assert.equal(early.done,false);
  const end=unlockLeavePose({elapsed:UNLOCK_LEAVE_DURATION,from:reveal.pose,to:destination});
  for(const key of ['x','y','r'])close(end.pose[key],destination[key]);
  assert.equal(end.morph,0);assert.equal(end.glowAlpha,0);assert.equal(end.panelAlpha,0);assert.equal(end.done,true);
});

test('reduced motion removes spin and overshoot but still reveals then restores the skin',()=>{
  const half=unlockPose({elapsed:.3,from,to,reducedMotion:true});
  assert.equal(half.rotation,from.roll);assert.equal(half.panelScale,1);assert.ok(half.pose.r<=to.r);
  const end=unlockPose({elapsed:.56,from,to,reducedMotion:true});
  assert.equal(end.ready,true);assert.equal(end.morph,1);assert.equal(end.glowAlpha,1);
  const leave=unlockLeavePose({elapsed:.28,from:end.pose,to:from,reducedMotion:true});
  assert.equal(leave.done,true);assert.equal(leave.rotation,end.pose.roll);assert.equal(leave.morph,0);
});

test('reward heading uses real selected-font text with an ink-fitted responsive frame',()=>{
  const markup=unlockTitleMarkup();
  assert.ok(markup.includes('<text x="0" y="0">已解锁外观！</text>'));
  assert.ok(markup.includes('viewBox="113 -797 5151 893"'));
  assert.ok(!markup.includes('<path'));
  const companion=unlockTitleMarkup('companion');
  assert.ok(companion.includes('<text x="0" y="0">已解锁伴星</text>'));
  assert.ok(companion.includes('viewBox="113 -797 4825 893"'));
  assert.equal(companion.includes('！'),false);
});

test('consecutive rewards keep one resting ball and uninterrupted panel and glow',()=>{
  const revealed=unlockPose({elapsed:UNLOCK_ENTER_DURATION,from,to}).pose;
  for(const reducedMotion of [false,true]){
    const duration=reducedMotion?.2:UNLOCK_SWITCH_DURATION;
    for(let frame=0;frame<=60;frame++){
      const state=unlockSwitchPose({elapsed:duration*frame/60,from:revealed,reducedMotion});
      for(const key of ['x','y','r','roll','squash','lookX','lookY'])close(state.pose[key],revealed[key]);
      assert.equal(state.panelAlpha,1);assert.equal(state.panelScale,1);assert.equal(state.glowAlpha,1);
      assert.ok(state.morph>=0&&state.morph<=1);assert.equal(state.ready,frame===60);
    }
    const end=unlockSwitchPose({elapsed:duration,from:revealed,reducedMotion});
    assert.equal(end.morph,1);assert.equal(end.titleAlpha,1);assert.equal(end.done,true);
    assert.deepEqual(unlockSwitchPose({elapsed:100,from:revealed,reducedMotion}),end);
  }
});

test('reward titles swap only at zero opacity and return without restarting the ball animation',()=>{
  for(const reducedMotion of [false,true]){
    const swapAt=reducedMotion?.06:.12,duration=reducedMotion?.2:UNLOCK_SWITCH_DURATION;
    const initial=unlockSwitchPose({from:to,reducedMotion});
    assert.equal(initial.switched,false);assert.equal(initial.titleAlpha,1);assert.equal(initial.morph,0);
    const before=unlockSwitchPose({elapsed:swapAt-1e-8,from:to,reducedMotion});
    const at=unlockSwitchPose({elapsed:swapAt,from:to,reducedMotion});
    const after=unlockSwitchPose({elapsed:swapAt+1e-8,from:to,reducedMotion});
    assert.equal(before.switched,false);assert.equal(at.switched,true);assert.equal(after.switched,true);
    close(before.titleAlpha,0);close(at.titleAlpha,0);close(after.titleAlpha,0);
    const rising=unlockSwitchPose({elapsed:(swapAt+duration)/2,from:to,reducedMotion});
    assert.ok(rising.titleAlpha>0&&rising.titleAlpha<1);assert.equal(rising.ready,false);
  }
});

test('a resized reward anchor moves continuously without overshoot or extra rotation and hands off to the final leave pose',()=>{
  const previous=unlockPose({elapsed:UNLOCK_ENTER_DURATION,from,to}).pose;
  const anchor={x:380,y:195,r:35};
  let lastX=previous.x,lastY=previous.y;
  for(let frame=0;frame<=60;frame++){
    const state=unlockSwitchPose({elapsed:UNLOCK_SWITCH_DURATION*frame/60,from:previous,to:anchor});
    assert.ok(state.pose.x>=lastX-1e-9&&state.pose.x<=anchor.x);
    assert.ok(state.pose.y<=lastY+1e-9&&state.pose.y>=anchor.y);
    assert.ok(state.pose.r<=previous.r&&state.pose.r>=anchor.r);close(state.rotation,previous.roll);
    lastX=state.pose.x;lastY=state.pose.y;
  }
  const final=unlockSwitchPose({elapsed:UNLOCK_SWITCH_DURATION,from:previous,to:anchor});
  const leaving=unlockLeavePose({elapsed:0,from:final.pose,to:{x:130,y:370,r:36}});
  for(const key of ['x','y','r','roll','squash','lookX','lookY'])close(leaving.pose[key],final.pose[key]);
  close(leaving.panelAlpha,final.panelAlpha);close(leaving.glowAlpha,final.glowAlpha);
});

test('unlock panel starts with the appearance heading and a generic accessible continue action',()=>{
  const panel={setAttribute(name,value){this[name]=value;}},doc={createElement:()=>panel};
  assert.equal(createUnlockPanel(doc),panel);assert.equal(panel.hidden,true);
  assert.equal(panel.role,'dialog');assert.equal(panel['aria-labelledby'],'skin-unlock-title');
  assert.ok(panel.innerHTML.includes('aria-label="已解锁外观！"'));
  assert.ok(panel.innerHTML.includes('aria-label="继续" disabled'));assert.equal(panel.innerHTML.includes('皮肤'),false);
});
