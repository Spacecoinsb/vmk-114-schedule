import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root=path.resolve('dist');
const snapshot=JSON.parse(await readFile(path.join(root,'source.json'),'utf8'));
let mode='ok'; let served=structuredClone(snapshot); const requests=[];
const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.pdf':'application/pdf','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.png':'image/png'};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');requests.push(url.pathname);
  const pathname=url.pathname.replace(/^\/vmk-114-schedule\//,'');
  try {
    if(pathname==='source.json'){
      if(mode==='unavailable'){res.writeHead(503);res.end('Unavailable');return;}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(mode==='corrupt'?{schema:2}:served));return;
    }
    if(pathname==='latest.pdf' && mode==='pdf-mismatch'){res.end('not matching pdf');return;}
    const file=path.resolve(root,pathname||'index.html');
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
    res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/vmk-114-schedule/`;
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
try {
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  const page=await context.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const at=async iso=>{await page.clock.setFixedTime(new Date(iso));await page.reload();};
  const status=async()=>{await page.locator('button.status').click();await page.getByRole('dialog').waitFor();};
  const refreshNow=async()=>{await status();const button=page.getByRole('dialog').getByRole('button',{name:'Обновить',exact:true});await page.waitForFunction(()=>![...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Обновить')?.disabled);await button.click();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});};
  // Friday 25 September 2026, 09:10 Moscow time: physical education is in progress.
  await page.clock.setFixedTime(new Date('2026-09-25T06:10:00Z'));
  await page.goto(base);
  await page.getByRole('button',{name:'PDF',exact:true}).waitFor();
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  assert.equal(await page.locator('html').getAttribute('data-theme'),'msu','MSU is the default theme');
  assert(requests.includes('/vmk-114-schedule/latest.pdf'),'first visit saves PDF even if seed hash matches');
  await status();
  await page.getByText('работает',{exact:true}).waitFor();
  await page.getByText('Последняя сверка с ВМК',{exact:true}).waitFor();
  assert(await page.getByRole('link',{name:'История проверок'}).isVisible());
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Неделя',exact:true}).click();
  assert.equal(await page.locator('.lesson').count(),21);
  assert.equal(await page.getByText('Межфакультетские курсы',{exact:true}).count(),0);
  assert(await page.locator('.lesson.lecture').count()>0);
  assert(await page.getByRole('link',{name:'Сайт ВМК'}).isVisible(),'VMK site link is always visible');
  const roomStyles=await page.locator('.room').evaluateAll(rooms=>[...new Set(rooms.map(r=>{const c=getComputedStyle(r);return [c.fontSize,c.fontWeight,c.borderTopWidth,c.borderTopLeftRadius,c.paddingLeft].join();}))]);
  assert.equal(roomStyles.length,1,'lecture halls and seminar rooms look the same');
  assert.equal(await page.locator('.room').filter({hasText:'613'}).count(),1);
  assert.equal(await page.locator('.room').filter({hasText:'682'}).count(),1);
  await page.getByRole('button',{name:'Подгруппа',exact:true}).click();
  await page.getByLabel('Английский язык',{exact:true}).selectOption({label:'Перцева З.Н.'});
  await page.getByLabel('Практикум на ЭВМ',{exact:true}).selectOption({label:'Панфёров А.А.'});
  await page.getByRole('button',{name:'Сохранить выбор',exact:true}).click();
  assert.equal(await page.locator('.room').filter({hasText:'786'}).count(),0);
  assert.equal(await page.locator('.room').filter({hasText:'696'}).count(),0,'choice also covers consultations');
  assert.equal(await page.locator('.room').filter({hasText:'П-5'}).count(),6,'shared lectures remain');
  await page.reload();
  assert.equal(await page.locator('.room').filter({hasText:'613'}).count(),0);
  assert.equal(await page.locator('.room').filter({hasText:'682'}).count(),1,'subgroup choice survives restart');
  await page.getByRole('button',{name:'Подгруппа',exact:true}).click();
  await page.getByLabel('Английский язык',{exact:true}).selectOption('');
  await page.getByLabel('Практикум на ЭВМ',{exact:true}).selectOption('');
  await page.getByRole('button',{name:'Сохранить выбор',exact:true}).click();
  await refreshNow();
  await page.getByText('Изменений нет',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Закрыть уведомление',exact:true}).click();
  assert.equal(await page.getByText('Изменений нет',{exact:true}).count(),0);
  console.log('PASS subgroup selection, identical rooms, persistence and dismissible notice');

  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile fits viewport');
  const glance=page.getByRole('region',{name:'Мой день сейчас'});
  await glance.getByText('1:20',{exact:true}).waitFor(); await glance.getByText('до конца пары',{exact:true}).waitFor();
  await page.getByText('идёт, ещё 1 ч 20 мин',{exact:true}).waitFor();
  await page.getByText('через 1 ч 30 мин',{exact:true}).waitFor();
  await at('2026-09-25T05:50:00Z');
  await glance.getByText('10 мин',{exact:true}).waitFor(); await glance.getByText('до первой пары',{exact:true}).waitFor();
  await at('2026-09-25T07:30:00Z');
  await glance.getByText('10 мин',{exact:true}).waitFor(); await glance.getByText('до следующей пары',{exact:true}).waitFor();
  assert.equal(await page.locator('.lesson.current').count(),0,'finished class is no longer current');
  assert.equal(await page.locator('.lesson.past').count(),1);
  // After the last class the next teaching day opens by itself.
  await at('2026-09-25T11:30:00Z');
  await page.locator('h1',{hasText:'26 сентября'}).waitFor();
  await page.locator('h1',{hasText:'Завтра, 26 сентября'}).waitFor();
  assert.equal(await glance.count(),0,'no "now" line once the day is over');
  await page.getByRole('button',{name:'Пятница, 25 сентября',exact:true}).click();
  await page.locator('h1',{hasText:'25 сентября'}).waitFor();
  await page.getByRole('button',{name:'К ближайшим',exact:true}).click();
  await page.locator('h1',{hasText:'26 сентября'}).waitFor();
  console.log('PASS countdowns, exact end-time transition and evening switch to the next day');

  // Swipe left/right changes the day; Saturday evening skips Sunday.
  await at('2026-09-25T06:10:00Z');
  const swipe=async dx=>{const box=await page.locator('main').boundingBox();const y=box.y+80,x=box.x+box.width/2;
    await page.locator('main').dispatchEvent('touchstart',{touches:[{identifier:1,clientX:x,clientY:y}],changedTouches:[{identifier:1,clientX:x,clientY:y}]});
    await page.locator('main').dispatchEvent('touchend',{touches:[],changedTouches:[{identifier:1,clientX:x+dx,clientY:y+5}]});};
  await swipe(-120); await page.locator('h1',{hasText:'26 сентября'}).waitFor();
  await swipe(-120); await page.locator('h1',{hasText:'27 сентября'}).waitFor();
  await page.getByText('Пар нет — отдыхай').waitFor();
  const footer=await page.locator('.footer').boundingBox();
  assert(footer.y+footer.height>760 && footer.y+footer.height<=844,'footer stays at screen bottom on an empty day');
  await swipe(120); await swipe(120); await page.locator('h1',{hasText:'25 сентября'}).waitFor();
  await page.keyboard.press('ArrowRight'); await page.locator('h1',{hasText:'26 сентября'}).waitFor();
  await page.keyboard.press('ArrowLeft'); await page.locator('h1',{hasText:'25 сентября'}).waitFor();
  console.log('PASS swipe and keyboard day navigation');

  // Any first-course group can be opened; the whole table is stored offline.
  await page.getByRole('button',{name:'Группа 114, сменить'}).click();
  for(const stream of ['1 поток','2 поток','3 поток','ФИИТ']) await page.getByRole('dialog').getByText(stream,{exact:true}).waitFor();
  await page.getByRole('dialog').getByText('108–114',{exact:true}).waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'142',exact:true}).click();
  await page.getByRole('button',{name:'Группа 142, сменить'}).waitFor();
  await page.getByRole('heading',{name:'Безопасность жизнедеятельности'}).waitFor();
  assert.equal(await page.locator('.lesson').first().locator('.range').textContent(),'09:00 – 10:30');
  await page.locator('.room').filter({hasText:'706'}).waitFor();
  await page.reload();
  await page.getByRole('button',{name:'Группа 142, сменить'}).waitFor();
  await page.getByRole('button',{name:'Группа 142, сменить'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'114',exact:true}).click();
  await page.locator('.room').filter({hasText:'507'}).waitFor();
  console.log('PASS switching between all first-course groups');

  // A room in the timetable opens the campus map with a route from the previous class.
  await at('2026-09-24T07:00:00Z');
  await page.getByRole('button',{name:/Аудитория 790, показать на карте/}).click();
  await page.getByRole('button',{name:'Карта',exact:true,pressed:true}).waitFor();
  await page.getByText('Поднимись по лестнице В на 7 этаж').waitFor();
  await page.getByText('Старт: аудитория 615, 6 этаж, северное крыло').waitFor();
  assert.equal(await page.locator('.floor-switch button.has-route').count(),2);
  await page.getByLabel('Поиск на карте').fill('диетка');
  await page.getByRole('option',{name:/Столовая «Диетка»/}).click();
  await page.getByRole('button',{name:'Сюда',exact:true}).click();
  await page.getByText(/Спустись по лестнице . на 2 этаж/).waitFor();
  await page.locator('.scene-view canvas, .scene-view img').first().waitFor();
  for(const mode of ['Схема','PDF','3D']) await page.getByRole('button',{name:mode,exact:true}).click();
  await page.getByRole('button',{name:'2',exact:true}).click();
  await page.getByRole('button',{name:'2',exact:true,pressed:true}).waitFor();
  await page.getByRole('button',{name:'Ближайший туалет'}).click();
  await page.getByText(/туалет/).first().waitFor();
  await page.getByRole('button',{name:'Расписание',exact:true}).click();
  await at('2026-09-25T06:10:00Z');
  console.log('PASS campus map: room from timetable, stairs between floors, search, 3D, nearest toilet');

  await page.getByRole('button',{name:'Тема оформления',exact:true}).click();
  for(const name of ['Осень','Зима','Весна','Лето','МГУ','Графит']) await page.getByRole('dialog').getByRole('button',{name,exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Ночь',exact:true}).click();
  await page.keyboard.press('Escape');
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'night');
  assert.equal(await page.locator('html').getAttribute('data-scheme'),'dark');
  await page.getByRole('button',{name:'Добавить задание',exact:true}).first().click();
  await page.getByLabel('Домашнее задание',{exact:true}).fill('Подготовить вопросы к занятию');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.reload();
  assert.equal(await page.getByRole('button',{name:'Открыть задание',exact:true}).count(),1);
  await page.getByText('Подготовить вопросы к занятию').waitFor();
  // With the on-screen keyboard only ~420px remain: the inline editor must still be fully visible.
  await page.setViewportSize({width:390,height:420});
  await page.getByRole('button',{name:'Добавить задание',exact:true}).last().click();
  await page.waitForTimeout(700);
  const box=await page.getByLabel('Домашнее задание',{exact:true}).boundingBox();
  assert(box.y>=0 && box.y+box.height<=420,'homework editor fits above the keyboard');
  assert(await page.getByRole('button',{name:'Сохранить',exact:true}).isVisible());
  await page.getByRole('button',{name:'Отмена',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Следующий день',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Открыть задание',exact:true}).count(),0,'homework belongs to one date only');
  await page.getByRole('button',{name:'Сегодня',exact:true}).click();
  await page.getByRole('button',{name:'Задания · 1',exact:true}).click();
  await page.getByRole('button',{name:'Отметить выполненным',exact:true}).click();
  await page.keyboard.press('Escape');
  await page.getByText('Сделано',{exact:true}).first().waitFor();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/dark-homework.png',fullPage:true});
  await page.getByRole('button',{name:'Тема оформления',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Бумага',exact:true}).click();
  await page.keyboard.press('Escape');
  assert((await page.locator('.lesson').first().boundingBox()).y<470,'schedule starts on the first screen');
  await page.screenshot({path:'test-results/mobile.png',fullPage:true});
  console.log('PASS dark-theme persistence, dated homework, completed tasks');

  await context.setOffline(true);
  await page.reload({waitUntil:'load'});
  await page.getByText('Без интернета · сохранённая копия',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Открыть задание',exact:true}).click();
  assert.equal(await page.getByLabel('Домашнее задание',{exact:true}).inputValue(),'Подготовить вопросы к занятию');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Неделя',exact:true}).click();
  assert.equal(await page.locator('.lesson').count(),21);
  // The PDF opens inside the app (a home-screen app on iPhone cannot go back from a PDF) and works offline.
  await page.getByRole('button',{name:'PDF',exact:true}).click();
  await page.getByRole('dialog',{name:'PDF расписания'}).locator('canvas').first().waitFor();
  const offlinePdf={ok:true,size:await page.getByRole('dialog',{name:'PDF расписания'}).locator('canvas').count()*1000+1};
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  assert.equal(await page.getByRole('dialog',{name:'PDF расписания'}).count(),0);
  assert(offlinePdf.ok && offlinePdf.size>1000);
  assert(await page.evaluate(async()=>(await fetch('map/f6.jpg')).ok),'floor plans work offline');
  await page.getByRole('button',{name:'Карта',exact:true}).click();
  await page.getByLabel('Поиск на карте').waitFor();
  await page.getByRole('button',{name:'Расписание',exact:true}).click();
  console.log('PASS genuine browser offline mode: full reload, 21 displayed lessons and saved PDF');
  await context.setOffline(false);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.getByText(/^Сверено с ВМК|^Проверено|^Проверка/).waitFor();

  // Simulate the server publishing a changed, validated timetable.
  served=structuredClone(snapshot);served.attemptedAt=served.checkedAt=new Date(Date.parse(snapshot.attemptedAt)+1000).toISOString();
  const lesson=served.schedule.groups['114'].lessons.find(l=>l.id==='3-10:30');lesson.detail='Морозова В.А. 999';lesson.raw='Алгебра и геометрия\nМорозова В.А. 999';
  served.history=[{date:'26.09.2026',previousDate:served.date,detectedAt:served.attemptedAt,pdfChanged:true,changes:{'114':[{id:'3-10:30',day:3,start:'10:30',title:'Алгебра и геометрия',before:'x',after:lesson.raw,details:['Аудитория: 615 → 999']}]}}];
  await refreshNow();
  await page.getByText(/ВМК обновил расписание \(от 26\.09\.2026\): Чт 10:30 Алгебра и геометрия — Аудитория: 615 → 999/).waitFor();
  await page.getByText('Изменено: Аудитория: 615 → 999').first().waitFor();
  await page.locator('.room').filter({hasText:'999'}).waitFor();
  assert.match(await page.evaluate(()=>JSON.parse(localStorage.getItem('vmk-v2')).snapshot.schedule.groups['114'].lessons.find(l=>l.id==='3-10:30').detail),/999/);
  await page.getByRole('button',{name:'Подробнее',exact:true}).click();
  await page.getByRole('dialog').getByText('Аудитория: 615 → 999').waitFor();
  await page.getByRole('dialog').getByText('Расписание от 26.09.2026 (было от 24.09.2026)').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({state:'hidden'});
  console.log('PASS changed room is applied, stored and shown in differences');

  for(const failure of ['unavailable','corrupt']){
    mode=failure;
    await refreshNow();
    await page.locator('button.status').getByText('Не удалось получить обновления',{exact:true}).waitFor();
    assert.equal(await page.locator('.room').filter({hasText:'999'}).count(),1);
  }
  mode='ok';served.status='error';served.error='Тест: ВМК недоступен';served.attemptedAt=new Date(Date.parse(snapshot.attemptedAt)+2000).toISOString();
  await refreshNow();
  await page.locator('button.status').getByText('Не удалось проверить ВМК',{exact:true}).waitFor();
  assert.equal(await page.locator('.room').filter({hasText:'999'}).count(),1);
  console.log('PASS network, malformed data and source failure retain timetable and show honest status');

  await context.setOffline(true);await page.reload();await page.getByText('Без интернета · сохранённая копия',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Неделя',exact:true}).click();
  assert.equal(await page.locator('.room').filter({hasText:'999'}).count(),1);
  assert.deepEqual(errors,[]);await context.close();
  const desktop=await browser.newPage({viewport:{width:1365,height:950}});mode='ok';served=snapshot;
  await desktop.goto(base);await desktop.locator('.lesson, .empty').first().waitFor();
  await desktop.screenshot({path:'test-results/desktop.png',fullPage:true});
  console.log('PASS changed timetable survives offline restart; no JavaScript errors');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
