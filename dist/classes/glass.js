// PDF §8.2–8.3 r=7. The 60-second conveyor uses active world time throughout.
const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
const EPSILON = 1e-9;

export function glassParams(difficulty) {
  const k = clamp(Math.floor(Number(difficulty) || 0), 0, 9);
  return Object.freeze({kind: 'glass', name: '碎屏', budgetKind: 'misses',
    budget: 5 - Math.floor(k / 4), duration: 60, fallSpeed: .9 + .1 * k,
    rowGap: 3 - .067 * k, rowPattern: k < 3 ? 'two' : k < 6 ? 'alternating' : 'three',
    glassRadius: .8, glassHp: 1, columnSpacing: 2.4, finalDuration: 15, finalSpeed: 1.4,
    returnDuration: .4, auxiliaryRadius: .7, fanAngle: Math.PI / 24,
    breathDuration: 1.5, breathSpawnRate: 2 / 3});
}

export function glassLayout(world, params = world.config) {
  const b = world.arenaBounds, u = world.unit;
  const top = Math.max(b.top, world.height > 520 ? 112 : 76) + params.glassRadius * u;
  const bottom = b.bottom - world.player.r - .35 * u;
  return {left: b.left, right: b.right, top, bottom, height: Math.max(u, bottom - top),
    centre: (b.left + b.right) / 2, start: {x: (b.left + b.right) / 2, y: bottom}};
}

export function createGlassRules(world) {
  let params, board, bottomZone, elapsed = 0, misses = 0, streak = 0, kills = 0;
  let row = 0, spawnDistance = 0, breathRemaining = 0, won = false, lost = false, accelerated = false;
  let live = [];
  const ballCount = () => streak >= 10 ? 3 : streak >= 5 ? 2 : 1;
  const rowCount = index => params.rowPattern === 'two' ? 2 : params.rowPattern === 'three' ? 3 : 2 + index % 2;
  const columnX = glass => board.centre + glass.column * world.unit;
  const separateRow = (current, placed) => {
    const u = world.unit, margin = .04 * u;
    const minimum = Math.max(...current.map(g => board.left + g.r + margin - columnX(g)));
    const maximum = Math.min(...current.map(g => board.right - g.r - margin - columnX(g)));
    const safe = offset => current.every(g => placed.every(other =>
      Math.hypot(columnX(g) + offset - other.x, g.y - other.y) >= g.r + other.r + margin));
    let offset = clamp(0, minimum, maximum);
    if (!safe(offset)) {
      // Rotation compresses the long conveyor vertically. Keep each entire
      // row horizontal and its exact time-to-bottom progress, using only the
      // nearest free horizontal space. The unrotated pattern stays unchanged.
      const candidates = [minimum, maximum];
      for (const glass of current) for (const other of placed) {
        const radius = glass.r + other.r + margin, dy = glass.y - other.y;
        if (Math.abs(dy) >= radius) continue;
        const centre = other.x - columnX(glass), half = Math.sqrt(radius * radius - dy * dy);
        candidates.push(centre - half - 1e-6, centre + half + 1e-6);
      }
      candidates.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
      const available = candidates.find(candidate => candidate >= minimum && candidate <= maximum && safe(candidate));
      if (available !== undefined) offset = available;
    }
    for (const glass of current) { glass.x = columnX(glass) + offset; glass.rowShift = offset / u; }
  };
  const separateRows = () => {
    const rows = new Map();
    for (const glass of live) if (glass.active !== false && !glass.dead) {
      if (!rows.has(glass.row)) rows.set(glass.row, []); rows.get(glass.row).push(glass);
    }
    const placed = [];
    for (const current of [...rows.values()].sort((a, b) => b[0].y - a[0].y)) {
      separateRow(current, placed); placed.push(...current);
    }
  };
  const sync = () => {
    world.glassClock = elapsed; world.glassMisses = misses;
    world.remaining = Math.max(0, params.budget - misses);
    world.glassState = {elapsed, remainingTime: Math.max(0, params.duration - elapsed), misses,
      budget: params.budget, streak, nextBalls: ballCount(), spawnedRows: row, kills,
      accelerated, returning: !!world.glassReturn, breathRemaining, spawnDistance};
  };
  const spawnRow = () => {
    const count = rowCount(row), offset = [0, -.5, .5, -.25, .25][row % 5];
    const current = [];
    for (let index = 0; index < count; index++) {
      const column = (index - (count - 1) / 2) * params.columnSpacing + offset;
      const glass = world.addStatic({kind: 'glass', shape: 'circle', x: board.centre + column * world.unit,
        y: board.top, r: params.glassRadius * world.unit, hp: params.glassHp, maxHp: params.glassHp,
        restitution: .95, row, index, column, target: true, value: 10, active: true,
        vx: 0, vy: params.fallSpeed * world.unit * (accelerated ? params.finalSpeed : 1)});
      current.push(glass);
    }
    separateRow(current, live.filter(glass => glass.active !== false && !glass.dead));
    live.push(...current);
    row++; world.emit('campaignGlassRow', {row: row - 1, count});
  };
  const layout = (initial = false, previous = null) => {
    const old = board; board = glassLayout(world, params);
    if (old && !initial) for (const glass of live) {
      const oldRadius = params.glassRadius * (previous?.unit || world.unit);
      const progress = (glass.y - old.top) / Math.max(1, old.bottom - oldRadius - old.top);
      glass.x = columnX(glass);
      glass.y = board.top + progress * (board.bottom - params.glassRadius * world.unit - board.top);
      glass.previousX = glass.x; glass.previousY = glass.y;
      glass.r = params.glassRadius * world.unit;
      glass.vy = params.fallSpeed * world.unit * (accelerated ? params.finalSpeed : 1);
    }
    if (old && !initial) separateRows();
    Object.assign(bottomZone, {x: board.centre, y: board.bottom, width: board.right - board.left,
      height: .08 * world.unit, visualY: board.bottom});
    if (initial) Object.assign(world.player, board.start, {vx: 0, vy: 0, born: 1, solid: true});
    const returning = world.glassReturn;
    if (!initial && !world.shotActive && !returning && world.phase === 'battle')
      Object.assign(world.player, board.start, {vx: 0, vy: 0});
    if (returning && old && previous) {
      returning.fromX = board.left + (returning.fromX - old.left) / (old.right - old.left) * (board.right - board.left);
      returning.fromY = board.top + (returning.fromY - old.top) / old.height * board.height;
      returning.toX = board.start.x; returning.toY = board.start.y;
      updateReturn(0);
    }
    world.glassBoard = board;
  };
  const updateReturn = dt => {
    const r = world.glassReturn; if (!r) return;
    r.elapsed = Math.min(r.duration, r.elapsed + dt);
    const raw = r.elapsed / r.duration;
    const t = world.feedbackOptions.reducedMotion ? 1 : raw * raw * (3 - 2 * raw);
    Object.assign(world.player, {x: r.fromX + (r.toX - r.fromX) * t,
      y: r.fromY + (r.toY - r.fromY) * t, vx: 0, vy: 0});
    if (r.elapsed >= r.duration - EPSILON) { Object.assign(world.player, board.start); world.glassReturn = null; }
  };
  const spawnEarnedBalls = (count, launch = {}) => {
    const p = world.player, vx = launch.vx ?? p.vx + (p.pendingVx || 0), vy = launch.vy ?? p.vy + (p.pendingVy || 0);
    const speed = Math.hypot(vx, vy), heading = Math.atan2(vy, vx);
    const offsets = count === 2 ? [params.fanAngle] : count === 3 ? [-params.fanAngle, params.fanAngle] : [];
    for (const offset of offsets) {
      const angle = heading + offset, auxiliary = world.makeBody(p.x, p.y, params.auxiliaryRadius * world.unit, p.density);
      Object.assign(auxiliary, {isPlayer: true, isAuxiliary: true, glassAuxiliary: true,
        sourceMass: p.mass, damageScale: 1, hp: Infinity, maxHp: Infinity,
        active: true, born: 1, solid: true, drag: .6, angle,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        feedbackFreeze: p.feedbackFreeze || 0, feedbackFreezeTotal: p.feedbackFreezeTotal || 0});
      world.auxiliaries.push(auxiliary);
    }
    if (offsets.length) world.emit('campaignGlassMulti', {x: p.x, y: p.y, count, streak,
      bodyIds: world.auxiliaries.map(body => body.id)});
  };
  return {
    managesBudget: true,
    physics: {nonlethal: true, freezeTargetsIdle: true, settleAll: true, playerDrag: .6},
    setup(k = world.config.k) {
      params = {...glassParams(k), ...world.config};
      world.budgetKind = 'misses'; world.budget = params.budget; world.remaining = params.budget;
      world.glassReturn = null; world.glassMissUntil = 0;
      bottomZone = world.addZone({kind: 'glass-bottom', shape: 'rect', x: 0, y: 0, width: 1, height: 1,
        centerOnly: true, active: true});
      layout(true); spawnRow(); sync();
    },
    canLaunch: () => !world.glassReturn && !won && !lost && elapsed < params.duration - EPSILON,
    canSeparateBody: body => body !== world.player || world.shotActive,
    timeUntilBoundary: () => Math.max(0, params.duration - elapsed),
    splitOptions: () => ({cap: 5, radius: .7, pending: 0}),
    onLaunch(launch) {
      world.auxiliaries = []; spawnEarnedBalls(ballCount(), launch); sync();
    },
    onStaticHit(glass, contact = {}, actor = contact.attacker || world.player) {
      if (glass.kind !== 'glass' || glass.dead || glass.active === false || won || lost || !world.shotActive) return;
      world.hitStatic(glass, actor.damageScale ?? 1, contact, {value: 10});
    },
    onKill(glass, contact = {}) {
      if (glass.kind !== 'glass' || glass.missed) return;
      glass.active = false; kills++; streak++;
      if (world.buffs.breath) breathRemaining = params.breathDuration;
      const actor = contact.attacker;
      // The PDF does not specify glass rebound: a shattered pane preserves
      // the actual pre-impact trajectory; a surviving pane still reflects.
      // This is local to glass, not the general piercing upgrade.
      if (actor && contact.source !== 'pulse' && Number.isFinite(contact.impactVx) && Number.isFinite(contact.impactVy)) {
        actor.vx = contact.impactVx; actor.vy = contact.impactVy;
      }
      world.emit('campaignGlassHit', {x: glass.x, y: glass.y, r: glass.r, bodyId: glass.id,
        row: glass.row, combo: streak, source: contact.source || 'impact', nextBalls: ballCount()});
      sync();
    },
    onTick(dt) {
      if (world.phase !== 'battle' || won || lost || !(dt > 0)) return;
      const activeDt = Math.min(dt, Math.max(0, params.duration - elapsed));
      const beforeRush = Math.max(0, Math.min(activeDt, params.duration - params.finalDuration - elapsed));
      const rushed = activeDt - beforeRush;
      const distance = params.fallSpeed * world.unit * (beforeRush + rushed * params.finalSpeed);
      const oldElapsed = elapsed; elapsed = Math.min(params.duration, elapsed + activeDt);
      if (!accelerated && elapsed >= params.duration - params.finalDuration - EPSILON) {
        accelerated = true; world.emit('campaignGlassRush', {remainingTime: params.finalDuration});
      }
      updateReturn(activeDt);
      for (const glass of live) {
        if (glass.dead || glass.active === false) continue;
        glass.previousX = glass.x; glass.previousY = glass.y;
        glass.y += distance; glass.vy = params.fallSpeed * world.unit * (accelerated ? params.finalSpeed : 1);
        glass.hit = Math.max(0, glass.hit - activeDt * 5); glass.squash *= Math.exp(-activeDt * 13);
      }
      // Integrate the short breath window independently of conveyor motion.
      // Its only effect is reducing newly generated row distance by one third.
      const slowed = Math.min(activeDt, breathRemaining);
      const slowBeforeRush = Math.min(slowed, Math.max(0, params.duration - params.finalDuration - oldElapsed));
      const slowDistance = params.fallSpeed * (slowBeforeRush + (slowed - slowBeforeRush) * params.finalSpeed);
      spawnDistance += distance / world.unit - slowDistance * (1 - params.breathSpawnRate);
      breathRemaining = Math.max(0, breathRemaining - activeDt);
      while (spawnDistance >= params.rowGap - EPSILON && elapsed < params.duration - EPSILON) {
        spawnDistance -= params.rowGap; spawnRow();
      }
      sync();
    },
    onAfterTick() {
      if (world.phase !== 'battle' || won || lost) return;
      for (const glass of live) {
        if (glass.dead || glass.active === false || glass.y + glass.r < board.bottom - EPSILON) continue;
        glass.active = false; glass.dead = true; glass.missed = true; misses++; streak = 0;
        world.glassMissUntil = world.feedbackTime + .3;
        world.emit('campaignGlassMiss', {x: glass.x, y: board.bottom, r: glass.r,
          bodyId: glass.id, misses, budget: params.budget, remaining: Math.max(0, params.budget - misses)});
      }
      live = live.filter(glass => !glass.dead && glass.active !== false);
      world.statics = world.statics.filter(s => s.kind !== 'glass' || !s.dead && s.active !== false);
      lost = misses > params.budget;
      won = !lost && elapsed >= params.duration - EPSILON;
      if (won) world.peakOrigin = {x: world.player.x, y: world.player.y};
      sync();
    },
    onLaunchEnd({victory = false} = {}) {
      world.auxiliaries = [];
      if (victory || won || lost) return;
      world.glassReturn = {fromX: world.player.x, fromY: world.player.y,
        toX: board.start.x, toY: board.start.y, elapsed: 0, duration: params.returnDuration,
        at: world.feedbackTime};
      updateReturn(0); sync();
    },
    onZone: () => false,
    isSettled: () => [world.player, ...world.auxiliaries].filter(body => body.active !== false && !body.captured)
      .every(body => Math.hypot(body.vx, body.vy) < 3 * world.unit),
    isWon: () => won,
    isLost: () => lost,
    rating: () => !won ? 0 : misses === 0 ? 3 : misses <= 1 ? 2 : 1,
    summary: () => `漏 ${misses} 颗`,
    progress: () => elapsed / params.duration,
    peakOptions: () => ({kind: 'glass', duration: .8, scale: .35, zoom: .03}),
    tutorialTarget: () => {
      const target = live.find(glass => glass.active !== false && !glass.dead);
      if (world.width <= world.height) return target || {x: board.centre, y: board.top};
      const distance = Math.max(world.unit, world.player.y - (target?.y ?? board.top));
      const angle = -Math.PI / 2 - Math.PI / 72;
      return {x: world.player.x + Math.cos(angle) * distance, y: world.player.y + Math.sin(angle) * distance};
    },
    resize: previous => { layout(false, previous); sync(); },
  };
}

export const classParams = glassParams;
export const createRules = createGlassRules;
