import {execFileSync} from 'node:child_process';
import {access,readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const root=path.resolve(process.env.DYNOTE_PACKAGE_OUT||`release/v${version}`);
const executable=process.platform==='darwin'?path.join(root,'Dynote-darwin-arm64/Dynote.app/Contents/MacOS/Dynote'):path.join(root,'Dynote-win32-x64/Dynote.exe');
const playwright=process.env.DYNOTE_PLAYWRIGHT_MODULE||pathToFileURL(path.join(process.env.RUNNER_TEMP,'dynote-ui-tools/node_modules/playwright/index.mjs')).href;
await access(executable);
const env={...process.env,DYNOTE_EXECUTABLE:executable,DYNOTE_PLAYWRIGHT_MODULE:playwright};
const scripts=['verify-outline-regions.mjs','verify-journal-threading.mjs','verify-journal-outline.mjs','verify-vault-spaces.mjs','verify-vault-space-fixes.mjs','verify-vault-history-runtime.mjs','verify-git-workspace.mjs','verify-ai-providers.mjs',...(process.platform==='darwin'?['verify-journal-workspace.mjs','verify-editor-tools.mjs','verify-journal-write-large-markdown.mjs','verify-planner-review.mjs']:[])];
for(const script of scripts)execFileSync(process.execPath,[`scripts/${script}`],{env,stdio:'inherit',timeout:180000});
console.log(`Verified ${scripts.length} native ${process.platform} package scenarios.`);
