import test from 'node:test';
import assert from 'node:assert/strict';
import {drawEnemyBall,isSpecialEnemy,enemyTransferMarkup,enemyBodyColor,enemyDetailColor} from '../dist/enemy-render.js';
import {transformSkinPoint} from '../dist/skin-render.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const body=(enemyType,extra={})=>({x:80,y:130,r:20,born:1,angle:0,squash:0,enemyType,...extra});
function recorder(){
  const shapes=[];let points=[],paint={};
  return {shapes,fillStyle(color,alpha){paint={color,alpha};},lineStyle(width,color,alpha){paint={width,color,alpha};},
    beginPath(){points=[];},moveTo(x,y){points.push({x,y});},lineTo(x,y){points.push({x,y});},closePath(){},
    fillPath(){shapes.push({type:'fill',...paint,points});},strokePath(){shapes.push({type:'stroke',...paint,points});}};
}
const center=shape=>shape.points.reduce((p,q)=>({x:p.x+q.x/shape.points.length,y:p.y+q.y/shape.points.length}),{x:0,y:0});

test('enemy silhouettes stay distinct without adding eyes to other classes',()=>{
  const counts={ring:[0,1],heavy:[1,1],split:[4,0],walker:[3,0],magnet:[0,2],shield:[1,1],leader:[2,0],normal:[1,0],fragment:[1,0]};
  for(const [type,[fills,strokes]] of Object.entries(counts)){
    const g=recorder(),b=body(type,{shield:true});drawEnemyBall(g,b,0xe88c72,{unit:20,player:{x:120,y:130}});
    assert.equal(g.shapes.filter(s=>s.type==='fill').length,fills,type);
    assert.equal(g.shapes.filter(s=>s.type==='stroke').length,strokes,type);
    assert.equal(isSpecialEnemy(b),type!=='normal');
    if(type==='heavy')assert.equal(g.shapes[1].width,2.25);
    if(type==='shield')assert.equal(g.shapes[1].width,2);
    if(type==='fragment')assert.equal(g.shapes[0].color,0xa26250);
  }
  assert.equal(isSpecialEnemy(body('walker',{isBoss:true})),false);
  assert.equal(isSpecialEnemy(body('ring',{isPlayer:true})),false);
});

test('hollow bodies and their lethal highlights never fill the centre',()=>{
  for(const type of ['ring','magnet'])for(const flashAlpha of [.2,1]){
    const g=recorder();drawEnemyBall(g,body(type),0xe88c72,{flashAlpha});
    assert.ok(g.shapes.every(s=>s.type==='stroke'));
    assert.equal(g.shapes[0].width,type==='ring'?3:2.5);
    assert.ok(g.shapes.some(s=>s.color===0xffffff&&s.alpha===flashAlpha));
  }
});

test('ring gains thickness only inward while its deformed outer edge and collider stay unchanged',()=>{
  for(const options of [{},{r:12,born:.6,angle:.71,roll:.2,squash:.23},{r:17,angle:-.9,squash:-.3}]){
    const b=body('ring',options),before=structuredClone(b),g=recorder();
    drawEnemyBall(g,b,0xe88c72,{flashAlpha:.7});
    const born=1-(1-b.born)**3;
    const pose={x:b.x,y:b.y,r:b.r*born,deformAngle:b.angle,roll:b.angle+(b.roll||0),squash:b.squash||0};
    const original=Array.from({length:128},(_,i)=>transformSkinPoint({x:Math.cos(i/128*Math.PI*2),y:Math.sin(i/128*Math.PI*2)},pose));
    assert.equal(g.shapes[0].width,3);assert.deepEqual(g.shapes[0].points,g.shapes[1].points);
    for(let i=0;i<128;i++){
      const previous=original[(i+127)%128],next=original[(i+1)%128];
      const dx=next.x-previous.x,dy=next.y-previous.y,length=Math.hypot(dx,dy),nx=dy/length,ny=-dx/length;
      const actual=g.shapes[0].points[i];
      near(actual.x+nx*1.5,original[i].x+nx*.75);
      near(actual.y+ny*1.5,original[i].y+ny*.75);
      near((original[i].x-nx*.75)-(actual.x-nx*1.5),nx*1.5);
      near((original[i].y-ny*.75)-(actual.y-ny*1.5),ny*1.5);
    }
    assert.deepEqual(b,before);
  }
});

test('ring birth keeps a real hole and magnetic double-ring strokes thicken with a thinner inner ring',()=>{
  for(const r of [.4,.8,1.5,3,20]){
    const g=recorder();drawEnemyBall(g,body('ring',{r}),0xe88c72);
    const radius=Math.hypot(g.shapes[0].points[0].x-80,g.shapes[0].points[0].y-130),half=g.shapes[0].width/2;
    near(radius+half,r+.75);assert.ok(radius-half>0);
  }
  const g=recorder();drawEnemyBall(g,body('magnet'),0xe88c72);
  assert.deepEqual(g.shapes.map(s=>s.width),[2.5,1.5]);
  near(g.shapes[0].points[0].x-80,20);near(g.shapes[1].points[0].x-80,14.4);
});

test('outer lines, markers and eyes share spin, squash, birth and display radius without mutating physics',()=>{
  const b=body('split',{born:.4,r:20*.82,angle:.71,roll:.2,squash:.23}),before=structuredClone(b);
  const g=recorder();drawEnemyBall(g,b,0xe88c72,{alpha:.7});
  const born=1-.6**3,pose={x:b.x,y:b.y,r:b.r*born,deformAngle:b.angle,roll:b.angle+b.roll,squash:b.squash};
  for(let i=0;i<128;i++){
    const t=i/128*Math.PI*2;
    const centers=[{x:0,y:0,r:1},{x:0,y:-.26,r:.12},{x:-.22,y:.13,r:.12},{x:.22,y:.13,r:.12}];
    for(const [index,center] of centers.entries()){
      const shape=g.shapes[index],expected=transformSkinPoint({x:center.x+Math.cos(t)*center.r,y:center.y+Math.sin(t)*center.r},pose);
      near(shape.points[i].x,expected.x);near(shape.points[i].y,expected.y);
    }
  }
  near(g.shapes[0].alpha,.7*born);
  for(const hole of g.shapes.slice(1)){near(hole.alpha,.7*born);assert.equal(hole.color,0x8b5444);}
  assert.deepEqual(b,before);
  const ghost=recorder();drawEnemyBall(ghost,{...b,feedbackFreeze:.06},0xe88c72,{alpha:.7});
  assert.deepEqual(ghost.shapes,g.shapes,'death freeze preserves type and geometry');
});

test('shield halo is visual only, follows the display scale and disappears on real shield state change',()=>{
  const b=body('shield',{r:16,shield:true}),g=recorder();
  drawEnemyBall(g,b,0xe88c72,{unit:16});
  near(g.shapes[1].points[0].x-b.x,16+16*.3);assert.equal(b.r,16);
  const broken=recorder();drawEnemyBall(broken,{...b,shield:false},0xe88c72,{unit:16});
  assert.equal(broken.shapes.length,1);assert.equal(broken.shapes[0].type,'fill');
});

test('walker eyes look toward the player in world coordinates while rotating with the body',()=>{
  for(const color of [0xe88c72,0xb2a2dc,0xeea752,0x222222])for(const angle of [0,.7,Math.PI/2]){
    const b=body('walker',{angle}),left=recorder(),right=recorder();
    drawEnemyBall(left,b,color,{player:{x:-100,y:b.y}});
    drawEnemyBall(right,b,color,{player:{x:300,y:b.y}});
    for(const i of [1,2]){
      const a=center(left.shapes[i]),z=center(right.shapes[i]);near(z.x-a.x,b.r*.26);near(z.y,a.y);
      assert.equal(left.shapes[i].color,enemyDetailColor(color));assert.equal(left.shapes[i].alpha,1);
    }
    const expected=[16,8,0].reduce((value,shift)=>value|Math.round(((color>>shift)&255)*.7)<<shift,0);
    assert.equal(enemyBodyColor(body('fragment'),color),expected);
    assert.equal(enemyBodyColor({bodySnapshot:body('fragment')},color),expected);
    assert.equal(enemyBodyColor(body('normal'),color),color);
  }
});

test('birth and result fades also apply to lines and details, and hidden births emit nothing',()=>{
  const g=recorder();assert.equal(drawEnemyBall(g,body('ring',{born:0}),0xe88c72),false);assert.equal(g.shapes.length,0);
  for(const enemyType of ['ring','heavy','split','walker','magnet','shield','leader','fragment']){
    const g=recorder();drawEnemyBall(g,body(enemyType,{shield:true}),0xe88c72,{alpha:.25,birthScale:.5,birthAlpha:.4});
    assert.ok(g.shapes.every(s=>s.alpha<=.1+1e-12&&s.alpha>0));
    const radius=Math.hypot(g.shapes[0].points[0].x-80,g.shapes[0].points[0].y-130);
    if(enemyType==='ring')near(radius+g.shapes[0].width/2,10+.75);else near(radius,10);
  }
});

test('result transfer markup preserves the displayed enemy paths and never fills a hollow source',()=>{
  for(const enemyType of ['ring','heavy','split','walker','magnet','shield','leader','fragment']){
    const b=body(enemyType,{r:14.4,born:.6,angle:.3,squash:.12,shield:true});
    const options={unit:16,player:{x:160,y:100}},g=recorder();
    drawEnemyBall(g,b,0xe88c72,{...options,birthScale:1,birthAlpha:1-.4**3});
    const markup=enemyTransferMarkup(b,0xe88c72,options),paths=[...markup.matchAll(/<path d="([^"]+)" fill="([^"]+)" stroke="([^"]+)"/g)];
    assert.equal(paths.length,g.shapes.length);
    paths.forEach((path,i)=>{
      const coordinates=[...path[1].matchAll(/[ML]([\d.e+-]+) ([\d.e+-]+)/g)];
      assert.equal(coordinates.length,g.shapes[i].points.length);
      coordinates.forEach((p,j)=>{near(Number(p[1]),g.shapes[i].points[j].x);near(Number(p[2]),g.shapes[i].points[j].y);});
    });
    if(['ring','magnet'].includes(enemyType))assert.ok(paths.every(path=>path[2]==='none'));
    assert.ok(markup.includes(`viewBox="${b.x-b.r} ${b.y-b.r} ${b.r*2} ${b.r*2}"`));
  }
});
