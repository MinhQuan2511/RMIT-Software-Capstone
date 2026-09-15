import test from "node:test";
import assert from "node:assert/strict";
import { parseSession, loadSessionFromStorage, saveSessionToStorage, SESSION_KEY, LEGACY_KEYS, emptySession } from "../src/lib/sessionState.js";
import { evaluateStage, stagesFor, stageForPath } from "../src/lib/workflowStages.js";
import { createLatestRequestTracker } from "../src/lib/latestRequest.js";
import { createToastController, TOAST_EXIT_MS, TOAST_VISIBLE_MS } from "../src/lib/toastController.js";

const PRJ = `prj_${"a".repeat(32)}`;
const JOB = `job_${"b".repeat(32)}`;

function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), keys: () => [...m.keys()] };
}

test("T18 session: corrupt, old-schema and tampered values reset safely with an explanation", () => {
  assert.deepEqual(parseSession(null), { session: emptySession(), notice: null });
  assert.match(parseSession("{not json").notice, /could not be read/);
  assert.match(parseSession(JSON.stringify({ schemaVersion: 1, generateComplete: true })).notice, /older version/);
  const tampered = parseSession(JSON.stringify({ schemaVersion: 2, projectId: "../../etc", jobId: JOB, revision: "1", mode: "api", operator: "<script>" }));
  assert.equal(tampered.session.projectId, null);
  assert.equal(tampered.session.jobId, null, "job without a valid revision is dropped");
  assert.equal(tampered.session.mode, "tcp");
  assert.equal(tampered.session.operator, null);
  assert.match(tampered.notice, /discarded/);
  const ok = parseSession(JSON.stringify({ schemaVersion: 2, projectId: PRJ, jobId: JOB, revision: 3, mode: "testing", operator: "A. Operator" }));
  assert.deepEqual(ok.session, { schemaVersion: 2, operator: "A. Operator", mode: "testing", projectId: PRJ, jobId: JOB, revision: 3, sourceId: null });
  assert.equal(ok.notice, null);
});

test("T18 session: legacy completion flags are removed and never unlock anything", () => {
  const storage = memoryStorage({ vd_tcp_workflow_progress: JSON.stringify({ generateComplete: true, step6Complete: true }), vd_auth_state: '{"isAuthenticated":true}' });
  const { session, notice } = loadSessionFromStorage(storage);
  assert.equal(session.jobId, null);
  assert.match(notice, /progress flags/);
  for (const k of LEGACY_KEYS) assert.equal(storage.getItem(k), null);
  // Stage evaluation never reads localStorage; without a server job, Export stays locked.
  assert.equal(evaluateStage("tcp", "export", { projectId: PRJ, sourceId: null, job: null, jobLoading: false, jobError: null }).allowed, false);
  assert.ok(saveSessionToStorage(storage, { ...session, projectId: PRJ }));
  assert.equal(JSON.parse(storage.getItem(SESSION_KEY)).projectId, PRJ);
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
  assert.match(loadSessionFromStorage(broken).notice, /unavailable/);
  assert.equal(saveSessionToStorage(broken, session), false);
});

const gates = (over = {}) => ({
  generate: { allowed: false, reasons: [{ code: "GEOMETRY_NOT_REVIEWED", message: "Review the geometry and diagnostics on Parse & Map first." }] },
  export: { allowed: false, reasons: [] },
  validation: { operatorReview: "not_reviewed" },
  ...over,
});
const snap = (over = {}) => ({ projectId: PRJ, sourceId: null, job: null, jobLoading: false, jobError: null, ...over });

test("T17 stage guard: prerequisites come from server artefacts, with reasons", () => {
  assert.deepEqual(stagesFor("tcp").map((s) => s.id), ["project", "acquire", "parse-map", "generate", "export"]);
  assert.deepEqual(stagesFor("testing").map((s) => s.id), ["project", "testing-upload", "testing-preview", "generate", "export"]);
  assert.equal(stageForPath("tcp", "/testing-upload"), null);

  const noProject = evaluateStage("tcp", "acquire", snap({ projectId: null }));
  assert.equal(noProject.allowed, false);
  assert.equal(noProject.fixPath, "/projects");
  assert.equal(evaluateStage("tcp", "acquire", snap()).allowed, true);
  assert.match(evaluateStage("tcp", "parse-map", snap()).reason, /Process a selected source/);

  const job = { record: { mode: "file_import" }, gates: gates() };
  assert.equal(evaluateStage("tcp", "parse-map", snap({ job })).allowed, true);
  const gen = evaluateStage("tcp", "generate", snap({ job }));
  assert.equal(gen.allowed, false);
  assert.equal(gen.fixPath, "/parse-map");
  assert.match(gen.reason, /Review the geometry/);

  const reviewed = { record: { mode: "file_import" }, gates: gates({ generate: { allowed: true, reasons: [] }, validation: { operatorReview: "geometry_reviewed" } }) };
  assert.equal(evaluateStage("tcp", "generate", snap({ job: reviewed })).allowed, true);
  assert.equal(evaluateStage("tcp", "export", snap({ job: reviewed })).fixPath, "/generate");
  const done = { record: { mode: "file_import" }, gates: gates({ generate: { allowed: true, reasons: [] }, validation: { operatorReview: "module_reviewed" } }) };
  assert.equal(evaluateStage("tcp", "export", snap({ job: done })).allowed, true);

  assert.equal(evaluateStage("tcp", "generate", snap({ jobLoading: true })).pending, true);
  assert.equal(evaluateStage("testing", "generate", snap({ job: done })).allowed, false, "mode mismatch");
  assert.equal(evaluateStage("testing", "testing-preview", snap({ sourceId: `src_points_${"c".repeat(24)}` })).allowed, true);
  assert.equal(evaluateStage("testing", "testing-preview", snap({ sourceId: `src_manual_${"c".repeat(24)}` })).allowed, false);
  assert.equal(evaluateStage("testing", "testing-preview", snap({ stagedSheet: true })).allowed, true);
  assert.equal(evaluateStage("testing", "testing-preview", snap({ projectId: null, stagedSheet: true })).allowed, false);
});

test("T20 latest-request tracker: a late response for an older request is ignored", async () => {
  const tracker = createLatestRequestTracker();
  const applied = [];
  const load = (label, delay) => {
    const token = tracker.begin();
    return new Promise((r) => setTimeout(r, delay)).then(() => { if (token.isCurrent()) applied.push(label); });
  };
  await Promise.all([load("job A (slow)", 30), load("job B (fast)", 5)]);
  assert.deepEqual(applied, ["job B (fast)"]);
  const t = tracker.begin();
  tracker.invalidate();
  assert.equal(t.isCurrent(), false);
});

function fakeTimers() {
  let now = 0;
  let id = 0;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => { id += 1; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimer: (h) => timers.delete(h),
    advance(ms) {
      now += ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        due[1].fn();
      }
    },
  };
}

test("W-11 toast: a new toast during the exit animation is not hidden by the old timer; repeats reset the timer", () => {
  const timers = fakeTimers();
  const toast = createToastController(timers);
  toast.show("First", "one");
  timers.advance(TOAST_VISIBLE_MS); // first begins exiting
  assert.equal(toast.getState().phase, "exiting");
  timers.advance(100);
  toast.show("Second", "two"); // arrives inside the 350 ms exit window
  timers.advance(TOAST_EXIT_MS); // old exit timer would have fired here
  assert.equal(toast.getState().toast.title, "Second");
  assert.equal(toast.getState().phase, "visible");

  timers.advance(TOAST_VISIBLE_MS - 1000);
  toast.show("Third", "three"); // repeat while open resets the visible timer
  timers.advance(1500);
  assert.equal(toast.getState().toast.title, "Third");
  assert.equal(toast.getState().phase, "visible");
  timers.advance(TOAST_VISIBLE_MS);
  timers.advance(TOAST_EXIT_MS);
  assert.equal(toast.getState().toast, null);
  toast.show("Err", "x", "error");
  timers.advance(TOAST_VISIBLE_MS + 10);
  assert.equal(toast.getState().phase, "visible", "errors stay longer");
  toast.destroy();
});
