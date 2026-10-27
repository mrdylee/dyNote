import test from 'node:test';
import assert from 'node:assert/strict';
import * as tools from '../core/update-information.mjs';
const release=(tag,extra={})=>({tag_name:tag,name:tag,body:'<script>inert text</script>',draft:false,prerelease:false,assets:[],...extra});
test('UPDATE-01 semantic ordering handles numeric minor versions and prereleases',()=>{
 assert.equal(typeof tools.releaseInformation,'function');
 assert.equal(tools.releaseInformation([release('v0.9.0'),release('v0.10.0')],'0.9.0',false).latest.tag,'v0.10.0');
 assert.equal(tools.releaseInformation([release('v1.0.0-beta.2',{prerelease:true}),release('v1.0.0-beta.10',{prerelease:true})],'1.0.0-beta.2',true).latest.tag,'v1.0.0-beta.10');
 assert.equal(tools.releaseInformation([release('v1.0.0'),release('v1.0.0-beta.10',{prerelease:true})],'1.0.0-beta.2',true).latest.tag,'v1.0.0');
});
test('UPDATE-01 stable filtering excludes draft/non-version/beta tags and never downgrades',()=>{
 assert.equal(typeof tools.releaseInformation,'function');
 const feed=[release('v2.0.0',{draft:true}),release('nightly'),release('v1.1.0-beta.1',{prerelease:true}),release('v1.0.0')];
 const result=tools.releaseInformation(feed,'1.1.0',false);assert.equal(result.latest.tag,'v1.0.0');assert.equal(result.available,false);
 assert.equal(tools.releaseInformation(feed,'1.0.0',true).available,true);
});
test('UPDATE-01 canonical links and text fields cannot introduce arbitrary release/asset targets',()=>{
 assert.equal(typeof tools.releaseInformation,'function');
 const result=tools.releaseInformation([release('v1.2.0',{html_url:'javascript:bad',assets:[{name:'bad.exe',browser_download_url:'https://evil.test/bad.exe'},{name:'Dynote.zip',browser_download_url:'https://github.com/mrdylee/dyNote/releases/download/v1.2.0/Dynote.zip'}]})],'1.0.0');
 assert.equal(result.latest.url,'https://github.com/mrdylee/dyNote/releases/tag/v1.2.0');assert.equal(result.latest.assets.length,1);assert.equal(result.latest.body,'<script>inert text</script>');
 assert.throws(()=>tools.releaseInformation({error:'bad'},'1.0.0'),/응답/);
});

test('UPDATE-01 malformed semantic prerelease identifiers cannot become the latest release',()=>{
 const result=tools.releaseInformation([release('v99.0.0-beta.01'),release('v99.0.0-x_y'),release('v99.0.0-beta..2'),release('v1.2.3+build.1')],'1.0.0',true);
 assert.equal(result.latest.tag,'v1.2.3+build.1');
});
