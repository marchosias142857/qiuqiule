// Appearance ownership is independent of polygon shapes and collision bodies.
export const APPEARANCE_STATE_VERSION = 1;
export const BIG_EYE_UNLOCK_SCORE = 26767;
export const BIG_EYE_DEFAULT_COLOR = '#b8db8a';
export const ORIGINAL_PLAYER_COLOR = '#252720';
const validColor = color => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
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
    ...(selected === 'big-eye' && validColor(saved.previousPlayerColor)
      ? {previousPlayerColor: saved.previousPlayerColor} : {}),
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

// The temporary green belongs to the appearance, not to the user's underlying
// player palette. Keep its exact predecessor across reloads and rapid changes.
export function changeAppearance(raw, id, {hasImage, playerColor = ORIGINAL_PLAYER_COLOR} = {}) {
  const state = normalizeAppearanceState(raw, {hasImage});
  const next = selectAppearance(state, id, {hasImage});
  const currentColor = validColor(playerColor) ? playerColor : ORIGINAL_PLAYER_COLOR;
  if (next.selected !== id || next.selected === state.selected) {
    return {state: next, playerColor: currentColor, changed: false};
  }
  if (id === 'big-eye') {
    return {state: {...next, previousPlayerColor: currentColor},
      playerColor: BIG_EYE_DEFAULT_COLOR, changed: true};
  }
  // v7.9 never stored a predecessor. Its already-equipped saves use the
  // original default rather than inventing a previous custom color.
  const restored = state.selected === 'big-eye'
    ? state.previousPlayerColor || ORIGINAL_PLAYER_COLOR : currentColor;
  delete next.previousPlayerColor;
  return {state: next, playerColor: restored, changed: true};
}

const colorValue = (value, fallback) => validColor(value) ? parseInt(value.slice(1), 16)
  : Number.isInteger(value) && value >= 0 && value <= 0xffffff ? value : fallback;
const mixColor = (from, to, t) => [16,8,0].reduce((value, shift) => value | (Math.round(
  ((from >> shift) & 255) * (1 - t) + ((to >> shift) & 255) * t) << shift), 0);
const luminance = value => [16,8,0].reduce((sum, shift, index) => {
  const channel = ((value >> shift) & 255) / 255;
  return sum + (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
    * [.2126,.7152,.0722][index];
}, 0);
const contrast = (a, b) => (Math.max(a,b) + .05) / (Math.min(a,b) + .05);

// Thin translucent feedback cannot use the pale body fill unchanged on a pale
// arena. Custom photos can conceal that same pale underlying palette, so both
// photo and Big Eye trails need this contrast protection. Body colors and the
// original appearance's trail style remain unchanged; aim guides use theme ink.
export function appearanceFeedbackColor(playerColor, backgroundColor, id = 'original') {
  const color = colorValue(playerColor, 0x252720);
  if (id !== 'big-eye' && id !== 'custom') return color;
  const background = luminance(colorValue(backgroundColor, 0xf4f3eb));
  const required = 6;
  if (contrast(luminance(color), background) >= required) return color;
  const target = contrast(0, background) >= contrast(1, background) ? 0x000000 : 0xffffff;
  const threshold = Math.min(required, contrast(luminance(target), background));
  let low = 0, high = 1;
  for (let step = 0; step < 16; step++) {
    const middle = (low + high) / 2;
    if (contrast(luminance(mixColor(color, target, middle)), background) >= threshold) high = middle;
    else low = middle;
  }
  return mixColor(color, target, high);
}
