import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {renderMarkdown} from '../core/knowledge.mjs';
import * as tools from '../core/pdf-links.mjs';
const attachments=[{path:'docs/manual.pdf'}];
test('PDF-01 rendered wiki and Markdown attachment links preserve PDF fragments',()=>{
 const source='[[docs/manual.pdf#page=2&selection=0,0,0,5]]\n\n[Read](docs/manual.pdf#page=2&annotation=8R)';
 const html=renderMarkdown(source,[],'Note.md',{vaultId:'vault',attachments});
 const links=[...new JSDOM(html).window.document.querySelectorAll('a')].map(a=>({path:a.dataset.attachment,fragment:a.dataset.attachmentFragment}));
 assert.deepEqual(links,[{path:'docs/manual.pdf',fragment:'page=2&selection=0,0,0,5'},{path:'docs/manual.pdf',fragment:'page=2&annotation=8R'}]);
});
test('PDF-01 parses and validates page/selection parameters and emits compatible links',()=>{
 assert.equal(typeof tools.parsePdfFragment,'function');
 assert.deepEqual(tools.parsePdfFragment('#page=2&selection=4,0,5,20&annotation=8R'),{page:2,selection:[4,0,5,20],annotation:'8R'});
 assert.throws(()=>tools.parsePdfFragment('page=-1'),/페이지/);
 assert.throws(()=>tools.parsePdfFragment('page=2&selection=1,0,-2,3'),/선택/);
 assert.throws(()=>tools.parsePdfFragment('selection=1,0,0,3'),/선택/);
 assert.equal(tools.pdfWikiLink('docs/manual.pdf',2,[0,0,0,5]),'[[docs/manual.pdf#page=2&selection=0,0,0,5]]');
});
test('PDF-01 backlinks resolve relative paths and ignore fenced examples and missing files',()=>{
 assert.equal(typeof tools.pdfBacklinks,'function');
 const notes=[{path:'notes/A.md',content:'[Page](../docs/manual.pdf#page=2)\n\n```md\n[[docs/manual.pdf#page=3]]\n```'},{path:'B.md',content:'[[manual.pdf#page=1]]\n[[missing.pdf#page=2]]'}];
 const links=tools.pdfBacklinks(notes,'docs/manual.pdf',attachments);
 assert.equal(links.length,2);assert.deepEqual(links.map(l=>l.notePath),['notes/A.md','B.md']);assert.equal(links[0].fragment,'page=2');
});

test('PDF-01 a hash in a valid attachment filename stays separate from its fragment',()=>{
 const html=renderMarkdown('[[docs/a%23b.pdf#page=2|Hash file]]',[],'Note.md',{vaultId:'vault',attachments:[{path:'docs/a#b.pdf'}]});
 assert.match(html,/data-attachment="docs\/a#b.pdf" data-attachment-fragment="page=2"/);
});
