import test from 'node:test';
import assert from 'node:assert/strict';
import {ENEMY_TYPES, enemyMix, enemyTypeLimit, enemyProfileFor, planEnemyCluster} from '../dist/enemies.js';

const near = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
const canonical = type => type === 'fragment' ? 'normal' : type;
function seeded(seed = 631) {
  let state = seed;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
}
function sequence(...values) {
  let index = 0;
  return () => { assert.ok(index < values.length, 'unexpected random draw'); return values[index++]; };
}
const bands = [
  {stages: [1, 2], cap: 1, weights: [100]},
  {stages: [3, 5], cap: 2, weights: [85, 15]},
  {stages: [6, 7], cap: 3, weights: [75, 15, 10]},
  {stages: [8, 9], cap: 3, weights: [65, 15, 10, 10]},
  {stages: [10, 12], cap: 4, weights: [55, 15, 10, 10, 10]},
  {stages: [13, 15], cap: 4, weights: [50, 12, 10, 10, 10, 8]},
  {stages: [16, 60], cap: 5, weights: [42, 12, 10, 10, 10, 8, 8]},
];
const mainTypes = ['normal', 'ring', 'heavy', 'split', 'walker', 'magnet', 'shield'];

test('stage bands have exact weights, caps and unlock stages, with shield at eight percent', () => {
  for (const {stages, cap, weights} of bands) for (const stage of stages) {
    const expected = Object.fromEntries(weights.map((weight, i) => [mainTypes[i], weight / 100]));
    assert.deepEqual(enemyMix(stage), expected); assert.equal(enemyTypeLimit(stage), cap);
    near(Object.values(enemyMix(stage)).reduce((sum, weight) => sum + weight, 0), 1);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(ENEMY_TYPES).map(([id, entry]) => [id, entry.stage])),
    {normal: 1, ring: 3, heavy: 6, split: 8, walker: 10, magnet: 13, shield: 16, leader: 12, fragment: 8});
  assert.equal(ENEMY_TYPES.fragment.spawnable, false);
  assert.equal(enemyMix(16).shield, .08);
  assert.deepEqual(enemyMix(0), enemyMix(1)); assert.deepEqual(enemyMix(3.9), enemyMix(3));
});

test('enemy profiles multiply base values once and preserve unit-based behavior parameters', () => {
  const base = Object.freeze({radiusScale: .9, density: 1.4, hp: 80, value: 999, custom: 'kept'});
  const expected = {
    normal: [.9, 1.4, 80, 10, 1, .9, 1.2, .2, 0],
    ring: [.9, 1.4, 160, 15, .5, 1, 1.2, 0, 0],
    heavy: [1.17, 3.5, 240, 30, 1, .9, 3, 0, 0],
    split: [1.2, 1.4, 120, 20, 1, .9, 1.2, .2, 0],
    walker: [.9, 1.4, 80, 20, 1, .9, 1.2, 0, 2],
    magnet: [.9, 1.4, 160, 25, 1, .9, 1.2, 0, 0],
    shield: [.9, 1.4, 80, 20, 1, .9, 1.2, .2, 0],
    leader: [1.1, 1.4, 160, 30, 1, .9, 1.2, .2, 0],
    fragment: [.6, 1.4, 24, 5, 1, .9, 1.2, .2, 0],
  };
  const fields = ['radiusScale', 'density', 'hp', 'value', 'massScale', 'restitution', 'drag', 'driftSpeed', 'moveSpeed'];
  for (const [type, values] of Object.entries(expected)) {
    const profile = enemyProfileFor(type, base);
    fields.forEach((field, i) => near(profile[field], values[i]));
    assert.equal(profile.enemyType, type); assert.equal(profile.custom, 'kept');
  }
  const split = enemyProfileFor('split', base), fragment = enemyProfileFor('fragment', {...base, hp: split.hp});
  near(fragment.hp, 36); near(fragment.density, base.density);
  assert.equal(split.splitCount, 3); assert.equal(split.splitSpeed, 6);
  const magnet = enemyProfileFor('magnet', base);
  assert.deepEqual([magnet.magnetRadius, magnet.magnetAcceleration, magnet.burstRadius, magnet.burstSpeed], [4, 1.5, 3, 4]);
  const leader = enemyProfileFor('leader', base);
  assert.deepEqual([leader.leaderPullSpeed, leader.burstSpeed], [.5, 2]);
  assert.equal(enemyProfileFor('shield', base).shield, true); assert.equal(enemyProfileFor('shield', base).shieldRadius, .3);
  assert.equal(enemyProfileFor('normal', base).shield, false);
});

test('every band produces the specified main-type frequency from stratified draws', () => {
  const samples = 10000;
  for (const {stages: [stage], weights} of bands) {
    const observed = Object.fromEntries(mainTypes.map(type => [type, 0]));
    for (let i = 0; i < samples; i++) {
      let calls = 0;
      const plan = planEnemyCluster({stage, size: 8, excludedTypes: ['leader'],
        random: () => calls++ === 0 ? (i + .5) / samples : .95});
      assert.equal(plan.length, 8); observed[plan[0]]++;
    }
    mainTypes.forEach((type, i) => assert.equal(observed[type], (weights[i] || 0) * samples / 100, `${stage}: ${type}`));
  }
});

test('uncapped specialty clusters average exactly seventy percent across integer sizes', () => {
  for (const size of [2, 3, 4, 5, 6, 7, 8]) {
    let rings = 0;
    for (let i = 0; i < 10; i++) {
      const plan = planEnemyCluster({stage: 3, size, random: sequence(.99, (i + .5) / 10)});
      assert.equal(plan.length, size); assert.ok(plan.every(type => type === 'ring' || type === 'normal'));
      assert.equal(plan[0], 'ring'); rings += plan.filter(type => type === 'ring').length;
    }
    assert.equal(rings, size * 7);
  }
});

test('leader chance is independent of the weighted main draw and leader occupies the center slot', () => {
  const samples = 100000, random = seeded(632), counts = Object.fromEntries(mainTypes.map(type => [type, 0]));
  let leaders = 0;
  for (let i = 0; i < samples; i++) {
    const plan = planEnemyCluster({stage: 16, size: 8, random});
    assert.equal(plan.length, 8);
    const hasLeader = plan[0] === 'leader'; leaders += Number(hasLeader);
    assert.equal(plan.filter(type => type === 'leader').length, Number(hasLeader));
    counts[plan[hasLeader ? 1 : 0]]++;
    for (const type of ['heavy', 'walker', 'magnet']) assert.ok(plan.filter(id => id === type).length <= 1);
  }
  near(leaders / samples, .30, .004);
  for (const [type, weight] of Object.entries(enemyMix(16))) near(counts[type] / samples, weight, .004);
  assert.ok(!planEnemyCluster({stage: 11, size: 8, random: () => 0}).includes('leader'));
  assert.equal(planEnemyCluster({stage: 12, size: 8, random: () => 0})[0], 'leader');
  assert.ok(!planEnemyCluster({stage: 12, size: 8, excludedTypes: ['leader'], random: () => 0}).includes('leader'));
});

test('heavy, magnet and walker never occupy more than one slot even when selected as the main type', () => {
  for (const [type, draw] of [['heavy', .58], ['walker', .78], ['magnet', .88]]) {
    const plan = planEnemyCluster({stage: 16, size: 8, random: sequence(draw, .95, .5)});
    assert.equal(plan[0], type); assert.equal(plan.filter(id => id === type).length, 1);
    assert.equal(plan.filter(id => id === 'normal').length, 7);
  }
});

test('split clusters keep the same composition and random draws across the late-stage boundary', () => {
  for (const stage of [16, 20, 21, 26, 60]) {
    const values = [.68, .95, .5]; let draws = 0;
    const plan = planEnemyCluster({stage, size: 8, random: () => {
      assert.ok(draws < values.length, 'stage boundary consumed extra randomness');
      return values[draws++];
    }});
    assert.equal(draws, 3);
    assert.deepEqual(plan, [...Array(6).fill('split'), 'normal', 'normal']);
  }
});

test('split plans reserve type slots without imposing mother or descendant family budgets', () => {
  for (const stage of [20, 21, 26, 60]) {
    const liveTypes = ['normal', ...Array(7).fill('split')];
    const reservedTypes = [...Array(12).fill('split'), ...Array(9).fill('fragment')];
    const plan = planEnemyCluster({stage, size: 8, liveTypes, reservedTypes, random: sequence(.68, .95, .5)});
    assert.deepEqual(plan, [...Array(6).fill('split'), 'normal', 'normal']);
    assert.equal(new Set([...liveTypes, ...reservedTypes, ...plan].map(canonical)).size, 2);
  }
});

test('late split plans still respect reserved type slots and ordinary-type exclusions', () => {
  const full = ['ring', 'heavy', 'walker', 'magnet'];
  const reserved = planEnemyCluster({stage: 26, size: 8, liveTypes: full, random: () => .68});
  assert.equal(reserved.length, 8);
  assert.ok(reserved.includes('normal'));
  assert.ok(!reserved.includes('split'));
  assert.equal(new Set([...full, ...reserved]).size, 5);

  const excludedTypes = ['normal', 'heavy', 'walker', 'magnet', 'shield', 'leader'];
  const allSplit = planEnemyCluster({stage: 26, size: 8, excludedTypes, random: sequence(.999)});
  assert.deepEqual(allSplit, Array(8).fill('split'));
  const excludedSplit = planEnemyCluster({stage: 26, size: 8, excludedTypes: [...excludedTypes, 'split'], random: sequence(.999)});
  assert.deepEqual(excludedSplit, Array(8).fill('ring'));
});

test('late cluster plans remain valid at random input boundaries', () => {
  for (const draw of [-1, 0, .64, .73, 1, Infinity, NaN]) {
    const plan = planEnemyCluster({stage: 26, size: 14, random: () => draw});
    assert.equal(plan.length, 14);
    assert.ok(plan.every(type => ENEMY_TYPES[type]?.spawnable));
    assert.ok(new Set(plan).size <= enemyTypeLimit(26));
    for (const type of ['heavy', 'walker', 'magnet', 'leader']) assert.ok(plan.filter(id => id === type).length <= 1);
  }
});

test('live and reserved types jointly cap new plans, including the normal part and leader', () => {
  const first = planEnemyCluster({stage: 8, size: 8, liveTypes: ['normal', 'ring'], random: sequence(.99, .5)});
  assert.equal(first[0], 'split');
  const second = planEnemyCluster({stage: 8, size: 8, liveTypes: ['normal', 'ring'], reservedTypes: first, random: sequence(.99, .5)});
  assert.ok(second.every(type => ['normal', 'ring', 'split'].includes(type)));
  assert.equal(new Set(['normal', 'ring', ...first, ...second]).size, 3);
  // With only one new slot free, normal must be reserved before a main type is chosen.
  const reserveNormal = planEnemyCluster({stage: 8, size: 8, liveTypes: ['ring', 'heavy'], random: sequence(.99, .5)});
  assert.ok(reserveNormal.every(type => type === 'normal' || type === 'ring' || type === 'heavy'));
  assert.ok(reserveNormal.includes('normal')); assert.equal(reserveNormal.length, 8);
  const noLeader = planEnemyCluster({stage: 12, size: 8, liveTypes: ['normal', 'ring'], reservedTypes: ['heavy', 'split'], random: sequence(0, 0)});
  assert.ok(!noLeader.includes('leader')); assert.equal(noLeader.length, 8);
});

test('fragments share the normal type slot and never enter the main pool', () => {
  const plan = planEnemyCluster({stage: 3, size: 8, liveTypes: ['fragment'], reservedTypes: ['ring'], random: sequence(.99, .5)});
  assert.equal(plan[0], 'ring'); assert.equal(plan.length, 8);
  assert.equal(new Set(['fragment', ...plan].map(canonical)).size, 2);
  assert.ok(!Object.hasOwn(enemyMix(60), 'fragment'));
});

test('teaching exclusions cannot leak through a weighted choice or fallback', () => {
  for (const type of mainTypes.slice(1)) {
    const stage = ENEMY_TYPES[type].stage;
    for (let i = 0; i < 100; i++) {
      const plan = planEnemyCluster({stage, size: 8, random: () => (i + .5) / 100,
        liveTypes: ['normal', type], reservedTypes: [type], excludedTypes: [type, 'leader']});
      assert.equal(plan.length, 8); assert.ok(!plan.includes(type));
    }
  }
  assert.deepEqual(planEnemyCluster({stage: 1, size: 8, excludedTypes: ['normal'], random: () => 0}), []);
});

test('legal full-cap populations stay within the cap across repeated reserved plans', () => {
  const random = seeded(633);
  for (const stage of [1, 3, 6, 8, 10, 12, 13, 16, 50]) {
    const cap = enemyTypeLimit(stage), available = Object.keys(enemyMix(stage));
    if (stage >= 12) available.push('leader');
    for (let trial = 0; trial < 150; trial++) {
      const liveTypes = ['normal'];
      for (let i = 1; i < cap; i++) {
        const options = available.filter(type => !liveTypes.includes(type));
        liveTypes.push(options[Math.floor(random() * options.length)]);
      }
      const reservedTypes = [];
      for (let wave = 0; wave < 3; wave++) {
        const plan = planEnemyCluster({stage, size: 8, liveTypes, reservedTypes, random});
        assert.equal(plan.length, 8); reservedTypes.push(...plan);
        assert.equal(new Set([...liveTypes, ...reservedTypes].map(canonical)).size, cap);
        for (const type of ['heavy', 'magnet', 'walker', 'leader']) assert.ok(plan.filter(id => id === type).length <= 1);
      }
    }
  }
});

test('blocked ordinary slots reuse allowed types or return only the legal limited slots', () => {
  const reuse = planEnemyCluster({stage: 8, size: 8, liveTypes: ['ring', 'heavy', 'split'], random: sequence(.1)});
  assert.equal(reuse.length, 8); assert.ok(reuse.every(type => ['ring', 'heavy', 'split'].includes(type)));
  const limited = planEnemyCluster({stage: 16, size: 8, excludedTypes: ['normal', 'ring', 'split', 'shield', 'leader'], random: sequence(.5)});
  assert.deepEqual(new Set(limited), new Set(['heavy', 'walker', 'magnet']));
  assert.equal(limited.length, 3);
});

test('helpers are replayable and do not mutate definitions or caller collections', () => {
  const liveTypes = Object.freeze(['fragment', 'ring']), reservedTypes = Object.freeze(['heavy']), excludedTypes = Object.freeze(['leader']);
  const options = {stage: 16, size: 8, liveTypes, reservedTypes, excludedTypes};
  const a = seeded(10), b = seeded(10), originalRandom = Math.random;
  Math.random = () => { throw new Error('un-injected randomness'); };
  try {
    for (let i = 0; i < 40; i++) assert.deepEqual(planEnemyCluster({...options, random: a}), planEnemyCluster({...options, random: b}));
    enemyProfileFor('heavy', Object.freeze({radiusScale: .8, hp: 10, density: .8}));
  } finally { Math.random = originalRandom; }
  const mix = enemyMix(16); mix.shield = 1; assert.equal(enemyMix(16).shield, .08);
  assert.ok(Object.isFrozen(ENEMY_TYPES)); assert.ok(Object.values(ENEMY_TYPES).every(Object.isFrozen));
  assert.deepEqual(planEnemyCluster({size: 0, random: () => { throw new Error('empty plan sampled'); }}), []);
  assert.deepEqual(liveTypes, ['fragment', 'ring']); assert.deepEqual(reservedTypes, ['heavy']);
});
