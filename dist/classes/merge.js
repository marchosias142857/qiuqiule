import {clamp} from '../physics.js';

export const MERGE_RADII = Object.freeze([.55, .75, 1, 1.3, 1.65]);
export function mergeParams(value) {
  const k = clamp(Math.floor(Number(value) || 0), 0, 9);
  return Object.freeze({kind: 'merge', name: '合成', budgetKind: 'pressure', budget: 42,
    targetMax: 2 + Math.floor(k / 3), goal: 2 + Math.floor(k / 3), coverageLimit: .42, spawnInterval: 2.2 - .11 * k,
    level3Chance: k >= 6 ? .1 + (k - 6) / 30 : 0, centreGravity: .6, drag: 1.2,
    radii: MERGE_RADII, initialBalls: 8, arenaUnits: 14, spawnSpeed: 2,
    mergeSpeed: 1, momentumRetention: .5, chainWindow: .75, captureDuration: .2,
    restitution: .95, maxClearPoints: 500});
}

export function mergeHash(k, index, salt = 0) {
  let x = (0x3c6ef372 ^ Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(index + 13, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35)) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function mergeLevelFor(k, index) {
  const p = mergeParams(k), value = mergeHash(k, index);
  return value < p.level3Chance ? 3 : value < p.level3Chance + (1 - p.level3Chance) / 2 ? 1 : 2;
}

export function mergeBounds(world) {
  const inset = world.inset ?? 16, top = world.height > 520 ? 128 : 86;
  const availableWidth = world.width - inset * 2, availableHeight = world.height - inset - top;
  const size = Math.min(14 * world.unit, availableWidth, availableHeight, Math.min(world.width, world.height) - 102);
  const left = (world.width - size) / 2, y = top + (availableHeight - size) / 2;
  return {left, right: left + size, top: y, bottom: y + size, width: size, height: size};
}

export function mergeCoverage(world) {
  const b = world.arenaBounds;
  return world.enemies.filter(body => body.kind === 'merge-ball' && body.active !== false && body.hp > 0)
    .reduce((area, body) => area + Math.PI * body.r * body.r, 0) / Math.max(1, b.width * b.height);
}

export function createMergeRules(world) {
  let params;
  const live = () => world.enemies.filter(body => body.kind === 'merge-ball' && body.active !== false && body.hp > 0);
  const centre = () => ({x: (world.arenaBounds.left + world.arenaBounds.right) / 2, y: (world.arenaBounds.top + world.arenaBounds.bottom) / 2});
  const sync = () => {
    world.mergeCoverage = mergeCoverage(world); world.remaining = Math.max(0, 42 - world.mergeCoverage * 100);
    world.mergeState = {produced: world.mergeMade, goal: params.targetMax, coverage: world.mergeCoverage,
      elapsed: world.mergeElapsed, chain: world.mergeChain, maxChain: world.mergeMaxChain};
  };
  const makeBall = (level, x, y, extra = {}) => {
    const r = MERGE_RADII[level - 1] * world.unit, mass = .55 ** 2 * 2 ** (level - 1);
    const body = world.makeBody(x, y, r, mass / (r / world.unit) ** 2);
    Object.assign(body, {kind: 'merge-ball', mergeLevel: level, enemyType: 'normal', hp: Infinity, maxHp: Infinity,
      mass, born: 1, solid: true, active: true, drag: params.drag, restitution: params.restitution,
      mergeChain: 0, mergeAt: -Infinity, mergeChainPeaked: false, ...extra});
    world.enemies.push(body); return body;
  };
  const tutorial = () => {
    const p = world.player, balls = live();
    let best = null, distance = Infinity;
    for (const a of balls) for (const b of balls) {
      if (a.id >= b.id || a.mergeLevel !== b.mergeLevel) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y) + Math.hypot(p.x - a.x, p.y - a.y) * .15;
      if (d < distance) { distance = d; best = a; }
    }
    return best || balls[0] || centre();
  };
  const spawn = () => {
    const index = world.mergeSpawnIndex, level = mergeLevelFor(world.config.k, index);
    const r = MERGE_RADII[level - 1] * world.unit, b = world.arenaBounds, c = centre(), margin = r + world.unit * .08;
    const balls = [world.player, ...live()];
    for (let attempt = 0; attempt < 48; attempt++) {
      const edge = Math.floor(mergeHash(world.config.k, index, 1 + attempt * 2) * 4);
      const along = .04 + .92 * mergeHash(world.config.k, index, 2 + attempt * 2);
      const x = edge === 0 ? b.left + margin : edge === 1 ? b.right - margin : b.left + margin + (b.width - margin * 2) * along;
      const y = edge === 2 ? b.top + margin : edge === 3 ? b.bottom - margin : b.top + margin + (b.height - margin * 2) * along;
      if (balls.some(other => Math.hypot(other.x - x, other.y - y) < other.r + r + world.unit * .06)) continue;
      const dx = c.x - x, dy = c.y - y, d = Math.hypot(dx, dy), speed = params.spawnSpeed * world.unit;
      const body = makeBall(level, x, y, {vx: dx / d * speed, vy: dy / d * speed});
      world.mergeSpawnIndex++;
      world.emit('campaignMergeSpawn', {bodyId: body.id, level, x, y, index}); return true;
    }
    // A blocked edge waits for real free space. It never overlaps a body,
    // changes the level draw, or grants a merge/score merely for spawning.
    return false;
  };
  const combine = (a, b, contact, maximum = false) => {
    if (a.active === false || b.active === false || a.hp <= 0 || b.hp <= 0) return false;
    const preA = contact.preA || a, preB = contact.preB || b, mass = preA.mass + preB.mass;
    const position = contact.centerOfMass || {x: (preA.x * preA.mass + preB.x * preB.mass) / mass,
      y: (preA.y * preA.mass + preB.y * preB.mass) / mass};
    const momentum = contact.momentum || {x: preA.vx * preA.mass + preB.vx * preB.mass,
      y: preA.vy * preA.mass + preB.vy * preB.mass};
    const continuing = [a, b].filter(body => world.time - body.mergeAt <= params.chainWindow + 1e-10);
    const chain = Math.max(0, ...continuing.map(body => body.mergeChain || 0)) + 1;
    let peaked = continuing.some(body => body.mergeChainPeaked);
    const origins = [a, b].map((body, i) => {
      const pre = i ? preB : preA;
      const snapshot = {...body, x: pre.x, y: pre.y, born: 1};
      world.mergeCaptures.push({kind: 'merge', bodyId: body.id, bodySnapshot: snapshot,
        x: pre.x, y: pre.y, toX: position.x, toY: position.y, at: world.feedbackTime, duration: params.captureDuration});
      return {id: body.id, x: pre.x, y: pre.y, r: body.r, level: body.mergeLevel};
    });
    a.active = b.active = false; a.hp = b.hp = 0;
    world.mergeChain = chain; world.mergeMaxChain = Math.max(world.mergeMaxChain, chain);
    world.mergeLastAt = world.time; world.maxCombo = Math.max(world.maxCombo, chain);
    if (chain >= 3 && !peaked) {
      peaked = true;
      world.beginCampaignSlow({duration: .4, scale: .3, kind: 'merge-chain', ...position});
      world.emit('campaignMergeChain', {...position, chain});
    }
    let child = null, value;
    if (maximum) {
      world.mergeClears++; value = params.maxClearPoints;
      world.beginCampaignSlow({duration: .4, scale: .3, kind: 'merge-clear', ...position});
    } else {
      const level = a.mergeLevel + 1; value = level * 10; world.mergeCount++;
      child = makeBall(level, position.x, position.y, {mass, density: mass / MERGE_RADII[level - 1] ** 2,
        vx: momentum.x / mass * params.momentumRetention, vy: momentum.y / mass * params.momentumRetention,
        mergeBornAt: world.feedbackTime, mergeAt: world.time, mergeChain: chain, mergeChainPeaked: peaked});
      if (level === 5) world.mergeMade++;
    }
    world.awardCampaignPoints(value, {kind: maximum ? 'merge-clear' : 'merge'});
    world.peakOrigin = {...position}; sync();
    world.emit(maximum ? 'campaignMergeClear' : 'campaignMerge', {...position, r: child?.r ?? MERGE_RADII[4] * world.unit,
      level: child?.mergeLevel ?? 5, newBodyId: child?.id ?? null, origins,
      produced: world.mergeMade, goal: params.targetMax, chain, value});
    return true;
  };
  const pushPulse = (a, b, contact) => {
    if (!world.buffs.pulse || !world.shotActive || a !== world.player && b !== world.player ||
      !(contact.normalSpeed > world.unit * 9) || world.mergePulseCooldown > 0) return;
    const origin = a === world.player ? b : a;
    world.mergePulseCooldown = .65;
    for (const body of live()) {
      if (body === origin) continue;
      const dx = body.x - origin.x, dy = body.y - origin.y, distance = Math.hypot(dx, dy);
      if (distance >= world.unit * 4 || distance < 1e-8) continue;
      body.vx += dx / distance * world.unit * 4; body.vy += dy / distance * world.unit * 4;
    }
    world.emit('pulse', {x: origin.x, y: origin.y, r: world.unit * 4, source: 'merge'});
  };
  return {
    managesBudget: true,
    physics: {nonlethal: true, restitution: .95, freezeTargetsIdle: false, idleDynamicRules: true, settleAll: false, playerDrag: .6},
    arenaBounds: () => mergeBounds(world),
    setup(k) {
      params = mergeParams(k); world.budget = 42; world.budgetKind = 'pressure';
      world.mergeMade = 0; world.mergeCount = 0; world.mergeClears = 0; world.mergeElapsed = 0;
      world.mergeChain = 0; world.mergeMaxChain = 0; world.mergeLastAt = -Infinity;
      world.mergeSpawnClock = 0; world.mergeSpawnIndex = 0; world.mergeCaptures = []; world.mergePulseCooldown = 0;
      const b = world.arenaBounds, c = centre();
      Object.assign(world.player, {x: c.x, y: b.bottom - world.unit * 1.5, vx: 0, vy: 0, born: 1, solid: true});
      const levels = [1, 1, 2, 2, 1, 1, 2, 2];
      for (let i = 0; i < levels.length; i++) {
        const angle = -Math.PI * .5 + i * Math.PI / 4;
        makeBall(levels[i], c.x + Math.cos(angle) * world.unit * 2.8, c.y + Math.sin(angle) * world.unit * 2.8);
      }
      sync();
    },
    onLaunch() {},
    onDynamicTouch(a, b, contact) {
      if (world.phase !== 'battle' || a.kind !== 'merge-ball' || b.kind !== 'merge-ball' ||
        a.mergeLevel !== 5 || b.mergeLevel !== 5) return false;
      return combine(a, b, contact, true);
    },
    onDynamicHit(a, b, contact) {
      if (world.phase !== 'battle') return false;
      pushPulse(a, b, contact);
      if (a.kind !== 'merge-ball' || b.kind !== 'merge-ball' || a.mergeLevel !== b.mergeLevel ||
        a.mergeLevel >= 5 || !(contact.normalSpeed > params.mergeSpeed * world.unit)) return false;
      return combine(a, b, contact);
    },
    onTick(dt) {
      world.mergeCaptures = world.mergeCaptures.filter(c => world.feedbackTime - c.at < c.duration);
      if (world.phase !== 'battle') return;
      world.mergeElapsed += dt; world.mergePulseCooldown = Math.max(0, world.mergePulseCooldown - dt);
      if (world.time - world.mergeLastAt > params.chainWindow) world.mergeChain = 0;
      const c = centre();
      for (const body of live()) {
        const dx = c.x - body.x, dy = c.y - body.y, distance = Math.hypot(dx, dy);
        if (distance > 1e-8) { body.vx += dx / distance * params.centreGravity * world.unit * dt; body.vy += dy / distance * params.centreGravity * world.unit * dt; }
        const gravity = world.gravityAcceleration(body);
        if (gravity) { body.vx += gravity.x * dt; body.vy += gravity.y * dt; }
      }
      world.mergeSpawnClock += dt;
      while (world.mergeSpawnClock >= params.spawnInterval - 1e-10) {
        if (!spawn()) { world.mergeSpawnClock = params.spawnInterval; break; }
        world.mergeSpawnClock = Math.max(0, world.mergeSpawnClock - params.spawnInterval);
      }
      sync();
    },
    onAfterTick: sync,
    isWon: () => world.mergeMade >= params.targetMax,
    isLost: () => mergeCoverage(world) >= params.coverageLimit - 1e-12,
    rating: () => world.mergeElapsed <= 60 + 1e-9 ? 3 : world.mergeElapsed <= 90 + 1e-9 ? 2 : 1,
    summary: () => world.mergeMade >= params.targetMax ? `${world.mergeMade}个最大球 · ${Math.ceil(world.mergeElapsed)}秒`
      : `空间${Math.round(mergeCoverage(world) * 100)}%`,
    progress: () => ({total: params.targetMax, remaining: Math.max(0, params.targetMax - world.mergeMade)}),
    tutorialTarget: tutorial,
    peakOptions: () => ({kind: 'merge', duration: .8, scale: .3, zoom: .04}),
    resize(previous) {
      const old = previous.bounds, next = world.arenaBounds, ratio = world.unit / previous.unit;
      for (const capture of world.mergeCaptures) {
        const map = (x, y) => ({x: next.left + (x - old.left) / old.width * next.width, y: next.top + (y - old.top) / old.height * next.height});
        const from = map(capture.bodySnapshot.x, capture.bodySnapshot.y), to = map(capture.toX, capture.toY);
        Object.assign(capture, {x: from.x, y: from.y, toX: to.x, toY: to.y});
        Object.assign(capture.bodySnapshot, {x: from.x, y: from.y, r: capture.bodySnapshot.r * ratio});
      }
      sync();
    },
  };
}
