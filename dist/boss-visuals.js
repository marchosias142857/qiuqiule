import {clamp,BOSS_TIMING} from './physics.js';

const smooth = value => {
  const t=clamp(value,0,1);
  return clamp(t*t*t*(10+t*(-15+6*t)),0,1);
};
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const toward=(a,b,distance)=>{
  const length=Math.hypot(b.x-a.x,b.y-a.y);
  return mix(a,b,distance/length);
};

function buildCrown(){
  const radius=1.18,width=.82,baseX=.9*width,baseY=-Math.sqrt(radius*radius-baseX*baseX);
  const corners=[
    {x:-baseX,y:baseY},{x:-1.08*width,y:-1.65},{x:-.47*width,y:-1.35},
    {x:0,y:-1.95},{x:.47*width,y:-1.35},{x:1.08*width,y:-1.65},{x:baseX,y:baseY}
  ];
  const bottomTrim=.11,topTrim=.10,steps=16;
  const points=[toward(corners[0],corners[1],bottomTrim)];
  const quadratic=(from,control,to)=>{
    for(let i=1;i<=steps;i++){
      const t=i/steps;
      points.push(mix(mix(from,control,t),mix(control,to,t),t));
    }
  };
  const cubic=(from,a,b,to)=>{
    for(let i=1;i<=steps;i++){
      const t=i/steps;
      points.push(mix(mix(mix(from,a,t),mix(a,b,t),t),mix(mix(a,b,t),mix(b,to,t),t),t));
    }
  };

  // Trim and round the three peaks and two valleys. The quadratic endpoints
  // follow their adjacent straight edges, so all five joins share a tangent.
  for(let i=1;i<corners.length-1;i++){
    const before=toward(corners[i],corners[i-1],topTrim);
    const after=toward(corners[i],corners[i+1],topTrim);
    points.push(before);
    quadratic(before,corners[i],after);
  }

  const right=corners[6],left=corners[0];
  const rightLine=toward(right,corners[5],bottomTrim);
  const rightAngle=Math.atan2(right.y,right.x)-bottomTrim/radius;
  const leftAngle=Math.atan2(left.y,left.x)+bottomTrim/radius;
  const arcPoint=angle=>({x:radius*Math.cos(angle),y:radius*Math.sin(angle)});
  // The arc is traversed clockwise; this is its unit tangent in canvas space.
  const arcTangent=angle=>({x:Math.sin(angle),y:-Math.cos(angle)});
  const rightArc=arcPoint(rightAngle),leftArc=arcPoint(leftAngle);
  const rightTangent=arcTangent(rightAngle),leftTangent=arcTangent(leftAngle);
  const handle=.07;
  points.push(rightLine);
  // The two bottom corners need cubic handles: a chord aimed at the old corner
  // would not share the exact circle tangent and would leave a small kink.
  cubic(rightLine,toward(rightLine,right,handle),
    {x:rightArc.x-rightTangent.x*handle,y:rightArc.y-rightTangent.y*handle},rightArc);
  for(let i=1;i<=32;i++)points.push(arcPoint(rightAngle+(leftAngle-rightAngle)*i/32));
  const leftLine=points[0];
  cubic(leftArc,{x:leftArc.x+leftTangent.x*handle,y:leftArc.y+leftTangent.y*handle},
    toward(leftLine,left,handle),leftLine);
  points.pop(); // The renderer closes the path; avoid a duplicate endpoint.
  return points;
}

const outline=buildCrown();

/**
 * A 150-point crown outline, relative to the player's center, with canvas y down.
 * radius is the player's radius. Close the returned path after its last point.
 * Its untrimmed bottom arc has radius 1.18 * radius about the player center.
 */
export function crownOutline(radius=1){
  return outline.map(point=>({x:point.x*radius,y:point.y*radius}));
}

/**
 * Visual envelope for the shared boss celebration. Time is seconds
 * since celebration began; this helper never controls simulation or player roll.
 * Scale about the crown's center (roughly y=-1.45 * player radius), not the player
 * center, to keep the small entering crown above the ball. Reduced motion keeps
 * the crown at full size and preserves the same soft opacity envelope.
 */
export function crownVisual(seconds,reducedMotion=false){
  const fadeStart=BOSS_TIMING.brake+BOSS_TIMING.spin+BOSS_TIMING.hold;
  const enter=smooth((seconds-BOSS_TIMING.brake)/.20),leave=smooth((seconds-fadeStart)/BOSS_TIMING.fade);
  return {scale:reducedMotion?1:.55+.45*enter,alpha:enter*(1-leave)};
}

function sampleCubic(from,a,b,to,steps=12){
  return Array.from({length:steps},(_,i)=>{
    const t=(i+1)/steps;
    return mix(mix(mix(from,a,t),mix(a,b,t),t),mix(mix(a,b,t),mix(b,to,t),t),t);
  });
}

function buildAngryEye(){
  // A minor circular segment below a straight lid, not a brow plus round eye.
  // Both chord/arc ends are rounded with exact endpoint tangents.
  const radius=.16,lid=.035,half=Math.sqrt(radius*radius-lid*lid),trim=.024;
  const left={x:-half+trim,y:lid},right={x:half-trim,y:lid};
  const start=Math.asin(lid/radius)+trim/radius,end=Math.PI-start;
  const onArc=t=>({x:radius*Math.cos(t),y:radius*Math.sin(t)});
  const tangent=t=>({x:-Math.sin(t),y:Math.cos(t)});
  const a=onArc(start),b=onArc(end),ta=tangent(start),tb=tangent(end),h=.016;
  const points=[left,right,...sampleCubic(right,{x:right.x+h,y:right.y},
    {x:a.x-ta.x*h,y:a.y-ta.y*h},a)];
  for(let i=1;i<=32;i++)points.push(onArc(start+(end-start)*i/32));
  points.push(...sampleCubic(b,{x:b.x+tb.x*h,y:b.y+tb.y*h},{x:left.x-h,y:left.y},left));
  points.pop();
  return points.map(p=>({x:p.x,y:p.y-(radius+lid)/2}));
}

const angryEye=buildAngryEye();
const eyeCenter=side=>({x:(side<0?-1:1)*.29,y:-.08});

/** Filled minor-segment eye. side is -1 (left) or +1 (right); all points are
 * boss-local unit coordinates. open flattens about the eye center; anger tilts
 * the lid downward toward the nose. Close the path after its last point. */
export function bossAngryEyeOutline(side,open=1,anger=1){
  const center=eyeCenter(side),tilt=-(side<0?-1:1)*.36*clamp(anger,0,1);
  const c=Math.cos(tilt),s=Math.sin(tilt),height=clamp(open,0,1);
  return angryEye.map(p=>({x:center.x+p.x*c-p.y*height*s,y:center.y+p.x*s+p.y*height*c}));
}

/** Open spiral polyline at the same eye center. Stroke with a roughly .025-unit
 * width and round caps; turn is radians, normally supplied by bossFacePose. */
export function bossSpiralEye(side,turn=0){
  const sign=side<0?-1:1,center=eyeCenter(side);
  return Array.from({length:81},(_,i)=>{
    const t=i/80,r=.012+.124*t,angle=t*Math.PI*3.5+turn;
    return {x:center.x+sign*Math.cos(angle)*r,y:center.y+Math.sin(angle)*r};
  });
}

// Both primary sides bow outward from root to tip, making a crescent rather
// than a leaf. Their separate roots and the closing edge stay inside the body.
const quadraticArc=(start,control,end)=>({start,control1:mix(start,control,2/3),control2:mix(end,control,2/3),end});
const hornOuter=quadraticArc({x:.17,y:-.28},{x:.34,y:.20},{x:.06,y:.38});
const hornInner=quadraticArc({x:-.35,y:-.28},{x:.04,y:.20},{x:.025,y:.36});
const hornArcs=[
  {role:'outer',...hornOuter},
  {role:'tip',start:hornOuter.end,
    control1:toward(hornOuter.end,{x:2*hornOuter.end.x-hornOuter.control2.x,y:2*hornOuter.end.y-hornOuter.control2.y},.022),
    control2:toward(hornInner.end,{x:2*hornInner.end.x-hornInner.control2.x,y:2*hornInner.end.y-hornInner.control2.y},.022),
    end:hornInner.end},
  {role:'inner',start:hornInner.end,control1:hornInner.control2,control2:hornInner.control1,end:hornInner.start}
];
const horn=[hornOuter.start,...hornArcs.flatMap(arc=>sampleCubic(arc.start,arc.control1,arc.control2,arc.end,arc.role==='tip'?24:80))];

function hornTransform(side,growth){
  const sign=side<0?-1:1,temple=.62,up=Math.sqrt(1-temple*temple);
  const radial={x:sign*temple,y:-up},tangent={x:sign*up,y:temple},g=clamp(growth,0,1);
  return p=>({
    x:radial.x*(.985+p.y*g)+tangent.x*p.x*g,
    y:radial.y*(.985+p.y*g)+tangent.y*p.x*g
  });
}

/** The two primary Bezier sides and small rounded tip backing bossHornOutline,
 * in boss-local coordinates. Each piece has role, start, control1, control2 and
 * end fields. The final hidden root edge is supplied by closing the path. */
export function bossHornCurves(side,growth=1){
  const transform=hornTransform(side,growth);
  return hornArcs.map(({role,...arc})=>({role,...Object.fromEntries(Object.entries(arc).map(([name,p])=>[name,transform(p)]))}));
}

/** Filled cosmetic horn; growth expands only its local shape, leaving its base
 * attached to the boss. Full radial protrusion is about .37 boss radii. This
 * helper creates drawing points only and has no collision/body side effects. */
export function bossHornOutline(side,growth=1){
  return horn.map(hornTransform(side,growth));
}

/** Pure presentation state: times must use the simulation clock so pause freezes
 * the pose. entryTime is elapsed boss-entry time (Infinity once entry finishes).
 * Body radius multiplies scale, body/face opacity multiplies alpha exactly once.
 * Face alphas are relative to that opacity. For angryScale, scale eye points
 * around their own eye center (side*.29,-.08), never around the boss center. */
export function bossFacePose({entryTime=Infinity,stunned=false,stunnedTime=0,time=0,reducedMotion=false}={}){
  const body=smooth(entryTime/.60),eyeOpen=smooth((entryTime-.50)/.20);
  const anger=smooth((entryTime-.60)/(BOSS_TIMING.entry-.60));
  const stun=stunned?smooth(stunnedTime/.24):0;
  return {
    alpha:body,scale:body,eyeOpen,anger,
    angryAlpha:eyeOpen*(1-stun),angryScale:1-.20*stun,
    spiralAlpha:eyeOpen*stun,spiralTurn:reducedMotion?0:time*1.8,
    hornScale:smooth((entryTime-.55)/(BOSS_TIMING.entry-.55))
  };
}
