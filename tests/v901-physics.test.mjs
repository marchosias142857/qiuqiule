import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../dist/physics.js';

const STEP = 1 / 120;
const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

function worldAt(stage, layers) {
  const world = new World(10000, 10000, () => .5, {spawnInitial: false});
  world.stage = stage;
  for (let i = 0; i < layers; i++) assert.equal(world.applyUpgrade('frenzy'), true);
  world.spawnTimer = 0;
  world.floorTimer = world.introTimer = Infinity;
  return world;
}

function watchWaves(world, count) {
  const waves = [], plan = world.makePlannedCluster;
  world.makePlannedCluster = function(size) {
    assert.equal(this.wave, null, 'a new wave must not replace an unfinished wave');
    if (waves.length) assert.equal(waves.at(-1).body.index, waves.at(-1).body.size);
    const body = plan.call(this, size);
    assert.ok(body);
    waves.push({body, start: this.time, observed: 0, slots: []});
    return body;
  };
  for (let frame = 0; waves.length < count && frame < 120 * 90; frame++) {
    world.time += STEP;
    world.advanceSpawning(STEP);
    assert.ok(world.spawnTimer >= -STEP - 1e-8, 'overdue starts must not accumulate a backlog');
    for (const wave of waves) {
      const consumed = wave.body.index - wave.observed;
      assert.ok(consumed <= 1, 'a frame must not catch up a burst of deferred wave slots');
      for (let i = 0; i < consumed; i++) wave.slots.push(world.time);
      wave.observed = wave.body.index;
    }
  }
  assert.equal(waves.length, count);
  return waves;
}

test('v9.0.1 frenzy adds one ball and multiplies rest by 0.9 for each layer after the first', () => {
  for (const stage of [1, 3, 4, 20]) {
    const baseline = worldAt(stage, 0), baselineSize = baseline.waveSize;
    for (const layers of [0, 1, 2, 3, 5]) {
      const world = worldAt(stage, layers), extra = layers ? 2 + layers - 1 : 0;
      const recovery = [3, 4].includes(stage % 5) ? 2 : 0;
      near(world.spawnInterval, baseline.spawnInterval);
      assert.equal(world.waveSize, baselineSize + extra);
      near(world.waveInterval, (baselineSize + extra) * baseline.spawnInterval
        * (layers ? .7 * .9 ** (layers - 1) : 1) + recovery);
      assert.equal(world.comboCap, layers ? 12 : 8);
    }
  }
});

test('v9.0.1 crowded frenzy waves consume every 300 ms slot before the next wave begins', () => {
  for (const [stage, layers] of [[20, 7], [30, 6], [30, 30]]) {
    const world = worldAt(stage, layers), waves = watchWaves(world, 3);
    for (let i = 0; i < 2; i++) {
      const wave = waves[i];
      assert.equal(wave.body.size, world.waveSize);
      assert.equal(wave.slots.length, world.waveSize);
      for (let slot = 1; slot < wave.slots.length; slot++) {
        near(wave.slots[slot] - wave.slots[slot - 1], .3, STEP + 1e-8);
      }
      assert.ok(waves[i + 1].start > wave.slots.at(-1));
      assert.ok(waves[i + 1].start - wave.slots.at(-1) <= STEP + 1e-8);
    }
    assert.ok(world.liveCount <= world.limit, 'full-field slots are consumed without overfilling');
  }
});

test('v9.0.1 non-overlapping zero- and one-layer waves keep their existing start cadence', () => {
  for (const [stage, layers] of [[1, 0], [1, 1], [3, 1], [20, 1]]) {
    const world = worldAt(stage, layers), interval = world.waveInterval;
    const waves = watchWaves(world, 3);
    near(waves[1].start - waves[0].start, interval, STEP + 1e-8);
    near(waves[2].start - waves[1].start, interval, STEP + 1e-8);
  }
});
