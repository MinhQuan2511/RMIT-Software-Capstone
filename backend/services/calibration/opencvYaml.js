/**
 * Strict reader for the small subset of OpenCV FileStorage YAML that a
 * hand-eye export uses:
 *
 *   %YAML:1.0
 *   ---
 *   info: "4 0 "
 *   handEyeMatrix: !!opencv-matrix
 *      rows: 4
 *      cols: 4
 *      dt: f
 *      data: [ 5.2e-01, ..., 1. ]
 *
 * Deliberately not a general YAML loader: no object construction, no anchors,
 * aliases, merge keys, nested mappings, block sequences or multiple documents,
 * and no tag other than !!opencv-matrix. Anything else is rejected with a
 * line-numbered diagnostic rather than guessed. Nothing is fetched or followed.
 */

const MAX_BYTES = 64 * 1024;
const MAX_MATRIX_ELEMENTS = 256;
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const NON_FINITE = /^[+-]?\.(?:inf|nan)$/i;
const PLAIN = /^[A-Za-z0-9_.+\- ]{1,200}$/;
const DT = { u: 'uint8', c: 'int8', w: 'uint16', s: 'int16', i: 'int32', f: 'float32', d: 'float64' };

const clip = (s) => (s.length > 60 ? `${s.slice(0, 57)}...` : s);

/**
 * @param {Buffer} buf
 * @returns {{ok: boolean, diagnostics: object[], directive?: string, entries?: object[]}}
 */
function parseOpenCvYaml(buf) {
  const fail = (code, message, line) => ({ ok: false, diagnostics: [{ code, severity: 'error', message, ...(line ? { line } : {}) }] });
  if (!Buffer.isBuffer(buf)) return fail('CALIB_NOT_BYTES', 'Calibration content must be bytes.');
  if (buf.length === 0) return fail('CALIB_EMPTY', 'The calibration file is empty.');
  if (buf.length > MAX_BYTES) return fail('CALIB_TOO_LARGE', `The calibration file exceeds ${MAX_BYTES / 1024} KB.`);
  let text = buf.toString('utf-8');
  if (text.includes('�')) return fail('CALIB_NOT_UTF8', 'The calibration file is not valid UTF-8 text.');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text)) return fail('CALIB_CONTROL_CHARACTERS', 'The calibration file contains control characters.');

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0] !== '%YAML:1.0' && lines[0] !== '%YAML 1.0') {
    return fail('CALIB_DIRECTIVE', 'The first line must be the OpenCV FileStorage directive %YAML:1.0.', 1);
  }
  if (lines[1] !== '---') return fail('CALIB_DOCUMENT_START', 'The second line must be the document marker ---.', 2);

  const entries = [];
  const seen = new Set();
  let i = 2;
  while (i < lines.length) {
    const raw = lines[i];
    const lineNo = i + 1;
    if (raw.trim() === '' || /^\s*#/.test(raw)) { i += 1; continue; }
    if (/^\s/.test(raw)) return fail('CALIB_UNEXPECTED_INDENT', 'Indented line outside a matrix block (nested mappings are not supported).', lineNo);
    if (raw === '---' || raw === '...' || raw.startsWith('%')) return fail('CALIB_MULTIPLE_DOCUMENTS', 'Only a single YAML document is supported.', lineNo);
    if (raw.startsWith('- ')) return fail('CALIB_UNSUPPORTED_SYNTAX', 'Top-level sequences are not supported.', lineNo);
    const m = raw.match(/^([^:\s]+):(?:[ \t]+(.*))?$/);
    if (!m) return fail('CALIB_UNRECOGNIZED_LINE', `Unrecognised line: ${clip(raw)}`, lineNo);
    const key = m[1];
    const value = (m[2] || '').trim();
    if (key === '<<') return fail('CALIB_UNSUPPORTED_SYNTAX', 'Merge keys are not supported.', lineNo);
    if (!KEY.test(key)) return fail('CALIB_INVALID_KEY', `Key '${clip(key)}' is not a plain identifier.`, lineNo);
    if (seen.has(key)) return fail('CALIB_DUPLICATE_KEY', `Key '${key}' appears more than once.`, lineNo);
    seen.add(key);

    if (value.startsWith('!!opencv-matrix')) {
      if (value !== '!!opencv-matrix') return fail('CALIB_UNSUPPORTED_SYNTAX', `Unexpected text after !!opencv-matrix on '${key}'.`, lineNo);
      i += 1;
      const fields = {};
      let dataText = null;
      let dataLine = null;
      while (i < lines.length && /^\s+\S/.test(lines[i])) {
        const l = lines[i].trim();
        const ln = i + 1;
        const fm = l.match(/^(rows|cols|dt|data):\s*(.*)$/);
        if (!fm) return fail('CALIB_MATRIX_FIELD', `Unexpected field in matrix '${key}': ${clip(l)}`, ln);
        if (Object.prototype.hasOwnProperty.call(fields, fm[1])) return fail('CALIB_MATRIX_FIELD', `Field '${fm[1]}' repeated in matrix '${key}'.`, ln);
        if (fm[1] === 'data') {
          let acc = fm[2];
          dataLine = ln;
          if (!acc.startsWith('[')) return fail('CALIB_MATRIX_DATA', `data of '${key}' must be a flow sequence [ ... ].`, ln);
          while (!acc.includes(']')) {
            i += 1;
            if (i >= lines.length || !/^\s+\S/.test(lines[i])) return fail('CALIB_MATRIX_DATA', `Unterminated data sequence in '${key}'.`, dataLine);
            acc += ` ${lines[i].trim()}`;
          }
          if (acc.indexOf(']') !== acc.length - 1) return fail('CALIB_MATRIX_DATA', `Unexpected text after the data sequence of '${key}'.`, i + 1);
          dataText = acc.slice(1, -1);
          fields.data = true;
        } else {
          fields[fm[1]] = fm[2];
        }
        i += 1;
      }
      for (const f of ['rows', 'cols', 'dt']) {
        if (fields[f] === undefined) return fail('CALIB_MATRIX_FIELD', `Matrix '${key}' is missing '${f}'.`, lineNo);
      }
      if (dataText === null) return fail('CALIB_MATRIX_FIELD', `Matrix '${key}' is missing 'data'.`, lineNo);
      if (!/^\d{1,3}$/.test(fields.rows) || !/^\d{1,3}$/.test(fields.cols)) return fail('CALIB_MATRIX_SHAPE', `rows and cols of '${key}' must be small non-negative integers.`, lineNo);
      const rows = Number(fields.rows);
      const cols = Number(fields.cols);
      if (!Object.prototype.hasOwnProperty.call(DT, fields.dt)) {
        return fail('CALIB_MATRIX_TYPE', `dt '${clip(fields.dt)}' of '${key}' is not a single-channel OpenCV type (u, c, w, s, i, f, d).`, lineNo);
      }
      const tokens = dataText.split(',').map((s) => s.trim());
      if (tokens.length > MAX_MATRIX_ELEMENTS) return fail('CALIB_MATRIX_SHAPE', `Matrix '${key}' has more than ${MAX_MATRIX_ELEMENTS} elements.`, dataLine);
      const values = [];
      for (const [k, tok] of tokens.entries()) {
        if (NON_FINITE.test(tok)) return fail('CALIB_NON_FINITE', `Element ${k} of '${key}' is ${tok}; only finite numbers are accepted.`, dataLine);
        if (!NUMBER.test(tok)) return fail('CALIB_MALFORMED_NUMBER', `Element ${k} of '${key}' ('${clip(tok)}') is not a number.`, dataLine);
        const v = Number(tok);
        if (!Number.isFinite(v)) return fail('CALIB_NON_FINITE', `Element ${k} of '${key}' overflows to a non-finite value.`, dataLine);
        values.push(v);
      }
      entries.push({ key, type: 'matrix', line: lineNo, rows, cols, dt: fields.dt, dtName: DT[fields.dt], values, tokens });
      continue;
    }

    if (value.startsWith('!')) return fail('CALIB_UNSUPPORTED_TAG', `Tag '${clip(value.split(/\s/)[0])}' on '${key}' is not supported; only !!opencv-matrix is read.`, lineNo);
    if (/^[&*]/.test(value)) return fail('CALIB_UNSUPPORTED_SYNTAX', 'Anchors and aliases are not supported.', lineNo);
    if (value === '' || /^[[{|>]/.test(value)) return fail('CALIB_UNSUPPORTED_SYNTAX', `Only scalar values and !!opencv-matrix blocks are supported ('${key}').`, lineNo);
    if (value.startsWith('"') || value.startsWith("'")) {
      const q = value[0];
      const inner = value.slice(1, -1);
      if (value.length < 2 || value[value.length - 1] !== q || inner.includes(q) || inner.includes('\\')) {
        return fail('CALIB_STRING', `The quoted value of '${key}' is malformed or uses escapes, which are not supported.`, lineNo);
      }
      entries.push({ key, type: 'string', line: lineNo, value: inner, quoted: true });
    } else if (NUMBER.test(value)) {
      const v = Number(value);
      if (!Number.isFinite(v)) return fail('CALIB_NON_FINITE', `Value of '${key}' is not finite.`, lineNo);
      entries.push({ key, type: 'number', line: lineNo, value: v, raw: value });
    } else if (NON_FINITE.test(value)) {
      return fail('CALIB_NON_FINITE', `Value of '${key}' is ${value}; only finite numbers are accepted.`, lineNo);
    } else if (PLAIN.test(value)) {
      entries.push({ key, type: 'string', line: lineNo, value, quoted: false });
    } else {
      return fail('CALIB_UNSUPPORTED_SYNTAX', `Value of '${key}' is not a supported scalar.`, lineNo);
    }
    i += 1;
  }
  if (entries.length === 0) return fail('CALIB_NO_ENTRIES', 'The document has no entries.');
  return { ok: true, diagnostics: [], directive: lines[0], entries };
}

module.exports = { parseOpenCvYaml, MAX_BYTES, DT };
