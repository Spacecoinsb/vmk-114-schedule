export const PARSER_VERSION = 2;
export const STALE_AFTER = 9 * 60 * 60 * 1000;
const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const isoDay = /^20\d\d-\d{2}-\d{2}$/;
export const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const validSourceUrl = value => typeof value === 'string' && /^https:\/\/cs\.msu\.ru\/sites\/cmc\/files\/[^?#]+\.pdf$/.test(value);
export const validTimestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function validSchedule(value) {
  return value?.group === 114 && Number.isInteger(value.year) && value.year >= 2020 && value.year < 2100
    && Number.isInteger(value.page) && value.page > 0 && validHash(value.hash)
    && validSourceUrl(value.sourceUrl) && typeof value.sourceDate === 'string' && validTimestamp(value.savedAt)
    && Array.isArray(value.lessons) && value.lessons.length >= 12 && value.lessons.length <= 40
    && new Set(value.lessons.map(l => l?.id)).size === value.lessons.length
    && value.lessons.every(l => l && Number.isInteger(l.day) && l.day >= 0 && l.day <= 5
      && time.test(l.start) && time.test(l.end) && l.end > l.start && l.id === `${l.day}-${l.start}`
      && typeof l.title === 'string' && l.title.trim() && typeof l.raw === 'string'
      && typeof l.detail === 'string' && typeof l.room === 'string'
      && ['lecture','class','consultation','sport'].includes(l.type)
      && (l.rule === null || (l.rule && typeof l.rule === 'object'
        && (l.rule.from === undefined || isoDay.test(l.rule.from))
        && (l.rule.dates === undefined || (Array.isArray(l.rule.dates) && l.rule.dates.length > 0 && l.rule.dates.every(d => isoDay.test(d)))))));
}

export function validSnapshot(value) {
  return value?.schema === 2 && ['ok','error'].includes(value.status)
    && validTimestamp(value.attemptedAt) && (value.checkedAt === null || validTimestamp(value.checkedAt))
    && (value.status !== 'ok' || value.checkedAt === value.attemptedAt)
    && (value.status !== 'error' || typeof value.error === 'string')
    && validSchedule(value.schedule) && value.hash === value.schedule.hash
    && value.date === value.schedule.sourceDate && value.url === value.schedule.sourceUrl;
}

export function diffSchedules(before, after) {
  const changes = [];
  for (const lesson of after.lessons) {
    const old = before.lessons.find(l => l.id === lesson.id);
    if (!old || old.raw !== lesson.raw || old.end !== lesson.end)
      changes.push({id:lesson.id, day:lesson.day, start:lesson.start, before:old?.raw, after:lesson.raw});
  }
  for (const lesson of before.lessons) {
    if (!after.lessons.some(l => l.id === lesson.id))
      changes.push({id:lesson.id, day:lesson.day, start:lesson.start, before:lesson.raw});
  }
  return changes;
}

// Join PDF line wraps before splitting teachers; preserve each subgroup's own room.
export function teacherRows(detail) {
  const joined = detail.replace(/\s+/g, ' ').trim();
  if (!joined) return [];
  const starts = [...joined.matchAll(/[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ]\.\s*[А-ЯЁ]\./g)].map(m => m.index);
  const pieces = starts.length > 1 ? starts.map((start, i) => joined.slice(i === 0 ? 0 : start, starts[i+1])) : [joined];
  return pieces.map(piece => {
    const match = piece.match(/^(.*?)\s*([0-9]{2,3}(?:\s*[-–]\s*[а-яА-Я])?|П\s*[-–]\s*\d+)(?:\s+(МЗ\s*[-–]\s*\d+))?[, .]*$/);
    return match ? {teacher:match[1].trim().replace(/\.{2,}$/,'.'), room:match[2].replace(/\s/g,'').replace('–','-'), note:match[3]?.replace(/\s/g,'').replace('–','-') || ''}
      : {teacher:piece.trim(), room:'', note:''};
  });
}

export function cleanTitle(lesson) {
  return lesson.title.replace(/^Конс\.\s*/i,'')
    .replace(/^с\s+\d{1,2}\.\d{2}\s*/i,'')
    .replace(/^(?:\d{1,2}[.,]?\s*,\s*)+\d{1,2}\s*\.\s*\d{2}\s*/,'')
    .replace(/^с октября\s*/i,'');
}

export function verification(snapshot, now = Date.now()) {
  if (!snapshot || !validTimestamp(snapshot.checkedAt)) return {tone:'warn', title:'Проверка ВМК не подтверждена'};
  if (snapshot.status === 'error') return {tone:'warn', title:'Не удалось проверить ВМК'};
  const age = now - Date.parse(snapshot.checkedAt);
  if (age < -300000 || age > STALE_AFTER) return {tone:'warn', title:'Проверка ВМК задерживается'};
  return {tone:'ok', title:'Проверено по сайту ВМК'};
}
