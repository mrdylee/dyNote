import moment from 'moment/moment.js';
import {parseDocument} from 'yaml';
import {parseMetadata,updateMetadata} from './metadata.mjs';
import {periodicEntries,periodicNote} from './periodic-notes.mjs';
const segmenter=new Intl.Segmenter('ko',{granularity:'word'});
export function timestampInsertion(source,cursor,noteDate,now=new Date(),settings={}) {
  const time=moment(now).locale(settings.locale||'ko'),today=time.format('YYYY-MM-DD');
  const stamp=`— ${noteDate===today?'':time.format(settings.dateStampFormat||'M/D/YYYY')+' '}${time.format(settings.timeStampFormat||'h:mm A')} —`;
  const eol=source.includes('\r\n')?'\r\n':'\n',before=source.slice(0,cursor),after=source.slice(cursor);
  const prefix=!before||before.endsWith(eol+eol)?'':before.endsWith(eol)?eol:eol+eol;
  const suffix=after.startsWith(eol+eol)?'':after.startsWith(eol)?eol:eol+eol;
  return {insert:prefix+stamp+suffix,anchor:cursor+prefix.length+stamp.length+eol.length*2};
}
export function rateJournal(source,rating) {
  if(rating!==null&&(!Number.isInteger(rating)||rating<1||rating>5))throw new Error('평가는 1~5점으로 선택해 주세요.');
  const metadata=parseMetadata(source);if(metadata.error)throw new Error(metadata.error);
  if(rating===null&&!Object.hasOwn(metadata.properties,'daily rating'))return source;
  const doc=parseDocument(metadata.yaml||'');if(rating===null)doc.delete('daily rating');else doc.set('daily rating',rating);
  return updateMetadata(source,doc.toString());
}
export function onThisDay(notes,date,settings={}) {
  periodicNote('daily',date);
  return periodicEntries(notes,'daily',settings).filter(n=>n.date.slice(5)===date.slice(5)&&n.date.slice(0,4)<date.slice(0,4)).reverse();
}
export function wordStatistics(source='') {
  const {body}=parseMetadata(source);let words=0;
  for(const part of segmenter.segment(body))if(part.isWordLike)words++;
  return {words,characters:body.length};
}
