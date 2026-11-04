import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProgress, levelRecord, recordAttempt, recordResult, recordCheckpoint,
  canSkip, skipLevel, markTutorial} from '../dist/campaign-progress.js';

function finish(raw, level, outcome, details = {}) {
  const started = recordAttempt(raw, level, details);
  return recordResult(started, level, {outcome, attemptId: levelRecord(started, level).activeAttempt, ...details});
}

test('numeric legacy saves represent unlocked levels, including 100 rather than 100 wins', () => {
  for (const [raw, completed, unlocked] of [[null, 0, 1], [7, 6, 7], [100, 99, 100], [101, 99, 100], [-10, 0, 1]]) {
    const state = normalizeProgress(raw);
    assert.equal(state.completed, completed);
    assert.equal(state.unlocked, unlocked);
    assert.equal(state.legacyCompleted, completed);
    for (let n = 1; n <= 100; n++) {
      const record = levelRecord(state, n);
      assert.equal(record.cleared, n <= completed);
      assert.equal(record.rating, 0);
      assert.equal(record.firstClearTime, null);
    }
  }
});

test('object migration preserves both confirmed contiguous wins and an existing available frontier', () => {
  const state = normalizeProgress({completed: 37, unlocked: 100});
  assert.equal(state.completed, 37);
  assert.equal(state.unlocked, 100);
  assert.equal(levelRecord(state, 38).cleared, false);
  assert.equal(levelRecord(state, 100).cleared, false);
  assert.deepEqual(normalizeProgress(JSON.parse(JSON.stringify(state))), state);
  assert.equal(normalizeProgress({completed: 100, unlocked: 101}).completed, 100);
  assert.equal(normalizeProgress({completed: -4}).unlocked, 1);
  assert.equal(normalizeProgress({unlocked: 15}).completed, 14);
});

test('three actual consecutive losses offer one skip without points or fake completion', () => {
  let state = normalizeProgress(null);
  state = finish(state, 1, 'loss');
  state = finish(state, 1, 'loss');
  assert.equal(canSkip(state, 1), false);
  state = finish(state, 1, 'loss');
  assert.equal(canSkip(state, 1), true);
  state = skipLevel(state, 1);
  assert.equal(state.unlocked, 2);
  assert.equal(state.completed, 0);
  assert.equal(levelRecord(state, 1).skipped, true);
  assert.equal(levelRecord(state, 1).rating, 0);
  assert.equal(canSkip(state, 1), false);
  assert.deepEqual(skipLevel(state, 1), state);
});

test('abandonment preserves prior real failures without adding another failure', () => {
  let state = normalizeProgress(null);
  state = finish(state, 1, 'loss'); state = finish(state, 1, 'loss');
  state = finish(state, 1, 'abandon', {progress: {remaining: 8, total: 20}, summary: '还剩8砖', elapsed: 28.5});
  let record = levelRecord(state, 1);
  assert.equal(record.losses, 2); assert.equal(record.abandoned, 1); assert.equal(record.failStreak, 2);
  assert.deepEqual(record.lastProgress, {remaining: 8, total: 20});
  assert.equal(record.lastSummary, '还剩8砖');
  assert.equal(record.lastAbandonTime, 28.5); assert.equal(record.lastElapsed, 28.5);
  state = finish(state, 1, 'loss');
  assert.equal(canSkip(state, 1), true);
  assert.equal(levelRecord(state, 1).attempts, 4);
});

test('clearing after skipped holes advances only the contiguous completion frontier', () => {
  let state = normalizeProgress(null);
  for (let i = 0; i < 3; i++) state = finish(state, 1, 'loss');
  state = skipLevel(state, 1);
  state = finish(state, 2, 'win', {legacy: true, score: 40, elapsed: 20});
  assert.equal(state.completed, 0); assert.equal(state.unlocked, 3);
  assert.equal(levelRecord(state, 2).cleared, true); assert.equal(levelRecord(state, 2).rating, 0);
  state = finish(state, 3, 'win', {legacy: true});
  assert.equal(state.completed, 0); assert.equal(state.unlocked, 4);
  state = finish(state, 1, 'win', {rating: 2, score: 100, elapsed: 37.2});
  assert.equal(state.completed, 3); assert.equal(state.unlocked, 4);
  assert.equal(levelRecord(state, 1).skipped, false);
  assert.equal(levelRecord(state, 1).rating, 2);
  assert.equal(levelRecord(state, 1).firstClearTime, 37.2);
});

test('a future milestone win cannot manufacture previous wins or three-dot scores', () => {
  let state = normalizeProgress({completed: 8, unlocked: 10});
  state = finish(state, 10, 'win', {rating: 3, score: 460, elapsed: 51});
  assert.equal(state.completed, 8); assert.equal(state.unlocked, 11);
  assert.equal(levelRecord(state, 9).cleared, false);
  assert.equal(levelRecord(state, 10).cleared, true);
  assert.equal(levelRecord(state, 10).rating, 3);
  assert.equal(levelRecord(state, 8).rating, 0);
  state = finish(state, 9, 'win', {legacy: true});
  assert.equal(state.completed, 10);
});

test('best rating and score survive retries, while first-clear time is assigned once', () => {
  let state = finish(null, 1, 'win', {rating: 2, score: 300, elapsed: 40});
  state = finish(state, 1, 'loss', {score: 80, elapsed: 12});
  state = finish(state, 1, 'win', {rating: 1, score: 200, elapsed: 30});
  let record = levelRecord(state, 1);
  assert.equal(record.rating, 2); assert.equal(record.bestScore, 300); assert.equal(record.firstClearTime, 40);
  assert.equal(record.lastLossTime, 12); assert.equal(record.lastClearTime, 30); assert.equal(record.lastElapsed, 30);
  assert.equal(record.attempts, 3); assert.equal(record.wins, 2); assert.equal(record.losses, 1);
  assert.equal(record.failStreak, 0);
  state = finish(state, 1, 'win', {rating: 3, score: 500, elapsed: 25});
  record = levelRecord(state, 1);
  assert.equal(record.rating, 3); assert.equal(record.bestScore, 500); assert.equal(record.firstClearTime, 40);
});

test('historic replay can earn a rating without inventing a historical first-clear time', () => {
  const state = finish(normalizeProgress(11), 10, 'win', {rating: 2, elapsed: 29});
  assert.equal(state.completed, 10); assert.equal(state.unlocked, 11);
  assert.equal(levelRecord(state, 10).rating, 2);
  assert.equal(levelRecord(state, 10).firstClearTime, null);
});

test('attempt IDs reject duplicate and late end events across restart', () => {
  let state = recordAttempt(null, 1);
  const first = levelRecord(state, 1).activeAttempt;
  state = recordResult(state, 1, {outcome: 'loss', attemptId: first});
  assert.deepEqual(recordResult(state, 1, {outcome: 'loss', attemptId: first}), state);
  assert.deepEqual(recordResult(state, 1, {outcome: 'loss'}), state);
  state = recordAttempt(state, 1);
  const second = levelRecord(state, 1).activeAttempt;
  assert.equal(second, first + 1);
  assert.deepEqual(recordResult(state, 1, {outcome: 'win', attemptId: first, rating: 3}), state);
  state = recordResult(state, 1, {outcome: 'win', attemptId: second, rating: 1});
  assert.equal(levelRecord(state, 1).attempts, 2);
  assert.equal(levelRecord(state, 1).losses, 1);
  assert.equal(levelRecord(state, 1).wins, 1);
});

test('restarting a persisted open run keeps its interruption checkpoint', () => {
  let state = recordAttempt(null, 1);
  const attemptId = levelRecord(state, 1).activeAttempt;
  state = recordCheckpoint(state, 1, {attemptId, progress: {remaining: 12, total: 20}, summary: '还剩12砖', elapsed: 18.25});
  state = recordAttempt(JSON.parse(JSON.stringify(state)), 1);
  const record = levelRecord(state, 1);
  assert.equal(record.attempts, 2); assert.equal(record.abandoned, 0); assert.equal(record.interrupted, 1);
  assert.equal(record.lastOutcome, 'interrupt'); assert.equal(record.activeAttempt, 2);
  assert.deepEqual(record.lastProgress, {remaining: 12, total: 20});
  assert.equal(record.lastSummary, '还剩12砖');
  assert.equal(record.lastInterruptTime, 18.25); assert.equal(record.lastElapsed, 18.25);
  assert.equal(record.activeElapsed, null);
});

test('trial operations leave formal records untouched, including tutorial and choices', () => {
  const state = normalizeProgress({completed: 20, unlocked: 21}), before = JSON.stringify(state);
  assert.equal(recordAttempt(state, 21, {upgradeId: 'energy', tutorialKey: 'wall', preview: true}), state);
  assert.equal(recordResult(state, 21, {outcome: 'win', rating: 3, preview: true}), state);
  assert.equal(skipLevel(state, 21, {preview: true}), state);
  assert.equal(recordCheckpoint(state, 21, {progress: 1, preview: true}), state);
  assert.equal(markTutorial(state, 'wall', {preview: true}), state);
  assert.equal(JSON.stringify(state), before);
});

test('tutorial waits for a real win while upgrade usage persists without mutating inputs', () => {
  const input = normalizeProgress(null), before = JSON.stringify(input);
  let state = recordAttempt(input, 1, {upgradeId: 'energy', tutorialKey: 'wall'});
  state = recordResult(state, 1, {outcome: 'loss'});
  state = recordAttempt(state, 1, {upgradeId: 'rubber'});
  assert.equal(state.tutorials.wall, undefined);
  state = recordResult(state, 1, {outcome: 'win', rating: 1});
  assert.equal(state.tutorials.wall, true);
  assert.deepEqual(state.upgradeChoices, {energy: 1, rubber: 1});
  assert.deepEqual(levelRecord(state, 1).upgradeChoices, {energy: 1, rubber: 1});
  assert.equal(JSON.stringify(input), before);
  assert.equal(markTutorial(state, 'peggle').tutorials.peggle, true);
});

test('invalid numeric metadata, forged dots and oversized/unsafe record keys are normalized', () => {
  const state = normalizeProgress({version: 3, legacyCompleted: NaN, completed: 100, unlocked: 1,
    levels: {'1': {cleared: false, rating: 3, bestScore: Infinity, attempts: -5, failStreak: 10},
      '2': {cleared: true, rating: 9}, '101': {cleared: true}, '03': {cleared: true}},
    tutorials: {wall: true, constructor: true, bogus: 1}, upgradeChoices: {energy: Infinity}});
  assert.equal(state.completed, 0); assert.equal(state.unlocked, 3);
  assert.equal(levelRecord(state, 1).rating, 0);
  assert.equal(levelRecord(state, 1).bestScore, 0);
  assert.equal(levelRecord(state, 1).failStreak, 0);
  assert.equal(levelRecord(state, 2).rating, 3);
  assert.deepEqual(Object.keys(state.levels), ['1', '2']);
  assert.deepEqual(state.tutorials, {wall: true});
  assert.deepEqual(normalizeProgress(JSON.parse(JSON.stringify(state))), state);
});

test('locked attempts and invalid results do not unlock or change records', () => {
  const state = normalizeProgress(null);
  assert.deepEqual(recordAttempt(state, 2), state);
  assert.deepEqual(recordResult(state, 2, {outcome: 'win', rating: 3}), state);
  assert.deepEqual(recordResult(state, 1, {outcome: 'unknown'}), state);
  assert.deepEqual(recordResult(state, 1, {outcome: 'win', attemptId: null}), state);
});

test('level 100 remains capped and skipping it does not count as completion', () => {
  let state = normalizeProgress(100);
  for (let i = 0; i < 3; i++) state = finish(state, 100, 'loss');
  assert.equal(canSkip(state, 100), true);
  state = skipLevel(state, 100);
  assert.equal(state.completed, 99); assert.equal(state.unlocked, 100);
  state = finish(state, 100, 'win', {rating: 1, elapsed: 70});
  assert.equal(state.completed, 100); assert.equal(state.unlocked, 100);
  assert.equal(levelRecord(state, 100).rating, 1);
});
