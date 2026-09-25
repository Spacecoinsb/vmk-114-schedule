import {useEffect,useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './ui/dialog';
import {cleanTitle,teacherRows} from '../lib/schedule-model.mjs';

// Group 114 keeps its original key so earlier choices survive.
const keyFor=(group:string)=>group==='114'?'vmk114-subgroups-v1':`vmk-subgroups-${group}`;
type Selection=Record<string,string>;
function load(storageKey:string):Selection {
  try {
    const value=JSON.parse(localStorage.getItem(storageKey)||'{}');
    return value && typeof value==='object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([key,name])=>key.length<200 && typeof name==='string' && name.length<200)) as Selection : {};
  } catch {return {};}
}

export function useSubgroups(lessons:{title:string;detail:string}[],group:string) {
  const storageKey=keyFor(group);
  const [selected,setSelected]=useState<Selection>(()=>load(storageKey));
  useEffect(()=>setSelected(load(storageKey)),[storageKey]);
  const [draft,setDraft]=useState<Selection>({});
  const [open,setOpen]=useState(false),[error,setError]=useState('');
  const subjects=new Map<string,Set<string>>();
  for(const lesson of lessons){
    const rows=teacherRows(lesson.detail) as {teacher:string}[];
    if(rows.length<2)continue;
    const title=cleanTitle(lesson) as string;
    const names=subjects.get(title)||new Set<string>();
    rows.forEach(row=>names.add(row.teacher));subjects.set(title,names);
  }
  function save(){
    try{localStorage.setItem(storageKey,JSON.stringify(draft));setSelected(draft);setOpen(false);setError('');}
    catch{setError('Не удалось сохранить выбор на устройстве. Попробуй ещё раз.');}
  }
  const button=<button onClick={()=>{setDraft({...selected});setError('');setOpen(true);}}>Моя подгруппа</button>;
  const dialog=<Dialog open={open} onOpenChange={setOpen}><DialogContent className="changes-dialog"><DialogTitle>Моя подгруппа</DialogTitle><DialogDescription>Выбери преподавателей — в расписании останутся только твои аудитории. Выбор сохраняется на этом устройстве.</DialogDescription>
    {[...subjects].map(([subject,names],index)=><div className="subgroup-field" key={subject}><label htmlFor={`subgroup-${index}`}>{subject}</label><select id={`subgroup-${index}`} value={draft[subject]||''} onChange={event=>setDraft({...draft,[subject]:event.target.value})}><option value="">Все подгруппы</option>{draft[subject]&&!names.has(draft[subject])&&<option value={draft[subject]}>{draft[subject]} — больше нет в PDF</option>}{[...names].map(name=><option value={name} key={name}>{name}</option>)}</select></div>)}
    {!subjects.size&&<p>В текущем расписании нет занятий с несколькими подгруппами.</p>}
    <p className="personal-hint">Общие лекции остаются. Если выбранного преподавателя нет в новом PDF, покажем все варианты и предупредим.</p>
    {error&&<p role="alert">{error}</p>}<button className="save-task" onClick={save}>Сохранить выбор</button>
  </DialogContent></Dialog>;
  return {selected,button,dialog};
}
