/**
 * Feature.txt seam descriptor parser.
 *
 * Grammar (one seam per file; keys are case-insensitive; whitespace around
 * tokens is ignored; CRLF, LF and a leading UTF-8 BOM are accepted; a line whose
 * first non-blank character is `#` is a comment — inline comments are not):
 *
 *   Straight seam
 *     curve: x1, y1, z1, x2, y2, z2, width          exactly 7 numbers
 *
 *   Curved seam (three points ON the arc)
 *     type: arc                                      optional, must say arc
 *     arc_start: x, y, z                             exactly 3 numbers
 *     arc_via:   x, y, z
 *     arc_end:   x, y, z
 *     seam_width: w                                  optional; default applied visibly
 *
 *   Optional on either form
 *     units: mm                                      only mm is supported
 *     frame: robot_base                              only robot_base is supported
 *
 * The parser checks grammar, numeric validity and input sanity limits. It does
 * not decide whether the geometry is weldable, reachable or safe — geometry
 * checks run in the planner, and reachability is not evaluated anywhere.
 */

const { diagnostic, hasErrors } = require('../util/errors');
const { parseStrictNumber } = require('../validation/numbers');

const DEFAULT_PARSE_OPTIONS = Object.freeze({
  maxTextLength: 64 * 1024,
  // Input sanity limits, NOT robot reach: they only catch unit and typing
  // mistakes (a coordinate of 1e7 mm is 10 km).
  maxAbsCoordinateMm: 100000,
  maxSeamWidthMm: 100,
  defaultSeamWidthMm: 5.54,
});

const POINT_KEYS = ['arc_start', 'arc_via', 'arc_end'];
const KNOWN_KEYS = new Set(['curve', 'type', 'units', 'frame', 'seam_width', ...POINT_KEYS]);
const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_]*)\s*:(.*)$/;

/** Quick content sniff used by the watch folder to tell seam files from notes. */
function looksLikeFeatureText(text) {
  return typeof text === 'string' && /^\s*(curve|arc_start)\s*:/im.test(text.replace(/^﻿/, ''));
}

function parseNumberList(raw, expected, key, line, opts, diagnostics) {
  const tokens = raw.split(',');
  if (tokens.length !== expected) {
    diagnostics.push(diagnostic('PARSE_TOKEN_COUNT', 'error',
      `'${key}' needs exactly ${expected} comma-separated value(s); found ${tokens.length}.`,
      { field: key, line, details: { expected, found: tokens.length } }));
    return null;
  }
  const values = [];
  tokens.forEach((token, i) => {
    const r = parseStrictNumber(token);
    if (!r.ok) {
      const code = r.reason === 'non_finite' ? 'PARSE_NON_FINITE' : r.reason === 'empty' ? 'PARSE_EMPTY_VALUE' : 'PARSE_MALFORMED_NUMBER';
      const what = r.reason === 'non_finite' ? 'is not a finite number' : r.reason === 'empty' ? 'is empty' : 'is not a valid number';
      diagnostics.push(diagnostic(code, 'error', `Value ${i + 1} of '${key}' ${what}: '${token.trim()}'.`,
        { field: key, line, details: { index: i } }));
      values.push(null);
    } else {
      values.push(r.value);
    }
  });
  return values.includes(null) ? null : values;
}

function checkCoordinateRange(point, key, line, opts, diagnostics) {
  const bad = point.filter((v) => Math.abs(v) > opts.maxAbsCoordinateMm);
  if (bad.length) {
    diagnostics.push(diagnostic('PARSE_COORDINATE_OUT_OF_RANGE', 'error',
      `'${key}' has a coordinate beyond the ±${opts.maxAbsCoordinateMm} mm input sanity limit (not a reachability limit).`,
      { field: key, line, details: { limitMm: opts.maxAbsCoordinateMm } }));
    return false;
  }
  return true;
}

function checkWidth(width, field, line, opts, diagnostics) {
  if (!(width > 0)) {
    diagnostics.push(diagnostic('PARSE_WIDTH_NOT_POSITIVE', 'error',
      `Seam width must be greater than 0 mm; found ${width}.`, { field, line }));
    return false;
  }
  if (width > opts.maxSeamWidthMm) {
    diagnostics.push(diagnostic('PARSE_WIDTH_OUT_OF_RANGE', 'error',
      `Seam width ${width} mm exceeds the ${opts.maxSeamWidthMm} mm input sanity limit.`, { field, line }));
    return false;
  }
  return true;
}

const toPoint = (v) => ({ x: v[0], y: v[1], z: v[2] });

/**
 * @param {string} text
 * @param {Partial<typeof DEFAULT_PARSE_OPTIONS>} [options]
 * @returns {{ok: boolean, seam: object|null, diagnostics: import('../util/errors').Diagnostic[]}}
 */
function parseFeatureText(text, options = {}) {
  const opts = { ...DEFAULT_PARSE_OPTIONS, ...options };
  const diagnostics = [];
  const fail = () => ({ ok: false, seam: null, diagnostics });

  if (typeof text !== 'string') {
    diagnostics.push(diagnostic('PARSE_NOT_TEXT', 'error', 'Seam descriptor must be text.'));
    return fail();
  }
  if (text.length > opts.maxTextLength) {
    diagnostics.push(diagnostic('PARSE_TOO_LONG', 'error',
      `Seam descriptor is ${text.length} characters; the limit is ${opts.maxTextLength}.`));
    return fail();
  }

  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
  const entries = new Map(); // key -> {raw, line}

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;

    const m = trimmed.match(KEY_LINE);
    if (!m) {
      diagnostics.push(diagnostic('PARSE_UNRECOGNIZED_LINE', 'error',
        `Line ${lineNo} is not a 'key: value' line or a # comment.`, { line: lineNo }));
      return;
    }
    const key = m[1].toLowerCase();
    if (!KNOWN_KEYS.has(key)) {
      diagnostics.push(diagnostic('PARSE_UNKNOWN_KEY', 'error',
        `Unknown key '${m[1]}' on line ${lineNo}.`, { field: key, line: lineNo }));
      return;
    }
    if (entries.has(key)) {
      const code = key === 'curve' || POINT_KEYS.includes(key) ? 'PARSE_MULTIPLE_SEAMS' : 'PARSE_DUPLICATE_KEY';
      const message = code === 'PARSE_MULTIPLE_SEAMS'
        ? `'${key}' appears more than once (lines ${entries.get(key).line} and ${lineNo}). One seam per file is supported; split the file or remove the extra seam.`
        : `'${key}' appears more than once (lines ${entries.get(key).line} and ${lineNo}).`;
      diagnostics.push(diagnostic(code, 'error', message, { field: key, line: lineNo }));
      return;
    }
    entries.set(key, { raw: m[2], line: lineNo });
  });

  if (hasErrors(diagnostics)) return fail();

  const hasCurve = entries.has('curve');
  const presentPointKeys = POINT_KEYS.filter((k) => entries.has(k));

  if (hasCurve && presentPointKeys.length > 0) {
    diagnostics.push(diagnostic('PARSE_AMBIGUOUS_SEAM', 'error',
      "The file declares both a 'curve:' straight seam and arc keys. Keep exactly one seam definition."));
    return fail();
  }
  if (!hasCurve && presentPointKeys.length === 0) {
    diagnostics.push(diagnostic('PARSE_NO_SEAM', 'error',
      "No seam found. Expected a 'curve:' line or 'arc_start', 'arc_via' and 'arc_end' keys."));
    return fail();
  }
  if (!hasCurve && presentPointKeys.length < 3) {
    const missing = POINT_KEYS.filter((k) => !entries.has(k));
    diagnostics.push(diagnostic('PARSE_INCOMPLETE_ARC', 'error',
      `Incomplete arc block: missing ${missing.join(', ')}. A partial arc is rejected rather than downgraded to a line.`,
      { details: { missing } }));
    return fail();
  }

  const seamType = hasCurve ? 'straight' : 'arc';

  // type:
  if (entries.has('type')) {
    const { raw, line } = entries.get('type');
    const value = raw.trim().toLowerCase();
    if (value !== 'arc' && value !== 'straight') {
      diagnostics.push(diagnostic('PARSE_UNSUPPORTED_TYPE', 'error',
        `Unsupported seam type '${raw.trim()}'. Supported: arc, straight.`, { field: 'type', line }));
    } else if (value !== seamType) {
      diagnostics.push(diagnostic('PARSE_TYPE_MISMATCH', 'error',
        `'type: ${value}' does not match the ${seamType} seam keys in the file.`, { field: 'type', line }));
    }
  }

  // units:
  let unitsProvenance = 'assumed';
  if (entries.has('units')) {
    const { raw, line } = entries.get('units');
    if (raw.trim().toLowerCase() !== 'mm') {
      diagnostics.push(diagnostic('PARSE_UNSUPPORTED_UNITS', 'error',
        `Unsupported units '${raw.trim()}'. Only mm is supported; values are never rescaled silently.`,
        { field: 'units', line, details: { value: raw.trim() } }));
    } else {
      unitsProvenance = 'file';
    }
  }

  // frame:
  let frameProvenance = 'assumed';
  if (entries.has('frame')) {
    const { raw, line } = entries.get('frame');
    if (raw.trim().toLowerCase() !== 'robot_base') {
      diagnostics.push(diagnostic('PARSE_UNSUPPORTED_FRAME', 'error',
        `Unsupported coordinate frame '${raw.trim()}'. Only robot_base is supported; no camera-to-robot transform exists in this application.`,
        { field: 'frame', line, details: { value: raw.trim() } }));
    } else {
      frameProvenance = 'file';
    }
  }

  let seam = null;

  if (seamType === 'straight') {
    const { raw, line } = entries.get('curve');
    const values = parseNumberList(raw, 7, 'curve', line, opts, diagnostics);
    if (values) {
      const start = values.slice(0, 3);
      const end = values.slice(3, 6);
      const width = values[6];
      const okStart = checkCoordinateRange(start, 'curve', line, opts, diagnostics);
      const okEnd = checkCoordinateRange(end, 'curve', line, opts, diagnostics);
      const okWidth = checkWidth(width, 'curve', line, opts, diagnostics);
      if (okStart && okEnd && okWidth) {
        seam = { type: 'straight', startPoint: toPoint(start), endPoint: toPoint(end), seamWidthMm: width, seamWidthProvenance: 'file' };
      }
    }
    if (entries.has('seam_width')) {
      diagnostics.push(diagnostic('PARSE_WIDTH_CONFLICT', 'error',
        "A straight 'curve:' line already carries the width; remove 'seam_width'.",
        { field: 'seam_width', line: entries.get('seam_width').line }));
    }
  } else {
    const points = {};
    for (const key of POINT_KEYS) {
      const { raw, line } = entries.get(key);
      const values = parseNumberList(raw, 3, key, line, opts, diagnostics);
      if (values && checkCoordinateRange(values, key, line, opts, diagnostics)) points[key] = toPoint(values);
    }
    let width = opts.defaultSeamWidthMm;
    let widthProvenance = 'default';
    let widthOk = true;
    if (entries.has('seam_width')) {
      const { raw, line } = entries.get('seam_width');
      const values = parseNumberList(raw, 1, 'seam_width', line, opts, diagnostics);
      widthOk = !!values && checkWidth(values[0], 'seam_width', line, opts, diagnostics);
      if (widthOk) { width = values[0]; widthProvenance = 'file'; }
    }
    if (Object.keys(points).length === 3 && widthOk) {
      seam = {
        type: 'arc',
        startPoint: points.arc_start,
        viaPoint: points.arc_via,
        endPoint: points.arc_end,
        seamWidthMm: width,
        seamWidthProvenance: widthProvenance,
      };
    }
  }

  if (hasErrors(diagnostics) || !seam) return fail();

  seam.units = 'mm';
  seam.unitsProvenance = unitsProvenance;
  seam.frame = 'robot_base';
  seam.frameProvenance = frameProvenance;

  if (unitsProvenance === 'assumed') {
    diagnostics.push(diagnostic('UNITS_ASSUMED_MM', 'warning',
      "The file has no 'units:' line. Values are interpreted as millimetres; confirm this before export.",
      { field: 'units', requiresAcknowledgement: true }));
  }
  if (seam.seamWidthProvenance === 'default') {
    diagnostics.push(diagnostic('SEAM_WIDTH_DEFAULT_APPLIED', 'info',
      `No seam_width given; the configured default ${opts.defaultSeamWidthMm} mm was applied. Width is display-only and does not affect motion.`,
      { field: 'seam_width', details: { defaultMm: opts.defaultSeamWidthMm } }));
  }

  return { ok: true, seam, diagnostics };
}

module.exports = { parseFeatureText, looksLikeFeatureText, DEFAULT_PARSE_OPTIONS };
