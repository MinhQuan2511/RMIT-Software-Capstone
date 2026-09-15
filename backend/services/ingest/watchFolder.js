/**
 * Watched folder: approved-root configuration and a settle-then-ingest scan.
 *
 * Lifecycle: there is no background watcher. A scan runs only when a client
 * calls it — the Acquire page polls every 3 s while it is open with the
 * watched-folder method selected. Navigating away stops ingestion.
 *
 * A file is ingested only after its size AND modification time have been
 * unchanged for at least `settleMs` across two or more scans, and after the
 * size/mtime observed immediately after reading still match. Ingestion copies
 * the bytes into the immutable source store (content-addressed), so an
 * unchanged file is idempotent and a changed file becomes a new source. Nothing
 * in the watched folder is modified or deleted.
 *
 * Status semantics returned per file:
 *   Writing  — not yet stable (new, growing, or changed since last scan)
 *   Ready    — stored as a new source during this scan
 *   Ingested — already stored on an earlier scan (same bytes)
 *   Ignored  — not a .txt seam descriptor, a symlink, or not a regular file
 *   Error    — too large, unreadable or vanished mid-read
 */

const fs = require('fs');
const path = require('path');
const { looksLikeFeatureText } = require('../parsers/curveParser');
const { AppError } = require('../util/errors');
const { writeFileAtomic, createKeyedMutex } = require('../util/atomicFs');

const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);

function within(child, parent) {
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

function createWatchFolderService({ store, previewSource, config, clock = Date.now, fsp = fs.promises }) {
  const state = new Map(); // realFolder -> Map(name -> observation)
  const lock = createKeyedMutex();

  async function readConfigured() {
    try {
      const parsed = JSON.parse(await fsp.readFile(config.watchConfigPath, 'utf-8'));
      if (parsed && typeof parsed.watchFolder === 'string' && parsed.watchFolder.trim()) return parsed.watchFolder.trim();
    } catch { /* fall through to default */ }
    return config.defaultWatchFolder;
  }

  const resolveInput = (value) => path.resolve(path.isAbsolute(value) ? value : path.join(config.repoRoot, value));

  async function realRoots() {
    const out = [];
    for (const root of config.watchRoots) {
      try { out.push({ root, real: await fsp.realpath(root), exists: true }); } catch { out.push({ root, real: null, exists: false }); }
    }
    return out;
  }

  const displayRoot = (p) => {
    const rel = path.relative(config.repoRoot, p);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : p;
  };

  /** Resolves and checks a folder against approved roots. Never follows a symlink out of a root. */
  async function checkFolder(value) {
    const resolved = resolveInput(value);
    let real;
    try {
      real = await fsp.realpath(resolved);
    } catch {
      return { ok: false, resolved, reason: 'not_found' };
    }
    const stat = await fsp.stat(real).catch(() => null);
    if (!stat || !stat.isDirectory()) return { ok: false, resolved, reason: 'not_directory' };
    const roots = await realRoots();
    const root = roots.find((r) => r.real && within(real, r.real));
    if (!root) return { ok: false, resolved, reason: 'outside_approved_roots' };
    const demoReal = [];
    for (const d of config.demoRoots) {
      try { demoReal.push(await fsp.realpath(d)); } catch { /* missing demo root */ }
    }
    return { ok: true, resolved, real, demo: demoReal.some((d) => within(real, d)) };
  }

  const REASON_TEXT = {
    not_found: 'The folder does not exist.',
    not_directory: 'The path is not a directory.',
    outside_approved_roots: 'The folder is outside the approved watch roots. Add a root with VD_WATCH_ROOTS in the backend environment.',
  };

  return {
    async status() {
      const configured = await readConfigured();
      const check = await checkFolder(configured);
      const roots = await realRoots();
      return {
        configured,
        display: displayRoot(check.resolved),
        exists: check.ok || check.reason === 'outside_approved_roots',
        approved: check.ok,
        demoFolder: !!check.demo,
        problem: check.ok ? null : REASON_TEXT[check.reason],
        approvedRoots: roots.map((r) => ({ display: displayRoot(r.root), exists: r.exists })),
        lifecycle: 'Polled by the Acquire page every 3 s while it is open with the watched-folder method selected. No background watcher runs.',
      };
    },

    async setFolder(value) {
      if (typeof value !== 'string' || !value.trim() || value.length > 1024 || value.includes('\0')) {
        throw new AppError(422, 'WATCH_FOLDER_INVALID', 'watchFolder must be a non-empty path.');
      }
      const check = await checkFolder(value.trim());
      if (!check.ok) throw new AppError(422, 'WATCH_FOLDER_REJECTED', REASON_TEXT[check.reason]);
      const rel = path.relative(config.repoRoot, check.resolved);
      const stored = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : check.resolved;
      await writeFileAtomic(config.watchConfigPath, `${JSON.stringify({ watchFolder: stored }, null, 2)}\n`);
      return this.status();
    },

    async scan() {
      const configured = await readConfigured();
      const check = await checkFolder(configured);
      if (!check.ok) {
        return { ok: false, folder: displayRoot(check.resolved), problem: REASON_TEXT[check.reason], files: [], scannedAt: new Date(clock()).toISOString() };
      }
      return lock(check.real, async () => {
        const seen = state.get(check.real) || new Map();
        state.set(check.real, seen);
        const now = clock();
        let entries;
        try {
          entries = await fsp.readdir(check.real, { withFileTypes: true });
        } catch (err) {
          return { ok: false, folder: displayRoot(check.resolved), problem: `The folder could not be read (${err.code || 'error'}).`, files: [], scannedAt: new Date(now).toISOString() };
        }
        const truncated = entries.length > config.limits.watchMaxEntries;
        entries = entries.slice(0, config.limits.watchMaxEntries);
        const files = [];
        const present = new Set();

        for (const entry of entries) {
          const name = entry.name;
          if (!name.toLowerCase().endsWith('.txt')) continue;
          present.add(name);
          const full = path.join(check.real, name);
          const row = { name, sizeBytes: null, modified: null, status: 'Ignored', sourceId: null, sourceKind: null, message: null, preview: null };
          files.push(row);

          if (entry.isSymbolicLink()) { row.message = 'Symbolic links are not followed.'; continue; }
          if (!entry.isFile()) { row.message = 'Not a regular file.'; continue; }

          let st;
          try { st = await fsp.stat(full); } catch (err) {
            row.status = 'Error';
            row.message = err.code === 'ENOENT' ? 'The file disappeared during the scan.' : `Could not read file metadata (${err.code || 'error'}).`;
            seen.delete(name);
            continue;
          }
          row.sizeBytes = st.size;
          row.modified = st.mtime.toISOString();

          if (st.size > config.limits.watchMaxFileBytes) {
            row.status = 'Error';
            row.message = `File is larger than the ${config.limits.watchMaxFileBytes} byte limit.`;
            continue;
          }

          const prev = seen.get(name);
          const unchanged = prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs;
          const obs = unchanged ? prev : { size: st.size, mtimeMs: st.mtimeMs, changedAt: now, sourceId: null };
          seen.set(name, obs);

          if (!unchanged || now - obs.changedAt < config.limits.watchSettleMs) {
            row.status = 'Writing';
            row.message = 'Waiting for size and modification time to settle.';
            continue;
          }
          if (obs.ignored) { row.message = 'No curve: or arc_start: key found.'; continue; }
          if (obs.sourceId) {
            const meta = await store.getSource(obs.sourceId).catch(() => null);
            if (meta) {
              row.status = 'Ingested';
              row.sourceId = meta.id;
              row.sourceKind = meta.sourceKind;
              row.preview = obs.preview || null;
              continue;
            }
          }

          let buf;
          try {
            buf = await fsp.readFile(full);
            const after = await fsp.stat(full);
            if (after.size !== st.size || after.mtimeMs !== st.mtimeMs || buf.length !== st.size) {
              seen.set(name, { size: after.size, mtimeMs: after.mtimeMs, changedAt: now, sourceId: null });
              row.status = 'Writing';
              row.message = 'The file changed while it was being read.';
              continue;
            }
          } catch (err) {
            row.status = 'Error';
            row.message = err.code === 'ENOENT' ? 'The file disappeared during the scan.' : `Could not read the file (${err.code || 'error'}).`;
            seen.delete(name);
            continue;
          }

          const text = buf.toString('utf-8');
          if (!looksLikeFeatureText(text)) {
            obs.ignored = true;
            row.message = 'No curve: or arc_start: key found.';
            continue;
          }
          const { source, created } = await store.putSource({
            content: buf,
            kind: check.demo ? 'demo' : 'watch_folder',
            name,
            contentType: 'feature-text',
            channelDetail: { folder: displayRoot(check.resolved) },
          });
          const preview = previewSource(source, buf);
          obs.sourceId = source.id;
          obs.preview = { ok: preview.ok, seamType: preview.seamType, errorCount: preview.diagnostics.filter((d) => d.severity === 'error').length, firstError: (preview.diagnostics.find((d) => d.severity === 'error') || {}).message || null };
          row.status = created ? 'Ready' : 'Ingested';
          row.sourceId = source.id;
          row.sourceKind = source.sourceKind;
          row.preview = obs.preview;
        }
        for (const name of [...seen.keys()]) if (!present.has(name)) seen.delete(name);

        files.sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));
        return {
          ok: true,
          folder: displayRoot(check.resolved),
          demoFolder: check.demo,
          files,
          truncated,
          scannedAt: new Date(now).toISOString(),
        };
      });
    },
  };
}

module.exports = { createWatchFolderService, within };
