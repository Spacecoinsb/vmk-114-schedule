import {appendFile, readFile, writeFile} from 'node:fs/promises';
import * as pdfjs from '../public/vendor/pdf.mjs';
import {parseSchedule} from '../public/parser.mjs';
import {checkSource} from './source-check.mjs';

const root = new URL('../public/',import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../public/vendor/pdf.worker.mjs',import.meta.url).href;
const previous = JSON.parse(await readFile(new URL('source.json',root),'utf8'));
previous.schedule ||= JSON.parse(await readFile(new URL('initial.json',root),'utf8'));
const {pdf, snapshot} = await checkSource({previous, parse:bytes => parseSchedule(pdfjs,bytes)});
if (pdf) {
  await writeFile(new URL('latest.pdf',root),pdf);
  await writeFile(new URL('initial.json',root),JSON.stringify(snapshot.schedule,null,2)+'\n');
}
// Failed attempts are published while the last verified timetable is retained.
await writeFile(new URL('source.json',root),JSON.stringify(snapshot)+'\n');
// Commit only real changes (plus one heartbeat a day); every run still deploys the fresh source.json.
const commit = previous.hash !== snapshot.hash || previous.status !== snapshot.status || previous.error !== snapshot.error
  || previous.attemptedAt?.slice(0,10) !== snapshot.attemptedAt.slice(0,10);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,`commit=${commit}\n`);
console.log(snapshot.status === 'ok'
  ? `ВМК проверен ${snapshot.checkedAt}: ${snapshot.schedule.lessons.length} занятий, PDF ${snapshot.hash}`
  : `Проверка не удалась; сохранена предыдущая версия: ${snapshot.error}`);
