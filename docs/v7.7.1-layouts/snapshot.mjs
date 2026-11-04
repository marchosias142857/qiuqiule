// Rebuild from the current public constructor, without moving or editing bodies.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CampaignWorld} from '../../dist/campaign.js';
import {golfRoute} from '../../dist/classes/golf.js';

const fields = ['id','kind','shape','x','y','r','width','height','cornerRadius','target','hp','mergeLevel','moving','active'];
const body = b => Object.fromEntries(fields.filter(k => b[k] !== undefined).map(k => [k,b[k]]));
const snapshots=[];
for(let level=1;level<=100;level++){
  const w=new CampaignWorld(390,844,level,()=>.5);
  snapshots.push({level,mode:w.config.type,name:w.config.name,layoutId:w.config.layoutId,
    layoutName:w.config.layoutName,width:w.width,height:w.height,unit:w.unit,bounds:w.arenaBounds,
    player:body(w.player),statics:w.statics.map(body),enemies:w.enemies.map(body),zones:w.zones.map(body),
    ports:w.mergePorts||[],tutorial:w.teachingTarget,route:w.config.type==='golf'?golfRoute(w):null,
    budget:w.budget,goal:w.config.targetMax||w.config.targetPegs||w.config.targetBalls||w.config.brickCount||null});
}
writeFileSync(new URL('./snapshot.json',import.meta.url),JSON.stringify(snapshots,null,2)+'\n');
const sources=['campaign.js','campaign-layout.js',...['wall','pool','merge','golf','peggle'].flatMap(name=>[`classes/${name}.js`,`classes/${name}-levels.js`])];
const hashes=Object.fromEntries(sources.map(path=>[path,createHash('sha256').update(readFileSync(new URL(`../../dist/${path}`,import.meta.url))).digest('hex')]));
writeFileSync(new URL('./source-hashes.json',import.meta.url),JSON.stringify(hashes,null,2)+'\n');
console.log(`Captured ${snapshots.length} fresh 390 × 844 CampaignWorld layouts.`);
