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
  const n = sideCount(sides), key = `${n}:${count}`;
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

export function normalizeSkins(raw, completed = 0) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const saved = Number.isInteger(value.unlocked) && value.unlocked >= SKIN_MIN_SIDES
    ? clamp(value.unlocked, SKIN_MIN_SIDES, SKIN_MAX_SIDES) : 0;
  const unlocked = Math.max(saved, unlockedSkinSides(completed));
  return {
    enabled: unlocked > 0 && value.enabled === true,
    sides: clamp(Math.round(finite(value.sides, SKIN_MIN_SIDES)), SKIN_MIN_SIDES, unlocked || SKIN_MIN_SIDES),
    unlocked,
  };
}

// Normalize with the OLD completed progress at load time. Award a freshly
// completed milestone here before migrating progress again. Previously earned
// milestones remain owned, so replaying one never opens another unlock popup.
export function unlockSkin(raw, level) {
  const state = normalizeSkins(raw);
  const milestone = Number.isInteger(level) && level >= 10 && level <= 100 && level % 10 === 0;
  const rewardSides = milestone ? level / 10 + 5 : 0;
  if (rewardSides <= state.unlocked) return {state, rewardSides: null};
  return {state: {...state, unlocked: rewardSides}, rewardSides};
}

export function selectSkin(raw, sides) {
  const state = normalizeSkins(raw);
  return {...state, sides: clamp(Math.round(finite(sides, state.sides)), SKIN_MIN_SIDES, state.unlocked || SKIN_MIN_SIDES)};
}

export function toggleSkins(raw, enabled) {
  const state = normalizeSkins(raw);
  return {...state, enabled: state.unlocked > 0 && !!enabled};
}
