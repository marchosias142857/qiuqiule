export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const length = b => Math.hypot(b.vx, b.vy);
export const ease = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const lerp = (a, b, t) => a + (b - a) * t;
export const PLAYER_BASE_DENSITY = 1.5;
export const BREATH_DURATION = 2;
export const BREATH_SPAWN_RATE = .5;
export const REGULAR_BUFF_STAGE_INTERVAL = 5;
export const REGULAR_BUFF_INTERVAL_BONUS = .15;
export const BLACK_HOLE_GRAVITY = Object.freeze({radius: 5, acceleration: 2.4});
export const BOSS_TIMING = Object.freeze({entry: .85, brake: .8, spin: .85, hold: 1, fade: .22});
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

// New ordinary upgrades gain 15 percentage points after each five completed
// stages. Existing stacks retain the value they had when they were collected.
export function regularBuffBonus(id, stage = 1) {
  if (id !== 'density' && id !== 'energy') return 0;
  const completed = Math.max(0, (Number.isFinite(stage) ? Math.floor(stage) : 1) - 1);
  const bands = Math.floor(completed / REGULAR_BUFF_STAGE_INTERVAL);
  return (id === 'density' ? .35 : .30) + bands * REGULAR_BUFF_INTERVAL_BONUS;
}

export function buffAtStage(buff, stage = 1) {
  if (buff.kind === 'special') return {...buff};
  const bonus = regularBuffBonus(buff.id, stage);
  const percent = Number((bonus * 100).toFixed(1));
  return {...buff, bonus, short: `${buff.id === 'density' ? '密度' : '弹射能量'} +${percent}%`};
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

export const BUFFS = [
  // Growth changes only geometry; mass and all launch/impact tuning stay independent.
  { id: 'density', kind: 'density', name: '重量级', short: '初始密度 +35%', detail: '质量更大，撞得更狠。同等能量下，出发稍慢。无尽模式每完成 5 个阶段，新获得的强化额外增加 15 个百分点，从第 6 阶段起首次提升；已获得的数值保持不变。', color: '#bbd968', sides: 3 },
  { id: 'energy', kind: 'energy', name: '弹性十足', short: '初始弹射能量 +30%', detail: '同样的拉伸，释放更多能量。无尽模式每完成 5 个阶段，新获得的强化额外增加 15 个百分点，从第 6 阶段起首次提升；已获得的数值保持不变。', color: '#ee967b', sides: 4 },
  { id: 'pierce', kind: 'special', name: '一往无前', short: '撞球不改方向', detail: '撞开敌球后保持原方向，仍然损失速度。', color: '#a4c9d8', sides: 5 },
  { id: 'pulse', kind: 'special', name: '连锁反应', short: '重击引发震荡', detail: '强力撞击时，震伤并推开附近的敌球。', color: '#b6ace0', sides: 5 },
  { id: 'bank', kind: 'special', name: '借墙发力', short: '碰墙后伤害 +60%', detail: '每次碰墙会强化下一次撞击，最多叠加 2 层。', color: '#e6c86c', sides: 5 },
  { id: 'growth', kind: 'special', name: '大一圈', short: '直径 1.2 倍 → 1.4 倍', detail: '仅扩大碰撞箱和显示尺寸，不改变质量、密度、速度或伤害公式。首次获得为原始直径的 1.2 倍，第二次为 1.4 倍。每局最多出现两次。', color: '#d5aa7c', sides: 5, maxOffers: 2, maxStacks: 2 },
  { id: 'breath', kind: 'special', name: '喘口气', short: '击破后 2 秒刷新速度减半', detail: '击杀后 2 秒内，敌球刷新计时以 50% 速度推进。连续击杀刷新持续时间，不叠加减速，也不会完全停刷。', color: '#96c9b1', sides: 5 },
  { id: 'gravity', kind: 'special', name: '黑洞引力', short: '持续吸引附近敌球', detail: '在基础球半径 5 倍的范围内，以恒定强度将敌球缓缓吸向自己。吸力不随距离增强，不影响正在出现的敌球或固定的 Boss。', color: '#9c95ca', sides: 5 },
];

export class World {
  constructor(width, height, random = Math.random, {spawnInitial = true} = {}) {
    this.random = random;
    this.width = width;
    this.height = height;
    this.unit = clamp(Math.min(width, height) * .047, 18, 34);
    this.inset = 16;
    this.time = 0;
    this.stage = 1;
    this.score = 0;
    this.target = 140;
    this.limit = 18;
    this.phase = 'battle';
    this.phaseTime = 0;
    this.spawnTimer = .45;
    this.breathTime = 0;
    this.pulseCooldown = 0;
    this.events = [];
    this.enemies = [];
    this.choices = [];
    this.boss = null;
    this.bossCelebration = null;
    this.arenaBlend = 0;
    this.arenaRestoreFrom = 0;
    this.buffs = {};
    this.buffOffers = {};
    this.id = 0;
    this.density = 1;
    this.energy = 1;
    this.bank = 0;
    this.pullStartSpeed = null;
    this.player = this.makeBody(width * .5, height * .62, this.unit, PLAYER_BASE_DENSITY);
    this.player.isPlayer = true;
    this.player.hp = Infinity;
    if (spawnInitial) {
      this.spawnEnemy();
      this.spawnEnemy();
    }
  }

  makeBody(x, y, r, density) {
    return {id: ++this.id, x, y, vx: 0, vy: 0, r, mass: density * (r / this.unit) ** 2,
      density, born: 0, solid: false, hp: 20, maxHp: 20, value: 10, hit: 0, squash: 0, angle: 0, spin: 0};
  }
  get arenaBounds() {
    const side = Math.min(this.width, this.height) - this.inset * 2;
    const blend = clamp(this.arenaBlend, 0, 1);
    const left = lerp(this.inset, (this.width - side) / 2, blend);
    const top = lerp(this.inset, (this.height - side) / 2, blend);
    const right = this.width - left, bottom = this.height - top;
    return {left, right, top, bottom, width: right - left, height: bottom - top};
  }
  get readySpeed() { return this.unit * (8 + 4 * Math.floor(Math.max(0, this.stage - 1) / 5) + (this.phase === 'boss' ? 12 : 0)); }
  get maxPhysicsSpeed() { return this.unit * 60 + this.readySpeed; }
  get ready() { return (this.phase === 'battle' || this.phase === 'choose' || this.phase === 'boss') && (this.pullStartSpeed !== null || length(this.player) < this.readySpeed); }
  beginPull() {
    if (!this.ready || this.pullStartSpeed !== null) return false;
    this.pullStartSpeed = length(this.player);
    return true;
  }
  cancelPull() { this.pullStartSpeed = null; }
  get maxPull() { return clamp(Math.min(this.width, this.height) * .25, 90, 170); }
  get baseSpeed() { return this.unit * 40; }
  get gravityRadius() { return this.unit * BLACK_HOLE_GRAVITY.radius; }
  gravityAcceleration(body) {
    if (this.phase !== 'battle' || !this.buffs.gravity || body.isPlayer || body.isBoss || !body.solid || body.hp <= 0) return null;
    const dx = this.player.x - body.x, dy = this.player.y - body.y, distance = Math.hypot(dx, dy);
    if (distance < 1e-6 || distance > this.gravityRadius) return null;
    const acceleration = this.unit * BLACK_HOLE_GRAVITY.acceleration;
    return {x: dx / distance * acceleration, y: dy / distance * acceleration};
  }
  get spawnInterval() { return Math.max(.52, 2.45 - (this.stage - 1) * .18 - this.time * .002); }
  enemyProfile() {
    return {
      radiusScale: .7 + this.random() * .38 + Math.min(this.stage - 1, 12) * .014,
      density: .65 + this.stage * .09 + this.time * .0007,
      hp: 19 + (this.stage - 1) * 6 + Math.floor(this.time / 45) * 2,
      value: 10 + Math.floor((this.stage - 1) / 3) * 5,
    };
  }
  emit(type, data = {}) { this.events.push({type, ...data}); }

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
    for (const body of [this.player, ...this.enemies]) {
      // Preserve ordinary resize behavior; the boss arena maps within its own
      // current bounds so rotating a square arena cannot squash its contents.
      const mapped = this.arenaBlend > 0 ? mapPoint(body, body.r * k) : {
        x: clamp(body.x * rx, body.r * k + this.inset, width - body.r * k - this.inset),
        y: clamp(body.y * ry, body.r * k + this.inset, height - body.r * k - this.inset)};
      body.x = mapped.x; body.y = mapped.y; body.r *= k; body.vx *= k; body.vy *= k;
    }
    this.layoutChoices();
    if (this.phase === 'transition') this.rollFrom = {x: this.player.x, y: this.player.y};
    if (this.boss) {
      const boss = this.boss;
      const inflationProgress = boss.r > boss.initialRadius ? (boss.r - boss.initialRadius) / (boss.maxRadius - boss.initialRadius) : 0;
      for (const key of ['r', 'initialRadius', 'minRadius', 'inflationRate']) boss[key] *= k;
      boss.maxRadius = (Math.min(width, height) - this.inset * 2) * .375;
      if (inflationProgress > 0) boss.r = lerp(boss.initialRadius, boss.maxRadius, clamp(inflationProgress, 0, 1));
      boss.thresholds = boss.thresholds.map(radius => radius * k);
      Object.assign(boss, this.bossAnchor());
      if (this.phase === 'boss-entry') {
        this.rollFrom = {x: this.rollFrom.x * rx, y: this.rollFrom.y * ry};
        this.positionBossEntry();
      } else if (this.phase === 'boss') this.separateBossPlayer();
      if (this.phase === 'boss-celebrate' && this.bossCelebration?.stop) {
        this.bossCelebration.stop = mapPoint(this.bossCelebration.stop, this.player.r);
        this.player.x = this.bossCelebration.stop.x; this.player.y = this.bossCelebration.stop.y;
      }
    }
  }

  spawnEnemy() {
    if (this.phase !== 'battle' || this.enemies.length >= this.limit) return;
    const profile = this.enemyProfile();
    const r = this.unit * profile.radiusScale;
    let x, y, best = -Infinity, pos;
    for (let n = 0; n < 24; n++) {
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
    b.vx = Math.cos(b.angle) * this.unit * .2;
    b.vy = Math.sin(b.angle) * this.unit * .2;
    this.enemies.push(b);
    this.emit('spawn', {x: b.x, y: b.y});
  }

  shoot(dx, dy) {
    const allowed = this.ready, carriedSpeed = this.pullStartSpeed ?? length(this.player);
    this.cancelPull();
    const distance = Math.hypot(dx, dy);
    if (!allowed || distance < 6) return false;
    const pull = clamp(distance / this.maxPull, 0, 1);
    // The established launch cap applies before adding the captured speed.
    const launchSpeed = Math.min(this.unit * 60, this.baseSpeed * pull * Math.sqrt(this.energy / this.density));
    const speed = launchSpeed + carriedSpeed;
    this.player.vx = -dx / distance * speed;
    this.player.vy = -dy / distance * speed;
    this.player.angle = Math.atan2(dy, dx);
    this.player.squash = -.33 * pull;
    this.emit('shoot', {power: pull});
    return true;
  }

  wall(b) {
    const bounds = this.arenaBounds;
    let nx = 0, ny = 0, speed = 0;
    if (b.x < bounds.left + b.r) { b.x = bounds.left + b.r; if (b.vx < 0) { speed = -b.vx; b.vx *= -.92; nx = -1; } }
    if (b.x > bounds.right - b.r) { b.x = bounds.right - b.r; if (b.vx > 0) { speed = b.vx; b.vx *= -.92; nx = 1; } }
    if (b.y < bounds.top + b.r) { b.y = bounds.top + b.r; if (b.vy < 0) { speed = Math.max(speed, -b.vy); b.vy *= -.92; ny = -1; } }
    if (b.y > bounds.bottom - b.r) { b.y = bounds.bottom - b.r; if (b.vy > 0) { speed = Math.max(speed, b.vy); b.vy *= -.92; ny = 1; } }
    if (speed > this.unit * .8) {
      b.squash = Math.min(.32, speed / this.baseSpeed * .4);
      b.angle = Math.atan2(ny, nx);
      if (b.isPlayer) {
        if (this.buffs.bank) this.bank = Math.min(2, this.bank + 1);
        this.emit('wall', {x: b.x + nx * b.r, y: b.y + ny * b.r, power: speed / this.baseSpeed});
      }
    }
  }

  collide(a, b, spawning = false) {
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
    const restitution = a.isPlayer ? .90 : .82;
    const impulse = (1 + restitution) * closing / totalInv;
    a.vx -= impulse * nx * invA; a.vy -= impulse * ny * invA;
    b.vx += impulse * nx * invB; b.vy += impulse * ny * invB;
    a.squash = b.squash = Math.min(.3, closing / this.baseSpeed * .42);
    a.angle = b.angle = Math.atan2(ny, nx);
    if (a.isPlayer && this.buffs.pierce && oldSpeed > 1) {
      const retain = Math.min(oldSpeed * .92, Math.max(oldSpeed * .52, length(a)));
      a.vx = oldX / oldSpeed * retain;
      a.vy = oldY / oldSpeed * retain;
    }
    if (a.isPlayer && closing > this.unit * 2.4) {
      const reducedMass = 1 / totalInv;
      const impact = .5 * reducedMass * (closing / this.unit) ** 2;
      const damage = Math.max(1, Math.round(impact * .31 * (1 + this.bank * .6)));
      this.bank = 0;
      this.damage(b, damage);
      this.emit('hit', {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, power: closing / this.baseSpeed, damage});
      if (this.phase === 'battle' && this.buffs.pulse && closing > this.unit * 9 && this.pulseCooldown <= 0) {
        this.pulseCooldown = .65;
        this.emit('pulse', {x: b.x, y: b.y, r: this.unit * 4});
        for (const other of this.enemies) {
          if (other === b || !other.solid || other.hp <= 0) continue;
          const d = Math.hypot(other.x - b.x, other.y - b.y);
          if (d < this.unit * 4) {
            this.damage(other, Math.round(damage * .3));
            other.vx += (other.x - b.x) / Math.max(1, d) * this.unit * 4;
            other.vy += (other.y - b.y) / Math.max(1, d) * this.unit * 4;
          }
        }
      }
    }
  }

  damage(b, damage) {
    if (this.phase !== 'battle' || b.hp <= 0 || damage <= 0) return;
    b.hp -= damage; b.hit = 1;
    if (b.hp <= 0) {
      this.score += b.value;
      if (this.buffs.breath) this.breathTime = BREATH_DURATION;
      this.emit('kill', {x: b.x, y: b.y, r: b.r, vx: b.vx, vy: b.vy, value: b.value});
      if (this.score >= this.target) this.beginUpgrade();
    }
  }

  clearEnemies() {
    for (const b of this.enemies) if (b.hp > 0) this.emit('shatter', {x:b.x, y:b.y, r:b.r * ease(b.born), vx:b.vx, vy:b.vy});
    this.enemies = [];
    this.breathTime = 0;
  }

  beginUpgrade({bypassBoss = false} = {}) {
    if (this.phase !== 'battle' && !(bypassBoss && this.phase === 'boss-celebrate')) return;
    if (!bypassBoss && this.mode !== 'campaign' && this.stage % 5 === 0) { this.beginBoss(); return; }
    this.cancelPull();
    this.arenaRestoreFrom = this.arenaBlend;
    this.phase = 'transition'; this.phaseTime = 0;
    this.clearEnemies();
    this.boss = null; this.bossCelebration = null; delete this.player.roll;
    this.player.vx = this.player.vy = 0;
    this.rollFrom = {x: this.player.x, y: this.player.y};
    const special = BUFFS.filter(b => b.kind === 'special' && (b.id === 'growth' ? (this.buffOffers.growth || 0) < 2 && (this.buffs.growth || 0) < 2 : !this.buffs[b.id]));
    let first = BUFFS[(this.stage - 1) % 2];
    let second = this.stage % 2 === 0 && special.length ? special[Math.floor(this.random() * special.length)] : BUFFS[this.stage % 2];
    if (this.stage % 3 === 0 && special.length) second = special[Math.floor(this.random() * special.length)];
    this.choices = [first, second].map(buff => ({...buffAtStage(buff, this.mode === 'campaign' ? 1 : this.stage), x: 0, y: 0, r: this.unit * 2, born: 0}));
    for (const choice of this.choices) this.buffOffers[choice.id] = (this.buffOffers[choice.id] || 0) + 1;
    this.layoutChoices();
    this.emit('upgrade');
  }

  bossAnchor() { return {x: this.width * .5, y: this.height * .5}; }

  bossPlayerAnchor() {
    const side = Math.min(this.width, this.height) - this.inset * 2;
    return {x: this.width * .5, y: this.height * .5 + side * .5 - this.player.r - Math.max(2, this.unit * .1)};
  }

  beginBoss() {
    this.cancelPull(); this.clearEnemies(); this.choices = [];
    this.phase = 'boss-entry'; this.phaseTime = 0; this.arenaBlend = 0;
    this.player.vx = this.player.vy = 0; this.player.roll = 0;
    this.rollFrom = {x: this.player.x, y: this.player.y};
    const config = bossConfig(this.stage, this.unit, Math.min(this.width, this.height) - this.inset * 2);
    this.boss = Object.assign(this.makeBody(0, 0, config.initialRadius, 1), config,
      {isBoss: true, mass: Infinity, hp: Infinity, maxHp: Infinity, value: 0, scoredSegments: 0,
        defeated: false, stunned: false, stunnedTime: 0});
    Object.assign(this.boss, this.bossAnchor());
    this.emit('bossEntry', {stage: this.stage, x: this.boss.x, y: this.boss.y, r: this.boss.r});
  }

  positionBossEntry() {
    const p = this.player, target = this.bossPlayerAnchor(), t = smooth(this.phaseTime / BOSS_TIMING.entry);
    this.arenaBlend = t;
    const bounds = this.arenaBounds;
    p.x = clamp(lerp(this.rollFrom.x, target.x, t), bounds.left + p.r, bounds.right - p.r);
    p.y = clamp(lerp(this.rollFrom.y, target.y, t), bounds.top + p.r, bounds.bottom - p.r);
    p.angle = .4; p.roll = Math.PI * 2 * t; p.squash = Math.sin(this.phaseTime * 10) * .12 * (1 - t);
    this.boss.born = clamp(this.phaseTime / BOSS_TIMING.entry, 0, 1);
  }

  // Resize or inflation can squeeze a player between the boss and a wall.
  // Include circle/bounds intersections so separation slides along that wall
  // instead of jumping all the way to one of the four cardinal directions.
  separateBossPlayer() {
    const p = this.player, b = this.boss, distance = Math.hypot(p.x - b.x, p.y - b.y), sum = p.r + b.r;
    if (distance >= sum) return;
    const radius = sum + .001, angle = Math.atan2(p.y - b.y, p.x - b.x), candidates = [];
    const bounds = this.arenaBounds;
    const minX = bounds.left + p.r, maxX = bounds.right - p.r;
    const minY = bounds.top + p.r, maxY = bounds.bottom - p.r;
    const add = (x, y) => { if (x >= minX && x <= maxX && y >= minY && y <= maxY) candidates.push({x, y}); };
    for (const a of [angle, Math.PI / 2, 0, Math.PI, -Math.PI / 2]) add(b.x + Math.cos(a) * radius, b.y + Math.sin(a) * radius);
    for (const x of [minX, maxX]) {
      const delta = x - b.x;
      if (Math.abs(delta) <= radius) { const h = Math.sqrt(Math.max(0, radius * radius - delta * delta)); add(x, b.y + h); add(x, b.y - h); }
    }
    for (const y of [minY, maxY]) {
      const delta = y - b.y;
      if (Math.abs(delta) <= radius) { const h = Math.sqrt(Math.max(0, radius * radius - delta * delta)); add(b.x + h, y); add(b.x - h, y); }
    }
    candidates.sort((a, c) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(c.x - p.x, c.y - p.y));
    if (candidates.length) { p.x = candidates[0].x; p.y = candidates[0].y; }
  }

  collideBoss() {
    if (this.phase !== 'boss' || !this.boss?.solid) return;
    const p = this.player, b = this.boss, dx = p.x - b.x, dy = p.y - b.y;
    const distance = Math.hypot(dx, dy), sum = p.r + b.r;
    if (distance >= sum) return;
    const nx = distance > .001 ? dx / distance : 0, ny = distance > .001 ? dy / distance : 1;
    const closing = -(p.vx * nx + p.vy * ny), overlap = sum - distance;
    p.x += nx * overlap; p.y += ny * overlap;
    const bounds = this.arenaBounds;
    p.x = clamp(p.x, bounds.left + p.r, bounds.right - p.r);
    p.y = clamp(p.y, bounds.top + p.r, bounds.bottom - p.r);
    this.separateBossPlayer();
    if (closing <= 0) return;
    // A fixed body reflects only the normal component; tangent speed is kept.
    p.vx += (1 + .985) * closing * nx; p.vy += (1 + .985) * closing * ny;
    p.squash = b.squash = Math.min(.3, closing / this.baseSpeed * .42);
    p.angle = b.angle = Math.atan2(ny, nx);
    this.damageBoss(closing, {x: b.x + nx * b.r, y: b.y + ny * b.r});
  }

  damageBoss(closing, contact = {}) {
    const boss = this.boss;
    if (this.phase !== 'boss' || !boss?.solid || !Number.isFinite(closing) || closing <= this.unit * 2.4) return false;
    let damage = 0;
    if (boss.stunned) {
      // As for ordinary impacts, use normal relative kinetic energy. A fixed
      // boss has infinite mass, so reduced mass is simply the player's mass.
      const impact = .5 * this.player.mass * (closing / this.unit) ** 2;
      damage = Math.max(1, Math.round(impact * .31 * (1 + this.bank * .6)));
      boss.hp -= damage;
    } else {
      const span = boss.initialRadius - boss.minRadius;
      boss.r = Math.max(boss.minRadius, boss.r - span * (.0225 + .0225 * clamp(closing / this.baseSpeed, 0, 1)) / boss.shrinkDivisor);
    }
    boss.hit = 1; this.bank = 0;
    this.emit('bossHit', {x: contact.x ?? boss.x, y: contact.y ?? boss.y, r: boss.r, power: closing / this.baseSpeed, damage});
    while (boss.scoredSegments < 5 && boss.r <= boss.thresholds[boss.scoredSegments] + 1e-9) {
      boss.scoredSegments++; this.score += boss.segmentValue; this.target += boss.segmentValue;
      this.emit('bossScore', {value: boss.segmentValue, segment: boss.scoredSegments, x: boss.x, y: boss.y, r: boss.r});
    }
    if (!boss.stunned && boss.r <= boss.minRadius + 1e-9) {
      boss.r = boss.minRadius; boss.stunned = true; boss.stunnedTime = 0;
      // Snapshot health once from this build's strongest ordinary launch,
      // including captured speed and the two-wall bonus when it is available.
      // Subsequent contacts keep using uncapped ordinary kinetic damage.
      const launch = Math.min(this.unit * 60, this.baseSpeed * Math.sqrt(this.energy / this.density));
      const impact = .5 * this.player.mass * ((launch + this.readySpeed) / this.unit) ** 2;
      const strongestHit = Math.max(1, Math.round(impact * .31 * (this.buffs.bank ? 2.2 : 1)));
      boss.maxHp = boss.hp = Math.ceil(strongestHit * 1.05 * (boss.stunHealthScale / 100));
      this.emit('bossStunned', {x: boss.x, y: boss.y, r: boss.r});
    } else if (boss.stunned && boss.hp <= 0) this.defeatBoss();
    return true;
  }

  defeatBoss() {
    const boss = this.boss, p = this.player;
    if (this.phase !== 'boss' || !boss || boss.defeated) return;
    boss.r = boss.minRadius; boss.defeated = true; boss.solid = false; boss.hp = 0;
    this.score += boss.killValue; this.target += boss.killValue;
    this.cancelPull(); this.phase = 'boss-celebrate'; this.phaseTime = 0; p.roll = 0;
    // Preserve the exact post-impact velocity. The brake integrates its smooth
    // envelope and real wall rebounds instead of lerping to a clamped endpoint.
    this.bossCelebration = {celebrated: false, stop: null};
    this.emit('bossDefeated', {value: boss.killValue, x: boss.x, y: boss.y, r: boss.r});
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

  advanceBoss(dt, dragging) {
    const p = this.player, b = this.boss;
    if (b.stunned) { b.r = b.minRadius; b.stunnedTime += dt; }
    else b.r = Math.min(b.maxRadius, b.r + b.inflationRate * dt);
    const friction = Math.exp(-(dragging ? 10 : .04) * dt);
    p.vx *= friction; p.vy *= friction;
    if (length(p) < 2) p.vx = p.vy = 0;
    p.x += p.vx * dt; p.y += p.vy * dt; p.spin += p.vx * dt / Math.max(1, p.r);
    p.hit = Math.max(0, p.hit - dt * 5); p.squash *= Math.exp(-dt * 13);
    b.hit = Math.max(0, b.hit - dt * 5); b.squash *= Math.exp(-dt * 13);
    this.wall(p); this.collideBoss();
    const bounds = this.arenaBounds;
    p.x = clamp(p.x, bounds.left + p.r, bounds.right - p.r);
    p.y = clamp(p.y, bounds.top + p.r, bounds.bottom - p.r);
    // A same-frame incoming hit can save the run or win before the size limit.
    if (this.phase === 'boss' && !b.stunned && b.r >= b.maxRadius) { this.cancelPull(); this.phase = 'over'; this.emit('over', {boss: true}); }
  }

  layoutChoices() {
    const gap = Math.min(this.width * .23, Math.max(100, this.unit * 4.5));
    this.choices.forEach((c, i) => { c.x = this.width / 2 + (i ? gap : -gap); c.y = this.height * (this.height < 520 && this.width > this.height ? .46 : .34); c.r = this.unit * 2; });
  }

  choose(choice) {
    if (this.phase !== 'choose') return;
    if (choice.id === 'growth' && (this.buffs.growth || 0) >= 2) return;
    this.buffs[choice.id] = (this.buffs[choice.id] || 0) + 1;
    if (choice.id === 'growth') this.player.r = this.unit * (1 + this.buffs.growth * .2);
    const bonus = regularBuffBonus(choice.id, this.mode === 'campaign' ? 1 : this.stage);
    if (choice.id === 'density') { this.density *= 1 + bonus; this.player.density = PLAYER_BASE_DENSITY * this.density; this.player.mass = this.player.density; }
    if (choice.id === 'energy') this.energy *= 1 + bonus;
    this.cancelPull();
    this.phase = 'reward'; this.phaseTime = 0;
    this.emit('buff', {buff: choice, x: choice.x, y: choice.y, r: choice.r});
    this.choices = [];
  }

  step(dt, dragging = false) {
    if (this.phase === 'over' || dt <= 0) return;
    // Subdivide fast motion instead of throwing away the added speed.
    // Each integration covers at most half a base radius at the sampled speed.
    let remaining = dt;
    while (remaining > 1e-10 && this.phase !== 'over') {
      const sampledSpeed = Math.max(length(this.player), ...this.enemies.map(length));
      const speed = ['boss', 'boss-celebrate'].includes(this.phase) ? sampledSpeed : Math.min(this.maxPhysicsSpeed, sampledSpeed);
      let h = Math.min(remaining, speed > 0 ? this.unit * .5 / speed : remaining);
      // Attraction can accelerate a resting enemy, which sampledSpeed cannot
      // predict. Bound those integrations so long frames cannot skip collisions.
      if (this.phase === 'battle' && this.buffs.gravity) h = Math.min(h, 1 / 120);
      if (this.phase === 'boss-celebrate' && this.phaseTime < BOSS_TIMING.brake) h = Math.min(h, 1 / 120, BOSS_TIMING.brake - this.phaseTime);
      this.advance(h, dragging);
      remaining -= h;
    }
  }

  advance(dt, dragging) {
    this.time += dt; this.phaseTime += dt;
    this.pulseCooldown -= dt;
    const p = this.player;
    if (this.phase === 'battle' && this.score >= this.target) { this.beginUpgrade(); return; }
    if (this.phase === 'boss-entry') {
      this.positionBossEntry(); p.spin += dt * 4;
      if (this.phaseTime + 1e-9 >= BOSS_TIMING.entry) {
        this.phase = 'boss'; this.phaseTime = 0; this.arenaBlend = 1; this.boss.born = 1; this.boss.solid = true;
        p.squash = 0; delete p.roll; this.emit('bossReady', {stage: this.stage});
      }
      return;
    }
    if (this.phase === 'boss') { this.advanceBoss(dt, dragging); return; }
    if (this.phase === 'boss-celebrate') { this.advanceBossCelebration(dt); return; }
    if (this.phase === 'transition') {
      this.arenaBlend = this.arenaRestoreFrom * (1 - smooth(this.phaseTime / BOSS_TIMING.entry));
      const t = ease(this.phaseTime / 1.45);
      p.x = lerp(this.rollFrom.x, this.width * .5, t);
      p.y = lerp(this.rollFrom.y, this.height * .72, t);
      const bounds = this.arenaBounds;
      p.x = clamp(p.x, bounds.left + p.r, bounds.right - p.r);
      p.y = clamp(p.y, bounds.top + p.r, bounds.bottom - p.r);
      p.spin += dt * 4;
      p.angle = .4; p.squash = Math.sin(this.phaseTime * 10) * .12 * (1 - t);
      for (const c of this.choices) c.born = clamp((this.phaseTime - .25) / 1.5, 0, 1);
      if (this.phaseTime >= 1.85) { this.arenaBlend = 0; this.phase = 'choose'; this.phaseTime = 0; this.emit('choiceReady'); }
      return;
    }
    if (this.phase === 'reward' && this.phaseTime >= 1) {
      this.stage++; this.target += 140 + this.stage * 50;
      this.phase = 'battle'; this.phaseTime = 0; this.spawnTimer = .1;
      this.emit('stage', {stage: this.stage});
    }
    if (this.phase === 'battle') {
      // Split the last partial slow frame, rather than losing or extending it.
      const slowed = Math.min(dt, this.breathTime);
      this.spawnTimer -= dt - slowed * (1 - BREATH_SPAWN_RATE);
      this.breathTime = Math.max(0, this.breathTime - dt);
      if (this.spawnTimer <= 0) {
        this.spawnEnemy();
        this.spawnTimer = this.spawnInterval;
      }
    }
    const bodies = [p, ...this.enemies];
    for (const b of bodies) {
      if (!b.isPlayer) { b.born = Math.min(1, b.born + dt / .8); b.solid = b.born >= 1; }
      const drag = b.isPlayer ? (dragging ? 10 : .60) : 1.20;
      const friction = Math.exp(-drag * dt);
      b.vx *= friction; b.vy *= friction;
      const attraction = this.gravityAcceleration(b);
      if (attraction) {
        // Exact damped velocity increment for a constant force during this
        // substep. Strength is independent of distance, mass and frame rate.
        const impulseTime = -Math.expm1(-drag * dt) / drag;
        b.vx += attraction.x * impulseTime; b.vy += attraction.y * impulseTime;
      }
      // Include the full capture allowance; fast frames are subdivided by step().
      const speed = length(b), cap = this.maxPhysicsSpeed;
      if (speed > cap) { b.vx *= cap / speed; b.vy *= cap / speed; }
      if (!attraction && length(b) < 2) b.vx = b.vy = 0;
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.spin += b.vx * dt / Math.max(1, b.r);
      b.hit = Math.max(0, b.hit - dt * 5);
      b.squash *= Math.exp(-dt * 13);
      this.wall(b);
    }
    // Growing enemies displace one another, but remain transparent to the player.
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      if (a.hp <= 0) continue;
      if (a.solid) this.collide(p, a);
      if (this.phase === 'transition' || this.phase === 'boss-entry') return;
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        if (b.hp > 0) this.collide(a, b, !a.solid || !b.solid);
      }
    }
    const bounds = this.arenaBounds;
    for (const b of bodies) { b.x = clamp(b.x, bounds.left + b.r, bounds.right - b.r); b.y = clamp(b.y, bounds.top + b.r, bounds.bottom - b.r); }
    this.enemies = this.enemies.filter(b => b.hp > 0);
    if (this.phase === 'choose') {
      for (const c of this.choices) {
        if (Math.hypot(p.x - c.x, p.y - c.y) < p.r + c.r) { this.choose(c); break; }
      }
    }
    if (this.phase === 'battle' && this.enemies.length >= this.limit) {
      this.cancelPull();this.phase = 'over'; this.emit('over');
    }
  }
}
