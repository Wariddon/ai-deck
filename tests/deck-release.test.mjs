import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { releaseMetadata, latestDeckRelease, downloadDeckRelease } from '../desktop/deck-release.mjs';
const body = Buffer.alloc(2000, 42);
const metadata = { schema: 1, version: '0.9.182', commit: 'a'.repeat(40), platform: 'win32', arch: 'x64', bytes: body.length,
  sha256: createHash('sha256').update(body).digest('hex'), electron: '45.2.3', name: 'AI-Deck-0.9.182-Windows-x64.zip',
  url: 'https://github.com/Wariddon/ai-deck/releases/download/v0.9.182/AI-Deck-0.9.182-Windows-x64.zip' };
test('release catalog binds stable tag, exact public repository, asset size and digest', async () => {
  const catalog = { tag_name: 'v0.9.182', assets: [{ name: 'ai-deck-update.json', browser_download_url: 'https://github.com/Wariddon/ai-deck/releases/download/v0.9.182/ai-deck-update.json' },
    { name: metadata.name, size: body.length, browser_download_url: metadata.url }] };
  assert.deepEqual(await latestDeckRelease({ fetcher: async url => new Response(JSON.stringify(url.includes('api.github.com') ? catalog : metadata)) }), metadata);
  for (const changed of [{ version: '1.0.0' }, { url: metadata.url.replace('Wariddon', 'attacker') }, { sha256: 'invalid' }, { bytes: 999999999 }, { arch: 'arm64' }]) assert.throws(() => releaseMetadata({ ...metadata, ...changed }));
  await assert.rejects(latestDeckRelease({ fetcher: async url => new Response(JSON.stringify(url.includes('api.github.com') ? { ...catalog, draft: true } : metadata)) }), /stable/);
});
test('release download streams and removes corrupt or oversized bytes, rejects foreign redirects', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aid-release-'));
  try {
    const file = await downloadDeckRelease(metadata, folder, { fetcher: async () => new Response(body) });
    assert.deepEqual(fs.readFileSync(file), body); fs.unlinkSync(file);
    await assert.rejects(downloadDeckRelease(metadata, folder, { fetcher: async () => new Response(Buffer.alloc(2000)) }), /SHA-256/);
    await assert.rejects(downloadDeckRelease(metadata, folder, { fetcher: async () => new Response(Buffer.alloc(2001)) }), /exceeded/);
    await assert.rejects(downloadDeckRelease(metadata, folder, { fetcher: async () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/a.zip' } }) }), /host/);
    assert.equal(fs.readdirSync(folder).length, 0);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
test('a release reader that ignores cancellation cannot retain startup or idle refresh', async () => {
  const controller = new AbortController();
  const pending = latestDeckRelease({ fetcher: () => new Promise(() => {}), signal: controller.signal });
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
});
