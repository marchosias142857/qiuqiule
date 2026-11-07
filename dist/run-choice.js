import {World, REWARD_TIMING, length} from './physics.js';

export const RUN_CHOICE_TIMING=Object.freeze({...REWARD_TIMING,rest:.4});
export const RUN_CHOICES=Object.freeze([
  Object.freeze({id:'new-run',name:'新的一局',icon:'restart',color:0xe88c72}),
  Object.freeze({id:'continue-run',name:'继续上局',icon:'continue',color:0xa9c575})
]);

// A disposable menu world. It shares reward placement, shooting and collisions,
// but has no connection to the paused run, its RNG or its progression.
export class RunChoiceWorld extends World {
  constructor(width,height,{from}={}){
    super(width,height,()=>.5,{spawnInitial:false});
    this.isRunChoice=true;
    this.selectedRunChoice=null;
    this.phase='transition';this.phaseTime=0;
    this.spawnTimer=this.floorTimer=this.introTimer=Infinity;
    const p=this.player;
    for(const key of ['x','y','angle','squash'])if(Number.isFinite(from?.[key]))p[key]=from[key];
    p.born=1;p.solid=true;this.clampBodyToArena(p);
    this.rollFrom={x:p.x,y:p.y,time:0,end:this.rewardTiming.move};
    this.rewardShapeFrom={angle:p.angle,squash:p.squash};
    this.choices=RUN_CHOICES.map(choice=>({...choice,runChoice:true,x:0,y:0,r:this.unit*2,born:0}));
    this.layoutChoices();
  }
  get rewardTiming(){return RUN_CHOICE_TIMING;}
  resize(width,height){
    super.resize(width,height);
    // Rotation can place a stationary player inside a newly laid-out choice.
    // Never let that geometry change silently choose to discard an old run.
    const p=this.player;
    if(this.phase==='choose'&&this.choices.some(c=>Math.hypot(p.x-c.x,p.y-c.y)<p.r+c.r+4)){
      Object.assign(p,{x:width/2,y:this.choicePlayerY,vx:0,vy:0,pendingVx:0,pendingVy:0});
      this.cancelPull();
    }
  }
  choose(choice){
    if(this.phase!=='choose'||this.selectedRunChoice||!this.choices.includes(choice))return false;
    const body={...choice,vx:0,vy:0,hp:0,born:1};
    const feedback={...this.impactFeedback(body,0),feedbackLevel:1,
      power:length(this.player)/this.baseSpeed,bodySnapshot:{...body}};
    this.selectedRunChoice=choice.id;this.cancelPull();
    this.phase='reward';this.phaseTime=0;this.rewardArenaFrom=0;this.choices=[];
    this.emit('runChoice',{choiceId:choice.id,choice:{...choice},x:body.x,y:body.y,r:body.r,vx:0,vy:0,...feedback});
    return true;
  }
  finishRewardRound(){
    if(this.phase!=='reward'||!this.selectedRunChoice)return;
    this.phase='run-choice-done';this.phaseTime=0;this.cancelPull();
    this.emit('runChoiceReady',{choiceId:this.selectedRunChoice});
  }
  advance(dt,dragging,timeScale=1){
    if(this.phase==='run-choice-done')return;
    super.advance(dt,dragging,timeScale);
  }
  step(dt,dragging=false,options={}){
    if(this.phase==='run-choice-done')return;
    super.step(dt,dragging,options);
  }
}
