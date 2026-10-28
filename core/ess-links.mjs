import { parseDocument } from 'yaml';
import { parseMetadata, updateMetadata } from './metadata.mjs';

export const ESS_DEVICES = ['container', ...Array.from({length:6},(_,i)=>`rack-0${i+1}`), ...Array.from({length:6},(_,i)=>`bpu-0${i+1}`), 'lcs', 'ebsc', 'switch', 'extended-switch'];
export const validEssTarget = value => typeof value === 'string' && /^ess-0[1-6]\/(?:container|rack-0[1-6]|bpu-0[1-6]|lcs|ebsc|switch|extended-switch)$/.test(value) && !value.includes('\n');
export function essLabel(target) {
  if (!validEssTarget(target)) return 'ESS LINK';
  const [container,device]=target.split('/');
  return `${container.toUpperCase().replace('-',' ')} · ${{container:'컨테이너',lcs:'LCS',ebsc:'eBSC',switch:'Switch','extended-switch':'Extended Switch'}[device] ?? device.toUpperCase().replace('-',' ')}`;
}
export function noteEssLinks(content) {
  const value=parseMetadata(content).properties.ess_links;
  return [...new Set((Array.isArray(value)?value:[value]).filter(validEssTarget))];
}
export function setEssLink(content,target,linked) {
  if (!validEssTarget(target)) throw new Error('ESS 대상을 확인해 주세요.');
  const parsed=parseMetadata(content);
  if (parsed.error) throw new Error(`문서 속성을 확인해 주세요: ${parsed.error}`);
  const value=parsed.properties.ess_links;
  const current=value===undefined?[]:Array.isArray(value)?value:[value];
  if (!current.every(validEssTarget)) throw new Error('문서의 ess_links 속성을 확인해 주세요. 기존 값은 보존했습니다.');
  if (current.includes(target)===linked) return content;
  const next=linked?[...current,target]:current.filter(v=>v!==target);
  const doc=parseDocument(parsed.yaml || '{}');
  if(next.length)doc.set('ess_links',next);else doc.delete('ess_links');
  return updateMetadata(content,doc.toString());
}
export function essMessage(event,source,origin) {
  if (!source || event.source!==source || event.origin!==origin || event.data?.channel!=='dynote-ess') return null;
  const {type,target,activate}=event.data;
  if (type==='ready' || type==='error') return {type};
  if (type==='select' && validEssTarget(target) && typeof activate==='boolean') return {type,target,activate};
  return null;
}
