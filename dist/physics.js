import {ENEMY_TYPES, enemyTypeLimit, enemyProfileFor, planEnemyCluster} from './enemies.js';
import {UPGRADES, UPGRADE_DEFINITIONS, canAcquireUpgrade, rollUpgrades, eligibleUpgrades} from './upgrades.js';

export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const length = b => Math.hypot(b.vx, b.vy);
export const ease = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const lerp = (a, b, t) => a + (b - a) * t;
export const PLAYER_BASE_DENSITY = 1.5;
export const BREATH_DURATION = 1.5;
export const BREATH_SPAWN_RATE = 2 / 3;
export const BLACK_HOLE_GRAVITY = Object.freeze({radius: 5, acceleration: 2.4});
export const BOSS_TIMING = Object.freeze({entry: .85, brake: .8, spin: .85, hold: 1, fade: .22});
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

// Endless upgrades have fixed per-layer values. Campaign's automatic rewards
// remain in CampaignWorld and do not pass through this upgrade pool.
export function regularBuffBonus(id) {
  return id === 'density' ? .35 : id === 'energy' ? .30 : 0;
}

export function buffAtStage(buff) {
  const bonus = regularBuffBonus(buff.id);
  return {...buff, ...(bonus ? {bonus} : {})};
}

// Boss difficulty and rewards grow with encounter number, starting at one.
// Keep this pure: looking up boss difficulty must not consume spawn randomness.
export function bossConfig(stage, unit, squareSide) {
  const index = Math.max(1, Math.floor(stage / 5));
  const difficulty = Math.log2(index);
  const initialRadius = unit * 4.8, minRadius = unit * 2;
  const segmentValue = 90 + 10 * index;
  return {index, initialRadius, minRadius, maxRadius: squareSide * .375,
    stunHealthScale: 100 * (1 + .12 * difficulty),
    inflationRate: initialRadius / 150 * (1 + .15 * difficulty),
    shrinkDivisor: 1 + .05 * difficulty, segmentValue, killValue: 450 + 50 * index,
    thresholds: Array.from({length: 5}, (_, i) => initialRadius - (initialRadius - minRadius) * (i + 1) / 5)};
}

export const BUFFS = UPGRADE_DEFINITIONS;

export class World {
  constructor(width, height, random = Math.random, {spawnInitial = true} = {}) {
    this.random = random;
    this.width = width;
    this.height = height;
    this.unit = clamp(Math.min(width, height) * .047, 18, 34);
    this.inset = 16;
    this.time = 0;
    this.feedbackTime = 0;
    this.stage = 1;
    this.maxStage = 1;
    this.maxCombo = 0;
    this.totalShots = 0;
    this.totalKills = 0;
    this.elapsed = 0;
    this.rewardSelectionsRemaining = 0;
    this.upgradeRound = 0;
    this.upgradeRoundTotal = 0;
    this.startingUpgrades = false;
    this.bossVictorySlowTime = 0;
    this.score = 0;
    // Retained for the existing Boss reward bookkeeping and campaign clients;
    // endless progression is exclusively stageKills / killTarget.
    this.target = 140;
    this.stageKills = 0;
    this.stageKillCarry = 0;
    this.shotKills = 0;
    this.shotBanked = false;
    this.shotHistory = [];
    this.auxiliaries = [];
    this.shotSplitUsed = false;
    this.shotWallCount = 0;
    this.pendingUpgradeBoost = false;
    this.shotUpgradeBoost = false;
    this.magnetPull = null;
    this.stageShots = 0;
    this.stageRealKills = 0;
    this.upgradeContext = null;
    this.nextGambler = false;
    this.gamblerTargetMultiplier = 1;
    this.gamblerRewardPending = false;
    this.activeShot = null;
    this.overTimer = 0;
    this.saveUsed = false;
    this.deathReason = null;
    this.clearing = null;
    this.pendingClearing = null;
    this.phase = 'battle';
    this.phaseTime = 0;
    this.spawnTimer = 4;
    this.floorTimer = 0;
    this.wave = null;
    this.floorCluster = null;
    this.clusterId = 0;
    this.typeIntroductions = {};
    this.introTimer = 0;
    this.fragmentQueue = [];
    this.seenEnemyKills = new Set();
    this.stepSerial = 0;
    this.breathTime = 0;
    this.pulseCooldown = 0;
    this.events = [];
    this.enemies = [];
    this.choices = [];
    this.boss = null;
    this.bossKills = 0;
    this.bossCelebration = null;
    this.arenaBlend = 0;
    this.arenaRestoreFrom = 0;
    this.buffs = {};
    this.id = 0;
    this.density = 1;
    this.energy = 1;
    this.bank = 0;
    this.pullStartSpeed = null;
    // Presentation timing is opt-in so headless simulations keep their original
    // cadence. The playable scene supplies the saved feedback preferences.
    this.feedbackOptions = {strength: 0, reducedMotion: false};
    this.feedbackKills = 0;
    this.feedbackFreezeUsed = 0;
    this.player = this.makeBody(width * .5, height * .62, this.unit, PLAYER_BASE_DENSITY);
    this.player.isPlayer = true;
    this.player.hp = Infinity;
    if (spawnInitial) this.fillFloor();
  }

  makeBody(x, y, r, density) {
    return {id: ++this.id, x, y, vx: 0, vy: 0, r, mass: density * (r / this.unit) ** 2,
      density, born: 0, solid: false, hp: 20, maxHp: 20, value: 10, hit: 0, squash: 0, angle: 0, spin: 0};
  }

  setFeedbackOptions({strength = 0, reducedMotion = false} = {}) {
    this.feedbackOptions = {strength: Number.isFinite(strength) ? clamp(strength, 0, 1) : 0, reducedMotion: !!reducedMotion};
    for (const body of [this.player, ...this.auxiliaries, ...this.enemies, this.boss].filter(Boolean)) {
      if (!this.feedbackOptions.strength) body.feedbackFreeze = 0;
      else if (reducedMotion) body.feedbackFreeze = Math.min(body.feedbackFreeze || 0, .05);
    }
    return this;
  }

  freezeFeedback(body, seconds, {scaled = true, actor = this.player} = {}) {
    const {strength, reducedMotion} = this.feedbackOptions;
    if (!strength || !(seconds > 0)) return 0;
    const requested = Math.min(seconds * (scaled ? strength : 1), reducedMotion ? .05 : Infinity);
    const previous = actor.feedbackFreeze || 0;
    const extension = Math.min(Math.max(0, requested - previous), Math.max(0, .25 - this.feedbackFreezeUsed));
    const duration = Math.min(requested, previous + extension);
    this.feedbackFreezeUsed += extension;
    actor.feedbackFreeze = previous + extension;
    actor.feedbackFreezeTotal = Math.max(actor.feedbackFreezeTotal || 0, actor.feedbackFreeze);
    if (body && body !== actor) {
      body.feedbackFreeze = Math.max(body.feedbackFreeze || 0, duration);
      body.feedbackFreezeTotal = Math.max(body.feedbackFreezeTotal || 0, body.feedbackFreeze);
    }
    return duration;
  }

  // Consume only the held portion of a step. The remainder integrates normally,
  // preventing frame-rate rounding from lengthening the 250 ms shot budget.
  feedbackStep(body, dt, timeScale = 1) {
    const held = Math.min(dt / timeScale, body.feedbackFreeze || 0);
    body.feedbackFreeze = Math.max(0, (body.feedbackFreeze || 0) - held);
    if (!body.feedbackFreeze) {
      body.feedbackFreezeTotal = 0;
      if (body.pendingVx) body.vx += body.pendingVx;
      if (body.pendingVy) body.vy += body.pendingVy;
      body.pendingVx = body.pendingVy = 0;
    }
    return Math.max(0, dt - held * timeScale);
  }

  impactFeedback(body, damage, contact = {}) {
    const p = contact.attacker || this.player;
    const dx = body.x - p.x, dy = body.y - p.y, distance = Math.hypot(dx, dy);
    const nx = contact.nx ?? (distance > 1e-8 ? dx / distance : 1);
    const ny = contact.ny ?? (distance > 1e-8 ? dy / distance : 0);
    const impactVx = contact.impactVx ?? p.vx, impactVy = contact.impactVy ?? p.vy;
    return {bodyId: body.id, attackerId: p.id, enemyType: body.enemyType || 'normal', shield: !!body.shield, maxHp: body.maxHp, damage, nx, ny,
      contactX: contact.contactX ?? body.x - nx * body.r,
      contactY: contact.contactY ?? body.y - ny * body.r,
      impactVx, impactVy, impactSpeed: contact.impactSpeed ?? Math.hypot(impactVx, impactVy),
      feedbackLevel: Math.max(1, this.feedbackKills), auxiliary: !!p.isAuxiliary, source: contact.source || 'impact'};
  }

  damageFeedback(body, damage, contact = {}) {
    const lethal = body.hp <= 0;
    if (lethal) this.feedbackKills++;
    const feedback = this.impactFeedback(body, damage, contact);
    body.hitAlpha = this.mode === 'campaign' ? .15 + .35 * clamp(damage / body.maxHp, 0, 1) : clamp(damage / body.maxHp, 0, 1);
    const seconds = lethal ? Math.min(.14, .08 + .02 * (this.feedbackKills - 1))
      : damage >= body.maxHp * .3 ? .025 : 0;
    feedback.freezeDuration = this.freezeFeedback(body, seconds, {scaled: lethal, actor: contact.attacker || this.player});
    if (lethal) feedback.bodySnapshot = {...body};
    return feedback;
  }
  get arenaBounds() {
    const side = Math.min(this.width, this.height) - this.inset * 2;
    const blend = clamp(this.arenaBlend, 0, 1);
    const left = lerp(this.inset, (this.width - side) / 2, blend);
    const top = lerp(this.inset, (this.height - side) / 2, blend);
    const right = this.width - left, bottom = this.height - top;
    return {left, right, top, bottom, width: right - left, height: bottom - top};
  }
  get arenaGeometry() {
    const bounds = this.arenaBounds, blend = clamp(this.arenaBlend, 0, 1);
    const r = Math.min(bounds.width, bounds.height) / 2;
    // The corner rounding is decorative. Boss collisions use four straight
    // walls throughout the rectangular-to-square entry and reward return.
    return {...bounds, x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2,
      r, blend, cornerRadius: 0, visualCornerRadius: Math.min(22, r),
      shape: blend >= 1 - 1e-10 ? 'square' : 'rect'};
  }
  get hasDefeatedBoss() { return this.bossKills > 0; }
  get bossControl() { return this.mode !== 'campaign' && ['boss-entry', 'boss'].includes(this.phase); }

  clampBodyToArena(body) {
    const g = this.arenaBounds;
    const x = clamp(body.x, g.left + body.r, g.right - body.r);
    const y = clamp(body.y, g.top + body.r, g.bottom - body.r);
    const dx = body.x - x, dy = body.y - y, distance = Math.hypot(dx, dy);
    body.x = x; body.y = y;
    return distance > 0 ? {nx: dx / distance, ny: dy / distance} : null;
  }

  get readySpeed() { return this.unit * (8 + 4 * Math.floor(Math.max(0, this.stage - 1) / 5) + (this.phase === 'boss' ? 12 : 0)); }
  get limit() { return this._limitOverride ?? (this.mode === 'campaign' ? 18 : 28); }
  set limit(value) { this._limitOverride = value; }
  get killTarget() { return Math.ceil((14 + 4 * (this.stage - 1)) * this.gamblerTargetMultiplier); }
  get floorCount() { return Math.ceil(Math.min(14, 6 + .5 * (this.stage - 1))); }
  get waveSize() { return Math.min(8, 4 + Math.floor((this.stage - 1) / 3)) + (this.mode !== 'campaign' && this.buffs.frenzy ? 2 : 0); }
  get comboCap() { return this.mode !== 'campaign' && this.buffs.frenzy ? 12 : 8; }
  get launchCap() { return this.unit * (60 + (this.mode !== 'campaign' ? 8 * (this.buffs.overspeed || 0) : 0)); }
  scoreValue(base) { return Math.round(base * (this.mode !== 'campaign' ? 1.5 ** (this.buffs.risk || 0) : 1)); }
  get liveCount() { return this.enemies.filter(body => body.hp > 0).length; }
  get resultMisses() { return this.shotHistory.filter(shot => this.feedbackTime - shot.time <= 20 && shot.hits === 0).length; }
  get maxPhysicsSpeed() { return (this.launchCap + this.readySpeed) * (this.mode !== 'campaign' && this.buffs.boomerang ? 1.2 : 1); }
  get combatActive() { return ['battle', 'boss-entry', 'boss'].includes(this.phase); }
  get continuousControl() { return this.mode !== 'campaign' && this.combatActive; }
  get waveInterval() { return this.waveSize * this.spawnInterval * (this.buffs.frenzy ? .7 : 1) + (this.mode !== 'campaign' && [3, 4].includes(this.stage % 5) ? 2 : 0); }
  get ready() { return this.continuousControl || (this.phase === 'battle' || this.phase === 'choose' || this.phase === 'boss') && (this.pullStartSpeed !== null || length(this.player) < this.readySpeed); }
  beginPull() {
    if (!this.ready || this.pullStartSpeed !== null) return false;
    this.pullStartSpeed = length(this.player);
    return true;
  }
  cancelPull() { this.pullStartSpeed = null; }
  get maxPull() { return clamp(Math.min(this.width, this.height) * .25, 90, 170); }
  get baseSpeed() { return this.unit * 40; }
  playerFriction(dt, body = this.player) {
    const speed = length(body), threshold = this.unit * 8;
    // Split a threshold crossing so the two drag rates do not depend on the
    // adaptive substep size. Holding an aim never adds braking in endless play.
    const fastTime = speed > threshold ? Math.min(dt, Math.log(speed / threshold) / .35) : 0;
    return Math.exp(-.35 * fastTime - 1.2 * (dt - fastTime));
  }
  get gravityRadius() { return this.unit * BLACK_HOLE_GRAVITY.radius; }
  gravityAcceleration(body) {
    if (!this.combatActive || !this.buffs.gravity || body.isPlayer || body.isBoss || !body.solid || body.hp <= 0) return null;
    const dx = this.player.x - body.x, dy = this.player.y - body.y, distance = Math.hypot(dx, dy);
    if (distance < 1e-6 || distance > this.gravityRadius) return null;
    const acceleration = this.unit * BLACK_HOLE_GRAVITY.acceleration;
    return {x: dx / distance * acceleration, y: dy / distance * acceleration};
  }

  magnetAcceleration(actor = this.player) {
    if (this.mode === 'campaign' || !this.combatActive) return null;
    let x = 0, y = 0;
    for (const b of this.enemies) {
      if (b.enemyType !== 'magnet' || !b.solid || b.hp <= 0) continue;
      const dx = b.x - actor.x, dy = b.y - actor.y, distance = Math.hypot(dx, dy);
      if (distance < 1e-8 || distance > this.unit * 4) continue;
      x += dx / distance * this.unit * 1.5; y += dy / distance * this.unit * 1.5;
    }
    return x || y ? {x, y} : null;
  }

  leaderDrift(body) {
    if (this.mode === 'campaign' || !this.combatActive || !body.solid || body.hp <= 0 || body.isPlayer || !body.clusterId || body.enemyType === 'leader') return null;
    const leader = this.enemies.find(b => b.enemyType === 'leader' && b.clusterId === body.clusterId && b.hp > 0 && b.solid);
    if (!leader) return null;
    const dx = leader.x - body.x, dy = leader.y - body.y, distance = Math.hypot(dx, dy);
    return distance > 1e-8 ? {x: dx / distance * this.unit * .5, y: dy / distance * this.unit * .5} : null;
  }

  normalizeWalker(body) {
    if (this.mode === 'campaign' || !this.combatActive || body.enemyType !== 'walker' || body.feedbackFreeze > 1e-10) return;
    const speed = length(body), angle = speed > 1e-8 ? Math.atan2(body.vy, body.vx) : body.angle;
    body.vx = Math.cos(angle) * this.unit * 2; body.vy = Math.sin(angle) * this.unit * 2;
  }

  pushEnemy(body, vx, vy) {
    if (this.mode !== 'campaign' && body.feedbackFreeze > 1e-10) {
      body.pendingVx = (body.pendingVx || 0) + vx; body.pendingVy = (body.pendingVy || 0) + vy;
    } else { body.vx += vx; body.vy += vy; }
  }

  enemyDeath(body) {
    if (this.mode === 'campaign' || !this.combatActive) return;
    const type = body.enemyType || 'normal';
    if (!['normal', 'fragment'].includes(type) && !this.seenEnemyKills.has(type)) {
      this.seenEnemyKills.add(type); this.emit('firstTypeKill', {bodyId: body.id, enemyType: type, x: body.x, y: body.y, r: body.r});
    }
    if (type === 'split' && !this.pendingClearing) {
      const angle = this.random() * Math.PI * 2, clusterId = ++this.clusterId;
      for (let i = 0; i < 3; i++) this.fragmentQueue.push({x: body.x, y: body.y, maxHp: body.maxHp,
        density: body.density, clusterId, angle: angle + i * Math.PI * 2 / 3});
    }
    if (type === 'magnet' || type === 'leader') {
      for (const other of this.enemies) {
        if (other === body || other.hp <= 0 || (type === 'leader' && (!body.clusterId || other.clusterId !== body.clusterId))) continue;
        const dx = other.x - body.x, dy = other.y - body.y, distance = Math.hypot(dx, dy);
        if (type === 'magnet' && distance > this.unit * 3) continue;
        const nx = distance > 1e-8 ? dx / distance : Math.cos(other.id), ny = distance > 1e-8 ? dy / distance : Math.sin(other.id);
        const speed = this.unit * (type === 'magnet' ? 4 : 2);
        this.pushEnemy(other, nx * speed, ny * speed);
      }
    }
  }

  flushFragments() {
    if (this.mode === 'campaign' || !this.combatActive || this.pendingClearing) return;
    while (this.fragmentQueue.length && this.liveCount < this.limit && this.canSpawnType('fragment')) {
      if (!this.spawnEnemy(null, 'fragment', this.fragmentQueue[0])) break;
      this.fragmentQueue.shift();
    }
  }
  get spawnInterval() {
    const introduction = Object.values(ENEMY_TYPES).some(type => type.spawnable && type.id !== 'normal' && type.stage === this.stage);
    return (.65 + 1.35 * .86 ** (this.stage - 1)) * (introduction ? 1.15 : 1) / (this.mode !== 'campaign' ? 1.2 ** (this.buffs.risk || 0) : 1);
  }
  enemyProfile() {
    return {
      radiusScale: .62 + this.random() * .36,
      density: .65 + this.stage * .06 + this.time * .0004,
      hp: 19 * 1.16 ** (this.stage - 1) + Math.floor(this.time / 45) * 2,
      value: 10,
    };
  }
  emit(type, data = {}) { this.events.push({type, feedbackTime: this.feedbackTime, ...data}); }

  resize(width, height) {
    this.cancelPull();
    const rx = width / this.width, ry = height / this.height;
    const oldBounds = this.arenaBounds, oldUnit = this.unit;
    this.width = width; this.height = height;
    this.unit = clamp(Math.min(width, height) * .047, 18, 34);
    const k = this.unit / oldUnit, bounds = this.arenaBounds;
    const mapPoint = (point, radius) => ({...point,
      x: clamp(bounds.left + (point.x - oldBounds.left) / oldBounds.width * bounds.width, bounds.left + radius, bounds.right - radius),
      y: clamp(bounds.top + (point.y - oldBounds.top) / oldBounds.height * bounds.height, bounds.top + radius, bounds.bottom - radius)});
    for (const body of [this.player, ...this.auxiliaries, ...this.enemies]) {
      // Preserve ordinary resize behavior; the boss arena maps within its own
      // current bounds so rotating a square arena cannot squash its contents.
      const mapped = this.arenaBlend > 0 ? mapPoint(body, body.r * k) : {
        x: clamp(body.x * rx, body.r * k + this.inset, width - body.r * k - this.inset),
        y: clamp(body.y * ry, body.r * k + this.inset, height - body.r * k - this.inset)};
      body.x = mapped.x; body.y = mapped.y; body.r *= k; body.vx *= k; body.vy *= k;
      body.pendingVx = (body.pendingVx || 0) * k; body.pendingVy = (body.pendingVy || 0) * k;
      this.clampBodyToArena(body);
    }
    this.layoutChoices();
    if (this.phase === 'choose' && this.choices.length === 5) {
      Object.assign(this.player, {x: width / 2, y: this.choicePlayerY, vx: 0, vy: 0, pendingVx: 0, pendingVy: 0});
    }
    if (this.clearing) {
      this.clearing.x *= rx; this.clearing.y *= ry; this.clearing.radius *= k;
    }
    if (this.pendingClearing) { this.pendingClearing.x *= rx; this.pendingClearing.y *= ry; }
    for (const cluster of [this.wave, this.floorCluster].filter(Boolean)) {
      for (const part of [cluster, ...(cluster.subclusters || [])]) {
        const mapped = mapPoint(part, this.unit * 3.5); part.x = mapped.x; part.y = mapped.y;
      }
    }
    if (this.magnetPull) this.magnetPull.remainingDistance *= k;
    for (const child of this.fragmentQueue) { child.x *= rx; child.y *= ry; }
    if (this.phase === 'transition') this.rollFrom = {x: this.player.x, y: this.player.y};
    if (this.boss) {
      const boss = this.boss;
      const inflated = boss.r >= boss.initialRadius;
      const progress = inflated ? (boss.r - boss.initialRadius) / Math.max(1e-8, boss.maxRadius - boss.initialRadius)
        : (boss.initialRadius - boss.r) / Math.max(1e-8, boss.initialRadius - boss.minRadius);
      const config = this.fittedBossConfig();
      for (const key of ['initialRadius', 'minRadius', 'maxRadius', 'inflationRate', 'thresholds']) boss[key] = config[key];
      boss.r = boss.stunned || boss.defeated ? boss.minRadius : inflated
        ? lerp(boss.initialRadius, boss.maxRadius, clamp(progress, 0, 1))
        : lerp(boss.initialRadius, boss.minRadius, clamp(progress, 0, 1));
      Object.assign(boss, this.bossAnchor());
      if (this.phase === 'boss-entry') {
        this.positionBossEntry();
      }
      if (['boss-entry', 'boss'].includes(this.phase)) for (const body of [this.player, ...this.auxiliaries, ...this.enemies]) this.separateBossPlayer(body);
      if (this.phase === 'boss-celebrate' && this.bossCelebration?.stop) {
        this.bossCelebration.stop = mapPoint(this.bossCelebration.stop, this.player.r);
        const stop = {...this.bossCelebration.stop, r: this.player.r}; this.clampBodyToArena(stop);
        this.bossCelebration.stop = {x: stop.x, y: stop.y};
        this.player.x = this.bossCelebration.stop.x; this.player.y = this.bossCelebration.stop.y;
      }
    }
  }

  makeCluster(size) {
    const bounds = this.arenaBounds, margin = this.unit * 3.5;
    const minX = bounds.left + margin, maxX = bounds.right - margin;
    const minY = bounds.top + margin, maxY = bounds.bottom - margin;
    let point = {x: this.width / 2, y: this.height / 2}, best = -Infinity;
    for (let i = 0; i < 24; i++) {
      const x = minX + ((this.random() + i * .61803398875) % 1) * Math.max(0, maxX - minX);
      const y = minY + ((this.random() + i * .38196601125) % 1) * Math.max(0, maxY - minY);
      let clearance = Math.hypot(x - this.player.x, y - this.player.y) - this.player.r - margin;
      for (const b of this.enemies) if (b.hp > 0) clearance = Math.min(clearance, Math.hypot(x - b.x, y - b.y) - b.r - margin);
      if (clearance > best) { best = clearance; point = {x, y}; }
    }
    return {...point, id: ++this.clusterId, size, index: 0, angle: this.random() * Math.PI * 2, timer: 0};
  }

  nextIntroduction() {
    return Object.values(ENEMY_TYPES).filter(type => type.spawnable && type.id !== 'normal' && type.stage <= this.stage)
      .sort((a, b) => a.stage - b.stage).find(type => (this.typeIntroductions[type.id] || 0) < 3)?.id || null;
  }

  reservedEnemyTypes(includeIntroduction = false) {
    const types = [...this.enemies.filter(b => b.hp > 0).map(b => b.enemyType || 'normal'),
      ...(this.wave?.types?.slice(this.wave.index) || []), ...(this.floorCluster?.types?.slice(this.floorCluster.index) || []),
      ...this.fragmentQueue.map(() => 'normal')];
    const counted = new Set(types.map(type => type === 'fragment' ? 'normal' : type));
    if (counted.has('split')) counted.add('normal');
    const intro = includeIntroduction && this.nextIntroduction();
    if (intro && (counted.has(intro) || counted.size < enemyTypeLimit(this.stage))) {
      if (intro !== 'split' || counted.has('normal') || counted.size + 2 <= enemyTypeLimit(this.stage)) counted.add(intro);
    }
    return [...counted];
  }

  canSpawnType(type) {
    const types = new Set(this.reservedEnemyTypes()); types.add(type === 'fragment' ? 'normal' : type);
    if (type === 'split') types.add('normal');
    return types.size <= enemyTypeLimit(this.stage);
  }

  makePlannedCluster(size) {
    const excludedTypes = Object.keys(ENEMY_TYPES).filter(type => type !== 'normal' && (this.typeIntroductions[type] || 0) < 3);
    const types = planEnemyCluster({stage: this.stage, size, random: this.random,
      reservedTypes: this.reservedEnemyTypes(true), excludedTypes});
    if (!types.length) return null;
    return {...this.makeCluster(types.length), types};
  }

  advanceIntroduction(dt) {
    this.introTimer -= dt;
    if (this.introTimer > 1e-10 || this.liveCount >= this.limit) return;
    const type = this.nextIntroduction();
    if (!type || !this.canSpawnType(type)) return;
    const body = this.spawnEnemy(null, type);
    if (body) {
      body.teaching = true; this.typeIntroductions[type] = (this.typeIntroductions[type] || 0) + 1;
      this.introTimer = .3;
    }
  }

  safeSpawnPosition(point, radius, cluster, {localOnly = false} = {}) {
    const bounds = this.arenaBounds;
    const fit = pos => ({x: clamp(pos.x, bounds.left + radius, bounds.right - radius), y: clamp(pos.y, bounds.top + radius, bounds.bottom - radius)});
    const clearance = pos => Math.min(Math.hypot(pos.x - this.player.x, pos.y - this.player.y) - radius - this.player.r,
      ...this.enemies.filter(b => b.hp > 0).map(b => Math.hypot(pos.x - b.x, pos.y - b.y) - radius - b.r));
    let best = fit(point), gap = clearance(best);
    if (gap >= 0 && (!localOnly || Math.hypot(best.x - cluster.x, best.y - cluster.y) <= this.unit * 2.5)) return {point: best, cluster};
    for (let pass = 0; pass < (localOnly ? 1 : 2); pass++) {
      if (pass) cluster = this.makeCluster(1);
      for (let i = 0; i < 48; i++) {
        const angle = cluster.angle + i * Math.PI * (3 - Math.sqrt(5));
        const distance = this.unit * (localOnly ? .75 + 1.75 * Math.sqrt(i / 47) : 2.5 * Math.sqrt(i / 48));
        const candidate = fit({x: cluster.x + Math.cos(angle) * distance, y: cluster.y + Math.sin(angle) * distance});
        if (localOnly && Math.hypot(candidate.x - cluster.x, candidate.y - cluster.y) > this.unit * 2.5 + 1e-8) continue;
        const next = clearance(candidate);
        if (next > gap) { best = candidate; gap = next; }
        if (next >= 0) return {point: candidate, cluster};
      }
    }
    // Split children belong at the death point. If the local ring is crowded,
    // keep them queued instead of relocating the burst to another arena area.
    if (localOnly) return null;
    // A crowded arena can force an overlap with another protected newborn,
    // but never place a new body on the player. Search the whole arena last.
    for (let i = 0; i < 96; i++) {
      const candidate = fit({x: bounds.left + ((i * .61803398875) % 1) * bounds.width,
        y: bounds.top + ((i * .38196601125 + .3) % 1) * bounds.height});
      const next = clearance(candidate);
      if (next > gap) { best = candidate; gap = next; }
      if (next >= 0) { cluster = {...this.makeCluster(1), x: candidate.x, y: candidate.y}; return {point: candidate, cluster}; }
    }
    if (Math.hypot(best.x - this.player.x, best.y - this.player.y) < radius + this.player.r) return null;
    return {point: best, cluster: {...cluster, x: best.x, y: best.y, id: ++this.clusterId}};
  }

  edgeSpawnPosition(radius) {
    const bounds = this.arenaBounds; let best = null, distance = -Infinity;
    for (let i = 0; i < 16; i++) {
      const side = i % 4, t = (this.random() + i * .61803398875) % 1;
      const point = {x: side < 2 ? (side ? bounds.right - radius : bounds.left + radius) : lerp(bounds.left + radius, bounds.right - radius, t),
        y: side >= 2 ? (side === 2 ? bounds.top + radius : bounds.bottom - radius) : lerp(bounds.top + radius, bounds.bottom - radius, t)};
      if (Math.hypot(point.x - this.player.x, point.y - this.player.y) < this.player.r + radius) continue;
      const gap = Math.min(Math.hypot(point.x - this.player.x, point.y - this.player.y) - this.player.r - radius,
        ...this.enemies.filter(b => b.hp > 0).map(b => Math.hypot(point.x - b.x, point.y - b.y) - b.r - radius));
      if (gap > distance) { best = point; distance = gap; }
    }
    return best;
  }

  fillFloor() {
    let count = Math.max(0, this.floorCount - this.liveCount);
    while (count > 0) {
      const size = Math.min(count, Math.max(6, this.waveSize)), cluster = this.makePlannedCluster(size);
      if (!cluster) break;
      for (let i = 0; i < cluster.size; i++) this.spawnEnemy(cluster);
      count -= cluster.size;
    }
    this.floorTimer = 0; this.floorCluster = null;
  }

  advanceSpawning(dt) {
    // Breath retains its existing slowdown on scheduled waves. The floor is a
    // separate guarantee, and full-field pressure always uses real active time.
    const slowed = Math.min(dt, this.breathTime), waveDt = dt - slowed * (1 - BREATH_SPAWN_RATE);
    this.breathTime = Math.max(0, this.breathTime - dt);
    if (this.liveCount >= this.floorCount) { if (Number.isFinite(this.floorTimer)) this.floorTimer = 0; this.floorCluster = null; }
    else {
      this.floorTimer -= dt;
      while (this.floorTimer <= 1e-10 && this.liveCount < this.floorCount) {
        if (!this.floorCluster || this.floorCluster.index >= this.floorCluster.size) this.floorCluster = this.makePlannedCluster(Math.min(this.waveSize, this.floorCount - this.liveCount));
        if (this.floorCluster) this.spawnEnemy(this.floorCluster);
        this.floorTimer += .15;
      }
    }
    this.spawnTimer -= waveDt;
    if (this.wave) this.wave.timer -= dt;
    if (this.spawnTimer <= 1e-10) {
      this.wave = this.makePlannedCluster(this.waveSize); if (this.wave) this.wave.timer = this.spawnTimer;
      this.spawnTimer += this.waveInterval;
    }
    while (this.wave && this.wave.timer <= 1e-10) {
      // Full capacity consumes this scheduled slot; it does not accumulate an
      // unbounded burst to release after the player makes room.
      if (this.liveCount < this.limit) this.spawnEnemy(this.wave); else this.wave.index++;
      this.wave.timer += .3;
      if (this.wave.index >= this.wave.size) this.wave = null;
    }
    this.advanceIntroduction(dt);
  }

  spawnEnemy(cluster = null, type = 'normal', fragment = null) {
    if (!this.combatActive || this.liveCount >= this.limit) return;
    const variants = this.mode !== 'campaign';
    if (variants) type = cluster?.types?.[cluster.index] || type;
    if (variants && !this.canSpawnType(type)) { if (cluster) cluster.index++; return; }
    const base = fragment ? {radiusScale: .6, density: fragment.density, hp: fragment.maxHp, value: 5} : this.enemyProfile();
    const profile = variants ? enemyProfileFor(type, base) : base;
    const r = this.unit * profile.radiusScale;
    let x, y, best = -Infinity, pos;
    if (this.mode !== 'campaign') {
      if (fragment) {
        fragment.clusterId ??= ++this.clusterId;
        cluster = {x: fragment.x, y: fragment.y, id: fragment.clusterId, size: 1, index: 0, angle: fragment.angle};
      } else cluster ||= this.makeCluster(1);
      let index = cluster.index++;
      if (cluster.size > 8) {
        const group = Math.floor(index / 8);
        cluster.subclusters ||= [];
        cluster.subclusters[group] ||= this.makeCluster(Math.min(8, cluster.size - group * 8));
        index %= 8; cluster = cluster.subclusters[group];
      }
      const hasCenter = cluster.size >= 7;
      const ringSize = cluster.size - (hasCenter ? 1 : 0), ringIndex = index - (hasCenter ? 1 : 0);
      const angle = cluster.angle + ringIndex * Math.PI * 2 / Math.max(1, ringSize);
      // Randomly rotate a spaced cluster instead of stacking random samples.
      // Even eight maximum-radius balls fit without overlap inside 2.5 units.
      const ringRadius = ringSize <= 1 ? 0 : .995 / Math.sin(Math.PI / ringSize);
      const radius = this.unit * (hasCenter && index === 0 ? 0 : Math.max(hasCenter ? 2 : 0, ringRadius)), bounds = this.arenaBounds;
      pos = {x: clamp(cluster.x + Math.cos(angle) * radius, bounds.left + r, bounds.right - r),
        y: clamp(cluster.y + Math.sin(angle) * radius, bounds.top + r, bounds.bottom - r)};
      if (type === 'leader') pos = {x: cluster.x, y: cluster.y};
      if (fragment) pos = {x: fragment.x + Math.cos(fragment.angle) * this.unit * 1.3, y: fragment.y + Math.sin(fragment.angle) * this.unit * 1.3};
      if (type === 'walker') { pos = this.edgeSpawnPosition(r); if (!pos) return; cluster = {...this.makeCluster(1), x: pos.x, y: pos.y}; }
      else {
        const safe = this.safeSpawnPosition(pos, r, cluster, {localOnly: !!fragment}); if (!safe) return;
        pos = safe.point; cluster = safe.cluster;
      }
    } else for (let n = 0; n < 24; n++) {
      x = this.inset + r + this.random() * (this.width - 2 * (this.inset + r));
      y = this.inset + r + this.random() * (this.height - 2 * (this.inset + r));
      let distance = Math.hypot(x - this.player.x, y - this.player.y) - r - this.player.r - this.unit * 2;
      for (const b of this.enemies) distance = Math.min(distance, Math.hypot(x - b.x, y - b.y) - r - b.r);
      if (distance > best) { best = distance; pos = {x, y}; }
      if (best > this.unit * .5) break;
    }
    const b = this.makeBody(pos.x, pos.y, r, profile.density);
    b.maxHp = b.hp = profile.hp;
    b.value = profile.value;
    b.born = 0;
    b.angle = this.random() * Math.PI * 2;
    if (variants) {
      Object.assign(b, {enemyType: type, shield: profile.shield, drag: profile.drag, moveSpeed: profile.moveSpeed});
      b.mass *= profile.massScale;
    }
    if (cluster) Object.assign(b, {clusterId: cluster.id, clusterX: cluster.x, clusterY: cluster.y});
    if (fragment) b.angle = Math.hypot(pos.x - fragment.x, pos.y - fragment.y) > 1e-8
      ? Math.atan2(pos.y - fragment.y, pos.x - fragment.x) : fragment.angle;
    const initialSpeed = fragment ? 6 : variants ? profile.moveSpeed || profile.driftSpeed : .2;
    b.vx = Math.cos(b.angle) * this.unit * initialSpeed;
    b.vy = Math.sin(b.angle) * this.unit * initialSpeed;
    this.enemies.push(b);
    this.emit('spawn', {x: b.x, y: b.y, bodyId: b.id, clusterId: b.clusterId, enemyType: b.enemyType || 'normal', shield: !!b.shield});
    return b;
  }

  shoot(dx, dy) {
    const allowed = this.ready, boost = this.mode !== 'campaign' && this.player.boomerangTime > 0 ? 1.2 : 1;
    const currentSpeed = length(this.player) / boost, carriedSpeed = (this.pullStartSpeed ?? length(this.player)) / boost;
    this.cancelPull();
    const distance = Math.hypot(dx, dy);
    if (!allowed || distance < 6) return false;
    if (this.mode !== 'campaign') {
      this.clearAuxiliaries();
      this.shotKills = 0; this.shotBanked = false; this.shotWallCount = 0; this.shotSplitUsed = false;
      if (this.continuousControl) {
        this.shotUpgradeBoost = this.pendingUpgradeBoost; this.pendingUpgradeBoost = false;
        this.totalShots++; if (this.phase === 'battle') this.stageShots++;
      }
      this.activeShot = this.combatActive ? {time: this.feedbackTime, hits: 0} : null;
      if (this.activeShot) this.shotHistory.push(this.activeShot);
    }
    this.feedbackKills = 0;
    this.feedbackFreezeUsed = 0;
    this.player.feedbackFreeze = this.player.feedbackFreezeTotal = 0;
    const pull = clamp(distance / this.maxPull, 0, 1);
    // Keep the established energy cap. Endless release redirects the current
    // velocity and only supplies the launch energy still needed at that speed.
    const launchSpeed = Math.min(this.launchCap, this.baseSpeed * pull * Math.sqrt(this.energy / this.density));
    const speed = this.bossControl ? launchSpeed + Math.min(carriedSpeed, this.readySpeed)
      : this.continuousControl
      ? Math.max(.9 * currentSpeed, launchSpeed * (1 - .5 * Math.min(1, currentSpeed / this.baseSpeed)))
      : launchSpeed + carriedSpeed;
    this.player.vx = -dx / distance * speed * boost;
    this.player.vy = -dy / distance * speed * boost;
    this.player.angle = Math.atan2(dy, dx);
    this.player.squash = -.33 * pull;
    const freezeDuration = this.freezeFeedback(this.player, .033, {scaled: false});
    this.emit('shoot', {power: pull, bodyId: this.player.id, feedbackLevel: 0,
      impactVx: this.player.vx, impactVy: this.player.vy, impactSpeed: speed * boost, freezeDuration, upgradeBoost: this.continuousControl && this.shotUpgradeBoost});
    return true;
  }

  clearAuxiliaries() { this.auxiliaries = []; }

  spawnAuxiliaries(contact = {}) {
    this.shotSplitUsed = true;
    if (this.mode === 'campaign' || !this.combatActive) return;
    const p = this.player, vx = contact.impactVx ?? p.vx, vy = contact.impactVy ?? p.vy;
    const speed = Math.hypot(vx, vy), heading = Math.atan2(vy, vx);
    for (const offset of [-Math.PI / 9, Math.PI / 9]) {
      const angle = heading + offset, child = this.makeBody(p.x, p.y, this.unit * .7, p.density);
      Object.assign(child, {isPlayer: true, isAuxiliary: true, sourceMass: p.mass, hp: Infinity,
        maxHp: Infinity, born: 1, solid: true, angle, vx: Math.cos(angle) * speed * .6,
        vy: Math.sin(angle) * speed * .6, bank: 0, slowAge: 0, upgradeBoost: !!this.shotUpgradeBoost});
      this.auxiliaries.push(child);
    }
    this.emit('playerSplit', {x: p.x, y: p.y, bodyIds: this.auxiliaries.map(b => b.id)});
  }

  startMagnetPull() {
    if (this.mode === 'campaign' || !this.buffs.magnet || this.pendingClearing) return;
    const p = this.player, candidates = this.enemies.filter(b => b.hp > 0 && b.solid);
    candidates.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
    this.magnetPull = candidates.length ? {bodyId: candidates[0].id, remainingTime: .4,
      remainingDistance: this.unit * 1.5 * this.buffs.magnet} : null;
  }

  advanceMagnetPull(dt, activeTimes = null) {
    const pull = this.magnetPull;
    if (!pull || !this.combatActive) return;
    const body = this.enemies.find(b => b.id === pull.bodyId && b.hp > 0 && b.solid);
    if (!body) { this.magnetPull = null; return; }
    // Integrate only the part left by this specific target's local hit-stop.
    dt = Math.min(dt, activeTimes?.get(body.id) ?? dt);
    if (body.feedbackFreeze > 1e-10 || dt <= 1e-10) return;
    const p = this.player, dx = p.x - body.x, dy = p.y - body.y, distance = Math.hypot(dx, dy);
    const duration = Math.min(dt, pull.remainingTime);
    const move = Math.min(pull.remainingDistance * duration / Math.max(1e-8, pull.remainingTime),
      Math.max(0, distance - p.r - body.r - .001));
    if (distance > 1e-8) { body.x += dx / distance * move; body.y += dy / distance * move; }
    pull.remainingDistance -= move; pull.remainingTime -= duration;
    if (pull.remainingTime <= 1e-8 || distance - move <= p.r + body.r + .0011) this.magnetPull = null;
  }

  advanceBoomerang(body, dt) {
    if (!(body.boomerangTime > 0)) return;
    body.boomerangTime = Math.max(0, body.boomerangTime - dt);
    if (body.boomerangTime <= 1e-10) {
      body.boomerangTime = 0; body.vx /= 1.2; body.vy /= 1.2;
    }
  }

  fullPullDamage(body) {
    const speed = Math.min(this.launchCap, this.baseSpeed * Math.sqrt(this.energy / this.density));
    const mass = body.isBoss ? this.player.mass : 1 / (1 / this.player.mass + 1 / body.mass);
    return .5 * mass * (speed / this.unit) ** 2 * .31;
  }

  releaseShockwave(actor = this.player) {
    const p = actor, radius = this.unit * 3;
    this.emit('shockwave', {x: p.x, y: p.y, r: radius, bodyId: p.id, auxiliary: !!p.isAuxiliary, walls: this.shotWallCount});
    if (['boss', 'boss-entry'].includes(this.phase)) {
      const boss = this.boss;
      if (boss?.solid && Math.hypot(boss.x - p.x, boss.y - p.y) - boss.r <= radius) {
        // The old Boss's outer shell uses speed-based contraction. An area hit
        // carries half kinetic energy; during stun its HP damage is exactly half
        // the current full-pull reference (and consumes no bank charge).
        const speed = Math.min(this.launchCap, this.baseSpeed * Math.sqrt(this.energy / this.density));
        this.damageBoss(speed / Math.sqrt(2), {source: 'shockwave', attacker: p, damageOverride: Math.max(1, Math.round(this.fullPullDamage(boss) * .5)), preserveBank: true});
      }
    }
    for (const body of this.enemies) {
      if (!body.solid || body.hp <= 0 || Math.hypot(body.x - p.x, body.y - p.y) > radius) continue;
      this.damage(body, Math.max(1, Math.round(this.fullPullDamage(body) * .5)), {source: 'shockwave', attacker: p});
    }
    if (this.pendingClearing) this.beginClearing(); else this.flushFragments();
  }

  wall(b) {
    const bounds = this.arenaBounds;
    const restitution = b.isPlayer && this.arenaBlend > 0 ? .985 : b.isPlayer && this.continuousControl ? .95 : .92;
    let nx = 0, ny = 0, speed = 0;
    if (b.x < bounds.left + b.r) { b.x = bounds.left + b.r; if (b.vx < 0) { speed = -b.vx; b.vx *= -restitution; nx = -1; } }
    if (b.x > bounds.right - b.r) { b.x = bounds.right - b.r; if (b.vx > 0) { speed = b.vx; b.vx *= -restitution; nx = 1; } }
    if (b.y < bounds.top + b.r) { b.y = bounds.top + b.r; if (b.vy < 0) { speed = Math.max(speed, -b.vy); b.vy *= -restitution; ny = -1; } }
    if (b.y > bounds.bottom - b.r) { b.y = bounds.bottom - b.r; if (b.vy > 0) { speed = Math.max(speed, b.vy); b.vy *= -restitution; ny = 1; } }
    if (speed > 0 && b.isPlayer && this.continuousControl) {
      this.shotBanked = true; this.shotWallCount++;
      if (this.buffs.boomerang) {
        if (!(b.boomerangTime > 0)) { b.vx *= 1.2; b.vy *= 1.2; }
        b.boomerangTime = .5;
      }
      if (this.buffs.shockwave && this.shotWallCount % 3 === 0) this.releaseShockwave(b);
    }
    if (speed > this.unit * .8) {
      b.squash = Math.min(.32, speed / this.baseSpeed * .4);
      b.angle = Math.atan2(ny, nx);
      if (b.isPlayer) {
        if (this.buffs.bank) { if (b.isAuxiliary) b.bank = Math.min(2, (b.bank || 0) + 1); else this.bank = Math.min(2, this.bank + 1); }
        this.emit('wall', {x: b.x + nx * b.r, y: b.y + ny * b.r, contactX: b.x + nx * b.r, contactY: b.y + ny * b.r,
          power: speed / this.baseSpeed,
          bodyId: b.id, nx, ny, bank: b.isAuxiliary ? b.bank || 0 : this.bank, auxiliary: !!b.isAuxiliary, impactSpeed: speed});
      }
    }
  }

  collide(a, b, spawning = false) {
    if (this.phase === 'clearing') return;
    if ((a.feedbackFreeze || 0) > 1e-10 || (b.feedbackFreeze || 0) > 1e-10) return;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const ar = a.r * (a.isPlayer ? 1 : ease(a.born));
    const br = b.r * ease(b.born);
    const sum = ar + br;
    if (dist >= sum || sum < 1) return;
    const nx = dist > .001 ? dx / dist : 1, ny = dist > .001 ? dy / dist : 0;
    const invA = 1 / a.mass, invB = 1 / b.mass;
    const totalInv = invA + invB;
    const overlap = sum - dist;
    a.x -= nx * overlap * invA / totalInv;
    a.y -= ny * overlap * invA / totalInv;
    b.x += nx * overlap * invB / totalInv;
    b.y += ny * overlap * invB / totalInv;
    const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (closing <= 0 || spawning) return;
    const oldSpeed = length(a), oldX = a.vx, oldY = a.vy;
    const variants = this.mode !== 'campaign' && this.combatActive;
    const ring = variants && (a.enemyType === 'ring' || b.enemyType === 'ring');
    const heavy = variants && a.isPlayer && b.enemyType === 'heavy';
    const restitution = ring ? 1 : a.isPlayer ? .90 : .82;
    const impulse = (1 + restitution) * closing / totalInv;
    a.vx -= impulse * nx * invA; a.vy -= impulse * ny * invA;
    b.vx += impulse * nx * invB; b.vy += impulse * ny * invB;
    a.squash = b.squash = Math.min(.3, closing / this.baseSpeed * .42);
    a.angle = b.angle = Math.atan2(ny, nx);
    if (a.isPlayer && this.continuousControl && oldSpeed > 0) {
      const solvedSpeed = length(a), pierce = !!this.buffs.pierce;
      const retention = Math.max(.70 + .06 * Math.min(4, this.buffs.rubber || 0), ring ? .98 : 0, pierce ? .92 : 0);
      const retain = Math.max(solvedSpeed, oldSpeed * retention);
      const directionX = pierce || solvedSpeed < 1e-10 ? oldX / oldSpeed : a.vx / solvedSpeed;
      const directionY = pierce || solvedSpeed < 1e-10 ? oldY / oldSpeed : a.vy / solvedSpeed;
      a.vx = directionX * retain; a.vy = directionY * retain;
    } else if (a.isPlayer && this.buffs.pierce && oldSpeed > 1) {
      const retain = Math.min(oldSpeed * .92, Math.max(oldSpeed * .52, length(a)));
      a.vx = oldX / oldSpeed * retain;
      a.vy = oldY / oldSpeed * retain;
    }
    if (heavy) this.shotBanked = true;
    if (a.isPlayer && closing > this.unit * 2.4) {
      const reducedMass = a.isAuxiliary ? 1 / (1 / a.sourceMass + invB) : 1 / totalInv;
      const referenceClosing = a.isAuxiliary ? closing / .6 : closing;
      const impact = .5 * reducedMass * (referenceClosing / this.unit) ** 2;
      const bank = a.isAuxiliary ? a.bank || 0 : this.bank;
      const damage = Math.max(1, Math.round(impact * .31 * (1 + bank * .6) * (a.isAuxiliary ? .6 : 1)));
      if (a.isAuxiliary) a.bank = 0; else this.bank = 0;
      const firstKill = this.shotKills === 0;
      const contact = {attacker: a, nx, ny, contactX: b.x - nx * br, contactY: b.y - ny * br,
        impactVx: oldX, impactVy: oldY, impactSpeed: oldSpeed};
      const feedback = this.damage(b, damage, contact);
      if (this.mode !== 'campaign' && this.buffs.penetration && firstKill && b.hp <= 0 && oldSpeed > 0) {
        const solved = length(a), direction = solved > 1e-8 ? {x: a.vx / solved, y: a.vy / solved} : {x: oldX / oldSpeed, y: oldY / oldSpeed};
        a.vx = direction.x * Math.max(oldSpeed, solved); a.vy = direction.y * Math.max(oldSpeed, solved);
      }
      if (!feedback?.shielded) this.emit('hit', {x: contact.contactX, y: contact.contactY, power: closing / this.baseSpeed,
        ...this.impactFeedback(b, damage, contact), ...feedback, lethal: b.hp <= 0});
      if (this.combatActive && this.buffs.pulse && closing > this.unit * 9 && this.pulseCooldown <= 0) {
        this.pulseCooldown = .65;
        this.emit('pulse', {x: b.x, y: b.y, r: this.unit * 4});
        for (const other of this.enemies) {
          if (other === b || !other.solid || other.hp <= 0) continue;
          const d = Math.hypot(other.x - b.x, other.y - b.y);
          if (d < this.unit * 4) {
            this.damage(other, Math.round(damage * .3), {...contact, source: 'pulse',
              nx: (other.x - b.x) / Math.max(1, d), ny: (other.y - b.y) / Math.max(1, d),
              contactX: other.x - (other.x - b.x) / Math.max(1, d) * other.r,
              contactY: other.y - (other.y - b.y) / Math.max(1, d) * other.r});
            this.pushEnemy(other, (other.x - b.x) / Math.max(1, d) * this.unit * 4,
              (other.y - b.y) / Math.max(1, d) * this.unit * 4);
          }
        }
      }
      if (this.pendingClearing) this.beginClearing();
      else this.flushFragments();
    }
    if (heavy && this.buffs.bank) { if (a.isAuxiliary) a.bank = Math.min(2, (a.bank || 0) + 1); else this.bank = Math.min(2, this.bank + 1); }
    this.normalizeWalker(a); this.normalizeWalker(b);
  }

  damage(b, damage, contact = {}) {
    if (!this.combatActive || b.hp <= 0 || damage <= 0 || !Number.isFinite(damage)) return;
    if (this.mode !== 'campaign' && (b.shield || ['pulse', 'shockwave'].includes(contact.source) && b.shieldBrokenStep === this.stepSerial)) {
      const feedback = {...this.impactFeedback(b, 0, contact), shielded: true, freezeDuration: 0};
      if (b.shield) {
        b.shield = false; b.shieldBrokenStep = this.stepSerial;
        this.emit('shieldBreak', {x: b.x, y: b.y, r: b.r, ...feedback, shield: false, blockedDamage: damage});
        if (this.activeShot && this.feedbackTime - this.activeShot.time <= 20) this.activeShot.hits++;
      }
      return feedback;
    }
    b.hp -= damage; b.hit = 1;
    if (this.mode !== 'campaign' && this.activeShot && this.feedbackTime - this.activeShot.time <= 20) this.activeShot.hits++;
    const feedback = this.damageFeedback(b, damage, contact);
    if (b.hp <= 0) {
      const combo = ++this.shotKills, value = this.scoreValue((ENEMY_TYPES[b.enemyType]?.value || 10) * Math.min(combo, this.comboCap) * (this.shotBanked ? 1.5 : 1));
      if (this.phase === 'battle') { this.stageKills++; this.stageRealKills++; }
      this.totalKills++; this.maxCombo = Math.max(this.maxCombo, combo); this.score += value;
      if (this.buffs.breath) this.breathTime = BREATH_DURATION;
      this.emit('kill', {x: b.x, y: b.y, r: b.r, vx: b.vx, vy: b.vy, value, combo, banked: this.shotBanked, upgradeBoost: !!this.shotUpgradeBoost, ...feedback});
      if (this.phase === 'battle' && this.stageKills >= this.killTarget && !this.pendingClearing) this.pendingClearing = {x: b.x, y: b.y};
      this.enemyDeath(b);
      this.startMagnetPull();
      if (!this.pendingClearing && this.buffs.split && !this.shotSplitUsed) this.spawnAuxiliaries(contact);
    }
    return feedback;
  }

  beginClearing() {
    if (this.mode === 'campaign' || this.phase !== 'battle') return;
    this.upgradeContext = this.captureUpgradeContext();
    this.clearAuxiliaries(); this.magnetPull = null; this.shotUpgradeBoost = false;
    const origin = this.pendingClearing || this.player;
    this.clearing = {x: origin.x, y: origin.y, radius: 0, elapsed: 0, count: 0};
    this.pendingClearing = null;
    this.stageKillCarry = Math.max(0, this.stageKills - this.killTarget);
    this.cancelPull(); this.phase = 'clearing'; this.phaseTime = 0; this.overTimer = 0;
    this.wave = null; this.floorCluster = null;
    this.fragmentQueue = [];
    this.enemies = this.enemies.filter(body => body.hp > 0);
    this.emit('clearingStart', {x: origin.x, y: origin.y, feedbackLevel: this.feedbackKills});
  }

  advanceClearing(dt, timeScale) {
    const wave = this.clearing;
    wave.elapsed += dt / timeScale; wave.radius += dt * this.unit * 20;
    for (const b of [this.player, ...this.auxiliaries, ...this.enemies]) {
      const bodyDt = this.feedbackStep(b, dt, timeScale);
      // The sweep holds positions still, but contact deformation and the hit
      // flash relax normally once each body's local hit-stop has finished.
      b.squash *= Math.exp(-13 * bodyDt);
      b.hit = Math.max(0, b.hit - 5 * bodyDt);
    }
    const ordered = this.enemies.slice().sort((a, b) => Math.hypot(a.x - wave.x, a.y - wave.y) - Math.hypot(b.x - wave.x, b.y - wave.y));
    for (const b of ordered) {
      if (b.hp <= 0 || Math.hypot(b.x - wave.x, b.y - wave.y) > wave.radius + b.r) continue;
      const damage = b.hp, value = this.scoreValue(10); b.hp = 0; this.score += value; wave.count++; this.feedbackKills++;
      const distance = Math.hypot(b.x - wave.x, b.y - wave.y), nx = (b.x - wave.x) / Math.max(distance, 1e-8), ny = (b.y - wave.y) / Math.max(distance, 1e-8);
      this.emit('clearKill', {x: b.x, y: b.y, r: b.r, vx: b.vx, vy: b.vy, value,
        combo: this.shotKills, banked: this.shotBanked, ...this.impactFeedback(b, damage, {nx, ny,
          impactVx: nx * this.unit * 20, impactVy: ny * this.unit * 20, source: 'clear'}), freezeDuration: 0});
    }
    this.enemies = this.enemies.filter(body => body.hp > 0);
    if (!this.enemies.length && !(this.player.feedbackFreeze > 1e-10)) {
      this.emit('clearingEnd', {x: wave.x, y: wave.y, count: wave.count, value: wave.count * this.scoreValue(10)});
      this.clearing = null; this.beginUpgrade();
    }
  }

  advancePressure(realDt) {
    if (this.liveCount < this.limit) { this.overTimer = 0; return; }
    this.overTimer += realDt;
    if (this.overTimer + 1e-10 < .8) return;
    if (!this.saveUsed) {
      this.saveUsed = true; this.overTimer = 0;
      const rescued = this.enemies.filter(body => body.hp > 0).sort((a, b) => a.id - b.id).slice(0, 3);
      for (const b of rescued) { b.hp = 0; this.emit('shatter', {x: b.x, y: b.y, r: b.r * ease(b.born), vx: b.vx, vy: b.vy, bodyId: b.id, enemyType: b.enemyType || 'normal', shield: !!b.shield, source: 'rescue'}); }
      this.enemies = this.enemies.filter(body => body.hp > 0);
      this.emit('rescue', {x: this.player.x, y: this.player.y, count: rescued.length, bodyIds: rescued.map(body => body.id)});
    } else {
      this.endRun('capacity');
    }
  }

  endRun(reason) {
    if (this.phase === 'over') return false;
    this.cancelPull(); this.deathReason = reason; this.phase = 'over';
    this.frozenSnapshot = {player: {...this.player}, enemies: this.enemies.map(b => ({...b})),
      auxiliaries: this.auxiliaries.map(b => ({...b})), boss: this.boss ? {...this.boss} : null};
    this.emit('over', {reason, boss: !!this.boss, misses: this.resultMisses,
      maxCombo: this.maxCombo, totalKills: this.totalKills, totalShots: this.totalShots, elapsed: this.elapsed});
    return true;
  }

  clearEnemies() {
    this.clearAuxiliaries(); this.magnetPull = null; this.shotUpgradeBoost = false;
    if (this.player.boomerangTime > 0) { this.player.vx /= 1.2; this.player.vy /= 1.2; this.player.boomerangTime = 0; }
    for (const b of this.enemies) if (b.hp > 0) this.emit('shatter', {x:b.x, y:b.y, r:b.r * ease(b.born), vx:b.vx, vy:b.vy, enemyType:b.enemyType || 'normal', shield:!!b.shield});
    this.enemies = [];
    this.fragmentQueue = [];
    this.breathTime = 0;
  }

  beginUpgrade({bypassBoss = false} = {}) {
    if (!['battle', 'clearing'].includes(this.phase) && !(bypassBoss && this.phase === 'boss-celebrate')) return;
    this.upgradeContext ||= this.captureUpgradeContext();
    if (!bypassBoss && this.mode !== 'campaign' && this.stage % 5 === 0) { this.beginBoss(); return; }
    this.rewardSelectionsRemaining = bypassBoss && this.phase === 'boss-celebrate' && this.boss?.defeated ? 2 : 1;
    this.upgradeRoundTotal = this.rewardSelectionsRemaining; this.upgradeRound = 0;
    this.startingUpgrades = false;
    this.offerUpgradeRound();
  }

  beginStartingUpgrades() {
    if (this.mode === 'campaign') return false;
    this.cancelPull(); this.enemies = []; this.fragmentQueue = []; this.clearAuxiliaries();
    this.events = this.events.filter(event => event.type !== 'spawn');
    this.stage = this.maxStage = 1; this.stageKills = this.stageKillCarry = 0;
    this.spawnTimer = this.floorTimer = this.introTimer = Infinity;
    this.rewardSelectionsRemaining = this.upgradeRoundTotal = 1; this.upgradeRound = 0;
    this.startingUpgrades = true; this.offerUpgradeRound();
    return true;
  }

  offerUpgradeRound() {
    this.cancelPull();
    this.pendingClearing = this.clearing = this.wave = this.floorCluster = null; this.overTimer = 0;
    this.arenaRestoreFrom = this.arenaBlend;
    this.phase = 'transition'; this.phaseTime = 0;
    this.clearEnemies(); this.boss = null; this.bossCelebration = null; delete this.player.roll;
    this.player.vx = this.player.vy = 0;
    this.rollFrom = {x: this.player.x, y: this.player.y};
    this.upgradeRound++;
    let offers;
    if (this.startingUpgrades) {
      const pool = eligibleUpgrades({counts: this.buffs, pool: 'regular'}); offers = [];
      while (offers.length < 3 && pool.length) offers.push(pool.splice(Math.min(pool.length - 1, Math.floor(this.random() * pool.length)), 1)[0]);
    } else {
      const count = this.upgradeRound === 1 && this.gamblerRewardPending ? 5 : 3;
      if (this.upgradeRound === 1) this.gamblerRewardPending = false;
      const counts = this.nextGambler ? {...this.buffs, gambler: UPGRADES.gambler.maxStacks} : this.buffs;
      offers = rollUpgrades({counts, context: this.upgradeContext, random: this.random, count});
    }
    this.choices = offers.map(buff => ({...buff, x: 0, y: 0, r: this.unit * 2, born: 0}));
    this.layoutChoices();
    if (!this.choices.length) { this.phase = 'reward'; this.phaseTime = 0; this.emit('upgradeSkipped'); }
    this.emit('upgrade', {round: this.upgradeRound, rounds: this.upgradeRoundTotal, starting: this.startingUpgrades});
  }

  finishRewardRound() {
    this.rewardSelectionsRemaining = Math.max(0, this.rewardSelectionsRemaining - 1);
    if (this.rewardSelectionsRemaining > 0) { this.offerUpgradeRound(); return; }
    const starting = this.startingUpgrades; this.startingUpgrades = false;
    if (starting) this.time = 0;
    if (!starting) { this.stage++; this.target += 140 + this.stage * 50; }
    this.maxStage = Math.max(this.maxStage, this.stage);
    this.phase = 'battle'; this.phaseTime = 0;
    this.gamblerTargetMultiplier = this.nextGambler ? 1.5 : 1;
    this.gamblerRewardPending = this.nextGambler; this.nextGambler = false;
    this.stageShots = this.stageRealKills = 0; this.upgradeContext = null;
    this.stageKills = this.stageKillCarry; this.stageKillCarry = 0;
    this.spawnTimer = starting ? 4 : 2 * this.spawnInterval;
    this.floorTimer = 0; this.introTimer = 0; this.wave = null; this.fillFloor();
    this.emit('stage', {stage: this.stage, starting});
  }

  bossAnchor() { return {x: this.width * .5, y: this.height * .5}; }

  bossPlayerAnchor() {
    const side = Math.min(this.width, this.height) - this.inset * 2;
    return {x: this.width * .5, y: this.height * .5 + side * .5 - this.player.r - Math.max(2, this.unit * .1)};
  }

  fittedBossConfig() {
    const diameter = Math.min(this.width, this.height) - this.inset * 2;
    const config = bossConfig(this.stage, this.unit, diameter), arenaRadius = diameter / 2;
    const maxRadius = Math.max(.001, Math.min(arenaRadius * .75, arenaRadius - 2 * this.player.r - this.unit * .1));
    const initialRadius = Math.min(this.unit * 4.8, maxRadius * .82);
    const minRadius = Math.min(this.unit * 2, maxRadius * .45);
    return {...config, initialRadius, minRadius, maxRadius,
      inflationRate: initialRadius / 150 * (1 + .15 * Math.log2(config.index)),
      thresholds: Array.from({length: 5}, (_, i) => initialRadius - (initialRadius - minRadius) * (i + 1) / 5)};
  }

  beginBoss() {
    this.upgradeContext ||= this.captureUpgradeContext();
    this.cancelPull(); this.clearEnemies(); this.choices = [];
    this.pendingClearing = this.clearing = this.wave = this.floorCluster = null; this.overTimer = 0;
    this.phase = 'boss-entry'; this.phaseTime = 0; this.arenaBlend = 0;
    this.maxStage = Math.max(this.maxStage, this.stage);
    const config = this.fittedBossConfig();
    this.boss = Object.assign(this.makeBody(0, 0, config.initialRadius, 1), config,
      {isBoss: true, bossType: 'inflation', mass: Infinity, hp: Infinity, maxHp: Infinity, value: 0, scoredSegments: 0,
        defeated: false, stunned: false, stunnedTime: 0, solid: true, contacts: new Set(), entryElapsed: 0});
    Object.assign(this.boss, this.bossAnchor());
    this.emit('bossEntry', {stage: this.stage, bossType: 'inflation', x: this.boss.x, y: this.boss.y, r: this.boss.r});
  }

  positionBossEntry() {
    this.arenaBlend = smooth(this.phaseTime / BOSS_TIMING.entry);
    this.boss.born = clamp(this.boss.entryElapsed / BOSS_TIMING.entry, 0, 1);
  }

  get bossRadius() { return this.boss ? this.boss.r * (this.phase === 'boss-entry' ? smooth(this.boss.entryElapsed / .6) : 1) : 0; }


  // Resize or inflation can squeeze a player between the boss and a wall.
  // Include circle/bounds intersections so separation slides along that wall
  // instead of jumping all the way to one of the four cardinal directions.
  separateBossPlayer(p = this.player) {
    const b = this.boss; if (!b) return;
    this.clampBodyToArena(p);
    const dx = p.x - b.x, dy = p.y - b.y, distance = Math.hypot(dx, dy), sum = p.r + this.bossRadius;
    if (distance >= sum) return;
    const angle = distance > 1e-8 ? Math.atan2(dy, dx) : Math.PI / 2;
    let nearest = null, travel = Infinity;
    for (let i = 0; i < 65; i++) {
      const a = i === 0 ? angle : angle + Math.ceil(i / 2) * Math.PI / 32 * (i % 2 ? 1 : -1);
      const candidate = {x: b.x + Math.cos(a) * (sum + .001), y: b.y + Math.sin(a) * (sum + .001), r: p.r};
      this.clampBodyToArena(candidate);
      if (Math.hypot(candidate.x - b.x, candidate.y - b.y) < sum - 1e-7) continue;
      const change = Math.hypot(candidate.x - p.x, candidate.y - p.y);
      if (change < travel) { nearest = candidate; travel = change; }
      if (i === 0 && nearest) break;
    }
    if (nearest) { p.x = nearest.x; p.y = nearest.y; }
  }

  collideBoss(p = this.player) {
    if (!['boss-entry', 'boss'].includes(this.phase) || !this.boss?.solid || p.hp <= 0) return;
    const b = this.boss, dx = p.x - b.x, dy = p.y - b.y;
    const distance = Math.hypot(dx, dy), radius = this.bossRadius, sum = p.r + radius;
    if (distance > sum + this.unit * .02) b.contacts.delete(p.id);
    if (distance >= sum || radius < 1 || (p.feedbackFreeze || 0) > 1e-10) return;
    const nx = distance > .001 ? dx / distance : 0, ny = distance > .001 ? dy / distance : 1;
    const closing = -(p.vx * nx + p.vy * ny), overlap = sum - distance;
    p.x += nx * overlap; p.y += ny * overlap;
    this.separateBossPlayer(p);
    if (closing <= 0) return;
    const impactVx = p.vx, impactVy = p.vy;
    p.vx += (1 + (p.isPlayer ? .985 : .9)) * closing * nx;
    p.vy += (1 + (p.isPlayer ? .985 : .9)) * closing * ny;
    p.squash = b.squash = Math.min(.3, closing / this.baseSpeed * .42); p.angle = b.angle = Math.atan2(ny, nx);
    if (!p.isPlayer || b.contacts.has(p.id) || closing <= this.unit * 2.4) return;
    b.contacts.add(p.id);
    this.damageBoss(closing, {attacker: p, x: b.x + nx * radius, y: b.y + ny * radius,
      contactX: b.x + nx * radius, contactY: b.y + ny * radius, nx: -nx, ny: -ny,
      impactVx, impactVy, impactSpeed: Math.hypot(impactVx, impactVy)});
  }

  damageBoss(closing, contact = {}) {
    const boss = this.boss, actor = contact.attacker || this.player;
    if (!['boss-entry', 'boss'].includes(this.phase) || !boss?.solid || !Number.isFinite(closing) || closing <= this.unit * 2.4) return false;
    // Inflation specifically rewards a banked collision. This is separate from
    // the stored bank-upgrade charges and never boosts an area shockwave.
    const wallBoost = this.shotBanked && (!contact.source || contact.source === 'impact') ? 1.5 : 1;
    let damage = 0;
    const bank = actor.isAuxiliary ? actor.bank || 0 : this.bank;
    if (boss.stunned) {
      const mass = actor.isAuxiliary ? actor.sourceMass : actor.mass;
      const referenceClosing = actor.isAuxiliary ? closing / .6 : closing;
      const impact = .5 * mass * (referenceClosing / this.unit) ** 2;
      damage = contact.damageOverride ?? Math.max(1, Math.round(impact * .31 * (1 + bank * .6) * (actor.isAuxiliary ? .6 : 1) * wallBoost));
      boss.hp -= damage;
    } else {
      const span = boss.initialRadius - boss.minRadius;
      boss.r = Math.max(boss.minRadius, boss.r - span * (.0225 + .0225 * clamp(closing / this.baseSpeed, 0, 1)) / boss.shrinkDivisor * wallBoost);
    }
    if (this.activeShot && this.feedbackTime - this.activeShot.time <= 20) this.activeShot.hits++;
    boss.hit = 1;
    if (!contact.preserveBank) { if (actor.isAuxiliary) actor.bank = 0; else this.bank = 0; }
    const enteringStun = !boss.stunned && boss.r <= boss.minRadius + 1e-9;
    const feedback = this.impactFeedback(boss, damage, contact);
    feedback.freezeDuration = this.freezeFeedback(boss, enteringStun || boss.hp <= 0 ? .15 : .1, {actor});
    this.emit('bossHit', {x: contact.x ?? boss.x, y: contact.y ?? boss.y, r: boss.r, bossType: boss.bossType,
      power: closing / this.baseSpeed, ...feedback, enteringStun});
    const reached = boss.thresholds.filter(radius => boss.r <= radius + 1e-9).length;
    while (boss.scoredSegments < reached) {
      boss.scoredSegments++; const value = this.scoreValue(boss.segmentValue); this.score += value; this.target += value;
      this.emit('bossScore', {value, segment: boss.scoredSegments, x: boss.x, y: boss.y, r: boss.r});
    }
    if (enteringStun) {
      boss.r = boss.minRadius; boss.stunned = true; boss.stunnedTime = 0;
      const launch = Math.min(this.launchCap, this.baseSpeed * Math.sqrt(this.energy / this.density));
      const speed = (launch + this.readySpeed) * (this.buffs.boomerang ? 1.2 : 1);
      const impact = .5 * this.player.mass * (speed / this.unit) ** 2;
      // Include the legal shared wall bonus in the once-only health snapshot:
      // a full powered impact should leave a distinct finishing rebound.
      const strongestHit = Math.max(1, Math.round(impact * .31 * 1.5 * (this.buffs.bank ? 2.2 : 1)));
      boss.maxHp = boss.hp = Math.ceil(strongestHit * 1.05 * (boss.stunHealthScale / 100));
      this.emit('bossStunned', {x: boss.x, y: boss.y, r: boss.r, ...feedback, maxHp: boss.maxHp});
    } else if (boss.stunned && boss.hp <= 0) this.defeatBoss(feedback);
    return true;
  }

  defeatBoss(feedback = null) {
    const boss = this.boss, p = this.player;
    if (!['boss-entry', 'boss'].includes(this.phase) || !boss || boss.defeated) return;
    boss.r = boss.minRadius;
    // Preserve the incoming strike, before its bounce reverses the player.
    // Direct/scripted defeats still get a directional fallback at the surface.
    const impact = feedback || this.impactFeedback(boss, 0);
    boss.defeated = true; boss.solid = false; boss.hp = 0;
    const value = this.scoreValue(boss.killValue); this.score += value; this.target += value;
    this.totalKills++; this.bossKills++; this.shotKills++; this.maxCombo = Math.max(this.maxCombo, this.shotKills); this.cancelPull(); this.phase = 'boss-celebrate'; this.phaseTime = 0; p.roll = 0;
    this.bossVictorySlowTime = .5;
    // Preserve the exact post-impact velocity. The brake integrates its smooth
    // envelope and real wall rebounds instead of lerping to a clamped endpoint.
    this.bossCelebration = {celebrated: false, stop: null};
    this.emit('bossDefeated', {...impact, value, bossType: boss.bossType, slowDuration: .5, x: boss.x, y: boss.y, r: boss.r,
      referenceRadius: this.unit * .8});
  }

  advanceBossCelebration(dt) {
    const p = this.player, motion = this.bossCelebration, duration = BOSS_TIMING.brake;
    const previous = Math.max(0, this.phaseTime - dt), end = Math.min(this.phaseTime, duration);
    if (previous < duration) {
      const from = Math.max(0, 1 - previous / duration), to = Math.max(0, 1 - end / duration);
      const travel = from > 0 ? duration / 3 * (from ** 3 - to ** 3) / (from * from) : 0;
      p.x += p.vx * travel; p.y += p.vy * travel;
      const retention = from > 0 ? to * to / (from * from) : 0;
      p.vx *= retention; p.vy *= retention;
      this.wall(p); p.squash *= Math.exp(-dt * 13);
    }
    if (this.phaseTime + 1e-9 >= duration) {
      p.vx = p.vy = 0;
      if (!motion.stop) motion.stop = {x: p.x, y: p.y};
      p.x = motion.stop.x; p.y = motion.stop.y; p.squash = 0;
      if (!motion.celebrated) { motion.celebrated = true; this.emit('bossCelebrate', {x: p.x, y: p.y, r: p.r}); }
    }
    p.roll = Math.PI * 2 * smooth((this.phaseTime - duration) / BOSS_TIMING.spin);
    const total = duration + BOSS_TIMING.spin + BOSS_TIMING.hold + BOSS_TIMING.fade;
    if (this.phaseTime + 1e-9 >= total) { delete p.roll; this.beginUpgrade({bypassBoss: true}); }
  }

  advanceBoss(dt, dragging, timeScale = 1) {
    const b = this.boss, bossDt = this.feedbackStep(b, dt, timeScale);
    if (this.phase === 'boss-entry') {
      b.entryElapsed += bossDt; this.positionBossEntry();
      if (b.entryElapsed + 1e-9 >= BOSS_TIMING.entry) { b.born = 1; this.phase = 'boss'; this.phaseTime = 0; this.arenaBlend = 1;
        this.emit('bossReady', {stage: this.stage, bossType: 'inflation'}); }
    } else if (b.stunned) { b.r = b.minRadius; b.stunnedTime += bossDt; }
    else b.r = Math.min(b.maxRadius, b.r + b.inflationRate * bossDt);
    this.advanceBodies(dt, dragging, timeScale);
    if (!['boss-entry', 'boss'].includes(this.phase)) return;
    b.hit = Math.max(0, b.hit - bossDt * 5); b.squash *= Math.exp(-bossDt * 13);
    if (!b.stunned && b.r >= b.maxRadius) this.endRun('boss');
  }

  advanceVictorySlow(dt, timeScale) {
    const amount = Math.min(dt / timeScale, this.bossVictorySlowTime), motionDt = amount * timeScale;
    this.bossVictorySlowTime = Math.max(0, this.bossVictorySlowTime - amount);
    if (this.bossVictorySlowTime <= 1e-10) this.bossVictorySlowTime = 0;
    this.phaseTime = 0;
    for (const body of [this.player, ...this.auxiliaries, ...this.enemies]) {
      const active = this.feedbackStep(body, motionDt, timeScale);
      body.x += body.vx * active; body.y += body.vy * active;
      body.spin += body.vx * active / Math.max(1, body.r);
      body.squash *= Math.exp(-13 * active); body.hit = Math.max(0, body.hit - 5 * active);
      this.wall(body);
    }
    if (this.boss) this.feedbackStep(this.boss, motionDt, timeScale);
  }

  layoutChoices({top, bottom} = {}) {
    const bounds = this.arenaBounds, compact = this.height < 520;
    const availableWidth = bounds.width - this.unit;
    if (this.choices.length === 5) {
      // Five offers frame the player: three above and two below. Labels belong
      // to each row's footprint, so they cannot consume the player's gap.
      const outerFactor = 1.28, labelHeight = 31, preferredGap = Math.max(8, this.unit * .35);
      let areaTop = clamp(top ?? Math.max(bounds.top + 12, this.height * (compact ? .12 : .17)), bounds.top + 8, bounds.bottom - 8);
      let areaBottom = clamp(bottom ?? Math.min(bounds.bottom - 10, this.height * .86), areaTop, bounds.bottom - 8);
      const minimumHeight = 4 * outerFactor * 7 + 2 * this.player.r + 2 * labelHeight + 2 * preferredGap;
      if (areaBottom - areaTop < minimumHeight && top === undefined && bottom === undefined) {
        // Default layouts may use more of a short arena. Explicit preview
        // limits remain authoritative: never expand behind its controls.
        areaTop = bounds.top + 8; areaBottom = bounds.bottom - 8;
      }
      const height = areaBottom - areaTop;
      // Extremely short landscapes reduce empty space before the targets.
      // Both rarity rings and the full label footprint stay outside the player.
      const gap = Math.min(preferredGap, Math.max(0, (height - 2 * this.player.r - 2 * labelHeight - 4 * outerFactor * 5) / 2));
      const radius = Math.max(1, Math.min(this.unit * 2, availableWidth / 3 / 2.8,
        (height - 2 * this.player.r - 2 * labelHeight - 2 * gap) / (4 * outerFactor)));
      this.choicePlayerY = (areaTop + areaBottom) / 2;
      this.choices.forEach((c, i) => {
        const lower = i >= 3, count = lower ? 2 : 3, index = lower ? i - 3 : i;
        const spacing = Math.min(availableWidth / count, this.unit * 6.4);
        c.x = this.width / 2 + (index - (count - 1) / 2) * spacing;
        c.y = lower ? areaBottom - outerFactor * radius - labelHeight : areaTop + outerFactor * radius;
        c.r = radius; c.labelWidth = Math.max(32, spacing - 8);
      });
      return {playerY: this.choicePlayerY};
    }
    // Three offers keep their established row and player position.
    const areaTop = top ?? Math.max(bounds.top + 12, this.height * (compact ? .12 : .19));
    const areaBottom = bottom ?? this.height * (compact ? .65 : .61);
    const areaHeight = Math.max(44, areaBottom - areaTop);
    const columns = Math.max(1, this.choices.length), slot = availableWidth / columns;
    const radius = Math.max(7, Math.min(this.unit * 2, slot / 2.8, (areaHeight - 26) / 2.4));
    this.choices.forEach((c, i) => {
      const spacing = Math.min(availableWidth / columns, this.unit * 6.4);
      c.x = this.width / 2 + (i - (columns - 1) / 2) * spacing;
      c.y = areaTop + (areaHeight - 22) / 2;
      c.r = radius; c.labelWidth = Math.max(32, spacing - 8);
    });
    const offerBottom = Math.max(areaTop, ...this.choices.map(c => c.y + c.r + 24));
    this.choicePlayerY = Math.min(bounds.bottom - this.player.r - 4,
      Math.max(this.height * .77, offerBottom + this.player.r + 8));
    return {playerY: this.choicePlayerY};
  }

  captureUpgradeContext() {
    const living = this.enemies.filter(b => b.hp > 0);
    return {hardEnemyShare: living.length ? living.filter(b => ['ring', 'heavy'].includes(b.enemyType)).length / living.length : 0,
      nextBoss: (this.stage + 1) % 5 === 0, completedShots: this.stageShots,
      averageKillsPerShot: this.stageShots ? this.stageRealKills / this.stageShots : 0};
  }

  applyUpgrade(id) {
    if (this.mode === 'campaign' || id === 'gambler' && this.nextGambler || !canAcquireUpgrade(id, this.buffs)) return false;
    this.buffs[id] = (this.buffs[id] || 0) + 1;
    if (id === 'growth') this.player.r = this.unit * (1 + this.buffs.growth * .2);
    if (id === 'density') { this.density *= 1.35; this.player.density = PLAYER_BASE_DENSITY * this.density; this.player.mass = this.player.density; }
    if (id === 'energy') this.energy *= 1.3;
    if (id === 'gambler') this.nextGambler = true;
    return true;
  }

  choose(choice) {
    if (this.phase !== 'choose') return false;
    // Capture contact before an upgrade can change radius or mass. This shares
    // the enemy-kill fragment inputs without counting a reward as an enemy kill.
    const body = {...choice, x: Number.isFinite(choice?.x) ? choice.x : this.player.x,
      y: Number.isFinite(choice?.y) ? choice.y : this.player.y,
      r: Number.isFinite(choice?.r) ? choice.r : this.unit * 2, vx: 0, vy: 0, hp: 0, born: 1};
    const feedback = {...this.impactFeedback(body, 0), feedbackLevel: 1,
      power: length(this.player) / this.baseSpeed, bodySnapshot: {...body}};
    if (!this.applyUpgrade(choice?.id)) return false;
    this.pendingUpgradeBoost = true;
    this.cancelPull(); this.clearAuxiliaries();
    this.phase = 'reward'; this.phaseTime = 0;
    this.emit('buff', {buff: {...UPGRADES[choice.id], ...choice}, x: body.x, y: body.y, r: body.r,
      vx: 0, vy: 0, ...feedback});
    this.choices = [];
    return true;
  }

  step(dt, dragging = false, {timeScale = 1} = {}) {
    if (this.phase === 'over' || dt <= 0) return;
    this.stepSerial++;
    timeScale = Number.isFinite(timeScale) && timeScale > 0 ? timeScale : 1;
    // Subdivide fast motion instead of throwing away the added speed.
    // Each integration covers at most half a base radius at the sampled speed.
    let remaining = dt;
    while (remaining > 1e-10 && this.phase !== 'over') {
      const sampledSpeed = Math.max(length(this.player), ...this.auxiliaries.map(length), ...this.enemies.map(length));
      const speed = ['boss-entry', 'boss', 'boss-celebrate'].includes(this.phase) ? sampledSpeed : Math.min(this.maxPhysicsSpeed, sampledSpeed);
      let h = Math.min(remaining, speed > 0 ? this.unit * .5 / speed : remaining);
      // Attraction can accelerate a resting enemy, which sampledSpeed cannot
      // predict. Bound those integrations so long frames cannot skip collisions.
      if (this.phase === 'battle' && this.buffs.gravity) h = Math.min(h, 1 / 120);
      if (this.mode !== 'campaign' && ['battle', 'clearing', 'boss-entry', 'boss'].includes(this.phase)) h = Math.min(h, 1 / 120);
      if (this.phase === 'boss-celebrate' && this.phaseTime < BOSS_TIMING.brake) h = Math.min(h, 1 / 120, BOSS_TIMING.brake - this.phaseTime);
      if (this.bossControl && speed > 0 && this.arenaBlend > .9) {
        const biggest = Math.max(this.player.r, ...this.auxiliaries.map(b => b.r));
        const corridor = this.arenaGeometry.r - this.bossRadius - 2 * biggest;
        h = Math.min(h, Math.max(this.unit * .025, corridor * .4) / speed);
      }
      if (this.phase === 'boss-celebrate' && this.bossVictorySlowTime > 1e-10) h = Math.min(h, this.bossVictorySlowTime * timeScale);
      this.advance(h, dragging, timeScale);
      remaining -= h;
    }
  }

  advance(dt, dragging, timeScale = 1) {
    this.time += dt; this.phaseTime += dt;
    if (this.combatActive) this.elapsed += dt / timeScale;
    // dt is already scaled by the scene. Feedback holds and corpse snapshots
    // use active real time so slow aiming never lengthens a contact freeze.
    this.feedbackTime += dt / timeScale;
    this.shotHistory = this.shotHistory.filter(shot => this.feedbackTime - shot.time <= 20);
    this.pulseCooldown -= dt;
    const p = this.player;
    if (this.mode !== 'campaign' && this.phase === 'battle' && (this.pendingClearing || this.stageKills >= this.killTarget)) this.beginClearing();
    if (this.phase === 'clearing') { this.advanceClearing(dt, timeScale); return; }
    if (this.phase === 'boss-celebrate' && this.bossVictorySlowTime > 1e-10) {
      this.advanceVictorySlow(dt, timeScale); return;
    }
    if (['boss-entry', 'boss'].includes(this.phase)) { this.advanceBoss(dt, dragging, timeScale); return; }
    // Finish the last local hold before reward placement or the existing crown.
    if (['transition', 'boss-celebrate'].includes(this.phase)) {
      const motionDt = this.feedbackStep(p, dt, timeScale);
      if (this.boss) this.feedbackStep(this.boss, dt, timeScale);
      this.phaseTime -= dt - motionDt; dt = motionDt;
      if (dt <= 1e-10) return;
    }
    if (this.phase === 'boss-celebrate') { this.advanceBossCelebration(dt); return; }
    if (this.phase === 'transition') {
      this.arenaBlend = this.arenaRestoreFrom * (1 - smooth(this.phaseTime / BOSS_TIMING.entry));
      const t = ease(this.phaseTime / 1.45);
      p.x = lerp(this.rollFrom.x, this.width * .5, t);
      p.y = lerp(this.rollFrom.y, this.choicePlayerY ?? this.height * .75, t);
      const bounds = this.arenaBounds;
      this.clampBodyToArena(p);
      p.spin += dt * 4;
      p.angle = .4; p.squash = Math.sin(this.phaseTime * 10) * .12 * (1 - t);
      for (const c of this.choices) c.born = clamp((this.phaseTime - .25) / 1.5, 0, 1);
      if (this.phaseTime >= 1.85) { this.arenaBlend = 0; this.phase = 'choose'; this.phaseTime = 0; this.emit('choiceReady'); }
      return;
    }
    if (this.phase === 'reward' && this.phaseTime + 1e-10 >= 1) {
      this.finishRewardRound();
      if (this.phase !== 'battle') return;
    }
    if (this.phase === 'battle') {
      if (this.mode !== 'campaign') { this.flushFragments(); this.advanceSpawning(dt); }
      else {
      // Split the last partial slow frame, rather than losing or extending it.
      const slowed = Math.min(dt, this.breathTime);
      this.spawnTimer -= dt - slowed * .5;
      this.breathTime = Math.max(0, this.breathTime - dt);
      if (this.spawnTimer <= 0) {
        this.spawnEnemy();
        this.spawnTimer = this.spawnInterval;
      }
      }
    }
    this.advanceBodies(dt, dragging, timeScale);
  }

  advanceBodies(dt, dragging, timeScale = 1) {
    const p = this.player;
    const bodies = [p, ...this.auxiliaries, ...this.enemies], activeTimes = new Map();
    for (const b of bodies) {
      const bodyDt = this.feedbackStep(b, dt, timeScale);
      activeTimes.set(b.id, bodyDt);
      if (bodyDt <= 1e-10 || b.hp <= 0) continue;
      this.advanceBoomerang(b, bodyDt);
      if (b.isAuxiliary) b.slowAge = length(b) < this.unit * 3 ? (b.slowAge || 0) + bodyDt : 0;
      if (!b.isPlayer) { b.born = Math.min(1, b.born + bodyDt / .8); b.solid = b.born >= 1; }
      const drag = b.isPlayer ? (this.bossControl ? .04 : this.continuousControl ? (length(b) > this.unit * 8 ? .35 : 1.2) : dragging ? 10 : .60) : this.mode !== 'campaign' ? b.drag || 1.20 : 1.20;
      const friction = b.isPlayer && this.continuousControl && !this.bossControl ? this.playerFriction(bodyDt, b) : Math.exp(-drag * bodyDt);
      b.vx *= friction; b.vy *= friction;
      const attraction = b.isPlayer ? this.magnetAcceleration(b) : this.gravityAcceleration(b);
      if (attraction) {
        // Exact damped velocity increment for a constant force during this
        // substep. Strength is independent of distance, mass and frame rate.
        const impulseTime = -Math.expm1(-drag * bodyDt) / drag;
        b.vx += attraction.x * impulseTime; b.vy += attraction.y * impulseTime;
      }
      // Include the full capture allowance; fast frames are subdivided by step().
      const speed = length(b), cap = this.maxPhysicsSpeed;
      if (speed > cap && !(b.isPlayer && ['boss-entry', 'boss'].includes(this.phase))) { b.vx *= cap / speed; b.vy *= cap / speed; }
      if (!attraction && length(b) < 2) b.vx = b.vy = 0;
      this.normalizeWalker(b);
      b.x += b.vx * bodyDt; b.y += b.vy * bodyDt;
      const drift = this.leaderDrift(b);
      if (drift) { b.x += drift.x * bodyDt; b.y += drift.y * bodyDt; }
      b.spin += b.vx * bodyDt / Math.max(1, b.r);
      b.hit = Math.max(0, b.hit - bodyDt * 5);
      b.squash *= Math.exp(-bodyDt * 13);
      this.wall(b);
      if (['clearing', 'boss-celebrate', 'over'].includes(this.phase)) return;
      this.normalizeWalker(b);
    }
    this.advanceMagnetPull(dt, activeTimes);
    // Growing enemies displace one another, but remain transparent to the player.
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      if (a.hp <= 0) continue;
      if (a.solid) {
        for (const actor of [p, ...this.auxiliaries]) {
          if (a.hp <= 0) break;
          this.collide(actor, a);
          if (['clearing', 'boss-celebrate', 'over'].includes(this.phase)) return;
        }
      }
      if (['clearing', 'transition', 'boss-celebrate', 'over'].includes(this.phase)) return;
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        if (b.hp > 0) this.collide(a, b, !a.solid || !b.solid);
      }
    }
    if (this.boss?.solid && ['boss-entry', 'boss'].includes(this.phase)) {
      for (const actor of [p, ...this.auxiliaries]) this.collideBoss(actor);
      if (this.phase === 'boss-celebrate') return;
      for (const enemy of this.enemies) this.collideBoss(enemy);
    }
    for (const b of bodies) this.clampBodyToArena(b);
    if (this.boss?.solid && ['boss-entry', 'boss'].includes(this.phase)) for (const body of bodies) this.separateBossPlayer(body);
    this.enemies = this.enemies.filter(b => b.hp > 0);
    this.auxiliaries = this.auxiliaries.filter(b => (b.slowAge || 0) + 1e-10 < .4);
    if (this.phase === 'choose') {
      for (const c of this.choices) {
        if (Math.hypot(p.x - c.x, p.y - c.y) < p.r + c.r) { this.choose(c); break; }
      }
    }
    if (this.combatActive && this.mode !== 'campaign') this.advancePressure(dt / timeScale);
    else if (this.phase === 'battle' && this.enemies.length >= this.limit) {
      this.cancelPull();this.phase = 'over'; this.emit('over');
    }
  }
}
