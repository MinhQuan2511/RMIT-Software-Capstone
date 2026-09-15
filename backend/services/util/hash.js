const crypto = require('crypto');

/** SHA-256 hex digest of a string (UTF-8) or Buffer. */
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * JSON with object keys sorted recursively, so two semantically equal
 * parameter objects hash identically regardless of key order.
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

module.exports = { sha256, canonicalJson };
