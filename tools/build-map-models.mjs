// Reproducible, texture-free architectural cutaway models.
// Plan positions come from map-data and extracted source strokes. Heights and
// material finishes are schematic: the supplied PDF contains no elevations.
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(data=>{this.result=data;this.onloadend?.();}); }
  readAsDataURL(blob) { blob.arrayBuffer().then(data=>{this.result=`data:${blob.type};base64,${Buffer.from(data).toString('base64')}`;this.onloadend?.();}); }
};
const {floors} = JSON.parse(await readFile('lib/map-data.json','utf8'));
const walls = JSON.parse(await readFile('lib/map-walls.json','utf8'));
await mkdir('public/map/models',{recursive:true});
const colors = {slab:0xd2d9dd, floor:0xe9eeeb, room:0xf9f6ef, lecture:0xc1dfd8, machine:0xd3e2ed, wc:0xd3ddec, food:0xeddcc7,
  place:0xdfdced, wall:0xf5f6f2, cap:0x889b9b, shadow:0xc2ccc9, stair:0xc3d8d5, steel:0x677e85, lift:0xb7c9d1, rail:0x819a9e};

for (const f of floors) {
  const group=new THREE.Group(); group.name=`VMK floor ${f.floor}`;
  group.userData={floor:f.floor,source:'tools/floor-plans.pdf',geometry:'architectural-cutaway-v2'};
  const batches=new Map();
  function box(x,y,z,w,h,d,kind,angle=0) {
    if(w<=0||h<=0||d<=0)return;
    const g=new THREE.BoxGeometry(w,h,d);g.rotateY(angle);g.translate(x-980,y,z-390);
    if(!batches.has(kind))batches.set(kind,[]);batches.get(kind).push(g);
  }
  function line(ax,az,bx,bz,y,h,width,kind) {box((ax+bx)/2,y,(az+bz)/2,Math.hypot(bx-ax,bz-az),h,width,kind,-Math.atan2(bz-az,bx-ax));}
  function area(b,y,h,kind,inset=0) {const [x0,z0,x1,z1]=b;box((x0+x1)/2,y,(z0+z1)/2,x1-x0-inset*2,h,z1-z0-inset*2,kind);}
  for(const b of f.footprint) {area(b,-3,6,'slab');area(b,.2,.5,'floor');}
  for(const r of f.rooms) area(r.box,.7,1,/^П-/.test(r.id)?'lecture':/^МЗ-/.test(r.id)?'machine':'room',1);
  for(const p of f.places) if(p.box) area(p.box,.7,1,colors[p.kind]?'place'===p.kind?'place':p.kind:'place',1);
  for(const [ax,az,bx,bz] of walls[f.floor]) {
    const mx=(ax+bx)/2,mz=(az+bz)/2;
    // Replace stair symbols by actual tread/landing meshes.
    if(f.stairs.some(s=>mx>s.box[0]-2&&mx<s.box[2]+2&&mz>s.box[1]-2&&mz<s.box[3]+2)) continue;
    line(ax,az,bx,bz,.6,.5,5.2,'shadow');
    line(ax,az,bx,bz,9,18,2.4,'wall');
    line(ax,az,bx,bz,18.2,.7,2.8,'cap');
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
    // Thin handrails and posts make the two flights recognisable at close zoom.
    for(let i=0;i<=4;i++) {
      const z=z0+4+i*(d-8)/4, h=3+i*9/4;
      box(x0+1,h,z,.8,6,.8,'rail');box(x1-1,21-i*9/4,z,.8,6,.8,'rail');
    }
    const rail=(x,start,end)=>{const a=new THREE.Vector3(x-980,start,z0+4-390),b=new THREE.Vector3(x-980,end,z1-4-390);const g=new THREE.CylinderGeometry(.5,.5,a.distanceTo(b),6);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize()));g.translate(...a.add(b).multiplyScalar(.5).toArray());if(!batches.has('rail'))batches.set('rail',[]);batches.get('rail').push(g);};
    rail(x0+1,6,15);rail(x1-1,24,15);
  }
  for(const p of f.places.filter(p=>p.kind==='lift'&&p.box)) {
    const [x0,z0,x1,z1]=p.box,w=x1-x0,d=z1-z0;
    box(x0+1,11,(z0+z1)/2,2,22,d,'wall');box(x1-1,11,(z0+z1)/2,2,22,d,'wall');
    box((x0+x1)/2,11,z0+1,w,22,2,'wall');
    for(const sign of [-1,1]) box((x0+x1)/2+sign*w*.23,9,z1-1,w*.43,18,1,'lift');
    box((x0+x1)/2,19,z1-1,w,2,2,'steel');
    box(x1-4,11,z1+.1,1.5,3,.7,'steel');
  }
  for(const [kind,geometries] of batches) {
    const merged=mergeGeometries(geometries);merged.computeBoundingSphere();
    const material=new THREE.MeshStandardMaterial({color:colors[kind],roughness:kind==='lift'?.35:.82,metalness:['rail','steel','lift'].includes(kind)?.35:0});material.name=kind;
    const mesh=new THREE.Mesh(merged,material);mesh.name=kind;mesh.castShadow=['wall','cap','stair','lift'].includes(kind);mesh.receiveShadow=true;group.add(mesh);
    geometries.forEach(g=>g.dispose());
  }
  const binary=await new GLTFExporter().parseAsync(group,{binary:true});
  await writeFile(`public/map/models/f${f.floor}.glb`,Buffer.from(binary));
  console.log(`Floor ${f.floor}: ${Math.round(binary.byteLength/1024)} KB, ${group.children.length} mesh batches`);
}
