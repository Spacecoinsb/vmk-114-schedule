// Architectural cutaway models built offline from the original floor plans.
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {FLOORS} from '@/lib/map-route.mjs';

type Box = number[];
type FloorData = {floor:number; image:string; imageBox:Box; footprint:Box[]; rooms:{id:string; x:number; y:number; box:Box}[];
  corridors:number[][][]; stairs:{id:string; x:number; y:number; box:Box}[]; places:{id:string; name:string; kind:string; x:number; y:number; box?:Box}[]};
export type Mode = 'schema'|'3d'|'pdf';
export type Mark = {floor:number; x:number; y:number; box?:Box; tone:'from'|'to'|'selected'};
export type Leg = {floor:number; points:number[][]};

const FLOOR_H = 70, ROOM_H = 12, CX = 980, CZ = 390;
const level = (floor:number) => (floor-1)*FLOOR_H;
const px = (x:number) => x-CX, pz = (y:number) => y-CZ;

// The model takes its colours from the current theme.
function palette() {
  const css = getComputedStyle(document.documentElement), v = (name:string) => css.getPropertyValue(name).trim() || '#888';
  const dark = document.documentElement.dataset.scheme === 'dark';
  const col = (x:string) => new THREE.Color(x);
  // Rooms stand out clearly from the floor slab; each kind keeps a recognisable hue.
  const room = dark ? col(v('--card')).lerp(col(v('--foreground')), .13) : col(v('--card'));
  const tint = (hue:string, amount:number) => col(hue).lerp(room, 1-amount).getHex();
  return {slab:(dark ? col(v('--background')).lerp(col(v('--foreground')), .1) : col(v('--muted'))).getHex(), room:room.getHex(),
    lecture:tint(v('--lecture'), dark ? .55 : .45), machine:tint('#34c27a', .42), wc:tint('#7f9bd6', .4), food:tint('#ff9f43', .45),
    place:tint('#a58bff', .45), lift:tint('#8fa3b8', .5), stair:tint(v('--now'), .6), edge:col(v('--foreground')).lerp(room, dark ? .45 : .6).getHex(),
    text:v('--foreground'), textSoft:v('--muted-foreground'), ghost:col(v('--border')).getHex(), now:col(v('--now')).getHex()};
}
const kindOf = (id:string) => /^П-/.test(id) ? 'lecture' : /^МЗ-/.test(id) ? 'machine' : 'room';

export class MapScene {
  private renderer:THREE.WebGLRenderer; private scene = new THREE.Scene();
  private persp = new THREE.PerspectiveCamera(38, 1, 5, 20000); private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
  private camera:THREE.Camera = this.ortho; private controls:OrbitControls;
  private floors = new Map<number, {group:THREE.Group; solid:THREE.Group; image:THREE.Mesh|null; loaded:boolean; loading:boolean; pick:THREE.Mesh}>();
  private dynamic = new THREE.Group(); private walker:THREE.Mesh|null = null; private walkPath:THREE.CurvePath<THREE.Vector3>|null = null;
  private mode:Mode = 'schema'; private active = 6; private frame = 0; private disposed = false; private down:{x:number; y:number}|null = null;
  private manualView = false;
  private colors = palette(); private anim:{from:THREE.Vector3; to:THREE.Vector3; t:number}|null = null;
  private labelCanvas:HTMLCanvasElement; private labelContext:CanvasRenderingContext2D; private marks:Mark[] = [];
  private observer:ResizeObserver;
  private loader = new GLTFLoader();
  private modelStatus:HTMLDivElement;

  constructor(private host:HTMLElement, private onPick:(floor:number, x:number, y:number)=>void) {
    this.renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure=1;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.autoUpdate=false; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.modelStatus = document.createElement('div'); this.modelStatus.className='map-model-status';
    this.modelStatus.setAttribute('role','status'); host.appendChild(this.modelStatus);
    this.labelCanvas = document.createElement('canvas'); this.labelCanvas.className = 'map-label-layer';
    this.labelContext = this.labelCanvas.getContext('2d')!; host.appendChild(this.labelCanvas);
    this.controls = new OrbitControls(this.ortho, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.screenSpacePanning = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc4d2d7, 1.5));
    const sun = new THREE.DirectionalLight(0xfff6e5, 2.4); sun.position.set(-700, 1200, -500); sun.castShadow=true;
    Object.assign(sun.shadow.camera,{left:-1200,right:1200,top:1000,bottom:-1000,near:1,far:3500});
    sun.shadow.mapSize.set(2048,2048); sun.shadow.bias=-.0003; sun.shadow.normalBias=.6;
    this.scene.add(sun);
    this.scene.add(this.dynamic);
    this.build();
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', e => { this.down = {x:e.clientX, y:e.clientY}; });
    el.addEventListener('pointerup', e => { if (this.down && Math.hypot(e.clientX-this.down.x, e.clientY-this.down.y) < 6) this.pick(e); else this.manualView=true; this.down = null; });
    el.addEventListener('wheel', () => { this.manualView=true; }, {passive:true});
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host);
    this.resize();
    const loop = () => { if (this.disposed) return; this.frame = requestAnimationFrame(loop); this.tick(); };
    loop();
  }

  private build() {
    this.colors = palette();
    for (const {group} of this.floors.values()) { this.scene.remove(group); disposeTree(group); }
    this.floors.clear();
    for (const f of FLOORS as FloorData[]) {
      const group = new THREE.Group(); group.position.y = level(f.floor);
      const solid = new THREE.Group();
      group.add(solid);
      // Invisible plane for taps.
      const [bx0, by0, bx1, by1] = bounds(f);
      const pick = new THREE.Mesh(new THREE.PlaneGeometry(bx1-bx0, by1-by0).rotateX(-Math.PI/2), new THREE.MeshBasicMaterial({visible:false}));
      pick.position.set(px((bx0+bx1)/2), 1, pz((by0+by1)/2)); group.add(pick);
      this.scene.add(group);
      this.floors.set(f.floor, {group, solid, image:null, loaded:false, loading:false, pick});
    }
    this.apply();
  }

  // The original drawing from the PDF, for checking the schematic.
  private image(floor:number) {
    const entry = this.floors.get(floor)!;
    if (entry.image) return entry.image;
    const f = (FLOORS as FloorData[]).find(q => q.floor === floor)!;
    const [x0, y0, x1, y1] = f.imageBox;
    const tex = new THREE.TextureLoader().load(import.meta.env.BASE_URL + f.image); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1-x0, y1-y0).rotateX(-Math.PI/2), new THREE.MeshBasicMaterial({map:tex,toneMapped:false}));
    mesh.position.set(px((x0+x1)/2), 0.5, pz((y0+y1)/2));
    entry.group.add(mesh); entry.image = mesh;
    return mesh;
  }

  private loadModel(floor:number) {
    const entry=this.floors.get(floor)!;
    if(entry.loaded || entry.loading) return;
    entry.loading=true;
    this.loader.load(import.meta.env.BASE_URL+`map/models/f${floor}.glb`, gltf=>{
      if(this.disposed || this.floors.get(floor)!==entry) { disposeTree(gltf.scene); return; }
      entry.solid.add(gltf.scene); entry.loaded=true; entry.loading=false;
      gltf.scene.traverse(o=>{const m=o as THREE.Mesh;if(m.isMesh){m.castShadow=['wall','cap','stair','lift'].includes(m.name);m.receiveShadow=true;}});
      this.themeModel(entry.solid); this.apply();
    },undefined,()=>{
      if(this.disposed)return;
      entry.loading=false;
      if(floor===this.active && this.mode!=='pdf') {
        this.modelStatus.textContent='Модель не загрузилась. Переключись на PDF или открой карту заново.';
        this.modelStatus.hidden=false;
      }
    });
  }

  private themeModel(root:THREE.Group) {
    const dark=document.documentElement.dataset.scheme==='dark';
    const shades:Record<string,number>={slab:0x23303a,floor:0x33434a,room:0x47565b,lecture:0x35655f,machine:0x3c576f,wc:0x435577,food:0x75604c,place:0x5c526d,wall:0x9daeb4,cap:0xc5d4d4,shadow:0x24363c,stair:0x577b7c,steel:0x9faeb5,lift:0x6c899c,rail:0xb8cbd0};
    root.traverse(o=>{
      const mesh=o as THREE.Mesh; if(!mesh.isMesh)return;
      const m=mesh.material as THREE.MeshStandardMaterial;
      if(!m.userData.lightColor)m.userData.lightColor=m.color.getHex();
      m.color.setHex(dark ? shades[m.name] ?? m.userData.lightColor : m.userData.lightColor);
    });
  }

  setView(mode:Mode, floor:number, lowest = floor) {
    const modeChanged = mode !== this.mode, floorChanged = floor !== this.active;
    this.mode = mode; this.active = floor; this.lowest = lowest;
    this.apply();
    if (modeChanged || floorChanged) { this.manualView=false; this.frameFloor(); }
  }
  private lowest = 6;

  private apply() {
    this.renderer.shadowMap.needsUpdate=true;
    for (const [n, e] of this.floors) {
      const on = n === this.active;
      // 3D: the floor in focus is solid, floors under it are faint, floors above are hidden.
      e.group.visible = on || (this.mode === '3d' && this.lowest < this.active && n >= this.lowest && n < this.active);
      e.solid.visible = this.mode !== 'pdf' || !on;
      const opacity = on ? 1 : n >= this.lowest ? .5 : .16;
      e.solid.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material|undefined; if (!m) return; m.transparent = !on || m.type === 'LineBasicMaterial'; m.opacity = on ? (m.type === 'LineBasicMaterial' ? .8 : 1) : opacity; m.depthWrite = on; m.needsUpdate = true; });
      if (on && this.mode === 'pdf') this.image(n);
      if (e.group.visible && this.mode !== 'pdf') this.loadModel(n);
      if (e.image) e.image.visible = on && this.mode === 'pdf';

    }
    const current=this.floors.get(this.active)!;
    this.modelStatus.hidden=this.mode==='pdf'||current.loaded;
    if(!this.modelStatus.hidden)this.modelStatus.textContent='Загружаем объёмную модель…';
    this.host.dataset.modelReady=String(current.loaded);
    this.applyDynamic();
    const top = this.mode !== '3d';
    this.camera = top ? this.ortho : this.persp;
    this.controls.object = this.camera;
    this.controls.enableRotate = !top;
    this.controls.touches = top ? {ONE:THREE.TOUCH.PAN, TWO:THREE.TOUCH.DOLLY_PAN} : {ONE:THREE.TOUCH.ROTATE, TWO:THREE.TOUCH.DOLLY_PAN};
    this.controls.mouseButtons = top ? {LEFT:THREE.MOUSE.PAN, MIDDLE:THREE.MOUSE.DOLLY, RIGHT:THREE.MOUSE.PAN} : {LEFT:THREE.MOUSE.ROTATE, MIDDLE:THREE.MOUSE.DOLLY, RIGHT:THREE.MOUSE.PAN};
    this.controls.maxPolarAngle = Math.PI*0.45; this.controls.minDistance = 120; this.controls.maxDistance = 8000;
    this.controls.minZoom = 0.05; this.controls.maxZoom = 14;
  }

  private frameFloor(focus?:{x:number; y:number}, overview=false) {
    const f = (FLOORS as FloorData[]).find(q => q.floor === this.active)!;
    const [x0, y0, x1, y1] = bounds(f), y = level(this.active);
    // Default view: the middle of the rooms (the U-shaped floors have an empty courtyard in the centre).
    const midY = f.rooms.reduce((a, r) => a + r.y, 0) / Math.max(1, f.rooms.length);
    if(!focus && !overview && this.host.clientWidth<600 && f.floor>=5) focus={x:980,y:580};
    const target = focus ? new THREE.Vector3(px(focus.x), y, pz(focus.y)) : new THREE.Vector3(px((x0+x1)/2), y, pz(f.rooms.length > 20 ? midY : (y0+y1)/2));
    const {clientWidth:w, clientHeight:h} = this.host;
    if (this.mode === '3d') {
      // Fit the whole floor width (or a neighbourhood of the focus) into the view, seen from the south-east above.
      const span = focus ? (this.manualView ? 280 : 620) : (x1-x0)*1.12, hfov = 2*Math.atan(Math.tan(THREE.MathUtils.degToRad(this.persp.fov/2))*this.persp.aspect);
      const dist = Math.min(7000, span/2/Math.tan(hfov/2));
      this.persp.position.copy(target).add(new THREE.Vector3(-0.22, 1.05, 0.72).normalize().multiplyScalar(dist));
    } else {
      // Start with the entire floor visible; search or a tap zooms into a room.
      this.ortho.zoom = focus ? w/360 : Math.min(w/((x1-x0)*1.08), h/((y1-y0)*1.18));
      this.ortho.position.set(target.x, y+2000, target.z); this.ortho.up.set(0, 0, -1);
      this.ortho.updateProjectionMatrix();
    }
    this.controls.target.copy(target); this.camera.lookAt(target); this.controls.update();
  }

  focus(floor:number, x:number, y:number) {
    if (floor !== this.active) { this.active = floor; this.apply(); }
    this.manualView=true;
    this.frameFloor({x, y});
  }

  zoom(factor:number) {
    this.manualView=true;
    if (this.mode === '3d') {
      const offset = this.persp.position.clone().sub(this.controls.target).divideScalar(factor);
      this.persp.position.copy(this.controls.target).add(offset);
    } else {
      this.ortho.zoom = THREE.MathUtils.clamp(this.ortho.zoom*factor, .08, 14);
      this.ortho.updateProjectionMatrix();
    }
    this.controls.update();
  }

  reset() { this.manualView=true; this.frameFloor(undefined,true); }

  setRoute(legs:Leg[], marks:Mark[]) {
    this.marks = marks;
    for (const o of [...this.dynamic.children]) { this.dynamic.remove(o); (o as THREE.Mesh).geometry?.dispose(); }
    this.walker = null; this.walkPath = null;
    const hl = (m:Mark) => {
      const r = m;
      const color = m.tone === 'to' ? this.colors.now : new THREE.Color(this.colors.text).getHex();
      if (r?.box) {
        const [x0, y0, x1, y1] = r.box, g = new THREE.BoxGeometry(x1-x0-2, 1, y1-y0-2);
        const box = new THREE.Mesh(g, new THREE.MeshBasicMaterial({color, transparent:true, opacity:.28, depthWrite:false}));
        box.position.set(px((x0+x1)/2), level(m.floor)+1.6, pz((y0+y1)/2)); box.userData.floor = m.floor; this.dynamic.add(box);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({color})); edges.position.copy(box.position); edges.userData.floor = m.floor; this.dynamic.add(edges);
      }
      const pin = new THREE.Group();
      const head = new THREE.Mesh(new THREE.SphereGeometry(7, 20, 14), new THREE.MeshLambertMaterial({color}));
      const tip = new THREE.Mesh(new THREE.ConeGeometry(4.5, 16, 16).rotateX(Math.PI), new THREE.MeshLambertMaterial({color}));
      head.position.y = 30; tip.position.y = 20; pin.add(head, tip);
      pin.position.set(px(m.x), level(m.floor)+ROOM_H, pz(m.y)); pin.userData.pin = true; pin.userData.floor = m.floor; this.dynamic.add(pin);
    };
    marks.forEach(hl);
    if (!legs.length) { this.applyDynamic(); return; }
    const tube = (pts:THREE.Vector3[], floor:number|null) => {
      const path = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 1; i < pts.length; i++) if (pts[i].distanceTo(pts[i-1]) > 0.01) path.add(new THREE.LineCurve3(pts[i-1], pts[i]));
      if (!path.curves.length) return;
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(32, pts.length*6), 2.6, 8, false), new THREE.MeshBasicMaterial({color:this.colors.now}));
      mesh.renderOrder = 3; mesh.userData.floor = floor; this.dynamic.add(mesh);
    };
    const all:THREE.Vector3[] = [];
    legs.forEach((leg, i) => {
      const pts = leg.points.map(([x, y]) => new THREE.Vector3(px(x), level(leg.floor)+ROOM_H+2, pz(y)));
      tube(pts, leg.floor);
      if (i > 0) tube([all[all.length-1], pts[0]], null);   // up or down the stairwell
      all.push(...pts);
    });
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 1; i < all.length; i++) if (all[i].distanceTo(all[i-1]) > 0.01) path.add(new THREE.LineCurve3(all[i-1], all[i]));
    if (!path.curves.length) return;
    this.walker = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 12), new THREE.MeshBasicMaterial({color:0xffffff}));
    const ring = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 12), new THREE.MeshBasicMaterial({color:this.colors.now, transparent:true, opacity:.5}));
    this.walker.add(ring); this.walker.userData.walker = true; this.dynamic.add(this.walker); this.walkPath = path;
    this.applyDynamic();
  }

  // Route pieces and highlights follow floor visibility: flat views show one floor only.
  private applyDynamic() {
    for (const o of this.dynamic.children) {
      const f = o.userData.floor as number|null|undefined;
      o.visible = this.mode === '3d' ? (f == null || f <= this.active) : f === this.active;
      if (o.userData.walker) o.visible = this.mode === '3d';
    }
  }

  private pick(e:PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1, -(e.clientY-rect.top)/rect.height*2+1), this.camera);
    const hit = ray.intersectObject(this.floors.get(this.active)!.pick)[0];
    if (hit) this.onPick(this.active, hit.point.x+CX, hit.point.z+CZ);
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h);
    const ratio = Math.min(devicePixelRatio, 2);
    this.labelCanvas.width = Math.round(w*ratio); this.labelCanvas.height = Math.round(h*ratio);
    this.labelCanvas.style.width = `${w}px`; this.labelCanvas.style.height = `${h}px`;
    this.persp.aspect = w/h; this.persp.updateProjectionMatrix();
    Object.assign(this.ortho, {left:-w/2, right:w/2, top:h/2, bottom:-h/2}); this.ortho.updateProjectionMatrix();
    if (!this.manualView) this.frameFloor();
  }

  private tick() {
    this.controls.update();
    const t = performance.now()/1000;
    if (this.walker && this.walkPath) this.walker.position.copy(this.walkPath.getPointAt((t*0.18)%1));
    for (const o of this.dynamic.children) if (o.userData.pin) o.children[0].position.y = 30 + Math.sin(t*3)*3;
    // Labels keep their size on screen in the flat view.
    this.renderer.render(this.scene, this.camera);
    this.drawLabels();
  }

  private drawLabels() {
    const ctx = this.labelContext, w = this.host.clientWidth, h = this.host.clientHeight;
    const ratio = Math.min(devicePixelRatio, 2);
    ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,w,h);
    if (this.mode === 'pdf') return;
    const f = (FLOORS as FloorData[]).find(q => q.floor === this.active)!;
    const point = (x:number,y:number,height=ROOM_H+2) => {
      const p = new THREE.Vector3(px(x),level(this.active)+height,pz(y)).project(this.camera);
      return {x:(p.x+1)*w/2,y:(1-p.y)*h/2,visible:p.z<1 && p.x>-1.1 && p.x<1.1 && p.y>-1.1 && p.y<1.1};
    };
    const selected = new Set(this.marks.filter(m=>m.floor===this.active).map(m=>`${m.x}:${m.y}`));
    const ink = document.documentElement.dataset.scheme==='dark' ? '#f7f8ff' : '#20202a';
    const bg = document.documentElement.dataset.scheme==='dark' ? 'rgba(19,26,54,.88)' : 'rgba(255,255,252,.9)';
    const accent = `#${this.colors.now.toString(16).padStart(6,'0')}`;
    const occupied:{x:number;y:number;w:number;h:number}[] = [];
    const labels = [
      ...f.rooms.map(r=>({text:r.id,x:r.x,y:r.y,box:r.box,priority:(r.box[2]-r.box[0])*(r.box[3]-r.box[1])})),
      ...f.places.filter(p=>p.kind==='wc'||p.kind==='food').map(p=>({text:p.kind==='wc'?'WC':p.name.replace(/\s*\(.*\)/,'').replace(/^Столовая /,''),x:p.x,y:p.y,box:p.box,priority:2000})),
      ...f.stairs.map(s=>({text:`Л ${s.id}`,x:s.x,y:s.y,box:s.box,priority:900})),
    ].sort((a,b)=>b.priority-a.priority);
    for (const item of labels) {
      const p = point(item.x,item.y); if (!p.visible) continue;
      const b=item.box;
      const corners=b ? [point(b[0],b[1]),point(b[2],b[1]),point(b[2],b[3]),point(b[0],b[3])] : [point(item.x-25,item.y),point(item.x+25,item.y)];
      const roomWidth=Math.max(...corners.map(q=>q.x))-Math.min(...corners.map(q=>q.x));
      const important = selected.has(`${item.x}:${item.y}`);
      ctx.font = `${important?'800':'700'} 12px system-ui, sans-serif`;
      const textWidth = ctx.measureText(item.text).width, pillWidth = textWidth+11;
      if (!important && roomWidth < pillWidth+2) continue;
      const rect = {x:p.x-pillWidth/2,y:p.y-10,w:pillWidth,h:20};
      if (rect.x<2||rect.x+rect.w>w-2||rect.y<2||rect.y+rect.h>h-2) continue;
      if (!important && occupied.some(q=>rect.x<q.x+q.w+2&&rect.x+rect.w+2>q.x&&rect.y<q.y+q.h+2&&rect.y+rect.h+2>q.y)) continue;
      occupied.push(rect);
      ctx.fillStyle = important ? accent : bg;
      ctx.beginPath();
      if (typeof ctx.roundRect==='function') ctx.roundRect(rect.x,rect.y,rect.w,rect.h,5);
      else ctx.rect(rect.x,rect.y,rect.w,rect.h);
      ctx.fill();
      ctx.fillStyle = important ? '#fff' : ink;
      ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(item.text,p.x,p.y+.5);
    }
  }

  retheme() { this.colors=palette(); for(const e of this.floors.values())this.themeModel(e.solid); }

  dispose() {
    this.disposed = true; cancelAnimationFrame(this.frame); this.observer.disconnect(); this.controls.dispose();
    disposeTree(this.scene);
    this.renderer.dispose(); this.renderer.domElement.remove(); this.labelCanvas.remove(); this.modelStatus.remove();
  }
}

function disposeTree(root:THREE.Object3D) {
  root.traverse(o => {
    const m = o as THREE.Mesh; m.geometry?.dispose();
    const materials = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const material of materials) {
      (material as THREE.Material & {map?:THREE.Texture}).map?.dispose(); material.dispose();
    }
  });
}

function bounds(f:FloorData):Box {
  const xs = f.footprint.flatMap(b => [b[0], b[2]]), ys = f.footprint.flatMap(b => [b[1], b[3]]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function floorTag(floor:number, x:number, z:number, color:string) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const ctx = c.getContext('2d')!; ctx.font = '800 64px system-ui, sans-serif'; ctx.fillStyle = color; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText(`${floor}`, 240, 48);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c), transparent:true, depthTest:false}));
  s.scale.set(80, 30, 1); s.position.set(x-30, 10, z);
  return s;
}
