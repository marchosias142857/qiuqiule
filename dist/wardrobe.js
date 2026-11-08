import {STAR_TRAIL_DEFINITIONS,normalizeStarTrailState,starTrailPreview} from './star-trails.js';
import {BIG_EYE_UNLOCK_SCORE} from './appearances.js';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const IMAGE_KEY='qiuqiule-appearance';
const CROP_SIZE=768;
const isAppearanceURL=value=>typeof value==='string'&&/^data:image\/(?:png|jpeg|webp);base64,/.test(value);

// Source coordinates for the largest possible square at zoom 1. Pan values
// are in displayed-square units, keeping gestures independent of screen size.
export function cropSourceRect(width,height,zoom=1,panX=0,panY=0){
  const side=Math.min(width,height)/clamp(zoom,1,4);
  return {x:clamp((width-side)/2-panX*side,0,width-side),y:clamp((height-side)/2-panY*side,0,height-side),side};
}

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

const returnMarkup='<svg class="return-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v8H6m5-5-5 5 5 5"/></svg>';
const lockMarkup='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
const ease=value=>{const t=clamp(value,0,1);return t*t*(3-2*t);};

export function wardrobeAppearanceCards(state){
  const selected=state.appearanceId||(state.image?'custom':'original');
  const unlocked=state.appearanceUnlocked===true||Number(state.best)>=BIG_EYE_UNLOCK_SCORE;
  return [{id:'original',label:'原汁原味',unlocked:true},{id:'custom',label:'自定义',unlocked:true},
    {id:'big-eye',label:'大眼萌',unlocked}].map(card=>({...card,selected:card.id===selected}));
}
export function wardrobeStarTrailCards(state){
  const starTrail=normalizeStarTrailState({unlocked:state.starTrailUnlocked,selected:state.starTrailId},{highestStage:state.highestStage});
  return STAR_TRAIL_DEFINITIONS.map((card,index)=>({...card,unlocked:index<starTrail.unlocked,selected:card.id===starTrail.selected}));
}
function appearancePreview(id){
  if(id==='custom')return '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="shape-outline" cx="50" cy="59" r="26"/><text class="appearance-question" x="50" y="68" text-anchor="middle">?</text></svg>';
  if(id==='big-eye')return '<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="wardrobe-eye-gradient"><stop offset="0" stop-color="#d9efc3"/><stop offset=".5" stop-color="#b8db8a"/><stop offset="1" stop-color="#75944e"/></radialGradient></defs><circle cx="50" cy="59" r="26" fill="url(#wardrobe-eye-gradient)"/><circle cx="50" cy="59" r="13.3333" fill="#000"/></svg>';
  return '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="59" r="26" fill="#252720"/><ellipse cx="45.5" cy="57.2" rx="1.6" ry="3.9" fill="#f4f3eb"/><ellipse cx="54.5" cy="57.2" rx="1.6" ry="3.9" fill="#f4f3eb"/></svg>';
}

export function initWardrobe({getState,onImage,onAppearance=()=>{},onStarTrail=()=>{},onNavigate=(from,to,commit)=>commit(),onError=()=>{}}){
  const $=id=>document.getElementById(id);
  const panel=$('wardrobe-panel'),content=$('wardrobe-content'),backButton=$('wardrobe-back');
  const separator=$('wardrobe-preview-line'),file=$('appearance-file');
  const layer=$('appearance-cropper'),canvas=$('crop-canvas'),zoomControl=$('crop-zoom'),apply=$('crop-apply');
  const views={main:$('wardrobe-main'),appearance:$('appearance-gallery'),'star-trail':$('star-trail-gallery')};
  let page='main',transition=null,crop=null,sourceURL=null,loadGeneration=0,saving=false,restoreFocus=null,previewColor=null;
  let pendingNavigation=false,navigationGeneration=0;
  const pointers=new Map(),appearanceButtons=new Map(),starTrailButtons=new Map();
  const setPage=target=>{
    page=target;
    for(const [name,view] of Object.entries(views))view.hidden=name!==page;
    backButton.innerHTML=page==='main'?'×':returnMarkup;
    backButton.setAttribute('aria-label',page==='main'?'关闭换装':'返回换装');
    panel.setAttribute('data-wardrobe-view',page);
  };
  const navigate=target=>{
    if(transition||pendingNavigation||page===target)return;
    const from=page,generation=++navigationGeneration;
    pendingNavigation=true;content.inert=true;
    // The scene may finish retracting its preview before fading the content.
    // A reset invalidates the callback even when a new navigation is pending.
    const commit=()=>{
      if(!pendingNavigation||generation!==navigationGeneration)return false;
      pendingNavigation=false;
      transition={target,elapsed:0,swapped:false,lineFrom:from==='main'?0:1,lineTo:target==='main'?0:1};
      panel.classList.add('wardrobe-switching');return true;
    };
    onNavigate(from,target,commit);
  };
  const update=dt=>{
    if(!transition)return;
    const move=transition;move.elapsed+=Math.max(0,Number.isFinite(dt)?dt:0);
    separator.style.opacity=String(move.lineFrom+(move.lineTo-move.lineFrom)*ease(move.elapsed/.24));
    if(move.elapsed>=.12&&!move.swapped){
      setPage(move.target);views[move.target].scrollTop=0;move.swapped=true;
    }
    content.style.opacity=String(move.elapsed<.12?1-ease(move.elapsed/.12):ease((move.elapsed-.12)/.12));
    if(move.elapsed<.24)return;
    transition=null;content.inert=false;content.style.opacity='1';panel.classList.remove('wardrobe-switching');
    // The header stays mounted during the content fade.
    backButton.focus?.({preventScroll:true});
  };
  const refresh=()=>{
    const state=getState();
    for(const card of wardrobeAppearanceCards(state)){
      const waitingForImage=card.id==='custom'&&state.imageLoading&&!state.image;
      const button=appearanceButtons.get(card.id);button.setAttribute('aria-pressed',String(card.selected));
      button.setAttribute('aria-disabled',String(!card.unlocked||!!waitingForImage));
      button.setAttribute('aria-busy',String(!!waitingForImage));
      button.setAttribute('aria-label',card.label+(waitingForImage?'，图片读取中':card.unlocked?'':`，达${BIG_EYE_UNLOCK_SCORE}分解锁`));
      button.querySelector('.wardrobe-card-lock').hidden=card.unlocked;
    }
    const color=state.playerColor??'#252720';
    for(const card of wardrobeStarTrailCards(state)){
      const button=starTrailButtons.get(card.id);button.setAttribute('aria-pressed',String(card.selected));
      button.setAttribute('aria-disabled',String(!card.unlocked));
      button.setAttribute('aria-label',card.label+(card.unlocked?'':`，到达第 ${card.stage} 阶段解锁`));
      button.querySelector('.wardrobe-card-lock').hidden=card.unlocked;
      if(color!==previewColor)button.querySelector('.star-trail-preview').innerHTML=starTrailPreview(card.id,color);
    }
    previewColor=color;
  };
  const makeCard=(title,preview,unlockText)=>{
    const button=document.createElement('button');button.type='button';button.className='wardrobe-card';
    button.innerHTML=`<span class="wardrobe-card-title">${title}</span>${preview}<span class="wardrobe-card-lock">${lockMarkup}<span>${unlockText}</span></span>`;
    return button;
  };
  for(const card of wardrobeAppearanceCards(getState())){
    const button=makeCard(card.label,appearancePreview(card.id),card.id==='big-eye'?`达${BIG_EYE_UNLOCK_SCORE}分<br>解锁`:'');
    button.id=`appearance-option-${card.id}`;button.setAttribute('data-appearance',card.id);
    button.addEventListener('click',()=>{
      if(transition||pendingNavigation)return;
      const state=getState(),current=wardrobeAppearanceCards(state).find(option=>option.id===card.id);
      if(!current?.unlocked){onError(`达${BIG_EYE_UNLOCK_SCORE}分解锁`);return;}
      if(card.id==='custom'&&state.imageLoading&&!state.image)return;
      // A saved image is reusable while another appearance is equipped.
      // Reopening the picker never changes selection until a crop is applied.
      if(card.id==='custom'&&(!state.image||current.selected)){file.value='';file.click();return;}
      onAppearance(card.id);refresh();
    });
    appearanceButtons.set(card.id,button);$('appearance-grid').append(button);
  }
  for(const card of wardrobeStarTrailCards(getState())){
    const button=makeCard(card.label,`<span class="star-trail-preview">${starTrailPreview(card.id,getState().playerColor??'#252720')}</span>`,`到达第 ${card.stage} 阶段<br>解锁`);
    button.id=`star-trail-option-${card.id}`;button.setAttribute('data-star-trail',card.id);
    button.addEventListener('click',()=>{
      if(transition||pendingNavigation)return;
      if(!wardrobeStarTrailCards(getState()).find(option=>option.id===card.id)?.unlocked){onError(`到达第 ${card.stage} 阶段解锁`);return;}
      onStarTrail(card.id);refresh();
    });
    starTrailButtons.set(card.id,button);$('star-trail-grid').append(button);
  }
  window.addEventListener('blur',()=>pointers.clear());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pointers.clear();});
  $('appearance-select').addEventListener('click',()=>navigate('appearance'));
  $('star-trail-select').addEventListener('click',()=>navigate('star-trail'));

  const releaseImage=()=>{if(sourceURL){URL.revokeObjectURL(sourceURL);sourceURL=null;}};
  const closeCrop=()=>{
    if(saving)return;
    loadGeneration++;crop=null;pointers.clear();releaseImage();layer.hidden=true;document.body.classList.remove('appearance-cropping');
    if(canvas.width!==1)canvas.width=1;
    if(canvas.height!==1)canvas.height=1;
    if(restoreFocus?.isConnected)restoreFocus.focus({preventScroll:true});restoreFocus=null;
  };
  const drawCrop=()=>{
    if(!crop)return;
    const rect=cropSourceRect(crop.image.naturalWidth,crop.image.naturalHeight,crop.zoom,crop.panX,crop.panY);
    crop.panX=((crop.image.naturalWidth-rect.side)/2-rect.x)/rect.side;
    crop.panY=((crop.image.naturalHeight-rect.side)/2-rect.y)/rect.side;
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,CROP_SIZE,CROP_SIZE);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(crop.image,rect.x,rect.y,rect.side,rect.side,0,0,CROP_SIZE,CROP_SIZE);zoomControl.value=String(crop.zoom);
  };
  const setZoom=value=>{
    if(!crop)return;
    const next=clamp(value,1,4),ratio=next/crop.zoom;crop.panX*=ratio;crop.panY*=ratio;crop.zoom=next;drawCrop();
  };
  file.addEventListener('change',async()=>{
    const selected=file.files?.[0];if(!selected)return;
    if(selected.size>32*1024*1024){onError('请选择小于32MB的图片');return;}
    const generation=++loadGeneration;releaseImage();sourceURL=URL.createObjectURL(selected);
    const image=new Image();image.src=sourceURL;
    try{await image.decode();}catch{if(generation===loadGeneration){releaseImage();onError('无法读取这张图片，请换一张图片重试');}return;}
    if(generation!==loadGeneration)return;
    if(canvas.width!==CROP_SIZE)canvas.width=CROP_SIZE;
    if(canvas.height!==CROP_SIZE)canvas.height=CROP_SIZE;
    crop={image,zoom:1,panX:0,panY:0};restoreFocus=appearanceButtons.get('custom');layer.hidden=false;document.body.classList.add('appearance-cropping');drawCrop();$('crop-cancel').focus({preventScroll:true});
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
  separator.style.opacity='0';setPage('main');refresh();
  return {refresh,update,
    getPage:()=>page,
    back(){if(transition||pendingNavigation)return true;if(page==='main')return false;navigate('main');return true;},
    resetNavigation(){navigationGeneration++;pendingNavigation=false;transition=null;content.inert=false;content.style.opacity='1';separator.style.opacity='0';panel.classList.remove('wardrobe-switching');setPage('main');},
    isCropping:()=>!layer.hidden,
    cancelInteraction(){pointers.clear();if(!saving)closeCrop();}
  };
}
