import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPEARANCE_STATE_VERSION, APPEARANCE_IDS, BIG_EYE_UNLOCK_SCORE, BIG_EYE_DEFAULT_COLOR,
  normalizeAppearanceState, unlockAppearance, selectAppearance, changeAppearance, appearanceFeedbackColor, acknowledgeAppearanceUnlock,
} from '../dist/appearances.js';

const original = {version: 1, selected: 'original', bigEyeUnlocked: false, pendingUnlock: false};

test('appearance defaults and malformed saves never grant ownership or invent an appearance', () => {
  assert.equal(APPEARANCE_STATE_VERSION, 1);
  assert.equal(BIG_EYE_UNLOCK_SCORE, 233333);
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
  for (const best of [0, 26767, 233332, 233332.999, -233333, NaN, Infinity, 'Infinity', true, {}, null]) {
    assert.deepEqual(normalizeAppearanceState(null, {best}), original);
  }
  for (const best of [233333, 233333.1, 1000000, '233333']) {
    assert.deepEqual(normalizeAppearanceState(null, {best}), {
      ...original, bigEyeUnlocked: true, pendingUnlock: true,
    });
  }
});

test('live unlock is idempotent and ownership plus pending reward survive saving and lower later scores', () => {
  const below = unlockAppearance(original, 233332);
  assert.equal(below.newlyUnlocked, false);
  const first = unlockAppearance(below.state, 233333);
  assert.equal(first.newlyUnlocked, true);
  assert.equal(first.state.selected, 'original');
  assert.equal(first.state.pendingUnlock, true);
  const restored = normalizeAppearanceState(JSON.stringify(first.state), {best: 1});
  assert.deepEqual(restored, first.state);
  for (const score of [233333, 80000, 0, NaN]) {
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
  const earned = unlockAppearance(custom, 233333).state;
  const eye = selectAppearance(earned, 'big-eye', {hasImage: true});
  assert.equal(eye.selected, 'big-eye');
  assert.equal(eye.pendingUnlock, true);
  assert.equal(selectAppearance(eye, 'original', {hasImage: true}).pendingUnlock, true);
  assert.equal(selectAppearance(eye, 'custom', {hasImage: true}).selected, 'custom');
});

test('only acknowledgement consumes the pending popup and a high stored score never repeats it', () => {
  const earned = unlockAppearance(original, 233333).state;
  const selected = selectAppearance(earned, 'big-eye');
  assert.equal(selected.pendingUnlock, true);
  const acknowledged = acknowledgeAppearanceUnlock(selected);
  assert.equal(acknowledged.pendingUnlock, false);
  assert.equal(acknowledged.bigEyeUnlocked, true);
  assert.equal(acknowledged.selected, 'big-eye');
  const restored = normalizeAppearanceState(JSON.stringify(acknowledged), {best: 900000});
  assert.deepEqual(restored, acknowledged);
  assert.deepEqual(acknowledgeAppearanceUnlock(original), original);
  assert.deepEqual(unlockAppearance(restored, 1000000), {state: restored, newlyUnlocked: false});
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


test('temporary Big Eye color preserves the exact preceding palette and restores it on either exit', () => {
  for (const previous of ['#405060', '#Aa22fF', '#b8db8a']) {
    const owned = {...original, bigEyeUnlocked: true};
    const entering = changeAppearance(owned, 'big-eye', {playerColor: previous, hasImage: true});
    assert.equal(entering.changed, true);
    assert.equal(entering.playerColor, '#b8db8a');
    assert.equal(entering.state.previousPlayerColor, previous);
    for (const id of ['original', 'custom']) {
      const leaving = changeAppearance(entering.state, id, {playerColor: '#123456', hasImage: true});
      assert.equal(leaving.changed, true);
      assert.equal(leaving.playerColor, previous, 'settings changes made while wearing Big Eye do not replace the old palette');
      assert.equal(leaving.state.selected, id);
      assert.equal('previousPlayerColor' in leaving.state, false);
    }
    assert.equal('previousPlayerColor' in owned, false);
  }
});

test('color predecessor survives storage, acknowledgements and repeated selection without being overwritten', () => {
  const entering = changeAppearance({...original, bigEyeUnlocked: true, pendingUnlock: true}, 'big-eye', {playerColor: '#6a5c47'});
  const loaded = normalizeAppearanceState(JSON.stringify(entering.state), {best: 30000});
  assert.equal(loaded.previousPlayerColor, '#6a5c47');
  const repeated = changeAppearance(acknowledgeAppearanceUnlock(loaded), 'big-eye', {playerColor: '#12ab34'});
  assert.equal(repeated.changed, false);
  assert.equal(repeated.state.previousPlayerColor, '#6a5c47');
  assert.equal(repeated.playerColor, '#12ab34');
  assert.equal(changeAppearance(repeated.state, 'original', {playerColor: repeated.playerColor}).playerColor, '#6a5c47');
});

test('rapid Big Eye replacement and re-entry always capture the restored current base color', () => {
  let state = {...original, bigEyeUnlocked: true}, playerColor = '#4682b4';
  for (let i = 0; i < 6; i++) {
    let selected = changeAppearance(state, 'big-eye', {playerColor});
    ({state, playerColor} = selected);
    assert.equal(state.previousPlayerColor, '#4682b4');
    assert.equal(playerColor, '#b8db8a');
    ({state, playerColor} = changeAppearance(state, 'original', {playerColor}));
    assert.equal(playerColor, '#4682b4');
  }
});

test('old v7.9 Big Eye saves use the documented original default because the predecessor was never stored', () => {
  const legacy = {selected: 'big-eye', bigEyeUnlocked: true};
  for (const previousPlayerColor of [undefined, null, false, '#abc', '#zzzzzz', 'secret']) {
    const loaded = normalizeAppearanceState({...legacy, previousPlayerColor});
    assert.equal('previousPlayerColor' in loaded, false);
    assert.equal(changeAppearance(loaded, 'original', {playerColor: '#b8db8a'}).playerColor, '#252720');
  }
});

test('locked or unavailable appearance choices cannot save, restore or alter player color', () => {
  assert.deepEqual(changeAppearance(original, 'big-eye', {playerColor: '#aabbcc'}), {
    state: original, playerColor: '#aabbcc', changed: false,
  });
  const equipped = changeAppearance({...original, bigEyeUnlocked: true}, 'big-eye', {playerColor: '#aabbcc'});
  const unavailable = changeAppearance(equipped.state, 'custom', {hasImage: false, playerColor: equipped.playerColor});
  assert.equal(unavailable.changed, false);
  assert.equal(unavailable.playerColor, '#b8db8a');
  assert.equal(unavailable.state.previousPlayerColor, '#aabbcc');
});

const contrastRatio = (one, two) => {
  const lightness = value => {
    const rgb = [value >>> 16, value >>> 8 & 255, value & 255].map(x => x / 255)
      .map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const values = [lightness(one), lightness(two)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
};

test('Big Eye and custom-photo trails retain visible same-hue ink on light and dark backgrounds', () => {
  const pale = 0xb8db8a, paper = 0xf4f3eb, night = 0x22272b;
  assert.ok(contrastRatio(pale, paper) < 1.5, 'the old pale fill is nearly invisible at trail alpha');
  for (const id of ['big-eye', 'custom']) {
    const darkened = appearanceFeedbackColor(pale, paper, id);
    assert.ok(contrastRatio(darkened, paper) >= 6);
    assert.ok((darkened >>> 8 & 255) > (darkened >>> 16) && (darkened >>> 16) > (darkened & 255), 'shade retains the green channel order');
    assert.equal(appearanceFeedbackColor(pale, night, id), pale, 'already legible green is unchanged on the night palette');
    assert.ok(contrastRatio(appearanceFeedbackColor(0x252720, night, id), night) >= 6);
    assert.ok(contrastRatio(appearanceFeedbackColor(paper, paper, id), paper) >= 6, 'photo must not hide an invisible same-background trail color');
  }
  assert.equal(appearanceFeedbackColor(pale, paper, 'original'), pale);
  assert.equal(appearanceFeedbackColor('#405060', '#f4f3eb', 'original'), 0x405060);
});
