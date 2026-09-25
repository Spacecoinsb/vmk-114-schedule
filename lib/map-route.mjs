// Campus navigation: corridor graphs per floor, stairwells between floors, room search.
import data from './map-data.json' with {type:'json'};

export const FLOORS = data.floors;
export const floorOf = n => FLOORS.find(f => f.floor === n);
// Coordinates are floor-6 plan units (~2000 wide); every floor is aligned to it through the stairwells.
const MIDDLE = 980;
export const WING = x => x < MIDDLE ? 'Север' : 'Юг';
const wingText = x => x < MIDDLE ? 'северное крыло' : 'южное крыло';
// Lecture halls span two floors; this is the entrance normally used.
const HALL_FLOOR = {'П-8':2, 'П-8А':2, 'П-9':2, 'П-12':2};

export const normalizeRoom = value => String(value).trim().toUpperCase()
  .replace(/^(АУД\.?|К\.)\s*/,'').replace(/\s+/g,'').replace(/[–—]/g,'-').replace(/^П(\d)/,'П-$1').replace(/^МЗ(\d)/,'МЗ-$1').replace(/^(\d+)-([А-Я])$/,'$1$2');

// Every searchable point: rooms, places (toilets, food…) and stairwells.
export const POINTS = FLOORS.flatMap(f => [
  ...f.rooms.map(r => ({key:`${f.floor}:${r.id}`, floor:f.floor, id:r.id, kind:'room', name:/^(П|МЗ)-/.test(r.id) ? r.id : `Аудитория ${r.id}`, x:r.x, y:r.y, box:r.box, note:r.note})),
  ...f.places.map(p => ({key:`${f.floor}:${p.id}`, floor:f.floor, id:p.id, kind:p.kind, name:p.name, x:p.x, y:p.y, box:p.box, note:p.note})),
]);
export const pointByKey = key => POINTS.find(p => p.key === key);

export function findRoom(room) {
  const id = normalizeRoom(room);
  const matches = POINTS.filter(p => p.kind === 'room' && normalizeRoom(p.id) === id);
  if (matches.length < 2) return matches[0] || null;
  const preferred = HALL_FLOOR[id] || 1;
  return matches.find(p => p.floor === preferred) || matches[0];
}

export function search(query, limit = 8) {
  const q = query.trim().toLowerCase().replace(/ё/g,'е');
  if (!q) return [];
  const id = normalizeRoom(query).toLowerCase();
  const scored = POINTS.map(p => {
    const name = p.name.toLowerCase().replace(/ё/g,'е'), pid = normalizeRoom(p.id).toLowerCase();
    const score = pid === id ? 0 : pid.startsWith(id) ? 1 : name.startsWith(q) ? 2 : name.includes(q) || (p.note||'').toLowerCase().includes(q) ? 3 : 9;
    return {p, score};
  }).filter(s => s.score < 9);
  return scored.sort((a,b) => a.score-b.score || a.p.id.length-b.p.id.length || a.p.id.localeCompare(b.p.id,'ru',{numeric:true})).slice(0,limit).map(s => s.p);
}

// --- graph ---------------------------------------------------------------------------------
const graphs = new Map();
function graph(floorNo) {
  if (graphs.has(floorNo)) return graphs.get(floorNo);
  const f = floorOf(floorNo), k = 1;
  const nodes = [], edges = new Map();
  const add = (x, y) => { const found = nodes.findIndex(n => Math.hypot((n.x-x)*k, n.y-y) < 0.2); if (found >= 0) return found; nodes.push({x, y}); return nodes.length-1; };
  const link = (a, b) => { if (a === b) return; const d = Math.hypot((nodes[a].x-nodes[b].x)*k, nodes[a].y-nodes[b].y);
    (edges.get(a) || edges.set(a, []).get(a)).push([b, d]); (edges.get(b) || edges.set(b, []).get(b)).push([a, d]); };
  const segments = f.corridors.flatMap((line, l) => line.slice(1).map((p, i) => [line[i], p, l]));
  const project = (x, y, skipLine = -1) => {
    let best = null;
    for (const [s, [a, b, l]] of segments.entries()) {
      if (l === skipLine) continue;
      const dx = (b[0]-a[0])*k, dy = b[1]-a[1], len = dx*dx+dy*dy;
      const t = len ? Math.max(0, Math.min(1, (((x-a[0])*k)*dx + (y-a[1])*dy) / len)) : 0;
      const px = a[0] + (b[0]-a[0])*t, py = a[1] + (b[1]-a[1])*t, d = Math.hypot((x-px)*k, y-py);
      if (!best || d < best.d) best = {s, t, x:px, y:py, d};
    }
    return best;
  };
  // Points to attach: every POI, every stair and every corridor end (so junctions connect).
  const anchors = [...f.rooms.map(r => ({key:`${floorNo}:${r.id}`, ...r})), ...f.places.map(p => ({key:`${floorNo}:${p.id}`, ...p})),
    ...f.stairs.map(s => ({key:`stair:${s.id}`, ...s})), ...f.corridors.flatMap((line, l) => line.map(([x, y]) => ({key:null, line:l, x, y})))];
  const onSegment = segments.map(() => []), anchorNode = new Map();
  for (const a of anchors) {
    // A corridor end joins another corridor only when it actually touches it.
    const p = project(a.x, a.y, a.key ? -1 : a.line);
    if (!p || (!a.key && p.d > 12)) continue;
    onSegment[p.s].push(p);
    const node = add(a.x, a.y);
    if (a.key) anchorNode.set(a.key, node);
    p.from = node;
  }
  for (const [s, [a, b]] of segments.entries()) {
    const chain = [{t:0, x:a[0], y:a[1]}, ...onSegment[s], {t:1, x:b[0], y:b[1]}].sort((p, q) => p.t-q.t);
    let prev = add(chain[0].x, chain[0].y);
    for (const p of chain.slice(1)) {
      const node = add(p.x, p.y); link(prev, node); prev = node;
      if (p.from !== undefined) link(p.from, node);
    }
  }
  const g = {nodes, edges, anchorNode};
  graphs.set(floorNo, g);
  return g;
}

function shortest(floorNo, fromKey, toKey) {
  const {nodes, edges, anchorNode} = graph(floorNo);
  const start = anchorNode.get(fromKey), goal = anchorNode.get(toKey);
  if (start === undefined || goal === undefined) return null;
  const dist = new Map([[start, 0]]), prev = new Map(), done = new Set();
  while (true) {
    let u = -1, best = Infinity;
    for (const [n, d] of dist) if (!done.has(n) && d < best) { best = d; u = n; }
    if (u < 0) return null;
    if (u === goal) break;
    done.add(u);
    for (const [v, w] of edges.get(u) || []) if (best + w < (dist.get(v) ?? Infinity)) { dist.set(v, best + w); prev.set(v, u); }
  }
  const path = [goal];
  while (path[0] !== start) path.unshift(prev.get(path[0]));
  return {length:dist.get(goal), points:path.map(n => [nodes[n].x, nodes[n].y])};
}

// One climbed floor costs roughly as much as a short corridor walk.
const FLOOR_COST = 110;
const floorWord = n => `${n} этаж`;

export function route(fromKey, toKey) {
  const from = pointByKey(fromKey), to = pointByKey(toKey);
  if (!from || !to || fromKey === toKey) return null;
  if (from.floor === to.floor) {
    const p = shortest(from.floor, fromKey, toKey);
    return p && {from, to, length:p.length, legs:[{floor:from.floor, points:p.points}], stair:null, steps:describe(from, to, null)};
  }
  let best = null;
  for (const s of floorOf(from.floor).stairs) {
    const a = shortest(from.floor, fromKey, `stair:${s.id}`), b = shortest(to.floor, `stair:${s.id}`, toKey);
    if (!a || !b) continue;
    const length = a.length + b.length + Math.abs(to.floor-from.floor)*FLOOR_COST;
    if (!best || length < best.length) best = {from, to, length, stair:s.id, legs:[{floor:from.floor, points:a.points}, {floor:to.floor, points:b.points}]};
  }
  if (best) best.steps = describe(from, to, best.stair);
  return best;
}

function describe(from, to, stair) {
  const place = p => p.kind !== 'room' ? p.name.toLowerCase() : /^(П|МЗ)-/.test(p.id) ? p.id : `аудитории ${p.id}`;
  const start = p => p.kind !== 'room' || /^(П|МЗ)-/.test(p.id) ? p.name : `аудитория ${p.id}`;
  const steps = [`Старт: ${start(from)}, ${floorWord(from.floor)}, ${wingText(from.x)}`];
  if (stair) {
    steps.push(`Иди по коридору к лестнице ${stair}`);
    steps.push(`${to.floor > from.floor ? 'Поднимись' : 'Спустись'} по лестнице ${stair} на ${floorWord(to.floor)}`);
  }
  steps.push(`${to.kind === 'room' ? 'Дойди до' : 'Иди к'} ${place(to)}${to.note ? ` — ${to.note}` : ''}`);
  return steps;
}

// Nearest place of a kind ("wc", "food") from a point, over all floors.
export function nearest(fromKey, kind) {
  let best = null;
  for (const p of POINTS.filter(p => p.kind === kind)) {
    const r = route(fromKey, p.key);
    if (r && (!best || r.length < best.length)) best = r;
  }
  return best;
}
