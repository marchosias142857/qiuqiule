import {levelConfig} from './campaign.js';
import {levelRecord} from './campaign-progress.js';
import {iconMarkup} from './icons.js';

const orbIcon=type=>iconMarkup(type).replace('<svg ','<svg x="-1" y="-1" width="2" height="2" ');
const lockedContents='<circle r="1" fill="#b6bdb0"/>'+orbIcon('lock');
const returnContents='<circle r="1" fill="#91b8c7"/>'+orbIcon('home');

function orbNode(){
  return document.createElementNS('http://www.w3.org/2000/svg','g');
}

function positionOrb(node,ball){
  const transform=`translate(${ball.x} ${ball.y}) scale(${ball.r*(ball.sx||1)} ${ball.r*(ball.sy||1)})`;
  if(node.getAttribute('transform')!==transform)node.setAttribute('transform',transform);
}

function unlockedContents(entry,record,number){
  const {level}=entry;
  const dots=record.rating?Array.from({length:3},(_,i)=>
    `<circle cx="${(i-1)*.19}" cy=".64" r=".045" fill="currentColor" opacity="${i<record.rating?1:.25}"/>`).join(''):'';
  const marker=record.rating===3?'<circle r=".91" fill="none" stroke="currentColor" stroke-width=".018"/>':'';
  const hard=entry.hard?'<circle r=".85" fill="none" stroke="currentColor" stroke-opacity=".45" stroke-width=".035"/>':'';
  const legacy=entry.legacy?'<text y=".65" style="text-anchor:middle" font-size=".19">旧版</text>':'';
  const skipped=record.skipped&&!record.cleared?'<path d="M-.13 .65h.26m-.09-.08 .09 .08-.09 .08" stroke="currentColor" stroke-width=".03" fill="none"/>':'';
  return `<circle r="1" fill="#9b89c5"/><text x="${number.x}" y="${number.y}" font-size="${number.size}">${level}</text>${dots}${marker}${hard}${legacy}${skipped}`;
}

function refreshOrb(entry,unlocked,progress,progressChanged,numberPosition,fontChanged){
  if(!unlocked){
    if(entry.unlocked!==false)entry.node.innerHTML=lockedContents;
    entry.unlocked=false;
    return;
  }
  if(entry.unlocked&&!progressChanged&&!fontChanged)return;
  const record=levelRecord(progress,entry.level);
  const hasSkip=record.skipped&&!record.cleared;
  const changedShape=!entry.unlocked || !!record.rating!==!!entry.rating ||
    (record.rating===3)!==(entry.rating===3) || hasSkip!==entry.hasSkip;
  if(changedShape){
    if(entry.hard===undefined){
      const config=levelConfig(entry.level);
      entry.hard=config.implemented&&config.k>=6;entry.legacy=!config.implemented;
    }
    entry.node.innerHTML=unlockedContents(entry,record,numberPosition(entry.level));
  }else{
    if(record.rating!==entry.rating){
      entry.node.querySelectorAll('circle[opacity]').forEach((dot,i)=>dot.setAttribute('opacity',i<record.rating?'1':'0.25'));
    }
    if(fontChanged){
      const label=entry.node.querySelector('text'),{x,y}=numberPosition(entry.level);
      label.setAttribute('x',x);label.setAttribute('y',y);
    }
  }
  entry.unlocked=true;entry.rating=record.rating;entry.hasSkip=hasSkip;
}

/** Retains only the orbs on the clipped arc. Scrolling keeps overlapping
 * levels and only mounts or retires the ones crossing its endpoints. */
export class LevelOrbView{
  constructor(orbs,returnGroup){
    this.orbs=orbs;
    this.entries=new Map();
    this.home=orbNode();
    this.home.innerHTML=returnContents;
    returnGroup.append(this.home);
  }
  render(balls,returnBall,progress,numberPosition,fontRevision){
    const progressChanged=this.progress!==progress,fontChanged=this.fontRevision!==fontRevision;
    const first=balls[0]?.level,last=balls.at(-1)?.level;
    for(const [level,entry] of this.entries){
      if(first===undefined||level<first||level>last){
        entry.node.remove();this.entries.delete(level);
      }
    }
    for(let i=0;i<balls.length;i++){
      const ball=balls[i];
      let entry=this.entries.get(ball.level);
      if(!entry){
        entry={level:ball.level,node:orbNode()};
        this.entries.set(ball.level,entry);
        this.orbs.insertBefore(entry.node,this.orbs.children[i]||null);
      }
      refreshOrb(entry,ball.unlocked,progress,progressChanged,numberPosition,fontChanged);
      positionOrb(entry.node,ball);
    }
    positionOrb(this.home,returnBall);
    this.progress=progress;this.fontRevision=fontRevision;
  }
}
