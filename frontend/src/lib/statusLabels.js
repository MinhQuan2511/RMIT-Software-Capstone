/**
 * Wording for the separate validation states. Each state has text and an icon
 * so status never depends on colour alone.
 */

export const VALIDATION_ROWS = [
  { key: "input", label: "Input / schema" },
  { key: "geometry", label: "Geometry checks" },
  { key: "applicationPrechecks", label: "Application prechecks" },
  { key: "operatorReview", label: "Operator review (this revision)" },
  { key: "robotStudio", label: "RobotStudio import / validation" },
  { key: "controllerConnection", label: "Controller connection" },
  { key: "physicalCommissioning", label: "Physical commissioning" },
  { key: "reachability", label: "Reachability / IK" },
  { key: "collision", label: "Collision checking" },
  { key: "singularities", label: "Singularity / joint limits" },
];

const STATE = {
  passed: { text: "Passed", tone: "ok", icon: "check_circle" },
  failed: { text: "Failed", tone: "bad", icon: "cancel" },
  not_reviewed: { text: "Not reviewed", tone: "pending", icon: "radio_button_unchecked" },
  geometry_reviewed: { text: "Geometry reviewed — module not yet reviewed", tone: "pending", icon: "rule" },
  module_reviewed: { text: "Geometry and module reviewed", tone: "ok", icon: "task_alt" },
  not_run: { text: "Not run — external validation required", tone: "neutral", icon: "pending" },
  operator_reported_pass: { text: "Operator-reported pass (not verified by this app)", tone: "info", icon: "person_check" },
  operator_reported_fail: { text: "Operator-reported fail", tone: "bad", icon: "report" },
  not_integrated: { text: "Not integrated in this application", tone: "neutral", icon: "link_off" },
  not_recorded: { text: "No evidence recorded", tone: "neutral", icon: "remove_circle_outline" },
  not_evaluated: { text: "Not evaluated", tone: "neutral", icon: "help_outline" },
};

export function describeState(value) {
  return STATE[value] || { text: String(value || "Not evaluated"), tone: "neutral", icon: "help_outline" };
}

export const TONE_CLASSES = {
  ok: "bg-emerald-50 text-emerald-800 border-emerald-300",
  bad: "bg-red-50 text-red-800 border-red-300",
  pending: "bg-amber-50 text-amber-900 border-amber-300",
  info: "bg-sky-50 text-sky-900 border-sky-300",
  neutral: "bg-slate-50 text-slate-700 border-slate-300",
};

export const SOURCE_KIND_LABEL = {
  manual_upload: "Manual upload",
  watch_folder: "Watched folder",
  demo: "DEMO SAMPLE — inspection only",
  testing_point_list: "Testing point list",
};

export const SEVERITY = {
  error: { text: "Error", icon: "error", tone: "bad" },
  warning: { text: "Warning", icon: "warning", tone: "pending" },
  info: { text: "Info", icon: "info", tone: "info" },
};

export const shortHash = (h) => (typeof h === "string" ? `${h.slice(0, 12)}…` : "—");
