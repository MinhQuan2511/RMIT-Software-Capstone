/**
 * Versioned local session.
 *
 * The browser keeps references only — which project, job, revision and source
 * the operator is looking at, plus the attribution name. Every artefact (geometry,
 * module, review state) is re-fetched from the backend. A stale or edited value
 * here can select what to load, never what is allowed: the backend re-evaluates
 * every gate.
 */

export const SESSION_KEY = "vd_session_v2";
export const SESSION_SCHEMA = 2;

// Keys written by the pre-v2 application. Their completion flags are not
// artefacts and must not unlock anything, so they are removed on load.
export const LEGACY_KEYS = ["vd_tcp_workflow_progress", "vd_tcp_last_payload", "vd_auth_state", "vd_tracerstudio_mode"];

const PATTERNS = {
  projectId: /^prj_[a-f0-9]{32}$/,
  jobId: /^job_[a-f0-9]{32}$/,
  sourceId: /^src_(manual|watch|demo|points)_[a-f0-9]{24}$/,
};
const OPERATOR = /^[\p{L}\p{N} ._'@-]{1,64}$/u;

export function emptySession() {
  return { schemaVersion: SESSION_SCHEMA, operator: null, mode: "tcp", projectId: null, jobId: null, revision: null, sourceId: null };
}

/**
 * @param {string|null|undefined} raw  localStorage value
 * @returns {{session: object, notice: string|null}}
 */
export function parseSession(raw) {
  if (raw === null || raw === undefined || raw === "") return { session: emptySession(), notice: null };
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { session: emptySession(), notice: "The saved session could not be read and was reset. No stored jobs were affected." };
  }
  if (!data || typeof data !== "object" || data.schemaVersion !== SESSION_SCHEMA) {
    return { session: emptySession(), notice: "A session saved by an older version was reset. Reopen your project from the Projects page." };
  }
  const session = emptySession();
  const dropped = [];
  if (typeof data.operator === "string" && OPERATOR.test(data.operator.trim())) session.operator = data.operator.trim();
  else if (data.operator !== null && data.operator !== undefined) dropped.push("operator");
  if (data.mode === "tcp" || data.mode === "testing") session.mode = data.mode;
  else if (data.mode !== undefined) dropped.push("mode");
  for (const key of ["projectId", "jobId", "sourceId"]) {
    if (data[key] === null || data[key] === undefined) continue;
    if (typeof data[key] === "string" && PATTERNS[key].test(data[key])) session[key] = data[key];
    else dropped.push(key);
  }
  if (data.revision !== null && data.revision !== undefined) {
    if (Number.isInteger(data.revision) && data.revision >= 1) session.revision = data.revision;
    else dropped.push("revision");
  }
  // A job reference without a revision (or vice versa) is incomplete.
  if (!session.jobId || !session.revision) { session.jobId = null; session.revision = null; }
  return { session, notice: dropped.length ? `Invalid saved values were discarded (${dropped.join(", ")}).` : null };
}

export function serializeSession(session) {
  return JSON.stringify({ ...emptySession(), ...session, schemaVersion: SESSION_SCHEMA });
}

export const isValidOperatorName = (name) => typeof name === "string" && OPERATOR.test(name.trim());

/** Loads and cleans localStorage; never throws. */
export function loadSessionFromStorage(storage) {
  try {
    const hadLegacy = LEGACY_KEYS.some((k) => storage.getItem(k) !== null);
    LEGACY_KEYS.forEach((k) => storage.removeItem(k));
    const result = parseSession(storage.getItem(SESSION_KEY));
    if (hadLegacy && !result.notice) {
      result.notice = "Workflow progress flags saved by the previous version were cleared; they did not correspond to stored jobs.";
    }
    return result;
  } catch {
    return { session: emptySession(), notice: "Browser storage is unavailable; the session will not survive a reload." };
  }
}

export function saveSessionToStorage(storage, session) {
  try {
    storage.setItem(SESSION_KEY, serializeSession(session));
    return true;
  } catch {
    return false;
  }
}
