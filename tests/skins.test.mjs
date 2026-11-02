import test from 'node:test';
import assert from 'node:assert/strict';
import {
  skinContour, morphSkinContour, skinPoint, contourArea, contourTopY,
  normalizeSkins, unlockSkin, selectSkin, toggleSkins, unlockedSkinSides,
} from '../dist/skins.js';

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
