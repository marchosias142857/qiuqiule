import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld, campaignUpgradePool, levelConfig} from '../dist/campaign.js';
import {wallParams, wallCells} from '../dist/classes/wall.js';
import {peggleParams} from '../dist/classes/peggle.js';

const levelFor = (rank, mode) => Math.floor(rank / 2) * 10 + (mode === 'wall' ? 1 : 9) + rank % 2;
const shootAt = (world, target) => {
  const angle = Math.atan2(target.y - world.player.y, target.x - world.player.x);
  assert.ok(world.shoot(-Math.cos(angle) * world.maxPull, -Math.sin(angle) * world.maxPull));
  for (let i = 0; i < 800 && world.shotActive && world.phase === 'battle'; i++) world.step(1 / 120);
};

test('wall and peggle have twenty distinct physical challenges with no duplicate paired level', () => {
  let hp = 0, width = Infinity, targets = 0, budget = Infinity;
  for (let rank = 0; rank < 20; rank++) {
    const k = Math.floor(rank / 2), variant = rank % 2;
    const wall = wallParams(k, variant), peg = peggleParams(k, variant);
    assert.ok(wall.totalHP > hp); hp = wall.totalHP;
    assert.equal(wall.totalHP, wallCells(k, variant).reduce((n, b) => n + b.hp, 0));
    assert.ok(wall.threePointShots < wall.twoPointShots && wall.twoPointShots < wall.budget);
    assert.ok(peg.bucketWidth < width && peg.totalPegs > peg.targetPegs);
    assert.ok(peg.targetPegs >= targets && peg.budget <= budget);
    [width, targets, budget] = [peg.bucketWidth, peg.targetPegs, peg.budget];
    assert.equal(levelConfig(levelFor(rank, 'wall')).totalHP, wall.totalHP);
    assert.equal(levelConfig(levelFor(rank, 'peggle')).totalPegs, peg.totalPegs);
  }
});

test('twenty wall and peg layouts fit the shared campaign frame in five viewport shapes', () => {
  for (const [w, h] of [[320, 568], [390, 844], [844, 390], [568, 320], [1440, 900]]) {
    for (const mode of ['wall', 'peggle']) for (let rank = 0; rank < 20; rank++) {
      const world = new CampaignWorld(w, h, levelFor(rank, mode), () => .5), b = world.arenaBounds;
      for (const s of world.statics) {
        const rx = s.shape === 'rect' ? s.width / 2 : s.r, ry = s.shape === 'rect' ? s.height / 2 : s.r;
        assert.ok(s.x - rx >= b.left - 1e-6 && s.x + rx <= b.right + 1e-6, `${mode} ${rank} horizontal bounds`);
        assert.ok(s.y - ry >= b.top - 1e-6 && s.y + ry <= b.bottom + 1e-6, `${mode} ${rank} vertical bounds`);
        assert.ok(s.y + ry < world.player.y - world.player.r, `${mode} ${rank} clears initial ball`);
      }
      if (mode === 'peggle') {
        for (let i = 0; i < world.statics.length; i++) for (let j = i + 1; j < world.statics.length; j++) {
          const a = world.statics[i], c = world.statics[j];
          assert.ok(Math.hypot(a.x - c.x, a.y - c.y) >= a.r + c.r - 1e-6, `${w}×${h} ${rank} pegs ${i}/${j}`);
        }
        assert.equal(world.zones[0].width / world.unit, world.config.bucketWidth);
      }
    }
  }
});

test('all twenty guides hit actual objectives on every phone orientation and offered upgrade', () => {
  for (const [w, h] of [[390, 844], [844, 390], [320, 568], [568, 320]]) {
    for (let rank = 0; rank < 20; rank++) for (const mode of ['wall', 'peggle']) for (const {id} of campaignUpgradePool(levelFor(rank, mode))) {
      const level = levelFor(rank, mode);
      const world = new CampaignWorld(w, h, level, () => .5, {upgradeId: id});
      assert.equal(world.tutorialVisible, true);
      assert.equal(world.tutorialPullRatio, 1);
      shootAt(world, world.teachingTarget);
      assert.ok(world.config.type === 'wall' ? world.wallTotalHP > world.statics.reduce((n, b) => n + Math.max(0, b.hp || 0), 0) : world.targetsRemaining < world.totalTargets,
        `${w}×${h} level ${level} ${id} guide makes objective progress`);
    }
  }
});

test('wall speed damage uses the normal component and four-brick celebration occurs once per shot', () => {
  const world = new CampaignWorld(390, 844, 91, () => .5), brick = world.statics.find(s => s.hp === 3);
  world.shotActive = true;
  world.rules.onStaticHit(brick, {normalSpeed: 20 * world.unit, impactSpeed: 50 * world.unit});
  assert.equal(brick.hp, 2, 'a fast graze does not get the full-speed damage bonus');
  world.rules.onStaticHit(brick, {normalSpeed: 20.01 * world.unit});
  assert.equal(brick.hp, 0, 'the normal speed threshold applies two HP');
  world.events.length = 0; world.rules.onLaunch();
  for (let i = 0; i < 9; i++) world.rules.onKill({kind: 'brick', x: i, y: 100});
  assert.equal(world.events.filter(e => e.type === 'campaignCombo').length, 1);
  assert.equal(world.events.find(e => e.type === 'campaignCombo').combo, 4);
  world.rules.onLaunch();
  for (let i = 0; i < 4; i++) world.rules.onKill({kind: 'brick', x: i, y: 100});
  assert.equal(world.events.filter(e => e.type === 'campaignCombo').length, 2);
  assert.deepEqual(campaignUpgradePool(1).map(x => x.id), ['rubber', 'energy', 'bank', 'density']);
});

test('wall and peg live scoring exposes the same reachable bands as final ratings', () => {
  for (let rank = 0; rank < 20; rank++) {
    const wall = new CampaignWorld(390, 844, levelFor(rank, 'wall'), () => .5);
    for (const [shots, rating] of [[wall.config.threePointShots, 3], [wall.config.threePointShots + 1, 2], [wall.config.twoPointShots + 1, 1]]) {
      wall.shotsUsed = shots; assert.equal(wall.ratingStatus.rating, rating);
      assert.ok(wall.ratingStatus.three.includes(String(wall.config.threePointShots)));
    }
    const peg = new CampaignWorld(390, 844, levelFor(rank, 'peggle'), () => .5);
    for (const [remaining, rating] of [[3, 3], [2, 2], [1, 2], [0, 1]]) {
      peg.remaining = remaining; assert.equal(peg.ratingStatus.rating, rating);
    }
  }
});
