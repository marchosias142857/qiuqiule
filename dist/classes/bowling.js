import {clamp} from '../physics.js';

export function bowlingParams(value) {
  const k = clamp(Math.floor(Number(value) || 0), 0, 9), rounds = k >= 6 ? 4 : 3;
  const totalPins = rounds * 10, passRatio = (70 + 1.7 * k) / 100;
  return Object.freeze({kind: 'bowling', name: '十瓶', rounds, totalPins, budget: rounds * 2,
    requiredPins: Math.ceil(totalPins * passRatio - 1e-10), passRatio,
    laneWidth: 10 - k / 3, gutterWidth: 1 + .07 * k, spacing: 1.6 + .045 * k,
    heavyPins: Math.floor(k / 3), pinRadius: .55, pinDensity: .35, restitution: .95,
    breakSpeed: 5, pinPoints: 10, strikePoints: 50, sparePoints: 20});
}

export function bowlingBounds(world) {
  const left = world.inset ?? 16, top = world.height > 520 ? 128 : 86;
  const right = world.width - left, bottom = world.height - left;
  return {left, right, top, bottom, width: right - left, height: bottom - top};
}

export function bowlingLayout(world, params = bowlingParams(world.config?.k || 0)) {
  const bounds = bowlingBounds(world), u = world.unit;
  const vertical = bounds.height >= bounds.width;
  const center = vertical ? (bounds.left + bounds.right) / 2 : (bounds.top + bounds.bottom) / 2;
  const longStart = vertical ? bounds.top : bounds.right, length = vertical ? bounds.height : bounds.width;
  const point = (along, across = 0) => vertical
    ? {x: center + across, y: longStart + along}
    : {x: longStart - along, y: center + across};
  const laneWidth = params.laneWidth * u, gutterWidth = params.gutterWidth * u;
  const wallThickness = Math.max(1, u * .05), outer = laneWidth / 2 + gutterWidth;
  const gutters = [-1, 1].map(side => ({...point(length / 2, side * (laneWidth + gutterWidth) / 2),
    width: vertical ? gutterWidth : length, height: vertical ? length : gutterWidth, side}));
  const walls = [-1, 1].map(side => ({...point(length / 2, side * (outer + wallThickness / 2)),
    width: vertical ? wallThickness : length, height: vertical ? length : wallThickness, side}));
  const spawn = point(length * .88), rack = point(length * .3), pins = [];
  // The literal k9 rear span is 7.115u in a 7u lane. Compress only the across
  // spacing enough for both .55u radii and .04u edge clearance; neither body
  // radius nor the nominal longitudinal/diagonal spacing changes.
  const acrossSpacing = Math.min(params.spacing * u, (laneWidth - 2 * params.pinRadius * u - .08 * u) / 3);
  const heavyColumns = [1, 2, 0].slice(0, params.heavyPins);
  for (let row = 0; row < 4; row++) for (let column = 0; column <= row; column++) {
    const p = point(length * .3 - row * params.spacing * u * Math.sqrt(3) / 2,
      (column - row / 2) * acrossSpacing);
    pins.push({...p, row, column, hp: row === 3 && heavyColumns.includes(column) ? 2 : 1});
  }
  return {...bounds, bounds, vertical, laneWidth, gutterWidth, wallThickness, acrossSpacing,
    nominalSpacing: params.spacing * u, length, center, spawn, rack, pins, gutters, walls};
}

export function createBowlingRules(world) {
  let params, layout;
  const standing = () => world.enemies.filter(body => body.kind === 'bowling-pin' && body.pinHP > 0);
  const resetPlayer = () => Object.assign(world.player, layout.spawn, {captured: false, vx: 0, vy: 0,
    pendingVx: 0, pendingVy: 0, feedbackFreeze: 0, feedbackFreezeTotal: 0});
  const updateTutorial = () => {
    world.tutorialTarget = standing().sort((a, b) => b.row - a.row)[0] || layout.rack;
    // Aim at the head pin for the first rack; subsequent spare aims use a real
    // remaining target. Steady hand can only correct towards these positions.
    const head = standing().find(pin => pin.row === 0);
    if (head) world.tutorialTarget = {x: head.x, y: head.y, r: head.r};
  };
  const buildRack = () => {
    world.enemies = [];
    for (const spec of layout.pins) {
      const pin = world.makeBody(spec.x, spec.y, params.pinRadius * world.unit, params.pinDensity);
      Object.assign(pin, {kind: 'bowling-pin', enemyType: spec.hp > 1 ? 'heavy' : 'normal',
        hp: spec.hp, maxHp: spec.hp, pinHP: spec.hp, pinMaxHP: spec.hp, bowlingFallen: false,
        row: spec.row, column: spec.column, restitution: params.restitution, drag: 1.2,
        value: 10, born: 1, solid: true});
      world.enemies.push(pin);
    }
    world.bowlingRoundPinsDown = 0; world.bowlingShot = 0; world.bowlingContacts.clear();
    resetPlayer(); updateTutorial();
  };
  const damagePin = (pin, attacker, contact, reversed = false) => {
    if (pin.kind !== 'bowling-pin' || pin.pinHP <= 0) return false;
    const impact = {...contact, attacker, source: 'bowling',
      nx: reversed ? -contact.nx : contact.nx, ny: reversed ? -contact.ny : contact.ny};
    if (reversed) {
      impact.contactX = pin.x - impact.nx * pin.r; impact.contactY = pin.y - impact.ny * pin.r;
      impact.impactVx = attacker.vx; impact.impactVy = attacker.vy;
    }
    pin.pinHP--; pin.hp = pin.pinHP; pin.hit = 1;
    const feedback = world.damageFeedback(pin, 1, impact);
    if (pin.pinHP > 0) {
      world.emit('hit', {x: pin.x, y: pin.y, r: pin.r, power: contact.normalSpeed / world.baseSpeed, ...feedback});
      return true;
    }
    pin.bowlingFallen = true; pin.fallenAt = world.feedbackTime;
    world.bowlingPinsDown++; world.bowlingRoundPinsDown++;
    world.creditKill(pin, impact, feedback, params.pinPoints);
    world.emit('campaignPinDown', {bodyId: pin.id, x: pin.x, y: pin.y, combo: world.shotKills,
      round: world.bowlingRound, pinsDown: world.bowlingPinsDown});
    // A visible, pale fallen pin keeps its real impulse and collider until the
    // launch ends. Removing it here would erase physical pin-to-pin chains.
    pin.hp = Infinity;
    if (world.bowlingRoundPinsDown === 10) world.requestLaunchEnd({reason: 'rack-clear', immediate: true});
    return true;
  };
  return {
    managesBudget: true,
    physics: {nonlethal: true, restitution: .95, freezeTargetsIdle: true, settleAll: true},
    arenaBounds: () => bowlingBounds(world),
    setup(k) {
      params = bowlingParams(k); layout = bowlingLayout(world, params); world.bowlingLayout = layout;
      world.budget = params.budget; world.bowlingRound = 1; world.bowlingShot = 0;
      world.bowlingPinsDown = 0; world.bowlingStrikes = 0; world.bowlingSpares = 0;
      world.bowlingCompletedRounds = 0; world.bowlingFrames = []; world.bowlingContacts = new Set();
      world.bowlingTransition = null; world.bowlingCrown = null; world.bowlingGutters = 0;
      for (const spec of layout.walls) world.addStatic({...spec, kind: 'bowling-wall', shape: 'rect', cornerRadius: 0, restitution: .95, bankSurface: true});
      for (const spec of layout.gutters) world.addZone({...spec, kind: 'gutter', shape: 'rect', centerOnly: true, oncePerShot: true});
      buildRack();
    },
    canLaunch: () => !world.bowlingTransition && world.bowlingCompletedRounds < params.rounds,
    preserveLaunchMotion: () => world.bowlingRoundPinsDown === 10 && world.bowlingShot === 1,
    intermissionMotion: () => !!world.bowlingTransition && world.bowlingRoundPinsDown === 10 && world.bowlingShot === 1,
    onLaunch() { world.bowlingShot++; world.bowlingContacts.clear(); },
    onDynamicHit(a, b, contact) {
      if (!world.shotActive || world.phase !== 'battle') return;
      const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
      if (world.bowlingContacts.has(key)) return;
      world.bowlingContacts.add(key);
      if (!(contact.normalSpeed > params.breakSpeed * world.unit)) return;
      const hitB = damagePin(b, a, contact), hitA = damagePin(a, b, contact, true);
      return hitA || hitB;
    },
    onZone(body, zone) {
      if (zone.kind !== 'gutter' || body !== world.player || !world.shotActive || body.captured) return false;
      body.captured = true; world.bowlingGutters++;
      world.emit('campaignGutter', {x: body.x, y: body.y, round: world.bowlingRound, shot: world.bowlingShot});
      world.requestLaunchEnd({reason: 'gutter', immediate: true}); return true;
    },
    onTick() {
      const bodies = new Map([world.player, ...world.enemies].map(body => [body.id, body]));
      for (const key of world.bowlingContacts) {
        const [a, b] = key.split(':').map(id => bodies.get(Number(id)));
        if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) > a.r + b.r + world.unit * .025) world.bowlingContacts.delete(key);
      }
      if (world.bowlingCrown && world.feedbackTime - world.bowlingCrown.at >= world.bowlingCrown.duration) world.bowlingCrown = null;
      if (world.bowlingTransition && world.feedbackTime >= world.bowlingTransition.until) {
        world.bowlingTransition = null; world.bowlingRound++; buildRack();
      }
    },
    onLaunchEnd({reason} = {}) {
      const clear = world.bowlingRoundPinsDown === 10;
      const strike = clear && world.bowlingShot === 1, spare = clear && world.bowlingShot === 2;
      // A strike carries its actual final motion through the crown interval.
      // buildRack performs the reset after it; no score/zone rules run there.
      if (!strike) { world.enemies = standing(); resetPlayer(); }
      world.bowlingContacts.clear();
      if (!clear && world.bowlingShot < 2) { updateTutorial(); return; }
      if (strike) {
        world.bowlingStrikes++; world.remaining = Math.max(0, world.remaining - 1);
        world.awardCampaignPoints(params.strikePoints, {kind: 'strike', round: world.bowlingRound});
        world.bowlingCrown = {...layout.rack, at: world.feedbackTime, duration: .8};
        world.beginCampaignSlow({duration: .4, scale: .3, kind: 'bowling-strike', ...layout.rack});
        world.emit('campaignStrike', {...layout.rack, round: world.bowlingRound, strikes: world.bowlingStrikes, duration: .8});
      } else if (spare) {
        world.bowlingSpares++;
        world.awardCampaignPoints(params.sparePoints, {kind: 'spare', round: world.bowlingRound});
        world.emit('campaignSpare', {...layout.rack, round: world.bowlingRound});
      }
      world.bowlingFrames.push({round: world.bowlingRound, shots: world.bowlingShot,
        pins: world.bowlingRoundPinsDown, strike, spare, reason});
      world.bowlingCompletedRounds++;
      world.emit('campaignRoundEnd', {kind: 'bowling', ...world.bowlingFrames.at(-1),
        completedRounds: world.bowlingCompletedRounds, rounds: params.rounds});
      if (world.bowlingCompletedRounds < params.rounds)
        world.bowlingTransition = {until: world.feedbackTime + (strike ? .8 : .25)};
      world.peakOrigin = {...layout.rack};
    },
    isWon: () => world.bowlingCompletedRounds >= params.rounds && world.bowlingPinsDown >= params.requiredPins,
    isLost: () => world.bowlingCompletedRounds >= params.rounds && world.bowlingPinsDown < params.requiredPins,
    rating: () => world.bowlingStrikes >= 2 ? 3 : world.bowlingStrikes >= 1 ? 2 : 1,
    summary: () => world.bowlingPinsDown >= params.requiredPins ? `${world.bowlingPinsDown}瓶 · ${world.bowlingStrikes}次全倒`
      : `差${params.requiredPins - world.bowlingPinsDown}瓶`,
    progress: () => ({total: params.requiredPins, remaining: Math.max(0, params.requiredPins - world.bowlingPinsDown)}),
    aimTargets: () => standing().map(pin => ({x: pin.x, y: pin.y})),
    tutorialTarget: () => world.tutorialTarget,
    peakOptions: () => ({kind: 'bowling', duration: .8, scale: .3, zoom: .04}),
    resize(previous) {
      const old = layout, next = bowlingLayout(world, params); layout = next; world.bowlingLayout = next;
      const mapPoint = p => {
        const along = old.vertical ? (p.y - old.top) / old.height : (old.right - p.x) / old.width;
        const across = (old.vertical ? p.x - old.center : p.y - old.center) / old.laneWidth;
        return next.vertical ? {x: next.center + across * next.laneWidth, y: next.top + along * next.height}
          : {x: next.right - along * next.width, y: next.center + across * next.laneWidth};
      };
      for (const body of [world.player, ...world.enemies]) {
        const before = previous?.positions?.get(body.id); if (before) Object.assign(body, mapPoint(before));
        if (old.vertical !== next.vertical) {
          const vx = body.vx, vy = body.vy; body.vx = old.vertical ? -vy : vy; body.vy = old.vertical ? vx : -vx;
        }
        world.clampBodyToArena(body);
      }
      for (const wall of world.statics) if (wall.kind === 'bowling-wall') Object.assign(wall, next.walls[wall.side < 0 ? 0 : 1]);
      for (const zone of world.zones) if (zone.kind === 'gutter') Object.assign(zone, next.gutters[zone.side < 0 ? 0 : 1]);
      if (world.bowlingCrown) Object.assign(world.bowlingCrown, next.rack);
      world.bowlingContacts.clear(); updateTutorial();
    },
  };
}
