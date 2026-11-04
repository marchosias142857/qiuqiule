const definition = (id, name, stage, value, options = {}) => Object.freeze({
  id, name, stage, value, spawnable: true, radiusMultiplier: 1, hpMultiplier: 1,
  densityMultiplier: 1, massScale: 1, restitution: .9, drag: 1.2,
  driftSpeed: .2, moveSpeed: 0, shield: false, ...options,
});

// Distances and speeds are expressed in player-radius units. Physics owns the
// conversion to pixels, movement, teaching encounters, and score multipliers.
export const ENEMY_TYPES = Object.freeze({
  normal: definition('normal', '普通球', 1, 10),
  ring: definition('ring', '空心环', 3, 15, {hpMultiplier: 2, massScale: .5, restitution: 1, driftSpeed: 0}),
  heavy: definition('heavy', '重球', 6, 30, {radiusMultiplier: 1.3, hpMultiplier: 3, densityMultiplier: 2.5, drag: 3, driftSpeed: 0, clusterLimit: 1}),
  split: definition('split', '分裂球', 8, 20, {radius: 1.2, hpMultiplier: 1.5, splitCount: 3, splitSpeed: 6}),
  walker: definition('walker', '游走球', 10, 20, {driftSpeed: 0, moveSpeed: 2, clusterLimit: 1}),
  magnet: definition('magnet', '磁球', 13, 25, {hpMultiplier: 2, driftSpeed: 0, magnetRadius: 4, magnetAcceleration: 1.5, burstRadius: 3, burstSpeed: 4, clusterLimit: 1}),
  shield: definition('shield', '护盾球', 16, 20, {shield: true, shieldRadius: .3}),
  leader: definition('leader', '簇长', 12, 30, {radius: 1.1, hpMultiplier: 2, leaderPullSpeed: .5, burstSpeed: 2, clusterLimit: 1}),
  fragment: definition('fragment', '子球', 8, 5, {radius: .6, hpMultiplier: .3, spawnable: false}),
});

const BANDS = Object.freeze([
  {stage: 1, limit: 1, mix: {normal: 1}},
  {stage: 3, limit: 2, mix: {normal: .85, ring: .15}},
  {stage: 6, limit: 3, mix: {normal: .75, ring: .15, heavy: .10}},
  {stage: 8, limit: 3, mix: {normal: .65, ring: .15, heavy: .10, split: .10}},
  {stage: 10, limit: 4, mix: {normal: .55, ring: .15, heavy: .10, split: .10, walker: .10}},
  {stage: 13, limit: 4, mix: {normal: .50, ring: .12, heavy: .10, split: .10, walker: .10, magnet: .08}},
  {stage: 16, limit: 5, mix: {normal: .42, ring: .12, heavy: .10, split: .10, walker: .10, magnet: .08, shield: .08}},
].map(band => Object.freeze({...band, mix: Object.freeze(band.mix)})));

const stageNumber = stage => Number.isFinite(stage) ? Math.max(1, Math.floor(stage)) : 1;
const bandFor = stage => BANDS.findLast(band => stageNumber(stage) >= band.stage);

export function enemyMix(stage) { return {...bandFor(stage).mix}; }
export function enemyTypeLimit(stage) { return bandFor(stage).limit; }

export function enemyProfileFor(type, base = {}) {
  const entry = ENEMY_TYPES[type] || ENEMY_TYPES.normal;
  return {...base, ...entry, enemyType: entry.id,
    radiusScale: entry.radius ?? (base.radiusScale ?? .8) * entry.radiusMultiplier,
    density: (base.density ?? 1) * entry.densityMultiplier,
    hp: (base.hp ?? 20) * entry.hpMultiplier,
  };
}

// A fragment still looks like an ordinary solid ball and shares its type slot.
const countedType = type => type === 'fragment' ? 'normal' : type;
const typeSet = types => new Set(Array.from(types || [], countedType).filter(type => ENEMY_TYPES[type]));
const unitRandom = random => Math.max(0, Math.min(1 - Number.EPSILON, Number(random()) || 0));

function weightedType(entries, random) {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (!total) return null;
  let sample = unitRandom(random) * total;
  for (const [type, weight] of entries) {
    sample -= weight;
    if (sample < 0) return type;
  }
  return entries.at(-1)[0];
}

export function planEnemyCluster({stage = 1, size = 0, random = Math.random,
  liveTypes = [], reservedTypes = [], excludedTypes = []} = {}) {
  const count = Number.isFinite(size) ? Math.max(0, Math.floor(size)) : 0;
  if (!count) return [];
  const limit = enemyTypeLimit(stage), occupied = typeSet([...liveTypes, ...reservedTypes]);
  const excluded = new Set(excludedTypes), mix = Object.entries(enemyMix(stage));
  const canUse = (type, types) => !excluded.has(type) && (types.has(type) || types.size < limit);

  // Reserve the ordinary part before picking a new main type. Otherwise a
  // simultaneously planned floor refill and wave can oversubscribe the cap.
  const planned = new Set(occupied);
  if (count > 1 && canUse('normal', planned)) planned.add('normal');
  const candidates = mix.filter(([type]) => canUse(type, planned));
  const main = weightedType(candidates, random);
  if (!main) return [];
  if (count > 1) planned.add(main);

  const withLeader = stageNumber(stage) >= ENEMY_TYPES.leader.stage && !excluded.has('leader')
    && unitRandom(random) < .30 && canUse('leader', planned);
  const plan = [], counts = new Map(), used = new Set(occupied);
  const append = type => {
    if (!canUse(type, used) || (counts.get(type) || 0) >= (ENEMY_TYPES[type].clusterLimit ?? Infinity)) return false;
    plan.push(type); used.add(type); counts.set(type, (counts.get(type) || 0) + 1); return true;
  };
  if (withLeader) append('leader');
  const slots = count - plan.length;
  const ordinaryAllowed = canUse('normal', planned);
  let mainCount = slots;
  if (main !== 'normal' && ordinaryAllowed && slots > 1) {
    const desired = slots * .7, whole = Math.floor(desired);
    mainCount = whole + (unitRandom(random) < desired - whole ? 1 : 0);
  }
  mainCount = Math.min(mainCount, ENEMY_TYPES[main].clusterLimit ?? Infinity);
  for (let i = 0; i < mainCount; i++) append(main);
  while (plan.length < count) {
    if (append('normal')) continue;
    if (append(main)) continue;
    // Normal can be unavailable when callers pass a full set of special live
    // types or explicitly exclude it. Reuse a legal type; never break the cap.
    const fallback = candidates.find(([type]) => canUse(type, used)
      && (counts.get(type) || 0) < (ENEMY_TYPES[type].clusterLimit ?? Infinity));
    if (!fallback || !append(fallback[0])) break;
  }
  // A shorter plan means the caller excluded every legal remaining slot.
  return plan;
}
