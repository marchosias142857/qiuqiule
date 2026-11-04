import {staticContact} from '../campaign-collision.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function golfParams(value) {
  const k = clamp(Math.floor(Number(value) || 0), 0, 9), par = 2 + Math.floor(k / 3);
  return Object.freeze({kind: 'golf', name: '推杆', staticCount: 1 + Math.floor(k / 2),
    walkers: 1 + Math.floor(k / 3), walkerSpeed: 1.5, walkerRadius: .8,
    holeRadius: 1.3, captureSpeed: 12, par, budget: par + 2,
    movingHole: k >= 6, holeSpeed: k >= 6 ? 1 + (k - 6) / 6 : 0, holeTravel: 2.6,
    restitution: .95});
}

// Fixed layouts are engineering completion of the PDF's corner/obstacle
// description. They do not change between attempts or depend on performance.
const LAYOUTS = [
  {start: [.5, .87], hole: [.5, .18], bricks: [[.23, .5, 'h']]},
  {start: [.28, .85], hole: [.72, .20], bricks: [[.48, .56, 'h']]},
  {start: [.23, .85], hole: [.76, .18], bricks: [[.38, .67, 'v'], [.65, .40, 'h']]},
  {start: [.22, .85], hole: [.85, .12], bricks: [[.44, .56, 'v'], [.7, .33, 'h']]},
  {start: [.78, .86], hole: [.15, .12], bricks: [[.64, .64, 'h'], [.38, .45, 'v'], [.65, .25, 'h']]},
  {start: [.18, .83], hole: [.86, .16], bricks: [[.38, .66, 'h'], [.58, .46, 'v'], [.30, .23, 'h']]},
  {start: [.2, .88], hole: [.78, .16], bricks: [[.37, .71, 'h'], [.68, .57, 'h'], [.45, .36, 'v'], [.21, .17, 'h']]},
  {start: [.8, .86], hole: [.23, .15], bricks: [[.67, .70, 'h'], [.37, .55, 'h'], [.61, .35, 'v'], [.8, .18, 'h']]},
  {start: [.18, .87], hole: [.78, .13], bricks: [[.36, .73, 'v'], [.64, .62, 'h'], [.38, .46, 'h'], [.64, .34, 'v'], [.26, .16, 'h']]},
  {start: [.81, .87], hole: [.22, .13], bricks: [[.65, .72, 'v'], [.36, .62, 'h'], [.61, .46, 'h'], [.37, .34, 'v'], [.79, .16, 'h']]},
];

export function golfLayout(world, params = world.config) {
  const u = world.unit, b = world.arenaBounds, k = params.k ?? 0, spec = LAYOUTS[k];
  const top = Math.max(world.height > 520 ? 112 : 76, b.top) + 1.5 * u;
  const left = b.left + 1.6 * u, right = b.right - 1.6 * u, bottom = b.bottom - 1.5 * u;
  const width = right - left, height = bottom - top;
  const point = ([x, y]) => ({x: left + width * x, y: top + height * y});
  const available = Math.max(2.3 * u, Math.min(3.2 * u, height * .25));
  const bricks = spec.bricks.map(([x, y, orientation]) => ({...point([x, y]),
    width: orientation === 'h' ? available : .8 * u,
    height: orientation === 'v' ? available : .8 * u, cornerRadius: .22 * u}));
  const hole = point(spec.hole), start = point(spec.start);
  // All short tracks stay at least a radius from the physical border.
  const excursion = params.movingHole ? Math.min(params.holeTravel * u / 2,
    hole.x - b.left - params.holeRadius * u, b.right - params.holeRadius * u - hole.x) : 0;
  return {left, right, top, bottom, width, height, bricks, hole, start, excursion};
}

function entryContact(body, zone, previous) {
  const ax = (previous?.x ?? body.x) - (zone.previousX ?? zone.x);
  const ay = (previous?.y ?? body.y) - (zone.previousY ?? zone.y);
  const bx = body.x - zone.x, by = body.y - zone.y, dx = bx - ax, dy = by - ay;
  const a = dx * dx + dy * dy, closest = a > 1e-12 ? clamp(-(ax * dx + ay * dy) / a, 0, 1) : 0;
  if (Math.hypot(ax + dx * closest, ay + dy * closest) >= zone.r) return null;
  let t = 0;
  const c = ax * ax + ay * ay - zone.r * zone.r;
  if (c > 0 && a > 1e-12) {
    const b = 2 * (ax * dx + ay * dy), discriminant = Math.max(0, b * b - 4 * a * c);
    t = clamp((-b - Math.sqrt(discriminant)) / (2 * a), 0, 1);
  }
  let nx = ax + dx * t, ny = ay + dy * t, distance = Math.hypot(nx, ny);
  if (distance < 1e-8) { nx = -(body.vx - (zone.vx || 0)); ny = -(body.vy - (zone.vy || 0)); distance = Math.hypot(nx, ny); }
  if (distance < 1e-8) { nx = 0; ny = 1; distance = 1; }
  return {nx: nx / distance, ny: ny / distance, t};
}

export function createGolfRules(world) {
  let params, board, hole, bricks = [], walkers = [], clock = 0, won = false;
  let initialDistance = 1, lastRejectAt = -Infinity;
  const updateHole = () => {
    const amplitude = board.excursion;
    const distance = params.holeSpeed * world.unit * clock;
    const period = 4 * amplitude;
    const offset = amplitude > 0 ? amplitude - Math.abs(((distance + amplitude) % period) - 2 * amplitude) : 0;
    hole.x = board.hole.x + offset; hole.y = board.hole.y;
    if (amplitude > 0) {
      const phase = (distance + amplitude) % period;
      hole.vx = (phase < 2 * amplitude ? 1 : -1) * params.holeSpeed * world.unit;
    } else hole.vx = 0;
    hole.vy = 0;
  };
  const releaseWalkers = () => {
    const u = world.unit, placed = [];
    for (const [index, walker] of walkers.entries()) {
      const origin = {x: walker.x, y: walker.y};
      const fit = point => ({x: clamp(point.x, board.left + walker.r, board.right - walker.r),
        y: clamp(point.y, board.top + walker.r, board.bottom - walker.r)});
      const clear = point => {
        if (bricks.some(brick => (staticContact({...walker, ...point}, brick)?.depth || 0) > 1e-6)) return false;
        return [world.player, hole, ...placed].every(other => Math.hypot(point.x - other.x, point.y - other.y) >= walker.r + other.r + u * .05);
      };
      let position = fit(origin);
      if (!clear(position)) {
        // Find the nearest deterministic open placement, retaining velocity
        // and all game state. This prevents a first-frame separation jump.
        for (let attempt = 0; attempt < 384; attempt++) {
          const angle = attempt * Math.PI * (3 - Math.sqrt(5)) + index;
          const distance = u * 8 * Math.sqrt((attempt + 1) / 384);
          const candidate = fit({x: origin.x + Math.cos(angle) * distance, y: origin.y + Math.sin(angle) * distance});
          if (clear(candidate)) { position = candidate; break; }
        }
      }
      Object.assign(walker, position); placed.push(walker);
    }
  };
  const layout = (initial = false, previous = null) => {
    board = golfLayout(world, params);
    for (const [i, brick] of bricks.entries()) Object.assign(brick, board.bricks[i]);
    hole.r = params.holeRadius * world.unit; updateHole();
    hole.previousX = hole.x; hole.previousY = hole.y;
    if (initial) {
      Object.assign(world.player, board.start, {vx: 0, vy: 0, born: 1, solid: true});
      initialDistance = Math.hypot(hole.x - world.player.x, hole.y - world.player.y);
      for (const [i, walker] of walkers.entries()) {
        // The first teaching lane is clear; its single moving obstacle starts
        // off to one side rather than covering the demonstrated straight putt.
        const nx = params.k === 0 ? .81 : .19 + (i + 1) / (walkers.length + 1) * .62;
        const ny = params.k === 0 ? .58 : .3 + i * .13;
        const angle = params.k === 0 ? .65 : .55 + i * 2.3;
        Object.assign(walker, {x: board.left + board.width * nx, y: board.top + board.height * ny,
          r: params.walkerRadius * world.unit, vx: Math.cos(angle) * params.walkerSpeed * world.unit,
          vy: Math.sin(angle) * params.walkerSpeed * world.unit, angle});
      }
    } else {
      for (const walker of walkers) {
        walker.x = clamp(walker.x, board.left + walker.r, board.right - walker.r);
        walker.y = clamp(walker.y, board.top + walker.r, board.bottom - walker.r);
      }
      initialDistance = Math.hypot(board.hole.x - board.start.x, board.hole.y - board.start.y);
    }
    if (won) {
      Object.assign(world.player, {x: hole.x, y: hole.y});
      if (world.golfCapture) {
        const capture = world.golfCapture, snapshot = capture.bodySnapshot;
        if (previous && snapshot) {
          snapshot.x *= world.width / previous.width; snapshot.y *= world.height / previous.height;
          snapshot.r *= world.unit / previous.unit;
        }
        Object.assign(capture, {x: hole.x, y: hole.y, pocketX: hole.x, pocketY: hole.y});
      }
    }
    if (!initial && !won) world.releaseOverlaps?.();
    releaseWalkers();
    world.golfLayout = board;
  };
  return {
    physics: {nonlethal: true, restitution: .95, freezeTargetsIdle: false, settleAll: false},
    setup(k = world.config.k) {
      params = {...golfParams(k), ...world.config, k};
      world.budget = params.budget; world.remaining = params.budget;
      for (let i = 0; i < params.staticCount; i++) bricks.push(world.addStatic({kind: 'obstacle', shape: 'rect',
        x: 0, y: 0, width: 1, height: 1, hp: Infinity, maxHp: Infinity, restitution: .95}));
      hole = world.addZone({kind: 'hole', shape: 'circle', x: 0, y: 0, r: params.holeRadius * world.unit,
        centerOnly: true, continuous: true, active: true, moving: params.movingHole, vx: 0, vy: 0});
      for (let i = 0; i < params.walkers; i++) {
        const walker = world.makeBody(0, 0, params.walkerRadius * world.unit, .8);
        Object.assign(walker, {hp: Infinity, maxHp: Infinity, born: 1, solid: true, drag: 0,
          value: 0, golfWalker: true, enemyType: 'walker'});
        world.enemies.push(walker); walkers.push(walker);
      }
      world.targetsRemaining = world.totalTargets = 1;
      layout(true);
    },
    onTick(dt) {
      if (!won) clock += dt;
      hole.previousX = hole.x; hole.previousY = hole.y;
      updateHole();
      if (won) hole.vx = hole.vy = 0;
      for (const walker of walkers) {
        const speed = Math.hypot(walker.vx, walker.vy), angle = speed > 1e-8 ? Math.atan2(walker.vy, walker.vx) : walker.angle;
        walker.vx = Math.cos(angle) * params.walkerSpeed * world.unit;
        walker.vy = Math.sin(angle) * params.walkerSpeed * world.unit;
        if (walker.x < board.left + walker.r) { walker.x = board.left + walker.r; walker.vx = Math.abs(walker.vx); }
        if (walker.x > board.right - walker.r) { walker.x = board.right - walker.r; walker.vx = -Math.abs(walker.vx); }
        if (walker.y < board.top + walker.r) { walker.y = board.top + walker.r; walker.vy = Math.abs(walker.vy); }
        if (walker.y > board.bottom - walker.r) { walker.y = board.bottom - walker.r; walker.vy = -Math.abs(walker.vy); }
      }
    },
    onStaticHit(body, contact) { world.staticFeedback(body, contact, {lethal: false}); },
    onZone(body, zone, contact = {}) {
      if (won || zone !== hole || body !== world.player || !world.shotActive) return false;
      const entry = entryContact(body, hole, contact.previous);
      if (!entry) return false;
      const speed = Math.hypot(body.vx, body.vy);
      if (speed < params.captureSpeed * world.unit) {
        won = true; world.targetsRemaining = 0; world.golfHoleInOne = world.shotsUsed === 1;
        world.peakOrigin = {x: hole.x, y: hole.y};
        world.golfCapture = {x: hole.x, y: hole.y, pocketX: hole.x, pocketY: hole.y,
          at: world.feedbackTime, bodySnapshot: {...body}, duration: .22, player: true, shot: world.shotsUsed};
        body.captured = true; body.vx = body.vy = 0;
        // Logical capture location is the hole; the renderer animates the saved
        // pose into it, keeping the subsequent result transition continuous.
        body.x = hole.x; body.y = hole.y;
        world.awardCampaignPoints(100, {source: 'golf', x: hole.x, y: hole.y, holeInOne: world.shotsUsed === 1});
        world.emit('campaignGolfCapture', {x: hole.x, y: hole.y, holeInOne: world.shotsUsed === 1});
        return true;
      }
      const {nx, ny} = entry;
      body.x = hole.x + nx * (hole.r + world.unit * .04);
      body.y = hole.y + ny * (hole.r + world.unit * .04);
      const relative = (body.vx - hole.vx) * nx + (body.vy - hole.vy) * ny;
      if (relative < 0) { body.vx -= (1 + params.restitution) * relative * nx; body.vy -= (1 + params.restitution) * relative * ny; }
      body.campaignSquintUntil = world.feedbackTime + .3;
      if (world.feedbackTime - lastRejectAt > .05) {
        lastRejectAt = world.feedbackTime;
        world.emit('campaignRim', {x: hole.x, y: hole.y, r: hole.r, bodyId: body.id,
          impactVx: contact.impactVx ?? body.vx, impactVy: contact.impactVy ?? body.vy});
      }
      return true;
    },
    isWon: () => won,
    isLost: () => !won && !world.shotActive && world.remaining <= 0,
    rating: () => !won ? 0 : world.shotsUsed <= params.par - 1 ? 3 : world.shotsUsed <= params.par ? 2 : 1,
    summary: () => won ? `${world.shotsUsed} 杆 · 标准 ${params.par}` : world.remaining <= 0 ? `超杆 ${world.shotsUsed - params.par}` : `标准 ${params.par} 杆`,
    progress: () => won ? 1 : clamp(1 - Math.hypot(world.player.x - hole.x, world.player.y - hole.y) / initialDistance, 0, .95),
    peakOptions: () => ({kind: 'golf', crown: world.shotsUsed === 1, duration: world.shotsUsed === 1 ? 1 : .7,
      scale: world.shotsUsed === 1 ? .25 : .4, zoom: world.shotsUsed === 1 ? .04 : .025}),
    tutorialTarget: () => ({x: hole.x, y: hole.y}),
    aimTargets: () => [{x: hole.x, y: hole.y}],
    resize: previous => layout(false, previous),
  };
}

export const classParams = golfParams;
export const createRules = createGolfRules;
