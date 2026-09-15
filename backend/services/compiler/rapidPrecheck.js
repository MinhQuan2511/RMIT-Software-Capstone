/**
 * Application precheck for generated RAPID text.
 *
 * Re-reads the module independently of the generator and confirms the narrow
 * structure this application emits. It is deliberately strict and deliberately
 * small: it is NOT a RAPID parser or compiler and cannot say whether a
 * controller will accept the module. Its checks are reported by ID so the UI
 * can show exactly what was and was not checked.
 */

const { isValidIdentifier, isAllowedSpeed, isAllowedZone } = require('../validation/rapidSyntax');
const { QUAT_NORM_TOLERANCE } = require('../validation/quaternion');

const DECIMAL = /^-?\d+(\.\d+)?$/;
const ROBTARGET = /^\s*CONST robtarget ([A-Za-z]\w*):=\[\[([^\]]*)\],\[([^\]]*)\],\[([^\]]*)\],\[([^\]]*)\]\];$/;
const MOVE_LJ = /^(MoveJ|MoveL) ([A-Za-z]\w*), (\w+), (\w+), ([A-Za-z]\w*)\\WObj:=([A-Za-z]\w*);$/;
const MOVE_C = /^MoveC ([A-Za-z]\w*), ([A-Za-z]\w*), (\w+), (\w+), ([A-Za-z]\w*)\\WObj:=([A-Za-z]\w*);$/;

function precheckRapidModule(code, expect = {}) {
  const checks = [];
  const add = (id, passed, message) => checks.push({ id, status: passed ? 'passed' : 'failed', message });

  add('ascii_only', /^[\t\n\r\x20-\x7E]*$/.test(code), 'Module contains only printable ASCII.');

  const lines = code.split('\n');
  const content = lines.map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('!'));

  const moduleOpen = content.filter((l) => l.startsWith('MODULE '));
  add('module_structure',
    moduleOpen.length === 1 && /^MODULE [A-Za-z]\w{0,31}$/.test(content[0] || '') &&
      content[content.length - 1] === 'ENDMODULE' && content.filter((l) => l === 'ENDMODULE').length === 1,
    'Exactly one MODULE … ENDMODULE block.');

  // Declarations
  const targets = new Map();
  let numericOk = true;
  let quatOk = true;
  let confOk = true;
  let declOk = true;
  for (const line of lines) {
    if (!line.includes('CONST robtarget')) continue;
    const m = line.match(ROBTARGET);
    if (!m) { declOk = false; continue; }
    const [, name, pos, orient, conf, ext] = m;
    if (targets.has(name) || !isValidIdentifier(name)) declOk = false;
    const p = pos.split(',');
    const q = orient.split(',');
    const c = conf.split(',');
    const e = ext.split(',');
    if (p.length !== 3 || q.length !== 4 || c.length !== 4 || e.length !== 6) { declOk = false; continue; }
    if (![...p, ...q, ...c].every((t) => DECIMAL.test(t)) || !e.every((t) => t === '9E+09')) numericOk = false;
    if (!c.every((t) => /^-?\d+$/.test(t))) confOk = false;
    const norm = Math.hypot(...q.map(Number));
    if (!(Math.abs(norm - 1) <= QUAT_NORM_TOLERANCE)) quatOk = false;
    targets.set(name, true);
  }
  add('robtarget_declarations', declOk && targets.size > 0 &&
    (expect.expectedTargetCount === undefined || targets.size === expect.expectedTargetCount),
  `Every robtarget declaration is well formed and uniquely named${expect.expectedTargetCount !== undefined ? ` (${expect.expectedTargetCount} expected)` : ''}.`);
  add('numeric_literals', numericOk, 'Numbers use plain decimal notation (no exponent, NaN or Infinity); external axes are 9E+09.');
  add('quaternion_norms', quatOk, `Every orientation has |q| within ${QUAT_NORM_TOLERANCE} of 1 after rounding.`);
  add('configuration_integers', confOk, 'Configuration values are integers.');

  // Procedures
  const procs = new Map();
  let current = null;
  let procOk = true;
  for (const l of content) {
    const open = l.match(/^PROC ([A-Za-z]\w*)\(\)$/);
    if (open) {
      if (current) procOk = false;
      current = open[1];
      if (procs.has(current)) procOk = false;
      procs.set(current, []);
      continue;
    }
    if (l === 'ENDPROC') { if (!current) procOk = false; current = null; continue; }
    if (current) procs.get(current).push(l);
  }
  if (current) procOk = false;
  add('procedure_structure', procOk && procs.has('main') && procs.has('Path_10'), 'PROC main() and PROC Path_10() are present and closed.');

  const mainBody = procs.get('main') || [];
  add('main_calls_path', mainBody.length === 1 && mainBody[0] === 'Path_10;', 'PROC main() consists of the call Path_10;');

  const body = procs.get('Path_10') || [];
  let motionOnly = body.length > 0;
  let refsOk = true;
  let speedZoneOk = true;
  let movecOk = true;
  const vias = [];
  const dests = [];
  for (const stmt of body) {
    let m = stmt.match(MOVE_LJ);
    if (m) {
      const [, , to, speed, zone, tool, wobj] = m;
      dests.push(to);
      if (!targets.has(to)) refsOk = false;
      if (!isAllowedSpeed(speed) || !isAllowedZone(zone)) speedZoneOk = false;
      if (!isValidIdentifier(tool) || !isValidIdentifier(wobj)) refsOk = false;
      continue;
    }
    m = stmt.match(MOVE_C);
    if (m) {
      const [, via, to, speed, zone, tool, wobj] = m;
      vias.push(via);
      dests.push(to);
      if (!targets.has(via) || !targets.has(to)) refsOk = false;
      if (via === to) movecOk = false;
      if (!isAllowedSpeed(speed) || !isAllowedZone(zone)) speedZoneOk = false;
      if (!isValidIdentifier(tool) || !isValidIdentifier(wobj)) refsOk = false;
      continue;
    }
    motionOnly = false;
  }
  if (vias.some((v) => dests.includes(v)) || new Set(vias).size !== vias.length) movecOk = false;

  add('motion_only', motionOnly, 'Path_10 contains only MoveJ, MoveL and MoveC statements (no welding, I/O or other instructions).');
  add('target_references', refsOk, 'Every motion statement references declared targets and valid tool/work-object identifiers.');
  add('speed_zone_allowlist', speedZoneOk, 'Every speed and zone is an allowed predefined speeddata/zonedata name.');
  add('movec_pairs', movecOk, 'Each MoveC has a distinct via and end target, and via targets are not used as destinations.');
  add('instruction_count',
    expect.expectedInstructionCount === undefined || body.length === expect.expectedInstructionCount,
    `Path_10 has the expected number of motion instructions${expect.expectedInstructionCount !== undefined ? ` (${expect.expectedInstructionCount})` : ''}.`);

  return checks;
}

module.exports = { precheckRapidModule };
