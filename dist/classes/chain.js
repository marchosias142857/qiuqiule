import {trackPath} from '../levels.js';

const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
const EPSILON = 1e-8;
const START = Math.PI * 2 / 3, SWEEP = Math.PI * 5 / 3;
const SIZES = Object.freeze([.6, .85, 1.1]);

export function chainParams(difficulty) {
  const k = clamp(Math.floor(Number(difficulty) || 0), 0, 9);
  return Object.freeze({kind: 'chain', name: '链球', budgetKind: 'time', budget: 60, duration: 60,
    advanceSpeed: .6 + .089 * k, initialCount: 12 + k, goal: 20 + 5 * k,
    sizes: SIZES, initialHeadFraction: .48, inertiaDrag: 1.2, impulseLimit: 4,
    gravityRadius: 5, gravityAcceleration: 2.4, railWidth: .08, clearPause: .6});
}

// Arc distance must use the chord angle, not r1+r2; only this makes circles
// of different radii exactly tangent on a curved centre line.
export function chainSpacing(radius, a, b) {
  return 2 * radius * Math.asin(clamp((a + b) / (2 * radius), 0, .999999));
}

export function chainLayout(world, params = world.config) {
  const u = world.unit, b = world.arenaBounds, top = Math.max(b.top, world.height > 520 ? 112 : 76);
  const cx = (b.left + b.right) / 2, cy = (top + b.bottom) / 2;
  const radius = Math.max(2.8 * u, Math.min(b.width, b.bottom - top) / 2 - (1.1 + .3) * u);
  const width = params.railWidth * u;
  const track = {cx, cy, radius, r: radius, inner: radius - width / 2, outer: radius + width / 2,
    corner: width * .4, startAngle: START, endAngle: START + SWEEP, sweepAngle: SWEEP,
    length: radius * SWEEP, width, unit: u};
  track.start = {x: cx + Math.cos(START) * radius, y: cy + Math.sin(START) * radius};
  track.end = {x: cx + Math.cos(START + SWEEP) * radius, y: cy + Math.sin(START + SWEEP) * radius};
  track.chord = {x1: track.start.x, y1: track.start.y, x2: track.end.x, y2: track.end.y, width};
  track.path = trackPath(track); return track;
}

export function chainMatches(beads) {
  const groups = [];
  for (let start = 0; start < beads.length;) {
    let end = start + 1;
    while (end < beads.length && beads[end].sizeIndex === beads[start].sizeIndex) end++;
    if (end - start >= 3) groups.push(beads.slice(start, end));
    start = end;
  }
  return groups;
}

export function createChainRules(world) {
  let params, track, wall, chord, hole, beads = [], tail = 0, inertia = 0;
  let elapsed = 0, cleared = 0, maxChain = 0, spawned = 0, pending = false;
  let clearDelay = 0, won = false, lost = false, lastImpact = null;
  let pulseKey = null, pulseMass = 0;
  const packedLength = (list = beads) => list.slice(1).reduce((total, bead, index) =>
    total + chainSpacing(track.radius, list[index].r, bead.r), 0);
  const headDistance = () => beads.length ? tail + packedLength() : 0;
  const mass = () => beads.filter(b => b.active !== false && !b.dead).reduce((sum, bead) => sum + bead.mass, 0);
  const sync = () => {
    world.remaining = Math.max(0, params.duration - elapsed);
    world.chainBeads = beads; world.chainClock = elapsed;
    world.chainState = {cleared, goal: params.goal, elapsed, remainingTime: world.remaining, maxChain,
      headProgress: clamp(headDistance() / track.length, 0, 1), headDistance: headDistance(),
      queued: beads.filter(b => b.chainS < 0 && !b.dead).length,
      liveCount: beads.length, visibleCount: beads.filter(b => b.active !== false && !b.dead).length,
      spawned, inertia: inertia / world.unit, clearDelay};
    world.targetsRemaining = Math.max(0, params.goal - cleared);
  };
  const chooseSize = (neighbors = []) => {
    let size = clamp(Math.floor(world.random() * 3), 0, 2);
    // Starting/refilled runs never receive free matches before a player has
    // removed a separator. The random draw otherwise keeps all three sizes.
    if (neighbors.length >= 2 && neighbors[0].sizeIndex === neighbors[1].sizeIndex && size === neighbors[0].sizeIndex)
      size = (size + 1 + Math.floor(world.random() * 2)) % 3;
    return size;
  };
  const newBead = sizeIndex => {
    spawned++;
    return world.addStatic({kind: 'chain-ball', shape: 'circle', x: track.start.x, y: track.start.y,
      r: SIZES[sizeIndex] * world.unit, sizeIndex, hp: 1, maxHp: 1, active: false,
      mass: SIZES[sizeIndex] ** 2, density: 1, restitution: .95, value: 10,
      chainS: 0, target: true, born: 1, solid: true, order: spawned});
  };
  const place = () => {
    let distance = tail;
    const velocity = won || lost ? 0 : params.advanceSpeed * world.unit + inertia;
    for (let i = 0; i < beads.length; i++) {
      const bead = beads[i];
      if (i) distance += chainSpacing(track.radius, beads[i - 1].r, bead.r);
      const angle = START + clamp(distance, 0, track.length) / track.radius;
      bead.previousX = bead.x; bead.previousY = bead.y;
      bead.chainS = distance < 0 && distance >= -EPSILON ? 0 : distance; bead.angle = angle;
      bead.x = track.cx + Math.cos(angle) * track.radius; bead.y = track.cy + Math.sin(angle) * track.radius;
      bead.active = !bead.dead && distance >= -EPSILON;
      bead.vx = -Math.sin(angle) * velocity; bead.vy = Math.cos(angle) * velocity;
      bead.head = i === beads.length - 1;
    }
    // Targets must resolve before the physical rail beneath their centres.
    world.statics = [...beads, wall, chord]; world.chainTrack = track;
  };
  const constrainPlayer = (reflect = false) => {
    const player = world.player, limit = Math.max(player.r, track.radius - player.r - track.width / 2 - 1e-5);
    const dx = player.x - track.cx, dy = player.y - track.cy, distance = Math.hypot(dx, dy);
    if (distance > limit) {
      const nx = dx / distance, ny = dy / distance;
      player.x = track.cx + nx * limit; player.y = track.cy + ny * limit;
      const out = player.vx * nx + player.vy * ny;
      if (reflect && out > 0) { player.vx -= 1.95 * out * nx; player.vy -= 1.95 * out * ny; }
    }
    const maximumY = track.start.y - player.r - track.width / 2 - 1e-5;
    if (player.y > maximumY) { player.y = maximumY; if (reflect && player.vy > 0) player.vy *= -.95; }
  };
  const layout = (initial = false, previous = null) => {
    const old = track, progress = old ? headDistance() / old.length : 0;
    const pose = previous?.positions?.get(world.player.id);
    track = chainLayout(world, params);
    for (const bead of beads) bead.r = SIZES[bead.sizeIndex] * world.unit;
    if (old && !initial) {
      tail = progress * track.length - packedLength();
      inertia *= world.unit / old.unit;
      if (pose) {
        world.player.x = track.cx + (pose.x - old.cx) / old.radius * track.radius;
        world.player.y = track.cy + (pose.y - old.cy) / old.radius * track.radius;
      }
    }
    Object.assign(wall, {x: track.cx, y: track.cy, r: track.radius, startAngle: START, sweepAngle: SWEEP, width: track.width});
    Object.assign(chord, {x: track.cx, y: track.start.y, width: track.radius, height: track.width, cornerRadius: track.width / 2});
    Object.assign(hole, track.end, {r: 1.25 * world.unit});
    if (initial) Object.assign(world.player, {x: track.cx, y: track.cy, vx: 0, vy: 0, born: 1, solid: true});
    constrainPlayer(); place(); sync();
  };
  const feed = () => {
    if (won || lost || clearDelay > 0 || elapsed >= params.duration - EPSILON || cleared >= params.goal) return;
    if (!beads.length) { beads.push(newBead(chooseSize())); tail = 0; place(); return; }
    // A fresh bead is inserted only when the tail has naturally vacated its
    // chord-correct diameter. Hidden initial beads are already in this queue.
    const candidateSize = world.chainNextSize ?? (world.chainNextSize = chooseSize(beads.slice(0, 2)));
    const candidateRadius = SIZES[candidateSize] * world.unit;
    const spacing = chainSpacing(track.radius, candidateRadius, beads[0].r);
    if (tail >= spacing - EPSILON) {
      tail -= spacing; beads.unshift(newBead(candidateSize)); world.chainNextSize = null; place();
    }
  };
  const resolveMatches = () => {
    if (!pending) return;
    pending = false;
    beads = beads.filter(bead => !bead.dead);
    world.chainNextSize = null;
    place();
    let level = 0;
    for (;;) {
      const groups = chainMatches(beads.filter(bead => bead.active !== false)); if (!groups.length) break;
      level++; maxChain = Math.max(maxChain, level);
      for (const group of groups) {
        const origin = group[Math.floor(group.length / 2)];
        world.awardCampaignPoints(30 * level, {source: 'chain-match', level, count: group.length, x: origin.x, y: origin.y});
        for (const bead of group) {
          bead.dead = true; bead.active = false; bead.hp = 0; cleared++;
          world.kills++; world.totalKills++; world.shotKills++;
          world.emit('shatter', {x: bead.x, y: bead.y, r: bead.r, vx: bead.vx, vy: bead.vy,
            bodyId: bead.id, source: 'chain-match', level});
        }
        world.emit('campaignChainMatch', {x: origin.x, y: origin.y, level, count: group.length, value: 30 * level});
      }
      beads = beads.filter(bead => !bead.dead); place();
    }
    if (!beads.length) {
      clearDelay = params.clearPause; tail = 0; inertia = 0; world.chainNextSize = null;
      const origin = lastImpact || world.player;
      world.emit('campaignChainClear', {x: origin.x, y: origin.y, cleared, maxChain});
      world.beginCampaignSlow?.({duration: .4, scale: .3, kind: 'chain', x: origin.x, y: origin.y});
    }
    place();
  };
  return {
    managesBudget: true,
    physics: {nonlethal: true, freezeTargetsIdle: true, settleAll: true, playerDrag: .6},
    setup(k = world.config.k) {
      params = {...chainParams(k), ...world.config};
      world.budget = params.duration; world.remaining = params.duration; world.totalTargets = params.goal;
      track = chainLayout(world, params);
      wall = world.addStatic({kind: 'chain-rail', shape: 'arc', x: track.cx, y: track.cy, r: track.radius,
        startAngle: START, sweepAngle: SWEEP, width: track.width, hp: Infinity, maxHp: Infinity, restitution: .95, bankSurface: true, pierceable: false});
      chord = world.addStatic({kind: 'chain-chord', shape: 'rect', x: track.cx, y: track.start.y,
        width: track.radius, height: track.width, hp: Infinity, maxHp: Infinity, restitution: .95, bankSurface: true, pierceable: false});
      hole = world.addZone({kind: 'chain-hole', shape: 'circle', ...track.end, r: 1.25 * world.unit, centerOnly: true, active: true});
      for (let i = 0; i < params.initialCount; i++) beads.push(newBead(chooseSize(beads.slice(-2))));
      const length = packedLength(); tail = Math.min(length, params.initialHeadFraction * track.length) - length;
      layout(true);
    },
    canLaunch: () => !won && !lost && elapsed < params.duration - EPSILON,
    timeUntilBoundary: () => Math.max(0, params.duration - elapsed),
    onUpgrade: () => constrainPlayer(),
    onStaticHit(bead, contact = {}, actor = contact.attacker || world.player) {
      if (bead.kind !== 'chain-ball' || bead.dead || bead.active === false || !world.shotActive || won || lost) return;
      const tangentX = -Math.sin(bead.angle), tangentY = Math.cos(bead.angle);
      const momentum = actor.mass * ((contact.impactVx || 0) * tangentX + (contact.impactVy || 0) * tangentY);
      const impulse = clamp(momentum / Math.max(1e-6, mass()), -params.impulseLimit * world.unit, params.impulseLimit * world.unit);
      inertia += impulse; lastImpact = {x: bead.x, y: bead.y};
      world.hitStatic(bead, 1, contact, {value: 10}); sync();
    },
    onKill(bead, contact = {}) {
      if (bead.kind !== 'chain-ball') return;
      bead.active = false; pending = true; cleared++;
      lastImpact = {x: bead.x, y: bead.y};
      world.emit('campaignChainHit', {x: bead.x, y: bead.y, bodyId: bead.id, cleared, source: contact.source || 'impact'});
    },
    onPulseTarget(bead, {nx, ny, speed, origin} = {}) {
      if (bead.kind !== 'chain-ball' || !bead.active || bead.dead) return;
      const key = `${world.stepSerial}:${origin?.id}`;
      if (pulseKey !== key) { pulseKey = key; pulseMass = Math.max(1e-6, mass()); }
      const projection = -Math.sin(bead.angle) * nx + Math.cos(bead.angle) * ny;
      inertia += bead.mass / pulseMass * speed * projection;
    },
    onTick(dt) {
      if (world.phase !== 'battle' || won || lost || !(dt > 0)) return;
      const activeDt = Math.min(dt, params.duration - elapsed);
      let acceleration = 0;
      if (world.buffs.gravity) {
        const totalMass = Math.max(1e-6, mass());
        for (const bead of beads) {
          if (!bead.active || bead.dead) continue;
          const dx = world.player.x - bead.x, dy = world.player.y - bead.y, distance = Math.hypot(dx, dy);
          if (distance < 1e-8 || distance > params.gravityRadius * world.unit) continue;
          const projection = (-Math.sin(bead.angle) * dx + Math.cos(bead.angle) * dy) / distance;
          acceleration += params.gravityAcceleration * world.unit * projection * bead.mass / totalMass;
        }
      }
      const decay = Math.exp(-params.inertiaDrag * activeDt);
      const integrated = -Math.expm1(-params.inertiaDrag * activeDt) / params.inertiaDrag;
      const distance = params.advanceSpeed * world.unit * activeDt + inertia * integrated
        + acceleration / params.inertiaDrag * (activeDt - integrated);
      inertia = inertia * decay + acceleration * integrated;
      if (beads.length) tail += distance;
      elapsed = Math.min(params.duration, elapsed + activeDt); clearDelay = Math.max(0, clearDelay - activeDt);
      if (clearDelay < EPSILON) clearDelay = 0;
      for (const bead of beads) { bead.hit = Math.max(0, bead.hit - activeDt * 5); bead.squash *= Math.exp(-activeDt * 13); }
      place(); sync();
    },
    onAfterTick() {
      if (world.phase !== 'battle' || won || lost) return;
      resolveMatches();
      // A real target-clearing shot wins first. Otherwise an uncleared head
      // reaching the hole defeats a simultaneous survival-time deadline.
      won = cleared >= params.goal;
      lost = !won && beads.length > 0 && headDistance() >= track.length - EPSILON;
      if (!lost && elapsed >= params.duration - EPSILON) won = true;
      if (won) world.peakOrigin = lastImpact || {x: track.cx, y: track.cy};
      if (!won && !lost) feed();
      else for (const bead of beads) bead.vx = bead.vy = 0;
      constrainPlayer(true); sync();
    },
    onZone: () => false,
    isWon: () => won,
    isLost: () => lost,
    rating: () => !won ? 0 : maxChain >= 3 ? 3 : maxChain >= 2 ? 2 : 1,
    summary: () => won ? `消除 ${cleared} 颗 · 连锁 ${maxChain}` : `差 ${Math.max(0, params.goal - cleared)} 颗`,
    progress: () => Math.max(cleared / params.goal, elapsed / params.duration),
    peakOptions: () => ({kind: 'chain', duration: .85, scale: .3, zoom: .03}),
    tutorialTarget: () => beads.find(bead => bead.active !== false && !bead.dead) || track.start,
    resize: previous => layout(false, previous),
  };
}

export const classParams = chainParams;
export const createRules = createChainRules;
