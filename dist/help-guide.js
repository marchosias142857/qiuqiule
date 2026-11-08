import {enemyTransferMarkup,enemyDetailColor} from './enemy-render.js';
import {bossHornOutline,bossAngryEyeOutline} from './boss-visuals.js';

// Player-facing reference copy stays separate from reward and owned-upgrade data.
export const HELP_UPGRADE_DESCRIPTIONS = Object.freeze({
  energy: '提高弹射能量，叠到4层后，可获得“超速”。',
  overspeed: '提高弹射速度上限，让小球弹得更快。',
  density: '增加质量，让撞击更有力；同样拉伸不会降低弹射速度。',
  rubber: '减少撞击造成的速度损失，更容易接续连击。',
  growth: '小球变大，伤害也随之提高。',
  magnet: '击杀后，把附近敌球拉向行进路线，帮助接上下一击。',
  pierce: '普通战斗中，撞击敌球后仍沿原方向前进，并减少掉速。',
  pulse: '重击会震伤并推开附近的敌球。',
  bank: '撞墙或重球可以积攒力量，提高下一击的伤害，最多积攒两次。',
  gravity: '持续把附近敌球缓缓吸向自己，对固定的魔王球无效。',
  breath: '击杀后暂时放慢敌球刷新，连续击杀可延长效果。',
  split: '每发首次击杀后，分出两颗小球继续攻击。',
  penetration: '每发首次击杀时补回出手速度，已经更快则保持。',
  boomerang: '撞墙后获得短暂加速。',
  shockwave: '同一发每累计两次撞墙，释放一次范围冲击波。',
  gambler: '下一阶段击杀目标增加50%，完成后额外获得一轮强化选择。',
  frenzy: '敌球更多、刷新更快，连击得分上限提高；超过6连击后逐步增加伤害，重复选择会同时增强收益与压力。',
});


const helpEnemyTypes = new Set(['ring','heavy','split','walker','leader','magnet','shield']);
const guideViewBox = '-29 -29 58 58';
const guideColor = color => '#'+color.toString(16).padStart(6,'0');
const coordinate = value => String(Math.round(value*1000)/1000);
const guidePath = points => points.map((point,index)=>
  `${index?'L':'M'}${coordinate(point.x*20)} ${coordinate(point.y*20)}`).join(' ')+' Z';

// Use the battle silhouettes at a settled pose; these pictures allocate no
// animation loop, canvas texture or separate downloaded image asset.
export function helpEnemyMarkup(type,color){
  if(helpEnemyTypes.has(type)){
    const body={enemyType:type,x:0,y:0,r:20,born:1,angle:0,squash:0,shield:type==='shield'};
    return enemyTransferMarkup(body,color,{unit:20})
      .replace('class="enemy-transfer"','class="help-enemy-art" focusable="false"')
      .replace(/viewBox="[^"]*"/,`viewBox="${guideViewBox}"`)
      .replace(' style="overflow:visible"','')
      .replace(/-?\d+\.\d+/g,value=>coordinate(Number(value)));
  }
  if(type!=='boss')return '';
  const fill=guideColor(color),face=guideColor(enemyDetailColor(color));
  const horns=[-1,1].map(side=>`<path d="${guidePath(bossHornOutline(side,1))}"/>`).join('');
  const eyes=[-1,1].map(side=>{
    const points=bossAngryEyeOutline(side,1,1).map(point=>({
      x:side*.29+(point.x-side*.29)*1.2,y:-.08+(point.y+.08)*1.2
    }));
    return `<path d="${guidePath(points)}"/>`;
  }).join('');
  return `<svg class="help-enemy-art" viewBox="${guideViewBox}" aria-hidden="true" focusable="false"><g fill="${fill}">${horns}<circle r="20"/></g><g fill="${face}">${eyes}</g></svg>`;
}
