import {particleVisualStyle} from './particle-appearance.js';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
export const STAR_TRAIL_STATE_VERSION=1;
export const STAR_TRAIL_UNLOCK_STEP=5;
export const STAR_TRAIL_DEFINITIONS=Object.freeze([
  ['triangle','三角星',['triangle']],['square','四方星',['square']],['diamond','菱星',['diamond']],
  ['snowflake','雪星',['snowflake']],['triple','三连星',['triangle','square','diamond']],
  ['sun','日',['sun']],['moon','月',['moon']],['galaxy','日月星',['sun','moon','star']],
  ['star','群星',['star']],
].map(([id,label,shapes],index)=>Object.freeze({id,label,name:label,shapes:Object.freeze(shapes),stage:(index+1)*STAR_TRAIL_UNLOCK_STEP})));
const definitions=new Map(STAR_TRAIL_DEFINITIONS.map(item=>[item.id,item]));
const empty=Object.freeze([]);
export const starTrailShapes=id=>definitions.get(id)?.shapes||empty;
/** The caller supplies its cosmetic random sample; gameplay RNG is untouched. */
export function resolveStarTrailShape(id,randomNumber=0){
  const shapes=starTrailShapes(id);if(!shapes.length)return null;
  const index=Math.min(shapes.length-1,Math.floor(clamp(finite(randomNumber),0,1)*shapes.length));
  return shapes[index];
}

function object(raw){
  if(typeof raw==='string'){try{raw=JSON.parse(raw);}catch{return {};}}
  return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
}
function stageCount(stage){
  if(typeof stage!=='number'&&typeof stage!=='string')return 0;
  const value=Number(stage);
  return Number.isFinite(value)?clamp(Math.floor(value/STAR_TRAIL_UNLOCK_STEP),0,9):0;
}
export function normalizeStarTrailState(raw,{highestStage=0}={}){
  const saved=object(raw),owned=clamp(Math.floor(finite(saved.unlocked)),0,9);
  const unlocked=Math.max(owned,stageCount(highestStage));
  const index=STAR_TRAIL_DEFINITIONS.findIndex(item=>item.id===saved.selected);
  const pending=new Set(Array.isArray(saved.pendingUnlocks)?saved.pendingUnlocks:[]);
  for(let i=owned;i<unlocked;i++)pending.add(STAR_TRAIL_DEFINITIONS[i].id);
  const pendingUnlocks=STAR_TRAIL_DEFINITIONS.slice(0,unlocked).filter(item=>pending.has(item.id)).map(item=>item.id);
  return {version:STAR_TRAIL_STATE_VERSION,unlocked,selected:index>=0&&index<unlocked?saved.selected:null,pendingUnlocks};
}
export function unlockStarTrails(raw,highestStage){
  const before=normalizeStarTrailState(raw),state=normalizeStarTrailState(before,{highestStage});
  return {state,newlyUnlocked:STAR_TRAIL_DEFINITIONS.slice(before.unlocked,state.unlocked).map(item=>item.id)};
}
export function acknowledgeStarTrailUnlock(raw,id){
  const state=normalizeStarTrailState(raw);
  return {...state,pendingUnlocks:state.pendingUnlocks.filter(pending=>pending!==id)};
}
export function selectStarTrail(raw,id){
  const state=normalizeStarTrailState(raw);
  if(id===null)return {...state,selected:null};
  const index=STAR_TRAIL_DEFINITIONS.findIndex(item=>item.id===id);
  if(index<0||index>=state.unlocked)return state;
  return {...state,selected:state.selected===id?null:id};
}

const numeric=value=>Number(finite(value).toFixed(4));
const ink=value=>typeof value==='string'&&/^#[\da-f]{6}$/i.test(value)?value:
  '#'+clamp(Math.round(finite(value,0x252720)),0,0xffffff).toString(16).padStart(6,'0');
function path(shape,x,y,r,rotation=0){
  const style=particleVisualStyle(shape),points=style.points,scale=r*style.sizeScale;
  const c=Math.cos(rotation)*scale,s=Math.sin(rotation)*scale;let d='';
  for(let i=0;i<points.length;i+=2)d+=(i?'L':'M')+numeric(x+points[i]*c-points[i+1]*s)+' '+numeric(y+points[i]*s+points[i+1]*c);
  return d+'Z';
}

/** A stable three-particle sample makes mixed cosmetics clear before equipping. */
export function starTrailPreview(id,color='#252720'){
  const shapes=starTrailShapes(id);if(!shapes.length)return '<svg viewBox="0 0 100 100" aria-hidden="true"></svg>';
  const positions=[[25,67,10,.2],[49,56,11.5,-.12],[75,63,12,.13]];
  return '<svg viewBox="0 0 100 100" aria-hidden="true" stroke="none">'+positions.map(([x,y,r,angle],i)=>{
    const shape=shapes[i%shapes.length],alpha=(.58+i*.15)*particleVisualStyle(shape).alphaScale;
    return `<path data-shape="${shape}" d="${path(shape,x,y,r*.85,angle)}" fill="${ink(color)}" opacity="${numeric(alpha)}"/>`;
  }).join('')+'</svg>';
}

const svgNamespace='http://www.w3.org/2000/svg';
function child(parent,index,tag){
  if(parent.children[index])return parent.children[index];
  const node=(parent.ownerDocument||document).createElementNS(svgNamespace,tag);parent.append(node);return node;
}
function attr(node,name,value){const text=String(value);if(node.getAttribute(name)!==text)node.setAttribute(name,text);}
function trim(parent,count){while(parent.children.length>count)parent.removeChild(parent.children[parent.children.length-1]);}

/** A showroom sample only: no orbit, emitter, gameplay RNG or saved particles.
 * The existing traveling-player transition supplies pose and layer weights. */
export function paintStarTrailSvg(host,layers,pose,time=0,{color='#252720',reducedMotion=false,compact=false}={}){
  if(!layers?.length||!pose||!(pose.r>0)){trim(host,0);return;}
  const svg=child(host,0,'svg'),r=pose.r;attr(svg,'viewBox',`0 0 ${r*4} ${r*4}`);attr(svg,'aria-hidden','true');
  let drawn=0;
  for(const layer of layers){
    const shapes=starTrailShapes(layer.id),weight=clamp(finite(layer.weight,1),0,1);if(!shapes.length||!weight)continue;
    for(let i=0;i<3;i++){
      const shape=shapes[i%shapes.length],node=child(svg,drawn++,'path');
      const x=pose.x-r*(1.55+i*(compact?.7:1.15)),y=pose.y+r*([.05,-.14,.20][i]);
      const angle=[.12,-.15,.19][i]+(reducedMotion?0:Math.sin(finite(time)*.75+i)*.10);
      attr(node,'data-shape',shape);attr(node,'d',path(shape,x,y,r*(.37-i*.02),angle));
      attr(node,'fill',ink(layer.color??color));attr(node,'opacity',numeric(weight*(.65-i*.12)*particleVisualStyle(shape).alphaScale));
    }
  }
  trim(svg,drawn);trim(host,1);
}
