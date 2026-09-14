import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.(jsx?|mjs|css)$/.test(e.name) ? [path.join(dir, e.name)] : []));
}
const sources = files(SRC).map((f) => ({ file: path.relative(SRC, f), text: fs.readFileSync(f, "utf-8") }));

test("T28 no unsupported verification, telemetry or calibration literals remain in the UI source", () => {
  const banned = [
    /REACHABILITY:\s*100%/i,
    /PASSED VERIFICATION/i,
    /IK Solver Check/i,
    /Singularity Check:\s*PASS/i,
    /Synced\s*&(amp;)?\s*Ready/i,
    /integrity_check/,
    /Data Buffer/i,
    /reprojectionError|pointsCaptured|0\.142/,
    /CYCLE:/,
    /TracerStudio API[^"\n]{0,20}Connected/i,
    /IRC5\s*\/\s*OmniCore/,
    /SYS:\s*ONLINE/,
    /v2\.4\.1-stable/,
    /Calibrated by TracerStudio/i,
    /COMPILED OK/i,
    /READY FOR CONTROLLER/i,
    /Collision-Free/i,
  ];
  const hits = [];
  for (const { file, text } of sources) for (const re of banned) if (re.test(text)) hits.push(`${file}: ${re}`);
  assert.deepEqual(hits, []);
});

test("T29 no external runtime asset hosts (fonts, images, CDNs) are referenced by the UI source", () => {
  const hits = [];
  for (const { file, text } of sources) {
    for (const m of text.matchAll(/https?:\/\/[^\s"'`)]+/g)) {
      if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(m[0])) hits.push(`${file}: ${m[0]}`);
    }
  }
  assert.deepEqual(hits, []);
  const layout = fs.readFileSync(path.join(SRC, "app", "layout.js"), "utf-8");
  assert.match(layout, /material-symbols\/outlined\.css/);
  assert.match(layout, /@fontsource\/inter/);
});
