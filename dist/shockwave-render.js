const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export const SHOCKWAVE_DURATION=.39;

// Two expanding fronts share the physical radius and end with the second fade.
export function shockwaveFrame(age,r,strength=1,reducedMotion=false){
  const rings=[],juice=clamp(strength,0,1);
  if(age<0||!juice||!(r>0))return {rings};
  if(reducedMotion){
    if(age<.32)rings.push({r,alpha:.5*juice*(1-age/.32)**1.5,width:1.5});
    return {rings};
  }
  for(const start of [0,.07]){
    const t=(age-start)/.32;
    if(t<0||t>=1)continue;
    rings.push({r:r*(.35+.65*(1-(1-t)**3)),alpha:.5*juice*(1-t)**1.5,width:2.5-1.5*t});
  }
  return {rings};
}
