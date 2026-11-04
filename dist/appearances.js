// Appearance ownership is independent of polygon shapes and collision bodies.
export const APPEARANCE_STATE_VERSION = 1;
export const BIG_EYE_UNLOCK_SCORE = 26767;
export const BIG_EYE_DEFAULT_COLOR = '#b8db8a';
export const APPEARANCE_IDS = Object.freeze(['original', 'custom', 'big-eye']);

function savedObject(raw) {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return {}; }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function scoreUnlocks(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  const score = Number(value);
  return Number.isFinite(score) && score >= BIG_EYE_UNLOCK_SCORE;
}

// hasImage may be omitted while the asynchronously stored photo is loading.
// Pass the original raw save again once it resolves so legacy photos migrate
// without overriding an explicit choice of the original or big-eye appearance.
export function normalizeAppearanceState(raw, {best = 0, hasImage} = {}) {
  const saved = savedObject(raw), owned = saved.bigEyeUnlocked === true;
  const earned = scoreUnlocks(best), bigEyeUnlocked = owned || earned;
  const requested = APPEARANCE_IDS.includes(saved.selected) ? saved.selected
    : hasImage === true && saved.selected === undefined ? 'custom' : 'original';
  const selected = requested === 'big-eye' && !bigEyeUnlocked
    || requested === 'custom' && hasImage === false ? 'original' : requested;
  return {
    version: APPEARANCE_STATE_VERSION,
    selected,
    bigEyeUnlocked,
    // Persist until the animated reward has actually been dismissed. Merely
    // loading a high score or rendering its card must not consume the reward.
    pendingUnlock: bigEyeUnlocked && (saved.pendingUnlock === true || !owned && earned),
  };
}

// The caller excludes demos/campaign scores and persists the returned state at
// the live threshold. The presentation can then wait for a safe result screen.
export function unlockAppearance(raw, score) {
  const state = normalizeAppearanceState(raw);
  const newlyUnlocked = !state.bigEyeUnlocked && scoreUnlocks(score);
  return {
    state: newlyUnlocked ? {...state, bigEyeUnlocked: true, pendingUnlock: true} : state,
    newlyUnlocked,
  };
}

export function selectAppearance(raw, id, {hasImage} = {}) {
  const state = normalizeAppearanceState(raw, {hasImage});
  if (!APPEARANCE_IDS.includes(id) || id === 'big-eye' && !state.bigEyeUnlocked
      || id === 'custom' && hasImage !== true) return state;
  return {...state, selected: id};
}

export function acknowledgeAppearanceUnlock(raw) {
  const state = normalizeAppearanceState(raw);
  return state.pendingUnlock ? {...state, pendingUnlock: false} : state;
}
