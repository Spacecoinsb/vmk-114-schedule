import {useEffect,useRef,useState} from 'react';
import {Palette,NotebookPen,Check} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './ui/dialog';

// name, label, scheme, swatch colours (background, lecture, now)
export const THEMES = [
  ['night','Ночь','dark',['#15130f','#e8b923','#ff6a48']], ['graphite','Графит','dark',['#111214','#b8f34a','#ff4f8b']],
  ['msu','МГУ','dark',['#140a0c','#d6aa4c','#8e1b2b']], ['winter','Зима','dark',['#0b1220','#6ea8ff','#ff6b9a']],
  ['autumn','Осень','dark',['#17100b','#ea7a36','#ff5e3a']], ['paper','Бумага','light',['#f3efe6','#f5c518','#ff5a36']],
  ['spring','Весна','light',['#f1f5ec','#6dbb5a','#ea4f8a']], ['summer','Лето','light',['#fff6e3','#ffae1f','#ff4e2e']],
] as const;
const themeKey='vmk114-theme';
// Older versions stored plain "light"/"dark".
const legacy=(value:string|null)=>value==='light'?'paper':value==='dark'?'night':value;
export function applyTheme(choice:string){
  const name=choice==='auto'?(matchMedia('(prefers-color-scheme: dark)').matches?'night':'paper'):choice;
  const theme=THEMES.find(t=>t[0]===name)||THEMES.find(t=>t[0]==='paper')!;
  document.documentElement.dataset.theme=theme[0];
  document.documentElement.dataset.scheme=theme[2];
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme[3][0]);
}
export function ThemeButton() {
  const [choice,setChoice]=useState(()=>{try{return legacy(localStorage.getItem(themeKey))||'auto';}catch{return 'auto';}});
  const [open,setOpen]=useState(false);
  useEffect(()=>{
    applyTheme(choice);
    if(choice!=='auto')return;
    const media=matchMedia('(prefers-color-scheme: dark)'),follow=()=>applyTheme('auto');
    media.addEventListener('change',follow);return()=>media.removeEventListener('change',follow);
  },[choice]);
  function pick(name:string){setChoice(name);try{localStorage.setItem(themeKey,name);}catch{}}
  return <>
    <button className="icon-button" aria-label="Тема оформления" title="Тема оформления" onClick={()=>setOpen(true)}><Palette size={18}/></button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="changes-dialog"><DialogTitle>Тема</DialogTitle><DialogDescription>Сохраняется на этом устройстве.</DialogDescription>
      <div className="theme-grid">
        <button aria-pressed={choice==='auto'} onClick={()=>pick('auto')}><span className="swatch auto"/>Как в системе</button>
        {THEMES.map(([name,label,,colors])=><button key={name} aria-pressed={choice===name} onClick={()=>pick(name)}>
          <span className="swatch" style={{background:colors[0]}}><i style={{background:colors[1]}}/><i style={{background:colors[2]}}/></span>{label}</button>)}
      </div>
    </DialogContent></Dialog>
  </>;
}

export type Task={id:string;date:string;subject:string;text:string;done:boolean;group?:string};
const key='vmk114-homework-v1';
function load():Task[]{try{const data=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(data)?data.filter(t=>t&&typeof t.id==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(t.date)&&typeof t.subject==='string'&&typeof t.text==='string'&&typeof t.done==='boolean'):[];}catch{return [];}}
const shortDate=(date:string)=>new Date(date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'});

// Homework lives inside the lesson row; the list dialog only jumps to it.
// Tasks without a group were written for 114 before group switching existed.
export function useHomework(group:string,onPick:(date:string,lessonId:string)=>void){
  const [all,setTasks]=useState<Task[]>(load);
  const tasks=all.filter(t=>(t.group||'114')===group);
  const [editing,setEditing]=useState(''),[listOpen,setListOpen]=useState(false),[error,setError]=useState('');
  function write(mine:Task[]){const next=[...all.filter(t=>(t.group||'114')!==group),...mine];try{localStorage.setItem(key,JSON.stringify(next));setTasks(next);setError('');return true;}catch{setError('Не удалось сохранить. Освободи место на устройстве.');return false;}}
  function save(task:Task){const other=tasks.filter(t=>t.id!==task.id);return write(task.text.trim()?[...other,{...task,group,text:task.text.trim()}]:other);}
  function toggle(id:string){write(tasks.map(t=>t.id===id?{...t,done:!t.done}:t));}
  const pending=tasks.filter(t=>!t.done).length;
  const dialogs=<Dialog open={listOpen} onOpenChange={setListOpen}><DialogContent className="changes-dialog"><DialogTitle>Задания{pending?` · ${pending}`:''}</DialogTitle><DialogDescription>Хранятся только на этом устройстве и доступны без сети.</DialogDescription>{tasks.length?[...tasks].sort((a,b)=>Number(a.done)-Number(b.done)||a.date.localeCompare(b.date)).map(task=><div className="task-list-row" key={task.id}><button className={'task-check '+(task.done?'done':'')} aria-label={task.done?'Отметить невыполненным':'Отметить выполненным'} onClick={()=>toggle(task.id)}>{task.done&&<Check size={14}/>}</button><button className="task-open" onClick={()=>{setListOpen(false);const lessonId=task.id.slice(11);onPick(task.date,lessonId);setEditing(task.id);}}><small>{shortDate(task.date)} · {task.subject}</small><span className={task.done?'task-done':''}>{task.text}</span></button></div>):<p className="personal-hint">Нажми «+ ДЗ» у пары, чтобы записать задание.</p>}{error&&<p role="alert">{error}</p>}</DialogContent></Dialog>;
  return {tasks,save,toggle,editing,setEditing,error,dialogs,listButton:<button onClick={()=>{setError('');setListOpen(true);}}>Задания{pending?` · ${pending}`:''}</button>};
}

export function HomeworkButton({task,onClick}:{task?:Task;onClick:()=>void}){
  return <button className={'homework-button '+(task?'has-task':'')} aria-label={task?'Открыть задание':'Добавить задание'} onClick={onClick}>{task?.done?<Check size={13}/>:task?<NotebookPen size={13}/>:null}<span>{task?(task.done?'Сделано':'ДЗ'):'+ ДЗ'}</span></button>;
}

export function HomeworkEditor({task,onSave,onToggle,onClose,error}:{task:Task;onSave:(t:Task)=>boolean;onToggle:()=>void;onClose:()=>void;error:string}){
  const [text,setText]=useState(task.text);
  const area=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{area.current?.focus();setTimeout(()=>area.current?.scrollIntoView({block:'center',behavior:'smooth'}),250);},[]);
  function done(){if(onSave({...task,text}))onClose();}
  return <div className="homework-editor">
    <textarea ref={area} aria-label="Домашнее задание" rows={3} maxLength={4000} value={text} onChange={e=>setText(e.target.value)} placeholder="Что задали…" onKeyDown={e=>{if(e.key==='Escape')onClose();}}/>
    {error&&<p role="alert" className="personal-hint">{error}</p>}
    <div className="homework-actions">
      {task.text&&<label className="task-toggle"><input type="checkbox" checked={task.done} onChange={onToggle}/>Сделано</label>}
      <span/>
      {task.text&&<button className="text-button danger" onClick={()=>{onSave({...task,text:''});onClose();}}>Удалить</button>}
      <button className="text-button" onClick={onClose}>Отмена</button>
      <button className="small-primary" onClick={done}>Сохранить</button>
    </div>
  </div>;
}
