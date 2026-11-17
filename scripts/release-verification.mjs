import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const manifestName = 'release-manifest.json';
const privateNames = new Set(['.git', '.codex', '.claude', 'workspace-state.json', 'auth.json', 'credentials.json',
  'local-defaults.json', 'native-text-drafts.json', 'draft-checkpoints', 'running-checkpoints', 'local storage', 'session storage']);
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function entries(app) {
  const root = fs.realpathSync.native(app), files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name), relative = path.relative(root, file).split(path.sep).join('/');
      if (privateNames.has(entry.name.toLowerCase()) || /^\.env(?:\.|$)/iu.test(entry.name)) throw Error('Private profile content in portable package: ' + relative);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || fs.realpathSync.native(file) !== file) throw Error('Linked release content: ' + relative);
      if (stat.isDirectory()) walk(file);
      else if (!stat.isFile() || stat.nlink > 1) throw Error('Unsupported release file: ' + relative);
      else if (relative !== manifestName) files.push({ path: relative, bytes: stat.size, sha256: sha256(file) });
    }
  }
  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function verifyRelease(app) {
  const manifest = JSON.parse(fs.readFileSync(path.join(app, manifestName), 'utf8'));
  const version = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).version;
  if (manifest.schema !== 1 || version !== manifest.version || JSON.stringify(entries(app)) !== JSON.stringify(manifest.files)) {
    throw Error('Release version or file hashes differ from the manifest.');
  }
  return { version, files: manifest.files.length, bytes: manifest.files.reduce((n, f) => n + f.bytes, 0) };
}

export function writeReleaseManifest(app, source) {
  const version = JSON.parse(fs.readFileSync(path.join(source, 'desktop/package.json'), 'utf8')).version;
  const readme = fs.readFileSync(path.join(source, 'README.md'), 'utf8');
  if (!readme.includes('Desktop ' + version) || !readme.includes('Latest update · ' + version)) throw Error('README and desktop release versions differ.');
  if (JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).version !== version) throw Error('Staged release version differs from source.');
  const sources = {};
  for (const name of fs.readdirSync(path.join(source, 'desktop'))) {
    if (!/\.(?:cjs|mjs|ps1)$|^package\.json$/u.test(name)) continue;
    const original = path.join(source, 'desktop', name), packaged = path.join(app, name);
    if (!fs.existsSync(packaged)) throw Error('Missing source module in package: ' + name);
    const hash = sha256(original);
    if (name !== 'native-hooks.cjs' && hash !== sha256(packaged)) throw Error('Stale packaged source: ' + name);
    sources['desktop/' + name] = hash;
  }
  sources['README.md'] = sha256(path.join(source, 'README.md'));
  const manifest = { schema: 1, version, sources, files: entries(app) };
  fs.writeFileSync(path.join(app, manifestName), JSON.stringify(manifest, null, 2));
  return verifyRelease(app);
}

export async function archiveHash(archive) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(archive)) hash.update(chunk);
  return hash.digest('hex');
}
