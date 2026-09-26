// Reads what the room list does not describe from the rendered floor plans (public/map/f*.jpg):
// lift cars (squares with a cross) and unnumbered rooms.
// Pure functions over RGBA pixels; tools/plan-features.html runs them in a browser
// (it decodes the JPEGs) and prints lib/map-plan.json for tools/build-map-models.mjs.

export function analyseFloor(floor, image) {
  const {width:W, height:H, data:px} = image;
  const [ix0,iy0,ix1,iy1] = floor.imageBox, sx = (ix1-ix0)/W, sy = (iy1-iy0)/H;
  const toMap = (x,y) => [ix0+x*sx, iy0+y*sy], toPx = (X,Y) => [(X-ix0)/sx, (Y-iy0)/sy];
  const r1 = v => Math.round(v*10)/10;
  const mapBox = (x0,y0,x1,y1) => [...toMap(x0,y0), ...toMap(x1,y1)].map(r1);

  // Ink: dark and unsaturated (room fills are coloured, walls and fixtures are black).
  const ink = new Uint8Array(W*H);
  for (let i=0;i<W*H;i++) { const r=px[i*4], g=px[i*4+1], b=px[i*4+2], mx=Math.max(r,g,b); ink[i] = mx<170 && mx-Math.min(r,g,b)<70 ? 1 : 0; }
  const dark = (x,y) => { x=Math.round(x); y=Math.round(y); return x>=0&&y>=0&&x<W&&y<H ? ink[y*W+x] : 0; };

  // Walls are long straight strokes: drop text and fixtures, keep runs of at least `run` pixels.
  const run = Math.round(12/sx), wall = new Uint8Array(W*H);
  for (let y=0;y<H;y++) { let s=-1; for (let x=0;x<=W;x++) { const on=x<W&&ink[y*W+x]; if(on&&s<0)s=x; if(!on&&s>=0){ if(x-s>=run) for(let k=s;k<x;k++) wall[y*W+k]=1; s=-1; } } }
  for (let x=0;x<W;x++) { let s=-1; for (let y=0;y<=H;y++) { const on=y<H&&ink[y*W+x]; if(on&&s<0)s=y; if(!on&&s>=0){ if(y-s>=run) for(let k=s;k<y;k++) wall[k*W+x]=1; s=-1; } } }

  // Lift cars: squares whose four sides and both diagonals are inked.
  function squareScore(cx, cy, s) {
    let hit=0, n=0; const h=s/2;
    for (let t=-1; t<=1.0001; t+=.1) {
      for (const [x,y] of [[cx+t*h,cy-h],[cx+t*h,cy+h],[cx-h,cy+t*h],[cx+h,cy+t*h],[cx+t*h*.8,cy+t*h*.8],[cx+t*h*.8,cy-t*h*.8]]) {
        n++; if (dark(x,y)||dark(x+1,y)||dark(x,y+1)||dark(x-1,y)||dark(x,y-1)) hit++;
      }
    }
    // The inside away from the cross must be mostly paper.
    let blank=0, m=0;
    for (const [ox,oy] of [[0,-.55],[0,.55],[-.55,0],[.55,0]]) { m++; if(!dark(cx+ox*h,cy+oy*h)) blank++; }
    return hit/n * (blank/m);
  }
  const lifts = floor.places.filter(p=>p.kind==='lift' && p.box).map(p=>{
    const [a,b,c,d]=p.box, [px0,py0]=toPx(a-22,b-26), [px1,py1]=toPx(c+22,d+26), cands=[];
    for (let s=Math.round(13/sx); s<=Math.round(24/sx); s++)
      for (let y=py0+s/2; y<=py1-s/2; y++) for (let x=px0+s/2; x<=px1-s/2; x++) {
        const score=squareScore(x,y,s); if (score>.72) cands.push({x,y,s,score});
      }
    cands.sort((p,q)=>q.score-p.score);
    const cars=[];
    for (const k of cands) if (!cars.some(q=>Math.abs(q.x-k.x)<(q.s+k.s)*.45 && Math.abs(q.y-k.y)<(q.s+k.s)*.45)) cars.push(k);
    // A lift is one column of cars; keep the column next to the room-list position.
    const [lx,ly]=toPx((a+c)/2,(b+d)/2);
    const best=cars.slice().sort((p,q)=>Math.hypot(p.x-lx,p.y-ly)-Math.hypot(q.x-lx,q.y-ly))[0];
    const column=best ? cars.filter(k=>Math.abs(k.x-best.x)<best.s*.35).sort((p,q)=>p.y-q.y) : [];
    return {id:p.id, cars:column.map(k=>mapBox(k.x-k.s/2,k.y-k.s/2,k.x+k.s/2,k.y+k.s/2))};
  });

  // Unnumbered rooms: closed areas of the wall mask that no listed item covers and no corridor runs through.
  const R = Math.max(2, Math.round(3/sx)), closed = new Uint8Array(W*H), tmp = new Uint8Array(W*H);
  for (let y=0;y<H;y++) { let last=-1e9; for (let x=0;x<W;x++){ if(wall[y*W+x])last=x; if(x-last<=R)tmp[y*W+x]=1; } last=1e9; for(let x=W-1;x>=0;x--){ if(wall[y*W+x])last=x; if(last-x<=R)tmp[y*W+x]=1; } }
  for (let x=0;x<W;x++) { let last=-1e9; for (let y=0;y<H;y++){ if(tmp[y*W+x])last=y; if(y-last<=R)closed[y*W+x]=1; } last=1e9; for(let y=H-1;y>=0;y--){ if(tmp[y*W+x])last=y; if(last-y<=R)closed[y*W+x]=1; } }
  const inside = (X,Y) => floor.footprint.some(b=>X>=b[0]&&X<=b[2]&&Y>=b[1]&&Y<=b[3]);
  const label = new Int32Array(W*H).fill(-1), stack = new Int32Array(W*H), comps = [];
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    const i=y*W+x; if (closed[i] || label[i]>=0) continue;
    let sp=0, n=0, bx0=x, bx1=x, by0=y, by1=y; stack[sp++]=i; label[i]=comps.length;
    while (sp) { const j=stack[--sp], jx=j%W, jy=(j-jx)/W; n++; if(jx<bx0)bx0=jx; if(jx>bx1)bx1=jx; if(jy<by0)by0=jy; if(jy>by1)by1=jy;
      if (jx>0 && !closed[j-1] && label[j-1]<0) { label[j-1]=comps.length; stack[sp++]=j-1; }
      if (jx<W-1 && !closed[j+1] && label[j+1]<0) { label[j+1]=comps.length; stack[sp++]=j+1; }
      if (jy>0 && !closed[j-W] && label[j-W]<0) { label[j-W]=comps.length; stack[sp++]=j-W; }
      if (jy<H-1 && !closed[j+W] && label[j+W]<0) { label[j+W]=comps.length; stack[sp++]=j+W; } }
    comps.push({n, box:mapBox(bx0-R,by0-R,bx1+R+1,by1+R+1), fill:n/((bx1-bx0+1)*(by1-by0+1))});
  }
  const corridorHits = new Set();
  for (const line of floor.corridors) for (let i=1;i<line.length;i++) {
    const [ax,ay]=line[i-1], [bx,by]=line[i], L=Math.hypot(bx-ax,by-ay);
    for (let t=0;t<=L;t+=2) { const [x,y]=toPx(ax+(bx-ax)*t/L, ay+(by-ay)*t/L), l=label[Math.round(y)*W+Math.round(x)]; if (l>=0) corridorHits.add(l); }
  }
  const known = [...floor.rooms.map(r=>r.box), ...floor.places.filter(p=>p.box).map(p=>p.box), ...floor.stairs.map(s=>s.box),
    ...lifts.flatMap(l=>l.cars)];
  const overlap = (a,b) => Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
  const extra = comps.filter((k,i)=>{
    const [x0,y0,x1,y1]=k.box, w=x1-x0, h=y1-y0, area=w*h;
    if (corridorHits.has(i) || k.fill<.72 || Math.min(w,h)<14 || area<500 || area>40000 || !inside((x0+x1)/2,(y0+y1)/2)) return false;
    return !known.some(b=>overlap(b,k.box) > .25*Math.min(area,(b[2]-b[0])*(b[3]-b[1])));
  }).map(k=>k.box);
  // A closed shape that lies inside a larger unnumbered room is furniture or a column.
  const rooms = extra.filter(b=>!extra.some(q=>q!==b && overlap(q,b)>.8*(b[2]-b[0])*(b[3]-b[1]) && (q[2]-q[0])*(q[3]-q[1])>(b[2]-b[0])*(b[3]-b[1])));
  return {lifts, rooms};
}
