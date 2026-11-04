import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {CampaignWorld} from '../dist/campaign.js';
import {campaignTutorialGuide,drawCampaign,drawCampaignBodyDetails,campaignFailureFeedback} from '../dist/campaign-render.js';

const elements=new Map(),events=new Map(),saved=new Map();
function element(key){
  if(elements.has(key))return elements.get(key);
  const classes=new Set(),node={hidden:false,dataset:{},children:[],attributes:{},style:{setProperty(){},removeProperty(){}},
    classList:{add(...n){n.forEach(x=>classes.add(x));},remove(...n){n.forEach(x=>classes.delete(x));},contains:n=>classes.has(n),toggle(n,on){on?classes.add(n):classes.delete(n);}},
    setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},addEventListener(){},replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},
    querySelector:selector=>element(key+' '+selector),getBoundingClientRect:()=>({x:0,y:0,width:390,height:844,left:0,top:0,right:390,bottom:844}),focus(){},firstElementChild:{style:{}},lastElementChild:{style:{}}};
  elements.set(key,node);return node;
}
globalThis.window={innerWidth:390,innerHeight:844,devicePixelRatio:1,addEventListener(){},removeEventListener(){}};
globalThis.localStorage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)};
globalThis.matchMedia=()=>({matches:false});
globalThis.getComputedStyle=()=>({paddingTop:'0',paddingBottom:'0',borderTopWidth:'0',borderBottomWidth:'0',marginBottom:'0'});
globalThis.requestAnimationFrame=fn=>fn();
globalThis.Phaser={AUTO:0,Scale:{NONE:0},Scene:class{constructor(){this.cameras={main:{setBackgroundColor(){}}};}},Game:class{constructor(config){this.scene=new config.scene();}}};
window.Phaser=globalThis.Phaser;
let created=0;
globalThis.document={readyState:'loading',hidden:false,hasFocus:()=>true,documentElement:element('html'),createElement:tag=>element(tag+(created++)),querySelector:element,querySelectorAll:()=>[],addEventListener(type,fn){events.set(type,[...(events.get(type)||[]),fn]);}};
if(!globalThis.navigator)globalThis.navigator={};
const entry=new URL('../dist/game.js',import.meta.url);
const source=(await readFile(entry,'utf8')).replace(/from '(\.\/[^']+)'/g,(_,p)=>`from '${new URL(p,entry).href}'`);
const adapter=`
export function setup(level=1,width=390,height=844){
  boot();scene=game.scene;scene.g={clear(){}};scene.add={text(){return {setOrigin(){return this;},setScale(){return this;},destroy(){}};}};
  viewport=displayMetrics(width,height,1);selectedMode='campaign';currentLevel=level;campaignOffer=null;transfer=null;controlFlight=null;modal=null;paused=false;result=null;feedbackDemo=false;campaignRecorded=false;drag=null;
  campaignProgress=normalizeProgress({version:3,unlocked:100,completed:0});selector=new LevelSelector(width,height,100);screen='levels';
  world=new CampaignWorld(width,height,level);return {world,scene};
}
export function showOffer(){offerCampaign(currentLevel);return campaignOffer;}
export function offerOutcome(outcome){
  world=new CampaignWorld(viewport.width,viewport.height,currentLevel);
  campaignProgress=recordAttempt(campaignProgress,currentLevel,{tutorialKey:world.config.classId,offerChoices:campaignOffer.choices.map(c=>c.id)});
  campaignAttemptId=levelRecord(campaignProgress,currentLevel).activeAttempt;campaignRecorded=false;
  saveCampaignResult(outcome);offerCampaign(currentLevel);return campaignOffer;
}
export function renderHud(){screen='play';updateHud();}
export function useEndless(){world=new World(390,844);world.phase='battle';screen='play';updateHud();return world;}
export function consume(events){world.events=events;scene.handleEvents();return scene;}
export function captureTone(){const tones=[];sound.tone=(...args)=>tones.push(args);return tones;}
export function settleLoss(){
  world=new CampaignWorld(viewport.width,viewport.height,currentLevel);
  campaignProgress=recordAttempt(campaignProgress,currentLevel,{tutorialKey:world.config.classId,offerChoices:campaignOffer.choices.map(c=>c.id)});
  campaignAttemptId=levelRecord(campaignProgress,currentLevel).activeAttempt;campaignRecorded=false;saveCampaignResult('loss');return levelRecord(campaignProgress,currentLevel);
}
export function stored(){return campaignProgress;}
export function showResult(){screen='play';world.completed=true;world._resultRating=3;world.phase='over';presentResult({...world.player},false,[],.65,{player:{...world.player},enemies:[]});}
export function prepare(){prepareGame();return world;}
`;
const app=await import('data:text/javascript;base64,'+Buffer.from(source+adapter).toString('base64'));

test('all five preflight cards explain scoring and both upgrade effects',()=>{
  for(const level of [1,3,5,7,9]){
    app.setup(level);const offer=app.showOffer();
    assert.equal(offer.choices.length,2);
    assert.match(element('#campaign-level-rating').textContent,/三点/);
    assert.match(element('#campaign-level-rating').textContent,/两点/);
    assert.equal((element('#campaign-upgrades').innerHTML.match(/<small>/g)||[]).length,2);
  }
});

test('cancel/reopen and abandon preserve exact offers while actual loss clears persisted offer',()=>{
  app.setup(1);const first=app.showOffer().choices.map(c=>c.id);
  assert.deepEqual(app.showOffer().choices.map(c=>c.id),first);
  assert.deepEqual(app.offerOutcome('abandon').choices.map(c=>c.id),first);
  // Observe real storage before the next offer, which may legitimately redraw
  // the same pair by chance; randomness is not tested by demanding a difference.
  assert.equal(app.stored().levels['1'].abandoned,1);
  assert.equal(app.stored().levels['1'].failStreak,0);
  const failed=app.settleLoss();assert.deepEqual(failed.offerChoices,[]);assert.equal(failed.failStreak,1);
});

test('live campaign HUD has exactly three dots, updates thresholds, and leaves endless ten dots clean',()=>{
  const {world}=app.setup(1);app.renderHud();
  assert.equal((element('#stage-progress').innerHTML.match(/<i /g)||[]).length,3);
  assert.match(element('#stage-progress').attributes['aria-label'],/通关可得 3 点/);
  assert.match(element('#campaign-rating-status').textContent,/建议拉距/);
  world.shotsUsed=world.config.threePointShots+1;app.renderHud();
  assert.match(element('#stage-progress').attributes['aria-label'],/通关可得 2 点/);
  app.useEndless();
  assert.equal((element('#stage-progress').innerHTML.match(/<i /g)||[]).length,10);
  assert.equal(element('#stage-progress').attributes.title,undefined);
  assert.equal(element('#campaign-rating-status').hidden,true);
});

test('tutorial guides stay visible while dragging and use recommended pull distance',()=>{
  for(const level of [1,3,5,7,9]){
    const world=new CampaignWorld(390,844,level,()=>.5,{tutorialSeen:false});
    const guide=campaignTutorialGuide(world,{dragging:true});
    assert.ok(guide.length>=2,`level ${level}`);assert.ok(guide.every(dot=>dot.alpha>=.5));
    const length=Math.hypot(guide.at(-1).x-guide[0].x,guide.at(-1).y-guide[0].y);
    assert.ok(length<=7*world.unit*world.tutorialPullRatio+1e-6);
  }
});

function graphics(){const calls=[];return {calls,g:new Proxy({}, {get(_,method){return(...args)=>calls.push({method,args});}})};}

test('golf obstacles are unfilled player outlines and hard wall bricks keep distinct opacity',()=>{
  const world=new CampaignWorld(390,844,17),{g,calls}=graphics();
  world.zones=[];world.tutorialSeen=true;drawCampaign(g,world,{playerColor:0x112233});
  assert.ok(calls.some(c=>c.method==='lineStyle'&&c.args[1]===0x112233));
  assert.equal(calls.filter(c=>c.method==='fillStyle').length,0);
  const wall=new CampaignWorld(390,844,91);wall.zones=[];wall.tutorialSeen=true;wall.statics=wall.statics.filter(b=>b.hard).slice(0,1);
  assert.equal(wall.statics.length,1);const hard=graphics();drawCampaign(hard.g,wall);
  assert.ok(hard.calls.some(c=>c.method==='fillStyle'&&c.args[1]===.72));
});

test('merge high levels gain 0/1/2 rings without adding endless render calls',()=>{
  const world=new CampaignWorld(390,844,5);
  for(const level of [3,4,5]){const {g,calls}=graphics();drawCampaignBodyDetails(g,world,{kind:'merge-ball',mergeLevel:level,x:40,y:50,r:12});assert.equal(calls.filter(c=>c.method==='strokePath').length,level-3);}
  const {g,calls}=graphics();drawCampaignBodyDetails(g,{mode:'endless'},{kind:'merge-ball',mergeLevel:5,x:40,y:50,r:12});assert.equal(calls.length,0);
});

test('failure cues differ by reason, survive scene feedback reset, and use campaign-only sounds',()=>{
  assert.notEqual(campaignFailureFeedback('budget').frequency,campaignFailureFeedback('coverage').frequency);
  assert.notEqual(campaignFailureFeedback('budget').pulses,campaignFailureFeedback('coverage').pulses);
  app.setup(5);const tones=app.captureTone(),scene=app.consume([{type:'campaignFail',reason:'coverage'}]);
  assert.equal(tones[0][0],120);assert.equal(scene.campaignFailure.reason,'coverage');scene.resetFeedback();assert.equal(scene.campaignFailure.reason,'coverage');
  app.consume([{type:'campaignPocketReject'},{type:'campaignFreeBall'},{type:'campaignLaunchEnd',reason:'timeout'}]);
  assert.ok(tones.some(c=>c[0]===880));assert.ok(tones.some(c=>c[0]===1100));assert.equal(tones.at(-1)[0],180);
});

test('result shows a ten-level chapter recap with the current level identified',()=>{
  app.setup(17);app.showResult();const chapter=element('#campaign-chapter');
  assert.equal(chapter.hidden,false);assert.equal((chapter.innerHTML.match(/class="chapter-cell/g)||[]).length,10);
  assert.match(chapter.innerHTML,/chapter-cell current[^>]+17关/);assert.match(chapter.attributes['aria-label'],/第 2 章/);
});


test('all 100 campaign HUDs stay above the frame at phone widths using the approved font advances',async()=>{
  const css=await readFile(new URL('../dist/style.css',import.meta.url),'utf8');
  assert.match(css,/#hud\.campaign-modern #campaign-goal\{white-space:nowrap;line-height:1\.4\}/);
  assert.match(css,/#campaign-rating-status\{[^}]*white-space:nowrap;[^}]*font-size:10px;line-height:1\.4/);
  const metadata=JSON.parse(await readFile(new URL('../docs/font-subset.json',import.meta.url),'utf8'));
  assert.equal(metadata.source_sha256,'7ccfc2cd0e971edeac7f65516df8db379f0f84d0d8ff79ee4dfe377956418d3b');
  // Measured from the approved ChillRoundF v3.200 hmtx table (1000 units/em).
  // All HUD CJK advance 1em. Subsetting preserves those metrics; explicitly
  // checking the source hash prevents silently using this on a new typeface.
  const advances={'0':.613,'1':.45,'2':.613,'3':.613,'4':.613,'5':.613,'6':.613,'7':.613,'8':.613,'9':.613,'%':.795,'/':.433,' ':.293,'≤':.615,'≥':.615,'·':.5};
  const widthOf=(text,size)=>[...text].reduce((sum,c)=>sum+(advances[c]??(/[\u3400-\u9fff]/u.test(c)?1:NaN))*size,0);
  const reports=[];
  for(const [width,height] of [[320,568],[390,844],[568,320],[844,390]])for(let level=1;level<=100;level++){
    const {world}=app.setup(level,width,height),landscape=height<=520;
    for(const phase of ['tutorial','first-shot','large-numbers']){
      world.shotsUsed=phase==='tutorial'?0:phase==='first-shot'?1:world.budget+99;
      world.poolScratches=phase==='large-numbers'?99:0;world.maxCombo=phase==='large-numbers'?999:0;
      world.mergeElapsed=phase==='large-numbers'?99999.9:48.1;
      if(world.mergeState){world.mergeState.elapsed=world.mergeElapsed;world.mergeState.coverage=.4199;}
      app.renderHud();
      const goal=element('#campaign-goal').textContent,status=element('#campaign-rating-status').textContent;
      const goalSize=landscape?11:12,statusSize=landscape?9:10;
      const goalWidth=widthOf(goal,goalSize),statusWidth=widthOf(status,statusSize);
      const available=landscape?width-110-32:width-54;
      assert.ok(Number.isFinite(goalWidth)&&goalWidth<=available,`${width}x${height} level ${level}: ${goal} ${goalWidth}/${available}`);
      assert.ok(Number.isFinite(statusWidth)&&statusWidth<=available,`${width}x${height} level ${level}: ${status} ${statusWidth}/${available}`);
      // Portrait: 26px padding + 34px top row + 3px gap + 16.8px
      // goal + 7px margin + 7px dots + 5px gap + 14px status = 112.8px.
      // Landscape information is absolutely positioned at 0/20/34px.
      const hudBottom=landscape?34+9*1.3:26+34+3+12*1.4+7+7+5+10*1.4;
      assert.ok(hudBottom<world.arenaBounds.top,`${width}x${height} level ${level} HUD ${hudBottom} reaches frame ${world.arenaBounds.top}`);
      if(world.config.classId==='merge'){
        assert.doesNotMatch(goal,/秒/);assert.match(status,new RegExp(`${Math.ceil(world.mergeElapsed)}秒`));
      }
      reports.push({width,height,level,phase,goal,status,goalSize,statusSize,goalWidth,statusWidth,available,hudBottom,frameTop:world.arenaBounds.top});
    }
  }
  if(process.env.V770_HUD_WIDTH_REPORT)await writeFile(process.env.V770_HUD_WIDTH_REPORT,JSON.stringify(reports));
});
