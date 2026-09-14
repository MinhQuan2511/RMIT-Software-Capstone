/**
 * Workflow modes, stable stage IDs and artefact-based prerequisites.
 *
 * The frontend guard improves usability (locked navigation, reasons, no
 * redirect loops). It is not the enforcement point: the backend re-checks the
 * stored job revision for every review, download and launch.
 *
 * Internal mode id `tcp` is a legacy name kept so saved values keep working.
 * It does NOT mean a TCP/IP connection to TracerStudio exists; the user-facing
 * label is "File import".
 */

export const MODES = {
  tcp: {
    id: "tcp",
    label: "File import",
    description: "Seam descriptor files from the watched folder or a manual upload.",
    jobMode: "file_import",
  },
  testing: {
    id: "testing",
    label: "Testing (CSV/XLSX)",
    description: "An operator-supplied point list, mapped explicitly and compiled by the same generator.",
    jobMode: "testing",
  },
};

const PROJECT = { id: "project", path: "/projects", label: "Project", icon: "folder" };
const GENERATE = { id: "generate", path: "/generate", label: "Generate", icon: "precision_manufacturing" };
const EXPORT = { id: "export", path: "/export", label: "Download / Open RobotStudio", shortLabel: "Download", icon: "download" };

export const STAGES = {
  tcp: [
    PROJECT,
    { id: "acquire", path: "/acquire", label: "Acquire", icon: "center_focus_strong" },
    { id: "parse-map", path: "/parse-map", label: "Parse & Map", icon: "schema" },
    GENERATE,
    EXPORT,
  ],
  testing: [
    PROJECT,
    { id: "testing-upload", path: "/testing-upload", label: "Upload", icon: "upload_file" },
    { id: "testing-preview", path: "/testing-preview", label: "Map & Review", icon: "visibility" },
    GENERATE,
    EXPORT,
  ],
};

/** Independent tools reachable from any mode. */
export const TOOL_ROUTES = [{ path: "/calibrate", label: "Calibration pose routine", icon: "tune" }];

/** Pages kept only to explain features that are not implemented. */
export const UNAVAILABLE_ROUTES = ["/configure", "/preview"];

export const stagesFor = (mode) => STAGES[mode] || STAGES.tcp;

export function stageForPath(mode, path) {
  return stagesFor(mode).find((s) => s.path === path) || null;
}

/**
 * @param {string} mode
 * @param {string} stageId
 * @param {{
 *   projectId: string|null,
 *   sourceId: string|null,
 *   stagedSheet?: boolean,   // Testing mode: a spreadsheet parsed in memory, not yet stored
 *   job: {record: object, gates: object}|null,
 *   jobLoading: boolean,
 *   jobError: string|null,
 * }} snap
 * @returns {{allowed: boolean, pending?: boolean, reason?: string, fixPath?: string}}
 */
export function evaluateStage(mode, stageId, snap) {
  const stages = stagesFor(mode);
  const first = (id) => stages.find((s) => s.id === id);
  const expectedJobMode = (MODES[mode] || MODES.tcp).jobMode;
  const record = snap.job && snap.job.record;
  const gates = snap.job && snap.job.gates;
  const intake = mode === "testing" ? first("testing-upload") : first("acquire");

  if (stageId === "project") return { allowed: true };

  if (!snap.projectId) {
    return { allowed: false, reason: "Select or create a project first.", fixPath: "/projects" };
  }
  if (stageId === "acquire" || stageId === "testing-upload") return { allowed: true };

  if (stageId === "testing-preview") {
    if (snap.stagedSheet) return { allowed: true };
    if (snap.sourceId && snap.sourceId.startsWith("src_points_")) return { allowed: true };
    if (record && record.mode === "testing") return { allowed: true };
    return { allowed: false, reason: "Upload and store a point list first.", fixPath: intake.path };
  }

  // Remaining stages need the current job revision.
  if (snap.jobLoading) return { allowed: false, pending: true, reason: "Loading the current job revision…" };
  if (snap.jobError) return { allowed: false, reason: snap.jobError, fixPath: intake.path };
  if (!record) {
    return { allowed: false, reason: mode === "testing" ? "Create a job from a reviewed point list first." : "Process a selected source first.", fixPath: intake.path };
  }
  if (record.mode !== expectedJobMode) {
    return { allowed: false, reason: `The selected job was created in ${record.mode === "testing" ? "Testing" : "File import"} mode. Switch mode or select another job.`, fixPath: "/projects" };
  }

  const reviewPath = mode === "testing" ? "/testing-preview" : "/parse-map";
  if (stageId === "parse-map") return { allowed: true };
  if (stageId === "generate") {
    if (!gates.generate.allowed) return { allowed: false, reason: gates.generate.reasons.map((r) => r.message).join(" "), fixPath: reviewPath };
    return { allowed: true };
  }
  if (stageId === "export") {
    if (gates.validation.operatorReview !== "module_reviewed") {
      return {
        allowed: false,
        reason: gates.generate.allowed ? "Review the generated module on Generate first." : "Review the geometry first.",
        fixPath: gates.generate.allowed ? "/generate" : reviewPath,
      };
    }
    return { allowed: true };
  }
  return { allowed: false, reason: "Unknown stage." };
}
