const RINGS = Object.freeze({regular: 0, special: 1, risk: 2});
const upgrade = (id, name, kind, maxStacks, short, detail, effect, requires = {}) => Object.freeze({
  id, name, kind, pool: kind, maxStacks, rings: RINGS[kind], short, detail,
  effect: Object.freeze(effect), requires: Object.freeze(requires),
});

// Limits count acquired layers, never appearances in an offer. Distances and
// speeds below use player-radius units; physics applies the effects.
export const UPGRADE_DEFINITIONS = Object.freeze([
  upgrade('energy', '弹性十足', 'regular', Infinity, '前 4 层能量 ×1.3，之后持续增长',
    '无层数上限。前 4 层每层弹射能量乘 1.3；之后每层增加第 4 层总能量的 12%。获得 4 层后解锁超速。', {energyMultiplier: 1.3}),
  upgrade('overspeed', '超速', 'regular', Infinity, '前 2 层上限 +8 u/s，之后递减增长',
    '弹性十足达到 4 层后解锁，无层数上限。前 2 层每层提高速度上限 8 u/s；之后额外获得 n 层时，共再提高 4√n u/s。', {speedCapBonus: 8}, {energy: 4}),
  upgrade('density', '重量级', 'regular', Infinity, '前 5 层质量 ×1.35，之后持续增长',
    '无层数上限。前 5 层每层质量乘 1.35；之后每层增加第 5 层总质量的 15%。无尽模式同样拉伸不降低弹射速度。', {densityMultiplier: 1.35}),
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
  upgrade('penetration', '势如破竹', 'special', 1, '每发首杀恢复出手速度',
    '每发第一次击杀时，主球恢复到这一发出手时的速度；已经更快则保持。出手速度不含回旋加速，恢复时再按当前回旋状态计入 30% 加速。', {restoreShotSpeed: true}),
  upgrade('boomerang', '回旋加速', 'special', 1, '撞墙后短暂加速',
    '撞墙后 0.8 秒内速度提高 30%。', {duration: .8, speedMultiplier: 1.3}),
  upgrade('shockwave', '震荡波纹', 'special', 1, '每第 2 次撞墙释放冲击波',
    '每第 2 次撞墙释放半径 4u 的冲击波，造成 75% 满拉伤害。', {everyWalls: 2, radius: 4, fullPullDamageRatio: .75}),
  upgrade('gambler', '赌徒', 'risk', Infinity, '下阶段目标 +50%，完成后多选一轮',
    '可反复获得。每次只提高下一阶段击杀目标 50%；完成下一阶段后，额外获得一轮三选一：普通阶段共 2 轮，Boss 阶段共 3 轮。待生效时不会再次出现。', {nextTargetMultiplier: 1.5, extraRewardRounds: 1}),
  upgrade('frenzy', '狂潮', 'risk', Infinity, '波次更密，6 连击后伤害递增',
    '无层数上限。首次获得后每波增加 2 颗、波间休止缩短 30%；从第 2 层起，每层每波再增加 1 颗、波间休止再乘 0.9。连击倍率上限保持 12。每层在超过 6 连击后，每多击杀 1 颗使后续伤害增加 15%，本层最多增加 60%；多层加算，连击中断后重置。',
    {waveSizeBonus: 2, extraWaveSizeBonus: 1, restMultiplier: .7, extraRestMultiplier: .9, comboCap: 12, comboDamageThreshold: 6, comboDamagePerKill: .15, comboDamageCap: .6}),
]);

export const UPGRADES = Object.freeze(Object.fromEntries(UPGRADE_DEFINITIONS.map(entry => [entry.id, entry])));
// The document says a "high" ring/heavy share. This implementation defines it
// as 30% of living enemies in the snapshot taken before clearing removes them.
export const HARD_ENEMY_SHARE = .3;

const definitionFor = entry => {
  const id = typeof entry === 'string' ? entry : entry?.id;
  return Object.hasOwn(UPGRADES, id) ? UPGRADES[id] : null;
};
const layers = value => Number.isFinite(Number(value))
  ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(Number(value)))) : 0;
const acquired = (counts, id) => layers(counts?.[id]);
const SOFT_CAPS = Object.freeze({energy: 4, density: 5, overspeed: 2});

export function upgradeStat(id, count = 0) {
  const n = layers(count);
  if (id === 'energy') return 1.3 ** Math.min(n, 4) * (1 + .12 * Math.max(0, n - 4));
  if (id === 'density') return 1.35 ** Math.min(n, 5) * (1 + .15 * Math.max(0, n - 5));
  if (id === 'overspeed') return 8 * Math.min(n, 2) + 4 * Math.sqrt(Math.max(0, n - 2));
  return 0;
}

export function upgradeOffer(entry, counts = {}) {
  const definition = definitionFor(entry);
  if (!definition) return {...entry};
  const id = definition.id, count = acquired(counts, id);
  let short = definition.short;
  if (id === 'energy') short = '弹射能量 ×1.3';
  if (id === 'density') short = '质量 ×1.35，无尽弹射不减速';
  if (id === 'overspeed') short = '速度上限 +8 u/s';
  if (id === 'frenzy' && count > 0) {
    const total = Math.round((count + 1) * definition.effect.comboDamageCap * 100);
    short = `每波再 +1，休止再 ×0.9；连击增伤上限共 +${total}%`;
  }
  if (count >= SOFT_CAPS[id]) {
    const previous = upgradeStat(id, count), next = upgradeStat(id, count + 1);
    const increase = id === 'overspeed' ? next - previous : (next / previous - 1) * 100;
    const displayed = Number(increase.toPrecision(3));
    short = id === 'overspeed' ? `速度上限 +${displayed} u/s`
      : id === 'energy' ? `弹射能量 +${displayed}%` : `质量 +${displayed}%，无尽弹射不减速`;
  }
  return {...definition, short};
}

function lateProgress(context) {
  const stage = Number(context.stage);
  return Number.isFinite(stage) ? Math.max(0, Math.min(1, (stage - 11) / 9)) : 0;
}

export function canAcquireUpgrade(entry, counts = {}) {
  const definition = definitionFor(entry);
  return !!definition && Number.isFinite(Number(counts?.[definition.id] ?? 0))
    && acquired(counts, definition.id) < definition.maxStacks
    && Object.entries(definition.requires).every(([id, minimum]) => acquired(counts, id) >= minimum);
}

export function eligibleUpgrades({counts = {}, pool = null, exclude = []} = {}) {
  const excluded = new Set(exclude);
  return UPGRADE_DEFINITIONS.filter(entry => (!pool || entry.pool === pool)
    && !excluded.has(entry.id) && canAcquireUpgrade(entry, counts));
}

export function upgradeWeight(entry, context = {}, counts = {}) {
  const definition = definitionFor(entry);
  if (!definition) return 0;
  const id = definition.id;
  let weight = 1;
  if (context.hardEnemyShare >= HARD_ENEMY_SHARE && ['rubber', 'penetration', 'bank'].includes(id)) weight *= 2;
  if (context.nextBoss && ['energy', 'density', 'split'].includes(id)) weight *= 2;
  if (context.completedShots > 0 && Number.isFinite(context.averageKillsPerShot)
    && context.averageKillsPerShot < 1.5 && ['split', 'pulse', 'gravity'].includes(id)) weight *= 2;
  const late = lateProgress(context), count = acquired(counts, id);
  if (id === 'frenzy') {
    weight *= count === 0 ? 1 + 1.5 * late
      : Math.max(.4, 1 / (1 + .25 * Math.max(0, count - 1) * late));
  }
  if (Object.hasOwn(SOFT_CAPS, id)) {
    const extra = Math.max(0, count - SOFT_CAPS[id]);
    weight *= Math.max(.2, 1 / (1 + .22 * extra * late));
  }
  return weight;
}

const sample = random => Math.max(0, Math.min(1 - Number.EPSILON, Number(random()) || 0));

function weightedChoice(candidates, context, counts, random) {
  let point = sample(random) * candidates.reduce((total, entry) => total + upgradeWeight(entry, context, counts), 0);
  for (const entry of candidates) {
    point -= upgradeWeight(entry, context, counts);
    if (point < 0) return entry;
  }
  return candidates.at(-1);
}

export function rollUpgrades({counts = {}, context = {}, random = Math.random, count = 3, exclude = [], maxRisks = 2} = {}) {
  const size = Number.isFinite(count) ? Math.max(0, Math.min(5, Math.floor(count))) : 3;
  const eligible = eligibleUpgrades({counts, exclude}), selected = [], used = new Set();
  const late = lateProgress(context), riskLimit = Number.isFinite(maxRisks) ? Math.max(0, Math.floor(maxRisks)) : 2;
  let selectedRisks = 0;
  for (let index = 0; index < size && used.size < eligible.length; index++) {
    // Starting with stage 12, every slot can favor risk. There is no regular
    // guarantee; distinct IDs naturally limit each offer to two risk upgrades.
    // Do not consume an extra random draw before that stage.
    const preferred = index === 0 || index === 3 ? 'regular' : index === 1 || index === 4 ? 'special'
      : sample(random) < .6 + .25 * late ? 'risk' : 'regular';
    const riskChance = index === 0 || index === 3 ? .2 * late : .45 * late;
    const poolName = index !== 2 && late > 0 && sample(random) < riskChance ? 'risk' : preferred;
    const pools = [poolName, ...['regular', 'special', 'risk'].filter(pool => pool !== poolName)];
    let candidates = [];
    for (const pool of pools) {
      // A cooling offer keeps the same category draws and item weights, but
      // once its one risk is filled, later risk slots fall back to non-risk.
      if (pool === 'risk' && selectedRisks >= riskLimit) continue;
      candidates = eligible.filter(entry => entry.pool === pool && !used.has(entry.id));
      if (candidates.length) break;
    }
    if (!candidates.length) break;
    const choice = weightedChoice(candidates, context, counts, random);
    if (choice.kind === 'risk') selectedRisks++;
    used.add(choice.id); selected.push(upgradeOffer(choice, counts));
  }
  // Return only real, distinct, eligible upgrades. An empty array tells physics
  // to finish the normal reward rest and continue, without a synthetic upgrade.
  return selected;
}
