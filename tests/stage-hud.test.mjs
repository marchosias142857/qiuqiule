import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {StageHud} from '../dist/stage-hud.js';

const near = (a, b, tolerance = .0001) => assert.ok(Math.abs(Number(a) - b) < tolerance, `${a} != ${b}`);
function node() {
  return {hidden: true, textContent: '', style: {}, children: [], attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    getAttribute(key) { return this.attributes[key] ?? null; },
    removeAttribute(key) { delete this.attributes[key]; },
    replaceChildren(...children) { this.children = children; }};
}
function setup() {
  const hud = new StageHud(), progress = node(), caption = node(), owner = {};
  const update = (values = {}) => hud.update(progress, caption, {owner, mode: 'endless', visible: true, stage: 12, ...values});
  return {hud, progress, caption, owner, update};
}

test('endless dots and stage text fade in together over 180 ms and hide only after the 160 ms exit', () => {
  const {update, progress, caption} = setup();
  update(); assert.equal(progress.hidden, false); assert.equal(caption.hidden, false); near(progress.style.opacity, 0);
  assert.equal(caption.textContent, '阶段 12');
  update({dt: .09}); near(progress.style.opacity, .5); near(caption.style.opacity, .225);
  update({dt: .09}); near(progress.style.opacity, 1); near(caption.style.opacity, .45);
  update({visible: false}); assert.equal(progress.hidden, false); assert.equal(caption.hidden, false);
  update({visible: false, dt: .08}); near(progress.style.opacity, .5); near(caption.style.opacity, .225);
  assert.equal(progress.hidden, false); update({visible: false, dt: .08});
  near(progress.style.opacity, 0); assert.equal(progress.hidden, true); assert.equal(caption.hidden, true);
});

test('rapid phase changes reverse the current fade without an opacity jump or restarting on repeated frames', () => {
  const {update, progress, caption} = setup();
  update({dt: .09}); near(progress.style.opacity, .5);
  update({visible: false}); near(progress.style.opacity, .5);
  update({visible: false, dt: .04}); near(progress.style.opacity, .25);
  update({stage: 13}); near(progress.style.opacity, .25); assert.equal(caption.textContent, '阶段 13');
  for (let i = 0; i < 9; i++) update({stage: 13, dt: .015});
  near(progress.style.opacity, 1); near(caption.style.opacity, .45);
});

test('stable visible and hidden frames perform no repeated DOM writes', () => {
  const {update, progress, caption} = setup(), writes = [];
  update({dt: .18});
  for (const element of [progress, caption, progress.style, caption.style]) {
    for (const key of Object.keys(element).filter(key => ['hidden', 'textContent', 'opacity'].includes(key))) {
      let value = element[key];
      Object.defineProperty(element, key, {get: () => value, set(next) { value = next; writes.push(key); }});
    }
  }
  for (let i = 0; i < 120; i++) update({dt: 1 / 60}); assert.deepEqual(writes, []);
  update({visible: false, dt: .16}); writes.length = 0;
  for (let i = 0; i < 120; i++) update({visible: false, dt: 1 / 60}); assert.deepEqual(writes, []);
});

test('home resets and new worlds never retain an endless caption or fade state', () => {
  const {hud, update, progress, caption} = setup(); update({dt: .18});
  hud.reset(progress, caption); assert.equal(progress.hidden, true); assert.equal(caption.hidden, true); assert.equal(caption.textContent, '');
  update({owner: {}, stage: 1}); near(progress.style.opacity, 0); assert.equal(caption.textContent, '阶段 1');
  update({mode: 'off'}); assert.equal(progress.hidden, true); assert.equal(caption.hidden, true);
});

const source = await readFile(new URL('../dist/game.js', import.meta.url), 'utf8');
function realHud() {
  const nodes = Object.fromEntries(['#score', '#hud', '#stage-progress', '#stage-caption'].map(id => [id, node()]));
  const functions = source.slice(source.indexOf('function setHudText('), source.indexOf('\nfunction polygon('));
  const build = new Function('StageHud', 'nodes', `
    const $=id=>nodes[id],document={createElement:()=>({className:'',setAttribute(){}})};
    let world=null,scene=null,feedbackDemo=true,runNewRecord=false,runBest=0,recordCue=0,recordPulse=0,reducedMotion=true,lastScore=-1;
    const settings={juice:0},pad=value=>String(Math.floor(value)).padStart(4,'0'),clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),smooth=n=>n;
    const grantEndlessAppearance=()=>{},grantEndlessCompanions=()=>{},tone=()=>{},saveEndlessProgress=()=>{},updateChoices=()=>{};
    const scoreFeedback={set(){},step(){return {value:world.score,scale:1}}};
    ${functions}
    return {update:updateHud,reset:resetStageHud,setWorld(value){world=value;},setScene(value){scene=value;}};
  `);
  const app = build(StageHud, nodes), world = {mode: 'endless', phase: 'battle', score: 0, stage: 7, stageKills: 3, killTarget: 14};
  app.setWorld(world); return {app, nodes, world};
}

test('real updateHud keeps ten dots and caption aligned across battle, clearing, Boss, reward and ending', () => {
  const {app, nodes, world} = realHud(), progress = nodes['#stage-progress'], caption = nodes['#stage-caption'];
  app.update(.18); assert.equal(progress.children.length, 10); assert.equal(caption.textContent, '阶段 7');
  near(progress.style.opacity, 1); world.phase = 'clearing'; app.update(.02); near(progress.style.opacity, 1);
  for (const phase of ['boss-entry', 'boss', 'boss-celebrate', 'transition', 'choose', 'reward']) {
    world.phase = phase; app.update(.16); assert.equal(progress.hidden, true); assert.equal(caption.hidden, true);
  }
  world.phase = 'battle'; world.stage = 8; app.update(.18); assert.equal(caption.textContent, '阶段 8');
  app.setScene({ending: {elapsed: 0}}); app.update(.08); near(progress.style.opacity, .5); assert.equal(caption.hidden, false);
  app.update(.08); assert.equal(progress.hidden, true); assert.equal(caption.hidden, true);
});

test('paused score time does not freeze an unfinished stage fade or hide its caption', () => {
  const {app, nodes} = realHud(), progress = nodes['#stage-progress'], caption = nodes['#stage-caption'];
  app.update(.04); const initial = Number(progress.style.opacity); app.update(0, .07);
  assert.ok(Number(progress.style.opacity) > initial); app.update(0, .07); near(progress.style.opacity, 1);
  assert.equal(progress.hidden, false); assert.equal(caption.hidden, false); near(caption.style.opacity, .45);
  assert.match(source, /updateHud\(paused\?0:dt,dt\)/);
});

test('leaving a real endless world clears its stage caption and fades immediately', () => {
  const {app, nodes} = realHud(), progress = nodes['#stage-progress'], caption = nodes['#stage-caption']; app.update(.18);
  app.setWorld(null); app.update(); assert.equal(caption.textContent, '');
  assert.equal(progress.hidden,true);assert.equal(caption.hidden,true);
});

test('caption stays a compact sibling below the dots and resets on return home', async () => {
  const [html, css] = await Promise.all(['../dist/index.html', '../dist/style.css'].map(file => readFile(new URL(file, import.meta.url), 'utf8')));
  assert.match(html, /<div id="stage-progress"[^>]*><\/div>\s*<span id="stage-caption" hidden><\/span>/);
  assert.match(css, /#stage-caption\{[^}]*margin-top:6px;[^}]*font-size:10px;[^}]*letter-spacing:\.08em;[^}]*opacity:\.45/);
  assert.match(css, /#stage-progress\[hidden\],#stage-caption\[hidden\]\{display:none\}/);
  for (const name of ['showHome']) {
    const body = source.slice(source.indexOf('function ' + name + '('), source.indexOf('\nfunction ', source.indexOf('function ' + name + '(') + 1));
    assert.match(body, /resetStageHud\(\)/);
  }
});
