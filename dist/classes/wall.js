import {clamp} from '../physics.js';
import {WALL_LEVELS} from './wall-levels.js';
export {WALL_LEVELS} from './wall-levels.js';

// Ball size and routes are campaign-only; World/endless values are untouched.
const tierNumber = value => clamp(Math.floor(Number(value) || 0), 0, 9);
const rankNumber = (value, variant = 0) => tierNumber(value) * 2 + (variant ? 1 : 0);

export function wallParams(value, variant = 0) {
  const rank20 = rankNumber(value, variant), spec = WALL_LEVELS[rank20];
  const cells = wallCells(value, variant), totalHP = cells.reduce((sum, cell) => sum + cell.hp, 0);
  const threePointShots = 4 + Math.floor(rank20 / 3), twoPointShots = 5 + Math.floor(rank20 * .45);
  return {
    rank20, layoutId: spec.id, layoutName: spec.name, layoutDescription: spec.strategy,
    rows: spec.rows.length, columns: 7, brickWidth: 1.65, brickHeight: .85, gap: .32,
    pattern: spec.id, playerRadius: .45, wanderers: 0, budget: twoPointShots + 3,
    brickCount: cells.length, totalHP, restitution: 1, threePointShots, twoPointShots,
  };
}

export function wallCells(value, variant = 0) {
  const rank = rankNumber(value, variant), spec = WALL_LEVELS[rank], cells = [];
  for (const [row, line] of spec.rows.entries()) for (let column = 0; column < line.length; column++) {
    if (line[column] !== '.') cells.push({row, column, hp: 1, shade: 0});
  }
  // Layout establishes the puzzle. Reinforcement is a secondary, monotonic
  // challenge: spread it over accessible cells rather than sealing a corridor.
  let extra = spec.totalHP - cells.length;
  const ordered = cells.slice().sort((a, b) => a.row - b.row || ((a.column * 3) % 7) - ((b.column * 3) % 7));
  const hardCount = rank >= 12 ? 1 + Math.floor((rank - 12) / 3) : 0;
  for (let i = 0; i < hardCount; i++) { ordered[i * 2].hp = 3; extra -= 2; }
  for (let pass = 0; extra > 0; pass++) for (const cell of ordered) {
    if (!extra) break;
    if (cell.hp >= (rank >= 12 ? 3 : 2)) continue;
    cell.hp++; extra--;
  }
  return cells;
}

export function wallLayout(world, params = wallParams(world.config?.k || 0, world.config?.variant || 0)) {
  const {unit: u, width} = world, bounds = world.arenaBounds;
  // Reserve a lower launch strip. The board uses arena height, not screen
  // height, so single-cell corridors remain wide enough in short landscape.
  const top = bounds.top + u * .6;
  const availableHeight = Math.max(u * 4, bounds.height * .62);
  const nominalWidth = (params.columns * params.brickWidth + (params.columns - 1) * params.gap) * u;
  const nominalHeight = (params.rows * params.brickHeight + (params.rows - 1) * params.gap) * u;
  const scale = Math.min(1, (bounds.width - u * 1.4) / nominalWidth, availableHeight / nominalHeight);
  const brickWidth = params.brickWidth * u * scale, brickHeight = params.brickHeight * u * scale, gap = params.gap * u * scale;
  const boardWidth = nominalWidth * scale, boardHeight = nominalHeight * scale;
  const left = (width - boardWidth) / 2;
  const spawn = {x: width / 2, y: clamp(bounds.top + bounds.height * .87,
    top + boardHeight + u * 1.5, bounds.bottom - u)};
  return {left, top, width: boardWidth, height: boardHeight, bottom: top + boardHeight,
    brickWidth, brickHeight, gap, scale, spawn};
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
      params = wallParams(k, world.config.variant); cells = wallCells(k, world.config.variant); layout = wallLayout(world, params);
      world.budget = params.budget; world.wallLayout = layout;
      world.wallTotalHP = params.totalHP; world.wallBroken = 0; world.shotBricks = 0;
      Object.assign(world.player, layout.spawn, {vx: 0, vy: 0, born: 1, solid: true});
      for (const cell of cells) {
        const brick = {shape: 'rect', kind: 'brick', ...cell,
          maxHp: cell.hp, restitution: params.restitution, pattern: params.pattern, hard: cell.hp === 3};
        positionBrick(brick);
        world.addStatic(brick);
      }
      updateTutorial();
    },
    onLaunch() { world.shotBricks = 0; },
    onStaticHit(brick, contact) {
      if (brick.kind !== 'brick' || brick.hp <= 0 || !world.shotActive || contact.normalSpeed <= world.unit * .5) return;
      const bank = world.bank || 0;
      world.bank = 0;
      const speedDamage = contact.normalSpeed > world.unit * 20 ? 2 : 1;
      world.hitStatic(brick, speedDamage + .6 * bank, contact, {value: 10});
    },
    onKill(body) {
      if (body.kind !== 'brick') return;
      world.wallBroken++; world.shotBricks++;
      if (world.shotBricks === 4) world.emit('campaignCombo', {kind: 'wall', combo: world.shotBricks, x: body.x, y: body.y});
      if (!remainingBricks().length) world.lastCampaignTarget = {x: body.x, y: body.y};
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
    ratingStatus: () => ({
      rating: world.shotsUsed <= params.threePointShots ? 3 : world.shotsUsed <= params.twoPointShots ? 2 : 1,
      summary: `已发 ${world.shotsUsed} · 还差 ${remainingBricks().length} 砖`,
      three: `三点 ≤ ${params.threePointShots} 发`, two: `两点 ≤ ${params.twoPointShots} 发`,
    }),
    tutorialTarget: () => world.tutorialTarget,
    tutorialPullRatio: 1,
    resize() {
      layout = wallLayout(world, params); world.wallLayout = layout;
      for (const brick of bricks()) positionBrick(brick);
      updateTutorial();
    },
  };
}
