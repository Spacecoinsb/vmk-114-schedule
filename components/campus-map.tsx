import {useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode} from 'react';
import {ArrowDownUp, Box, Layers, LocateFixed, Minus, Plus, Search, Utensils, X} from 'lucide-react';
import {FLOORS, WING, floorOf, nearest, pointByKey, route, search} from '@/lib/map-route.mjs';

type Point = {key:string; floor:number; id:string; kind:string; name:string; x:number; y:number; note?:string};
type Leg = {floor:number; points:number[][]};
type Route = {from:Point; to:Point; length:number; legs:Leg[]; stair:string|null; steps:string[]};
type Floor = (typeof FLOORS)[number];
const asset = (path:string) => import.meta.env.BASE_URL + path;
const VIEW = 1000;
const kindLabel:Record<string,string> = {room:'Аудитория', wc:'Туалет', food:'Еда', place:'Место'};

// Route line, markers and tappable rooms drawn in the floor's own coordinates.
function Overlay({floor, legs, marks, onPick, labels}:{floor:Floor; legs:Leg[]; marks:{p:Point; tone:string}[]; onPick?:(key:string)=>void; labels:boolean}) {
  const h = VIEW/floor.aspect;
  return <svg className="map-overlay" viewBox={`0 0 ${VIEW} ${h}`} preserveAspectRatio="none">
    {onPick && floor.rooms.map(r=><circle key={r.id} className="hotspot" cx={r.x*VIEW} cy={r.y*h} r={9} onClick={e=>{e.stopPropagation();onPick(`${floor.floor}:${r.id}`);}}><title>{r.id}</title></circle>)}
    {onPick && floor.places.map(p=><circle key={p.id} className="hotspot" cx={p.x*VIEW} cy={p.y*h} r={10} onClick={e=>{e.stopPropagation();onPick(`${floor.floor}:${p.id}`);}}><title>{p.name}</title></circle>)}
    {legs.filter(l=>l.floor===floor.floor).map((l,i)=><polyline key={i} className="route-line" points={l.points.map(([x,y])=>`${x*VIEW},${y*h}`).join(' ')}/>)}
    {legs.length>1 && legs.map((l,i)=>l.floor===floor.floor && <circle key={'s'+i} className="stair-mark" cx={l.points[i===0?l.points.length-1:0][0]*VIEW} cy={l.points[i===0?l.points.length-1:0][1]*h} r={7}/>)}
    {marks.filter(m=>m.p.floor===floor.floor).map(m=><g key={m.p.key+m.tone} className={`mark ${m.tone}`} transform={`translate(${m.p.x*VIEW} ${m.p.y*h})`}>
      <circle className="pulse" r={16}/><circle r={7}/>{labels && <text y={-14}>{m.p.id.length<6?m.p.id:m.p.name}</text>}
    </g>)}
  </svg>;
}

// Flat floor plan with drag, pinch and wheel zoom.
function FloorView({floor, legs, marks, focus, onPick}:{floor:Floor; legs:Leg[]; marks:{p:Point; tone:string}[]; focus:{x:number; y:number}|null; onPick:(key:string)=>void}) {
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({s:1, x:0, y:0});
  const pointers = useRef(new Map<number,{x:number; y:number}>()), gesture = useRef<{d:number; s:number; x:number; y:number; cx:number; cy:number}|null>(null), moved = useRef(0);
  const size = () => { const r = box.current!.getBoundingClientRect(); return {w:r.width, h:r.height}; };
  const clamp = (s:number, x:number, y:number) => {
    const {w, h} = size(), cw = w*s, ch = w*s/floor.aspect;
    return {s, x:cw<w ? (w-cw)/2 : Math.min(0, Math.max(w-cw, x)), y:ch<h ? (h-ch)/2 : Math.min(0, Math.max(h-ch, y))};
  };
  const zoomAt = (s:number, px:number, py:number, from=t) => {
    const next = Math.min(12, Math.max(1, s));
    setT(clamp(next, px-(px-from.x)*next/from.s, py-(py-from.y)*next/from.s));
  };
  // Open readable: fit the height, then centre on what matters.
  useEffect(() => {
    if (!box.current) return;
    const {w, h} = size();
    const s = Math.max(1, Math.min(8, h*floor.aspect/w*0.95));
    const target = focus ?? {x:0.5, y:0.5};
    setT(clamp(s, w/2-target.x*w*s, h/2-target.y*w*s/floor.aspect));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor.floor, focus?.x, focus?.y]);
  function down(e:ReactPointerEvent) { box.current!.setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, {x:e.clientX, y:e.clientY}); moved.current = 0; start(); }
  function start() {
    const ps = [...pointers.current.values()], r = box.current!.getBoundingClientRect();
    const cx = ps.reduce((a,p)=>a+p.x,0)/ps.length-r.left, cy = ps.reduce((a,p)=>a+p.y,0)/ps.length-r.top;
    gesture.current = {d:ps.length>1 ? Math.hypot(ps[0].x-ps[1].x, ps[0].y-ps[1].y) : 0, s:t.s, x:t.x, y:t.y, cx, cy};
  }
  function move(e:ReactPointerEvent) {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, {x:e.clientX, y:e.clientY});
    const ps = [...pointers.current.values()], r = box.current!.getBoundingClientRect(), g = gesture.current;
    const cx = ps.reduce((a,p)=>a+p.x,0)/ps.length-r.left, cy = ps.reduce((a,p)=>a+p.y,0)/ps.length-r.top;
    moved.current += 1;
    if (ps.length>1 && g.d) {
      const s = Math.min(12, Math.max(1, g.s*Math.hypot(ps[0].x-ps[1].x, ps[0].y-ps[1].y)/g.d));
      setT(clamp(s, cx-(g.cx-g.x)*s/g.s, cy-(g.cy-g.y)*s/g.s));
    } else setT(clamp(g.s, g.x+cx-g.cx, g.y+cy-g.cy));
  }
  function up(e:ReactPointerEvent) { pointers.current.delete(e.pointerId); if (pointers.current.size) start(); else gesture.current = null; }
  return <div className="floor-view" ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
    onWheel={e=>{const r=box.current!.getBoundingClientRect();zoomAt(t.s*(e.deltaY<0?1.2:1/1.2), e.clientX-r.left, e.clientY-r.top);}}
    onClickCapture={e=>{if(moved.current>4){e.stopPropagation();e.preventDefault();}}}>
    <div className="floor-canvas" style={{transform:`translate(${t.x}px,${t.y}px) scale(${t.s})`, aspectRatio:String(floor.aspect)}}>
      <img src={asset(floor.image)} alt={`План ${floor.floor} этажа`} draggable={false}/>
      <Overlay floor={floor} legs={legs} marks={marks} onPick={onPick} labels/>
    </div>
    <div className="compass"><span>← Север</span><span>Юг →</span></div>
    <div className="zoom-buttons">
      <button aria-label="Приблизить" onClick={()=>{const {w,h}=size();zoomAt(t.s*1.5,w/2,h/2);}}><Plus size={16}/></button>
      <button aria-label="Отдалить" onClick={()=>{const {w,h}=size();zoomAt(t.s/1.5,w/2,h/2);}}><Minus size={16}/></button>
    </div>
  </div>;
}

// All floors stacked in perspective; drag to turn, tap a floor to open it.
function Stack({active, legs, marks, stair, onOpen}:{active:number; legs:Leg[]; marks:{p:Point; tone:string}[]; stair:string|null; onOpen:(floor:number)=>void}) {
  const box = useRef<HTMLDivElement>(null);
  const [angle, setAngle] = useState({z:-20, x:56}), drag = useRef<{x:number; y:number; z:number; a:number; moved:number}|null>(null);
  const [width, setWidth] = useState(340);
  useEffect(() => { const r = () => setWidth(Math.min(640, (box.current?.clientWidth || 360)*0.86)); r(); addEventListener('resize', r); return () => removeEventListener('resize', r); }, []);
  const ref = floorOf(6)!, H = width/ref.aspect, gap = width*0.1;
  const routeFloors = new Set(legs.map(l=>l.floor));
  const stairRef = stair ? ref.stairs.find(s=>s.id===stair) : null;
  const [lo, hi] = legs.length>1 ? [Math.min(legs[0].floor, legs[1].floor), Math.max(legs[0].floor, legs[1].floor)] : [0, 0];
  return <div className="stack-stage" ref={box}
    onPointerDown={e=>{drag.current={x:e.clientX,y:e.clientY,z:angle.z,a:angle.x,moved:0};}}
    onPointerMove={e=>{const d=drag.current;if(!d)return;
      // Capture only a real drag, so a tap still reaches the floor under the finger.
      if(Math.hypot(e.clientX-d.x,e.clientY-d.y)<6&&!d.moved)return;
      if(!d.moved)box.current!.setPointerCapture(e.pointerId);d.moved++;
      setAngle({z:d.z+(e.clientX-d.x)*0.4,x:Math.min(80,Math.max(20,d.a-(e.clientY-d.y)*0.3))});}}
    onPointerUp={()=>{setTimeout(()=>drag.current=null);}}>
    <div className="stack" style={{width, height:H, transform:`rotateX(${angle.x}deg) rotateZ(${angle.z}deg) translateZ(${-3*gap}px)`}}>
      {FLOORS.map(f=>{
        const a = f.align;
        return <div key={f.floor} className={`plane ${f.floor===active?'active':''} ${routeFloors.has(f.floor)?'on-route':''}`}
          style={{left:a.x*width, top:a.y*H, width:a.w*width, height:a.h*H, transform:`translateZ(${(f.floor-1)*gap}px)`}}
          onClick={()=>{if(!drag.current?.moved)onOpen(f.floor);}}>
          <img src={asset(f.image)} alt="" draggable={false}/>
          <Overlay floor={f} legs={legs} marks={marks} labels={false}/>
          <span className="plane-label">{f.floor} этаж</span>
        </div>;
      })}
      {stairRef && <div className="stair-shaft" style={{left:stairRef.x*width, top:stairRef.y*H, height:(hi-lo)*gap, transform:`translateZ(${(lo-1)*gap}px) rotateX(-90deg)`}}/>}
    </div>
    <p className="stack-hint">Потяни, чтобы повернуть. Нажми на этаж, чтобы открыть план.</p>
  </div>;
}

function PointChip({label, point, onClear}:{label:string; point:Point|null; onClear:()=>void}) {
  return <div className={`point-chip ${point?'':'empty'}`}><small>{label}</small><span>{point ? `${point.name} · ${point.floor} эт.` : 'не выбрано'}</span>{point && <button aria-label={`Очистить: ${label}`} onClick={onClear}><X size={14}/></button>}</div>;
}

export function CampusMap({target, fromHint, children}:{target:string|null; fromHint:string|null; children?:ReactNode}) {
  const [floor, setFloor] = useState(6), [mode, setMode] = useState<'2d'|'3d'>('2d');
  const [query, setQuery] = useState(''), [selected, setSelected] = useState<string|null>(null);
  const [fromKey, setFrom] = useState<string|null>(null), [toKey, setTo] = useState<string|null>(null), [special, setSpecial] = useState<Route|null>(null);
  const results = useMemo(() => search(query) as Point[], [query]);
  const r = useMemo(() => special ?? (fromKey && toKey ? route(fromKey, toKey) as Route|null : null), [fromKey, toKey, special]);
  const sel = selected ? pointByKey(selected) as Point : null;
  const from = fromKey ? pointByKey(fromKey) as Point : null, to = toKey ? pointByKey(toKey) as Point : null;
  const [focus, setFocus] = useState<{x:number; y:number}|null>(null);

  function show(key:string) { const p = pointByKey(key) as Point; setSelected(key); setFloor(p.floor); setFocus({x:p.x, y:p.y}); }
  // Opened from a lesson: select its room and, if the previous class is known, route from there.
  useEffect(() => {
    if (!target) return;
    show(target); setSpecial(null);
    if (fromHint && fromHint!==target) { setFrom(fromHint); setTo(target); } else setTo(target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, fromHint]);
  useEffect(() => { if (r) { const leg = r.legs[0]; setFloor(leg.floor); const p = leg.points[Math.floor(leg.points.length/2)]; setFocus({x:p[0], y:p[1]}); } }, [r]);

  const marks = [
    ...(from ? [{p:from, tone:'from'}] : []), ...(to ? [{p:to, tone:'to'}] : []),
    ...(sel && sel.key!==fromKey && sel.key!==toKey ? [{p:sel, tone:'selected'}] : []), ...(special ? [{p:special.to, tone:'to'}] : []),
  ];
  const legs = r?.legs ?? [];
  const current = floorOf(floor)!;
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
      <div className="floor-switch" role="group" aria-label="Этаж">{FLOORS.map(f=><button key={f.floor} aria-pressed={mode==='2d'&&floor===f.floor} className={legs.some(l=>l.floor===f.floor)?'has-route':''} onClick={()=>{setFloor(f.floor);setMode('2d');setFocus(null);}}>{f.floor}</button>)}</div>
      <button className={`mode-button ${mode==='3d'?'on':''}`} onClick={()=>setMode(mode==='3d'?'2d':'3d')} aria-pressed={mode==='3d'}>{mode==='3d'?<Layers size={15}/>:<Box size={15}/>}{mode==='3d'?'План':'3D'}</button>
    </div>

    {mode==='2d' ? <FloorView floor={current} legs={legs} marks={marks} focus={focus} onPick={show}/>
      : <Stack active={floor} legs={legs} marks={marks} stair={r?.stair ?? null} onOpen={f=>{setFloor(f);setMode('2d');setFocus(null);}}/>}

    {sel && sel.key!==fromKey && sel.key!==toKey && <div className="map-card">
      <div><small>{kindLabel[sel.kind]} · {sel.floor} этаж · {sel.x<0.5?'северная':'южная'} часть</small><strong>{sel.name}</strong>{sel.note && <p>{sel.note}</p>}</div>
      <div className="map-card-actions">
        <button className="small-primary" onClick={()=>{setSpecial(null);setTo(sel.key);setSelected(null);}}>Сюда</button>
        <button className="text-button" onClick={()=>{setSpecial(null);setFrom(sel.key);setSelected(null);}}>Отсюда</button>
        <button className="icon-button" aria-label="Закрыть" onClick={()=>setSelected(null)}><X size={16}/></button>
      </div>
    </div>}

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
      <button disabled={!(selected||fromKey||toKey)} onClick={()=>quick('wc')}><LocateFixed size={14}/>Ближайший туалет</button>
      <button disabled={!(selected||fromKey||toKey)} onClick={()=>quick('food')}><Utensils size={14}/>Где поесть</button>
    </div>
    <p className="map-credit">План этажей — памятка первокурсника ВМК. Этажи 3–4 не показаны: по лестницам идёшь насквозь.</p>
  </div>;
}
