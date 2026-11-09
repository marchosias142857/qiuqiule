// Test-only scene builders, concatenated into the entry-module harness.
// This file is never imported by or shipped with the game runtime.
// A link-only acceptance playground. It uses real World collisions and never
// saves its score or progression; the normal home screen has no extra controls.
function installFeedbackDemo(){
  if($('#feedback-demo'))return;
  const panel=document.createElement('section');panel.id='feedback-demo';panel.className='feedback-demo';
  panel.setAttribute('aria-label','打击反馈试玩');
  panel.innerHTML='<div class="demo-title">打击反馈试玩 <span>选择场景，可继续拖拽弹射</span></div><div class="demo-actions"><button data-demo="steer">高速转向</button><button data-demo="light">轻击</button><button data-demo="medium">普通命中</button><button data-demo="heavy">重击</button><button data-demo="kill">击杀</button><button data-demo="multi">连续击杀</button><button data-demo="reward">连锁清场</button><button data-demo="rescue">压力保命</button><button data-demo="danger">危险宽限</button><button data-demo="boss">Boss</button><button data-demo="home">返回游戏</button><button data-demo="all-demos">试玩菜单</button></div><div class="volume-row"><div><label for="demo-strength">反馈强度</label><output id="demo-value">60%</output></div><input id="demo-strength" type="range" min="0" max="100" step="10" value="60" aria-label="试玩反馈强度"></div>';
  const typeOptions=['ring','heavy','split','walker','magnet','shield','leader'].map(type=>`<option value="${type}">${ENEMY_TYPES[type].name}</option>`).join('');
  panel.innerHTML+=`<div class="demo-enemy"><label for="demo-enemy-type">敌球类型</label><select id="demo-enemy-type">${typeOptions}</select><button type="button" data-demo="enemy-type">试玩敌球</button></div>`;
  const upgradeOptions=UPGRADE_DEFINITIONS.map(upgrade=>`<option value="upgrade-${upgrade.id}">${upgrade.name}</option>`).join('');
  panel.innerHTML+=`<div class="demo-enemy"><label for="demo-upgrade-type">强化试玩</label><select id="demo-upgrade-type"><option value="choices-3">奖励三选一</option><option value="choices-double">连续两轮三选一</option>${upgradeOptions}</select><button type="button" data-demo="upgrade-type">试玩强化</button></div>`;
  panel.innerHTML+='<div class="demo-enemy demo-endless"><label for="demo-endless-type">无尽进程</label><select id="demo-endless-type"><option value="boss-inflation">方场膨胀Boss</option><option value="boss-rewards">Boss末杀与双重奖励</option><option value="ending">结局镜头</option><option value="starting-1">一次起步强化</option><option value="all-demos">全部试玩场景</option></select><button type="button" data-demo="endless-type">试玩进程</button></div>';
  document.body.append(panel);
  const slider=panel.querySelector('#demo-strength'),output=panel.querySelector('#demo-value');
  slider.value=Math.round(settings.juice*100);output.value=slider.value+'%';slider.style.setProperty('--volume',output.value);
  slider.addEventListener('input',()=>{
    settings.juice=feedbackStrength(Number(slider.value)/100);output.value=slider.value+'%';slider.style.setProperty('--volume',output.value);
    syncFeedbackSettings();storage.write('qiuqiule-settings',settings);
  });
  panel.addEventListener('click',event=>{
    let kind=event.target.closest('[data-demo]')?.dataset.demo;if(!kind)return;
    if(kind==='home'){panel.hidden=true;feedbackDemo=false;showHome();return;}
    if(kind==='enemy-type')kind='type-'+panel.querySelector('#demo-enemy-type').value;
    if(kind==='upgrade-type')kind=panel.querySelector('#demo-upgrade-type').value;
    if(kind==='endless-type')kind=panel.querySelector('#demo-endless-type').value;
    if(kind==='all-demos'){panel.classList.remove('demo-flow','demo-compact');return;}
    startFeedbackDemo(kind);
  });
}
function startFeedbackDemo(kind){
  unlockAudio();hidePanel();prepareGame({demo:true});
  feedbackDemo=true;paused=false;world.enemies=[];world.events=[];world.spawnTimer=Infinity;world.floorTimer=Infinity;world.introTimer=Infinity;world.wave=null;
  const hints={steer:'球在飞行时也能拖拽；轻点不会发射',reward:'最后一杀引发碎裂波，清场后选择强化',rescue:'触顶后有0.8秒宽限，本局首次自动清除三个名额，同族子球一并清除',danger:'保命已用完；新球出现触顶后，及时击杀可以挽回'};
  const type=kind.startsWith('type-')?kind.slice(5):null;
  const typeHints={ring:'空心环很轻；试着将它弹开',heavy:'重球更难推动；碰撞时注意反弹',split:'击碎后分成三颗子球，可继续清理',walker:'游走球会持续移动；拖拽瞄准它',magnet:'靠近磁球会被吸引，击碎后邻球散开',shield:'第一击破盾，之后才能伤到球体',leader:'周围球向簇长聚拢，击碎后散开'};
  const hint=$('#feedback-demo .demo-title span');if(hint)hint.textContent=typeHints[type]||hints[kind]||'选择场景，可继续拖拽弹射';
  const p=world.player,u=world.unit;
  $('#feedback-demo')?.classList.toggle('demo-flow',kind==='boss'||kind.startsWith('boss-')||kind==='ending'||kind.startsWith('starting-'));
  $('#feedback-demo')?.classList.toggle('demo-compact',kind==='choices-double'||kind==='upgrade-gambler');
  p.x=viewport.width*.24;p.y=viewport.height*.46;p.vx=p.vy=0;p.born=1;p.solid=true;
  if(kind==='boss'||kind.startsWith('boss-')||kind==='ending'||kind.startsWith('starting-')){startEndlessDemo(kind);return;}
  if(kind.startsWith('upgrade-')||kind.startsWith('choices-')){startUpgradeDemo(kind);return;}
  const add=(x,y,hp=19,density=.8,r=u*.85)=>{
    const b=world.makeBody(x,y,r,density);Object.assign(b,{hp,maxHp:hp,born:1,solid:true,vx:0,vy:0});world.enemies.push(b);return b;
  };
  const middle=viewport.width*.52;
  if(type&&ENEMY_TYPES[type]?.spawnable){
    world.stage=ENEMY_TYPES[type].stage;world.stageKills=0;
    const panel=$('#feedback-demo'),rect=panel&&!panel.hidden?panel.getBoundingClientRect():null,bounds=world.arenaBounds;
    const bottom=rect?.height>0&&rect.top>bounds.top?Math.min(bounds.bottom,rect.top):bounds.bottom;
    const top=Math.min(bounds.top+u*5,bottom-u*5),middleY=clamp(lerp(top,bottom-u*2,.5),bounds.top+u*3,bottom-u*2);
    p.x=bounds.left+bounds.width*.25;p.y=middleY;
    const targetX=type==='magnet'?p.x+u*3:bounds.left+bounds.width*.65;
    const place=(enemyType,x,y)=>{
      const enemy=world.spawnEnemy(null,enemyType);
      if(enemy)Object.assign(enemy,{x,y,born:1,solid:true,...(enemyType==='walker'?{}:{vx:0,vy:0})});
      return enemy;
    };
    const target=place(type,targetX,middleY);
    if(type==='magnet'){
      if(bottom-bounds.top<u*7)place('normal',targetX+u*2.5,middleY);
      else place('normal',targetX,Math.max(bounds.top+u*1.3,middleY-u*2.5));
    }
    if(type==='leader'&&target){
      let positions;
      if(bottom-bounds.top<u*9){
        const left=bounds.left+u*1.2,right=bounds.right-u*1.2;
        p.x=left;target.x=lerp(left,right,.5);
        positions=[.25,.75,1].map(t=>({x:lerp(left,right,t),y:middleY}));
      }else positions=[-Math.PI/2,0,Math.PI/2].map(turn=>({x:target.x+Math.cos(turn)*u*2.5,y:target.y+Math.sin(turn)*u*2.5}));
      for(const point of positions){
        const neighbour=place('normal',point.x,point.y);
        if(neighbour)neighbour.clusterId=target.clusterId;
      }
    }
    if(!['walker','magnet','leader'].includes(type))world.shoot(-world.maxPull*(['ring','heavy'].includes(type)?.65:1),0);
    updateHud();return;
  }
  if(kind==='rescue'||kind==='danger'){
    const panel=$('#feedback-demo'),rect=panel&&!panel.hidden?panel.getBoundingClientRect():null;
    const bounds=world.arenaBounds,gap=Math.max(4,u*.35);
    const bottom=rect?.height>0&&rect.top>bounds.top?Math.min(bounds.bottom,rect.top):bounds.bottom;
    p.x=viewport.width*.5;p.y=bottom-p.r*2;
    const radius=Math.min(u*.7,(bounds.width-gap*8)/14,Math.max(1,(bottom-bounds.top-p.r*3-gap*6)/8));
    const gridEnd=p.y-p.r-radius-gap;
    const gridStart=Math.max(bounds.top+radius+gap,Math.min(bounds.top+u*5,gridEnd-3*(radius*2+gap)));
    const count=kind==='rescue'?28:27;
    for(let i=0;i<count;i++)add(lerp(bounds.left+radius+gap,bounds.right-radius-gap,(i%7)/6),lerp(gridStart,gridEnd,Math.floor(i/7)/3),19,.8,radius);
    world.saveUsed=kind==='danger';world.overTimer=0;
    if(kind==='danger')world.spawnTimer=.8;
    updateHud();return;
  }
  if(kind==='steer'){
    for(const [x,y] of [[.48,.28],[.72,.48],[.35,.65]])add(viewport.width*x,viewport.height*y,10000,1,u*.85);
    p.vx=world.baseSpeed;p.vy=-world.baseSpeed*.2;return;
  }
  if(kind==='multi'){
    for(let i=0;i<3;i++)add(middle+i*u*1.7,p.y,1,.12,u*.65);
  }else add(middle,p.y,kind==='light'?2000:kind==='medium'?600:kind==='heavy'?180:19);
  // This independent ball visibly keeps moving during another pair's hit-stop.
  const witness=add(viewport.width*.65,Math.max(90,p.y-u*5),10000,.8,u*.7);witness.vx=-u*1.5;
  if(kind==='reward'){
    world.stageKills=world.killTarget-1;
    for(const [x,y] of [[.2,.2],[.42,.25],[.76,.24],[.2,.72],[.48,.76],[.78,.68],[.83,.49]])add(viewport.width*x,viewport.height*y);
  }
  world.shoot(-world.maxPull,0);
}

function startEndlessDemo(kind){
  const p=world.player,u=world.unit,hint=$('#feedback-demo .demo-title span');
  if(kind.startsWith('starting-')){
    world.beginStartingUpgrades();
    if(hint)hint.textContent='只从常规强化中选择；完成后从第一阶段开始';
    updateChoices();updateHud();return;
  }
  if(kind==='ending'){
    world.stage=world.maxStage=12;world.maxCombo=7;world.score=460;world.saveUsed=true;world.overTimer=.79;
    for(let i=0;i<28;i++){
      const b=world.makeBody(viewport.width*(.12+(i%7)*.125),viewport.height*(.16+Math.floor(i/7)*.15),u*.7,.8);
      Object.assign(b,{born:1,solid:true,hp:19,maxHp:19,enemyType:'normal'});world.enemies.push(b);
    }
    p.x=viewport.width*.5;p.y=viewport.height*.75;p.vx=u*5;p.vy=-u;
    if(hint)hint.textContent='结尾镜头后，点击结算空白处可快速重开';
    updateHud();return;
  }
  const victory=kind==='boss-rewards';world.stage=world.maxStage=5;
  if(victory){
    world.beginBoss();Object.assign(p,world.bossPlayerAnchor());p.born=1;p.solid=true;
    Object.assign(world.boss,{r:world.boss.minRadius,hp:1,maxHp:1,stunned:true});
    world.shoot(0,world.maxPull);
  }else{
    const panel=$('#feedback-demo'),rect=panel&&!panel.hidden?panel.getBoundingClientRect():null,bounds=world.arenaBounds;
    const bottom=rect?.height>0&&rect.top>bounds.top?Math.min(bounds.bottom,rect.top):bounds.bottom;
    p.x=bounds.left+bounds.width*.22;p.y=clamp((bounds.top+bottom)*.48,bounds.top+u*3,bottom-u*3);
    world.stageKills=world.killTarget-1;
    for(const [x,y] of [[.5,0],[.67,-2.7],[.84,2.7]]){
      const enemy=world.spawnEnemy(null,'normal');
      if(enemy)Object.assign(enemy,{x:bounds.left+bounds.width*x,y:clamp(p.y+y*u,bounds.top+u*1.5,bottom-u*1.5),hp:1,maxHp:1,vx:0,vy:0,born:1,solid:true});
    }
    world.shoot(-world.maxPull,0);
  }
  if(hint)hint.textContent=victory?'最后一击让边框震动；胜利后连续选择两次强化':'清空场地后，在正方形边界内挑战膨胀Boss';
  updateHud();
}

function fitDemoOffer(){
  const panel=$('#feedback-demo');
  if(!feedbackDemo||(!panel?.classList.contains('demo-flow')&&!panel?.classList.contains('demo-compact'))||!['transition','choose'].includes(world?.phase))return;
  panel.classList.toggle('demo-compact',world.choices.length>3||world.upgradeRoundTotal>1);
  const rect=!panel.hidden?panel.getBoundingClientRect():null,bounds=world.arenaBounds,u=world.unit,p=world.player;
  const bottom=rect?.height>0&&rect.top>bounds.top?Math.min(bounds.bottom,rect.top):bounds.bottom;
  world.layoutChoices(world.choices.length>3?{top:bounds.top+8,bottom:bottom-8}:{top:bounds.top+u*3,bottom:bottom-u*4});
  if(world.choices.length<=3)world.choicePlayerY=bottom-p.r*2;
  if(world.phase==='choose'){
    p.x=viewport.width*.5;p.y=world.choicePlayerY;p.vx=p.vy=0;
    if(world.choices.length<=3&&viewport.width>viewport.height&&world.choices.some(c=>Math.hypot(p.x-c.x,p.y-c.y)<p.r+c.r+8)){
      p.x=bounds.left+p.r*1.5;p.y=Math.max(bounds.top+p.r*2,(bounds.top+bottom)*.55);
    }
  }
  updateChoices();
}

function startUpgradeDemo(kind){
  const id=kind.startsWith('upgrade-')?kind.slice(8):null,definition=UPGRADES[id],p=world.player,u=world.unit;
  const acquire=upgrade=>{
    world.phase='choose';
    world.choose({...UPGRADES[upgrade],x:p.x,y:p.y,r:u*2,born:1});
    // Finish the same reward rest used by ordinary play.
    for(let i=0;i<125&&world.phase==='reward';i++)world.step(1/120);
  };
  if(id==='overspeed')for(let i=0;i<4;i++)acquire('energy');
  if(definition)acquire(id);
  if(kind==='choices-double')acquire('gambler');
  world.enemies=[];world.auxiliaries=[];world.fragmentQueue=[];world.events=[];
  world.score=0;world.stageKills=0;world.spawnTimer=world.floorTimer=world.introTimer=Infinity;world.wave=null;
  const panel=$('#feedback-demo'),rect=panel&&!panel.hidden?panel.getBoundingClientRect():null,bounds=world.arenaBounds;
  const bottom=rect?.height>0&&rect.top>bounds.top?Math.min(bounds.bottom,rect.top):bounds.bottom;
  const hint=$('#feedback-demo .demo-title span');
  if(kind.startsWith('choices-')||id==='gambler'){
    world.beginUpgrade();
    for(let i=0;i<240&&world.phase==='transition';i++)world.step(1/120);
    world.layoutChoices(world.choices.length>3?{top:bounds.top+8,bottom:bottom-8}:{top:bounds.top+u*3,bottom:bottom-u*4});
    p.x=viewport.width*.5;p.y=world.choices.length>3?world.choicePlayerY:bottom-p.r*2;p.vx=p.vy=0;p.born=1;p.solid=true;
    if(world.choices.length<=3&&viewport.width>viewport.height&&world.choices.some(c=>Math.hypot(p.x-c.x,p.y-c.y)<p.r+c.r+8)){
      p.x=bounds.left+p.r*1.5;p.y=Math.max(bounds.top+p.r*2,(bounds.top+bottom)*.55);
    }
    world.events=[];
    if(hint)hint.textContent=(world.upgradeRoundTotal>1?'连续两轮三选一；':'')+'长按球看示意，拖拽玩家撞球选择';
    updateChoices();updateHud();return;
  }
  const middleY=clamp((bounds.top+bottom)*.52,bounds.top+u*3,bottom-u*3);
  p.x=bounds.left+bounds.width*.2;p.y=middleY;p.vx=p.vy=0;p.born=1;p.solid=true;
  const place=(x,y)=>{
    const enemy=world.spawnEnemy(null,'normal');
    if(enemy)Object.assign(enemy,{x,y,vx:0,vy:0,born:1,solid:true});
    return enemy;
  };
  const targetX=bounds.left+bounds.width*.5;
  if(id==='gravity'){
    p.x=bounds.left+bounds.width*.42;
    const compact=bottom-bounds.top<u*8,spread=compact?.5:.8,distance=compact?4:3.4;
    if(compact)p.y=(bounds.top+bottom)/2;
    for(const angle of [-spread,0,spread])place(p.x+Math.cos(angle)*u*distance,p.y+Math.sin(angle)*u*distance);
  }else if(id==='shockwave'){
    if(bottom-bounds.top<u*8)p.y=bounds.top+p.r*1.5;
    for(const side of [bounds.left+u*1.5,bounds.right-u*1.5])place(side,p.y+u*2.3);
  }else{
    place(targetX,p.y);
    if(['split','pulse','magnet'].includes(id))for(const side of [-1,1])place(targetX+u*2.5,p.y+side*u*1.9);
    else for(let i=1;i<=2;i++)place(targetX+u*2.3*i,p.y);
  }
  if(['breath','frenzy'].includes(id))world.spawnTimer=.45;
  if(id!=='gravity')world.shoot(world.maxPull*(['bank','boomerang','shockwave'].includes(id)?1:-1),0);
  const hints={energy:'强化后的这一发更快；可继续拖拽发射',overspeed:'弹性已达4层；这一发能越过原来的速度上限',density:'重量级碰撞更有分量；继续试着撞开敌球',rubber:'碰撞后保留更多速度，可连续弹射',growth:'玩家已经大一圈，伤害也提高了10%',magnet:'击杀后快速牵引敌球，优先前方路线；最多同时牵引两颗',pierce:'撞击后仍沿原方向，试着穿过一排',pulse:'重击会震伤附近敌球并将它们推开',bank:'先撞墙，下一次撞击更有力量',gravity:'附近敌球正向玩家聚拢，可继续拖拽发射',breath:'击杀后刷新会短暂放慢',split:'这一发首杀后会分出两颗辅助球',penetration:'这一发首杀后恢复出手速度',boomerang:'撞墙后0.8秒，球会加速30%',shockwave:'每第2次撞墙会释放冲击波',frenzy:'每波更多球；同一发超过6连击后，每次连击增加15%伤害，单层最多60%'};
  if(hint)hint.textContent=hints[id]||'选择场景，可继续拖拽弹射';
  updateHud();
}

