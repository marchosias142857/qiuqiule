import test from 'node:test';
import assert from 'node:assert/strict';
import {
  skinContour, morphSkinContour, skinPoint, contourArea, contourTopY,
  normalizeSkins, unlockSkin, selectSkin, toggleSkins, unlockedSkinSides, skinOptions,
} from '../dist/skins.js';
import {fitCrownToSkin, projectSkinContour, photoMesh} from '../dist/skin-render.js';
import {crownOutline} from '../dist/boss-visuals.js';

const close = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);

test('all rewarded rounded skins have exactly the original circle area at every render resolution', () => {
  for (const segments of [96, 192, 384]) for (const sides of [0, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
    const points = skinContour(sides, segments);
    assert.equal(points.length, segments);
    close(contourArea(points), Math.PI);
    for (let i = 0; i < points.length; i++) {
      const angle = i * Math.PI * 2 / segments, point = points[i];
      close(point.x * Math.sin(angle) - point.y * Math.cos(angle), 0);
      assert.ok(point.x * Math.cos(angle) + point.y * Math.sin(angle) > .9);
    }
  }
});

test('rounded regular skins have tangent corner joins and flat top sides', () => {
  const samples = 1536;
  for (let sides = 6; sides <= 15; sides++) {
    const points = skinContour(sides, samples);
    const top = contourTopY(points, 0);
    close(contourTopY(points, .04), top);
    close(contourTopY(points, -.04), top);
    let maxTurn = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[(i + points.length - 1) % points.length], b = points[i], c = points[(i + 1) % points.length];
      const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
      const cross = ux * vy - uy * vx;
      assert.ok(cross >= -1e-12, 'contour remains convex');
      maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(cross, ux * vx + uy * vy)));
    }
    assert.ok(maxTurn < .04, `skin ${sides} has smooth corners, maximum turn ${maxTurn}`);
  }
});

test('all circle/polygon morphs retain area and polar correspondence, including interrupted changes', () => {
  for (const [from, to] of [[0, 6], [15, 0], ...Array.from({length: 9}, (_, i) => [i + 6, i + 7])]) {
    for (const t of [.01, .25, .5, .75, .99]) {
      const points = morphSkinContour(from, to, t);
      close(contourArea(points), Math.PI);
      const interrupted = morphSkinContour(points, 10, .1);
      close(contourArea(interrupted), Math.PI);
      for (let i = 0; i < points.length; i++) {
        const angle = i * Math.PI * 2 / points.length;
        close(points[i].x * Math.sin(angle) - points[i].y * Math.cos(angle), 0);
      }
    }
    assert.equal(morphSkinContour(from, to, 0), skinContour(from));
    assert.equal(morphSkinContour(from, to, 1), skinContour(to));
  }
});

test('skin ray samples and crown top agree with the same rendered boundary', () => {
  for (const sides of [0, 6, 7, 15]) {
    const points = skinContour(sides);
    for (let i = 0; i < points.length; i++) {
      const actual = skinPoint(i * Math.PI * 2 / points.length, sides);
      close(actual.x, points[i].x);
      close(actual.y, points[i].y);
    }
    for (const angle of [-Math.PI / 2, -Math.PI / 2 + .37, -Math.PI / 2 - .37]) {
      const point = skinPoint(angle, sides);
      close(contourTopY(points, point.x), point.y);
    }
  }
});

test('milestone rewards are 10→6 through 100→15 and do not repeat or auto-equip', () => {
  let state = normalizeSkins(null, 0);
  assert.deepEqual(state, {enabled: false, sides: 6, unlocked: 0});
  assert.equal(toggleSkins(state, true).enabled, false);
  for (let level = 1; level <= 100; level++) {
    const award = unlockSkin(state, level);
    assert.equal(award.rewardSides, level % 10 === 0 ? level / 10 + 5 : null);
    state = award.state;
    assert.equal(unlockSkin(state, level).rewardSides, null);
    assert.equal(state.enabled, false);
    assert.equal(state.sides, 6);
  }
  assert.equal(state.unlocked, 15);
  assert.equal(unlockSkin(state, 110).rewardSides, null);
});

test('legacy completed progress grants only already-cleared milestones, including level 100', () => {
  for (const [completed, unlocked] of [[0, 0], [9, 0], [10, 6], [19, 6], [20, 7], [99, 14], [100, 15]]) {
    assert.equal(unlockedSkinSides(completed), unlocked);
    const state = normalizeSkins(null, {completed});
    assert.equal(state.unlocked, unlocked);
    if (completed >= 10) assert.equal(unlockSkin(state, Math.floor(completed / 10) * 10).rewardSides, null);
  }
});

test('turning skins off preserves selection and limits controls to owned sides', () => {
  let state = normalizeSkins(null, 50);
  state = selectSkin(state, 100);
  assert.equal(state.sides, 10);
  state = selectSkin(toggleSkins(state, true), 8);
  assert.equal(state.enabled, true);
  state = toggleSkins(state, false);
  assert.deepEqual(state, {enabled: false, sides: 8, unlocked: 10});
  assert.deepEqual(toggleSkins(state, true), {enabled: true, sides: 8, unlocked: 10});
  assert.equal(selectSkin(state, -1).sides, 6);
  assert.deepEqual(normalizeSkins({enabled: true, sides: NaN, unlocked: '15'}), {enabled: false, sides: 6, unlocked: 0});
});

test('retired endless-only unlocks migrate to the original circle without granting campaign skins', () => {
  const legacy = {enabled: true, sides: 9, unlocked: 0, variants: [6, 7, 8, 9], variant: true};
  const state = normalizeSkins(legacy);
  assert.deepEqual(state, {enabled: false, sides: 6, unlocked: 0});
  assert.deepEqual(skinOptions(legacy), []);
  assert.deepEqual(skinOptions(state), []);
  assert.equal(toggleSkins(state, true).enabled, false);
  assert.equal(state.variant, undefined); assert.equal(state.variants, undefined);
  assert.deepEqual(normalizeSkins(JSON.parse(JSON.stringify(state))), state);
  assert.deepEqual(legacy.variants, [6, 7, 8, 9], 'migration does not mutate the caller save');
  const award = unlockSkin(state, 10);
  assert.equal(award.rewardSides, 6, 'retired rewards do not consume a campaign milestone');
  assert.equal(award.state.enabled, false);
  assert.deepEqual(skinOptions(award.state), [{sides: 6}]);
});

test('retired active variants fall back only to owned campaign shapes and keep normal selections', () => {
  const legacy = {enabled: true, sides: 7, unlocked: 8, variants: [6, 7, 8, 9], variant: true};
  const state = normalizeSkins(legacy);
  assert.deepEqual(state, {enabled: true, sides: 7, unlocked: 8});
  assert.deepEqual(skinOptions(legacy), [{sides: 6}, {sides: 7}, {sides: 8}]);
  assert.deepEqual(normalizeSkins({...legacy, sides: 9}), {enabled: true, sides: 8, unlocked: 8});
  assert.deepEqual(normalizeSkins({...legacy, enabled: false}), {enabled: false, sides: 7, unlocked: 8});
  assert.deepEqual(normalizeSkins({...legacy, unlocked: 0}, 10), {enabled: true, sides: 6, unlocked: 6});
  assert.deepEqual(normalizeSkins({enabled: true, sides: 12, unlocked: 15}), {enabled: true, sides: 12, unlocked: 15});
  assert.deepEqual(selectSkin(state, {sides: 9, variant: true}), {enabled: true, sides: 8, unlocked: 8});
  assert.deepEqual(toggleSkins(toggleSkins(state, false), true), state);
});

test('retired contour flags resolve to the exact same cached campaign shape at every resolution', () => {
  for (const sides of [6, 7, 8, 9, 12, 15]) for (const segments of [96, 192, 384]) {
    const base = skinContour(sides, segments), legacy = skinContour({sides, variant: true}, segments);
    assert.equal(legacy, base);
    close(contourArea(legacy), Math.PI);
    for (let i = 0; i < legacy.length; i++) {
      const sample = skinPoint(i / segments * Math.PI * 2, {sides, variant: true}, segments);
      close(sample.x, base[i].x); close(sample.y, base[i].y);
    }
  }
});

test('campaign morphs, crowns and photo geometry share the same contour through deformation', () => {
  const from = skinContour(6), to = skinContour(7);
  assert.equal(morphSkinContour(from, to, 0), from); assert.equal(morphSkinContour(from, to, 1), to);
  for (const t of [.1, .5, .9]) close(contourArea(morphSkinContour(from, to, t)), Math.PI);
  const crown = fitCrownToSkin(crownOutline(), to);
  assert.ok(crown.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert.notDeepEqual(crown, fitCrownToSkin(crownOutline(), from));
  const pose = {x: 100, y: 150, r: 32, roll: .8, deformAngle: -.4, squash: .2, pullAmount: .7, flightStretch: .08, flightAngle: .6};
  const boundary = projectSkinContour(to, pose), mesh = photoMesh(to, pose);
  for (let i = 0; i < to.length; i++) assert.deepEqual(mesh[i].target[1], boundary[i]);
});

test('skipping a milestone cannot grant its skin when a later milestone is cleared', () => {
  const before = normalizeSkins(null, 9);
  const later = unlockSkin(before, 20);
  assert.equal(later.rewardSides, 7);
  assert.deepEqual(later.state, {enabled: false, sides: 7, unlocked: 7, owned: [7]});
  assert.deepEqual(skinOptions(later.state), [{sides: 7}]);
  assert.equal(selectSkin(later.state, 6).sides, 7);
  assert.equal(unlockSkin(later.state, 20).rewardSides, null);
  const loaded = normalizeSkins(JSON.parse(JSON.stringify(later.state)), 9);
  assert.deepEqual(loaded, later.state, 'low contiguous completion keeps the actually earned higher polygon');
  const earlier = unlockSkin(toggleSkins(loaded, true), 10);
  assert.equal(earlier.rewardSides, 6, 'the newly cleared lower milestone still receives its first unlock');
  assert.deepEqual(earlier.state, {enabled: true, sides: 7, unlocked: 7});
  assert.deepEqual(skinOptions(earlier.state), [{sides: 6}, {sides: 7}]);
  assert.equal(unlockSkin(earlier.state, 10).rewardSides, null);
});

test('exact ownership preserves old polygons, skips holes in selection and never revives retired variants', () => {
  const legacy = {enabled: true, sides: 7, unlocked: 7, variants: [6, 7, 8, 9], variant: true};
  const award = unlockSkin(legacy, 40);
  assert.equal(award.rewardSides, 9);
  assert.deepEqual(award.state, {enabled: true, sides: 7, unlocked: 9, owned: [6, 7, 9]});
  assert.deepEqual(skinOptions(award.state), [{sides: 6}, {sides: 7}, {sides: 9}]);
  assert.equal(selectSkin(award.state, 8).sides, 7);
  assert.equal(selectSkin(award.state, 100).sides, 9);
  assert.equal(selectSkin(award.state, -1).sides, 6);
  assert.equal(award.state.variant, undefined); assert.equal(award.state.variants, undefined);
  assert.deepEqual(toggleSkins(toggleSkins(award.state, false), true), award.state);
  assert.deepEqual(normalizeSkins(award.state, 30), {enabled: true, sides: 7, unlocked: 9},
    'genuinely consecutive completion can fill an older ownership gap');
  assert.deepEqual(legacy, {enabled: true, sides: 7, unlocked: 7, variants: [6, 7, 8, 9], variant: true});
});

test('exact owned sides are sanitized without expanding them from a stale maximum field', () => {
  const raw = {enabled: true, sides: 8, unlocked: 15, owned: [9, 7, 7, 4, 18, '8', null, NaN], variants: [6]};
  const state = normalizeSkins(raw);
  assert.deepEqual(state, {enabled: true, sides: 7, unlocked: 9, owned: [7, 9]});
  assert.deepEqual(normalizeSkins(state), state);
  assert.deepEqual(skinOptions(raw), [{sides: 7}, {sides: 9}]);
  assert.deepEqual(normalizeSkins({enabled: true, unlocked: 15, owned: []}), {enabled: false, sides: 6, unlocked: 0});
});
