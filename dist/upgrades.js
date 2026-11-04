const RINGS = Object.freeze({regular: 0, special: 1, risk: 2});
const upgrade = (id, name, kind, maxStacks, short, detail, effect, requires = {}) => Object.freeze({
  id, name, kind, pool: kind, maxStacks, rings: RINGS[kind], short, detail,
  effect: Object.freeze(effect), requires: Object.freeze(requires),
});

// Limits count acquired layers, never appearances in an offer. Distances and
// speeds below use player-radius units; physics applies the effects.
export const UPGRADE_DEFINITIONS = Object.freeze([
  upgrade('energy', '弹性十足', 'regular', 4, '弹射能量 ×1.3',
    '每层弹射能量乘 1.3，最多 4 层；满层后可获得超速。', {energyMultiplier: 1.3}),
  upgrade('overspeed', '超速', 'regular', 2, '速度上限 +8 u/s',
    '弹性十足满 4 层后解锁，每层提高速度上限 8 u/s，最多 2 层。', {speedCapBonus: 8}, {energy: 4}),
  upgrade('density', '重量级', 'regular', 5, '质量 ×1.35，无尽弹射不减速',
    '每层质量乘 1.35，撞击更有分量；无尽模式同样拉伸不降低弹射速度，最多 5 层。', {densityMultiplier: 1.35}),
  upgrade('rubber', '橡胶', 'regular', 4, '未击杀保速 +8 点，击杀 +4 点',
    '每层最低撞击保速：未击杀增加 8 个百分点，直接击杀增加 4 个百分点，最多 4 层。分别从 70% 和 85% 起，最多保留 100%。', {retentionBonus: .08, lethalRetentionBonus: .04}),
  upgrade('growth', '大一圈', 'regular', 2, '直径变大，每层伤害 +10%',
    '第一层直径为原始大小的 1.2 倍，第二层为 1.4 倍；伤害分别增加 10% 和 20%，质量不变。',
    {radiusScales: Object.freeze([1.2, 1.4]), damageBonus: .1}),
  upgrade('magnet', '磁吸', 'regular', 2, '击杀后拉近最近敌球',
    '击杀后 0.6 秒内将最近一颗敌球拉近，每层拉近 2.5u，最多 2 层。', {pullDuration: .6, pullDistance: 2.5}),
  upgrade('pierce', '一往无前', 'special', 1, '撞敌球不改方向，至少保速 92%',
    '无尽普通战斗中，撞击敌球后保持原方向，至少保留碰撞前 92% 的速度；已有更高保速仍生效。', {retention: .92}),
  upgrade('pulse', '连锁反应', 'special', 1, '重击震伤附近敌球',
    '重击时震伤 4u 内敌球，造成该次撞击 30% 的伤害并推开它们。', {radius: 4, damageRatio: .3}),
  upgrade('bank', '借墙发力', 'special', 1, '每次撞墙下一击 +60%',
    '每次撞墙强化下一击，伤害增加 60%，最多储存 2 次撞墙。', {damageBonus: .6, maxCharges: 2}),
  upgrade('gravity', '黑洞引力', 'special', 1, '持续吸引 5u 内敌球',
    '以恒定强度把 5u 内敌球缓缓吸向玩家，不影响固定的 Boss。', {radius: 5, acceleration: 2.4}),
  upgrade('breath', '喘息之间', 'special', 1, '击杀后刷新间隔 +50%',
    '击杀后 2.5 秒内，波次刷新和场上补球都按原速的 2/3 进行；连续击杀刷新持续时间。', {duration: 2.5, intervalMultiplier: 1.5}),
  upgrade('split', '分身有术', 'special', 1, '每发首杀分出两颗子球',
    '每发第一次击杀后分出两颗 0.7u 子球，以 60% 速度和伤害飞完这一发。',
    {count: 2, radius: .7, speedRatio: .6, damageRatio: .6}),
  upgrade('penetration', '势如破竹', 'special', 1, '每发第一次击杀不减速',
    '每发的第一次击杀保留全部速度。', {firstKillRetention: 1}),
  upgrade('boomerang', '回旋加速', 'special', 1, '撞墙后短暂加速',
    '撞墙后 0.8 秒内速度提高 30%。', {duration: .8, speedMultiplier: 1.3}),
  upgrade('shockwave', '震荡波纹', 'special', 1, '每第 2 次撞墙释放冲击波',
    '每第 2 次撞墙释放半径 3u 的冲击波，造成 75% 满拉伤害。', {everyWalls: 2, radius: 3, fullPullDamageRatio: .75}),
  upgrade('risk', '冒险', 'risk', 2, '敌球 HP ×1.15，分数 ×1.5',
    '新生敌球 HP 每层乘 1.15，得分每层乘 1.5，最多 2 层；刷新速度不变，不增加 Boss HP。', {enemyHpMultiplier: 1.15, scoreMultiplier: 1.5}),
  upgrade('gambler', '赌徒', 'risk', 2, '下阶段目标 +50%，下次五选一',
    '下一阶段击杀目标增加 50%，下一次强化改为五选一；最多获得 2 次。', {nextTargetMultiplier: 1.5, nextChoiceCount: 5}),
  upgrade('frenzy', '狂潮', 'risk', 1, '波次更密，连击上限 12',
    '每波增加 2 颗，波间休止缩短 30%，连击倍率上限从 8 提高到 12。', {waveSizeBonus: 2, restMultiplier: .7, comboCap: 12}),
]);

export const UPGRADES = Object.freeze(Object.fromEntries(UPGRADE_DEFINITIONS.map(entry => [entry.id, entry])));
// The document says a "high" ring/heavy share. This implementation defines it
// as 30% of living enemies in the snapshot taken before clearing removes them.
export const HARD_ENEMY_SHARE = .3;

const definitionFor = entry => {
  const id = typeof entry === 'string' ? entry : entry?.id;
  return Object.hasOwn(UPGRADES, id) ? UPGRADES[id] : null;
};
const acquired = (counts, id) => Math.max(0, Math.floor(Number(counts?.[id]) || 0));

export function canAcquireUpgrade(entry, counts = {}) {
  const definition = definitionFor(entry);
  return !!definition && acquired(counts, definition.id) < definition.maxStacks
    && Object.entries(definition.requires).every(([id, minimum]) => acquired(counts, id) >= minimum);
}

export function eligibleUpgrades({counts = {}, pool = null, exclude = []} = {}) {
  const excluded = new Set(exclude);
  return UPGRADE_DEFINITIONS.filter(entry => (!pool || entry.pool === pool)
    && !excluded.has(entry.id) && canAcquireUpgrade(entry, counts));
}

export function upgradeWeight(entry, context = {}) {
  const definition = definitionFor(entry);
  if (!definition) return 0;
  const id = definition.id;
  let weight = 1;
  if (context.hardEnemyShare >= HARD_ENEMY_SHARE && ['rubber', 'penetration', 'bank'].includes(id)) weight *= 2;
  if (context.nextBoss && ['energy', 'density', 'split'].includes(id)) weight *= 2;
  if (context.completedShots > 0 && Number.isFinite(context.averageKillsPerShot)
    && context.averageKillsPerShot < 1.5 && ['split', 'pulse', 'gravity'].includes(id)) weight *= 2;
  return weight;
}

const sample = random => Math.max(0, Math.min(1 - Number.EPSILON, Number(random()) || 0));

function weightedChoice(candidates, context, random) {
  let point = sample(random) * candidates.reduce((total, entry) => total + upgradeWeight(entry, context), 0);
  for (const entry of candidates) {
    point -= upgradeWeight(entry, context);
    if (point < 0) return entry;
  }
  return candidates.at(-1);
}

export function rollUpgrades({counts = {}, context = {}, random = Math.random, count = 3} = {}) {
  const size = Number.isFinite(count) ? Math.max(0, Math.min(5, Math.floor(count))) : 3;
  const eligible = eligibleUpgrades({counts}), selected = [], used = new Set();
  for (let index = 0; index < size && used.size < eligible.length; index++) {
    // Five-choice offers retain the ordinary three slots and add one regular
    // and one special slot. Risk is a 60% category roll, not a rarity roll.
    const preferred = index === 0 || index === 3 ? 'regular' : index === 1 || index === 4 ? 'special'
      : sample(random) < .6 ? 'risk' : 'regular';
    const pools = [preferred, ...['regular', 'special', 'risk'].filter(pool => pool !== preferred)];
    let candidates = [];
    for (const pool of pools) {
      candidates = eligible.filter(entry => entry.pool === pool && !used.has(entry.id));
      if (candidates.length) break;
    }
    if (!candidates.length) break;
    const choice = weightedChoice(candidates, context, random);
    used.add(choice.id); selected.push({...choice});
  }
  // Return only real, distinct, eligible upgrades. An empty array tells physics
  // to finish the normal reward rest and continue, without a synthetic upgrade.
  return selected;
}
