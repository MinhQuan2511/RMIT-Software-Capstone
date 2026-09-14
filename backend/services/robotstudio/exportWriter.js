/**
 * Saves a stored module to the export directory under a generated name.
 *
 * The browser never supplies a filename or content. The basename is derived
 * from the job ID, revision and output hash; it is checked against a strict
 * pattern and Windows reserved device names; the directory is canonicalised
 * and the final path must be a direct child of it. Files are created
 * exclusively and are never overwritten: if a file with the name already
 * exists it must contain exactly the same bytes.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { createFileExclusive } = require('../util/atomicFs');
const { sha256 } = require('../util/hash');
const { AppError } = require('../util/errors');

const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}\.mod$/;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

function safeModuleFileName(jobId, revision, outputSha256) {
  return `VD_${String(jobId).slice(4, 12)}_r${revision}_${String(outputSha256).slice(0, 8)}.mod`;
}

function validateFileName(name) {
  if (typeof name !== 'string' || !SAFE_NAME.test(name)) return false;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return false;
  return !RESERVED.test(name.slice(0, -4));
}

async function saveModuleFile({ exportDir, fileName, code, expectedSha256 }) {
  if (!validateFileName(fileName)) throw new AppError(422, 'EXPORT_NAME_INVALID', 'Generated file name failed validation.');
  if (sha256(code) !== expectedSha256) throw new AppError(500, 'MODULE_INTEGRITY', 'Module bytes do not match the expected hash.');

  let realDir;
  try {
    realDir = await fsp.realpath(exportDir);
  } catch {
    throw new AppError(409, 'EXPORT_DIR_MISSING', 'The export folder (Downloads by default) does not exist. Set VD_EXPORT_DIR or create the folder.');
  }
  const st = await fsp.stat(realDir);
  if (!st.isDirectory()) throw new AppError(409, 'EXPORT_DIR_NOT_DIRECTORY', 'The export path is not a folder.');

  const target = path.join(realDir, fileName);
  if (path.dirname(target) !== realDir || path.basename(target) !== fileName) {
    throw new AppError(422, 'EXPORT_PATH_ESCAPE', 'Resolved export path escaped the export folder.');
  }

  let created;
  try {
    created = await createFileExclusive(target, code);
  } catch (err) {
    const code_ = err.code === 'EACCES' || err.code === 'EPERM' ? 'EXPORT_PERMISSION_DENIED' : 'EXPORT_WRITE_FAILED';
    throw new AppError(409, code_, code_ === 'EXPORT_PERMISSION_DENIED' ? 'No permission to write to the export folder.' : 'The module could not be written to the export folder.');
  }
  if (!created) {
    const existing = await fsp.readFile(target, 'utf-8').catch(() => null);
    if (existing === null || sha256(existing) !== expectedSha256) {
      throw new AppError(409, 'EXPORT_FILE_CONFLICT', `A different file named ${fileName} already exists in the export folder; it was not overwritten.`);
    }
    return { status: 'already_saved', fileName, folderLabel: 'export folder', absolutePath: target, sha256: expectedSha256 };
  }
  return { status: 'saved', fileName, folderLabel: 'export folder', absolutePath: target, sha256: expectedSha256 };
}

module.exports = { safeModuleFileName, validateFileName, saveModuleFile };
