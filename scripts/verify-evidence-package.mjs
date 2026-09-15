/**
 * Independent verifier for an offline evidence package.
 *
 *   node scripts/verify-evidence-package.mjs <package.zip> [--json]
 *
 * Shares no code with the backend: its own ZIP reader (stored or deflated
 * entries, CRC-32 checked), its own canonical-JSON digest and its own checks.
 * Exit 0 when every check passes, 1 otherwise. It does not validate the robot
 * program; it only shows that the files are the ones the manifest names.
 */

import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a ZIP archive (no end of central directory)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory entry");
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) throw new Error(`unsupported compression method ${method} for ${name}`);
    if (data.length !== size) throw new Error(`size mismatch for ${name}`);
    if ((zlib.crc32(data) >>> 0) !== crc) throw new Error(`CRC-32 mismatch for ${name}`);
    if (entries.has(name)) throw new Error(`duplicate entry ${name}`);
    entries.set(name, data);
    p += 46 + nameLen + extra + comment;
  }
  return entries;
}

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

const CLEARANCE_STATUSES = new Set(["intersection_detected", "no_intersection_detected_in_assessed_geometry", "inconclusive", "not_assessed"]);

/**
 * Format @2 adds workpiece geometry, tool envelope and clearance diagnostics.
 * Checks that they are bound to this revision's identity, use only the scoped
 * status vocabulary, never report a pass without geometry, and that a definite
 * intersection with operator-defined plates is recorded as an export block.
 */
function verifyClearance(entries, manifest, id, check) {
  if (manifest.format === "vd-offline-evidence-package@1") { check("clearance_files_not_in_format_1", true, "older package format without clearance records"); return; }
  const need = ["geometry/workpiece.json", "geometry/tool-envelope.json", "clearance/clearance.json"];
  const missing = need.filter((n) => !entries.has(n));
  check("clearance_files_present", missing.length === 0, missing.length ? missing : undefined);
  if (missing.length) return;
  let wp; let env; let doc; let review;
  try {
    wp = JSON.parse(entries.get("geometry/workpiece.json").toString("utf8"));
    env = JSON.parse(entries.get("geometry/tool-envelope.json").toString("utf8"));
    doc = JSON.parse(entries.get("clearance/clearance.json").toString("utf8"));
    review = JSON.parse(entries.get("checks/operator-review.json").toString("utf8"));
  } catch (err) { check("clearance_files_parse", false, err.message); return; }
  const c = doc.clearance;
  const s = manifest.statuses && manifest.statuses.workpieceClearance;
  if (!c) {
    check("clearance_not_recorded_is_not_a_pass", doc.status === "not_recorded" && s && s.result === "not_recorded" && s.realWorkpiece === "not_assessed");
    return;
  }
  check("workpiece_definition_digest_recomputed", sha(canonical(wp.definition)) === wp.definitionSha256 && wp.definitionSha256 === c.geometry.definitionSha256 && wp.definitionSha256 === id.workpieceDefinitionSha256, wp.definitionSha256);
  check("tool_envelope_digest_recomputed", sha(canonical(env.definition)) === env.sha256 && env.sha256 === c.toolEnvelope.definitionSha256 && env.sha256 === id.toolEnvelopeSha256, env.sha256);
  check("clearance_bound_to_output_and_configuration", c.identity.outputSha256 === id.outputSha256 && c.identity.configurationSha256 === id.configurationSha256);
  const statusValues = [c.overall.result, c.overall.realWorkpiece, ...Object.values(c.categories)];
  const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (k === "result" && typeof v === "string") statusValues.push(v); else walk(v); } };
  walk(c.targets); walk(c.segments); walk(c.findings);
  const bad = [...new Set(statusValues.filter((v) => !CLEARANCE_STATUSES.has(v)))];
  check("clearance_statuses_in_scoped_vocabulary", bad.length === 0, bad.length ? bad : undefined);
  const provenance = c.overall.geometryProvenance;
  check("unknown_or_illustrative_geometry_not_assessed_for_real_workpiece", provenance === "operator_defined" || c.overall.realWorkpiece === "not_assessed");
  check("unknown_geometry_never_clear", provenance !== "unknown" || c.overall.result === "not_assessed");
  check("manifest_clearance_status_matches_record", s && s.result === c.overall.result && s.realWorkpiece === c.overall.realWorkpiece && s.geometryProvenance === provenance);
  const blocked = (review.gatesAtPackageTime.export.reasons || []).some((r) => r.code === "WORKPIECE_INTERSECTION_DETECTED");
  const shouldBlock = provenance === "operator_defined" && c.overall.result === "intersection_detected";
  check("definite_intersection_recorded_as_export_block", blocked === shouldBlock, { shouldBlock, blocked });
  check("findings_retained", c.overall.result !== "intersection_detected" || c.findings.some((f) => f.result === "intersection_detected"));
}

export function verifyPackage(buf) {
  const checks = [];
  const check = (id, ok, detail) => checks.push({ id, ok: !!ok, ...(detail !== undefined ? { detail } : {}) });
  let entries;
  try {
    entries = readZip(buf);
    check("zip_readable", true, `${entries.size} entries, CRC-32 verified`);
  } catch (err) {
    check("zip_readable", false, err.message);
    return { ok: false, checks };
  }
  const names = [...entries.keys()];
  check("safe_entry_names", names.every((n) => !n.startsWith("/") && !/^[A-Za-z]:/.test(n) && !n.split("/").includes("..") && !n.includes("\\")), names);

  const sums = entries.get("SHA256SUMS");
  check("sha256sums_present", !!sums);
  if (sums) {
    const listed = new Map(sums.toString("utf8").trim().split("\n").map((l) => { const m = l.match(/^([a-f0-9]{64}) {2}(.+)$/); return m ? [m[2], m[1]] : [l, null]; }));
    const bad = [...listed].filter(([name, h]) => !h || !entries.has(name) || sha(entries.get(name)) !== h).map(([name]) => name);
    check("sha256sums_match", bad.length === 0, bad.length ? bad : `${listed.size} files`);
    check("sha256sums_complete", names.filter((n) => n !== "SHA256SUMS").every((n) => listed.has(n)));
  }

  let manifest = null;
  try { manifest = JSON.parse(entries.get("manifest.json").toString("utf8")); } catch { /* reported below */ }
  check("manifest_parses", !!manifest);
  if (!manifest) return { ok: false, checks };
  const listedFiles = new Set(manifest.files.map((f) => f.path));
  const expectedFiles = names.filter((n) => n !== "manifest.json" && n !== "SHA256SUMS");
  check("manifest_lists_exactly_the_content_files", expectedFiles.length === listedFiles.size && expectedFiles.every((n) => listedFiles.has(n)));
  const mismatched = manifest.files.filter((f) => !entries.has(f.path) || sha(entries.get(f.path)) !== f.sha256 || entries.get(f.path).length !== f.bytes).map((f) => f.path);
  check("manifest_hashes_match", mismatched.length === 0, mismatched.length ? mismatched : undefined);

  const id = manifest.identity || {};
  const moduleBytes = entries.get(id.moduleFile || "module/Module1.mod");
  check("module_hash_equals_output_sha256", moduleBytes && sha(moduleBytes) === id.outputSha256, id.outputSha256);
  check("module_does_not_contain_its_own_hash", moduleBytes && !moduleBytes.toString("utf8").includes(id.outputSha256));
  const sourceName = names.find((n) => /^input\/source\.(txt|json)$/.test(n));
  check("source_hash_equals_source_sha256", sourceName && sha(entries.get(sourceName)) === id.sourceSha256, id.sourceSha256);

  try {
    const cfg = JSON.parse(entries.get("configuration/configuration.json").toString("utf8"));
    const digest = sha(canonical(cfg.configuration));
    check("configuration_digest_recomputed", digest === id.configurationSha256 && digest === cfg.configurationSha256, digest);
  } catch (err) {
    check("configuration_digest_recomputed", false, err.message);
  }

  try {
    const evidence = JSON.parse(entries.get("validation/external-evidence.json").toString("utf8"));
    const sheet = entries.get("validation/robotstudio-validation-sheet.md").toString("utf8");
    const bound = evidence.records.every((r) => r.outputSha256 === id.outputSha256 && (r.configurationSha256 === id.configurationSha256 || (id.configurationDerived && r.configurationSha256 === undefined)));
    check("external_evidence_bound_to_both_hashes", bound);
    check("validation_sheet_not_prefilled_as_pass", /\*\*Result\*\* \| \*\*NOT RUN\*\*/.test(sheet));
    check("no_external_status_without_records", evidence.records.length > 0 || evidence.status === "NOT RUN");
  } catch (err) {
    check("validation_files", false, err.message);
  }

  verifyClearance(entries, manifest, id, check);

  const text = names.map((n) => entries.get(n).toString("latin1")).join("\n");
  check("no_absolute_windows_or_home_paths", !/[A-Za-z]:\\(Users|Windows|Program Files)|\/home\/|\/Users\//.test(text));

  return { ok: checks.every((c) => c.ok), identity: id, synthetic: manifest.synthetic, checks };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const file = process.argv[2];
  if (!file) { console.error("usage: node scripts/verify-evidence-package.mjs <package.zip> [--json]"); process.exit(2); }
  const report = verifyPackage(fs.readFileSync(file));
  if (process.argv.includes("--json")) console.log(JSON.stringify({ packageSha256: sha(fs.readFileSync(file)), ...report }, null, 2));
  else {
    for (const c of report.checks) console.log(`${c.ok ? "PASS" : "FAIL"} ${c.id}${c.detail !== undefined && !c.ok ? ` — ${JSON.stringify(c.detail)}` : ""}`);
    console.log(report.ok ? "Package verified against its manifest." : "Package verification FAILED.");
  }
  process.exit(report.ok ? 0 : 1);
}
