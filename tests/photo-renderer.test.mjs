import test from 'node:test';
import assert from 'node:assert/strict';
import {PhotoRenderer,photoMeshData,photoFrame} from '../dist/photo-renderer.js';
import {skinContour,morphSkinContour} from '../dist/skins.js';
import {transformSkinPoint} from '../dist/skin-render.js';

const near=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const pose={x:140,y:210,r:40,roll:0,deformAngle:0,pullAmount:0,squash:0};
const photo={width:768,height:768};

function graphics(){
  const calls=[],textures=new Set(),buffers=new Set(),programs=new Set();
  let id=0;
  const gl={calls,textures,buffers,programs,failCompile:false,failLink:false,lost:false,
    createTexture(){const object={id:++id};textures.add(object);return object;},
    deleteTexture(object){textures.delete(object);calls.push(['deleteTexture',object]);},
    createBuffer(){const object={id:++id};buffers.add(object);return object;},
    deleteBuffer(object){buffers.delete(object);calls.push(['deleteBuffer',object]);},
    createProgram(){const object={id:++id};programs.add(object);return object;},
    deleteProgram(object){programs.delete(object);calls.push(['deleteProgram',object]);},
    createShader:()=>({id:++id}),getShaderParameter:()=>!gl.failCompile,
    getProgramParameter:()=>!gl.failLink,getAttribLocation:(_,name)=>name==='a_point'?0:1,
    getUniformLocation:(_,name)=>name,isContextLost:()=>gl.lost,
  };
  for(const name of ['VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS','TEXTURE_2D',
    'UNPACK_FLIP_Y_WEBGL','UNPACK_PREMULTIPLY_ALPHA_WEBGL','TEXTURE_WRAP_S','TEXTURE_WRAP_T',
    'CLAMP_TO_EDGE','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','LINEAR','RGBA','UNSIGNED_BYTE',
    'ARRAY_BUFFER','STATIC_DRAW','DYNAMIC_DRAW','COLOR_BUFFER_BIT','BLEND','CULL_FACE','DEPTH_TEST',
    'SCISSOR_TEST','TEXTURE0','FLOAT','TRIANGLE_FAN'])gl[name]=name;
  for(const name of ['shaderSource','compileShader','deleteShader','attachShader','linkProgram','bindTexture',
    'pixelStorei','texParameteri','texImage2D','bindBuffer','bufferData','viewport','clearColor','clear',
    'disable','useProgram','activeTexture','uniform1i','uniform4f','uniform3f','enableVertexAttribArray',
    'vertexAttribPointer','drawArrays'])gl[name]=(...args)=>calls.push([name,...args]);
  return gl;
}

function context2d(){
  const calls=[],ctx={calls,globalAlpha:1};
  for(const name of ['setTransform','clearRect','save','restore','beginPath','closePath','moveTo',
    'lineTo','clip','transform','drawImage'])ctx[name]=(...args)=>calls.push([name,...args]);
  return ctx;
}

function surface(gl=graphics()){
  const events=new Map(),ctx=context2d(),children=[];
  const canvas={width:300,height:150,hidden:false,style:{zIndex:'40'},events,children,ctx,
    getContext(type,options){if(type==='webgl'){canvas.options=options;return gl;}return type==='2d'?ctx:null;},
    addEventListener:(type,fn)=>events.set(type,fn),removeEventListener:type=>events.delete(type),
    setAttribute(){},remove(){canvas.removed=true;},
    parentNode:{insertBefore(child){children.push(child);}},
  };
  canvas.ownerDocument={createElement:()=>surface(null)};
  return canvas;
}

test('cached fan preserves original image coordinates and closes exactly once',()=>{
  for(const sides of [0,6,7,15]){
    const contour=skinContour(sides),mesh=photoMeshData(contour);
    assert.equal(mesh.count,contour.length+2);
    assert.deepEqual(Array.from(mesh.vertices.slice(0,4)),[0,0,.5,.5]);
    for(let i=0;i<contour.length;i++){
      const offset=(i+1)*4,p=contour[i];
      near(mesh.vertices[offset],p.x);near(mesh.vertices[offset+1],p.y);
      near(mesh.vertices[offset+2],(p.x/mesh.extent+1)/2);
      near(mesh.vertices[offset+3],(p.y/mesh.extent+1)/2);
    }
    assert.deepEqual(Array.from(mesh.vertices.slice(-4)),Array.from(mesh.vertices.slice(4,8)));
  }
  assert.equal(photoMeshData([]),null);
  assert.equal(photoMeshData([{x:0,y:0},{x:NaN,y:1},{x:1,y:0}]),null);
});

test('local backing bounds contain continuous rolled pulls and squash without per-frame resize',()=>{
  for(const sides of [0,6,9,15]){
    const contour=skinContour(sides),mesh=photoMeshData(contour);
    const baseline=photoFrame(mesh,pose,3);
    for(const pullAmount of [0,.3,1])for(const squash of [-.25,0,.25])for(const roll of [0,.7,2.4])for(const deformAngle of [-2.1,0,1.3]){
      const p={...pose,pullAmount,squash,roll,deformAngle},frame=photoFrame(mesh,p,3);
      assert.equal(frame.pixels,baseline.pixels);
      assert.equal(frame.size,baseline.size);
      assert.ok(frame.pixels<=1024);
      for(const point of contour){
        const projected=transformSkinPoint(point,p);
        assert.ok(projected.x>frame.left&&projected.x<frame.left+frame.size);
        assert.ok(projected.y>frame.top&&projected.y<frame.top+frame.size);
      }
    }
  }
});

test('image upload and eleven prewarmed meshes are reused across movement and deformation',()=>{
  const gl=graphics(),canvas=surface(gl),renderer=new PhotoRenderer(canvas);
  assert.equal(renderer.setImage(photo),true);
  assert.equal(renderer.stats.backend,'webgl');assert.equal(renderer.stats.textureUploads,1);
  assert.equal(renderer.stats.cachedMeshes,11);assert.equal(renderer.stats.meshUploads,11);
  assert.equal(canvas.options.preserveDrawingBuffer,true);
  assert.equal(canvas.options.premultipliedAlpha,true);
  assert.deepEqual(gl.calls.filter(c=>c[0]==='pixelStorei'),[
    ['pixelStorei','UNPACK_FLIP_Y_WEBGL',false],['pixelStorei','UNPACK_PREMULTIPLY_ALPHA_WEBGL',true]
  ]);
  renderer.draw(skinContour(6),pose,{scale:3});
  assert.equal(gl.calls.filter(c=>c[0]==='drawArrays').length,1);
  renderer.hide();renderer.draw(skinContour(6),{...pose,x:300,y:400},{scale:3});
  assert.equal(renderer.stats.drawCalls,1,'CSS movement must reuse the retained raster');
  assert.equal(canvas.hidden,false);
  for(let i=0;i<40;i++)renderer.draw(skinContour(6),{...pose,roll:i*.03,pullAmount:i/40,squash:Math.sin(i)*.1},{scale:3});
  assert.equal(renderer.stats.textureUploads,1);assert.equal(renderer.stats.meshUploads,11);
  assert.equal(gl.calls.filter(c=>c[0]==='texImage2D').length,1);
  assert.equal(gl.calls.filter(c=>c[0]==='drawArrays').length,renderer.stats.drawCalls);
  assert.ok(gl.calls.filter(c=>c[0]==='drawArrays').every(c=>c[1]==='TRIANGLE_FAN'&&c[3]===194));
  renderer.setImage(photo);assert.equal(renderer.stats.textureUploads,1);
});

test('morphs reuse one dynamic GPU buffer instead of accumulating transient frames',()=>{
  const gl=graphics(),renderer=new PhotoRenderer(surface(gl));renderer.setImage(photo);
  for(let i=1;i<200;i++)renderer.draw(morphSkinContour(6,15,i/200),pose);
  assert.equal(renderer.stats.cachedMeshes,11);assert.equal(renderer.stats.transientMeshes,1);
  assert.equal(gl.buffers.size,12);assert.equal(gl.textures.size,1);
  renderer.draw(skinContour(15),pose);assert.equal(gl.buffers.size,12);
});

test('global UI clipping is translated into local canvas bounds',()=>{
  const canvas=surface(),renderer=new PhotoRenderer(canvas);renderer.setImage(photo);
  const mesh=photoMeshData(skinContour(0)),frame=photoFrame(mesh,pose,2);
  const clip={left:frame.left+10,top:frame.top+20,right:frame.left+frame.size-30,bottom:frame.top+frame.size-40};
  renderer.draw(skinContour(0),pose,{scale:2,clip});
  assert.equal(canvas.style.clipPath,'inset(20px 30px 40px 10px)');
  renderer.draw(skinContour(0),pose);assert.equal(canvas.style.clipPath,'none');
});

test('removal frees every image resource and a replacement cannot reuse the old texture',()=>{
  const gl=graphics(),canvas=surface(gl),renderer=new PhotoRenderer(canvas);renderer.setImage(photo);
  renderer.draw(morphSkinContour(6,7,.5),pose);
  renderer.clear();
  assert.equal(renderer.image,null);assert.equal(renderer.stats.hasImage,false);
  assert.equal(renderer.stats.cachedMeshes,0);assert.equal(renderer.stats.transientMeshes,0);
  assert.equal(gl.textures.size,0);assert.equal(gl.buffers.size,0);assert.equal(gl.programs.size,0);
  assert.equal(canvas.hidden,true);assert.equal(canvas.width*canvas.height,1);
  assert.equal(renderer.draw(skinContour(0),pose),false);
  const replacement={width:512,height:512};renderer.setImage(replacement);renderer.draw(skinContour(0),pose);
  assert.equal(renderer.image,replacement);assert.equal(renderer.stats.textureUploads,2);
  assert.equal(gl.textures.size,1);assert.equal(gl.buffers.size,11);
  renderer.setImage(null);assert.equal(gl.textures.size,0);
});

test('unsupported WebGL uses a small exact 2D fallback and reuses a stationary shape',()=>{
  const canvas=surface(null),renderer=new PhotoRenderer(canvas);renderer.setImage(photo);
  assert.equal(renderer.stats.backend,'2d');
  renderer.draw(skinContour(0),{...pose,pullAmount:.8},{scale:2});
  const calls=canvas.ctx.calls.filter(c=>c[0]==='drawImage').length;
  assert.equal(calls,64);assert.equal(renderer.stats.drawCalls,64);assert.ok(canvas.width<1024);
  renderer.draw(skinContour(0),{...pose,pullAmount:.8,x:300},{scale:2});
  assert.equal(canvas.ctx.calls.filter(c=>c[0]==='drawImage').length,calls);
  renderer.draw(skinContour(0),{...pose,r:65,pullAmount:.8});
  assert.equal(canvas.ctx.calls.filter(c=>c[0]==='drawImage').length,calls+96);
  renderer.draw(skinContour(0),{...pose,r:110,pullAmount:.8});
  assert.equal(canvas.ctx.calls.filter(c=>c[0]==='drawImage').length,calls+96+192);
  assert.equal(renderer.stats.drawCalls,calls+96+192);
  renderer.clear();assert.equal(renderer.stats.cachedMeshes,0);assert.equal(canvas.width,1);
});

test('shader failure and context loss use a separate 2D canvas, and removal prevents resurrection',()=>{
  const gl=graphics(),canvas=surface(gl),renderer=new PhotoRenderer(canvas);renderer.setImage(photo);
  let prevented=false;gl.lost=true;
  canvas.events.get('webglcontextlost')({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(renderer.stats.backend,'2d');
  renderer.draw(skinContour(0),pose);
  const fallback=canvas.children[0];assert.ok(fallback);assert.equal(fallback.hidden,false);
  assert.equal(fallback.style.zIndex,'40');assert.equal(canvas.hidden,true);
  renderer.hide();assert.equal(fallback.hidden,true);
  renderer.clear();assert.equal(fallback.removed,true);assert.equal(renderer.image,null);
  const uploads=renderer.stats.textureUploads;gl.lost=false;
  canvas.events.get('webglcontextrestored')();
  assert.equal(renderer.stats.textureUploads,uploads);assert.equal(renderer.stats.backend,'none');
  assert.equal(renderer.draw(skinContour(0),pose),false);
  renderer.setImage(photo);assert.equal(renderer.stats.backend,'webgl');
  const badGL=graphics();badGL.failCompile=true;
  const badCanvas=surface(badGL),fallbackRenderer=new PhotoRenderer(badCanvas);
  assert.equal(fallbackRenderer.setImage(photo),true);assert.equal(fallbackRenderer.stats.backend,'2d');
  fallbackRenderer.draw(skinContour(0),pose);assert.equal(badCanvas.children.length,1);
  fallbackRenderer.dispose();assert.equal(badCanvas.events.size,0);
});

test('fallback sampling changes at radius thresholds even within the same backing-size bucket',()=>{
  const canvas=surface(null),renderer=new PhotoRenderer(canvas);renderer.setImage(photo);
  const contour=skinContour(0);
  for(const [before,after,firstCount,nextCount] of [[48,48.01,64,96],[96,96.01,96,192]]){
    const start=renderer.stats.drawCalls;
    renderer.draw(contour,{...pose,r:before,pullAmount:.8});
    const pixels=canvas.width;
    assert.equal(renderer.stats.drawCalls-start,firstCount);
    renderer.draw(contour,{...pose,r:after,pullAmount:.8});
    assert.equal(canvas.width,pixels);
    assert.equal(renderer.stats.drawCalls-start,firstCount+nextCount);
    renderer.draw(contour,{...pose,r:after,pullAmount:.8,x:pose.x+20});
    assert.equal(renderer.stats.drawCalls-start,firstCount+nextCount,'position-only movement still reuses the selected sampling tier');
  }
});
