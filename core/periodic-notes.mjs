import moment from 'moment';
import 'moment/locale/ko.js';
import 'moment/locale/en-gb.js';

export const periods = { daily: '일간', weekly: '주간', monthly: '월간', quarterly: '분기', yearly: '연간' };
const units = { daily: 'day', weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year' };
const formats = { daily: 'YYYY-MM-DD', weekly: 'gggg-[W]ww', monthly: 'YYYY-MM', quarterly: 'YYYY-[Q]Q', yearly: 'YYYY' };
export const localDate = (value = new Date()) => moment(value).format('YYYY-MM-DD');
export function periodicNote(period, date, settings = {}) {
  if (!units[period]) throw new Error('지원하지 않는 주기입니다.');
  const value = moment(date, 'YYYY-MM-DD', true).locale(settings.locale || 'ko');
  if (!value.isValid()) throw new Error('올바른 날짜를 선택해 주세요.');
  // ISO week formats must retain their own boundary, independently of locale weeks.
  const format = settings.format?.trim() || formats[period];
  const unit = period === 'weekly' && /G{4}|W/.test(format.replace(/\[[^\]]*\]/g, '')) ? 'isoWeek' : units[period];
  value.startOf(unit);
  const title = value.format(format);
  const folder = settings.folder?.trim() || '';
  const path = (folder ? folder + '/' : '') + title + '.md';
  if (path.length > 1023 || /[\\\0<>:"|?*]/.test(path) || path.split('/').some(p => !p || p.startsWith('.') || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))
    throw new Error('노트 경로에 사용할 수 없는 문자가 있습니다.');
  return { path, title: title.split('/').at(-1), date: value.format('YYYY-MM-DD'), period, format, locale: settings.locale || 'ko' };
}
export function renderTemplate(content, note, now = new Date()) {
  const target = moment(note.date, 'YYYY-MM-DD', true).locale(note.locale || 'ko');
  const clock = moment(now).locale(note.locale || 'ko');
  return content.replace(/{{\s*(title|date|time|yesterday|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:([+-])(\d+)([dwMy]))?(?::([^}]+))?\s*}}/g,
    (all, key, sign, amount, unit, format) => {
      if (key === 'title') return note.title;
      const date = key === 'time' ? clock.clone() : target.clone();
      if (key === 'yesterday') date.subtract(1, 'day');
      else if (key === 'tomorrow') date.add(1, 'day');
      else if (!['date','time'].includes(key)) {
        const day = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].indexOf(key);
        date.add((day - date.day() + 7) % 7, 'day');
      }
      if (amount) date.add((sign === '-' ? -1 : 1) * Number(amount), unit);
      return date.format(format?.trim() || (key === 'time' ? 'HH:mm' : note.format || 'YYYY-MM-DD'));
    });
}
export function periodicEntries(notes, period, settings = {}) {
  const format = settings.format?.trim() || formats[period];
  const folder = settings.folder?.trim() || '';
  const prefix = folder ? folder + '/' : '';
  return notes.flatMap(note => {
    if (!note.path.startsWith(prefix) || !note.path.endsWith('.md')) return [];
    const name = note.path.slice(prefix.length, -3);
    const date = moment(name, format, settings.locale || 'ko', true);
    if (!date.isValid() || date.format(format) !== name) return [];
    return [{ ...note, date: date.format('YYYY-MM-DD') }];
  }).sort((a,b) => a.date.localeCompare(b.date) || a.path.localeCompare(b.path));
}
export function adjacentEntry(entries, path, direction) {
  const index = entries.findIndex(entry => entry.path === path);
  return index < 0 ? null : entries[index + direction] ?? null;
}
