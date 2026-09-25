import {useEffect,useState} from 'react';
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

type Task={id:string;date:string;subject:string;text:string;done:boolean};
const key='vmk114-homework-v1';
function load():Task[]{try{const data=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(data)?data.filter(t=>t&&typeof t.id==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(t.date)&&typeof t.subject==='string'&&typeof t.text==='string'&&typeof t.done==='boolean'):[];}catch{return [];}}
export function useHomework(){
  const [tasks,setTasks]=useState<Task[]>(load),[editing,setEditing]=useState<Task|null>(null),[listOpen,setListOpen]=useState(false),[error,setError]=useState('');
  function save(next:Task[]){try{localStorage.setItem(key,JSON.stringify(next));setTasks(next);setError('');return true;}catch{setError('Не удалось сохранить задание. Освободи место на устройстве и попробуй ещё раз.');return false;}}
  function open(date:string,id:string,subject:string){setError('');setEditing(tasks.find(t=>t.id===date+':'+id)||{id:date+':'+id,date,subject,text:'',done:false});}
  const pending=tasks.filter(t=>!t.done).length;
  const dialogs=<>
    <Dialog open={listOpen} onOpenChange={setListOpen}><DialogContent className="changes-dialog"><DialogTitle>Задания{pending?` · ${pending}`:''}</DialogTitle><DialogDescription>Все записи хранятся только на этом устройстве и доступны без сети.</DialogDescription>{tasks.length?[...tasks].sort((a,b)=>Number(a.done)-Number(b.done)||a.date.localeCompare(b.date)).map(task=><div className="task-list-row" key={task.id}><button className={'task-check '+(task.done?'done':'')} aria-label={task.done?'Отметить невыполненным':'Отметить выполненным'} onClick={()=>save(tasks.map(t=>t.id===task.id?{...t,done:!t.done}:t))}>{task.done&&<Check size={14}/>}</button><button className="task-open" onClick={()=>{setListOpen(false);setEditing(task);setError('');}}><small>{new Date(task.date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'})} · {task.subject}</small><span className={task.done?'task-done':''}>{task.text}</span></button></div>):<p className="personal-hint">Нажми на значок блокнота в карточке пары, чтобы записать домашнее задание или вопрос преподавателю.</p>}{error&&<p role="alert">{error}</p>}</DialogContent></Dialog>
    <Dialog open={!!editing} onOpenChange={open=>{if(!open)setEditing(null);}}><DialogContent><DialogTitle>К этой паре</DialogTitle><DialogDescription>{editing?.subject} · {editing&&new Date(editing.date+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}</DialogDescription>{editing&&<form onSubmit={event=>{event.preventDefault();const other=tasks.filter(t=>t.id!==editing.id);if(save(editing.text.trim()?[...other,{...editing,text:editing.text.trim()}]:other))setEditing(null);}}><label className="task-label" htmlFor="homework-text">Домашнее задание или заметка</label><textarea id="homework-text" rows={5} maxLength={4000} value={editing.text} onChange={event=>setEditing({...editing,text:event.target.value})} placeholder="Что подготовить к занятию…"/><label className="task-toggle"><input type="checkbox" checked={editing.done} onChange={event=>setEditing({...editing,done:event.target.checked})}/>Выполнено</label><p className="personal-hint">Запись относится только к этой дате. Пустой текст удаляет запись.</p>{error&&<p role="alert">{error}</p>}<button className="save-task" type="submit">Сохранить</button></form>}</DialogContent></Dialog>
  </>;
  return {tasks,open,dialogs,listButton:<button onClick={()=>{setError('');setListOpen(true);}}>Задания{pending?` · ${pending}`:''}</button>};
}
export function HomeworkButton({text,done,onClick}:{text?:string;done?:boolean;onClick:()=>void}){
  return <button className={'homework-button '+(text?'has-task':'')} title={text?'Открыть задание':'Добавить задание'} aria-label={text?'Открыть задание':'Добавить задание'} onClick={onClick}>{done?<Check size={14}/>:<NotebookPen size={14}/>}<span>{text?(done?'Готово':'Есть задание'):''}</span></button>;
}
