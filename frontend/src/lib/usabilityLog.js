/**
 * Optional, local timing/event capture for a FUTURE human evaluation.
 *
 * Off by default. When enabled it records only a fixed set of workflow
 * boundaries with milliseconds since capture started and a few non-personal
 * details (revision number, planned seam type, profile id). No operator name,
 * file name, path, coordinate or hash is stored. Data stay in this browser
 * until the evaluator exports or clears them. Nothing is sent anywhere.
 *
 * Recording an event is not evidence that a study happened; an exported log
 * from a real session is.
 */

export const USABILITY_KEY = "vd.usabilityEvents.v1";
export const USABILITY_EVENTS = Object.freeze([
  "capture_started",
  "source_selected",
  "job_created",
  "revision_created",
  "geometry_reviewed",
  "module_reviewed",
  "module_downloaded",
  "evidence_package_downloaded",
  "copy_failed_download_offered",
]);
const DETAIL_KEYS = { revision: "number", plannedType: "string", profileId: "string", outcome: "string" };
const MAX_EVENTS = 2000;

function sanitizeDetail(detail) {
  const out = {};
  if (!detail || typeof detail !== "object") return out;
  for (const [k, type] of Object.entries(DETAIL_KEYS)) {
    const v = detail[k];
    if (typeof v === type && (type !== "string" || /^[a-z0-9_@.-]{1,64}$/i.test(v))) out[k] = v;
  }
  return out;
}

export function createUsabilityLog({ storage = null, now = () => Date.now() } = {}) {
  const read = () => {
    try {
      const s = storage && JSON.parse(storage.getItem(USABILITY_KEY));
      if (s && s.format === "vd-usability-events@1" && Array.isArray(s.events)) return s;
    } catch { /* corrupt or unavailable: start empty */ }
    return { format: "vd-usability-events@1", enabled: false, startedAt: null, events: [] };
  };
  const write = (s) => { try { if (storage) storage.setItem(USABILITY_KEY, JSON.stringify(s)); } catch { /* storage full or blocked */ } };

  return {
    state: read,
    enable() {
      const s = read();
      if (s.enabled) return s;
      const next = { ...s, enabled: true, startedAt: now(), events: [{ tMs: 0, event: "capture_started", detail: {} }] };
      write(next);
      return next;
    },
    disable() {
      const next = { ...read(), enabled: false };
      write(next);
      return next;
    },
    clear() {
      const next = { format: "vd-usability-events@1", enabled: false, startedAt: null, events: [] };
      write(next);
      return next;
    },
    /** Records an allowed event if capture is enabled; returns whether it was recorded. */
    record(event, detail) {
      const s = read();
      if (!s.enabled || !USABILITY_EVENTS.includes(event) || s.events.length >= MAX_EVENTS) return false;
      s.events.push({ tMs: Math.max(0, now() - s.startedAt), event, detail: sanitizeDetail(detail) });
      write(s);
      return true;
    },
    exportJson() {
      const s = read();
      return JSON.stringify({
        format: s.format,
        note: "Local workflow timing events. Milliseconds since capture started. No names, files, coordinates or hashes. Not a study result by itself.",
        eventCount: s.events.length,
        events: s.events,
      }, null, 2);
    },
  };
}

function browserStorage() {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}

/** Shared browser instance (storage resolved lazily so server rendering is unaffected). */
export const usabilityLog = {
  get: () => createUsabilityLog({ storage: browserStorage() }),
  record: (event, detail) => createUsabilityLog({ storage: browserStorage() }).record(event, detail),
};
