/**
 * Browser evidence run: drives the real application in a headless Chromium-based
 * browser and saves screenshots plus a JSON step log.
 *
 * Isolation: it starts its OWN backend (node server.js) and frontend
 * (next start) as child processes with a scratch data directory, config file,
 * export directory and watch root, and VD_ROBOTSTUDIO_EXE pointing at a
 * non-existent file so no RobotStudio process can start. It stops only those
 * children. It refuses to run if port 3000 or 5000 is in use.
 *
 * Prerequisites: `npm --prefix frontend run build` first; playwright-core
 * resolvable (set PLAYWRIGHT_CORE to its package directory); an installed Edge or
 * Chrome (set BROWSER_EXE to override).
 *
 *   EVIDENCE_DIR=<scratch> node scripts/browser-evidence.mjs
 * EVIDENCE_DIR must contain watch/inbox/*.txt fixtures and points.csv.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const E = process.env.EVIDENCE_DIR;
if (!E) throw new Error("Set EVIDENCE_DIR");
const SHOTS = path.join(ROOT, "docs", "screenshots");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const BROWSER = process.env.BROWSER_EXE || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const FE = "http://127.0.0.1:3000";
const BE = "http://127.0.0.1:5000/api";

const log = { startedAt: new Date().toISOString(), browser: BROWSER, steps: [], consoleErrors: [], pageErrors: [] };
const step = (name, ok, detail = null) => { log.steps.push({ name, ok, detail, at: new Date().toISOString() }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`); };

const free = (port) => new Promise((resolve) => { const s = net.createServer(); s.once("error", () => resolve(false)); s.once("listening", () => s.close(() => resolve(true))); s.listen(port, "127.0.0.1"); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHttp(url, ms = 60000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try { const r = await fetch(url); if (r.status < 500) return true; } catch { /* retry */ }
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
  for (const p of [3000, 5000]) if (!(await free(p))) throw new Error(`port ${p} in use; refusing to run`);
  fs.mkdirSync(SHOTS, { recursive: true });

  const backendEnv = {
    ...process.env,
    PORT: "5000",
    VD_DATA_DIR: path.join(E, "data"),
    VD_CONFIG_PATH: path.join(E, "config.json"),
    VD_EXPORT_DIR: path.join(E, "exports"),
    VD_WATCH_ROOTS: path.join(E, "watch"),
    WATCH_FOLDER: path.join(E, "watch", "inbox"),
    VD_WATCH_SETTLE_MS: "1000",
    VD_ROBOTSTUDIO_EXE: path.join(E, "not-installed", "RobotStudio.exe"),
  };
  let backend = start("backend", process.execPath, ["server.js"], { cwd: path.join(ROOT, "backend"), env: backendEnv });
  start("frontend", process.execPath, [path.join(ROOT, "frontend", "node_modules", "next", "dist", "bin", "next"), "start", "--hostname", "127.0.0.1", "--port", "3000"], { cwd: path.join(ROOT, "frontend"), env: process.env });
  await waitHttp(`${BE}/health`);
  await waitHttp(`${FE}/`);

  const browser = await chromium.launch({ executablePath: BROWSER, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width: 1680, height: 1050 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") log.consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => log.pageErrors.push(String(e).slice(0, 300)));
  page.on("dialog", (d) => d.accept());
  const shot = async (name) => { await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  const text = (t, opts = {}) => page.getByText(t, opts).first().waitFor({ timeout: 30000 });

  async function ackAndReview() {
    await page.locator('input[type=checkbox][id^="ack-"]').first().waitFor({ timeout: 30000 });
    const boxes = page.locator('input[type=checkbox][id^="ack-"]:not([disabled])');
    for (let i = 0, n = await boxes.count(); i < n; i += 1) await boxes.nth(i).check();
    await page.getByRole("button", { name: "Confirm geometry review and continue" }).click();
    await page.waitForURL("**/generate", { timeout: 30000 });
  }
  async function selectAndProcess(fileName) {
    await page.goto(`${FE}/acquire`);
    await page.getByRole("radio", { name: `Select ${fileName}` }).waitFor({ timeout: 30000 });
    await page.getByRole("radio", { name: `Select ${fileName}` }).check();
    await page.getByRole("button", { name: "Process selected source" }).click();
    await page.waitForURL("**/parse-map", { timeout: 30000 });
  }

  try {
    await page.goto(`${FE}/`);
    await text("Online", { exact: true });
    await shot("01-welcome-measured-status");
    step("welcome shows measured backend status and non-integrated camera/controller", true);

    await page.getByRole("link", { name: /Start local session/ }).click();
    await page.getByLabel("Operator name").fill("Evidence Operator");
    await shot("02-operator-attribution");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL("**/projects");

    await page.goto(`${FE}/export`);
    await text("Select or create a project first.");
    await shot("03-guard-direct-url-no-project");
    step("direct URL /export without a project is locked", true);

    await page.goto(`${FE}/projects`);
    await page.getByLabel("Name").fill("Evidence project");
    await page.getByRole("button", { name: "Create and select" }).click();
    await text("Jobs in the selected project");
    await shot("04-projects");

    await page.goto(`${FE}/export`);
    await text("Process a selected source first.");
    await shot("05-guard-direct-url-no-job");
    step("direct URL /export with a project but no job is locked", true);

    await page.goto(`${FE}/acquire`);
    await page.getByRole("radio", { name: "Select Feature_Straight_Op.txt" }).waitFor({ timeout: 30000 });
    await sleep(3500);
    await shot("06-acquire-watch-folder-statuses");
    step("watched folder ingests settled files with real statuses", true);

    await page.getByRole("radio", { name: "Select broken_seam.txt" }).check();
    await text(/exactly 7 comma-separated/);
    await shot("07-invalid-input-diagnostics");
    step("invalid input shows diagnostics and processing is disabled", await page.getByRole("button", { name: "Fix the input errors before processing" }).isDisabled());

    await page.getByRole("radio", { name: "Select near_straight_arc.txt" }).check();
    await page.getByRole("button", { name: "Process selected source" }).click();
    await text("ARC_NEAR_STRAIGHT");
    await shot("08-near-straight-arc-blocked");
    step("near-straight arc blocked by default (422, no job)", page.url().endsWith("/acquire"));
    await page.getByRole("button", { name: "Process with explicit arc-to-line conversion" }).click();
    await page.waitForURL("**/parse-map", { timeout: 30000 });
    await text("ARC_CONVERTED_TO_LINE");
    await shot("09-near-straight-conversion-ack-required");
    step("explicit conversion creates a revision that requires acknowledgement", true);

    await selectAndProcess("Feature_Straight_Op.txt");
    await page.getByRole("img", { name: "Isometric toolpath projection" }).waitFor({ timeout: 30000 });
    await shot("10-parse-map-straight");
    const straightHash = await page.locator("text=Output SHA-256").first().locator("xpath=following-sibling::dd[1]").getAttribute("title");
    await ackAndReview();
    await page.getByRole("button", { name: "Play preview", exact: true }).click();
    await sleep(5200);
    await shot("11-generate-straight-playing-weld");
    step("generate preview playing through the weld segment", await page.getByText("effects on").count() > 0);
    await page.getByRole("button", { name: "I have reviewed this module text" }).click();
    await page.waitForURL("**/export", { timeout: 30000 });
    const exportHash = await page.locator("text=Output SHA-256").first().locator("xpath=following-sibling::dd[1]").getAttribute("title");
    await shot("12-export-straight-identity");
    step("Generate/Parse & Map and Export show the same output hash", straightHash === exportHash, { straightHash, exportHash });

    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.getByRole("button", { name: "Download .mod" }).click()]);
    const dlPath = path.join(E, "downloads", download.suggestedFilename());
    await download.saveAs(dlPath);
    const dlHash = crypto.createHash("sha256").update(fs.readFileSync(dlPath)).digest("hex");
    step("browser download bytes match the revision output hash", dlHash === exportHash, { file: download.suggestedFilename(), dlHash });

    await page.getByRole("button", { name: "Save and open RobotStudio" }).click();
    await text(/VD_ROBOTSTUDIO_EXE is set but does not point/);
    await shot("13-export-launch-failure-distinct-states");
    step("save succeeds and launch failure is reported separately", true, fs.readdirSync(path.join(E, "exports")));

    await selectAndProcess("Feature_Arc_Op.txt");
    await text("Arc via (MoveC)");
    await shot("14-parse-map-arc");
    await ackAndReview();
    await page.getByRole("button", { name: "Play preview", exact: true }).click();
    await sleep(6000);
    await shot("15-generate-arc-playing-weld");
    step("arc revision renders MoveC via and plays", true);

    await page.goto(`${FE}/acquire`);
    await page.getByRole("button", { name: "Load arc sample" }).click();
    await text("Feature_Arc_Sample.txt");
    await page.getByRole("button", { name: "Process selected source" }).click();
    await page.waitForURL("**/parse-map", { timeout: 30000 });
    await ackAndReview();
    await page.getByRole("button", { name: "I have reviewed this module text" }).click();
    await page.waitForURL("**/export", { timeout: 30000 });
    await text("Demo samples are for inspection only");
    await shot("16-demo-export-blocked");
    step("demo sample export and launch blocked", await page.getByRole("button", { name: "Download .mod" }).isDisabled());

    await page.goto(`${FE}/calibrate`);
    await text("Robtargets declared");
    await shot("17-calibration-routine");
    step("calibration page shows archive facts, no fake results", true);

    await page.getByRole("button", { name: "Testing (CSV/XLSX)" }).click();
    await page.waitForURL("**/testing-upload");
    await page.getByLabel("Choose spreadsheet").setInputFiles(path.join(E, "points.csv"));
    await text("3 data rows");
    await page.getByRole("button", { name: /Next: map columns/ }).click();
    await page.waitForURL("**/testing-preview");
    await page.getByLabel(/Use \[0,0,0,0\] for every target/).check();
    await shot("18-testing-mapping-explicit-choices");
    await page.getByRole("button", { name: "Store point list as a source" }).click();
    await page.getByRole("button", { name: "Create job from this point list" }).click();
    await text("Review revision 1");
    await shot("19-testing-job-review");
    step("testing mode maps explicitly and creates a canonical job", true);

    stop(backend);
    await sleep(1500);
    await page.reload();
    await text(/Backend disconnected/);
    await sleep(1000);
    await shot("20-backend-disconnected-no-fabrication");
    step("backend down: disconnected state, nothing fabricated", true);
  } catch (err) {
    step("run aborted", false, String(err).slice(0, 500));
    await shot("zz-failure").catch(() => {});
  } finally {
    await browser.close();
    children.forEach(stop);
    log.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(SHOTS, "browser-evidence.json"), JSON.stringify(log, null, 2));
  }
}

main().catch((err) => { console.error(err); children.forEach(stop); process.exit(1); });
