import {World, clamp, length} from './physics.js';
import {campaignBounds} from './campaign-layout.js';
export {campaignBounds} from './campaign-layout.js';
import {UPGRADES} from './upgrades.js';
import {LegacyCampaignWorld, legacyLevelConfig} from './classes/legacy.js';
import {wallParams, createWallRules} from './classes/wall.js';
import {peggleParams, createPeggleRules} from './classes/peggle.js';
import {poolParams, createPoolRules} from './classes/pool.js';
import {golfParams, createGolfRules} from './classes/golf.js';
import {mergeParams, createMergeRules} from './classes/merge.js';
import {staticContact, dynamicContact, resolveStatic, resolveDynamic, zoneContains, sweptZoneEntry} from './campaign-collision.js';
export {normalizeProgress} from './campaign-progress.js';
export {LegacyCampaignWorld, legacyLevelConfig};

export const LEVEL_COUNT = 100;
const levelNumber = v => clamp(Math.floor(Number.isFinite(Number(v)) ? Number(v) : 1), 1, LEVEL_COUNT);
// r remains the renderer's historic mode identifier. digit is the actual
// level suffix; rank20 is the strictly ordered challenge within one mode.
const classes = [
  ['wall', '破墙', 7, 1], ['pool', '落袋', 8, 4], ['merge', '合成', 11, 5],
  ['golf', '推杆', 8, 8], ['peggle', '钉板狂热', 7, 0],
];
const registry = {wall: [wallParams, createWallRules], peggle: [peggleParams, createPeggleRules],
  pool: [poolParams, createPoolRules], golf: [golfParams, createGolfRules], merge: [mergeParams, createMergeRules]};
export function levelConfig(level) {
  const n = levelNumber(level), digit = n % 10, k = Math.floor((n - 1) / 10), variant = (n - 1) % 2;
  const [classId, name, task, r] = classes[Math.floor(((n - 1) % 10) / 2)];
  const rank20 = k * 2 + variant, params = registry[classId][0](k, variant);
  return Object.freeze({...params, level: n, digit, r, k, variant, rank20, classId, type: classId,
    name, task, implemented: true, legacy: false, difficult: rank20 >= 12});
}
export function progressPercent(value, total) {
  return Number.isFinite(total) && total > 0 ? Math.round(clamp((Number(value) || 0) / total, 0, 1) * 100) : 0;
}
export const CAMPAIGN_UPGRADES = Object.freeze({
  ...UPGRADES,
  steady: Object.freeze({id: 'steady', name: '稳手', type: 'regular', icon: 'triangle', short: '满拉时向目标微调，最多两度', maxStacks: 1}),
});
export function campaignUpgradePool(level) {
  const c = levelConfig(level); if (!c.implemented) return [];
  const precision = ['pool', 'golf', 'bowling'].includes(c.type);
  const ids = c.type === 'wall' ? ['rubber', 'energy', 'bank', 'density'] : c.task === 11 ? ['gravity', 'density', 'growth', 'pulse'] : c.task === 10 ? ['split', 'energy', 'breath', 'pulse'] : precision ? ['density', 'rubber', 'bank', 'steady'] : ['rubber', 'energy', 'bank', 'pierce'];
  const descriptions = {
    density: '提高重量，撞球更有力', rubber: '碰撞回弹由九成五提高到全速',
    bank: precision || c.type === 'pinball' ? '碰墙蓄力，强化下一次碰撞' : c.type === 'peggle' ? '碰墙后下一钉回弹更快' : '碰墙后下一砖伤害更高',
    energy: '提高弹射能量', pierce: '穿过目标并保留九成二速度', steady: '满拉时向目标微调，最多两度',
    split: '每发首杀分出两颗子球', breath: '击碎后暂缓新目标出现', pulse: c.type === 'merge' ? '重击推开附近目标' : '重击震伤附近目标',
    gravity: '吸引附近目标', growth: '球体增大两成，重量不变',
  };
  return ids.map(id => ({...CAMPAIGN_UPGRADES[id], short: descriptions[id]}));
}
export function campaignUpgradeChoices(level, random = Math.random) {
  const pool = campaignUpgradePool(level); if (!pool.length) return [];
  const take = () => pool.splice(clamp(Math.floor(random() * pool.length), 0, pool.length - 1), 1)[0];
  return [take(), take()];
}

export class CampaignWorld extends World {
  constructor(width, height, level = 1, random = Math.random, options = {}) {
    super(width, height, random, {spawnInitial: false});
    const config = levelConfig(level);
    if (!config.implemented) {
      const legacy = new LegacyCampaignWorld(width, height, config.level, random);
      legacy.config = Object.freeze({...legacy.config, ...config}); return legacy;
    }
    this.mode = 'campaign'; this.config = config; this.level = config.level; this.legacy = false;
    this.target = Infinity; this.completed = false; this.kills = 0; this.totalEnemies = 0; this.spawned = 0; this.spawnTimer = Infinity;
    this.statics = []; this.zones = []; this.contacts = new Set(); this.zoneContacts = new Set(); this.shotZones = new Set();
    this.blockedZoneEntries = new Set();
    this.blockedStaticEntries = new Set();
    this.blockedDynamicPairs = new Set();
    this.shotsUsed = 0; this.budget = config.budget; this.remaining = this.budget;
    this.shotActive = false; this.shotTime = 0; this.shotSlowTime = 0; this.shotFinish = null;
    this.freeBalls = 0; this.tutorialLookTime = 0; this.tutorialSeen = options.showTutorial === false || !!options.tutorialSeen; this.celebration = null; this._resultRating = 0;
    this.lastContact = null; this.peakOrigin = null; this.upgradeId = null;
    this.pendingLaunchEnd = null; this.transientSlow = null; this.lastAimAdjustment = 0;
    this.player.born = 1; this.player.solid = true;
    // Mode-specific colliders are set before layout/teaching is calculated.
    // World and its endless sizing remain untouched.
    const radiusRatio = clamp(config.playerRadius ?? 1, .25, 1.2);
    this.player.r = this.unit * radiusRatio;
    this.player.mass = this.player.density * radiusRatio * radiusRatio;
    this.rules = registry[config.type][1](this);
    this.rules.setup(config.k);
    if (config.task !== 11) this.remaining = this.budget;
    this.applyCampaignUpgrade(options.upgradeId);
  }
  get arenaBounds() { return this.mode === 'campaign' ? this.rules?.arenaBounds?.() || campaignBounds(this) : super.arenaBounds; }
  get ready() {
    const resourceAvailable = this.config?.budgetKind === 'misses' ? this.remaining >= 0 : this.remaining > 0;
    return this.phase === 'battle' && !this.shotActive && resourceAvailable && this.rules?.canLaunch?.() !== false;
  }
  get campaignActors() { return [this.player, ...this.auxiliaries]; }
  get campaignBodies() { return [...this.campaignActors, ...this.enemies]; }
  isCampaignActor(body) { return body === this.player || !!body.isAuxiliary; }
  get continuousControl() { return false; }
  get baseSpeed() { return this.unit * (this.config?.launchSpeed || 40); }
  get combatActive() { return this.phase === 'battle'; }
  get spawnInterval() { return Infinity; }
  spawnEnemy() { return null; }
  get tutorialVisible() { return !this.tutorialSeen && this.shotsUsed === 0 && this.phase === 'battle'; }
  get tutorialPullRatio() {
    const hint = this.rules.tutorialPullRatio;
    return clamp(Number(typeof hint === 'function' ? hint() : hint) || 1, .05, 1);
  }
  get ratingStatus() {
    const status = this.rules.ratingStatus?.() || {};
    return {rating: clamp(Math.floor(status.rating || this.resultRating || 1), 1, 3),
      summary: status.summary || this.resultSummary, three: status.three || '', two: status.two || ''};
  }
  get liveRating() { return this.ratingStatus.rating; }
  get teachingTarget() {
    const target = typeof this.rules.tutorialTarget === 'function' ? this.rules.tutorialTarget() : this.rules.tutorialTarget;
    return target || this.statics.find(s => s.active !== false && !s.dead && (this.config.r === 1 || s.target));
  }
  get presentationTimeScale() {
    if (this.feedbackOptions.reducedMotion || !this.feedbackOptions.strength) return 1;
    const peak = this.celebration && this.celebration.elapsed < this.celebration.duration ? this.celebration.scale : 1;
    const transient = this.transientSlow?.remaining > 0 ? this.transientSlow.scale : 1;
    const scale = Math.min(peak, transient);
    return 1 - (1 - scale) * this.feedbackOptions.strength;
  }
  beginCampaignSlow({duration = .3, scale = .3, kind = this.config.type, ...origin} = {}) {
    if (this.phase !== 'battle' || !(duration > 0)) return false;
    this.transientSlow = {remaining: duration, duration, scale: clamp(scale, .05, 1), kind};
    this.emit('campaignSlow', {...origin, ...this.transientSlow}); return true;
  }
  get resultRating() { return this.completed ? this._resultRating || clamp(Math.floor(this.rules.rating()), 1, 3) : 0; }
  get resultSummary() { return this.rules.summary?.() || ''; }
  summary() { return this.resultSummary; }
  get percent() {
    if (this.completed) return 100;
    const p = typeof this.rules.progress === 'function' ? this.rules.progress() : this.rules.progress;
    if (Number.isFinite(p)) return Math.round(clamp(p, 0, 1) * 100);
    if (p && Number.isFinite(p.total)) return progressPercent(p.total - p.remaining, p.total);
    return 0;
  }
  applyCampaignUpgrade(id) {
    if (!campaignUpgradePool(this.level).some(offer => offer.id === id) || this.upgradeId || this.shotsUsed) return false;
    this.upgradeId = id; this.buffs[id] = 1; if (id === 'energy') this.energy = 1.3;
    if (id === 'density') { this.density *= 1.35; this.player.density *= 1.35; this.player.mass *= 1.35; }
    if (id === 'growth') this.player.r *= 1.2;
    this.rules.onUpgrade?.(id);
    return true;
  }
  addStatic(spec) {
    const body = {id: ++this.id, shape: 'circle', active: true, hp: Infinity, maxHp: spec.hp ?? Infinity,
      restitution: .95, born: 1, solid: true, hit: 0, vx: 0, vy: 0, squash: 0, angle: 0,
      r: spec.r ?? Math.min(spec.width || this.unit, spec.height || this.unit) / 2, ...spec};
    this.statics.push(body); return body;
  }
  addZone(spec) { const zone = {id: ++this.id, shape: 'circle', active: true, ...spec}; this.zones.push(zone); return zone; }
  awardCampaignPoints(value, data = {}) {
    value = Math.max(0, Math.round(Number(value) || 0)); this.score += value;
    this.emit('campaignPoints', {value, ...data}); return value;
  }
  grantFreeBall(zone) {
    if (!this.shotActive || this._freeBallShot === this.shotsUsed) return false;
    this._freeBallShot = this.shotsUsed; this.remaining++; this.freeBalls++;
    this.emit('campaignFreeBall', {x: zone.x, y: zone.y, remaining: this.remaining}); return true;
  }
  hitStatic(body, damage, contact = {}, {value = 10, remove = true} = {}) {
    if (body.active === false || body.dead || body.hp <= 0 || !(damage > 0)) return null;
    body.hp = Math.max(0, body.hp - damage);
    if (this.config.task >= 10 && body.hp <= 1e-9) body.hp = 0;
    body.hit = 1;
    const feedback = this.damageFeedback(body, damage, contact);
    // Static objects have their own renderer; a circular death ghost would be wrong.
    delete feedback.bodySnapshot;
    this.lastContact = {...contact, x: body.x, y: body.y};
    if (body.hp <= 0) { if (remove) body.dead = true; this.creditKill(body, contact, feedback, value); }
    else this.emit('hit', {x: body.x, y: body.y, r: body.r, power: contact.normalSpeed / this.baseSpeed, ...feedback});
    this.applyCampaignPulse(body, damage, contact);
    return feedback;
  }
  staticFeedback(body, contact = {}, {lethal = false, value = 0} = {}) {
    body.hit = 1; const feedback = this.impactFeedback(body, 1, contact);
    if (value) this.awardCampaignPoints(value);
    this.emit(lethal ? 'kill' : 'hit', {x: body.x, y: body.y, r: body.r, value, ...feedback}); return feedback;
  }
  creditKill(body, contact, feedback, value = 10) {
    this.kills++; this.totalKills++; this.shotKills++; this.maxCombo = Math.max(this.maxCombo, this.shotKills); this.score += value;
    this.rules.onKill?.(body, contact);
    this.emit('kill', {x: body.x, y: body.y, r: body.r, vx: body.vx || 0, vy: body.vy || 0, value, combo: this.shotKills, ...feedback});
    if (this.config.task === 10 && this.buffs.split && !this.shotSplitUsed && this.shotActive) this.spawnCampaignSplit(contact);
  }
  spawnCampaignSplit(contact = {}) {
    this.shotSplitUsed = true;
    if (this.config.task !== 10 || !this.shotActive || this.phase !== 'battle') return [];
    const source = contact.attacker || this.player, options = this.rules.splitOptions?.(contact) || {};
    const live = this.campaignActors.filter(body => body.active !== false && !body.captured && body.hp > 0).length;
    const pending = Math.max(0, Math.floor(options.pending || 0));
    const used = Math.max(0, Math.floor(options.used ?? live));
    const count = Math.min(2, Math.max(0, Math.floor(options.cap ?? 5) - used - pending));
    const vx = contact.impactVx ?? source.vx, vy = contact.impactVy ?? source.vy;
    const speed = Math.hypot(vx, vy) * .6, heading = Math.atan2(vy, vx), children = [];
    for (const offset of [-Math.PI / 9, Math.PI / 9].slice(0, count)) {
      const angle = heading + offset, child = this.makeBody(source.x, source.y, this.unit * (options.radius ?? .7), source.density || this.player.density);
      Object.assign(child, {isPlayer: true, isAuxiliary: true, campaignSplit: true, damageScale: .6,
        sourceMass: source.mass, hp: Infinity, maxHp: Infinity, active: true, born: 1, solid: true,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, angle,
        feedbackFreeze: source.feedbackFreeze || 0, feedbackFreezeTotal: source.feedbackFreezeTotal || 0});
      this.auxiliaries.push(child); children.push(child);
    }
    if (children.length) this.emit('playerSplit', {x: source.x, y: source.y, bodyIds: children.map(body => body.id), source: this.config.type});
    return children;
  }
  applyCampaignPulse(origin, damage, contact = {}) {
    if (!(this.config.task === 10 || this.config.type === 'chain') || !this.shotActive || this.phase !== 'battle' || !this.buffs.pulse ||
      contact.source === 'pulse' || !(contact.normalSpeed > this.unit * 9) || this.pulseCooldown > 1e-10) return false;
    this.pulseCooldown = .65;
    this.emit('pulse', {x: origin.x, y: origin.y, r: this.unit * 4});
    for (const target of this.statics) {
      if (target === origin || target.active === false || target.dead || target.hp <= 0 || !Number.isFinite(target.hp)) continue;
      if (this.config.type === 'chain' && target.kind !== 'chain-ball') continue;
      const dx = target.x - origin.x, dy = target.y - origin.y, distance = Math.hypot(dx, dy);
      if (distance >= this.unit * 4) continue;
      const nx = distance > 1e-9 ? dx / distance : 1, ny = distance > 1e-9 ? dy / distance : 0;
      this.rules.onPulseTarget?.(target, {nx, ny, speed: this.unit * 4, origin});
      this.hitStatic(target, damage * .3, {...contact, source: 'pulse', nx, ny,
        contactX: target.x - nx * target.r, contactY: target.y - ny * target.r}, {value: target.value ?? 10});
    }
    return true;
  }
  damage(body, damage, contact = {}) {
    if (this.phase !== 'battle' || !this.shotActive || body.hp <= 0 || !(damage > 0) || !Number.isFinite(damage)) return;
    body.hp -= damage; body.hit = 1; const feedback = this.damageFeedback(body, damage, contact);
    if (body.hp <= 0) this.creditKill(body, contact, feedback, body.value || 10); return feedback;
  }
  adjustedLaunch(dx, dy) {
    const distance = Math.hypot(dx, dy); this.lastAimAdjustment = 0;
    if (!this.buffs.steady || distance < this.maxPull - 1e-8) return {dx, dy};
    const targets = this.rules.aimTargets?.() || [this.rules.aimTarget?.() || this.teachingTarget].filter(Boolean);
    const heading = Math.atan2(-dy, -dx), cap = Math.PI / 90;
    let correction = null;
    for (const target of targets) {
      if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) continue;
      const angle = Math.atan2(target.y - this.player.y, target.x - this.player.x);
      const delta = Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading));
      if (Math.abs(delta) <= cap + 1e-10 && (correction === null || Math.abs(delta) < Math.abs(correction))) correction = delta;
    }
    if (correction === null) return {dx, dy};
    this.lastAimAdjustment = clamp(correction, -cap, cap);
    return {dx: -Math.cos(heading + this.lastAimAdjustment) * distance, dy: -Math.sin(heading + this.lastAimAdjustment) * distance};
  }
  shoot(dx, dy) {
    const adjusted = this.ready ? this.adjustedLaunch(dx, dy) : {dx, dy};
    if (!super.shoot(adjusted.dx, adjusted.dy)) return false;
    this.shotsUsed++; this.totalShots++;
    if (!['lives', 'misses', 'pressure', 'time'].includes(this.config.budgetKind)) this.remaining--;
    this.shotActive = true;
    this.pendingLaunchEnd = null; this.shotFinish = null; this.shotTime = this.shotSlowTime = 0; this.shotKills = 0; this.shotBanked = false; this.shotWallCount = 0;
    this.shotZones.clear(); this.zoneContacts.clear(); this.contacts.clear();
    this.shotSplitUsed = false;
    const vx = this.player.vx + (this.player.pendingVx || 0), vy = this.player.vy + (this.player.pendingVy || 0);
    this.rules.onLaunch?.({vx, vy, speed: Math.hypot(vx, vy), dx: adjusted.dx, dy: adjusted.dy, actor: this.player});
    this.emit('campaignLaunch', {shotsUsed: this.shotsUsed, remaining: this.remaining}); return true;
  }
  requestLaunchEnd(options = {}) { if (this.shotActive) this.pendingLaunchEnd = options; }
  endLaunch({victory = false, reason = 'settled'} = {}) {
    if (!this.shotActive) return false;
    const preserveMotion = this.rules.preserveLaunchMotion?.({victory, reason}) === true;
    this.shotActive = false; this.pendingLaunchEnd = null; this.shotFinish = null; this.cancelPull(); this.player.pendingVx = this.player.pendingVy = 0;
    if (!preserveMotion) {
      this.player.vx = this.player.vy = 0;
      for (const body of this.auxiliaries) body.vx = body.vy = 0;
      if (this.rules.physics?.settleAll) for (const body of this.enemies) body.vx = body.vy = 0;
    }
    this.rules.onLaunchEnd?.({victory, reason}); this.contacts.clear(); this.zoneContacts.clear();
    this.emit('campaignLaunchEnd', {shotsUsed: this.shotsUsed, remaining: this.remaining, victory, reason});
    if (!victory && !preserveMotion) this.releaseOverlaps(); return true;
  }
  launchMovingBodies() {
    const bodies = this.rules.physics?.settleAll ? this.campaignBodies : this.campaignActors;
    return bodies.filter(body => !body.captured && body.active !== false && body.hp > 0);
  }
  advanceLaunchBrake(dt) {
    const finish = this.shotFinish;
    if (!this.shotActive || !finish || this.shotTime < finish.brakeAt - 1e-9) return;
    const remaining = Math.max(0, finish.duration - (this.shotTime - finish.brakeAt));
    // Multiplicative ratios of the remaining time give a linear envelope at
    // every physics step, while collisions may still redirect the velocity.
    const ratio = remaining > 1e-9 ? Math.max(0, remaining - dt) / remaining : 0;
    for (const body of this.launchMovingBodies()) { body.vx *= ratio; body.vy *= ratio; }
  }
  launchDeadlineReached(settled) {
    const specialDuration = this.rules.physics?.shotDuration;
    if (Number.isFinite(specialDuration)) return this.shotTime >= specialDuration - 1e-9;
    if (this.shotTime >= 4 - 1e-9 && !this.shotFinish) {
      const speed = Math.max(0, ...this.launchMovingBodies().map(length));
      this.shotFinish = {brakeAt: 4 + (speed > 6 * this.unit ? 1 : 0), duration: .3};
    }
    if (this.shotFinish) {
      if (this.shotTime >= this.shotFinish.brakeAt - 1e-9)
        return this.shotTime >= this.shotFinish.brakeAt + this.shotFinish.duration - 1e-9;
      // A high-speed extension may end naturally if the balls settle sooner.
      if (settled && this.shotSlowTime >= (this.rules.physics?.settleDelay ?? .4) - 1e-9) return true;
    }
    return false;
  }
  launchEndReason() {
    return this.shotFinish && this.shotTime >= this.shotFinish.brakeAt + this.shotFinish.duration - 1e-9 ? 'timeout' : 'settled';
  }
  releaseOverlaps(body = this.player, {rotation = false} = {}) {
    if (body.captured || body.active === false || body.hp <= 0 || this.rules.canSeparateBody?.(body) === false) return;
    const original = {x: body.x, y: body.y};
    for (let pass = 0; pass < 12; pass++) {
      let moved = false;
      for (const shape of this.statics) {
        const hit = staticContact(body, shape); if (!hit || hit.depth < 1e-5) continue;
        if (rotation) this.blockedStaticEntries.add(`${body.id}:${shape.id}`);
        body.x += hit.nx * (hit.depth + .001); body.y += hit.ny * (hit.depth + .001); moved = true;
      }
      this.clampBodyToArena(body); if (!moved) break;
    }
    if (!rotation || !this.statics.some(shape => (staticContact(body, shape)?.depth || 0) > 1e-5)) return;
    // A rotated bumper can trap a ball against the frame: normal projection
    // alone then oscillates between the bumper and the boundary. Search only
    // this resize path for the nearest local legal centre, keeping the radius.
    const bounds = this.arenaBounds;
    for (let ring = 1; ring <= 48; ring++) {
      const radius = ring * this.unit / 4;
      let best = null, bestDistance = Infinity;
      for (let direction = 0; direction < 64; direction++) {
        const angle = direction * Math.PI / 32;
        const candidate = {...body,
          x: clamp(original.x + Math.cos(angle) * radius, bounds.left + body.r, bounds.right - body.r),
          y: clamp(original.y + Math.sin(angle) * radius, bounds.top + body.r, bounds.bottom - body.r)};
        if (this.statics.some(shape => (staticContact(candidate, shape)?.depth || 0) > 1e-5)) continue;
        const distance = Math.hypot(candidate.x - original.x, candidate.y - original.y);
        if (distance < bestDistance) { bestDistance = distance; best = candidate; }
      }
      if (best) { body.x = best.x; body.y = best.y; return; }
    }
  }
  beginCampaignPeak(origin = this.peakOrigin || this.lastContact || this.player, options = {}) {
    if (this.celebration || this.phase === 'over') return false;
    const peggle = this.config.r === 0, velocity = {vx: this.player.vx, vy: this.player.vy};
    this.endLaunch({victory: true}); Object.assign(this.player, velocity); this.completed = true;
    this._resultRating = clamp(Math.floor(this.rules.rating()), 1, 3);
    this.phase = 'campaign-celebrate'; this.phaseTime = 0; this.cancelPull();
    const classOptions = this.rules.peakOptions?.() || {};
    this.transientSlow = null;
    this.celebration = {kind: this.config.type, elapsed: 0, duration: peggle ? 1.2 : .95,
      scale: peggle ? .25 : .3, zoom: peggle ? .06 : .04, bonusElapsed: 0,
      bonusRemaining: peggle ? this.remaining : 0, originalRemaining: this.remaining, ...classOptions, ...options};
    this.emit('campaignPeak', {x: origin.x, y: origin.y, ...this.celebration}); return true;
  }
  finishCampaign(won) {
    if (this.phase === 'over') return false;
    this.completed = !!won; this.cancelPull(); this.phase = 'over';
    if (!won) {
      const ruleReason = typeof this.rules.failureReason === 'function' ? this.rules.failureReason() : this.rules.failureReason;
      this.failureReason = ruleReason || (this.config.type === 'merge' ? 'coverage' : 'budget');
      this.emit('campaignFail', {reason: this.failureReason, level: this.level});
    }
    this.emit('over', {completed: this.completed, level: this.level, kills: this.kills, totalEnemies: this.totalEnemies,
      rating: this.resultRating, summary: this.resultSummary, shotsUsed: this.shotsUsed, remaining: this.remaining,
      elapsed: this.elapsed, score: this.score, reason: this.failureReason || null}); return true;
  }
  checkOutcome() {
    if (this.phase !== 'battle') return;
    if (this.rules.isWon()) { this.beginCampaignPeak(); return; }
    if (this.rules.isLost?.() || !this.rules.managesBudget && !this.shotActive && this.remaining <= 0) this.finishCampaign(false);
  }
  wall(body) {
    const before = {vx: body.vx, vy: body.vy}; super.wall(body);
    if (this.isCampaignActor(body) && this.shotActive && (before.vx !== body.vx || before.vy !== body.vy)) {
      this.shotBanked = true; this.shotWallCount++;
      const restitution = this.rules.physics?.wallRestitution ?? (this.buffs.rubber ? 1 : .95);
      if (before.vx * body.vx < 0) body.vx *= restitution / .92;
      if (before.vy * body.vy < 0) body.vy *= restitution / .92;
    } else if (this.rules.physics?.nonlethal && !this.isCampaignActor(body)) {
      if (before.vx * body.vx < 0) body.vx *= .95 / .92;
      if (before.vy * body.vy < 0) body.vy *= .95 / .92;
    }
  }
  processZones(body, previous, currentZones, {sweep = true} = {}) {
    if (body.hp <= 0 || body.active === false || body.captured || this.isCampaignActor(body) && !this.shotActive) return;
    for (const zone of this.zones) {
      const key = `${body.id}:${zone.id}`, inside = zoneContains(body, zone);
      if (inside) currentZones.add(key);
      if (this.blockedZoneEntries.has(key)) {
        // Rotation can place a body inside a newly laid-out pocket/hole. That
        // is not a physical entry. Keep even continuous zones blocked until a
        // real exit, and skip the departure sweep so exiting cannot capture it.
        const geometricInside = zoneContains(body, Number.isFinite(zone.maxSpeed) ? {...zone, maxSpeed: undefined} : zone);
        if (!geometricInside) this.blockedZoneEntries.delete(key);
        continue;
      }
      if (this._acceptedZoneChecks?.has(key) || zone.oncePerShot && this.shotZones.has(key)) continue;
      const entered = zone.continuous && inside || !this.zoneContacts.has(key) && (inside || sweep && sweptZoneEntry(body, previous, zone));
      if (!entered) continue;
      const accepted = this.rules.onZone?.(body, zone, {previous, impactVx: body.vx, impactVy: body.vy});
      if (accepted !== false) { this.shotZones.add(key); this._acceptedZoneChecks?.add(key); }
      if (body.hp <= 0 || body.active === false || body.captured || this.isCampaignActor(body) && !this.shotActive) break;
    }
  }
  collideCampaign(a, b) {
    if (!this.rules.physics?.nonlethal) { super.collide(a, b); return; }
    if (a.captured || b.captured || a.active === false || b.active === false || a.hp <= 0 || b.hp <= 0) return;
    const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
    const pairKey = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
    if (this.blockedDynamicPairs.has(pairKey) && distance > a.r + b.r + this.unit * .025) this.blockedDynamicPairs.delete(pairKey);
    const blocked = this.blockedDynamicPairs.has(pairKey);
    if (!blocked && this.rules.onDynamicTouch) {
      const touching = dynamicContact(a, b);
      if (touching && this.rules.onDynamicTouch(a, b, touching) === true) return;
    }
    const actor = this.isCampaignActor(a), bank = a.isAuxiliary ? a.bank || 0 : this.bank;
    if (actor && this.buffs.bank && bank > 0 && distance < a.r + b.r &&
      (a.vx - b.vx) * dx + (a.vy - b.vy) * dy > 0) {
      const boost = Math.sqrt(1 + .6 * bank); a.vx *= boost; a.vy *= boost;
      if (a.isAuxiliary) a.bank = 0; else this.bank = 0;
    }
    const restitution = (actor || this.isCampaignActor(b)) && this.buffs.rubber ? 1 : this.rules.physics.restitution ?? .95;
    const contact = resolveDynamic(a, b, {restitution}); if (!contact) return;
    a.squash = b.squash = Math.min(.3, contact.normalSpeed / this.baseSpeed * .42);
    a.angle = b.angle = Math.atan2(contact.ny, contact.nx);
    const feedbackHandled = blocked || this.rules.onDynamicHit?.(a, b, contact) === true;
    if (!feedbackHandled && actor && this.phase === 'battle' && contact.normalSpeed > this.unit * .8)
      this.emit('hit', {x: contact.contactX, y: contact.contactY, r: b.r, power: contact.normalSpeed / this.baseSpeed,
        ...this.impactFeedback(b, 0, contact), damage: 0, lethal: false});
  }
  step(dt, dragging = false, {timeScale = 1} = {}) {
    if (this.phase === 'over' || !(dt > 0) || !Number.isFinite(dt)) return;
    timeScale = Number.isFinite(timeScale) && timeScale > 0 ? timeScale : 1; this.stepSerial++;
    let remaining = dt;
    while (remaining > 1e-10 && this.phase !== 'over') {
      const speed = Math.max(...this.campaignBodies.map(length), ...this.statics.map(s => Math.hypot(s.vx || 0, s.vy || 0)));
      let h = Math.min(remaining, 1 / 120, speed > 0 ? this.unit * .18 / speed : Infinity);
      if (this.phase === 'battle' && this.shotActive && !Number.isFinite(this.rules.physics?.shotDuration)) {
        const next = this.shotFinish ? this.shotTime < this.shotFinish.brakeAt - 1e-9
          ? this.shotFinish.brakeAt : this.shotFinish.brakeAt + this.shotFinish.duration : 4;
        if (next - this.shotTime > 1e-9) h = Math.min(h, next - this.shotTime);
      }
      if (this.phase === 'battle' && this.config.task >= 10) {
        const boundary = this.rules.timeUntilBoundary?.();
        if (Number.isFinite(boundary) && boundary >= 0) h = Math.min(h, boundary);
        if (this.shotActive && Number.isFinite(this.rules.physics?.shotDuration))
          h = Math.min(h, Math.max(0, this.rules.physics.shotDuration - this.shotTime));
        if (h <= 1e-10) {
          this.rules.onAfterTick?.(0, {realDt: 0, timeScale}); this.checkOutcome();
          if (this.phase !== 'battle') continue;
          if (this.shotActive && this.shotTime >= this.rules.physics.shotDuration - 1e-9) { this.endLaunch(); this.checkOutcome(); continue; }
          break;
        }
      }
      this.advance(h, dragging, timeScale); remaining -= h;
    }
  }
  advance(dt, dragging = false, timeScale = 1) {
    const realDt = dt / timeScale;
    if (this.transientSlow) { this.transientSlow.remaining = Math.max(0, this.transientSlow.remaining - realDt); if (!this.transientSlow.remaining) this.transientSlow = null; }
    this.time += dt; this.feedbackTime += realDt; this.phaseTime += dt;
    if (this.phase === 'campaign-celebrate') {
      const c = this.celebration; c.elapsed += realDt;
      if (c.elapsed <= c.duration + 1e-9) this.advanceCelebrationMotion(dt, timeScale);
      for (const body of this.statics) {
        body.hit = Math.max(0, body.hit - dt * 5); body.squash *= Math.exp(-dt * 13); this.feedbackStep(body, dt, timeScale);
      }
      if (c.elapsed + 1e-9 < c.duration) return;
      if (c.bonusRemaining > 0) {
        c.bonusElapsed += realDt;
        while (c.bonusRemaining > 0 && c.bonusElapsed >= .12 - 1e-9) {
          c.bonusElapsed -= .12; c.bonusRemaining--; this.score += 10;
          this.emit('campaignBonus', {value: 10, remaining: c.bonusRemaining, index: c.originalRemaining - c.bonusRemaining,
            x: this.player.x, y: this.player.y});
        }
        if (c.bonusRemaining > 0) return;
      }
      this.finishCampaign(true); return;
    }
    if (this.phase !== 'battle') return;
    this.elapsed += realDt; this.tutorialLookTime += realDt;
    if (this.config.task >= 10) this.pulseCooldown = Math.max(0, this.pulseCooldown - dt);
    for (const zone of this.zones) { zone.previousX = zone.x; zone.previousY = zone.y; }
    const context = {realDt, timeScale};
    this.rules.onTick?.(dt, context);
    if (!this.shotActive && this.rules.intermissionMotion?.()) {
      this.advanceCampaignMotion(dt, timeScale, {silent: true});
      this.rules.onAfterTick?.(dt, context);
      this.checkOutcome(); return;
    }
    this.advanceLaunchBrake(dt);
    const currentContacts = new Set(), currentZones = new Set(), previousPositions = new Map();
    this._acceptedZoneChecks = new Set();
    for (const body of this.campaignBodies) {
      if (body.hp <= 0 || body.active === false || body.captured) continue;
      // A queued ball is born at this substep's endpoint; its motion and hold
      // clock begin with the following slice, not before the release time.
      if (this.config.task >= 10 && body.campaignReleasedAt >= this.time - 1e-10) continue;
      const bodyDt = this.feedbackStep(body, dt, timeScale);
      body.born = 1; body.solid = true; body.hit = Math.max(0, body.hit - 5 * bodyDt); body.squash *= Math.exp(-13 * bodyDt);
      const actor = this.isCampaignActor(body);
      if (!this.shotActive && (actor || this.rules.physics?.freezeTargetsIdle)) continue;
      const previous = {x: body.x, y: body.y}, drag = actor ? this.rules.physics?.actorDrag ?? this.rules.physics?.playerDrag ?? .6 : body.drag ?? 1.2;
      previousPositions.set(body.id, previous);
      const friction = Math.exp(-drag * bodyDt); body.vx *= friction; body.vy *= friction;
      const speed = length(body);
      if (speed > this.maxPhysicsSpeed) { body.vx *= this.maxPhysicsSpeed / speed; body.vy *= this.maxPhysicsSpeed / speed; }
      body.x += body.vx * bodyDt; body.y += body.vy * bodyDt; body.spin += body.vx * bodyDt / Math.max(1, body.r);
      this.processZones(body, previous, currentZones);
      if (body.active === false || body.captured || body.hp <= 0 || actor && !this.shotActive) continue;
      this.wall(body);
      for (const shape of this.statics) {
        if (shape.active === false || shape.dead) continue;
        const key = `${body.id}:${shape.id}`;
        if (this.blockedStaticEntries.has(key) && !staticContact(body, shape, this.unit * .025)) this.blockedStaticEntries.delete(key);
        const touching = staticContact(body, shape, .001); if (!touching) continue;
        currentContacts.add(key);
        const pierce = actor && !!this.buffs.pierce && shape.pierceable !== false && this.rules.canPierceStatic?.(shape, body) !== false;
        const restitution = actor && this.buffs.rubber ? Math.min(1, (shape.restitution ?? .95) + .06) : shape.restitution;
        const contact = resolveStatic(body, shape, {pierce, restitution});
        if (!contact || !actor || !this.shotActive || this.contacts.has(key) || this.blockedStaticEntries.has(key) || contact.normalSpeed < this.unit * .1) continue;
        if (pierce) { body.vx *= .92; body.vy *= .92; }
        this.lastContact = {...contact, x: shape.x, y: shape.y};
        if (shape.bankSurface) {
          this.shotBanked = true; this.shotWallCount++;
          if (this.buffs.bank) {
            if (body.isAuxiliary) body.bank = Math.min(2, (body.bank || 0) + 1); else this.bank = Math.min(2, this.bank + 1);
          }
          this.emit('wall', {x: contact.contactX, y: contact.contactY, ...contact, bodyId: body.id,
            power: contact.normalSpeed / this.baseSpeed, bank: body.isAuxiliary ? body.bank || 0 : this.bank, auxiliary: !!body.isAuxiliary});
        }
        (this.rules.onStaticHit || this.rules.onHit)?.call(this.rules, shape, contact, body);
        const bank = body.isAuxiliary ? body.bank || 0 : this.bank;
        if (!shape.bankSurface && (this.config.r === 0 || this.rules.physics?.nonlethal) && this.buffs.bank && bank > 0) {
          const boost = Math.sqrt(1 + .6 * bank); body.vx *= boost; body.vy *= boost;
          if (body.isAuxiliary) body.bank = 0; else this.bank = 0;
        }
        if (this.config.task < 10) { this.checkOutcome(); if (this.phase !== 'battle') return; }
      }
      this.clampBodyToArena(body);
    }
    this.contacts = currentContacts;
    let settledDeadline = false;
    if (this.shotActive) {
      const enemies = this.rules.physics?.idleDynamicRules ? this.enemies.slice() : this.enemies;
      for (const actor of this.campaignActors) if (actor.hp > 0 && actor.active !== false && !actor.captured)
        for (const enemy of enemies) if (enemy.hp > 0 && enemy.active !== false && !enemy.captured) this.collideCampaign(actor, enemy);
      for (let i = 0; i < enemies.length; i++) for (let j = i + 1; j < enemies.length; j++)
        if (enemies[i].hp > 0 && enemies[j].hp > 0) this.collideCampaign(enemies[i], enemies[j]);
      if (this.rules.physics?.nonlethal) for (const body of this.campaignBodies) {
        this.processZones(body, previousPositions.get(body.id) || body, currentZones, {sweep: false});
        if (!body.captured && body.hp > 0 && body.active !== false) this.wall(body);
      }
      if (this.rules.physics?.nonlethal) {
        this.separateDynamicBodies(12);
        for (const body of this.campaignBodies) this.processZones(body, previousPositions.get(body.id) || body, currentZones, {sweep: false});
      }
      this.enemies = this.enemies.filter(body => body.hp > 0 && body.active !== false && !body.captured);
      this.auxiliaries = this.auxiliaries.filter(body => body.hp > 0 && body.active !== false && !body.captured);
      this.shotTime += dt;
      const moving = this.launchMovingBodies();
      const settled = this.rules.isSettled?.() ?? moving.every(body => length(body) < this.unit * (this.rules.physics?.settleSpeed ?? 3));
      this.shotSlowTime = settled ? this.shotSlowTime + dt : 0;
      const timedOut = this.launchDeadlineReached(settled);
      const braking = this.shotFinish && this.shotTime >= this.shotFinish.brakeAt - 1e-9;
      settledDeadline = timedOut || !braking && settled && this.shotSlowTime >= (this.rules.physics?.settleDelay ?? .4) - 1e-9;
      if (this.config.task < 10) {
        this.checkOutcome(); if (this.phase !== 'battle') return;
        if (this.pendingLaunchEnd && (this.pendingLaunchEnd.immediate || !this.rules.physics?.settleAll || settledDeadline)) this.endLaunch(this.pendingLaunchEnd);
        else if (settledDeadline) this.endLaunch({reason: this.launchEndReason()});
      }
    }
    if (!this.shotActive && this.rules.physics?.nonlethal && !this.rules.physics.freezeTargetsIdle) this.resolveIdleDynamics();
    this.zoneContacts = currentZones;
    this.rules.onAfterTick?.(dt, context);
    if (this.config.task >= 10) {
      this.checkOutcome(); if (this.phase !== 'battle') return;
      if (this.pendingLaunchEnd && (this.pendingLaunchEnd.immediate || !this.rules.physics?.settleAll || settledDeadline)) this.endLaunch(this.pendingLaunchEnd);
      else if (this.shotActive && settledDeadline) this.endLaunch({reason: this.launchEndReason()});
    }
    this.checkOutcome();
  }
  separateDynamicBodies(passes = 16) {
    if (!this.rules.physics?.nonlethal) return;
    const bodies = this.campaignBodies.filter(body => body.hp > 0 && body.active !== false && !body.captured);
    const b = this.arenaBounds;
    const travel = (body, dx, dy) => Math.max(0, Math.min(
      dx > 1e-9 ? (b.right - body.r - body.x) / dx : dx < -1e-9 ? (b.left + body.r - body.x) / dx : Infinity,
      dy > 1e-9 ? (b.bottom - body.r - body.y) / dy : dy < -1e-9 ? (b.top + body.r - body.y) / dy : Infinity));
    for (const body of bodies) this.clampBodyToArena(body);
    for (let pass = 0; pass < passes; pass++) {
      let maximum = 0;
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], c = bodies[j], dx = c.x - a.x, dy = c.y - a.y, distance = Math.hypot(dx, dy);
        if (this.isCampaignActor(a) && this.isCampaignActor(c)) continue;
        const overlap = a.r + c.r - distance; if (overlap < 1e-6) continue;
        maximum = Math.max(maximum, overlap);
        const nx = distance > 1e-8 ? dx / distance : Math.cos(a.id + c.id), ny = distance > 1e-8 ? dy / distance : Math.sin(a.id + c.id);
        const capA = travel(a, -nx, -ny), capB = travel(c, nx, ny), invA = 1 / a.mass, invB = 1 / c.mass;
        let moveA = Math.min(capA, overlap * invA / (invA + invB));
        let moveB = Math.min(capB, overlap - moveA);
        moveA = Math.min(capA, overlap - moveB);
        a.x -= nx * moveA; a.y -= ny * moveA; c.x += nx * moveB; c.y += ny * moveB;
      }
      if (maximum < 1e-5) break;
    }
  }
  resolveIdleDynamics() {
    // A golfer can take time to aim. Roaming obstacles bounce off the parked
    // cue rather than walking through it or moving it without a paid stroke.
    const fixedPlayer = {shape: 'circle', x: this.player.x, y: this.player.y, r: this.player.r, restitution: .95};
    const bodies = this.enemies.filter(body => body.hp > 0 && body.active !== false && !body.captured);
    if (this.rules.physics?.idleDynamicRules) {
      // Natural merging uses the same contact hooks while the player aims.
      // Snapshot this generation so removed parents cannot merge twice, and
      // newly created children begin contact processing on the next substep.
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) this.collideCampaign(bodies[i], bodies[j]);
      for (const body of this.enemies) if (body.hp > 0 && body.active !== false && !body.captured) {
        resolveStatic(body, fixedPlayer); this.wall(body);
      }
      this.enemies = this.enemies.filter(body => body.hp > 0 && body.active !== false && !body.captured);
      return;
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++)
        resolveDynamic(bodies[i], bodies[j], {restitution: this.rules.physics.restitution ?? .95});
      for (const body of bodies) {
        resolveStatic(body, fixedPlayer); this.wall(body);
      }
    }
  }
  advanceCelebrationMotion(dt, timeScale) {
    // The last impact keeps moving through the real slowed simulation. No new
    // targets, launch budget, bucket rewards or damage are credited here.
    this.rules.onTick?.(dt, {realDt: dt / timeScale, timeScale});
    this.advanceCampaignMotion(dt, timeScale, {silent: this.rules.preserveLaunchMotion?.({victory: true}) === true});
  }
  advanceCampaignMotion(dt, timeScale, {silent = false} = {}) {
    const bodies = this.campaignBodies;
    for (const body of bodies) {
      if (body.captured || body.active === false || body.hp <= 0) continue;
      const bodyDt = this.feedbackStep(body, dt, timeScale);
      const friction = Math.exp(-(this.isCampaignActor(body) ? this.rules.physics?.actorDrag ?? this.rules.physics?.playerDrag ?? .6 : body.drag ?? 1.2) * bodyDt);
      body.vx *= friction; body.vy *= friction;
      body.x += body.vx * bodyDt; body.y += body.vy * bodyDt;
      body.spin += body.vx * bodyDt / Math.max(1, body.r);
      body.hit = Math.max(0, body.hit - 5 * bodyDt); body.squash *= Math.exp(-13 * bodyDt);
      if (silent) {
        const b = this.arenaBounds, restitution = this.isCampaignActor(body) && this.buffs.rubber ? 1 : .95;
        if (body.x < b.left + body.r && body.vx < 0 || body.x > b.right - body.r && body.vx > 0) body.vx *= -restitution;
        if (body.y < b.top + body.r && body.vy < 0 || body.y > b.bottom - body.r && body.vy > 0) body.vy *= -restitution;
        this.clampBodyToArena(body);
      } else this.wall(body);
      for (const shape of this.statics) if (shape.active !== false && !shape.dead)
        resolveStatic(body, shape, {restitution: shape.restitution ?? .95});
      this.clampBodyToArena(body);
    }
    if (silent) {
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j];
        if (this.isCampaignActor(a) && this.isCampaignActor(b)) continue;
        resolveDynamic(a, b, {restitution: (this.isCampaignActor(a) || this.isCampaignActor(b)) && this.buffs.rubber ? 1 : this.rules.physics?.restitution ?? .95});
      }
      this.separateDynamicBodies(12);
    } else for (const actor of this.campaignActors) if (!actor.captured && actor.active !== false)
      for (const enemy of this.enemies) if (enemy.hp > 0) this.collideCampaign(actor, enemy);
  }
  resize(width, height) {
    if (!this.rules) { super.resize(width, height); return; }
    const previous = {width: this.width, height: this.height, unit: this.unit, bounds: this.arenaBounds};
    const positions = new Map(this.campaignBodies.map(body => [body.id, {x: body.x, y: body.y}]));
    previous.positions = positions;
    super.resize(width, height);
    {
      const old = previous.bounds, now = this.arenaBounds;
      for (const body of this.campaignBodies) {
        const p = positions.get(body.id); if (!p) continue;
        body.x = clamp(now.left + (p.x - old.left) / old.width * now.width, now.left + body.r, now.right - body.r);
        body.y = clamp(now.top + (p.y - old.top) / old.height * now.height, now.top + body.r, now.bottom - body.r);
      }
    } this.contacts.clear(); this.zoneContacts.clear();
    if (this.rules.resize) this.rules.resize(previous);
    else {
      const sx = width / previous.width, sy = height / previous.height, sr = this.unit / previous.unit;
      for (const shape of [...this.statics, ...this.zones]) {
        shape.x *= sx; shape.y *= sy;
        for (const key of ['r', 'width', 'height', 'cornerRadius']) if (Number.isFinite(shape[key])) shape[key] *= sr;
      }
    }
    if (this.config.task >= 9) for (const actor of this.campaignActors) {
      if (actor.captured || actor.active === false || actor.hp <= 0) continue;
      // Moving the board during rotation is not a hit. Separate every ball,
      // including auxiliaries, then suppress that contact episode until the
      // ball has genuinely left it. Physical reflection still applies.
      for (const shape of this.statics) if (staticContact(actor, shape, .001)) this.blockedStaticEntries.add(`${actor.id}:${shape.id}`);
      this.releaseOverlaps(actor, {rotation: true});
    } else this.releaseOverlaps();
    const excludeDynamicContacts = () => {
      if (this.config.task !== 11) return;
      const bodies = this.campaignBodies.filter(body => body.hp > 0 && body.active !== false && !body.captured);
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) <= a.r + b.r + this.unit * .025)
          this.blockedDynamicPairs.add(a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`);
      }
    };
    excludeDynamicContacts(); this.separateDynamicBodies(80); excludeDynamicContacts();
    this.blockedZoneEntries.clear();
    if (this.config.task >= 8) for (const body of this.campaignBodies) {
      if (body.captured || body.active === false || body.hp <= 0) continue;
      for (const zone of this.zones)
        if (zoneContains(body, Number.isFinite(zone.maxSpeed) ? {...zone, maxSpeed: undefined} : zone))
          this.blockedZoneEntries.add(`${body.id}:${zone.id}`);
    }
  }
}
