/**
 * Spreadsheet → point-list document for Testing mode.
 *
 * Column mapping is suggested from header names but always shown and editable.
 * Values are passed through as text; the backend parses and validates them
 * strictly. Nothing is defaulted: an unmapped required column is a problem to
 * resolve, not a zero.
 */

export const MAX_TEXT_CHARS = 2 * 1024 * 1024;
export const MAX_ROWS = 2000;

export const FIELDS = [
  { key: "name", label: "Target name", required: false },
  { key: "x", label: "X (mm)", required: true },
  { key: "y", label: "Y (mm)", required: true },
  { key: "z", label: "Z (mm)", required: true },
  { key: "q1", label: "q1 (w)", group: "quaternion_wxyz" },
  { key: "q2", label: "q2 (x)", group: "quaternion_wxyz" },
  { key: "q3", label: "q3 (y)", group: "quaternion_wxyz" },
  { key: "q4", label: "q4 (z)", group: "quaternion_wxyz" },
  { key: "rx", label: "Rx (deg)", group: "euler_zyx_deg" },
  { key: "ry", label: "Ry (deg)", group: "euler_zyx_deg" },
  { key: "rz", label: "Rz (deg)", group: "euler_zyx_deg" },
  { key: "cf1", label: "cf1", group: "columns" },
  { key: "cf4", label: "cf4", group: "columns" },
  { key: "cf6", label: "cf6", group: "columns" },
  { key: "cfx", label: "cfx", group: "columns" },
];

const ALIASES = {
  name: ["name", "target", "point", "id", "targetname", "target_name"],
  x: ["x", "pos_x", "posx"], y: ["y", "pos_y", "posy"], z: ["z", "pos_z", "posz"],
  q1: ["q1", "qw"], q2: ["q2", "qx"], q3: ["q3", "qy"], q4: ["q4", "qz"],
  rx: ["rx"], ry: ["ry"], rz: ["rz"],
  cf1: ["cf1", "c1"], cf4: ["cf4", "c2"], cf6: ["cf6", "c3"], cfx: ["cfx", "c4"],
};

export function suggestMapping(headers) {
  const lower = headers.map((h) => String(h).trim().toLowerCase());
  const mapping = {};
  for (const f of FIELDS) {
    const idx = lower.findIndex((h) => ALIASES[f.key].includes(h));
    mapping[f.key] = idx >= 0 ? headers[idx] : null;
  }
  return mapping;
}

export function suggestOrientation(mapping) {
  if (["q1", "q2", "q3", "q4"].every((k) => mapping[k])) return "quaternion_wxyz";
  if (["rx", "ry", "rz"].every((k) => mapping[k])) return "euler_zyx_deg";
  return null;
}

/** Minimal RFC 4180 CSV reader (quoted fields, doubled quotes, CRLF/LF). */
export function parseCsvText(text) {
  if (typeof text !== "string") return { headers: [], rows: [], problems: ["The file is not text."] };
  if (text.length > MAX_TEXT_CHARS) return { headers: [], rows: [], problems: [`The file exceeds ${MAX_TEXT_CHARS} characters.`] };
  const src = text.replace(/^﻿/, "");
  const records = [];
  let field = "";
  let record = [];
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") { record.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i += 1;
      record.push(field); field = "";
      records.push(record); record = [];
    } else field += c;
  }
  if (field !== "" || record.length) { record.push(field); records.push(record); }
  const nonEmpty = records.filter((r) => r.some((v) => v.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [], problems: ["The file has no header row."] };
  const headers = nonEmpty[0].map((h) => h.trim());
  const problems = [];
  const rows = [];
  records.slice(records.indexOf(nonEmpty[0]) + 1).forEach((r, i) => {
    if (!r.some((v) => v.trim() !== "")) return;
    if (r.length !== headers.length) problems.push(`Row ${i + 2} has ${r.length} values; the header has ${headers.length}.`);
    rows.push({ __rowNumber: i + 2, ...Object.fromEntries(headers.map((h, j) => [h, (r[j] ?? "").trim()])) });
  });
  if (rows.length > MAX_ROWS) problems.push(`The file has ${rows.length} data rows; the limit is ${MAX_ROWS}.`);
  return { headers, rows: rows.slice(0, MAX_ROWS + 1), problems };
}

/**
 * @returns {{document: object|null, problems: string[], skippedEmptyRows: number}}
 */
export function buildPointListDocument({ rows, mapping, orientationConvention, configurationPolicy }) {
  const problems = [];
  for (const f of FIELDS.filter((x) => x.required)) if (!mapping[f.key]) problems.push(`Map a column to ${f.label}.`);
  if (orientationConvention !== "quaternion_wxyz" && orientationConvention !== "euler_zyx_deg") problems.push("Choose how orientation is given (quaternion or Euler ZYX).");
  else for (const f of FIELDS.filter((x) => x.group === orientationConvention)) if (!mapping[f.key]) problems.push(`Map a column to ${f.label}.`);
  if (configurationPolicy !== "fixed_zero" && configurationPolicy !== "columns") problems.push("Choose a robot configuration policy.");
  else if (configurationPolicy === "columns") for (const f of FIELDS.filter((x) => x.group === "columns")) if (!mapping[f.key]) problems.push(`Map a column to ${f.label}.`);
  if (rows.length > MAX_ROWS) problems.push(`At most ${MAX_ROWS} rows are supported.`);
  if (problems.length) return { document: null, problems, skippedEmptyRows: 0 };

  const used = FIELDS.filter((f) => !f.group || f.group === orientationConvention || (f.group === "columns" && configurationPolicy === "columns"));
  let skipped = 0;
  const out = [];
  rows.forEach((row, i) => {
    const cells = used.filter((f) => mapping[f.key]).map((f) => row[mapping[f.key]]);
    if (cells.every((v) => v === undefined || v === null || String(v).trim() === "")) { skipped += 1; return; }
    const entry = { rowNumber: Number.isInteger(row.__rowNumber) ? row.__rowNumber : i + 2 };
    for (const f of used) if (mapping[f.key]) entry[f.key] = row[mapping[f.key]] === undefined ? "" : String(row[mapping[f.key]]);
    out.push(entry);
  });
  if (out.length === 0) return { document: null, problems: ["No non-empty data rows."], skippedEmptyRows: skipped };
  return {
    document: { units: "mm", orientationConvention, configurationPolicy, rows: out },
    problems: [],
    skippedEmptyRows: skipped,
  };
}
