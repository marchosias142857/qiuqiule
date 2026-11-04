// Campaign-only geometry: HUD, physical walls and all mode layouts share one
// frame. Endless continues to use World.arenaBounds without any changes.
export function campaignBounds(world, {squareUnits = null} = {}) {
  const inset = world.inset ?? 16, unit = world.unit || 18;
  const left = inset, right = world.width - inset, bottom = world.height - inset;
  const top = Math.min(world.height > 520 ? 128 : 86, bottom - unit * 8);
  const width = right - left, height = bottom - top;
  if (!(squareUnits > 0)) return {left, right, top, bottom, width, height};
  const size = Math.max(unit * 4, Math.min(squareUnits * unit, width, height, Math.min(world.width, world.height) - 102));
  const x = (world.width - size) / 2, y = top + (height - size) / 2;
  return {left: x, right: x + size, top: y, bottom: y + size, width: size, height: size};
}
