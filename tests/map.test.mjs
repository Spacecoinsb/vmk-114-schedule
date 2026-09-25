import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FLOORS,POINTS,findRoom,nearest,normalizeRoom,route,search} from '../lib/map-route.mjs';
import {teacherRows} from '../lib/schedule-model.mjs';
import source from '../public/source.json' with {type:'json'};

test('all floors are present with rooms, six stairwells and corridors',()=>{
  assert.deepEqual(FLOORS.map(f=>f.floor),[1,2,5,6,7]);
  for(const f of FLOORS){assert.equal(f.stairs.length,6);assert(f.corridors.length>0);for(const p of [...f.rooms,...f.places])assert(p.x>0&&p.x<2100&&p.y>0&&p.y<900,`${f.floor}:${p.id}`);
    for(const r of f.rooms){const [x0,y0,x1,y1]=r.box;assert(x0<r.x&&r.x<x1&&y0<r.y&&r.y<y1&&x1-x0<450&&y1-y0<450,`box of ${f.floor}:${r.id}`);}}
  assert(POINTS.filter(p=>p.kind==='room').length>300);
});
test('room names from the timetable are found',()=>{
  assert.equal(normalizeRoom('582-а'),'582А'); assert.equal(normalizeRoom('п-5'),'П-5'); assert.equal(normalizeRoom('МЗ3'),'МЗ-3');
  assert.equal(findRoom('П-5').floor,1); assert.equal(findRoom('П-8А').floor,2); assert.equal(findRoom('71').floor,7);
  assert.equal(findRoom('606').floor,6); assert.equal(findRoom('МЗ-3').floor,1); assert.equal(findRoom('526 б').floor,5);
  assert.equal(findRoom('999'),null);
  // Almost every room used by group 114 is on the map.
  const rooms=new Set(source.schedule.groups['114'].lessons.flatMap(l=>[l.room,...teacherRows(l.detail).map(r=>r.room)]).flatMap(r=>r.split(', ')).filter(Boolean));
  const missing=[...rooms].filter(r=>!findRoom(r));
  assert(missing.length<=2,`missing: ${missing}`);
});
test('search ranks exact numbers first and finds places by name',()=>{
  assert.equal(search('606')[0].id,'606');
  assert.equal(search('диет')[0].id,'dietka');
  assert(search('туалет').length>=8);
});
test('routes stay on one floor or use one stairwell',()=>{
  const same=route('6:606','6:682');
  assert.equal(same.legs.length,1); assert.equal(same.stair,null);
  assert(same.legs[0].points.length>=3,'goes out to the corridor and back in');
  const up=route('6:606','7:71');
  assert.equal(up.legs.length,2); assert.equal(up.stair,'А','the left wing stairwell is closest');
  assert.match(up.steps.join(' '),/Поднимись по лестнице А на 7 этаж/);
  const down=route('7:779','1:П-5');
  assert.equal(down.legs[0].floor,7); assert.equal(down.legs[1].floor,1);
  assert.match(down.steps.join(' '),/Спустись/);
  // Every room on every floor is reachable from a lecture hall.
  for(const p of POINTS) if(p.key!=='1:П-5') assert(route('1:П-5',p.key),p.key);
});
test('nearest toilet prefers the same floor',()=>{
  const r=nearest('6:606','wc');
  assert.equal(r.to.floor,6); assert.equal(r.to.id,'wc-f');
});
