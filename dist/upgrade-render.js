import {projectSkinContour} from './skin-render.js';
import {skinContour} from './skins.js';

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const ease=t=>1-(1-clamp(t,0,1))**3;
const circle=Array.from({length:96},(_,i)=>({x:Math.cos(i/96*Math.PI*2),y:Math.sin(i/96*Math.PI*2)}));
const appearances=Object.freeze({
  regular:{color:0xc4dcaa,ink:0x35533e,shade:0x63874e,sides:3,radius:.38,angle:-Math.PI/2},
  special:{color:0xbdaee2,ink:0x4f416e,shade:0x796693,sides:4,radius:.31,angle:Math.PI/4},
  risk:{color:0xe8c17f,ink:0x704e2c,shade:0xa77b40,sides:5,radius:.285,angle:-Math.PI/2},
});

export function upgradeAppearance(choice,background=0xf4f3eb){
  const kind=typeof choice==='string'?choice:choice?.kind||['regular','special','risk'][choice?.rings||0];
  const style=appearances[kind]||appearances.regular;
  const distance=Math.hypot(...[16,8,0].map(shift=>((style.color>>shift)&255)-((background>>shift)&255)));
  return distance<65?{...style,color:style.shade,ink:0xfff9ed}:style;
}

function markerPoints(style){
  return Array.from({length:style.sides},(_,i)=>{
    const angle=style.angle+i/style.sides*Math.PI*2;
    return {x:Math.cos(angle)*style.radius,y:Math.sin(angle)*style.radius};
  });
}

export function upgradeIconMarkup(choice,background){
  const style=upgradeAppearance(choice,background),hex=color=>'#'+color.toString(16).padStart(6,'0');
  const points=markerPoints(style).map(p=>(12+p.x*10).toFixed(3)+','+(12+p.y*10).toFixed(3)).join(' ');
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="${hex(style.color)}" stroke="none"/><polygon points="${points}" fill="${hex(style.ink)}" stroke="none"/></svg>`;
}

// Small, text-free diagrams in unit-ball coordinates. Dotted paths convey
// movement; outlined small balls are targets and solid balls are the player.
export function upgradePreviewGeometry(id,time=0){
  const shapes=[],dot=(x,y,r=.09)=>shapes.push({type:'dot',x,y,r}),ring=(x,y,r=.12)=>shapes.push({type:'ring',x,y,r});
  const line=(...points)=>shapes.push({type:'line',points:points.map(([x,y])=>({x,y}))});
  const wave=.5-.5*Math.cos(time*2.5),runner=-.5+wave*.8;
  switch(id){
    case 'energy':line([-.6,0],[.6,0]);dot(runner,0,.13);break;
    case 'overspeed':line([-.65,-.12],[.65,-.12]);line([-.6,.18],[.45,.18]);dot(runner,-.12,.12);break;
    case 'density':dot(-.3,0,.23);ring(.27,0,.11);line([.1,0],[.62,0]);break;
    case 'rubber':line([-.58,.3],[-.18,-.32],[.18,.3],[.58,-.3]);dot(-.18,-.32,.1);break;
    case 'growth':ring(-.33,0,.12);line([-.1,0],[.1,0]);dot(.32,0,.25);break;
    case 'magnet':dot(-.25,0,.15);ring(.32-wave*.1,0,.1);line([.08,0],[.4,0]);break;
    case 'pierce':line([-.65,0],[.65,0]);for(const x of [-.25,.1,.45])ring(x,0,.12);dot(-.55,0,.1);break;
    case 'pulse':dot(0,0,.16);for(const a of [-1.6,.5,2.6]){const x=Math.cos(a),y=Math.sin(a);line([x*.23,y*.23],[x*.46,y*.46]);ring(x*.55,y*.55,.09);}break;
    case 'bank':line([-.5,.35],[.5,-.2],[-.3,-.45]);line([.57,-.45],[.57,.3]);dot(-.5,.35,.1);ring(-.3,-.45,.1);break;
    case 'gravity':dot(0,0,.19);for(const a of [-Math.PI/2,Math.PI/6,Math.PI*5/6]){const x=Math.cos(a),y=Math.sin(a);line([x*.28,y*.28],[x*.47,y*.47]);ring(x*(.58-wave*.07),y*(.58-wave*.07),.08);}break;
    case 'breath':line([-.58,.1],[.58,.1]);dot(-.54,.1,.1);ring(0,.1,.09);ring(.54,.1,.09);break;
    case 'split':line([-.5,0],[0,0],[.45,-.3]);line([0,0],[.45,.3]);dot(-.5,0,.14);dot(.45,-.3,.1);dot(.45,.3,.1);break;
    case 'penetration':line([-.6,0],[.6,0]);dot(.1+wave*.32,0,.12);ring(-.2,0,.19);break;
    case 'boomerang':line([-.55,.32],[.45,-.32],[.1,.24],[-.36,-.1]);dot(-.55,.32,.1);line([.55,-.5],[.55,.2]);break;
    case 'shockwave':dot(0,0,.1);ring(0,0,.28);ring(0,0,.46+wave*.06);break;
    case 'gambler':for(const x of [-.4,0,.4])ring(x,-.34,.085);for(const x of [-.4,0,.4])ring(x,.34,.085);dot(0,0,.12);line([0,-.15],[0,-.22]);break;
    case 'frenzy':for(const x of [-.32,0,.32])for(const y of [-.2,.2])ring(x,y,.085);line([-.62,0],[.62,0]);dot(runner,0,.1);break;
    default:dot(0,0,.16);
  }
  return shapes;
}

function path(g,points,color,alpha,width=0){
  if(width)g.lineStyle(width,color,alpha);else g.fillStyle(color,alpha);
  g.beginPath();points.forEach((p,i)=>i?g.lineTo(p.x,p.y):g.moveTo(p.x,p.y));g.closePath();
  if(width)g.strokePath();else g.fillPath();
}
function disk(g,x,y,r,color,alpha,width=0){path(g,circle.map(p=>({x:x+p.x*r,y:y+p.y*r})),color,alpha,width);}

export function drawUpgradeBall(g,choice,background=0xf4f3eb,{alpha=1,preview=false,time=0,reducedMotion=false}={}){
  const appear=ease(choice.born??1),r=choice.r*appear,opacity=alpha*appear;
  if(r<1||opacity<=0)return;
  const style=upgradeAppearance(choice,background),{color,ink}=style;
  disk(g,choice.x,choice.y,r,color,opacity);
  if(!preview){
    path(g,markerPoints(style).map(p=>({x:choice.x+p.x*r,y:choice.y+p.y*r})),ink,opacity);
    return;
  }
  for(const shape of upgradePreviewGeometry(choice.id,reducedMotion?0:time)){
    if(shape.type==='line'){
      for(let i=1;i<shape.points.length;i++){
        const a=shape.points[i-1],b=shape.points[i],count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/.11));
        for(let n=0;n<=count;n++)disk(g,choice.x+(a.x+(b.x-a.x)*n/count)*r,choice.y+(a.y+(b.y-a.y)*n/count)*r,Math.max(.6,r*.018),ink,opacity*.65);
      }
    }else disk(g,choice.x+shape.x*r,choice.y+shape.y*r,shape.r*r,ink,opacity*.9,shape.type==='ring'?Math.max(.8,r*.025):0);
  }
}

export function drawAuxiliaryBall(g,body,color,alpha=1,{contour=skinContour(0),pose:override={}}={}){
  const appear=ease(body.born??1),r=body.r*appear;
  if(r<.3||alpha<=0)return;
  const pose={x:body.x,y:body.y,r,roll:body.roll??0,deformAngle:body.angle||0,squash:body.squash||0,...override};
  path(g,projectSkinContour(contour,pose),color,alpha*appear);
}
