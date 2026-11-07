import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initWardrobe,wardrobeAppearanceCards,wardrobeCompanionCards} from '../dist/wardrobe.js';
import {normalizeCompanionState,selectCompanion} from '../dist/companions.js';

function wardrobe(t,initial,saveImage){
  const previous=Object.fromEntries(['document','window'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  t.after(()=>{for(const [key,descriptor] of Object.entries(previous)){
    if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }});
  const nodes=new Map(),lookups=[],removed=new Set(['shape-select','shape-gallery','shape-grid','appearance-tools','appearance-clear']);let created=0;
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
      fire(type,fields={}){return Promise.all((listeners.get(type)||[]).map(handler=>handler({detail:0,preventDefault(){},...fields})));},
    };
    nodes.set(id,result);return result;
  };
  Object.defineProperty(globalThis,'document',{configurable:true,value:{body:node('body'),getElementById:id=>{lookups.push(id);return removed.has(id)?null:node(id);},createElement:tag=>node(`created-${tag}-${++created}`),addEventListener(){},hidden:false}});
  Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener(){}}});
  node('appearance-cropper').hidden=true;
  let state=initial;const errors=[],images=[],appearances=[];
  const ui=initWardrobe({getState:()=>state,
    onAppearance:id=>{appearances.push(id);state={...state,appearanceId:id};},
    onCompanion:id=>{const next=selectCompanion(normalizeCompanionState({unlocked:state.companionUnlocked,selected:state.companionId},{highestStage:state.highestStage}),id);state={...state,companionId:next.selected,companionUnlocked:next.unlocked};},
    onImage:async image=>{images.push(image);await saveImage?.(image);state={...state,image,appearanceId:'custom'};},onError:error=>errors.push(error)});
  const open=kind=>{node(`${kind}-select`).fire('click');ui.update(.24);};
  return {node,ui,open,state:()=>state,setState:value=>{state=value;ui.refresh();},errors,images,appearances,lookups};
}

test('wardrobe initializes without querying removed shape or image-removal controls',t=>{
  const view=wardrobe(t,{appearanceId:'custom',image:'data:image/png;base64,b2xk'});
  view.ui.refresh();view.ui.resetNavigation();
  assert.equal(view.node('appearance-grid').children.length,3);
  assert.equal(view.node('companion-grid').children.length,9);
  assert.ok(!view.lookups.some(id=>['shape-select','shape-gallery','shape-grid','appearance-tools','appearance-clear'].includes(id)));
  assert.equal(view.node('wardrobe-panel').getAttribute('data-wardrobe-view'),'main');
});



test('gallery fades only content and keeps the same header and preview nodes mounted',t=>{
  const view=wardrobe(t,{}),preview=view.node('wardrobe-ball'),header=view.node('wardrobe-title');
  view.node('appearance-select').fire('click');
  assert.equal(view.node('wardrobe-content').inert,true);
  view.ui.update(.06);assert.equal(view.node('wardrobe-content').style.opacity,'0.5');
  assert.equal(view.node('wardrobe-main').hidden,false);assert.equal(view.node('appearance-gallery').hidden,true);
  view.ui.update(.06);assert.equal(view.node('wardrobe-main').hidden,true);assert.equal(view.node('appearance-gallery').hidden,false);
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

test('rapid navigation or selection during a fade cannot change the appearance or lose the return route',t=>{
  const view=wardrobe(t,{appearanceId:'original',appearanceUnlocked:true});
  view.node('appearance-select').fire('click');view.node('companion-select').fire('click');
  view.node('appearance-option-big-eye').fire('click');assert.equal(view.state().appearanceId,'original');assert.equal(view.ui.back(),true);
  view.ui.update(.24);assert.equal(view.node('wardrobe-panel').getAttribute('data-wardrobe-view'),'appearance');
  view.node('appearance-option-big-eye').fire('click');assert.equal(view.state().appearanceId,'big-eye');
  view.ui.back();view.ui.update(.04);view.ui.resetNavigation();view.ui.update(1);
  assert.equal(view.node('wardrobe-panel').getAttribute('data-wardrobe-view'),'main');
  assert.equal(view.node('wardrobe-content').inert,false);assert.equal(view.node('wardrobe-content').style.opacity,'1');
});

test('appearance gallery has exactly three choices and enforces the 233333 score lock',t=>{
  const initial={appearanceId:'original',best:233332};
  const view=wardrobe(t,initial);view.open('appearance');
  assert.equal(view.node('appearance-grid').children.length,3);
  const big=view.node('appearance-option-big-eye');
  assert.equal(big.getAttribute('aria-disabled'),'true');assert.match(big.getAttribute('aria-label'),/233333/);
  big.fire('click');assert.equal(view.state().appearanceId,'original');assert.equal(view.errors.at(-1),'达233333分解锁');
  view.setState({...initial,best:233333});big.fire('click');assert.equal(view.state().appearanceId,'big-eye');
  assert.equal(big.getAttribute('aria-pressed'),'true');assert.equal(big.querySelector('.wardrobe-card-lock').hidden,true);
  view.node('appearance-option-original').fire('click');assert.equal(view.state().appearanceId,'original');
  assert.equal(big.getAttribute('aria-pressed'),'false');
});

test('equipped custom opens its picker again and cancelling preserves the image and selection',async t=>{
  const image='data:image/png;base64,b2xk';
  const view=wardrobe(t,{image,appearanceId:'custom'});view.open('appearance');
  const file=view.node('appearance-file');file.value='previous';
  assert.equal(view.node('appearance-option-custom').getAttribute('aria-pressed'),'true');
  await view.node('appearance-option-custom').fire('click');assert.equal(file.clickCount,1);assert.equal(file.value,'');
  file.files=[];await file.fire('change');
  assert.equal(view.state().image,image);assert.equal(view.state().appearanceId,'custom');
  assert.deepEqual(view.images,[]);assert.deepEqual(view.appearances,[]);assert.equal(view.ui.isCropping(),false);
});

test('switching to original or Big Eye keeps a saved image reusable without a new picker',t=>{
  const image='data:image/png;base64,b2xk';
  const view=wardrobe(t,{image,appearanceId:'custom',appearanceUnlocked:true});view.open('appearance');
  for(const id of ['original','big-eye','original']){
    view.node(`appearance-option-${id}`).fire('click');
    assert.equal(view.state().appearanceId,id);assert.equal(view.state().image,image);
    view.node('appearance-option-custom').fire('click');
    assert.equal(view.state().appearanceId,'custom');assert.equal(view.state().image,image);
    assert.equal(view.node('appearance-file').clickCount||0,0);
  }
  assert.deepEqual(view.images,[]);
  assert.deepEqual(view.appearances,['original','custom','big-eye','custom','original','custom']);
});

test('custom without a saved image opens the picker without changing the previous appearance',async t=>{
  const view=wardrobe(t,{image:null,appearanceId:'big-eye',appearanceUnlocked:true});view.open('appearance');
  await view.node('appearance-option-custom').fire('click');assert.equal(view.node('appearance-file').clickCount,1);
  view.node('appearance-file').files=[];await view.node('appearance-file').fire('change');
  assert.equal(view.state().appearanceId,'big-eye');assert.equal(view.state().image,null);
  assert.deepEqual(view.images,[]);assert.deepEqual(view.appearances,[]);
});

test('image storage loading waits before a picker but never blocks other appearances or a known saved image',t=>{
  const view=wardrobe(t,{image:null,imageLoading:true,appearanceId:'custom',appearanceUnlocked:true});view.open('appearance');
  const custom=view.node('appearance-option-custom'),file=view.node('appearance-file');
  assert.equal(custom.getAttribute('aria-busy'),'true');assert.equal(custom.getAttribute('aria-disabled'),'true');
  assert.match(custom.getAttribute('aria-label'),/图片读取中/);
  custom.fire('click');assert.equal(file.clickCount||0,0);assert.deepEqual(view.appearances,[]);
  for(const id of ['original','big-eye']){
    const button=view.node(`appearance-option-${id}`);
    assert.equal(button.getAttribute('aria-disabled'),'false');button.fire('click');
    assert.equal(view.state().appearanceId,id);
  }
  view.setState({...view.state(),image:'data:image/png;base64,b2xk'});
  assert.equal(custom.getAttribute('aria-busy'),'false');assert.equal(custom.getAttribute('aria-disabled'),'false');
  custom.fire('click');assert.equal(view.state().appearanceId,'custom');assert.equal(file.clickCount||0,0);
  custom.fire('click');assert.equal(file.clickCount,1,'a known equipped image can be replaced even while its initial decode is finishing');
  view.setState({...view.state(),image:null,imageLoading:false,appearanceId:'original'});
  custom.fire('click');assert.equal(file.clickCount,2,'confirmed absence opens the picker normally');
  assert.equal(view.state().appearanceId,'original');assert.deepEqual(view.images,[]);
});

test('temporary crop surface preserves the 768px edit through a failed save and releases on cancel or success',async t=>{
  let resolveSave,rejectSave,finishDecode;
  const saved={image:'data:image/png;base64,b2xk',appearanceId:'custom'};
  const view=wardrobe(t,saved,()=>new Promise((resolve,reject)=>{resolveSave=resolve;rejectSave=reject;}));
  const originalImage=Object.getOwnPropertyDescriptor(globalThis,'Image');
  Object.defineProperty(globalThis,'Image',{configurable:true,value:class{
    naturalWidth=1200;naturalHeight=800;
    decode(){return new Promise(resolve=>{finishDecode=resolve;});}
  }});
  t.after(()=>{if(originalImage)Object.defineProperty(globalThis,'Image',originalImage);else delete globalThis.Image;});
  const revocations=t.mock.method(URL,'revokeObjectURL');
  const file=view.node('appearance-file'),canvas=view.node('crop-canvas'),apply=view.node('crop-apply');
  const cancel=view.node('crop-cancel'),custom=view.node('appearance-option-custom'),draws=[];
  const markup=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  assert.match(markup,/<canvas id="crop-canvas" width="1" height="1"/);
  canvas.width=canvas.height=1;custom.isConnected=true;
  const size=()=>[canvas.width,canvas.height];
  const context={clearRect(...args){assert.deepEqual(args,[0,0,768,768]);},drawImage(image,...args){
    assert.deepEqual(size(),[768,768]);assert.equal(this.imageSmoothingQuality,'high');draws.push(args);
  }};
  canvas.getContext=()=>context;
  canvas.toDataURL=mime=>{assert.equal(mime,'image/png');assert.deepEqual(size(),[768,768]);return 'data:image/png;base64,test';};
  view.open('appearance');
  const select=()=>{custom.click();file.files=[new Blob(['fixture'])];return file.fire('change');};

  const abandoned=select();view.ui.cancelInteraction();finishDecode();await abandoned;
  assert.deepEqual(size(),[1,1]);assert.equal(view.ui.isCropping(),false);assert.equal(draws.length,0);
  assert.deepEqual(view.state(),saved);assert.deepEqual(view.images,[]);
  const open=async()=>{const decoding=select();assert.deepEqual(size(),[1,1]);finishDecode();await decoding;
    assert.equal(view.ui.isCropping(),true);assert.deepEqual(draws.at(-1),[200,0,800,800,0,0,768,768]);};
  await open();await cancel.fire('click');assert.deepEqual(size(),[1,1]);assert.equal(document.activeElement,custom);
  assert.deepEqual(view.state(),saved);assert.deepEqual(view.images,[]);
  const original={image:null,appearanceId:'original'};view.setState(original);
  await open();await cancel.fire('click');assert.deepEqual(view.state(),original);assert.deepEqual(view.images,[]);
  view.setState(saved);
  await open();const zoom=view.node('crop-zoom');zoom.value='2';await zoom.fire('input');
  assert.deepEqual(draws.at(-1),[400,200,400,400,0,0,768,768]);

  const failed=apply.fire('click');assert.equal(cancel.disabled,true);view.ui.cancelInteraction();
  assert.deepEqual(size(),[768,768]);rejectSave(new Error('storage full'));await failed;
  assert.equal(view.ui.isCropping(),true);assert.equal(apply.disabled,false);assert.equal(cancel.disabled,false);
  assert.equal(view.errors.at(-1),'storage full');assert.deepEqual(size(),[768,768]);assert.equal(zoom.value,'2');
  assert.deepEqual(view.state(),saved);
  const retry=apply.fire('click');resolveSave();await retry;
  assert.deepEqual(view.images,['data:image/png;base64,test','data:image/png;base64,test']);
  assert.equal(view.state().image,'data:image/png;base64,test');assert.equal(view.state().appearanceId,'custom');
  assert.deepEqual(size(),[1,1]);assert.equal(view.ui.isCropping(),false);assert.equal(document.activeElement,custom);
  await open();view.ui.cancelInteraction();assert.deepEqual(size(),[1,1]);assert.equal(revocations.mock.callCount(),5);
});

test('appearance card models preserve earned ownership independently of the current score',()=>{
  const cards=wardrobeAppearanceCards({appearanceId:'big-eye',appearanceUnlocked:true,best:0});
  assert.equal(cards.find(card=>card.id==='big-eye').unlocked,true);
  assert.equal(cards.find(card=>card.id==='big-eye').selected,true);
});

test('preview separator fades with every subpage and back while preserving the ball layout',t=>{
  const view=wardrobe(t,{}),line=view.node('wardrobe-preview-line'),ball=view.node('wardrobe-ball');
  assert.equal(line.style.opacity,'0');
  for(const page of ['appearance','companion']){
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


test('companion gallery exposes stage milestones, protects locked choices and supports click-to-remove',t=>{
  const initial={highestStage:9,best:999999,companionId:null,companionUnlocked:0,playerColor:'#526a9b'};
  const view=wardrobe(t,initial);view.open('companion');
  assert.equal(view.node('companion-grid').children.length,9);
  assert.equal(view.node('wardrobe-panel').getAttribute('data-wardrobe-view'),'companion');
  const sun=view.node('companion-option-sun-1'),moon=view.node('companion-option-moon-1');
  assert.equal(sun.getAttribute('aria-disabled'),'false');assert.equal(moon.getAttribute('aria-disabled'),'true');
  assert.match(moon.innerHTML,/到达第 10 阶段/);assert.match(moon.getAttribute('aria-label'),/到达第 10 阶段解锁/);
  assert.equal(sun.querySelector('.wardrobe-card-lock').hidden,true);assert.equal(moon.querySelector('.wardrobe-card-lock').hidden,false);
  moon.fire('click');assert.equal(view.state().companionId,null);assert.equal(view.errors.at(-1),'到达第 10 阶段解锁');
  sun.fire('click');assert.equal(view.state().companionId,'sun-1');assert.equal(sun.getAttribute('aria-pressed'),'true');
  sun.fire('click');assert.equal(view.state().companionId,null);assert.equal(sun.getAttribute('aria-pressed'),'false');
  view.setState({...view.state(),highestStage:10});moon.fire('click');
  assert.equal(view.state().companionId,'moon-1');assert.equal(moon.getAttribute('aria-pressed'),'true');
  assert.equal(sun.getAttribute('aria-pressed'),'false');assert.equal(moon.querySelector('.wardrobe-card-lock').hidden,true);
});

test('companion navigation preserves preview motion nodes and selection waits until the content transition completes',t=>{
  const view=wardrobe(t,{companionId:null,companionUnlocked:9,best:0});
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
  const view=wardrobe(t,{companionId:'sun-1',companionUnlocked:1,playerColor:'#526a9b'});
  const button=view.node('companion-option-sun-1'),preview=button.querySelector('.companion-preview'),first=preview.innerHTML;
  assert.match(first,/<svg/);assert.match(first,/<path/);
  view.setState({...view.state(),playerColor:'#b8db8a'});
  assert.notEqual(preview.innerHTML,first);assert.equal(view.node('companion-option-sun-1'),button);
  assert.equal(button.getAttribute('aria-pressed'),'true');
});

test('companion cards follow stage milestones and preserve previously earned ownership',()=>{
  const cards=wardrobeCompanionCards({best:0,companionUnlocked:9,companionId:'star-3'});
  assert.deepEqual(cards.map(card=>card.label),['日·一','月·一','星·一','日·二','月·二','星·二','日·三','月·三','星·三']);
  assert.deepEqual(cards.map(card=>card.stage),[5,10,15,20,25,30,35,40,45]);
  assert.ok(cards.every(card=>card.unlocked&&card.score===undefined));assert.equal(cards.filter(card=>card.selected).length,1);
  assert.equal(cards.at(-1).selected,true);
  assert.equal(wardrobeCompanionCards({highestStage:4,best:999999}).some(card=>card.unlocked),false);
});


test('companion preview disables inherited icon strokes without changing white lock outlines',()=>{
  const css=readFileSync(new URL('../dist/style.css',import.meta.url),'utf8');
  const preview=css.match(/\.wardrobe-card \.companion-preview>svg\{([^}]+)\}/)?.[1];
  const lock=css.match(/\.wardrobe-card-lock svg\{([^}]+)\}/)?.[1];
  assert.match(preview,/(?:^|;)stroke:none(?:;|$)/);
  assert.match(lock,/(?:^|;)stroke:#fff(?:;|$)/);
});
