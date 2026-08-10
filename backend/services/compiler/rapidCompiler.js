/**
 * ABB RAPID (.mod) Code Generator Service
 * Converts 6D Poses [X, Y, Z, q1, q2, q3, q4] and Waypoints into valid ABB RAPID Module file.
 */

function generateRapidCode(targets, options = {}) {
  const {
    moduleName = "WeldModule",
    speed = "v100",
    approachSpeed = "v200",
    zone = "fine",
    tool = "tWeldGun",
    wobj = "wobj0",
    homeTarget = "[[1178.89,0,809.42],[0.069756,0,0.997564,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]]"
  } = options;

  if (!Array.isArray(targets) || targets.length === 0) {
    return `! Empty target list provided.\nMODULE ${moduleName}\n  PROC main()\n  ENDPROC\nENDMODULE`;
  }

  const lines = [];

  // Header & Module Declaration
  lines.push(`MODULE ${moduleName}`);
  lines.push(`    !***********************************************************`);
  lines.push(`    ! Module:      ${moduleName}`);
  lines.push(`    ! Description: Automatically generated weld trajectory from VertexDynamics Pipeline`);
  lines.push(`    ! Generated:   ${new Date().toISOString()}`);
  lines.push(`    !***********************************************************`);
  lines.push(``);
  lines.push(`    ! Home position robtarget declaration`);
  lines.push(`    CONST robtarget p_home:=${homeTarget};`);
  lines.push(``);
  lines.push(`    ! Robtarget declarations for trajectory points`);

  // Target Names & Robtarget Declarations
  const declaredNames = [];

  targets.forEach((target, idx) => {
    const rawName = target.name || `Target_${(idx + 1) * 10}`;
    let name = rawName.replace(/[^a-zA-Z0-9_]/g, '_');
    if (!/^[a-zA-Z_]/.test(name)) name = `p_${name}`;

    declaredNames.push({ name, type: target.type || 'weld' });

    const x = parseFloat((target.x || 0).toFixed(4));
    const y = parseFloat((target.y || 0).toFixed(4));
    const z = parseFloat((target.z || 0).toFixed(4));

    const q1 = target.q1 !== undefined ? parseFloat(target.q1.toFixed(7)) : (target.q?.[0] ?? 1.0);
    const q2 = target.q2 !== undefined ? parseFloat(target.q2.toFixed(7)) : (target.q?.[1] ?? 0.0);
    const q3 = target.q3 !== undefined ? parseFloat(target.q3.toFixed(7)) : (target.q?.[2] ?? 0.0);
    const q4 = target.q4 !== undefined ? parseFloat(target.q4.toFixed(7)) : (target.q?.[3] ?? 0.0);

    const c1 = target.c1 ?? 0;
    const c2 = target.c2 ?? -1;
    const c3 = target.c3 ?? 0;
    const c4 = target.c4 ?? 0;

    lines.push(
      `    CONST robtarget ${name}:=[[${x},${y},${z}],[${q1},${q2},${q3},${q4}],[${c1},${c2},${c3},${c4}],[9E+09,9E+09,9E+09,9E+09,9E+09,9E+09]];`
    );
  });

  lines.push(``);
  lines.push(`    !***********************************************************`);
  lines.push(`    ! Procedure: main`);
  lines.push(`    ! Entry point for execution`);
  lines.push(`    !***********************************************************`);
  lines.push(`    PROC main()`);
  lines.push(`        ! Move to initial home position`);
  lines.push(`        MoveJ p_home, ${approachSpeed}, fine, ${tool}\\WObj:=${wobj};`);
  lines.push(``);
  lines.push(`        ! Execute Welding Sequence`);
  lines.push(`        ExecuteWeldSequence;`);
  lines.push(``);
  lines.push(`        ! Return home post-weld`);
  lines.push(`        MoveJ p_home, ${approachSpeed}, fine, ${tool}\\WObj:=${wobj};`);
  lines.push(`    ENDPROC`);
  lines.push(``);
  lines.push(`    !***********************************************************`);
  lines.push(`    ! Procedure: ExecuteWeldSequence`);
  lines.push(`    ! Sequenced MoveJ (approach) and MoveL (weld/retract) commands`);
  lines.push(`    !***********************************************************`);
  lines.push(`    PROC ExecuteWeldSequence()`);

  declaredNames.forEach((item, idx) => {
    if (item.type === 'approach' || idx === 0) {
      lines.push(`        MoveJ ${item.name}, ${approachSpeed}, z10, ${tool}\\WObj:=${wobj};`);
    } else if (item.type === 'retract') {
      lines.push(`        MoveL ${item.name}, ${approachSpeed}, fine, ${tool}\\WObj:=${wobj};`);
    } else {
      lines.push(`        MoveL ${item.name}, ${speed}, ${zone}, ${tool}\\WObj:=${wobj};`);
    }
  });

  lines.push(`    ENDPROC`);
  lines.push(`ENDMODULE`);

  return lines.join('\n');
}

module.exports = {
  generateRapidCode
};
