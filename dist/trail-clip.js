// Polygon difference for a translucent trail and its convex, already deformed
// body outline. Stitch the surviving boundary back together rather than filling
// half-plane slices: shared slice edges would leave antialias seams in the ink.
const cross=(ax,ay,bx,by)=>ax*by-ay*bx;
const area=points=>points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-p.y*q.x;},0)*.5;
const inside=(point,polygon)=>{
  let hit=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)hit=!hit;
  }
  return hit;
};
const bounds=points=>{
  const b={left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity};
  for(const p of points){b.left=Math.min(b.left,p.x);b.right=Math.max(b.right,p.x);b.top=Math.min(b.top,p.y);b.bottom=Math.max(b.bottom,p.y);}
  return b;
};
const separated=(a,b)=>a.right<b.left||b.right<a.left||a.bottom<b.top||b.bottom<a.top;
const clamp=value=>Math.max(0,Math.min(1,value));
const within=(p,b)=>p.x>=b.left&&p.x<=b.right&&p.y>=b.top&&p.y<=b.bottom;

function convexTest(points,box){
  const origin=points[0],winding=Math.sign(area(points))||1;
  const side=(a,b,p)=>cross(b.x-a.x,b.y-a.y,p.x-a.x,p.y-a.y)*winding;
  return point=>{
    if(!within(point,box)||side(origin,points[1],point)<0||side(origin,points.at(-1),point)>0)return false;
    let low=1,high=points.length-1;
    while(high-low>1){const middle=(low+high)>>1;if(side(origin,points[middle],point)>=0)low=middle;else high=middle;}
    return side(points[low],points[high],point)>=0;
  };
}

function clean(points,epsilon){
  const out=[];
  for(const p of points){
    const last=out.at(-1);
    if(!last||Math.hypot(p.x-last.x,p.y-last.y)>epsilon)out.push(p);
  }
  if(out.length>1&&Math.hypot(out[0].x-out.at(-1).x,out[0].y-out.at(-1).y)<=epsilon)out.pop();
  return out;
}

function segments(points){
  return points.map((a,i)=>{const b=points[(i+1)%points.length];
    return {a,b,dx:b.x-a.x,dy:b.y-a.y,parameters:[0,1],bounds:{left:Math.min(a.x,b.x),right:Math.max(a.x,b.x),top:Math.min(a.y,b.y),bottom:Math.max(a.y,b.y)}};
  });
}

function intersect(a,b,epsilon){
  if(separated(a.bounds,b.bounds))return false;
  const dx=b.a.x-a.a.x,dy=b.a.y-a.a.y;
  const determinant=cross(a.dx,a.dy,b.dx,b.dy),scale=Math.hypot(a.dx,a.dy)*Math.hypot(b.dx,b.dy);
  if(Math.abs(determinant)>scale*1e-12){
    const t=cross(dx,dy,b.dx,b.dy)/determinant,u=cross(dx,dy,a.dx,a.dy)/determinant;
    if(t< -1e-10||t>1+1e-10||u< -1e-10||u>1+1e-10)return false;
    a.parameters.push(clamp(t));b.parameters.push(clamp(u));return true;
  }
  if(Math.abs(cross(dx,dy,a.dx,a.dy))>epsilon*Math.hypot(a.dx,a.dy))return false;
  a.collinear=b.collinear=true;
  // Coincident boundaries need the same endpoints before duplicate edges can
  // be removed. This also handles a trail lying exactly along a flattened edge.
  const aa=a.dx*a.dx+a.dy*a.dy,bb=b.dx*b.dx+b.dy*b.dy;
  let found=false;
  for(const p of [b.a,b.b]){
    const t=((p.x-a.a.x)*a.dx+(p.y-a.a.y)*a.dy)/aa;
    if(t>=-1e-10&&t<=1+1e-10){a.parameters.push(clamp(t));found=true;}
  }
  for(const p of [a.a,a.b]){
    const t=((p.x-b.a.x)*b.dx+(p.y-b.a.y)*b.dy)/bb;
    if(t>=-1e-10&&t<=1+1e-10){b.parameters.push(clamp(t));found=true;}
  }
  return found;
}

function pointAt(segment,t){
  return t===0?segment.a:t===1?segment.b:{x:segment.a.x+segment.dx*t,y:segment.a.y+segment.dy*t};
}
function augmented(segments,epsilon){
  const points=[];
  for(const segment of segments)for(const t of segment.parameters.sort((a,b)=>a-b))if(t<1)points.push(pointAt(segment,t));
  return clean(points,epsilon);
}
function chain(points,from,to){
  const result=[points[from]];
  for(let i=(from+1)%points.length;i!==to;i=(i+1)%points.length)result.push(points[i]);
  result.push(points[to]);return result;
}
function midpoint(points){return {x:(points[0].x+points[1].x)*.5,y:(points[0].y+points[1].y)*.5};}

function simpleCut(as,bs,inSubject,inClip,epsilon){
  if(as.some(segment=>segment.collinear)||bs.some(segment=>segment.collinear))return null;
  const cuts=[];
  for(const segment of as)for(const t of segment.parameters.slice(2)){
    const point=pointAt(segment,t);
    if(!cuts.some(other=>Math.hypot(point.x-other.x,point.y-other.y)<=epsilon*4))cuts.push(point);
    if(cuts.length>2)return null;
  }
  if(cuts.length!==2)return null;
  const a=augmented(as,epsilon),b=augmented(bs,epsilon);
  const index=(points,p)=>points.findIndex(q=>Math.hypot(p.x-q.x,p.y-q.y)<=epsilon*4);
  const ai=cuts.map(p=>index(a,p)),bi=cuts.map(p=>index(b,p));
  if([...ai,...bi].some(i=>i<0)||ai[0]===ai[1]||bi[0]===bi[1])return null;
  const forwards=chain(a,ai[0],ai[1]),backwards=chain(a,ai[1],ai[0]);
  const forwardOutside=!inClip(midpoint(forwards)),backwardOutside=!inClip(midpoint(backwards));
  if(forwardOutside===backwardOutside)return null;
  const kept=forwardOutside?forwards:backwards,start=forwardOutside?1:0,end=1-start;
  const one=chain(b,bi[start],bi[end]),two=chain(b,bi[end],bi[start]).reverse();
  const oneInside=inSubject(midpoint(one)),twoInside=inSubject(midpoint(two));
  if(oneInside===twoInside)return null;
  const outline=kept.concat((oneInside?one:two).slice(1,-1));
  if(area(outline)<0)outline.reverse();
  return [outline];
}

function bridgeHole(outer,hole,epsilon){
  let h=0;
  for(let i=1;i<hole.length;i++)if(hole[i].x>hole[h].x||(hole[i].x===hole[h].x&&hole[i].y<hole[h].y))h=i;
  const point=hole[h];let edge=-1,x=Infinity;
  for(let i=0;i<outer.length;i++){
    const a=outer[i],b=outer[(i+1)%outer.length];
    if((a.y>point.y)===(b.y>point.y))continue;
    const crossing=a.x+(point.y-a.y)*(b.x-a.x)/(b.y-a.y);
    if(crossing>=point.x-epsilon&&crossing<x){x=crossing;edge=i;}
  }
  if(edge<0)return outer;
  const joined=outer.slice(),a=joined[edge],b=joined[(edge+1)%joined.length];
  let anchor;
  if(Math.hypot(x-a.x,point.y-a.y)<=epsilon)anchor=edge;
  else if(Math.hypot(x-b.x,point.y-b.y)<=epsilon)anchor=(edge+1)%joined.length;
  else{anchor=edge+1;joined.splice(anchor,0,{x,y:point.y});}
  // A hole needs a doubled, zero-width bridge. Earcut and nonzero Canvas fills
  // both retain the hole without introducing any independently painted seam.
  const walk=hole.slice(h).concat(hole.slice(0,h),[hole[h]]);
  joined.splice(anchor+1,0,...walk,joined[anchor]);
  return joined;
}

/** Borrow input points read-only. Results are continuous fill polygons; a hole
 * is represented by the standard zero-width bridge used in triangulation. */
export function createTrailClipper(convexOutline){
  if(!Array.isArray(convexOutline)||convexOutline.length<3||convexOutline.length>2048||convexOutline.some(p=>!Number.isFinite(p?.x)||!Number.isFinite(p?.y)))return ()=>[];
  const bb=bounds(convexOutline),scale=Math.max(1,bb.right-bb.left,bb.bottom-bb.top),clip=clean(convexOutline,scale*1e-9);
  if(clip.length<3)return ()=>[];
  const prepared={bb,clip,scale,clipWinding:Math.sign(area(clip))||1,inClip:convexTest(clip,bb),clipSegments:segments(clip)};
  return vertices=>clipPrepared(vertices,prepared);
}

export function clipTrailOutside(vertices,convexOutline){return createTrailClipper(convexOutline)(vertices);}

function clipPrepared(vertices,{bb,clip,scale:clipScale,clipWinding,inClip,clipSegments}){
  if(!Array.isArray(vertices)||vertices.length<3)return [];
  // Real ribbons/contours use at most 384/192 vertices. Fail closed for invalid
  // external geometry instead of allowing nonfinite or unbounded clipping work.
  if(vertices.length>2048||vertices.some(p=>!Number.isFinite(p?.x)||!Number.isFinite(p?.y)))return [];
  const ab=bounds(vertices);
  if(separated(ab,bb))return [vertices];
  const scale=Math.max(clipScale,ab.right-ab.left,ab.bottom-ab.top),epsilon=scale*1e-9;
  const subject=clean(vertices,epsilon);
  if(subject.length<3)return [];
  const subjectWinding=Math.sign(area(subject))||1;
  const inSubject=point=>within(point,ab)&&inside(point,subject);
  for(const segment of clipSegments){segment.parameters.length=2;segment.parameters[0]=0;segment.parameters[1]=1;segment.collinear=false;}
  const as=segments(subject),bs=clipSegments.filter(segment=>!separated(segment.bounds,ab));let crossings=false;
  for(const a of as)for(const b of bs)crossings=intersect(a,b,epsilon)||crossings;
  if(!crossings){
    if(inClip(subject[0]))return [];
    if(!inSubject(clip[0]))return [vertices];
  }
  // A ribbon can fold over itself after a tight rebound. Split those crossings
  // too, so each returned contour describes the filled region without a bridge
  // cutting across the body or an overlapping set of independently drawn slices.
  let folded=false;
  const ordered=as.map((segment,index)=>({segment,index})).sort((a,b)=>a.segment.bounds.left-b.segment.bounds.left);
  for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length;j++){
    const a=ordered[i],b=ordered[j];
    if(b.segment.bounds.left>a.segment.bounds.right)break;
    const gap=Math.abs(a.index-b.index);if(gap===1||gap===as.length-1)continue;
    folded=intersect(a.segment,b.segment,epsilon)||folded;
  }
  if(!folded){const cut=simpleCut(as,clipSegments,inSubject,inClip,epsilon);if(cut)return cut;}
  const nodes=[],grid=new Map(),exact=new Map(),edges=[],unique=new Set(),cell=epsilon*4;
  const node=point=>{
    const exactKey=`${point.x},${point.y}`,retained=exact.get(exactKey);if(retained)return retained;
    const gx=Math.round(point.x/cell),gy=Math.round(point.y/cell);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
      for(const n of grid.get(`${gx+dx},${gy+dy}`)||[])if(Math.hypot(n.x-point.x,n.y-point.y)<=cell){exact.set(exactKey,n);return n;}
    }
    const n={x:point.x,y:point.y,id:nodes.length,out:[]};nodes.push(n);
    const key=`${gx},${gy}`,bucket=grid.get(key)||[];bucket.push(n);grid.set(key,bucket);exact.set(exactKey,n);return n;
  };
  const filled=point=>inSubject(point)&&!inClip(point);
  for(const [index,segment] of [...as,...bs].entries()){
    const parameters=segment.parameters.sort((a,b)=>a-b),length=Math.hypot(segment.dx,segment.dy);
    for(let i=1;i<parameters.length;i++){
      const from=parameters[i-1],to=parameters[i];if((to-from)*length<=epsilon)continue;
      const middle=(from+to)*.5,x=segment.a.x+segment.dx*middle,y=segment.a.y+segment.dy*middle;
      const offset=Math.min(scale*1e-7,(to-from)*length*1e-5),nx=-segment.dy/length*offset,ny=segment.dx/length*offset;
      let left,right;
      if(folded){left=filled({x:x+nx,y:y+ny});right=filled({x:x-nx,y:y-ny});}
      else if(index<as.length){
        const keep=!inClip({x:x+nx*subjectWinding,y:y+ny*subjectWinding});
        left=keep&&subjectWinding>0;right=keep&&subjectWinding<0;
      }else{
        const keep=inSubject({x:x-nx*clipWinding,y:y-ny*clipWinding});
        left=keep&&clipWinding<0;right=keep&&clipWinding>0;
      }
      if(left===right)continue;
      const first=from===0?segment.a:{x:segment.a.x+segment.dx*from,y:segment.a.y+segment.dy*from};
      const last=to===1?segment.b:{x:segment.a.x+segment.dx*to,y:segment.a.y+segment.dy*to};
      const a=node(left?first:last),b=node(left?last:first),key=`${a.id}:${b.id}`;
      if(a===b||unique.has(key))continue;
      const edge={a,b,used:false};unique.add(key);edges.push(edge);a.out.push(edge);
    }
  }
  const loops=[];
  for(const start of edges){
    if(start.used)continue;
    let edge=start;const points=[];
    for(let guard=0;guard<=edges.length;guard++){
      edge.used=true;points.push({x:edge.a.x,y:edge.a.y});
      if(edge.b===start.a){if(points.length>=3&&Math.abs(area(points))>epsilon*epsilon)loops.push(points);break;}
      const reverse=Math.atan2(edge.a.y-edge.b.y,edge.a.x-edge.b.x);
      let next=null,turn=Infinity;
      for(const candidate of edge.b.out){
        if(candidate.used)continue;
        const angle=Math.atan2(candidate.b.y-candidate.a.y,candidate.b.x-candidate.a.x);
        const clockwise=((reverse-angle)%(Math.PI*2)+Math.PI*2)%(Math.PI*2);
        if(clockwise<turn){next=candidate;turn=clockwise;}
      }
      if(!next)break;
      edge=next;
    }
  }
  const outers=loops.filter(loop=>area(loop)>0),holes=loops.filter(loop=>area(loop)<0);
  holes.sort((a,b)=>Math.max(...b.map(p=>p.x))-Math.max(...a.map(p=>p.x)));
  for(const hole of holes){
    let parent=-1,parentArea=Infinity;
    for(let i=0;i<outers.length;i++)if(inside(hole[0],outers[i])){
      const size=Math.abs(area(outers[i]));if(size<parentArea){parent=i;parentArea=size;}
    }
    if(parent>=0)outers[parent]=bridgeHole(outers[parent],hole,epsilon);
  }
  return outers;
}
