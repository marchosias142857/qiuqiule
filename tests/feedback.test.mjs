import test from 'node:test';
import assert from 'node:assert/strict';
import {ScoreFeedback, impactShards, mergeShards, impactZoom, feedbackStrength, hitFeedbackTier} from '../dist/feedback.js';

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, message || `${actual} ≈ ${expected}`);

test('ordinary hit tiers use maximum health with inclusive ten and thirty percent boundaries', () => {
  for (const [damage, expected] of [[0, 'light'], [9.999, 'light'], [10, 'medium'], [29.999, 'medium'], [30, 'heavy'], [100, 'heavy']]) {
    assert.equal(hitFeedbackTier({damage, maxHp: 100}), expected);
    assert.equal(hitFeedbackTier({damage, maxHp: 100, hp: 1}), expected, 'remaining HP cannot inflate an ordinary hit tier');
  }
  for (const sample of [{}, {damage: NaN, maxHp: 100}, {damage: 1, maxHp: Infinity}, {damage: 1, maxHp: 0}]) {
    assert.equal(hitFeedbackTier(sample), 'heavy', 'unclassified legacy events retain their established feedback');
  }
});

test('score rolls monotonically to the exact score within 250 ms while its pop ends at 160 ms', () => {
  const score = new ScoreFeedback(); score.set(137);
  assert.deepEqual(score.step(0), {value: 0, scale: 1});
  const halfPop = score.step(.08);
  assert.ok(halfPop.value > 0 && halfPop.value < 137); near(halfPop.scale, 1.18);
  const popEnd = score.step(.08);
  assert.ok(popEnd.value >= halfPop.value && popEnd.value < 137); assert.equal(popEnd.scale, 1);
  assert.deepEqual(score.step(.09), {value: 137, scale: 1});
  assert.deepEqual(score.step(1), {value: 137, scale: 1});
});

test('continuous scoring retargets from the displayed state and repeated HUD sync does not restart the animation', () => {
  const score = new ScoreFeedback(); score.set(10);
  const first = score.step(.05); score.set(30);
  assert.equal(score.step(0).value, first.value);
  let previous = first.value;
  for (let frame = 0; frame < 5; frame++) {
    score.set(30);
    const state = score.step(.05);
    assert.ok(state.value >= previous && state.value <= 30); previous = state.value;
  }
  assert.equal(previous, 30);
  score.set(5000); score.step(.1); score.set(5001);
  assert.deepEqual(score.step(.25), {value: 5001, scale: 1});
});

test('endless kill pops grow with capped combo while keeping the original timing and exact score', () => {
  for(const [combo,cap,peak] of [[1,8,1.22],[2,8,1.26],[3,8,1.30],[8,8,1.50],[12,8,1.50],[12,12,1.66],[40,12,1.66]]){
    const score=new ScoreFeedback();score.noteKill(combo,cap);score.set(1000);
    near(score.step(.08).scale,peak);near(score.step(.08).scale,1);
    assert.deepEqual(score.step(.09),{value:1000,scale:1});
  }
});

test('batched kills select their highest combo once without contaminating later nonkill scores or repeated syncs', () => {
  const score=new ScoreFeedback();for(const combo of [1,3,2])score.noteKill(combo);score.set(75);
  near(score.step(.08).scale,1.30);score.set(75);near(score.step(.08).scale,1);
  assert.deepEqual(score.step(.09),{value:75,scale:1});
  score.set(85);near(score.step(.08).scale,1.18);
  score.noteKill(12,12);score.set(85);score.set(100);near(score.step(.08).scale,1.18,'already-counted kills are discarded on a same-target sync');
  for(const combo of [0,-1,NaN,Infinity])score.noteKill(combo,12);
  score.set(110);near(score.step(.08).scale,1.18);
});

test('score reset and disabled animation discard queued and active combo amplification', () => {
  const score=new ScoreFeedback();score.noteKill(12,12);score.reset(0);score.set(10);
  near(score.step(.08).scale,1.18);
  score.noteKill(12,12);score.set(30,false);assert.deepEqual(score.step(0),{value:30,scale:1});
  score.set(40);near(score.step(.08).scale,1.18);
  score.noteKill(12,12);score.set(100);score.step(.03);assert.deepEqual(score.step(.01,false),{value:100,scale:1});
  score.set(110);near(score.step(.08).scale,1.18);
});

test('reduced animation, disabled feedback and restart produce immediate exact scores without a residual pop', () => {
  const score = new ScoreFeedback(); score.set(19, false);
  assert.deepEqual(score.step(0), {value: 19, scale: 1});
  score.set(123); score.step(.03);
  assert.deepEqual(score.step(.01, false), {value: 123, scale: 1});
  score.set(240); score.step(.05); score.reset(0);
  assert.deepEqual(score.step(0), {value: 0, scale: 1});
  score.set(10); score.step(.08); score.set(0);
  assert.deepEqual(score.step(.01), {value: 0, scale: 1});
});

const contact = {x: 50, y: 60, r: 24, contactX: 30, contactY: 60, nx: 1, ny: 0,
  impactVx: 400, impactVy: 0, impactSpeed: 400, feedbackLevel: 1};

test('impact shards originate at contact and fan away along the collision normal', () => {
  const shards = impactShards(contact, 0x123456, {strength: 1});
  assert.equal(shards.length, 7);
  assert.ok(shards.some(shard => shard.vy > 0) && shards.some(shard => shard.vy < 0));
  for (const shard of shards) {
    assert.equal(shard.x, contact.contactX); assert.equal(shard.y, contact.contactY);
    assert.ok(shard.vx > 0); assert.equal(shard.color, 0x123456);
    assert.ok(shard.total >= .5 && shard.total <= .62);
  }
});

test('vertical impact fans preserve a zero x normal and rotate with the incoming strike', () => {
  const horizontal = impactShards(contact, 0, {strength: 1});
  const vertical = impactShards({...contact, nx: 0, ny: 1, impactVx: 0, impactVy: 400}, 0, {strength: 1});
  for (let i = 0; i < horizontal.length; i++) {
    near(vertical[i].vx, -horizontal[i].vy);
    near(vertical[i].vy, horizontal[i].vx);
  }
});

test('shards inherit 35% of the incoming velocity and grow in energy without randomness', () => {
  const common = {...contact, impactSpeed: 400};
  const still = impactShards({...common, impactVx: 0, impactVy: 0}, 0);
  const moving = impactShards({...common, impactVx: 400, impactVy: -200}, 0);
  moving.forEach((shard, i) => { near(shard.vx - still[i].vx, 140); near(shard.vy - still[i].vy, -70); });
  const weak = impactShards({...common, impactSpeed: 0, impactVx: 0, impactVy: 0}, 0);
  assert.ok(Math.hypot(still[0].vx, still[0].vy) > Math.hypot(weak[0].vx, weak[0].vy));
  const original = Math.random;
  try {
    Math.random = () => { throw new Error('impact feedback must not consume randomness'); };
    assert.deepEqual(impactShards(contact, 0), impactShards(contact, 0));
  } finally { Math.random = original; }
});

test('fragment counts are bounded by feedback level and reduced motion limits speed, spin and lifetime', () => {
  const base = impactShards(contact, 0, {strength: 1});
  const second = impactShards({...contact, feedbackLevel: 2}, 0, {strength: 1});
  assert.equal(second.length, base.length + 2);
  assert.equal(impactShards({...contact, feedbackLevel: 999}, 0, {strength: 1}).length, 21);
  assert.equal(impactShards(contact, 0, {strength: 0}).length, 3);
  const full = impactShards(contact, 0, {count: 5, strength: 1});
  const reduced = impactShards(contact, 0, {count: 5, strength: 1, reducedMotion: true});
  assert.equal(reduced.length, 5);
  reduced.forEach((shard, i) => {
    near(shard.vx, full[i].vx * .3); near(shard.vy, full[i].vy * .3);
    assert.equal(shard.spin, 0); assert.equal(shard.total, .3);
  });
  assert.equal(feedbackStrength(-1), 0); assert.equal(feedbackStrength(10), 1); assert.equal(feedbackStrength(NaN), .6);
});

test('impact zoom rises to its 80 ms peak and returns at 280 ms without overshoot', () => {
  const peak = .03;
  assert.equal(impactZoom(-.01, peak), 1); assert.equal(impactZoom(0, peak), 1);
  near(impactZoom(.04, peak), 1 + peak / 2);
  near(impactZoom(.08, peak), 1 + peak);
  near(impactZoom(.18, peak), 1 + peak / 2);
  assert.equal(impactZoom(.28, peak), 1); assert.equal(impactZoom(1, peak), 1);
  let last = 1;
  for (let i = 0; i <= 8; i++) { const z = impactZoom(i / 100, peak); assert.ok(z >= last && z <= 1 + peak); last = z; }
  for (let i = 9; i <= 28; i++) { const z = impactZoom(i / 100, peak); assert.ok(z <= last && z >= 1); last = z; }
  for (const age of [0, .04, .08, .18, .28]) assert.equal(impactZoom(age, 0), 1);
});

test('a marked upgrade shot adds exactly two enemy-kill shards without changing other event feedback',()=>{
  for(const strength of [.2,.6,1])for(const feedbackLevel of [1,4,20]){
    const event={...contact,type:'kill',feedbackLevel};
    const normal=impactShards(event,0,{strength});
    const boosted=impactShards({...event,upgradeBoost:true},0,{strength});
    assert.equal(boosted.length,normal.length+2);
    assert.ok(boosted.every(s=>s.x===contact.contactX&&s.y===contact.contactY&&Number.isFinite(s.vx)&&Number.isFinite(s.vy)));
  }
  for(const type of ['clearKill','rescue','shieldBreak','bossHit']){
    const event={...contact,type};
    assert.deepEqual(impactShards({...event,upgradeBoost:true},0),impactShards(event,0));
  }
});

test('upgrade shards keep disabled and reduced-motion budgets unchanged',()=>{
  const event={...contact,type:'kill',feedbackLevel:8};
  for(const options of [{strength:0},{strength:1,reducedMotion:true},{strength:.6,reducedMotion:true}]){
    assert.deepEqual(impactShards({...event,upgradeBoost:true},0,options),impactShards(event,0,options));
  }
});

test('Boss shards scale the ordinary final count by radius while keeping the same directional fan',()=>{
  for(const strength of [0,.2,.6,1])for(const feedbackLevel of [1,4,8])for(const ratio of [1.25,2.5,4]){
    const event={...contact,type:'bossDefeated',feedbackLevel};
    const normal=impactShards(event,0x123456,{strength});
    const boss=impactShards(event,0x123456,{strength,countScale:ratio});
    assert.equal(boss.length,Math.round(normal.length*ratio));
    for(const shard of boss){
      near(shard.x,event.contactX);near(shard.y,event.contactY);assert.ok(shard.vx>0);
      assert.equal(shard.color,0x123456);assert.ok(shard.total>=.5&&shard.total<=.62);
    }
  }
});

test('oversized shard scaling is bounded and never expands the reduced-motion budget',()=>{
  const event={...contact,type:'bossDefeated',feedbackLevel:8};
  assert.equal(impactShards(event,0,{countScale:1000,strength:1}).length,120);
  for(const countScale of [2.5,1000]){
    const reduced=impactShards(event,0,{countScale,strength:1,reducedMotion:true});
    assert.equal(reduced.length,5);assert.ok(reduced.every(shard=>shard.spin===0&&shard.total===.3));
  }
  for(const countScale of [NaN,Infinity])assert.deepEqual(impactShards(event,0,{countScale}),impactShards(event,0));
});


test('merge fragments converge without overshooting and reduced motion stays within four fragments',()=>{
  const event={x:40,y:50,origins:[{x:20,y:50,r:12},{x:60,y:50,r:12}]};
  for(const reducedMotion of [false,true]){
    const shards=mergeShards(event,0x123456,{strength:1,reducedMotion});
    assert.equal(shards.length,reducedMotion?4:10);
    for(const shard of shards){
      const start=Math.hypot(shard.x-event.x,shard.y-event.y);
      for(const t of [0,.05,.1,.2,.249]){
        const x=shard.x+shard.vx*t,y=shard.y+shard.vy*t;
        assert.ok(Math.hypot(x-event.x,y-event.y)<=start+1e-9);
        assert.ok((x-event.x)*(shard.x-event.x)+(y-event.y)*(shard.y-event.y)>=-1e-9);
      }
      assert.equal(shard.spin,0);assert.equal(shard.color,0x123456);
    }
  }
});
