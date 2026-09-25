import {createHash} from 'node:crypto';
import {DEFAULT_GROUP, HISTORY_LIMIT, PARSER_VERSION, diffTables, validHistory, validTable} from '../lib/schedule-model.mjs';

export const PAGE = 'https://cs.msu.ru/studies/schedule';
export function readMetadata(html) {
  const section = html.split(/Бакалавриат и интегрированные магистры/i)[1]?.split(/Магистратура и второе высшее образование/i)[0];
  if (!section) throw Error('На сайте ВМК изменился раздел расписаний.');
  const date = section.replace(/<[^>]*>/g,' ').match(/Расписание\s+обновлено\s+(\d{2}\.\d{2}\.\d{4})/i)?.[1];
  if (!date) throw Error('Не найдена дата обновления на сайте ВМК.');
  const anchors = [...section.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const href = anchors.find(a => /101\s*(?:[–—-]|&ndash;|&#8211;)\s*121/.test(a[2].replace(/<[^>]*>/g,'')))?.[1];
  if (!href) throw Error('Не найдена ссылка на расписание первого курса.');
  const url = new URL(href.replace(/&amp;/g,'&'), PAGE);
  if (url.origin !== 'https://cs.msu.ru' || !url.pathname.startsWith('/sites/cmc/files/') || !url.pathname.endsWith('.pdf') || url.search || url.hash)
    throw Error('Неизвестная ссылка на PDF.');
  return {date, url:url.href};
}

async function download(fetcher, url, accept, limit) {
  const signal = AbortSignal.timeout(45000);
  for (let redirects = 0; redirects < 5; redirects++) {
    const response = await fetcher(url, {redirect:'manual', headers:{Accept:accept, 'User-Agent':'VMK114-Schedule/2.0'}, signal});
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw Error('ВМК вернул пустое перенаправление.');
      url = new URL(location,url).href;
      await response.body?.cancel();
      if (new URL(url).origin !== 'https://cs.msu.ru') throw Error('ВМК перенаправил на другой сайт.');
      continue;
    }
    if (!response.ok) throw Error(`Сайт ВМК недоступен (HTTP ${response.status}).`);
    if (Number(response.headers.get('content-length')) > limit) throw Error('Ответ ВМК слишком большой.');
    const chunks = []; let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > limit) throw Error('Ответ ВМК слишком большой.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw Error('Слишком много перенаправлений ВМК.');
}

// Older snapshots stored only group 114.
export function previousTable(previous) {
  const schedule = previous?.schedule;
  if (validTable(schedule)) return schedule;
  if (schedule?.lessons) { const {lessons, page, group, ...rest} = schedule; return {...rest, groups:{[DEFAULT_GROUP]:{page, lessons}}}; }
  return null;
}

// Every successful check downloads and parses the PDF, even if its URL/date did not change.
// When VMK publishes a new date or a different PDF, the exact differences of every group are recorded.
export async function checkSource({previous, parse, fetcher = fetch, now = () => new Date().toISOString()}) {
  const before = previousTable(previous);
  const history = validHistory(previous?.history) ? previous.history : [];
  try {
    const html = await download(fetcher, PAGE, 'text/html', 2_000_000);
    const metadata = readMetadata(html.toString('utf8'));
    const pdf = await download(fetcher, metadata.url, 'application/pdf', 8_000_000);
    if (pdf.subarray(0,5).toString() !== '%PDF-') throw Error('Вместо PDF получен другой файл.');
    const hash = createHash('sha256').update(pdf).digest('hex');
    const parsed = await parse(pdf);
    const attemptedAt = now();
    const savedAt = before?.hash === hash ? before.savedAt : attemptedAt;
    const schedule = {year:parsed.year, groups:parsed.groups, sourceDate:metadata.date, sourceUrl:metadata.url, hash, savedAt, parserVersion:PARSER_VERSION};
    if (!validTable(schedule)) throw Error('Не удалось проверить полноту расписания.');
    let nextHistory = history;
    const pdfChanged = !!before && before.hash !== hash;
    if (before && (pdfChanged || before.sourceDate !== metadata.date)) {
      // A parser upgrade on an unchanged PDF must not look like a timetable change.
      const changes = pdfChanged ? diffTables(before, schedule) : {};
      // Groups first seen after the single-group era are not "new classes".
      if (pdfChanged) for (const name of Object.keys(changes)) if (!before.groups[name] && Object.keys(before.groups).length === 1) delete changes[name];
      nextHistory = [{date:metadata.date, previousDate:before.sourceDate || null, detectedAt:attemptedAt, pdfChanged, changes}, ...history].slice(0, HISTORY_LIMIT);
    }
    return {pdf, snapshot:{schema:3, status:'ok', attemptedAt, checkedAt:attemptedAt, error:null, date:metadata.date, url:metadata.url, hash, schedule, history:nextHistory}};
  } catch (error) {
    if (!before) throw error;
    return {pdf:null, snapshot:{schema:3, status:'error', attemptedAt:now(), checkedAt:previous.checkedAt || null,
      error:error instanceof Error ? error.message : 'Не удалось проверить сайт ВМК.',
      date:before.sourceDate, url:before.sourceUrl, hash:before.hash, schedule:before, history}};
  }
}
