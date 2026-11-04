import {clamp} from '../physics.js';

export function bricksParams(value) {
  const k = clamp(Math.floor(Number(value) || 0), 0, 9);
  return Object.freeze({kind: 'bricks', name: '落砖', goal: 30 + 10 * k, roundLimit: 25 + 5 * k,
    budget: 25 + 5 * k, ballCap: 12 + Math.floor(.9 * k), initialBalls: 4, initialRows: 3,
    columns: 6, brickChance: .55, pickupChance: .1, brickRadius: .8, ballRadius: .5,
    rowSpacing: 2.4, launchInterval: .12, shotDuration: 3.5, restitution: 1, wallRestitution: .98,
    hpScale: 1 + .15 * k});
}

// One fixed, level-specific integer hash. No Date/Math.random, retries, results,
// upgrade choice or viewport enters the cell draw; brick/+1/empty are disjoint.
export function bricksCell(k, row, column) {
  let x = (0x6b8b4567 ^ Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(row + 7, 0x85ebca6b) ^ Math.imul(column + 11, 0xc2b2ae35)) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
  const value = (x >>> 0) / 4294967296;
  return value < .55 ? 'brick' : value < .65 ? 'plus' : 'empty';
}

export function bricksBounds(world) {
  const inset = world.inset ?? 16, top = world.height > 520 ? 128 : 86;
  return {left: inset, right: world.width - inset, top, bottom: world.height - inset,
    width: world.width - inset * 2, height: world.height - inset - top};
}

export function bricksLayout(world, params = bricksParams(world.config?.k || 0)) {
  const b = bricksBounds(world), u = world.unit, vertical = b.height >= b.width;
  const crossLength = vertical ? b.width : b.height, length = vertical ? b.height : b.width;
  const first = 1.1 * u, launchAlong = length - 1.4 * u;
  const capacity = Math.max(4, Math.floor((launchAlong - first) / (params.rowSpacing * u)));
  // Fit whole rows to the player's actual launch line. The nominal 2.4u is
  // the minimum pitch, not an earlier invisible loss line above the player.
  const pitch = (launchAlong - first) / capacity;
  const spawn = vertical ? {x: (b.left + b.right) / 2, y: b.top + launchAlong}
    : {x: b.right - launchAlong, y: (b.top + b.bottom) / 2};
  return {...b, vertical, crossLength, length, pitch, first, launchAlong, capacity, spawn,
    cellWidth: crossLength / params.columns};
}

const gridPoint = (layout, row, column) => layout.vertical
  ? {x: layout.left + (column + .5) * layout.cellWidth, y: layout.top + layout.first + row * layout.pitch}
  : {x: layout.right - layout.first - row * layout.pitch, y: layout.top + (column + .5) * layout.cellWidth};

export function createBricksRules(world) {
  let params, layout;
  const bricks = () => world.statics.filter(body => body.kind === 'number-brick' && !body.dead && body.hp > 0);
  const resetPlayer = () => Object.assign(world.player, layout.spawn, {captured: false, vx: 0, vy: 0,
    pendingVx: 0, pendingVy: 0, feedbackFreeze: 0, feedbackFreezeTotal: 0});
  const updateVisibility = body => {
    const margin = layout.vertical ? body.y - body.r - layout.top : layout.right - body.x - body.r;
    body.buffered = margin < -1e-8;
    body.active = !body.buffered && !body.collected;
  };
  const updateTutorial = () => {
    world.tutorialTarget = bricks().filter(b => b.active !== false).sort((a, b) => b.gridRow - a.gridRow || Math.abs(a.gridColumn - 2.5) - Math.abs(b.gridColumn - 2.5))[0] || layout.spawn;
  };
  const addRow = (row, seedRow, roundNo) => {
    const rowId = ++world.bricksRowSerial, hp = Math.max(1, Math.round(roundNo * params.hpScale));
    let count = 0;
    for (let column = 0; column < params.columns; column++) {
      const cell = bricksCell(world.config.k, seedRow, column), position = gridPoint(layout, row, column);
      if (cell === 'brick') {
        count++;
        world.addStatic({...position, kind: 'number-brick', shape: 'circle', r: params.brickRadius * world.unit,
          hp, maxHp: hp, restitution: 1, gridRow: row, gridColumn: column, rowId, spawnedRound: roundNo});
      } else if (cell === 'plus') world.addZone({...position, kind: 'brick-plus', shape: 'circle',
        r: world.unit * .45, gridRow: row, gridColumn: column, rowId, oncePerShot: true});
    }
    world.bricksRows.set(rowId, {remaining: count, initial: count});
  };
  const launchBall = () => {
    const p = world.makeBody(layout.spawn.x, layout.spawn.y, params.ballRadius * world.unit, world.player.density);
    Object.assign(p, {kind: 'bricks-ball', isAuxiliary: true, isPlayer: true, hp: Infinity, maxHp: Infinity,
      born: 1, solid: true, damageScale: 1, vx: world.bricksLaunchVelocity.vx, vy: world.bricksLaunchVelocity.vy,
      campaignReleasedAt: world.time,
      feedbackFreeze: world.bricksLaunchFreeze, feedbackFreezeTotal: world.bricksLaunchFreeze});
    world.auxiliaries.push(p); world.bricksLaunched++;
    world.emit('campaignBrickBall', {bodyId: p.id, index: world.bricksLaunched, count: world.bricksVolleyCount,
      x: p.x, y: p.y, time: world.bricksVolleyTime});
  };
  const finishShift = () => {
    world.bricksShift = null;
    world.bricksOverflow = bricks().some(brick => brick.gridRow >= layout.capacity);
    resetPlayer(); updateTutorial();
  };
  const beginShift = () => {
    world.statics = world.statics.filter(body => body.kind !== 'number-brick' || !body.dead && body.hp > 0);
    world.zones = world.zones.filter(zone => zone.kind !== 'brick-plus' || !zone.collected);
    for (const body of [...world.statics, ...world.zones]) {
      body.shiftFromX = body.x; body.shiftFromY = body.y; body.gridRow++;
    }
    world.bricksRound = world.shotsUsed + 1;
    // The approved turn-based breath adaptation keeps every downward shift,
    // but accrues only 2/3 of a new-row interval during its 1.5s kill window.
    const breath = world.bricksBreathActive;
    world.bricksSpawnClock += breath ? 2 / 3 : 1;
    const generated = world.bricksSpawnClock >= 1 - 1e-10;
    if (generated) {
      world.bricksSpawnClock = Math.max(0, world.bricksSpawnClock - 1);
      addRow(0, world.bricksRound + params.initialRows - 2, world.bricksRound);
      for (const body of [...world.statics, ...world.zones]) if (body.shiftFromX === undefined) {
        const from = gridPoint(layout, -1, body.gridColumn); body.shiftFromX = from.x; body.shiftFromY = from.y;
      }
    }
    world.bricksShift = {at: world.feedbackTime, duration: .25};
    world.emit('campaignBrickRow', {round: world.bricksRound, generated, breath, spawnClock: world.bricksSpawnClock});
  };
  return {
    managesBudget: true,
    physics: {shotDuration: 3.5, settleSpeed: 3, settleDelay: 0, actorDrag: 0, playerDrag: 0, wallRestitution: .98},
    arenaBounds: () => bricksBounds(world),
    setup(k) {
      params = bricksParams(k); layout = bricksLayout(world, params); world.bricksLayout = layout;
      world.budget = params.budget; world.bricksRound = 1; world.bricksBroken = 0; world.bricksBallCount = params.initialBalls;
      world.bricksRows = new Map(); world.bricksRowSerial = 0; world.bricksRowsCleared = 0; world.bricksRoundRows = 0;
      world.bricksSpawnClock = 0; world.bricksLastKillTime = -Infinity; world.bricksOverflow = false;
      world.bricksBreathActive = false;
      world.bricksQueue = 0; world.bricksVolleyTime = 0; world.bricksLaunched = 0; world.bricksVolleyCount = 0;
      world.bricksReturns = []; world.bricksReturn = null; world.bricksShift = null; world.bricksHitCount = 0;
      for (let row = 0; row < params.initialRows; row++) addRow(row, row, 1);
      resetPlayer(); updateTutorial();
    },
    canLaunch: () => !world.bricksReturn && !world.bricksShift && !world.bricksOverflow,
    onLaunch({vx, vy} = {}) {
      world.bricksLaunchVelocity = {vx: vx ?? world.player.vx + (world.player.pendingVx || 0), vy: vy ?? world.player.vy + (world.player.pendingVy || 0)};
      world.bricksLaunchFreeze = world.player.feedbackFreeze || 0;
      world.player.captured = true; world.player.vx = world.player.vy = 0;
      world.auxiliaries = []; world.bricksVolleyTime = 0; world.bricksLaunched = 0;
      world.bricksVolleyCount = world.bricksBallCount; world.bricksQueue = world.bricksVolleyCount;
      world.bricksRoundRows = 0; world.bricksHitCount = 0; world.bricksQueue--; launchBall();
    },
    timeUntilBoundary: () => world.shotActive && world.bricksQueue > 0
      ? Math.max(1e-10, world.bricksLaunched * params.launchInterval - world.bricksVolleyTime) : Infinity,
    isSettled: () => world.bricksQueue === 0 && world.auxiliaries.every(body => Math.hypot(body.vx, body.vy) < 3 * world.unit),
    splitOptions: () => ({cap: params.ballCap, radius: .5, pending: world.bricksQueue, used: world.bricksLaunched}),
    onStaticHit(brick, contact, actor = contact.attacker || world.player) {
      if (brick.kind !== 'number-brick' || brick.dead || brick.active === false || !world.shotActive) return;
      const damage = actor.damageScale || 1;
      world.hitStatic(brick, damage, {...contact, attacker: actor, source: 'bricks'});
      world.bricksHitCount++;
      world.emit('campaignBrickHit', {x: brick.x, y: brick.y, bodyId: brick.id,
        note: Math.min(16, world.bricksHitCount), lethal: brick.dead, hp: brick.hp});
    },
    onKill(brick) {
      if (brick.kind !== 'number-brick') return;
      world.bricksBroken++; world.bricksLastKillTime = world.time;
      const row = world.bricksRows.get(brick.rowId);
      if (row && row.remaining > 0 && --row.remaining === 0) {
        world.bricksRowsCleared++; world.bricksRoundRows++;
        if (world.bricksRoundRows === 3) {
          world.beginCampaignSlow({duration: .4, scale: .3, kind: 'bricks-rows', x: brick.x, y: brick.y});
          world.emit('campaignBrickRows', {rows: 3, x: brick.x, y: brick.y});
        }
      }
      world.peakOrigin = {x: brick.x, y: brick.y};
    },
    onZone(body, zone) {
      if (zone.kind !== 'brick-plus' || zone.active === false || !body.isAuxiliary || !world.shotActive) return false;
      zone.collected = true; zone.active = false;
      const before = world.bricksBallCount; world.bricksBallCount = Math.min(params.ballCap, before + 1);
      world.emit('campaignBrickPlus', {x: zone.x, y: zone.y, count: world.bricksBallCount, added: world.bricksBallCount - before});
      return true;
    },
    onTick(dt) {
      if (world.shotActive) {
        world.bricksVolleyTime += dt;
        while (world.bricksQueue > 0 && world.bricksVolleyTime + 1e-9 >= world.bricksLaunched * params.launchInterval) {
          world.bricksQueue--; launchBall();
        }
      }
      world.bricksReturns = world.bricksReturns.filter(record => world.feedbackTime - record.at < record.duration);
      if (world.bricksReturn && world.feedbackTime >= world.bricksReturn.until) {
        world.bricksReturn = null;
        if (world.remaining > 0 && world.bricksBroken < params.goal) beginShift();
        else resetPlayer();
      }
      if (world.bricksShift) {
        const t = clamp((world.feedbackTime - world.bricksShift.at) / world.bricksShift.duration, 0, 1);
        const eased = world.feedbackOptions.reducedMotion ? 1 : 1 - (1 - t) ** 3;
        for (const body of [...world.statics, ...world.zones]) {
          const to = gridPoint(layout, body.gridRow, body.gridColumn);
          body.x = body.shiftFromX + (to.x - body.shiftFromX) * eased; body.y = body.shiftFromY + (to.y - body.shiftFromY) * eased;
          updateVisibility(body);
        }
        if (t >= 1) {
          for (const body of [...world.statics, ...world.zones]) { delete body.shiftFromX; delete body.shiftFromY; }
          finishShift();
        }
      }
    },
    onLaunchEnd({victory} = {}) {
      world.bricksQueue = 0;
      world.bricksBreathActive = !!world.buffs.breath && world.time < world.bricksLastKillTime + 1.5;
      world.bricksReturns = world.auxiliaries.map(body => ({bodySnapshot: {...body, isPlayer: true, isAuxiliary: true},
        fromX: body.x, fromY: body.y, x: body.x, y: body.y, toX: layout.spawn.x, toY: layout.spawn.y,
        at: world.feedbackTime, duration: .35}));
      world.auxiliaries = [];
      if (victory) { world.bricksReturn = null; resetPlayer(); }
      else world.bricksReturn = {until: world.feedbackTime + .35};
    },
    isWon: () => world.bricksBroken >= params.goal,
    isLost: () => !world.shotActive && !world.bricksReturn && !world.bricksShift && (world.bricksOverflow || world.remaining <= 0),
    rating: () => world.remaining >= params.roundLimit * .3 ? 3 : world.remaining >= params.roundLimit * .1 ? 2 : 1,
    summary: () => world.bricksBroken >= params.goal ? `${world.bricksBroken}砖 · 余${world.remaining}回合`
      : world.bricksOverflow ? '砖到达底线' : `差${params.goal - world.bricksBroken}砖`,
    progress: () => ({remaining: Math.max(0, params.goal - world.bricksBroken), total: params.goal}),
    tutorialTarget: () => world.tutorialTarget,
    resize(previous) {
      const old = layout; layout = bricksLayout(world, params);
      // Rotation changes the physical spacing, never the number of rows left
      // before the loss line in an already-running level.
      layout.capacity = old.capacity;
      layout.pitch = Math.max((layout.launchAlong - layout.first) / old.capacity, world.unit * 1.68);
      layout.first = layout.launchAlong - layout.pitch * layout.capacity;
      world.bricksLayout = layout;
      const ratio = world.unit / previous.unit;
      const mapPoint = p => {
        const along = old.vertical ? (p.y - old.top) / old.height : (old.right - p.x) / old.width;
        const cross = old.vertical ? (p.x - old.left) / old.width : (p.y - old.top) / old.height;
        return layout.vertical ? {x: layout.left + cross * layout.width, y: layout.top + along * layout.height}
          : {x: layout.right - along * layout.width, y: layout.top + cross * layout.height};
      };
      for (const body of [world.player, ...world.auxiliaries]) {
        const before = previous.positions?.get(body.id); if (before) Object.assign(body, mapPoint(before));
        if (old.vertical !== layout.vertical) { const vx = body.vx, vy = body.vy; body.vx = old.vertical ? -vy : vy; body.vy = old.vertical ? vx : -vx; }
      }
      if (world.bricksLaunchVelocity) {
        let {vx, vy} = world.bricksLaunchVelocity;
        if (old.vertical !== layout.vertical) [vx, vy] = old.vertical ? [-vy, vx] : [vy, -vx];
        world.bricksLaunchVelocity = {vx: vx * ratio, vy: vy * ratio};
      }
      for (const body of [...world.statics, ...world.zones]) {
        Object.assign(body, gridPoint(layout, body.gridRow, body.gridColumn));
        body.r *= ratio;
        if (world.bricksShift) {
          const from = gridPoint(layout, body.gridRow - 1, body.gridColumn);
          body.shiftFromX = from.x; body.shiftFromY = from.y;
          const t = clamp((world.feedbackTime - world.bricksShift.at) / world.bricksShift.duration, 0, 1);
          const eased = world.feedbackOptions.reducedMotion ? 1 : 1 - (1 - t) ** 3;
          body.x = from.x + (body.x - from.x) * eased; body.y = from.y + (body.y - from.y) * eased;
        }
        updateVisibility(body);
      }
      for (const record of world.bricksReturns) {
        const from = mapPoint({x: record.fromX, y: record.fromY});
        Object.assign(record, {fromX: from.x, fromY: from.y, x: from.x, y: from.y, toX: layout.spawn.x, toY: layout.spawn.y});
        Object.assign(record.bodySnapshot, {x: from.x, y: from.y, r: record.bodySnapshot.r * ratio});
      }
      if (!world.shotActive && !world.bricksReturn) resetPlayer();
      updateTutorial();
    },
  };
}
