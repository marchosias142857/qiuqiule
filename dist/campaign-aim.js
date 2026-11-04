// Campaign-only, first-contact guidance. This never advances the live world,
// predicts a moving target's future position, or changes endless aiming.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const EPS = 1e-5;
const alive = b => b.active !== false && !b.dead && !b.captured && b.hp !== 0;
const point = (p, d, t) => ({x: p.x + d.x * t, y: p.y + d.y * t});

function circleRay(p, d, center, radius) {
  const x = p.x - center.x, y = p.y - center.y, b = x * d.x + y * d.y;
  const c = x * x + y * y - radius * radius, disc = b * b - c;
  if (c <= EPS * Math.max(1, radius)) {
    const distance = Math.hypot(x, y);
    return b < -EPS && distance > EPS ? {t: 0, nx: x / distance, ny: y / distance} : null;
  }
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < EPS) return null;
  const at = point(p, d, t);
  return {t, nx: (at.x - center.x) / radius, ny: (at.y - center.y) / radius};
}
function shapeRay(p, d, shape, radius) {
  if (shape.shape !== 'rect') return circleRay(p, d, shape, shape.r + radius);
  const hx = shape.width / 2, hy = shape.height / 2;
  const cr = clamp(shape.cornerRadius || 0, 0, Math.min(hx, hy));
  const innerX = hx - cr, innerY = hy - cr, hits = [];
  for (const sign of [-1, 1]) {
    if (Math.abs(d.x) > EPS) {
      const t = (shape.x + sign * (hx + radius) - p.x) / d.x;
      if (t >= -EPS && d.x * sign < -EPS && Math.abs(p.y + d.y * t - shape.y) <= innerY + EPS) hits.push({t: Math.max(0, t), nx: sign, ny: 0});
    }
    if (Math.abs(d.y) > EPS) {
      const t = (shape.y + sign * (hy + radius) - p.y) / d.y;
      if (t >= -EPS && d.y * sign < -EPS && Math.abs(p.x + d.x * t - shape.x) <= innerX + EPS) hits.push({t: Math.max(0, t), nx: 0, ny: sign});
    }
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const center = {x: shape.x + sx * innerX, y: shape.y + sy * innerY};
    const hit = circleRay(p, d, center, cr + radius);
    if (hit) {
      const at = point(p, d, hit.t);
      if ((at.x - center.x) * sx >= -EPS && (at.y - center.y) * sy >= -EPS) hits.push(hit);
    }
  }
  return hits.sort((a, b) => a.t - b.t)[0] || null;
}
export function campaignAimContact(world, origin, direction, distance, radius = world.player.r, ignored = null) {
  const b = world.arenaBounds;
  let nearest = {t: distance, kind: 'end', body: null};
  const accept = hit => { if (hit && hit.t >= 0 && hit.t < nearest.t) nearest = hit; };
  for (const [axis, face, n] of [['x', b.left + radius, 1], ['x', b.right - radius, -1],
    ['y', b.top + radius, 1], ['y', b.bottom - radius, -1]]) {
    if (Math.abs(direction[axis]) < EPS) continue;
    const t = (face - origin[axis]) / direction[axis];
    if (direction[axis] * n < -EPS) accept({t: t >= -EPS ? Math.max(0, t) : t, kind: 'wall', body: null, nx: axis === 'x' ? n : 0, ny: axis === 'y' ? n : 0});
  }
  for (const body of [...(world.statics || []), ...(world.enemies || [])]) {
    if (body === ignored || !alive(body)) continue;
    const hit = shapeRay(origin, direction, body, radius);
    if (hit) accept({...hit, body, kind: world.enemies?.includes(body) ? 'ball' : 'static'});
  }
  return {...nearest, at: point(origin, direction, nearest.t)};
}

// Integrate only the scalar flight envelope: same drag, settling threshold and
// 4s/5s + .3s finish as CampaignWorld. Contacts are explained separately below.
export function campaignTravelEstimate(world, power) {
  const physics = world.rules?.physics || {}, drag = physics.actorDrag ?? physics.playerDrag ?? .6;
  let speed = Math.min(world.launchCap || Infinity, world.baseSpeed * power * (world.launchEnergyScale || 1));
  let time = 0, travelled = 0, low = 0, brakeAt = null;
  const dt = 1 / 120, threshold = world.unit * (physics.settleSpeed ?? 3);
  for (let i = 0; i < 640; i++) {
    if (brakeAt !== null && time >= brakeAt) speed *= Math.max(0, .3 - (time - brakeAt) - dt) / Math.max(EPS, .3 - (time - brakeAt));
    speed *= Math.exp(-drag * dt); travelled += speed * dt; time += dt;
    low = speed < threshold ? low + dt : 0;
    if (time >= 4 - EPS && brakeAt === null) brakeAt = speed > 6 * world.unit ? 5 : 4;
    if (brakeAt !== null && time >= brakeAt + .3 - EPS) break;
    if ((brakeAt === null || time < brakeAt) && low >= (physics.settleDelay ?? .4)) break;
  }
  return travelled;
}

export function campaignAimGuide(world, drag, {player = world?.player} = {}) {
  const empty = {segments: [], rings: [], power: 0, hit: null, arrow: null};
  if (!world || world.mode !== 'campaign' || !world.config?.implemented || world.isCampaignOffer || !player || !drag || drag.pending) return empty;
  const pull = Math.hypot(drag.dx, drag.dy);
  if (!Number.isFinite(pull) || pull <= 3) return empty;
  const power = clamp(pull / world.maxPull, 0, 1), u = world.unit, kind = world.config.classId;
  // Steady-hand aim follows the same bounded full-pull adjustment as release.
  // Compute the adjustment without changing the world's diagnostic state.
  let dx = drag.dx, dy = drag.dy;
  if (world.buffs?.steady && power >= 1 && world.rules?.aimTargets) {
    const heading = Math.atan2(-dy, -dx), cap = Math.PI / 90;
    let closest = cap + EPS;
    for (const target of world.rules.aimTargets()) {
      const a = Math.atan2(target.y - player.y, target.x - player.x) - heading;
      const delta = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(delta) <= cap && Math.abs(delta) < Math.abs(closest)) closest = delta;
    }
    if (Math.abs(closest) <= cap) { dx = -Math.cos(heading + closest) * pull; dy = -Math.sin(heading + closest) * pull; }
  }
  const direction = {x: -dx / pull, y: -dy / pull}, radius = world.player.r;
  const travel = campaignTravelEstimate(world, power);
  const length = kind === 'golf' ? travel : Math.min(travel, u * (kind === 'pool' ? 32 : 22));
  const hit = campaignAimContact(world, player, direction, Math.max(0, length), radius);
  const segments = [], rings = [];
  const addLine = (from, to, alpha = .48, role = 'aim') => {
    if (Math.hypot(to.x - from.x, to.y - from.y) > .1) segments.push({from, to, alpha, width: role === 'aim' ? 1.2 : 1, role});
  };
  const start = point(player, direction, Math.min(radius + u * .15, hit.t));
  addLine(start, hit.at);
  if (kind === 'pool' && hit.kind === 'ball') {
    rings.push({...hit.at, r: radius, alpha: .48, role: 'ghost'});
    const out = {x: -hit.nx, y: -hit.ny}, normal = direction.x * out.x + direction.y * out.y;
    const body = hit.body;
    const invA = 1 / Math.max(EPS, world.player.mass), invB = body.mass === Infinity ? 0 : 1 / Math.max(EPS, body.mass);
    const restitution = world.buffs?.rubber ? 1 : world.rules?.physics?.restitution ?? .95;
    const impulse = (1 + restitution) * Math.max(0, normal) / (invA + invB);
    const targetEnd = campaignAimContact(world, body, out, u * (1.8 + power * 2.2) * impulse * invB, body.r, body);
    addLine(point(body, out, body.r), targetEnd.at, .35, 'target');
    const cue = {x: direction.x - out.x * impulse * invA, y: direction.y - out.y * impulse * invA}, t = Math.hypot(cue.x, cue.y);
    if (t > .015) {
      const td = {x: cue.x / t, y: cue.y / t};
      addLine(hit.at, campaignAimContact(world, hit.at, td, u * 2 * t, radius, body).at, .22, 'cue');
    }
  } else if (kind === 'merge' && hit.kind === 'ball') {
    rings.push({x: hit.body.x, y: hit.body.y, r: hit.body.r + u * .12, alpha: .45, role: 'target'});
    const out = {x: -hit.nx, y: -hit.ny};
    addLine(point(hit.body, out, hit.body.r), campaignAimContact(world, hit.body, out, hit.body.r + u * (1 + power), hit.body.r, hit.body).at, .28, 'push');
  } else if (hit.kind === 'static' && world.buffs?.pierce && hit.body.pierceable !== false && world.rules?.canPierceStatic?.(hit.body, world.player) !== false) {
    rings.push({...hit.at, r: Math.max(2, radius * .4), alpha: .32, role: 'contact'});
    const continuation = campaignAimContact(world, point(hit.at, direction, .001), direction, Math.min(Math.max(0, length - hit.t), u * 4), radius, hit.body);
    addLine(hit.at, continuation.at, .23, 'pierce');
  } else if (hit.kind !== 'end') {
    rings.push({...hit.at, r: Math.max(2.2, radius * .45), alpha: .38, role: 'contact'});
    const dot = direction.x * hit.nx + direction.y * hit.ny;
    const restitution = hit.kind === 'wall' ? world.rules?.physics?.wallRestitution ?? (world.buffs?.rubber ? 1 : .95)
      : world.buffs?.rubber ? Math.min(1, (hit.body?.restitution ?? .95) + .06) : hit.body?.restitution ?? .95;
    const velocity = {x: direction.x - (1 + restitution) * dot * hit.nx, y: direction.y - (1 + restitution) * dot * hit.ny};
    const speed = Math.hypot(velocity.x, velocity.y), reflected = {x: velocity.x / speed, y: velocity.y / speed};
    const remaining = Math.max(0, length - hit.t), origin = point(hit.at, reflected, .001);
    const rebound = campaignAimContact(world, origin, reflected, Math.min(remaining, u * (kind === 'golf' ? 8 : 4)), radius, hit.body);
    addLine(origin, rebound.at, .23, 'rebound');
  } else {
    rings.push({...hit.at, r: kind === 'golf' ? radius * .75 : 2, alpha: .36, role: 'range'});
  }
  return {segments, rings, power, hit, arrow: null};
}

export function drawCampaignAim(g, world, drag, {player = world?.player, color = 0x252720} = {}) {
  const guide = campaignAimGuide(world, drag, {player});
  for (const line of guide.segments) {
    g.lineStyle(line.width, color, line.alpha); g.beginPath(); g.moveTo(line.from.x, line.from.y); g.lineTo(line.to.x, line.to.y); g.strokePath();
  }
  for (const ring of guide.rings) { g.lineStyle(1, color, ring.alpha); g.beginPath(); g.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2); g.strokePath(); }
  return guide;
}
