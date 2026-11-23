(() => {
  const stage = document.querySelector('#stage');
  const canvas = document.querySelector('#canvas');
  const ctx = canvas.getContext('2d');
  const input = document.querySelector('#photo');
  const empty = document.querySelector('#empty');
  const hand = document.querySelector('#hand');
  const hint = document.querySelector('#hint');
  const status = document.querySelector('#status');
  const reset = document.querySelector('#reset');
  const strength = document.querySelector('#strength');
  const overlay = document.querySelector('#overlay'), octx = overlay.getContext('2d');
  const area = document.querySelector('#area'), finish = document.querySelector('#finish'), cancel = document.querySelector('#cancel');
  const handInput = document.querySelector('#hand-photo'), help = document.querySelector('#editor-help');
  const photoList = document.querySelector('#photo-list');
  const presets = [
    ['assets/default-photo.jpg', 'IMG_5607'],
    ...['img_0023','img_0024','img_0031','img_0084','img_0106','img_0110','img_5632','img_5657','img_5683','img_5700','2dc9dfb1-141f-4166-82ba-68819800acf0'].map((name, i) => [`assets/photos/${name}.jpg`, `사진 ${i+2}`])
  ];
  function selectPreset(index) {
    photoList.querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
  }
  presets.forEach(([src, label], i) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'photo-choice'; button.setAttribute('aria-label', `${label} 선택`); button.setAttribute('aria-pressed', String(i === 0));
    const thumbnail = document.createElement('img'); thumbnail.src = src; thumbnail.alt = ''; thumbnail.loading = 'lazy';
    button.append(thumbnail); button.addEventListener('click', () => loadPreset(i)); photoList.append(button);
  });
  let mode = null, points = [], targetImage = null, mask = null, personMask = null, focusBounds = null, segmenterPromise = null;
  function imageRect() {
    const focused = image === targetImage && focusBounds;
    const scale = Math.min(width / image.width, height / image.height) * (focused ? 1.18 : 1);
    const w = image.width * scale, h = image.height * scale;
    let x = (width - w) / 2, y = (height - h) / 2;
    if (focused) {
      const cx = (focusBounds.left + focusBounds.right) / 2;
      const cy = (focusBounds.top + focusBounds.bottom) / 2;
      x = width / 2 - cx * w; y = height / 2 - cy * h;
      x = w > width ? Math.min(0, Math.max(width - w, x)) : Math.max(0, Math.min(width - w, x));
      y = h > height ? Math.min(0, Math.max(height - h, y)) : Math.max(0, Math.min(height - h, y));
    }
    return {x,y,w,h};
  }
  async function detectPerson(photo, version) {
    try {
      if (!segmenterPromise) segmenterPromise = (async () => {
        const {ImageSegmenter, FilesetResolver} = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs');
        const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm');
        return ImageSegmenter.createFromOptions(vision, {
          baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'},
          runningMode:'IMAGE', outputCategoryMask:false, outputConfidenceMasks:true
        });
      })();
      const segmenter = await segmenterPromise;
      if (version !== imageVersion || targetImage !== photo) return;
      segmenter.segment(photo, result => {
        if (version !== imageVersion || targetImage !== photo || mode) return;
        const masks=result.confidenceMasks, m=masks && masks[masks.length-1]; if(!m) throw new Error('no mask');
        const data=m.getAsFloat32Array(), mw=m.width, mh=m.height, path=new Path2D();
        let left=mw,top=mh,right=0,bottom=0,count=0;
        for(let y=0;y<mh;y++) { let start=-1; for(let x=0;x<=mw;x++) {
          const hit=x<mw && data[y*mw+x] > .45;
          if(hit){if(start<0) start=x;count++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
          if(!hit && start>=0){path.rect(start,y,x-start,1);start=-1;}
        }}
        if(count < mw*mh*.015) {help.textContent='사람을 찾지 못했어요. 반응 영역을 직접 지정해 주세요.';return;}
        personMask={path,width:mw,height:mh};mask=null;
        focusBounds={left:left/mw,right:(right+1)/mw,top:top/mh,bottom:(bottom+1)/mh};
        help.textContent='인물을 인식해 반응 영역을 설정했어요. 필요하면 직접 수정할 수 있습니다.';
        status.textContent='인물 위를 천천히 쓰다듬어 보세요';draw();
      });
    } catch (error) {
      segmenterPromise=null;
      if(version===imageVersion && targetImage===photo) help.textContent='자동 인식이 어려워요. 반응 영역을 직접 지정해 주세요.';
    }
  }
  function paintOverlay() {
    octx.clearRect(0,0,width,height); if (!mode || !image || !points.length) return;
    const r=imageRect(); octx.beginPath(); points.forEach((p,i)=>i?octx.lineTo(r.x+p.x*r.w,r.y+p.y*r.h):octx.moveTo(r.x+p.x*r.w,r.y+p.y*r.h));
    octx.strokeStyle='#fff'; octx.lineWidth=3; octx.stroke(); octx.strokeStyle='#8b5d44'; octx.lineWidth=1.5; octx.stroke();
    for(const p of points){octx.beginPath();octx.arc(r.x+p.x*r.w,r.y+p.y*r.h,4,0,Math.PI*2);octx.fillStyle='#fff';octx.fill();octx.strokeStyle='#8b5d44';octx.stroke();}
  }
  function endEditing() { mode=null;points=[];stage.classList.remove('editing'); finish.disabled=true;cancel.disabled=true;paintOverlay(); }
  function startEditing(which) { mode=which; points=[];active=false;hand.classList.remove('visible','pressing');stage.classList.add('editing');finish.disabled=false;cancel.disabled=false;help.textContent=which==='area'?'반응시킬 부분의 테두리를 클릭한 뒤 영역 완료를 누르세요.':'손의 테두리를 클릭한 뒤 영역 완료를 누르세요.';draw();paintOverlay(); }

  let image = null, width = 0, height = 0, dpr = 1, active = false, pointerId = null, hintTimer, request = 0, imageVersion = 0;
  const cursor = { x: 0, y: 0, px: 0, py: 0, dx: 0, dy: 0, force: 0 };

  function resize() {
    const rect = stage.getBoundingClientRect();
    width = rect.width; height = rect.height; dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    overlay.width=canvas.width; overlay.height=canvas.height; octx.setTransform(dpr,0,0,dpr,0,0); paintOverlay();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  function triangle(s, d) {
    const [a,b,c] = s, [p,q,r] = d;
    const det = a.x*(b.y-c.y)+b.x*(c.y-a.y)+c.x*(a.y-b.y);
    if (Math.abs(det) < .0001) return;
    const xx = (p.x*(b.y-c.y)+q.x*(c.y-a.y)+r.x*(a.y-b.y))/det;
    const xy = (p.x*(c.x-b.x)+q.x*(a.x-c.x)+r.x*(b.x-a.x))/det;
    const x0 = (p.x*(b.x*c.y-c.x*b.y)+q.x*(c.x*a.y-a.x*c.y)+r.x*(a.x*b.y-b.x*a.y))/det;
    const yx = (p.y*(b.y-c.y)+q.y*(c.y-a.y)+r.y*(a.y-b.y))/det;
    const yy = (p.y*(c.x-b.x)+q.y*(a.x-c.x)+r.y*(b.x-a.x))/det;
    const y0 = (p.y*(b.x*c.y-c.x*b.y)+q.y*(c.x*a.y-a.x*c.y)+r.y*(a.x*b.y-b.x*a.y))/det;
    ctx.save(); ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(q.x,q.y); ctx.lineTo(r.x,r.y); ctx.closePath(); ctx.clip();
    ctx.transform(xx,yx,xy,yy,x0,y0); ctx.drawImage(image,0,0); ctx.restore();
  }
  function draw() {
    ctx.clearRect(0,0,width,height); if (!image || !width || !height) return;
    const rect = imageRect(), iw=rect.w, ih=rect.h, ox=rect.x, oy=rect.y;
    ctx.fillStyle = '#ded9cf'; ctx.fillRect(0,0,width,height);
    ctx.drawImage(image,ox,oy,iw,ih);
    if (cursor.force < .01 || (!mask && !personMask) || mode) return;
    ctx.save();
    if (personMask) {ctx.translate(ox,oy);ctx.scale(iw/personMask.width,ih/personMask.height);ctx.clip(personMask.path);ctx.setTransform(dpr,0,0,dpr,0,0);}
    else {ctx.beginPath(); mask.forEach((p,i)=>i?ctx.lineTo(ox+p.x*iw,oy+p.y*ih):ctx.moveTo(ox+p.x*iw,oy+p.y*ih));ctx.closePath();ctx.clip();}
    const cols=24, rows=Math.min(40,Math.max(12,Math.round(cols*ih/iw))), points=[];
    const radius=Math.max(75,Math.min(iw,ih)*.24), power=(Number(strength.value)/100)*cursor.force;
    for(let y=0;y<=rows;y++) { points[y]=[]; for(let x=0;x<=cols;x++) {
      const sx=image.width*x/cols, sy=image.height*y/rows, px=ox+iw*x/cols, py=oy+ih*y/rows;
      const dist=Math.hypot(px-cursor.x,py-cursor.y), fall=Math.exp(-dist*dist/(radius*radius))*power;
      points[y][x]={s:{x:sx,y:sy},d:{x:px+cursor.dx*fall*.8,y:py+cursor.dy*fall*.8}};
    }}
    for(let y=0;y<rows;y++) for(let x=0;x<cols;x++) {
      const a=points[y][x], b=points[y][x+1], c=points[y+1][x], d=points[y+1][x+1];
      triangle([a.s,b.s,c.s],[a.d,b.d,c.d]); triangle([b.s,d.s,c.s],[b.d,d.d,c.d]);
    }
    ctx.restore();
  }
  function frame() {
    cursor.dx *= .87; cursor.dy *= .87; cursor.force += ((active ? 1 : 0)-cursor.force)*.12;
    draw(); if (active || cursor.force > .01) request=requestAnimationFrame(frame); else request=0;
  }
  function animate() { if (!request) request=requestAnimationFrame(frame); }
  function locate(event) {
    const rect=stage.getBoundingClientRect(), x=event.clientX-rect.left, y=event.clientY-rect.top;
    if(active) { cursor.dx=Math.max(-28,Math.min(28,(x-cursor.px)*1.8)); cursor.dy=Math.max(-28,Math.min(28,(y-cursor.py)*1.8)); }
    cursor.x=x; cursor.y=y; cursor.px=x; cursor.py=y;
    hand.style.transform=`translate(${x - hand.offsetWidth*.38}px, ${y - hand.offsetWidth*.35}px) rotate(${Math.max(-12,Math.min(12,cursor.dx))}deg)`;
  }
  stage.addEventListener('pointerenter',e=>{if(!image || mode)return; locate(e); hand.classList.add('visible');});
  stage.addEventListener('pointerdown',e=>{if(!image || e.button!==0)return; if(mode){const r=imageRect(), box=stage.getBoundingClientRect(),x=(e.clientX-box.left-r.x)/r.w,y=(e.clientY-box.top-r.y)/r.h;if(x>=0&&x<=1&&y>=0&&y<=1){points.push({x,y});paintOverlay();}return;} active=false; locate(e); active=true; pointerId=e.pointerId; stage.setPointerCapture(e.pointerId); hand.classList.add('visible','pressing'); hint.hidden=true; animate();});
  stage.addEventListener('pointermove',e=>{if(!image || mode)return; locate(e); if(active) animate();});
  function release(e){if(e.pointerId!==pointerId)return; active=false; pointerId=null; hand.classList.remove('pressing'); if(e.pointerType==='touch') hand.classList.remove('visible'); animate();}
  stage.addEventListener('pointerup',release); stage.addEventListener('pointercancel',release); stage.addEventListener('lostpointercapture',release);
  stage.addEventListener('pointerleave',()=>{if(!active) hand.classList.remove('visible');});
  function showPhoto(next, version) {
    image=targetImage=next; mask=null; personMask=null; focusBounds=null; endEditing();
    area.disabled=false; active=false; cursor.force=0; hand.classList.remove('visible','pressing');
    empty.hidden=true; empty.style.display='none'; stage.classList.add('has-image'); reset.disabled=false;
    status.textContent='사진 위를 천천히 쓰다듬어 보세요'; hint.hidden=false;
    clearTimeout(hintTimer); hintTimer=setTimeout(()=>hint.hidden=true,5000); draw();
    help.textContent='인물 자동 인식을 시도하고 있어요…'; detectPerson(next,version);
  }
  function loadPreset(index) {
    const version=++imageVersion, next=new Image();
    next.onload=()=>{
      if(version!==imageVersion)return;
      if(index===0) { setDefault(next); selectPreset(index); return; }
      selectPreset(index); showPhoto(next,version);
    };
    next.onerror=()=>{if(version===imageVersion) status.textContent='사진을 불러올 수 없습니다. 다른 사진을 선택해 주세요.';};
    next.src=presets[index][0];
  }
  input.addEventListener('change',()=>{
    const file=input.files[0]; if(!file)return;
    if(!file.type.startsWith('image/')){status.textContent='이미지 파일을 선택해 주세요'; input.value=''; return;}
    const version=++imageVersion, url=URL.createObjectURL(file), next=new Image();
    next.onload=()=>{URL.revokeObjectURL(url); if(version!==imageVersion)return; selectPreset(-1); showPhoto(next,version);};
    next.onerror=()=>{URL.revokeObjectURL(url); if(version===imageVersion) status.textContent='사진을 열 수 없습니다. 다른 파일을 선택해 주세요.';};
    next.src=url; input.value='';
  });
  area.addEventListener('click',()=>{if(targetImage){image=targetImage;startEditing('area');}});
  cancel.addEventListener('click',()=>{image=targetImage;endEditing();help.textContent='영역 지정을 취소했습니다.';draw();});
  finish.addEventListener('click',()=>{
    if(points.length<3){help.textContent='세 점 이상 선택해 주세요.';return;}
    if(mode==='area'){mask=points.slice();personMask=null;help.textContent='반응 영역을 지정했습니다. 손 사진을 선택할 수 있습니다.';endEditing();draw();return;}
    const xs=points.map(p=>p.x*image.width), ys=points.map(p=>p.y*image.height);
    const x=Math.floor(Math.min(...xs)),y=Math.floor(Math.min(...ys)),w=Math.ceil(Math.max(...xs))-x,h=Math.ceil(Math.max(...ys))-y;
    if(w<2||h<2){help.textContent='손을 더 넓게 지정해 주세요.';return;}
    const cut=document.createElement('canvas');cut.width=w;cut.height=h;const c=cut.getContext('2d');c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x*image.width-x,p.y*image.height-y):c.moveTo(p.x*image.width-x,p.y*image.height-y));c.closePath();c.clip();c.drawImage(image,-x,-y);
    hand.querySelector('img').src=cut.toDataURL('image/png'); image=targetImage; endEditing();help.textContent='손을 분리했습니다. 사진 위를 눌러 쓰다듬어 보세요.';draw();
  });
  handInput.addEventListener('change',()=>{const file=handInput.files[0];handInput.value='';if(!file)return;if(!targetImage){help.textContent='대상 사진을 먼저 선택해 주세요.';return;}const url=URL.createObjectURL(file),next=new Image();next.onload=()=>{URL.revokeObjectURL(url);image=next;startEditing('hand');};next.onerror=()=>{URL.revokeObjectURL(url);help.textContent='손 사진을 열 수 없습니다. JPG 또는 PNG를 선택해 주세요.';};next.src=url;});
  reset.addEventListener('click',()=>input.click());
  function setDefault(defaultImage) {
    image = targetImage = defaultImage; personMask=null; endEditing(); active=false; cursor.force=0; hand.classList.remove('visible','pressing');
    mask = [{x:.535,y:.30},{x:.54,y:.265},{x:.56,y:.245},{x:.60,y:.225},{x:.66,y:.21},{x:.72,y:.215},{x:.77,y:.235},{x:.80,y:.28},{x:.82,y:.33},{x:.85,y:.37},{x:.89,y:.40},{x:.94,y:.46},{x:.965,y:.52},{x:.965,y:.61},{x:.955,y:.68},{x:.94,y:.74},{x:.91,y:.80},{x:.86,y:.85},{x:.79,y:.875},{x:.72,y:.88},{x:.66,y:.865},{x:.61,y:.85},{x:.56,y:.83},{x:.51,y:.80},{x:.48,y:.76},{x:.47,y:.71},{x:.47,y:.66},{x:.46,y:.62},{x:.475,y:.57},{x:.49,y:.52},{x:.48,y:.48},{x:.47,y:.45},{x:.48,y:.43},{x:.50,y:.44},{x:.52,y:.47},{x:.55,y:.48},{x:.56,y:.44},{x:.56,y:.40},{x:.545,y:.35}];
    focusBounds = {left:.46,top:.21,right:.965,bottom:.88};
    empty.hidden = true; empty.style.display = 'none'; stage.classList.add('has-image');
    area.disabled = false; reset.disabled = false;
    status.textContent = '사진 속 인물을 천천히 쓰다듬어 보세요';
    help.textContent = '기본 반응 영역이 설정되어 있어요. 영역을 다시 지정할 수도 있습니다.';
    hint.hidden = false; clearTimeout(hintTimer); hintTimer = setTimeout(() => hint.hidden = true, 5000);
    draw();
  }
  loadPreset(0);
  new ResizeObserver(resize).observe(stage);
})();
