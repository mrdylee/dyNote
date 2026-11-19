import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream, existsSync} from 'node:fs';
import {access, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

if (process.platform !== 'win32') throw new Error('Run this script on Windows with Inno Setup installed.');
const repo = fileURLToPath(new URL('..', import.meta.url));
const {version} = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'));
const output = path.resolve(process.env.DYNOTE_PACKAGE_OUT || path.join(repo, 'release', `v${version}`));
const packageName = 'Dynote-win32-x64';
const packageDir = path.join(output, packageName);
await access(path.join(packageDir, 'Dynote.exe'));

const iscc = [
  path.join(process.env.ProgramFiles, 'Inno Setup 7', 'ISCC.exe'),
  path.join(process.env['ProgramFiles(x86)'], 'Inno Setup 6', 'ISCC.exe'),
].find(existsSync) || 'ISCC.exe';
execFileSync(iscc, [`/DAppVersion=${version}`, `/DPackageDir=${packageDir}`, `/O${output}`, path.join(repo, 'installer', 'dynote.iss')], {stdio: 'inherit'});

const base = `Dynote-${version}-windows-x64`;
const zip = path.join(output, base + '.zip');
await rm(zip, {force: true});
execFileSync('tar.exe', ['-a', '-cf', zip, '-C', output, packageName], {stdio: 'inherit'});

const sums = [];
for (const name of [base + '.zip', base + '-Setup.exe']) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join(output, name))) hash.update(chunk);
  sums.push(`${hash.digest('hex')}  ${name}`);
}
await writeFile(path.join(output, 'SHA256SUMS-windows-x64.txt'), sums.join('\n') + '\n');
