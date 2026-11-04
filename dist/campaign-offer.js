import {World, REWARD_TIMING, clamp, lerp} from './physics.js';

const smooth = value => { const t=clamp(value,0,1);return t*t*(3-2*t); };
const smoother = value => { const t=clamp(value,0,1);return t*t*t*(10+t*(-15+6*t)); };

// A disposable selection arena. Its campaign identity prevents endless stats,
// enemy spawning, upgrade stacks and progression from ever being touched.
export class CampaignOfferWorld extends World {
  constructor(width,height,config,offers) {
    super(width,height,()=>.5,{spawnInitial:false});
    this.mode='campaign';
    this.isCampaignOffer=true;this.level=config.level;this.config={...config,implemented:false};
    this.offers=offers.map(offer=>({...offer}));this.selectedUpgrade=null;
    this.spawnTimer=this.floorTimer=this.introTimer=Infinity;
    this.phase='transition';this.phaseTime=0;this.rewardShapeFrom={angle:this.player.angle,squash:this.player.squash};
    this.choices=this.offers.map(offer=>({...offer,x:0,y:0,r:this.unit*2,born:0}));
    this.layoutChoices();this.player.y=this.choicePlayerY;
    this.rollFrom={x:this.player.x,y:this.player.y,time:0,end:this.rewardTiming.move};
    this.emit('upgrade',{campaignOffer:true});
  }
  get rewardTiming(){return REWARD_TIMING;}
  get rewardMoveProgress(){return smoother(this.phaseTime/this.rewardTiming.move);}
  get combatActive(){return false;}
  get ready(){return this.phase==='choose'&&super.ready;}
  get presentationAlpha(){
    if(this.phase==='offer-complete')return 0;
    if(this.phase==='offer-exit')return this.exitAlpha*(1-smooth(this.phaseTime/.22));
    if(['reward','offer-complete'].includes(this.phase))return 1-smooth(this.phaseTime/this.rewardTiming.rest);
    return smooth(this.phaseTime/.3)*(this.phase==='transition'?1:0)+(this.phase==='choose'?1:0);
  }
  layoutChoices(){
    const compact=this.height<520,top=compact?92:Math.max(154,this.height*.2);
    return super.layoutChoices({top,bottom:Math.max(top+70,this.height*(compact?.57:.57))});
  }
  applyUpgrade(id){
    if(this.selectedUpgrade||!this.offers.some(offer=>offer.id===id))return false;
    this.selectedUpgrade=id;return true;
  }
  choose(choice){
    // The shared collision loop is the sole caller that can reach selection.
    if(this.phase!=='choose'||!this.choices.includes(choice)||Math.hypot(this.player.x-choice.x,this.player.y-choice.y)>=this.player.r+choice.r)return false;
    const choices=this.choices;
    this.captureDeparturePose();
    if(!super.choose(choice))return false;
    choice.selected=true;this.choices=choices;
    return true;
  }
  finishRewardRound(){
    this.choices=[];this.phase='offer-complete';this.emit('campaignOfferComplete',{upgradeId:this.selectedUpgrade});
  }
  launchTo(id){
    const choice=this.choices.find(offer=>offer.id===id);
    if(!choice||!this.ready)return false;
    const dx=this.player.x-choice.x,dy=this.player.y-choice.y,distance=Math.hypot(dx,dy);
    return distance>0&&this.shoot(dx/distance*this.maxPull,dy/distance*this.maxPull);
  }
  captureDeparturePose(){
    for(const choice of this.choices)choice.departureBob=this.phase==='choose'&&!this.feedbackOptions.reducedMotion
      ?Math.sin(this.phaseTime*2+choice.x)*2*smooth(this.phaseTime/.4)
      :this.phase==='reward'?(choice.departureBob||0)*(1-smooth(this.phaseTime/.22)):0;
  }
  leave(target='levels'){
    if(this.phase==='offer-exit'||this.phase==='offer-complete')return false;
    this.exitAlpha=this.presentationAlpha;this.captureDeparturePose();
    this.exitRoll=this.player.roll??(this.phase==='transition'?Math.PI*2*this.rewardMoveProgress:0);
    this.player.roll=this.exitRoll;
    this.cancelPull();this.phase='offer-exit';this.phaseTime=0;this.exitTarget=target;
    for(const choice of this.choices)choice.exitBorn=choice.born;
    return true;
  }
  step(dt,dragging=false,options={}){
    if(this.phase==='offer-complete')return;
    if(this.phase==='offer-exit'){
      this.phaseTime+=dt;this.feedbackTime+=dt;
      this.advanceBodies(dt,false);
      const brake=Math.exp(-dt*14);this.player.vx*=brake;this.player.vy*=brake;
      this.player.roll=lerp(this.exitRoll,Math.round(this.exitRoll/(Math.PI*2))*Math.PI*2,smooth(this.phaseTime/.22));
      for(const choice of this.choices)choice.born=(choice.exitBorn??1)*(1-smooth(this.phaseTime/.22));
      if(this.phaseTime>=.22){this.phase='offer-complete';this.emit('campaignOfferExit',{target:this.exitTarget});}
      return;
    }
    super.step(dt,dragging,options);
  }
  advance(dt,dragging,timeScale=1){
    const before=this.phase;
    super.advance(dt,dragging,timeScale);
    if(before==='transition'){
      const duration=(this.rollFrom.end??this.rewardTiming.move)-(this.rollFrom.time||0);
      const t=smoother(duration>0?(this.phaseTime-(this.rollFrom.time||0))/duration:1);
      this.player.x=lerp(this.rollFrom.x,this.width*.5,t);
      this.player.y=lerp(this.rollFrom.y,this.choicePlayerY,t);
      this.player.angle=lerp(this.rewardShapeFrom.angle,.4,smoother(this.phaseTime/.2));
      if(this.phase==='choose'){this.player.x=this.width*.5;this.player.y=this.choicePlayerY;this.player.squash=0;}
    }
    if(this.phase==='reward')for(const choice of this.choices)choice.born=1-smooth(this.phaseTime/.22);
  }
}
