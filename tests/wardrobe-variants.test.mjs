import test from 'node:test';
import assert from 'node:assert/strict';
import {initWardrobe,wardrobeShapeCards,wardrobeAppearanceCards} from '../dist/wardrobe.js';
import {normalizeSkins,selectSkin,toggleSkins,unlockSkin} from '../dist/skins.js';

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
    onAppearance:id=>{state={...state,appearanceId:id};},onImage:image=>images.push(image),onError:error=>errors.push(error)});
  const open=kind=>{node(kind==='shape'?'shape-select':'appearance-select').fire('click');ui.update(.24);};
  return {node,ui,open,state:()=>state,setState:value=>{state=value;ui.refresh();},errors,images};
}

test('retired endless-only unlock fields never grant a campaign polygon or open its selector',t=>{
  const view=wardrobe(t,normalizeSkins({enabled:true,sides:9,unlocked:0,variants:[6,7,8,9],variant:true}));
  assert.equal(view.node('skin-lock').hidden,false);assert.equal(view.node('skin-toggle').hidden,true);
  assert.equal(view.node('skin-infinity').hidden,false);assert.equal(view.node('shape-select').hidden,true);
  view.node('shape-select').fire('click');view.ui.update(1);
  assert.equal(view.node('wardrobe-panel').getAttribute('data-wardrobe-view'),'main');
  view.node('skin-toggle').fire('click');assert.equal(view.state().enabled,false);
  assert.equal(view.state().variant,undefined);assert.equal(view.state().variants,undefined);
});

test('shape gallery shows every milestone but selects only genuinely owned polygons across skipped gaps',t=>{
  let state=normalizeSkins({enabled:true,sides:6},10);
  state=unlockSkin(state,30).state;state=unlockSkin(state,50).state;
  const view=wardrobe(t,state);view.open('shape');
  assert.equal(view.node('shape-grid').children.length,10);
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
  const shapes=wardrobeShapeCards(normalizeSkins(null));assert.deepEqual(shapes.map(x=>x.level),[10,20,30,40,50,60,70,80,90,100]);
  assert.ok(shapes.every(x=>!x.unlocked&&!x.selected));
  const cards=wardrobeAppearanceCards({appearanceId:'big-eye',appearanceUnlocked:true,best:0});
  assert.equal(cards.find(x=>x.id==='big-eye').unlocked,true);assert.equal(cards.find(x=>x.id==='big-eye').selected,true);
});
