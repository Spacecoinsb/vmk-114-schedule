// Real 3D model of the faculty built from the room outlines in lib/map-data.json.
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {FLOORS} from '@/lib/map-route.mjs';

type Box = number[];
type FloorData = {floor:number; image:string; imageBox:Box; footprint:Box[]; rooms:{id:string; x:number; y:number; box:Box}[];
  stairs:{id:string; x:number; y:number; box:Box}[]; places:{id:string; name:string; kind:string; x:number; y:number; box?:Box}[]};
export type Mode = 'schema'|'3d'|'pdf';
export type Mark = {floor:number; x:number; y:number; box?:Box; tone:'from'|'to'|'selected'};
export type Leg = {floor:number; points:number[][]};

const FLOOR_H = 70, ROOM_H = 12, CX = 980, CZ = 390;
const level = (floor:number) => (floor-1)*FLOOR_H;
const px = (x:number) => x-CX, pz = (y:number) => y-CZ;

function palette(dark:boolean) {
  // Same warm palette as the timetable: sunny lecture halls, ink outlines.
  return dark ? {slab:0x2b2720, room:0x3a352c, lecture:0xc99b16, machine:0x2f5a3f, wc:0x3b3f4a, food:0x7a4a22, place:0x4b3f66, stair:0x8a3a28,
    edge:0x8d8574, text:'#f3eee3', textSoft:'#c9c1b1', ghost:0x5a5448}
    : {slab:0xe9e3d6, room:0xfffdf8, lecture:0xffd23f, machine:0xcdeed6, wc:0xe6e8ef, food:0xffd9b8, place:0xe9e2ff, stair:0xffb9a6,
    edge:0x8f8672, text:'#1d1b16', textSoft:'#5e584c', ghost:0xd6cfbf};
}
const kindOf = (id:string) => /^П-/.test(id) ? 'lecture' : /^МЗ-/.test(id) ? 'machine' : 'room';
const ICON:Record<string,string> = {wc:'WC', food:'🍽', place:'★'};

export class MapScene {
  private renderer:THREE.WebGLRenderer; private scene = new THREE.Scene();
  private persp = new THREE.PerspectiveCamera(38, 1, 5, 20000); private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
  private camera:THREE.Camera = this.ortho; private controls:OrbitControls;
  private floors = new Map<number, {group:THREE.Group; solid:THREE.Group; labels:THREE.Mesh|null; image:THREE.Mesh|null; pick:THREE.Mesh}>();
  private dynamic = new THREE.Group(); private walker:THREE.Mesh|null = null; private walkPath:THREE.CurvePath<THREE.Vector3>|null = null;
  private mode:Mode = 'schema'; private active = 6; private frame = 0; private disposed = false; private down:{x:number; y:number}|null = null;
  private colors = palette(false); private anim:{from:THREE.Vector3; to:THREE.Vector3; t:number}|null = null;

  constructor(private host:HTMLElement, private onPick:(floor:number, x:number, y:number)=>void) {
    this.renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.ortho, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.screenSpacePanning = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-600, 1200, 800); this.scene.add(sun);
    this.scene.add(this.dynamic);
    this.build();
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', e => { this.down = {x:e.clientX, y:e.clientY}; });
    el.addEventListener('pointerup', e => { if (this.down && Math.hypot(e.clientX-this.down.x, e.clientY-this.down.y) < 6) this.pick(e); this.down = null; });
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const loop = () => { if (this.disposed) return; this.frame = requestAnimationFrame(loop); this.tick(); };
    loop();
  }

  private build() {
    this.colors = palette(document.documentElement.dataset.theme === 'dark');
    for (const {group} of this.floors.values()) { this.scene.remove(group); group.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose(); }); }
    this.floors.clear();
    for (const f of FLOORS as FloorData[]) {
      const group = new THREE.Group(); group.position.y = level(f.floor);
      const solid = new THREE.Group();
      // Floor slab from the building footprint.
      const slabs = f.footprint.map(([x0, y0, x1, y1]) => { const g = new THREE.BoxGeometry(x1-x0, 4, y1-y0); g.translate(px((x0+x1)/2), -2, pz((y0+y1)/2)); return g; });
      solid.add(new THREE.Mesh(mergeGeometries(slabs), new THREE.MeshLambertMaterial({color:this.colors.slab})));
      // Rooms as low blocks, coloured by purpose.
      const blocks:THREE.BufferGeometry[] = [];
      const add = (box:Box, color:number, h = ROOM_H) => {
        const [x0, y0, x1, y1] = box, w = Math.max(2, x1-x0-1.5), d = Math.max(2, y1-y0-1.5);
        const g = new THREE.BoxGeometry(w, h, d); g.translate(px((x0+x1)/2), h/2, pz((y0+y1)/2));
        const c = new THREE.Color(color), arr = new Float32Array(g.attributes.position.count*3);
        for (let i = 0; i < g.attributes.position.count; i++) c.toArray(arr, i*3);
        g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); blocks.push(g);
      };
      for (const r of f.rooms) add(r.box, this.colors[kindOf(r.id) as 'room']);
      for (const s of f.stairs) add(s.box, this.colors.stair, ROOM_H+6);
      for (const p of f.places) if (p.box) add(p.box, this.colors[p.kind as 'food'] ?? this.colors.place);
      const merged = mergeGeometries(blocks);
      solid.add(new THREE.Mesh(merged, new THREE.MeshLambertMaterial({vertexColors:true})));
      solid.add(new THREE.LineSegments(new THREE.EdgesGeometry(merged), new THREE.LineBasicMaterial({color:this.colors.edge, transparent:true, opacity:.8})));
      group.add(solid);
      // Invisible plane for taps.
      const [bx0, by0, bx1, by1] = bounds(f);
      const pick = new THREE.Mesh(new THREE.PlaneGeometry(bx1-bx0, by1-by0).rotateX(-Math.PI/2), new THREE.MeshBasicMaterial({visible:false}));
      pick.position.set(px((bx0+bx1)/2), ROOM_H, pz((by0+by1)/2)); group.add(pick);
      group.add(floorTag(f.floor, px(bx0)-10, pz((by0+by1)/2), this.colors.text));
      this.scene.add(group);
      this.floors.set(f.floor, {group, solid, labels:null, image:null, pick});
    }
    this.apply();
  }

  // Room numbers are painted on a transparent texture laid over the blocks, only for the floor in focus.
  private labels(floor:number) {
    const entry = this.floors.get(floor)!;
    if (entry.labels) return entry.labels;
    const f = (FLOORS as FloorData[]).find(q => q.floor === floor)!;
    const [x0, y0, x1, y1] = bounds(f), k = 4096/(x1-x0);
    const canvas = document.createElement('canvas'); canvas.width = 4096; canvas.height = Math.ceil((y1-y0)*k);
    const ctx = canvas.getContext('2d')!; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const text = (label:string, box:Box|null, x:number, y:number, weight = 700, color = this.colors.text) => {
      const w = box ? (box[2]-box[0])*k : 60*k, h = box ? (box[3]-box[1])*k : 30*k;
      let size = Math.min(h*0.42, 40); ctx.font = `${weight} ${size}px system-ui, sans-serif`;
      const fit = w*0.86/ctx.measureText(label).width; if (fit < 1) { size *= fit; ctx.font = `${weight} ${size}px system-ui, sans-serif`; }
      ctx.fillStyle = color; ctx.fillText(label, (x-x0)*k, (y-y0)*k);
    };
    for (const r of f.rooms) text(r.id, r.box, (r.box[0]+r.box[2])/2, (r.box[1]+r.box[3])/2);
    for (const s of f.stairs) text(s.id, s.box, s.x, s.y, 800);
    for (const p of f.places) {
      const short = p.kind === 'wc' ? p.name.replace('Туалет ', 'WC ') : p.name.replace(/\s*\(.*\)/, '').replace(/^Столовая /, '');
      text(p.box ? short : ICON[p.kind] ?? '•', p.box ?? null, p.box ? (p.box[0]+p.box[2])/2 : p.x, p.box ? (p.box[1]+p.box[3])/2 : p.y, 600, this.colors.textSoft);
    }
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1-x0, y1-y0).rotateX(-Math.PI/2), new THREE.MeshBasicMaterial({map:tex, transparent:true, depthWrite:false}));
    mesh.position.set(px((x0+x1)/2), ROOM_H+0.6, pz((y0+y1)/2)); mesh.renderOrder = 2;
    entry.group.add(mesh); entry.labels = mesh;
    return mesh;
  }

  // The original drawing from the PDF, for checking the schematic.
  private image(floor:number) {
    const entry = this.floors.get(floor)!;
    if (entry.image) return entry.image;
    const f = (FLOORS as FloorData[]).find(q => q.floor === floor)!;
    const [x0, y0, x1, y1] = f.imageBox;
    const tex = new THREE.TextureLoader().load(import.meta.env.BASE_URL + f.image); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1-x0, y1-y0).rotateX(-Math.PI/2), new THREE.MeshBasicMaterial({map:tex}));
    mesh.position.set(px((x0+x1)/2), 0.5, pz((y0+y1)/2));
    entry.group.add(mesh); entry.image = mesh;
    return mesh;
  }

  setView(mode:Mode, floor:number, lowest = floor) {
    const modeChanged = mode !== this.mode, floorChanged = floor !== this.active;
    this.mode = mode; this.active = floor; this.lowest = lowest;
    this.apply();
    if (modeChanged || floorChanged) this.frameFloor();
  }
  private lowest = 6;

  private apply() {
    for (const [n, e] of this.floors) {
      const on = n === this.active;
      // 3D: the floor in focus is solid, floors under it are faint, floors above are hidden.
      e.group.visible = on || (this.mode === '3d' && n < this.active);
      e.solid.visible = this.mode !== 'pdf' || !on;
      const opacity = on ? 1 : n >= this.lowest ? .5 : .16;
      e.solid.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material|undefined; if (!m) return; m.transparent = !on || m.type === 'LineBasicMaterial'; m.opacity = on ? (m.type === 'LineBasicMaterial' ? .8 : 1) : opacity; m.depthWrite = on; m.needsUpdate = true; });
      if (on && this.mode !== 'pdf') this.labels(n);
      if (on && this.mode === 'pdf') this.image(n);
      if (e.labels) e.labels.visible = on && this.mode !== 'pdf';
      if (e.image) e.image.visible = on && this.mode === 'pdf';
    }
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

  private frameFloor(focus?:{x:number; y:number}) {
    const f = (FLOORS as FloorData[]).find(q => q.floor === this.active)!;
    const [x0, y0, x1, y1] = bounds(f), y = level(this.active);
    const target = focus ? new THREE.Vector3(px(focus.x), y, pz(focus.y)) : new THREE.Vector3(px((x0+x1)/2), y, pz((y0+y1)/2));
    const {clientWidth:w, clientHeight:h} = this.host;
    if (this.mode === '3d') {
      // Fit the whole floor width (or a neighbourhood of the focus) into the view, seen from the south-east above.
      const span = focus ? 420 : (x1-x0)*0.92, hfov = 2*Math.atan(Math.tan(THREE.MathUtils.degToRad(this.persp.fov/2))*this.persp.aspect);
      const dist = Math.min(7000, span/2/Math.tan(hfov/2));
      this.persp.position.copy(target).add(new THREE.Vector3(-0.12, 0.78, 0.62).normalize().multiplyScalar(dist));
    } else {
      // Open wide enough to read the numbers; pinch out for the whole building.
      this.ortho.zoom = focus ? Math.max(2.4, w/520) : Math.min(w/(x1-x0)*1.8, h/(y1-y0)*0.9);
      this.ortho.position.set(target.x, y+2000, target.z); this.ortho.up.set(0, 0, -1);
      this.ortho.updateProjectionMatrix();
    }
    this.controls.target.copy(target); this.camera.lookAt(target); this.controls.update();
  }

  focus(floor:number, x:number, y:number) {
    if (floor !== this.active) { this.active = floor; this.apply(); }
    this.frameFloor({x, y});
  }

  setRoute(legs:Leg[], marks:Mark[]) {
    for (const o of [...this.dynamic.children]) { this.dynamic.remove(o); (o as THREE.Mesh).geometry?.dispose(); }
    this.walker = null; this.walkPath = null;
    const hl = (m:Mark) => {
      const r = m;
      const color = m.tone === 'from' ? 0x1d1b16 : m.tone === 'to' ? 0xff5a36 : 0x1d1b16;
      if (r?.box) {
        const [x0, y0, x1, y1] = r.box, g = new THREE.BoxGeometry(x1-x0+2, ROOM_H+2, y1-y0+2);
        const box = new THREE.Mesh(g, new THREE.MeshBasicMaterial({color, transparent:true, opacity:.28, depthWrite:false}));
        box.position.set(px((x0+x1)/2), level(m.floor)+ROOM_H/2, pz((y0+y1)/2)); box.userData.floor = m.floor; this.dynamic.add(box);
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
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(32, pts.length*6), 2.6, 8, false), new THREE.MeshBasicMaterial({color:0xff5a36}));
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
    const ring = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 12), new THREE.MeshBasicMaterial({color:0xff5a36, transparent:true, opacity:.5}));
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
    this.persp.aspect = w/h; this.persp.updateProjectionMatrix();
    Object.assign(this.ortho, {left:-w/2, right:w/2, top:h/2, bottom:-h/2}); this.ortho.updateProjectionMatrix();
  }

  private tick() {
    this.controls.update();
    const t = performance.now()/1000;
    if (this.walker && this.walkPath) this.walker.position.copy(this.walkPath.getPointAt((t*0.18)%1));
    for (const o of this.dynamic.children) if (o.userData.pin) o.children[0].position.y = 30 + Math.sin(t*3)*3;
    // Labels keep their size on screen in the flat view.
    this.renderer.render(this.scene, this.camera);
  }

  retheme() { this.build(); this.frameFloor(); }

  dispose() {
    this.disposed = true; cancelAnimationFrame(this.frame); this.controls.dispose();
    this.scene.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose(); const mat = m.material as THREE.Material & {map?:THREE.Texture}; mat?.map?.dispose(); mat?.dispose?.(); });
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
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
