import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {skinContour} from '../dist/skins.js';
import {projectSkinContour,fitCrownToSkin} from '../dist/skin-render.js';
import {bigEyeGeometry} from '../dist/big-eye.js';
import {crownOutline} from '../dist/boss-visuals.js';
import {resultBounce,transferPose} from '../dist/motion.js';

const [html,css,game]=await Promise.all(['index.html','style.css','game.js'].map(name=>readFile(new URL('../dist/'+name,import.meta.url),'utf8')));
const overlay=html.match(/<div id="ui-ball"[\s\S]*?<\/div>/)[0];
const layers=[...overlay.matchAll(/<svg class="([^"]+)" viewBox="([^"]+)">([\s\S]*?)<\/svg>/g)]
  .map(([,name,box,content])=>({name,box:box.split(/\s+/).map(Number),content}));
const rasterRule=css.match(/#ui-ball svg\.ui-ball-raster\{([^}]+)\}/)[1];
const rasterStyle=Object.fromEntries(rasterRule.split(';').filter(Boolean).map(pair=>pair.split(':')));
const outline=skinContour(0);
const inside=(point,[x,y,w,h])=>point.x>x&&point.x<x+w&&point.y>y&&point.y<y+h;
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('body raster padding preserves the original face viewport, origin and appearance paint order',()=>{
  assert.equal(layers.length,3);
  assert.match(layers[0].content,/class="ui-body"/);assert.match(layers[0].content,/class="ui-pull-outline"/);
  assert.match(layers[1].content,/class="ui-eyes"/);assert.deepEqual(layers[1].box,[0,0,100,100]);
  assert.match(layers[2].content,/class="ui-big-eye"/);assert.match(layers[2].content,/class="ui-result-crown"/);
  assert.equal(css.match(/#ui-ball \.ui-eyes\{([^}]+)\}/)[1],'fill:var(--face,#f4f3eb);transform-origin:50px 50px');
  assert.match(game,/el\.style\.width=el\.style\.height=p\.r\*2\+'px'/,'the traveling wrapper keeps its original diameter');
  assert.match(game,/translate3d\(\$\{p\.x-p\.r\}px,\$\{p\.y-p\.r\}px,0\)/);
});

test('deformed return, bounce, full pull and crown geometry fits inside actual body raster surfaces',()=>{
  let exceededOldBounds=0;
  const from={x:282,y:646,r:35},to={x:195,y:646,r:38};
  const poses=Array.from({length:121},(_,i)=>transferPose(from,to,i/120));
  poses.push(...Array.from({length:181},(_,i)=>resultBounce(to,i/120)));
  for(const angle of [0,.7,Math.PI/2,Math.PI,4.1])for(let i=0;i<=60;i++){
    const p=transferPose({...from,visualPull:{amount:1,angle}},to,i/60);
    poses.push({...p,pullAmount:p.visualPull.amount,deformAngle:p.visualPull.angle});
  }
  for(const p of poses){
    const pose={...p,x:50,y:50,r:50},points=projectSkinContour(outline,pose),eye=bigEyeGeometry(outline,pose);
    assert.ok(points.every(point=>inside(point,layers[0].box)));
    assert.ok(eye.outline.every(point=>inside(point,layers[2].box)));
    for(const sign of [-1,1])assert.ok(inside({x:eye.eye.x+sign*eye.eye.r,y:eye.eye.y+sign*eye.eye.r},layers[2].box));
    exceededOldBounds+=points.filter(point=>!inside(point,[0,0,100,100])).length;
  }
  const crown=fitCrownToSkin(crownOutline(),outline).map(p=>({x:50+p.x*35,y:50+(-1+(p.y+1)*.7)*50}));
  assert.ok(crown.every(point=>inside(point,layers[2].box)));
  assert.ok(exceededOldBounds>100,'sampled deformations really exceed the old tight body viewport');
});

test('padding leaves every body and eye point at the same screen position as v11.2.0',()=>{
  const width=parseFloat(rasterStyle.width)/100,height=parseFloat(rasterStyle.height)/100;
  const left=parseFloat(rasterStyle.left)/100,top=parseFloat(rasterStyle.top)/100;
  function screen(point,pose,box,{width=1,height=1,left=0,top=0}={}){
    const d=pose.r*2;
    const x=left*d+(point.x-box[0])/box[2]*width*d-d/2;
    const y=top*d+(point.y-box[1])/box[3]*height*d-d/2;
    return {x:pose.x+x*(1-pose.squash),y:pose.y+y*(1+pose.squash*.7)};
  }
  for(const r of [14,35,38,72])for(const squash of [-.15,0,.12,.24])for(const angle of [0,.4,Math.PI/2,Math.PI,5.2]){
    const pose={x:195,y:647,r,squash},points=projectSkinContour(outline,{x:50,y:50,r:50,squash,roll:angle});
    // The exact original eye viewport and origin are used, including rotating
    // and gazing points; no transform is moved to the padded raster layers.
    const eyes=[41.5,58.5].map(x=>({x:50+(x-50)*Math.cos(angle)+3.5*Math.sin(angle),y:50+(x-50)*Math.sin(angle)-3.5*Math.cos(angle)}));
    for(const point of points){
      const before=screen(point,pose,[0,0,100,100]);
      const after=screen(point,pose,layers[0].box,{width,height,left,top});
      close(after.x,before.x);close(after.y,before.y);
    }
    for(const point of eyes){
      const before=screen(point,pose,[0,0,100,100]),after=screen(point,pose,layers[1].box);
      close(after.x,before.x);close(after.y,before.y);
    }
  }
});
