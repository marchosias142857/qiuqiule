export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const length = b => Math.hypot(b.vx, b.vy);
export const ease = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const lerp = (a, b, t) => a + (b - a) * t;
export const PLAYER_BASE_DENSITY = 1.5;
export const BREATH_DURATION = 2;
export const BREATH_SPAWN_RATE = .5;

export const BUFFS = [
  // Growth changes only geometry; mass and all launch/impact tuning stay independent.
  { id: 'density', kind: 'density', name: '重量级', short: '密度 +35%', detail: '质量更大，撞得更狠。同等能量下，出发稍慢。', color: '#bbd968', sides: 3 },
  { id: 'energy', kind: 'energy', name: '弹性十足', short: '弹射能量 +30%', detail: '同样的拉伸，释放更多能量。', color: '#ee967b', sides: 4 },
  { id: 'pierce', kind: 'special', name: '一往无前', short: '撞球不改方向', detail: '撞开敌球后保持原方向，仍然损失速度。', color: '#a4c9d8', sides: 5 },
  { id: 'pulse', kind: 'special', name: '连锁反应', short: '重击引发震荡', detail: '强力撞击时，震伤并推开附近的敌球。', color: '#b6ace0', sides: 5 },
  { id: 'bank', kind: 'special', name: '借墙发力', short: '碰墙后伤害 +60%', detail: '每次碰墙会强化下一次撞击，最多叠加 2 层。', color: '#e6c86c', sides: 5 },
  { id: 'growth', kind: 'special', name: '大一圈', short: '直径 1.2 倍 → 1.4 倍', detail: '仅扩大碰撞箱和显示尺寸，不改变质量、密度、速度或伤害公式。首次获得为原始直径的 1.2 倍，第二次为 1.4 倍。每局最多出现两次。', color: '#d5aa7c', sides: 5, maxOffers: 2, maxStacks: 2 },
  { id: 'breath', kind: 'special', name: '喘口气', short: '击破后 2 秒刷新速度减半', detail: '击杀后 2 秒内，敌球刷新计时以 50% 速度推进。连续击杀刷新持续时间，不叠加减速，也不会完全停刷。', color: '#96c9b1', sides: 5 },
];

export class World {
  constructor(width, height, random = Math.random) {
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
    this.spawnEnemy();
    this.spawnEnemy();
  }

  makeBody(x, y, r, density) {
    return {id: ++this.id, x, y, vx: 0, vy: 0, r, mass: density * (r / this.unit) ** 2,
      density, born: 0, solid: false, hp: 20, maxHp: 20, value: 10, hit: 0, squash: 0, angle: 0, spin: 0};
  }
  get readySpeed() { return this.unit * (8 + 4 * Math.floor(Math.max(0, this.stage - 1) / 5)); }
  get maxPhysicsSpeed() { return this.unit * 60 + this.readySpeed; }
  get ready() { return (this.phase === 'battle' || this.phase === 'choose') && (this.pullStartSpeed !== null || length(this.player) < this.readySpeed); }
  beginPull() {
    if (!this.ready || this.pullStartSpeed !== null) return false;
    this.pullStartSpeed = length(this.player);
    return true;
  }
  cancelPull() { this.pullStartSpeed = null; }
  get maxPull() { return clamp(Math.min(this.width, this.height) * .25, 90, 170); }
  get baseSpeed() { return this.unit * 40; }
  emit(type, data = {}) { this.events.push({type, ...data}); }

  resize(width, height) {
    this.cancelPull();
    const rx = width / this.width, ry = height / this.height;
    this.width = width; this.height = height;
    const oldUnit = this.unit;
    this.unit = clamp(Math.min(width, height) * .047, 18, 34);
    const k = this.unit / oldUnit;
    for (const b of [this.player, ...this.enemies]) {
      b.x = clamp(b.x * rx, b.r * k + this.inset, width - b.r * k - this.inset);
      b.y = clamp(b.y * ry, b.r * k + this.inset, height - b.r * k - this.inset);
      b.r *= k; b.vx *= k; b.vy *= k;
    }
    this.layoutChoices();
    if (this.phase === 'transition') this.rollFrom = {x: this.player.x, y: this.player.y};
  }

  spawnEnemy() {
    if (this.phase !== 'battle' || this.enemies.length >= this.limit) return;
    const r = this.unit * (.7 + this.random() * .38 + Math.min(this.stage - 1, 12) * .014);
    let x, y, best = -Infinity, pos;
    for (let n = 0; n < 24; n++) {
      x = this.inset + r + this.random() * (this.width - 2 * (this.inset + r));
      y = this.inset + r + this.random() * (this.height - 2 * (this.inset + r));
      let distance = Math.hypot(x - this.player.x, y - this.player.y) - r - this.player.r - this.unit * 2;
      for (const b of this.enemies) distance = Math.min(distance, Math.hypot(x - b.x, y - b.y) - r - b.r);
      if (distance > best) { best = distance; pos = {x, y}; }
      if (best > this.unit * .5) break;
    }
    const b = this.makeBody(pos.x, pos.y, r, .65 + this.stage * .09 + this.time * .0007);
    b.maxHp = b.hp = 19 + (this.stage - 1) * 6 + Math.floor(this.time / 45) * 2;
    b.value = 10 + Math.floor((this.stage - 1) / 3) * 5;
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
    const pad = this.inset;
    let nx = 0, ny = 0, speed = 0;
    if (b.x < pad + b.r) { b.x = pad + b.r; if (b.vx < 0) { speed = -b.vx; b.vx *= -.92; nx = -1; } }
    if (b.x > this.width - pad - b.r) { b.x = this.width - pad - b.r; if (b.vx > 0) { speed = b.vx; b.vx *= -.92; nx = 1; } }
    if (b.y < pad + b.r) { b.y = pad + b.r; if (b.vy < 0) { speed = Math.max(speed, -b.vy); b.vy *= -.92; ny = -1; } }
    if (b.y > this.height - pad - b.r) { b.y = this.height - pad - b.r; if (b.vy > 0) { speed = Math.max(speed, b.vy); b.vy *= -.92; ny = 1; } }
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

  beginUpgrade() {
    if (this.phase !== 'battle') return;
    this.cancelPull();
    this.phase = 'transition'; this.phaseTime = 0;
    for (const b of this.enemies) if (b.hp > 0) this.emit('shatter', {x:b.x, y:b.y, r:b.r * ease(b.born), vx:b.vx, vy:b.vy});
    this.enemies = [];
    this.breathTime = 0;
    this.player.vx = this.player.vy = 0;
    this.rollFrom = {x: this.player.x, y: this.player.y};
    const special = BUFFS.filter(b => b.kind === 'special' && (b.id === 'growth' ? (this.buffOffers.growth || 0) < 2 && (this.buffs.growth || 0) < 2 : !this.buffs[b.id]));
    let first = BUFFS[(this.stage - 1) % 2];
    let second = this.stage % 2 === 0 && special.length ? special[Math.floor(this.random() * special.length)] : BUFFS[this.stage % 2];
    if (this.stage % 3 === 0 && special.length) second = special[Math.floor(this.random() * special.length)];
    this.choices = [first, second].map(buff => ({...buff, x: 0, y: 0, r: this.unit * 2, born: 0}));
    for (const choice of this.choices) this.buffOffers[choice.id] = (this.buffOffers[choice.id] || 0) + 1;
    this.layoutChoices();
    this.emit('upgrade');
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
    if (choice.id === 'density') { this.density *= 1.35; this.player.density = PLAYER_BASE_DENSITY * this.density; this.player.mass = this.player.density; }
    if (choice.id === 'energy') this.energy *= 1.3;
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
      const speed = Math.min(this.maxPhysicsSpeed, Math.max(length(this.player), ...this.enemies.map(length)));
      const h = Math.min(remaining, speed > 0 ? this.unit * .5 / speed : remaining);
      this.advance(h, dragging);
      remaining -= h;
    }
  }

  advance(dt, dragging) {
    this.time += dt; this.phaseTime += dt;
    this.pulseCooldown -= dt;
    const p = this.player;
    if (this.phase === 'battle' && this.score >= this.target) { this.beginUpgrade(); return; }
    if (this.phase === 'transition') {
      const t = ease(this.phaseTime / 1.45);
      p.x = lerp(this.rollFrom.x, this.width * .5, t);
      p.y = lerp(this.rollFrom.y, this.height * .72, t);
      p.spin += dt * 4;
      p.angle = .4; p.squash = Math.sin(this.phaseTime * 10) * .12 * (1 - t);
      for (const c of this.choices) c.born = clamp((this.phaseTime - .25) / 1.5, 0, 1);
      if (this.phaseTime >= 1.85) { this.phase = 'choose'; this.phaseTime = 0; this.emit('choiceReady'); }
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
        this.spawnTimer = Math.max(.52, 2.45 - (this.stage - 1) * .18 - this.time * .002);
      }
    }
    const bodies = [p, ...this.enemies];
    for (const b of bodies) {
      if (!b.isPlayer) { b.born = Math.min(1, b.born + dt / .8); b.solid = b.born >= 1; }
      const drag = b.isPlayer ? (dragging ? 10 : .60) : 1.20;
      const friction = Math.exp(-drag * dt);
      b.vx *= friction; b.vy *= friction;
      // Include the full capture allowance; fast frames are subdivided by step().
      const speed = length(b), cap = this.maxPhysicsSpeed;
      if (speed > cap) { b.vx *= cap / speed; b.vy *= cap / speed; }
      if (length(b) < 2) b.vx = b.vy = 0;
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
      if (this.phase === 'transition') return;
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        if (b.hp > 0) this.collide(a, b, !a.solid || !b.solid);
      }
    }
    for (const b of bodies) { b.x = clamp(b.x, this.inset + b.r, this.width - this.inset - b.r); b.y = clamp(b.y, this.inset + b.r, this.height - this.inset - b.r); }
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
