import {GOLF_LEVELS} from './golf-levels.js';
export {GOLF_LEVELS} from './golf-levels.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function golfParams(value, variant = 0) {
  const k = clamp(Math.floor(Number(value) || 0), 0, 9), rank20 = k * 2 + (variant ? 1 : 0), level = GOLF_LEVELS[rank20];
  const par = level.par;
  return Object.freeze({kind: 'golf', name: '推杆', k, variant: variant ? 1 : 0, rank20,
    layoutId: level.id, layoutName: level.name, staticCount: level.walls.length,
    playerRadius: .46, walkers: 0,
    holeRadius: .78, captureSpeed: 12, par, budget: par + (rank20 >= 6 ? 3 : 2),
    threePointShots: par - 1, twoPointShots: par,
    movingHole: !!level.moving, holeSpeed: level.moving || 0, holeTravel: level.travel ?? 1.3,
    restitution: .95});
}

export function golfLayout(world, params = world.config) {
  const u = world.unit, b = world.arenaBounds;
  const rank = params.rank20 ?? 2 * (params.k || 0) + (params.variant ? 1 : 0), spec = GOLF_LEVELS[rank];
  const margin = u * .95, left = b.left + margin, right = b.right - margin;
  const top = b.top + margin, bottom = b.bottom - margin;
  const width = right - left, height = bottom - top, vertical = height >= width;
  const across = vertical ? width : height, along = vertical ? height : width;
  const point = ([q,p]) => vertical ? {x:left+q*across,y:top+p*along} : {x:right-p*along,y:top+q*across};
  const bricks = spec.walls.map(([q,p,w,h]) => {
    const position=point([q,p]); let width=vertical?w*across:h*along,height=vertical?h*along:w*across;
    // Side-joined rails meet the arena. Otherwise a ball could bypass every
    // turn of a zigzag by travelling through the decorative outer margin.
    const low=q-w/2<=.071,high=q+w/2>=.929,edge=u*.015;
    if (vertical) {const l=low?b.left+edge:position.x-width/2,r=high?b.right-edge:position.x+width/2;position.x=(l+r)/2;width=r-l;}
    else {const t=low?b.top+edge:position.y-height/2,bottom=high?b.bottom-edge:position.y+height/2;position.y=(t+bottom)/2;height=bottom-t;}
    if (vertical) {const t=p-h/2<=.02?b.top+edge:position.y-height/2,bottom=p+h/2>=.98?b.bottom-edge:position.y+height/2;position.y=(t+bottom)/2;height=bottom-t;}
    else {const l=p+h/2>=.98?b.left+edge:position.x-width/2,r=p-h/2<=.02?b.right-edge:position.x+width/2;position.x=(l+r)/2;width=r-l;}
    return {...position,width,height,cornerRadius:u*.14};
  });
  const hole = point(spec.hole), start = point(spec.start);
  const available = vertical ? Math.min(hole.x-left,right-hole.x) : Math.min(hole.y-top,bottom-hole.y);
  const excursion = params.movingHole ? Math.min(params.holeTravel*u/2,available-params.holeRadius*u) : 0;
  return {left,right,top,bottom,width,height,vertical,bricks,hole,start,
    excursion:Math.max(0,excursion),layoutId:spec.id,layoutName:spec.name};
}

// A first-shot hint must follow the actual course, including a rotated phone.
// Visibility corners give the next open stretch; they never move the ball or
// steer a launched shot. Leave a little room beyond its physical radius so the
// suggested stopping point does not balance on an obstacle's edge.
export function golfRoute(world, destination = world.zones[0]) {
  const margin = world.player.r + world.unit * .24, b = world.arenaBounds;
  const rectangles = world.statics.map(s => ({left:s.x-s.width/2-margin, right:s.x+s.width/2+margin,
    top:s.y-s.height/2-margin, bottom:s.y+s.height/2+margin}));
  const clearance = rectangles.map(r=>({left:r.left+world.unit*.12,right:r.right-world.unit*.12,
    top:r.top+world.unit*.12,bottom:r.bottom-world.unit*.12}));
  const clear = (a,c) => !clearance.some(r => {
    let enter=0, leave=1;
    for (const [p,d,low,high] of [[a.x,c.x-a.x,r.left,r.right],[a.y,c.y-a.y,r.top,r.bottom]]) {
      if (Math.abs(d)<1e-9) { if (p<=low+1e-7 || p>=high-1e-7) return false; }
      else { const t0=(low-p)/d,t1=(high-p)/d; enter=Math.max(enter,Math.min(t0,t1)); leave=Math.min(leave,Math.max(t0,t1)); }
    }
    return enter < leave-1e-7 && leave > 1e-7 && enter < 1-1e-7;
  });
  const points = [{x:world.player.x,y:world.player.y},{x:destination.x,y:destination.y}];
  for (const r of rectangles) for (const x of [r.left,r.right]) for (const y of [r.top,r.bottom]) {
    if (x<=b.left+margin || x>=b.right-margin || y<=b.top+margin || y>=b.bottom-margin) continue;
    if (rectangles.some(other => x>other.left+1e-7 && x<other.right-1e-7 && y>other.top+1e-7 && y<other.bottom-1e-7)) continue;
    points.push({x,y});
  }
  const distances=points.map(()=>Infinity), previous=points.map(()=>-1), visited=new Set(); distances[0]=0;
  for (let i=0;i<points.length;i++) {
    let current=-1;
    for (let j=0;j<points.length;j++) if (!visited.has(j) && (current<0 || distances[j]<distances[current])) current=j;
    if (current<0 || !Number.isFinite(distances[current]) || current===1) break;
    visited.add(current);
    for (let j=1;j<points.length;j++) if (!visited.has(j) && clear(points[current],points[j])) {
      const distance=distances[current]+Math.hypot(points[j].x-points[current].x,points[j].y-points[current].y);
      if (distance<distances[j]) {distances[j]=distance;previous[j]=current;}
    }
  }
  if (!Number.isFinite(distances[1])) return [];
  const route=[];
  for(let at=1;at>0;at=previous[at]) route.unshift(points[at]);
  return route;
}

function entryContact(body, zone, previous) {
  const ax = (previous?.x ?? body.x) - (zone.previousX ?? zone.x);
  const ay = (previous?.y ?? body.y) - (zone.previousY ?? zone.y);
  const bx = body.x - zone.x, by = body.y - zone.y, dx = bx - ax, dy = by - ay;
  const a = dx * dx + dy * dy, closest = a > 1e-12 ? clamp(-(ax * dx + ay * dy) / a, 0, 1) : 0;
  if (Math.hypot(ax + dx * closest, ay + dy * closest) >= zone.r - 1e-9) return null;
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
  let params, board, hole, bricks = [], clock = 0, won = false;
  let initialDistance = 1, lastRejectAt = -Infinity;
  const updateHole = () => {
    const amplitude = board.excursion;
    const distance = params.holeSpeed * world.unit * clock;
    const period = 4 * amplitude;
    const offset = amplitude > 0 ? amplitude - Math.abs(((distance + amplitude) % period) - 2 * amplitude) : 0;
    hole.x = board.hole.x + (board.vertical ? offset : 0); hole.y = board.hole.y + (board.vertical ? 0 : offset);
    if (amplitude > 0) {
      const phase = (distance + amplitude) % period;
      const velocity = (phase < 2 * amplitude ? 1 : -1) * params.holeSpeed * world.unit;
      hole.vx = board.vertical ? velocity : 0; hole.vy = board.vertical ? 0 : velocity;
    } else hole.vx = hole.vy = 0;
  };
  const layout = (initial = false, previous = null) => {
    board = golfLayout(world, params);
    for (const [i, brick] of bricks.entries()) Object.assign(brick, board.bricks[i]);
    hole.r = params.holeRadius * world.unit; updateHole();
    hole.previousX = hole.x; hole.previousY = hole.y;
    if (initial) {
      Object.assign(world.player, board.start, {vx: 0, vy: 0, born: 1, solid: true});
      initialDistance = Math.hypot(hole.x - world.player.x, hole.y - world.player.y);
    } else initialDistance = Math.hypot(board.hole.x - board.start.x, board.hole.y - board.start.y);
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
    world.golfLayout = board;
  };
  return {
    physics: {nonlethal: true, restitution: .95, playerDrag: .6, freezeTargetsIdle: false, settleAll: false},
    setup(k = world.config.k) {
      params = {...golfParams(k, world.config?.variant), ...world.config, k};
      world.budget = params.budget; world.remaining = params.budget;
      for (let i = 0; i < params.staticCount; i++) bricks.push(world.addStatic({kind: 'obstacle', shape: 'rect',
        x: 0, y: 0, width: 1, height: 1, hp: Infinity, maxHp: Infinity, restitution: .95}));
      hole = world.addZone({kind: 'hole', shape: 'circle', x: 0, y: 0, r: params.holeRadius * world.unit,
        centerOnly: true, continuous: true, active: true, moving: params.movingHole, vx: 0, vy: 0});
      world.targetsRemaining = world.totalTargets = 1;
      layout(true);
    },
    onTick(dt) {
      if (!won) clock += dt;
      hole.previousX = hole.x; hole.previousY = hole.y;
      updateHole();
      if (won) hole.vx = hole.vy = 0;
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
    ratingStatus: () => ({rating: world.shotsUsed <= params.par - 1 ? 3 : world.shotsUsed <= params.par ? 2 : 1,
      summary: `${world.shotsUsed}杆 · 标准${params.par}杆`, three: `三点 ≤ ${params.par - 1}杆`, two: `两点 ≤ ${params.par}杆`}),
    summary: () => won ? `${world.shotsUsed} 杆 · 标准 ${params.par}` : world.remaining <= 0 ? `超杆 ${world.shotsUsed - params.par}` : `标准 ${params.par} 杆`,
    progress: () => won ? 1 : clamp(1 - Math.hypot(world.player.x - hole.x, world.player.y - hole.y) / initialDistance, 0, .95),
    peakOptions: () => ({kind: 'golf', crown: world.shotsUsed === 1, duration: world.shotsUsed === 1 ? 1 : .7,
      scale: world.shotsUsed === 1 ? .25 : .4, zoom: world.shotsUsed === 1 ? .04 : .025}),
    tutorialTarget: () => golfRoute(world)[0] || ({x: hole.x, y: hole.y}),
    tutorialPullRatio: () => {
      const route = golfRoute(world), target = route[0] || hole, distance = Math.hypot(target.x-world.player.x,target.y-world.player.y)/world.unit;
      const speed = .6*distance + (route.length>1 ? 3*Math.exp(-.6*.4) : 6);
      return clamp(speed / 40 * Math.sqrt(world.density/world.energy), .08, .95);
    },
    aimTargets: () => [{x: hole.x, y: hole.y}],
    resize: previous => layout(false, previous),
  };
}

export const classParams = golfParams;
export const createRules = createGolfRules;
