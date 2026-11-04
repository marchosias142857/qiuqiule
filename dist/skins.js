// Skin geometry is deliberately independent of bodies and collision radii.
// Zero represents the original circle; rewards are regular polygons 6–15.
export const SKIN_MIN_SIDES = 6;
export const SKIN_MAX_SIDES = 15;
export const SKIN_SEGMENTS = 192;
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const contourCache = new Map();

export function contourArea(points) {
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twiceArea) * .5;
}

function equalArea(points) {
  const scale = Math.sqrt(Math.PI / contourArea(points));
  return points.map(point => ({x: point.x * scale, y: point.y * scale}));
}

function sideCount(value) {
  return Number.isFinite(value) && value >= SKIN_MIN_SIDES
    ? clamp(Math.round(value), SKIN_MIN_SIDES, SKIN_MAX_SIDES) : 0;
}

// A regular polygon eroded by a disc, then dilated by that same disc. Each
// straight side meets its circular corner tangentially, without sharp joins.
// A horizontal top side also gives every skin a natural crown attachment.
function roundedRadius(angle, sides) {
  if (!sides) return 1;
  const half = Math.PI / sides, sector = half * 2;
  const apothem = Math.cos(half), rounding = .24;
  const normal = Math.round((angle + Math.PI * .5) / sector) * sector - Math.PI * .5;
  const delta = angle - normal;
  const straightRadius = apothem / Math.cos(delta);
  const straightHalfLength = (apothem - rounding) * Math.tan(half);
  if (Math.abs(straightRadius * Math.sin(delta)) <= straightHalfLength) return straightRadius;
  const vertexAngle = normal + (delta < 0 ? -half : half);
  const centerRadius = (apothem - rounding) / Math.cos(half);
  const relativeAngle = angle - vertexAngle;
  const along = centerRadius * Math.cos(relativeAngle);
  const across = centerRadius * Math.sin(relativeAngle);
  return along + Math.sqrt(Math.max(0, rounding * rounding - across * across));
}

// The returned contour has no repeated final point. All skins use the same
// polar angles, so interpolation never twists their correspondence. Normalize
// the actual rendered polygon, rather than only the ideal curved shape, to π.
export function skinContour(sides = 0, segments = SKIN_SEGMENTS) {
  const count = clamp(Math.floor(finite(segments, SKIN_SEGMENTS)), 48, 1536);
  const n = sideCount(typeof sides === 'object' ? sides?.sides : sides);
  const key = `${n}:${count}`;
  if (!contourCache.has(key)) {
    const points = Array.from({length: count}, (_, i) => {
      const angle = TAU * i / count, radius = roundedRadius(angle, n);
      return {x: Math.cos(angle) * radius, y: Math.sin(angle) * radius};
    });
    contourCache.set(key, Object.freeze(equalArea(points).map(Object.freeze)));
  }
  return contourCache.get(key);
}

// Arrays are accepted as endpoints so a second tap can start from the current
// in-between contour without snapping back to the previous integer skin.
export function morphSkinContour(fromSides, toSides, progress, segments = SKIN_SEGMENTS) {
  const from = Array.isArray(fromSides) ? fromSides : skinContour(fromSides, segments);
  const to = Array.isArray(toSides) ? toSides : skinContour(toSides, from.length);
  if (from.length !== to.length) throw new RangeError('Skin contours must use matching sample counts');
  const t = clamp(finite(progress), 0, 1);
  if (!t) return from;
  if (t === 1) return to;
  return equalArea(from.map((point, i) => ({
    x: point.x + (to[i].x - point.x) * t,
    y: point.y + (to[i].y - point.y) * t,
  })));
}

// Intersect the requested ray with the cached contour. Integer sample angles
// reproduce skinContour exactly; intermediate angles stay on its true edge.
export function skinPoint(angle, sides = 0, segments = SKIN_SEGMENTS) {
  const points = Array.isArray(sides) ? sides : skinContour(sides, segments);
  const theta = ((finite(angle) % TAU) + TAU) % TAU;
  const index = Math.min(points.length - 1, Math.floor(theta / TAU * points.length));
  const a = points[index], b = points[(index + 1) % points.length];
  const x = Math.cos(theta), y = Math.sin(theta);
  const denominator = x * (b.y - a.y) - y * (b.x - a.x);
  const radius = (a.x * b.y - a.y * b.x) / denominator;
  return {x: radius * x, y: radius * y};
}

// The upper boundary in skin-local coordinates, including during a morph.
// Call with x / playerRadius and multiply the result by playerRadius to adapt
// the crown's lower edge. Rotation/deformation can be applied to both together.
export function contourTopY(points, x) {
  if (!points?.length) return 0;
  const minX = Math.min(...points.map(point => point.x));
  const maxX = Math.max(...points.map(point => point.x));
  const target = clamp(finite(x), minX, maxX);
  let top = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (target < Math.min(a.x, b.x) - 1e-12 || target > Math.max(a.x, b.x) + 1e-12) continue;
    if (Math.abs(b.x - a.x) < 1e-12) top = Math.min(top, a.y, b.y);
    else {
      const t = clamp((target - a.x) / (b.x - a.x), 0, 1);
      top = Math.min(top, a.y + (b.y - a.y) * t);
    }
  }
  return Number.isFinite(top) ? top : 0;
}

export function unlockedSkinSides(completed) {
  const cleared = clamp(Math.floor(finite(completed?.completed ?? completed)), 0, 100);
  return cleared < 10 ? 0 : Math.floor(cleared / 10) + 5;
}

// Only campaign-earned polygons are selectable. Retired endless unlock fields
// are ignored, so they cannot grant a campaign skin during save migration.
function ownedSkinSides(raw, completed = 0) {
  const saved = raw && typeof raw === 'object' ? raw : {};
  const unlocked = Number.isInteger(saved.unlocked) && saved.unlocked >= SKIN_MIN_SIDES
    ? clamp(saved.unlocked, SKIN_MIN_SIDES, SKIN_MAX_SIDES) : 0;
  // Before skipping existed, unlocked represented a complete prefix. New
  // noncontiguous saves carry their exact ownership and never infer that
  // skipped lower milestones were cleared from the highest owned polygon.
  const sides = Array.isArray(saved.owned)
    ? saved.owned.filter(side => Number.isInteger(side) && side >= SKIN_MIN_SIDES && side <= SKIN_MAX_SIDES)
    : Array.from({length: Math.max(0, unlocked - SKIN_MIN_SIDES + 1)}, (_, i) => SKIN_MIN_SIDES + i);
  const earned = unlockedSkinSides(completed);
  for (let side = SKIN_MIN_SIDES; side <= earned; side++) sides.push(side);
  return [...new Set(sides)].sort((a, b) => a - b);
}

export function skinOptions(raw) {
  return ownedSkinSides(raw).map(sides => ({sides}));
}

export function normalizeSkins(raw, completed = 0) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const owned = ownedSkinSides(value, completed), unlocked = owned.at(-1) || 0;
  const requested = clamp(Math.round(finite(value.sides, SKIN_MIN_SIDES)), SKIN_MIN_SIDES, unlocked || SKIN_MIN_SIDES);
  // An old active endless shape falls back to an owned polygon of the same or
  // nearest lower side count, or the original circle when none is unlocked.
  const state = {
    enabled: unlocked > 0 && value.enabled === true,
    sides: owned.filter(side => side <= requested).at(-1) || owned[0] || SKIN_MIN_SIDES, unlocked,
  };
  // Keep the historic shape unchanged for all contiguous saves. Once a gap is
  // truly completed, the optional exact-ownership field is no longer needed.
  if (owned.length && owned.length !== unlocked - SKIN_MIN_SIDES + 1) state.owned = owned;
  return state;
}

// Normalize with the OLD completed progress at load time. Award a freshly
// completed milestone here before migrating progress again. Previously earned
// milestones remain owned, so replaying one never opens another unlock popup.
export function unlockSkin(raw, level) {
  const state = normalizeSkins(raw);
  const milestone = Number.isInteger(level) && level >= 10 && level <= 100 && level % 10 === 0;
  const rewardSides = milestone ? level / 10 + 5 : 0;
  const owned = ownedSkinSides(state);
  if (!rewardSides || owned.includes(rewardSides)) return {state, rewardSides: null};
  return {state: normalizeSkins({...state, owned: [...owned, rewardSides]}), rewardSides};
}

export function selectSkin(raw, sides) {
  const state = normalizeSkins(raw);
  return normalizeSkins({...state, sides: finite(typeof sides === 'object' ? sides?.sides : sides, state.sides)});
}

export function toggleSkins(raw, enabled) {
  const state = normalizeSkins(raw);
  return {...state, enabled: skinOptions(state).length > 0 && !!enabled};
}
