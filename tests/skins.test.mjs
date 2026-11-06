import test from 'node:test';
import assert from 'node:assert/strict';
import {
  skinContour, morphSkinContour, skinPoint, contourArea, contourTopY,
} from '../dist/skins.js';
import {fitCrownToSkin, projectSkinContour, photoMesh} from '../dist/skin-render.js';
import {crownOutline} from '../dist/boss-visuals.js';

const close = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);

test('rounded contours have exactly the original circle area at every render resolution', () => {
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

test('object-form contours ignore extra flags and share the same cached geometry at every resolution', () => {
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

test('morphs, crowns and photo geometry share the same contour through deformation', () => {
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
