import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const PAGE='https://cs.msu.ru/studies/schedule';
const root=new URL('../public/',import.meta.url);
async function download(url,accept,maxBytes){
  const response=await fetch(url,{headers:{Accept:accept,'User-Agent':'VMK114-Schedule/1.0'},signal:AbortSignal.timeout(30000)});
  if(!response.ok||new URL(response.url).origin!=='https://cs.msu.ru')throw Error(`Источник ВМК недоступен: ${response.status}`);
  if(Number(response.headers.get('content-length'))>maxBytes)throw Error('Ответ ВМК слишком большой');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length>maxBytes)throw Error('Ответ ВМК слишком большой');
  return bytes;
}
const html=new TextDecoder().decode(await download(PAGE,'text/html',2_000_000));
const section=html.split(/Бакалавриат и интегрированные магистры/i)[1]?.split(/Магистратура и второе высшее образование/i)[0];
if(!section)throw Error('На сайте ВМК изменился раздел расписаний');
const date=section.replace(/<[^>]*>/g,' ').match(/Расписание\s+обновлено\s+(\d{2}\.\d{2}\.\d{4})/i)?.[1]||'Дата не указана';
const anchors=[...section.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
const href=anchors.find(a=>/101\s*(?:[–—-]|&ndash;|&#8211;)\s*121/.test(a[2].replace(/<[^>]*>/g,'')))?.[1];
if(!href)throw Error('На сайте ВМК не найдена ссылка на первый курс');
const url=new URL(href.replace(/&amp;/g,'&'),PAGE);
if(url.origin!=='https://cs.msu.ru'||!url.pathname.startsWith('/sites/cmc/files/')||!url.pathname.endsWith('.pdf'))throw Error('Неизвестная ссылка на PDF');
const pdf=await download(url.href,'application/pdf',8_000_000);
if(new TextDecoder().decode(pdf.subarray(0,5))!=='%PDF-')throw Error('ВМК вернул не PDF');
const hash=createHash('sha256').update(pdf).digest('hex');
const previous=JSON.parse(await readFile(new URL('source.json',root),'utf8'));
const checkedAt=previous.checkedAt&&Date.now()-Date.parse(previous.checkedAt)<28*86_400_000?previous.checkedAt:new Date().toISOString();
const metadata={date,url:url.href,hash,checkedAt};
if(previous.hash!==hash){await writeFile(new URL('latest.pdf',root),pdf);console.log(`PDF обновился: ${hash}`);}
else {try{await readFile(new URL('latest.pdf',root));}catch{await writeFile(new URL('latest.pdf',root),pdf);}}
if(previous.hash!==hash||previous.date!==date||previous.url!==url.href||previous.checkedAt!==checkedAt)await writeFile(new URL('source.json',root),JSON.stringify(metadata)+'\n');
console.log(`Расписание ВМК: ${date}, ${hash}`);
