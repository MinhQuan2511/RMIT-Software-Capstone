/**
 * Browser checks for the offline milestone, against the real built application.
 *
 *   npm --prefix frontend run build
 *   EVIDENCE_DIR=<scratch> PLAYWRIGHT_CORE=<pw>/node_modules/playwright-core node scripts/offline-milestone-browser.mjs
 *
 * EVIDENCE_DIR must contain points_explicit_headers.xlsx, malformed.xlsx and notes.xlsx.
 * Starts its OWN backend and frontend (scratch data/config/export/watch directories,
 * VD_ROBOTSTUDIO_EXE pointing at a non-existent file) and stops only those children.
 * Refuses to run if port 3000 or 5000 is busy.
 *
 * External network: Chromium resolves every host except 127.0.0.1/localhost to NOTFOUND
 * (--host-resolver-rules), and every non-loopback request is logged. This removes the
 * external network without the browser's global offline switch, which would also cut the
 * local backend. Each context starts with an empty cache (cold load).
 *
 * Outputs: LocalUse/3/evidence/browser/*.png and browser-offline-milestone.json;
 * the downloaded synthetic evidence package and its verification report in LocalUse/3/sample-package/.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { verifyPackage } from "./verify-evidence-package.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const E = process.env.EVIDENCE_DIR;
if (!E) throw new Error("Set EVIDENCE_DIR");
const OUT = process.env.OUT_DIR || path.join(ROOT, "LocalUse", "3", "evidence", "browser");
const PKG_DIR = process.env.PKG_DIR || path.join(ROOT, "LocalUse", "3", "sample-package");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const BROWSER = process.env.BROWSER_EXE || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
// Ports are configurable so the run never needs to stop another copy of the app. NEXT_PUBLIC_API_URL is
// inlined at build time, so a non-default backend port needs a build made with the matching URL.
const FE_PORT = Number(process.env.VD_E2E_FRONTEND_PORT) || 3000;
const BE_PORT = Number(process.env.VD_E2E_BACKEND_PORT) || 5000;
const FE = `http://127.0.0.1:${FE_PORT}`;
const BE = `http://127.0.0.1:${BE_PORT}/api`;
const LOOPBACK = /^(https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/|data:|blob:|about:)/;
// Pages of the browser's own UI (for example Edge's download bubble). Not network traffic; logged separately.
const BROWSER_INTERNAL = /^(edge|chrome|devtools|chrome-extension):/;
const PROBE = "https://example.com/vd-network-probe";
const FIXTURE = "units: mm\n# SYNTHETIC FIXTURE: straight fillet seam along +X (not a measurement)\ncurve: 400, 100, 300, 600, 100, 300, 5\n";
const PREVIEW = '[aria-label="3D toolpath preview (illustrative animation)"]';

const log = { startedAt: new Date().toISOString(), browser: BROWSER, steps: [], consoleErrors: [], pageErrors: [], externalRequests: [], browserInternalRequests: [] };
const step = (name, ok, detail = null) => { log.steps.push({ name, ok: !!ok, detail, at: new Date().toISOString() }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== null ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`); };
const free = (port) => new Promise((resolve) => { const s = net.createServer(); s.once("error", () => resolve(false)); s.once("listening", () => s.close(() => resolve(true))); s.listen(port, "127.0.0.1"); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

async function waitHttp(url, ms = 90000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch { /* retry */ }
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${url}`);
}

const children = [];
function start(name, cmd, args, opts) {
  const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
  const out = fs.createWriteStream(path.join(E, `${name}.log`));
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  children.push(child);
  return child;
}
function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

async function main() {
  for (const p of [FE_PORT, BE_PORT]) if (!(await free(p))) throw new Error(`port ${p} in use; refusing to run`);
  if (!fs.existsSync(path.join(ROOT, "frontend", ".next", "BUILD_ID"))) throw new Error("Run npm --prefix frontend run build first");
  for (const f of ["points_explicit_headers.xlsx", "malformed.xlsx", "notes.xlsx"]) if (!fs.existsSync(path.join(E, f))) throw new Error(`missing fixture ${f}`);
  for (const d of [OUT, PKG_DIR, path.join(E, "watch", "inbox"), path.join(E, "exports"), path.join(E, "downloads")]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(E, "synthetic_fillet_fixture.txt"), FIXTURE);
  fs.copyFileSync(path.join(ROOT, "samples", "Feature_Straight_Sample.txt"), path.join(E, "legacy_straight_upload.txt"));

  const backendEnv = {
    ...process.env,
    PORT: String(BE_PORT),
    VD_ALLOWED_ORIGINS: `http://127.0.0.1:${FE_PORT},http://localhost:${FE_PORT}`,
    VD_DATA_DIR: path.join(E, "data"),
    VD_CONFIG_PATH: path.join(E, "config.json"),
    VD_EXPORT_DIR: path.join(E, "exports"),
    VD_WATCH_ROOTS: path.join(E, "watch"),
    WATCH_FOLDER: path.join(E, "watch", "inbox"),
    VD_WATCH_SETTLE_MS: "1000",
    VD_ROBOTSTUDIO_EXE: path.join(E, "not-installed", "RobotStudio.exe"),
  };
  start("backend", process.execPath, ["server.js"], { cwd: path.join(ROOT, "backend"), env: backendEnv });
  start("frontend", process.execPath, [path.join(ROOT, "frontend", "node_modules", "next", "dist", "bin", "next"), "start", "--hostname", "127.0.0.1", "--port", String(FE_PORT)], { cwd: path.join(ROOT, "frontend"), env: process.env });
  await waitHttp(`${BE}/health`);
  await waitHttp(`${FE}/`);

  const browser = await chromium.launch({
    executablePath: BROWSER,
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost"],
  });

  async function newContext() {
    const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, acceptDownloads: true });
    ctx.on("request", (r) => {
      const url = r.url();
      if (BROWSER_INTERNAL.test(url)) { if (log.browserInternalRequests.length < 50) log.browserInternalRequests.push(url); return; }
      if (!LOOPBACK.test(url) && url !== PROBE) log.externalRequests.push(url);
    });
    // Counts WebGL contexts created and explicitly released in each document.
    await ctx.addInitScript(() => {
      window.__vdGl = { created: 0, lost: 0 };
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
        const gl = original.call(this, type, ...rest);
        if (gl && /webgl/.test(String(type)) && !this.__vdCounted) {
          this.__vdCounted = true;
          window.__vdGl.created += 1;
          const getExtension = gl.getExtension.bind(gl);
          gl.getExtension = (name) => {
            const ext = getExtension(name);
            if (ext && name === "WEBGL_lose_context" && !ext.__vdWrapped) {
              const lose = ext.loseContext.bind(ext);
              ext.loseContext = () => { window.__vdGl.lost += 1; return lose(); };
              ext.__vdWrapped = true;
            }
            return ext;
          };
        }
        return gl;
      };
    });
    return ctx;
  }
  const watch = (page, tag) => {
    page.on("console", (m) => { if (m.type() === "error") log.consoleErrors.push(`[${tag}] ${m.text().slice(0, 300)}`); });
    page.on("pageerror", (e) => log.pageErrors.push(`[${tag}] ${String(e).slice(0, 300)}`));
    page.on("dialog", (d) => d.accept());
  };
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const text = (page, t, opts = {}) => page.getByText(t, opts).first().waitFor({ timeout: 30000 });
  const outputHash = (page) => page.locator("text=Output SHA-256").first().locator("xpath=following-sibling::dd[1]").getAttribute("title");

  async function ackAndReview(page) {
    await page.locator('input[type=checkbox][id^="ack-"]').first().waitFor({ timeout: 30000 });
    const boxes = page.locator('input[type=checkbox][id^="ack-"]:not([disabled])');
    for (let i = 0, n = await boxes.count(); i < n; i += 1) await boxes.nth(i).check();
    await page.getByRole("button", { name: "Confirm geometry review and continue" }).click();
    await page.waitForURL("**/generate", { timeout: 30000 });
  }
  async function reviewModule(page) {
    await page.getByRole("button", { name: "I have reviewed this module text" }).click();
    await page.waitForURL("**/export", { timeout: 30000 });
  }
  async function uploadAndProcess(page, file, provenance) {
    await page.goto(`${FE}/acquire`);
    await page.getByRole("radio", { name: /Manual upload/ }).check();
    await page.locator("#upload").setInputFiles(path.join(E, file));
    if (provenance) await page.getByLabel("Upload provenance").selectOption(provenance);
    await page.getByRole("button", { name: "Upload selected files" }).click();
    await page.getByRole("radio", { name: `Select ${file}` }).waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Process selected source" }).click();
    await page.waitForURL("**/parse-map", { timeout: 30000 });
  }

  const ctx = await newContext();
  const page = await ctx.newPage();
  watch(page, "tab1");
  try {
    // A. Cold load with the external network unavailable and loopback working.
    await page.goto(`${FE}/`);
    await text(page, "Online", { exact: true });
    const probe = await page.evaluate(async ({ be, url }) => {
      const out = {};
      try { await fetch(url, { mode: "no-cors" }); out.external = "reachable"; } catch (e) { out.external = `blocked (${e.name})`; }
      try { out.loopback = (await fetch(`${be}/health`)).status; } catch (e) { out.loopback = `failed (${e.name})`; }
      await document.fonts.ready;
      out.loadedFonts = [...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")))];
      return out;
    }, { be: BE, url: PROBE });
    step("external network unavailable while the loopback backend answers", probe.external.startsWith("blocked") && probe.loopback === 200, probe);
    step("fonts and icons load from local assets in a cold context", probe.loadedFonts.some((f) => /Inter/i.test(f)) && probe.loadedFonts.some((f) => /Material Symbols/i.test(f)), probe.loadedFonts);
    await shot(page, "01-cold-load-external-network-unavailable");

    await page.getByRole("link", { name: /Start local session/ }).click();
    await page.getByLabel("Operator name").fill("Offline Milestone Operator");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL("**/projects");
    await page.getByLabel("Name").fill("Offline milestone");
    await page.getByRole("button", { name: "Create and select" }).click();
    await text(page, "Jobs in the selected project");

    // B. Synthetic fixture with declared provenance → legacy revision 1 → joint-relative revision 2.
    await uploadAndProcess(page, "synthetic_fillet_fixture.txt", "synthetic_fixture");
    await text(page, "SYNTHETIC fixture");
    await page.getByLabel("Orientation mode").selectOption("joint");
    await page.getByLabel("Station profile").selectOption("synthetic-tool-z-approach");
    await shot(page, "02-orientation-form-synthetic-station");
    await page.getByRole("button", { name: /Apply orientation as revision 2/ }).click();
    await text(page, "Joint-relative orientation (experimental)");
    await page.getByText(/Mathematical check passed/).first().waitFor({ timeout: 30000 });
    const agrees = (await page.getByText(/· agrees within/).count()) > 0;
    const banner = (await page.getByText(/Synthetic fixture and station profile/i).count()) > 0;
    step("joint-relative revision shows requested vs recovered angles, browser recomputation agrees, synthetic banner visible", agrees && banner, { agrees, banner });
    await shot(page, "03-parse-map-joint-relative-r2");

    // C. Two real tabs on one job.
    await ackAndReview(page);
    await reviewModule(page);
    const tab2 = await ctx.newPage();
    watch(tab2, "tab2");
    await tab2.goto(`${FE}/parse-map`);
    await text(tab2, "Joint-relative orientation (experimental)");
    step("second tab opens the same job revision", (await tab2.locator("text=Job / revision").first().locator("xpath=following-sibling::dd[1]").innerText()).includes("r2"));

    await page.goto(`${FE}/parse-map`);
    await page.getByLabel("Push angle").fill("15");
    await page.getByRole("button", { name: /Apply orientation as revision 3/ }).click();
    await page.getByText(/Revision 3 created/).first().waitFor({ timeout: 30000 });

    await tab2.getByLabel("Push angle").fill("5");
    await tab2.getByRole("button", { name: /Apply orientation as revision 3/ }).click();
    await text(tab2, "REVISION_CONFLICT");
    const tab1Rev = await page.locator("text=Job / revision").first().locator("xpath=following-sibling::dd[1]").innerText();
    const tab2Rev = await tab2.locator("text=Job / revision").first().locator("xpath=following-sibling::dd[1]").innerText();
    step("stale tab cannot create a revision from an old base (409) and each tab keeps its own job identity", tab1Rev.includes("r3") && tab2Rev.includes("r2"), { tab1Rev, tab2Rev });
    await shot(tab2, "04-two-tabs-stale-reprocess-conflict");

    await tab2.getByRole("button", { name: "Continue" }).first().click();
    await tab2.waitForURL("**/generate", { timeout: 30000 });
    await tab2.getByRole("button", { name: "Continue to download" }).click();
    await tab2.waitForURL("**/export", { timeout: 30000 });
    await tab2.getByRole("button", { name: "Download offline evidence package" }).click();
    await text(tab2, "PACKAGE_BLOCKED");
    const staleReason = (await tab2.getByText(/Revision 2 is superseded by revision 3/).count()) > 0;
    step("stale tab's package request for the superseded revision is refused by the backend", staleReason);
    await shot(tab2, "05-two-tabs-stale-package-blocked");
    await tab2.close();

    // D. Revision 3: review, 3D indicators, ordinary export blocked, offline package downloaded and verified.
    await ackAndReview(page);
    await page.locator(`${PREVIEW} canvas`).waitFor({ timeout: 30000 });
    await sleep(1200);
    await shot(page, "06-generate-joint-frame-and-torch-axis");
    await reviewModule(page);
    const exportDisabled = await page.getByRole("button", { name: "Download .mod" }).isDisabled();
    const reasons = (await page.getByText(/station\/tool profile is a synthetic fixture/).count()) > 0;
    step("synthetic revision: ordinary download/save/launch disabled with a stated reason", exportDisabled && reasons, { exportDisabled, reasons });
    const [pkgDl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.getByRole("button", { name: "Download offline evidence package" }).click()]);
    const pkgPath = path.join(PKG_DIR, pkgDl.suggestedFilename());
    await pkgDl.saveAs(pkgPath);
    const pkgBytes = fs.readFileSync(pkgPath);
    const verification = verifyPackage(pkgBytes);
    fs.writeFileSync(path.join(PKG_DIR, "verification-report.json"), `${JSON.stringify({ file: path.basename(pkgPath), packageSha256: sha(pkgBytes), verifiedAt: new Date().toISOString(), ...verification }, null, 2)}\n`);
    await text(page, "Package download started");
    step("offline evidence package downloads and verifies against its manifest independently", verification.ok, { file: path.basename(pkgPath), sha256: sha(pkgBytes), failed: verification.checks.filter((c) => !c.ok) });
    await shot(page, "07-export-synthetic-package-downloaded");

    // E. Repeated real WebGL mounts (client-side navigation) and a real context loss.
    for (let i = 0; i < 10; i += 1) {
      await page.goBack();
      await page.waitForURL("**/generate", { timeout: 30000 });
      await page.locator(`${PREVIEW} canvas`).waitFor({ timeout: 30000 });
      await page.goForward();
      await page.waitForURL("**/export", { timeout: 30000 });
      await page.locator(`${PREVIEW} canvas`).waitFor({ timeout: 30000 });
    }
    await sleep(500);
    const gl = await page.evaluate(() => ({ ...window.__vdGl, canvasesInDocument: document.querySelectorAll("canvas").length }));
    // One detection canvas is created once per document and never released; one preview is mounted now.
    step("20 preview mounts: every unmounted renderer released its WebGL context (created − released ≤ 2), one canvas remains", gl.created >= 20 && gl.created - gl.lost <= 2 && gl.canvasesInDocument === 1, gl);
    await page.evaluate((sel) => {
      const c = document.querySelector(`${sel} canvas`);
      const g = c.getContext("webgl2") || c.getContext("webgl");
      g.getExtension("WEBGL_lose_context").loseContext();
    }, PREVIEW);
    await text(page, "The WebGL context was lost");
    const tableVisible = await page.locator('[aria-label="3D preview unavailable"] table').first().isVisible();
    step("real context loss shows the table fallback with the same targets", tableVisible);
    await shot(page, "08-webgl-context-loss-fallback");

    // F. Clipboard failure with an independent download fallback (non-synthetic legacy job).
    await uploadAndProcess(page, "legacy_straight_upload.txt", null);
    await ackAndReview(page);
    await reviewModule(page);
    const expectedHash = await outputHash(page);
    await page.getByRole("button", { name: "Copy text" }).click();
    await page.getByText(/^Copy:/).first().waitFor({ timeout: 30000 });
    let clipboardMode = "real_permission_denial";
    if ((await page.getByText("did not allow clipboard access").count()) === 0) {
      clipboardMode = "simulated_NotAllowedError (the headless browser granted clipboard writes)";
      await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new DOMException("Write permission denied.", "NotAllowedError")); });
      await page.getByRole("button", { name: "Copy text" }).click();
      await text(page, "did not allow clipboard access");
    }
    const [modDl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.getByRole("button", { name: "Download the .mod instead" }).click()]);
    const modPath = path.join(E, "downloads", modDl.suggestedFilename());
    await modDl.saveAs(modPath);
    step("clipboard failure offers a download that yields the exact module bytes", sha(fs.readFileSync(modPath)) === expectedHash, { clipboardMode, file: modDl.suggestedFilename() });
    await shot(page, "09-clipboard-denied-download-fallback");

    // G. XLSX in the browser: malformed, non-workbook, and a real workbook needing explicit mapping.
    await page.getByRole("button", { name: "Testing (CSV/XLSX)" }).click();
    await page.waitForURL("**/testing-upload", { timeout: 30000 });
    await page.getByLabel("Choose spreadsheet").setInputFiles(path.join(E, "malformed.xlsx"));
    await text(page, "The workbook could not be parsed");
    step("malformed .xlsx is rejected with a message, nothing staged", (await page.getByRole("button", { name: /Next: map columns/ }).isDisabled()));
    await shot(page, "10-xlsx-malformed-rejected");
    await page.getByLabel("Choose spreadsheet").setInputFiles(path.join(E, "notes.xlsx"));
    await sleep(800);
    const notesAlert = (await page.locator('[role="alert"]').allTextContents()).join(" | ");
    step("plain text renamed to .xlsx does not become point data", /could not be parsed|No data rows|empty|no sheets/i.test(notesAlert) && (await page.getByRole("button", { name: /Next: map columns/ }).isDisabled()), notesAlert);
    await page.getByLabel("Choose spreadsheet").setInputFiles(path.join(E, "points_explicit_headers.xlsx"));
    await text(page, "3 data rows");
    await page.getByRole("button", { name: /Next: map columns/ }).click();
    await page.waitForURL("**/testing-preview", { timeout: 30000 });
    const selectFor = (label) => page.locator("label", { hasText: label }).locator("select").first();
    step("non-standard headers are not mapped automatically", (await selectFor("X (mm)").inputValue()) === "");
    await page.getByLabel(/Euler Rx, Ry, Rz/).check();
    await page.getByLabel(/Use \[0,0,0,0\] for every target/).check();
    for (const [label, header] of [["Target name", "Pt"], ["X (mm)", "East (mm)"], ["Y (mm)", "North (mm)"], ["Z (mm)", "Up (mm)"], ["Rx (deg)", "A"], ["Ry (deg)", "B"], ["Rz (deg)", "C"]]) {
      await selectFor(label).selectOption(header);
    }
    await shot(page, "11-xlsx-explicit-column-mapping");
    await page.getByRole("button", { name: "Store point list as a source" }).click();
    await page.getByRole("button", { name: "Create job from this point list" }).click();
    await text(page, "Review revision 1");
    const table = await page.locator("table", { hasText: "Targets of the current revision" }).first().innerText();
    step("workbook rows parsed in the browser become a canonical job through the explicit mapping", /P1/.test(table) && /450\.500/.test(table) && /home/.test(table), table.split("\n").slice(0, 6));
    await shot(page, "12-xlsx-job-review");

    step("no request to a non-loopback host during the run (other than the deliberate probe; browser-internal edge:// pages logged separately)", log.externalRequests.length === 0, { external: log.externalRequests.slice(0, 10), browserInternalCount: log.browserInternalRequests.length });
  } catch (err) {
    step("run aborted", false, String(err).slice(0, 800));
    await shot(page, "zz-failure").catch(() => {});
  } finally {
    await browser.close();
    children.forEach(stop);
    log.finishedAt = new Date().toISOString();
    log.ok = log.steps.every((s) => s.ok);
    fs.writeFileSync(path.join(OUT, "browser-offline-milestone.json"), `${JSON.stringify(log, null, 2)}\n`);
  }
  process.exitCode = log.ok ? 0 : 1;
}

main().catch((err) => { console.error(err); children.forEach(stop); process.exit(1); });
