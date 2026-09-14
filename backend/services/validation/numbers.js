/**
 * Strict numeric token parsing.
 *
 * Accepted: optional sign, digits with an optional fractional part (or a bare
 * fraction such as `.5`), optional decimal exponent. Rejected: empty tokens,
 * hexadecimal, `NaN`, `Infinity`, embedded spaces, thousands separators, and
 * anything that overflows to a non-finite double (e.g. `1e999`).
 */

const STRICT_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * @param {string} token
 * @returns {{ok: true, value: number} | {ok: false, reason: 'empty'|'malformed'|'non_finite'}}
 */
function parseStrictNumber(token) {
  if (typeof token !== 'string') return { ok: false, reason: 'malformed' };
  const t = token.trim();
  if (t === '') return { ok: false, reason: 'empty' };
  if (!STRICT_NUMBER.test(t)) return { ok: false, reason: 'malformed' };
  const value = Number(t);
  if (!Number.isFinite(value)) return { ok: false, reason: 'non_finite' };
  return { ok: true, value: Object.is(value, -0) ? 0 : value };
}

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

module.exports = { parseStrictNumber, isFiniteNumber, STRICT_NUMBER };
