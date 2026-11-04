import test from 'node:test';
import assert from 'node:assert/strict';
import {drawCampaign,campaignTutorialGuide,campaignBodyVisual,campaignCaptureVisuals,campaignBorderGap,drawCampaignBorder,campaignTextVisuals,campaignChainTrack} from '../dist/campaign-render.js';
import {levelLayout,trackPath} from '../dist/levels.js';
import {CampaignWorld} from '../dist/campaign.js';
import {MERGE_RADII} from '../dist/classes/merge.js';
import {wallParams,createWallRules} from '../dist/classes/wall.js';
import {peggleParams,createPeggleRules} from '../dist/classes/peggle.js';
import {poolParams,poolBounds,createPoolRules} from '../dist/classes/pool.js';
import {golfParams,createGolfRules} from '../dist/classes/golf.js';
import {pinballParams,createPinballRules} from '../dist/classes/pinball.js';
import {bowlingParams,bowlingBounds,createBowlingRules} from '../dist/classes/bowling.js';
import {bricksParams,bricksBounds,createBricksRules} from '../dist/classes/bricks.js';
import {glassParams,createGlassRules} from '../dist/classes/glass.js';
import {drawEnemyBall} from '../dist/enemy-render.js';

function recorder(){
  let points=[],style={},closed=false;const shapes=[];
  return {shapes,fillStyle(color,alpha){style={color,alpha};},lineStyle(width,color,alpha){style={width,color,alpha};},
    beginPath(){points=[];closed=false;},moveTo(x,y){points.push({x,y});},lineTo(x,y){points.push({x,y});},closePath(){closed=true;},
    fillPath(){shapes.push({type:'fill',...style,closed,points});},strokePath(){shapes.push({type:'stroke',...style,closed,points});}};
}
const bounds=shape=>({left:Math.min(...shape.points.map(p=>p.x)),right:Math.max(...shape.points.map(p=>p.x)),
  top:Math.min(...shape.points.map(p=>p.y)),bottom:Math.max(...shape.points.map(p=>p.y))});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const base=()=>({mode:'campaign',config:{k:1},phase:'battle',unit:20,player:{x:100,y:260,r:20},statics:[],zones:[]});

test('chain rail samples the selector rounded 300-degree path, caches only stable geometry and stays inside its true band',()=>{
  for(const [width,height] of [[320,568],[390,844],[844,390],[568,320],[1280,800]]){
    const layout=levelLayout(width,height),before=structuredClone(layout),points=campaignChainTrack(layout);
    assert.ok(points.length>100&&points.length<200);
    assert.equal(campaignChainTrack(layout),points);assert.deepEqual(layout,before);
    const start=trackPath(layout).match(/^M ([\d.-]+) ([\d.-]+)/);
    near(points[0].x,Number(start[1]));near(points[0].y,Number(start[2]));
    for(const point of points){
      assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y));
      const r=Math.hypot(point.x-layout.cx,point.y-layout.cy);
      assert.ok(r>=layout.inner-1e-4&&r<=layout.outer+1e-4,`${width} x ${height}: ${r}`);
    }
    const oldX=points[0].x;layout.cx+=10;const moved=campaignChainTrack(layout);
    assert.notEqual(moved,points);near(moved[0].x,oldX+10);
  }
  assert.deepEqual(campaignChainTrack(null),[]);
  assert.deepEqual(campaignChainTrack({cx:0,cy:0,inner:0,outer:10,corner:0,startAngle:0,endAngle:5}),[]);
});

test('merge sources converge while the new size fades in without changing simulation radii or skin/player geometry',()=>{
  const world={...base(),feedbackTime:4},sources=[-1,1].map((side,id)=>({id,kind:'merge-ball',mergeLevel:3,
    x:100+side*20,y:140,r:20,hp:Infinity,born:1,angle:.2,roll:.4}));
  world.mergeCaptures=sources.map(bodySnapshot=>({bodySnapshot,bodyId:bodySnapshot.id,kind:'merge',
    toX:100,toY:140,at:4,duration:.2}));
  const merged={id:3,kind:'merge-ball',mergeLevel:4,x:100,y:140,r:26,hp:Infinity,born:1,mergeBornAt:4};
  const initial=campaignBodyVisual(world,merged);near(initial.body.r,26*.55);assert.equal(initial.alpha,0);
  world.feedbackTime+=.1;const before=JSON.stringify(world),beforeBody=structuredClone(merged);
  const live=campaignBodyVisual(world,merged),ghosts=campaignCaptureVisuals(world);
  assert.ok(live.alpha>0&&live.alpha<1);assert.ok(live.body.r>26*.55&&live.body.r<26);
  assert.equal(ghosts.length,2);
  for(let i=0;i<2;i++){
    assert.ok(Math.abs(ghosts[i].body.x-100)<Math.abs(sources[i].x-100));
    assert.ok(ghosts[i].body.r<sources[i].r);assert.equal(ghosts[i].player,false);
    assert.equal(ghosts[i].body.roll,sources[i].roll);
  }
  const reduced=campaignBodyVisual(world,merged,{reducedMotion:true}),still=campaignCaptureVisuals(world,{reducedMotion:true});
  near(reduced.body.r,merged.r);near(reduced.alpha,live.alpha);
  for(let i=0;i<2;i++){near(still[i].body.x,sources[i].x);near(still[i].body.r,sources[i].r);near(still[i].alpha,ghosts[i].alpha);}
  assert.equal(JSON.stringify(world),before);assert.deepEqual(merged,beforeBody);
  const main={...world.player,isPlayer:true,r:24};assert.equal(campaignBodyVisual(world,main).body,main);
  world.feedbackTime=4.2;assert.equal(campaignCaptureVisuals(world).length,0);assert.equal(campaignBodyVisual(world,merged).body,merged);
  assert.equal(campaignBodyVisual(world,{...merged,active:false,hp:0}).hidden,true);
  for(let level=1;level<=5;level++){
    const body={...merged,mergeLevel:level,r:MERGE_RADII[level-1]*world.unit};
    const g=recorder();drawEnemyBall(g,campaignBodyVisual(world,body).body,0x123456);
    assert.equal(g.shapes.length,1);assert.equal(g.shapes[0].color,0x123456);
    near(bounds(g.shapes[0]).right-bounds(g.shapes[0]).left,body.r*2);
  }
});

test('chain rendering follows the real rail, skips queued beads and keeps size rings inside their collision radii',()=>{
  const world={...base(),chainTrack:{cx:170,cy:220,radius:110,inner:109.2,outer:110.8,corner:.7,
    startAngle:Math.PI*2/3,endAngle:Math.PI*7/3}};
  world.statics=[0,1,2].map((sizeIndex,index)=>({id:index,kind:'chain-ball',shape:'circle',sizeIndex,
    x:100+index*50,y:150,r:[.6,.85,1.1][sizeIndex]*20,hp:1,active:true}));
  world.statics.push({kind:'chain-ball',shape:'circle',sizeIndex:2,x:20,y:20,r:22,hp:1,hidden:true},
    {kind:'chain-wall',shape:'arc',x:170,y:220,r:110,startAngle:Math.PI*2/3,sweepAngle:Math.PI*5/3,width:1.6,hp:Infinity},
    {kind:'chain-chord',shape:'rect',x:170,y:220+110*Math.sin(Math.PI*2/3),width:110,height:1.6,cornerRadius:.8,hp:Infinity});
  const end=world.chainTrack.endAngle;
  world.zones=[{kind:'chain-hole',shape:'circle',x:170+110*Math.cos(end),y:220+110*Math.sin(end),r:25}];
  const before=JSON.stringify(world),g=recorder(),reduced=recorder();
  drawCampaign(g,world,{showTutorial:false,enemyColor:0x123456});
  drawCampaign(reduced,world,{showTutorial:false,enemyColor:0x123456,reducedMotion:true,strength:0});
  assert.deepEqual(g.shapes,reduced.shapes);assert.equal(JSON.stringify(world),before);
  assert.equal(g.shapes.length,11);assert.deepEqual(g.shapes[0].points,campaignChainTrack(world.chainTrack));
  assert.equal(g.shapes[0].type,'fill');assert.equal(g.shapes[1].closed,false);
  assert.equal(g.shapes[2].type,'fill');assert.equal(g.shapes[3].width,1);
  let offset=4;
  for(const body of world.statics.slice(0,3)){
    const ball=g.shapes[offset++];assert.equal(ball.color,0x123456);assert.equal(ball.type,'fill');
    near(bounds(ball).right-bounds(ball).left,body.r*2);
    for(let i=0;i<body.sizeIndex;i++)for(const point of g.shapes[offset++].points)
      assert.ok(Math.hypot(point.x-body.x,point.y-body.y)+.5<body.r);
  }
  const chord=g.shapes.at(-1);assert.equal(chord.color,g.shapes[0].color);assert.equal(chord.alpha,g.shapes[0].alpha);
  near(bounds(chord).right-bounds(chord).left,110);near(bounds(chord).bottom-bounds(chord).top,1.6);
  world.statics[0].x+=7;const moved=recorder();drawCampaign(moved,world,{showTutorial:false});
  near(moved.shapes[4].points[0].x-g.shapes[4].points[0].x,7);
});

test('brick damage changes only drawing opacity and size while preserving the collider and theme color',()=>{
  const world=base(),brick={shape:'rect',kind:'brick',x:100,y:80,width:44,height:24,cornerRadius:4,hp:3,maxHp:3};
  world.statics=[brick];const before=structuredClone(world),whole=recorder();
  drawCampaign(whole,world,{enemyColor:0x123456});assert.deepEqual(world,before);
  near(bounds(whole.shapes[0]).right-bounds(whole.shapes[0]).left,44);near(whole.shapes[0].alpha,.9);
  brick.hp=1;const injured=recorder(),hurtBefore=structuredClone(world);drawCampaign(injured,world,{enemyColor:0x123456});
  assert.deepEqual(world,hurtBefore);assert.equal(injured.shapes[0].color,0x123456);
  assert.ok(bounds(injured.shapes[0]).right-bounds(injured.shapes[0]).left<44);
  assert.ok(injured.shapes[0].alpha<whole.shapes[0].alpha);
  brick.hp=0;const dead=recorder();drawCampaign(dead,world);assert.equal(dead.shapes.length,0);
});

test('checker cells are visibly distinct without adding decorative shapes or extra colors',()=>{
  const world=base();world.statics=[0,1].map((shade,i)=>({shape:'rect',kind:'brick',x:50+i*50,y:80,width:44,height:24,
    cornerRadius:4,hp:2,maxHp:2,pattern:'checker',shade}));
  const g=recorder();drawCampaign(g,world);assert.equal(g.shapes.length,2);
  assert.notEqual(g.shapes[0].alpha,g.shapes[1].alpha);assert.equal(g.shapes[0].color,g.shapes[1].color);
});

test('permanent rounded rectangular obstacles retain finite visible geometry with infinite HP',()=>{
  const world=base();world.statics=[{shape:'rect',kind:'obstacle',x:100,y:80,width:44,height:24,cornerRadius:4,hp:Infinity,maxHp:Infinity}];
  const g=recorder();drawCampaign(g,world);
  assert.equal(g.shapes.length,1);near(g.shapes[0].alpha,.85);assert.equal(g.shapes[0].type,'stroke');
  for(const point of g.shapes[0].points)assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y));
  near(bounds(g.shapes[0]).right-bounds(g.shapes[0]).left,44);
});

test('target and ordinary pegs stay solid-looking or outlined respectively, and hit pegs retain their collision radius until cleared',()=>{
  const world=base();world.statics=[false,true].map((target,i)=>({shape:'circle',kind:'peg',x:60+i*60,y:100,r:9,target,active:true}));
  const before=structuredClone(world),g=recorder();drawCampaign(g,world);
  assert.deepEqual(world,before);assert.equal(g.shapes[0].type,'stroke');assert.equal(g.shapes[1].type,'fill');
  world.statics.forEach(body=>body.hitThisShot=true);const hit=recorder();drawCampaign(hit,world);
  assert.equal(hit.shapes.length,4);near(bounds(hit.shapes[0]).right-bounds(hit.shapes[0]).left,18);
  near(bounds(hit.shapes[2]).right-bounds(hit.shapes[2]).left,18);
  assert.equal(hit.shapes[0].type,'stroke');assert.equal(hit.shapes[2].type,'fill');
  assert.ok(hit.shapes[0].alpha<g.shapes[0].alpha);assert.ok(hit.shapes[2].alpha<g.shapes[1].alpha);
  world.statics.forEach(body=>body.active=false);const cleared=recorder();drawCampaign(cleared,world);assert.equal(cleared.shapes.length,0);
});

test('moving bucket is a background-filled open slot at the real floor and follows its zone horizontally',()=>{
  const world=base();world.zones=[{kind:'bucket',shape:'rect',x:90,y:355,width:44,height:10,visualY:375,visualHeight:10}];
  const before=structuredClone(world),g=recorder();drawCampaign(g,world,{bgColor:0xabcdef,inkColor:0x334455});
  assert.deepEqual(world,before);assert.equal(g.shapes.length,3);assert.equal(g.shapes[0].color,0xabcdef);
  const outline=g.shapes[1];assert.equal(outline.type,'stroke');assert.equal(outline.closed,false);
  assert.equal(outline.color,0x334455);near(bounds(outline).bottom,380);near(bounds(outline).right-bounds(outline).left,44);
  near(outline.points[0].y,370);near(outline.points.at(-1).y,370);
  world.zones[0].x+=17;const moved=recorder();drawCampaign(moved,world);
  for(let i=0;i<outline.points.length;i++){near(moved.shapes[1].points[i].x-outline.points[i].x,17);near(moved.shapes[1].points[i].y,outline.points[i].y);}
});

test('first-shot teaching uses a bounded static dotted path outside the player and ends before the target',()=>{
  const world={...base(),config:{k:0},tutorialVisible:true,tutorialTarget:{x:80,y:60,r:9},shotsUsed:0};
  const dots=campaignTutorialGuide(world);assert.ok(dots.length>=2&&dots.length<=24);
  for(const dot of dots){assert.ok(Math.hypot(dot.x-world.player.x,dot.y-world.player.y)>world.player.r);
    assert.ok(Math.hypot(dot.x-80,dot.y-60)>9);}
  const normal=recorder(),reduced=recorder();drawCampaign(normal,world);drawCampaign(reduced,world,{reducedMotion:true,strength:0});
  assert.deepEqual(normal.shapes,reduced.shapes,'no tutorial pulse or zoom is required to read the hint');
  world.shotActive=true;assert.equal(campaignTutorialGuide(world).length,0);world.shotActive=false;world.tutorialVisible=false;
  assert.equal(campaignTutorialGuide(world).length,0);
});

test('pool pockets and golf holes keep the actual trigger radius with only background fill and a one-pixel ink ring',()=>{
  const world=base();world.zones=[{kind:'pocket',shape:'circle',x:50,y:80,r:27},
    {kind:'hole',shape:'circle',x:150,y:100,r:26,moving:true}];
  const before=structuredClone(world),g=recorder();drawCampaign(g,world,{bgColor:0xabcdef,inkColor:0x334455});
  assert.deepEqual(world,before);assert.equal(g.shapes.length,4);
  for(let i=0;i<2;i++){
    const fill=g.shapes[i*2],ring=g.shapes[i*2+1];
    assert.equal(fill.type,'fill');assert.equal(fill.color,0xabcdef);
    assert.equal(ring.type,'stroke');assert.equal(ring.color,0x334455);assert.equal(ring.width,1);
    assert.deepEqual(fill.points,ring.points);near(bounds(fill).right-bounds(fill).left,world.zones[i].r*2);
  }
  world.zones[1].x+=11;const moved=recorder();drawCampaign(moved,world,{reducedMotion:true,strength:0});
  for(let i=0;i<g.shapes[3].points.length;i++)near(moved.shapes[3].points[i].x-g.shapes[3].points[i].x,11);
});

test('first-shot guide stops outside dynamic target balls and hole zones instead of crossing their artwork',()=>{
  for(const collection of ['enemies','zones']){
    const world={...base(),config:{k:0},tutorialVisible:true,tutorialTarget:{x:100,y:80},[collection]:[{x:100,y:80,r:27}]};
    const dots=campaignTutorialGuide(world);assert.ok(dots.length>0);
    assert.ok(Math.hypot(dots.at(-1).x-100,dots.at(-1).y-80)>=30-1e-8);
  }
});

test('capture snapshots shrink into the matching pocket without changing infinite-HP simulation bodies or appearance',()=>{
  const world={...base(),feedbackTime:5};
  const target={id:9,x:80,y:100,r:19,hp:Infinity,maxHp:Infinity,angle:.3,born:1};
  world.poolCaptures=[{bodyId:9,bodySnapshot:target,pocketX:50,pocketY:80,at:5,duration:.22,player:false}];
  const before=structuredClone(world),initial=campaignCaptureVisuals(world);
  assert.deepEqual(initial[0].body,targetWithCaptureDefaults(target));assert.equal(initial[0].alpha,1);assert.equal(initial[0].player,false);
  assert.deepEqual(world,before);
  world.feedbackTime+=.11;const mid=campaignCaptureVisuals(world)[0];
  assert.ok(mid.body.x<target.x&&mid.body.x>50);assert.ok(mid.body.y<target.y&&mid.body.y>80);
  assert.ok(mid.body.r>0&&mid.body.r<target.r);near(mid.alpha,.5);assert.equal(mid.body.hp,Infinity);assert.equal(mid.body.angle,.3);
  world.feedbackTime+=.11;assert.equal(campaignCaptureVisuals(world).length,0);
});

function targetWithCaptureDefaults(target){return {...target,born:1,captured:false};}

test('golf capture hides only the captured main player while providing the hole endpoint for crown and result transfer',()=>{
  const world={...base(),feedbackTime:2},player={id:1,isPlayer:true,x:100,y:100,r:20,captured:true,roll:.6};
  world.player=player;world.golfCapture={bodySnapshot:{...player},pocketX:110,pocketY:90,at:2,duration:.22,player:true};
  const before=structuredClone(world),main=campaignBodyVisual(world,player),ghost=campaignCaptureVisuals(world)[0];
  assert.equal(main.hidden,true);assert.equal(main.alpha,0);assert.equal(main.body.x,110);assert.equal(main.body.y,90);
  assert.equal(main.body.r,20);assert.equal(main.body.roll,.6);assert.equal(ghost.body.isPlayer,true);assert.equal(ghost.player,true);
  assert.equal(ghost.body.captured,false);assert.deepEqual(world,before);
  const ordinary={id:2,x:40,y:50,r:20};assert.equal(campaignBodyVisual(world,ordinary).body,ordinary);
  assert.equal(campaignBodyVisual({...world,mode:'endless'},player).hidden,false);
});

test('capture pause and reduced motion keep stable geometry while missing or expired data never produce NaN',()=>{
  const world={...base(),feedbackTime:2.1},source={id:1,isPlayer:true,x:100,y:100,r:20};
  world.golfCapture={bodySnapshot:source,pocketX:110,pocketY:90,at:2,duration:.22,player:true};
  const frame=campaignCaptureVisuals(world,{reducedMotion:true});
  assert.deepEqual(campaignCaptureVisuals(world,{reducedMotion:true}),frame,'unchanged clock represents pause');
  assert.equal(frame[0].body.x,100);assert.equal(frame[0].body.y,100);assert.equal(frame[0].body.r,20);
  assert.ok(frame[0].alpha>0&&frame[0].alpha<1);
  world.golfCapture={bodySnapshot:{...source,r:NaN},at:2};assert.deepEqual(campaignCaptureVisuals(world),[]);
  world.golfCapture={bodySnapshot:source,age:.3,duration:.22};assert.deepEqual(campaignCaptureVisuals(world),[]);
  world.golfCapture={bodySnapshot:source,age:0};const fallback=campaignCaptureVisuals(world)[0];
  assert.ok([fallback.body.x,fallback.body.y,fallback.body.r,fallback.alpha].every(Number.isFinite));
});

test('bowling heavy-pin damage and fallen transfer bodies remain readable without changing physics size',()=>{
  const world=base(),pin={id:2,kind:'bowling-pin',enemyType:'heavy',x:80,y:100,r:11,hp:Infinity,maxHp:Infinity,pinHP:2,pinMaxHP:2};
  const whole=campaignBodyVisual(world,pin);assert.equal(whole.body,pin);assert.equal(whole.alpha,1);
  pin.pinHP=1;const before=structuredClone(pin),injured=campaignBodyVisual(world,pin);
  assert.equal(injured.body.r,11);assert.ok(injured.alpha<whole.alpha&&injured.alpha>.5);assert.deepEqual(pin,before);
  pin.pinHP=0;pin.bowlingFallen=true;const fallen=campaignBodyVisual(world,pin);
  assert.equal(fallen.hidden,false);assert.ok(fallen.alpha>0&&fallen.alpha<injured.alpha);assert.equal(fallen.body.r,11);
  const light={...pin,enemyType:'normal',pinHP:1,pinMaxHP:1,bowlingFallen:false};
  const heavyArt=recorder(),lightArt=recorder();drawEnemyBall(heavyArt,whole.body,0x123456);drawEnemyBall(lightArt,light,0x123456);
  assert.equal(heavyArt.shapes.length,2);assert.equal(heavyArt.shapes[1].type,'stroke');assert.equal(lightArt.shapes.length,1);
});

test('pinball bumpers use player-colored rings while targets and damaged jackpots use enemy color',()=>{
  const world=base();world.statics=[
    {kind:'bumper',shape:'circle',x:60,y:80,r:18,hp:Infinity,maxHp:Infinity},
    {kind:'pinball-target',shape:'rect',x:130,y:80,width:25,height:13,cornerRadius:3.2,hp:1,maxHp:1},
    {kind:'jackpot',shape:'circle',x:100,y:160,r:36,hp:3,maxHp:3},
  ];
  const before=structuredClone(world),g=recorder();drawCampaign(g,world,{playerColor:0x123456,enemyColor:0x654321});
  assert.deepEqual(world,before);assert.equal(g.shapes.length,3);
  assert.equal(g.shapes[0].type,'stroke');assert.equal(g.shapes[0].color,0x123456);near(bounds(g.shapes[0]).right-bounds(g.shapes[0]).left,36);
  for(const shape of g.shapes.slice(1)){assert.equal(shape.type,'fill');assert.equal(shape.color,0x654321);}
  world.statics[2].hp=1;const damaged=recorder();drawCampaign(damaged,world);
  assert.ok(damaged.shapes[2].alpha<g.shapes[2].alpha);assert.deepEqual(damaged.shapes[2].points,g.shapes[2].points);
  world.statics[1].hp=world.statics[2].hp=0;const gone=recorder();drawCampaign(gone,world);assert.equal(gone.shapes.length,1);
});

test('pinball drain is a real open border path with matching width, including visual feedback offsets',()=>{
  const world=base();world.arenaBounds={left:16,right:304,top:16,bottom:552};
  world.zones=[{kind:'drain',shape:'rect',x:160,y:531,width:80,height:4,visualY:552,visualHeight:10}];
  const before=structuredClone(world),gap=campaignBorderGap(world);assert.deepEqual(gap,{left:120,right:200});
  for(const options of [{},{dx:2,dy:-1,outset:3}]){
    const g=recorder();g.lineStyle(1,0x123456,.65);
    assert.equal(drawCampaignBorder(g,{...world.arenaBounds,cornerRadius:22},gap,options),true);
    const shape=g.shapes[0],dx=options.dx||0,dy=options.dy||0,outset=options.outset||0;
    assert.equal(shape.closed,false);assert.equal(shape.type,'stroke');assert.equal(shape.width,1);assert.equal(shape.color,0x123456);
    near(shape.points[0].x,gap.right+dx);near(shape.points.at(-1).x,gap.left+dx);
    near(shape.points[0].y,552+dy+outset);near(shape.points.at(-1).y,552+dy+outset);
    for(let i=1;i<shape.points.length;i++){
      const a=shape.points[i-1],b=shape.points[i];
      assert.ok([a.x,a.y,b.x,b.y].every(Number.isFinite));
      if(Math.abs(a.y-(552+dy+outset))<1e-8&&Math.abs(b.y-a.y)<1e-8)
        assert.ok(Math.max(a.x,b.x)<=gap.left+dx+1e-8||Math.min(a.x,b.x)>=gap.right+dx-1e-8,'no stroke crosses the opening');
    }
  }
  const normal=recorder(),reduced=recorder();drawCampaign(normal,world);drawCampaign(reduced,world,{reducedMotion:true,strength:0});
  assert.deepEqual(reduced.shapes,normal.shapes);assert.equal(normal.shapes.length,3);assert.deepEqual(world,before);
  for(const line of normal.shapes.filter(shape=>shape.type==='stroke'))assert.equal(line.points[0].x,line.points[1].x,'no floor stroke seals the drain');
  assert.equal(campaignBorderGap({...world,mode:'endless'}),null);
  world.zones[0].active=false;assert.equal(campaignBorderGap(world),null);
});

test('number-brick labels keep stable IDs, exact moving centers and approved-font width inside the circle',()=>{
  const world=base();world.statics=[1,12,165,999].map((hp,id)=>({id,kind:'number-brick',shape:'circle',x:40+id*40,y:80,r:14.4,hp,maxHp:hp}));
  const before=structuredClone(world),labels=campaignTextVisuals(world);
  assert.deepEqual(world,before);assert.deepEqual(labels.map(label=>label.text),['1','12','165','999']);
  for(const [index,label] of labels.entries()){
    const advance=[...label.text].reduce((sum,char)=>sum+(char==='1'?.450:.613),0)*label.size;
    assert.ok(advance<=world.statics[index].r*1.35);assert.ok(label.size<=world.statics[index].r*1.05);
    assert.equal(label.x,world.statics[index].x);assert.equal(label.y,world.statics[index].y);
    assert.equal(label.color,0x252720);assert.ok(Number.isFinite(label.size)&&label.size>0);
  }
  world.statics[2].hp=99;world.statics[2].y+=19;
  const moved=campaignTextVisuals(world,{alpha:.4});assert.equal(moved[2].id,labels[2].id);
  assert.equal(moved[2].text,'99');assert.equal(moved[2].y,99);assert.equal(moved[2].alpha,.4);
  const damaged=recorder();drawCampaign(damaged,world);assert.ok(damaged.shapes[2].alpha<damaged.shapes[0].alpha);
  near(bounds(damaged.shapes[2]).right-bounds(damaged.shapes[2]).left,world.statics[2].r*2);
  assert.equal(campaignTextVisuals(world,{enemyColor:0x101010})[0].color,0xf4f3eb);
  world.statics[0].hp=0;world.statics[1].active=false;world.statics[2].dead=true;world.statics[3].hp=Infinity;
  assert.deepEqual(campaignTextVisuals(world),[]);assert.deepEqual(campaignTextVisuals({...before,mode:'endless'}),[]);
});

test('plus-one pickups use one readable background ring and matching text without decorative paths',()=>{
  const world=base();world.zones=[{id:8,kind:'brick-plus',shape:'circle',x:100,y:80,r:9,active:true}];
  const g=recorder();drawCampaign(g,world,{bgColor:0xf4f3eb,inkColor:0x123456});
  assert.equal(g.shapes.length,2);assert.equal(g.shapes[0].type,'fill');assert.equal(g.shapes[0].color,0xf4f3eb);
  assert.equal(g.shapes[1].type,'stroke');assert.equal(g.shapes[1].color,0x123456);
  const [label]=campaignTextVisuals(world,{inkColor:0x123456});assert.equal(label.text,'+1');assert.equal(label.color,0x123456);
  assert.ok((.549+.450)*label.size<9*1.35);near(label.x,100);near(label.y,80);
  world.zones[0].active=false;assert.deepEqual(campaignTextVisuals(world),[]);const gone=recorder();drawCampaign(gone,world);assert.equal(gone.shapes.length,0);
});

test('glass contours stay hollow at their physical outer radius and the nonblocking miss line stays a single line',()=>{
  const world=base();world.statics=[{kind:'glass',shape:'circle',x:100,y:100,r:16,hp:1,maxHp:1}];
  world.zones=[{kind:'glass-bottom',shape:'rect',x:160,y:300,width:288,height:1,visualY:300}];
  const before=structuredClone(world),g=recorder(),reduced=recorder();
  drawCampaign(g,world,{enemyColor:0x654321});drawCampaign(reduced,world,{enemyColor:0x654321,reducedMotion:true,strength:0});
  assert.deepEqual(world,before);assert.deepEqual(reduced.shapes,g.shapes);assert.equal(g.shapes.length,2);
  assert.equal(g.shapes[0].type,'stroke');assert.equal(g.shapes[0].points.length,2);assert.equal(g.shapes[0].closed,false);
  assert.equal(g.shapes[1].type,'stroke');assert.equal(g.shapes[1].color,0x654321);
  near(bounds(g.shapes[1]).right+g.shapes[1].width/2,116);assert.equal(campaignTextVisuals(world).length,0);
  world.statics[0].y+=12;const moving=recorder();drawCampaign(moving,world);
  for(let i=0;i<g.shapes[1].points.length;i++)near(moving.shapes[1].points[i].y-g.shapes[1].points[i].y,12);
});

test('twenty returning small balls keep unique player-photo identities, fixed radii and synchronized fades',()=>{
  const world={...base(),feedbackTime:2.175};world.bricksReturns=Array.from({length:20},(_,index)=>({
    bodySnapshot:{id:index+100,isPlayer:true,isAuxiliary:true,kind:'bricks-ball',x:30+index*10,y:80,r:10,roll:index*.1},
    toX:160,toY:300,at:2,duration:.35}));
  const before=structuredClone(world),normal=campaignCaptureVisuals(world),reduced=campaignCaptureVisuals(world,{reducedMotion:true});
  assert.equal(normal.length,20);assert.equal(new Set(normal.map(item=>item.body.id)).size,20);assert.deepEqual(world,before);
  for(const [index,item] of normal.entries()){
    assert.equal(item.player,true);assert.equal(item.auxiliary,true);assert.equal(item.body.isAuxiliary,true);assert.equal(item.body.r,10);
    assert.equal(item.body.roll,index*.1);near(item.alpha,.5);assert.ok(item.body.y>80&&item.body.y<300);
    assert.equal(reduced[index].body.x,before.bricksReturns[index].bodySnapshot.x);assert.equal(reduced[index].body.y,80);
    assert.equal(reduced[index].body.r,10);near(reduced[index].alpha,.5);
  }
  world.feedbackTime=2.35;assert.deepEqual(campaignCaptureVisuals(world),[]);
});

test('legacy, inactive and fully faded campaign layers do not draw',()=>{
  for(const world of [{...base(),legacy:true},{...base(),config:{legacy:true}},{...base(),mode:'endless'}]){
    world.statics=[{shape:'circle',kind:'peg',r:9,x:50,y:50,target:true}];const g=recorder();drawCampaign(g,world);assert.equal(g.shapes.length,0);
  }
  const world=base();world.statics=[{shape:'circle',kind:'peg',r:9,x:50,y:50,target:true}];const g=recorder();
  drawCampaign(g,world,{alpha:0});assert.equal(g.shapes.length,0);
});

test('all ten real wall layouts stay within portrait and landscape bounds with bounded graphics work',()=>{
  for(const [width,height] of [[320,568],[390,844],[844,390],[568,320],[1280,800]])for(let k=0;k<10;k++){
    const unit=Math.max(18,Math.min(34,Math.min(width,height)*.047));
    const world={...base(),width,height,unit,config:{k},player:{x:width/2,y:height*.76,r:unit},enemies:[],id:0,
      arenaBounds:{left:16,right:width-16,top:16,bottom:height-16,width:width-32,height:height-32},
      addStatic(spec){const body={...spec,id:++this.id};this.statics.push(body);return body;},
      makeBody(x,y,r,density){return {id:++this.id,x,y,r,density};}};
    const rules=createWallRules(world);rules.setup(k);
    const before=JSON.stringify(world),g=recorder();drawCampaign(g,world,{showTutorial:false});
    assert.equal(JSON.stringify(world),before);assert.equal(g.shapes.length,wallParams(k).brickCount);
    assert.ok(g.shapes.length<=64);
    for(const shape of g.shapes){assert.equal(shape.points.length,28);
      for(const point of shape.points){assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y));
        assert.ok(point.x>=16&&point.x<=width-16,`${width}x${height} k${k} x${point.x}`);
        assert.ok(point.y>=16&&point.y<=height-16,`${width}x${height} k${k} y${point.y}`);}}
  }
});

test('all ten real peg layouts and their moving pins draw within phone and desktop bounds',()=>{
  for(const [width,height] of [[320,568],[390,844],[844,390],[568,320],[1280,800]])for(let k=0;k<10;k++){
    const unit=Math.max(18,Math.min(34,Math.min(width,height)*.047)),params=peggleParams(k);
    const world={...base(),width,height,unit,config:{...params,k},player:{x:width/2,y:height*.76,r:unit},id:0,
      arenaBounds:{left:16,right:width-16,top:16,bottom:height-16,width:width-32,height:height-32},
      addStatic(spec){const body={...spec,id:++this.id};this.statics.push(body);return body;},
      addZone(spec){const zone={...spec,id:++this.id};this.zones.push(zone);return zone;}};
    const rules=createPeggleRules(world);rules.setup(k);rules.onTick(1.6);
    const before=JSON.stringify(world),g=recorder();drawCampaign(g,world,{showTutorial:false});
    assert.equal(JSON.stringify(world),before);assert.equal(g.shapes.length,params.totalPegs+3);
    assert.ok(g.shapes.length<=56);
    for(const shape of g.shapes)for(const point of shape.points){
      assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y));
      assert.ok(point.x>=16-1e-8&&point.x<=width-16+1e-8,`${width}x${height} k${k} x${point.x}`);
      assert.ok(point.y>=16-1e-8&&point.y<=height-16+1e-8,`${width}x${height} k${k} y${point.y}`);
    }
    world.statics.forEach(pin=>pin.hitThisShot=true);const touched=recorder();drawCampaign(touched,world,{showTutorial:false});
    assert.equal(touched.shapes.length,params.totalPegs*2+3);assert.ok(touched.shapes.length<=109);
  }
});

test('all forty pool and golf layouts keep holes, obstacles and infinite-HP actors finite and clear of the HUD',()=>{
  for(const [width,height] of [[320,568],[390,844],[844,390],[568,320],[1280,800]]){
    for(const kind of ['pool','golf'])for(let rank=0;rank<20;rank++){
      const k=rank>>1,world=new CampaignWorld(width,height,k*10+(kind==='pool'?3:7)+rank%2,()=>.5);
      const {unit,config:params,rules}=world;
      for(const dt of [0,1.6,1.6]){
        rules.onTick(dt);
        const before=JSON.stringify(world),normal=recorder(),reduced=recorder();
        drawCampaign(normal,world,{showTutorial:false});drawCampaign(reduced,world,{showTutorial:false,reducedMotion:true,strength:0});
        assert.equal(JSON.stringify(world),before);assert.deepEqual(reduced.shapes,normal.shapes);
        assert.equal(normal.shapes.length,kind==='pool'?12:params.staticCount+2);
        const b=world.arenaBounds,hudBottom=height>520?112:76;
        for(const shape of normal.shapes)for(const point of shape.points){
          assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y),`${kind} k${k} nonfinite path`);
          assert.ok(point.x>=b.left-1e-8&&point.x<=b.right+1e-8,`${kind} ${width}x${height} k${k} x=${point.x}`);
          assert.ok(point.y>=Math.max(b.top,hudBottom)-1e-8&&point.y<=b.bottom+1e-8,`${kind} ${width}x${height} k${k} y=${point.y}`);
        }
        for(const body of [world.player,...world.enemies]){
          assert.ok(body.x-body.r>=b.left-1e-8&&body.x+body.r<=b.right+1e-8,`${kind} ${width}x${height} k${k} body x=${body.x}`);
          assert.ok(body.y-body.r>=Math.max(b.top,hudBottom)-1e-8&&body.y+body.r<=b.bottom+1e-8,`${kind} ${width}x${height} k${k} body y=${body.y}`);
        }
        const dynamic=recorder();
        for(const body of world.enemies){assert.equal(body.hp,Infinity);assert.equal(body.maxHp,Infinity);
          drawEnemyBall(dynamic,body,0x123456,{unit,player:world.player});}
        assert.ok(dynamic.shapes.length<=12,'no hidden per-frame particle or decorative work');
        for(const shape of dynamic.shapes)for(const point of shape.points)assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y));
      }
    }
  }
});

test('all ten pinball boards render each real target cycle and active jackpot within phone bounds',()=>{
  for(const [width,height] of [[320,568],[390,844],[844,390],[568,320],[1280,800]])for(let k=0;k<10;k++){
    const unit=Math.max(18,Math.min(34,Math.min(width,height)*.047)),params=pinballParams(k);
    const world={...base(),width,height,unit,config:{...params,k},id:0,enemies:[],auxiliaries:[],events:[],
      player:{id:0,isPlayer:true,x:width/2,y:height*.76,r:unit,mass:1.5},shotActive:true,feedbackTime:0,maxCombo:0,
      arenaBounds:{left:16,right:width-16,top:16,bottom:height-16,width:width-32,height:height-32},
      addStatic(spec){const body={...spec,id:++this.id};this.statics.push(body);return body;},
      addZone(spec){const zone={...spec,id:++this.id};this.zones.push(zone);return zone;},
      hitStatic(body,damage){body.hp-=damage;if(body.hp<=0)body.dead=true;},emit(type,event){this.events.push({type,...event});}};
    const rules=createPinballRules(world);rules.setup(k);
    const check=expected=>{
      const before=JSON.stringify(world),g=recorder(),reduced=recorder();
      drawCampaign(g,world,{showTutorial:false});drawCampaign(reduced,world,{showTutorial:false,reducedMotion:true,strength:0});
      assert.equal(JSON.stringify(world),before);assert.deepEqual(reduced.shapes,g.shapes);
      assert.equal(g.shapes.length,expected);assert.ok(g.shapes.length<=14);
      for(const shape of g.shapes)for(const point of shape.points){
        assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y));
        assert.ok(point.x>=16-1e-8&&point.x<=width-16+1e-8,`${width}x${height} k${k} x${point.x}`);
        assert.ok(point.y>=(height>520?112:76)-1e-8&&point.y<=height-16+1e-8,`${width}x${height} k${k} y${point.y}`);
      }
      const gap=campaignBorderGap(world);near(gap.right-gap.left,4*unit);
    };
    for(let group=0;group<3;group++){
      check(3+params.bumperCount+params.targetCount);
      const guide=campaignTutorialGuide({...world,shotActive:false,tutorialVisible:true,teachingTarget:rules.tutorialTarget()});
      assert.ok(guide.length>0);for(const dot of guide)assert.ok(Number.isFinite(dot.x)&&Number.isFinite(dot.y));
      for(const target of world.statics.filter(body=>body.kind==='pinball-target'))rules.onStaticHit(target);
      check(3+params.bumperCount+1);
      const jackpot=world.statics.find(body=>body.kind==='jackpot');
      for(let hit=0;hit<3;hit++)rules.onStaticHit(jackpot);
      rules.onTick(3);
      if(group<2)assert.equal(world.pinballState.group,group+1);
    }
  }
});

test('all ten bowling lanes keep their gutters reachable, outside walls aligned, and pin artwork inside phone bounds',()=>{
  for(const [width,height] of [[320,568],[390,844],[844,390],[568,320],[1280,800]])for(let k=0;k<10;k++){
    const unit=Math.max(18,Math.min(34,Math.min(width,height)*.047)),params=bowlingParams(k);
    const world={...base(),width,height,unit,config:{...params,k},id:0,enemies:[],inset:16,
      player:{id:0,isPlayer:true,x:width/2,y:height*.76,r:unit,mass:1.5},
      get arenaBounds(){return bowlingBounds(this);},
      addStatic(spec){const body={hp:Infinity,maxHp:Infinity,...spec,id:++this.id};this.statics.push(body);return body;},
      addZone(spec){const zone={...spec,id:++this.id};this.zones.push(zone);return zone;},
      makeBody(x,y,r,density){return {id:++this.id,x,y,r,density,vx:0,vy:0,squash:0,angle:0,born:1};}};
    const rules=createBowlingRules(world);rules.setup(k);
    const layout=world.bowlingLayout,b=world.arenaBounds;
    assert.equal(world.enemies.filter(body=>body.enemyType==='heavy').length,params.heavyPins);
    for(const gutter of world.zones){
      const wall=world.statics.find(body=>body.side===gutter.side);
      const gCenter=layout.vertical?gutter.x:gutter.y,wCenter=layout.vertical?wall.x:wall.y;
      const gHalf=(layout.vertical?gutter.width:gutter.height)/2,wHalf=(layout.vertical?wall.width:wall.height)/2;
      near(gCenter+gHalf*gutter.side,wCenter-wHalf*gutter.side);
      near(Math.abs(gCenter-layout.center)-gHalf,layout.laneWidth/2);
      assert.ok(Math.abs(wCenter-layout.center)>Math.abs(gCenter-layout.center),'the physical wall stays outside the gutter');
    }
    for(const state of ['standing','hurt','fallen']){
      for(const pin of world.enemies){pin.pinHP=state==='standing'?pin.pinMaxHP:state==='hurt'?1:0;pin.bowlingFallen=state==='fallen';}
      const before=JSON.stringify(world),g=recorder(),reduced=recorder();
      drawCampaign(g,world,{showTutorial:false});drawCampaign(reduced,world,{showTutorial:false,reducedMotion:true,strength:0});
      assert.equal(g.shapes.length,6);assert.deepEqual(reduced.shapes,g.shapes);assert.equal(JSON.stringify(world),before);
      for(const pin of world.enemies){const pose=campaignBodyVisual(world,pin);assert.equal(pose.body.r,.55*unit);
        drawEnemyBall(g,pose.body,0x123456,{alpha:pose.alpha,unit});}
      assert.ok(g.shapes.length<=19);
      for(const shape of g.shapes)for(const point of shape.points){
        assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y)&&Number.isFinite(shape.alpha));
        assert.ok(point.x>=b.left-1e-8&&point.x<=b.right+1e-8,`${width}x${height} k${k} x${point.x}`);
        assert.ok(point.y>=b.top-1e-8&&point.y<=b.bottom+1e-8,`${width}x${height} k${k} y${point.y}`);
      }
    }
  }
});

function task10Fixture(width,height,k,kind){
  const unit=Math.max(18,Math.min(34,Math.min(width,height)*.047)),params=kind==='bricks'?bricksParams(k):glassParams(k);
  return {...base(),width,height,unit,config:{...params,k},id:0,enemies:[],auxiliaries:[],events:[],inset:16,
    player:{id:0,isPlayer:true,x:width/2,y:height*.76,r:unit,mass:1.5,density:1.5},
    remaining:params.budget,shotsUsed:0,shotActive:false,feedbackTime:0,time:0,buffs:{},feedbackOptions:{strength:.6,reducedMotion:false},
    get arenaBounds(){return kind==='bricks'?bricksBounds(this):{left:16,right:width-16,top:16,bottom:height-16,width:width-32,height:height-32};},
    addStatic(spec){const body={...spec,id:++this.id};this.statics.push(body);return body;},
    addZone(spec){const zone={...spec,id:++this.id};this.zones.push(zone);return zone;},
    makeBody(x,y,r,density){return {id:++this.id,x,y,r,density,vx:0,vy:0,squash:0,angle:0,born:1};},
    emit(type,event){this.events.push({type,...event});}};
}

test('all ten brick boards keep moving numbers inside circles and the HUD safe throughout row entry and full grids',()=>{
  for(const [width,height] of [[320,568],[390,844],[844,390],[568,320],[1280,800]])for(let k=0;k<10;k++){
    const world=task10Fixture(width,height,k,'bricks'),rules=createBricksRules(world);rules.setup(k);
    const check=()=>{
      const before=JSON.stringify(world),g=recorder(),reduced=recorder(),labels=campaignTextVisuals(world);
      drawCampaign(g,world,{showTutorial:false});drawCampaign(reduced,world,{showTutorial:false,reducedMotion:true,strength:0});
      assert.deepEqual(g.shapes,reduced.shapes);assert.equal(JSON.stringify(world),before);
      assert.ok(g.shapes.length<=120);assert.ok(labels.length<=84);
      const b=world.arenaBounds;
      for(const shape of g.shapes)for(const point of shape.points){
        assert.ok([point.x,point.y,shape.alpha].every(Number.isFinite));
        assert.ok(point.x>=b.left-1e-8&&point.x<=b.right+1e-8,`${width}x${height} k${k} x${point.x}`);
        assert.ok(point.y>=b.top-1e-8&&point.y<=b.bottom+1e-8,`${width}x${height} k${k} y${point.y}`);
      }
      for(const label of labels){
        const body=[...world.statics,...world.zones].find(body=>label.id.endsWith('-'+body.id));
        assert.ok(body);near(label.x,body.x);near(label.y,body.y);
        assert.ok(label.text.length*.64*label.size<=body.r*1.35+1e-8);
        if(label.alpha>0){assert.ok(label.x>=b.left&&label.x<=b.right);assert.ok(label.y>=b.top&&label.y<=b.bottom);}
      }
    };
    check();
    while(!world.bricksOverflow){
      world.shotsUsed++;world.remaining--;rules.onLaunchEnd({victory:false});
      world.feedbackTime+=.35;rules.onTick(.35);check();
      world.feedbackTime+=.125;rules.onTick(.125);check();
      world.feedbackTime+=.125;rules.onTick(.125);check();
      assert.ok(world.shotsUsed<=30,'full board reaches its loss row within bounded rounds');
    }
  }
});

test('all ten glass conveyors keep hollow moving rows and the miss baseline inside portrait and landscape bounds',()=>{
  for(const [width,height] of [[320,568],[390,844],[844,390],[568,320],[1280,800]])for(let k=0;k<10;k++){
    const world=task10Fixture(width,height,k,'glass'),rules=createGlassRules(world);rules.setup(k);
    for(let tick=0;tick<80;tick++){
      world.feedbackTime+=.125;world.time+=.125;rules.onTick(.125);rules.onAfterTick();
      const before=JSON.stringify(world),g=recorder(),reduced=recorder();
      drawCampaign(g,world,{showTutorial:false});drawCampaign(reduced,world,{showTutorial:false,reducedMotion:true,strength:0});
      assert.deepEqual(g.shapes,reduced.shapes);assert.equal(JSON.stringify(world),before);
      assert.ok(g.shapes.length<=45);assert.deepEqual(campaignTextVisuals(world),[]);
      for(const shape of g.shapes){assert.equal(shape.type,'stroke');
        for(const point of shape.points){assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y));
          assert.ok(point.x>=16-1e-8&&point.x<=width-16+1e-8);
          assert.ok(point.y>=(height>520?112:76)-1e-8&&point.y<=height-16+1e-8);}}
    }
  }
});

const renderRandom=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};

test('all ten real merge boards keep initial and spawned Infinite-HP balls within the square before and after rotation',()=>{
  for(const [width,height] of [[320,568],[390,844],[844,390],[568,320],[1280,800]])for(let k=0;k<10;k++){
    const world=new CampaignWorld(width,height,k*10+5,renderRandom(400+k),{upgradeId:k%2?'growth':'gravity'});
    const check=()=>{
      const b=world.arenaBounds,before=JSON.stringify(world),g=recorder();
      drawCampaign(g,world,{showTutorial:false});assert.equal(g.shapes.length,world.statics.length,'only authored fixed columns enter the static layer');
      for(const body of world.enemies){
        const pose=campaignBodyVisual(world,body);if(pose.hidden)continue;
        assert.equal(body.hp,Infinity);assert.equal(body.maxHp,Infinity);
        near(body.r,MERGE_RADII[body.mergeLevel-1]*world.unit);
        drawEnemyBall(g,pose.body,0x123456,{unit:world.unit,alpha:pose.alpha});
      }
      for(const capture of campaignCaptureVisuals(world))drawEnemyBall(g,capture.body,0x123456,{alpha:capture.alpha});
      assert.equal(JSON.stringify(world),before);
      assert.ok(g.shapes.length<=40,'plain balls and bounded short captures need no extra shape decoration');
      for(const shape of g.shapes)for(const p of shape.points){
        assert.ok([p.x,p.y,shape.alpha].every(Number.isFinite));
        assert.ok(p.x>=b.left-1e-5&&p.x<=b.right+1e-5,`${width}x${height} k${k} x${p.x}`);
        assert.ok(p.y>=b.top-1e-5&&p.y<=b.bottom+1e-5,`${width}x${height} k${k} y${p.y}`);
      }
      assert.ok(b.top>=(world.height>520?128:86));
      near(campaignBodyVisual(world,world.player).body.r,world.unit*world.config.playerRadius*(world.upgradeId==='growth'?1.2:1));
    };
    check();world.step(4);check();world.resize(height,width);check();
  }
});
