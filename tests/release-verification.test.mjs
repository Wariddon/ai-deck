import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { writeReleaseManifest, verifyRelease, archiveHash } from '../scripts/release-verification.mjs';
import { releaseGuide } from '../scripts/release-guide.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), app = path.join(root, 'app');
  fs.mkdirSync(path.join(source, 'desktop'), { recursive: true }); fs.mkdirSync(app);
  const version = '0.9.175';
  fs.writeFileSync(path.join(source, 'README.md'), `Desktop ${version}\nLatest update · ${version}`);
  for (const [file, value] of [['package.json', JSON.stringify({ version })], ['main.cjs', 'module.exports = 42;']]) {
    fs.writeFileSync(path.join(source, 'desktop', file), value); fs.writeFileSync(path.join(app, file), value);
  }
  return { root, source, app };
}

test('release files and source hashes are reproducible without machine paths', t => {
  const { source, app } = fixture(t);
  const first = writeReleaseManifest(app, source), text = fs.readFileSync(path.join(app, 'release-manifest.json'), 'utf8');
  assert.equal(first.version, '0.9.175'); assert.equal(first.files, 2);
  assert.deepEqual(writeReleaseManifest(app, source), first);
  assert.equal(fs.readFileSync(path.join(app, 'release-manifest.json'), 'utf8'), text);
  assert.ok(!text.includes(source) && !text.includes(process.env.USERPROFILE));
});

test('release validation rejects changed, missing and injected private files', t => {
  const { source, app } = fixture(t); writeReleaseManifest(app, source);
  fs.writeFileSync(path.join(app, 'main.cjs'), 'tampered'); assert.throws(() => verifyRelease(app), /hashes differ/);
  fs.writeFileSync(path.join(app, 'main.cjs'), 'module.exports = 42;');
  for (const name of ['local-defaults.json', 'workspace-state.json', 'auth.json', '.env']) {
    fs.writeFileSync(path.join(app, name), '{}'); assert.throws(() => verifyRelease(app), /Private profile/); fs.unlinkSync(path.join(app, name));
  }
  fs.unlinkSync(path.join(app, 'main.cjs')); assert.throws(() => verifyRelease(app), /hashes differ/);
});

test('packaging refuses mismatched README, version or source bytes', t => {
  const { source, app } = fixture(t);
  fs.writeFileSync(path.join(app, 'main.cjs'), 'old source'); assert.throws(() => writeReleaseManifest(app, source), /Stale packaged source/);
  fs.writeFileSync(path.join(app, 'main.cjs'), 'module.exports = 42;');
  fs.writeFileSync(path.join(app, 'package.json'), '{"version":"0.9.174"}'); assert.throws(() => writeReleaseManifest(app, source), /version differs/);
  fs.writeFileSync(path.join(source, 'README.md'), 'Desktop 0.9.174'); assert.throws(() => writeReleaseManifest(app, source), /README/);
});

test('archive digest streams the actual bytes and guide describes only current menus', async t => {
  const { root } = fixture(t), archive = path.join(root, 'fixture.zip'), bytes = Buffer.alloc(2 * 1024 * 1024, 17);
  fs.writeFileSync(archive, bytes);
  assert.equal(await archiveHash(archive), createHash('sha256').update(bytes).digest('hex'));
  const guide = releaseGuide('0.9.175');
  assert.match(guide, /thirteen categories/); assert.match(guide, /files are not included/);
  assert.doesNotMatch(guide, /Scheduled|Team inbox|\/inbox|Pull sessions|Team settings/);
  assert.match(releaseGuide('0.9.175', { voice: true }), /files are included/);
});
