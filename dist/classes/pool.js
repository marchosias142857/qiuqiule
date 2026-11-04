import {clamp} from '../physics.js';

const tier = value => clamp(Math.floor(Number(value) || 0), 0, 9);

export function poolParams(value) {
  const k = tier(value), targetBalls = 7 + Math.floor(k / 2);
  return Object.freeze({kind: 'pool', name: '落袋', targetBalls,
    budget: targetBalls + 4 - Math.floor(k / 3), scratchPenalty: k >= 5 ? 2 : 1,
    ballRadius: .95, pocketRadius: 1.35, pocketSpeedLimit: 30, restitution: .95, drag: .3,
    pattern: k < 3 ? 'triangle' : k < 6 ? 'split-triangle' : k < 9 ? 'diamond' : 'scattered',
  });
}

export function poolBounds(world) {
  const inset = world.inset ?? 16, top = world.height > 520 ? 128 : 86;
  const left = inset, right = world.width - inset, bottom = world.height - inset;
  return {left, right, top: Math.min(top, bottom - world.unit * 8), bottom,
    width: right - left, height: bottom - Math.min(top, bottom - world.unit * 8)};
}

export function poolLayout(world, params = poolParams(world.config?.k || 0)) {
  const b = poolBounds(world), u = world.unit, r = params.pocketRadius * u;
  const vertical = b.height >= b.width;
  const pockets = [
    {x: b.left + r, y: b.top + r}, {x: b.right - r, y: b.top + r},
    {x: b.left + r, y: b.bottom - r}, {x: b.right - r, y: b.bottom - r},
    ...(vertical ? [{x: b.left + r, y: (b.top + b.bottom) / 2}, {x: b.right - r, y: (b.top + b.bottom) / 2}]
      : [{x: (b.left + b.right) / 2, y: b.top + r}, {x: (b.left + b.right) / 2, y: b.bottom - r}]),
  ];
  // p follows the long axis from the rack end to the launch end, q the short
  // axis. Keep the same billiards layout when rotating a phone.
  const point = (p, q) => vertical
    ? {x: b.left + b.width * q, y: b.top + b.height * p}
    : {x: b.left + b.width * (1 - p), y: b.top + b.height * q};
  const spawn = point(.82, .5), rack = point(.38, .5), spacing = u * 2.04;
  const local = (along, across) => vertical
    ? {x: rack.x + across * spacing, y: rack.y + along * spacing}
    : {x: rack.x - along * spacing, y: rack.y + across * spacing};
  const positions = [], count = params.targetBalls;
  if (params.pattern === 'triangle' || params.pattern === 'split-triangle') {
    const rackCount = count - (params.pattern === 'split-triangle' ? 2 : 0);
    let left = rackCount, row = 0;
    while (left > 0) {
      const inRow = Math.min(row + 1, left);
      for (let i = 0; i < inRow; i++) positions.push(local(-row * Math.sqrt(3) / 2, i - (inRow - 1) / 2));
      left -= inRow; row++;
    }
    if (params.pattern === 'split-triangle') positions.push(point(.57, .24), point(.57, .76));
  } else if (params.pattern === 'diamond') {
    const cells = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0]];
    for (const [along, across] of cells.slice(0, count)) positions.push(local(along, across));
  } else {
    const cells = [[.22, .24], [.22, .5], [.22, .76], [.4, .34], [.4, .66],
      [.57, .2], [.57, .5], [.57, .8], [.72, .3], [.72, .7], [.48, .5]];
    for (const [p, q] of cells.slice(0, count)) positions.push(point(p, q));
  }
  // A 320px landscape table has only ~12u on its short axis. Resolve any
  // compressed rack pairs without shrinking either target or player balls.
  const radius = params.ballRadius * u, clearance = radius * 2 + u * .07;
  const fit = p => { p.x = clamp(p.x, b.left + radius, b.right - radius); p.y = clamp(p.y, b.top + radius, b.bottom - radius); };
  for (const p of positions) fit(p);
  for (let pass = 0; pass < 36; pass++) {
    let moved = false;
    for (let i = 0; i < positions.length; i++) {
      const a = positions[i];
      for (const pocket of pockets) {
        const dx = a.x - pocket.x, dy = a.y - pocket.y, d = Math.hypot(dx, dy), safe = r + radius * .65;
        if (d >= safe) continue;
        const nx = d > 1e-8 ? dx / d : (b.left + b.right) / 2 > a.x ? 1 : -1;
        const ny = d > 1e-8 ? dy / d : 0;
        a.x += nx * (safe - d); a.y += ny * (safe - d); fit(a); moved = true;
      }
      for (let j = i + 1; j < positions.length; j++) {
        const c = positions[j], dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy);
        if (d >= clearance) continue;
        const nx = d > 1e-8 ? dx / d : 1, ny = d > 1e-8 ? dy / d : 0, push = (clearance - d) / 2;
        a.x -= nx * push; a.y -= ny * push; c.x += nx * push; c.y += ny * push;
        fit(a); fit(c); moved = true;
      }
    }
    if (!moved) break;
  }
  return {...b, vertical, pockets, positions, spawn};
}

export function poolAimTargets(world) {
  const targets = [], p = world.player;
  for (const ball of world.enemies) {
    if (ball.hp <= 0 || ball.captured) continue;
    for (const pocket of world.zones.filter(zone => zone.kind === 'pocket')) {
      const dx = pocket.x - ball.x, dy = pocket.y - ball.y, d = Math.hypot(dx, dy);
      if (d < 1e-8) continue;
      const ghost = {x: ball.x - dx / d * (p.r + ball.r), y: ball.y - dy / d * (p.r + ball.r)};
      const b = world.arenaBounds;
      if (ghost.x < b.left + p.r || ghost.x > b.right - p.r || ghost.y < b.top + p.r || ghost.y > b.bottom - p.r) continue;
      // A ghost behind the target relative to the cue is not a usable first
      // contact. This only defines the optional steady-hand candidate points.
      if ((ball.x - p.x) * dx + (ball.y - p.y) * dy <= 0) continue;
      targets.push(ghost);
    }
  }
  return targets;
}

function safeSpawn(world, desired) {
  const b = world.arenaBounds, r = world.player.r;
  const candidates = [desired];
  for (let ring = 1; ring <= 6; ring++) for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI / 8;
    candidates.push({x: clamp(desired.x + Math.cos(angle) * ring * r * 1.5, b.left + r, b.right - r),
      y: clamp(desired.y + Math.sin(angle) * ring * r * 1.5, b.top + r, b.bottom - r)});
  }
  let best = candidates[0], bestGap = -Infinity;
  for (const candidate of candidates) {
    const gap = Math.min(...world.enemies.filter(body => body.hp > 0).map(body => Math.hypot(body.x - candidate.x, body.y - candidate.y) - body.r - r),
      ...world.zones.filter(zone => zone.kind === 'pocket').map(zone => Math.hypot(zone.x - candidate.x, zone.y - candidate.y) - zone.r - r * .2));
    if (gap > bestGap) { bestGap = gap; best = candidate; }
    if (gap >= world.unit * .1) return candidate;
  }
  return best;
}

export function createPoolRules(world) {
  let params, layout;
  const live = () => world.enemies.filter(body => body.kind === 'pool-ball' && body.hp > 0 && !body.captured);
  const updateTutorial = () => {
    const targets = poolAimTargets(world);
    world.tutorialTarget = targets.sort((a, b) => Math.hypot(a.x - world.player.x, a.y - world.player.y) - Math.hypot(b.x - world.player.x, b.y - world.player.y))[0]
      || live()[0] || null;
  };
  const rebound = (body, zone, contact) => {
    const b = world.arenaBounds;
    let dx = body.x - zone.x, dy = body.y - zone.y, d = Math.hypot(dx, dy);
    if (d < 1e-8) { dx = (b.left + b.right) / 2 - zone.x; dy = (b.top + b.bottom) / 2 - zone.y; d = Math.hypot(dx, dy); }
    let nx = dx / Math.max(d, 1e-8), ny = dy / Math.max(d, 1e-8), distance = zone.r + world.unit * .03;
    const outside = zone.x + nx * distance < b.left + body.r || zone.x + nx * distance > b.right - body.r
      || zone.y + ny * distance < b.top + body.r || zone.y + ny * distance > b.bottom - body.r;
    if (outside) {
      dx = (b.left + b.right) / 2 - zone.x; dy = (b.top + b.bottom) / 2 - zone.y; d = Math.hypot(dx, dy);
      nx = dx / d; ny = dy / d;
    }
    const dot = body.vx * nx + body.vy * ny;
    if (dot < 0) { body.vx -= (1 + params.restitution) * dot * nx; body.vy -= (1 + params.restitution) * dot * ny; }
    body.x = zone.x + nx * distance; body.y = zone.y + ny * distance;
    world.clampBodyToArena(body);
    world.emit('campaignPocketReject', {kind: 'pool', bodyId: body.id, x: zone.x, y: zone.y,
      impactVx: contact.impactVx, impactVy: contact.impactVy});
  };
  return {
    physics: {nonlethal: true, restitution: .95, freezeTargetsIdle: true, settleAll: true},
    arenaBounds: () => poolBounds(world),
    setup(k) {
      params = poolParams(k); layout = poolLayout(world, params);
      world.budget = params.budget; world.poolPotted = 0; world.poolScratches = 0;
      world.poolShotPockets = 0; world.poolScratched = false; world.poolCaptures = []; world.poolLayout = layout;
      Object.assign(world.player, layout.spawn, {vx: 0, vy: 0, born: 1, solid: true, captured: false});
      for (let i = 0; i < layout.pockets.length; i++) world.addZone({kind: 'pocket', shape: 'circle',
        ...layout.pockets[i], r: params.pocketRadius * world.unit, centerOnly: true, pocketIndex: i});
      for (let i = 0; i < layout.positions.length; i++) {
        const p = layout.positions[i], body = world.makeBody(p.x, p.y, params.ballRadius * world.unit, world.player.mass);
        Object.assign(body, {kind: 'pool-ball', enemyType: 'normal', hp: Infinity, maxHp: Infinity,
          mass: world.player.mass, density: world.player.mass / params.ballRadius ** 2,
          restitution: params.restitution, drag: params.drag, value: 10, born: 1, solid: true, rackIndex: i});
        world.enemies.push(body);
      }
      updateTutorial();
    },
    onLaunch() { world.poolShotPockets = 0; world.poolScratched = false; },
    onZone(body, zone, contact = {}) {
      if (zone.kind !== 'pocket' || world.phase !== 'battle' || !world.shotActive || body.hp <= 0 || body.captured) return false;
      const speed = Math.hypot(body.vx, body.vy);
      if (speed >= params.pocketSpeedLimit * world.unit) { rebound(body, zone, contact); return false; }
      const snapshot = {...body}, event = {kind: 'pool', bodyId: body.id, bodySnapshot: snapshot, x: body.x, y: body.y,
        pocketX: zone.x, pocketY: zone.y, pocketIndex: zone.pocketIndex, r: body.r, player: body === world.player,
        combo: body === world.player ? 0 : world.poolShotPockets + 1};
      body.captured = true;
      world.emit('campaignPocket', event);
      if (body === world.player) {
        if (world.poolScratched) return true;
        world.poolScratched = true; world.poolScratches++;
        world.remaining = Math.max(0, world.remaining - params.scratchPenalty);
        world.emit('campaignScratch', {...event, penalty: params.scratchPenalty, remaining: world.remaining});
        world.requestLaunchEnd({reason: 'scratch'});
      } else {
        world.poolCaptures.push({...event, at: world.feedbackTime, age: 0, duration: .22});
        body.hp = 0; body.active = false;
        const nx = (zone.x - body.x) / Math.max(1e-8, Math.hypot(zone.x - body.x, zone.y - body.y));
        const ny = (zone.y - body.y) / Math.max(1e-8, Math.hypot(zone.x - body.x, zone.y - body.y));
        const impact = {attacker: world.player, nx, ny, contactX: zone.x, contactY: zone.y,
          impactVx: contact.impactVx ?? body.vx, impactVy: contact.impactVy ?? body.vy, source: 'pocket'};
        world.creditKill(body, impact, {...world.impactFeedback(body, 1, impact), feedbackLevel: ++world.feedbackKills}, 10);
        world.poolPotted++; world.poolShotPockets++;
        if (world.poolShotPockets === 2) world.beginCampaignSlow({duration: .3, scale: .3, kind: 'pool-double', x: zone.x, y: zone.y});
        world.peakOrigin = {x: zone.x, y: zone.y};
      }
      body.vx = body.vy = 0;
      return true;
    },
    onTick(dt) {
      for (const capture of world.poolCaptures) capture.age += dt;
      world.poolCaptures = world.poolCaptures.filter(capture => world.feedbackTime - capture.at < capture.duration);
    },
    onLaunchEnd() {
      if (world.poolScratched || world.player.captured) {
        const spawn = safeSpawn(world, layout.spawn);
        Object.assign(world.player, spawn, {captured: false, vx: 0, vy: 0, feedbackFreeze: 0, feedbackFreezeTotal: 0});
      }
      updateTutorial();
    },
    isWon: () => live().length === 0,
    isLost: () => !world.shotActive && world.remaining <= 0 && live().length > 0,
    rating: () => live().length ? 0 : world.shotsUsed <= params.targetBalls ? 3 : world.shotsUsed <= params.budget - 1 ? 2 : 1,
    summary: () => live().length ? `还差${live().length}球` : `${world.shotsUsed}发清台`,
    progress: () => ({remaining: live().length, total: params.targetBalls, scratches: world.poolScratches}),
    aimTargets: () => poolAimTargets(world),
    tutorialTarget: () => world.tutorialTarget,
    peakOptions: () => ({kind: 'pool', duration: .95, scale: .3, zoom: .04}),
    resize(previous) {
      const old = previous?.bounds || layout;
      const oldVertical = old.height >= old.width;
      layout = poolLayout(world, params); world.poolLayout = layout;
      const ratio = world.unit / (previous?.unit || world.unit);
      const mapPoint = point => {
        const p = oldVertical ? (point.y - old.top) / old.height : 1 - (point.x - old.left) / old.width;
        const q = oldVertical ? (point.x - old.left) / old.width : (point.y - old.top) / old.height;
        return layout.vertical ? {x: layout.left + q * layout.width, y: layout.top + p * layout.height}
          : {x: layout.left + (1 - p) * layout.width, y: layout.top + q * layout.height};
      };
      for (const body of [world.player, ...world.enemies]) {
        const before = previous?.positions?.get(body.id);
        if (before) Object.assign(body, mapPoint(before));
        if (oldVertical !== layout.vertical) {
          const vx = body.vx, vy = body.vy;
          body.vx = oldVertical ? -vy : vy; body.vy = oldVertical ? vx : -vx;
        }
        world.clampBodyToArena(body);
      }
      for (const capture of world.poolCaptures) {
        Object.assign(capture, mapPoint(capture));
        capture.r *= ratio;
        Object.assign(capture.bodySnapshot, {x: capture.x, y: capture.y, r: capture.r});
        if (oldVertical !== layout.vertical) capture.pocketIndex = (oldVertical ? [1, 3, 0, 2, 4, 5] : [2, 0, 3, 1, 4, 5])[capture.pocketIndex];
        const pocket = layout.pockets[capture.pocketIndex];
        capture.pocketX = pocket.x; capture.pocketY = pocket.y;
      }
      for (const zone of world.zones) if (zone.kind === 'pocket') {
        Object.assign(zone, layout.pockets[zone.pocketIndex], {r: params.pocketRadius * world.unit});
        zone.previousX = zone.x; zone.previousY = zone.y;
      }
      updateTutorial();
    },
  };
}
