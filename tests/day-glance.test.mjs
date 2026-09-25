import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {dayGlance,lessonsOn,roomFor} from '../lib/day-glance.mjs';

const snapshot=JSON.parse(await readFile(new URL('./fixtures/source.json',import.meta.url),'utf8'));
const schedule=snapshot.schedule;

test('current day distinguishes first class, lesson, break and finish at exact boundaries',()=>{
  const before=dayGlance(schedule,'2026-09-25','08:50');
  assert.equal(before.kind,'before');assert.match(before.title,/10 мин/);
  const current=dayGlance(schedule,'2026-09-25','09:10');
  assert.equal(current.kind,'now');assert.match(current.title,/1 ч 20 мин/);
  assert.match(current.detail,/История России · 10:40 · ауд. 507/);
  const gap=dayGlance(schedule,'2026-09-25','10:30');
  assert.equal(gap.kind,'break');assert.match(gap.title,/10 мин/);
  const done=dayGlance(schedule,'2026-09-25','14:25');
  assert.equal(done.kind,'done');assert.match(done.detail,/Завтра: Алгебра и геометрия · 08:45 · ауд. 624/);
});
test('selected subgroup determines the room; unknown subgroup never guesses',()=>{
  const choices={'Практикум на ЭВМ':'Панфёров А.А.'};
  const gap=dayGlance(schedule,'2026-09-25','12:15',choices);
  assert.equal(gap.kind,'break');assert.match(gap.detail,/ауд. 682/);assert.doesNotMatch(gap.detail,/613/);
  const lesson=lessonsOn(schedule,'2026-09-25').find(l=>l.id==='4-12:50');
  assert.equal(roomFor(lesson,choices),'682');
  assert.equal(roomFor(lesson,{}),'');
  assert.equal(roomFor(lesson,{'Практикум на ЭВМ':'Неизвестный преподаватель'}),'');
});
test('date restrictions and non-teaching days are respected',()=>{
  assert.equal(lessonsOn(schedule,'2026-09-26').length,3);
  assert.equal(lessonsOn(schedule,'2026-10-03').length,2,'September-only lecture must not appear in October');
  assert.equal(dayGlance(schedule,'2026-09-27','12:00').kind,'done');
  assert.match(dayGlance(schedule,'2026-09-27','12:00').detail,/Завтра: Алгебра и геометрия · 10:30/);
  assert.match(dayGlance(schedule,'2026-10-03','14:25').detail,/пн, 5 окт.:/);
  assert.equal(dayGlance(schedule,'2026-08-31','12:00'),null);
});
