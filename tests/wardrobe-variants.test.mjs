import test from 'node:test';
import assert from 'node:assert/strict';
import {initWardrobe} from '../dist/wardrobe.js';
import {normalizeSkins, selectSkin, toggleSkins, unlockSkin} from '../dist/skins.js';

function wardrobe(t, initial) {
  const previous = Object.fromEntries(['document', 'window'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of Object.entries(previous)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }});
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) {
      const listeners = new Map(), attributes = new Map();
      nodes.set(id, {id, hidden: false, disabled: false, textContent: '', style: {},
        addEventListener(type, handler) { const entries = listeners.get(type) || []; entries.push(handler); listeners.set(type, entries); },
        setAttribute(name, value) { attributes.set(name, value); }, getAttribute(name) { return attributes.get(name); },
        fire(type, fields = {}) { for (const handler of listeners.get(type) || []) handler({detail: 0, preventDefault() {}, ...fields}); },
      });
    }
    return nodes.get(id);
  };
  Object.defineProperty(globalThis, 'document', {configurable: true, value: {
    getElementById: node, addEventListener() {}, hidden: false,
  }});
  Object.defineProperty(globalThis, 'window', {configurable: true, value: {addEventListener() {}}});
  let state = initial;
  const ui = initWardrobe({getState: () => state,
    onToggle: enabled => { state = toggleSkins(state, enabled); },
    onSides: selection => { state = selectSkin(state, selection); },
    onImage() {},
  });
  return {node, ui, state: () => state};
}

test('retired endless-only unlocks no longer expose an equip option', t => {
  const initial = normalizeSkins({enabled: true, sides: 9, unlocked: 0, variants: [6, 7, 8, 9], variant: true});
  const view = wardrobe(t, initial);
  assert.equal(view.node('skin-lock').hidden, false);
  assert.equal(view.node('skin-toggle').hidden, true);
  assert.equal(view.node('skin-infinity').hidden, false);
  assert.equal(view.node('skin-stepper').hidden, true);
  view.node('skin-toggle').fire('click');
  assert.equal(view.state().enabled, false); assert.equal(view.state().unlocked, 0);
  assert.equal(view.node('skin-minus').disabled, true); assert.equal(view.node('skin-plus').disabled, true);
  assert.equal(view.state().variant, undefined); assert.equal(view.state().variants, undefined);
});

test('wardrobe arrows skip retired variants and visit each owned campaign shape once', t => {
  const initial = normalizeSkins({enabled: true, sides: 6, unlocked: 8, variants: [6, 7, 8, 9], variant: true});
  const view = wardrobe(t, initial);
  const shown = [view.node('skin-sides').textContent];
  for (let i = 0; i < 3; i++) {
    view.node('skin-plus').fire('click'); shown.push(view.node('skin-sides').textContent);
  }
  assert.deepEqual(shown, ['6', '7', '8', '8']);
  assert.equal(view.node('skin-plus').disabled, true);
  assert.equal(view.node('skin-sides').getAttribute('aria-label'), '8边形，基础外形');
  view.node('skin-minus').fire('click');
  assert.equal(view.state().sides, 7); assert.equal(view.state().variant, undefined);
  assert.equal(view.node('skin-sides').textContent, '7');
});

test('existing campaign-only wardrobe still steps to the next actual polygon', t => {
  const view = wardrobe(t, normalizeSkins({enabled: true, sides: 6}, 30));
  view.node('skin-plus').fire('click');
  assert.equal(view.state().sides, 7); assert.equal(view.state().variants, undefined);
  view.node('skin-plus').fire('click');
  assert.equal(view.state().sides, 8); assert.equal(view.node('skin-plus').disabled, true);
  view.node('skin-minus').fire('click');
  assert.equal(view.state().sides, 7);
});

test('wardrobe arrows visit only genuinely owned milestone skins across skipped gaps', t => {
  let state = normalizeSkins({enabled: true, sides: 6}, 10);
  state = unlockSkin(state, 30).state;
  state = unlockSkin(state, 50).state;
  const view = wardrobe(t, state), shown = [view.node('skin-sides').textContent];
  for (let i = 0; i < 3; i++) {view.node('skin-plus').fire('click');shown.push(view.node('skin-sides').textContent);}
  assert.deepEqual(shown, ['6', '8', '10', '10']);
  assert.equal(view.node('skin-plus').disabled, true);
  view.node('skin-minus').fire('click');assert.equal(view.state().sides, 8);
  view.node('skin-minus').fire('click');assert.equal(view.state().sides, 6);
  assert.equal(view.node('skin-minus').disabled, true);
  assert.deepEqual(view.state().owned, [6, 8, 10]);
});
