import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { archiveHash } from './release-verification.mjs';
import { releaseMetadata, releaseRepository } from '../desktop/deck-release.mjs';

// Credentials remain in process memory; this script never logs HTTP bodies or tokens.
export async function publishRelease({ root, archive, token, fetcher = fetch }) {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'desktop/package.json'), 'utf8')).version;
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const tag = 'v' + version;
  if (process.env.GITHUB_REF && process.env.GITHUB_REF !== 'refs/tags/' + tag) throw Error('Release tag and package version differ.');
  if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()) throw Error('Commit the release source before publishing.');
  const name = 'AI-Deck-' + version + '-Windows-x64.zip';
  const metadata = releaseMetadata({ schema: 1, version, commit, platform: 'win32', arch: 'x64',
    bytes: fs.statSync(archive).size, sha256: await archiveHash(archive), name,
    electron: fs.readFileSync(path.join(root, 'node_modules/electron/dist/version'), 'utf8').trim(),
    url: 'https://github.com/' + releaseRepository + '/releases/download/' + tag + '/' + encodeURIComponent(name) });
  if (!token) throw Error('A GitHub release credential is required.');
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'AI-Deck-Release' };
  async function api(route, options = {}, allow404 = false) {
    const res = await fetcher('https://api.github.com/repos/' + releaseRepository + route, { ...options, headers: { ...headers, 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(30000) });
    if (allow404 && res.status === 404) return null;
    if (!res.ok) throw Error('GitHub release request failed (' + res.status + ').');
    return res.status === 204 ? null : res.json();
  }
  let release = await api('/releases/tags/' + tag, {}, true);
  if (release && !release.draft) {
    const ok = release.assets?.some(a => a.name === name && a.size === metadata.bytes && (!a.digest || a.digest === 'sha256:' + metadata.sha256));
    if (ok && release.assets.some(a => a.name === 'ai-deck-update.json')) return { url: release.html_url, version, alreadyPublished: true };
    throw Error('A published release already exists with different or missing assets.');
  }
  if (!release) release = await api('/releases', { method: 'POST', body: JSON.stringify({ tag_name: tag, target_commitish: commit, name: 'AI Deck ' + version, draft: true,
    body: 'Portable Windows x64 release. Download the ZIP, extract it, and run AI Deck.exe. Your local account credentials and chat profiles are not included.\n\nSHA-256: `' + metadata.sha256 + '`\n\nSource: `' + commit + '`\n\nThe update catalog is used by AI Deck’s update bell.' }) });
  const base = release.upload_url?.split('{')[0];
  if (base !== 'https://uploads.github.com/repos/' + releaseRepository + '/releases/' + release.id + '/assets') throw Error('Unexpected GitHub upload location.');
  for (const a of release.assets ?? []) if ([name, 'ai-deck-update.json'].includes(a.name)) await api('/releases/assets/' + a.id, { method: 'DELETE' });
  for (const asset of [{ name, body: fs.createReadStream(archive), bytes: metadata.bytes, type: 'application/zip' },
    { name: 'ai-deck-update.json', body: JSON.stringify(metadata, null, 2), bytes: Buffer.byteLength(JSON.stringify(metadata, null, 2)), type: 'application/json' }]) {
    const res = await fetcher(base + '?name=' + encodeURIComponent(asset.name), { method: 'POST', body: asset.body, duplex: 'half',
      signal: AbortSignal.timeout(300000), headers: { ...headers, 'Content-Type': asset.type, 'Content-Length': String(asset.bytes) } });
    if (!res.ok) throw Error('Release asset upload failed (' + res.status + '). The release remains a draft.');
    const saved = await res.json();
    if (saved.state !== 'uploaded' || saved.name !== asset.name || saved.size !== asset.bytes || asset.type === 'application/zip' && saved.digest && saved.digest !== 'sha256:' + metadata.sha256) throw Error('GitHub did not verify the uploaded asset.');
  }
  const published = await api('/releases/' + release.id, { method: 'PATCH', body: JSON.stringify({ draft: false, make_latest: 'true' }) });
  return { url: published.html_url, version, sha256: metadata.sha256 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const archive = process.argv[2];
  if (!archive) throw Error('Pass the packaged Windows ZIP.');
  let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    const credential = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', GCM_GUI_PROMPT: 'false' } });
    token = /^password=(.+)$/mu.exec(credential)?.[1].trim();
  }
  console.log(JSON.stringify(await publishRelease({ root: process.cwd(), archive, token })));
}
