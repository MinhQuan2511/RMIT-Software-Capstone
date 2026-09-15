/**
 * Atomic filesystem helpers.
 *
 * Writes go to a uniquely named temporary file in the same directory and are
 * then renamed over (replace) or hard-linked into place (create-only). A crash
 * mid-write therefore leaves at most a stray `.tmp-*` file, never a truncated
 * record under its real name.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const tmpName = (target) =>
  path.join(path.dirname(target), `.tmp-${path.basename(target)}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);

async function writeTemp(target, data) {
  const tmp = tmpName(target);
  const handle = await fsp.open(tmp, 'wx', 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return tmp;
}

/** Atomically replace `target` with `data`. */
async function writeFileAtomic(target, data) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const tmp = await writeTemp(target, data);
  try {
    await fsp.rename(tmp, target);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Atomically create `target` only if it does not exist.
 * @returns {Promise<boolean>} true if created, false if it already existed
 */
async function createFileExclusive(target, data) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const tmp = await writeTemp(target, data);
  try {
    await fsp.link(tmp, target);
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    if (err.code === 'EPERM' || err.code === 'ENOTSUP' || err.code === 'EXDEV') {
      // Filesystems without hard links: fall back to an exclusive open. The
      // window between the check and the write is unavoidable here.
      try {
        const handle = await fsp.open(target, 'wx', 0o600);
        try {
          await handle.writeFile(data);
          await handle.sync();
        } finally {
          await handle.close();
        }
        return true;
      } catch (inner) {
        if (inner.code === 'EEXIST') return false;
        throw inner;
      }
    }
    throw err;
  } finally {
    await fsp.rm(tmp, { force: true });
  }
}

async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, 'utf-8'));
}

/** Serialises async work per key within this process. */
function createKeyedMutex() {
  const tails = new Map();
  return async function withLock(key, fn) {
    const previous = tails.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    tails.set(key, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}

module.exports = { writeFileAtomic, createFileExclusive, readJson, createKeyedMutex };
