import {createReadStream} from 'node:fs';
import {lstat, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runGit} from './git-backup.mjs';

export function isGitUpdateSource(url) {
  return typeof url === 'string' && url.endsWith('.git');
}

export function gitAssetUrl(repo, revision, name) {
  return repo.slice(0, -4) + '/blob/' + revision + '/dynote/' + name;
}

export function gitAssetRevision(repo, url, name) {
  const revision = url.pathname.split('/').at(-3);
  if (!/^(?:[a-f\d]{40}|[a-f\d]{64})$/.test(revision) || url.href !== gitAssetUrl(repo, revision, name)) return null;
  return revision;
}

async function fetchRevision(dir, repo, ref) {
  await runGit(dir, ['init', '--quiet']);
  await runGit(dir, ['remote', 'add', 'origin', repo]);
  await runGit(dir, ['fetch', '--quiet', '--depth=1', '--no-tags', '--filter=blob:none', 'origin', ref]);
}

export async function readGitUpdateManifest(repo) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dynote-feed-'));
  try {
    await fetchRevision(dir, repo, 'HEAD');
    const revision = (await runGit(dir, ['rev-parse', 'FETCH_HEAD'])).stdout.trim();
    const result = await runGit(dir, ['show', revision + ':dynote/latest.json']);
    return {revision, manifest:JSON.parse(result.stdout)};
  } finally {
    await rm(dir, {recursive:true, force:true, maxRetries:3});
  }
}

export async function* readGitUpdateInstaller(repo, asset) {
  const revision = gitAssetRevision(repo, new URL(asset.url), asset.name);
  if (!revision || !/^Dynote-[a-z0-9._-]+-windows-x64-Setup\.exe$/i.test(asset.name)) throw new Error('사내 Git 설치 파일 경로가 올바르지 않습니다.');
  const dir = await mkdtemp(path.join(tmpdir(), 'dynote-installer-'));
  try {
    await fetchRevision(dir, repo, revision);
    const file = 'dynote/' + asset.name;
    const entry = (await runGit(dir, ['ls-tree', revision, '--', file])).stdout;
    if (!/^100(?:644|755) blob /.test(entry)) throw new Error('사내 dynote 폴더에서 설치 파일을 찾지 못했습니다.');
    const pointer = (await runGit(dir, ['show', revision + ':' + file])).stdout.trim().split(/\r?\n/);
    if (pointer[0] !== 'version https://git-lfs.github.com/spec/v1' || !pointer.includes('oid '+asset.digest) || !pointer.includes('size '+asset.size)) {
      throw new Error('Git LFS 설치 파일 정보가 latest.json과 일치하지 않습니다.');
    }
    await runGit(dir, ['lfs', 'version']).catch(() => { throw new Error('사내 Git 설치 파일을 받으려면 Git LFS가 필요합니다.'); });
    await writeFile(path.join(dir,'.git','info','attributes'), file+' filter=lfs -text\n');
    await runGit(dir, [
      '-c','filter.lfs.process=git-lfs filter-process', '-c','filter.lfs.required=true',
      '-c','lfs.fetchinclude=', '-c','lfs.fetchexclude=', 'checkout',revision,'--',file,
    ], {
      env:{...process.env, GIT_LFS_SKIP_SMUDGE:'0'}, timeout:30*60*1000,
    });
    const local = path.join(dir, file);
    if ((await lstat(local)).size !== asset.size) throw new Error('Git LFS 설치 파일을 받지 못했습니다. 사내 Git 권한과 LFS 설정을 확인해 주세요.');
    yield* createReadStream(local);
  } finally {
    await rm(dir, {recursive:true, force:true, maxRetries:3});
  }
}
