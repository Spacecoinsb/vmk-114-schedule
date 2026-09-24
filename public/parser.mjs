// Local, deterministic extraction: the column is selected by actual PDF cell borders.
export const DAYS = ['понедельник','вторник','среда','четверг','пятница','суббота'];
const clean = s => s.replace(/\s+/g,' ').replace(/\s+([,.])/g,'$1').trim();
const transformPoint = (m,x,y) => [m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
const multiply = (a,b) => [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];

function borders(op,OPS,height) {
  let matrix=[1,0,0,1,0,0],stack=[],path=[],segments=[];
  const paint=new Set([OPS.stroke,OPS.closeStroke,OPS.fillStroke,OPS.eoFillStroke,OPS.closeFillStroke,OPS.closeEOFillStroke,OPS.fill,OPS.eoFill]);
  const segment=(x,y,u,v)=>{const a=transformPoint(matrix,x,y),b=transformPoint(matrix,u,v);path.push({x0:Math.min(a[0],b[0]),x1:Math.max(a[0],b[0]),y0:height-Math.max(a[1],b[1]),y1:height-Math.min(a[1],b[1])});};
  for(let k=0;k<op.fnArray.length;k++) {
    const fn=op.fnArray[k],args=op.argsArray[k];
    if(fn===OPS.save)stack.push([...matrix]);
    else if(fn===OPS.restore)matrix=stack.pop()||[1,0,0,1,0,0];
    else if(fn===OPS.transform)matrix=multiply(matrix,args);
    else if(fn===OPS.constructPath) {
      const [commands,coords]=args;let p=0,x=0,y=0,sx=0,sy=0;
      for(const c of commands) {
        if(c===OPS.moveTo){x=sx=coords[p++];y=sy=coords[p++];}
        else if(c===OPS.lineTo){const u=coords[p++],v=coords[p++];segment(x,y,u,v);x=u;y=v;}
        else if(c===OPS.rectangle){const u=coords[p++],v=coords[p++],w=coords[p++],h=coords[p++];segment(u,v,u+w,v);segment(u+w,v,u+w,v+h);segment(u+w,v+h,u,v+h);segment(u,v+h,u,v);}
        else if(c===OPS.closePath){segment(x,y,sx,sy);x=sx;y=sy;}
        else if(c===OPS.curveTo){p+=6;x=coords[p-2];y=coords[p-1];}
        else if(c===OPS.curveTo2||c===OPS.curveTo3){p+=4;x=coords[p-2];y=coords[p-1];}
      }
    }else if(paint.has(fn)){segments.push(...path);path=[];}
    else if(fn===OPS.endPath)path=[];
  }
  return {horizontal:segments.filter(s=>s.y1-s.y0<1.5&&s.x1-s.x0>20),vertical:segments.filter(s=>s.x1-s.x0<1.5&&s.y1-s.y0>5)};
}
function linesOf(items) {
  const lines=[];
  for(const item of [...items].sort((a,b)=>a.y-b.y||a.x-b.x)) {
    let line=lines.find(l=>Math.abs(l.y-item.y)<3);
    if(!line){line={y:item.y,items:[]};lines.push(line);}line.items.push(item);
  }
  return lines.map(l=>({...l,text:clean(l.items.sort((a,b)=>a.x-b.x).map(i=>i.str).join(' '))}));
}
function dateRule(title,year) {
  const explicit=title.match(/((?:\d{1,2}[.,]?\s*,\s*)+\d{1,2})\s*\.\s*(\d{2})/);
  if(explicit){const month=explicit[2];return {dates:explicit[1].match(/\d+/g).map(d=>`${year}-${month}-${d.padStart(2,'0')}`)};}
  const since=title.match(/\bс\s+(\d{1,2})\.(\d{2})/i) || title.match(/с\s+(\d{1,2})\.(\d{2})/i);
  if(since)return {from:`${year}-${since[2]}-${since[1].padStart(2,'0')}`};
  if(/с октября/i.test(title))return {from:`${year}-10-01`};
  return null;
}
export async function parseSchedule(pdfjs,data) {
  const task=pdfjs.getDocument({data:new Uint8Array(data),isEvalSupported:false,useSystemFonts:true});
  const doc=await task.promise;
  try {
    for(let pageNo=1;pageNo<=doc.numPages;pageNo++) {
      const page=await doc.getPage(pageNo),content=await page.getTextContent();
      if(!content.items.some(i=>i.str?.trim()==='114'))continue;
      const height=page.view[3],items=content.items.filter(i=>i.str?.trim()).map(i=>({str:i.str,x:i.transform[4],y:height-i.transform[5],width:i.width}));
      const headers=items.filter(i=>DAYS.includes(i.str.trim().toLowerCase())).sort((a,b)=>a.y-b.y);
      if(headers.length!==6)throw Error('В PDF изменилась структура дней. Сохранённое расписание оставлено.');
      const year=Number(items.map(i=>i.str).join(' ').match(/(20\d{2})\s*\/\s*20\d{2}/)?.[1]);
      if(!year)throw Error('Не удалось определить учебный год PDF.');
      const {horizontal,vertical}=borders(await page.getOperatorList(),pdfjs.OPS,height);
      const lessons=[];
      for(let day=0;day<6;day++) {
        const head=headers[day],bottom=headers[day+1]?.y??height;
        const group=items.find(i=>i.str.trim()==='114'&&Math.abs(i.y-head.y)<6);
        const first=items.filter(i=>/^1\d\d$/.test(i.str.trim())&&Math.abs(i.y-head.y)<6).sort((a,b)=>a.x-b.x)[0];
        if(!group||!first)throw Error('Не найдена колонка 114.');
        const gx=group.x+group.width/2;
        const contentLeft=Math.max(...vertical.filter(v=>v.x0<first.x&&v.y0<head.y&&v.y1>head.y).map(v=>v.x0));
        if(!Number.isFinite(contentLeft))throw Error('Не найдена граница таблицы.');
        const times=linesOf(items.filter(i=>i.x<contentLeft-2&&i.y>head.y+5&&i.y<bottom-8));
        let validTimes=0;
        for(const t of times){
          const match=t.text.match(/(\d{1,2})[.:](\d{2})\s*[–—-]\s*(\d{1,2})[.:](\d{2})/);
          if(!match)continue;
          validTimes++;
          const crosses=horizontal.filter(h=>h.x0<gx&&h.x1>gx);
          const top=Math.max(...crosses.filter(h=>h.y0<t.y-2).map(h=>h.y0));
          const end=Math.min(...crosses.filter(h=>h.y0>t.y+1).map(h=>h.y0));
          if(!Number.isFinite(top)||!Number.isFinite(end)||end-top>180)throw Error('Не удалось прочитать строки PDF.');
          const mid=(top+end)/2;
          const vs=vertical.filter(v=>v.y0<mid&&v.y1>mid);
          const left=Math.max(contentLeft,...vs.filter(v=>v.x0<gx).map(v=>v.x0));
          const right=Math.min(...vs.filter(v=>v.x0>gx).map(v=>v.x0));
          if(!Number.isFinite(right))throw Error('Не найдена правая граница ячейки.');
          const cell=linesOf(items.filter(i=>i.x+i.width/2>left+1&&i.x+i.width/2<right-1&&i.y>top+2&&i.y<end-1));
          if(!cell.length)continue;
          const raw=cell.map(l=>l.text).join('\n');
          const titleParts=[];let split=0;
          for(const l of cell){if(titleParts.length&&(/(?:[А-ЯЁ]\.\s*){2}/.test(l.text)||/^(доцент|профессор|академик)\s/i.test(l.text)))break;titleParts.push(l.text);split++;}
          let title=titleParts.join(' ').replace(/^\.?\s*/,'');
          // A full-width sports row repeats its time inside the cell.
          title=title.replace(/^\d{1,2}[.:]\d{2}\s*[–—-]\s*\d{1,2}[.:]\d{2}\s*/,'');
          const room=title.match(/\s+(П\s*[-–]\s*\d+)\s*$/i)?.[1]?.replace(/\s/g,'')||'';
          if(room)title=title.replace(/\s+П\s*[-–]\s*\d+\s*$/i,'');
          const detail=cell.slice(split).map(l=>l.text).join('\n');
          const type=/Конс\./i.test(title)?'consultation':/Физическая/.test(title)?'sport':room?'lecture':'class';
          lessons.push({id:`${day}-${match[1].padStart(2,'0')}:${match[2]}`,day,start:`${match[1].padStart(2,'0')}:${match[2]}`,end:`${match[3].padStart(2,'0')}:${match[4]}`,title,detail,room,type,rule:dateRule(title,year),raw});
        }
        if(validTimes<3||validTimes>8)throw Error('Не удалось проверить время занятий.');
      }
      if(lessons.length<12||lessons.length>40||new Set(lessons.map(x=>x.id)).size!==lessons.length)throw Error('Не удалось проверить полноту расписания.');
      return {group:114,year,page:pageNo,lessons};
    }
    throw Error('В PDF не найдена группа 114.');
  }finally{await doc.destroy();}
}
export function isActive(lesson,date){const day=date.slice(0,10);return !lesson.rule || ((!lesson.rule.from||day>=lesson.rule.from)&&(!lesson.rule.dates||lesson.rule.dates.includes(day)));}
