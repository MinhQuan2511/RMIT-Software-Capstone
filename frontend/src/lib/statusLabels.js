/**
 * Wording for the separate validation states. Each state has text and an icon
 * so status never depends on colour alone.
 */

import { CLEARANCE_STATES } from "./clearanceView.js";

export const VALIDATION_ROWS = [
  { key: "input", label: "Input / schema" },
  { key: "geometry", label: "Geometry checks" },
  { key: "applicationPrechecks", label: "Application prechecks" },
  { key: "orientationCheck", label: "Joint-relative orientation (mathematical check)" },
  { key: "operatorReview", label: "Operator review (this revision)" },
  { key: "configurationProvenance", label: "Station / tool configuration" },
  { key: "sourceProvenance", label: "Source provenance" },
  { key: "robotStudio", label: "RobotStudio import / validation" },
  { key: "calibrationTransform", label: "Calibration transform" },
  { key: "controllerConnection", label: "Controller connection" },
  { key: "physicalCommissioning", label: "Physical commissioning" },
  { key: "reachability", label: "Reachability / IK" },
  { key: "workpieceClearance", label: "Workpiece clearance (modeled plates only)" },
  { key: "collision", label: "Robot / cell collision checking" },
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
  mathematical_check_passed: { text: "Mathematical check passed — not robot verified", tone: "info", icon: "calculate" },
  mathematical_check_failed: { text: "Mathematical check failed", tone: "bad", icon: "cancel" },
  not_applicable: { text: "Not applicable to this profile", tone: "neutral", icon: "remove" },
  synthetic_fixture: { text: "SYNTHETIC fixture — offline evidence only", tone: "pending", icon: "science" },
  operator_declared: { text: "Operator-declared — not verified by this app", tone: "info", icon: "person" },
  operator_reported_external_evidence: { text: "Operator-declared, cites external evidence — not verified", tone: "info", icon: "person_check" },
  documented_unresolved: { text: "Unresolved", tone: "bad", icon: "help" },
  legacy_fixed_profile: { text: "Legacy fixed-orientation profile", tone: "neutral", icon: "history" },
  user_supplied_unverified: { text: "User-supplied — origin not verified", tone: "neutral", icon: "help_outline" },
  recorded_device_export: { text: "Declared device export (operator statement)", tone: "info", icon: "person" },
  provenance_not_recorded: { text: "Not recorded (older revision)", tone: "neutral", icon: "remove_circle_outline" },
  not_applied: { text: "Not applied — robot-base input assumed", tone: "neutral", icon: "block" },
  not_validated: { text: "Not validated — no calibration evidence", tone: "neutral", icon: "help_outline" },
  disabled: { text: "Disabled", tone: "neutral", icon: "block" },
  ambiguous_multiple_4x4_matrices: { text: "Ambiguous — several 4×4 matrices", tone: "bad", icon: "help" },
  ...CLEARANCE_STATES,
  assessed: { text: "Assessed", tone: "info", icon: "done" },
  partially_assessed: { text: "Partially assessed", tone: "pending", icon: "rule" },
};

export const PROVENANCE_LABEL = {
  recorded_device_export: "Declared device export",
  user_supplied_unverified: "Unverified origin",
  synthetic_fixture: "SYNTHETIC fixture",
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
