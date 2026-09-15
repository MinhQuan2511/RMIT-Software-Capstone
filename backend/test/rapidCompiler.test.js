const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseFeatureText } = require('../services/parsers/curveParser');
const { resolveProfile } = require('../services/kinematics/profiles');
const { planSeam } = require('../services/kinematics/pathPlanner');
const { compileRapidModule, formatRapidNumber } = require('../services/compiler/rapidCompiler');
const { precheckRapidModule } = require('../services/compiler/rapidPrecheck');
const { sha256 } = require('../services/util/hash');

const SAMPLES = path.join(__dirname, '../../samples');

function build(file, params = {}) {
  const text = fs.readFileSync(path.join(SAMPLES, file), 'utf-8');
  const { profile } = resolveProfile(params);
  const plan = planSeam(parseFeatureText(text).seam, profile);
  return { plan, profile, input: { waypoints: plan.waypoints, segments: plan.segments, profile, provenance: { sourceSha256: sha256(text), profileId: `${profile.id}@${profile.version}` } } };
}

const failedChecks = (r) => (r.prechecks || []).filter((c) => c.status !== 'passed').map((c) => c.id);

test('T01 compiler: straight module passes prechecks, calls Path_10 and is motion-only', () => {
  const { input } = build('Feature_Straight_Sample.txt');
  const r = compileRapidModule(input);
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  assert.deepEqual(failedChecks(r), []);
  assert.match(r.code, /PROC main\(\)\n {8}Path_10;\n {4}ENDPROC/);
  const body = r.code.split('PROC Path_10()')[1].split('ENDPROC')[0].trim().split('\n').map((l) => l.trim());
  assert.deepEqual(body, [
    'MoveJ home, v100, z100, tWeldGun\\WObj:=wobj0;',
    'MoveL Target_30, v60, z10, tWeldGun\\WObj:=wobj0;',
    'MoveL Target_40, v100, fine, tWeldGun\\WObj:=wobj0;',
    'MoveL Target_20_5, v100, fine, tWeldGun\\WObj:=wobj0;',
    'MoveL Target_20, v80, z10, tWeldGun\\WObj:=wobj0;',
    'MoveL home, v100, fine, tWeldGun\\WObj:=wobj0;',
  ]);
  assert.match(r.code, /CONST robtarget Target_40:=\[\[414\.69,1112\.75,320\.342\],\[0\.383667588,0\.149822324,0\.889291982,-0\.198776819\],\[0,0,0,0\],\[9E\+09,9E\+09,9E\+09,9E\+09,9E\+09,9E\+09\]\];/);
  assert.doesNotMatch(r.code, /\b(ArcL|ArcC|ArcLStart|ArcLEnd|SetDO|welddata|seamdata|ConfL|ConfJ)\b/);
  assert.equal((r.code.match(/CONST robtarget/g) || []).length, 5);
  assert.equal(r.outputSha256, sha256(r.code));
});

test('T02 compiler: arc module consumes the via target in MoveC and never moves to it alone', () => {
  const { input } = build('Feature_Arc_Sample.txt');
  const r = compileRapidModule(input);
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  assert.match(r.code, /MoveC Target_45, Target_20_5, v100, fine, tWeldGun\\WObj:=wobj0;/);
  assert.doesNotMatch(r.code, /Move[LJ] Target_45\b/);
  assert.equal((r.code.match(/CONST robtarget/g) || []).length, 6);
  assert.equal((r.code.match(/^\s+Move[LJC] /gm) || []).length, 6);
});

test('T10 compiler: identical input produces identical bytes; different profile changes the hash', () => {
  const a = compileRapidModule(build('Feature_Arc_Sample.txt').input);
  const b = compileRapidModule(build('Feature_Arc_Sample.txt').input);
  assert.equal(a.code, b.code);
  assert.equal(a.outputSha256, b.outputSha256);
  assert.doesNotMatch(a.code, /20\d\d-\d\d-\d\d|job_|revision/i); // nothing volatile in the bytes
  const c = compileRapidModule(build('Feature_Arc_Sample.txt', { motion: { weld: { speed: 'v50' } } }).input);
  assert.notEqual(a.outputSha256, c.outputSha256);
});

test('R-01 compiler: numbers never use exponent notation; non-finite values are rejected before serialisation', () => {
  // The old formatter printed String(1e21) === '1e+21'. Such values are now refused.
  assert.throws(() => formatRapidNumber(1e21, 4));
  assert.equal(formatRapidNumber(123456.78901, 4), '123456.789');
  assert.equal(formatRapidNumber(1e-10, 9), '0');
  assert.equal(formatRapidNumber(-0.00000001, 4), '0');
  assert.equal(formatRapidNumber(0.1 + 0.2, 9), '0.3');
  assert.equal(formatRapidNumber(-12.5, 4), '-12.5');
  assert.throws(() => formatRapidNumber(NaN, 4));
  assert.throws(() => formatRapidNumber(Infinity, 4));

  const { input } = build('Feature_Straight_Sample.txt');
  const bad = JSON.parse(JSON.stringify(input));
  bad.waypoints[1].pos[0] = null; // JSON turns NaN into null; also test NaN directly
  assert.equal(compileRapidModule(bad).ok, false);
  const nan = build('Feature_Straight_Sample.txt').input;
  nan.waypoints[2].pos[1] = NaN;
  const rn = compileRapidModule(nan);
  assert.equal(rn.ok, false);
  assert.equal(rn.code, undefined);
  assert.ok(rn.diagnostics.some((d) => d.code === 'RAPID_INVALID_POSITION'));
});

test('R-04 compiler: invalid names, speeds, zones, quaternions, MoveC pairing and tool identifiers are rejected', () => {
  const mutate = (fn) => { const { input } = build('Feature_Arc_Sample.txt'); fn(input); return compileRapidModule(input); };
  const expectCode = (r, code) => { assert.equal(r.ok, false); assert.ok(r.diagnostics.some((d) => d.code === code), `${code} not in ${r.diagnostics.map((d) => d.code)}`); };
  expectCode(mutate((i) => { i.waypoints[1].name = 'Target 30'; }), 'RAPID_INVALID_IDENTIFIER');
  expectCode(mutate((i) => { i.waypoints[1].name = 'Target_40'; }), 'RAPID_DUPLICATE_TARGET');
  expectCode(mutate((i) => { i.segments[1].speed = 'vmax'; }), 'RAPID_INVALID_SPEED');
  expectCode(mutate((i) => { i.segments[1].zone = 'z7'; }), 'RAPID_INVALID_ZONE');
  expectCode(mutate((i) => { i.waypoints[2].orient = [0.38268343, 0.14943801, 0.88701083, -0.19826693]; }), 'RAPID_INVALID_QUATERNION');
  expectCode(mutate((i) => { i.segments[3].via = 'Target_20_5'; }), 'RAPID_MOVEC_VIA');
  expectCode(mutate((i) => { delete i.segments[3].via; }), 'RAPID_MOVEC_VIA');
  expectCode(mutate((i) => { i.segments[4].to = 'Target_45'; }), 'RAPID_MOVEC_VIA');
  expectCode(mutate((i) => { i.segments[2].instruction = 'ArcL'; }), 'RAPID_INVALID_INSTRUCTION');
  expectCode(mutate((i) => { i.profile = { ...i.profile, toolName: 'tWeld;SetDO' }; }), 'RAPID_INVALID_IDENTIFIER');
  expectCode(mutate((i) => { i.provenance.sourceSha256 = 'abc\nPROC evil()'; }), 'RAPID_INVALID_PROVENANCE');
  expectCode(mutate((i) => { i.waypoints[0].conf = [0, 0.5, 0, 0]; }), 'RAPID_INVALID_CONFIGURATION');
});

test('compiler precheck: detects exponent literals, missing main call, non-motion statements and bad quaternions', () => {
  const { code } = compileRapidModule(build('Feature_Straight_Sample.txt').input);
  const fails = (text) => precheckRapidModule(text).filter((c) => c.status === 'failed').map((c) => c.id);
  assert.deepEqual(fails(code), []);
  assert.ok(fails(code.replace('414.69', '4.1469e2')).includes('numeric_literals'));
  assert.ok(fails(code.replace('        Path_10;', '        !Add your code here')).includes('main_calls_path'));
  assert.ok(fails(code.replace('MoveL Target_30', 'SetDO doWeld, 1;\n        MoveL Target_30')).includes('motion_only'));
  assert.ok(fails(code.replace('0.383667588,0.149822324', '0.38268343,0.14943801')).includes('quaternion_norms'));
  assert.ok(fails(code.replace('MoveL Target_20,', 'MoveL Target_99,')).includes('target_references'));
});
