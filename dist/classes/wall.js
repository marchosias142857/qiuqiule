import {clamp} from '../physics.js';

// The PDF's example budgets preserve all three rating bands. Its alternative
// ceil(.35 * totalHP) + 2 formula makes the one-point band unreachable on most
// walls. Keep the published anchor values and interpolate between anchors.
const BUDGETS = Object.freeze([14, 16, 18, 20, 24, 27, 30, 33, 36, 38]);
const tierNumber = value => clamp(Math.floor(Number(value) || 0), 0, 9);

export function wallParams(value) {
  const k = tierNumber(value), rows = 4 + Math.floor(k / 2), columns = 5 + Math.floor(k / 3);
  const cells = wallCells(k), totalHP = cells.reduce((sum, cell) => sum + cell.hp, 0);
  return {
    rows, columns, brickWidth: k === 9 ? 1.9 : columns >= 7 ? 2 : 2.2,
    brickHeight: k === 9 ? 1 : columns >= 7 ? 1.1 : 1.2, gap: .25,
    pattern: k < 3 ? 'wall' : k < 6 ? 'checker' : 'arch',
    wanderers: 2 + Math.floor(k / 3), budget: BUDGETS[k],
    brickCount: cells.length, totalHP, restitution: .95,
    threePointShots: Math.floor(.35 * totalHP), twoPointShots: Math.floor(.5 * totalHP),
  };
}

export function wallCells(value) {
  const k = tierNumber(value), rows = 4 + Math.floor(k / 2), columns = 5 + Math.floor(k / 3);
  const toughRows = Math.floor(k / 3), opening = k === 9 ? 4 : 3;
  const gapStart = Math.floor((columns - opening) / 2), cells = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    // The checker pattern is expressed by alternating HP/visual cells, not by
    // secretly deleting half of the nominal brick wall at the middle tiers.
    if (k >= 6 && row >= toughRows && column >= gapStart && column < gapStart + opening) continue;
    let hp = row < toughRows ? 2 : 1;
    if (k === 1 && row === 0 && column % 2 === 0) hp = 2;
    if (k === 2 && row === 0) hp = 2;
    cells.push({row, column, hp, shade: k >= 3 && k < 6 ? (row + column) % 2 : 0});
  }
  // A deterministic spread of hard bricks, only within the reinforced upper
  // rows. No randomness or changed layout is introduced by a retry.
  const hardCount = k >= 6 ? Math.floor(cells.length * (k === 9 ? .15 : .1)) : 0;
  const upper = cells.filter(cell => cell.row < toughRows);
  for (let i = 0; i < hardCount; i++) upper[Math.floor((i + .5) * upper.length / hardCount)].hp = 3;
  // Intermediate tiers whose row/column counts do not change receive a few
  // reinforced checker/arch-side cells, making each tier a distinct layout.
  const extraCount = k === 5 ? 3 : k === 7 ? 6 : k === 8 ? 8 : 0;
  const ordinary = cells.filter(cell => cell.hp === 1);
  for (let i = 0; i < extraCount; i++) ordinary[Math.floor((i + .5) * ordinary.length / extraCount)].hp = 2;
  return cells;
}

export function wallLayout(world, params = wallParams(world.config?.k || 0)) {
  const {unit: u, width, height} = world, bounds = world.arenaBounds;
  // HUD stays above the board. A short landscape screen scales the complete
  // brick geometry uniformly; the player radius and all HP/counts stay fixed.
  const top = Math.max(bounds.top + u * 1.6, height > 520 ? 116 : 76);
  const bottom = Math.max(top + 30, Math.min(height * .51, bounds.bottom - u * 5));
  const nominalWidth = (params.columns * params.brickWidth + (params.columns - 1) * params.gap) * u;
  const nominalHeight = (params.rows * params.brickHeight + (params.rows - 1) * params.gap) * u;
  const availableWidth = Math.max(1, bounds.width - u * 1.4), availableHeight = Math.max(1, bottom - top);
  const scale = Math.min(1, availableWidth / nominalWidth, availableHeight / nominalHeight);
  const brickWidth = params.brickWidth * u * scale, brickHeight = params.brickHeight * u * scale, gap = params.gap * u * scale;
  const boardWidth = nominalWidth * scale, boardHeight = nominalHeight * scale;
  const left = (width - boardWidth) / 2, boardTop = top + (availableHeight - boardHeight) * .2;
  const spawn = {x: width / 2, y: clamp(height * .76, bottom + u * 2, bounds.bottom - u * 1.5)};
  return {left, top: boardTop, width: boardWidth, height: boardHeight, bottom: boardTop + boardHeight,
    brickWidth, brickHeight, gap, scale, spawn,
    wanderTop: Math.max(height * .55, boardTop + boardHeight + u), wanderBottom: bounds.bottom - u};
}

export function createWallRules(world) {
  let params, layout, cells;
  const bricks = () => world.statics.filter(body => body.kind === 'brick');
  const remainingBricks = () => bricks().filter(body => body.hp > 0 && !body.dead);
  const positionBrick = brick => {
    brick.x = layout.left + layout.brickWidth / 2 + brick.column * (layout.brickWidth + layout.gap);
    brick.y = layout.top + layout.brickHeight / 2 + brick.row * (layout.brickHeight + layout.gap);
    brick.width = layout.brickWidth; brick.height = layout.brickHeight;
    brick.cornerRadius = Math.min(layout.brickHeight * .22, world.unit * .18);
    brick.r = Math.min(brick.width, brick.height) / 2;
  };
  const updateTutorial = () => {
    const target = remainingBricks().sort((a, b) => Math.hypot(a.x - world.player.x, a.y - world.player.y) - Math.hypot(b.x - world.player.x, b.y - world.player.y))[0];
    world.tutorialTarget = target ? {x: target.x, y: target.y} : null;
  };
  return {
    setup(k) {
      params = wallParams(k); cells = wallCells(k); layout = wallLayout(world, params);
      world.budget = params.budget; world.wallLayout = layout;
      world.wallTotalHP = params.totalHP; world.wallBroken = 0; world.shotBricks = 0;
      Object.assign(world.player, layout.spawn, {vx: 0, vy: 0, born: 1, solid: true});
      for (const cell of cells) {
        const brick = {shape: 'rect', kind: 'brick', ...cell,
          maxHp: cell.hp, restitution: params.restitution, pattern: params.pattern, hard: cell.hp === 3};
        positionBrick(brick);
        world.addStatic(brick);
      }
      for (let i = 0; i < params.wanderers; i++) {
        const x = world.arenaBounds.left + world.arenaBounds.width * (i + .5) / params.wanderers;
        let y = clamp(layout.wanderTop + world.unit * (1.1 + (i % 2) * 1.8), layout.wanderTop + world.unit, layout.wanderBottom - world.unit);
        if (Math.hypot(x - layout.spawn.x, y - layout.spawn.y) < world.unit * 2.1) y = layout.spawn.y - world.unit * 2.2;
        const body = world.makeBody(x, y, world.unit * .72, .75);
        const angle = i * 2.399963229728653 + .35;
        Object.assign(body, {kind: 'wanderer', enemyType: 'normal', hp: 19, maxHp: 19, value: 10,
          born: 1, solid: true, vx: Math.cos(angle) * world.unit * .2, vy: Math.sin(angle) * world.unit * .2,
          angle, driftAngle: angle});
        world.enemies.push(body);
      }
      updateTutorial();
    },
    onLaunch() { world.shotBricks = 0; },
    onStaticHit(brick, contact) {
      if (brick.kind !== 'brick' || brick.hp <= 0 || !world.shotActive || contact.normalSpeed <= world.unit * .5) return;
      const bank = world.bank || 0;
      world.bank = 0;
      world.hitStatic(brick, 1 + .6 * bank, contact, {value: 10});
    },
    onKill(body) {
      if (body.kind !== 'brick') return;
      world.wallBroken++; world.shotBricks++;
      if (world.shotBricks >= 4) world.emit('campaignCombo', {kind: 'wall', combo: world.shotBricks, x: body.x, y: body.y});
      if (!remainingBricks().length) world.lastCampaignTarget = {x: body.x, y: body.y};
    },
    onTick() {
      for (const body of world.enemies) {
        if (body.hp <= 0) continue;
        const low = layout.wanderTop + body.r, high = Math.max(low, layout.wanderBottom - body.r);
        if (body.y < low) { body.y = low; body.vy = Math.abs(body.vy); }
        if (body.y > high) { body.y = high; body.vy = -Math.abs(body.vy); }
        if (Math.hypot(body.vx, body.vy) < world.unit * .19) {
          const angle = Math.hypot(body.vx, body.vy) > 1e-6 ? Math.atan2(body.vy, body.vx) : body.driftAngle;
          body.vx = Math.cos(angle) * world.unit * .2; body.vy = Math.sin(angle) * world.unit * .2;
        }
      }
    },
    onLaunchEnd() { updateTutorial(); },
    isWon: () => remainingBricks().length === 0,
    isLost: () => !world.shotActive && world.remaining <= 0 && remainingBricks().length > 0,
    rating() {
      if (remainingBricks().length) return 0;
      return world.shotsUsed <= params.threePointShots ? 3 : world.shotsUsed <= params.twoPointShots ? 2 : 1;
    },
    summary: () => remainingBricks().length ? `还差${remainingBricks().length}砖` : `${world.shotsUsed}发破墙`,
    progress: () => ({remaining: remainingBricks().length, total: params.brickCount,
      remainingHP: remainingBricks().reduce((sum, brick) => sum + brick.hp, 0), totalHP: params.totalHP}),
    tutorialTarget: () => world.tutorialTarget,
    resize() {
      layout = wallLayout(world, params); world.wallLayout = layout;
      for (const brick of bricks()) positionBrick(brick);
      updateTutorial();
    },
  };
}
