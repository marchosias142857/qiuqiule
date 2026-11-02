import {skinContour} from './skins.js';
import {paintPhoto} from './skin-render.js';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const SHAPES=[0,6,7,8,9,10,11,12,13,14,15];
const VERTEX=`
attribute vec2 a_point;
attribute vec2 a_uv;
uniform vec4 u_turn;
uniform vec3 u_shape;
varying mediump vec2 v_uv;
void main(){
  vec2 p=vec2(a_point.x*u_turn.x-a_point.y*u_turn.y,
              a_point.x*u_turn.y+a_point.y*u_turn.x);
  vec2 local=vec2(p.x*u_turn.z+p.y*u_turn.w,
                 -p.x*u_turn.w+p.y*u_turn.z);
  float radius=length(local);
  if(radius>0.000000000001){
    float front=max(0.0,local.x/radius);
    float weight=front*front*front;
    local.x+=0.95*u_shape.x*weight*(2.0-front)*radius;
    local.y*=1.0-0.15*u_shape.x*weight;
  }
  local*=vec2(1.0-u_shape.y,1.0+0.7*u_shape.y);
  p=vec2(local.x*u_turn.z-local.y*u_turn.w,
         local.x*u_turn.w+local.y*u_turn.z)/u_shape.z;
  gl_Position=vec4(p.x,-p.y,0.0,1.0);
  v_uv=a_uv;
}`;
const FRAGMENT=`
precision mediump float;
uniform sampler2D u_image;
varying mediump vec2 v_uv;
void main(){gl_FragColor=texture2D(u_image,v_uv);}
`;

/** Precompute one shared-edge fan. UVs stay in the original image space. */
export function photoMeshData(contour,reuse){
  if(!Array.isArray(contour)||contour.length<3)return null;
  let extent=0,radius=0;
  for(const point of contour){
    if(!Number.isFinite(point.x)||!Number.isFinite(point.y))return null;
    extent=Math.max(extent,Math.abs(point.x),Math.abs(point.y));
    radius=Math.max(radius,Math.hypot(point.x,point.y));
  }
  if(!(extent>0))return null;
  const count=contour.length+2;
  const vertices=reuse?.length===count*4?reuse:new Float32Array(count*4);
  vertices.set([0,0,.5,.5],0);
  for(let i=0;i<=contour.length;i++){
    const p=contour[i%contour.length],offset=(i+1)*4;
    vertices[offset]=p.x;vertices[offset+1]=p.y;
    vertices[offset+2]=(p.x/extent+1)/2;vertices[offset+3]=(p.y/extent+1)/2;
  }
  const sampled=segments=>contour.length<=segments?contour:
    Array.from({length:segments},(_,i)=>contour[Math.floor(i*contour.length/segments)]);
  return {vertices,count,extent,radius,coarse64:sampled(64),coarse96:sampled(96)};
}

/** A local backing surface with room for the full continuous pull range.
 * Fixed breathing/pull allowance avoids resizing the canvas every frame. */
export function photoFrame(mesh,pose,scale=1,maxPixels=1024){
  const r=Number.isFinite(pose.r)?Math.max(0,pose.r):1,squash=pose.squash||0;
  const stretch=Math.max(1.5,Math.abs(1-squash),Math.abs(1+squash*.7));
  const halfUnit=mesh.radius*1.95*stretch+.04;
  const size=Math.max(1,2*r*halfUnit);
  const pixels=Math.min(maxPixels,Math.max(32,Math.ceil(size*clamp(scale||1,1,3)/32)*32));
  return {halfUnit,size,pixels,left:(pose.x||0)-size/2,top:(pose.y||0)-size/2};
}

/** Caches image pixels and the eleven skin meshes once. Continuous deformation
 * is a handful of uniforms and one GPU draw, never an atlas of all drag poses. */
export class PhotoRenderer {
  constructor(canvas,{maxPixels=1024}={}){
    this.canvas=canvas;this.maxPixels=clamp(maxPixels,128,2048);
    this.image=null;this.meshes=new Map();this.dynamic=null;
    this.gl=null;this.glAcquired=false;this.lost=false;
    this.program=null;this.texture=null;this.fallback=null;this.context2d=null;
    this.lastDraw=null;this.backend='none';
    this.counts={drawCalls:0,frames:0,textureUploads:0,meshUploads:0};
    this.onLost=event=>{
      event.preventDefault?.();this.lost=true;this.lastDraw=null;
      // The browser has already discarded these GL resources.
      this._dropResources(false);this.canvas.hidden=true;
      if(this.image)this._activateFallback();
    };
    this.onRestored=()=>{
      this.lost=false;this.lastDraw=null;
      if(this.image){
        try{this._initializeGL();this._removeFallback();}
        catch{this._dropResources(true);this._activateFallback();}
      }
    };
    canvas.addEventListener?.('webglcontextlost',this.onLost);
    canvas.addEventListener?.('webglcontextrestored',this.onRestored);
    this.hide();
  }

  get stats(){return {...this.counts,backend:this.backend,cachedMeshes:this.meshes.size,
    transientMeshes:this.dynamic?1:0,hasImage:!!this.image,
    backingPixels:(this.fallback||this.canvas).width*(this.fallback||this.canvas).height};}

  setImage(image){
    if(image===this.image)return !!image;
    this.clear();
    if(!image)return false;
    const width=image.naturalWidth||image.videoWidth||image.width;
    const height=image.naturalHeight||image.videoHeight||image.height;
    if(!(width>0&&height>0))return false;
    this.image=image;
    try{
      if(this.lost)throw new Error('Context unavailable');
      if(!this.gl){
        this.gl=this.canvas.getContext('webgl',{alpha:true,antialias:true,depth:false,stencil:false,
          premultipliedAlpha:true,preserveDrawingBuffer:true,powerPreference:'low-power'});
        this.glAcquired=!!this.gl;
      }
      if(!this.gl)throw new Error('WebGL unavailable');
      this._initializeGL();
    }catch{
      this._dropResources(!this.lost);this._activateFallback();
    }
    return this.backend!=='none';
  }

  _compile(type,source){
    const gl=this.gl,shader=gl.createShader(type);
    gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){
      gl.deleteShader(shader);throw new Error('Photo shader unavailable');
    }
    return shader;
  }

  _initializeGL(){
    const gl=this.gl;
    if(!gl||this.lost||!this.image)throw new Error('Photo context unavailable');
    this._dropResources(true);
    let vertex=null,fragment=null;
    try{
      vertex=this._compile(gl.VERTEX_SHADER,VERTEX);fragment=this._compile(gl.FRAGMENT_SHADER,FRAGMENT);
      this.program=gl.createProgram();gl.attachShader(this.program,vertex);gl.attachShader(this.program,fragment);
      gl.linkProgram(this.program);
      if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error('Photo program unavailable');
    }finally{
      if(vertex)gl.deleteShader(vertex);if(fragment)gl.deleteShader(fragment);
    }
    this.locations={point:gl.getAttribLocation(this.program,'a_point'),uv:gl.getAttribLocation(this.program,'a_uv'),
      turn:gl.getUniformLocation(this.program,'u_turn'),shape:gl.getUniformLocation(this.program,'u_shape'),
      image:gl.getUniformLocation(this.program,'u_image')};
    this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.image);
    this.counts.textureUploads++;
    for(const sides of SHAPES){
      const contour=skinContour(sides),mesh=photoMeshData(contour);
      mesh.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);
      gl.bufferData(gl.ARRAY_BUFFER,mesh.vertices,gl.STATIC_DRAW);
      this.counts.meshUploads++;this.meshes.set(contour,mesh);
    }
    this.backend='webgl';this.lastDraw=null;
  }

  _activateFallback(){
    let surface=this.canvas;
    if(this.glAcquired){
      if(!this.fallback){
        const owner=this.canvas.ownerDocument||globalThis.document;
        if(!owner?.createElement){this.backend='none';return;}
        this.fallback=owner.createElement('canvas');
        this.fallback.hidden=true;
        this.fallback.setAttribute?.('aria-hidden','true');
        this.fallback.id='player-photo-fallback';
        this.canvas.parentNode?.insertBefore(this.fallback,this.canvas.nextSibling);
      }
      surface=this.fallback;this.canvas.hidden=true;
    }
    this.context2d=surface.getContext('2d');
    this.backend=this.context2d?'2d':'none';this.lastDraw=null;
    if(!this.meshes.size)for(const sides of SHAPES){const contour=skinContour(sides);this.meshes.set(contour,photoMeshData(contour));}
  }

  _mesh(contour){
    const fixed=this.meshes.get(contour);
    if(fixed)return fixed;
    if(this.dynamic?.contour===contour)return this.dynamic;
    const mesh=photoMeshData(contour,this.dynamic?.vertices);
    if(!mesh)return null;
    mesh.contour=contour;mesh.buffer=this.dynamic?.buffer||null;
    if(this.backend==='webgl'){
      const gl=this.gl;mesh.buffer ||= gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);gl.bufferData(gl.ARRAY_BUFFER,mesh.vertices,gl.DYNAMIC_DRAW);
      this.counts.meshUploads++;
    }
    this.dynamic=mesh;return mesh;
  }

  draw(contour,pose={}, {scale=1,clip=null}={}){
    if(!this.image||this.backend==='none'||!(pose.r>0)){this.hide();return false;}
    const mesh=this._mesh(contour);
    if(!mesh){this.hide();return false;}
    const frame=photoFrame(mesh,pose,scale,this.maxPixels),surface=this.fallback||this.canvas;
    const style=surface.style;
    Object.assign(style,{position:'fixed',inset:'auto',left:'0',top:'0',
      transform:`translate3d(${frame.left}px,${frame.top}px,0)`,
      width:frame.size+'px',height:frame.size+'px',pointerEvents:'none',zIndex:this.canvas.style.zIndex||'3'});
    style.clipPath=clip?`inset(${Math.max(0,clip.top-frame.top)}px ${Math.max(0,frame.left+frame.size-clip.right)}px ${Math.max(0,frame.top+frame.size-clip.bottom)}px ${Math.max(0,clip.left-frame.left)}px)`:'none';
    surface.hidden=false;
    const resized=surface.width!==frame.pixels||surface.height!==frame.pixels;
    if(resized){surface.width=surface.height=frame.pixels;this.lastDraw=null;}
    const roll=pose.roll||0,angle=pose.deformAngle??pose.angle??0;
    const pull=clamp(pose.pullAmount||0,0,1),squash=pose.squash||0;
    const meshContour=this.backend==='2d'
      ?Math.abs(squash)>.3||pose.r>96?contour:pose.r>48?mesh.coarse96:mesh.coarse64:null;
    const key=[mesh,frame.halfUnit,frame.pixels,roll,angle,pull,squash,meshContour?.length||0];
    if(this.lastDraw&&key.every((value,i)=>value===this.lastDraw[i]))return true;
    let drawCalls=1;
    if(this.backend==='webgl'){
      const gl=this.gl;
      if(gl.isContextLost?.()){this.hide();return false;}
      gl.viewport(0,0,frame.pixels,frame.pixels);
      gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);gl.disable(gl.DEPTH_TEST);gl.disable(gl.SCISSOR_TEST);
      gl.useProgram(this.program);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);
      gl.uniform1i(this.locations.image,0);
      gl.uniform4f(this.locations.turn,Math.cos(roll),Math.sin(roll),Math.cos(angle),Math.sin(angle));
      gl.uniform3f(this.locations.shape,pull,squash,frame.halfUnit);
      gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);
      gl.enableVertexAttribArray(this.locations.point);gl.vertexAttribPointer(this.locations.point,2,gl.FLOAT,false,16,0);
      gl.enableVertexAttribArray(this.locations.uv);gl.vertexAttribPointer(this.locations.uv,2,gl.FLOAT,false,16,8);
      gl.drawArrays(gl.TRIANGLE_FAN,0,mesh.count);
    }else{
      const ctx=this.context2d,factor=frame.pixels/frame.size;
      // Keep the exact outer clip. Small fallback balls need fewer texture
      // wedges; large or strongly squashed poses retain the full fan.
      ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,frame.pixels,frame.pixels);
      ctx.setTransform(factor,0,0,factor,0,0);
      paintPhoto(ctx,this.image,contour,{...pose,x:frame.size/2,y:frame.size/2},{meshContour});
      drawCalls=pull>1e-6?meshContour.length:1;
    }
    this.counts.drawCalls+=drawCalls;this.counts.frames++;this.lastDraw=key;return true;
  }

  hide(){this.canvas.hidden=true;if(this.fallback)this.fallback.hidden=true;}

  _dropResources(remove){
    const gl=this.gl;
    if(remove&&gl){
      gl.useProgram(null);gl.bindTexture(gl.TEXTURE_2D,null);gl.bindBuffer(gl.ARRAY_BUFFER,null);
      if(this.texture)gl.deleteTexture(this.texture);
      for(const mesh of this.meshes.values())if(mesh.buffer)gl.deleteBuffer(mesh.buffer);
      if(this.dynamic?.buffer)gl.deleteBuffer(this.dynamic.buffer);
      if(this.program)gl.deleteProgram(this.program);
    }
    this.texture=null;this.program=null;this.locations=null;
    this.meshes.clear();this.dynamic=null;this.lastDraw=null;
  }

  _removeFallback(){
    if(this.fallback){this.fallback.width=this.fallback.height=1;this.fallback.remove?.();this.fallback=null;}
    this.context2d=null;
  }

  clear(){
    this.hide();this._dropResources(!this.lost);this._removeFallback();
    this.image=null;this.backend='none';this.canvas.width=this.canvas.height=1;
  }

  dispose(){
    this.clear();this.canvas.removeEventListener?.('webglcontextlost',this.onLost);
    this.canvas.removeEventListener?.('webglcontextrestored',this.onRestored);
  }
}
