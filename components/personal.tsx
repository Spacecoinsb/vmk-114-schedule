import {useEffect,useRef,useState} from 'react';
import {Moon,Sun,NotebookPen,Check} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './ui/dialog';

export function ThemeButton() {
  const [dark,setDark]=useState(()=>document.documentElement.dataset.theme==='dark');
  useEffect(()=>{document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#0f1217':'#f6f7f9');},[dark]);
  useEffect(()=>{
    const media=matchMedia('(prefers-color-scheme: dark)');
    const follow=()=>{try{if(localStorage.getItem('vmk114-theme'))return;}catch{}document.documentElement.dataset.theme=media.matches?'dark':'light';setDark(media.matches);};
    follow();media.addEventListener('change',follow);return()=>media.removeEventListener('change',follow);
  },[]);
  function toggle(){const next=!dark;setDark(next);document.documentElement.dataset.theme=next?'dark':'light';try{localStorage.setItem('vmk114-theme',next?'dark':'light');}catch{}}
  return <button className="icon-button" aria-label={dark?'Светлая тема':'Тёмная тема'} title={dark?'Светлая тема':'Тёмная тема'} onClick={toggle}>{dark?<Sun size={17}/>:<Moon size={17}/>}</button>;
}

export type Task={id:string;date:string;subject:string;text:string;done:boolean};
const key='vmk114-homework-v1';
function load():Task[]{try{const data=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(data)?data.filter(t=>t&&typeof t.id==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(t.date)&&typeof t.subject==='string'&&typeof t.text==='string'&&typeof t.done==='boolean'):[];}catch{return [];}}
const shortDate=(date:string)=>new Date(date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'});

// Homework lives inside the lesson row; the list dialog only jumps to it.
export function useHomework(onPick:(date:string,lessonId:string)=>void){
  const [tasks,setTasks]=useState<Task[]>(load),[editing,setEditing]=useState(''),[listOpen,setListOpen]=useState(false),[error,setError]=useState('');
  function write(next:Task[]){try{localStorage.setItem(key,JSON.stringify(next));setTasks(next);setError('');return true;}catch{setError('Не удалось сохранить. Освободи место на устройстве.');return false;}}
  function save(task:Task){const other=tasks.filter(t=>t.id!==task.id);return write(task.text.trim()?[...other,{...task,text:task.text.trim()}]:other);}
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
