import {periodicEntries} from './periodic-notes.mjs';
export function journalPreferences(value, notes) {
  if (value?.daily) return value;
  const legacy = periodicEntries(notes, 'daily').length > 0;
  return {...value, daily:{folder:legacy ? '' : 'Journal'}};
}
