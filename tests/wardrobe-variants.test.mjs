import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initWardrobe,wardrobeShapeCards,wardrobeAppearanceCards,wardrobeCompanionCards} from '../dist/wardrobe.js';
import {normalizeSkins,selectSkin,toggleSkins,unlockSkin} from '../dist/skins.js';
import {normalizeCompanionState,selectCompanion} from '../dist/companions.js';

function wardrobe(t,initial){
  const previous=Object.fromEntries(['document','window'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  t.after(()=>{for(const [key,descriptor] of Object.entries(previous)){
    if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }});
  const nodes=new Map();let created=0;
  const node=id=>{
    if(nodes.has(id))return nodes.get(id);
    const listeners=new Map(),attributes=new Map(),classes=new Set();let identity=id;
    const result={hidden:false,disabled:false,inert:false,textContent:'',innerHTML:'',style:{},children:[],scrollTop:0,
      classList:{add(...values){values.forEach(value=>classes.add(value));},remove(...values){values.forEach(value=>classes.delete(value));},contains:value=>classes.has(value)},
      get id(){return identity;},set id(value){identity=value;nodes.set(value,result);},
      addEventListener(type,handler){const entries=listeners.get(type)||[];entries.push(handler);listeners.set(type,entries);},
      setAttribute(name,value){attributes.set(name,value);},getAttribute:name=>attributes.get(name),
      querySelector:selector=>node(identity+' '+selector),append(...children){this.children.push(...children);},
      focus(){document.activeElement=result;},click(){this.clickCount=(this.clickCount||0)+1;this.fire('click');},
      fire(type,fields={}){for(const handler of listeners.get(type)||[])handler({detail:0,preventDefault(){},...fields});},
    };
    nodes.set(id,result);return result;
  };
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:node,createElement:tag=>node(`created-${tag}-${++created}`),addEventListener(){},hidden:false}});
  Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener(){}}});
  node('appearance-cropper').hidden=true;
  let state=initial;const errors=[],images=[];
  const ui=initWardrobe({getState:()=>state,
    onToggle:enabled=>{state={...state,...toggleSkins(state,enabled)};},
    onSides:selection=>{state={...state,...toggleSkins(selectSkin(state,selection),true)};},
    onAppearance:id=>{state={...state,appearanceId:id};},
    onCompanion:id=>{const next=selectCompanion(normalizeCompanionState({unlocked:state.companionUnlocked,selected:state.companionId},{best:state.best}),id);state={...state,companionId:next.selected,companionUnlocked:next.unlocked};},
    onImage:image=>images.push(image),onError:error=>errors.push(error)});
  const open=kind=>{node(`${kind}-select`).fire('click');ui.update(.24);};
  return {node,ui,open,state:()=>state,setState:value=>{state=value;ui.refresh();},errors,images};
}

test('retired endless-only unlock fields leave polygons locked while the circle selector remains available',t=>{
  const view=wardrobe(t,normalizeSkins({enabled:true,sides:9,unlocked:0,variants:[6,7,8,9],variant:true}));
  assert.equal(view.node('shape-select').hidden,false);
  view.node('shape-select').fire('click');view.ui.update(1);
  assert.equal(view.node('wardrobe-panel').getAttribute('data-wardrobe-view'),'shape');
  const circle=view.node('shape-option-0');
  assert.equal(circle.getAttribute('aria-disabled'),'false');assert.equal(circle.getAttribute('aria-pressed'),'true');
  circle.fire('click');assert.equal(view.state().enabled,false);
  for(let sides=6;sides<=15;sides++)assert.equal(view.node(`shape-option-${sides}`).getAttribute('aria-disabled'),'true');
  assert.equal(view.state().variant,undefined);assert.equal(view.state().variants,undefined);
});

test('shape gallery shows every milestone but selects only genuinely owned polygons across skipped gaps',t=>{
  let state=normalizeSkins({enabled:true,sides:6},10);
  state=unlockSkin(state,30).state;state=unlockSkin(state,50).state;
  const view=wardrobe(t,state);view.open('shape');
  assert.equal(view.node('shape-grid').children.length,11);
  for(let sides=6;sides<=15;sides++){
    const button=view.node(`shape-option-${sides}`),owned=[6,8,10].includes(sides);
    assert.equal(button.getAttribute('aria-disabled'),String(!owned));
    assert.equal(button.querySelector('.wardrobe-card-lock').hidden,owned);
    button.fire('click');assert.equal(view.state().sides,owned?sides:([6,8,10].filter(x=>x<sides).at(-1)||6));
  }
  assert.deepEqual(view.state().owned,[6,8,10]);assert.equal(view.errors.length,7);
  assert.equal(view.node('shape-option-10').getAttribute('aria-pressed'),'true');
  assert.equal(view.node('shape-option-8').getAttribute('aria-pressed'),'false');
});

test('gallery fades only content and keeps the same header and preview nodes mounted',t=>{
  const view=wardrobe(t,normalizeSkins({enabled:true,sides:6},30)),preview=view.node('wardrobe-ball'),header=view.node('wardrobe-title');
  view.node('shape-select').fire('click');
  assert.equal(view.node('wardrobe-content').inert,true);
  view.ui.update(.06);assert.equal(view.node('wardrobe-content').style.opacity,'0.5');
  assert.equal(view.node('wardrobe-main').hidden,false);assert.equal(view.node('shape-gallery').hidden,true);
  view.ui.update(.06);assert.equal(view.node('wardrobe-main').hidden,true);assert.equal(view.node('shape-gallery').hidden,false);
  assert.equal(view.node('wardrobe-content').style.opacity,'0');
  view.ui.update(.12);assert.equal(view.node('wardrobe-content').style.opacity,'1');
  assert.equal(view.node('wardrobe-content').inert,false);assert.equal(view.node('wardrobe-back').getAttribute('aria-label'),'返回换装');
  assert.match(view.node('wardrobe-back').innerHTML,/return-icon/);
  assert.equal(view.node('wardrobe-ball'),preview);assert.equal(view.node('wardrobe-title'),header);
  assert.deepEqual(preview.style,{});assert.deepEqual(header.style,{});
  assert.equal(view.ui.back(),true);view.ui.update(.24);
  assert.equal(view.node('wardrobe-panel').getAttribute('data-wardrobe-view'),'main');
  assert.equal(view.node('wardrobe-back').innerHTML,'×');assert.equal(view.ui.back(),false);
});

test('rapid navigation or selection during a fade cannot change the active skin or lose the return route',t=>{
  const view=wardrobe(t,normalizeSkins({enabled:true,sides:6},30));
  view.node('shape-select').fire('click');view.node('appearance-select').fire('click');
  view.node('shape-option-8').fire('click');assert.equal(view.state().sides,6);assert.equal(view.ui.back(),true);
  view.ui.update(.24);assert.equal(view.node('wardrobe-panel').getAttribute('data-wardrobe-view'),'shape');
  view.node('shape-option-8').fire('click');assert.equal(view.state().sides,8);
  view.ui.back();view.ui.update(.04);view.ui.resetNavigation();view.ui.update(1);
  assert.equal(view.node('wardrobe-panel').getAttribute('data-wardrobe-view'),'main');
  assert.equal(view.node('wardrobe-content').inert,false);assert.equal(view.node('wardrobe-content').style.opacity,'1');
});

test('appearance gallery has exactly three choices and enforces the 26767 score lock',t=>{
  const initial={...normalizeSkins(null),appearanceId:'original',best:26766};
  const view=wardrobe(t,initial);view.open('appearance');
  assert.equal(view.node('appearance-grid').children.length,3);
  const big=view.node('appearance-option-big-eye');
  assert.equal(big.getAttribute('aria-disabled'),'true');assert.match(big.getAttribute('aria-label'),/26767/);
  big.fire('click');assert.equal(view.state().appearanceId,'original');assert.equal(view.errors.at(-1),'达26767分解锁');
  view.setState({...initial,best:26767});big.fire('click');assert.equal(view.state().appearanceId,'big-eye');
  assert.equal(big.getAttribute('aria-pressed'),'true');assert.equal(big.querySelector('.wardrobe-card-lock').hidden,true);
  view.node('appearance-option-original').fire('click');assert.equal(view.state().appearanceId,'original');
  assert.equal(big.getAttribute('aria-pressed'),'false');
});

test('custom appearance opens the existing picker and an equipped saved image is highlighted',t=>{
  const view=wardrobe(t,{...normalizeSkins(null),image:'data:image/png;base64,abc',appearanceId:'custom'});view.open('appearance');
  assert.equal(view.node('appearance-option-custom').getAttribute('aria-pressed'),'true');
  assert.equal(view.node('appearance-clear').hidden,false);assert.equal(view.node('appearance-tools').hidden,false);
  view.node('appearance-option-custom').fire('click');assert.equal(view.node('appearance-file').clickCount,1);
  assert.equal(view.images.length,0,'opening a picker never deletes or replaces the saved image');
});

test('card models keep exact campaign thresholds and persistent appearance ownership',()=>{
  const shapes=wardrobeShapeCards(normalizeSkins(null));assert.deepEqual(shapes.slice(1).map(x=>x.level),[10,20,30,40,50,60,70,80,90,100]);
  assert.deepEqual(shapes[0],{sides:0,label:'圆形',level:null,unlocked:true,selected:true});
  assert.ok(shapes.slice(1).every(x=>!x.unlocked&&!x.selected));
  const cards=wardrobeAppearanceCards({appearanceId:'big-eye',appearanceUnlocked:true,best:0});
  assert.equal(cards.find(x=>x.id==='big-eye').unlocked,true);assert.equal(cards.find(x=>x.id==='big-eye').selected,true);
});

test('circle and polygon cards form one selection and retain the previous polygon when returning to circle',t=>{
  const view=wardrobe(t,normalizeSkins({enabled:true,sides:8},30));view.open('shape');
  const circle=view.node('shape-option-0'),polygon=view.node('shape-option-8');
  assert.match(circle.innerHTML,/>圆形</);assert.match(circle.innerHTML,/class="shape-outline"/);
  assert.equal(circle.querySelector('.wardrobe-card-lock').hidden,true);
  assert.equal(circle.getAttribute('aria-pressed'),'false');assert.equal(polygon.getAttribute('aria-pressed'),'true');
  circle.fire('click');assert.equal(view.state().enabled,false);assert.equal(view.state().sides,8);
  assert.equal(circle.getAttribute('aria-pressed'),'true');assert.equal(polygon.getAttribute('aria-pressed'),'false');
  polygon.fire('click');assert.equal(view.state().enabled,true);assert.equal(view.state().sides,8);
  assert.equal(circle.getAttribute('aria-pressed'),'false');assert.equal(polygon.getAttribute('aria-pressed'),'true');
});

test('preview separator fades with every subpage and back while preserving the ball layout',t=>{
  const view=wardrobe(t,normalizeSkins(null)),line=view.node('wardrobe-preview-line'),ball=view.node('wardrobe-ball');
  assert.equal(line.style.opacity,'0');
  for(const page of ['shape','appearance','companion']){
    view.node(`${page}-select`).fire('click');view.ui.update(.06);
    assert.equal(Number(line.style.opacity),.15625);
    view.ui.update(.06);assert.equal(Number(line.style.opacity),.5);
    view.ui.update(.12);assert.equal(line.style.opacity,'1');
    view.ui.back();view.ui.update(.12);assert.equal(Number(line.style.opacity),.5);
    view.ui.update(.12);assert.equal(line.style.opacity,'0');
    assert.equal(view.node('wardrobe-ball'),ball);assert.deepEqual(ball.style,{});
  }
  view.open('appearance');view.ui.back();view.ui.update(.06);view.ui.resetNavigation();
  assert.equal(line.style.opacity,'0');view.ui.update(1);assert.equal(line.style.opacity,'0');
  const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../dist/style.css',import.meta.url),'utf8');
  assert.doesNotMatch(html,/id="skin-(?:toggle|lock|infinity)"/);
  assert.match(css,/\.wardrobe-preview\{[^}]*border-top:1px solid transparent/);
  assert.match(css,/#wardrobe-preview-line\{[^}]*position:absolute[^}]*opacity:0/);
});


test('companion gallery exposes all nine score milestones, protects locked choices and supports click-to-remove',t=>{
  const initial={...normalizeSkins(null),best:15999,companionId:null,companionUnlocked:0,playerColor:'#526a9b'};
  const view=wardrobe(t,initial);view.open('companion');
  assert.equal(view.node('companion-grid').children.length,9);
  assert.equal(view.node('wardrobe-panel').getAttribute('data-wardrobe-view'),'companion');
  const sun=view.node('companion-option-sun-1'),moon=view.node('companion-option-moon-1');
  assert.equal(sun.getAttribute('aria-disabled'),'false');assert.equal(moon.getAttribute('aria-disabled'),'true');
  assert.equal(sun.querySelector('.wardrobe-card-lock').hidden,true);assert.equal(moon.querySelector('.wardrobe-card-lock').hidden,false);
  moon.fire('click');assert.equal(view.state().companionId,null);assert.equal(view.errors.at(-1),'达16000分解锁');
  sun.fire('click');assert.equal(view.state().companionId,'sun-1');assert.equal(sun.getAttribute('aria-pressed'),'true');
  sun.fire('click');assert.equal(view.state().companionId,null);assert.equal(sun.getAttribute('aria-pressed'),'false');
  view.setState({...view.state(),best:16000});moon.fire('click');
  assert.equal(view.state().companionId,'moon-1');assert.equal(moon.getAttribute('aria-pressed'),'true');
  assert.equal(sun.getAttribute('aria-pressed'),'false');assert.equal(moon.querySelector('.wardrobe-card-lock').hidden,true);
});

test('companion navigation preserves preview motion nodes and selection waits until the content transition completes',t=>{
  const view=wardrobe(t,{...normalizeSkins(null),companionId:null,companionUnlocked:9,best:0});
  const preview=view.node('wardrobe-ball'),orbit=view.node('ui-companions');
  view.node('companion-select').fire('click');view.node('companion-option-star-3').fire('click');
  assert.equal(view.state().companionId,null);view.ui.update(.24);
  assert.equal(view.node('companion-gallery').hidden,false);assert.equal(view.node('appearance-gallery').hidden,true);
  assert.equal(view.node('wardrobe-back').getAttribute('aria-label'),'返回换装');
  view.node('companion-option-star-3').fire('click');assert.equal(view.state().companionId,'star-3');
  assert.equal(view.ui.back(),true);view.ui.update(.24);
  assert.equal(view.node('wardrobe-panel').getAttribute('data-wardrobe-view'),'main');
  assert.equal(view.node('wardrobe-ball'),preview);assert.equal(view.node('ui-companions'),orbit);
  assert.deepEqual(preview.style,{});assert.deepEqual(orbit.style,{});
  assert.equal(view.state().companionId,'star-3');
});

test('companion card preview colors refresh with the player and keep static trails without replacing selection controls',t=>{
  const view=wardrobe(t,{...normalizeSkins(null),companionId:'sun-1',companionUnlocked:1,playerColor:'#526a9b'});
  const button=view.node('companion-option-sun-1'),preview=button.querySelector('.companion-preview'),first=preview.innerHTML;
  assert.match(first,/<svg/);assert.match(first,/<path/);
  view.setState({...view.state(),playerColor:'#b8db8a'});
  assert.notEqual(preview.innerHTML,first);assert.equal(view.node('companion-option-sun-1'),button);
  assert.equal(button.getAttribute('aria-pressed'),'true');
});

test('companion cards follow sun moon star tiers and preserve earned ownership independently of current score',()=>{
  const cards=wardrobeCompanionCards({best:0,companionUnlocked:9,companionId:'star-3'});
  assert.deepEqual(cards.map(card=>card.label),['日·一','月·一','星·一','日·二','月·二','星·二','日·三','月·三','星·三']);
  assert.deepEqual(cards.map(card=>card.score),[8000,16000,24000,32000,40000,48000,56000,64000,72000]);
  assert.ok(cards.every(card=>card.unlocked));assert.equal(cards.filter(card=>card.selected).length,1);
  assert.equal(cards.at(-1).selected,true);
  assert.equal(wardrobeCompanionCards({best:7999}).some(card=>card.unlocked),false);
});


test('companion preview disables inherited icon strokes without changing white lock outlines',()=>{
  const css=readFileSync(new URL('../dist/style.css',import.meta.url),'utf8');
  const preview=css.match(/\.wardrobe-card \.companion-preview>svg\{([^}]+)\}/)?.[1];
  const lock=css.match(/\.wardrobe-card-lock svg\{([^}]+)\}/)?.[1];
  assert.match(preview,/(?:^|;)stroke:none(?:;|$)/);
  assert.match(lock,/(?:^|;)stroke:#fff(?:;|$)/);
});
