/**
 * Converts an array of CSV coordinate objects into ABB RAPID code.
 *
 * Expected row format: { X, Y, Z, Rx, Ry, Rz }
 * - X, Y, Z: Position in mm
 * - Rx, Ry, Rz: Euler angles in degrees (converted to approximate quaternion)
 *
 * Returns a complete RAPID MODULE string.
 */

/**
 * Simple Euler (ZYX) to quaternion approximation.
 * Uses Rx, Ry, Rz in degrees.
 */
function eulerToQuaternion(rx, ry, rz) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const cx = Math.cos(toRad(rx) / 2);
  const sx = Math.sin(toRad(rx) / 2);
  const cy = Math.cos(toRad(ry) / 2);
  const sy = Math.sin(toRad(ry) / 2);
  const cz = Math.cos(toRad(rz) / 2);
  const sz = Math.sin(toRad(rz) / 2);

  const q1 = cx * cy * cz + sx * sy * sz;
  const q2 = sx * cy * cz - cx * sy * sz;
  const q3 = cx * sy * cz + sx * cy * sz;
  const q4 = cx * cy * sz - sx * sy * cz;

  return [
    parseFloat(q1.toFixed(6)),
    parseFloat(q2.toFixed(6)),
    parseFloat(q3.toFixed(6)),
    parseFloat(q4.toFixed(6)),
  ];
}

/**
 * Convert CSV rows to RAPID module string.
 * @param {Array<{X: number, Y: number, Z: number, Rx: number, Ry: number, Rz: number}>} rows
 * @returns {string} RAPID module code
 */
export function csvToRapid(rows) {
  if (!rows || rows.length === 0) {
    return "! No coordinate data provided.";
  }

  const lines = [];
  lines.push("MODULE WeldPathModule");
  lines.push("    ! Auto-generated from CSV welding coordinates");
  lines.push("    ! Total points: " + rows.length);
  lines.push("");

  // Home position
  lines.push("    CONST robtarget pHome := [[500, 0, 500], [1, 0, 0, 0], [0, 0, 0, 0], [9E9, 9E9, 9E9, 9E9, 9E9, 9E9]];");
  lines.push("");

  // Tool and work object definitions
  lines.push("    PERS tooldata tWeld := [TRUE, [[0, 0, 120], [1, 0, 0, 0]], [1.2, [0, 0, 40], [1, 0, 0, 0], 0, 0, 0]];");
  lines.push("    PERS wobjdata wobj_weld := [FALSE, TRUE, \"\", [[0, 0, 0], [1, 0, 0, 0]], [[0, 0, 0], [1, 0, 0, 0]]];");
  lines.push("");

  // Generate robtarget declarations
  rows.forEach((row, idx) => {
    const x = parseFloat(row.X) || 0;
    const y = parseFloat(row.Y) || 0;
    const z = parseFloat(row.Z) || 0;
    const rx = parseFloat(row.Rx) || 0;
    const ry = parseFloat(row.Ry) || 0;
    const rz = parseFloat(row.Rz) || 0;

    const [q1, q2, q3, q4] = eulerToQuaternion(rx, ry, rz);
    const pointName = `pWeld_${idx + 1}`;

    lines.push(
      `    CONST robtarget ${pointName} := [[${x}, ${y}, ${z}], [${q1}, ${q2}, ${q3}, ${q4}], [0, -1, 0, 0], [9E9, 9E9, 9E9, 9E9, 9E9, 9E9]];`
    );
  });

  lines.push("");
  lines.push("    PROC main()");
  lines.push("        ConfL \\Off;");
  lines.push("        ConfJ \\Off;");
  lines.push("");
  lines.push("        ! Move to home position");
  lines.push("        MoveJ pHome, v500, fine, tWeld \\WObj:=wobj_weld;");
  lines.push("");
  lines.push("        ! Begin welding sequence");
  lines.push("        SetDO do_WeldActive, 1;");

  rows.forEach((_, idx) => {
    const pointName = `pWeld_${idx + 1}`;
    const speed = idx === 0 ? "v200" : "v100";
    const zone = idx === rows.length - 1 ? "fine" : "z5";
    const moveType = idx === 0 ? "MoveJ" : "MoveL";
    lines.push(
      `        ${moveType} ${pointName}, ${speed}, ${zone}, tWeld \\WObj:=wobj_weld;`
    );
  });

  lines.push("        SetDO do_WeldActive, 0;");
  lines.push("");
  lines.push("        ! Return to home");
  lines.push("        MoveJ pHome, v500, fine, tWeld \\WObj:=wobj_weld;");
  lines.push("    ENDPROC");
  lines.push("ENDMODULE");

  return lines.join("\n");
}
