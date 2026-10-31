import {World} from '../dist/physics.js';

export function randomSource(seed){
  let state=seed;
  const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
  random.state=()=>state;
  return random;
}
export function generateFixtures(width=468,height=686){
  for(let seed=1;seed<=30;seed++){
    const random=randomSource(seed),world=new World(width,height,random),frames=[];
    let pull=null;
    for(let frame=0;frame<3600;frame++){
      if(!pull&&world.ready&&world.phase==='battle'){
        const target=world.enemies.filter(b=>b.solid).sort((a,b)=>Math.hypot(a.x-world.player.x,a.y-world.player.y)-Math.hypot(b.x-world.player.x,b.y-world.player.y))[0];
        if(target&&world.beginPull()){
          const dx=world.player.x-target.x,dy=world.player.y-target.y,d=Math.hypot(dx,dy);
          pull={dx:dx/d*world.maxPull,dy:dy/d*world.maxPull,age:0};
        }
      }
      if(pull){pull.age+=1/30;if(pull.age>=.6){world.shoot(pull.dx,pull.dy);pull=null;}}
      frames.push({world:JSON.parse(JSON.stringify(world)),randomState:random.state(),pull:pull?{...pull}:null});
      for(let n=0;n<4;n++)world.step(1/120,!!pull);
      world.events=[];
      if(world.phase==='transition'){
        const start=Math.max(0,frame-180);
        return {seed,startFrame:start,upgradeFrame:frame,battle:frames[start],beforeUpgrade:frames[Math.max(0,frame-26)],score:world.score};
      }
      if(world.phase==='over')break;
    }
  }
  throw new Error('Could not find a completed real gameplay run');
}
if(import.meta.url===new URL(process.argv[1],'file:').href){
  const result=generateFixtures();console.log(JSON.stringify({seed:result.seed,start:result.startFrame,upgrade:result.upgradeFrame,score:result.score}));
}
