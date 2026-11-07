import {World} from './physics.js';
import {UPGRADES} from './upgrades.js';
import {captureEndlessRun, restoreEndlessRun} from './endless-progress.js';

export const RUN_SAVE_VERSION = 1;
export const RUN_SAVE_KEY = 'qiuqiule-run-save';
const FORMAT = 'qiuqiule-run';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_NODES = 24000;
const MAX_VALUES = 160000;
const PHASES = new Set(['battle', 'clearing', 'transition', 'choose', 'reward', 'boss-entry', 'boss', 'boss-celebrate']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const own = (object, key) => Object.hasOwn(object, key);
const plain = value => value && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const fail = () => { throw new TypeError('Invalid run snapshot'); };
const require = condition => { if (!condition) fail(); };

// Every own World field is retained, including fields first created during a
// shot, reward transition or Boss encounter. A graph preserves activeShot's
// shared reference with shotHistory, as well as references from scene extras.
function encodeGraph(root, world) {
  const nodes = [], ids = new Map(); let values = 0;
  function encode(value, depth = 0) {
    require(++values <= MAX_VALUES && depth <= 100);
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number') {
      require(!Number.isNaN(value));
      return Number.isFinite(value) ? Object.is(value, -0) ? {n: '-0'} : value : {n: value > 0 ? '+' : '-'};
    }
    if (value === undefined) return {u: 1};
    require(typeof value === 'object');
    if (ids.has(value)) return {r: ids.get(value)};
    require(nodes.length < MAX_NODES);
    const index = nodes.length; ids.set(value, index);
    const node = {}; nodes.push(node);
    if (value === world) node.t = 'world';
    else if (Array.isArray(value)) node.t = 'array';
    else if (value instanceof Set) node.t = 'set';
    else if (value instanceof Map) node.t = 'map';
    else { require(plain(value)); node.t = Object.getPrototypeOf(value) === null ? 'null-object' : 'object'; }
    if (node.t === 'array' || node.t === 'set') node.v = Array.from(value, item => encode(item, depth + 1));
    else if (node.t === 'map') node.v = Array.from(value, ([key, item]) => [encode(key, depth + 1), encode(item, depth + 1)]);
    else {
      node.v = [];
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (value === world && key === 'random') continue;
        require(!FORBIDDEN_KEYS.has(key) && own(descriptor, 'value') && typeof descriptor.value !== 'function');
        node.v.push([key, encode(descriptor.value, depth + 1)]);
      }
    }
    return {r: index};
  }
  return {root: encode(root), nodes};
}

function decodeGraph(graph) {
  require(plain(graph) && Array.isArray(graph.nodes) && graph.nodes.length > 0 && graph.nodes.length <= MAX_NODES);
  let worldCount = 0, values = 0;
  const objects = graph.nodes.map(node => {
    require(plain(node) && Array.isArray(node.v));
    if (node.t === 'world') { require(++worldCount === 1); return Object.create(World.prototype); }
    if (node.t === 'object') return {};
    if (node.t === 'null-object') return Object.create(null);
    if (node.t === 'array') return [];
    if (node.t === 'set') return new Set();
    if (node.t === 'map') return new Map();
    fail();
  });
  require(worldCount === 1);
  function decode(value) {
    require(++values <= MAX_VALUES);
    if (value === null || ['boolean', 'string'].includes(typeof value)) return value;
    if (typeof value === 'number') { require(Number.isFinite(value)); return value; }
    require(plain(value) && Object.keys(value).length === 1);
    if (own(value, 'r')) { require(Number.isInteger(value.r) && value.r >= 0 && value.r < objects.length); return objects[value.r]; }
    if (own(value, 'u') && value.u === 1) return undefined;
    if (own(value, 'n')) {
      if (value.n === '+') return Infinity;
      if (value.n === '-') return -Infinity;
      if (value.n === '-0') return -0;
    }
    fail();
  }
  for (let index = 0; index < graph.nodes.length; index++) {
    const node = graph.nodes[index], object = objects[index];
    if (node.t === 'array') for (const item of node.v) object.push(decode(item));
    else if (node.t === 'set') for (const item of node.v) object.add(decode(item));
    else if (node.t === 'map') for (const pair of node.v) {
      require(Array.isArray(pair) && pair.length === 2); object.set(decode(pair[0]), decode(pair[1]));
    } else {
      const keys = new Set();
      for (const pair of node.v) {
        require(Array.isArray(pair) && pair.length === 2);
        const [key, value] = pair;
        require(typeof key === 'string' && !FORBIDDEN_KEYS.has(key) && !keys.has(key)); keys.add(key);
        if (node.t === 'world') require(key !== 'random' && !(key in World.prototype));
        Object.defineProperty(object, key, {value: decode(value), writable: true, enumerable: true, configurable: true});
      }
    }
  }
  return decode(graph.root);
}

const finiteFields = ['width', 'height', 'unit', 'inset', 'time', 'feedbackTime', 'borderTime', 'stage', 'maxStage',
  'maxCombo', 'totalShots', 'totalKills', 'elapsed', 'rewardSelectionsRemaining', 'upgradeRound', 'upgradeRoundTotal',
  'bossVictorySlowTime', 'score', 'target', 'stageKills', 'stageKillCarry', 'shotKills', 'shotWallCount', 'stageShots',
  'stageRealKills', 'gamblerTargetMultiplier', 'overTimer', 'phaseTime', 'clusterId', 'stepSerial', 'breathTime',
  'pulseCooldown', 'bossKills', 'arenaBlend', 'arenaRestoreFrom', 'id', 'density', 'energy', 'bank',
  'feedbackKills', 'feedbackFreezeUsed'];
const booleanFields = ['startingUpgrades', 'shotRecoveryUsed', 'shotBanked', 'shotSplitUsed', 'pendingUpgradeBoost',
  'shotUpgradeBoost', 'nextGambler', 'gamblerRewardPending', 'saveUsed', 'riskOfferCooldown'];
const nullableFields = ['shotRelease', 'magnetPull', 'upgradeContext', 'activeShot', 'clearing', 'pendingClearing',
  'wave', 'floorCluster', 'boss', 'bossCelebration'];
function validBody(body) {
  return plain(body) && Number.isSafeInteger(body.id) && body.id > 0 &&
    ['x', 'y', 'vx', 'vy', 'r', 'density', 'born', 'angle', 'spin'].every(key => Number.isFinite(body[key])) &&
    body.r > 0 && typeof body.hp === 'number' && !Number.isNaN(body.hp) &&
    typeof body.mass === 'number' && body.mass > 0;
}
function validateWorld(world) {
  require(Object.getPrototypeOf(world) === World.prototype && PHASES.has(world.phase) && world.mode !== 'campaign' && !world.isRunChoice);
  require(finiteFields.every(key => own(world, key) && Number.isFinite(world[key])));
  require(booleanFields.every(key => typeof world[key] === 'boolean'));
  require(nullableFields.every(key => own(world, key) && (world[key] === null || plain(world[key]))));
  require(['spawnTimer', 'floorTimer', 'introTimer'].every(key => typeof world[key] === 'number' && !Number.isNaN(world[key])));
  require(world.width > 0 && world.height > 0 && world.width <= 100000 && world.height <= 100000 && world.unit > 0);
  require(Number.isSafeInteger(world.stage) && world.stage >= 1 && Number.isSafeInteger(world.maxStage) && world.maxStage >= 1);
  require(world.pullStartSpeed === null || Number.isFinite(world.pullStartSpeed));
  require(world.deathReason === null || typeof world.deathReason === 'string');
  require(['enemies', 'auxiliaries', 'choices', 'events', 'fragmentQueue', 'shotHistory'].every(key => Array.isArray(world[key])));
  require(world.shotHistory.every(shot => plain(shot) && Number.isFinite(shot.time) && Number.isFinite(shot.hits)));
  require(world.events.every(event => plain(event) && typeof event.type === 'string'));
  require(world.choices.every(choice => plain(choice) && typeof choice.id === 'string' && choice.r > 0 &&
    ['x', 'y', 'r', 'born'].every(key => Number.isFinite(choice[key]))));
  require(world.fragmentQueue.every(child => plain(child) &&
    ['x', 'y', 'maxHp', 'density', 'splitFamilyId', 'clusterId', 'distanceUnits', 'angle'].every(key => Number.isFinite(child[key]))));
  require(world.seenEnemyKills instanceof Set && plain(world.buffs) && plain(world.typeIntroductions) && plain(world.feedbackOptions));
  require(validBody(world.player) && world.player.isPlayer === true && world.enemies.every(validBody) && world.auxiliaries.every(validBody));
  if (world.boss !== null) require(validBody(world.boss) && world.boss.contacts instanceof Set && Array.isArray(world.boss.thresholds));
  if (world.phase.startsWith('boss')) require(world.boss !== null);
  if (world.phase === 'clearing') require(plain(world.clearing));
  if (world.phase === 'transition') require(plain(world.rollFrom) && plain(world.rewardShapeFrom));
}

export function createRunSnapshot({world, runDay, extra = {}} = {}) {
  validateWorld(world);
  require(world.random === runDay?.random && plain(extra));
  const run = captureEndlessRun(runDay);
  const snapshot = {format: FORMAT, version: RUN_SAVE_VERSION, run, data: encodeGraph({world, extra}, world)};
  require(JSON.stringify(snapshot).length <= MAX_BYTES);
  return snapshot;
}

// Bad, incomplete or unsupported data is ignored at the boundary. Nothing in
// the live world or the previous persistent slot is mutated during validation.
export function restoreRunSnapshot(raw) {
  try {
    if (typeof raw === 'string') { require(raw.length <= MAX_BYTES); raw = JSON.parse(raw); }
    require(plain(raw) && raw.format === FORMAT && raw.version === RUN_SAVE_VERSION);
    require(JSON.stringify(raw).length <= MAX_BYTES);
    const runDay = restoreEndlessRun(raw.run), root = decodeGraph(raw.data);
    require(plain(root) && own(root, 'world') && own(root, 'extra') && plain(root.extra));
    if (!own(root.world, 'riskOfferCooldown')) {
      // v10.1 saves have no offer history. A still-visible double-risk offer
      // proves the next round needs protection; do not invent older history.
      const visible = ['transition', 'choose'].includes(root.world.phase) && Array.isArray(root.world.choices);
      root.world.riskOfferCooldown = visible && new Set(root.world.choices
        .filter(choice => UPGRADES[choice?.id]?.kind === 'risk').map(choice => choice.id)).size > 1;
    }
    validateWorld(root.world); root.world.random = runDay.random;
    return {world: root.world, runDay, extra: root.extra};
  } catch { return null; }
}

export function createRunSaveStore(storage, key = RUN_SAVE_KEY) {
  return {
    read() {
      try {
        const raw = storage?.getItem(key);
        return raw && restoreRunSnapshot(raw) ? JSON.parse(raw) : null;
      } catch { return null; }
    },
    write(snapshot) {
      try {
        if (!restoreRunSnapshot(snapshot) || typeof storage?.setItem !== 'function') return false;
        storage.setItem(key, JSON.stringify(snapshot)); return true;
      } catch { return false; }
    },
    remove() {
      try {
        if (typeof storage?.removeItem !== 'function') return false;
        storage.removeItem(key); return true;
      } catch { return false; }
    },
    invalidate() {
      // A forced ending cannot remain resumable merely because removal is
      // unavailable. A terminal marker replaces the previous run atomically;
      // it deliberately has a different format and is never restorable.
      if (this.remove()) return true;
      try {
        if (typeof storage?.setItem !== 'function') return false;
        storage.setItem(key, JSON.stringify({format: 'qiuqiule-run-ended', version: RUN_SAVE_VERSION}));
        return true;
      } catch { return false; }
    },
  };
}
