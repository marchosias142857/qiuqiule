import {World, clamp, PLAYER_BASE_DENSITY} from './physics.js';

export const LEVEL_COUNT = 100;
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const levelNumber = value => clamp(Math.floor(finite(value, 1)), 1, LEVEL_COUNT);

// Every level has a fixed finite population. No wall-clock escalation is hidden
// in campaign mode, so a retry has the same difficulty as its first attempt.
export function levelConfig(level) {
  const n = levelNumber(level), difficulty = n - 1;
  return Object.freeze({
    level: n,
    totalEnemies: 20 + difficulty,
    spawnInterval: 3.1 / (1 + difficulty * .025),
    enemyHp: 15 + Math.round(difficulty * .65),
    enemyDensity: .70 + difficulty * .006,
    enemyRadius: .70 + difficulty * .0015,
    enemyRadiusVariation: .34,
    playerEnergy: 1.06 + difficulty * .0018,
    upgradeEvery: 5 + Math.floor(difficulty / 25),
  });
}

export function progressPercent(kills, total) {
  const population = finite(total, 0);
  return population > 0 ? Math.round(clamp(finite(kills, 0) / population, 0, 1) * 100) : 0;
}

// Completed is the highest consecutively cleared level. A numeric legacy value
// means the highest unlocked level; unlocking 100 does not mean clearing it.
export function normalizeProgress(raw) {
  const object = raw && typeof raw === 'object' ? raw : null;
  const hasCompleted = object && typeof object.completed === 'number' && Number.isFinite(object.completed);
  const unlocked = levelNumber(object ? object.unlocked : raw);
  const completed = hasCompleted ? clamp(Math.floor(object.completed), 0, LEVEL_COUNT) : unlocked - 1;
  return {unlocked: Math.min(LEVEL_COUNT, completed + 1), completed};
}

export class CampaignWorld extends World {
  constructor(width, height, level = 1, random = Math.random) {
    // Avoid virtual calls to campaign spawning until its counters/config exist.
    super(width, height, random, {spawnInitial: false});
    this.mode = 'campaign';
    this.config = levelConfig(level);
    this.level = this.config.level;
    this.totalEnemies = this.config.totalEnemies;
    this.spawned = 0;
    this.kills = 0;
    this.completed = false;
    this.upgrades = 0;
    this.nextUpgrade = this.config.upgradeEvery;
    this.target = Infinity;
    this.energy = this.config.playerEnergy;
    this.spawnTimer = this.config.spawnInterval;
    this.spawnEnemy();
    this.spawnEnemy();
  }

  get spawnInterval() { return this.config.spawnInterval; }
  get percent() { return progressPercent(this.kills, this.totalEnemies); }
  enemyProfile() {
    return {
      radiusScale: this.config.enemyRadius + this.random() * this.config.enemyRadiusVariation,
      density: this.config.enemyDensity,
      hp: this.config.enemyHp,
      value: 0,
    };
  }
  spawnEnemy() {
    if (this.spawned >= this.totalEnemies || this.phase !== 'battle') return;
    const previous = this.enemies.length;
    super.spawnEnemy();
    if (this.enemies.length > previous) this.spawned++;
  }
  emit(type, data = {}) {
    super.emit(type, type === 'over' ? {
      ...data, completed: this.completed, level: this.level,
      kills: this.kills, totalEnemies: this.totalEnemies,
    } : data);
  }
  damage(body, damage) {
    if (this.phase !== 'battle' || body.hp <= 0 || damage <= 0 || !Number.isFinite(damage)) return;
    body.hp -= damage;
    body.hit = 1;
    if (body.hp > 0) return;
    this.kills++;
    this.emit('kill', {x: body.x, y: body.y, r: body.r, vx: body.vx, vy: body.vy, value: 0});
    // Credit the actual last kill before deciding the outcome. The shared
    // full-board check then sees phase=over and cannot overwrite a victory.
    if (this.spawned === this.totalEnemies && this.kills === this.totalEnemies) {
      this.completed = true;
      this.phase = 'over';
      this.emit('over');
      return;
    }
    if (this.kills >= this.nextUpgrade) {
      this.nextUpgrade += this.config.upgradeEvery;
      this.gainAttribute();
    }
  }
  gainAttribute() {
    const index = this.upgrades++;
    let attribute, label;
    if (index % 3 === 0) {
      this.energy *= 1.14;
      attribute = 'energy'; label = '弹力 +14%';
    } else if (index % 3 === 1) {
      this.density *= 1.12;
      this.player.density = PLAYER_BASE_DENSITY * this.density;
      this.player.mass = this.player.density;
      attribute = 'density'; label = '密度 +12%';
    } else if ((this.buffs.campaignGrowth || 0) < 4) {
      this.buffs.campaignGrowth = (this.buffs.campaignGrowth || 0) + 1;
      this.player.r = this.unit * (1 + this.buffs.campaignGrowth * .06);
      attribute = 'size'; label = '体型 +6%';
    } else {
      this.energy *= 1.14;
      attribute = 'energy'; label = '弹力 +14%';
    }
    this.player.hit = 1;
    this.emit('campaignBuff', {attribute, label, x: this.player.x, y: this.player.y, r: this.player.r});
  }
}
