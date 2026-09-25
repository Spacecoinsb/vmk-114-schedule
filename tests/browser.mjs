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
  await page.goto(base);
  await page.getByText('Доступно без интернета',{exact:true}).waitFor();
  await page.getByRole('link',{name:'PDF',exact:true}).waitFor();
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  assert(requests.includes('/vmk-114-schedule/latest.pdf'),'first visit saves PDF even if seed hash matches');
  await page.getByRole('button',{name:'Неделя',exact:true}).click();
  assert.equal(await page.locator('.lesson').count(),22);
  assert.equal(await page.locator('.room').filter({hasText:'613'}).count(),1);
  assert.equal(await page.locator('.room').filter({hasText:'682'}).count(),1);
  assert.equal(await page.getByText('Как установить на iPhone').count(),0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile fits viewport');
  await page.getByRole('button',{name:'День',exact:true}).click();
  await page.getByRole('button',{name:'Тёмная тема',exact:true}).click();
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.getByRole('button',{name:'Добавить задание',exact:true}).first().click();
  await page.getByLabel('Домашнее задание или заметка',{exact:true}).fill('Подготовить вопросы к занятию');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.reload();
  assert.equal(await page.getByRole('button',{name:'Открыть задание',exact:true}).count(),1);
  await page.getByRole('button',{name:'Следующая неделя',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Открыть задание',exact:true}).count(),0,'homework belongs to one date only');
  await page.getByRole('button',{name:'Сегодня',exact:true}).click();
  await page.getByRole('button',{name:'Задания · 1',exact:true}).click();
  await page.getByRole('button',{name:'Отметить выполненным',exact:true}).click();
  await page.keyboard.press('Escape');
  await page.getByText('Готово',{exact:true}).waitFor();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/dark-homework.png',fullPage:true});
  await page.getByRole('button',{name:'Воскресенье, 27 сентября',exact:true}).click();
  const footer=await page.locator('.footer').boundingBox();
  assert(footer.y+footer.height>760 && footer.y+footer.height<=844,'footer stays at screen bottom on an empty day');
  await page.getByRole('button',{name:'Сегодня',exact:true}).click();
  await page.getByRole('button',{name:'Светлая тема',exact:true}).click();
  console.log('PASS dark-theme persistence, dated homework, completed tasks, bottom footer');
  assert((await page.locator('.lesson').first().boundingBox()).y<240,'schedule is above the fold on mobile');
  assert(await page.getByRole('link',{name:'Сайт ВМК',exact:true}).isVisible(),'source is accessible without opening details');
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/mobile.png',fullPage:true});
  await page.locator('.verification summary').click();
  await page.getByText('Успешная проверка ВМК',{exact:true}).waitFor();
  await page.screenshot({path:'test-results/status.png',fullPage:true});
  console.log('PASS mobile, unified rooms, verification details, first-visit PDF cache');

  await page.clock.setFixedTime(new Date('2026-09-25T05:50:00Z'));
  await page.reload();
  await page.getByText('Через 10 мин',{exact:true}).waitFor();
  await page.clock.setFixedTime(new Date('2026-09-25T06:10:00Z'));
  await page.reload();
  await page.getByText('Сейчас · ещё 1 ч 20 мин',{exact:true}).waitFor();
  await page.clock.setFixedTime(new Date('2026-09-25T07:30:00Z'));
  await page.reload();
  await page.getByText('Через 10 мин',{exact:true}).waitFor();
  assert.equal(await page.locator('.lesson.current').count(),0,'finished class is no longer current');
  await page.clock.setFixedTime(new Date());
  await page.reload();
  console.log('PASS next-class countdown, current-class countdown and exact end-time transition');

  await context.setOffline(true);
  await page.reload({waitUntil:'load'});
  await page.getByText('Без интернета',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Открыть задание',exact:true}).click();
  assert.equal(await page.getByLabel('Домашнее задание или заметка',{exact:true}).inputValue(),'Подготовить вопросы к занятию');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Неделя',exact:true}).click();
  assert.equal(await page.locator('.lesson').count(),22);
  const offlinePdf=await page.evaluate(async()=>{const link=document.querySelector('.footer a');const response=await fetch(link.href);return {ok:response.ok,size:(await response.arrayBuffer()).byteLength};});
  assert(offlinePdf.ok && offlinePdf.size>1000);
  console.log('PASS genuine browser offline mode: full reload, 22 lessons and saved PDF');
  await context.setOffline(false);
  await page.getByRole('button',{name:'Обновить',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.refresh-button').disabled);

  // Simulate the server publishing a changed, validated timetable.
  served=structuredClone(snapshot);served.attemptedAt=served.checkedAt=new Date(Date.now()+1000).toISOString();
  const lesson=served.schedule.lessons.find(l=>l.id==='3-10:30');lesson.detail='Морозова В.А. 999';lesson.raw='Алгебра и геометрия\nМорозова В.А. 999';
  await page.getByRole('button',{name:'Обновить',exact:true}).click();
  await page.getByText('Пары обновлены и сохранены на устройстве.').waitFor();
  await page.locator('.room').filter({hasText:'999'}).waitFor();
  assert.match(await page.evaluate(()=>JSON.parse(localStorage.getItem('vmk114-v1')).data.lessons.find(l=>l.id==='3-10:30').detail),/999/);
  await page.getByRole('button',{name:'Что изменилось',exact:true}).click();
  await page.getByRole('dialog').getByText(/Стало/).waitFor();
  await page.keyboard.press('Escape');
  console.log('PASS changed room is applied, stored and shown in differences');

  for(const failure of ['unavailable','corrupt']){
    mode=failure; await page.waitForFunction(()=>!document.querySelector('.refresh-button').disabled);
    await page.getByRole('button',{name:'Обновить',exact:true}).click();
    await page.getByText('Не удалось получить обновления',{exact:true}).waitFor();
    assert.equal(await page.locator('.room').filter({hasText:'999'}).count(),1);
  }
  mode='ok';served.status='error';served.error='Тест: ВМК недоступен';served.attemptedAt=new Date(Date.now()+2000).toISOString();
  await page.getByRole('button',{name:'Обновить',exact:true}).click();
  await page.getByText('Не удалось проверить ВМК',{exact:true}).waitFor();
  assert.equal(await page.locator('.room').filter({hasText:'999'}).count(),1);
  console.log('PASS network, malformed data and source failure retain timetable and show honest status');

  await context.setOffline(true);await page.reload();await page.getByText('Без интернета',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Неделя',exact:true}).click();
  assert.equal(await page.locator('.room').filter({hasText:'999'}).count(),1);
  assert.deepEqual(errors,[]);await context.close();
  const desktop=await browser.newPage({viewport:{width:1365,height:950}});mode='ok';served=snapshot;
  await desktop.goto(base);await desktop.getByText('Доступно без интернета',{exact:true}).waitFor();
  await desktop.screenshot({path:'test-results/desktop.png',fullPage:true});
  console.log('PASS changed timetable survives offline restart; no JavaScript errors');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
