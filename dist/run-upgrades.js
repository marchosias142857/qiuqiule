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
    return '下阶段目标 +50%，完成后额外 1 轮三选一。'
      + (reward ? '本轮赌注的额外奖励已计入。' : '');
  }
  if (reward) return '本轮奖励兑现中，额外 1 轮三选一已计入。';
  if (activeTarget && ['battle', 'clearing', 'boss-entry', 'boss', 'boss-celebrate'].includes(world.phase))
    return '本阶段目标 +50%，完成后额外 1 轮三选一。';
  if (world.phase === 'over' && world.gamblerRewardPending) return '本局已结束，本阶段赌注尚未兑现。';
  return '已兑现，当前无待生效赌注。';
}

function summaryFor(definition, stacks, world) {
  const {id, effect} = definition;
  if (id === 'energy') return `弹射能量约为初始的 ${number(upgradeStat(id, stacks))} 倍。`;
  if (id === 'density') return `质量约为初始的 ${number(upgradeStat(id, stacks))} 倍，同样拉伸不降低弹射速度。`;
  if (id === 'overspeed') return `弹射速度上限 ${number(60 + upgradeStat(id, stacks))} u/s（基础 60 + 强化 ${number(upgradeStat(id, stacks))}）。`;
  if (id === 'rubber') return `撞击保速下限：未击杀 ${percent(Math.min(1, .70 + effect.retentionBonus * stacks))}%，直接击杀 ${percent(Math.min(1, .85 + effect.lethalRetentionBonus * stacks))}%。`;
  if (id === 'growth') return `直径为初始的 ${number(effect.radiusScales[stacks - 1])} 倍，伤害 +${percent(effect.damageBonus * stacks)}%；质量不变。`;
  if (id === 'magnet') return `击杀后 ${number(effect.pullDuration)} 秒内牵引敌球，优先前方路线；每颗最多移动 ${number(effect.pullDistance * stacks)}u，同时最多 2 颗。`;
  if (id === 'gambler') return gamblerSummary(world);
  if (id === 'frenzy') return `超过 ${effect.comboDamageThreshold} 连击后，每击杀使后续伤害 +${percent(effect.comboDamagePerKill * stacks)}%，最多 +${percent(effect.comboDamageCap * stacks)}%，连击中断重置。`
    + `每波 +${effect.waveSizeBonus + effect.extraWaveSizeBonus * (stacks - 1)} 颗；波间休止 ×${number(effect.restMultiplier * effect.extraRestMultiplier ** (stacks - 1))}；连击倍率上限 ${effect.comboCap}。`;
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
