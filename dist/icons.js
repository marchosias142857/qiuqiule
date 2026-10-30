const cream=0xfff9ec;
const geometries=new Map();
const arc=(cx,cy,r,start,end,n=48)=>Array.from({length:n+1},(_,i)=>{const a=start+(end-start)*i/n;return [cx+Math.cos(a)*r,cy+Math.sin(a)*r];});
function rounded(vertices,cut=.22){
  return vertices.flatMap((v,i)=>{
    const prev=vertices[(i+vertices.length-1)%vertices.length],next=vertices[(i+1)%vertices.length];
    const a=v.map((n,k)=>n+(prev[k]-n)*cut),b=v.map((n,k)=>n+(next[k]-n)*cut);
    return Array.from({length:17},(_,j)=>{const t=j/16,u=1-t;return [u*u*a[0]+2*u*t*v[0]+t*t*b[0],u*u*a[1]+2*u*t*v[1]+t*t*b[1]];});
  });
}
export function iconGeometry(type,muted=false){
  const key=type+muted;if(geometries.has(key))return geometries.get(key);
  const fills=[],strokes=[];let width=.075;
  if(type==='play')fills.push(rounded([[.54,0],[-.36,.522],[-.36,-.522]],.24));
  if(type==='sound'){
    fills.push(rounded([[-.44,-.17],[-.22,-.17],[.04,-.39],[.04,.39],[-.22,.17],[-.44,.17]],.17));
    strokes.push(arc(.02,0,.23,-.8,.8),arc(.02,0,.43,-.8,.8));
    if(muted)strokes.push([[-.43,-.46],[.43,.46]]);
  }
  if(type==='settings'){
    const gear=Array.from({length:32},(_,i)=>{const a=i/32*Math.PI*2,r=[.36,.48,.48,.36][i%4];return [Math.cos(a)*r,Math.sin(a)*r];});
    const outline=rounded(gear,.25);strokes.push([...outline,outline[0]],arc(0,0,.17,0,Math.PI*2));width=.067;
  }
  if(type==='restart'){
    const start=-.9,end=4.45,r=.39,tip=[Math.cos(end)*r,Math.sin(end)*r];
    // Rotate only the arrowhead 12 degrees counterclockwise about its fixed tip.
    const headAngle=end-Math.PI/15,nx=-Math.sin(headAngle),ny=Math.cos(headAngle);
    strokes.push(arc(0,0,r,start,end),[[tip[0]-nx*.2-ny*.15,tip[1]-ny*.2+nx*.15],tip,[tip[0]-nx*.2+ny*.15,tip[1]-ny*.2-nx*.15]]);
  }
  if(type==='home')strokes.push([[.34,-.35],[.34,.08],[-.35,.08]],[[-.1,-.17],[-.35,.08],[-.1,.33]]);
  const geometry={fills,strokes,width};geometries.set(key,geometry);return geometry;
}
export function iconMarkup(type,muted=false){
  const {fills,strokes,width}=iconGeometry(type,muted),path=points=>points.map(([x,y],i)=>`${i?'L':'M'}${x} ${y}`).join(' ');
  return `<svg viewBox="-1 -1 2 2" aria-hidden="true" style="fill:none;stroke:none">${fills.map(p=>`<path d="${path(p)}Z" fill="#fff9ec"/>`).join('')}${strokes.map(p=>`<path d="${path(p)}" stroke="#fff9ec" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
}
export function drawIcon(g,type,muted=false,alpha=1){
  const {fills,strokes,width}=iconGeometry(type,muted);
  for(const points of fills){g.fillStyle(cream,alpha);g.beginPath();points.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();g.fillPath();}
  for(const points of strokes){
    g.lineStyle(width,cream,alpha);g.beginPath();points.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.strokePath();
    g.fillStyle(cream,alpha);for(const [x,y] of (points.length<=4?points:[points[0],points.at(-1)]))g.fillCircle(x,y,width/2);
  }
}
export function drawFunctionalBall(g,body,color,type,alpha=1,muted=false){
  // The circle and icon share one transform: position, pulse and impact squash.
  g.save();g.translateCanvas(body.x,body.y);g.scaleCanvas(body.r*(body.sx||1),body.r*(body.sy||1));
  g.fillStyle(color,alpha);g.fillEllipse(0,0,2,2,192);drawIcon(g,type,muted,alpha);g.restore();
}
