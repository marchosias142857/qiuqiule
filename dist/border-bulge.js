// All coordinates below are presentation copies in CSS pixels. No collision
// bounds, body positions or physics clocks are changed by this module.
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const TAU=Math.PI*2,MAX_SLOPE=Math.sin(Math.PI/18);
const smooth=t=>t*t*(3-2*t);

export function wallBulgeSpec({power,bank=0,unit,strength=.6,reducedMotion=false,auxiliary=false}={}){
  if(auxiliary||!Number.isFinite(power)||power<=.25||!Number.isFinite(unit)||unit<=0)return null;
  const intensity=clamp(finite(strength),0,1),charged=bank>0;
  if(!intensity)return null;
  const peak=unit*(charged?7/30:7/60)*clamp((power-.25)/.75,0,1)**1.5*intensity*(reducedMotion?.5:1);
  return {peak,halfWidth:unit*(charged?3:2.5),duration:charged?.3:.18,bank:charged,reducedMotion:!!reducedMotion};
}

const BANK_TIMES=[0,.033,.075,.15,.225,.3];
const BANK_VALUES=[1,1,0,-.25,-.05,0];
// Shape-preserving Hermite tangents keep the single negative lobe monotone
// between its extrema, with a continuous derivative at every timing node.
const BANK_SLOPES=BANK_TIMES.map((time,i)=>{
  if(i===0||i===BANK_TIMES.length-1)return 0;
  const a=time-BANK_TIMES[i-1],b=BANK_TIMES[i+1]-time;
  const before=(BANK_VALUES[i]-BANK_VALUES[i-1])/a,after=(BANK_VALUES[i+1]-BANK_VALUES[i])/b;
  if(before*after<=0)return 0;
  const w1=2*b+a,w2=b+2*a;
  return (w1+w2)/(w1/before+w2/after);
});

export function wallBulgeEnvelope(age,{bank=false,reducedMotion=false}={}){
  const t=Math.max(0,finite(age));
  if(!bank){
    if(t>=.18)return 0;
    const tail=t<=.15?1:1-smooth((t-.15)/.03);
    return Math.exp(-t/.06)*tail;
  }
  if(t>=.3)return 0;
  if(reducedMotion)return 1-smooth(t/.3);
  let i=0;while(i<BANK_TIMES.length-2&&t>BANK_TIMES[i+1])i++;
  const h=BANK_TIMES[i+1]-BANK_TIMES[i],x=(t-BANK_TIMES[i])/h;
  const x2=x*x,x3=x2*x;
  return (2*x3-3*x2+1)*BANK_VALUES[i]+(x3-2*x2+x)*h*BANK_SLOPES[i]
    +(-2*x3+3*x2)*BANK_VALUES[i+1]+(x3-x2)*h*BANK_SLOPES[i+1];
}

export function wallBulgeHeight(state){
  return finite(state?.peak)*wallBulgeEnvelope(state?.age,state||{});
}

function geometry(frame){
  if(!frame||![frame.left,frame.top,frame.right,frame.bottom].every(Number.isFinite))return null;
  const {left,top,right,bottom}=frame,w=right-left,h=bottom-top;
  if(w<=0||h<=0)return null;
  const r=clamp(finite(frame.cornerRadius,22),0,Math.min(w,h)/2),parts=[];
  let length=0;
  const line=(x,y,dx,dy,size,nx,ny)=>{
    if(size>0){parts.push({start:length,length:size,x,y,dx,dy,nx,ny});length+=size;}
  };
  const arc=(x,y,angle)=>{
    if(r>0){parts.push({start:length,length:r*Math.PI/2,x,y,angle,r});length+=r*Math.PI/2;}
  };
  line(left+r,top,1,0,w-2*r,0,-1);arc(right-r,top+r,-Math.PI/2);
  line(right,top+r,0,1,h-2*r,1,0);arc(right-r,bottom-r,0);
  const bottomStart=length;
  line(right-r,bottom,-1,0,w-2*r,0,1);arc(left+r,bottom-r,Math.PI/2);
  line(left,bottom-r,0,-1,h-2*r,-1,0);arc(left+r,top+r,Math.PI);
  return {left,top,right,bottom,r,w,h,parts,length,bottomStart};
}

function onPart(part,distance){
  if(part.r){
    const a=part.angle+distance/part.r,nx=Math.cos(a),ny=Math.sin(a);
    return {x:part.x+nx*part.r,y:part.y+ny*part.r,nx,ny};
  }
  return {x:part.x+part.dx*distance,y:part.y+part.dy*distance,nx:part.nx,ny:part.ny};
}

function pointAt(g,s){
  const d=((s%g.length)+g.length)%g.length;
  const part=g.parts.find(p=>d<=p.start+p.length+1e-10)||g.parts[g.parts.length-1];
  return onPart(part,clamp(d-part.start,0,part.length));
}

function project(g,x,y){
  let best=null;
  for(const part of g.parts){
    let along;
    if(part.r){
      const raw=Math.atan2(y-part.y,x-part.x);
      let angle=raw;
      while(angle<part.angle-Math.PI)angle+=TAU;
      while(angle>part.angle+Math.PI)angle-=TAU;
      angle=clamp(angle,part.angle,part.angle+Math.PI/2);
      along=(angle-part.angle)*part.r;
    }else along=clamp((x-part.x)*part.dx+(y-part.y)*part.dy,0,part.length);
    const p=onPart(part,along),distance=(p.x-x)**2+(p.y-y)**2;
    if(!best||distance<best.distance)best={...p,s:part.start+along,distance};
  }
  return best;
}

function taper(distance,width){
  if(distance<=0)return {value:0,derivative:0};
  if(distance>=width)return {value:1,derivative:0};
  const t=distance/width;
  return {value:smooth(t),derivative:6*t*(1-t)/width};
}

function multiply(a,b){
  return {value:a.value*b.value,derivative:a.derivative*b.value+a.value*b.derivative};
}

// The original rounded rectangle is C1 but its curvature changes at straight /
// arc joins. A fixed contact normal makes the added displacement itself C1 at
// those joins; using a different normal at each sample would create a kink.
function displacement(s,g,states,start,end,open){
  let x=0,y=0,dx=0,dy=0;
  const maximum=Math.max(0,...states.map(state=>Math.abs(state.height)));
  for(const state of states){
    let delta=s-state.s;
    if(!open)delta=((delta+g.length/2)%g.length+g.length)%g.length-g.length/2;
    if(Math.abs(delta)>=state.halfWidth)continue;
    const angle=Math.PI*delta/state.halfWidth;
    let weight={value:(1+Math.cos(angle))/2,derivative:-Math.PI*Math.sin(angle)/(2*state.halfWidth)};
    if(open){
      weight=multiply(weight,taper(s-start,state.halfWidth));
      const right=taper(end-s,state.halfWidth);right.derivative*=-1;
      weight=multiply(weight,right);
    }
    if(!g.r){
      // An intentionally square frame has no unique corner normal. Keep its
      // vertices fixed and meet each adjacent straight edge with zero slope.
      for(const part of g.parts){
        let d=((s-part.start+g.length/2)%g.length+g.length)%g.length-g.length/2;
        const factor=taper(Math.abs(d),Math.min(state.halfWidth,g.w/2,g.h/2));
        factor.derivative*=Math.sign(d);weight=multiply(weight,factor);
      }
    }
    const targetX=state.nx*state.height,targetY=state.ny*state.height;
    const influence=Math.abs(state.height)/maximum;
    // Stable input order gives smooth overlap without adding heights. This is
    // a convex blend, so it cannot exceed the largest single-contact height.
    // Influence vanishes with current height, including the bank zero crossing.
    // A dying contact must never keep masking an earlier overlapping contact.
    dx=dx*(1-influence*weight.value)+(targetX-influence*x)*weight.derivative;
    dy=dy*(1-influence*weight.value)+(targetY-influence*y)*weight.derivative;
    x=x*(1-influence*weight.value)+targetX*weight.value;
    y=y*(1-influence*weight.value)+targetY*weight.value;
  }
  return {x,y,dx,dy};
}

export function buildBulgedBorder(frame,gap,bulges=[],{maxStep=2}={}){
  const g=geometry(frame);if(!g)return {paths:[]};
  const gapLeft=gap?clamp(finite(gap.left,g.left+g.r),g.left+g.r,g.right-g.r):0;
  const gapRight=gap?clamp(finite(gap.right,g.right-g.r),g.left+g.r,g.right-g.r):0;
  const open=!!gap&&gapRight>gapLeft;
  // Walk clockwise from the left lip of a bottom gap, around the entire frame
  // to its right lip. No line is ever drawn across the missing section.
  const start=open?g.bottomStart+(g.right-g.r-gapLeft):0;
  const end=open?g.bottomStart+(g.right-g.r-gapRight)+g.length:g.length;
  const states=[];
  for(const source of bulges){
    if(source?.auxiliary)continue;
    const halfWidth=Math.min(finite(source?.halfWidth),g.length/2);
    const height=finite(source?.height);
    if(halfWidth<=0||Math.abs(height)<1e-10)continue;
    const x=finite(source.contactX,finite(source.x,(g.left+g.right)/2));
    const y=finite(source.contactY,finite(source.y,(g.top+g.bottom)/2));
    const contact=project(g,x,y);
    let s=contact.s;
    if(open&&s<start)s+=g.length;
    if(open&&(s<start||s>end))continue;
    states.push({s,nx:contact.nx,ny:contact.ny,halfWidth,height});
  }
  const widthStep=states.length?Math.min(...states.map(state=>state.halfWidth/16)):2;
  const step=Math.min(clamp(finite(maxStep,2),.001,2),Math.max(.001,widthStep)),breaks=[start,end];
  for(const part of g.parts){
    let s=part.start;while(s<start)s+=g.length;
    if(s>start&&s<end)breaks.push(s);
  }
  for(const state of states)for(const offset of [-1,-.5,0,.5,1]){
    let s=state.s+offset*state.halfWidth;
    if(!open){while(s<start)s+=g.length;while(s>end)s-=g.length;}
    if(s>start&&s<end)breaks.push(s);
  }
  breaks.sort((a,b)=>a-b);
  const samples=[];
  for(let i=0;i<breaks.length-1;i++){
    const from=breaks[i],to=breaks[i+1];if(to-from<1e-8)continue;
    const midpoint=((from+to)/2)%g.length;
    const part=g.parts.find(part=>midpoint>=part.start&&midpoint<=part.start+part.length);
    const intervalStep=part?.r?Math.min(step,Math.max(.001,part.r*Math.PI/96)):step;
    const count=Math.ceil((to-from)/intervalStep);
    for(let k=0;k<count;k++)samples.push(from+(to-from)*k/count);
  }
  samples.push(end);
  let largestSlope=0;
  const values=samples.map(s=>{
    const p=pointAt(g,s),d=displacement(s,g,states,start,end,open);
    largestSlope=Math.max(largestSlope,Math.hypot(d.dx,d.dy));
    return {p,d};
  });
  // |D'| <= sin(10°) bounds the direction change of the frame tangent by 10°,
  // including overlaps and gap/sharp-corner tapers. Keep a sampling margin.
  const scale=Math.min(1,MAX_SLOPE*.98/(largestSlope||1));
  const points=values.map(({p,d})=>({x:p.x+d.x*scale,y:p.y+d.y*scale}));
  if(!open&&points.length)points[points.length-1]={...points[0]};
  return {paths:[{points,closed:!open}]};
}
