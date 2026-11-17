const fs = require('node:fs/promises'), path = require('node:path');
const { createHash } = require('node:crypto');
const { eligibleReviewPath, shareableDiffPath } = require('./review-snapshot.cjs');

// Hash bounded local artifacts. Images are recorded bytes, never a visual verdict.
async function readEvidenceArtifacts(contracts, cwd) {
  const refs = contracts.flatMap(contract => contract.evidenceRefs ?? []);
  const jsonPaths = new Set(refs.flatMap(ref => (ref.assertions ?? []).map(assertion => assertion.path)));
  const artifacts = new Map(), documents = new Map();
  const physicalRoot = await fs.realpath(cwd).catch(() => null);
  let remaining = 4 * 1024 * 1024;
  for (const relative of new Set(refs.flatMap(ref => ref.paths))) {
    const missing = () => artifacts.set(relative, { path: relative, status: 'unverified' });
    const visible = shareableDiffPath(relative) && !relative.split('/').some(part => part.startsWith('.'));
    const image = visible && /\.(?:png|jpe?g|webp)$/iu.test(relative);
    if (artifacts.size >= 12 || !eligibleReviewPath(relative) && !(visible && /\.json$/iu.test(relative)) && !image) { missing(); continue; }
    try {
      if (!physicalRoot) throw Error('Evidence folder unavailable');
      const filename = path.resolve(cwd, relative), real = await fs.realpath(filename), local = path.relative(physicalRoot, real);
      if (path.isAbsolute(local) || local === '..' || local.startsWith('..' + path.sep) || !(await fs.lstat(filename)).isFile()) throw Error('Outside evidence scope');
      const handle = await fs.open(real, 'r');
      try {
        const before = await handle.stat(), maximum = image ? 2 * 1024 * 1024 : 512 * 1024;
        if (!before.isFile() || before.nlink > 1 || before.size > maximum || before.size > remaining) throw Error('Evidence byte limit or linked artifact');
        const bytes = Buffer.alloc(before.size + 1), { bytesRead } = await handle.read(bytes, 0, bytes.length, 0), after = await handle.stat();
        remaining -= bytesRead;
        if (bytesRead !== before.size || before.mtimeMs !== after.mtimeMs || before.size !== after.size || before.ino !== after.ino || await fs.realpath(filename) !== real) throw Error('Artifact changed');
        artifacts.set(relative, { path: relative, status: 'recorded', sha256: createHash('sha256').update(bytes.subarray(0, bytesRead)).digest('hex') });
        if (jsonPaths.has(relative)) {
          try { documents.set(relative, { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead))) }); }
          catch { documents.set(relative, { error: true }); }
        }
      } finally { await handle.close(); }
    } catch { missing(); }
  }
  return { artifacts, documents };
}

async function captureWorkArtifacts(contracts, cwd) {
  const { artifacts } = await readEvidenceArtifacts(contracts, cwd);
  return { files: [...artifacts.values()], host: { platform: process.platform, arch: process.arch }, observedAt: new Date().toISOString() };
}

const artifactsMatch = (paths, saved, current) => paths.every(file => saved.get(file)?.status === 'recorded' &&
  current.get(file)?.status === 'recorded' && saved.get(file).sha256 === current.get(file).sha256);

module.exports = { readEvidenceArtifacts, captureWorkArtifacts, artifactsMatch };
