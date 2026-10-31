// Capture-only adapter, appended to a disposable copy of game.js by render.mjs.
// Uses the shipped World, renderer, menus and transitions without gameplay changes.
let trailerTime=0, trailerPull=null, trailerMode='home', trailerFirstStep=false;
const trailerSounds=[];
sound.tone=(...args)=>trailerSounds.push({time:trailerTime,args});
sound.unlock=()=>{};
window.trailer={
  ready:()=>!!scene&&!!game,
  init(){
    game.loop.stop();game.hasFocus=true;game.isPaused=false;
    document.documentElement.dataset.inputMode='pointer';
    document.hasFocus=()=>true;
    settings.expressions=true;settings.haptic=false;settings.sound=false;applyTheme();
    home=new HomeWorld(viewport.width,viewport.height);homeReveal=1;
    scene.clock=0;scene.effects=[];
  },
  restore(fixture){
    startGame();
    let state=fixture.randomState;
    const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
    world=Object.assign(Object.create(World.prototype),structuredClone(fixture.world),{random});
    world.player.hp=Infinity;world.events=[];
    scene.clock=world.time;scene.accumulator=0;scene.effects=[];
    trailerPull=fixture.pull?{...fixture.pull}:null;
    drag=trailerPull?{id:1,x:world.player.x,y:world.player.y,dx:trailerPull.dx,dy:trailerPull.dy}:null;
    trailerFirstStep=true;trailerMode='battle';lastScore=-1;lastPhase='';updateHud();
  },
  homeDrag(power){
    const p=home.player;drag={id:1,x:p.x,y:p.y,dx:0,dy:-home.maxPull*power};
  },
  homeRelease(){if(drag){home.shoot(drag.dx,drag.dy);drag=null;}},
  select(){trailerMode='choose';},
  settings(){showHome();trailerMode='settings';},
  openSettings(){openSettings();},
  theme(name){Object.assign(settings,palettes[name]);applyTheme();},
  close(){closePanel();},
  step(time,delta){
    trailerTime=time/1000;
    if(world&&['battle','choose'].includes(trailerMode)){
      if(!trailerFirstStep){
        if(!trailerPull&&world.ready&&((world.phase==='battle'&&trailerMode==='battle')||world.phase==='choose'&&trailerMode==='choose')){
          const target=world.phase==='choose'?world.choices.find(c=>c.id==='energy'):
            world.enemies.filter(b=>b.solid).sort((a,b)=>Math.hypot(a.x-world.player.x,a.y-world.player.y)-Math.hypot(b.x-world.player.x,b.y-world.player.y))[0];
          if(target&&world.beginPull()){
            const dx=world.player.x-target.x,dy=world.player.y-target.y,d=Math.hypot(dx,dy);
            trailerPull={dx:dx/d*world.maxPull,dy:dy/d*world.maxPull,age:0};
          }
        }
        if(trailerPull){
          trailerPull.age+=delta/1000;
          if(trailerPull.age>=.6){world.shoot(trailerPull.dx,trailerPull.dy);trailerPull=null;drag=null;}
        }
      }
      trailerFirstStep=false;
      if(trailerPull)drag={id:1,x:world.player.x,y:world.player.y,dx:trailerPull.dx,dy:trailerPull.dy};
      if(!['battle','choose'].includes(world.phase)){trailerPull=null;drag=null;}
    }
    game.step(time,delta);
    document.activeElement?.blur();
    for(const anim of document.getAnimations()){anim.pause();anim.currentTime=time;}
    return {screen,modal,phase:world?.phase,score:world?.score,stage:world?.stage,energy:world?.energy,
      pull:drag?{x:drag.x+drag.dx,y:drag.y+drag.dy}:null};
  },
  sounds:()=>trailerSounds
};
