import {CometWorkspace,cometProfile} from './comet-trail.js';
import {drawParticleAppearance} from './particle-appearance.js';
import {starTrailShapes} from './star-trails.js';

const SVG='http://www.w3.org/2000/svg',SPEED=33,STRENGTH=.6,TAU=Math.PI*2;
// Three permanent sample positions: only their size, opacity and angle breathe.
const SAMPLES=Object.freeze([
  {back:1.65,side:.06,size:.31,angle:-.12,phase:0},
  {back:3.05,side:-.1,size:.30,angle:.16,phase:.8},
  {back:4.35,side:.05,size:.29,angle:-.1,phase:1.6},
]);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const number=value=>String(Number(finite(value).toFixed(4)));
const ink=value=>typeof value==='string'&&/^#[\da-f]{6}$/i.test(value)?value:
  '#'+clamp(Math.round(finite(value,0x252720)),0,0xffffff).toString(16).padStart(6,'0');
const attr=(node,key,value)=>{value=String(value);if(node.getAttribute(key)!==value)node.setAttribute(key,value);};
let nextMask=0;
function node(parent,tag){const value=(parent.ownerDocument||document).createElementNS(SVG,tag);parent.append(value);return value;}
function activeLayers(layers){
  const ids=new Set();
  for(const layer of layers||[])if(starTrailShapes(layer.id).length&&finite(layer.weight,1)>0)ids.add(layer.id);
  return ids;
}

/** Small retained SVG adapter for the same fill-only Graphics calls used in
 * battle. Paths are pooled within each active cosmetic rather than recreated
 * each frame. Offscreen points are faded by the group's shared tail mask. */
class SvgGraphics {
  constructor(group){this.group=group;this.paths=[];this.count=0;this.d='';this.dx=0;this.dy=0;}
  start(dx,dy){this.count=0;this.dx=dx;this.dy=dy;}
  fillStyle(color,alpha){this.color=ink(color);this.alpha=alpha;}
  beginPath(){this.d='';}
  moveTo(x,y){this.d+='M'+number(x+this.dx)+' '+number(y+this.dy);}
  lineTo(x,y){this.d+='L'+number(x+this.dx)+' '+number(y+this.dy);}
  closePath(){this.d+='Z';}
  fillPath(){
    const path=this.paths[this.count]??=node(this.group,'path');this.count++;
    attr(path,'d',this.d);attr(path,'fill',this.color);attr(path,'opacity',number(this.alpha));attr(path,'display','');
  }
  finish(){for(let i=this.count;i<this.paths.length;i++)attr(this.paths[i],'display','none');}
}

/** Wardrobe-only fixed composition. The thin ribbon uses the battle renderer;
 * three decorative samples stay anchored to it and breathe in place. This
 * class owns no World, emitter, gameplay RNG, persistence or acquisition UI. */
export class WardrobeShowroom {
  constructor(){this.workspace=new CometWorkspace();this.dom=null;this.reset();}
  reset(){
    this.points=[];this.radius=0;this.clock=0;this.reducedMotion=false;
    if(this.dom){attr(this.dom.svg,'visibility','hidden');this.removeUnusedGroups(new Set());}
  }
  step(dt,{radius,reducedMotion=false}={}){
    if(!(Number.isFinite(radius)&&radius>0)){this.reset();return;}
    if(Math.abs(radius-this.radius)>1e-6){
      this.radius=radius;
      const length=cometProfile(SPEED*radius,radius,radius,STRENGTH).length;
      // A dense straight centerline retains the shared ribbon's taper and nine
      // alpha bands without advancing or ageing any virtual body underneath it.
      this.points=Array.from({length:33},(_,i)=>({x:-length*(1-i/32),y:0,age:0}));
    }
    this.reducedMotion=!!reducedMotion;
    if(!this.reducedMotion)this.clock=(this.clock+clamp(finite(dt),0,.05))%2.8;
  }
  ensureDom(host){
    if(this.dom?.host===host&&this.dom.svg.parentNode!==null)return this.dom;
    // The caller owns this dedicated host. A previous menu renderer may have
    // left its own SVG; replace it once when taking ownership, never per frame.
    while(host.children.length)host.removeChild(host.children[host.children.length-1]);
    const svg=node(host,'svg'),defs=node(svg,'defs'),gradient=node(defs,'linearGradient');
    const maskId='wardrobe-tail-'+(++nextMask),gradientId=maskId+'-fade';
    attr(svg,'aria-hidden','true');attr(svg,'overflow','visible');attr(svg,'stroke','none');
    attr(gradient,'id',gradientId);attr(gradient,'gradientUnits','userSpaceOnUse');attr(gradient,'y1',0);attr(gradient,'y2',0);
    const dark=node(gradient,'stop'),light=node(gradient,'stop');attr(dark,'offset',0);attr(dark,'stop-color','#000');attr(light,'offset',1);attr(light,'stop-color','#fff');
    const mask=node(defs,'mask'),maskRect=node(mask,'rect');attr(mask,'id',maskId);attr(mask,'maskUnits','userSpaceOnUse');attr(mask,'maskContentUnits','userSpaceOnUse');attr(mask,'mask-type','luminance');attr(maskRect,'fill',`url(#${gradientId})`);
    const scene=node(svg,'g'),thin=node(scene,'g');attr(scene,'mask',`url(#${maskId})`);attr(thin,'data-kind','thin-trail');
    this.dom={host,svg,gradient,mask,maskRect,scene,thin:new SvgGraphics(thin),groups:new Map()};return this.dom;
  }
  removeUnusedGroups(ids){
    if(!this.dom)return;
    for(const [id,g] of this.dom.groups)if(!ids.has(id)){this.dom.scene.removeChild(g.group);this.dom.groups.delete(id);}
  }
  paint(host,{pose,length,alpha=1,color=0x252720,layers=[]}={}){
    if(!host)return;
    const dom=this.ensureDom(host),r=finite(pose?.r,this.radius),visible=clamp(finite(length),0,cometProfile(SPEED*r,r,r,STRENGTH).length);
    if(!this.points.length||!(r>0)||!(visible>0)||!(alpha>0)){attr(dom.svg,'visibility','hidden');return;}
    const x=finite(pose.x),y=finite(pose.y),left=x-visible,fade=Math.min(r*.8,visible*.25),height=r*4;
    attr(dom.svg,'viewBox',`0 0 ${number(r*4)} ${number(r*4)}`);attr(dom.svg,'visibility','visible');attr(dom.scene,'opacity',number(clamp(alpha,0,1)));
    attr(dom.gradient,'x1',number(left));attr(dom.gradient,'x2',number(left+fade));
    for(const target of [dom.mask,dom.maskRect]){
      attr(target,'x',number(left));attr(target,'y',number(y-r*2));attr(target,'width',number(visible));attr(target,'height',number(height));
    }
    const profile=cometProfile(SPEED*r,r,r,STRENGTH);
    dom.thin.start(x,y);
    for(const band of this.workspace.bands(this.points,{...profile,length:visible})){
      dom.thin.fillStyle(color,profile.alpha*band.opacity*band.crossAlpha);dom.thin.beginPath();
      band.vertices.forEach((point,i)=>i?dom.thin.lineTo(point.x,point.y):dom.thin.moveTo(point.x,point.y));
      dom.thin.closePath();dom.thin.fillPath();
    }
    dom.thin.finish();
    const ids=activeLayers(layers);this.removeUnusedGroups(ids);
    for(const layer of layers){
      if(!ids.has(layer.id))continue;
      const shapes=starTrailShapes(layer.id);
      let g=dom.groups.get(layer.id);
      if(!g){const group=node(dom.scene,'g');attr(group,'data-star-trail',layer.id);g=new SvgGraphics(group);dom.groups.set(layer.id,g);}
      attr(g.group,'opacity',number(clamp(finite(layer.weight,1),0,1)));
      g.start(0,0);
      for(let i=0;i<SAMPLES.length;i++){
        const sample=SAMPLES[i],phase=this.clock*TAU/2.8+sample.phase;
        const breath=this.reducedMotion?1:.5+.5*Math.cos(phase);
        drawParticleAppearance(g,{shape:shapes[i%shapes.length],x:x-r*sample.back,y:y+r*sample.side,
          radius:r*sample.size*(.66+.34*breath),color:layer.color??color,alpha:.38+.62*breath,
          rotation:sample.angle+(this.reducedMotion?0:.14*Math.sin(phase))});
      }
      g.finish();
    }
  }
}
