import {UPGRADE_DEFINITIONS, upgradeStat} from './upgrades.js';

const number = value => String(Number(value.toPrecision(3)));
const percent = value => number(value * 100);

function acquiredStacks(value, definition) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, definition.maxStacks, Math.floor(value));
}

function gamblerSummary(world) {
  const activeTarget = Number.isFinite(world.gamblerTargetMultiplier) && world.gamblerTargetMultiplier > 1;
  const reward = activeTarget && !world.gamblerRewardPending
    && ['transition', 'choose', 'reward'].includes(world.phase);
  if (world.nextGambler) {
    return '下阶段目标 +50%，完成后额外选择 1 次强化。'
      + (reward ? '本轮赌注的额外奖励已计入。' : '');
  }
  if (reward) return '本轮奖励兑现中，额外 1 次强化选择已计入。';
  if (activeTarget && ['battle', 'clearing', 'boss-entry', 'boss', 'boss-celebrate'].includes(world.phase))
    return '本阶段目标 +50%，完成后额外选择 1 次强化。';
  if (world.phase === 'over' && world.gamblerRewardPending) return '本局已结束，本阶段赌注尚未兑现。';
  return '已兑现，当前无待生效赌注。';
}

function summaryFor(definition, stacks, world) {
  const {id, effect} = definition;
  if (id === 'energy') return `弹射能量 +${((upgradeStat(id, stacks) - 1) * 100).toFixed(0)}%。`;
  if (id === 'density') return `质量 +${((upgradeStat(id, stacks) - 1) * 100).toFixed(0)}%。`;
  if (id === 'overspeed') return `弹射速度上限 +${(upgradeStat(id, stacks) / 60 * 100).toFixed(0)}%。`;
  if (id === 'rubber') return `撞击保速下限：未击杀 ${percent(Math.min(1, .70 + effect.retentionBonus * stacks))}%，直接击杀 ${percent(Math.min(1, .85 + effect.lethalRetentionBonus * stacks))}%。`;
  if (id === 'growth') return `直径为初始的 ${number(effect.radiusScales[stacks - 1])} 倍，伤害 +${percent(effect.damageBonus * stacks)}%。`;
  if (id === 'magnet') return `击杀后 ${number(effect.pullDuration)} 秒内牵引附近敌球，同时最多牵引 2 颗${stacks > 1 ? '；牵引速度提升' : ''}。`;
  if (id === 'pierce') return `撞击敌球后保持原方向，至少保留碰撞前 ${percent(effect.retention)}% 的速度。`;
  if (id === 'pulse') return `重击时震伤周围一定范围内的敌球，造成该次撞击 ${percent(effect.damageRatio)}% 的伤害并推开它们。`;
  if (id === 'gravity') return '持续将一定范围内的敌球缓缓吸向自己，不影响固定的魔王球。';
  if (id === 'split') return `每发首次击杀后分出两颗子球，以主球 ${percent(effect.speedRatio)}% 的速度和 ${percent(effect.damageRatio)}% 的伤害飞完这一发。`;
  if (id === 'shockwave') return `同一发每累计 ${effect.everyWalls} 次撞墙，释放一次冲击波，对一定范围内的敌球造成 ${percent(effect.fullPullDamageRatio)}% 满拉伤害。`;
  if (id === 'gambler') return gamblerSummary(world);
  if (id === 'frenzy') return `连击倍率上限 +${effect.comboCap - 8}；超过 ${effect.comboDamageThreshold} 连击后，每击杀使后续伤害 +${percent(effect.comboDamagePerKill * stacks)}%，最多 +${percent(effect.comboDamageCap * stacks)}%，连击中断重置。`
    + `每波 +${effect.waveSizeBonus + effect.extraWaveSizeBonus * (stacks - 1)} 颗敌球，波间休止 ×${(effect.restMultiplier * effect.extraRestMultiplier ** (stacks - 1)).toFixed(1)}。`;
  return definition.detail;
}

// This is a snapshot of acquired effects, not the next layer's offer text.
export function runUpgradeEntries(world) {
  if (!world?.buffs || typeof world.buffs !== 'object') return [];
  return UPGRADE_DEFINITIONS.flatMap(definition => {
    if (!Object.hasOwn(world.buffs, definition.id)) return [];
    const stacks = acquiredStacks(world.buffs[definition.id], definition);
    if (!stacks) return [];
    return [{id: definition.id, name: definition.name, kind: definition.kind, stacks,
      summary: summaryFor(definition, stacks, world)}];
  });
}
