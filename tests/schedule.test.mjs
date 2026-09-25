import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import * as pdfjs from '../public/vendor/pdf.mjs';
import {parseAll,parseSchedule,isActive} from '../public/parser.mjs';
import {checkSource,readMetadata} from '../scripts/source-check.mjs';
import {cleanTitle,diffSchedules,groupSchedule,teacherRows,validSchedule,validSnapshot,verification,STALE_AFTER} from '../lib/schedule-model.mjs';

pdfjs.GlobalWorkerOptions.workerSrc=new URL('../public/vendor/pdf.worker.mjs',import.meta.url).href;
const pdf=await readFile(new URL('./fixtures/schedule.pdf',import.meta.url));
const seed=JSON.parse(await readFile(new URL('./fixtures/source.json',import.meta.url),'utf8'));
const html='<h2>Бакалавриат и интегрированные магистры</h2>Расписание обновлено 21.09.2026<a href="/sites/cmc/files/docs/1_kurs_osen_2026_9.pdf">101–121, 141-142</a><h2>Магистратура и второе высшее образование</h2>Расписание обновлено 22.09.2026';
const fetcher=async url=>new Response(url.endsWith('.pdf')?pdf:html);
const parse=bytes=>parseAll(pdfjs,bytes);
const lessons114=snapshot=>snapshot.schedule.groups['114'].lessons;
const now=()=>new Date(Date.parse(seed.attemptedAt)+60000).toISOString();

test('real PDF: correct group, merged lectures, subgroups and date restrictions',async()=>{
  const data=await parseSchedule(pdfjs,pdf);
  assert.equal(data.group,114); assert.equal(data.page,2); assert.equal(data.lessons.length,22);
  assert.deepEqual(Array.from({length:6},(_,day)=>data.lessons.filter(l=>l.day===day).length),[3,5,4,4,3,3]);
  const find=id=>data.lessons.find(l=>l.id===id);
  assert.equal(find('1-10:30').room,'П-13');
  assert.deepEqual(teacherRows(find('1-12:50').detail),[{teacher:'Перцева З.Н.',room:'71',note:''},{teacher:'Шабловский А.А.',room:'786',note:''}]);
  assert.deepEqual(teacherRows(find('1-14:35').detail),[{teacher:'Бордаченкова Е.А.',room:'696',note:'МЗ-3'},{teacher:'Панфёров А.А.',room:'64',note:''}]);
  assert.deepEqual(teacherRows(find('4-12:50').detail).map(r=>r.room),['613','682']);
  assert.equal(cleanTitle(find('4-10:40')),'История России');
  assert.equal(cleanTitle(find('5-10:30')),'Алгебра и геометрия');
  assert.equal(isActive(find('4-10:40'),'2026-09-04'),false);
  assert.equal(isActive(find('5-10:30'),'2026-09-26'),true);
  assert.equal(isActive(find('5-10:30'),'2026-10-03'),false);
  assert.equal(data.lessons.some(l=>l.title.includes('государственности')),false);
});
test('page parser follows the first-course link and reads only the bachelor date',()=>{
  assert.equal(readMetadata(html).date,'21.09.2026');
  assert.equal(readMetadata(html.replace('1_kurs_osen_2026_9.pdf','new.pdf')).url,'https://cs.msu.ru/sites/cmc/files/docs/new.pdf');
  assert.throws(()=>readMetadata(html.replace('/sites/cmc/files/docs/1_kurs_osen_2026_9.pdf','https://example.com/file.pdf')));
  assert.throws(()=>readMetadata('changed markup'));
});
test('a successful unchanged check advances the actual check time',async()=>{
  const result=await checkSource({previous:seed,fetcher,parse,now});
  assert.equal(result.snapshot.status,'ok'); assert.equal(result.snapshot.checkedAt,now());
  assert.equal(result.snapshot.hash,seed.hash); assert.equal(result.snapshot.schedule.savedAt,seed.schedule.savedAt);
  assert.equal(validSnapshot(result.snapshot),true);
});
test('a changed PDF replaces an older timetable, not just its notification',async()=>{
  const old=structuredClone(seed); old.hash=old.schedule.hash='0'.repeat(64);
  lessons114(old).find(l=>l.id==='3-10:30').raw='Алгебра и геометрия\nМорозова В.А. 500';
  lessons114(old).find(l=>l.id==='3-10:30').detail='Морозова В.А. 500';
  const result=await checkSource({previous:old,fetcher,parse,now});
  assert.equal(result.snapshot.status,'ok'); assert.notEqual(result.snapshot.hash,old.hash);
  assert.equal(teacherRows(lessons114(result.snapshot).find(l=>l.id==='3-10:30').detail)[0].room,'615');
  // The server records exactly what changed and when.
  const [entry]=result.snapshot.history;
  assert.equal(entry.pdfChanged,true); assert.equal(entry.detectedAt,now()); assert.deepEqual(Object.keys(entry.changes),['114']);
  assert.match(entry.changes['114'][0].after,/615/);
  assert.deepEqual(entry.changes['114'][0].details,['Аудитория: 500 → 615']);
  assert.equal(validSnapshot(result.snapshot),true);
});
test('network, malformed page/PDF, and parse failures retain previous data and report failure',async()=>{
  const failures=[
    {fetcher:async()=>{throw Error('offline');}},
    {fetcher:async()=>new Response('unavailable',{status:503})},
    {fetcher:async()=>new Response('unknown page')},
    {fetcher:async url=>new Response(url.endsWith('.pdf')?'not a PDF':html)},
    {parse:async()=>{throw Error('Changed PDF table');}},
    {parse:async()=>({year:2026,groups:{'114':{page:2,lessons:[]}}})},
  ];
  for(const failure of failures){
    const result=await checkSource({previous:seed,fetcher,parse,now,...failure});
    assert.equal(result.snapshot.status,'error'); assert.equal(result.pdf,null);
    assert.deepEqual(result.snapshot.schedule,seed.schedule); assert.equal(result.snapshot.checkedAt,seed.checkedAt);
    assert.equal(result.snapshot.attemptedAt,now()); assert.equal(validSnapshot(result.snapshot),true);
  }
});
test('off-site redirects are rejected without contacting another origin',async()=>{
  let calls=0;
  const result=await checkSource({previous:seed,parse,now,fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://example.org'}});}});
  assert.equal(calls,1); assert.equal(result.snapshot.status,'error');
});
test('fresh, delayed and failed verification states are distinguishable',()=>{
  const base=Date.parse(seed.checkedAt);
  assert.equal(verification(seed,base+1000).tone,'ok');
  assert.match(verification(seed,base+STALE_AFTER+1).title,/задерживается/);
  assert.match(verification({...seed,status:'error'},base+1000).title,/Не удалось/);
  assert.equal(verification(null).tone,'warn');
});
test('invalid client payloads are rejected',()=>{
  assert.equal(validSchedule(null),false);
  const bad=structuredClone(seed); lessons114(bad)[0].day=9;
  assert.equal(validSnapshot(bad),false);
  assert.equal(validSnapshot({...seed,hash:'0'.repeat(64)}),false);
  assert.equal(validSnapshot({...seed,checkedAt:'not a date'}),false);
});

test('changes are described in plain words',()=>{
  const base=lessons114(seed).find(l=>l.id==='4-12:50');
  const moved={...base,detail:'Бордаченкова Е.А. 613\nПанфёров А.А. 700',raw:'x'};
  assert.deepEqual(diffSchedules({lessons:[base]},{lessons:[moved]})[0].details,['Аудитория (Панфёров А.А.): 682 → 700']);
  const teacher={...base,detail:'Иванов И.И. 613\nПанфёров А.А. 682',raw:'y'};
  assert.deepEqual(diffSchedules({lessons:[base]},{lessons:[teacher]})[0].details,['Преподаватель: Бордаченкова Е.А., Панфёров А.А. → Иванов И.И., Панфёров А.А.']);
  const later={...base,end:'14:40',raw:'z'};
  assert.deepEqual(diffSchedules({lessons:[base]},{lessons:[later]})[0].details,['Время: 12:50–14:25 → 12:50–14:40']);
  assert.match(diffSchedules({lessons:[base]},{lessons:[]})[0].details[0],/^Пара убрана: Практикум на ЭВМ/);
  assert.match(diffSchedules({lessons:[]},{lessons:[base]})[0].details[0],/^Новая пара: Практикум на ЭВМ, 12:50–14:25/);
});

test('every first-course group is parsed; 114 stays identical',async()=>{
  const all=await parse(pdf);
  assert.deepEqual(Object.keys(all.groups).sort(),[...Array.from({length:20},(_,i)=>String(101+i)),'141','142']);
  for(const name of Object.keys(all.groups)) assert.equal(validSchedule({...groupSchedule({...seed.schedule,groups:all.groups},name)}),true,name);
  const g101=all.groups['101'].lessons, find=(g,id)=>all.groups[g].lessons.find(l=>l.id===id);
  assert.equal(find('101','0-08:45').room,'П-6'); assert.equal(find('101','0-08:45').type,'lecture');
  assert.equal(g101.filter(l=>l.day===0).length,5);
  // FIIT page: lectures in 510, stacked cells and a later start time.
  assert.equal(find('141','0-14:35').room,'510'); assert.equal(find('141','0-14:35').type,'lecture');
  assert.equal(cleanTitle(find('141','3-12:50-2')),'Алгебра и аналитическая геометрия');
  assert.equal(find('142','4-10:40').start,'10:45'); assert.equal(find('142','4-10:40').room,'706');
  assert.deepEqual(find('142','3-08:45').rule,{from:'2026-09-10'}); assert.equal(cleanTitle(find('142','3-08:45')),'История России');
  assert.equal(find('106','0-12:50').start,'12:15');
});
test('a new date on the VMK site is recorded even when the PDF is the same',async()=>{
  const newer=html.replace('21.09.2026','28.09.2026');
  const result=await checkSource({previous:{...seed,date:'21.09.2026',schedule:{...seed.schedule,sourceDate:'21.09.2026'}},parse,now,fetcher:async url=>new Response(url.endsWith('.pdf')?pdf:newer)});
  assert.deepEqual(result.snapshot.history[0],{date:'28.09.2026',previousDate:'21.09.2026',detectedAt:now(),pdfChanged:false,changes:{}});
});
test('the old single-group snapshot is upgraded without reporting other groups as new',async()=>{
  const legacy={schema:2,status:'ok',attemptedAt:seed.attemptedAt,checkedAt:seed.checkedAt,error:null,date:seed.date,url:seed.url,hash:'1'.repeat(64),
    schedule:{group:114,year:2026,...seed.schedule.groups['114'],sourceDate:seed.schedule.sourceDate,sourceUrl:seed.schedule.sourceUrl,hash:'1'.repeat(64),savedAt:seed.schedule.savedAt}};
  const result=await checkSource({previous:legacy,fetcher,parse,now});
  assert.equal(result.snapshot.status,'ok'); assert.equal(Object.keys(result.snapshot.schedule.groups).length,22);
  assert.deepEqual(Object.keys(result.snapshot.history[0].changes),[]);
});
