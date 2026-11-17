import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { abortableRead } from './abortable-read.cjs';

export const releaseRepository = 'Wariddon/ai-deck';
export const releasePage = 'https://github.com/' + releaseRepository + '/releases/latest';
export const releaseApi = 'https://api.github.com/repos/' + releaseRepository + '/releases/latest';
const maxArchive = 700 * 1024 * 1024;
const versionPattern = /^0\.9\.[1-9][0-9]{0,5}$/u;
export function releaseMetadata(value) {
  const m = value;
  if (!m || m.schema !== 1 || !versionPattern.test(m.version) || m.platform !== 'win32' || m.arch !== 'x64' ||
      !/^[a-f0-9]{40}$/u.test(m.commit) || !/^[a-f0-9]{64}$/u.test(m.sha256) ||
      !Number.isSafeInteger(m.bytes) || m.bytes < 1000 || m.bytes > maxArchive || !/^\d+\.\d+\.\d+$/u.test(m.electron)) throw Error('Unsupported AI Deck release metadata.');
  const name = 'AI-Deck-' + m.version + '-Windows-x64.zip';
  const url = 'https://github.com/' + releaseRepository + '/releases/download/v' + m.version + '/' + encodeURIComponent(name);
  if (m.name !== name || m.url !== url) throw Error('Release asset does not match its version.');
  return { schema: 1, version: m.version, platform: 'win32', arch: 'x64', commit: m.commit, sha256: m.sha256,
    bytes: m.bytes, electron: m.electron, name, url };
}
function allowedUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !['github.com', 'api.github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(u.hostname)) throw Error('Unsupported release download host.');
  return u.href;
}
async function response(url, fetcher, signal) {
  for (let n = 0; n < 5; n++) {
    const res = await abortableRead(() => fetcher(allowedUrl(url), { signal, redirect: 'manual', credentials: 'omit', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AI-Deck-Updater' } }), signal);
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location'); await res.body?.cancel();
      if (!location) throw Error('Release redirect is missing.');
      url = new URL(location, url).href; continue;
    }
    if (!res.ok) { await res.body?.cancel(); throw Error('Release service is unavailable (' + res.status + ').'); }
    return res;
  }
  throw Error('Too many release redirects.');
}
async function json(url, fetcher, signal) {
  const res = await response(url, fetcher, signal); const parts = []; let bytes = 0;
  try { for await (const b of res.body) { bytes += b.length; if (bytes > 256 * 1024) throw Error('Release metadata is too large.'); parts.push(Buffer.from(b)); } }
  finally { await res.body?.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
export async function latestDeckRelease({ fetcher = fetch, signal } = {}) {
  signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
  const release = await json(releaseApi, fetcher, signal);
  if (release.draft || release.prerelease || !/^v0\.9\.[1-9][0-9]{0,5}$/u.test(release.tag_name)) throw Error('No stable AI Deck release.');
  const base = 'https://github.com/' + releaseRepository + '/releases/download/' + release.tag_name + '/';
  const asset = release.assets?.find(a => a.name === 'ai-deck-update.json' && a.browser_download_url === base + 'ai-deck-update.json');
  if (!asset) throw Error('This release has no verified update catalog.');
  const metadata = releaseMetadata(await json(asset.browser_download_url, fetcher, signal));
  if ('v' + metadata.version !== release.tag_name || !release.assets?.some(a => a.name === metadata.name && a.size === metadata.bytes && a.browser_download_url === metadata.url)) throw Error('The release assets are incomplete.');
  return metadata;
}
export async function downloadDeckRelease(metadata, directory, { fetcher = fetch, signal } = {}) {
  metadata = releaseMetadata(metadata);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(fs.realpathSync.native(directory), randomUUID() + '.zip');
  const hash = createHash('sha256'); let bytes = 0;
  signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000);
  try {
    const res = await response(metadata.url, fetcher, signal);
    await pipeline(Readable.fromWeb(res.body), new Transform({ transform(chunk, encoding, cb) {
      bytes += chunk.length;
      if (bytes > metadata.bytes) return cb(Error('Release download exceeded its declared size.'));
      hash.update(chunk); cb(null, chunk);
    } }), fs.createWriteStream(file, { flags: 'wx' }), { signal });
    if (bytes !== metadata.bytes || hash.digest('hex') !== metadata.sha256) throw Error('Release download failed its SHA-256 check.');
    return file;
  } catch (error) { fs.rmSync(file, { force: true }); throw error; }
}
