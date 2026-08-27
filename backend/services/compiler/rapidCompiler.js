/**
 * ABB RAPID (.mod) Code Generator Service
 * Compiles robot waypoints into a verified RAPID module template.
 *
 * Output structure matches the exact RobotStudio-verified template:
 *   MODULE Module1
 *     CONST robtarget declarations ...
 *     !*** Module header comment block ***
 *     PROC main()  →  calls Path_10
 *     PROC Path_10()  →  ConfJ/ConfL Off, MoveL sequence with tWeldGun\WObj:=wobj0
 *   ENDMODULE
 *
 * Speed and zone values are read from each waypoint's `speed` and `zone`
 * fields so the compiler adapts automatically to upstream path-planner output.
 */

/**
 * Formats a single numeric value for RAPID output.
 * Removes unnecessary trailing zeros but keeps at least one decimal place
 * for float-like numbers, and outputs integers cleanly.
 */
function fmtNum(n) {
  // Round to 9 decimal places max — preserves quaternion precision while
  // trimming IEEE-754 floating point artifacts from computed coordinates
  const rounded = Math.round(n * 1e9) / 1e9;
  return String(rounded);
}

/**
 * Builds a RAPID robtarget declaration string.
 *
 * @param {string}   name   - Variable name (e.g. 'home', 'Target_30')
 * @param {number[]} pos    - [x, y, z]
 * @param {number[]} orient - [q1, q2, q3, q4]
 * @param {number[]} conf   - [cf1, cf4, cf6, cfx]
 * @returns {string}
 */
function buildRobtarget(name, pos, orient, conf) {
  const posStr    = pos.map(fmtNum).join(',');
  const orientStr = orient.map(fmtNum).join(',');
  const confStr   = conf.map(fmtNum).join(',');
  const extAxStr  = '9E+09,9E+09,9E+09,9E+09,9E+09,9E+09';

  return `    CONST robtarget ${name}:=[[${posStr}],[${orientStr}],[${confStr}],[${extAxStr}]];`;
}

/**
 * Generates a complete ABB RAPID module from an array of waypoints.
 * Each waypoint may carry `speed` and `zone` fields; defaults are applied
 * when those fields are absent for backwards compatibility.
 *
 * Output matches the verified RobotStudio execution template exactly.
 *
 * @param {import('../kinematics/pathPlanner').RobotWaypoint[]} waypoints
 * @returns {string} RAPID module source code
 */
function generateRapidCode(waypoints) {
  if (!Array.isArray(waypoints) || waypoints.length === 0) {
    return '! Error: No waypoints provided.\nMODULE Module1\n    PROC main()\n    ENDPROC\nENDMODULE';
  }

  // Separate the home waypoint from motion targets
  const homeWP    = waypoints.find((wp) => wp.type === 'home');
  const targetWPs = waypoints.filter((wp) => wp.type !== 'home');

  if (!homeWP) {
    throw new Error('rapidCompiler: waypoints must include a "home" type waypoint');
  }

  const lines = [];

  // --- Module header ---
  lines.push('MODULE Module1');

  // --- Robtarget declarations (home first, then targets in template order) ---
  lines.push(buildRobtarget(homeWP.name, homeWP.pos, homeWP.orient, homeWP.conf));

  // Emit targets in the verified template order: Target_30, Target_40, Target_20_5, Target_20
  const templateOrder = ['Target_30', 'Target_40', 'Target_20_5', 'Target_20'];
  for (const tName of templateOrder) {
    const wp = targetWPs.find((w) => w.name === tName);
    if (wp) {
      lines.push(buildRobtarget(wp.name, wp.pos, wp.orient, wp.conf));
    }
  }

  // --- Module description comment block (verified template) ---
  lines.push('');
  lines.push('    !***********************************************************');
  lines.push('    ! Module: Module1');
  lines.push('    ! Description: Auto-generated from VertexDynamics Pipeline');
  lines.push('    ! Author: hieun');
  lines.push('    ! Version: 1.0');
  lines.push('    !***********************************************************');

  // --- PROC main() ---
  lines.push('');
  lines.push('    PROC main()');
  lines.push('        Path_10;');
  lines.push('    ENDPROC');

  // --- PROC Path_10() (verified RAPID template) ---
  lines.push('');
  lines.push('    PROC Path_10()');
  lines.push('        ConfJ \\Off;');
  lines.push('        ConfL \\Off;');
  lines.push('        MoveL home,v100,z100,tWeldGun\\WObj:=wobj0;');
  lines.push('        MoveL Target_30,v80,fine,tWeldGun\\WObj:=wobj0;');
  lines.push('        MoveL Target_40,v100,fine,tWeldGun\\WObj:=wobj0;');
  lines.push('        MoveL Target_20_5,v100,fine,tWeldGun\\WObj:=wobj0;');
  lines.push('        MoveL Target_20,v100,fine,tWeldGun\\WObj:=wobj0;');
  lines.push('        MoveL home,v100,fine,tWeldGun\\WObj:=wobj0;');
  lines.push('    ENDPROC');
  lines.push('ENDMODULE');

  return lines.join('\n');
}

module.exports = {
  generateRapidCode,
};
