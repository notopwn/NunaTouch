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
  let mode = null, points = [], targetImage = null, mask = null, handObjectUrl = null;
  function imageRect() { const scale=Math.min(width/image.width,height/image.height), w=image.width*scale,h=image.height*scale; return {x:(width-w)/2,y:(height-h)/2,w,h}; }
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
    const scale = Math.min(width/image.width,height/image.height);
    const iw = image.width*scale, ih = image.height*scale, ox=(width-iw)/2, oy=(height-ih)/2;
    ctx.fillStyle = '#ded9cf'; ctx.fillRect(0,0,width,height);
    ctx.drawImage(image,ox,oy,iw,ih);
    if (cursor.force < .01 || !mask || mode) return;
    ctx.save(); ctx.beginPath(); mask.forEach((p,i)=>i?ctx.lineTo(ox+p.x*iw,oy+p.y*ih):ctx.moveTo(ox+p.x*iw,oy+p.y*ih)); ctx.closePath(); ctx.clip();
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
  input.addEventListener('change',()=>{
    const file=input.files[0]; if(!file)return;
    if(!file.type.startsWith('image/')){status.textContent='이미지 파일을 선택해 주세요'; input.value=''; return;}
    const version=++imageVersion, url=URL.createObjectURL(file), next=new Image();
    next.onload=()=>{URL.revokeObjectURL(url); if(version!==imageVersion)return; image=next; targetImage=next; mask=null; endEditing(); area.disabled=false; help.textContent='반응 영역을 먼저 지정한 뒤 손 사진을 선택하세요.'; active=false; cursor.force=0; empty.hidden=true; empty.style.display='none'; stage.classList.add('has-image'); reset.disabled=false; status.textContent='사진 위를 천천히 쓰다듬어 보세요'; hint.hidden=false; clearTimeout(hintTimer); hintTimer=setTimeout(()=>hint.hidden=true,5000); draw();};
    next.onerror=()=>{URL.revokeObjectURL(url); if(version===imageVersion) status.textContent='사진을 열 수 없습니다. 다른 파일을 선택해 주세요.';};
    next.src=url; input.value='';
  });
  area.addEventListener('click',()=>{if(targetImage){image=targetImage;startEditing('area');}});
  cancel.addEventListener('click',()=>{image=targetImage;endEditing();help.textContent='영역 지정을 취소했습니다.';draw();});
  finish.addEventListener('click',()=>{
    if(points.length<3){help.textContent='세 점 이상 선택해 주세요.';return;}
    if(mode==='area'){mask=points.slice();help.textContent='반응 영역을 지정했습니다. 손 사진을 선택할 수 있습니다.';endEditing();draw();return;}
    const xs=points.map(p=>p.x*image.width), ys=points.map(p=>p.y*image.height);
    const x=Math.floor(Math.min(...xs)),y=Math.floor(Math.min(...ys)),w=Math.ceil(Math.max(...xs))-x,h=Math.ceil(Math.max(...ys))-y;
    if(w<2||h<2){help.textContent='손을 더 넓게 지정해 주세요.';return;}
    const cut=document.createElement('canvas');cut.width=w;cut.height=h;const c=cut.getContext('2d');c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x*image.width-x,p.y*image.height-y):c.moveTo(p.x*image.width-x,p.y*image.height-y));c.closePath();c.clip();c.drawImage(image,-x,-y);
    hand.querySelector('img').src=cut.toDataURL('image/png'); image=targetImage; endEditing();help.textContent='손을 분리했습니다. 사진 위를 눌러 쓰다듬어 보세요.';draw();
  });
  handInput.addEventListener('change',()=>{const file=handInput.files[0];handInput.value='';if(!file)return;if(!targetImage){help.textContent='대상 사진을 먼저 선택해 주세요.';return;}const url=URL.createObjectURL(file),next=new Image();next.onload=()=>{URL.revokeObjectURL(url);image=next;startEditing('hand');};next.onerror=()=>{URL.revokeObjectURL(url);help.textContent='손 사진을 열 수 없습니다. JPG 또는 PNG를 선택해 주세요.';};next.src=url;});
  reset.addEventListener('click',()=>input.click());
  new ResizeObserver(resize).observe(stage);
})();
