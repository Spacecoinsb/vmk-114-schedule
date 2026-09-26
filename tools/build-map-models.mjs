// Reproducible, texture-free architectural cutaway models.
// Walls come from the room layout, not from tracing the raster plan: every room, toilet,
// stairwell and lift (lib/map-data.json) and every unnumbered room found on the plans
// (lib/map-plan.json, from tools/plan-features.html) is a closed box with a door towards
// the corridor. Walls shared by neighbours are merged into one, the outer shell follows
// the building outline with windows, and wall ends are joined to the walls they meet.
// Heights and finishes are schematic: the supplied PDF contains no elevations.
//
//   node tools/build-map-models.mjs [--svg]   (--svg also writes tools/out/f<floor>.svg for review)
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(data=>{this.result=data;this.onloadend?.();}); }
  readAsDataURL(blob) { blob.arrayBuffer().then(data=>{this.result=`data:${blob.type};base64,${Buffer.from(data).toString('base64')}`;this.onloadend?.();}); }
};
const {floors} = JSON.parse(await readFile('lib/map-data.json','utf8'));
const plan = JSON.parse(await readFile('lib/map-plan.json','utf8'));
const svg = process.argv.includes('--svg');
await mkdir('public/map/models',{recursive:true});
if (svg) await mkdir('tools/out',{recursive:true});
const colors = {slab:0xcfd6da, floor:0xe8ece9, room:0xf8f5ee, lecture:0xc1dfd8, machine:0xd3e2ed, wc:0xd3ddec, food:0xeddcc7,
  place:0xdfdced, wall:0xf4f4f0, cap:0x7f9293, glass:0x9fc3d3, door:0xb89a78, stair:0xc3d8d5, steel:0x677e85, lift:0xb7c9d1, rail:0x819a9e};

const WALL_H = 18, DOOR_H = 13.5, INNER = 2.4, OUTER = 4;
const MERGE = 12;      // boxes of neighbouring rooms are drawn up to this far apart
const SHELL = 26;      // rooms this close to the outline share the outer wall
const JOIN = 15;       // wall ends this close to a crossing wall are extended to it
const kindOfRoom = id => /^П-/.test(id) ? 'lecture' : /^МЗ-/.test(id) ? 'machine' : 'room';
const inside = ([x0,y0,x1,y1], x, y, m=0) => x>x0-m && x<x1+m && y>y0-m && y<y1+m;
const overlap = (a,b) => Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
const areaOf = b => (b[2]-b[0])*(b[3]-b[1]);
const median = xs => { const s=[...xs].sort((a,b)=>a-b); return s.length ? s[s.length>>1] : 0; };

// Outline of a union of rectangles: the parts of every edge with no rectangle right outside it.
// `out` is the outward direction (−1: towards smaller coordinates).
function outline(rects) {
  const edges = [];
  for (const [x0,y0,x1,y1] of rects) {
    const cuts = (lo, hi, pick) => [...new Set([lo, hi, ...rects.flatMap(pick).filter(v=>v>lo&&v<hi)])].sort((a,b)=>a-b);
    const xs = cuts(x0, x1, r=>[r[0],r[2]]), ys = cuts(y0, y1, r=>[r[1],r[3]]);
    for (let i=1;i<xs.length;i++) {
      const m=(xs[i-1]+xs[i])/2;
      if (!rects.some(r=>inside(r,m,y0-.5))) edges.push({o:'h',c:y0,a:xs[i-1],b:xs[i],out:-1});
      if (!rects.some(r=>inside(r,m,y1+.5))) edges.push({o:'h',c:y1,a:xs[i-1],b:xs[i],out:1});
    }
    for (let i=1;i<ys.length;i++) {
      const m=(ys[i-1]+ys[i])/2;
      if (!rects.some(r=>inside(r,x0-.5,m))) edges.push({o:'v',c:x0,a:ys[i-1],b:ys[i],out:-1});
      if (!rects.some(r=>inside(r,x1+.5,m))) edges.push({o:'v',c:x1,a:ys[i-1],b:ys[i],out:1});
    }
  }
  // Join collinear pieces (the cuts split long sides) into whole straight runs.
  const runs = [];
  for (const e of edges.sort((p,q)=>p.o.localeCompare(q.o)||p.c-q.c||p.out-q.out||p.a-q.a)) {
    const last = runs.at(-1);
    if (last && last.o===e.o && Math.abs(last.c-e.c)<.01 && last.out===e.out && e.a<=last.b+.01) last.b=Math.max(last.b,e.b);
    else runs.push({...e});
  }
  return runs;
}

function nearestCorridor(corridors, x, y) {
  let best = null;
  for (const line of corridors) for (let i=1;i<line.length;i++) {
    const [ax,ay]=line[i-1], [bx,by]=line[i], dx=bx-ax, dy=by-ay, len=dx*dx+dy*dy||1;
    const t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/len)), px=ax+t*dx, py=ay+t*dy, d=Math.hypot(px-x,py-y);
    if (!best || d<best.d) best={x:px,y:py,d};
  }
  return best ?? {x, y:y+1e4, d:1e4};
}

const sidesOf = ([x0,y0,x1,y1]) => ({
  top:{o:'h',c:y0,a:x0,b:x1,inward:1}, bottom:{o:'h',c:y1,a:x0,b:x1,inward:-1},
  left:{o:'v',c:x0,a:y0,b:y1,inward:1}, right:{o:'v',c:x1,a:y0,b:y1,inward:-1}});

// The side a door (or an open front) goes on: the one that looks out onto the corridor
// rather than into a neighbouring room. `only` limits the choice (lift doors are on the long side).
function doorSide(box, corridors, blockers, only) {
  const sides = sidesOf(box), cx=(box[0]+box[2])/2, cy=(box[1]+box[3])/2, target=nearestCorridor(corridors,cx,cy);
  let best=null;
  for (const [name,s] of Object.entries(sides)) {
    if (only && !only.includes(name)) continue;
    const along = Math.max(s.a+4, Math.min(s.b-4, s.o==='h' ? target.x : target.y));
    const [px,py] = s.o==='h' ? [along, s.c-s.inward*8] : [s.c-s.inward*8, along];
    const blocked = blockers.some(b=>b!==box && inside(b,px,py));
    const score = (blocked ? 1e5 : 0) + nearestCorridor(corridors,px,py).d;
    if (!best || score<best.score) best={name,s,along,score};
  }
  return best;
}

// Neighbouring boxes are drawn a few units apart: their facing edges become one wall.
function mergeWalls(edges) {
  const parent=edges.map((_,i)=>i), find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
  for (let i=0;i<edges.length;i++) for (let j=i+1;j<edges.length;j++) {
    const e=edges[i], q=edges[j];
    if (e.o===q.o && Math.abs(e.c-q.c)<=MERGE && Math.min(e.b,q.b)-Math.max(e.a,q.a) > -1.5) parent[find(i)]=find(j);
  }
  const groups=new Map();
  edges.forEach((e,i)=>{const k=find(i); if(!groups.has(k))groups.set(k,[]); groups.get(k).push(e);});
  return [...groups.values()].map(list=>{
    const weight=list.reduce((s,e)=>s+(e.b-e.a),0)||1, c=list.reduce((s,e)=>s+e.c*(e.b-e.a),0)/weight;
    return {o:list[0].o, c, spans:unite(list.map(e=>[e.a,e.b])), ext:false, gaps:[]};
  });
}
function unite(spans) {
  const merged=[];
  for (const [a,b] of [...spans].sort((p,q)=>p[0]-q[0])) { const last=merged.at(-1); if(last && a<=last[1]+3) last[1]=Math.max(last[1],b); else merged.push([a,b]); }
  return merged;
}
const cut = (spans, a, b) => spans.flatMap(([p,q])=>b<=p||a>=q ? [[p,q]] : [[p,a],[b,q]].filter(([s,t])=>t-s>1.5));

// One column of lift cars from the squares found on the plan, evenly split.
function liftColumn(place, found) {
  const cars = found?.cars ?? [];
  if (!cars.length) { const [x0,y0,x1,y1]=place.box; return {box:place.box, cars:[[x0,y0,x1,(y0+y1)/2],[x0,(y0+y1)/2,x1,y1]]}; }
  const size=median(cars.map(c=>Math.max(c[2]-c[0],c[3]-c[1]))), cx=median(cars.map(c=>(c[0]+c[2])/2));
  const good=cars.filter(c=>Math.abs((c[0]+c[2])/2-cx)<size*.4 && Math.max(c[2]-c[0],c[3]-c[1])<size*1.3);
  let y0=Math.min(...good.map(c=>c[1])), y1=Math.max(...good.map(c=>c[3]));
  // Passenger lifts stand in threes; a lone large square is a goods lift. Missing cars were
  // hidden by labels or doors on the plan: add them on the side of the listed position.
  const n=good.length===1 && size>21 ? 1 : 3, want=size*n, centre=(place.box[1]+place.box[3])/2;
  while (y1-y0 < want-1) { if (Math.abs((y0-size+y1)/2-centre) < Math.abs((y0+y1+size)/2-centre)) y0-=Math.min(size,want-(y1-y0)); else y1+=Math.min(size,want-(y1-y0)); }
  if (y1-y0 > want+size*.5) { const c=(y0+y1)/2; y0=c-want/2; y1=c+want/2; }
  const box=[cx-size/2,y0,cx+size/2,y1];
  return {box, cars:Array.from({length:n},(_,i)=>[box[0],y0+(y1-y0)*i/n,box[2],y0+(y1-y0)*(i+1)/n])};
}

for (const f of floors) {
  const group=new THREE.Group(); group.name=`VMK floor ${f.floor}`;
  group.userData={floor:f.floor,source:'lib/map-data.json + lib/map-plan.json',geometry:'architectural-cutaway-v3'};
  const batches=new Map();
  const add=(kind,g)=>{if(!batches.has(kind))batches.set(kind,[]);batches.get(kind).push(g);};
  function box(x,y,z,w,h,d,kind,angle=0) {
    if(w<=.05||h<=.05||d<=.05)return;
    const g=new THREE.BoxGeometry(w,h,d);g.rotateY(angle);g.translate(x-980,y,z-390);add(kind,g);
  }
  function line(ax,az,bx,bz,y,h,width,kind) {box((ax+bx)/2,y,(az+bz)/2,Math.hypot(bx-ax,bz-az),h,width,kind,-Math.atan2(bz-az,bx-ax));}
  function area(b,y,h,kind,inset=0) {const [x0,z0,x1,z1]=b;box((x0+x1)/2,y,(z0+z1)/2,x1-x0-inset*2,h,z1-z0-inset*2,kind);}
  const piece=(w,a,b,y0,y1,thick,kind)=>w.o==='h' ? line(a,w.c,b,w.c,(y0+y1)/2,y1-y0,thick,kind) : line(w.c,a,w.c,b,(y0+y1)/2,y1-y0,thick,kind);

  // Everything that is a closed space on this floor.
  const places=f.places.filter(p=>p.box && p.kind!=='lift');
  const lifts=f.places.filter(p=>p.kind==='lift' && p.box).map(p=>liftColumn(p, plan[f.floor]?.lifts.find(l=>l.id===p.id)));
  const listed=[...f.rooms.map(r=>r.box), ...places.map(p=>p.box), ...f.stairs.map(s=>s.box), ...lifts.map(l=>l.box)];
  const extra=(plan[f.floor]?.rooms ?? []).filter(b=>!listed.some(q=>overlap(q,b)>.25*Math.min(areaOf(q),areaOf(b))));
  const blockers=[...listed, ...extra];

  for(const b of f.footprint) {area(b,-3,6,'slab');area(b,.2,.5,'floor');}
  for(const r of f.rooms) area(r.box,.7,1,kindOfRoom(r.id),1);
  for(const p of places) area(p.box,.7,1,colors[p.kind]?p.kind:'place',1);
  for(const b of extra) area(b,.7,1,'room',1);

  // Plan: room boxes with doors, open-fronted stairwells and open halls, lift shafts.
  const edges=[], doors=[];
  const enclose=(b,width,{open=false,only,liftCars,blockers:against=blockers}={})=>{
    const side=doorSide(b,f.corridors,against,only);
    for (const [name,s] of Object.entries(sidesOf(b))) {
      if (open && name===side.name) continue;
      edges.push({o:s.o,c:s.c,a:s.a,b:s.b});
      if (name!==side.name || open) continue;
      if (liftCars) { for (const car of liftCars) { const [a,c]=s.o==='h'?[car[0],car[2]]:[car[1],car[3]], w=(c-a)*.62, m=(a+c)/2; doors.push({o:s.o,c:s.c,a:m-w/2,b:m+w/2,inward:s.inward,lift:true}); } continue; }
      const w=Math.min(width,(s.b-s.a)-6), mid=Math.max(s.a+w/2+2.5,Math.min(s.b-w/2-2.5,side.along));
      doors.push({o:s.o,c:s.c,a:mid-w/2,b:mid+w/2,inward:s.inward});
    }
  };
  for(const r of f.rooms) enclose(r.box,Math.min(14,Math.max(10,(r.box[2]-r.box[0])*.25)));
  for(const p of places) enclose(p.box,p.kind==='wc'?9:14,{open:!!p.open});
  for(const b of extra) enclose(b,11);
  for(const s of f.stairs) enclose(s.box,0,{open:true});
  for(const l of lifts) {
    const [x0,y0,x1,y1]=l.box, tall=y1-y0>=x1-x0;
    enclose(l.box,0,{blockers:listed,only:tall?['left','right']:['top','bottom'],liftCars:l.cars});
    for (const car of l.cars.slice(1)) edges.push(tall ? {o:'h',c:car[1],a:x0,b:x1} : {o:'v',c:car[0],a:y0,b:y1});
  }
  const walls=mergeWalls(edges);

  // Outer shell: pull each side of the outline onto the rooms along it, drop their duplicate walls.
  const shell=outline(f.footprint).map(e=>({...e, c0:e.c}));
  for (const e of shell) {
    const near=walls.filter(w=>w.o===e.o && (w.c-e.c)*e.out<=2 && Math.abs(w.c-e.c)<=SHELL && w.spans.some(([a,b])=>Math.min(b,e.b)-Math.max(a,e.a)>8));
    if (!near.length) continue;
    const len=w=>w.spans.reduce((s,[a,b])=>s+Math.max(0,Math.min(b,e.b)-Math.max(a,e.a)),0);
    const weighted=near.flatMap(w=>Array(Math.max(1,Math.round(len(w)/10))).fill(w.c));
    e.c=median(weighted)+e.out*(OUTER/2+.4);
    for (const w of near) w.spans=cut(w.spans,e.a-1,e.b+1);
  }
  // Corners of the shell follow the moved sides.
  for (const e of shell) for (const end of ['a','b']) {
    const q=shell.find(q=>q.o!==e.o && Math.abs(q.c0-e[end])<.01 && q.a-.01<=e.c0 && e.c0<=q.b+.01);
    if (q) e[end]=q.c;
  }
  for (const e of shell) walls.push({o:e.o,c:e.c,spans:[[Math.min(e.a,e.b),Math.max(e.a,e.b)]],ext:true,gaps:[]});
  for (const w of walls) w.spans=w.spans.filter(([a,b])=>b-a>1.5);

  // Doors go into the merged wall they belong to.
  for(const d of doors) {
    const w=walls.filter(w=>w.o===d.o&&!w.ext&&Math.abs(w.c-d.c)<=MERGE+1&&w.spans.some(([a,b])=>a<=d.a+.5&&b>=d.b-.5))
      .sort((p,q)=>Math.abs(p.c-d.c)-Math.abs(q.c-d.c))[0];
    if(w) w.gaps.push(d);
  }
  // Wall ends that stop just short of a crossing wall are extended to meet it.
  for (const w of walls) if (!w.ext) w.spans=w.spans.map(([a,b])=>{
    const cross=walls.filter(v=>v.o!==w.o && v.spans.some(([p,q])=>p-3<=w.c && w.c<=q+3));
    const lo=cross.filter(v=>v.c>=a-JOIN && v.c<=a+2).sort((p,q)=>Math.abs(p.c-a)-Math.abs(q.c-a))[0];
    const hi=cross.filter(v=>v.c<=b+JOIN && v.c>=b-2).sort((p,q)=>Math.abs(p.c-b)-Math.abs(q.c-b))[0];
    return [lo?lo.c:a, hi?hi.c:b];
  });

  for(const w of walls) {
    const thick=w.ext?OUTER:INNER;
    let spans=w.spans;
    for(const g of w.gaps) spans=cut(spans,g.a,g.b);
    for(const [a,b] of spans) {
      // Extend by half a thickness so corners close without gaps.
      const a2=a-thick/2, b2=b+thick/2;
      if(!w.ext) { piece(w,a2,b2,0,WALL_H,thick,'wall'); piece(w,a2,b2,WALL_H,WALL_H+.8,thick+.3,'cap'); continue; }
      // Outer walls: sill, lintel, piers and glazing, one window per ~26 units.
      const len=b2-a2, n=Math.max(1,Math.round(len/26)), step=len/n, pier=Math.min(6,step*.35);
      piece(w,a2,b2,0,6,thick,'wall'); piece(w,a2,b2,15,WALL_H,thick,'wall');
      for(let i=0;i<=n;i++) { const m=a2+i*step; piece(w,Math.max(a2,m-pier/2),Math.min(b2,m+pier/2),6,15,thick,'wall'); }
      piece(w,a2,b2,6,15,1,'glass');
      piece(w,a2,b2,WALL_H,WALL_H+.8,thick+.3,'cap');
    }
    for(const g of w.gaps) {
      piece(w,g.a,g.b,DOOR_H,WALL_H,thick,'wall'); piece(w,g.a,g.b,WALL_H,WALL_H+.8,thick+.3,'cap');
      if (g.lift) {
        // Closed sliding doors of a lift car, with a steel frame.
        const m=(g.a+g.b)/2, off=-g.inward*(thick/2+.2);
        const at=(p,q)=>w.o==='h' ? [p,w.c+off,q,w.c+off] : [w.c+off,p,w.c+off,q];
        line(...at(g.a,m-.2),DOOR_H/2,DOOR_H,.6,'lift');
        line(...at(m+.2,g.b),DOOR_H/2,DOOR_H,.6,'lift');
        line(...at(g.a-.8,g.b+.8),DOOR_H+.5,1,.9,'steel');
        continue;
      }
      // A door leaf standing open into the room.
      const len=g.b-g.a, ang=THREE.MathUtils.degToRad(70), inward=g.inward;
      const [hx,hz]=w.o==='h'?[g.a,w.c]:[w.c,g.a];
      const [ux,uz]=w.o==='h'?[Math.cos(ang),inward*Math.sin(ang)]:[inward*Math.sin(ang),Math.cos(ang)];
      line(hx,hz,hx+ux*(len-1),hz+uz*(len-1),DOOR_H/2+.4,DOOR_H-.4,.8,'door');
    }
  }

  for(const s of f.stairs) {
    const [x0,z0,x1,z1]=s.box,w=x1-x0,d=z1-z0;
    area(s.box,.8,1.2,'stair');
    const flight=(w-5)/2,run=(d-8)/10;
    for(let i=0;i<10;i++) {
      box(x0+flight/2+1,(i+1)*.45,z0+4+(i+.5)*run,flight,(i+1)*.9,run+.1,'stair');
      box(x1-flight/2-1,9+(10-i)*.45,z0+4+(i+.5)*run,flight,(10-i)*.9,run+.1,'stair');
      box(x0+flight/2+1,(i+1)*.9+.15,z0+4+i*run,flight,.3,.6,'steel');
      box(x1-flight/2-1,9+(10-i)*.9+.15,z0+4+(i+1)*run,flight,.3,.6,'steel');
    }
    box((x0+x1)/2,9,z1-2,w-2,1,5,'stair');
    for(let i=0;i<=4;i++) {
      const z=z0+4+i*(d-8)/4, h=3+i*9/4;
      box(x0+1,h,z,.8,6,.8,'rail');box(x1-1,21-i*9/4,z,.8,6,.8,'rail');
    }
    const rail=(x,start,end)=>{const a=new THREE.Vector3(x-980,start,z0+4-390),b=new THREE.Vector3(x-980,end,z1-4-390);const g=new THREE.CylinderGeometry(.5,.5,a.distanceTo(b),6);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize()));g.translate(...a.add(b).multiplyScalar(.5).toArray());add('rail',g);};
    rail(x0+1,6,15);rail(x1-1,24,15);
  }
  // Lift cars: a steel floor, and a cross on the roof like on the plan.
  for(const l of lifts) for(const car of l.cars) {
    area(car,.8,1,'lift',.6);
    const [x0,z0,x1,z1]=car;
    line(x0+1,z0+1,x1-1,z1-1,WALL_H-.2,.4,.6,'steel'); line(x0+1,z1-1,x1-1,z0+1,WALL_H-.2,.4,.6,'steel');
    area(car,WALL_H+.4,.8,'cap',-.3);
  }

  for(const [kind,geometries] of batches) {
    const merged=mergeGeometries(geometries);merged.computeBoundingSphere();
    const material=new THREE.MeshStandardMaterial({color:colors[kind],roughness:kind==='glass'||kind==='lift'?.3:.82,metalness:['rail','steel','lift','glass'].includes(kind)?.35:0});material.name=kind;
    const mesh=new THREE.Mesh(merged,material);mesh.name=kind;mesh.castShadow=['wall','cap','stair','lift','door'].includes(kind);mesh.receiveShadow=true;group.add(mesh);
    geometries.forEach(g=>g.dispose());
  }
  const binary=await new GLTFExporter().parseAsync(group,{binary:true});
  await writeFile(`public/map/models/f${f.floor}.glb`,Buffer.from(binary));
  console.log(`Floor ${f.floor}: ${Math.round(binary.byteLength/1024)} KB, ${group.children.length} mesh batches, ${walls.length} walls, ${doors.length} doors, ${extra.length} unnumbered rooms`);

  if (svg) {
    const [bx0,by0,bx1,by1]=f.imageBox, s=[];
    s.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bx0} ${by0} ${bx1-bx0} ${by1-by0}">`);
    for(const w of walls) { let spans=w.spans; for(const g of w.gaps) spans=cut(spans,g.a,g.b); for(const [a,b] of spans) {
      const [x1,y1,x2,y2]=w.o==='h'?[a,w.c,b,w.c]:[w.c,a,w.c,b];
      s.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${w.ext?'#135':'#c22'}" stroke-width="${w.ext?OUTER:INNER}"/>`);
    }}
    for(const d of doors) { const [x1,y1,x2,y2]=d.o==='h'?[d.a,d.c,d.b,d.c]:[d.c,d.a,d.c,d.b]; s.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${d.lift?'#06f':'#1a2'}" stroke-width="1.5"/>`); }
    for(const l of lifts) for(const c of l.cars) s.push(`<rect x="${c[0]}" y="${c[1]}" width="${c[2]-c[0]}" height="${c[3]-c[1]}" fill="#06f" fill-opacity=".25"/>`);
    s.push('</svg>');
    await writeFile(`tools/out/f${f.floor}.svg`,s.join('\n'));
  }
}
