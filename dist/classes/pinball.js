// PDF §8.3 r=6. Target counts follow the prose's 3–5 range and the printed
// 3/4/4/5 examples; life counts retain the explicit 5-floor(k/4) formula.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function pinballParams(difficulty) {
  const k = clamp(Math.floor(Number(difficulty) || 0), 0, 9);
  return Object.freeze({kind: 'pinball', name: '弹珠', budgetKind: 'lives',
    bumperCount: Math.min(5, 3 + Math.floor(k / 3)), bumperRadius: .9, bumperImpulse: 8,
    bumperRestitution: 1, targetCount: 3 + Math.round(2 * k / 9), targetHp: 1,
    targetWidth: 1.25, targetHeight: .65, jackpotRadius: 1.8, jackpotHp: 3,
    jackpotGoal: 3 + Math.floor(k / 3), jackpotValue: 300, budget: 5 - Math.floor(k / 4),
    drainWidth: 4, ballSaveDuration: 8, respawnDelay: 3, multiballHits: 5, auxiliaryRadius: .7});
}

export function pinballLayout(world, params = world.config, group = 0) {
  const u = world.unit, b = world.arenaBounds;
  const left = b.left, right = b.right;
  const top = Math.max(world.height > 520 ? 112 : 76, b.top);
  const bottom = b.bottom, width = right - left, height = bottom - top;
  const landscape = width > height, centre = {x: (left + right) / 2, y: (top + bottom) / 2};
  // Keep the bumper/jackpot gaps in physical units rather than stretching
  // them over a tall screen. A ricochet can genuinely return to the jackpot.
  // The row follows the long axis; it becomes a vertical line in landscape.
  const point = (across, depth) => landscape
    ? {x: centre.x + depth * u, y: centre.y + across * u}
    : {x: centre.x + across * u, y: centre.y + depth * u};
  const bumperCoordinates = params.bumperCount === 3
    ? [[-4.8, 0], [4.8, 0], [0, 4.8]]
    : [[-4.8, 0], [4.8, 0], [-3.7, 3.7], [3.7, 3.7], [0, -4.8]].slice(0, params.bumperCount);
  const rowWidth = (params.targetCount - 1) * 1.85 * u;
  // Three repeated but distinct rows: fixed retry geometry, never adaptive to
  // the player's aim. They share a clear top band above the bumper field.
  const shift = [0, -.5, .5][group % 3], depth = [-7, -7.4, -6.6][group % 3];
  const targets = Array.from({length: params.targetCount}, (_, index) => ({
    ...point(-rowWidth / u / 2 + index * 1.85 + shift, depth),
    width: (landscape ? params.targetHeight : params.targetWidth) * u,
    height: (landscape ? params.targetWidth : params.targetHeight) * u, cornerRadius: .16 * u}));
  return {left, right, top, bottom, width, height, targets,
    landscape, centre, bumpers: bumperCoordinates.map(([x, y]) => point(x, y)), jackpot: centre,
    start: {x: b.right - 2 * u, y: b.bottom - 2 * u}};
}

export function createPinballRules(world) {
  let params, board, drain, jackpot, bumpers = [], targets = [];
  let group = 0, jackpots = 0, respawnRemaining = null, saveElapsed = 0, started = false;
  let charge = 0, bumperHits = 0, shotBumpers = 0, drainedShot = -1, won = false;
  let returnPending = false;
  const activeTargets = () => targets.filter(target => target.active !== false && !target.dead && target.hp > 0);
  const sync = () => {
    world.pinballJackpots = jackpots;
    world.targetsRemaining = params.jackpotGoal - jackpots;
    world.pinballState = {jackpots, goal: params.jackpotGoal, group, bumperHits, shotBumpers,
      saveRemaining: Math.max(0, params.ballSaveDuration - saveElapsed),
      saveActive: started && saveElapsed < params.ballSaveDuration,
      multiballReady: charge >= params.multiballHits, charge,
      respawnRemaining, targetsRemaining: activeTargets().length, jackpotActive: jackpot.active && !jackpot.dead};
  };
  const layout = (initial = false) => {
    board = pinballLayout(world, params, group);
    for (const [index, bumper] of bumpers.entries()) Object.assign(bumper, board.bumpers[index], {
      r: params.bumperRadius * world.unit, impulse: params.bumperImpulse * world.unit});
    for (const [index, target] of targets.entries()) Object.assign(target, board.targets[index], {r: params.targetHeight * world.unit / 2});
    Object.assign(jackpot, board.jackpot, {r: params.jackpotRadius * world.unit});
    const b = world.arenaBounds;
    // Centre entry is detected just before the ordinary floor contact, so the
    // 4u opening is physically reachable without changing endless walls.
    Object.assign(drain, {x: (b.left + b.right) / 2, y: b.bottom - world.player.r + .1 * world.unit,
      width: params.drainWidth * world.unit, height: .4 * world.unit,
      visualY: b.bottom, visualHeight: .5 * world.unit});
    if (initial || returnPending) Object.assign(world.player, board.start, {vx: 0, vy: 0, born: 1, solid: true});
    world.pinballBoard = board; sync();
  };
  const spawnTargets = () => {
    group++; respawnRemaining = null;
    for (const target of targets) Object.assign(target, {hp: 1, maxHp: 1, active: true, dead: false,
      hit: 0, group, born: 1, solid: true});
    // Move only the new target row. Bumpers, jackpot and active bodies keep
    // their current physical coordinates and velocities.
    board = pinballLayout(world, params, group);
    for (const [index, target] of targets.entries()) Object.assign(target, board.targets[index]);
    world.pinballBoard = board;
    world.emit('campaignTargetGroup', {group, count: targets.length});
  };
  const spawnJackpot = () => {
    Object.assign(jackpot, {hp: params.jackpotHp, maxHp: params.jackpotHp, active: true, dead: false,
      hit: 0, group, born: 1, solid: true});
    respawnRemaining = params.respawnDelay;
    world.emit('campaignJackpotReady', {x: jackpot.x, y: jackpot.y, r: jackpot.r, group});
  };
  const addAuxiliary = () => {
    const player = world.player, speed = Math.hypot(player.vx, player.vy), angle = Math.atan2(player.vy, player.vx) + Math.PI / 12;
    const child = world.makeBody(player.x, player.y, params.auxiliaryRadius * world.unit, player.density);
    Object.assign(child, {isPlayer: true, isAuxiliary: true, pinballAuxiliary: true, sourceMass: player.mass,
      hp: Infinity, maxHp: Infinity, born: 1, solid: true, active: true, drag: .6, angle,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      feedbackFreeze: player.feedbackFreeze || 0, feedbackFreezeTotal: player.feedbackFreezeTotal || 0});
    world.auxiliaries.push(child);
    world.emit('playerSplit', {x: player.x, y: player.y, bodyIds: [child.id], source: 'pinball'});
  };
  const returnPlayer = () => {
    Object.assign(world.player, board.start, {vx: 0, vy: 0, pendingVx: 0, pendingVy: 0,
      captured: false, active: true, feedbackFreeze: 0, feedbackFreezeTotal: 0});
    returnPending = false;
  };
  return {
    budgetKind: 'lives',
    physics: {nonlethal: true, freezeTargetsIdle: true, settleAll: true, playerDrag: .6},
    setup(k = world.config.k) {
      params = {...pinballParams(k), ...world.config};
      world.budgetKind = 'lives'; world.budget = params.budget; world.remaining = params.budget;
      for (let index = 0; index < params.bumperCount; index++) bumpers.push(world.addStatic({
        kind: 'bumper', shape: 'circle', x: 0, y: 0, r: params.bumperRadius * world.unit,
        hp: Infinity, maxHp: Infinity, restitution: params.bumperRestitution, impulse: params.bumperImpulse * world.unit,
        pierceable: false, index}));
      for (let index = 0; index < params.targetCount; index++) targets.push(world.addStatic({
        kind: 'pinball-target', shape: 'rect', x: 0, y: 0, width: 1, height: 1, hp: 1, maxHp: 1,
        restitution: .95, index, group, target: true}));
      jackpot = world.addStatic({kind: 'jackpot', shape: 'circle', x: 0, y: 0,
        r: params.jackpotRadius * world.unit, hp: params.jackpotHp, maxHp: params.jackpotHp,
        restitution: .95, active: false, target: true});
      drain = world.addZone({kind: 'drain', shape: 'rect', x: 0, y: 0, width: 1, height: 1,
        centerOnly: true, continuous: true, active: true});
      world.totalTargets = params.jackpotGoal; layout(true);
    },
    onLaunch() {
      started = true; shotBumpers = 0; returnPending = false;
      world.auxiliaries = [];
      if (charge >= params.multiballHits) { charge = 0; addAuxiliary(); }
      sync();
    },
    onStaticHit(shape, contact = {}, attacker = contact.attacker || world.player) {
      if (!world.shotActive || won || attacker.captured || attacker.active === false || shape.active === false || shape.dead) return;
      if (shape.kind === 'bumper') {
        bumperHits++; shotBumpers++; charge = Math.min(params.multiballHits, charge + 1);
        shape.hit = 1; shape.squash = Math.min(.2, (contact.normalSpeed || 0) / world.baseSpeed * .2);
        world.maxCombo = Math.max(world.maxCombo, shotBumpers);
        world.emit('campaignBumperHit', {x: shape.x, y: shape.y, r: shape.r, bodyId: shape.id,
          attackerId: attacker.id, combo: shotBumpers, charge, ...contact});
        if (shotBumpers === 4) world.emit('campaignBumperRun', {x: shape.x, y: shape.y, combo: shotBumpers});
      } else if (shape.kind === 'pinball-target') {
        world.hitStatic(shape, 1, contact, {value: 10});
        if (!activeTargets().length) spawnJackpot();
      } else if (shape === jackpot) {
        world.hitStatic(shape, 1, contact, {value: params.jackpotValue});
        if (shape.hp <= 0) {
          shape.active = false; jackpots++;
          world.pinballCrown = {at: world.feedbackTime, duration: .8};
          world.peakOrigin = {x: shape.x, y: shape.y};
          world.emit('campaignJackpot', {x: shape.x, y: shape.y, r: shape.r, jackpots,
            goal: params.jackpotGoal, value: params.jackpotValue});
          won = jackpots >= params.jackpotGoal;
          if (!won) world.beginCampaignSlow?.({duration: .4, scale: .3, kind: 'pinball', x: shape.x, y: shape.y});
          if (!won && respawnRemaining <= 0) spawnTargets();
        }
      }
      sync();
    },
    onTick(dt) {
      if (world.phase !== 'battle') return;
      for (const shape of [...bumpers, ...targets, jackpot]) {
        shape.hit = Math.max(0, shape.hit - dt * 5);
        shape.squash *= Math.exp(-dt * 13);
      }
      // Waiting, pause, background and presentation real time do not spend
      // the opening protection. Only active world simulation does.
      if (started && world.shotActive) saveElapsed = Math.min(params.ballSaveDuration, saveElapsed + dt);
      if (respawnRemaining !== null) {
        respawnRemaining = Math.max(0, respawnRemaining - dt);
        if (!won && respawnRemaining === 0 && (!jackpot.active || jackpot.dead)) spawnTargets();
      }
      sync();
    },
    onZone(body, zone, contact = {}) {
      if (zone !== drain || !world.shotActive || won || body.captured || body.active === false) return false;
      if (!(body.vy > 0) || !(contact.previous?.y < zone.y - zone.height / 2)) return false;
      if (body.isAuxiliary) {
        body.active = false; body.vx = body.vy = 0;
        world.emit('campaignDrain', {x: body.x, y: body.y, auxiliary: true, remaining: world.remaining});
        return true;
      }
      if (body !== world.player || drainedShot === world.shotsUsed) return false;
      drainedShot = world.shotsUsed; returnPending = true;
      const saved = saveElapsed < params.ballSaveDuration;
      if (!saved) world.remaining = Math.max(0, world.remaining - 1);
      body.captured = true; body.vx = body.vy = 0;
      world.emit(saved ? 'campaignBallSave' : 'campaignDrain', {x: body.x, y: body.y,
        auxiliary: false, remaining: world.remaining, saved});
      world.requestLaunchEnd?.({reason: saved ? 'ball-save' : 'drain',
        immediate: !world.auxiliaries.some(aux => aux.active !== false && !aux.captured)});
      sync(); return true;
    },
    onLaunchEnd() {
      world.auxiliaries = [];
      if (returnPending) returnPlayer();
      sync();
    },
    isSettled: () => [world.player, ...world.auxiliaries].filter(body => !body.captured && body.active !== false)
      .every(body => Math.hypot(body.vx, body.vy) < 3 * world.unit),
    isWon: () => won,
    isLost: () => !won && !world.shotActive && world.remaining <= 0,
    rating: () => !won ? 0 : world.remaining >= 2 ? 3 : world.remaining >= 1 ? 2 : 1,
    summary: () => won ? `剩余 ${world.remaining} 球` : `差 ${params.jackpotGoal - jackpots} 大奖`,
    progress: () => (jackpots + (jackpot.active && !jackpot.dead ? (params.jackpotHp - jackpot.hp) / params.jackpotHp * .5 + .5
      : (params.targetCount - activeTargets().length) / params.targetCount * .5)) / params.jackpotGoal,
    peakOptions: () => ({kind: 'pinball', crown: true, duration: .95, scale: .3, zoom: .04}),
    tutorialTarget: () => {
      const remaining = activeTargets();
      if (!remaining.length) return jackpot;
      const target = board.landscape ? remaining[0] : remaining.at(-1);
      if (!board.landscape) return target;
      // The top shoulder of the first landscape target leaves the direct
      // bumper lane; this is a visible first-shot example, not aim assistance.
      const distance = Math.hypot(target.x - world.player.x, target.y - world.player.y);
      const angle = Math.atan2(target.y - world.player.y, target.x - world.player.x) - .12;
      return {x: world.player.x + Math.cos(angle) * distance, y: world.player.y + Math.sin(angle) * distance};
    },
    resize: () => layout(false),
  };
}

export const classParams = pinballParams;
export const createRules = createPinballRules;
