import test from 'node:test';
import assert from 'node:assert/strict';
import {World, length, BOSS_TIMING} from '../dist/physics.js';
import {UPGRADES} from '../dist/upgrades.js';

const near = (actual, expected, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
function run() {
  const w = new World(10000, 10000, () => .5, {spawnInitial: false});
  w.spawnTimer = w.floorTimer = w.introTimer = Infinity;
  Object.assign(w.player, {x: 4000, y: 4000, vx: 0, vy: 0});
  return w;
}
function enemy(w, values = {}) {
  const b = w.makeBody(6000, 6000, w.unit, 1.5);
  Object.assign(b, {enemyType: 'normal', born: 1, solid: true, hp: 10000, maxHp: 10000}, values);
  w.enemies.push(b); return b;
}
function gain(w, id, count = 1) {
  for (let i = 0; i < count; i++) assert.equal(w.applyUpgrade(id), true, `${id} layer ${i + 1}`);
}
function advance(w, seconds) {
  while (seconds > 1e-10) { const dt = Math.min(seconds, 1 / 120); w.step(dt); seconds -= dt; }
}
function headOn(w, body, speed = w.unit * 30, actor = w.player) {
  Object.assign(actor, {x: body.x - body.r - actor.r + .01, y: body.y, vx: speed, vy: 0});
  w.collide(actor, body);
}
function bounce(w, speed = w.unit * 30) {
  Object.assign(w.player, {x: 0, y: 4000, vx: -speed, vy: 0}); w.wall(w.player);
}
function splitShot(w) {
  gain(w, 'split'); w.shoot(-w.maxPull, 0);
  const speed = w.unit * 30; w.player.vx = speed; w.player.vy = 0;
  w.damage(enemy(w, {hp: 1}), 1, {impactVx: speed, impactVy: 0, impactSpeed: speed});
  return w.auxiliaries;
}

test('base upgrades retain their original layers and continue growing beyond them while finite upgrades keep their caps', () => {
  const w = run(), mass = w.player.mass;
  assert.equal(w.applyUpgrade('overspeed'), false); assert.equal(w.applyUpgrade('missing'), false);
  gain(w, 'energy', 4); near(w.energy, 1.3 ** 4);
  gain(w, 'overspeed', 2);
  w.energy = 100; w.shoot(-w.maxPull, 0); near(length(w.player), w.unit * 76);
  gain(w, 'density', 5); near(w.density, 1.35 ** 5); near(w.player.mass, mass * 1.35 ** 5);
  gain(w, 'energy'); near(w.energy, 1.3 ** 4 * 1.12);
  gain(w, 'density'); near(w.density, 1.35 ** 5 * 1.15); near(w.player.mass, mass * w.density);
  gain(w, 'overspeed'); near(w.launchCap / w.unit, 80);
  const grownMass = w.player.mass; gain(w, 'growth'); near(w.player.r, w.unit * 1.2);
  gain(w, 'growth'); near(w.player.r, w.unit * 1.4); near(w.player.mass, grownMass);
  assert.equal(w.applyUpgrade('growth'), false);
});

test('many acquired base layers remain finite and produce playable high-speed collisions', () => {
  const w = run(); gain(w, 'energy', 60); gain(w, 'density', 60); gain(w, 'overspeed', 60);
  near(w.energy, 1.3 ** 4 * (1 + .12 * 56)); near(w.density, 1.35 ** 5 * (1 + .15 * 55));
  near(w.launchCap / w.unit, 76 + 4 * Math.sqrt(58));
  assert.ok([w.energy, w.density, w.player.mass, w.launchCap, w.maxPhysicsSpeed].every(Number.isFinite));
  assert.equal(w.shoot(-w.maxPull, 0), true);
  const target = enemy(w, {x: w.player.x + w.unit * 3, y: w.player.y, hp: 100000, maxHp: 100000});
  w.step(.04);
  assert.ok(target.hp < target.maxHp, 'substeps still detect an enemy at the increased launch speed');
  assert.ok([w.player.x, w.player.y, w.player.vx, w.player.vy, target.hp].every(Number.isFinite));
});

test('normal offers contain three distinct unacquired upgrades and skipped offers do not consume layers', () => {
  const w = run();
  for (let i = 0; i < 4; i++) {
    w.phase = 'battle'; w.beginUpgrade();
    assert.equal(w.choices.length, 3); assert.equal(new Set(w.choices.map(c => c.id)).size, 3);
    assert.deepEqual(w.buffs, {});
  }
  const chosen = w.choices[0]; w.phase = 'choose';
  assert.equal(w.choose(chosen), true); assert.equal(w.buffs[chosen.id], 1);
  assert.equal(w.phase, 'reward'); assert.equal(w.choices.length, 0);
  advance(w, w.rewardTiming.rest - .01); assert.equal(w.phase, 'reward'); advance(w, .011); assert.equal(w.phase, 'battle');
});

test('selection feedback boost survives tiny and reward shots and is consumed by exactly one combat shot', () => {
  const w = run(); w.phase = 'choose'; w.choose(UPGRADES.energy);
  assert.equal(w.pendingUpgradeBoost, true);
  w.phase = 'choose'; w.player.vx = w.player.vy = 0;
  assert.equal(w.shoot(-w.maxPull, 0), true); assert.equal(w.pendingUpgradeBoost, true);
  w.phase = 'battle'; assert.equal(w.shoot(1, 0), false); assert.equal(w.pendingUpgradeBoost, true);
  assert.equal(w.shoot(-w.maxPull, 0), true); assert.equal(w.pendingUpgradeBoost, false); assert.equal(w.shotUpgradeBoost, true);
  w.damage(enemy(w, {hp: 1}), 1); assert.equal(w.events.find(e => e.type === 'kill').upgradeBoost, true);
  w.shoot(-w.maxPull, 0); assert.equal(w.shotUpgradeBoost, false);
  w.damage(enemy(w, {hp: 1}), 1); assert.equal(w.events.filter(e => e.type === 'kill').at(-1).upgradeBoost, false);
  w.phase = 'choose'; w.choose(UPGRADES.density); w.phase = 'battle'; w.shoot(-w.maxPull, 0);
  w.stageKills = w.killTarget - 1; w.damage(enemy(w, {hp: 1}), 1);
  assert.equal(w.events.filter(e => e.type === 'kill').at(-1).upgradeBoost, true);
  w.step(1 / 120); assert.equal(w.shotUpgradeBoost, false, 'the old combat boost cannot leak through clearing into reward travel');
  w.pendingUpgradeBoost = true; w.phase = 'battle'; w.beginUpgrade();
  assert.equal(w.pendingUpgradeBoost, true, 'a future unspent selection boost survives cleanup');
  const boss = run(); boss.pendingUpgradeBoost = true; boss.stage = 5; boss.beginBoss(); advance(boss, BOSS_TIMING.entry);
  assert.equal(boss.shoot(-boss.maxPull, 0), true); assert.equal(boss.pendingUpgradeBoost, false); assert.equal(boss.shotUpgradeBoost, true);
});

test('gambler raises only the next stage quota and adds one three-choice reward before advancing', () => {
  const w = run(); w.phase = 'choose'; w.choose(UPGRADES.gambler); advance(w, 1.001);
  assert.equal(w.stage, 2); assert.equal(w.killTarget, 27); assert.equal(w.buffs.gambler, 1);
  w.beginUpgrade(); assert.equal(w.upgradeRoundTotal, 2); assert.equal(w.gamblerRewardPending, false);
  for (let round = 1; round <= 2; round++) {
    assert.equal(w.upgradeRound, round); assert.equal(w.choices.length, 3);
    assert.equal(new Set(w.choices.map(c => c.id)).size, 3);
    w.phase = 'choose'; w.choose(w.choices.find(c => c.id !== 'gambler')); advance(w, 1.001);
    assert.equal(w.stage, round === 1 ? 2 : 3);
  }
  assert.equal(w.killTarget, 22); w.beginUpgrade(); assert.equal(w.upgradeRoundTotal, 1);
  w.phase = 'choose'; w.choose(UPGRADES.gambler); advance(w, 1.001);
  assert.equal(w.stage, 4); assert.equal(w.killTarget, 39); assert.equal(w.buffs.gambler, 2);
  w.beginUpgrade(); assert.equal(w.upgradeRoundTotal, 2);
  w.phase = 'choose'; assert.equal(w.choose(UPGRADES.gambler), true); advance(w, 1.001);
  assert.equal(w.stage, 4); assert.equal(w.upgradeRound, 2); assert.equal(w.buffs.gambler, 3);
  assert.ok(w.choices.every(c => c.id !== 'gambler'));
  w.phase = 'choose'; w.choose(w.choices[0]); advance(w, 1.001);
  assert.equal(w.stage, 5); assert.equal(w.killTarget, 45);
  w.beginUpgrade({bypassBoss: true}); assert.equal(w.upgradeRoundTotal, 2);
  for (let round = 1; round <= 2; round++) {
    w.phase = 'choose'; w.choose(w.choices.find(c => c.id !== 'gambler')); advance(w, 1.001);
  }
  assert.equal(w.stage, 6); assert.equal(w.killTarget, 34);
  w.beginUpgrade(); assert.equal(w.upgradeRoundTotal, 1); assert.equal(w.choices.length, 3);
});

test('a repeat wager cannot stack during three Boss rewards and becomes available after the next stage begins', () => {
  const w = run(); w.stage = 19; w.phase = 'choose'; w.choose(UPGRADES.gambler); advance(w, 1.001);
  assert.equal(w.stage, 20); assert.equal(w.gamblerRewardPending, true); assert.equal(w.gamblerTargetMultiplier, 1.5);
  w.random = () => 0;
  w.beginBoss(); w.boss.defeated = true; w.phase = 'boss-celebrate'; w.beginUpgrade({bypassBoss: true});
  assert.equal(w.upgradeRoundTotal, 3); assert.equal(w.choices.length, 3); assert.equal(w.gamblerRewardPending, false);
  assert.ok(w.choices.some(c => c.id === 'gambler'));
  w.phase = 'choose'; assert.equal(w.choose(w.choices.find(c => c.id === 'gambler')), true); advance(w, 1.001);
  for (let round = 2; round <= 3; round++) {
    assert.equal(w.stage, 20); assert.equal(w.upgradeRound, round); assert.equal(w.choices.length, 3);
    assert.equal(w.nextGambler, true); assert.ok(w.choices.every(c => c.id !== 'gambler'));
    assert.ok(w.choices.some(c => c.kind !== 'risk'));
    assert.equal(w.applyUpgrade('gambler'), false); assert.equal(w.buffs.gambler, 2);
    w.phase = 'choose'; w.choose(w.choices[0]); advance(w, 1.001);
  }
  assert.equal(w.stage, 21); assert.equal(w.nextGambler, false); assert.equal(w.gamblerTargetMultiplier, 1.5);
  assert.equal(w.killTarget, 141); assert.equal(w.gamblerRewardPending, true);
  w.beginUpgrade(); assert.equal(w.upgradeRoundTotal, 2); assert.equal(w.choices.length, 3);
  assert.ok(w.choices.some(c => c.id === 'gambler'));
  w.phase = 'choose'; assert.equal(w.choose(w.choices.find(c => c.id === 'gambler')), true);
  assert.equal(w.buffs.gambler, 3);
});

test('rubber raises the solved-direction retention floor while pierce keeps the incoming direction', () => {
  for (let layers = 0; layers <= 4; layers++) {
    const w = run(); gain(w, 'rubber', layers);
    const b = enemy(w); headOn(w, b); near(length(w.player), w.unit * 30 * Math.min(1, .7 + .08 * layers));
    assert.ok(w.player.vx > 0); near(w.player.vy, 0);
  }
  const w = run(); gain(w, 'pierce');
  const b = enemy(w, {x: 4060, y: 4020}); Object.assign(w.player, {vx: 600, vy: 0}); w.collide(w.player, b);
  near(w.player.vy, 0); assert.ok(w.player.vx >= 600 * .92); assert.equal(w.applyUpgrade('pierce'), false);
});

test('penetration recovers the release speed lost to friction only on the first kill of a successful shot', () => {
  const w = run(); gain(w, 'penetration'); w.shoot(-w.maxPull, 0);
  const released = length(w.player); advance(w, .7); const slowed = length(w.player);
  assert.ok(slowed < released);
  headOn(w, enemy(w, {hp: 1}), slowed); near(length(w.player), released);
  headOn(w, enemy(w, {hp: 1}), slowed); near(length(w.player), slowed * .85);
  assert.equal(w.shoot(1, 0), false);
  headOn(w, enemy(w, {hp: 1}), slowed); near(length(w.player), slowed * .85);
  assert.equal(w.shoot(-w.maxPull, 0), true); const nextRelease = length(w.player);
  headOn(w, enemy(w, {hp: 1}), nextRelease * .5); near(length(w.player), nextRelease);
});

test('a pulse first kill recovers the main ball after a nonlethal direct impact and spends the only recovery', () => {
  const w = run(); gain(w, 'penetration'); gain(w, 'pulse');
  w.shoot(-w.maxPull, 0); const released = length(w.player);
  const direct = enemy(w, {x: 5000, y: 4000}), nearby = enemy(w, {x: 5000 + w.unit * 2.5, y: 4000, hp: 1});
  const speed = released * .6; headOn(w, direct, speed);
  assert.ok(direct.hp > 0); assert.ok(nearby.hp <= 0); assert.equal(w.shotKills, 1); near(length(w.player), released);
  w.buffs.pulse = 0; headOn(w, enemy(w, {hp: 1}), speed); near(length(w.player), speed * .85);
});

test('penetration still recovers lost travel speed with four rubber layers and does not change impact damage', () => {
  const withRecovery = run(), withoutRecovery = run();
  for (const w of [withRecovery, withoutRecovery]) { gain(w, 'rubber', 4); w.shoot(-w.maxPull, 0); }
  gain(withRecovery, 'penetration');
  const released = length(withRecovery.player), speed = released * .55;
  for (const w of [withRecovery, withoutRecovery]) headOn(w, enemy(w, {hp: 1}), speed);
  near(length(withRecovery.player), released); near(length(withoutRecovery.player), speed);
  const hit = w => w.events.filter(e => e.type === 'hit').at(-1);
  assert.equal(hit(withRecovery).damage, hit(withoutRecovery).damage);
});

test('penetration records the actual short release and ignores hits or shield breaks without a kill', () => {
  const w = run(); gain(w, 'penetration');
  assert.equal(w.shoot(-w.maxPull * .35, 0), true);
  const released = length(w.player), speed = released * .8;
  assert.ok(released < w.baseSpeed * .5);
  headOn(w, enemy(w), speed); near(length(w.player), speed * .7); assert.equal(w.shotKills, 0);
  headOn(w, enemy(w, {shield: true, hp: 1}), speed); near(length(w.player), speed * .7); assert.equal(w.shotKills, 0);
  headOn(w, enemy(w, {hp: 1}), speed); near(length(w.player), released);
});

test('penetration applies only the boomerang multiplier active at the kill without extending its timer', () => {
  for (const activeAtShot of [false, true]) for (const activeAtKill of [false, true]) {
    const w = run(); gain(w, 'penetration'); gain(w, 'boomerang');
    if (activeAtShot) { bounce(w, w.unit * 10); w.player.x = 4000; }
    w.shoot(-w.maxPull, 0);
    const releaseBase = length(w.player) / (activeAtShot ? 1.3 : 1);
    if (activeAtShot && !activeAtKill) w.advanceBoomerang(w.player, .8);
    if (!activeAtShot && activeAtKill) bounce(w, releaseBase * .4);
    const timeBefore = w.player.boomerangTime || 0;
    headOn(w, enemy(w, {hp: 1}), releaseBase * .4 * (activeAtKill ? 1.3 : 1));
    near(length(w.player), releaseBase * (activeAtKill ? 1.3 : 1));
    near(w.player.boomerangTime || 0, timeBefore);
    if (activeAtKill) { w.advanceBoomerang(w.player, timeBefore); near(length(w.player), releaseBase); }
  }
});

test('penetration leaves a faster resolved velocity intact and consumes that shot recovery', () => {
  const w = run(); gain(w, 'penetration'); w.shoot(-w.maxPull * .5, 0);
  const released = length(w.player), fast = released * 2;
  headOn(w, enemy(w, {hp: 1}), fast); near(length(w.player), fast * .85);
  headOn(w, enemy(w, {hp: 1}), released * .5); near(length(w.player), released * .5 * .85);
});

test('penetration uses resized world units and the resolved collision direction', () => {
  const w = run(); gain(w, 'penetration'); w.shoot(-w.maxPull, 0);
  const releaseUnits = length(w.player) / w.unit, oldUnit = w.unit;
  w.resize(400, 600); assert.ok(w.unit < oldUnit);
  const heavy = enemy(w, {x: 240, y: 250, hp: 1, mass: 1000});
  headOn(w, heavy, releaseUnits * w.unit * .5);
  near(length(w.player), releaseUnits * w.unit);
  assert.ok(w.player.vx < 0, 'the heavy-target rebound remains opposite to release aim'); near(w.player.vy, 0);
});

test('shockwave first kills recover only the main ball and use its current direction or stopped release aim', () => {
  for (const stopped of [false, true]) {
    const w = run(); gain(w, 'penetration'); gain(w, 'shockwave');
    w.shoot(0, -w.maxPull); const released = length(w.player);
    Object.assign(w.player, {vx: stopped ? 0 : -released * .4, vy: 0});
    enemy(w, {x: w.player.x + w.unit * 2, y: w.player.y, hp: 1});
    w.releaseShockwave(); assert.equal(w.shotKills, 1); near(length(w.player), released);
    near(w.player.vx, stopped ? 0 : -released); near(w.player.vy, stopped ? released : 0);
  }
});

test('auxiliary shockwave first kills restore the main ball without accelerating the split', () => {
  const w = run(); gain(w, 'penetration'); gain(w, 'split'); gain(w, 'shockwave');
  w.shoot(-w.maxPull, 0); const released = length(w.player);
  w.spawnAuxiliaries({impactVx: released, impactVy: 0}); const child = w.auxiliaries[0];
  const childSpeed = length(child); w.player.vx = released * .4;
  enemy(w, {x: child.x + w.unit * 2, y: child.y, hp: 1});
  w.releaseShockwave(child);
  near(length(w.player), released); near(length(child), childSpeed); assert.equal(w.shotKills, 1);
});

test('a recovery kill keeps newly spawned splits at their original impact-speed fraction', () => {
  const w = run(); gain(w, 'penetration'); gain(w, 'split'); w.shoot(-w.maxPull, 0);
  const released = length(w.player), impactSpeed = released * .5;
  headOn(w, enemy(w, {hp: 1}), impactSpeed);
  near(length(w.player), released); assert.equal(w.auxiliaries.length, 2);
  for (const child of w.auxiliaries) near(length(child), impactSpeed * .6);
  const child = w.auxiliaries[0]; w.player.vx = released * .4;
  headOn(w, enemy(w, {hp: 1}), impactSpeed * .6, child);
  near(length(w.player), released * .4); near(length(child), impactSpeed * .6 * .85);
});

test('a Boss first kill recovers its resolved rebound and still follows the existing celebration brake', () => {
  const w = run(); gain(w, 'penetration'); w.stage = 5; w.beginBoss(); advance(w, BOSS_TIMING.entry);
  Object.assign(w.player, {vx: 0, vy: 0}); w.shoot(-w.maxPull, 0); const released = length(w.player);
  const b = w.boss; Object.assign(b, {r: b.minRadius, stunned: true, hp: 1});
  Object.assign(w.player, {x: b.x - b.r - w.player.r + .01, y: b.y, vx: released * .5, vy: 0});
  w.collideBoss(); assert.equal(w.phase, 'boss-celebrate'); assert.equal(w.shotKills, 1);
  near(w.player.vx, -released); near(w.player.vy, 0);
  advance(w, w.bossVictorySlowTime + BOSS_TIMING.brake + .01); near(length(w.player), 0);
});

test('clearing a boomerang boost leaves the saved release base unchanged and cannot reset a spent recovery', () => {
  const w = run(); gain(w, 'penetration'); gain(w, 'boomerang');
  bounce(w, w.unit * 10); w.player.x = 4000; w.shoot(-w.maxPull, 0);
  const releaseBase = length(w.player) / 1.3;
  w.clearEnemies(); near(w.player.boomerangTime, 0); near(length(w.player), releaseBase);
  headOn(w, enemy(w, {hp: 1}), releaseBase * .5); near(length(w.player), releaseBase);
  w.clearEnemies(); headOn(w, enemy(w, {hp: 1}), releaseBase * .5);
  near(length(w.player), releaseBase * .5 * .85);
});

test('penetration cannot fabricate a launch reference before any successful shot', () => {
  const w = run(); gain(w, 'penetration');
  assert.equal(w.shoot(1, 0), false);
  const speed = w.unit * 20;
  headOn(w, enemy(w, {hp: 1}), speed); near(length(w.player), speed * .85);
  assert.equal(w.shotRelease, null);
});

test('boomerang refreshes its 0.8-second window without multiplying again on another wall', () => {
  const w = run(); gain(w, 'boomerang'); bounce(w);
  near(length(w.player), w.unit * 30 * .95 * 1.3);
  w.player.x = 4000; advance(w, .25); const before = length(w.player);
  bounce(w, before); near(length(w.player), before * .95);
  w.player.x = 4000; const refreshed = length(w.player);
  advance(w, .79); near(length(w.player), refreshed * Math.exp(-.35 * .79));
  advance(w, .01); near(length(w.player), refreshed / 1.3 * Math.exp(-.35 * .8));
});

test('shooting during boomerang computes from unboosted current speed and expiry preserves the new shot', () => {
  const w = run(); gain(w, 'boomerang'); bounce(w); w.player.x = 4000;
  const baseCurrent = length(w.player) / 1.3;
  const redirected = Math.max(baseCurrent, w.baseSpeed * (1 - .5 * Math.min(1, baseCurrent / w.baseSpeed)));
  w.shoot(0, -w.maxPull); near(w.player.vx, 0); near(w.player.vy, redirected * 1.3);
  advance(w, .8); near(w.player.vy, redirected * Math.exp(-.35 * .8));
  w.shoot(-w.maxPull, 0); const afterExpiryShot = length(w.player);
  advance(w, .2); near(length(w.player), afterExpiryShot * Math.exp(-.35 * .2));
});

test('first kill spawns exactly two physical auxiliaries at sixty-percent speed and twenty-degree angles', () => {
  const w = run(), children = splitShot(w), speed = w.unit * 30;
  assert.equal(children.length, 2);
  for (const [i, child] of children.entries()) {
    assert.equal(child.isAuxiliary, true); assert.equal(child.solid, true);
    near(child.r, w.unit * .7); near(length(child), speed * .6);
    near(Math.atan2(child.vy, child.vx), (i ? 1 : -1) * Math.PI / 9);
  }
  const ids = children.map(b => b.id); w.damage(enemy(w, {hp: 1}), 1);
  assert.deepEqual(w.auxiliaries.map(b => b.id), ids);
  w.shoot(-w.maxPull, 0); assert.equal(w.auxiliaries.length, 0);
  w.damage(enemy(w, {hp: 1}), 1); assert.equal(w.auxiliaries.length, 2);
  assert.ok(w.auxiliaries.every(b => !ids.includes(b.id)));
});

test('auxiliary damage is sixty percent of the captured main-ball reference, not its reduced mass or squared speed', () => {
  const w = run(); gain(w, 'density', 2); const sourceMass = w.player.mass;
  const [child] = splitShot(w); near(child.sourceMass, sourceMass);
  const target = enemy(w, {mass: .8}), referenceSpeed = w.unit * 30;
  w.player.mass *= 5;
  headOn(w, target, referenceSpeed * .6, child);
  const reducedMass = 1 / (1 / sourceMass + 1 / target.mass);
  const expected = Math.round(.5 * reducedMass * 30 ** 2 * .31 * .6);
  assert.equal(10000 - target.hp, expected);
  const hit = w.events.filter(e => e.type === 'hit').at(-1);
  assert.equal(hit.auxiliary, true); near(hit.impactSpeed, referenceSpeed * .6);
});

test('auxiliary contacts freeze their own pair and each player ball is attracted from its own position', () => {
  const w = run(), [child, sibling] = splitShot(w); w.setFeedbackOptions({strength: 1});
  const target = enemy(w, {hp: 100, maxHp: 100, mass: .8}); headOn(w, target, w.unit * 18, child);
  near(child.feedbackFreeze, .025); near(target.feedbackFreeze, .025); near(w.player.feedbackFreeze || 0, 0);
  const childX = child.x, targetX = target.x, playerX = w.player.x, siblingX = sibling.x;
  w.step(.01); near(child.x, childX); near(target.x, targetX);
  assert.ok(w.player.x > playerX); assert.ok(sibling.x > siblingX);

  const magnetic = run(), [left, right] = splitShot(magnetic);
  magnetic.enemies = [];
  enemy(magnetic, {enemyType: 'magnet', x: 4000, y: 4000, vx: 0, vy: 0});
  Object.assign(magnetic.player, {x: 4000, y: 4000 + magnetic.unit * 3, vx: 0, vy: 0});
  Object.assign(left, {x: 4000 - magnetic.unit * 3, y: 4000, vx: 0, vy: 0});
  Object.assign(right, {x: 4000 + magnetic.unit * 3, y: 4000, vx: 0, vy: 0});
  magnetic.step(.01);
  assert.ok(left.vx > 0); near(left.vy, 0); assert.ok(right.vx < 0); near(right.vy, 0);
  near(magnetic.player.vx, 0); assert.ok(magnetic.player.vy < 0);
});

test('auxiliaries expire after continuous low speed and leave with a new shot or clearing or Boss entry', () => {
  const w = run(); splitShot(w);
  for (const child of w.auxiliaries) { child.vx = w.unit * 2; child.vy = 0; }
  advance(w, .399); assert.equal(w.auxiliaries.length, 2);
  advance(w, .001); assert.equal(w.auxiliaries.length, 0);
  for (const finish of [world => world.shoot(-world.maxPull, 0), world => world.beginClearing(), world => world.beginUpgrade()]) {
    const current = run(); splitShot(current); assert.equal(current.auxiliaries.length, 2);
    finish(current); assert.equal(current.auxiliaries.length, 0);
  }
  const retained = run(); splitShot(retained);const children=retained.auxiliaries.slice();
  retained.stage=5;retained.beginBoss();assert.deepEqual(retained.auxiliaries,[]);
  const before=children.map(b=>({x:b.x,y:b.y}));retained.step(.01);
  assert.equal(retained.auxiliaries.length,0);assert.ok(children.every((b,i)=>b.x===before[i].x&&b.y===before[i].y));
});

test('magnet pulls the nearest solid enemy by the layered distance and never crosses the player boundary', () => {
  for (const layers of [1, 2]) {
    const w = run(); gain(w, 'magnet', layers); const x = w.player.x;
    const target = enemy(w, {x: x + w.unit * 8, y: w.player.y});
    const other = enemy(w, {x: x - w.unit * 10, y: w.player.y});
    enemy(w, {x: x + w.unit, y: w.player.y, born: 0, solid: false});
    w.damage(enemy(w, {hp: 1}), 1); const otherX = other.x;
    advance(w, .6); near(target.x, x + w.unit * (8 - 2.5 * layers)); near(other.x, otherX);
    const close = enemy(w, {x: x + w.player.r + w.unit + 1, y: w.player.y});
    w.damage(enemy(w, {hp: 1}), 1); advance(w, .6);
    assert.ok(Math.hypot(close.x - w.player.x, close.y - w.player.y) >= close.r + w.player.r);
  }
});

test('magnet does not move its selected target through a local hit hold', () => {
  const w = run(); gain(w, 'magnet');
  const target = enemy(w, {x: w.player.x + w.unit * 8, y: w.player.y, feedbackFreeze: .025});
  w.damage(enemy(w, {hp: 1}), 1); const x = target.x;
  w.step(.02); near(target.x, x); w.step(.005); near(target.x, x);
  w.step(.01); assert.ok(target.x < x);
});

test('shockwave happens on every second actual wall and deals 75% full-pull damage to each in-range target', () => {
  const w = run(); gain(w, 'shockwave'); const anchor = w.inset + w.player.r;
  const first = enemy(w, {x: anchor + w.unit * 2, y: 4000, mass: .8});
  const second = enemy(w, {x: anchor, y: 4000 + w.unit * 2, mass: 2.5});
  const outside = enemy(w, {x: anchor + w.unit * 4.1, y: 4000});
  bounce(w); assert.equal(first.hp, 10000); assert.equal(second.hp, 10000);
  bounce(w);
  for (const body of [first, second]) {
    const mass = 1 / (1 / w.player.mass + 1 / body.mass);
    assert.equal(10000 - body.hp, Math.round(.5 * mass * 40 ** 2 * .31 * .75));
  }
  assert.equal(outside.hp, 10000); assert.equal(w.events.filter(e => e.type === 'shockwave').length, 1);
  w.shoot(-w.maxPull, 0); bounce(w); assert.equal(w.events.filter(e => e.type === 'shockwave').length, 1);
  bounce(w); assert.equal(w.events.filter(e => e.type === 'shockwave').length, 2);
});

test('the shared second wall releases shockwave at the actual auxiliary and freezes only that impact pair', () => {
  const w = run(), [child] = splitShot(w); gain(w, 'shockwave');
  w.setFeedbackOptions({strength: 1});
  bounce(w); assert.equal(w.shotWallCount, 1);
  const nearMain = enemy(w, {x: w.player.x + w.unit * 2, y: w.player.y, hp: 300, maxHp: 300});
  const childX = w.inset + child.r;
  const nearChild = enemy(w, {x: childX + w.unit * 2, y: 2000, hp: 300, maxHp: 300});
  Object.assign(child, {x: 0, y: 2000, vx: -w.unit * 30, vy: 0}); w.wall(child);
  assert.equal(w.shotWallCount, 2);
  const shock = w.events.find(e => e.type === 'shockwave'); near(shock.x, child.x); near(shock.y, child.y);
  const reducedMass = 1 / (1 / w.player.mass + 1 / nearChild.mass);
  assert.equal(300 - nearChild.hp, Math.round(.5 * reducedMass * 40 ** 2 * .31 * .75));
  assert.equal(nearMain.hp, 300, 'the primary player position is outside this auxiliary shockwave');
  near(child.feedbackFreeze, .035); near(nearChild.feedbackFreeze, .035); near(w.player.feedbackFreeze || 0, 0);
  const mainX = w.player.x, frozenX = child.x, frozenTargetX = nearChild.x;
  w.step(.01); assert.ok(w.player.x > mainX); near(child.x, frozenX); near(nearChild.x, frozenTargetX);
});

test('effective area damage counts as a hit for missed-shot attribution while zero damage does not', () => {
  const w = run(); gain(w, 'shockwave'); w.shoot(-w.maxPull, 0);
  const target = enemy(w, {x: w.inset + w.player.r + w.unit * 2, y: 4000});
  assert.equal(w.resultMisses, 1); bounce(w); assert.equal(w.activeShot.hits, 0);
  bounce(w); assert.ok(target.hp < target.maxHp); assert.equal(w.activeShot.hits, 1); assert.equal(w.resultMisses, 0);

  const pulse = run(); pulse.shoot(-pulse.maxPull, 0); const pulseTarget = enemy(pulse);
  pulse.damage(pulseTarget, 0, {source: 'pulse'}); assert.equal(pulse.activeShot.hits, 0); assert.equal(pulse.resultMisses, 1);
  pulse.damage(pulseTarget, 1, {source: 'pulse'}); assert.equal(pulse.activeShot.hits, 1); assert.equal(pulse.resultMisses, 0);
});

test('removed risk cannot alter ordinary and clear awards, including combo and bank bonuses', () => {
  const w = run(); w.buffs.risk = 2; assert.equal(w.applyUpgrade('risk'), false); bounce(w);
  w.damage(enemy(w, {hp: 1}), 1); w.damage(enemy(w, {hp: 1}), 1);
  assert.deepEqual(w.events.filter(e => e.type === 'kill').map(e => e.value), [15, 30]); assert.equal(w.score, 45);
  const clear = run(); clear.buffs.risk = 2; clear.stageKills = clear.killTarget - 1;
  clear.damage(enemy(clear, {x: 4000, y: 3000, hp: 1}), 1);
  enemy(clear, {x: 4100, y: 3000}); enemy(clear, {x: 4200, y: 3000});
  while (clear.phase === 'battle' || clear.phase === 'clearing') clear.step(1 / 120);
  assert.deepEqual(clear.events.filter(e => e.type === 'clearKill').map(e => e.value), [10, 10]);
  assert.equal(clear.score, 30); assert.equal(clear.stageKills, 14);
});

test('removed risk cannot alter boss segment and final rewards', () => {
  const w = run(); w.buffs.risk = 2; w.stage = 10; w.beginBoss({type:'inflation'}); advance(w, BOSS_TIMING.entry);
  w.boss.r = w.boss.minRadius + .001; w.damageBoss(w.baseSpeed);
  assert.equal(w.boss.stunned, true); assert.deepEqual(w.events.filter(e => e.type === 'bossScore').map(e => e.value), Array(5).fill(110));
  w.damageBoss(w.baseSpeed * 20); assert.equal(w.phase, 'boss-celebrate');
  assert.equal(w.events.find(e => e.type === 'bossDefeated').value, 550); assert.equal(w.score, 1100);
});

test('breath slows the wave start clock for 2.5 seconds and leaves in-wave spacing unchanged', () => {
  const w = run(); gain(w, 'breath'); w.spawnTimer = 0; w.advanceSpawning(.001);
  assert.equal(w.enemies.length, 1); const firstTimer = w.wave.timer;
  w.damage(enemy(w, {hp: 1}), 1); near(w.breathTime, 2.5);
  const startTimer = w.spawnTimer; w.advanceSpawning(.3);
  near(w.spawnTimer, startTimer - .2); near(w.wave.timer, firstTimer); near(w.breathTime, 2.2);
  assert.equal(w.events.filter(e => e.type === 'spawn').length, 2);
  w.advanceSpawning(2.3); near(w.breathTime, 0); near(w.spawnTimer, startTimer - .2 - 2.2 * 2 / 3 - .1);
});

test('repeated frenzy stacks wave pressure and keeps a twelve-kill combo cap', () => {
  const w = run(), interval = w.spawnInterval; gain(w, 'frenzy', 5); near(w.spawnInterval, interval); assert.equal(w.waveSize, 10); assert.equal(w.comboCap, 12);
  w.spawnTimer = 0; w.advanceSpawning(.001); near(w.spawnTimer, w.waveSize * w.spawnInterval * .7 * .9 ** 4 - .001);
  w.enemies = []; w.wave = null; w.spawnTimer = Infinity;
  for (let i = 0; i < 13; i++) w.damage(enemy(w, {hp: 1}), 1);
  assert.deepEqual(w.events.filter(e => e.type === 'kill').slice(-3).map(e => e.value), [165, 180, 180]);
  assert.equal(w.stageKills, 13); assert.equal(w.phase, 'battle');
});

test('offer context survives the sweep and uses the widened efficiency window in actual reward selection', () => {
  const w = run(); w.stage = 4;
  for (let i = 0; i < 10; i++) w.shoot(-w.maxPull, 0);
  w.stageRealKills = 12; w.stageKills = w.killTarget - 1;
  enemy(w, {x: 4100, y: 3000, enemyType: 'ring'}); enemy(w, {x: 4200, y: 3000, enemyType: 'heavy'});
  enemy(w, {x: 4300, y: 3000}); enemy(w, {x: 4400, y: 3000});
  w.damage(enemy(w, {x: 4000, y: 3000, hp: 1}), 1); w.step(1 / 120);
  assert.equal(w.phase, 'clearing');
  const expected = {stage: 4, hardEnemyShare: .5, nextBoss: true, completedShots: 10, averageKillsPerShot: 1.3};
  assert.deepEqual(w.upgradeContext, expected);
  // This draw falls into pulse with the 1.3-kill efficiency boost, but pierce
  // without it; the snapshot must still drive the offer after all targets vanish.
  w.random = () => .08;
  while (w.phase === 'clearing') w.step(1 / 120);
  assert.equal(w.enemies.length, 0); assert.equal(w.choices.length, 3); assert.deepEqual(w.upgradeContext, expected);
  assert.equal(w.choices[1].id, 'pulse');
  w.phase = 'choose'; w.choose(w.choices[0]); advance(w, 1.001); assert.equal(w.upgradeContext, null);
});

test('a late fully developed build keeps real upgrade choices without exhausting its pool', () => {
  const w = run();
  for (const upgrade of Object.values(UPGRADES)) {
    if (upgrade.id !== 'gambler') gain(w, upgrade.id, Number.isFinite(upgrade.maxStacks) ? upgrade.maxStacks : 60);
  }
  w.stage = 21;
  const acquired = {...w.buffs}; w.beginUpgrade();
  assert.equal(w.phase, 'transition'); assert.equal(w.choices.length, 3); assert.deepEqual(w.buffs, acquired);
  assert.equal(new Set(w.choices.map(c => c.id)).size, 3);
  assert.ok(w.choices.every(c => ['energy', 'density', 'overspeed', 'frenzy', 'gambler'].includes(c.id)));
  assert.equal(w.events.filter(e => e.type === 'upgradeSkipped').length, 0);
  w.phase = 'choose'; const choice = w.choices[0]; assert.equal(w.choose(choice), true);
  assert.equal(w.buffs[choice.id], (acquired[choice.id] || 0) + 1);
  advance(w, 1.001); assert.equal(w.phase, 'battle'); assert.equal(w.stage, 22); assert.equal(w.score, 0);
});



test('each three-choice gambler reward fits narrow and landscape viewports with separate hit areas and player space', () => {
  for (const [width, height] of [[320, 568], [844, 390]]) {
    const w = new World(width, height, () => .5, {spawnInitial: false});
    w.gamblerRewardPending = true; w.beginUpgrade(); assert.equal(w.choices.length, 3); assert.equal(w.upgradeRoundTotal, 2);
    const bounds = w.arenaBounds;
    for (const choice of w.choices) {
      assert.ok(choice.x - choice.r >= bounds.left); assert.ok(choice.x + choice.r <= bounds.right);
      assert.ok(choice.y - choice.r >= bounds.top); assert.ok(choice.y + choice.r + 24 < bounds.bottom);
      assert.ok(choice.labelWidth > 0);
      assert.ok(Math.hypot(choice.x - width / 2, choice.y - w.choicePlayerY) > choice.r + w.player.r);
    }
    for (let i = 0; i < w.choices.length; i++) for (let j = i + 1; j < w.choices.length; j++) {
      const a = w.choices[i], b = w.choices[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > (a.r + b.r) * 1.2, `${width}x${height}: ${a.id}/${b.id}`);
    }
    advance(w, 1.86); assert.equal(w.phase, 'choose');
    near(w.player.x, width / 2); near(w.player.y, w.choicePlayerY);
    for (const choice of w.choices) assert.ok(Math.hypot(choice.x - w.player.x, choice.y - w.player.y) > choice.r + w.player.r);
  }
});




test('each three-choice gambler offer can be struck once and emits the common kill-fragment contact data',()=>{
  for(const [width,height] of [[390,844],[844,390]])for(let index=0;index<3;index++){
    const w=new World(width,height,()=>.5,{spawnInitial:false});w.gamblerRewardPending=true;w.beginUpgrade();advance(w,1.86);
    const c={...w.choices[index]},p=w.player,score=w.score,kills=w.totalKills,stageKills=w.stageKills;
    const dx=c.x-p.x,dy=c.y-p.y,distance=Math.hypot(dx,dy);
    assert.ok(w.beginPull());assert.ok(w.shoot(-dx/distance*w.maxPull,-dy/distance*w.maxPull));
    for(let i=0;i<360&&w.phase==='choose';i++)w.step(1/120);
    const events=w.events.filter(e=>e.type==='buff');assert.equal(events.length,1);const e=events[0];
    assert.equal(e.buff.id,c.id);assert.equal(e.bodySnapshot.id,c.id);assert.equal(e.bodySnapshot.hp,0);
    near(e.x,c.x);near(e.y,c.y);near(e.r,c.r);near(Math.hypot(e.nx,e.ny),1);
    near(e.contactX,e.x-e.nx*e.r);near(e.contactY,e.y-e.ny*e.r);
    assert.ok(e.impactSpeed>0&&e.power>0);near(e.impactSpeed,Math.hypot(e.impactVx,e.impactVy));assert.equal(e.feedbackLevel,1);
    assert.equal(w.score,score);assert.equal(w.totalKills,kills);assert.equal(w.stageKills,stageKills);
    assert.equal(w.choose(c),false);assert.equal(w.events.filter(e=>e.type==='buff').length,1);
  }
});

test('normal three-choice rewards retain one upper row and produce the same contact feedback',()=>{
  const w=new World(390,844,()=>.5,{spawnInitial:false});w.beginUpgrade();advance(w,1.86);
  assert.equal(w.choices.length,3);assert.ok(w.choices.every(c=>c.y<w.player.y));near(w.choices[0].y,w.choices[2].y);
  const c=w.choices[1];Object.assign(w.player,{x:c.x,y:c.y+c.r+w.player.r-.1,vx:0,vy:-w.unit*20});w.step(1/120);
  const e=w.events.find(e=>e.type==='buff');assert.ok(e);assert.equal(e.buff.id,c.id);assert.equal(e.ny,-1);assert.ok(e.impactSpeed>0);
  assert.equal(w.events.filter(e=>e.type==='kill').length,0);
});




test('removed risk cannot raise enemy HP or affect split offspring and spawn cadence', () => {
  for (const layers of [1, 2]) {
    const w = run(); w.stage = 13; w.time = 91;
    const interval = w.spawnInterval, waveInterval = w.waveInterval;
    const existing = w.spawnEnemy(null, 'normal'), originalHp = existing.hp;
    w.buffs.risk = layers;
    near(w.spawnInterval, interval); near(w.waveInterval, waveInterval); near(existing.hp, originalHp);
    const next = w.spawnEnemy(null, 'normal'); near(next.maxHp, originalHp);
    const mother = w.spawnEnemy(null, 'split'); mother.born = 1; mother.solid = true;
    w.damage(mother, 1e9); w.flushFragments();
    const children = w.enemies.filter(body => body.enemyType === 'fragment');
    assert.equal(children.length, 3);
    for (const child of children) near(child.maxHp, mother.maxHp * .3);
  }
});

test('removed risk remains inert in Boss calculations', () => {
  const plain = run(), risky = run(); risky.buffs.risk = 2;
  for (const w of [plain, risky]) {
    w.stage = 10; w.beginBoss(); advance(w, BOSS_TIMING.entry);
    w.boss.r = w.boss.minRadius + .001; w.damageBoss(w.baseSpeed);
  }
  near(risky.boss.hp, plain.boss.hp); near(risky.boss.inflationRate, plain.boss.inflationRate);
  assert.equal(risky.scoreValue(100), 100);
});

test('v7.3 growth adds ten percent per layer to direct, pulse and full-pull area damage without changing mass or launch', () => {
  for (const layers of [0, 1, 2]) {
    const w = run(); gain(w, 'density', 2); gain(w, 'energy', 2);
    const mass = w.player.mass; gain(w, 'growth', layers); gain(w, 'pulse');
    w.shoot(-w.maxPull, 0); const speed = length(w.player);
    near(speed, Math.min(w.launchCap, w.baseSpeed * Math.sqrt(w.energy))); near(w.player.mass, mass);
    const direct = enemy(w, {x: 6000, y: 6000});
    const collateral = enemy(w, {x: direct.x, y: direct.y + w.unit * 2});
    const reducedMass = 1 / (1 / mass + 1 / direct.mass);
    const reference = .5 * reducedMass * (speed / w.unit) ** 2 * .31 * (1 + .1 * layers);
    near(w.fullPullDamage(direct), reference); headOn(w, direct, speed);
    const actual = Math.round(reference); assert.equal(10000 - direct.hp, actual);
    assert.equal(10000 - collateral.hp, Math.round(actual * .3));
    w.buffs.pulse = 0; const area = enemy(w, {x: w.player.x, y: w.player.y + w.unit * 2});
    w.releaseShockwave(); assert.equal(10000 - area.hp, Math.round(reference * .75));
  }
});

test('v7.3 growth reaches split-ball damage exactly once', () => {
  for (const layers of [1, 2]) {
    const w = run(); gain(w, 'growth', layers); gain(w, 'density', 2);
    const [child] = splitShot(w), target = enemy(w, {mass: .8});
    const reducedMass = 1 / (1 / child.sourceMass + 1 / target.mass);
    headOn(w, target, w.unit * 30 * .6, child);
    assert.equal(10000 - target.hp, Math.round(.5 * reducedMass * 30 ** 2 * .31 * .6 * (1 + .1 * layers)));
  }
});

test('v7.3 growth and shockwave use the same Boss HP reference and never spend bank charges on the area hit', () => {
  for (const layers of [0, 1, 2]) {
    const w = run(); gain(w, 'growth', layers); gain(w, 'density', 2); gain(w, 'bank');
    w.stage = 5; w.beginBoss(); advance(w, BOSS_TIMING.entry);
    Object.assign(w.boss, {stunned: true, r: w.boss.minRadius, hp: 100000, maxHp: 100000});
    const reference = .5 * w.player.mass * 40 ** 2 * .31 * (1 + .1 * layers);
    w.damageBoss(w.baseSpeed); assert.equal(100000 - w.boss.hp, Math.round(reference));
    const before = w.boss.hp; w.bank = 2; w.shotBanked = true;
    Object.assign(w.player, {x: w.boss.x, y: w.boss.y + w.boss.r + w.player.r});
    w.releaseShockwave(); assert.equal(before - w.boss.hp, Math.round(reference * .75)); assert.equal(w.bank, 2);
    const actor = w.makeBody(0, 0, w.unit * .7, w.player.density);
    Object.assign(actor, {isPlayer: true, isAuxiliary: true, sourceMass: w.player.mass});
    const beforeAux = w.boss.hp; w.shotBanked = false;
    w.damageBoss(w.baseSpeed * .6, {attacker: actor});
    assert.equal(beforeAux - w.boss.hp, Math.round(reference * .6));
  }
});

test('v7.3 Boss max-hit snapshot still requires a finishing rebound at the new growth and boomerang limits', () => {
  const w = run(); for (const id of ['growth', 'growth', 'boomerang', 'bank', 'density', 'density']) gain(w, id);
  gain(w, 'energy', 4); gain(w, 'overspeed', 2); w.stage = 5; w.beginBoss(); advance(w, BOSS_TIMING.entry);
  w.boss.r = w.boss.minRadius + .001; w.damageBoss(w.baseSpeed); const hp = w.boss.hp;
  const speed = (Math.min(w.launchCap, w.baseSpeed * Math.sqrt(w.energy)) + w.readySpeed) * 1.3;
  w.bank = 2; w.shotBanked = true; w.damageBoss(speed);
  assert.ok(w.boss.hp > 0 && w.boss.hp < hp); const damagedHp = w.boss.hp;
  w.bank = 2; w.damageBoss(speed); assert.equal(w.phase, 'boss-celebrate'); assert.ok(damagedHp < hp * .1);
});

test('v7.3 breath integrates a partial expiry on both refill clocks and refreshes without accumulating time', () => {
  const whole = run(), split = run();
  for (const w of [whole, split]) { w.floorTimer = w.spawnTimer = 1; w.breathTime = .1; }
  whole.advanceSpawning(.2); split.advanceSpawning(.1); split.advanceSpawning(.1);
  near(whole.floorTimer, 1 - .1 * 2 / 3 - .1); near(whole.spawnTimer, whole.floorTimer);
  near(whole.breathTime, 0); near(split.floorTimer, whole.floorTimer); near(split.spawnTimer, whole.spawnTimer);
  gain(whole, 'breath'); whole.damage(enemy(whole, {hp: 1}), 1); near(whole.breathTime, 2.5);
  whole.advanceSpawning(.2); whole.damage(enemy(whole, {hp: 1}), 1); near(whole.breathTime, 2.5);
});

test('v7.3 breath never slows capacity grace and boomerang cleanup removes only its temporary multiplier', () => {
  for (const breath of [0, 2.5]) {
    const w = run(); w.breathTime = breath;
    for (let i = 0; i < w.limit; i++) enemy(w, {x: 6000 + i * w.unit * 3, y: 6000});
    advance(w, .2); near(w.overTimer, .2); assert.equal(w.phase, 'battle');
  }
  const w = run(); gain(w, 'boomerang'); bounce(w); near(w.player.boomerangTime, .8);
  const boosted = length(w.player); near(w.maxPhysicsSpeed, (w.launchCap + w.readySpeed) * 1.3);
  w.clearEnemies(); near(length(w.player), boosted / 1.3); near(w.player.boomerangTime, 0);
  w.clearEnemies(); near(length(w.player), boosted / 1.3);
  const [child] = splitShot(w); Object.assign(child, {x: 0, vx: -w.unit * 30, vy: 0});
  w.wall(child); const childBoost = length(child); near(child.boomerangTime, .8);
  w.advanceBoomerang(child, .8); near(length(child), childBoost / 1.3); near(child.boomerangTime, 0);
});
