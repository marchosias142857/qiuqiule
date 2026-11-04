import {trackPath} from './levels.js';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=(value,fallback)=>Number.isFinite(value)?value:fallback;

// Sample the selector's own rounded rail rather than rebuilding an almost
// matching second outline. trackPath emits only circular M/A/L/Z commands.
// Cache by layout identity: the rail changes on resize, never every frame.
const chainRails=new WeakMap();
export function campaignChainTrack(layout){
  if(!layout||![layout.cx,layout.cy,layout.inner,layout.outer,layout.corner,layout.startAngle,layout.endAngle].every(Number.isFinite)||
    !(layout.inner>0&&layout.outer>layout.inner&&layout.corner>0&&layout.corner<layout.inner&&layout.corner<layout.outer/2))return [];
  const key=[layout.cx,layout.cy,layout.inner,layout.outer,layout.corner,layout.startAngle,layout.endAngle].join(',');
  const cached=chainRails.get(layout);if(cached?.key===key)return cached.points;
  const tokens=trackPath(layout).match(/[MLAZ]|[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi)||[];
  const points=[];let i=0,x=0,y=0;
  while(i<tokens.length){
    const command=tokens[i++];
    if(command==='M'||command==='L'){
      x=Number(tokens[i++]);y=Number(tokens[i++]);points.push({x,y});
    }else if(command==='A'){
      let radius=Number(tokens[i++]);i+=2;
      const large=Number(tokens[i++]),sweep=Number(tokens[i++]),toX=Number(tokens[i++]),toY=Number(tokens[i++]);
      const dx=(x-toX)/2,dy=(y-toY)/2,chord=Math.hypot(dx,dy);
      radius=Math.max(radius,chord);
      const offset=chord>1e-9?Math.sqrt(Math.max(0,radius*radius-chord*chord))/chord*(large===sweep?-1:1):0;
      const cx=(x+toX)/2+dy*offset,cy=(y+toY)/2-dx*offset;
      const start=Math.atan2(y-cy,x-cx),end=Math.atan2(toY-cy,toX-cx);
      let span=end-start;if(sweep&&span<0)span+=Math.PI*2;if(!sweep&&span>0)span-=Math.PI*2;
      const count=Math.max(2,Math.ceil(Math.abs(span)/(Math.PI/32)));
      for(let n=1;n<=count;n++){const a=start+span*n/count;points.push({x:cx+Math.cos(a)*radius,y:cy+Math.sin(a)*radius});}
      x=toX;y=toY;
    }else if(command==='Z')break;
    else return [];
  }
  chainRails.set(layout,{key,points});return points;
}

function captureRecords(world){
  if(!world||world.mode!=='campaign'||world.config?.legacy||world.legacy)return [];
  return [...(world.poolCaptures||[]),...(world.golfCapture?[world.golfCapture]:[]),
    ...(world.mergeCaptures||[]),
    ...(world.bricksReturns||[]).map(capture=>({...capture,kind:'bricks-return',player:true,auxiliary:true}))];
}

function captureBody(capture){return capture.bodySnapshot||capture.body||capture;}
function captureAge(world,capture){
  const clock=finite(world.feedbackTime,world.time);
  return Math.max(0,Number.isFinite(capture.at)&&Number.isFinite(clock)?clock-capture.at:finite(capture.age,0));
}

// Captured actors leave the simulation immediately. The ordinary body drawing
// and the visual-only snapshot therefore need separate poses, while keeping the
// approved player skin/photo renderer as the single source of their appearance.
export function campaignBodyVisual(world,body,{reducedMotion=false}={}){
  if(!body||world?.mode!=='campaign')return {body,alpha:1,hidden:false};
  if(body.kind==='merge-ball'){
    if(body.active===false||body.hp<=0)return {body,alpha:0,hidden:true};
    if(Number.isFinite(body.mergeBornAt)){
      const age=Math.max(0,finite(world.feedbackTime,finite(world.time,body.mergeBornAt))-body.mergeBornAt),t=clamp(age/.2,0,1);
      const appear=t*t*(3-2*t);
      if(t<1)return {body:{...body,r:body.r*(reducedMotion?1:.55+.45*appear),born:1},alpha:appear,hidden:false};
    }
  }
  if(body.kind==='bowling-pin'&&!body.captured){
    const hp=finite(body.pinHP,body.hp),maxHp=finite(body.pinMaxHP,body.maxHp);
    const ratio=Number.isFinite(hp)&&maxHp>0?clamp(hp/maxHp,0,1):1;
    return {body,alpha:body.bowlingFallen?.18:.4+.6*ratio,hidden:false};
  }
  if(!body.captured)return {body,alpha:1,hidden:false};
  const capture=captureRecords(world).find(item=>{
    const snapshot=captureBody(item),id=item.bodyId??snapshot.id;
    return (item.player&&!item.auxiliary&&body.isPlayer&&!body.isAuxiliary)||(id!==undefined&&id===body.id);
  });
  const x=finite(capture?.pocketX,body.x),y=finite(capture?.pocketY,body.y);
  // Keep the original radius at the endpoint for crown/result transfer geometry.
  return {body:{...body,x,y},alpha:0,hidden:true};
}

export function campaignCaptureVisuals(world,{reducedMotion=false}={}){
  const visuals=[];
  for(const capture of captureRecords(world)){
    if(capture.active===false)continue;
    const source=captureBody(capture),duration=finite(capture.duration,.22);
    if(!(duration>0)||![source.x,source.y,source.r].every(Number.isFinite)||source.r<=0)continue;
    const progress=clamp(captureAge(world,capture)/duration,0,1);
    if(progress>=1)continue;
    const returning=capture.kind==='bricks-return',merging=capture.kind==='merge';
    const move=reducedMotion?0:1-Math.pow(1-progress,3);
    const x=source.x+(finite(returning||merging?capture.toX:capture.pocketX,source.x)-source.x)*move;
    const y=source.y+(finite(returning||merging?capture.toY:capture.pocketY,source.y)-source.y)*move;
    const r=source.r*(reducedMotion||returning?1:1-.94*move);
    const fade=progress*progress*(3-2*progress);
    visuals.push({body:{...source,x,y,r,born:1,captured:false},alpha:1-fade,player:!!capture.player,
      ...(returning?{auxiliary:true}:{})});
  }
  return visuals;
}

function circlePoints(x,y,r,count=40){
  return Array.from({length:count},(_,i)=>{
    const angle=i*Math.PI*2/count;
    return {x:x+Math.cos(angle)*r,y:y+Math.sin(angle)*r};
  });
}

function roundedRectPoints(x,y,width,height,cornerRadius){
  const hw=width/2,hh=height/2,r=clamp(cornerRadius,0,Math.min(hw,hh));
  const corners=[[x+hw-r,y+hh-r,0],[x-hw+r,y+hh-r,Math.PI/2],
    [x-hw+r,y-hh+r,Math.PI],[x+hw-r,y-hh+r,Math.PI*1.5]];
  return corners.flatMap(([cx,cy,start])=>Array.from({length:7},(_,i)=>{
    const angle=start+i*Math.PI/12;
    return {x:cx+Math.cos(angle)*r,y:cy+Math.sin(angle)*r};
  }));
}

function path(g,points,fill,color,alpha,width=1,closed=true){
  if(!points.length||alpha<=0)return;
  if(fill)g.fillStyle(color,alpha);else g.lineStyle(width,color,alpha);
  g.beginPath();g.moveTo(points[0].x,points[0].y);
  for(let i=1;i<points.length;i++)g.lineTo(points[i].x,points[i].y);
  if(closed)g.closePath();
  if(fill)g.fillPath();else g.strokePath();
}

function numberColor(enemyColor,bgColor,opacity=.9){
  const channel=shift=>opacity*((enemyColor>>shift)&255)+(1-opacity)*((bgColor>>shift)&255);
  return channel(16)*.299+channel(8)*.587+channel(0)*.114<145?0xf4f3eb:0x252720;
}

function brickEntranceAlpha(world,body){
  if(!world.bricksLayout||!['number-brick','brick-plus'].includes(body.kind))return 1;
  const b=world.arenaBounds||world.bricksLayout;
  const outer=body.r+(body.kind==='brick-plus'?.675:0);
  const margin=world.bricksLayout.vertical?body.y-outer-b.top:b.right-body.x-outer;
  return clamp(margin/(finite(world.unit,18)*.3),0,1);
}

// Labels use the approved GameSans text nodes owned by the scene. Their IDs
// survive motion and HP changes; geometry and numbers consume the same body
// position so a descending row never leaves its label behind.
export function campaignTextVisuals(world,{enemyColor=0xe88c72,inkColor=0x252720,bgColor=0xf4f3eb,alpha=1}={}){
  if(!world||world.mode!=='campaign'||world.config?.legacy||world.legacy)return [];
  alpha=clamp(finite(alpha,1),0,1);if(!alpha)return [];
  const labels=[];
  for(const [index,body] of [...(world.statics||[]),...(world.zones||[])].entries()){
    const bonus=body.kind==='brick-plus';
    if((body.kind!=='number-brick'&&!bonus)||body.active===false||body.dead||
      ![body.x,body.y,body.r].every(Number.isFinite)||body.r<=0||!bonus&&(!Number.isFinite(body.hp)||body.hp<=0))continue;
    const text=bonus?'+1':String(Math.ceil(body.hp));
    // ChillRoundF v3.200 digits advance at most .613em (+ is .549em).
    // The .64em bound leaves padding without measuring or replacing glyphs.
    const size=Math.min(body.r*1.05,body.r*1.35/(text.length*.64));
    const ratio=Number.isFinite(body.maxHp)&&body.maxHp>0?clamp(body.hp/body.maxHp,0,1):1;
    labels.push({id:`campaign-${bonus?'plus':'hp'}-${body.id??index}`,x:body.x,y:body.y,text,size,
      color:bonus?inkColor:numberColor(enemyColor,bgColor,.9*(.4+.6*ratio)),alpha:alpha*brickEntranceAlpha(world,body)});
  }
  return labels;
}

export function campaignBorderGap(world){
  if(!world||world.mode!=='campaign'||world.config?.legacy||world.legacy)return null;
  const drain=(world.zones||[]).find(zone=>zone.kind==='drain'&&zone.active!==false&&!zone.hidden);
  if(!drain||!Number.isFinite(drain.x)||!Number.isFinite(drain.width)||!(drain.width>0))return null;
  return {left:drain.x-drain.width/2,right:drain.x+drain.width/2};
}

// Trace the single physical bottom opening as an open path. The caller keeps
// its existing border color/feedback, and other modes keep their original
// rounded-rectangle drawing; this never erases a previously drawn outline.
export function drawCampaignBorder(g,bounds,gap,{dx=0,dy=0,outset=0}={}){
  if(!gap||![bounds.left,bounds.top,bounds.right,bounds.bottom,gap.left,gap.right].every(Number.isFinite))return false;
  const left=bounds.left+dx-outset,right=bounds.right+dx+outset;
  const top=bounds.top+dy-outset,bottom=bounds.bottom+dy+outset;
  const r=clamp(finite(bounds.cornerRadius,22)+outset,0,Math.min(right-left,bottom-top)/2);
  const from=clamp(gap.left+dx,left+r,right-r),to=clamp(gap.right+dx,left+r,right-r);
  if(!(right>left&&bottom>top&&to>from))return false;
  const points=[{x:to,y:bottom}];
  for(const [x,y,start] of [[right-r,bottom-r,Math.PI/2],[right-r,top+r,0],
    [left+r,top+r,-Math.PI/2],[left+r,bottom-r,-Math.PI]]){
    for(let i=0;i<=8;i++){
      const angle=start-i*Math.PI/16;
      points.push({x:x+Math.cos(angle)*r,y:y+Math.sin(angle)*r});
    }
  }
  points.push({x:from,y:bottom});
  g.beginPath();g.moveTo(points[0].x,points[0].y);
  for(const point of points.slice(1))g.lineTo(point.x,point.y);
  g.strokePath();return true;
}

// Return just the guide geometry so the eye look and the dotted suggestion can
// be inspected independently of the Phaser boundary. The guide is static and
// remains useful with reduced motion or feedback strength set to zero.
export function campaignTutorialGuide(world){
  if(!world||world.config?.legacy||world.legacy||world.phase!=='battle')return [];
  const visible=world.tutorialVisible??(world.config?.k===0&&(world.shotsUsed||0)===0);
  if(!visible||world.shotActive)return [];
  let target=world.teachingTarget||world.tutorialTarget;
  if(typeof target==='function')target=target.call(world);
  const player=world.player;
  if(!player||!target||![player.x,player.y,target.x,target.y].every(Number.isFinite))return [];
  const dx=target.x-player.x,dy=target.y-player.y,distance=Math.hypot(dx,dy);
  const targetBody=[...(world.statics||[]),...(world.zones||[]),...(world.enemies||[])].find(body=>
    body.active!==false&&!body.dead&&body.hp!==0&&Math.abs(body.x-target.x)<1e-5&&Math.abs(body.y-target.y)<1e-5);
  const targetRadius=targetBody?.shape==='rect'
    ? Math.min(targetBody.width*.5/(Math.abs(dx/distance)||1e-9),targetBody.height*.5/(Math.abs(dy/distance)||1e-9))
    : finite(target.r,finite(targetBody?.r,0));
  const start=player.r+Math.max(5,world.unit*.3);
  const end=distance-Math.max(4,targetRadius+world.unit*.15);
  if(end<=start)return [];
  const count=clamp(Math.floor((end-start)/Math.max(9,world.unit*.55))+1,2,24);
  const r=clamp(world.unit*.065,1.1,1.8);
  return Array.from({length:count},(_,i)=>{
    const along=start+(end-start)*i/(count-1);
    return {x:player.x+dx/distance*along,y:player.y+dy/distance*along,r,alpha:.24+.14*i/(count-1)};
  });
}

// All dimensions below are drawing-only. In particular injured bricks retain
// their original collider, and a touched peg remains visible until shot-end.
export function drawCampaign(g,world,{
  enemyColor=0xe88c72,playerColor=0x252720,inkColor=0x252720,bgColor=0xf4f3eb,
  alpha=1,reducedMotion=false,strength=1,showTutorial=true,
}={}){
  if(!world||world.mode!=='campaign'||world.config?.legacy||world.legacy)return;
  alpha=clamp(finite(alpha,1),0,1);
  if(!alpha)return;
  const unit=finite(world.unit,18);
  if(world.chainTrack){
    const track=world.chainTrack,rail=campaignChainTrack(track);
    path(g,rail,true,inkColor,alpha*.35);
    if(rail.length){
      const radius=finite(track.radius,(track.inner+track.outer)/2),a=track.startAngle;
      const nx=Math.cos(a),ny=Math.sin(a),tx=-ny,ty=nx;
      const x=track.cx+nx*radius,y=track.cy+ny*radius;
      // One small direction mark identifies the inlet. It sits within the
      // first bead and is naturally covered as that bead enters the rail.
      path(g,[{x:x-tx*unit*.2+nx*unit*.16,y:y-ty*unit*.2+ny*unit*.16},
        {x:x+tx*unit*.16,y:y+ty*unit*.16},
        {x:x-tx*unit*.2-nx*unit*.16,y:y-ty*unit*.2-ny*unit*.16}],false,inkColor,alpha*.5,1,false);
    }
  }
  for(const zone of world.zones||[]){
    if(zone.active===false||zone.hidden)continue;
    if(zone.kind==='glass-bottom'){
      const y=finite(zone.visualY,zone.y);
      if(![zone.x,y,zone.width].every(Number.isFinite)||zone.width<=0)continue;
      path(g,[{x:zone.x-zone.width/2,y},{x:zone.x+zone.width/2,y}],false,inkColor,alpha*.35,1,false);
    }else if(zone.kind==='brick-plus'&&zone.shape==='circle'&&zone.r>0){
      const points=circlePoints(zone.x,zone.y,zone.r);
      const appear=brickEntranceAlpha(world,zone);
      path(g,points,true,bgColor,alpha*appear);
      path(g,points,false,inkColor,alpha*.75*appear,1.35);
    }else if(zone.kind==='drain'){
      const width=zone.width,height=finite(zone.visualHeight,unit*.5);
      const bottom=finite(zone.visualY,world.arenaBounds?.bottom);
      if(!(width>0&&height>0)||!Number.isFinite(bottom))continue;
      const left=zone.x-width/2,right=zone.x+width/2,top=bottom-height;
      path(g,[{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}],true,bgColor,alpha);
      path(g,[{x:left,y:top},{x:left,y:bottom}],false,inkColor,alpha*.6,1,false);
      path(g,[{x:right,y:top},{x:right,y:bottom}],false,inkColor,alpha*.6,1,false);
    }else if(zone.kind==='bucket'){
      const width=zone.width,height=zone.visualHeight??zone.height;
      const y=zone.visualY??zone.y;
      if(!(width>0&&height>0))continue;
      const left=zone.x-width/2,right=zone.x+width/2,top=y-height/2,bottom=y+height/2;
      path(g,[{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}],true,bgColor,alpha);
      // An open U exposes the entry. Its base aligns with the physical floor;
      // the trigger itself tests the ball centre one radius above this slot.
      const corner=Math.min(unit*.13,width/6,height/3);
      const points=[{x:left,y:top},{x:left,y:bottom-corner}];
      for(let i=0;i<=5;i++){
        const angle=Math.PI-i*Math.PI/10;
        points.push({x:left+corner+Math.cos(angle)*corner,y:bottom-corner+Math.sin(angle)*corner});
      }
      points.push({x:right-corner,y:bottom});
      for(let i=0;i<=5;i++){
        const angle=Math.PI/2-i*Math.PI/10;
        points.push({x:right-corner+Math.cos(angle)*corner,y:bottom-corner+Math.sin(angle)*corner});
      }
      points.push({x:right,y:top});
      path(g,points,false,inkColor,alpha*.75,1.2,false);
    }else if(zone.shape==='circle'&&zone.r>0){
      const points=circlePoints(zone.x,zone.y,zone.r);
      path(g,points,true,bgColor,alpha);
      path(g,points,false,inkColor,alpha*.6,1);
    }else if(zone.shape==='rect'&&zone.width>0&&zone.height>0){
      const points=roundedRectPoints(zone.x,zone.y,zone.width,zone.height,finite(zone.cornerRadius,zone.kind==='gutter'?0:unit*.12));
      path(g,points,true,bgColor,alpha);
      path(g,points,false,inkColor,alpha*.6,1);
    }
  }
  for(const body of world.statics||[]){
    if(body.active===false||body.hidden||body.dead||(body.kind!=='peg'&&body.hp<=0))continue;
    if(body.shape==='rect'){
      if(!(body.width>0&&body.height>0))continue;
      if(body.kind==='chain-chord'){
        path(g,roundedRectPoints(body.x,body.y,body.width,body.height,finite(body.cornerRadius,body.height/2)),true,inkColor,alpha*.35);
        continue;
      }
      const ratio=Number.isFinite(body.maxHp)&&body.maxHp>0&&Number.isFinite(body.hp)?clamp(body.hp/body.maxHp,0,1):1;
      const scale=.82+.18*ratio;
      const points=roundedRectPoints(body.x,body.y,body.width*scale,body.height*scale,finite(body.cornerRadius,unit*.16)*scale);
      const patternAlpha=body.pattern==='checker'&&body.shade? .72 : .9;
      path(g,points,true,enemyColor,alpha*patternAlpha*(.4+.6*ratio));
    }else if(body.shape==='circle'&&body.r>0){
      const points=circlePoints(body.x,body.y,body.r);
      if(body.kind==='chain-ball'){
        path(g,points,true,enemyColor,alpha);
        const rings=clamp(Math.floor(body.sizeIndex)||0,0,2),ink=numberColor(enemyColor,bgColor,1);
        for(let ring=0;ring<rings;ring++)
          path(g,circlePoints(body.x,body.y,body.r*(ring?.76:.52),24),false,ink,alpha*.7,1);
      }else if(body.kind==='glass'){
        const width=Math.min(2.5,body.r*.3);
        path(g,circlePoints(body.x,body.y,body.r-width/2),false,enemyColor,alpha*.9,width);
      }else if(body.kind==='bumper'){
        path(g,points,false,playerColor,alpha*.9,1.5);
      }else if(body.kind==='peg'){
        if(body.target)path(g,points,true,enemyColor,alpha*(body.hitThisShot?.36:.9));
        else path(g,points,false,enemyColor,alpha*(body.hitThisShot?.38:.75),1.35);
        if(body.hitThisShot){
          path(g,circlePoints(body.x,body.y,body.r*.22,16),true,playerColor,alpha*.5);
        }
      }else{
        const ratio=['jackpot','number-brick'].includes(body.kind)&&Number.isFinite(body.maxHp)&&body.maxHp>0&&Number.isFinite(body.hp)?clamp(body.hp/body.maxHp,0,1):1;
        path(g,points,true,enemyColor,alpha*.9*(.4+.6*ratio)*brickEntranceAlpha(world,body));
      }
    }
  }
  if(showTutorial)for(const dot of campaignTutorialGuide(world))
    path(g,circlePoints(dot.x,dot.y,dot.r,12),true,playerColor,alpha*dot.alpha);
}
