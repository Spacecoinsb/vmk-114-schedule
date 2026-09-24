import {useEffect, useRef, useState} from 'react';
import {ArrowUpRight, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, RefreshCw, WifiOff} from 'lucide-react';
import {Dialog, DialogContent, DialogTitle, DialogDescription} from '@/components/ui/dialog';
import {cleanTitle, diffSchedules, teacherRows, validSchedule, validSnapshot, verification} from '@/lib/schedule-model.mjs';
import seed from '@/public/source.json';

type Lesson = {id:string; day:number; start:string; end:string; title:string; detail:string; room:string; type:string; raw:string; rule:{from?:string; dates?:string[]}|null};
type Schedule = {group:number; year:number; page:number; lessons:Lesson[]; sourceDate:string; sourceUrl:string; hash:string; savedAt:string};
type Snapshot = {schema:number; status:string; attemptedAt:string; checkedAt:string|null; error:string|null; date:string; url:string; hash:string; schedule:Schedule};
type Change = {id:string; day:number; start:string; before?:string; after?:string};
type Saved = {data:Schedule; snapshot:Snapshot|null; syncedAt:string; changes:Change[]};
const dayNames = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
const shortDays = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const typeNames:Record<string,string> = {lecture:'Лекция', class:'Занятие', consultation:'Консультация', sport:'Физкультура'};
const storageKey = 'vmk114-v1';
const dataCache = 'vmk114-data-v1';
const asset = (path:string) => import.meta.env.BASE_URL + path.replace(/^\//,'');
const pdfKey = (hash:string) => asset(`saved-schedule-${hash}.pdf`);
const isoMoscow = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const addDays = (iso:string,n:number) => new Date(new Date(iso+'T12:00:00Z').getTime()+n*86400000).toISOString().slice(0,10);
const weekday = (iso:string) => (new Date(iso+'T12:00:00Z').getUTCDay()+6)%7;
const formatDate = (iso:string,options:Intl.DateTimeFormatOptions={day:'numeric',month:'long'}) => new Date(iso+'T12:00:00Z').toLocaleDateString('ru-RU',{...options,timeZone:'Europe/Moscow'});
const stamp = (iso:string|null) => iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : 'Нет подтверждения';
const active = (lesson:Lesson,date:string) => !lesson.rule || ((!lesson.rule.from || date>=lesson.rule.from) && (!lesson.rule.dates || lesson.rule.dates.includes(date)));
const safeChanges = (value:unknown):Change[] => Array.isArray(value) ? value.filter(c => c && typeof c.id==='string' && Number.isInteger(c.day) && c.day>=0 && c.day<6 && typeof c.start==='string' && (c.before===undefined || typeof c.before==='string') && (c.after===undefined || typeof c.after==='string')) : [];

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
function LessonCard({lesson,date,today,clock,changed}:{lesson:Lesson;date:string;today:string;clock:string;changed:boolean}) {
  const now = date===today && clock>=lesson.start && clock<lesson.end;
  const rows = teacherRows(lesson.detail) as {teacher:string;room:string;note:string}[];
  const note = lesson.rule?.dates ? 'Только '+lesson.rule.dates.map(d=>formatDate(d,{day:'numeric',month:'short'})).join(', ') : lesson.rule?.from ? 'С '+formatDate(lesson.rule.from) : '';
  return <article className={`lesson ${now?'current':''}`}>
    <div className="time"><strong>{lesson.start}</strong><span>{lesson.end}</span></div>
    <div className="lesson-card">
      <div className="lesson-top"><span className="type">{typeNames[lesson.type]}</span><div className="tags">{now && <span className="badge">Сейчас</span>}{changed && <span className="badge">Изменено</span>}</div></div>
      <h3>{cleanTitle(lesson)}</h3>
      {rows.map((row,i)=><div className="teacher-row" key={i}><span>{row.teacher}</span>{(row.room || (i===0 && lesson.room)) && <Room room={row.room || lesson.room} note={row.note}/>}</div>)}
      {!rows.length && lesson.room && <Room room={lesson.room}/>}
      {note && <p className="rule-note">{note}</p>}
    </div>
  </article>;
}

export default function Home() {
  const [saved,setSaved] = useState<Saved>(initialState);
  const current = useRef(saved);
  const [today,setToday] = useState(isoMoscow), [selected,setSelected] = useState(isoMoscow);
  const [view,setView] = useState('day'), [busy,setBusy] = useState(false), [online,setOnline] = useState(navigator.onLine);
  const [message,setMessage] = useState(''), [syncError,setSyncError] = useState(''), [offlineReady,setOfflineReady] = useState(false);
  const [changesOpen,setChangesOpen] = useState(false), [clock,setClock] = useState(''), [pdfUrl,setPdfUrl] = useState(''), [pdfError,setPdfError] = useState('');
  const checking = useRef(false), lastAttempt = useRef(0);
  const data = saved.data;
  const monday = addDays(selected,-weekday(selected));
  const week = Array.from({length:7},(_,i)=>addDays(monday,i));
  const status = verification(saved.snapshot);
  const statusTitle = !online ? 'Без интернета' : busy ? 'Получаем обновления…' : syncError ? 'Не удалось получить обновления' : status.title;
  const tone = !online ? 'offline' : syncError ? 'warn' : status.tone;

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
    if (checking.current || (!manual && Date.now()-lastAttempt.current<10*60*1000)) return;
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
      if (diff.length) setMessage('Пары обновлены и сохранены на устройстве.');
      else if (manual) setMessage('Получена последняя опубликованная версия. Изменений в парах нет.');
      try { await savePdf(snapshot.hash); }
      catch (error) { setPdfError(error instanceof Error?error.message:'Не удалось сохранить PDF. Пары сохранены.'); }
    } catch (error) { setSyncError(error instanceof Error?error.message:'Не удалось получить обновления. Сохранённая версия оставлена.'); }
    finally { checking.current=false; setBusy(false); }
  }

  useEffect(()=>{
    let disposed=false;
    const tick=()=>{setClock(new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'}).format(new Date()));setToday(isoMoscow());};
    tick(); const timer=setInterval(tick,30000);
    const syncTimer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},10*60*1000);
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

  function renderDay(date:string,weekly=false) {
    const list=data.lessons.filter(l=>l.day===weekday(date) && active(l,date));
    return <section className={weekly?'week-day':''} key={date} aria-label={formatDate(date)}>
      <div className="day-title"><h2>{dayNames[weekday(date)]}{weekly && <span> · {formatDate(date,{day:'numeric',month:'short'})}</span>}</h2><span>{list.length?`${list.length} ${list.length===1?'пара':list.length<5?'пары':'пар'}`:'Выходной'}</span></div>
      {list.length ? list.map(l=><LessonCard key={l.id} lesson={l} date={date} today={today} clock={clock} changed={saved.changes.some(c=>c.id===l.id)}/>) : <div className="empty"><CalendarDays size={25}/><p>На этот день пар нет</p></div>}
    </section>;
  }

  return <div className="shell">
    <header className="topbar"><a className="brand" href={import.meta.env.BASE_URL} aria-label="Расписание группы 114"><span className="brandmark">114</span><span><strong>Расписание</strong><small>ВМК МГУ · 1 курс</small></span></a><button className="quiet-button refresh-button" onClick={()=>refresh(true)} disabled={busy || !online}><RefreshCw size={17} className={busy?'spin':''}/>{busy?'Загрузка…':'Обновить'}</button></header>
    <details className={`verification ${tone}`}>
      <summary><span className="status-icon">{!online?<WifiOff size={17}/>:busy?<RefreshCw size={17} className="spin"/>:<span className="status-dot"/>}</span><span className="status-copy"><strong aria-live="polite">{statusTitle}</strong><small>{!online?'Показана сохранённая версия':`ВМК: ${stamp(saved.snapshot?.checkedAt || null)}`}</small></span><ChevronDown className="disclosure" size={17}/></summary>
      <div className="verification-details">
        {syncError && <p className="status-error" role="alert">{syncError}</p>}
        {saved.snapshot?.status==='error' && <p className="status-error">{saved.snapshot.error} Сохранена последняя проверенная версия.</p>}
        {status.tone==='warn' && saved.snapshot?.status!=='error' && <p className="status-error">Свежая проверка не подтверждена. Данные могут быть устаревшими.</p>}
        <dl><div><dt>Успешная проверка ВМК</dt><dd>{stamp(saved.snapshot?.checkedAt || null)}</dd></div><div><dt>Последняя попытка</dt><dd>{stamp(saved.snapshot?.attemptedAt || null)}</dd></div><div><dt>Получено на устройство</dt><dd>{saved.syncedAt?stamp(saved.syncedAt):'Ещё не синхронизировано'}</dd></div><div><dt>Дата расписания на ВМК</dt><dd>{data.sourceDate}</dd></div></dl>
        <p>Автопроверка ВМК запланирована раз в 6 часов. GitHub может задержать запуск; спустя 9 часов без успешной проверки здесь появится предупреждение. Кнопка «Обновить» получает результат последней проверки.</p>
        <p>При изменении PDF пары обновляются автоматически. Если файл не удаётся разобрать, остаётся прежняя версия с сообщением об ошибке.</p>
        <div className="source-links"><a href="https://cs.msu.ru/studies/schedule" target="_blank" rel="noreferrer">Сайт ВМК<ArrowUpRight size={15}/></a><a href="https://github.com/Spacecoinsb/vmk-114-schedule/actions/workflows/pages.yml" target="_blank" rel="noreferrer">История проверок<ArrowUpRight size={15}/></a></div>
      </div>
    </details>
    <main>
      <div className="heading"><div><p className="eyebrow">Осень {data.year}</p><h1>{view==='day'?formatDate(selected):'Расписание недели'}</h1></div><div className="view-switch" role="group" aria-label="Вид расписания"><button aria-pressed={view==='day'} onClick={()=>setView('day')}>День</button><button aria-pressed={view==='week'} onClick={()=>setView('week')}>Неделя</button></div></div>
      <div className="week-switcher"><span>{formatDate(monday,{day:'numeric',month:'short'})} — {formatDate(week[6],{day:'numeric',month:'short'})}</span><div className="week-arrows"><button className="icon-button" aria-label="Предыдущая неделя" onClick={()=>setSelected(addDays(selected,-7))}><ChevronLeft/></button><button className="today-button" onClick={()=>setSelected(today)}>Сегодня</button><button className="icon-button" aria-label="Следующая неделя" onClick={()=>setSelected(addDays(selected,7))}><ChevronRight/></button></div></div>
      {view==='day' && <nav className="day-strip" aria-label="Выбрать день">{week.map((date,i)=><button key={date} className={`day-button ${date===today?'today':''}`} aria-pressed={date===selected} onClick={()=>setSelected(date)} aria-label={dayNames[i]+', '+formatDate(date)}><span>{shortDays[i]}</span><strong>{Number(date.slice(-2))}</strong></button>)}</nav>}
      {message && <div className="message" role="status">{message}{saved.changes.length>0 && <button onClick={()=>setChangesOpen(true)}>Что изменилось</button>}</div>}
      {(selected<`${data.year}-09-01` || selected>`${data.year+1}-01-31`) && <div className="message warning">Это расписание осени {data.year}. Для выбранной даты оно может быть неактуально.</div>}
      {view==='day'?renderDay(selected):week.map(date=>renderDay(date,true))}
    </main>
    <footer className="footer"><div className="offline-state">{offlineReady?<Check size={15}/>:<WifiOff size={15}/>}<span>{offlineReady?'Доступно без интернета':'Офлайн-доступ пока не готов'}</span></div><div className="footer-links">{pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer">PDF<ArrowUpRight size={14}/></a>}{saved.changes.length>0 && <button onClick={()=>setChangesOpen(true)}>Изменения</button>}<span>Время московское</span></div>{pdfError && <p className="pdf-error">{pdfError}</p>}</footer>
    <Dialog open={changesOpen} onOpenChange={setChangesOpen}><DialogContent className="changes-dialog"><DialogTitle>Что изменилось</DialogTitle><DialogDescription>Сравнение с предыдущей версией на этом устройстве.</DialogDescription>{saved.changes.map(change=><div className="change-item" key={change.id}><strong>{dayNames[change.day]} · {change.start} · {!change.before?'Добавлено':!change.after?'Убрано':'Изменено'}</strong>{change.before && <p><span>Было</span>{change.before}</p>}{change.after && <p><span>Стало</span>{change.after}</p>}</div>)}</DialogContent></Dialog>
  </div>;
}
