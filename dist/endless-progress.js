export const ENDLESS_PROGRESS_VERSION = 1;
export const ENDLESS_DAILY_LIMIT = 32;

// Scores and progress must survive a JSON round trip without NaN, Infinity,
// negative values or fractional layers. Numeric strings support legacy saves.
function nonnegativeInteger(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return 0;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(number))) : 0;
}

function validDateKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [year, month, day] = key.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

function savedObject(raw) {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return {}; }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function recordValues(raw) {
  return {best: nonnegativeInteger(raw?.best), maxStage: nonnegativeInteger(raw?.maxStage), maxCombo: nonnegativeInteger(raw?.maxCombo)};
}

function maxima(first, second) {
  return {best: Math.max(first.best, second.best), maxStage: Math.max(first.maxStage, second.maxStage), maxCombo: Math.max(first.maxCombo, second.maxCombo)};
}

export function normalizeEndless(raw, legacyBest = 0) {
  const saved = savedObject(raw), byDate = new Map();
  let allTime = {...recordValues(saved), best: Math.max(nonnegativeInteger(saved.best), nonnegativeInteger(legacyBest))};
  for (const record of Array.isArray(saved.daily) ? saved.daily : []) {
    if (!record || typeof record !== 'object' || !validDateKey(record.key)) continue;
    const values = recordValues(record);
    byDate.set(record.key, maxima(byDate.get(record.key) || {best: 0, maxStage: 0, maxCombo: 0}, values));
    // Preserve achievements from older days even when their daily entry ages
    // out of the bounded history, including when repairing an oversized save.
    allTime = maxima(allTime, values);
  }
  const daily = [...byDate].sort(([a], [b]) => a < b ? 1 : a > b ? -1 : 0)
    .slice(0, ENDLESS_DAILY_LIMIT).map(([key, values]) => ({key, ...values}));
  return {version: ENDLESS_PROGRESS_VERSION, ...allTime, daily};
}

export function recordEndlessRun(raw, {score, stage, maxCombo, dateKey} = {}) {
  const state = normalizeEndless(raw), values = {best: nonnegativeInteger(score), maxStage: nonnegativeInteger(stage), maxCombo: nonnegativeInteger(maxCombo)};
  const daily = validDateKey(dateKey) ? [...state.daily, {key: dateKey, ...values}] : state.daily;
  // No clock is read here. A run keeps the date captured at its start, even
  // when its final score or milestone is recorded after local midnight.
  return normalizeEndless({...state, ...maxima(state, values), daily});
}

// The same merge is safe at entry and stage boundaries, before a run ends.
export const recordEndlessProgress = recordEndlessRun;

function localDateKey(date) {
  if (typeof date === 'string' && validDateKey(date)) return date;
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new RangeError('A valid local run date is required');
  const key = `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  if (!validDateKey(key)) throw new RangeError('Run date must be between years 0001 and 9999');
  return key;
}

function randomSeed() {
  // Draw fresh entropy for every run, including rapid restarts on the same day.
  // The local date is only for score records and never determines gameplay.
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 4294967296);
}

function randomFor(seed) {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  // Read without drawing another number. Resuming a run must continue the
  // shared spawn/upgrade stream at exactly its captured position.
  Object.defineProperty(random, 'getState', {value: () => state});
  return random;
}

export function captureEndlessRun(run) {
  if (!run || !validDateKey(run.key) || !Number.isInteger(run.seed) || run.seed < 0 || run.seed > 0xffffffff
    || typeof run.random?.getState !== 'function') throw new TypeError('Invalid resumable run');
  const state = run.random.getState();
  if (!Number.isInteger(state) || state < 0 || state > 0xffffffff) throw new TypeError('Invalid random state');
  return {key: run.key, seed: run.seed, state};
}

export function restoreEndlessRun(saved) {
  if (!saved || !validDateKey(saved.key) || ![saved.seed, saved.state].every(value =>
    Number.isInteger(value) && value >= 0 && value <= 0xffffffff)) throw new TypeError('Invalid saved run');
  return Object.freeze({key: saved.key, seed: saved.seed, random: randomFor(saved.state)});
}

export function createEndlessRun(date = new Date(), seed = randomSeed()) {
  const key = localDateKey(date);
  seed = seed >>> 0;
  // The RNG closure and captured date belong to this run. Gameplay systems
  // share it; cosmetic sampling must use a separate source owned by the UI.
  return Object.freeze({key, seed, random: randomFor(seed)});
}
