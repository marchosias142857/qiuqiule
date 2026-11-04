import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {
  ENDLESS_PROGRESS_VERSION, ENDLESS_DAILY_LIMIT, normalizeEndless, recordEndlessRun,
  recordEndlessProgress, createEndlessRun,
} from '../dist/endless-progress.js';
import {planEnemyCluster} from '../dist/enemies.js';
import {rollUpgrades} from '../dist/upgrades.js';

const empty = {version: 1, best: 0, maxStage: 0, maxCombo: 0, daily: []};
const samples = (run, count = 20) => Array.from({length: count}, () => run.random());
const dayKey = day => new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10);

test('empty and damaged saves normalize without inventing progress from a legacy best score', () => {
  for (const raw of [null, undefined, false, 90, [], 'broken json', '[123]', 'null']) assert.deepEqual(normalizeEndless(raw), empty);
  for (const legacyBest of [-10, NaN, Infinity, -Infinity, null, true, {}, [], 'not a score', 'Infinity']) {
    assert.deepEqual(normalizeEndless(null, legacyBest), empty);
  }
  const migrated = normalizeEndless(null, '1234.9');
  assert.deepEqual(migrated, {...empty, best: 1234});
  assert.deepEqual(normalizeEndless({best: 900, maxStage: 4, maxCombo: 6}, 1234),
    {...empty, best: 1234, maxStage: 4, maxCombo: 6});
  assert.equal(normalizeEndless({best: 1500}, 1234).best, 1500);
});

test('normalization produces only finite nonnegative safe integer metrics and stable JSON', () => {
  const state = normalizeEndless({version: 999, best: 1e200, maxStage: '15.9', maxCombo: -20,
    daily: [{key: '2026-11-03', best: '400.8', maxStage: Infinity, maxCombo: '8.9'},
      {key: '2026-11-02', best: NaN, maxStage: true, maxCombo: {value: 20}}]});
  assert.equal(state.version, ENDLESS_PROGRESS_VERSION); assert.equal(state.best, Number.MAX_SAFE_INTEGER);
  assert.equal(state.maxStage, 15); assert.equal(state.maxCombo, 8);
  for (const record of [state, ...state.daily]) for (const field of ['best', 'maxStage', 'maxCombo']) {
    assert.ok(Number.isSafeInteger(record[field])); assert.ok(record[field] >= 0);
  }
  assert.deepEqual(normalizeEndless(JSON.stringify(state)), state);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
  assert.deepEqual(normalizeEndless(state), state);
});

test('duplicate daily records merge each maximum and repair understated all-time values', () => {
  const state = normalizeEndless({best: 1, maxStage: 1, maxCombo: 1, daily: [
    {key: '2026-11-02', best: 80, maxStage: 9, maxCombo: 2},
    {key: '2026-11-03', best: 90, maxStage: 8, maxCombo: 4},
    {key: '2026-11-02', best: 50, maxStage: 5, maxCombo: 10},
    {key: '2026-11-03', best: 100, maxStage: 4, maxCombo: 1},
  ]});
  assert.deepEqual(state, {version: 1, best: 100, maxStage: 9, maxCombo: 10, daily: [
    {key: '2026-11-03', best: 100, maxStage: 8, maxCombo: 4},
    {key: '2026-11-02', best: 80, maxStage: 9, maxCombo: 10},
  ]});
});

test('calendar validation rejects impossible dates and only admits real leap days', () => {
  const invalid = ['2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00',
    '2026-1-03', '26-11-03', '0000-01-01', '10000-01-01', '2026-11-03T00:00:00Z', '__proto__', null];
  const state = normalizeEndless({daily: [...invalid.map(key => ({key, best: 9999, maxStage: 99, maxCombo: 99})),
    {key: '2000-02-29', best: 2, maxStage: 3, maxCombo: 4}, {key: '2024-02-29', best: 3, maxStage: 4, maxCombo: 5}]});
  assert.deepEqual(state.daily.map(record => record.key), ['2024-02-29', '2000-02-29']);
  assert.equal(state.best, 3); assert.equal(state.maxStage, 4); assert.equal(state.maxCombo, 5);
  assert.deepEqual(normalizeEndless({daily: {bad: 'record'}}), empty);
});

test('history retains the latest thirty-two dates while older achievements remain all-time records', () => {
  const daily = Array.from({length: 45}, (_, i) => ({key: dayKey(i + 1), best: i + 1, maxStage: i + 1, maxCombo: i + 1}));
  daily[0] = {...daily[0], best: 9000, maxStage: 60, maxCombo: 70};
  const state = normalizeEndless({daily: [...daily].reverse()});
  assert.equal(ENDLESS_DAILY_LIMIT, 32); assert.equal(state.daily.length, 32);
  assert.deepEqual(state.daily.map(record => record.key), daily.slice(13).reverse().map(record => record.key));
  assert.equal(state.best, 9000); assert.equal(state.maxStage, 60); assert.equal(state.maxCombo, 70);
  assert.ok(!state.daily.some(record => record.best === 9000));
  const olderRun = recordEndlessRun(state, {dateKey: dayKey(1), score: 10000, stage: 65, maxCombo: 75});
  assert.equal(olderRun.daily.length, 32); assert.deepEqual(olderRun.daily, state.daily);
  assert.equal(olderRun.best, 10000); assert.equal(olderRun.maxStage, 65); assert.equal(olderRun.maxCombo, 75);
});

test('entry, stage and final-score records merge monotonically before a run finishes', () => {
  let state = normalizeEndless(null);
  state = recordEndlessProgress(state, {dateKey: '2026-11-03', stage: 1});
  assert.deepEqual(state.daily[0], {key: '2026-11-03', best: 0, maxStage: 1, maxCombo: 0});
  state = recordEndlessProgress(state, {dateKey: '2026-11-03', stage: 5});
  state = recordEndlessProgress(state, {dateKey: '2026-11-03', stage: 10, score: 300, maxCombo: 6});
  state = recordEndlessRun(state, {dateKey: '2026-11-03', stage: 8, score: 290, maxCombo: 4});
  assert.deepEqual(state, {version: 1, best: 300, maxStage: 10, maxCombo: 6,
    daily: [{key: '2026-11-03', best: 300, maxStage: 10, maxCombo: 6}]});
  const laterDay = recordEndlessRun(state, {dateKey: '2026-11-04', score: 400, stage: 3, maxCombo: 2});
  assert.deepEqual(laterDay.daily[0], {key: '2026-11-04', best: 400, maxStage: 3, maxCombo: 2});
  assert.equal(laterDay.maxStage, 10); assert.equal(laterDay.maxCombo, 6); assert.equal(laterDay.best, 400);
});

test('a missing or damaged captured date can update all-time progress without inventing a daily record', () => {
  for (const dateKey of [undefined, null, '2026-02-29', 'not a date']) {
    const state = recordEndlessRun(empty, {dateKey, score: 50.9, stage: 5.8, maxCombo: 6.9});
    assert.deepEqual(state, {...empty, best: 50, maxStage: 5, maxCombo: 6});
  }
});

test('normalization and recording leave the caller state and frozen daily records untouched', () => {
  const record = Object.freeze({key: '2026-11-03', best: 50, maxStage: 5, maxCombo: 4});
  const raw = Object.freeze({version: 1, best: 50, maxStage: 5, maxCombo: 4, daily: Object.freeze([record])});
  const result = recordEndlessRun(raw, {dateKey: '2026-11-03', score: 70, stage: 10, maxCombo: 7});
  assert.equal(raw.best, 50); assert.equal(raw.daily[0].maxStage, 5); assert.equal(raw.daily[0].maxCombo, 4);
  assert.notEqual(result, raw); assert.notEqual(result.daily, raw.daily); assert.notEqual(result.daily[0], record);
  result.daily[0].best = 999;
  assert.equal(raw.daily[0].best, 50);
});

test('every new run samples fresh entropy even at the exact same local time', t => {
  let nextSeed = 1200;
  t.mock.method(globalThis.crypto, 'getRandomValues', array => {array[0] = nextSeed++; return array;});
  t.mock.method(Math, 'random', () => {throw new Error('secure run seeding must not use cosmetic randomness');});
  const date = new Date(2026, 10, 3, 12, 0, 0), first = createEndlessRun(date), second = createEndlessRun(date);
  assert.equal(first.key, '2026-11-03'); assert.equal(second.key, first.key);
  assert.equal(first.seed, 1200); assert.equal(second.seed, 1201);
  assert.notDeepEqual(samples(first), samples(second)); assert.ok(Object.isFrozen(first));
});

test('new runs remain random when Web Crypto is unavailable', t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {value: undefined, configurable: true});
  t.after(() => Object.defineProperty(globalThis, 'crypto', descriptor));
  let value = .25;
  t.mock.method(Math, 'random', () => {const result = value; value += .25; return result;});
  const first = createEndlessRun('2026-11-03'), second = createEndlessRun('2026-11-03');
  assert.equal(first.seed, 1073741824); assert.equal(second.seed, 2147483648);
  assert.notDeepEqual(samples(first), samples(second));
});

test('local dates label records and do not determine the gameplay sequence', () => {
  const morning = createEndlessRun(new Date(2026, 10, 3, 0, 0, 0), 42);
  const night = createEndlessRun(new Date(2026, 10, 3, 23, 59, 59, 999), 43);
  const tomorrow = createEndlessRun(new Date(2026, 10, 4, 0, 0, 0), 42);
  assert.equal(morning.key, '2026-11-03'); assert.equal(night.key, morning.key);
  assert.notDeepEqual(samples(night), samples(createEndlessRun(morning.key, 42)));
  assert.equal(tomorrow.key, '2026-11-04'); assert.deepEqual(samples(tomorrow), samples(morning));
  for (const [date, key] of [[new Date(2027, 0, 1), '2027-01-01'], [new Date(2024, 1, 29), '2024-02-29'], [new Date(2024, 2, 1), '2024-03-01']]) {
    assert.equal(createEndlessRun(date).key, key);
  }
});

test('date and random stream remain captured after midnight and mutating the input Date does not change the run', () => {
  const date = new Date(2026, 10, 3, 23, 59, 59), run = createEndlessRun(date, 123), reference = createEndlessRun('2026-11-03', 123);
  assert.equal(run.random(), reference.random());
  date.setDate(4); date.setHours(0, 0, 0, 0);
  assert.equal(run.key, '2026-11-03'); assert.equal(createEndlessRun(date).key, '2026-11-04');
  assert.deepEqual(samples(run), samples(reference));
  const state = recordEndlessRun(empty, {dateKey: run.key, score: 100, stage: 10, maxCombo: 6});
  assert.equal(state.daily[0].key, '2026-11-03'); assert.equal(state.daily.length, 1);
});

test('run records use device-local dates rather than UTC and ignore DST clock repetition', () => {
  const moduleUrl = new URL('../dist/endless-progress.js', import.meta.url).href;
  const script = `import {createEndlessRun} from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify(['2026-11-03T00:30:00Z','2026-11-01T08:30:00Z','2026-11-01T09:30:00Z'].map(value=>createEndlessRun(new Date(value)).key)));`;
  const underTimezone = TZ => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script],
    {env: {...process.env, TZ}, encoding: 'utf8'}));
  const pacific = underTimezone('America/Los_Angeles'), islands = underTimezone('Pacific/Kiritimati');
  assert.equal(pacific[0], '2026-11-02'); assert.equal(islands[0], '2026-11-03');
  assert.equal(pacific[1], pacific[2]); assert.equal(pacific[1], '2026-11-01');
});

test('invalid dates fail explicitly instead of silently selecting today or rolling to another month', () => {
  for (const date of [new Date(NaN), '2026-02-29', 'broken', null, 0, {}]) assert.throws(() => createEndlessRun(date), RangeError);
  const farFuture = new Date(0); farFuture.setFullYear(10000);
  assert.throws(() => createEndlessRun(farFuture), RangeError);
  assert.equal(createEndlessRun('2000-02-29').key, '2000-02-29');
});

test('the run RNG stays in range and every run owns an independent stream', () => {
  const run = createEndlessRun('2026-11-03');
  for (let i = 0; i < 100000; i++) {
    const value = run.random(); assert.ok(Number.isFinite(value) && value >= 0 && value < 1);
  }
  const first = createEndlessRun('2026-11-03', 11), second = createEndlessRun('2026-11-03', 12), reference = createEndlessRun('2026-11-03', 12);
  samples(first, 50);
  assert.deepEqual(samples(second), samples(reference));
});

test('actual cluster and upgrade samplers vary between runs and stay independent of cosmetic randomness', t => {
  function gameplay(run, cosmetic) {
    const result = [];
    for (let i = 0; i < 25; i++) {
      if (cosmetic) for (let j = 0; j < i + 1; j++) Math.random();
      result.push(planEnemyCluster({stage: 16, size: 8, random: run.random}));
      result.push(rollUpgrades({counts: {energy: 4, growth: 1}, count: 5, random: run.random}).map(choice => choice.id));
    }
    return result;
  }
  const baseline = gameplay(createEndlessRun('2026-11-03', 1200), false);
  assert.deepEqual(gameplay(createEndlessRun('2026-11-03', 1200), true), baseline);
  const another = gameplay(createEndlessRun('2026-11-03', 1201), false);
  assert.notDeepEqual(another.filter((_, i) => i % 2 === 0), baseline.filter((_, i) => i % 2 === 0));
  assert.notDeepEqual(another.filter((_, i) => i % 2 === 1), baseline.filter((_, i) => i % 2 === 1));
  const run = createEndlessRun('2026-11-03', 1200);
  t.mock.method(Math, 'random', () => {throw new Error('an active run used ambient randomness');});
  assert.deepEqual(gameplay(run, false), baseline);
  recordEndlessRun(empty, {dateKey: '2026-11-03', score: 10, stage: 5});
});
