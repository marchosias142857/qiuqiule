import test from 'node:test';
import assert from 'node:assert/strict';
import {COMPANION_DEFINITIONS,COMPANION_STATE_VERSION,COMPANION_UNLOCK_STEP,COMPANION_ORBIT,
  normalizeCompanionState,unlockCompanions,acknowledgeCompanionUnlock,selectCompanion,companionColors,companionGeometry,
  drawCompanions,companionSvg,companionPreview,CompanionTrails,companionTrailLength} from '../dist/companions.js';
import {COMET_CROSS_SECTION,COMET_TRAIL} from '../dist/comet-trail.js';
import {skinContour,morphSkinContour} from '../dist/skins.js';
import {projectSkinContour} from '../dist/skin-render.js';

const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const polygonArea=points=>Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-p.y*q.x;},0))/2;
const centroid=points=>{
  let area=0,x=0,y=0;
  points.forEach((p,i)=>{const q=points[(i+1)%points.length],cross=p.x*q.y-q.x*p.y;area+=cross;x+=(p.x+q.x)*cross;y+=(p.y+q.y)*cross;});
  return {x:x/(3*area),y:y/(3*area)};
};
const segmentDistance=(p,a,b)=>{
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy,t=length?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/length,0,1):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const outlineDistance=(p,contour)=>Math.min(...contour.map((a,i)=>segmentDistance(p,a,contour[(i+1)%contour.length])));
const crosses=(a,b,c,d)=>{
  const cross=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  const ab=Math.hypot(b.x-a.x,b.y-a.y)*1e-6,cd=Math.hypot(d.x-c.x,d.y-c.y)*1e-6;
  const ac=cross(a,b,c),ad=cross(a,b,d),ca=cross(c,d,a),cb=cross(c,d,b);
  return ((ac>ab&&ad< -ab)||(ac< -ab&&ad>ab))&&((ca>cd&&cb< -cd)||(ca< -cd&&cb>cd));
};

test('nine companions are ordered by count then sun, moon, star at exact five-stage steps',()=>{
  assert.equal(COMPANION_STATE_VERSION,2);assert.equal(COMPANION_UNLOCK_STEP,5);
  assert.deepEqual(COMPANION_DEFINITIONS.map(item=>item.id),['sun-1','moon-1','star-1','sun-2','moon-2','star-2','sun-3','moon-3','star-3']);
  assert.deepEqual(COMPANION_DEFINITIONS.map(item=>item.label),['日·一','月·一','星·一','日·二','月·二','星·二','日·三','月·三','星·三']);
  assert.deepEqual(COMPANION_DEFINITIONS.map(item=>item.stage),[5,10,15,20,25,30,35,40,45]);
  COMPANION_DEFINITIONS.forEach((item,i)=>{
    assert.equal(item.count,Math.floor(i/3)+1);assert.equal('score' in item,false);
    assert.equal(normalizeCompanionState(null,{highestStage:item.stage-1}).unlocked,i);
    assert.equal(normalizeCompanionState(null,{highestStage:item.stage-.001}).unlocked,i);
    const earned=normalizeCompanionState(null,{highestStage:item.stage});
    assert.equal(earned.unlocked,i+1);
    assert.deepEqual(earned.pendingUnlocks,COMPANION_DEFINITIONS.slice(0,i+1).map(item=>item.id));
    assert.deepEqual(normalizeCompanionState(null,{highestStage:String(item.stage)}),earned);
  });
});

test('invalid stages and legacy raw score cannot grant companions or auto-equip one',()=>{
  const empty={version:2,unlocked:0,selected:null,pendingUnlocks:[]};
  for(const raw of [null,undefined,[],false,'bad JSON',{unlocked:Infinity},{unlocked:-4},{unlocked:'9'},{selected:'star-3'}])assert.deepEqual(normalizeCompanionState(raw),empty);
  for(const highestStage of [NaN,Infinity,true,{},null,-5,'Infinity']){
    assert.deepEqual(normalizeCompanionState(null,{highestStage}),empty);
    assert.deepEqual(unlockCompanions(null,highestStage),{state:empty,newlyUnlocked:[]});
  }
  for(const best of [8000,72000,999999,'999999'])assert.deepEqual(normalizeCompanionState(null,{best}),empty);
  const all=normalizeCompanionState(null,{highestStage:999999});
  assert.equal(all.unlocked,9);assert.equal(all.selected,null);assert.equal(all.pendingUnlocks.length,9);
});

test('legacy score-earned ownership survives migration without replaying already owned rewards',()=>{
  for(let unlocked=0;unlocked<=9;unlocked++){
    const selected=unlocked?COMPANION_DEFINITIONS[unlocked-1].id:null;
    const legacy=Object.freeze({version:1,unlocked,selected});
    const migrated=normalizeCompanionState(JSON.stringify(legacy),{highestStage:0,best:999999});
    assert.deepEqual(migrated,{version:2,unlocked,selected,pendingUnlocks:[]});
    assert.deepEqual(normalizeCompanionState(migrated,{highestStage:unlocked*5}),migrated);
  }
  const upgraded=normalizeCompanionState({version:1,unlocked:2,selected:'moon-1'},{highestStage:25});
  assert.deepEqual(upgraded,{version:2,unlocked:5,selected:'moon-1',pendingUnlocks:['star-1','sun-2','moon-2']});
  assert.deepEqual(normalizeCompanionState(JSON.stringify(upgraded),{highestStage:25}),upgraded);
});

test('ownership persists across lower runs and reports every newly crossed milestone once',()=>{
  const first=unlockCompanions(null,15);
  assert.deepEqual(first.newlyUnlocked,['sun-1','moon-1','star-1']);
  assert.deepEqual(first.state.pendingUnlocks,first.newlyUnlocked);
  const equipped=selectCompanion(first.state,'moon-1');
  const restored=normalizeCompanionState(JSON.stringify(equipped),{highestStage:1});assert.deepEqual(restored,equipped);
  assert.deepEqual(unlockCompanions(restored,5),{state:restored,newlyUnlocked:[]});
  const all=unlockCompanions(restored,45);
  assert.equal(all.state.selected,'moon-1');assert.deepEqual(all.newlyUnlocked,COMPANION_DEFINITIONS.slice(3).map(item=>item.id));
  assert.deepEqual(all.state.pendingUnlocks,COMPANION_DEFINITIONS.map(item=>item.id));
  assert.deepEqual(unlockCompanions(all.state,1e9).newlyUnlocked,[]);
});

test('pending rewards are canonical, owned-only and durable until their individual acknowledgement',()=>{
  const pendingUnlocks=Object.freeze(['star-1','sun-1','moon-1','sun-1','star-3','unknown',null]);
  const raw=Object.freeze({version:2,unlocked:3,selected:'moon-1',pendingUnlocks});
  const normalized=normalizeCompanionState(raw);
  assert.deepEqual(normalized.pendingUnlocks,['sun-1','moon-1','star-1']);
  assert.deepEqual(selectCompanion(normalized,'sun-1').pendingUnlocks,normalized.pendingUnlocks);
  assert.deepEqual(acknowledgeCompanionUnlock(normalized,'unknown'),normalized);
  assert.deepEqual(acknowledgeCompanionUnlock(normalized),normalized);
  const acknowledged=acknowledgeCompanionUnlock(normalized,'moon-1');
  assert.deepEqual(acknowledged,{...normalized,pendingUnlocks:['sun-1','star-1']});
  assert.deepEqual(acknowledgeCompanionUnlock(acknowledged,'moon-1'),acknowledged);
  const reloaded=normalizeCompanionState(JSON.stringify(acknowledged),{highestStage:15});
  assert.deepEqual(reloaded,acknowledged,'reload must not re-queue a dismissed reward');
  const next=unlockCompanions(reloaded,20);
  assert.deepEqual(next.newlyUnlocked,['sun-2']);
  assert.deepEqual(next.state.pendingUnlocks,['sun-1','star-1','sun-2']);
  let completed=next.state;
  for(const id of completed.pendingUnlocks)completed=acknowledgeCompanionUnlock(completed,id);
  assert.deepEqual(completed.pendingUnlocks,[]);
  assert.equal(completed.unlocked,4);assert.equal(completed.selected,'moon-1');
  assert.deepEqual(unlockCompanions(JSON.stringify(completed),20),{state:completed,newlyUnlocked:[]});
  assert.equal(raw.pendingUnlocks,pendingUnlocks);assert.equal(raw.pendingUnlocks.length,7);
});

test('malformed pending data never invents notifications for old ownership',()=>{
  for(const pendingUnlocks of [true,'sun-1',{},null,undefined]){
    assert.deepEqual(normalizeCompanionState({version:1,unlocked:9,pendingUnlocks}).pendingUnlocks,[]);
  }
  assert.deepEqual(normalizeCompanionState({pendingUnlocks:['star-3']}).pendingUnlocks,[]);
});

test('selection toggles the equipped choice off, guards locked entries and never mutates saves',()=>{
  const raw=Object.freeze({version:2,unlocked:2,selected:null,pendingUnlocks:Object.freeze(['moon-1'])});
  assert.deepEqual(selectCompanion(raw,'star-1'),raw);assert.deepEqual(selectCompanion(raw,'invalid'),raw);
  const equipped=selectCompanion(raw,'sun-1');assert.equal(equipped.selected,'sun-1');
  assert.equal(selectCompanion(equipped,'sun-1').selected,null);
  assert.equal(selectCompanion(equipped,'moon-1').selected,'moon-1');
  assert.equal(selectCompanion(equipped,null).selected,null);
  assert.equal(raw.selected,null);
});

test('each count follows the same circular orbit at equal angular spacing with no time or view reset',()=>{
  for(const definition of COMPANION_DEFINITIONS)for(const time of [0,.1,1.7,3.4,1234.567]){
    const pose=Object.freeze({x:120,y:280,r:17,squash:.9,angle:1.5,pullAmount:1,vx:999,vy:-300,mass:19});
    const geometry=companionGeometry(definition.id,pose,time);
    assert.equal(geometry.satellites.length,definition.count);
    for(const satellite of geometry.satellites)near(Math.hypot(satellite.center.x-pose.x,satellite.center.y-pose.y),pose.r*COMPANION_ORBIT.radius);
    for(let i=1;i<geometry.satellites.length;i++)near(geometry.satellites[i].angle-geometry.satellites[i-1].angle,Math.PI*2/definition.count);
    assert.deepEqual(companionGeometry(definition.id,pose,time,{reducedMotion:true}),geometry);
    const next=companionGeometry(definition.id,pose,time+COMPANION_ORBIT.period);
    geometry.satellites.forEach((sat,i)=>{near(sat.center.x,next.satellites[i].center.x);near(sat.center.y,next.satellites[i].center.y);});
  }
});

test('polygon orbit uses a rounded true distance offset rather than scaling vertices',()=>{
  const pose={x:70,y:90,r:20},contour=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>({x:pose.x+x*pose.r,y:pose.y+y*pose.r}));
  const geometry=companionGeometry('sun-3',pose,.33,{contour});
  assert.equal(geometry.orbitOffset,10);assert.equal(geometry.orbitPath.length,96);
  for(const p of [...geometry.orbitPath,...geometry.satellites.map(s=>s.center)])assert.ok(Math.abs(outlineDistance(p,contour)-10)<.1);
  const diagonal=geometry.orbitPath[36];
  near(diagonal.x-pose.x,20+10/Math.sqrt(2));near(diagonal.y-pose.y,20+10/Math.sqrt(2));
  assert.ok(Math.abs(diagonal.x-(pose.x+30))>2,'simple scale would incorrectly put the corner at x + 30');
});

test('all rendered shape, morph, drag and flight contours have a parallel orbit without offset self-crossings',()=>{
  for(const sides of [0,6,7,15])for(const pullAmount of [0,.5,1])for(const roll of [0,.7]){
    const pose=Object.freeze({x:30,y:70,r:17,pullAmount,deformAngle:.3,roll,squash:.12,flightStretch:.1,flightAngle:.5});
    const contour=projectSkinContour(skinContour(sides),pose),snapshot=JSON.stringify(contour);
    const geometry=companionGeometry('moon-3',pose,1.3,{contour});
    for(const p of [...geometry.orbitPath,...geometry.satellites.map(s=>s.center)]){
      assert.ok(Math.abs(outlineDistance(p,contour)/pose.r-.5)<.008);
    }
    const path=geometry.orbitPath;
    for(let i=0;i<path.length;i++)for(let j=i+2;j<path.length;j++){
      if(i===0&&j===path.length-1)continue;
      assert.equal(crosses(path[i],path[(i+1)%path.length],path[j],path[(j+1)%path.length]),false);
    }
    assert.equal(JSON.stringify(contour),snapshot);
    assert.ok(geometry.orbitSourcePoints<=64&&geometry.orbitSourcePoints>=24);
  }
});

test('companions and tails traverse the same projected orbit with equal arc-length spacing',()=>{
  const pose={x:60,y:90,r:24,pullAmount:1,deformAngle:1.1,squash:-.1,roll:.7};
  const contour=projectSkinContour(skinContour(6),pose);
  for(const count of [1,2,3])for(const time of [.1,1.7,3.39,3.41]){
    const geometry=companionGeometry('star-'+count,pose,time,{contour}),length=geometry.orbitLength;
    geometry.satellites.forEach((sat,index)=>{
      const next=geometry.satellites[(index+1)%count];
      if(count>1)near(((next.orbitDistance-sat.orbitDistance)%length+length)%length,length/count);
      for(const p of sat.tailPoints)assert.ok(outlineDistance(p,geometry.orbitPath)<1e-7);
      for(const p of sat.tail.flatMap(band=>band.vertices))assert.ok(outlineDistance(p,geometry.orbitPath)<pose.r*.15);
      assert.ok(sat.tail.every(band=>band.vertices.every(p=>Math.hypot(p.x-sat.center.x,p.y-sat.center.y)>.02*pose.r)));

    });
  }
});

test('morphing shapes preserves the current orbit phase and cache is shared by fading companion layers',()=>{
  const pose={x:90,y:120,r:25,roll:.3,pullAmount:.6,deformAngle:2},time=2.19;
  const first=projectSkinContour(morphSkinContour(6,15,.4),pose),next=projectSkinContour(morphSkinContour(6,15,.4001),pose);
  const before=companionGeometry('sun-3',pose,time,{contour:first}),after=companionGeometry('sun-3',pose,time,{contour:next});
  before.satellites.forEach((sat,i)=>assert.ok(Math.hypot(sat.center.x-after.satellites[i].center.x,sat.center.y-after.satellites[i].center.y)<pose.r*.01));
  const fadingLayer=companionGeometry('moon-2',pose,time,{contour:first,alpha:.4});
  assert.equal(fadingLayer.orbitPath,before.orbitPath);
  near(fadingLayer.satellites[0].center.x,before.satellites[0].center.x);near(fadingLayer.satellites[0].center.y,before.satellites[0].center.y);
  const plain=companionGeometry('moon-2',pose,time,{contour:[]});assert.equal(plain.orbitPath,null);
});

test('the filled crescent centroid itself follows the circular orbit and retains a real concave cutout',()=>{
  for(const time of [0,.4,2]){
    const sat=companionGeometry('moon-1',{x:80,y:90,r:25},time).satellites[0];
    const outline=[...sat.bands[0].outer,...sat.bands.at(-1).inner.slice().reverse()],center=centroid(outline);
    near(center.x,sat.center.x);near(center.y,sat.center.y);
    const turns=outline.map((p,i)=>{const a=outline[(i+1)%outline.length],b=outline[(i+2)%outline.length];return(a.x-p.x)*(b.y-a.y)-(a.y-p.y)*(b.x-a.x);});
    assert.ok(turns.some(t=>t>1e-5)&&turns.some(t=>t< -1e-5));
    assert.ok(polygonArea(outline)<Math.PI*sat.r*sat.r*.7);
  }
});

test('companion body and comet tail remain within the shared four-radius UI box at all orbit angles',()=>{
  for(const definition of COMPANION_DEFINITIONS)for(let i=0;i<24;i++){
    const geometry=companionGeometry(definition.id,{x:40,y:40,r:20},i/24*COMPANION_ORBIT.period);
    for(const satellite of geometry.satellites){
      const points=[...satellite.bands.flatMap(b=>[...b.outer,...b.inner]),...satellite.tail.flatMap(b=>b.vertices)];
      assert.ok(points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=80&&p.y>=0&&p.y<=80));
    }
  }
});

test('tails share player comet cross-section and a tapered nonzero-width flat end even for stationary players',()=>{
  const satellite=companionGeometry('sun-1',{x:0,y:0,r:20,vx:0,vy:0},0).satellites[0];
  assert.equal(new Set(satellite.tail.map(b=>b.region)).size,COMET_CROSS_SECTION.length);
  satellite.tail.forEach(band=>{
    near(band.alpha,COMPANION_ORBIT.tailOpacity*COMET_CROSS_SECTION[band.region].alpha);
    assert.ok(band.vertices.length>=4);assert.ok(polygonArea(band.vertices)>0);
  });
  const edge=satellite.tail[0].vertices;
  assert.ok(Math.hypot(edge[0].x-edge.at(-1).x,edge[0].y-edge.at(-1).y)>0);
});

test('only in-play speed above the player trail threshold grows companion tails smoothly to a bound',()=>{
  const r=20,unit=17,base=COMPANION_ORBIT.size*4.6*r;
  const length=speed=>companionTrailLength(r,{speed:speed*unit,unit,inPlay:true});
  for(const speed of [0,COMET_TRAIL.startSpeed-1,COMET_TRAIL.startSpeed])near(length(speed),base);
  const speeds=[COMET_TRAIL.startSpeed,22,26,30,36,COMET_TRAIL.fullSpeed];
  for(let i=1;i<speeds.length;i++)assert.ok(length(speeds[i])>length(speeds[i-1]));
  near(length(COMET_TRAIL.fullSpeed),base*3);near(length(1000),base*3);
  assert.ok(length(COMET_TRAIL.startSpeed+.001)-base<1e-6,'no jump at the shared onset speed');
  near(length(30),base*2);
  for(const speed of [0,20*unit,40*unit,1000*unit])near(companionTrailLength(r,{speed,unit}),base);
  near(companionTrailLength(0,{speed:100,inPlay:true}),0);
  near(companionTrailLength(r,{speed:NaN,unit,inPlay:true}),base);
  near(companionTrailLength(r*2,{speed:30*unit*2,unit:unit*2,inPlay:true}),length(30)*2);
});

test('all gradient bands are translucent, use the selected hue and fade proportionally',()=>{
  for(const color of ['#b8db8a','#252720','#ffee55',0,0xffffff]){
    const colors=companionColors(color);
    for(const shift of [16,8,0]){
      assert.ok(((colors.center>>shift)&255)>=((colors.base>>shift)&255));
      assert.ok(((colors.edge>>shift)&255)<=((colors.base>>shift)&255));
    }
    const full=companionGeometry('star-3',{r:20},0,{color}),half=companionGeometry('star-3',{r:20},0,{color,alpha:.5});
    full.satellites.forEach((sat,i)=>{
      assert.ok(sat.bands.every(b=>b.alpha>0&&b.alpha<1));
      sat.bands.forEach((band,j)=>near(half.satellites[i].bands[j].alpha,band.alpha*.5));
      sat.tail.forEach((band,j)=>{assert.equal(band.color,colors.base);near(half.satellites[i].tail[j].alpha,band.alpha*.5);});
    });
  }
});

test('continuous gradient endpoints meet without jumps and keep the lighter 60 percent opacity',()=>{
  assert.equal(COMPANION_ORBIT.opacity,.60);
  for(const shape of ['sun','moon','star']){
    const colors=companionColors('#b8db8a'),sat=companionGeometry(shape+'-1',{r:20},0,{color:'#b8db8a'}).satellites[0];
    assert.ok(sat.bands.every(b=>b.alpha===.60));
    for(let i=1;i<sat.bands.length;i++){
      assert.equal(shape==='moon'?sat.bands[i-1].innerColor:sat.bands[i-1].outerColor,
        shape==='moon'?sat.bands[i].outerColor:sat.bands[i].innerColor);
    }
    if(shape==='moon'){
      assert.equal(sat.bands[0].outerColor,colors.edge);assert.equal(sat.bands.at(-1).innerColor,colors.edge);
      assert.equal(sat.bands[1].innerColor,colors.center);
    }else{
      assert.equal(sat.bands[0].innerColor,colors.center);assert.equal(sat.bands.at(-1).outerColor,colors.edge);
    }
  }
});

test('WebGL interpolates vertices while Canvas uses fine disjoint bands, both cover the body once',()=>{
  for(const type of [1,2])for(const shape of ['sun','moon','star']){
    let style=null;const triangles=[],polygons=[],current=[],gradients=[];
    const g={scene:{sys:{game:{renderer:{type}}}},
      fillStyle(color,alpha){style={color,alpha};},
      fillGradientStyle(tl,tr,bl,br,alpha){style={vertexColors:[tl,tr,bl],alpha};gradients.push({tl,tr,bl,br,alpha});},
      fillTriangle(...coords){triangles.push({coords,...style});},beginPath(){current.length=0;},moveTo(x,y){current.push({x,y});},lineTo(x,y){current.push({x,y});},closePath(){},fillPath(){polygons.push([...current]);}};
    const geometry=drawCompanions(g,shape+'-1',{x:20,y:40,r:25},.7,{color:'#b8db8a'}),sat=geometry.satellites[0];
    const boundary=shape==='moon'?[...sat.bands[0].outer,...sat.bands.at(-1).inner.slice().reverse()]:sat.bands.at(-1).outer;
    const filledArea=triangles.reduce((sum,{coords})=>sum+polygonArea([{x:coords[0],y:coords[1]},{x:coords[2],y:coords[3]},{x:coords[4],y:coords[5]}]),0);
    near(filledArea,polygonArea(boundary),1e-6);
    assert.ok(triangles.length<=(type===2?128:768));assert.equal(polygons.length,9);
    assert.ok(triangles.every(t=>t.alpha===.60));assert.ok(!style.vertexColors,'gradient state must not leak to the player/crown');
    if(type===2){
      assert.equal(gradients.length,8);assert.ok(triangles.every(t=>new Set(t.vertexColors).size===2));
      sat.bands.forEach((band,i)=>{
        assert.deepEqual(gradients[i*2],{tl:band.outerColor,tr:band.outerColor,bl:band.innerColor,br:band.innerColor,alpha:.60});
        assert.deepEqual(gradients[i*2+1],{tl:band.outerColor,tr:band.innerColor,bl:band.innerColor,br:band.innerColor,alpha:.60});
      });
    }else{
      assert.equal(gradients.length,0);assert.ok(new Set(triangles.map(t=>t.color)).size>=12,'fallback retains smooth interior shading');
    }
  }
});

test('SVG composites fine opaque body layers under one single-opacity group without alpha buildup',()=>{
  for(const definition of COMPANION_DEFINITIONS){
    const svg=companionSvg(definition.id,{x:50,y:50,r:20},.8,{color:'#e08855',alpha:.5});
    const groups=[...svg.matchAll(/<g opacity="([^"]+)">([\s\S]*?)<\/g>/g)];
    assert.equal(groups.length,definition.count);
    for(const [,opacity,body] of groups){
      near(Number(opacity),.30);assert.equal((body.match(/<path /g)||[]).length,24);
      assert.doesNotMatch(body,/opacity|fill-opacity/,'opaque children cannot compound the original alpha');
      assert.ok(new Set([...body.matchAll(/fill="(#[\da-f]+)"/g)].map(match=>match[1])).size>=20);
    }
    assert.equal((svg.match(/<path /g)||[]).length,definition.count*33);
    assert.doesNotMatch(svg,/<circle|<image|<rect|<filter|NaN|Infinity/);
    assert.ok(svg.length<45000);
    const preview=companionPreview(definition.id,'#e08855');
    assert.match(preview,/viewBox="0 0 100 100"/);assert.match(preview,/<g transform="translate\(/);
    assert.equal(preview,companionPreview(definition.id,'#e08855'));
  }
});

test('empty, hidden or malformed geometry never paints or changes caller data',()=>{
  const pose=Object.freeze({x:8,y:12,r:20,vx:300,vy:20,mass:1}),options=Object.freeze({color:'#123456',alpha:.5});
  const before=JSON.stringify({pose,options});
  companionGeometry('moon-3',pose,7,options);companionSvg('moon-3',pose,7,options);
  assert.equal(JSON.stringify({pose,options}),before);
  assert.equal(companionSvg(null,pose,0),'');assert.equal(companionSvg('sun-1',pose,0,{alpha:0}),'');
  assert.equal(companionSvg('sun-1',{r:NaN},0),'');assert.equal(companionSvg('sun-1',{r:-20},0),'');
  assert.equal(drawCompanions({},null,pose,0).satellites.length,0);
});

const insidePolygon=(p,polygon)=>{
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
};
function assertRearOnly(satellite){
  const {center,direction,boundary}=satellite;
  for(const band of satellite.tail){
    for(const p of band.vertices){
      assert.ok((p.x-center.x)*direction.x+(p.y-center.y)*direction.y<1e-6,'history ahead of the moving body is clipped');
      assert.ok(!insidePolygon(p,boundary)||outlineDistance(p,boundary)<1e-6,'tail vertex lies inside translucent body');
    }
    for(const p of boundary)assert.ok(!insidePolygon(p,band.vertices)||outlineDistance(p,band.vertices)<1e-6,'tail covers a body vertex');
    for(let i=0;i<band.vertices.length;i++)for(let j=0;j<boundary.length;j++){
      assert.equal(crosses(band.vertices[i],band.vertices[(i+1)%band.vertices.length],boundary[j],boundary[(j+1)%boundary.length]),false,'tail crosses through a body edge');
    }
  }
}

test('each companion keeps the same face toward the ball while its body rotates, including deformed polygon orbits',()=>{
  const pose={x:40,y:90,r:20},contour=projectSkinContour(skinContour(6),{...pose,pullAmount:.9,deformAngle:.2,squash:.12});
  for(const shape of ['sun','moon','star']){
    const reference=companionGeometry(shape+'-1',pose,0).satellites[0];
    near(reference.rotation,0);
    for(const time of [.4,.85,1.7,2.55,3.39])for(const options of [{},{contour}]){
      const satellite=companionGeometry(shape+'-1',pose,time,options).satellites[0],c=Math.cos(satellite.rotation),s=Math.sin(satellite.rotation);
      const toward={x:(pose.x-satellite.center.x)/(Math.hypot(pose.x-satellite.center.x,pose.y-satellite.center.y)),y:(pose.y-satellite.center.y)/(Math.hypot(pose.x-satellite.center.x,pose.y-satellite.center.y))};
      near(toward.x*c+toward.y*s,0);near(-toward.x*s+toward.y*c,1);
      satellite.boundary.forEach((p,i)=>{
        const dx=p.x-satellite.center.x,dy=p.y-satellite.center.y,original=reference.boundary[i];
        near(dx*c+dy*s,original.x-reference.center.x);near(-dx*s+dy*c,original.y-reference.center.y);
      });
    }
  }
});

test('gameplay tail stores actual world displacement; its first frame has no synthetic orbit tail',()=>{
  const trails=new CompanionTrails(),initial={x:80,y:90,r:20};
  const first=companionGeometry('moon-1',initial,0,{trails}).satellites[0];
  assert.equal(first.tail.length,0);assert.equal(first.tailPoints.length,1);
  let satellite;
  for(let i=1;i<=24;i++)satellite=companionGeometry('moon-1',{...initial,x:initial.x+i*5,y:initial.y+i*2},i/60,{trails}).satellites[0];
  assert.ok(satellite.tail.length>0);
  near(satellite.tailPoints[0].x,first.center.x);near(satellite.tailPoints[0].y,first.center.y);
  assert.ok(satellite.direction.x>.8&&satellite.direction.y>.1,'translation contributes to actual heading');
  assert.ok(Math.min(...satellite.tail.flatMap(band=>band.vertices.map(p=>p.x)))<satellite.center.x-10);
  assertRearOnly(satellite);
});

test('history freezes at zero elapsed time, preserves same-frame handoffs and resets on discontinuity or unmount',()=>{
  const history=new CompanionTrails(),center={x:10,y:20};
  history.sample('moon-1:0',center,20,0);history.sample('moon-1:0',{x:12,y:21},20,.02);
  const snapshot=JSON.stringify([...history.entries]);
  const paused=history.sample('moon-1:0',{x:12,y:21},20,.02);
  assert.equal(JSON.stringify([...history.entries]),snapshot);assert.ok(paused.length>1);
  const beforeHandoff=paused.map(p=>({...p})),handoff=history.sample('moon-1:0',{x:15,y:21},20,.02);
  assert.equal(handoff.length,beforeHandoff.length,'same-frame Canvas/SVG handoff retains travelled history');
  assert.deepEqual(handoff.slice(0,-1),beforeHandoff.slice(0,-1));
  assert.deepEqual(handoff.at(-1),{x:15,y:21,age:0});
  assert.equal(history.entries.get('moon-1:0').time,.02,'handoff never invents elapsed time');
  assert.equal(history.sample('moon-1:0',{x:12,y:21},20,.5).length,1,'hidden tab gap starts fresh');
  assert.equal(history.sample('moon-1:0',{x:500,y:21},20,.52).length,1,'teleport starts fresh');
  assert.equal(history.sample('moon-1:0',{x:500,y:21},40,.54).length,1,'resize starts fresh');
  assert.equal(history.sample('moon-1:0',{x:500,y:21},40,.1).length,1,'clock reset starts fresh');
  history.sample('sun-1:0',center,20,.1);history.retainIds(['sun-1']);assert.deepEqual([...history.entries.keys()],['sun-1:0']);
  history.retain([]);assert.equal(history.entries.size,0);
  history.sample('star-1:0',center,20,.1);history.clear();assert.equal(history.entries.size,0);
  assert.deepEqual(history.sample('star-1:0',{x:NaN,y:20},20,.1),[]);
});

test('actual movement trails remain rear-clipped through high speed, reversals, curved paths and changing polygon contours',()=>{
  const r=20,paths=[
    t=>({x:80+1200*t,y:120+50*t}),
    t=>({x:80+600*(t<.25?t:.5-t),y:120+80*t}),
    t=>({x:80+30*Math.sin(t*18),y:120+30*Math.cos(t*18)}),
    t=>({x:80+60*Math.sin(t*30),y:120+35*Math.sin(t*48)}),
  ];
  for(const shape of ['sun','moon','star'])for(const movement of paths){
    const trails=new CompanionTrails();
    for(let i=0;i<=36;i++){
      const time=i/60,pose={...movement(time),r};
      const contour=projectSkinContour(skinContour(6),{...pose,roll:time*3,pullAmount:.4+.4*Math.sin(time*20),deformAngle:time*4});
      const geometry=companionGeometry(shape+'-3',pose,time,{trails,contour,inPlay:true,speed:r*40,unit:r});
      geometry.satellites.forEach(assertRearOnly);
    }
  }
});

test('speed growth draws longer real displacement histories, with unchanged menu length and body clipping',()=>{
  for(const shape of ['sun','moon','star']){
    const trails=new CompanionTrails(),r=20,unit=20;
    let pose;
    for(let frame=0;frame<=60;frame++){
      pose={x:80+800*frame/60,y:120+60*frame/60,r};
      companionGeometry(shape+'-1',pose,frame/60,{trails});
    }
    const extent=options=>{
      const satellite=companionGeometry(shape+'-1',pose,1,{trails,...options}).satellites[0];
      assertRearOnly(satellite);
      return Math.max(...satellite.tail.flatMap(band=>band.vertices.map(p=>-(p.x-satellite.center.x)*satellite.direction.x-(p.y-satellite.center.y)*satellite.direction.y)));
    };
    const base=extent({inPlay:true,speed:20*unit,unit}),medium=extent({inPlay:true,speed:30*unit,unit}),full=extent({inPlay:true,speed:40*unit,unit});
    assert.ok(medium>base*1.9);assert.ok(full>medium*1.4);
    near(extent({speed:100*unit,unit}),base);
    near(extent({inPlay:true,speed:100*unit,unit}),full);
  }
});

test('trail reaches the actual rear silhouette instead of stopping at an invisible enclosing circle',()=>{
  for(const shape of ['sun','moon','star'])for(let step=0;step<16;step++){
    const trails=new CompanionTrails(),time=.5,heading=step*Math.PI/8,pose={x:80,y:100,r:20};
    // Arrange an arbitrary incoming path while keeping this frame's orientation.
    const center=companionGeometry(shape+'-1',pose,time).satellites[0].center;
    for(let i=0;i<12;i++)trails.sample(shape+'-1:0',{x:center.x-Math.cos(heading)*(12-i)*2,y:center.y-Math.sin(heading)*(12-i)*2},pose.r,time-(12-i)/120);
    const satellite=companionGeometry(shape+'-1',pose,time,{trails}).satellites[0];
    assert.ok(satellite.tail.length>0);
    const contact=Math.min(...satellite.tail.flatMap(band=>band.vertices.map(p=>outlineDistance(p,satellite.boundary))));
    assert.ok(contact<1e-6,`${shape} tail must touch visible body, distance ${contact}`);
    assertRearOnly(satellite);
  }
});

test('history and tail length are stable across frame rates without an unbounded point buffer',()=>{
  const observations=[];
  for(const fps of [30,60,120]){
    const trails=new CompanionTrails();let geometry;
    for(let i=0;i<=fps;i++)geometry=companionGeometry('sun-1',{x:50+300*i/fps,y:70+40*i/fps,r:20},i/fps,{trails});
    const satellite=geometry.satellites[0],rear=Math.min(...satellite.tail.flatMap(band=>band.vertices.map(p=>(p.x-satellite.center.x)*satellite.direction.x+(p.y-satellite.center.y)*satellite.direction.y)));
    observations.push(rear);
    assert.ok(satellite.tailPoints.length<=96);assert.ok(satellite.tailPoints.every(p=>p.age<=.5));
  }
  assert.ok(Math.max(...observations)-Math.min(...observations)<.15);
});
