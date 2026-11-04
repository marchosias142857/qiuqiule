// Campaign-only geometry. The endless solver and its collision boundaries are
// deliberately not involved in static obstacles or nonblocking trigger zones.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const EPSILON = 1e-7;

export function staticContact(body, shape, margin = 0) {
  if (shape.active === false || shape.dead) return null;
  const dx = body.x - shape.x, dy = body.y - shape.y;
  if (shape.shape === 'arc') {
    const tau = Math.PI * 2, start = shape.startAngle || 0;
    const sweep = clamp(shape.sweepAngle ?? tau, -tau, tau), direction = sweep < 0 ? -1 : 1;
    const angle = Math.atan2(dy, dx), relative = ((angle - start) * direction % tau + tau) % tau;
    let closestAngle = angle;
    if (relative > Math.abs(sweep)) {
      const end = start + sweep;
      const startDistance = Math.hypot(dx - Math.cos(start) * shape.r, dy - Math.sin(start) * shape.r);
      const endDistance = Math.hypot(dx - Math.cos(end) * shape.r, dy - Math.sin(end) * shape.r);
      closestAngle = startDistance <= endDistance ? start : end;
    }
    const px = Math.cos(closestAngle) * shape.r, py = Math.sin(closestAngle) * shape.r;
    const ex = dx - px, ey = dy - py, distance = Math.hypot(ex, ey);
    const halfWidth = Math.max(0, shape.width || 0) / 2, sum = body.r + halfWidth + margin;
    if (distance > sum + EPSILON) return null;
    const nx = distance > EPSILON ? ex / distance : -Math.cos(closestAngle);
    const ny = distance > EPSILON ? ey / distance : -Math.sin(closestAngle);
    return {nx, ny, depth: sum - distance,
      x: shape.x + px + nx * halfWidth, y: shape.y + py + ny * halfWidth};
  }
  if (shape.shape === 'circle' || !Number.isFinite(shape.width)) {
    const distance = Math.hypot(dx, dy), sum = body.r + shape.r + margin;
    if (distance > sum + EPSILON) return null;
    const nx = distance > EPSILON ? dx / distance : 1;
    const ny = distance > EPSILON ? dy / distance : 0;
    return {nx, ny, depth: sum - distance, x: shape.x + nx * shape.r, y: shape.y + ny * shape.r};
  }
  const hx = shape.width / 2, hy = shape.height / 2;
  const radius = clamp(shape.cornerRadius || 0, 0, Math.min(hx, hy));
  const qx = clamp(dx, -hx + radius, hx - radius), qy = clamp(dy, -hy + radius, hy - radius);
  const ex = dx - qx, ey = dy - qy, distance = Math.hypot(ex, ey);
  if (distance > EPSILON) {
    const gap = distance - radius;
    if (gap > body.r + margin + EPSILON) return null;
    const nx = ex / distance, ny = ey / distance;
    return {nx, ny, depth: body.r + margin - gap,
      x: shape.x + qx + nx * radius, y: shape.y + qy + ny * radius};
  }
  // Inside the rectangle's inner core: choose its nearest real outer face.
  const rx = hx - Math.abs(dx), ry = hy - Math.abs(dy);
  const nx = rx <= ry ? (dx < 0 ? -1 : 1) : 0, ny = rx > ry ? (dy < 0 ? -1 : 1) : 0;
  return {nx, ny, depth: body.r + margin + Math.min(rx, ry),
    x: body.x + nx * Math.min(rx, ry), y: body.y + ny * Math.min(rx, ry)};
}

export function resolveStatic(body, shape, {restitution = shape.restitution ?? .95, pierce = false} = {}) {
  const hit = staticContact(body, shape);
  if (!hit) return null;
  const impactVx = body.vx, impactVy = body.vy;
  const relativeVx = body.vx - (shape.vx || 0), relativeVy = body.vy - (shape.vy || 0);
  const closing = -(relativeVx * hit.nx + relativeVy * hit.ny);
  if (!pierce) {
    body.x += hit.nx * (Math.max(0, hit.depth) + EPSILON);
    body.y += hit.ny * (Math.max(0, hit.depth) + EPSILON);
    if (closing > 0) {
      body.vx += (1 + restitution) * closing * hit.nx;
      body.vy += (1 + restitution) * closing * hit.ny;
      const impulse = Math.max(0, shape.impulse || 0);
      body.vx += hit.nx * impulse; body.vy += hit.ny * impulse;
    }
  }
  return {nx: -hit.nx, ny: -hit.ny, contactX: hit.x, contactY: hit.y,
    impactVx, impactVy, impactSpeed: Math.hypot(impactVx, impactVy), normalSpeed: Math.max(0, closing),
    depth: hit.depth, attacker: body};
}

function pairSnapshot(a, b) {
  const preA = {x: a.x, y: a.y, vx: a.vx, vy: a.vy, mass: a.mass, r: a.r};
  const preB = {x: b.x, y: b.y, vx: b.vx, vy: b.vy, mass: b.mass, r: b.r};
  const totalMass = a.mass + b.mass;
  const centerOfMass = Number.isFinite(totalMass) && totalMass > 0
    ? {x: (a.x * a.mass + b.x * b.mass) / totalMass, y: (a.y * a.mass + b.y * b.mass) / totalMass}
    : a.mass === Infinity ? {x: a.x, y: a.y} : {x: b.x, y: b.y};
  const momentum = Number.isFinite(totalMass)
    ? {x: a.vx * a.mass + b.vx * b.mass, y: a.vy * a.mass + b.vy * b.mass} : null;
  return {preA, preB, centerOfMass, momentum};
}

export function dynamicContact(a, b) {
  if (a.active === false || b.active === false || a.captured || b.captured || a.hp <= 0 || b.hp <= 0) return null;
  const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
  if (distance > a.r + b.r + EPSILON) return null;
  const nx = distance > EPSILON ? dx / distance : 1, ny = distance > EPSILON ? dy / distance : 0;
  return {nx, ny, contactX: b.x - nx * b.r, contactY: b.y - ny * b.r,
    impactVx: a.vx, impactVy: a.vy, impactSpeed: Math.hypot(a.vx, a.vy),
    normalSpeed: Math.max(0, (a.vx - b.vx) * nx + (a.vy - b.vy) * ny), attacker: a,
    ...pairSnapshot(a, b)};
}

// Equal-mass cut shots and nonlethal moving obstacles use only the rigid-body
// impulse here. No endless damage, minimum-speed retention or kill hooks apply.
export function resolveDynamic(a, b, {restitution = .95} = {}) {
  if (a.active === false || b.active === false || a.captured || b.captured || a.hp <= 0 || b.hp <= 0) return null;
  const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy), sum = a.r + b.r;
  if (distance >= sum) return null;
  const nx = distance > EPSILON ? dx / distance : 1, ny = distance > EPSILON ? dy / distance : 0;
  const invA = a.mass === Infinity ? 0 : 1 / Math.max(EPSILON, a.mass);
  const invB = b.mass === Infinity ? 0 : 1 / Math.max(EPSILON, b.mass), totalInv = invA + invB;
  if (!totalInv) return null;
  const depth = sum - distance;
  const before = pairSnapshot(a, b);
  a.x -= nx * depth * invA / totalInv; a.y -= ny * depth * invA / totalInv;
  b.x += nx * depth * invB / totalInv; b.y += ny * depth * invB / totalInv;
  const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  const impactVx = a.vx, impactVy = a.vy;
  if (closing <= 0) return null;
  const impulse = (1 + restitution) * closing / totalInv;
  a.vx -= impulse * nx * invA; a.vy -= impulse * ny * invA;
  b.vx += impulse * nx * invB; b.vy += impulse * ny * invB;
  return {nx, ny, contactX: b.x - nx * b.r, contactY: b.y - ny * b.r,
    impactVx, impactVy, impactSpeed: Math.hypot(impactVx, impactVy), normalSpeed: closing, attacker: a,
    ...before};
}

export function zoneContains(body, zone) {
  if (zone.active === false) return false;
  if (Number.isFinite(zone.maxSpeed) && Math.hypot(body.vx, body.vy) > zone.maxSpeed) return false;
  const radius = zone.centerOnly ? 0 : body.r;
  if (zone.shape === 'circle') return Math.hypot(body.x - zone.x, body.y - zone.y) <= zone.r + radius;
  const dx = Math.max(0, Math.abs(body.x - zone.x) - zone.width / 2);
  const dy = Math.max(0, Math.abs(body.y - zone.y) - zone.height / 2);
  return dx * dx + dy * dy <= radius * radius + EPSILON;
}

function segmentCircle(ax, ay, dx, dy, x, y, radius) {
  const d2 = dx * dx + dy * dy;
  const t = d2 > EPSILON ? clamp(-((ax - x) * dx + (ay - y) * dy) / d2, 0, 1) : 0;
  return Math.hypot(ax + dx * t - x, ay + dy * t - y) <= radius;
}

function segmentRect(ax, ay, dx, dy, hx, hy) {
  let enter = 0, exit = 1;
  for (const [a, d, half] of [[ax, dx, hx], [ay, dy, hy]]) {
    if (Math.abs(d) < EPSILON) { if (Math.abs(a) > half) return false; continue; }
    const t1 = (-half - a) / d, t2 = (half - a) / d;
    enter = Math.max(enter, Math.min(t1, t2)); exit = Math.min(exit, Math.max(t1, t2));
    if (enter > exit) return false;
  }
  return exit >= 0 && enter <= 1;
}

export function sweptZoneEntry(body, previous, zone) {
  if (zoneContains(body, zone)) return true;
  if (zone.active === false || Number.isFinite(zone.maxSpeed) && Math.hypot(body.vx, body.vy) > zone.maxSpeed) return false;
  const radius = zone.centerOnly ? 0 : body.r;
  const ax = previous.x - (zone.previousX ?? zone.x), ay = previous.y - (zone.previousY ?? zone.y);
  const bx = body.x - zone.x, by = body.y - zone.y, dx = bx - ax, dy = by - ay;
  if (zone.shape === 'circle') return segmentCircle(ax, ay, dx, dy, 0, 0, zone.r + radius);
  const hx = zone.width / 2, hy = zone.height / 2;
  // A swept circle against a rectangle has rounded Minkowski corners. An
  // inflated AABB alone would incorrectly trigger diagonal near misses.
  if (segmentRect(ax, ay, dx, dy, hx + radius, hy) || segmentRect(ax, ay, dx, dy, hx, hy + radius)) return true;
  if (radius <= 0) return false;
  for (const x of [-hx, hx]) for (const y of [-hy, hy])
    if (segmentCircle(ax, ay, dx, dy, x, y, radius)) return true;
  return false;
}
