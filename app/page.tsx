import React, {useEffect, useRef, useState, type TouchEvent} from 'react';
import {ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, RefreshCw, WifiOff, X} from 'lucide-react';
import {Dialog, DialogContent, DialogTitle, DialogDescription} from '@/components/ui/dialog';
import {cleanTitle, diffSchedules, isDisplayedLesson, teacherRows, validSchedule, validSnapshot, verification} from '@/lib/schedule-model.mjs';
import {ThemeButton,HomeworkButton,HomeworkEditor,useHomework,type Task} from '@/components/personal';
import {useSubgroups} from '@/components/subgroups';
import {dayGlance, duration, focusDate, minutes} from '@/lib/day-glance.mjs';
import seed from '@/public/source.json';

type Lesson = {id:string; day:number; start:string; end:string; title:string; detail:string; room:string; type:string; raw:string; rule:{from?:string; dates?:string[]}|null};
type Schedule = {group:number; year:number; page:number; lessons:Lesson[]; sourceDate:string; sourceUrl:string; hash:string; savedAt:string};
type Snapshot = {schema:number; status:string; attemptedAt:string; checkedAt:string|null; error:string|null; date:string; url:string; hash:string; schedule:Schedule};
type Change = {id:string; day:number; start:string; title?:string; before?:string; after?:string; details?:string[]};
type Saved = {data:Schedule; snapshot:Snapshot|null; syncedAt:string; changes:Change[]};
const dayNames = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
const shortDays = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const typeNames:Record<string,string> = {lecture:'Лекция', consultation:'Консультация'};
const storageKey = 'vmk114-v1';
const dataCache = 'vmk114-data-v1';
const asset = (path:string) => import.meta.env.BASE_URL + path.replace(/^\//,'');
const pdfKey = (hash:string) => asset(`saved-schedule-${hash}.pdf`);
const isoMoscow = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const clockMoscow = () => new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'}).format(new Date());
const addDays = (iso:string,n:number) => new Date(new Date(iso+'T12:00:00Z').getTime()+n*86400000).toISOString().slice(0,10);
const weekday = (iso:string) => (new Date(iso+'T12:00:00Z').getUTCDay()+6)%7;
const formatDate = (iso:string,options:Intl.DateTimeFormatOptions={day:'numeric',month:'long'}) => new Date(iso+'T12:00:00Z').toLocaleDateString('ru-RU',{...options,timeZone:'Europe/Moscow'});
const stamp = (iso:string|null) => iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : 'нет данных';
const plural = (n:number,forms:[string,string,string]) => forms[n%10===1&&n%100!==11?0:n%10>=2&&n%10<=4&&(n%100<10||n%100>=20)?1:2];
const lessonCount = (n:number) => n ? `${n} ${plural(n,['пара','пары','пар'])}` : 'Без пар';
function ago(iso:string|null) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '';
  const m = Math.max(0,Math.round((Date.now()-Date.parse(iso))/60000));
  if (m<1) return 'только что';
  if (m<60) return `${m} мин назад`;
  const h = Math.floor(m/60);
  if (h<24) return `${h} ${plural(h,['час','часа','часов'])} назад`;
  return stamp(iso);
}
const active = (lesson:Lesson,date:string) => !lesson.rule || ((!lesson.rule.from || date>=lesson.rule.from) && (!lesson.rule.dates || lesson.rule.dates.includes(date)));
const safeChanges = (value:unknown):Change[] => Array.isArray(value) ? value.filter(c => c && typeof c.id==='string' && Number.isInteger(c.day) && c.day>=0 && c.day<6 && typeof c.start==='string' && (c.before===undefined || typeof c.before==='string') && (c.after===undefined || typeof c.after==='string') && (c.details===undefined || (Array.isArray(c.details) && c.details.every((d:unknown)=>typeof d==='string')))) : [];

function initialState():Saved {
  const fallback:Saved = {data:seed.schedule as Schedule, snapshot:seed as Snapshot, syncedAt:'', changes:[]};
  try {
    const old = JSON.parse(localStorage.getItem(storageKey)||'null');
    if (!validSchedule(old?.data)) return fallback;
    const snapshot = validSnapshot(old.snapshot) && old.snapshot.hash===old.data.hash ? old.snapshot : null;
    // Prefer the newer bundled version after an app update, while retaining newer offline data.
    if (Date.parse(snapshot?.attemptedAt || old.data.savedAt) < Date.parse(seed.attemptedAt)) {
      const diff = diffSchedules(old.data,fallback.data) as Change[];
      return {...fallback,changes:diff.length?diff:old.data.hash===fallback.data.hash?safeChanges(old.changes):[]};
    }
    return {data:old.data, snapshot, syncedAt:typeof old.syncedAt==='string'?old.syncedAt:'', changes:safeChanges(old.changes)};
  } catch { return fallback; }
}
function persist(value:Saved) {
  try { localStorage.setItem(storageKey,JSON.stringify(value)); }
  catch { throw Error('Не удалось сохранить расписание на устройстве. Освободи место и повтори обновление.'); }
}

function Room({room,note=''}:{room:string; note?:string}) {
  return <span className="room" aria-label={`Аудитория ${room}${note?', '+note:''}`}>{room}{note && <span className="room-note">{note}</span>}</span>;
}
type Editor = {task?:Task; editing:boolean; open:()=>void; editor:React.ReactNode};
function LessonCard({lesson,date,today,clock,change,next,hw,preferredTeacher}:{lesson:Lesson;date:string;today:string;clock:string;change?:Change;next:boolean;hw:Editor;preferredTeacher?:string}) {
  const now = date===today && !!clock && clock>=lesson.start && clock<lesson.end;
  const past = date<today || (date===today && !!clock && clock>=lesson.end);
  const left = clock ? minutes(now?lesson.end:lesson.start)-minutes(clock) : 0;
  const progress = now ? (minutes(clock)-minutes(lesson.start))/(minutes(lesson.end)-minutes(lesson.start)) : 0;
  const allRows = teacherRows(lesson.detail) as {teacher:string;room:string;note:string}[];
  const matched = allRows.filter(row=>row.teacher===preferredTeacher);
  const rows = allRows.length>1 && matched.length ? matched : allRows;
  const missingTeacher = !!preferredTeacher && allRows.length>0 && lesson.type!=='lecture' && !matched.length;
  const note = lesson.rule?.dates ? 'Только '+lesson.rule.dates.map(d=>formatDate(d,{day:'numeric',month:'short'})).join(', ') : lesson.rule?.from ? 'С '+formatDate(lesson.rule.from) : '';
  const label = now ? `идёт, ещё ${duration(left)}` : next ? `через ${duration(left)}` : '';
  return <article className={`lesson ${lesson.type} ${now?'current':''} ${past?'past':''}`}>
    <div className="time"><strong>{lesson.start}</strong><span>{lesson.end}</span></div>
    <div className="lesson-body">
      <div className="lesson-head">
        <h3>{cleanTitle(lesson)}</h3>
        <HomeworkButton task={hw.task} onClick={hw.open}/>
      </div>
      {(typeNames[lesson.type] || label) && <p className="meta">{[typeNames[lesson.type],label].filter(Boolean).join(' · ')}</p>}
      {rows.map((row,i)=><div className="teacher-row" key={i}><span>{row.teacher}</span>{(row.room || (i===0 && lesson.room)) && <Room room={row.room || lesson.room} note={row.note}/>}</div>)}
      {!rows.length && lesson.room && <div className="teacher-row"><span/><Room room={lesson.room}/></div>}
      {now && <div className="progress" aria-hidden="true"><i style={{width:`${Math.round(progress*100)}%`}}/></div>}
      {change && <p className="changed-note">Изменено: {(change.details?.length?change.details:['обновлена запись в PDF']).join('; ')}</p>}
      {missingTeacher && <p className="rule-note subgroup-warning">Преподаватель подгруппы изменился — показаны все варианты.</p>}
      {note && <p className="rule-note">{note}</p>}
      {hw.task && !hw.editing && <button className={`hw-preview ${hw.task.done?'task-done':''}`} onClick={hw.open}>{hw.task.text}</button>}
      {hw.editing && hw.editor}
    </div>
  </article>;
}

export default function Home() {
  const [saved,setSaved] = useState<Saved>(initialState);
  const current = useRef(saved);
  const [today,setToday] = useState(isoMoscow), [clock,setClock] = useState(clockMoscow);
  // null = follow the current time (today, or the next teaching day once today's classes are over).
  const [pinned,setPinned] = useState<string|null>(null), [slide,setSlide] = useState('');
  const [view,setView] = useState('day'), [busy,setBusy] = useState(false), [online,setOnline] = useState(navigator.onLine);
  const [message,setMessage] = useState(''), [syncError,setSyncError] = useState(''), [offlineReady,setOfflineReady] = useState(false);
  const [changesOpen,setChangesOpen] = useState(false), [statusOpen,setStatusOpen] = useState(false), [pdfUrl,setPdfUrl] = useState(''), [pdfError,setPdfError] = useState('');
  const checking = useRef(false), lastAttempt = useRef(0), touch = useRef<{x:number;y:number}|null>(null);
  const data = saved.data;
  const subgroups=useSubgroups(data.lessons);
  const homework=useHomework((date)=>{setView('day');go(date);});
  const focus = focusDate(data,today,clock) as string;
  const selected = pinned ?? focus;
  const monday = addDays(selected,-weekday(selected));
  const week = Array.from({length:7},(_,i)=>addDays(monday,i));
  const todayLessons = data.lessons.filter(l=>isDisplayedLesson(l) && l.day===weekday(today) && active(l,today)).sort((a,b)=>a.start.localeCompare(b.start));
  const nextId = todayLessons.find(l=>l.start>clock)?.id;
  const selectedLessons = data.lessons.filter(l=>isDisplayedLesson(l) && l.day===weekday(selected) && active(l,selected));
  const status = verification(saved.snapshot);
  const glance = view==='day' && (selected===today || selected===focus) ? dayGlance(data,today,clock,subgroups.selected) : null;
  const relative = selected===today ? 'Сегодня' : selected===addDays(today,1) ? 'Завтра' : selected===addDays(today,-1) ? 'Вчера' : dayNames[weekday(selected)];
  const checkedAgo = ago(saved.snapshot?.checkedAt || null);
  const statusText = !online ? 'Без интернета · сохранённая копия' : busy ? 'Получаем обновления…' : syncError ? 'Не удалось получить обновления'
    : saved.snapshot?.status==='error' ? 'Не удалось проверить ВМК' : checkedAgo ? `Сверено с ВМК ${checkedAgo}` : status.title;
  const tone = !online ? 'offline' : syncError ? 'warn' : status.tone;

  function go(date:string,direction=0) {
    setSlide(direction>0?'from-right':direction<0?'from-left':'');
    setPinned(date===focus?null:date);
  }
  function shift(direction:number) { go(addDays(selected,direction*(view==='week'?7:1)),direction); }
  function onTouchStart(event:TouchEvent) { const t=event.touches[0]; touch.current={x:t.clientX,y:t.clientY}; }
  function onTouchEnd(event:TouchEvent) {
    const start=touch.current, t=event.changedTouches[0]; touch.current=null;
    if (!start) return;
    const dx=t.clientX-start.x, dy=t.clientY-start.y;
    if (Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.5) shift(dx<0?1:-1);
  }

  async function savePdf(hash:string) {
    if (!('caches' in window)) throw Error('Сохранение PDF недоступно в этом браузере.');
    const cache = await caches.open(dataCache);
    const key = pdfKey(hash);
    if (!await cache.match(key)) {
      const response = await fetch(asset('latest.pdf')+'?v='+hash,{cache:'no-store',signal:AbortSignal.timeout(45000)});
      if (!response.ok) throw Error('PDF пока недоступен. Пары уже сохранены.');
      if (Number(response.headers.get('content-length'))>8_000_000) throw Error('PDF слишком большой.');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength>8_000_000) throw Error('PDF слишком большой.');
      const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
      if (actual!==hash) throw Error('PDF ещё публикуется. Пары уже сохранены; PDF загрузится при следующем обновлении.');
      await cache.put(key,new Response(bytes,{headers:{'Content-Type':'application/pdf'}}));
    }
    setPdfUrl(key); setPdfError('');
    for (const request of await cache.keys()) if (new URL(request.url).pathname!==key) await cache.delete(request);
  }

  async function refresh(manual=false) {
    if (checking.current || (!manual && Date.now()-lastAttempt.current<5*60*1000)) return;
    if (!navigator.onLine) {setOnline(false); return;}
    checking.current=true; lastAttempt.current=Date.now(); setBusy(true); setSyncError(''); setMessage('');
    try {
      const response = await fetch(asset('source.json')+'?t='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(20000)});
      if (!response.ok) throw Error('Сервер обновлений недоступен. Показано сохранённое расписание.');
      const snapshot = await response.json() as Snapshot;
      if (!validSnapshot(snapshot)) throw Error('Не удалось проверить полученное расписание. Предыдущая версия оставлена.');
      const before = current.current;
      if (before.snapshot && Date.parse(snapshot.attemptedAt)<Date.parse(before.snapshot.attemptedAt)) throw Error('Сервер вернул старую копию. Повтори обновление позже.');
      const diff = diffSchedules(before.data,snapshot.schedule) as Change[];
      const changed = before.data.hash!==snapshot.hash || diff.length>0;
      const next:Saved = {data:snapshot.schedule,snapshot,syncedAt:new Date().toISOString(),changes:changed?diff:before.changes};
      persist(next);
      current.current=next; setSaved(next);
      if (before.data.hash!==snapshot.hash) setPdfUrl('');
      if (diff.length) setMessage('Расписание изменилось: '+diff.slice(0,3).map(c=>`${shortDays[c.day]} ${c.start} ${c.title||''} — ${(c.details||[]).join('; ')}`).join(' · ')+(diff.length>3?` и ещё ${diff.length-3}`:''));
      else if (manual) setMessage('Изменений нет');
      try { await savePdf(snapshot.hash); }
      catch (error) { setPdfError(error instanceof Error?error.message:'Не удалось сохранить PDF. Пары сохранены.'); }
    } catch (error) { setSyncError(error instanceof Error?error.message:'Не удалось получить обновления. Сохранённая версия оставлена.'); }
    finally { checking.current=false; setBusy(false); }
  }

  useEffect(()=>{
    let disposed=false;
    const tick=()=>{setClock(clockMoscow());setToday(isoMoscow());};
    tick(); const timer=setInterval(tick,15000);
    const syncTimer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},5*60*1000);
    const onOnline=()=>{setOnline(true);lastAttempt.current=0;void refresh();};
    const onOffline=()=>setOnline(false);
    const onVisible=()=>{if(document.visibilityState==='visible'){tick();void refresh();}};
    window.addEventListener('online',onOnline);window.addEventListener('offline',onOffline);document.addEventListener('visibilitychange',onVisible);
    async function prepareOffline() {
      try {
        persist(current.current);
        if (!('serviceWorker' in navigator)) throw Error('Офлайн-доступ не поддерживается браузером.');
        const registration=await navigator.serviceWorker.register(asset('sw.js'),{scope:import.meta.env.BASE_URL,updateViaCache:'none'});
        await navigator.serviceWorker.ready;
        if (!disposed) setOfflineReady(!!await caches.match(asset('offline-ready')));
        void registration.update().catch(()=>{});
        if (await (await caches.open(dataCache)).match(pdfKey(current.current.data.hash))) setPdfUrl(pdfKey(current.current.data.hash));
      } catch { if(!disposed)setSyncError('Не удалось подготовить доступ без сети. Подключись к интернету и открой сайт ещё раз.'); }
    }
    void prepareOffline(); void refresh();
    return()=>{disposed=true;clearInterval(timer);clearInterval(syncTimer);window.removeEventListener('online',onOnline);window.removeEventListener('offline',onOffline);document.removeEventListener('visibilitychange',onVisible);};
  // Initialization happens before the first update; refs always hold the last saved version.
  },[]);

  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if (event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      if (event.key==='ArrowLeft') shift(-1); else if (event.key==='ArrowRight') shift(1);
    };
    window.addEventListener('keydown',onKey); return()=>window.removeEventListener('keydown',onKey);
  });

  function editorFor(date:string,lesson:Lesson):Editor {
    const id=date+':'+lesson.id, task=homework.tasks.find(t=>t.id===id), editing=homework.editing===id;
    const draft:Task=task||{id,date,subject:cleanTitle(lesson),text:'',done:false};
    return {task,editing,open:()=>homework.setEditing(editing?'':id),
      editor:editing?<HomeworkEditor task={draft} error={homework.error} onSave={homework.save} onToggle={()=>homework.toggle(id)} onClose={()=>homework.setEditing('')}/>:null};
  }
  function renderDay(date:string,weekly=false) {
    const list=data.lessons.filter(l=>isDisplayedLesson(l) && l.day===weekday(date) && active(l,date)).sort((a,b)=>a.start.localeCompare(b.start));
    return <section className={weekly?'week-day':''} key={date} aria-label={formatDate(date)}>
      {weekly && <div className="day-title"><h2>{dayNames[weekday(date)]}<span> · {formatDate(date,{day:'numeric',month:'short'})}</span></h2><span>{lessonCount(list.length)}</span></div>}
      {list.length ? <div className="list">{list.map(l=><LessonCard key={l.id} lesson={l} date={date} today={today} clock={clock} change={saved.changes.find(c=>c.id===l.id)} next={date===today && l.id===nextId} hw={editorFor(date,l)} preferredTeacher={subgroups.selected[cleanTitle(l)]}/>)}</div> : <div className="empty"><CalendarDays size={22}/><p>Пар нет — отдыхай</p></div>}
    </section>;
  }

  return <div className="shell">
    <header className="topbar">
      <a className="brand" href={import.meta.env.BASE_URL} aria-label="Расписание группы 114"><span className="brandmark">ВМК</span><span><strong>114 группа</strong><small>Расписание · МГУ</small></span></a>
      <div className="header-actions">
        <a className="vmk-link" href="https://cs.msu.ru/studies/schedule" target="_blank" rel="noreferrer">Сайт ВМК<ArrowUpRight size={14}/></a>
        <ThemeButton/>
      </div>
    </header>

    <div className="toolbar">
      <div className="view-switch" role="group" aria-label="Вид расписания"><button aria-pressed={view==='day'} onClick={()=>setView('day')}>День</button><button aria-pressed={view==='week'} onClick={()=>setView('week')}>Неделя</button></div>
      <button className={`status ${tone}`} onClick={()=>setStatusOpen(true)} aria-label={`Статус проверки: ${statusText}`}>
        <span className="status-icon">{!online?<WifiOff size={13}/>:busy?<RefreshCw size={13} className="spin"/>:<span className="status-dot"/>}</span>
        <span aria-live="polite">{statusText}</span>
      </button>
    </div>

    <div className="heading">
      <div>
        <p className="eyebrow">{view==='day' ? <>{relative}{relative!==dayNames[weekday(selected)] && ` · ${dayNames[weekday(selected)].toLowerCase()}`} · {lessonCount(selectedLessons.length).toLowerCase()}</> : 'Неделя'}</p>
        <h1>{view==='day'?formatDate(selected):`${formatDate(monday,{day:'numeric',month:'short'})} — ${formatDate(week[6],{day:'numeric',month:'short'})}`}</h1>
      </div>
      {pinned!==null && <button className="text-button" onClick={()=>go(focus,focus>selected?1:-1)}>{focus===today?'Сегодня':'К ближайшим'}</button>}
    </div>

    <nav className="date-navigation" aria-label="Выбрать день">
      <button className="icon-button" aria-label={view==='day'?'Предыдущий день':'Предыдущая неделя'} onClick={()=>shift(-1)}><ChevronLeft/></button>
      <div className="days">{week.map((date,i)=><button key={date} className={`day-button ${date===today?'today':''}`} aria-pressed={view==='day' && date===selected} onClick={()=>{setView('day');go(date,date>selected?1:date<selected?-1:0);}} aria-label={dayNames[i]+', '+formatDate(date)}><span>{shortDays[i]}</span><strong>{Number(date.slice(-2))}</strong></button>)}</div>
      <button className="icon-button" aria-label={view==='day'?'Следующий день':'Следующая неделя'} onClick={()=>shift(1)}><ChevronRight/></button>
    </nav>

    <main onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {glance && <section className={`day-glance ${glance.kind}`} aria-label="Мой день сейчас"><strong>{glance.title}</strong>{glance.detail&&<span>{glance.detail}</span>}</section>}
      {message && <div className="message" role="status"><span>{message}{saved.changes.length>0 && <button onClick={()=>setChangesOpen(true)}>Что изменилось</button>}</span><button className="dismiss-message" aria-label="Закрыть уведомление" onClick={()=>setMessage('')}><X size={15}/></button></div>}
      {(selected<`${data.year}-09-01` || selected>`${data.year+1}-01-31`) && <div className="message warning">Это расписание осени {data.year}. Для выбранной даты оно может быть неактуально.</div>}
      <div key={selected+view} className={`slide ${slide}`}>{view==='day'?renderDay(selected):week.map(date=>renderDay(date,true))}</div>
    </main>

    <footer className="footer">
      <div className="footer-links">{homework.listButton}{subgroups.button}{saved.changes.length>0 && <button onClick={()=>setChangesOpen(true)}>Изменения</button>}{pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer">PDF</a>}</div>
      <span className="footer-note">Расписание от {data.sourceDate}</span>
    </footer>

    <Dialog open={statusOpen} onOpenChange={setStatusOpen}><DialogContent className="changes-dialog">
      <DialogTitle>Актуальность расписания</DialogTitle>
      <DialogDescription>Сервер сам скачивает PDF с сайта ВМК, находит 114 группу и публикует пары. Телефон подхватывает их при открытии и заменяет старые пары — смотреть PDF вручную не нужно.</DialogDescription>
      {syncError && <p className="status-error" role="alert">{syncError}</p>}
      {saved.snapshot?.status==='error' && <p className="status-error">{saved.snapshot.error} Показана последняя проверенная версия.</p>}
      {status.tone==='warn' && saved.snapshot?.status!=='error' && <p className="status-error">Последняя сверка с ВМК была давно: сервер проверки запускается с опозданием. Пары показаны по последней проверенной версии.</p>}
      <dl className="status-list">
        <div><dt>Последняя сверка с ВМК</dt><dd>{stamp(saved.snapshot?.checkedAt || null)}</dd></div>
        <div><dt>Последняя попытка</dt><dd>{stamp(saved.snapshot?.attemptedAt || null)}</dd></div>
        <div><dt>Получено телефоном</dt><dd>{saved.syncedAt?stamp(saved.syncedAt):'ещё нет'}</dd></div>
        <div><dt>Расписание на сайте ВМК от</dt><dd>{data.sourceDate}</dd></div>
        <div><dt>Без интернета</dt><dd>{offlineReady?'работает':'ещё не готово'}</dd></div>
      </dl>
      {pdfError && <p className="personal-hint">{pdfError}</p>}
      <button className="save-task" onClick={()=>refresh(true)} disabled={busy || !online}><RefreshCw size={15} className={busy?'spin':''}/> {busy?'Обновляем…':'Обновить'}</button>
      <div className="source-links"><a href="https://github.com/Spacecoinsb/vmk-114-schedule/actions/workflows/pages.yml" target="_blank" rel="noreferrer">История проверок<ArrowUpRight size={14}/></a></div>
    </DialogContent></Dialog>
    {homework.dialogs}
    {subgroups.dialog}
    <Dialog open={changesOpen} onOpenChange={setChangesOpen}><DialogContent className="changes-dialog"><DialogTitle>Что изменилось</DialogTitle><DialogDescription>Сравнение с предыдущей версией на этом устройстве.</DialogDescription>{saved.changes.map(change=><div className="change-item" key={change.id}><strong>{dayNames[change.day]}, {change.start}{change.title?` · ${change.title}`:''}</strong>{change.details?.length ? <ul>{change.details.map(d=><li key={d}>{d}</li>)}</ul> : <>{change.before && <p><span>Было</span>{change.before}</p>}{change.after && <p><span>Стало</span>{change.after}</p>}</>}</div>)}</DialogContent></Dialog>
  </div>;
}
