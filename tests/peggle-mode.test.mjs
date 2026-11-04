import test from 'node:test';
import assert from 'node:assert/strict';
import {peggleParams, peggleLayout, createPeggleRules} from '../dist/classes/peggle.js';
import {CampaignWorld} from '../dist/campaign.js';
import {campaignBounds} from '../dist/campaign-layout.js';

function realShot(world, angle, power = 1, dt = 1 / 120) {
  assert.equal(world.shoot(-Math.cos(angle) * world.maxPull * power, -Math.sin(angle) * world.maxPull * power), true);
  for (let frame = 0; frame < 800 && world.shotActive && world.phase === 'battle'; frame++) world.step(dt);
  assert.equal(world.shotActive, false);
}

function fixture(k = 0, width = 390, height = 844) {
  const unit = Math.max(18, Math.min(34, Math.min(width, height) * .047));
  const world = {width, height, unit, config: {k, ...peggleParams(k)}, statics: [], zones: [], events: [],
    arenaBounds: {left: 16, right: width - 16, top: 16, bottom: height - 16},
    player: {x: width / 2, y: height * .83, r: unit * peggleParams(k).playerRadius, vx: 0, vy: 0}, score: 0, shotActive: true,
    addStatic(spec) { const pin = {...spec, id: this.statics.length + 1}; this.statics.push(pin); return pin; },
    addZone(spec) { const zone = {...spec, id: this.zones.length + 100}; this.zones.push(zone); return zone; },
    emit(type, data = {}) { this.events.push({type, ...data}); },
    awardCampaignPoints(value, data) { this.score += value; this.emit('campaignPoints', {...data, value}); },
    grantFreeBall(zone) { if (zone.granted) return false; zone.granted = true; this.remaining++; this.emit('campaignFreeBall'); return true; },
    endLaunch() { this.shotActive = false; this.rules.onLaunchEnd(); },
  };
  world.arenaBounds = campaignBounds(world);
  world.rules = createPeggleRules(world); world.rules.setup(k); return world;
}

test('peggle chapters have the revised target counts and accessible budgets', () => {
  const examples = [[0, 13, 8, 11], [3, 16, 11, 11], [6, 18, 14, 10], [9, 30, 17, 10]];
  for (const [k, total, target, budget] of examples) {
    const p = peggleParams(k);
    assert.equal(p.totalPegs, total); assert.equal(p.targetPegs, target); assert.equal(p.budget, budget);
  }
  for (let k = 0; k < 10; k++) {
    const world = fixture(k), p = world.config;
    assert.equal(world.statics.length, p.totalPegs);
    assert.equal(world.statics.filter(pin => pin.target).length, p.targetPegs);
    assert.equal(world.statics.filter(pin => pin.moving).length, k >= 8 ? 2 : 0);
    assert.equal(world.remaining, p.budget);
    assert.equal(world.rules.rating(), 0);
    assert.equal(world.rules.progress(), 0);
  }
});

test('every pattern fits portrait and short landscape with fixed radius and no overlapping pins', () => {
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [568, 320], [1280, 720]]) {
    for (let k = 0; k < 10; k++) {
      const world = fixture(k, width, height), b = world.arenaBounds;
      for (const pin of world.statics) {
        assert.equal(pin.r, .36 * world.unit);
        assert.ok(pin.x - pin.r >= b.left && pin.x + pin.r <= b.right);
        assert.ok(pin.y - pin.r >= (height > 520 ? 112 : 76), 'pins clear the actual score/goal/budget HUD');
        assert.ok(pin.y - pin.r >= b.top && pin.y + pin.r < world.player.y - world.player.r);
      }
      for (let i = 0; i < world.statics.length; i++) for (let j = i + 1; j < world.statics.length; j++) {
        const a = world.statics[i], c = world.statics[j];
        assert.ok(Math.hypot(a.x - c.x, a.y - c.y) >= a.r + c.r, `${width}×${height} tier ${k}: ${i}/${j}`);
      }
      assert.equal(peggleLayout(world).positions.length, world.config.totalPegs);
    }
  }
});

test('target and normal pegs score once, remain solid for the shot, then clear at shot end', () => {
  const world = fixture(), target = world.statics.find(pin => pin.target), normal = world.statics.find(pin => !pin.target);
  world.rules.onLaunch();
  for (const pin of [target, normal]) {
    world.rules.onStaticHit(pin, {normalSpeed: 100, impactVx: 100, impactVy: 0});
    world.rules.onStaticHit(pin, {normalSpeed: 100, impactVx: -100, impactVy: 0});
    assert.equal(pin.active, true); assert.equal(pin.hp, 1); assert.equal(pin.hitThisShot, true);
  }
  assert.equal(world.targetsRemaining, world.config.targetPegs - 1); assert.equal(world.score, 20);
  assert.equal(world.events.filter(event => event.type === 'campaignPegHit').length, 2);
  world.rules.onLaunchEnd(); world.rules.onLaunchEnd();
  assert.equal(target.active, false); assert.equal(normal.active, false);
  assert.equal(world.events.filter(event => event.type === 'shatter').length, 2);
  world.rules.onStaticHit(target, {});
  assert.equal(world.score, 20);
});

test('the eighth distinct hit emits one run accent and a later launch resets its counter', () => {
  const world = fixture(4);
  world.rules.onLaunch();
  for (const pin of world.statics.slice(0, 9)) world.rules.onStaticHit(pin, {});
  assert.equal(world.events.filter(event => event.type === 'campaignPegRun').length, 1);
  world.rules.onLaunchEnd(); world.rules.onLaunch();
  for (const pin of world.statics.slice(9, 16)) world.rules.onStaticHit(pin, {});
  assert.equal(world.events.filter(event => event.type === 'campaignPegRun').length, 1);
});

test('the last target wins even on the last ball and rating uses spare balls', () => {
  for (const [remaining, rating] of [[0, 1], [1, 2], [2, 2], [3, 3], [10, 3]]) {
    const world = fixture(); world.remaining = remaining;
    const targets = world.statics.filter(pin => pin.target);
    for (const pin of targets) world.rules.onStaticHit(pin, {});
    assert.equal(world.rules.isWon(), true); assert.equal(world.rules.isLost(), false);
    assert.equal(world.rules.rating(), rating); assert.equal(world.targetsRemaining, 0);
    assert.deepEqual(world.peakOrigin, {x: targets.at(-1).x, y: targets.at(-1).y});
    world.shotActive = false;
    assert.equal(world.rules.isLost(), false);
    assert.equal(world.rules.progress(), 1);
  }
  const failed = fixture(); failed.remaining = 0;
  assert.equal(failed.rules.isLost(), false);
  failed.shotActive = false;
  assert.equal(failed.rules.isLost(), true);
  assert.equal(failed.rules.summary(), `差 ${failed.config.targetPegs} 钉`);
});

test('bucket width remains accessible and free ball credit is per launch', () => {
  const world = fixture(), bucket = world.zones[0], x = bucket.x;
  assert.equal(bucket.width / world.unit, 2.6);
  world.rules.onTick(.25);
  assert.ok(Math.abs(bucket.x - x - 1.2 * world.unit * .25) < 1e-8);
  const remaining = world.remaining;
  world.player.vy = 100;
  const entry = {previous: {x: bucket.x, y: bucket.y - bucket.height}};
  world.rules.onZone(world.player, bucket, entry); world.rules.onZone(world.player, bucket, entry);
  assert.equal(world.remaining, remaining + 1);
  assert.equal(world.shotActive, false);
  assert.equal(world.player.y, world.arenaBounds.bottom - 3 * world.unit);
  world.rules.onZone({...world.player}, bucket);
  assert.equal(world.remaining, remaining + 1);
  for (let i = 0; i < 10000; i++) {
    world.rules.onTick(1 / 120);
    assert.ok(bucket.x - bucket.width / 2 >= world.arenaBounds.left - 1e-7);
    assert.ok(bucket.x + bucket.width / 2 <= world.arenaBounds.right + 1e-7);
  }
});

test('resting, upward and already-overlapping bucket entries do not grant free balls', () => {
  for (const [vy, fromY] of [[0, -100], [-100, -100], [100, 0]]) {
    const world = fixture(), bucket = world.zones[0], remaining = world.remaining;
    world.player.vy = vy;
    world.rules.onZone(world.player, bucket, {previous: {x: bucket.x, y: bucket.y + fromY}});
    assert.equal(world.remaining, remaining);
    assert.equal(world.shotActive, true);
  }
});

test('high-tier pins move on bounded tracks and resize preserves hits, goals and motion phase', () => {
  const world = fixture(9), moving = world.statics.filter(pin => pin.moving), target = world.statics.find(pin => pin.target);
  world.rules.onStaticHit(target, {});
  const remaining = world.targetsRemaining, score = world.score;
  for (let i = 0; i < 1000; i++) {
    world.rules.onTick(1 / 120);
    for (const pin of moving) assert.ok(Math.abs(pin.x - pin.baseX) <= world.unit * .45 + 1e-7);
  }
  world.width = 844; world.height = 390;
  world.arenaBounds = {left: 16, right: 828, top: 16, bottom: 374};
  world.rules.resize();
  assert.equal(world.targetsRemaining, remaining); assert.equal(world.score, score);
  assert.equal(target.hitThisShot, true);
  for (const pin of moving) assert.ok(Math.abs(pin.vx) < world.unit, 'resize must not create an impulsive pin velocity');
  world.rules.onTick(1 / 120);
  for (const pin of moving) assert.ok(Math.abs(pin.vx) < world.unit);
});

test('the first-shot guide physically reaches targets with every offer on phone layouts', () => {
  for (const [width, height] of [[390, 844], [844, 390], [320, 568], [568, 320]]) {
    for (const upgradeId of ['rubber', 'energy', 'bank', 'pierce']) {
      const world = new CampaignWorld(width, height, 10, () => .5, {upgradeId});
      const target = world.teachingTarget, angle = Math.atan2(target.y - world.player.y, target.x - world.player.x);
      assert.equal(world.tutorialVisible, true);
      realShot(world, angle);
      assert.ok(world.targetsRemaining < world.config.targetPegs, `${width}×${height}/${upgradeId}: hint must hit a real target`);
      assert.equal(world.tutorialVisible, false);
      assert.equal(world.shotsUsed, 1);
      assert.equal(world.remaining, world.budget - 1 + world.freeBalls);
      assert.equal(world.statics.filter(pin => pin.active !== false && pin.hitThisShot).length, 0);
    }
  }
});

// Fixed routes discovered by an offline angle search. Replaying these uses
// only public shoot/step calls: no target, HP, budget or player-position edits.
const WINNING_ROUTES = [
  {"width":390,"height":844,"rank":0,"level":9,"upgradeId":"energy","fps":120,"shots":[[0.7853981633974483,1],[-2.28019019070131,1],[3.665191429188092,1],[1.0471975511965976,1],[-1.6886338204878364,1]]},
  {"width":390,"height":844,"rank":1,"level":10,"upgradeId":"energy","fps":120,"shots":[[-1.958178511138973,1],[-0.6705246171124748,1],[-2.108616380046505,1]]},
  {"width":390,"height":844,"rank":2,"level":19,"upgradeId":"energy","fps":120,"shots":[[-1.9931785111389728,1],[0.7853981633974483,1],[-1.8827673196070445,1],[-1.7321007555534977,1]]},
  {"width":390,"height":844,"rank":3,"level":20,"upgradeId":"energy","fps":120,"shots":[[-1.258331518928425,1],[6.021385919380436,1],[1.832595714594046,1],[5.759586531581287,1]]},
  {"width":390,"height":844,"rank":4,"level":29,"upgradeId":"energy","fps":120,"shots":[[-2.646004407018007,1],[-2.3543230878726296,1],[3.665191429188092,1],[-2.350635445299348,1]]},
  {"width":390,"height":844,"rank":5,"level":30,"upgradeId":"energy","fps":120,"shots":[[-1.0888377466068426,1],[0,1],[0.30202078957705003,1],[-2.048988298289321,1]]},
  {"width":390,"height":844,"rank":6,"level":39,"upgradeId":"energy","fps":120,"shots":[[0.7853981633974483,1],[0.7079741739771169,1],[-2.4146263850739,1],[-1.9169985788338637,1]]},
  {"width":390,"height":844,"rank":7,"level":40,"upgradeId":"energy","fps":120,"shots":[[-1.7465431965741862,1],[0.891727146448056,1],[-0.18831245606473337,1],[2.0943951023931953,1],[-2.960446302046433,1],[1.5961162575664019,1]]},
  {"width":390,"height":844,"rank":8,"level":49,"upgradeId":"energy","fps":120,"shots":[[-1.452958833101957,1],[4.4505895925855405,1],[3.4033920413889427,1],[2.356194490192345,1]]},
  {"width":390,"height":844,"rank":9,"level":50,"upgradeId":"energy","fps":120,"shots":[[-1.793436981444891,1],[1.2360696878229829,1],[1.3089969389957472,1],[2.3080255714265556,1],[-1.7062470227789834,1]]},
  {"width":390,"height":844,"rank":10,"level":59,"upgradeId":"energy","fps":120,"shots":[[6.021385919380436,1],[-2.7667343666415105,1],[2.1725438839807483,1],[-1.3959736461607988,1],[6.021385919380436,1]]},
  {"width":390,"height":844,"rank":11,"level":60,"upgradeId":"energy","fps":120,"shots":[[-1.8024809428788398,1],[-1.5854089426737532,1],[-1.0926663877017069,1],[4.1887902047863905,1],[1.0471975511965976,1]]},
  {"width":390,"height":844,"rank":12,"level":69,"upgradeId":"energy","fps":120,"shots":[[-1.4980047934786598,1],[-1.8011019624685765,1],[1.381924010646209,1],[2.0456269738362267,1],[-1.2078689569938286,1],[-1.3383058473592881,1],[-1.3383058473592881,1]]},
  {"width":390,"height":844,"rank":13,"level":70,"upgradeId":"energy","fps":120,"shots":[[-0.27818097559662175,1],[-0.3436218141063285,1],[2.411919387962474,1],[0.709430802202847,1],[1.0851293916540596,1]]},
  {"width":390,"height":844,"rank":14,"level":79,"upgradeId":"energy","fps":120,"shots":[[-1.4006262631749469,1],[-1.9905937932278823,1],[-1.1576228986954866,1],[3.14863292197127,1],[1.863827575133945,1],[1.0471975511965976,1],[0.8230643080539126,1]]},
  {"width":390,"height":844,"rank":15,"level":80,"upgradeId":"energy","fps":120,"shots":[[-1.3204280216950026,1],[-0.714599483154806,1],[-1.1096541142997407,1],[-1.6052146919793262,1],[1.2052062191639157,1]]},
  {"width":390,"height":844,"rank":16,"level":89,"upgradeId":"energy","fps":120,"shots":[[-1.8032868062305052,1],[0.02089963656189838,1],[4.1887902047863905,1],[-1.3970625562112287,1],[1.0471975511965976,1],[-1.2869885620934611,1]]},
  {"width":390,"height":844,"rank":17,"level":90,"upgradeId":"energy","fps":120,"shots":[[-1.6709663904148466,1],[-2.0251336450110875,1],[3.665191429188092,1],[1.767730107940986,1],[3.4033920413889427,1],[-0.13899911950166577,1]]},
  {"width":390,"height":844,"rank":18,"level":99,"upgradeId":"energy","fps":120,"shots":[[-1.4181556721449022,1],[-1.3977390131892289,1],[3.1576494520492013,1],[-1.1290129505992268,1],[3.4033920413889427,1],[2.356194490192345,1]]},
  {"width":390,"height":844,"rank":19,"level":100,"upgradeId":"energy","fps":120,"shots":[[-2.0139882982893207,1],[-0.609828365955652,1],[-2.038586328368326,1],[4.4505895925855405,1],[-0.8065227187272447,1],[-1.8032868062305052,1],[-1.5301406837046585,1]]},
  {"width":844,"height":390,"rank":0,"level":9,"upgradeId":"energy","fps":120,"shots":[[5.235987755982989,1],[-2.2930605724700923,1],[-0.22075196966105307,1],[0.5235987755982988,1],[2.5322622422261314,1]]},
  {"width":844,"height":390,"rank":1,"level":10,"upgradeId":"energy","fps":120,"shots":[[4.974188368183839,1],[-0.547514501558148,1],[-0.26291823600360686,1],[-0.2327961845007245,1]]},
  {"width":844,"height":390,"rank":2,"level":19,"upgradeId":"energy","fps":120,"shots":[[-2.4944158516876813,1],[2.8797932657906435,1],[2.356194490192345,1],[0.7853981633974483,1]]},
  {"width":844,"height":390,"rank":3,"level":20,"upgradeId":"energy","fps":120,"shots":[[-1.1975731427852392,1],[-2.6845903452564035,1],[-2.5670287359226727,1],[-3.084518496764176,1]]},
  {"width":844,"height":390,"rank":4,"level":29,"upgradeId":"energy","fps":120,"shots":[[-2.3136049726410834,1],[-2.9145622097727344,1],[4.4505895925855405,1],[2.875245051357713,1]]},
  {"width":844,"height":390,"rank":5,"level":30,"upgradeId":"energy","fps":120,"shots":[[-2.223060572470092,1],[3.4033920413889427,1],[2.7409651033875457,1],[0.5235987755982988,1]]},
  {"width":844,"height":390,"rank":6,"level":39,"upgradeId":"energy","fps":120,"shots":[[-2.5815638120071345,1],[5.759586531581287,1],[-3.088160297719299,1],[-2.920973461837929,1]]},
  {"width":844,"height":390,"rank":7,"level":40,"upgradeId":"energy","fps":120,"shots":[[3.926990816987241,1],[-0.002562244347655077,1],[3.0980109897794494,1],[-2.488685434464186,1]]},
  {"width":844,"height":390,"rank":8,"level":49,"upgradeId":"energy","fps":120,"shots":[[-0.848532081119701,1],[5.235987755982989,1],[2.1061509557031552,1],[-0.09757092901213718,1],[2.898349386806694,1]]},
  {"width":844,"height":390,"rank":9,"level":50,"upgradeId":"energy","fps":120,"shots":[[-2.4944635762939207,1],[1.0471975511965976,1],[1.0216868696339942,1],[0,1]]},
  {"width":844,"height":390,"rank":10,"level":59,"upgradeId":"energy","fps":120,"shots":[[-2.7068456136885417,1],[-0.23339716614691738,1],[-0.6031632477471296,1],[-0.1709158411942784,1],[0.021975712296045502,1]]},
  {"width":844,"height":390,"rank":11,"level":60,"upgradeId":"energy","fps":120,"shots":[[-2.5595218166450624,1],[-0.09741731831501074,1],[-2.982281666201533,1],[6.021385919380436,1],[0.5235987755982988,1]]},
  {"width":844,"height":390,"rank":12,"level":69,"upgradeId":"energy","fps":120,"shots":[[-2.5595218166450624,1],[0.10236787900037936,1],[0.7853981633974483,1],[-0.9425868156646817,1],[-1.454302965869208,1]]},
  {"width":844,"height":390,"rank":13,"level":70,"upgradeId":"energy","fps":120,"shots":[[5.235987755982989,1],[-0.01207499373063671,1],[2.356194490192345,1],[2.8610694360708813,1],[1.3089969389957472,1]]},
  {"width":844,"height":390,"rank":14,"level":79,"upgradeId":"energy","fps":120,"shots":[[-2.790877545307813,1],[0.5623808265591416,1],[-0.42064710866194643,1],[3.100909806660835,1],[5.497787143782138,1],[-3.1007552427300222,1]]},
  {"width":844,"height":390,"rank":15,"level":80,"upgradeId":"energy","fps":120,"shots":[[-2.511563812007134,1],[-1.4850687899232957,1],[1.0911576028009147,1],[-2.698557532880133,1],[-2.8221005473163197,1]]},
  {"width":844,"height":390,"rank":16,"level":89,"upgradeId":"energy","fps":120,"shots":[[-2.559435157833371,1],[2.9370924448195215,1],[-0.6231835720707425,1],[-2.7068456136885417,1],[3.0159841974529633,1]]},
  {"width":844,"height":390,"rank":17,"level":90,"upgradeId":"energy","fps":120,"shots":[[-2.589578836446443,1],[5.235987755982989,1],[-0.7284041496021354,1],[5.497787143782138,1],[1.1575812954522844,1],[-0.11489657870908979,1]]},
  {"width":844,"height":390,"rank":18,"level":99,"upgradeId":"energy","fps":120,"shots":[[-2.589578836446443,1],[-0.2583722387595492,1],[0,1],[2.90192621004738,1],[-2.9717213828117313,1],[-1.524363870348244,1],[-2.9333053361699175,1]]},
  {"width":844,"height":390,"rank":19,"level":100,"upgradeId":"energy","fps":120,"shots":[[-2.3136049726410834,1],[-0.19488871374295666,1],[3.665191429188092,1],[2.8797932657906435,1],[2.0943951023931953,1],[-1.9909199782387004,1]]},
  {"width":390,"height":844,"rank":0,"level":9,"upgradeId":"energy","fps":30,"shots":[[-1.7236338204878363,1],[-2.8290691465278885,1],[-1.2897227311631163,1],[-0.368825226812274,1]]},
  {"width":390,"height":844,"rank":1,"level":10,"upgradeId":"energy","fps":30,"shots":[[-2.3700699348625487,1],[-1.3640972960078792,1],[0.7853981633974483,1]]},
  {"width":390,"height":844,"rank":2,"level":19,"upgradeId":"energy","fps":30,"shots":[[-1.7156160793544104,1],[-1.090949403798386,1],[0.2617993877991494,1],[-1.6012500192571837,1],[-1.3950494570156071,1]]},
  {"width":390,"height":844,"rank":3,"level":20,"upgradeId":"energy","fps":30,"shots":[[5.235987755982989,1],[0.3610008875624029,1],[1.5038218880794159,1],[2.0943951023931953,1],[-0.8065227187272447,1]]},
  {"width":390,"height":844,"rank":4,"level":29,"upgradeId":"energy","fps":30,"shots":[[0.7853981633974483,1],[4.974188368183839,1],[1.2966705000667484,1],[4.1887902047863905,1]]},
  {"width":390,"height":844,"rank":5,"level":30,"upgradeId":"energy","fps":30,"shots":[[-1.0888377466068426,1],[-1.4547113450810576,1],[4.71238898038469,1],[1.5707963267948966,1],[1.376287074178856,1]]},
  {"width":390,"height":844,"rank":6,"level":39,"upgradeId":"energy","fps":30,"shots":[[0.7853981633974483,1],[-1.0993606625321874,1],[1.5707963267948966,1],[0.5922419480725555,1]]},
  {"width":390,"height":844,"rank":7,"level":40,"upgradeId":"energy","fps":30,"shots":[[-2.863411677993171,1],[-1.4194537287939075,1],[-1.3045674903763012,1],[-1.1627162759975793,1]]},
  {"width":390,"height":844,"rank":8,"level":49,"upgradeId":"energy","fps":30,"shots":[[4.1887902047863905,1],[-1.539855069338839,1],[-1.0743851949410714,1],[2.356194490192345,1]]},
  {"width":390,"height":844,"rank":9,"level":50,"upgradeId":"energy","fps":30,"shots":[[-1.758436981444891,1],[1.4961965176240488,1],[-1.241079170856145,1],[1.0471975511965976,1]]},
  {"width":390,"height":844,"rank":10,"level":59,"upgradeId":"energy","fps":30,"shots":[[2.6179938779914944,1],[-1.8340272615807571,1],[4.974188368183839,1],[2.356194490192345,1]]},
  {"width":390,"height":844,"rank":11,"level":60,"upgradeId":"energy","fps":30,"shots":[[-1.9789882982893208,1],[1.058080211855938,1],[-0.867693614644746,1],[3.4033920413889427,1],[1.832595714594046,1]]},
  {"width":390,"height":844,"rank":12,"level":69,"upgradeId":"energy","fps":30,"shots":[[-2.36002748134082,1],[1.6716954816252738,1],[2.5553211406558507,1],[1.7582222465700024,1],[1.6140528793526083,1]]},
  {"width":390,"height":844,"rank":13,"level":70,"upgradeId":"energy","fps":30,"shots":[[-1.0086218800516222,1],[-1.4150937794062919,1],[-1.4932803511409527,1],[2.771322954986298,1],[-0.24318097559662175,1],[5.497787143782138,1]]},
  {"width":390,"height":844,"rank":14,"level":79,"upgradeId":"energy","fps":30,"shots":[[-2.1329707735381707,1],[-2.6929760640495912,1],[-1.7781029917575055,1],[2.5686600161132143,1],[-2.272721095182354,1]]},
  {"width":390,"height":844,"rank":15,"level":80,"upgradeId":"energy","fps":30,"shots":[[3.4033920413889427,1],[5.497787143782138,1],[-1.3481556721449024,1],[3.665191429188092,1],[-1.2176588492435512,1],[3.665191429188092,1]]},
  {"width":390,"height":844,"rank":16,"level":89,"upgradeId":"energy","fps":30,"shots":[[-1.6435878601111336,1],[1.4003913010396247,1],[2.0943951023931953,1],[-2.219086619938263,1],[2.0943951023931953,1],[-2.8984116779931712,1],[-1.3741117107109535,1]]},
  {"width":390,"height":844,"rank":17,"level":90,"upgradeId":"energy","fps":30,"shots":[[-1.923178511138973,1],[-1.3796350695457982,1],[0.5235987755982988,1],[5.235987755982989,1],[-2.2327185803948275,1],[-1.1268944893447033,1],[0.7853981633974483,1]]},
  {"width":390,"height":844,"rank":18,"level":99,"upgradeId":"energy","fps":30,"shots":[[-2.0690193476355434,1],[4.71238898038469,1],[1.905080637832782,1],[-0.25233864515822113,1],[1.0471975511965976,1],[-0.6900815513844826,1]]},
  {"width":390,"height":844,"rank":19,"level":100,"upgradeId":"energy","fps":30,"shots":[[-1.9789882982893208,1],[-2.0723827302009514,1],[-0.5999890754484786,1],[2.6127824527584025,1],[-0.46058824657178604,1],[3.926990816987241,1]]},
  {"width":844,"height":390,"rank":0,"level":9,"upgradeId":"energy","fps":30,"shots":[[4.4505895925855405,1],[-1.023681809326881,1],[6.021385919380436,1],[-3.1368388849112847,1]]},
  {"width":844,"height":390,"rank":1,"level":10,"upgradeId":"energy","fps":30,"shots":[[-2.9763258721402632,1],[-0.0612713892097512,1],[-2.2814558787096932,1],[2.356194490192345,1]]},
  {"width":844,"height":390,"rank":2,"level":19,"upgradeId":"energy","fps":30,"shots":[[3.926990816987241,1],[-0.7525872924577925,1],[6.021385919380436,1],[-0.6179072191256069,1]]},
  {"width":844,"height":390,"rank":3,"level":20,"upgradeId":"energy","fps":30,"shots":[[-1.1975731427852392,1],[2.5101296949385223,1],[1.3089969389957472,1],[-2.9972125934848974,1],[3.103983801622661,1]]},
  {"width":844,"height":390,"rank":4,"level":29,"upgradeId":"energy","fps":30,"shots":[[-2.3486049726410836,1],[6.021385919380436,1],[2.356194490192345,1],[0.5149398637130097,1]]},
  {"width":844,"height":390,"rank":5,"level":30,"upgradeId":"energy","fps":30,"shots":[[-2.8274733446009783,1],[1.9559803836219167,1],[-2.7659111034291004,1],[-0.31411930898881474,1]]},
  {"width":844,"height":390,"rank":6,"level":39,"upgradeId":"energy","fps":30,"shots":[[-2.424606772313674,1],[2.2443820208514835,1],[-2.9037102035637106,1],[-2.3507678720377707,1],[-3.0523360954517584,1]]},
  {"width":844,"height":390,"rank":7,"level":40,"upgradeId":"energy","fps":30,"shots":[[-1.148192850717397,1],[3.141592653589793,1],[0.2617993877991494,1],[-0.33118056435849547,1]]},
  {"width":844,"height":390,"rank":8,"level":49,"upgradeId":"energy","fps":30,"shots":[[-2.0633998028723965,1],[-0.582157495756422,1],[2.661745871132551,1],[-1.7020145206058788,1],[-2.679473862553864,1]]},
  {"width":844,"height":390,"rank":9,"level":50,"upgradeId":"energy","fps":30,"shots":[[-2.720945544927847,1],[-2.632841335503591,1],[4.1887902047863905,1],[-0.5967408771664109,1],[0.04523680845042629,1]]},
  {"width":844,"height":390,"rank":10,"level":59,"upgradeId":"energy","fps":30,"shots":[[-2.5586854344641865,1],[4.974188368183839,1],[3.0801035277904645,1],[2.8797932657906435,1]]},
  {"width":844,"height":390,"rank":11,"level":60,"upgradeId":"energy","fps":30,"shots":[[-2.8624733446009785,1],[-0.6312806872634447,1],[-3.019591719837299,1],[-0.9683226668598829,1],[3.4033920413889427,1]]},
  {"width":844,"height":390,"rank":12,"level":69,"upgradeId":"energy","fps":30,"shots":[[-2.424606772313674,1],[0.18118220699980786,1],[0.2617993877991494,1],[-0.143798314321481,1]]},
  {"width":844,"height":390,"rank":13,"level":70,"upgradeId":"energy","fps":30,"shots":[[-2.720945544927847,1],[-3.1651356213313817,1],[-1.8285004030098382,1],[0.2617993877991494,1],[-2.790823148315331,1]]},
  {"width":844,"height":390,"rank":14,"level":79,"upgradeId":"energy","fps":30,"shots":[[-2.223060572470092,1],[-2.8768265326387765,1],[-0.1227884012667473,1],[4.1887902047863905,1],[1.832595714594046,1]]},
  {"width":844,"height":390,"rank":15,"level":80,"upgradeId":"energy","fps":30,"shots":[[-2.906439986773993,1],[2.4234128141547497,1],[5.759586531581287,1],[-3.1635406505855435,1],[-3.0606224780549787,1],[-2.7900065230409963,1]]},
  {"width":844,"height":390,"rank":16,"level":89,"upgradeId":"energy","fps":30,"shots":[[-2.0633998028723965,1],[-2.3669786782900135,1],[0.7853981633974483,1],[-0.3049817356997343,1],[-0.5642288393037616,1]]},
  {"width":844,"height":390,"rank":17,"level":90,"upgradeId":"energy","fps":30,"shots":[[-2.2931562275690793,1],[-1.111530800763288,1],[-0.23056412644279298,1],[3.665191429188092,1],[-1.8834877413415372,1],[-0.04785351649869839,1]]},
  {"width":844,"height":390,"rank":18,"level":99,"upgradeId":"energy","fps":30,"shots":[[-3.0256224780549785,1],[3.4033920413889427,1],[-2.8879719830992867,1],[0.5183756489300518,1],[0.2617993877991494,1],[3.0494773143854124,1],[4.4505895925855405,1]]},
  {"width":844,"height":390,"rank":19,"level":100,"upgradeId":"energy","fps":30,"shots":[[-0.5820708369447307,1],[-0.2010141906455913,1],[-0.3569870176943548,1],[-2.936025654562098,1],[5.497787143782138,1],[3.665191429188092,1]]}
];

test('real launch routes clear all twenty authored boards in portrait and landscape at 30 and 120 fps within budget', () => {
  for (const route of WINNING_ROUTES) {
    const world = new CampaignWorld(route.width, route.height, route.level, () => .5, {upgradeId: route.upgradeId});
    for (const [angle, power] of route.shots) realShot(world, angle, power, 1 / route.fps);
    assert.equal(world.completed, true, `${route.width}×${route.height} rank ${route.rank} at ${route.fps}fps`);
    assert.equal(world.targetsRemaining, 0);
    assert.equal(world.phase, 'campaign-celebrate');
    assert.equal(world.events.filter(event => event.type === 'campaignPeak').length, 1);
    assert.equal(world.shotsUsed, route.shots.length);
    assert.equal(world.remaining, world.budget - world.shotsUsed + world.freeBalls);
    const score = world.score, spare = world.remaining;
    for (let frame = 0; frame < 800 && world.phase !== 'over'; frame++) world.step(1 / 120);
    assert.equal(world.phase, 'over');
    assert.equal(world.score, score + spare * 10);
    assert.equal(world.events.filter(event => event.type === 'campaignBonus').length, spare);
    assert.equal(world.events.filter(event => event.type === 'over').length, 1);
    assert.equal(world.resultRating, spare >= 3 ? 3 : spare >= 1 ? 2 : 1);
    const final = world.score;
    world.step(10);
    assert.equal(world.score, final);
    assert.equal(world.events.filter(event => event.type === 'over').length, 1);
  }
});
