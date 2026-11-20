import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { spawn } from 'node:child_process';
import { stageUpdate, launchUpdate } from '../electron/update-installer.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'dynote-install-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('verified setup'), file = path.join(directory, 'download.exe');
  await writeFile(file, bytes);
  return { directory, file, tag: 'v2.0.0', executable: 'C:\\Users\\Example User\\한글\\Dynote.exe', parentPid: 1234,
    asset: { size: bytes.length, digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex') } };
}
test('installer stages independent verified bytes and a literal manifest outside the app', async t => {
  const input = await fixture(t), job = await stageUpdate(input);
  const manifest = JSON.parse(await readFile(job.manifest, 'utf8'));
  assert.equal(manifest.executable, input.executable); assert.equal(manifest.parentPid, 1234);
  assert.deepEqual(await readFile(manifest.installer), await readFile(input.file));
  await writeFile(input.file, 'later change');
  assert.equal(await readFile(manifest.installer, 'utf8'), 'verified setup');
  assert.ok((await readFile(path.join(job.directory, 'install.ps1'), 'utf8')).includes('WaitForExit'));
});
test('corrupt staging never creates a runnable job and removes partial files', async t => {
  const input = await fixture(t); await writeFile(input.file, 'corrupt setup!');
  await assert.rejects(stageUpdate(input), /검증/);
  assert.deepEqual(await readdir(path.join(input.directory, 'install')), []);
});
test('launcher waits for helper acknowledgment and passes paths as arguments without a shell', async t => {
  const job = await stageUpdate(await fixture(t)); let released = false;
  await launchUpdate(job, { spawnProcess(command, args, options) {
    assert.equal(options.shell, false); assert.equal(options.detached, true);
    assert.equal(args.at(-1), job.manifest); assert.ok(command.endsWith('powershell.exe'));
    const child = new EventEmitter(); child.unref = () => { released = true; }; child.kill = () => assert.fail('should not kill acknowledged helper');
    void writeFile(path.join(job.directory, 'ready'), 'ready');
    return child;
  }});
  assert.equal(released, true);
});
test('failed or unresponsive helper is canceled before the app may quit', async t => {
  for (const fails of [true, false]) {
    const job = await stageUpdate(await fixture(t)); let killed = false;
    await assert.rejects(launchUpdate(job, { timeout: 70, spawnProcess() {
      const child = new EventEmitter(); child.kill = () => { killed = true; };
      if (fails) queueMicrotask(() => child.emit('error', new Error('blocked by policy')));
      return child;
    }}), fails ? /policy/ : /시작하지/);
    assert.equal(killed, true); assert.equal(await readFile(path.join(job.directory, 'cancel'), 'utf8'), '');
  }
});
test('launcher reports the native helper failure from its result file', async t => {
  const job = await stageUpdate(await fixture(t));
  await writeFile(path.join(job.directory, 'result.json'), '\uFEFF' + JSON.stringify({ installed: false, error: 'Native startup failure' }));
  await assert.rejects(launchUpdate(job, { spawnProcess() {
    const child = new EventEmitter(); child.kill = () => {};
    queueMicrotask(() => child.emit('exit', 0));
    return child;
  }}), /Native startup failure/);
});
test('Windows helper acknowledges startup and cancels without running an installer', { skip: process.platform !== 'win32' }, async t => {
  const input = await fixture(t);
  const parent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await once(parent, 'spawn');
  const job = await stageUpdate({ ...input, parentPid: parent.pid });
  let helper;
  try {
    await launchUpdate(job, { spawnProcess(...args) { helper = spawn(...args); return helper; } });
    assert.equal((await readFile(path.join(job.directory, 'ready'), 'utf8')).trim(), 'ready');
  } catch (error) {
    console.error('Windows helper diagnostics:', error.message, await readdir(job.directory));
    for (const name of ['helper.log', 'result.json']) console.error(name, await readFile(path.join(job.directory, name), 'utf8').catch(() => '(missing)'));
    throw error;
  } finally {
    await writeFile(path.join(job.directory, 'cancel'), '');
    const parentExit = once(parent, 'exit');
    const helperExit = helper && helper.exitCode === null && helper.signalCode === null
      ? once(helper, 'exit', { signal: AbortSignal.timeout(10000) }) : Promise.resolve();
    parent.kill();
    await parentExit;
    await helperExit;
  }
});
