import test from 'node:test';
import assert from 'node:assert/strict';
import {unlockPose,unlockLeavePose,unlockSwitchPose,unlockStarTrailPose,unlockStarTrailGeometry,unlockTitleMarkup,createUnlockPanel,UNLOCK_ENTER_DURATION,UNLOCK_LEAVE_DURATION,UNLOCK_SWITCH_DURATION} from '../dist/skin-unlock.js';
import {transferPose,smooth} from '../dist/motion.js';

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
  const starTrail=unlockTitleMarkup('star-trail');
  assert.ok(starTrail.includes('<text x="0" y="0">已获得星迹！</text>'));
  assert.ok(starTrail.includes('viewBox="113 -797 5151 893"'));
  assert.equal(starTrail.includes('！'),true);
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

const starGeometry={start:{x:92,y:330,r:26},finish:{x:260,y:330,r:26},length:168};
const poseKeys=['x','y','r','roll','squash','lookX','lookY'];

test('star rewards approach like the wardrobe then reveal the fixed-face ribbon and centered light together',()=>{
  for(const reducedMotion of [false,true]){
    const approach=reducedMotion?.16:.28,draw=reducedMotion?.16:.26;
    for(let frame=0;frame<=20;frame++){
      const elapsed=approach*frame/20,state=unlockStarTrailPose({elapsed,from,geometry:starGeometry,reducedMotion});
      const expected=transferPose({...from,visualSquash:from.squash},starGeometry.start,frame/20);
      for(const key of poseKeys)close(state.pose[key],expected[key]);
      assert.equal(state.trailProgress,0);assert.equal(state.morph,0);assert.equal(state.glowAlpha,0);assert.equal(state.ready,false);
    }
    const arrival=unlockStarTrailPose({elapsed:approach,from,geometry:starGeometry,reducedMotion});
    for(let frame=0;frame<=40;frame++){
      const progress=frame/40,t=smooth(progress),state=unlockStarTrailPose({elapsed:approach+draw*progress,from,geometry:starGeometry,reducedMotion});
      close(state.pose.x,starGeometry.start.x+starGeometry.length*t);close(state.pose.y,starGeometry.finish.y);close(state.pose.r,starGeometry.finish.r);
      close(state.pose.roll,arrival.pose.roll);close(state.pose.lookX,arrival.pose.lookX);close(state.pose.lookY,arrival.pose.lookY);
      close(state.pose.squash,(arrival.pose.squash||0)*(1-t)+(reducedMotion?0:Math.sin(Math.PI*t)*.06));
      close(state.trailProgress,t);close(state.morph,t);assert.equal(state.trailAlpha,1);close(state.glowAlpha,t);
    }
    const end=unlockStarTrailPose({elapsed:approach+draw,from,geometry:starGeometry,reducedMotion});
    assert.equal(end.ready,true);assert.equal(end.panelScale,1);assert.equal(end.titleAlpha,1);assert.equal(end.panelAlpha,1);
    assert.deepEqual(unlockStarTrailPose({elapsed:40,from,geometry:starGeometry,reducedMotion}),end);
  }
});

test('star approach-to-draw and retract-to-return joins keep position, size, face and opacity continuous',()=>{
  for(const reducedMotion of [false,true]){
    const approach=reducedMotion?.16:.28,draw=reducedMotion?.16:.26,retract=reducedMotion?.12:.18;
    const arrival=unlockStarTrailPose({elapsed:approach,from,geometry:starGeometry,reducedMotion});
    for(const offset of [-1e-9,1e-9]){
      const adjacent=unlockStarTrailPose({elapsed:approach+offset,from,geometry:starGeometry,reducedMotion});
      for(const key of poseKeys)close(adjacent.pose[key],arrival.pose[key]);
      close(adjacent.trailProgress,arrival.trailProgress);close(adjacent.panelAlpha,arrival.panelAlpha);
    }
    const shown=unlockStarTrailPose({elapsed:approach+draw,from,geometry:starGeometry,reducedMotion});
    const at=unlockStarTrailPose({elapsed:retract,from:shown.pose,to:from,geometry:starGeometry,phase:'leave',reducedMotion});
    for(const offset of [-1e-9,1e-9]){
      const adjacent=unlockStarTrailPose({elapsed:retract+offset,from:shown.pose,to:from,geometry:starGeometry,phase:'leave',reducedMotion});
      for(const key of poseKeys)close(adjacent.pose[key],at.pose[key]);
      close(adjacent.trailProgress,at.trailProgress);close(adjacent.trailAlpha,at.trailAlpha);close(adjacent.panelAlpha,at.panelAlpha);
    }
  }
});

test('consecutive star rewards crossfade in .18 seconds with one stable ball, title and full trail',()=>{
  const captured={...starGeometry.finish,roll:1.1,lookX:.04,lookY:-.03,squash:.02};
  for(const reducedMotion of [false,true])for(let frame=0;frame<=36;frame++){
    const state=unlockStarTrailPose({elapsed:.18*frame/36,from:captured,geometry:starGeometry,phase:'switch',reducedMotion});
    assert.deepEqual(state.pose,captured);close(state.morph,smooth(frame/36));
    for(const key of ['panelAlpha','panelScale','titleAlpha','trailProgress','trailAlpha'])assert.equal(state[key],1);
    assert.equal(state.glowAlpha,1);assert.equal(state.switched,true);assert.equal(state.ready,frame===36);
  }
  const resized={...starGeometry,finish:{x:380,y:195,r:22}},mid=unlockStarTrailPose({elapsed:.09,from:captured,geometry:resized,phase:'switch'});
  close(mid.pose.x,(captured.x+resized.finish.x)/2);close(mid.pose.y,(captured.y+resized.finish.y)/2);close(mid.pose.r,24);
  close(mid.pose.roll,captured.roll);close(mid.pose.lookX,captured.lookX);close(mid.pose.squash,captured.squash);
  const end=unlockStarTrailPose({elapsed:.18,from:captured,geometry:resized,phase:'switch'});
  for(const key of ['x','y','r'])close(end.pose[key],resized.finish[key]);assert.equal(end.done,true);
});

test('star dismissal retracts in place before the wardrobe return transfer and restores the original layers',()=>{
  const captured=unlockStarTrailPose({elapsed:2,from,geometry:starGeometry}).pose;
  for(const reducedMotion of [false,true]){
    const retract=reducedMotion?.12:.18,travel=reducedMotion?.22:.32;
    for(let frame=0;frame<=20;frame++){
      const state=unlockStarTrailPose({elapsed:retract*frame/20,from:captured,to:from,geometry:starGeometry,phase:'leave',reducedMotion});
      assert.deepEqual(state.pose,captured);close(state.trailProgress,1-smooth(frame/20));close(state.trailAlpha,state.trailProgress);
      assert.equal(state.morph,1);assert.equal(state.panelAlpha,1);assert.equal(state.titleAlpha,1);close(state.glowAlpha,state.trailProgress);
    }
    for(let frame=1;frame<=20;frame++){
      const progress=frame/20,state=unlockStarTrailPose({elapsed:retract+travel*progress,from:captured,to:from,geometry:starGeometry,phase:'leave',reducedMotion});
      const expected=transferPose({...captured,visualSquash:captured.squash||0},from,progress);
      for(const key of poseKeys)close(state.pose[key],expected[key]);
      close(state.morph,1-smooth(progress));assert.equal(state.trailProgress,0);assert.equal(state.trailAlpha,0);
    }
    const end=unlockStarTrailPose({elapsed:retract+travel,from:captured,to:from,geometry:starGeometry,phase:'leave',reducedMotion});
    assert.equal(end.done,true);assert.equal(end.morph,0);assert.equal(end.panelAlpha,0);assert.equal(end.titleAlpha,0);
    for(const key of ['x','y','r'])close(end.pose[key],from[key]);
  }
});

test('appearance-to-star handoff keeps its existing panel visible throughout the new approach',()=>{
  for(const elapsed of [0,.04,.15,.28,.4,.54]){
    const state=unlockStarTrailPose({elapsed,from,geometry:starGeometry,panelAlreadyVisible:true});
    assert.equal(state.panelAlpha,1);assert.equal(state.titleAlpha,1);assert.equal(state.panelScale,1);close(state.glowAlpha,state.trailProgress);
  }
  const fresh=unlockStarTrailPose({from,geometry:starGeometry});assert.equal(fresh.panelAlpha,0);assert.equal(fresh.titleAlpha,0);
  assert.deepEqual(unlockStarTrailPose({elapsed:NaN,from,geometry:starGeometry}),fresh);
  assert.deepEqual(unlockStarTrailPose({elapsed:-1,from,geometry:starGeometry}),fresh);
});

test('star composition centers its full extent while the whole approach ball keeps an inset from the panel',()=>{
  for(const left of [0,24,234])for(let width=224;width<=380;width+=1){
    const y=183.25,geometry=unlockStarTrailGeometry({left,width,y}),{start,finish,length,glow,inset}=geometry;
    assert.ok(start.x-start.r>=left+inset-1e-9,'leftmost approach edge keeps the intended panel margin');
    assert.ok(finish.x+finish.r<=left+width-inset+1e-9,'resting ball stays inside the right edge');
    const tailLeft=finish.x-length,bodyRight=finish.x+finish.r;
    close((tailLeft+bodyRight)/2,left+width/2);
    close(tailLeft-left,left+width-bodyRight);
    close(start.y,y);close(finish.y,y);close(glow.y,y);close(glow.x,left+width/2);close(glow.r,finish.r);
    assert.ok(finish.r>0&&finish.r<=38);assert.ok(inset>=18&&inset<=28);
  }
  const phone=unlockStarTrailGeometry({left:24,width:342,y:434.5625});
  assert.ok(phone.finish.r>33&&phone.finish.r<34,'phone sample is smaller than the previous 46px radius');
  assert.ok(phone.start.x-phone.start.r>24+27,'the start is inside the popup, not merely inside the screen');
});

test('centered star glow fades in with the draw, survives every switch and vanishes before return flight',()=>{
  const geometry=unlockStarTrailGeometry({left:24,width:342,y:434.5625});
  for(const reducedMotion of [false,true]){
    const approach=reducedMotion?.16:.28,draw=reducedMotion?.16:.26,retract=reducedMotion?.12:.18;
    const entering=unlockStarTrailPose({elapsed:approach+draw/2,from,geometry,reducedMotion});
    close(entering.glowAlpha,.5);assert.deepEqual(geometry.glow,{x:195,y:434.5625,r:geometry.finish.r});
    const shown=unlockStarTrailPose({elapsed:approach+draw,from,geometry,reducedMotion});
    assert.equal(shown.glowAlpha,1);
    for(const elapsed of [0,.01,.09,.18,3]){
      const switched=unlockStarTrailPose({elapsed,from:shown.pose,geometry,phase:'switch',reducedMotion});
      assert.equal(switched.glowAlpha,shown.glowAlpha);
    }
    const half=unlockStarTrailPose({elapsed:retract/2,from:shown.pose,to:from,geometry,phase:'leave',reducedMotion});
    close(half.glowAlpha,.5);assert.deepEqual(half.pose,shown.pose);
    for(const elapsed of [retract,retract+.01,retract+.32]){
      const leaving=unlockStarTrailPose({elapsed,from:shown.pose,to:from,geometry,phase:'leave',reducedMotion});
      assert.equal(leaving.glowAlpha,0);
    }
  }
});
