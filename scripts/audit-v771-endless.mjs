// Reproduce the v7.6.0/endless isolation audit against an unmodified checkout.
// Usage: node scripts/audit-v771-endless.mjs [baseline checkout] [current checkout]
// Both real game entry modules use the SAME baseline DOM/Phaser test adapter.
import {readFile,writeFile,mkdtemp,rm,cp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile), sha=value=>createHash('sha256').update(value).digest('hex');
const baseline=resolve(process.argv[2]||'/tmp/v771-endless-baseline'),current=resolve(process.argv[3]||new URL('..',import.meta.url).pathname);
const baselineCommit='a5c1166010534328a8fa7719018fb15e7c2fa933';
const modules='physics aim aim-metrics feedback rhythm-feedback endless-progress enemies enemy-render upgrades upgrade-render boss-visuals audio home motion skins skin-render skin-unlock comet-trail display photo-renderer wardrobe icons'.split(' ');
const coreModules={};for(const name of modules){const [a,b]=await Promise.all([readFile(join(baseline,'dist',name+'.js')),readFile(join(current,'dist',name+'.js'))]);coreModules[name+'.js']={baselineSha256:sha(a),sha256:sha(b),matchesBaseline:a.equals(b)};}
const fixture=await readFile(join(baseline,'tests/restart.test.mjs'),'utf8');
const prefix=fixture.slice(0,fixture.indexOf("test('public bootstrap"));
const graphics=fixture.slice(fixture.indexOf('function graphicsRecorder(){'),fixture.indexOf("test('entering selection focuses"));
const scenarios=['cold-home','home-drag','home-entry','opening','shoot','slow-aim','rewards','gambler','boss','pressure','pause','resize','ending','record'];
const cases=[];
for(const [width,height]of [[390,844],[844,390]])for(const reduced of [false,true])for(const scenario of scenarios)cases.push({id:`${scenario}-${width}x${height}-${reduced?'reduced':'normal'}`,scenario,width,height,reduced,frames:scenario==='boss'?900:scenario==='opening'?480:300});
for(let i=0;i<10;i++)cases.push({id:'migration-'+i,scenario:'migration',width:390,height:844,reduced:false,frames:4,migration:i});
for(const [width,height]of [[390,844],[844,390]])cases.push({id:`campaign-switch-${width}x${height}`,scenario:'switch',width,height,reduced:false,frames:120});
const temp=await mkdtemp(join(tmpdir(),'v771-endless-audit-'));
const frozenCurrent=join(temp,'current-source');await mkdir(frozenCurrent);
await cp(join(current,'dist'),join(frozenCurrent,'dist'),{recursive:true});await cp(join(current,'package.json'),join(frozenCurrent,'package.json'));
const sharedPaths=['game.js','style.css','index.html','fonts/qiuqiule-ui.woff2'];
const sourceHashes=Object.fromEntries(await Promise.all(sharedPaths.map(async path=>[path,sha(await readFile(join(frozenCurrent,'dist',path)))])));
// Freeze all production imports once: edits during the audit cannot mix versions.
const extraAdapter=`
export function auditAudio(){const calls=[];for(const name of Object.getOwnPropertyNames(Object.getPrototypeOf(sound))){if(name==='constructor'||typeof sound[name]!=='function')continue;const old=sound[name];sound[name]=function(...args){calls.push({name,args});return old.apply(this,args);};}return calls;}
export function auditSwitchToEndless(resetRandom){showHome();for(let f=0;f<90;f++)scene.update(f*1000/60,1000/60);home.mode='endless';syncMode();resetRandom();prepareGame();updateUiBall(1);}
export function auditRead(){return {screen,selectedMode,paused,modal,drag,transfer,uiAnchor,releaseOverlay,result,home,world,runAimHoldDuration,runDay,runBest,runNewRecord,recordPulse,recordCue,scoreFeedback,settings,skins,playerContour};}
`;
const fixed=`
import {writeFile as auditWriteFile} from 'node:fs/promises';
import {createHash as auditCreateHash} from 'node:crypto';
const spec=JSON.parse(process.env.AUDIT_SPEC),auditOut=process.env.AUDIT_OUTPUT;
let auditSeed=0x357719,auditNow=1893456000000;
Math.random=()=>{auditSeed=(Math.imul(auditSeed,1664525)+1013904223)>>>0;return auditSeed/4294967296;};
Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues(array){for(let i=0;i<array.length;i++)array[i]=Math.floor(Math.random()*4294967296);return array;}}});
const AuditDate=Date;globalThis.Date=class extends AuditDate{constructor(...args){super(...(args.length?args:[auditNow]));}static now(){return auditNow;}};
`;
const init=`
window.innerWidth=spec.width;window.innerHeight=spec.height;
globalThis.matchMedia=()=>({matches:spec.reduced});
saved.set('qiuqiule-mode',JSON.stringify('endless'));
saved.set('qiuqiule-settings',JSON.stringify({juice:.6,expressions:true}));
if(spec.scenario==='migration'){
 const completed=spec.migration*10;
 saved.set('qiuqiule-campaign',JSON.stringify({completed,unlocked:completed+1}));
 saved.set('qiuqiule-skins',JSON.stringify({enabled:!!(spec.migration%2),sides:3+spec.migration%8,unlocked:3+spec.migration%8}));
 saved.set('qiuqiule-best',String(spec.migration*100));
}
`;
const run=`
const hash=value=>auditCreateHash('sha256').update(JSON.stringify(value)).digest('hex');
const clean=value=>{const active=new WeakSet();const visit=v=>{if(v===undefined)return '[undefined]';if(typeof v==='function')return undefined;if(typeof v==='number'&&!Number.isFinite(v))return String(v);if(v===null||typeof v!=='object')return v;if(active.has(v))return '[cycle]';active.add(v);let out;if(v instanceof Set)out=[...v].map(visit);else if(v instanceof Map)out=[...v].map(([k,x])=>[visit(k),visit(x)]);else if(Array.isArray(v))out=v.map(visit);else{out={};for(const key of Object.keys(v).sort()){if(typeof v[key]!=='function')out[key]=visit(v[key]);}}active.delete(v);return out;};return visit(value);};
// Retain the baseline shape recorder and additionally capture EVERY graphics
// command, including arc/closePath/transform methods its proxy treats as no-ops.
const rawGraphics=graphicsRecorder(),graphicsCommands=[];
const g=new Proxy(rawGraphics,{get(target,key){const value=target[key];if(typeof value!=='function')return value;return (...args)=>{if(key==='clear')graphicsCommands.length=0;graphicsCommands.push([key,args]);return value.apply(target,args);};}}),audio=app.auditAudio();let scene,world,home,pointer;
if(spec.scenario==='cold-home'){
 await app.startWithFont();const canvas={style:{},addEventListener(){}};({scene,world,home}=app.mountInitialScene(canvas,g));
}else{
 ({scene,world,home}=app.seedRenderer(g,spec.width,spec.height,!['home-drag','home-entry'].includes(spec.scenario)));
 app.setFeedbackStrength(.6);app.setExpressionEnabled(true);
 pointer=inputCanvas(spec.width,spec.height);
}
if(spec.scenario==='migration'){app.prepareNormalGame();({scene,world,home}=app.readRestart());}
if(spec.scenario==='switch'){
 app.seedCampaignRenderer(g,spec.width,spec.height,1);({scene}=app.readRestart());
 // Cross the real home/mode/start boundaries; begin comparison only after the
 // campaign has been left. RNG is reset so this checks residual-state isolation.
 for(let f=0;f<30;f++)scene.update(f*1000/60,1000/60);
 app.auditSwitchToEndless(()=>{auditSeed=0x113377;});({scene,world}=app.readRestart());audio.length=0;
}
if(['shoot','slow-aim','pressure','pause','resize','ending','record'].includes(spec.scenario)){
 world.spawnTimer=Infinity;world.floorTimer=Infinity;world.wave=null;world.introTimer=Infinity;world.fragmentQueue=[];
}
if(spec.scenario==='home-entry')app.enterFromHome();
if(spec.scenario==='opening')world.beginStartingUpgrades();
if(['rewards','gambler'].includes(spec.scenario)){world.gamblerRewardPending=spec.scenario==='gambler';world.beginUpgrade();}
if(spec.scenario==='boss'){world.stage=10;world.stageKills=world.killTarget;}
if(spec.scenario==='pressure'){
 world.enemies=[];Object.assign(world.player,{x:spec.width/2,y:spec.height-60,vx:0,vy:0});
 for(let i=0;i<26;i++){const b=world.makeBody(45+i%7*(spec.width-90)/6,80+Math.floor(i/7)*(spec.height-180)/4,world.unit*.5,.8);Object.assign(b,{hp:10000,maxHp:10000,born:1,solid:true,vx:0,vy:0});world.enemies.push(b);}
}
if(spec.scenario==='record')app.seedEndless({best:5},{date:'2030-01-01'});
if(spec.scenario==='ending'){
 app.seedEndless({best:1000});Object.assign(world,{score:460,maxCombo:7,maxStage:12,shotHistory:[{time:world.feedbackTime,hits:0}]});Object.assign(world.player,{vx:world.unit*5,vy:-world.unit});world.endRun('capacity');
}
if(spec.scenario==='resize')app.mountSceneBoundary(pointer.canvas,g);
const hudSelectors=['#hud','#score','#best','#stage','#progress','#slow-meter','#choice-labels','#result-peak','#result-records','#result-reason','#over-ball','#pause-ball','#ui-ball','#ui-ball .ui-eyes','#ui-ball .ui-result-crown','#modal-layer','#home-mode','#home-play'];
const nodeView=e=>({text:e.textContent,html:e.innerHTML,hidden:e.hidden,inert:e.inert,className:e.className,attributes:e.attributes,style:e.style,children:e.children.map(c=>({text:c.textContent,html:c.innerHTML,className:c.className,style:c.style,hidden:c.hidden}))});
const sceneKeys=['effects','accumulator','timeSlices','clock','inputClock','frameStamp','timeScale','hitSoundAt','wallFlashes','impactGhosts','zoomPulse','upgradeCue','feedbackCamera','blinkUntil','rescueUntil','firstTypeUntil','ending','pressureWarning','cometTrails','trailPhase'];
const rows=[],phases=new Set();let calls=0,maxShapes=0;let chosen=0;
const coverage={launchCalls:0,minTimeScale:1,maxPressureAlpha:0,maxChoices:0,pausedFrames:0,endingFrames:0,resultFrames:0,newRecordFrames:0,widths:[],mode:null};const seenWidths=new Set();
for(let f=0;f<spec.frames;f++){
 auditNow=1893456000000+f*1000/60;
 const w=app.readRestart().world,p=w?.player;
 if(spec.scenario==='home-drag'){
  if(f===10)pointer('pointerdown',home.player.x,home.player.y);
  if(f>=10&&f<45)pointer('pointermove',home.player.x+45,home.player.y+60);
  if(f===45)pointer('pointerup',home.player.x+45,home.player.y+60);
 }
 if(spec.scenario==='shoot'&&[10,150].includes(f)){const target=w.enemies[0];if(target){const dx=target.x-p.x,dy=target.y-p.y,d=Math.hypot(dx,dy);pointer('pointerdown',p.x,p.y);pointer('pointermove',p.x-dx/d*w.maxPull,p.y-dy/d*w.maxPull);pointer('pointerup',p.x-dx/d*w.maxPull,p.y-dy/d*w.maxPull);}}
 if(spec.scenario==='slow-aim'){
  if(f===10)pointer('pointerdown',p.x,p.y);if(f>=10&&f<190)pointer('pointermove',p.x+65,p.y+50);if(f===190)pointer('pointerup',p.x+65,p.y+50);
 }
 if(['opening','rewards','gambler','boss'].includes(spec.scenario)&&w?.phase==='choose'&&chosen<(spec.scenario==='boss'?2:1)){
  const c=w.choices.find(c=>c.id!=='growth')||w.choices[0];Object.assign(p,{x:c.x,y:c.y,vx:0,vy:0,feedbackFreeze:0});chosen++;
 }
 if(spec.scenario==='boss'&&w.phase==='boss'&&f%4===0)w.damageBoss(w.baseSpeed);
 if(spec.scenario==='pressure'&&f===140)w.beginUpgrade();
 if(spec.scenario==='pause'){
  if(f===60)clickAction('pause');if(f===100)clickAction('resume');if(f===170){document.hidden=true;for(const fn of listeners.get('visibilitychange')||[])fn();}if(f===190){document.hidden=false;for(const fn of listeners.get('visibilitychange')||[])fn();}if(f===220)clickAction('resume');
 }
 if(spec.scenario==='resize'&&[90,180].includes(f)){[window.innerWidth,window.innerHeight]=[window.innerHeight,window.innerWidth];for(const fn of windowListeners.get('resize')||[])fn();}
 if(spec.scenario==='record'&&[20,70,120].includes(f)){const e=w.enemies.find(e=>e.hp>0);if(e)w.damage(e,e.hp+1);}
 scene.update(f*1000/60,1000/60);
 const state=app.auditRead();phases.add(state.world?.phase||state.screen);
 const sceneState=Object.fromEntries(sceneKeys.map(key=>[key,scene[key]]));
 const data={state:clean({...state,scene:sceneState}),graphics:clean({commands:graphicsCommands,shapes:g.shapes,borders:g.borders,lines:g.lines,labels:(scene.testLabels||[]).filter(l=>!l.destroyed)}),audio:clean(audio.splice(0)),hud:clean(Object.fromEntries(hudSelectors.map(s=>[s,nodeView(element(s))])))};
 calls+=data.audio.length;maxShapes=Math.max(maxShapes,g.shapes.length);
 coverage.launchCalls+=data.audio.filter(c=>c.name==='launch').length;coverage.minTimeScale=Math.min(coverage.minTimeScale,scene.timeScale);coverage.maxPressureAlpha=Math.max(coverage.maxPressureAlpha,scene.pressureWarning.alpha);coverage.maxChoices=Math.max(coverage.maxChoices,state.world?.choices.length||0);coverage.pausedFrames+=state.paused?1:0;coverage.endingFrames+=scene.ending?1:0;coverage.resultFrames+=state.modal==='over'?1:0;coverage.newRecordFrames+=state.runNewRecord?1:0;if(state.world){seenWidths.add(state.world.width);coverage.mode=state.world.mode||'endless';}
 rows.push(Object.fromEntries(Object.entries(data).map(([k,v])=>[k,hash(v)])));
 if(Number(process.env.AUDIT_DUMP_FRAME)===f)await auditWriteFile(auditOut+'.frame',JSON.stringify(data));
}
coverage.widths=[...seenWidths];coverage.chosen=chosen;
const checks={
 'cold-home':phases.has('home'),
 'home-drag':phases.has('home')&&calls>0,
 'home-entry':phases.has('entering')&&phases.has('choose'),
 opening:phases.has('reward')&&phases.has('battle')&&chosen===1,
 shoot:coverage.launchCalls>0,
 'slow-aim':coverage.minTimeScale<1&&coverage.launchCalls>0,
 rewards:chosen===1&&phases.has('battle'),
 gambler:coverage.maxChoices===5&&chosen===1&&phases.has('battle'),
 boss:chosen===2&&phases.has('boss-entry')&&phases.has('boss-celebrate')&&phases.has('battle'),
 pressure:coverage.maxPressureAlpha>0&&scene.pressureWarning.alpha===0,
 pause:coverage.pausedFrames>0&&!app.auditRead().paused,
 resize:coverage.widths.length===2,
 ending:coverage.endingFrames>0&&coverage.resultFrames>0,
 record:coverage.newRecordFrames>0,
 migration:coverage.mode==='endless',
 switch:coverage.mode==='endless',
};
await auditWriteFile(auditOut,JSON.stringify({id:spec.id,frames:rows,phases:[...phases],audioCalls:calls,maxShapes,coverage,coveragePassed:checks[spec.scenario]}));
`;
function workerText(root){let text=prefix.replace(/from '(\.\.\/[^']+)'/g,(_,p)=>`from '${pathToFileURL(resolve(root,'tests',p)).href}'`).replaceAll('import.meta.url',JSON.stringify(pathToFileURL(join(root,'tests/restart.test.mjs')).href));text=fixed+text;text=text.replace("const entry=new URL",init+'\nconst entry=new URL');text=text.replace("const app=await import",'const auditExtraAdapter='+JSON.stringify(extraAdapter)+';\nconst app=await import').replace('Buffer.from(source+adapter)','Buffer.from(source+adapter+auditExtraAdapter)');return text+graphics+run;}
const workers={};for(const [kind,root]of [['baseline',baseline],['current',frozenCurrent]]){workers[kind]=join(temp,kind+'.mjs');await writeFile(workers[kind],workerText(root));}
async function execute(kind,spec,dumpFrame){const out=join(temp,kind+'-'+spec.id+'.json');await exec(process.execPath,[workers[kind]],{env:{...process.env,AUDIT_SPEC:JSON.stringify(spec),AUDIT_OUTPUT:out,AUDIT_DUMP_FRAME:dumpFrame===undefined?'none':String(dumpFrame)},maxBuffer:1000000});return {out,result:JSON.parse(await readFile(out,'utf8'))};}
function firstDifference(a,b,path=''){if(JSON.stringify(a)===JSON.stringify(b))return null;if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return {path,baseline:a,current:b};for(const key of new Set([...Object.keys(a),...Object.keys(b)])){const found=firstDifference(a[key],b[key],path+'.'+key);if(found)return found;}return {path,baseline:a,current:b};}
const results=[];let next=0;
async function queue(){while(next<cases.length){const spec=cases[next++];const [a,b]=await Promise.all([execute('baseline',spec),execute('current',spec)]);let mismatch=null;for(let f=0;f<spec.frames;f++)for(const channel of ['state','graphics','audio','hud'])if(a.result.frames[f][channel]!==b.result.frames[f][channel]&&!mismatch)mismatch={frame:f,channel};if(mismatch){await Promise.all([execute('baseline',spec,mismatch.frame),execute('current',spec,mismatch.frame)]);const [aa,bb]=await Promise.all([readFile(a.out+'.frame','utf8'),readFile(b.out+'.frame','utf8')]);mismatch.difference=firstDifference(JSON.parse(aa)[mismatch.channel],JSON.parse(bb)[mismatch.channel]);}const row={...spec,passed:!mismatch&&a.result.coveragePassed&&b.result.coveragePassed,coveragePassed:a.result.coveragePassed&&b.result.coveragePassed,coverage:a.result.coverage,phases:a.result.phases,audioCalls:a.result.audioCalls,maxShapes:a.result.maxShapes,baselineTraceSha256:sha(JSON.stringify(a.result.frames)),currentTraceSha256:sha(JSON.stringify(b.result.frames)),...(mismatch?{mismatch}:{})};results.push(row);process.stdout.write((row.passed?'PASS ':'FAIL ')+spec.id+(mismatch?' '+mismatch.channel+' frame '+mismatch.frame:'')+'\n');}}
try{await Promise.all([queue(),queue(),queue(),queue()]);results.sort((a,b)=>cases.findIndex(c=>c.id===a.id)-cases.findIndex(c=>c.id===b.id));const report={baseline:baselineCommit,checkedAt:new Date().toISOString(),method:'Real Scene.update and production World; identical v7.6.0 restart DOM/Phaser adapter in isolated child processes over frozen production source; fixed Math.random, crypto.getRandomValues and Date; scenario activity assertions; exact SHA-256 of every frame state/all graphics commands plus shape summaries/audio/HUD; no source-string equivalence claims.',command:'node scripts/audit-v771-endless.mjs /tmp/v771-endless-baseline .',harnessSha256:sha(prefix+graphics),coreModules,sceneCases:56,sceneFrames:results.filter(r=>!['migration','switch'].includes(r.scenario)).reduce((n,r)=>n+r.frames,0),migrationCases:10,migrationFrames:40,switchCases:2,switchFrames:240,switchWarmupPerCase:{campaignFrames:30,homeFrames:90},totalCases:results.length,totalFrames:results.reduce((n,r)=>n+r.frames,0),sharedFileHashes:sourceHashes,cases:results,passed:Object.values(coreModules).every(m=>m.matchesBaseline)&&results.every(r=>r.passed)};report.sourceUnchangedDuringAudit=true;for(const path of sharedPaths)if(sourceHashes[path]!==sha(await readFile(join(current,'dist',path))))report.sourceUnchangedDuringAudit=false;report.passed=report.passed&&report.sourceUnchangedDuringAudit;await writeFile(join(current,'docs/V7.7.1-ENDLESS-ISOLATION.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,cases:report.totalCases,frames:report.totalFrames,failures:results.filter(r=>!r.passed).map(r=>({id:r.id,...r.mismatch}))}));if(!report.passed)process.exitCode=1;}finally{if(!process.env.AUDIT_KEEP_TEMP)await rm(temp,{recursive:true,force:true});else console.log(temp);}
