/**
 * Identity of the running generator, computed once at start-up without
 * spawning any process: a SHA-256 over the backend source files that shape the
 * output, plus the git HEAD read from .git (which does NOT tell whether the
 * working tree is dirty — the file digest does).
 *
 * No host name, user name or absolute path is included.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { sha256 } = require('./hash');

function listFiles(dir, root, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, root, out);
    else if (/\.(js|json)$/.test(entry.name)) out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out;
}

function readGitHead(repoRoot) {
  try {
    const head = fs.readFileSync(path.join(repoRoot, '.git', 'HEAD'), 'utf-8').trim();
    const ref = head.match(/^ref: (refs\/[A-Za-z0-9._/-]+)$/);
    if (!ref) return { head: /^[a-f0-9]{40}$/.test(head) ? head : null, branch: null };
    const refFile = path.join(repoRoot, '.git', ...ref[1].split('/'));
    if (fs.existsSync(refFile)) return { head: fs.readFileSync(refFile, 'utf-8').trim(), branch: ref[1].replace('refs/heads/', '') };
    const packed = fs.readFileSync(path.join(repoRoot, '.git', 'packed-refs'), 'utf-8');
    const line = packed.split('\n').find((l) => l.endsWith(` ${ref[1]}`));
    return { head: line ? line.split(' ')[0] : null, branch: ref[1].replace('refs/heads/', '') };
  } catch {
    return { head: null, branch: null };
  }
}

function computeSourceIdentity(repoRoot) {
  const backend = path.join(repoRoot, 'backend');
  const files = [
    ...listFiles(path.join(backend, 'services'), repoRoot, []),
    ...listFiles(path.join(backend, 'routes'), repoRoot, []),
    'backend/app.js', 'backend/package.json', 'backend/package-lock.json',
  ].filter((f) => fs.existsSync(path.join(repoRoot, f))).sort();
  const lines = files.map((f) => `${sha256(fs.readFileSync(path.join(repoRoot, f)))}  ${f}`);
  const pkg = JSON.parse(fs.readFileSync(path.join(backend, 'package.json'), 'utf-8'));
  const git = readGitHead(repoRoot);
  return {
    backendSourceDigestSha256: sha256(lines.join('\n')),
    backendSourceFileCount: files.length,
    digestScope: 'SHA-256 over "<sha256>  <path>" lines of backend/services/**, backend/routes/**, backend/app.js and the backend package manifests',
    backendPackage: `${pkg.name}@${pkg.version}`,
    git: { ...git, dirtyStateKnown: false, note: 'HEAD alone does not identify uncommitted changes; use the source digest.' },
    runtime: { node: process.version, platform: os.platform(), release: os.release(), arch: os.arch() },
  };
}

module.exports = { computeSourceIdentity };
