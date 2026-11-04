import {transformSkinPoint} from './skin-render.js';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const ease=value=>1-(1-clamp(value,0,1))**3;
const circle=Array.from({length:128},(_,i)=>({x:Math.cos(i/128*Math.PI*2),y:Math.sin(i/128*Math.PI*2)}));
const types=new Set(['ring','heavy','split','walker','magnet','shield','leader','fragment']);
const darken=(color,amount)=>[16,8,0].reduce((result,shift)=>result|Math.round(((color>>shift)&255)*(1-amount))<<shift,0);
const splitHoles=[{x:0,y:-.26},{x:-.22,y:.13},{x:.22,y:.13}];

// Precompose black with the theme color; do not blend these details a second
// time over the body. Boss eyes share the same 40% black mixture.
export const enemyDetailColor=color=>darken(color,.4);
export function enemyBodyColor(body,color){
  const type=body?.enemyType??body?.bodySnapshot?.enemyType;
  return type==='fragment'&&!body?.isPlayer&&!body?.isBoss?darken(color,.3):color;
}

export function isSpecialEnemy(body){return !body.isPlayer&&!body.isBoss&&types.has(body.enemyType);}

// The caller supplies the HP-adjusted body radius and unit. Every contour,
// marker, eye and highlight shares this one birth/rotation/impact projection.
// Drawing never changes the body's collision radius or its physics state.
export function drawEnemyBall(g,body,color,{alpha=1,unit=body.r,player=null,flashAlpha=0,flashColor=0xffffff,birthScale,birthAlpha}={}){
  color=enemyBodyColor(body,color);
  const born=birthScale??ease(body.born??1),r=body.r*born;
  const opacity=alpha*(birthAlpha??born);
  if(r<.3||opacity<=0)return false;
  const angle=body.angle||0,turn=angle+(body.roll||0);
  const pose={x:body.x,y:body.y,r,squash:body.squash||0,deformAngle:angle,roll:turn};
  const paintPath=(points,paint,opacity,width=0)=>{
    if(opacity<=0)return;
    if(width)g.lineStyle(width,paint,opacity);else g.fillStyle(paint,opacity);
    g.beginPath();
    for(let i=0;i<points.length;i++){
      const p=points[i];
      i?g.lineTo(p.x,p.y):g.moveTo(p.x,p.y);
    }
    g.closePath();if(width)g.strokePath();else g.fillPath();
  };
  const path=(points,paint,opacity,width=0)=>paintPath(points.map(p=>transformSkinPoint(p,pose)),paint,opacity,width);
  const disk=(radius,paint,opacity,width=0)=>path(radius===1?circle:circle.map(p=>({x:p.x*radius,y:p.y*radius})),paint,opacity,width);
  const type=body.enemyType,edge=darken(color,.22),hollow=type==='ring'||type==='magnet';
  if(hollow){
    let ring;
    if(type==='ring'){
      const contour=circle.map(p=>transformSkinPoint(p,pose));
      // Move the stroke centre inward by half the added thickness. Offsetting
      // in screen-space normals preserves the original outer edge even while
      // squashing; neither the collider nor the transparent centre is painted.
      const width=Math.min(3,r*.9),inset=(width-1.5)/2;
      const points=contour.map((point,i)=>{
        const previous=contour[(i+127)%128],next=contour[(i+1)%128];
        const dx=next.x-previous.x,dy=next.y-previous.y,length=Math.hypot(dx,dy)||1;
        return {x:point.x-dy/length*inset,y:point.y+dx/length*inset};
      });
      ring=(paint,alpha)=>paintPath(points,paint,alpha,width);
    }else ring=(paint,alpha)=>{disk(1,paint,alpha,2.5);disk(.72,paint,alpha*.8,1.5);};
    ring(color,opacity);
    // A hit brightens the same band without covering the hollow centre.
    if(flashAlpha>0){
      ring(flashColor,opacity*flashAlpha);
    }
    return true;
  }
  disk(1,color,opacity);
  if(flashAlpha>0)disk(.85,flashColor,opacity*flashAlpha);
  if(type==='heavy')disk(.975,edge,opacity*.8,2.25);
  if(type==='split')for(const center of splitHoles){
    path(circle.map(p=>({x:center.x+p.x*.12,y:center.y+p.y*.12})),enemyDetailColor(color),opacity);
  }
  if(type==='shield'&&body.shield)disk(1+.3*unit/body.r,color,opacity*.8,2);
  if(type==='leader')disk(.105,edge,opacity);
  if(type==='walker'){
    const dx=(player?.x??body.x)-body.x,dy=(player?.y??body.y)-body.y,length=Math.hypot(dx,dy)||1;
    const c=Math.cos(turn),s=Math.sin(turn),lookX=(dx*c+dy*s)/length*.13,lookY=(-dx*s+dy*c)/length*.13;
    for(const side of [-1,1])path(circle.filter((_,i)=>i%4===0).map(p=>({x:side*.17+lookX+p.x*.0525,y:-.07+lookY+p.y*.095})),enemyDetailColor(color),opacity);
  }
  return true;
}

// Result controls briefly carry the exact enemy drawing before becoming their
// filled button. Use the same paths as the live renderer, including hollow
// centres and the shield's visual halo outside the collision circle.
export function enemyTransferMarkup(body,color,options={}){
  const paths=[];let points=[],paint={};
  const record=(stroke=false)=>{
    const d=points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ')+' Z';
    const color='#'+paint.color.toString(16).padStart(6,'0');
    paths.push(`<path d="${d}" fill="${stroke?'none':color}" stroke="${stroke?color:'none'}" stroke-width="${stroke?paint.width:0}" opacity="${paint.alpha}"/>`);
  };
  const graphics={fillStyle(color,alpha){paint={color,alpha};},lineStyle(width,color,alpha){paint={width,color,alpha};},
    beginPath(){points=[];},moveTo(x,y){points.push({x,y});},lineTo(x,y){points.push({x,y});},closePath(){},
    fillPath(){record();},strokePath(){record(true);}};
  drawEnemyBall(graphics,body,color,{...options,birthScale:1,birthAlpha:ease(body.born??1)});
  return `<svg class="enemy-transfer" viewBox="${body.x-body.r} ${body.y-body.r} ${body.r*2} ${body.r*2}" aria-hidden="true" style="overflow:visible">${paths.join('')}</svg>`;
}
