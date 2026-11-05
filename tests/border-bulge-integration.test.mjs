import {createSvgNode,isSvgMount} from './fixtures/svg-dom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {World} from '../dist/physics.js';
import {CampaignWorld} from '../dist/campaign.js';
import {UPGRADES} from '../dist/upgrades.js';

// Execute the shipped scene; only its browser, audio and Phaser boundaries are stubbed.
const elements=new Map();
function element(selector){
  if(elements.has(selector))return elements.get(selector);
  if(isSvgMount(selector)){const mount=createSvgNode('http://www.w3.org/2000/svg','g');elements.set(selector,mount);return mount;}
  const classes=new Set();
  const value={hidden:false,children:[],dataset:{},style:{setProperty(){},removeProperty(){}},
    classList:{add:(...names)=>names.forEach(name=>classes.add(name)),remove:(...names)=>names.forEach(name=>classes.delete(name)),
      contains:name=>classes.has(name),toggle(name,on){on?classes.add(name):classes.delete(name);}},
    attributes:{},setAttribute(k,v){this.attributes[k]=v;},getAttribute(k){return this.attributes[k]??null;},removeAttribute(k){delete this.attributes[k];},addEventListener(){},focus(){},replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},
    firstElementChild:{style:{}},lastElementChild:{style:{}},querySelector:child=>element(selector+' '+child),
    getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:390,bottom:844,width:390,height:844})};
  elements.set(selector,value);return value;
}
globalThis.window={innerWidth:390,innerHeight:844,devicePixelRatio:2,addEventListener(){},removeEventListener(){}};
globalThis.localStorage={getItem:()=>null,setItem(){}};
globalThis.Phaser={AUTO:0,Scale:{NONE:0},Scene:class{constructor(){this.cameras={main:{setBackgroundColor(){}}};}},
  Game:class{constructor(config){this.scene=new config.scene();}}};
window.Phaser=Phaser;
globalThis.matchMedia=()=>({matches:false});
globalThis.getComputedStyle=()=>({paddingTop:'0',paddingBottom:'0',borderTopWidth:'0',borderBottomWidth:'0',marginBottom:'0'});
globalThis.requestAnimationFrame=fn=>fn();
let created=0;
globalThis.document={createElementNS:createSvgNode,readyState:'loading',hidden:false,hasFocus:()=>true,documentElement:element('html'),
  createElement:tag=>element(tag+(++created)),querySelector:element,querySelectorAll:()=>[],addEventListener(){}};

const entry=new URL('../dist/game.js',import.meta.url);
const source=(await readFile(entry,'utf8')).replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${new URL(path,entry).href}'`);
const app=await import('data:text/javascript;base64,'+Buffer.from(source+`
export function seedBorder(graphics,mode='endless',strength=1){
  viewport=displayMetrics(390,844,1);screen='play';modal=null;paused=false;result=null;drag=null;choicePress=null;
  selectedMode=mode;world=mode==='campaign'?new CampaignWorld(390,844,1,()=>.5):new World(390,844,()=>.5,{spawnInitial:false});
  world.setFeedbackOptions({strength,reducedMotion});settings.juice=strength;settings.sound=true;
  world.events=[];world.spawnTimer=world.floorTimer=world.introTimer=Infinity;
  boot();scene=game.scene;scene.g=graphics;scene.clock=10;scene.hitSoundAt=0;
  const wallSounds=[];sound.wall=(...args)=>{wallSounds.push(args);return true;};
  return {world,scene,wallSounds};
}
export function pauseBorder(value){paused=value;}
export function replaceBorderWorld(){world=new World(390,844,()=>.5,{spawnInitial:false});return world;}
`).toString('base64'));

const near=(a,b,epsilon=1e-8)=>assert.ok(Math.abs(a-b)<=epsilon,`${a} != ${b}`);
function graphics(){
  let points=[],style={width:1,color:0,alpha:1};
  const g={strokes:[],rectangles:[],lines:[],clear(){this.strokes=[];this.rectangles=[];this.lines=[];},
    lineStyle(width,color,alpha=1){style={width,color,alpha};},beginPath(){points=[];},
    moveTo(x,y){points.push({x,y});},lineTo(x,y){points.push({x,y});},closePath(){this.closed=true;},
    strokePath(){this.strokes.push({...style,points:[...points]});},
    strokeRoundedRect(x,y,width,height,radius){this.rectangles.push({...style,x,y,rectWidth:width,rectHeight:height,radius});},
    lineBetween(x1,y1,x2,y2){this.lines.push({...style,x1,y1,x2,y2});}};
  return new Proxy(g,{get:(target,key)=>key in target?target[key]:()=>{}});
}
function run(mode='endless',strength=1){const g=graphics();return {g,...app.seedBorder(g,mode,strength)};}
function hitWall(world,body=world.player,power=1,side='left'){
  const b=world.arenaBounds;Object.assign(body,{x:world.width/2,y:world.height/2,vx:0,vy:0});
  if(side==='left'){body.x=b.left+body.r-.01;body.vx=-world.baseSpeed*power;}
  if(side==='right'){body.x=b.right-body.r+.01;body.vx=world.baseSpeed*power;}
  if(side==='top'){body.y=b.top+body.r-.01;body.vy=-world.baseSpeed*power;}
  if(side==='bottom'){body.y=b.bottom-body.r+.01;body.vy=world.baseSpeed*power;}
  world.wall(body);return world.events.find(event=>event.type==='wall');
}
function draw(run){run.g.clear();run.scene.drawBorder(run.world.arenaBounds);}

test('only real main-player exterior collisions deform the frame in endless and campaign',()=>{
  for(const mode of ['endless','campaign']){
    const state=run(mode),{world,scene,g}=state;
    const event=hitWall(world);assert.equal(event.surface,'arena');scene.handleEvents();
    assert.equal(scene.wallBulges.length,1);draw(state);
    assert.equal(g.rectangles.length,0,'there is no undeformed outline beneath the bulge');
    assert.equal(g.lines.length,0,'there is no old thick impact segment');
    assert.equal(g.strokes.length,1,'the complete frame is stroked once');
    assert.ok(g.strokes[0].points.some(point=>point.x<scene.lastBorder.left-.5));
    for(const stroke of g.strokes){near(stroke.width,1);near(stroke.alpha,.65);assert.equal(stroke.color,0xc8ccbd);}
    scene.resetFeedback();
    const clone=Object.assign(world.makeBody(100,100,world.unit*.7,1),{isPlayer:true,isAuxiliary:true});world.auxiliaries.push(clone);
    const cloneEvent=hitWall(world,clone);assert.equal(cloneEvent.auxiliary,true);scene.handleEvents();
    assert.equal(scene.wallBulges.length,0,'a clone never deforms the frame');
    world.emit('wall',{...event,surface:'obstacle'});scene.handleEvents();
    assert.equal(scene.wallBulges.length,0,'an internal bank surface never deforms the exterior');
  }
});

test('low-speed outer-wall contacts are silent and have no visual response in either mode',()=>{
  for(const mode of ['endless','campaign']){
    const state=run(mode),{world,scene,wallSounds}=state;
    hitWall(world,world.player,.24);scene.handleEvents();draw(state);
    assert.equal(wallSounds.length,0);assert.equal(scene.wallBulges.length,0);
    assert.equal(state.g.strokes.length,0);assert.equal(state.g.lines.length,0);assert.equal(state.g.rectangles.length,1);
    hitWall(world,world.player,.6);scene.handleEvents();
    assert.equal(wallSounds.length,1);assert.equal(scene.wallBulges.length,1);
  }
});

test('wall-triggered shockwaves retain their wave without an indirect border flash or clone bulge',()=>{
  for(const auxiliary of [false,true]){
    const state=run(),{world,scene}=state;
    world.buffs.shockwave=1;world.shotWallCount=UPGRADES.shockwave.effect.everyWalls-1;
    const actor=auxiliary?Object.assign(world.makeBody(100,100,world.unit*.7,1),{isPlayer:true,isAuxiliary:true}):world.player;
    if(auxiliary)world.auxiliaries.push(actor);
    hitWall(world,actor);assert.ok(world.events.some(event=>event.type==='shockwave'));
    scene.handleEvents();draw(state);
    assert.equal(scene.effects.filter(effect=>effect.type==='upgrade-wave').length,1);
    assert.equal(scene.wallFlashes.length,0);
    assert.equal(scene.wallBulges.length,auxiliary?0:1);
    for(const stroke of [...state.g.strokes,...state.g.rectangles]){near(stroke.width,1);near(stroke.alpha,.65);}
  }
});

test('the first displayed collision frame keeps the peak despite later simulation substeps',()=>{
  const state=run(),{world,scene}=state;hitWall(world);scene.handleEvents();
  const bulge=scene.wallBulges[0];near(bulge.age,0);
  world.borderTime+=.04;scene.updateWallBulges();near(bulge.age,0);
  draw(state);assert.equal(bulge.fresh,false);near(bulge.age,0);
  world.borderTime+=.03;scene.updateWallBulges();near(bulge.age,.03);
  const first=state.g.strokes[0].points.reduce((min,point)=>Math.min(min,point.x),Infinity);
  draw(state);const next=state.g.strokes[0].points.reduce((min,point)=>Math.min(min,point.x),Infinity);
  assert.ok(next>first,'only subsequent displayed frames recede');
});

test('a same-edge collision uses the current rebound magnitude without adding or reviving the old peak',()=>{
  const state=run(),{world,scene}=state;world.buffs.bank=1;hitWall(world);scene.handleEvents();draw(state);
  const originalPeak=scene.wallBulges[0].peak;
  world.borderTime+=.15;scene.updateWallBulges();draw(state);
  world.buffs.bank=0;world.bank=0;hitWall(world,world.player,.5);scene.handleEvents();
  assert.equal(scene.wallBulges.length,1);near(scene.wallBulges[0].peak,originalPeak*.25);
  assert.equal(scene.wallBulges[0].fresh,true);near(scene.wallBulges[0].age,0);
  hitWall(world,world.player,1,'right');scene.handleEvents();assert.equal(scene.wallBulges.length,2);
});

test('border clocks follow scaled motion time and subtract the exact local player hold',()=>{
  for(const create of [()=>new World(900,700,()=>.5,{spawnInitial:false}),()=>new CampaignWorld(900,700,1,()=>.5)]){
    const world=create();world.setFeedbackOptions({strength:1});world.spawnTimer=world.floorTimer=world.introTimer=Infinity;
    Object.assign(world.player,{vx:0,vy:0});world.player.feedbackFreeze=.03;
    const start=world.borderTime;world.step(.005,false,{timeScale:.5});near(world.borderTime-start,0);
    world.step(.02,false,{timeScale:.5});near(world.borderTime-start,.01);
    assert.ok(world.time>world.borderTime,'the ordinary world clock includes the local hold');
  }
});

test('paused or hidden scenes do not consume pending border animation time',()=>{
  const state=run(),{world,scene}=state;hitWall(world);scene.handleEvents();draw(state);
  const bulge=scene.wallBulges[0];world.borderTime+=.03;scene.updateWallBulges();near(bulge.age,.03);
  app.pauseBorder(true);scene.updateFeedback(.2);near(bulge.age,.03);app.pauseBorder(false);
  document.hidden=true;scene.updateFeedback(.2);near(bulge.age,.03);document.hidden=false;
  world.borderTime+=.02;scene.updateWallBulges();near(bulge.age,.05);
});

test('drawing and advancing a bulge cannot alter collision geometry or subsequent bounce results',()=>{
  for(const mode of ['endless','campaign']){
    const state=run(mode),{world,scene}=state;
    const control=mode==='campaign'?new CampaignWorld(390,844,1,()=>.5):new World(390,844,()=>.5,{spawnInitial:false});
    control.setFeedbackOptions({strength:1});control.spawnTimer=control.floorTimer=control.introTimer=Infinity;control.events=[];
    hitWall(world);hitWall(control);scene.handleEvents();control.events=[];
    const bounds=structuredClone(world.arenaBounds),geometry=structuredClone(world.arenaGeometry),player=structuredClone(world.player);
    for(let i=0;i<12;i++){draw(state);scene.updateWallBulges();}
    assert.deepEqual(world.arenaBounds,bounds);assert.deepEqual(world.arenaGeometry,geometry);assert.deepEqual(world.player,player);
    world.step(.02);control.step(.02);
    assert.deepEqual(world.player,control.player);assert.deepEqual(world.arenaBounds,control.arenaBounds);
  }
});

test('scene reset and world replacement cannot leave an old border bulge visible',()=>{
  let state=run();hitWall(state.world);state.scene.handleEvents();draw(state);
  state.scene.resetFeedback();assert.equal(state.scene.wallBulges.length,0);draw(state);assert.equal(state.g.rectangles.length,1);
  state=run();hitWall(state.world);state.scene.handleEvents();draw(state);
  app.replaceBorderWorld();state.scene.updateWallBulges();assert.equal(state.scene.wallBulges.length,0);
});
