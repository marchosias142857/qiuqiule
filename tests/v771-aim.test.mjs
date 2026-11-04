import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld, campaignUpgradePool} from '../dist/campaign.js';
import {World} from '../dist/physics.js';
import {staticContact, resolveDynamic} from '../dist/campaign-collision.js';
import {campaignAimContact, campaignAimGuide, campaignTravelEstimate, drawCampaignAim} from '../dist/campaign-aim.js';

const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} / ${b}`);
const fresh=(level=1)=>new CampaignWorld(390,844,level,()=>.5);
const fixture=()=>({player:{r:10},arenaBounds:{left:0,right:1000,top:0,bottom:1000},statics:[],enemies:[]});

test('guide finds expanded circles and rounded rectangle faces and corners at real contact',()=>{
  for(const shape of [{shape:'circle',x:200,y:200,r:25},{shape:'rect',x:200,y:200,width:80,height:50,cornerRadius:10},
    {shape:'rect',x:200,y:200,width:80,height:50,cornerRadius:0}]) {
    for(const origin of [{x:60,y:200},{x:90,y:70},{x:200,y:60},{x:340,y:280}]) {
      const w=fixture();w.statics=[shape];const len=Math.hypot(200-origin.x,200-origin.y),d={x:(200-origin.x)/len,y:(200-origin.y)/len};
      const hit=campaignAimContact(w,origin,d,600);assert.equal(hit.body,shape);
      assert.equal(staticContact({x:hit.at.x-d.x*.001,y:hit.at.y-d.y*.001,r:10},shape),null);
      assert.ok(staticContact({x:hit.at.x+d.x*.001,y:hit.at.y+d.y*.001,r:10},shape));
      near(Math.hypot(hit.nx,hit.ny),1);
    }
  }
  const w=fixture();w.statics=[{shape:'rect',x:200,y:200,width:80,height:50,cornerRadius:15}];
  assert.equal(campaignAimContact(w,{x:150,y:164.99},{x:1,y:0},80).kind,'end','rounded corner near miss stays a miss');
});

test('pool uses a tangent ghost cue plus distinct target and cue directions',()=>{
  const w=fresh(3),target=w.enemies[0];w.buffs.rubber=true;w.statics=[];w.enemies=[target];
  Object.assign(w.player,{x:100,y:500});Object.assign(target,{x:200,y:510});
  const guide=campaignAimGuide(w,{dx:-w.maxPull,dy:0});
  assert.equal(guide.hit.body,target);assert.equal(guide.rings[0].role,'ghost');
  near(Math.hypot(guide.rings[0].x-target.x,guide.rings[0].y-target.y),w.player.r+target.r);
  const out=guide.segments.find(s=>s.role==='target'),cue=guide.segments.find(s=>s.role==='cue');assert.ok(out&&cue);
  const a={x:out.to.x-out.from.x,y:out.to.y-out.from.y},b={x:cue.to.x-cue.from.x,y:cue.to.y-cue.from.y};
  near(a.x*b.x+a.y*b.y,0,1e-5);assert.equal(guide.arrow,null);
});

test('touching bodies and walls are first contacts when launching inward, but allow outward launches',()=>{
  const w=fixture(),body={shape:'circle',x:200,y:200,r:25};w.enemies=[body];
  assert.equal(campaignAimContact(w,{x:165,y:200},{x:1,y:0},500).body,body);
  assert.equal(campaignAimContact(w,{x:165,y:200},{x:-1,y:0},500).kind,'wall');
  w.enemies=[];w.statics=[{shape:'rect',x:200,y:200,width:80,height:50,cornerRadius:10}];
  assert.equal(campaignAimContact(w,{x:150,y:200},{x:1,y:0},500).t,0);
  assert.equal(campaignAimContact(w,{x:10,y:200},{x:-1,y:0},500).t,0);
});

test('pool cue branch follows real mass and restitution after a single collision',()=>{
  for(const upgradeId of ['density','rubber','bank'])for(const offset of [0,10]){
    const w=new CampaignWorld(390,844,3,()=>.5,{upgradeId}),target=w.enemies[0];w.enemies=[target];
    Object.assign(w.player,{x:100,y:500});Object.assign(target,{x:200,y:500+offset});
    const guide=campaignAimGuide(w,{dx:-w.maxPull,dy:0}),cue=guide.segments.find(s=>s.role==='cue');
    const a={...w.player,x:guide.hit.at.x+.0001,vx:100,vy:0},b={...target,vx:0,vy:0};
    resolveDynamic(a,b,{restitution:upgradeId==='rubber'?1:.95});
    if(Math.hypot(a.vx,a.vy)>1.5){assert.ok(cue,upgradeId);const d={x:cue.to.x-cue.from.x,y:cue.to.y-cue.from.y},l=Math.hypot(d.x,d.y),s=Math.hypot(a.vx,a.vy);near(d.x/l,a.vx/s,.001);near(d.y/l,a.vy/s,.001);}
  }
});

test('full golf pulls show the real first wall rather than a false capped stopping ring',()=>{
  const w=fresh(7);w.statics=[];Object.assign(w.player,{x:195,y:800});
  const guide=campaignAimGuide(w,{dx:0,dy:w.maxPull});
  assert.equal(guide.hit.kind,'wall');near(guide.hit.at.y,w.arenaBounds.top+w.player.r);
  assert.equal(guide.rings.some(r=>r.role==='range'),false);
});

test('golf distance increases with pull and agrees with actual unobstructed stopping distance',()=>{
  for(const power of [.08,.16,.24]) {
    const w=fresh(7);w.statics=[];w.zones=[];w.rules.isWon=()=>false;w.rules.isLost=()=>false;
    Object.assign(w.player,{x:195,y:700});w.setFeedbackOptions({strength:0});
    const estimate=campaignTravelEstimate(w,power),guide=campaignAimGuide(w,{dx:0,dy:w.maxPull*power});
    const before=w.player.y;w.shoot(0,w.maxPull*power);
    for(let i=0;i<700&&w.shotActive;i++)w.step(1/120);
    near(before-w.player.y,estimate,1.5);near(guide.hit.t,estimate);
  }
  const w=fresh(7);assert.ok(campaignTravelEstimate(w,.4)>campaignTravelEstimate(w,.2));
});

test('peggle piercing previews a forward continuation; ordinary hits reflect',()=>{
  const w=fresh(9),peg=w.statics[0];w.statics=[peg];Object.assign(w.player,{x:195,y:600});Object.assign(peg,{x:195,y:400});
  const drag={dx:0,dy:w.maxPull};const ordinary=campaignAimGuide(w,drag);
  assert.equal(ordinary.hit.body,peg);assert.ok(ordinary.segments.some(s=>s.role==='rebound'&&s.to.y>s.from.y));
  w.buffs.pierce=true;const piercing=campaignAimGuide(w,drag);
  assert.ok(piercing.segments.some(s=>s.role==='pierce'&&s.to.y<s.from.y));
});

test('all hundred levels and offers draw finite bounded guides without advancing or mutating the world',()=>{
  for(const [width,height] of [[320,568],[844,390]])for(let level=1;level<=100;level++)for(const {id}of campaignUpgradePool(level)){
    let rng=0;const w=new CampaignWorld(width,height,level,()=>{rng++;return .5;},{upgradeId:id});
    const target=w.teachingTarget,angle=Math.atan2(target.y-w.player.y,target.x-w.player.x),drag={dx:-Math.cos(angle)*w.maxPull,dy:-Math.sin(angle)*w.maxPull};
    const before=JSON.stringify(w),calls=rng,guide=campaignAimGuide(w,drag),b=w.arenaBounds;
    assert.equal(JSON.stringify(w),before);assert.equal(rng,calls);assert.ok(guide.segments.length>0);
    for(const s of guide.segments)for(const p of [s.from,s.to]){
      assert.ok(Number.isFinite(p.x+p.y));assert.ok(p.x>=b.left-1e-4&&p.x<=b.right+1e-4&&p.y>=b.top-1e-4&&p.y<=b.bottom+1e-4,`${level} ${id}`);
    }
    assert.ok(guide.rings.every(r=>Number.isFinite(r.x+r.y+r.r)));assert.equal(guide.arrow,null);
  }
});

test('endless and reward selection keep their existing guide with no campaign drawing',()=>{
  const commands=[],g=new Proxy({},{get:(_,method)=>(...args)=>commands.push([method,...args])});
  for(const w of [new World(390,844),Object.assign(fresh(),{isCampaignOffer:true})]){
    assert.deepEqual(drawCampaignAim(g,w,{dx:80,dy:80}).segments,[]);assert.deepEqual(commands,[]);
  }
  drawCampaignAim(g,fresh(),{dx:0,dy:100});assert.ok(commands.length>0);assert.ok(commands.some(c=>c[0]==='arc'));
});
