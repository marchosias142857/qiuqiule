import test from 'node:test';
import assert from 'node:assert/strict';
import {World, BOSS_TIMING} from '../dist/physics.js';
import {UPGRADES} from '../dist/upgrades.js';

const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function world() {
  const w = new World(10000, 10000, () => .5, {spawnInitial: false});
  w.spawnTimer = w.floorTimer = w.introTimer = Infinity;
  Object.assign(w.player, {x: 4000, y: 4000, vx: 0, vy: 0});
  return w;
}
function enemy(w, options = {}) {
  const body = w.makeBody(5000, 4000, w.unit, 1.5);
  Object.assign(body, {born: 1, solid: true, enemyType: 'normal', hp: 100000, maxHp: 100000}, options);
  w.enemies.push(body); return body;
}
function acquire(w, id, count = 1) { for (let i = 0; i < count; i++) assert.equal(w.applyUpgrade(id), true); }
function advance(w, seconds) { while (seconds > 1e-10) { const dt = Math.min(1 / 120, seconds); w.step(dt); seconds -= dt; } }
function strike(w, body, actor = w.player, speed = w.unit * 30) {
  Object.assign(actor, {x: body.x - body.r - actor.r + .01, y: body.y, vx: speed, vy: 0}); w.collide(actor, body);
}
function choose(w, id) {
  w.phase = 'choose'; assert.equal(w.choose(w.choices.find(c => c.id === id) || UPGRADES[id]), true); advance(w, w.rewardTiming.rest + .001);
}

test('v8.3 removed risk cannot be acquired and stale counts never change HP or scores', () => {
  const w = world(), base = w.enemyProfile(); w.buffs.risk = 200;
  assert.equal(w.applyUpgrade('risk'), false); assert.deepEqual(w.enemyProfile(), base);
  assert.equal(w.scoreValue(10.5), 11);
  w.damage(enemy(w, {hp: 1}), 1); assert.equal(w.score, 10);
});

test('frenzy keeps additive unlimited combo damage while v9.0.1 pressure also stacks', () => {
  const w = world(); w.stage = 12; acquire(w, 'frenzy');
  const waveSize = w.waveSize, interval = w.waveInterval;
  acquire(w, 'frenzy', 19); assert.equal(w.buffs.frenzy, 20);
  assert.equal(w.waveSize, waveSize + 19); near(w.waveInterval, interval * (waveSize + 19) / waveSize * .9 ** 19); assert.equal(w.comboCap, 12);
  for (const [kills, perLayer] of [[0, 0], [6, 0], [7, .15], [8, .3], [9, .45], [10, .6], [40, .6]]) {
    w.shotKills = kills; near(w.frenzyDamageScale, 1 + 20 * perLayer);
  }
  w.shoot(-w.maxPull, 0); assert.equal(w.shotKills, 0); assert.equal(w.frenzyDamageScale, 1);
});

test('v8.3 frenzy amplifies direct and auxiliary damage once and pulse inherits the same impact multiplier', () => {
  for (const auxiliary of [false, true]) {
    const w = world(); acquire(w, 'frenzy', 3); acquire(w, 'pulse');
    const actor = auxiliary ? w.makeBody(0, 0, w.unit * .7, w.player.density) : w.player;
    if (auxiliary) Object.assign(actor, {isPlayer: true, isAuxiliary: true, sourceMass: w.player.mass, bank: 0, hp: Infinity});
    const target = enemy(w), splash = enemy(w, {x: target.x, y: target.y + w.unit * 2.5});
    w.shotKills = 8;
    const speed = w.unit * (auxiliary ? 18 : 30), referenceSpeed = auxiliary ? speed / .6 : speed;
    const mass = 1 / (1 / (auxiliary ? actor.sourceMass : actor.mass) + 1 / target.mass);
    const expected = Math.round(.5 * mass * (referenceSpeed / w.unit) ** 2 * .31 * 1.9 * (auxiliary ? .6 : 1));
    strike(w, target, actor, speed);
    assert.equal(target.maxHp - target.hp, expected);
    assert.equal(splash.maxHp - splash.hp, Math.round(expected * .3));
  }
});

test('v8.3 a seventh kill enables frenzy only for subsequent direct damage', () => {
  const w = world(); acquire(w, 'frenzy', 2); w.shotKills = 6;
  const before = enemy(w, {hp: 1}); strike(w, before);
  assert.equal(w.shotKills, 7); near(w.frenzyDamageScale, 1.3);
  const next = enemy(w, {x: 6000});
  const expected = Math.round(.5 / (1 / w.player.mass + 1 / next.mass) * 30 ** 2 * .31 * 1.3);
  strike(w, next); assert.equal(next.maxHp - next.hp, expected);
});

test('v8.3 frenzy changes Boss shell contraction and stunned damage, while a fresh Boss shot has no combo bonus', () => {
  for (const stunned of [false, true]) {
    const samples = [];
    for (const layers of [0, 2]) {
      const w = world(); acquire(w, 'frenzy', layers); w.stage = 5; w.beginBoss(); advance(w, BOSS_TIMING.entry);
      w.shotKills = 9; const boss = w.boss;
      if (stunned) Object.assign(boss, {stunned: true, hp: 100000, maxHp: 100000});
      const before = stunned ? boss.hp : boss.r; w.damageBoss(w.unit * 30);
      samples.push(stunned ? before - boss.hp : before - boss.r);
      w.shoot(-w.maxPull, 0); near(w.frenzyDamageScale, 1);
    }
    if (stunned) {
      const w = world(); near(samples[1], Math.round(.5 * w.player.mass * 30 ** 2 * .31 * 1.9));
    } else near(samples[1], samples[0] * 1.9);
  }
});

test('v8.3 shockwave uses the frenzy full-pull reference once and reaches four radius units', () => {
  const w = world(); acquire(w, 'frenzy', 2); acquire(w, 'shockwave'); w.shotKills = 10;
  const target = enemy(w, {x: w.player.x + w.unit * 3.5}), outside = enemy(w, {x: w.player.x + w.unit * 4.01});
  const expected = Math.round(.5 / (1 / w.player.mass + 1 / target.mass) * 40 ** 2 * .31 * 2.2 * .75);
  w.releaseShockwave(); assert.equal(target.maxHp - target.hp, expected); assert.equal(outside.hp, outside.maxHp);
  assert.equal(w.events.find(e => e.type === 'shockwave').hits, 1);
});

test('v8.3 shockwave has one 35 ms local hold with radial 120 ms deformation and retained lethal fragments', () => {
  const w = world(); w.setFeedbackOptions({strength: 1});
  const survivor = enemy(w, {x: w.player.x + w.unit * 2}), killed = enemy(w, {x: w.player.x, y: w.player.y + w.unit * 3, hp: 1});
  const outside = enemy(w, {x: w.player.x + w.unit * 5}); outside.vx = 100;
  w.releaseShockwave(); near(w.player.feedbackFreeze, .035); near(w.feedbackFreezeUsed, .035);
  near(survivor.feedbackFreeze, .035); near(killed.feedbackFreeze, .035); near(outside.feedbackFreeze || 0, 0);
  near(survivor.squash, .15); near(survivor.angle, 0); near(killed.angle, Math.PI / 2);
  const event = w.events.find(e => e.type === 'shockwave'), kill = w.events.find(e => e.type === 'kill');
  assert.equal(event.hits, 2); assert.equal(kill.source, 'shockwave'); near(kill.freezeDuration, .035);
  assert.ok(kill.bodySnapshot); near(kill.bodySnapshot.squash, .15);
  const outsideX = outside.x; advance(w, .02); assert.ok(outside.x > outsideX);
  advance(w, .101); near(survivor.shockwaveSquashTime, 0); near(survivor.squash, 0);
});

test('v8.3 shockwave counts actual shield breaks and suppresses repeat shield immunity in the same step', () => {
  const w = world(); w.setFeedbackOptions({strength: 1});
  const target = enemy(w, {x: w.player.x + w.unit * 2, shield: true});
  w.releaseShockwave(); assert.equal(target.hp, target.maxHp); assert.equal(target.shield, false);
  assert.equal(w.events.filter(e => e.type === 'shockwave').at(-1).hits, 1);
  assert.equal(w.events.find(e => e.type === 'shieldBreak').source, 'shockwave');
  w.releaseShockwave(); assert.equal(w.events.filter(e => e.type === 'shockwave').at(-1).hits, 0);
  near(w.feedbackFreezeUsed, .035);
  w.stepSerial++; w.releaseShockwave(); assert.ok(target.hp < target.maxHp);
  assert.equal(w.events.filter(e => e.type === 'shockwave').at(-1).hits, 1);
});

test('v8.3 empty shockwaves have no hold and wall-triggered events preserve exact contact and outward normal', () => {
  const w = world(); acquire(w, 'shockwave'); w.setFeedbackOptions({strength: 1});
  const p = w.player, bounds = w.arenaBounds;
  for (let i = 0; i < 2; i++) { Object.assign(p, {x: 0, y: 3000, vx: -w.unit * 20, vy: 0}); w.wall(p); }
  const event = w.events.find(e => e.type === 'shockwave'); assert.ok(event);
  assert.equal(event.hits, 0); near(event.contactX, bounds.left); near(event.contactY, 3000);
  assert.equal(event.nx, -1); assert.equal(event.ny, 0); near(p.feedbackFreeze || 0, 0);
});

test('v8.3 shockwave Boss hits use short local feedback and preserve bank charges', () => {
  for (const stunned of [false, true]) {
    const w = world(); acquire(w, 'frenzy', 2); acquire(w, 'bank'); w.stage = 5; w.beginBoss(); advance(w, BOSS_TIMING.entry);
    w.setFeedbackOptions({strength: 1}); w.bank = 2; w.shotKills = 10;
    Object.assign(w.player, {x: w.boss.x, y: w.boss.y + w.boss.r + w.unit * 2});
    if (stunned) Object.assign(w.boss, {stunned: true, hp: 100000, maxHp: 100000});
    const expected = Math.round(w.fullPullDamage(w.boss) * .75); w.releaseShockwave();
    assert.equal(w.events.find(e => e.type === 'shockwave').hits, 1); near(w.player.feedbackFreeze, .035); near(w.boss.feedbackFreeze, .035);
    assert.equal(w.bank, 2); if (stunned) assert.equal(w.boss.maxHp - w.boss.hp, expected);
    assert.equal(w.events.find(e => e.type === 'bossHit').source, 'shockwave');
  }
});

test('v8.3 reduced motion and disabled feedback preserve shockwave damage while adding no hold or deformation', () => {
  for (const options of [{strength: 1, reducedMotion: true}, {strength: 0, reducedMotion: false}]) {
    const w = world(); w.setFeedbackOptions(options);
    const target = enemy(w, {x: w.player.x + w.unit * 2}); w.releaseShockwave();
    assert.ok(target.hp < target.maxHp); near(target.squash, 0); near(target.shockwaveSquashTime || 0, 0);
    near(target.feedbackFreeze || 0, 0); near(w.player.feedbackFreeze || 0, 0);
    assert.equal(w.events.find(e => e.type === 'shockwave').hits, 1);
  }
});

test('v8.3 changing feedback preferences clears only active shockwave deformation', () => {
  for (const options of [{strength: 1, reducedMotion: true}, {strength: 0}]) {
    const w = world(); w.setFeedbackOptions({strength: 1});
    const target = enemy(w, {x: w.player.x + w.unit * 2}), ordinary = enemy(w, {squash: .2});
    w.releaseShockwave(); near(target.squash, .15); w.setFeedbackOptions(options);
    near(target.squash, 0); near(target.shockwaveSquashTime, 0); near(ordinary.squash, .2);
  }
});

test('v8.3 a wager buys one extra normal reward round and applies a new wager only after the entire sequence', () => {
  const w = world(); w.stage = 20; w.phase = 'choose'; w.choose(UPGRADES.gambler); advance(w, 1.001);
  assert.equal(w.stage, 21); near(w.gamblerTargetMultiplier, 1.5); assert.equal(w.gamblerRewardPending, true);
  w.beginUpgrade(); assert.equal(w.upgradeRoundTotal, 2); assert.equal(w.choices.length, 3); assert.equal(w.gamblerRewardPending, false);
  choose(w, 'gambler'); assert.equal(w.stage, 21); assert.equal(w.upgradeRound, 2); assert.equal(w.choices.length, 3);
  assert.equal(w.nextGambler, true); assert.ok(w.choices.every(c => c.id !== 'gambler'));
  assert.equal(w.applyUpgrade('gambler'), false); choose(w, w.choices[0].id);
  assert.equal(w.stage, 22); assert.equal(w.buffs.gambler, 2); near(w.gamblerTargetMultiplier, 1.5); assert.equal(w.gamblerRewardPending, true);
  w.beginUpgrade(); assert.equal(w.upgradeRoundTotal, 2); choose(w, w.choices.find(c => c.id !== 'gambler').id);
  assert.equal(w.stage, 22); choose(w, w.choices.find(c => c.id !== 'gambler').id);
  assert.equal(w.stage, 23); near(w.gamblerTargetMultiplier, 1); assert.equal(w.gamblerRewardPending, false);
  w.beginUpgrade(); assert.equal(w.upgradeRoundTotal, 1); assert.equal(w.choices.length, 3);
});

test('v8.3 a Boss wager yields exactly three distinct three-choice rounds before stage progression', () => {
  const w = world(); w.stage = 20; w.gamblerRewardPending = true; w.beginBoss();
  w.boss.defeated = true; w.phase = 'boss-celebrate'; w.beginUpgrade({bypassBoss: true});
  assert.equal(w.upgradeRoundTotal, 3); assert.equal(w.gamblerRewardPending, false);
  for (let round = 1; round <= 3; round++) {
    assert.equal(w.stage, 20); assert.equal(w.upgradeRound, round); assert.equal(w.choices.length, 3);
    assert.equal(new Set(w.choices.map(c => c.id)).size, 3); assert.ok(w.choices.some(c => c.kind !== 'risk'));
    choose(w, round === 1 ? 'gambler' : w.choices[0].id);
    if (round < 3) assert.ok(w.choices.every(c => c.id !== 'gambler'));
  }
  assert.equal(w.stage, 21); near(w.gamblerTargetMultiplier, 1.5); assert.equal(w.gamblerRewardPending, true);
});

test('v8.3 starting rewards remain one round and each earned three-choice round survives viewport rotation', () => {
  const start = world(); start.beginStartingUpgrades(); assert.equal(start.upgradeRoundTotal, 1); choose(start, start.choices[0].id); assert.equal(start.stage, 1);
  for (const [width, height] of [[320, 568], [844, 390]]) {
    const w = new World(width, height, () => .5, {spawnInitial: false}); w.stage = 21; w.gamblerRewardPending = true; w.beginUpgrade();
    for (let round = 1; round <= 2; round++) {
      advance(w, 1.86); assert.equal(w.phase, 'choose'); assert.equal(w.choices.length, 3); w.resize(w.height, w.width);
      const bounds = w.arenaBounds;
      for (const c of w.choices) {
        assert.ok(c.x - c.r >= bounds.left && c.x + c.r <= bounds.right);
        assert.ok(c.y + c.r + 24 < bounds.bottom); assert.ok(c.labelWidth > 0);
      }
      const target = w.choices[1], before = w.buffs[target.id] || 0;
      Object.assign(w.player, {x: target.x, y: target.y + target.r + w.player.r - .1, vx: 0, vy: -w.unit * 20}); w.step(1 / 120);
      assert.equal(w.phase, 'reward'); assert.equal(w.buffs[target.id], before + 1); assert.equal(w.choose(target), false); advance(w, 1.001);
    }
    assert.equal(w.stage, 22); assert.equal(w.events.filter(e => e.type === 'buff').length, 2);
  }
});
