const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseFeatureText, looksLikeFeatureText } = require('../services/parsers/curveParser');

const SAMPLES = path.join(__dirname, '../../samples');
const codes = (r) => r.diagnostics.map((d) => d.code);

test('T01/T02 parser: bundled samples parse with explicit provenance', () => {
  const straight = parseFeatureText(fs.readFileSync(path.join(SAMPLES, 'Feature_Straight_Sample.txt'), 'utf-8'));
  assert.equal(straight.ok, true);
  assert.deepEqual(straight.seam.startPoint, { x: 414.69, y: 1112.75, z: 320.342 });
  assert.deepEqual(straight.seam.endPoint, { x: 338.531, y: 1333.74, z: 322.068 });
  assert.equal(straight.seam.seamWidthMm, 5.54);
  // No units line in the legacy straight sample → acknowledgement required.
  assert.equal(straight.seam.unitsProvenance, 'assumed');
  const unitsDiag = straight.diagnostics.find((d) => d.code === 'UNITS_ASSUMED_MM');
  assert.ok(unitsDiag && unitsDiag.requiresAcknowledgement);

  const arc = parseFeatureText(fs.readFileSync(path.join(SAMPLES, 'Feature_Arc_Sample.txt'), 'utf-8'));
  assert.equal(arc.ok, true);
  assert.equal(arc.seam.type, 'arc');
  assert.equal(arc.seam.unitsProvenance, 'file');
  assert.equal(arc.seam.seamWidthProvenance, 'file');
  assert.deepEqual(arc.seam.viaPoint, { x: 1080, y: 60, z: 480.278 });
});

test('T03 parser: empty, prose and non-string input are structured failures', () => {
  for (const input of ['', '   \n\n', 'just some notes', '# only a comment']) {
    const r = parseFeatureText(input);
    assert.equal(r.ok, false, JSON.stringify(input));
    assert.equal(r.seam, null);
    assert.ok(r.diagnostics.length > 0);
  }
  assert.deepEqual(codes(parseFeatureText('')), ['PARSE_NO_SEAM']);
  assert.deepEqual(codes(parseFeatureText(undefined)), ['PARSE_NOT_TEXT']);
  assert.deepEqual(codes(parseFeatureText('hello world')), ['PARSE_UNRECOGNIZED_LINE']);
});

test('T04 parser: NaN, Infinity, overflow, malformed and extra tokens are rejected', () => {
  const cases = {
    'curve:1,2,3,4,5,6': 'PARSE_TOKEN_COUNT',
    'curve:1,2,3,4,5,6,7,8': 'PARSE_TOKEN_COUNT',
    'curve:1,2,NaN,4,5,6,7': 'PARSE_MALFORMED_NUMBER',
    'curve:1,2,Infinity,4,5,6,7': 'PARSE_MALFORMED_NUMBER',
    'curve:1,2,1e999,4,5,6,7': 'PARSE_NON_FINITE',
    'curve:1,2,1.2.3,4,5,6,7': 'PARSE_MALFORMED_NUMBER',
    'curve:1,2,3e,4,5,6,7': 'PARSE_MALFORMED_NUMBER',
    'curve:1,2,0x10,4,5,6,7': 'PARSE_MALFORMED_NUMBER',
    'curve:1,,3,4,5,6,7': 'PARSE_EMPTY_VALUE',
    'curve:1 2,3,4,5,6,7,8': 'PARSE_MALFORMED_NUMBER',
    'curve:1,2,3,4,5,6,7 # trailing comment': 'PARSE_MALFORMED_NUMBER',
    'arc_start: 1,2,3,4\narc_via: 5,6,7\narc_end: 8,9,10': 'PARSE_TOKEN_COUNT',
    'curve:1,2,3,4,5,6,7\ncurve:1,2,3,4,5,6,7': 'PARSE_MULTIPLE_SEAMS',
    'curve:1,2,3,4,5,6,7\narc_start:1,2,3\narc_via:1,2,3\narc_end:1,2,3': 'PARSE_AMBIGUOUS_SEAM',
    'arc_start:1,2,3\narc_end:4,5,6': 'PARSE_INCOMPLETE_ARC',
    'curve:1,2,3,4,5,6,7\ncolour: red': 'PARSE_UNKNOWN_KEY',
    'units: mm\nunits: mm\ncurve:1,2,3,4,5,6,7': 'PARSE_DUPLICATE_KEY',
    'type: spline\ncurve:1,2,3,400,5,6,7': 'PARSE_UNSUPPORTED_TYPE',
    'type: arc\ncurve:1,2,3,400,5,6,7': 'PARSE_TYPE_MISMATCH',
    'curve:1,2,3,400000,5,6,7': 'PARSE_COORDINATE_OUT_OF_RANGE',
  };
  for (const [input, code] of Object.entries(cases)) {
    const r = parseFeatureText(input);
    assert.equal(r.ok, false, input);
    assert.ok(codes(r).includes(code), `${input} → ${codes(r)} (expected ${code})`);
  }
});

test('T05 parser: non-positive width and unsupported units/frame are explicit errors', () => {
  assert.ok(codes(parseFeatureText('curve:1,2,3,400,5,6,-9.9')).includes('PARSE_WIDTH_NOT_POSITIVE'));
  assert.ok(codes(parseFeatureText('curve:1,2,3,400,5,6,0')).includes('PARSE_WIDTH_NOT_POSITIVE'));
  assert.ok(codes(parseFeatureText('curve:1,2,3,400,5,6,500')).includes('PARSE_WIDTH_OUT_OF_RANGE'));
  const metres = parseFeatureText('units: m\ncurve:0.4,1.1,0.3,0.3,1.3,0.3,0.005');
  assert.equal(metres.ok, false);
  assert.ok(codes(metres).includes('PARSE_UNSUPPORTED_UNITS'));
  assert.ok(codes(parseFeatureText('frame: camera\ncurve:1,2,3,400,5,6,7')).includes('PARSE_UNSUPPORTED_FRAME'));
  const arcWidth = parseFeatureText('arc_start:0,0,0\narc_via:50,20,0\narc_end:100,0,0\nseam_width: -1');
  assert.ok(codes(arcWidth).includes('PARSE_WIDTH_NOT_POSITIVE'));
});

test('parser: BOM, CRLF, whitespace, case and scientific notation are accepted', () => {
  const r = parseFeatureText('﻿# header\r\n  UNITS :  MM \r\n\r\n  Curve:  4.1469e2 , 1112.75, +320.342, 338.531,1333.74, 322.068 , .554E1  \r\n');
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  assert.equal(r.seam.startPoint.x, 414.69);
  assert.equal(r.seam.seamWidthMm, 5.54);
  assert.equal(r.seam.unitsProvenance, 'file');
  assert.ok(!codes(r).includes('UNITS_ASSUMED_MM'));
});

test('parser: arc without width records default provenance visibly', () => {
  const r = parseFeatureText('type: arc\nunits: mm\narc_start:0,0,0\narc_via:50,20,0\narc_end:100,0,0');
  assert.equal(r.ok, true);
  assert.equal(r.seam.seamWidthProvenance, 'default');
  assert.equal(r.seam.seamWidthMm, 5.54);
  assert.ok(codes(r).includes('SEAM_WIDTH_DEFAULT_APPLIED'));
});

test('parser: looksLikeFeatureText distinguishes seam files from notes', () => {
  assert.equal(looksLikeFeatureText('curve:1,2,3'), true);
  assert.equal(looksLikeFeatureText('﻿  ARC_START: 1,2,3'), true);
  assert.equal(looksLikeFeatureText('# curve:1,2,3'), false);
  assert.equal(looksLikeFeatureText('just some notes'), false);
});
