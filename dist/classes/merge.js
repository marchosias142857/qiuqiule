import {clamp} from '../physics.js';
import {campaignBounds} from '../campaign-layout.js';
import {staticContact} from '../campaign-collision.js';
import {MERGE_LEVELS, mergeLevel} from './merge-levels.js';
export {MERGE_LEVELS} from './merge-levels.js';

export const MERGE_RADII = Object.freeze([.55, .75, 1, 1.3, 1.65]);
export function mergeParams(value, variant = 0) {
  const k = clamp(Math.floor(Number(value) || 0), 0, 9);
  // The second merge level of each chapter is a half-step, so all twenty
  // levels increase arrival pressure without doubling the old final tier.
  const difficulty = k + (Number(variant) >= 1 ? .5 : 0);
  const layout = mergeLevel(k, variant);
  return Object.freeze({kind: 'merge', name: '合成', budgetKind: 'pressure', budget: 42,
    layoutId: layout.id, layoutName: layout.name, playerRadius: .72, rank20: layout.rank,
    difficulty, targetMax: 2 + Math.floor(k / 3), goal: 2 + Math.floor(k / 3),
    coverageLimit: .42, warningThreshold: .37, spawnInterval: 2.2 - .11 * difficulty,
    threePointTime: 60 + 4 * difficulty, twoPointTime: 90 + 6 * difficulty,
    incomingLevels: layout.sequence, centreGravity: .6, drag: 1.2,
    radii: MERGE_RADII, initialBalls: layout.balls.length, arenaUnits: 14, spawnSpeed: 2,
    mergeSpeed: 1, momentumRetention: .5, chainWindow: .75, captureDuration: .2,
    restitution: .95, maxClearPoints: 500});
}

export function mergeHash(k, index, salt = 0) {
  let x = (0x3c6ef372 ^ Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(index + 13, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35)) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function mergeLevelFor(k, index, variant = 0) {
  const order = mergeLevel(k, variant).sequence;
  return order[Math.max(0, Math.floor(index)) % order.length];
}

export function mergeBounds(world) {
  return campaignBounds(world, {squareUnits: 14});
}

export function mergeLayout(world, params = world.config) {
  const layout = MERGE_LEVELS[params.rank20 ?? 2 * (params.k || 0) + (params.variant ? 1 : 0)];
  const b = world.arenaBounds, u = world.unit, span = (b.width / 2 - 1.5 * u) / 4.5;
  const point = ([x,y]) => ({x:(b.left+b.right)/2+x*span,y:(b.top+b.bottom)/2+y*span});
  return {id:layout.id,name:layout.name,start:point(layout.start),
    balls:layout.balls.map(([x,y,level])=>({...point([x,y]),level})),
    baffles:layout.baffles.map(([x,y,width,height])=>({...point([x,y]),width:width*span,height:height*span})),
    ports:layout.ports.map(([edge,along])=>({edge,along,x:edge===0?b.left:edge===1?b.right:b.left+b.width*along,
      y:edge===2?b.top:edge===3?b.bottom:b.top+b.height*along}))};
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
      elapsed: world.mergeElapsed, chain: world.mergeChain, maxChain: world.mergeMaxChain,
      warning: world.mergeWarning || 0, warningThreshold: params.warningThreshold, coverageLimit: params.coverageLimit,
      threePointTime: params.threePointTime, twoPointTime: params.twoPointTime};
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
    const index = world.mergeSpawnIndex, level = mergeLevelFor(world.config.k, index, world.config.variant);
    const r = MERGE_RADII[level - 1] * world.unit, b = world.arenaBounds, c = centre(), margin = r + world.unit * .08;
    const balls = [world.player, ...live()];
    const ports = world.mergePorts;
    for (let attempt = 0; attempt < ports.length * 9; attempt++) {
      const port = ports[(index + attempt) % ports.length], edge = port.edge;
      const nudge = [0,.04,-.04,.08,-.08,.12,-.12,.16,-.16][Math.floor(attempt / ports.length)];
      const along = clamp(port.along+nudge,.04,.96);
      const x = edge === 0 ? b.left + margin : edge === 1 ? b.right - margin : b.left + margin + (b.width - margin * 2) * along;
      const y = edge === 2 ? b.top + margin : edge === 3 ? b.bottom - margin : b.top + margin + (b.height - margin * 2) * along;
      if (balls.some(other => Math.hypot(other.x - x, other.y - y) < other.r + r + world.unit * .06)) continue;
      if (world.statics.some(shape => staticContact({x,y,r},shape,world.unit*.06))) continue;
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
      params = mergeParams(k, world.config.variant); world.budget = 42; world.budgetKind = 'pressure';
      world.mergeMade = 0; world.mergeCount = 0; world.mergeClears = 0; world.mergeElapsed = 0;
      world.mergeChain = 0; world.mergeMaxChain = 0; world.mergeLastAt = -Infinity;
      world.mergeSpawnClock = 0; world.mergeSpawnIndex = 0; world.mergeCaptures = []; world.mergePulseCooldown = 0;
      world.mergeWarning = 0; world.mergeWarningActive = false;
      const layout = mergeLayout(world, params);
      Object.assign(world.player, layout.start, {vx: 0, vy: 0, born: 1, solid: true});
      world.mergePorts = layout.ports;
      for (const [index, shape] of layout.baffles.entries()) world.addStatic({kind:'obstacle',shape:'rect',...shape,
        cornerRadius:world.unit*.12,hp:Infinity,maxHp:Infinity,pierceable:false,mergeBaffle:index});
      for (const ball of layout.balls) makeBall(ball.level, ball.x, ball.y);
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
    onTick(dt, {realDt = dt} = {}) {
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
      const coverage = world.mergeCoverage;
      if (coverage >= params.warningThreshold && !world.mergeWarningActive) {
        world.mergeWarningActive = true;
        world.emit('campaignPressureWarning', {kind: 'merge', coverage, limit: params.coverageLimit});
      } else if (coverage < params.warningThreshold - .01) world.mergeWarningActive = false;
      const target = coverage >= params.warningThreshold
        ? .25 + .75 * clamp((coverage - params.warningThreshold) / (params.coverageLimit - params.warningThreshold), 0, 1) : 0;
      world.mergeWarning += (target - world.mergeWarning) * (1 - Math.exp(-Math.max(0, realDt) / .22));
      world.mergeState.warning = world.mergeWarning;
    },
    onAfterTick: sync,
    isWon: () => world.mergeMade >= params.targetMax,
    isLost: () => mergeCoverage(world) >= params.coverageLimit - 1e-12,
    failureReason: () => 'pressure',
    rating: () => world.mergeElapsed <= params.threePointTime + 1e-9 ? 3 : world.mergeElapsed <= params.twoPointTime + 1e-9 ? 2 : 1,
    ratingStatus: () => ({
      rating: world.mergeElapsed <= params.threePointTime + 1e-9 ? 3 : world.mergeElapsed <= params.twoPointTime + 1e-9 ? 2 : 1,
      summary: `${world.mergeMade}/${params.targetMax}个 · ${Math.ceil(world.mergeElapsed)}秒 · 空间${Math.round(mergeCoverage(world) * 100)}%`,
      three: `三点 ≤ ${params.threePointTime}秒`, two: `两点 ≤ ${params.twoPointTime}秒`,
    }),
    summary: () => world.mergeMade >= params.targetMax ? `${world.mergeMade}个最大球 · ${Math.ceil(world.mergeElapsed)}秒`
      : `空间${Math.round(mergeCoverage(world) * 100)}%`,
    progress: () => ({total: params.targetMax, remaining: Math.max(0, params.targetMax - world.mergeMade)}),
    tutorialTarget: tutorial,
    tutorialPullRatio: .8,
    peakOptions: () => ({kind: 'merge', duration: .8, scale: .3, zoom: .04}),
    resize(previous) {
      const old = previous.bounds, next = world.arenaBounds, ratio = world.unit / previous.unit;
      const layout = mergeLayout(world, params); world.mergePorts = layout.ports;
      for (const shape of world.statics) if (Number.isInteger(shape.mergeBaffle))
        Object.assign(shape,layout.baffles[shape.mergeBaffle],{cornerRadius:world.unit*.12});
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
