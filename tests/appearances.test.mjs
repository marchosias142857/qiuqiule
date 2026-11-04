import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPEARANCE_STATE_VERSION, APPEARANCE_IDS, BIG_EYE_UNLOCK_SCORE, BIG_EYE_DEFAULT_COLOR,
  normalizeAppearanceState, unlockAppearance, selectAppearance, acknowledgeAppearanceUnlock,
} from '../dist/appearances.js';

const original = {version: 1, selected: 'original', bigEyeUnlocked: false, pendingUnlock: false};

test('appearance defaults and malformed saves never grant ownership or invent an appearance', () => {
  assert.equal(APPEARANCE_STATE_VERSION, 1);
  assert.equal(BIG_EYE_UNLOCK_SCORE, 26767);
  assert.equal(BIG_EYE_DEFAULT_COLOR, '#b8db8a');
  assert.deepEqual(APPEARANCE_IDS, ['original', 'custom', 'big-eye']);
  for (const raw of [null, undefined, false, [], 'broken JSON', {selected: 'other'},
    {selected: 'big-eye', bigEyeUnlocked: 'true', pendingUnlock: true}]) {
    assert.deepEqual(normalizeAppearanceState(raw), original);
  }
});

test('legacy photos migrate only when there is no explicit saved appearance choice', () => {
  assert.equal(normalizeAppearanceState(null).selected, 'original');
  assert.equal(normalizeAppearanceState(null, {hasImage: true}).selected, 'custom');
  assert.equal(normalizeAppearanceState(null, {hasImage: false}).selected, 'original');
  assert.equal(normalizeAppearanceState({...original, selected: 'custom'}).selected, 'custom',
    'loading an asynchronous image must not erase the saved choice');
  assert.equal(normalizeAppearanceState({...original, selected: 'custom'}, {hasImage: false}).selected, 'original');
  assert.equal(normalizeAppearanceState(original, {hasImage: true}).selected, 'original',
    'a retained photo must not override a deliberate return to the original appearance');
  assert.equal(normalizeAppearanceState({...original, selected: 'big-eye', bigEyeUnlocked: true},
    {hasImage: true}).selected, 'big-eye');
});

test('exact score threshold and historical best migration grant one pending reward without auto-equipping', () => {
  for (const best of [0, 26766, 26766.999, -26767, NaN, Infinity, 'Infinity', true, {}, null]) {
    assert.deepEqual(normalizeAppearanceState(null, {best}), original);
  }
  for (const best of [26767, 26767.1, 100000, '26767']) {
    assert.deepEqual(normalizeAppearanceState(null, {best}), {
      ...original, bigEyeUnlocked: true, pendingUnlock: true,
    });
  }
});

test('live unlock is idempotent and ownership plus pending reward survive saving and lower later scores', () => {
  const below = unlockAppearance(original, 26766);
  assert.equal(below.newlyUnlocked, false);
  const first = unlockAppearance(below.state, 26767);
  assert.equal(first.newlyUnlocked, true);
  assert.equal(first.state.selected, 'original');
  assert.equal(first.state.pendingUnlock, true);
  const restored = normalizeAppearanceState(JSON.stringify(first.state), {best: 1});
  assert.deepEqual(restored, first.state);
  for (const score of [26767, 80000, 0, NaN]) {
    const again = unlockAppearance(restored, score);
    assert.equal(again.newlyUnlocked, false);
    assert.deepEqual(again.state, restored);
  }
});

test('selection guards locked skins and missing photos while preserving pending rewards', () => {
  assert.deepEqual(selectAppearance(original, 'big-eye'), original);
  assert.deepEqual(selectAppearance(original, 'unlisted'), original);
  assert.deepEqual(selectAppearance(original, 'custom'), original);
  assert.deepEqual(selectAppearance(original, 'custom', {hasImage: false}), original);
  const custom = selectAppearance(original, 'custom', {hasImage: true});
  assert.equal(custom.selected, 'custom');
  const earned = unlockAppearance(custom, 26767).state;
  const eye = selectAppearance(earned, 'big-eye', {hasImage: true});
  assert.equal(eye.selected, 'big-eye');
  assert.equal(eye.pendingUnlock, true);
  assert.equal(selectAppearance(eye, 'original', {hasImage: true}).pendingUnlock, true);
  assert.equal(selectAppearance(eye, 'custom', {hasImage: true}).selected, 'custom');
});

test('only acknowledgement consumes the pending popup and a high stored score never repeats it', () => {
  const earned = unlockAppearance(original, 26767).state;
  const selected = selectAppearance(earned, 'big-eye');
  assert.equal(selected.pendingUnlock, true);
  const acknowledged = acknowledgeAppearanceUnlock(selected);
  assert.equal(acknowledged.pendingUnlock, false);
  assert.equal(acknowledged.bigEyeUnlocked, true);
  assert.equal(acknowledged.selected, 'big-eye');
  const restored = normalizeAppearanceState(JSON.stringify(acknowledged), {best: 90000});
  assert.deepEqual(restored, acknowledged);
  assert.deepEqual(acknowledgeAppearanceUnlock(original), original);
  assert.deepEqual(unlockAppearance(restored, 100000), {state: restored, newlyUnlocked: false});
});

test('appearance operations never mutate caller state or game settings', () => {
  const raw = Object.freeze({...original, selected: 'custom'});
  const before = JSON.stringify(raw);
  normalizeAppearanceState(raw, {best: 30000, hasImage: true});
  unlockAppearance(raw, 30000);
  selectAppearance(raw, 'original', {hasImage: true});
  acknowledgeAppearanceUnlock(raw);
  assert.equal(JSON.stringify(raw), before);
});
