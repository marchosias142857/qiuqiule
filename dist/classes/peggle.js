// PDF §8.3, r=0. Counts use nearest integer for total pins and floor for
// targets: that is the one rounding policy matching all four printed examples.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const TAU = Math.PI * 2;

export function peggleParams(difficulty) {
  const k = clamp(Math.floor(Number(difficulty) || 0), 0, 9);
  return Object.freeze({
    kind: 'peggle', name: '钉板狂热',
    totalPegs: Math.round(36 + 1.33 * k), targetPegs: Math.floor(18 + .9 * k),
    budget: 10 - Math.floor(k / 3), pegRadius: .45, restitution: .95,
    bucketWidth: 2.2, bucketSpeed: 1.2, movingPegs: k >= 8 ? 2 : 0,
    pattern: k < 3 ? 'arcs' : k < 6 ? 'grid' : k < 8 ? 'spiral' : 'mixed',
    peakDuration: 1.2, peakTimeScale: .25, peakZoom: .06, remainingBallValue: 10,
  });
}

// Pin size is physical and stays .45u. Only the spacing/layout fits the screen;
// neither player radius nor pin count changes on short landscape viewports.
export function peggleLayout(world, params = world.config) {
  const u = world.unit, b = world.arenaBounds;
  const left = b.left + 1.7 * u, right = b.right - 1.7 * u;
  const hudBottom = world.height > 520 ? 112 : 76;
  const top = Math.max(hudBottom + params.pegRadius * u, b.top + 2.6 * u, Math.min(100, world.height * .22));
  const bottom = Math.max(top + 5.6 * u, Math.min(world.height * .64, b.bottom - 4.5 * u));
  const width = right - left, height = bottom - top, count = params.totalPegs;
  const positions = [];
  if (params.pattern === 'spiral') {
    // A pair of interleaved Fermat arms leaves the centre open rather than
    // stacking circles on a small-radius circular spiral.
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const radius = Math.sqrt((i + .7) / count), angle = i * golden;
      positions.push({x: left + width * (.5 + .47 * radius * Math.cos(angle)),
        y: top + height * (.5 + .47 * radius * Math.sin(angle))});
    }
  } else {
    const columns = params.pattern === 'arcs' ? 6 : 8;
    const rows = Math.ceil(count / columns);
    let index = 0;
    for (let row = 0; row < rows; row++) {
      const inRow = Math.min(columns, count - index);
      for (let column = 0; column < inRow; column++, index++) {
        const nx = (column + .5 + (columns - inRow) / 2) / columns;
        const base = (row + .5) / rows;
        const arc = params.pattern === 'arcs' ? (.5 - Math.abs(nx - .5)) * .7 / rows
          : params.pattern === 'mixed' ? Math.sin(nx * TAU + row * .7) * .16 / rows : 0;
        positions.push({x: left + width * nx, y: top + height * (base + arc)});
      }
    }
  }
  // Elliptical spirals compress on very short screens. Resolve that spacing
  // geometrically instead of shrinking pins or dropping targets.
  const separation = 1.02 * u;
  for (let pass = 0; pass < 24; pass++) {
    let changed = false;
    for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i], c = positions[j], dx = c.x - a.x, dy = c.y - a.y;
      const distance = Math.hypot(dx, dy);
      if (distance >= separation - 1e-7) continue;
      const nx = distance > 1e-8 ? dx / distance : 1, ny = distance > 1e-8 ? dy / distance : 0;
      const correction = (separation - distance) / 2 + 1e-7;
      a.x = clamp(a.x - nx * correction, left, right); a.y = clamp(a.y - ny * correction, top, bottom);
      c.x = clamp(c.x + nx * correction, left, right); c.y = clamp(c.y + ny * correction, top, bottom);
      changed = true;
    }
    if (!changed) break;
  }
  return {left, right, top, bottom, positions};
}

export function createPeggleRules(world) {
  let params, pins = [], bucket, remainingTargets = 0, shotHits = 0;
  let bucketDirection = 1, clock = 0, peak = false;
  const targetCount = () => remainingTargets;
  const targetPoint = () => {
    const p = world.player;
    const targets = pins.filter(pin => pin.active !== false && pin.target && !pin.hitThisShot);
    const nearest = targets.reduce((best, pin) => !best || Math.hypot(pin.x - p.x, pin.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y) ? pin : best, null);
    if (nearest && params?.k === 0 && !(world.shotsUsed > 0)) {
      // Demonstrate an oblique first shot. A centre-to-centre hit on the nearest
      // bottom pin merely returns the ball to the floor on a tall phone.
      const wide = world.width / world.height > 2;
      const outer = targets.filter(pin => pin.x > world.width * .65).sort((a, b) => b.y - a.y)[0] || nearest;
      const chosen = wide ? nearest : outer;
      const offset = wide ? (world.upgradeId === 'bank' || world.upgradeId === 'pierce' ? 0 : -.13)
        : world.height / world.width > 1.9 ? .13 : 0;
      const distance = Math.hypot(chosen.x - p.x, chosen.y - p.y);
      const angle = Math.atan2(chosen.y - p.y, chosen.x - p.x) + offset;
      return {x: p.x + Math.cos(angle) * distance, y: p.y + Math.sin(angle) * distance};
    }
    return nearest ? {x: nearest.x, y: nearest.y} : {x: world.width / 2, y: world.height / 3};
  };
  const bucketLimits = () => {
    const b = world.arenaBounds;
    return {left: b.left + bucket.width / 2, right: b.right - bucket.width / 2};
  };
  const setMovingPins = () => {
    if (!params.movingPegs) return;
    const sorted = pins.slice().sort((a, b) => a.baseX - b.baseX);
    const left = sorted[0], right = sorted.at(-1);
    Object.assign(left, {moving: true, moveDirection: -1});
    Object.assign(right, {moving: true, moveDirection: 1});
  };
  const layout = (initial = false) => {
    const board = peggleLayout(world, params), u = world.unit, b = world.arenaBounds;
    for (const [index, pin] of pins.entries()) {
      const position = board.positions[index];
      Object.assign(pin, {x: position.x, y: position.y, baseX: position.x, baseY: position.y,
        previousX: position.x, previousY: position.y, r: params.pegRadius * u});
    }
    setMovingPins();
    for (const pin of pins) if (pin.moving) {
      const distance = u * .45 * (1 - Math.cos(clock * TAU / 3.2)) / 2;
      pin.x = pin.baseX + pin.moveDirection * distance;
      pin.previousX = pin.x;
      pin.vx = pin.moveDirection * u * .45 * Math.sin(clock * TAU / 3.2) * Math.PI / 3.2;
    }
    const oldLimits = bucket && bucket._limits;
    const fraction = oldLimits ? clamp((bucket.x - oldLimits.left) / Math.max(1, oldLimits.right - oldLimits.left), 0, 1) : .5;
    Object.assign(bucket, {width: params.bucketWidth * u, height: .5 * u,
      y: b.bottom - world.player.r - .15 * u, visualY: b.bottom - .25 * u, visualHeight: .5 * u});
    const limits = bucketLimits(); bucket._limits = limits;
    bucket.x = limits.left + (limits.right - limits.left) * fraction;
    bucket.previousX = bucket.x; bucket.previousY = bucket.y;
    if (initial) Object.assign(world.player, {x: world.width / 2, y: b.bottom - 3 * u, vx: 0, vy: 0, born: 1, solid: true});
    world.pegBoard = board;
    world.tutorialTarget = targetPoint;
  };
  return {
    setup(k = world.config.k) {
      params = {...peggleParams(k), ...world.config};
      world.budget = params.budget; world.remaining = params.budget;
      remainingTargets = params.targetPegs;
      for (let index = 0; index < params.totalPegs; index++) {
        // Distribute the exact target count throughout the whole board. The
        // layout is fixed for a level so a retry can teach a repeatable route.
        const target = Math.floor((index + 1) * params.targetPegs / params.totalPegs) > Math.floor(index * params.targetPegs / params.totalPegs);
        pins.push(world.addStatic({kind: 'peg', shape: 'circle', x: 0, y: 0, r: params.pegRadius * world.unit,
          hp: 1, maxHp: 1, restitution: params.restitution, active: true,
          target, hitThisShot: false, hit: 0, index, moving: false}));
      }
      bucket = world.addZone({kind: 'bucket', shape: 'rect', x: world.width / 2, y: 0,
        width: params.bucketWidth * world.unit, height: .5 * world.unit,
        centerOnly: true, oncePerShot: true, active: true});
      world.targetsRemaining = remainingTargets; world.totalTargets = params.targetPegs;
      layout(true);
    },
    onLaunch() { shotHits = 0; },
    onStaticHit(pin, contact = {}) {
      if (pin.kind !== 'peg' || !world.shotActive || pin.active === false || pin.hitThisShot || peak) return;
      pin.hitThisShot = true; pin.hit = 1; shotHits++;
      if (pin.target) remainingTargets--;
      world.targetsRemaining = remainingTargets;
      world.awardCampaignPoints(10, {source: 'peg', target: pin.target, x: pin.x, y: pin.y, combo: shotHits});
      world.maxCombo = Math.max(world.maxCombo || 0, shotHits);
      world.totalKills = (world.totalKills || 0) + 1;
      world.emit('campaignPegHit', {x: pin.x, y: pin.y, r: pin.r, bodyId: pin.id,
        target: pin.target, combo: shotHits, feedbackLevel: shotHits, ...contact});
      if (shotHits === 8) world.emit('campaignPegRun', {x: pin.x, y: pin.y, combo: shotHits});
      if (remainingTargets === 0) { peak = true; world.peakOrigin = {x: pin.x, y: pin.y}; }
    },
    onTick(dt) {
      clock += dt;
      for (const pin of pins) {
        pin.hit = Math.max(0, pin.hit - dt * 4);
        pin.previousX = pin.x; pin.previousY = pin.y;
        if (pin.moving && pin.active !== false) {
          // Two outward-only .45u tracks at high difficulty; the direction
          // never pushes a moving pin into the rest of the pattern.
          const distance = world.unit * .45 * (1 - Math.cos(clock * TAU / 3.2)) / 2;
          pin.x = pin.baseX + pin.moveDirection * distance;
          pin.vx = dt > 0 ? (pin.x - pin.previousX) / dt : 0;
          pin.vy = 0;
        }
      }
      bucket.previousX = bucket.x; bucket.previousY = bucket.y;
      const limits = bucketLimits();
      bucket.x += bucketDirection * params.bucketSpeed * world.unit * dt;
      if (bucket.x > limits.right) { bucket.x = limits.right - (bucket.x - limits.right); bucketDirection = -1; }
      if (bucket.x < limits.left) { bucket.x = limits.left + (limits.left - bucket.x); bucketDirection = 1; }
      bucket.x = clamp(bucket.x, limits.left, limits.right); bucket._limits = limits;
    },
    onZone(body, zone, contact = {}) {
      if (zone !== bucket || body !== world.player || !world.shotActive || peak) return false;
      // Catch only a downward crossing through the open top. A bucket that
      // moves beneath a resting ball, or a launch already inside the strip,
      // cannot mint extra balls.
      if (!(body.vy > 0) || !(contact.previous?.y < zone.y - zone.height / 2)) return false;
      if (!world.grantFreeBall(zone)) return false;
      world.endLaunch({reason: 'bucket'});
      Object.assign(body, {x: world.width / 2, y: world.arenaBounds.bottom - 3 * world.unit,
        vx: 0, vy: 0, feedbackFreeze: 0});
      return true;
    },
    onLaunchEnd() {
      for (const pin of pins) {
        if (!pin.hitThisShot || pin.active === false) continue;
        pin.active = false;
        world.emit('shatter', {x: pin.x, y: pin.y, r: pin.r, vx: 0, vy: 0,
          bodyId: pin.id, source: 'peg', target: pin.target});
      }
    },
    isWon: () => remainingTargets === 0,
    isLost: () => world.remaining <= 0 && !world.shotActive && remainingTargets > 0,
    rating: () => remainingTargets > 0 ? 0 : world.remaining >= 3 ? 3 : world.remaining >= 1 ? 2 : 1,
    summary: () => remainingTargets > 0 ? `差 ${remainingTargets} 钉` : `剩余 ${world.remaining} 球`,
    progress: () => 1 - remainingTargets / Math.max(1, params.targetPegs),
    remainingTargets: targetCount,
    tutorialTarget: targetPoint,
    resize: () => layout(false),
  };
}

// Descriptive aliases let future class registries use one common interface.
export const classParams = peggleParams;
export const createRules = createPeggleRules;
