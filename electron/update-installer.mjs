import { copyFile, mkdir, readFile, writeFile, rm, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function stageUpdate({ file, asset, tag, directory, executable, parentPid = process.pid }) {
  const jobDirectory = path.join(directory, 'install', randomUUID());
  await mkdir(jobDirectory, { recursive: true });
  try {
    const installer = path.join(jobDirectory, 'Setup.exe');
    await copyFile(file, installer);
    const hash = createHash('sha256'); let size = 0;
    for await (const chunk of createReadStream(installer)) { hash.update(chunk); size += chunk.length; }
    if (size !== asset.size || `sha256:${hash.digest('hex')}` !== asset.digest) throw new Error('설치 파일 검증에 실패했습니다. 다시 다운로드해 주세요.');
    await writeFile(path.join(jobDirectory, 'install.ps1'), await readFile(new URL('./install-update.ps1', import.meta.url)));
    const manifest = path.join(jobDirectory, 'job.json');
    await writeFile(manifest, JSON.stringify({ installer, executable, parentPid, sha256: asset.digest.slice(7), tag }));
    return { directory: jobDirectory, manifest };
  } catch (error) { await rm(jobDirectory, { recursive: true, force: true }); throw error; }
}

export async function launchUpdate(job, { spawnProcess = spawn, powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), timeout = 10000 } = {}) {
  const logPath = path.join(job.directory, 'helper.log'), log = await open(logPath, 'w');
  let child, failure;
  try {
    child = spawnProcess(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', path.join(job.directory, 'install.ps1'), '-JobPath', job.manifest], { windowsHide: true, stdio: ['ignore', log.fd, log.fd], shell: false });
    child.once('error', error => { failure = error; });
    child.once('exit', code => { if (code !== 0) failure ??= new Error(`업데이트 실행기가 종료되었습니다 (${code}).`); });
  } finally { await log.close(); }
  const deadline = Date.now() + timeout;
  try {
    while (Date.now() < deadline) {
      if (failure) throw failure;
      try { await readFile(path.join(job.directory, 'ready')); child.unref(); return; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await delay(50);
    }
    throw new Error('업데이트 실행기를 시작하지 못했습니다. 설치 파일 위치에서 직접 실행해 주세요.');
  } catch (error) {
    await writeFile(path.join(job.directory, 'cancel'), '').catch(() => {});
    child.kill();
    const result = await readFile(path.join(job.directory, 'result.json'), 'utf8')
      .then(value => JSON.parse(value.replace(/^\uFEFF/, ''))).catch(() => null);
    const details = result?.error || await readFile(logPath, 'utf8').catch(() => '');
    if (details.trim()) throw new Error(error.message + '\n' + details.trim().slice(-2000), { cause: error });
    throw error;
  }
}
