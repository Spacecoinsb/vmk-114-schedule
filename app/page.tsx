"use client";
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,CalendarDays,Check,ChevronLeft,ChevronRight,Download,RefreshCw,WifiOff} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import seed from '@/public/initial.json';

type Lesson={id:string;day:number;start:string;end:string;title:string;detail:string;room:string;type:string;raw:string;rule:{from?:string;dates?:string[]}|null};
type Schedule={group:number;year:number;page:number;lessons:Lesson[];sourceDate:string;sourceUrl:string;hash:string;savedAt:string};
type Change={id:string;day:number;start:string;before?:string;after?:string};
const dayNames=['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
const shortDays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const storageKey='vmk114-v1';
const asset=(path:string)=>import.meta.env.BASE_URL+path.replace(/^\//,'');
const isoMoscow=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const addDays=(iso:string,n:number)=>new Date(new Date(iso+'T12:00:00Z').getTime()+n*86400000).toISOString().slice(0,10);
const weekday=(iso:string)=>(new Date(iso+'T12:00:00Z').getUTCDay()+6)%7;
const formatDate=(iso:string,options:Intl.DateTimeFormatOptions={day:'numeric',month:'long'})=>new Date(iso+'T12:00:00Z').toLocaleDateString('ru-RU',{...options,timeZone:'Europe/Moscow'});
const active=(l:Lesson,date:string)=>!l.rule||((!l.rule.from||date>=l.rule.from)&&(!l.rule.dates||l.rule.dates.includes(date)));
const typeNames:Record<string,string>={lecture:'Лекция',class:'Занятие',consultation:'Консультация',sport:'Физкультура'};
const valid=(x:unknown):x is Schedule=>!!x&&typeof x==='object'&&'group' in x&&x.group===114&&'lessons' in x&&Array.isArray(x.lessons)&&x.lessons.length>0&&x.lessons.every(l=>typeof l.title==='string'&&typeof l.start==='string'&&typeof l.end==='string'&&Number.isInteger(l.day));

export default function Home(){
 const [data,setData]=useState<Schedule>(seed as Schedule),current=useRef<Schedule>(seed as Schedule);
 const [today,setToday]=useState(seed.savedAt.slice(0,10)),[selected,setSelected]=useState(seed.savedAt.slice(0,10));
 const [view,setView]=useState('day'),[busy,setBusy]=useState(false),[online,setOnline]=useState(true),[message,setMessage]=useState(''),[error,setError]=useState(false);
 const [checked,setChecked]=useState(''),[offlineReady,setOfflineReady]=useState(false),[installOpen,setInstallOpen]=useState(false),[changesOpen,setChangesOpen]=useState(false),[changes,setChanges]=useState<Change[]>([]);
 const [clock,setClock]=useState(''),[pdfUrl,setPdfUrl]=useState('');
 const checking=useRef(false),lastAttempt=useRef(0);
 const monday=addDays(selected,-weekday(selected));
 const week=Array.from({length:7},(_,i)=>addDays(monday,i));
 const lessons=(date:string)=>data.lessons.filter(l=>l.day===weekday(date)&&active(l,date));
 function saveMeta(next:Schedule,when:string,changed:Change[]){try{localStorage.setItem(storageKey,JSON.stringify({data:next,checked:when,changes:changed}));}catch{throw Error('Не удалось сохранить обновление на телефоне. Освободи место и повтори проверку.');}}
 async function refresh(manual=false){
  if(checking.current||(!manual&&Date.now()-lastAttempt.current<10*60*1000))return;
  if(!navigator.onLine){setOnline(false);if(manual){setMessage('Нет интернета. Показано сохранённое расписание.');setError(true);}return;}
  checking.current=true;lastAttempt.current=Date.now();setBusy(true);setError(false);if(manual)setMessage('');
  try{
   const before=current.current;
   const metaResponse=await fetch(asset('/source.json')+'?t='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(20000)});
   if(!metaResponse.ok)throw Error('Не удалось проверить расписание. Сохранённая версия доступна.');
   const meta=await metaResponse.json() as {date:string;url:string;hash:string};
   if(!/^[a-f0-9]{64}$/.test(meta.hash)||!/^https:\/\/cs\.msu\.ru\/sites\/cmc\/files\/.*\.pdf$/.test(meta.url))throw Error('Источник расписания имеет неизвестный формат.');
   if(meta.hash===before.hash){const when=new Date().toISOString();const next={...before,sourceDate:meta.date,sourceUrl:meta.url};const stored=JSON.parse(localStorage.getItem(storageKey)||'null');saveMeta(next,when,stored?.changes||changes);setChecked(when);setData(next);current.current=next;if(manual)setMessage('Проверено: расписание 114 группы не изменилось.');return;}
   const response=await fetch(asset('/latest.pdf')+'?v='+meta.hash,{cache:'no-store',signal:AbortSignal.timeout(45000)});
   if(!response.ok)throw Error('Новый PDF пока недоступен. Сохранённая версия оставлена.');
   const bytes=await response.arrayBuffer();
   // These local modules are cached together with the app for offline use.
   const pdfModule=asset('/vendor/pdf.mjs');
   const pdfjs=await import(/* @vite-ignore */ pdfModule);
   pdfjs.GlobalWorkerOptions.workerSrc=asset('/vendor/pdf.worker.mjs');
   const parserModule=asset('/parser.mjs');
   const parser=await import(/* @vite-ignore */ parserModule);
   const parsed=await parser.parseSchedule(pdfjs,bytes.slice(0));
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
   if(hash!==meta.hash)throw Error('PDF обновляется. Повтори проверку чуть позже.');
   const next:Schedule={...parsed,sourceDate:meta.date,sourceUrl:meta.url,hash,savedAt:new Date().toISOString()};
   if(!valid(next))throw Error('Не удалось проверить новое расписание. Сохранённая версия оставлена.');
   const diff:Change[]=[];
   for(const l of next.lessons){const old=before.lessons.find(x=>x.id===l.id);if(!old||old.raw!==l.raw||old.end!==l.end)diff.push({id:l.id,day:l.day,start:l.start,before:old?.raw,after:l.raw});}
   for(const l of before.lessons)if(!next.lessons.some(x=>x.id===l.id))diff.push({id:l.id,day:l.day,start:l.start,before:l.raw});
   const when=new Date().toISOString();
   // Save the matching PDF first; retain the previous version on a storage failure.
   const cache=await caches.open('vmk114-data-v1');
   const pdfKey=asset('/saved-schedule-'+hash+'.pdf');
   await cache.put(pdfKey,new Response(bytes,{headers:{'Content-Type':'application/pdf'}}));
   saveMeta(next,when,diff);setData(next);current.current=next;setChecked(when);setChanges(diff);setPdfUrl(pdfKey);
   for(const request of await cache.keys())if(new URL(request.url).pathname!==pdfKey)await cache.delete(request);
   setMessage(diff.length?'Расписание 114 группы изменилось. Новая версия сохранена.':'PDF обновился, но пары 114 группы не изменились.');
  }catch(e){setError(true);setMessage(e instanceof Error?e.message:'Не удалось проверить обновления. Сохранённое расписание оставлено.');}
  finally{checking.current=false;setBusy(false);}
 }
 useEffect(()=>{
  const date=isoMoscow();setToday(date);setSelected(date);setOnline(navigator.onLine);
  try{const old=JSON.parse(localStorage.getItem(storageKey)||'null');if(valid(old?.data)){current.current=old.data;setData(old.data);setChecked(old.checked||'');setChanges(Array.isArray(old.changes)?old.changes:[]);}}catch{/* Keep verified initial schedule. */}
  const tick=()=>{setClock(new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'}).format(new Date()));setToday(isoMoscow());};tick();
  const timer=setInterval(tick,30000);
  const onOnline=()=>{setOnline(true);lastAttempt.current=0;void refresh();};
  const onOffline=()=>setOnline(false);
  const onVisible=()=>{if(document.visibilityState==='visible'){tick();void refresh();}};
  window.addEventListener('online',onOnline);window.addEventListener('offline',onOffline);document.addEventListener('visibilitychange',onVisible);
   if('serviceWorker' in navigator){navigator.serviceWorker.register(asset('/sw.js'),{scope:import.meta.env.BASE_URL}).then(async()=>{await navigator.serviceWorker.ready;const cached=await caches.match(asset('/offline-ready'));setOfflineReady(!!cached);}).catch(()=>{setMessage('Не удалось подготовить офлайн-доступ. Открой приложение в Safari и попробуй ещё раз.');setError(true);});}
   const savedPdf=asset('/saved-schedule-'+current.current.hash+'.pdf');
  if('caches' in window)caches.open('vmk114-data-v1').then(c=>c.match(savedPdf)).then(r=>{if(r)setPdfUrl(savedPdf);}).catch(()=>{});
  void refresh();
  return()=>{clearInterval(timer);window.removeEventListener('online',onOnline);window.removeEventListener('offline',onOffline);document.removeEventListener('visibilitychange',onVisible);};
 // Initialization reads the stored version before the first network check.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 function renderDay(date:string,weekly=false){const list=lessons(date);return <section className={weekly?'week-day':''} key={date} aria-label={formatDate(date)}><div className="day-title"><h2>{dayNames[weekday(date)]}{weekly&&<span> · {formatDate(date,{day:'numeric',month:'short'})}</span>}</h2><span>{list.length?`${list.length} ${list.length===1?'занятие':list.length<5?'занятия':'занятий'}`:'Без занятий'}</span></div>{list.length?list.map(l=><article className={`lesson ${date===today&&clock>=l.start&&clock<l.end?'current':''} ${changes.some(c=>c.id===l.id)?'changed':''}`} key={l.id}><div className="time"><strong>{l.start}</strong><span>{l.end}</span></div><div className="lesson-card"><div className="lesson-top"><span className="type">{typeNames[l.type]||'Занятие'}</span><div className="tags">{date===today&&clock>=l.start&&clock<l.end&&<span className="badge">Сейчас</span>}{changes.some(c=>c.id===l.id)&&<span className="badge">Изменено</span>}{l.room&&<span className="room">{l.room}</span>}</div></div><h3>{l.title}</h3>{l.detail&&<p>{l.detail}</p>}</div></article>):<div className="empty"><CalendarDays size={28}/><strong>Можно выдохнуть</strong>В расписании на этот день занятий нет.</div>}</section>;}
 return <div className="shell"><header className="topbar"><div className="brand"><div className="brandmark">114</div><div><strong>Расписание</strong><span>ВМК МГУ · 1 курс</span></div></div><button className="quiet-button" onClick={()=>refresh(true)} disabled={busy} aria-label="Проверить обновления"><RefreshCw className={busy?'spin':''}/><span className="refresh-label">{busy?'Проверяем…':'Обновить'}</span></button></header><Tabs value={view} onValueChange={setView} className="view-tabs"><div className="heading"><div><p className="eyebrow">Осенний семестр {data.year}/{data.year+1}</p><h1>{view==='day'?formatDate(selected):'Твоя неделя'}</h1></div><TabsList aria-label="Вид расписания"><TabsTrigger value="day">День</TabsTrigger><TabsTrigger value="week">Неделя</TabsTrigger></TabsList></div><div className="main-grid"><main className="schedule-surface"><div className="week-switcher"><span className="week-label">{formatDate(monday,{day:'numeric',month:'short'})} — {formatDate(week[6],{day:'numeric',month:'short'})}</span><div className="week-arrows"><button className="icon-button" aria-label="Предыдущая неделя" onClick={()=>setSelected(addDays(selected,-7))}><ChevronLeft/></button><button className="quiet-button" onClick={()=>setSelected(today)}>Сегодня</button><button className="icon-button" aria-label="Следующая неделя" onClick={()=>setSelected(addDays(selected,7))}><ChevronRight/></button></div></div><TabsContent value="day"><div className="day-strip" aria-label="Выбрать день">{week.map((d,i)=><button key={d} className={`day-button ${d===selected?'selected':''} ${d===today?'today':''}`} aria-pressed={d===selected} onClick={()=>setSelected(d)} aria-label={dayNames[i]+', '+formatDate(d)}><span>{shortDays[i]}</span><strong>{Number(d.slice(-2))}</strong></button>)}</div></TabsContent>{!online&&<div className="message">Нет интернета. Сохранённое расписание доступно.</div>}{message&&<div className={'message '+(error?'error':'')} role="status">{message}{changes.length>0&&!error&&<button onClick={()=>setChangesOpen(true)}>Что изменилось</button>}</div>}{(selected<`${data.year}-09-01`||selected>`${data.year+1}-01-31`)&&<div className="message error">Это расписание осеннего семестра {data.year}/{data.year+1}. Для выбранной даты оно может быть неактуально.</div>}<TabsContent value="day">{renderDay(selected)}</TabsContent><TabsContent value="week">{week.map(d=>renderDay(d,true))}</TabsContent></main><aside className="aside"><section className="aside-card"><h2>Актуальность расписания</h2><div className="info-row"><span>Дата на сайте ВМК</span><strong>{data.sourceDate}</strong></div><div className="info-row"><span>Последняя проверка</span><strong>{checked?new Date(checked).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Ещё не проверено'}</strong></div><div className="status">{!online?<WifiOff/>:offlineReady?<Check/>:<Download/>}<span>{offlineReady?'Сохранено для доступа без сети':'Подготовка офлайн-доступа…'}</span></div>{changes.length>0&&<button className="quiet-button" style={{marginTop:15}} onClick={()=>setChangesOpen(true)}>Посмотреть изменения</button>}<div className="source-links">{pdfUrl&&<a href={pdfUrl} target="_blank" rel="noreferrer">Сохранённый PDF <ArrowUpRight/></a>}<a href="https://cs.msu.ru/studies/schedule" target="_blank" rel="noreferrer">Страница ВМК <ArrowUpRight/></a></div></section><section className="aside-card install-card"><Download size={24}/><h2>Расписание под рукой</h2><p>Добавь на экран «Домой», чтобы открывать пары как приложение.</p><button className="quiet-button" onClick={()=>setInstallOpen(true)}>Как установить на iPhone</button></section></aside></div></Tabs><footer className="footer"><span>Группа 114 · Время московское</span><span>Проверяем изменения при открытии и появлении сети</span></footer><Dialog open={installOpen} onOpenChange={setInstallOpen}><DialogContent><DialogTitle>На главный экран iPhone</DialogTitle><DialogDescription>Один раз открой приложение с интернетом и дождись надписи «Сохранено для доступа без сети».</DialogDescription><ol className="install-steps"><li>Открой эту страницу в <strong>Safari</strong>.</li><li>Нажми <strong>«Поделиться»</strong> — квадрат со стрелкой вверх.</li><li>Выбери <strong>«На экран “Домой”»</strong>. Если есть переключатель «Открывать как веб-приложение», включи его.</li><li>Нажми <strong>«Добавить»</strong> и один раз открой новую иконку с интернетом.</li></ol><p className="text-sm text-muted-foreground">После сохранения расписание открывается без сети. При открытии с интернетом проверяются изменения на сайте ВМК. Пока приложение закрыто, проверки на телефоне не выполняются.</p></DialogContent></Dialog><Dialog open={changesOpen} onOpenChange={setChangesOpen}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogTitle>Что изменилось</DialogTitle><DialogDescription>Сравнение с предыдущей сохранённой версией для 114 группы.</DialogDescription>{changes.length?changes.map(c=><div className="change-item" key={c.id}><strong>{dayNames[c.day]} · {c.start} · {!c.before?'Добавлено':!c.after?'Убрано':'Изменено'}</strong>{c.before&&<p>Было: {c.before}</p>}{c.after&&<p>Стало: {c.after}</p>}</div>):<p>Изменений для 114 группы нет.</p>}</DialogContent></Dialog></div>;
}
