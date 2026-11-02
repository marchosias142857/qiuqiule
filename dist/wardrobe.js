const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const IMAGE_KEY='qiuqiule-appearance';
const isAppearanceURL=value=>typeof value==='string'&&/^data:image\/(?:png|jpeg|webp);base64,/.test(value);

// Source coordinates for the largest possible square at zoom 1. Pan values
// are in displayed-square units, keeping gestures independent of screen size.
export function cropSourceRect(width,height,zoom=1,panX=0,panY=0){
  const side=Math.min(width,height)/clamp(zoom,1,4);
  return {x:clamp((width-side)/2-panX*side,0,width-side),y:clamp((height-side)/2-panY*side,0,height-side),side};
}
export function repeatDelay(milliseconds){return Math.max(55,300-Math.max(0,milliseconds-450)*.15);}

function appearanceDatabase(){
  return new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB){reject(new Error('Image storage unavailable'));return;}
    const request=indexedDB.open(IMAGE_KEY,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('images');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('Image storage busy'));
  });
}
export async function loadAppearance(){
  // A fallback is the latest successful write when IndexedDB could not be
  // updated. Its explicit null also prevents an undeleted old image returning.
  try{
    const fallback=localStorage.getItem(IMAGE_KEY);
    if(isAppearanceURL(fallback))return fallback; // Earlier raw-data-URL format.
    if(fallback!==null){
      const record=JSON.parse(fallback);
      if(record?.version===1&&(record.image===null||isAppearanceURL(record.image)))return record.image;
    }
  }catch{}
  try{
    const db=await appearanceDatabase();
    const value=await new Promise((resolve,reject)=>{
      const tx=db.transaction('images','readonly'),request=tx.objectStore('images').get('player');
      request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);
      tx.oncomplete=()=>db.close();tx.onabort=()=>{db.close();reject(tx.error);};
    });
    return value;
  }catch{}
  return null;
}
export async function saveAppearance(dataURL){
  if(dataURL!==null&&!isAppearanceURL(dataURL))throw new Error('无效图片');
  try{
    const db=await appearanceDatabase();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('images','readwrite'),store=tx.objectStore('images');
      if(dataURL)store.put(dataURL,'player');else store.delete('player');
      tx.oncomplete=()=>{db.close();resolve();};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error);};
    });
    try{localStorage.removeItem(IMAGE_KEY);}catch{}
  }catch{
    try{localStorage.setItem(IMAGE_KEY,JSON.stringify({version:1,image:dataURL}));}
    catch{throw new Error('图片未能保存，请释放设备存储空间后重试');}
  }
}

export function initWardrobe({getState,onToggle,onSides,onImage,onError=()=>{}}){
  const $=id=>document.getElementById(id);
  const toggle=$('skin-toggle'),minus=$('skin-minus'),plus=$('skin-plus'),file=$('appearance-file');
  const layer=$('appearance-cropper'),canvas=$('crop-canvas'),zoomControl=$('crop-zoom'),apply=$('crop-apply');
  let repeatTimer=null,repeatStarted=0,crop=null,sourceURL=null,loadGeneration=0,saving=false,restoreFocus=null;
  const pointers=new Map();
  const refresh=()=>{
    const state=getState(),unlocked=state.unlocked>=6,active=unlocked&&state.enabled;
    $('skin-lock').hidden=unlocked;toggle.hidden=!unlocked;
    toggle.setAttribute('aria-checked',String(active));
    $('skin-infinity').hidden=active;$('skin-stepper').hidden=!active;
    $('skin-sides').textContent=String(state.sides);
    minus.disabled=!active||state.sides<=6;plus.disabled=!active||state.sides>=state.unlocked;
    $('appearance-clear').hidden=!state.image;
  };
  const stopRepeat=()=>{clearTimeout(repeatTimer);repeatTimer=null;};
  const step=delta=>{
    const state=getState();if(!state.enabled||state.unlocked<6)return false;
    const next=clamp(state.sides+delta,6,state.unlocked);if(next===state.sides)return false;
    onSides(next);refresh();return true;
  };
  for(const [button,delta] of [[minus,-1],[plus,1]]){
    button.addEventListener('pointerdown',event=>{
      if(event.button!==0||button.disabled)return;
      event.preventDefault();stopRepeat();button.setPointerCapture?.(event.pointerId);
      step(delta);repeatStarted=performance.now();
      const again=()=>{if(step(delta))repeatTimer=setTimeout(again,repeatDelay(performance.now()-repeatStarted));else stopRepeat();};
      repeatTimer=setTimeout(again,450);
    });
    for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,stopRepeat);
    button.addEventListener('click',event=>{event.preventDefault();if(event.detail===0)step(delta);});
    button.addEventListener('contextmenu',event=>event.preventDefault());
  }
  window.addEventListener('pointerup',stopRepeat);window.addEventListener('pointercancel',stopRepeat);
  window.addEventListener('blur',()=>{stopRepeat();pointers.clear();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopRepeat();pointers.clear();}});
  toggle.addEventListener('click',()=>{onToggle(!getState().enabled);refresh();});

  const releaseImage=()=>{if(sourceURL){URL.revokeObjectURL(sourceURL);sourceURL=null;}};
  const closeCrop=()=>{
    if(saving)return;
    loadGeneration++;crop=null;pointers.clear();releaseImage();layer.hidden=true;document.body.classList.remove('appearance-cropping');
    if(restoreFocus?.isConnected)restoreFocus.focus({preventScroll:true});restoreFocus=null;
  };
  const drawCrop=()=>{
    if(!crop)return;
    const rect=cropSourceRect(crop.image.naturalWidth,crop.image.naturalHeight,crop.zoom,crop.panX,crop.panY);
    crop.panX=((crop.image.naturalWidth-rect.side)/2-rect.x)/rect.side;
    crop.panY=((crop.image.naturalHeight-rect.side)/2-rect.y)/rect.side;
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,768,768);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(crop.image,rect.x,rect.y,rect.side,rect.side,0,0,768,768);zoomControl.value=String(crop.zoom);
  };
  const setZoom=value=>{
    if(!crop)return;
    const next=clamp(value,1,4),ratio=next/crop.zoom;crop.panX*=ratio;crop.panY*=ratio;crop.zoom=next;drawCrop();
  };
  $('appearance-select').addEventListener('click',()=>{file.value='';file.click();});
  file.addEventListener('change',async()=>{
    const selected=file.files?.[0];if(!selected)return;
    if(selected.size>32*1024*1024){onError('请选择小于32MB的图片');return;}
    const generation=++loadGeneration;releaseImage();sourceURL=URL.createObjectURL(selected);
    const image=new Image();image.src=sourceURL;
    try{await image.decode();}catch{if(generation===loadGeneration){releaseImage();onError('无法读取这张图片，请换一张图片重试');}return;}
    if(generation!==loadGeneration)return;
    crop={image,zoom:1,panX:0,panY:0};restoreFocus=$('appearance-select');layer.hidden=false;document.body.classList.add('appearance-cropping');drawCrop();$('crop-cancel').focus({preventScroll:true});
  });
  $('appearance-clear').addEventListener('click',async()=>{
    const button=$('appearance-clear');button.disabled=true;
    try{await onImage(null);refresh();}catch(error){onError(error.message||'图片未能移除，请重试');}finally{button.disabled=false;}
  });
  $('crop-cancel').addEventListener('click',closeCrop);
  zoomControl.addEventListener('input',()=>setZoom(Number(zoomControl.value)));
  canvas.addEventListener('pointerdown',event=>{
    if(!crop||saving||event.button!==0)return;
    event.preventDefault();canvas.setPointerCapture(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  });
  canvas.addEventListener('pointermove',event=>{
    if(!crop||saving||!pointers.has(event.pointerId))return;
    event.preventDefault();const old=pointers.get(event.pointerId),size=canvas.getBoundingClientRect().width;
    if(pointers.size===1){crop.panX+=(event.clientX-old.x)/size;crop.panY+=(event.clientY-old.y)/size;}
    else{
      const other=[...pointers].find(([id])=>id!==event.pointerId)[1];
      const oldDistance=Math.hypot(old.x-other.x,old.y-other.y),newDistance=Math.hypot(event.clientX-other.x,event.clientY-other.y);
      if(oldDistance>1)setZoom(crop.zoom*newDistance/oldDistance);
      crop.panX+=(event.clientX-old.x)/size/2;crop.panY+=(event.clientY-old.y)/size/2;
    }
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});drawCrop();
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,event=>pointers.delete(event.pointerId));
  canvas.addEventListener('wheel',event=>{if(crop){event.preventDefault();setZoom(crop.zoom*Math.exp(-event.deltaY*.002));}},{passive:false});
  apply.addEventListener('click',async()=>{
    if(!crop||saving)return;saving=true;apply.disabled=true;$('crop-cancel').disabled=true;apply.textContent='正在应用';
    try{
      // Keep transparency and avoid JPEG halos at the player's moving edge.
      await onImage(canvas.toDataURL('image/png'));refresh();saving=false;closeCrop();
    }catch(error){onError(error.message||'图片未能保存，请重试');}
    finally{saving=false;apply.disabled=false;$('crop-cancel').disabled=false;apply.textContent='应用';}
  });
  document.addEventListener('keydown',event=>{
    if(layer.hidden)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeCrop();}
    if(event.key==='Tab'){
      event.stopImmediatePropagation();
      const controls=[...layer.querySelectorAll('button,input')].filter(el=>!el.disabled),first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  },{capture:true});
  refresh();
  return {refresh,isCropping:()=>!layer.hidden,cancelInteraction(){stopRepeat();if(!saving)closeCrop();}};
}
