// Local campaign records. Version 1 saved only a contiguous completion frontier;
// keep that evidence separately so skipped levels never become inferred wins.
export const CAMPAIGN_PROGRESS_VERSION = 2;
const LAST_LEVEL = 100;
const count = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
const bounded = (value, max) => Math.min(max, count(value));
const levelNumber = value => Math.max(1, bounded(value, LAST_LEVEL));
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const validKey = key => /^[a-z][a-z0-9-]{0,31}$/.test(key) && !['constructor', 'prototype'].includes(key);
const time = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const text = value => typeof value === 'string' ? value.slice(0, 160) : '';
const counterMap = raw => Object.fromEntries(Object.entries(object(raw)).filter(([key]) => validKey(key)).slice(0, 64).map(([key, value]) => [key, count(value)]));

function progressValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return text(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value).slice(0, 16).filter(([key, item]) =>
    /^[a-zA-Z][a-zA-Z0-9]{0,31}$/.test(key) && !['constructor', 'prototype'].includes(key) &&
    (typeof item === 'boolean' || typeof item === 'string' || typeof item === 'number' && Number.isFinite(item)))
    .map(([key, item]) => [key, typeof item === 'string' ? text(item) : item]));
}

function normalizedRecord(raw, historicalClear = false) {
  const value = object(raw), cleared = historicalClear || value.cleared === true;
  const attempts = count(value.attempts), settledAttempt = Math.min(attempts, count(value.settledAttempt));
  const activeAttempt = count(value.activeAttempt);
  return {
    cleared,
    // A historic clear supplies no evidence for any of the three new dots.
    rating: cleared ? bounded(value.rating, 3) : 0,
    bestScore: count(value.bestScore), attempts,
    wins: Math.min(attempts, count(value.wins)), losses: Math.min(attempts, count(value.losses)),
    abandoned: Math.min(attempts, count(value.abandoned)),
    firstClearTime: time(value.firstClearTime),
    lastElapsed: time(value.lastElapsed), lastClearTime: time(value.lastClearTime),
    lastAbandonTime: time(value.lastAbandonTime), lastLossTime: time(value.lastLossTime),
    activeElapsed: time(value.activeElapsed),
    lastOutcome: ['win', 'loss', 'abandon'].includes(value.lastOutcome) ? value.lastOutcome : null,
    lastProgress: progressValue(value.lastProgress), lastSummary: text(value.lastSummary),
    failStreak: cleared ? 0 : Math.min(count(value.losses), count(value.failStreak)),
    skipped: !cleared && value.skipped === true,
    activeAttempt: activeAttempt > settledAttempt && activeAttempt <= attempts ? activeAttempt : null,
    settledAttempt,
    upgradeChoices: counterMap(value.upgradeChoices),
  };
}

export function normalizeProgress(raw) {
  const value = object(raw), isCurrent = value.version === CAMPAIGN_PROGRESS_VERSION;
  const numericLegacy = typeof raw === 'number' && Number.isFinite(raw);
  const unlocked = numericLegacy ? levelNumber(raw) : levelNumber(value.unlocked);
  const oldCompleted = typeof value.completed === 'number' && Number.isFinite(value.completed)
    ? bounded(value.completed, LAST_LEVEL) : unlocked - 1;
  const legacyCompleted = isCurrent ? bounded(value.legacyCompleted, LAST_LEVEL) : oldCompleted;
  const levels = {};
  for (const [key, record] of Object.entries(object(value.levels))) {
    const n = Number(key);
    if (!Number.isInteger(n) || n < 1 || n > LAST_LEVEL || String(n) !== key) continue;
    levels[key] = normalizedRecord(record, n <= legacyCompleted);
  }
  let completed = legacyCompleted;
  while (completed < LAST_LEVEL && levels[completed + 1]?.cleared) completed++;
  let frontier = Math.max(unlocked, Math.min(LAST_LEVEL, completed + 1));
  for (const [key, record] of Object.entries(levels)) {
    if (record.cleared || record.skipped) frontier = Math.max(frontier, Math.min(LAST_LEVEL, Number(key) + 1));
  }
  const tutorials = Object.fromEntries(Object.entries(object(value.tutorials))
    .filter(([key, seen]) => validKey(key) && seen === true).slice(0, 32));
  return {version: CAMPAIGN_PROGRESS_VERSION, completed, unlocked: frontier, legacyCompleted,
    levels, tutorials, upgradeChoices: counterMap(value.upgradeChoices)};
}

export function levelRecord(raw, level) {
  const state = normalizeProgress(raw), n = levelNumber(level);
  return normalizedRecord(state.levels[n], n <= state.legacyCompleted);
}

function putRecord(state, level, record) {
  state.levels[level] = record;
  return normalizeProgress(state);
}

export function recordAttempt(raw, level, {upgradeId, tutorialKey, preview = false} = {}) {
  if (preview) return raw;
  let state = normalizeProgress(raw);
  const n = levelNumber(level);
  if (n > state.unlocked) return state;
  let record = levelRecord(state, n);
  // A persisted open attempt is an interrupted run. Retain its last checkpoint
  // and classify it as abandonment when the player explicitly starts again.
  if (record.activeAttempt !== null) {
    state = recordResult(state, n, {outcome: 'abandon', attemptId: record.activeAttempt,
      progress: record.lastProgress, summary: record.lastSummary, elapsed: record.activeElapsed});
    record = levelRecord(state, n);
  }
  record.attempts++; record.activeAttempt = record.attempts; record.activeElapsed = null;
  if (typeof upgradeId === 'string' && validKey(upgradeId)) {
    record.upgradeChoices[upgradeId] = count(record.upgradeChoices[upgradeId]) + 1;
    state.upgradeChoices[upgradeId] = count(state.upgradeChoices[upgradeId]) + 1;
  }
  if (typeof tutorialKey === 'string' && validKey(tutorialKey)) state.tutorials[tutorialKey] = true;
  return putRecord(state, n, record);
}

// The optional attemptId makes repeated/late result callbacks idempotent. The
// caller should retain levelRecord(state, n).activeAttempt after recordAttempt.
export function recordResult(raw, level, result = {}) {
  if (result.preview) return raw;
  const state = normalizeProgress(raw), n = levelNumber(level);
  if (n > state.unlocked || !['win', 'loss', 'abandon'].includes(result.outcome)) return state;
  const record = levelRecord(state, n);
  if (result.attemptId !== undefined && (!Number.isInteger(result.attemptId) || result.attemptId <= 0 || result.attemptId !== record.activeAttempt)) return state;
  if (record.activeAttempt === null) {
    // Permit the first result from an older caller that did not record starts;
    // after that, starts are required and duplicate result events are ignored.
    if (record.settledAttempt > 0) return state;
    record.attempts++; record.activeAttempt = record.attempts;
  }
  const wasCleared = record.cleared;
  const elapsed = time(result.elapsed) ?? record.activeElapsed;
  record.lastOutcome = result.outcome;
  record.lastElapsed = elapsed; record.activeElapsed = null;
  record.lastProgress = progressValue(result.progress);
  record.lastSummary = text(result.summary);
  record.bestScore = Math.max(record.bestScore, count(result.score));
  record.settledAttempt = record.activeAttempt; record.activeAttempt = null;
  if (result.outcome === 'win') {
    record.wins++; record.cleared = true; record.skipped = false; record.failStreak = 0;
    record.lastClearTime = elapsed;
    if (!result.legacy) record.rating = Math.max(record.rating, Math.max(1, bounded(result.rating, 3)));
    if (!wasCleared) record.firstClearTime = elapsed;
    state.unlocked = Math.max(state.unlocked, Math.min(LAST_LEVEL, n + 1));
  } else if (result.outcome === 'loss') {
    record.losses++; record.lastLossTime = elapsed;
    record.failStreak = wasCleared ? 0 : record.failStreak + 1;
  } else {
    record.abandoned++; record.failStreak = 0; record.lastAbandonTime = elapsed;
  }
  return putRecord(state, n, record);
}

export function recordCheckpoint(raw, level, {progress, summary, elapsed, attemptId, preview = false} = {}) {
  if (preview) return raw;
  const state = normalizeProgress(raw), n = levelNumber(level), record = levelRecord(state, n);
  if (record.activeAttempt === null || attemptId !== undefined && attemptId !== record.activeAttempt) return state;
  record.lastProgress = progressValue(progress); record.lastSummary = text(summary);
  if (time(elapsed) !== null) record.activeElapsed = time(elapsed);
  return putRecord(state, n, record);
}

export function canSkip(raw, level) {
  const state = normalizeProgress(raw), n = levelNumber(level), record = levelRecord(state, n);
  return n <= state.unlocked && !record.cleared && !record.skipped &&
    record.activeAttempt === null && record.failStreak >= 3;
}

export function skipLevel(raw, level, {preview = false} = {}) {
  if (preview) return raw;
  const state = normalizeProgress(raw), n = levelNumber(level);
  if (!canSkip(state, n)) return state;
  const record = levelRecord(state, n);
  record.skipped = true; record.rating = 0;
  state.unlocked = Math.max(state.unlocked, Math.min(LAST_LEVEL, n + 1));
  return putRecord(state, n, record);
}

export function markTutorial(raw, key, {preview = false} = {}) {
  if (preview) return raw;
  const state = normalizeProgress(raw);
  if (typeof key === 'string' && validKey(key)) state.tutorials[key] = true;
  return state;
}
