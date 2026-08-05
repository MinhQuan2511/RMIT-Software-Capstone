/**
 * Converts an array of CSV / Excel coordinate objects into ABB RAPID code matching user's default template.
 *
 * Expected row format (keys are case-insensitive):
 * - Name / Target / Point / ID (optional, defaults to Target_10, Target_20...)
 * - X, Y, Z (position in mm)
 * - q1, q2, q3, q4 (optional, or Rx, Ry, Rz for Euler angles)
 * - c1, c2, c3, c4 (optional robot axis configuration)
 *
 * Returns a complete RAPID MODULE string matching Module1 format.
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
    parseFloat(q1.toFixed(9)),
    parseFloat(q2.toFixed(9)),
    parseFloat(q3.toFixed(9)),
    parseFloat(q4.toFixed(9)),
  ];
}

function getValue(row, keys) {
  for (const key of keys) {
    for (const rKey of Object.keys(row)) {
      if (rKey.trim().toLowerCase() === key.toLowerCase()) {
        return row[rKey];
      }
    }
  }
  return undefined;
}

export function csvToRapid(rows) {
  if (!rows || rows.length === 0) {
    return "! No coordinate data provided.";
  }

  const lines = [];
  lines.push("MODULE Module1");
  lines.push("    CONST robtarget home:=[[1178.890158094,0,809.419411487],[0.069756473,0,0.99756405,0],[0,0,0,0],[9E+09,9E+09,9E+09,9E+09,9E+09,9E+09]];");

  const targetNames = [];

  rows.forEach((row, idx) => {
    // 1. Target Name
    const rawName = getValue(row, ["Name", "Target", "Point", "ID", "TargetName", "Target_Name"]);
    let targetName = rawName
      ? String(rawName).trim().replace(/[^a-zA-Z0-9_]/g, "_")
      : `Target_${(idx + 1) * 10}`;

    // Ensure targetName starts with a valid character
    if (!/^[a-zA-Z_]/.test(targetName)) {
      targetName = `Target_${targetName}`;
    }
    targetNames.push(targetName);

    // 2. Position (X, Y, Z)
    const xVal = getValue(row, ["X", "x", "Pos_X", "PosX"]);
    const yVal = getValue(row, ["Y", "y", "Pos_Y", "PosY"]);
    const zVal = getValue(row, ["Z", "z", "Pos_Z", "PosZ"]);

    const x = xVal !== undefined && xVal !== "" ? parseFloat(xVal) : 0;
    const y = yVal !== undefined && yVal !== "" ? parseFloat(yVal) : 0;
    const z = zVal !== undefined && zVal !== "" ? parseFloat(zVal) : 0;

    // 3. Orientation (q1, q2, q3, q4 or Rx, Ry, Rz)
    const q1Val = getValue(row, ["q1", "Q1", "qw", "qW"]);
    const q2Val = getValue(row, ["q2", "Q2", "qx", "qX"]);
    const q3Val = getValue(row, ["q3", "Q3", "qy", "qY"]);
    const q4Val = getValue(row, ["q4", "Q4", "qz", "qZ"]);

    let q1, q2, q3, q4;
    if (
      q1Val !== undefined && q2Val !== undefined &&
      q3Val !== undefined && q4Val !== undefined
    ) {
      q1 = parseFloat(q1Val) || 0;
      q2 = parseFloat(q2Val) || 0;
      q3 = parseFloat(q3Val) || 0;
      q4 = parseFloat(q4Val) || 0;
    } else {
      const rxVal = getValue(row, ["Rx", "rx", "rX"]);
      const ryVal = getValue(row, ["Ry", "ry", "rY"]);
      const rzVal = getValue(row, ["Rz", "rz", "rZ"]);
      if (rxVal !== undefined || ryVal !== undefined || rzVal !== undefined) {
        const rx = parseFloat(rxVal) || 0;
        const ry = parseFloat(ryVal) || 0;
        const rz = parseFloat(rzVal) || 0;
        [q1, q2, q3, q4] = eulerToQuaternion(rx, ry, rz);
      } else {
        // Default orientation matching template example
        q1 = 0;
        q2 = 0;
        q3 = 0.965925826;
        q4 = -0.258819045;
      }
    }

    // 4. Configuration [c1, c2, c3, c4]
    const c1Val = getValue(row, ["c1", "C1", "cf1"]);
    const c2Val = getValue(row, ["c2", "C2", "cf4"]);
    const c3Val = getValue(row, ["c3", "C3", "cf6"]);
    const c4Val = getValue(row, ["c4", "C4", "cfx"]);

    let c1 = c1Val !== undefined ? parseInt(c1Val, 10) : -1;
    let c2 = c2Val !== undefined ? parseInt(c2Val, 10) : 0;
    let c3 = c3Val !== undefined ? parseInt(c3Val, 10) : -1;
    let c4 = c4Val !== undefined ? parseInt(c4Val, 10) : 0;

    if (isNaN(c1)) c1 = 0;
    if (isNaN(c2)) c2 = 0;
    if (isNaN(c3)) c3 = 0;
    if (isNaN(c4)) c4 = 0;

    lines.push(
      `    CONST robtarget ${targetName}:=[[${x},${y},${z}],[${q1},${q2},${q3},${q4}],[${c1},${c2},${c3},${c4}],[9E+09,9E+09,9E+09,9E+09,9E+09,9E+09]];`
    );
  });

  lines.push("    !***********************************************************");
  lines.push("    !");
  lines.push("    ! Module:  Module1");
  lines.push("    !");
  lines.push("    ! Description:");
  lines.push("    !   <Insert description here>");
  lines.push("    !");
  lines.push("    ! Author: hieun");
  lines.push("    !");
  lines.push("    ! Version: 1.0");
  lines.push("    !");
  lines.push("    !***********************************************************");
  lines.push("    ");
  lines.push("    ");
  lines.push("    !***********************************************************");
  lines.push("    !");
  lines.push("    ! Procedure main");
  lines.push("    !");
  lines.push("    !   This is the entry point of your program");
  lines.push("    !");
  lines.push("    !***********************************************************");
  lines.push("    PROC main()");
  lines.push("        !Add your code here");
  lines.push("    ENDPROC");
  lines.push("    PROC Path_10()");
  lines.push("        MoveL home,v100,z100,tWeldGun\\WObj:=wobj0;");

  targetNames.forEach((name, idx) => {
    const speed = idx === 0 ? "v80" : "v100";
    lines.push(`        MoveL ${name},${speed},fine,tWeldGun\\WObj:=wobj0;`);
  });

  lines.push("        MoveL home,v100,fine,tWeldGun\\WObj:=wobj0;");
  lines.push("    ENDPROC");
  lines.push("ENDMODULE");

  return lines.join("\n");
}
