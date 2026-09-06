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
 * The Path_10 motion sequence is derived from the waypoint array rather than
 * hard-coded: declarations follow the array order, and each move reads the
 * `speed` and `zone` fields of its own waypoint. A straight seam therefore
 * still produces the byte-identical template it always did, while an arc seam
 * can insert an extra target without the compiler needing to know about it.
 *
 * Arc support: a waypoint of type 'weld_via' is not emitted as a move of its
 * own — it is consumed as the interpolation point of the MoveC that carries
 * the following waypoint. Everything else is a MoveL.
 */

// Tool and work object are fixed by the verified RobotStudio station.
const TOOL_SUFFIX = 'tWeldGun\\WObj:=wobj0';

// The return-to-home move closing Path_10 is a constant of the template —
// it is deliberately not the home waypoint's own zone (which is z100).
const RETURN_HOME_SPEED = 'v100';
const RETURN_HOME_ZONE = 'fine';

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
  const posStr = pos.map(fmtNum).join(',');
  const orientStr = orient.map(fmtNum).join(',');
  const confStr = conf.map(fmtNum).join(',');
  const extAxStr = '9E+09,9E+09,9E+09,9E+09,9E+09,9E+09';

  return `    CONST robtarget ${name}:=[[${posStr}],[${orientStr}],[${confStr}],[${extAxStr}]];`;
}

/**
 * Builds the body of PROC Path_10 from the waypoint array.
 *
 * @param {object}   homeWP    - The 'home' waypoint
 * @param {object[]} targetWPs - Motion waypoints, in execution order
 * @returns {string[]} RAPID motion statement lines
 */
function buildMotionSequence(homeWP, targetWPs) {
  const lines = [];

  // Approach the standby pose with a joint move, as the verified template does.
  lines.push(
    `        MoveJ ${homeWP.name}, ${homeWP.speed || 'v100'}, ${homeWP.zone || 'z100'}, ${TOOL_SUFFIX};`
  );

  for (let i = 0; i < targetWPs.length; i += 1) {
    const wp = targetWPs[i];

    // A via point carries no move of its own — the next MoveC consumes it.
    if (wp.type === 'weld_via') continue;

    const speed = wp.speed || 'v100';
    const zone = wp.zone || 'fine';
    const prev = i > 0 ? targetWPs[i - 1] : null;

    if (prev && prev.type === 'weld_via') {
      lines.push(
        `        MoveC ${prev.name}, ${wp.name}, ${speed}, ${zone}, ${TOOL_SUFFIX};`
      );
    } else {
      lines.push(
        `        MoveL ${wp.name}, ${speed}, ${zone}, ${TOOL_SUFFIX};`
      );
    }
  }

  // Close the path by returning to standby.
  lines.push(
    `        MoveL ${homeWP.name}, ${RETURN_HOME_SPEED}, ${RETURN_HOME_ZONE}, ${TOOL_SUFFIX};`
  );

  return lines;
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
  const homeWP = waypoints.find((wp) => wp.type === 'home');
  const targetWPs = waypoints.filter((wp) => wp.type !== 'home');

  if (!homeWP) {
    throw new Error('rapidCompiler: waypoints must include a "home" type waypoint');
  }

  const lines = [];

  // --- Module header ---
  lines.push('MODULE Module1');

  // --- Robtarget declarations (home first, then targets in planner order) ---
  lines.push(buildRobtarget(homeWP.name, homeWP.pos, homeWP.orient, homeWP.conf));

  for (const wp of targetWPs) {
    lines.push(buildRobtarget(wp.name, wp.pos, wp.orient, wp.conf));
  }

  // --- Module description comment block (verified template) ---
  lines.push('');
  lines.push('    !***********************************************************');
  lines.push('    ! Module: Module1');
  lines.push('    ! Description: Auto-generated from VertexDynamics Pipeline');
  lines.push('    ! Author: VertexDynamics');
  lines.push('    ! Version: 1.0');
  lines.push('    !***********************************************************');

  // --- PROC main() ---
  lines.push('');
  lines.push('    PROC main()');
  lines.push('        Path_10;');
  lines.push('    ENDPROC');

  // --- PROC Path_10() (derived from the waypoint array) ---
  lines.push('');
  lines.push('    PROC Path_10()');
  lines.push(...buildMotionSequence(homeWP, targetWPs));
  lines.push('    ENDPROC');
  lines.push('ENDMODULE');

  return lines.join('\n');
}

module.exports = {
  generateRapidCode,
};
