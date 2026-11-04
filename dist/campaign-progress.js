// Version 3 pairs five modes across each chapter. Old completion evidence and
// unlocked skins survive; ratings earned on the old layouts are archived.
export const CAMPAIGN_PROGRESS_VERSION = 3;
const LAST_LEVEL = 100;
const count = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
const bounded = (value, max) => Math.min(max, count(value));
const levelNumber = value => Math.max(1, bounded(value, LAST_LEVEL));
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const validKey = key => /^[a-z][a-z0-9-]{0,31}$/.test(key) && !['constructor', 'prototype'].includes(key);
const time = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const text = value => typeof value === 'string' ? value.slice(0, 160) : '';
const offerList = raw => {
  const ids = Array.isArray(raw) ? [...new Set(raw.filter(id => typeof id === 'string' && validKey(id)))].slice(0, 2) : [];
  return ids.length === 2 ? ids : [];
};
const modeForLevel = n => ['wall', 'pool', 'merge', 'golf', 'peggle'][Math.floor(((n - 1) % 10) / 2)];
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
    cleared, historicalClear: value.historicalClear === true,
    // A historic clear supplies no evidence for any of the three new dots.
    rating: cleared ? bounded(value.rating, 3) : 0,
    bestScore: count(value.bestScore), attempts,
    wins: Math.min(attempts, count(value.wins)), losses: Math.min(attempts, count(value.losses)),
    abandoned: Math.min(attempts, count(value.abandoned)), interrupted: Math.min(attempts, count(value.interrupted)),
    firstClearTime: time(value.firstClearTime),
    lastElapsed: time(value.lastElapsed), lastClearTime: time(value.lastClearTime),
    lastAbandonTime: time(value.lastAbandonTime), lastLossTime: time(value.lastLossTime), lastInterruptTime: time(value.lastInterruptTime),
    activeElapsed: time(value.activeElapsed),
    lastOutcome: ['win', 'loss', 'abandon', 'interrupt'].includes(value.lastOutcome) ? value.lastOutcome : null,
    lastProgress: progressValue(value.lastProgress), lastSummary: text(value.lastSummary),
    failStreak: cleared ? 0 : Math.min(count(value.losses), count(value.failStreak)),
    skipped: !cleared && value.skipped === true,
    activeAttempt: activeAttempt > settledAttempt && activeAttempt <= attempts ? activeAttempt : null,
    settledAttempt,
    upgradeChoices: counterMap(value.upgradeChoices), offerChoices: offerList(value.offerChoices),
    tutorialKey: typeof value.tutorialKey === 'string' && validKey(value.tutorialKey) ? value.tutorialKey : null,
  };
}

export function normalizeProgress(raw) {
  const value = object(raw), isCurrent = value.version === CAMPAIGN_PROGRESS_VERSION, isV2 = value.version === 2;
  const migrate = !isCurrent && (isV2 || Object.keys(value.levels || {}).length > 0);
  const numericLegacy = typeof raw === 'number' && Number.isFinite(raw);
  const unlocked = numericLegacy ? levelNumber(raw) : levelNumber(value.unlocked);
  const oldCompleted = typeof value.completed === 'number' && Number.isFinite(value.completed)
    ? bounded(value.completed, LAST_LEVEL) : unlocked - 1;
  const legacyCompleted = isCurrent || isV2 ? bounded(value.legacyCompleted, LAST_LEVEL) : oldCompleted;
  const levels = {}, legacyRecords = {};
  for (const [key, record] of Object.entries(object(value.legacyRecords))) {
    const n = Number(key);
    if (Number.isInteger(n) && n >= 1 && n <= LAST_LEVEL && String(n) === key) legacyRecords[key] = normalizedRecord(record);
  }
  for (const [key, record] of Object.entries(object(value.levels))) {
    const n = Number(key);
    if (!Number.isInteger(n) || n < 1 || n > LAST_LEVEL || String(n) !== key) continue;
    const normalized = normalizedRecord(record, n <= legacyCompleted);
    if (migrate) {
      legacyRecords[key] = normalizedRecord(record, n <= legacyCompleted);
      normalized.historicalClear = normalized.cleared;
      normalized.rating = 0; normalized.bestScore = 0; normalized.lastSummary = ''; normalized.lastProgress = null;
      normalized.offerChoices = []; normalized.tutorialKey = null;
    }
    levels[key] = normalized;
  }
  let completed = legacyCompleted;
  while (completed < LAST_LEVEL && levels[completed + 1]?.cleared) completed++;
  let frontier = Math.max(unlocked, Math.min(LAST_LEVEL, completed + 1));
  for (const [key, record] of Object.entries(levels)) {
    if (record.cleared || record.skipped) frontier = Math.max(frontier, Math.min(LAST_LEVEL, Number(key) + 1));
  }
  const tutorials = Object.fromEntries(Object.entries(object(isCurrent ? value.tutorials : {}))
    .filter(([key, seen]) => validKey(key) && seen === true).slice(0, 32));
  return {version: CAMPAIGN_PROGRESS_VERSION, completed, unlocked: frontier, legacyCompleted,
    levels, tutorials, legacyRecords, upgradeChoices: counterMap(value.upgradeChoices)};
}

export function levelRecord(raw, level) {
  const state = normalizeProgress(raw), n = levelNumber(level);
  return normalizedRecord(state.levels[n], n <= state.legacyCompleted);
}

function putRecord(state, level, record) {
  state.levels[level] = record;
  return normalizeProgress(state);
}

export function recordAttempt(raw, level, {upgradeId, tutorialKey, offerChoices, preview = false} = {}) {
  if (preview) return raw;
  let state = normalizeProgress(raw);
  const n = levelNumber(level);
  if (n > state.unlocked) return state;
  let record = levelRecord(state, n);
  // A persisted open attempt was interrupted, not deliberately abandoned.
  if (record.activeAttempt !== null) {
    state = recordResult(state, n, {outcome: 'interrupt', attemptId: record.activeAttempt,
      progress: record.lastProgress, summary: record.lastSummary, elapsed: record.activeElapsed});
    record = levelRecord(state, n);
  }
  record.attempts++; record.activeAttempt = record.attempts; record.activeElapsed = null;
  if (typeof upgradeId === 'string' && validKey(upgradeId)) {
    record.upgradeChoices[upgradeId] = count(record.upgradeChoices[upgradeId]) + 1;
    state.upgradeChoices[upgradeId] = count(state.upgradeChoices[upgradeId]) + 1;
  }
  record.tutorialKey = typeof tutorialKey === 'string' && validKey(tutorialKey) ? tutorialKey : modeForLevel(n);
  const offers = offerList(offerChoices);
  if (!record.offerChoices.length && offers.length === 2) record.offerChoices = offers;
  return putRecord(state, n, record);
}

// The optional attemptId makes repeated/late result callbacks idempotent. The
// caller should retain levelRecord(state, n).activeAttempt after recordAttempt.
export function recordResult(raw, level, result = {}) {
  if (result.preview) return raw;
  const state = normalizeProgress(raw), n = levelNumber(level);
  if (n > state.unlocked || !['win', 'loss', 'abandon', 'interrupt'].includes(result.outcome)) return state;
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
    const tutorialKey = typeof result.tutorialKey === 'string' && validKey(result.tutorialKey) ? result.tutorialKey : record.tutorialKey || modeForLevel(n);
    state.tutorials[tutorialKey] = true;
    record.lastClearTime = elapsed;
    if (!result.legacy) record.rating = Math.max(record.rating, Math.max(1, bounded(result.rating, 3)));
    if (!wasCleared) record.firstClearTime = elapsed;
    state.unlocked = Math.max(state.unlocked, Math.min(LAST_LEVEL, n + 1));
  } else if (result.outcome === 'loss') {
    record.losses++; record.lastLossTime = elapsed; record.offerChoices = [];
    record.failStreak = wasCleared ? 0 : record.failStreak + 1;
  } else if (result.outcome === 'abandon') {
    record.abandoned++; record.lastAbandonTime = elapsed;
  } else {
    record.interrupted++; record.lastInterruptTime = elapsed;
  }
  return putRecord(state, n, record);
}

// Candidate IDs are stored before choosing a buff. Cancelling, restarting or
// interrupting therefore cannot repeatedly reroll the pair. Only a real loss
// clears it. upgradeChoices remains the separate usage counter map.
export function recordOffers(raw, level, choices, {preview = false} = {}) {
  if (preview) return raw;
  const state = normalizeProgress(raw), n = levelNumber(level), offers = offerList(choices);
  if (n > state.unlocked || offers.length !== 2) return state;
  const record = levelRecord(state, n);
  if (!record.offerChoices.length) record.offerChoices = offers;
  return putRecord(state, n, record);
}

// Call once when loading persisted data. A normal pause/resume only writes a
// checkpoint; it does not settle the attempt or count an interruption.
export function recoverInterruptedAttempts(raw) {
  let state = normalizeProgress(raw);
  for (const [level, record] of Object.entries(state.levels)) {
    if (record.activeAttempt === null) continue;
    state = recordResult(state, Number(level), {outcome: 'interrupt', attemptId: record.activeAttempt,
      elapsed: record.activeElapsed, progress: record.lastProgress, summary: record.lastSummary});
  }
  return state;
}
export const recoverInterruptions = recoverInterruptedAttempts;

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
