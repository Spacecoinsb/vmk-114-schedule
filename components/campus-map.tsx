import {useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode} from 'react';
import {ArrowDownUp, LocateFixed, Maximize2, Minus, Plus, Search, Utensils, X} from 'lucide-react';
import {MapScene, type Mark, type Mode} from '@/components/map-scene';
import {FLOORS, WING, POINTS, nearest, pointByKey, route, search} from '@/lib/map-route.mjs';

type Point = {key:string; floor:number; id:string; kind:string; name:string; x:number; y:number; box?:number[]; note?:string};
type Leg = {floor:number; points:number[][]};
type Route = {from:Point; to:Point; length:number; legs:Leg[]; stair:string|null; steps:string[]};
const kindLabel:Record<string,string> = {room:'Аудитория', wc:'Туалет', food:'Еда', place:'Место', lift:'Лифт'};

// Hosts the three.js model; the scene is created once and updated through props.
function SceneView({mode, floor, lowest, legs, marks, focus, onPick}:{mode:Mode; floor:number; lowest:number; legs:Leg[]; marks:Mark[]; focus:{floor:number; x:number; y:number; n:number}|null; onPick:(floor:number, x:number, y:number)=>void}) {
  const host = useRef<HTMLDivElement>(null), scene = useRef<MapScene|null>(null), pick = useRef(onPick);
  pick.current = onPick;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let s:MapScene;
    try { s = new MapScene(host.current!, (f, x, y) => pick.current(f, x, y)); }
    catch { setFailed(true); return; }
    scene.current = s;
    const theme = new MutationObserver(() => s.retheme());
    theme.observe(document.documentElement, {attributes:true, attributeFilter:['data-theme','data-scheme']});
    return () => { theme.disconnect(); s.dispose(); scene.current = null; };
  }, []);
  useEffect(() => { scene.current?.setView(mode, floor, lowest); if (focus?.floor===floor) scene.current?.focus(floor,focus.x,focus.y); }, [mode, floor, lowest]);
  useEffect(() => { scene.current?.setRoute(legs, marks); }, [legs, marks]);
  useEffect(() => { if (focus) scene.current?.focus(focus.floor, focus.x, focus.y); }, [focus]);
  // Without WebGL the original floor plan is still available.
  if (failed) { const f = FLOORS.find(q => q.floor === floor)!; return <div className="scene-view fallback"><img src={import.meta.env.BASE_URL + f.image} alt={`План ${floor} этажа`}/><p className="scene-hint">Интерактивная карта недоступна — показан исходный план</p></div>; }
  return <div className="scene-view" ref={host}>
    <div className="map-orientation"><strong>{floor} этаж</strong><span>{mode==='3d'?'Объёмная модель':mode==='pdf'?'Исходный план':'Север ← · → Юг'}</span></div>
    <div className="map-zoom" role="group" aria-label="Масштаб карты">
      <button aria-label="Приблизить карту" title="Приблизить" onClick={()=>scene.current?.zoom(1.6)}><Plus size={18}/></button>
      <button aria-label="Отдалить карту" title="Отдалить" onClick={()=>scene.current?.zoom(1/1.6)}><Minus size={18}/></button>
      <button aria-label="Показать весь этаж" title="Весь этаж" onClick={()=>scene.current?.reset()}><Maximize2 size={17}/></button>
    </div>
    <p className="scene-hint">{mode==='3d' ? 'Вращай пальцем · приближай двумя' : 'Нажми на кабинет · двигай и приближай план'}</p>
  </div>;
}

function PointChip({label, point, onClear}:{label:string; point:Point|null; onClear:()=>void}) {
  return <div className={`point-chip ${point?'':'empty'}`}><small>{label}</small><span>{point ? `${point.name} · ${point.floor} эт.` : 'не выбрано'}</span>{point && <button aria-label={`Очистить: ${label}`} onClick={onClear}><X size={14}/></button>}</div>;
}

const area = (p:Point) => p.box ? (p.box[2]-p.box[0])*(p.box[3]-p.box[1]) : 1e9;

export function CampusMap({target, fromHint, children}:{target:string|null; fromHint:string|null; children?:ReactNode}) {
  const [floor, setFloor] = useState(6), [mode, setMode] = useState<Mode>('3d');
  const [query, setQuery] = useState(''), [selected, setSelected] = useState<string|null>(null);
  const [fromKey, setFrom] = useState<string|null>(null), [toKey, setTo] = useState<string|null>(null), [special, setSpecial] = useState<Route|null>(null);
  const results = useMemo(() => search(query) as Point[], [query]);
  const r = useMemo(() => special ?? (fromKey && toKey ? route(fromKey, toKey) as Route|null : null), [fromKey, toKey, special]);
  const sel = selected ? pointByKey(selected) as Point : null;
  const from = fromKey ? pointByKey(fromKey) as Point : null, to = toKey ? pointByKey(toKey) as Point : null;
  const [focus, setFocus] = useState<{floor:number; x:number; y:number; n:number}|null>(null);

  function show(key:string) { const p = pointByKey(key) as Point; setSelected(key); setFloor(p.floor); setFocus({floor:p.floor, x:p.x, y:p.y, n:Date.now()}); }
  // A tap selects the room under the finger, or the nearest point close to it.
  function pickAt(f:number, x:number, y:number) {
    const here = (POINTS as Point[]).filter(p => p.floor === f);
    const inside = here.filter(p => p.box && p.box[0] <= x && x <= p.box[2] && p.box[1] <= y && y <= p.box[3]).sort((a, b) => area(a) - area(b))[0];
    const close = here.map(p => ({p, d:Math.hypot(p.x-x, p.y-y)})).sort((a, b) => a.d-b.d)[0];
    const hit = inside ?? (close && close.d < 30 ? close.p : null);
    if (hit) show(hit.key);
    else setFocus({floor:f, x, y, n:Date.now()});
  }
  // Opened from a lesson: select its room and, if the previous class is known, route from there.
  useEffect(() => {
    if (!target) return;
    show(target); setSpecial(null);
    if (fromHint && fromHint!==target) { setFrom(fromHint); setTo(target); } else setTo(target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, fromHint]);
  useEffect(() => { if (r) setFloor(Math.max(...r.legs.map(l => l.floor))); }, [r]);

  const marks = useMemo<Mark[]>(() => [
    ...(from ? [{...from, tone:'from' as const}] : []), ...(to ? [{...to, tone:'to' as const}] : []),
    ...(sel && sel.key!==fromKey && sel.key!==toKey ? [{...sel, tone:'selected' as const}] : []),
  ], [from, to, sel, fromKey, toKey]);
  const legs = useMemo(() => r?.legs ?? [], [r]);
  const lowest = legs.length ? Math.min(...legs.map(l => l.floor)) : floor;
  function quick(kind:'wc'|'food') { const start = selected || fromKey || toKey; if (!start) return; const n = nearest(start, kind) as Route|null; if (n) { setSpecial(n); setFrom(start); setTo(n.to.key); setSelected(null); } }

  return <div className="campus-map">
    <div className="map-search">
      <Search size={16}/>
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Кабинет, столовая, туалет…" aria-label="Поиск на карте" enterKeyHint="search"
        onKeyDown={e=>{if(e.key==='Enter'&&results[0]){show(results[0].key);setQuery('');}}}/>
      {query && <button aria-label="Очистить поиск" onClick={()=>setQuery('')}><X size={15}/></button>}
      {query && <div className="map-results" role="listbox">{results.length ? results.map(p=><button key={p.key} role="option" onClick={()=>{show(p.key);setQuery('');}}>
        <strong>{p.name}</strong><span>{p.floor} этаж · {WING(p.x)}{p.note?` · ${p.note}`:''}</span></button>) : <p>Ничего не найдено</p>}</div>}
    </div>

    <div className="map-toolbar">
      <div className="floor-switch" role="group" aria-label="Этаж">{FLOORS.map(f=><button key={f.floor} aria-pressed={floor===f.floor} className={legs.some(l=>l.floor===f.floor)?'has-route':''} onClick={()=>{setFloor(f.floor); if(sel?.floor!==f.floor) setSelected(null); setFocus(null);}}>{f.floor}</button>)}</div>
      <div className="view-switch map-modes" role="group" aria-label="Вид карты">{([['schema','Схема'],['3d','3D'],['pdf','PDF']] as const).map(([m,label])=><button key={m} aria-pressed={mode===m} onClick={()=>setMode(m)}>{label}</button>)}</div>
    </div>
    <div className="map-stage"><SceneView mode={mode} floor={floor} lowest={lowest} legs={legs} marks={marks} focus={focus} onPick={pickAt}/>
    {sel && sel.key!==fromKey && sel.key!==toKey && <div className="map-card">
      <div><small>{kindLabel[sel.kind]} · {sel.floor} этаж · {WING(sel.x)}</small><strong>{sel.name}</strong>{sel.note && <p>{sel.note}</p>}</div>
      <div className="map-card-actions">
        <button className="small-primary" onClick={()=>{setSpecial(null);setTo(sel.key);setSelected(null);}}>Сюда</button>
        <button className="text-button" onClick={()=>{setSpecial(null);setFrom(sel.key);setSelected(null);}}>Отсюда</button>
        <button className="icon-button" aria-label="Закрыть" onClick={()=>setSelected(null)}><X size={16}/></button>
      </div>
    </div>}
    </div>

    {(from || to) && <div className="route-box">
      <div className="route-points">
        <PointChip label="Откуда" point={from} onClear={()=>{setFrom(null);setSpecial(null);}}/>
        <button className="icon-button" aria-label="Поменять местами" onClick={()=>{setSpecial(null);setFrom(toKey);setTo(fromKey);}}><ArrowDownUp size={16}/></button>
        <PointChip label="Куда" point={to} onClear={()=>{setTo(null);setSpecial(null);}}/>
      </div>
      {r ? <ol className="route-steps">{r.steps.map(s=><li key={s}>{s}</li>)}</ol>
        : <p className="personal-hint">{from ? 'Выбери, куда идти: найди кабинет или нажми на него на плане.' : 'Выбери, откуда идёшь: найди кабинет или нажми на него на плане.'}</p>}
    </div>}

    <div className="map-quick">
      {children}
      {(selected||fromKey||toKey) && <><button onClick={()=>quick('wc')}><LocateFixed size={14}/>Ближайший туалет</button>
      <button onClick={()=>quick('food')}><Utensils size={14}/>Где поесть</button></>}
    </div>
    <p className="map-credit">План этажей — памятка первокурсника ВМК. Этажи 3–4 не показаны: по лестницам идёшь насквозь.</p>
  </div>;
}
