import {cleanTitle,isDisplayedLesson,teacherRows} from './schedule-model.mjs';

const dayNames=['вс','пн','вт','ср','чт','пт','сб'];
const minutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
const duration=value=>value>=60?`${Math.floor(value/60)} ч${value%60?` ${value%60} мин`:''}`:`${value} мин`;
const plusDays=(date,offset)=>new Date(Date.parse(date+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
const weekday=date=>(new Date(date+'T12:00:00Z').getUTCDay()+6)%7;
const active=(lesson,date)=>!lesson.rule||(!lesson.rule.from||date>=lesson.rule.from)&&(!lesson.rule.dates||lesson.rule.dates.includes(date));

export function lessonsOn(schedule,date){
  return schedule.lessons.filter(lesson=>isDisplayedLesson(lesson)&&lesson.day===weekday(date)&&active(lesson,date)).sort((a,b)=>a.start.localeCompare(b.start));
}

export function roomFor(lesson,subgroups={}){
  if(lesson.room)return lesson.room;
  const rows=teacherRows(lesson.detail);
  const chosen=subgroups[cleanTitle(lesson)];
  if(chosen){
    const match=rows.find(row=>row.teacher===chosen);
    // Avoid guessing a room if the saved subgroup is no longer in the PDF.
    return match?.room||'';
  }
  return rows.length===1?rows[0].room:'';
}

function upcoming(lesson,subgroups){
  const room=roomFor(lesson,subgroups);
  return `${cleanTitle(lesson)} · ${lesson.start}${room?` · ауд. ${room}`:''}`;
}

export function dayGlance(schedule,date,now,subgroups={}){
  if(date<`${schedule.year}-09-01`||date>`${schedule.year+1}-01-31`)return null;
  const today=lessonsOn(schedule,date),clock=minutes(now);
  const last=today.at(-1);
  const end=last?` · свободен в ${last.end}`:'';
  const firstFuture=today.find(lesson=>minutes(lesson.start)>clock);
  const current=today.find(lesson=>minutes(lesson.start)<=clock&&clock<minutes(lesson.end));
  if(current){
    const next=today.find(lesson=>minutes(lesson.start)>=minutes(current.end));
    return {kind:'now',title:`До конца ${duration(minutes(current.end)-clock)}`,detail:next?`Дальше: ${upcoming(next,subgroups)}${end}`:`Последняя пара сегодня, конец в ${current.end}`};
  }
  if(firstFuture){
    const beforeFirst=firstFuture===today[0];
    return {kind:beforeFirst?'before':'break',title:beforeFirst?`До первой пары ${duration(minutes(firstFuture.start)-clock)}`:`Окно ${duration(minutes(firstFuture.start)-clock)}`,detail:`Дальше: ${upcoming(firstFuture,subgroups)}${end}`};
  }
  for(let offset=1;offset<=14;offset++){
    const nextDate=plusDays(date,offset);
    if(nextDate>`${schedule.year+1}-01-31`)break;
    const first=lessonsOn(schedule,nextDate)[0];
    if(first){
      const name=offset===1?'Завтра':`${dayNames[new Date(nextDate+'T12:00:00Z').getUTCDay()]}, ${new Date(nextDate+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'numeric',month:'short',timeZone:'UTC'})}`;
      return {kind:'done',title:today.length?'На сегодня всё':'Сегодня пар нет',detail:`${name}: ${upcoming(first,subgroups)}`};
    }
  }
  return {kind:'done',title:today.length?'На сегодня всё':'Сегодня пар нет',detail:''};
}
