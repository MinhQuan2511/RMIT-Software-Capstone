/**
 * Client for the local backend API (v2).
 *
 * Every mutating request carries the per-process CSRF token from
 * GET /api/session. Errors are normalised into ApiError so pages can tell a
 * disconnected backend (network) from a rejected request (status + code +
 * diagnostics). Nothing here substitutes data when a request fails.
 */

import axios from "axios";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:5000/api";

export class ApiError extends Error {
  constructor({ status = 0, code, message, diagnostics = [], details = null, network = false, cancelled = false }) {
    super(message);
    this.status = status;
    this.code = code;
    this.diagnostics = Array.isArray(diagnostics) ? diagnostics : [];
    this.details = details;
    this.network = network;
    this.cancelled = cancelled;
  }
}

const http = axios.create({ baseURL: API_BASE, timeout: 20000 });

let tokenPromise = null;
function csrfToken(force = false) {
  if (!tokenPromise || force) {
    tokenPromise = http.get("/session", { timeout: 5000 }).then((r) => r.data.csrfToken).catch((err) => {
      tokenPromise = null;
      throw err;
    });
  }
  return tokenPromise;
}

/** Error body of a response, also when the request asked for binary data. */
function errorBody(response) {
  let data = response && response.data;
  if (typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer) {
    try { data = JSON.parse(new TextDecoder().decode(data)); } catch { data = null; }
  }
  return data && typeof data === "object" && data.error ? data.error : {};
}

function normalize(err) {
  if (axios.isCancel(err) || err?.code === "ERR_CANCELED") {
    return new ApiError({ code: "CANCELLED", message: "Request cancelled.", cancelled: true });
  }
  if (err?.response) {
    const body = errorBody(err.response);
    return new ApiError({
      status: err.response.status,
      code: body.code || `HTTP_${err.response.status}`,
      message: body.message || `Request failed with status ${err.response.status}.`,
      diagnostics: body.diagnostics,
      details: body.details,
    });
  }
  return new ApiError({
    code: "BACKEND_UNREACHABLE",
    message: "The backend is not reachable. Start it (npm run dev or npm run backend) and retry. No data was generated.",
    network: true,
  });
}

async function request(config, retried = false) {
  try {
    const method = (config.method || "get").toLowerCase();
    const headers = { ...(config.headers || {}) };
    if (method !== "get" && method !== "head") headers["X-VD-CSRF"] = await csrfToken();
    const res = await http.request({ ...config, headers });
    return config.fullResponse ? res : res.data;
  } catch (err) {
    const code = err?.response ? errorBody(err.response).code : undefined;
    if (!retried && err?.response?.status === 403 && code === "CSRF_TOKEN_INVALID") {
      await csrfToken(true).catch(() => {});
      return request(config, true);
    }
    throw err instanceof ApiError ? err : normalize(err);
  }
}

const rev = (jobId, revision) => `/jobs/${encodeURIComponent(jobId)}/revisions/${encodeURIComponent(revision)}`;

export const api = {
  health: (signal) => request({ url: "/health", signal, timeout: 4000 }),
  profiles: () => request({ url: "/profiles" }),

  listProjects: () => request({ url: "/projects" }),
  createProject: (name, description = "") => request({ method: "post", url: "/projects", data: { name, description } }),
  getProject: (projectId, signal) => request({ url: `/projects/${encodeURIComponent(projectId)}`, signal }),

  watchStatus: (signal) => request({ url: "/watch-folder", signal }),
  setWatchFolder: (watchFolder) => request({ method: "put", url: "/watch-folder", data: { watchFolder } }),
  scanWatchFolder: (signal) => request({ method: "post", url: "/watch-folder/scan", signal }),

  listSources: (limit = 30) => request({ url: `/sources?limit=${limit}` }),
  getSource: (sourceId, signal) => request({ url: `/sources/${encodeURIComponent(sourceId)}`, signal }),
  /** declaration: null, or { provenance, operator, note } applied to every uploaded file. */
  uploadSources: (files, declaration = null) => {
    const form = new FormData();
    for (const f of files) form.append("files", f, f.name);
    if (declaration) {
      form.append("provenance", declaration.provenance);
      form.append("operator", declaration.operator || "");
      if (declaration.note) form.append("note", declaration.note);
    }
    return request({ method: "post", url: "/sources", data: form });
  },
  declareSourceProvenance: (sourceId, provenance, operator, note = "") => request({ method: "post", url: `/sources/${encodeURIComponent(sourceId)}/provenance`, data: { provenance, operator, note } }),
  loadDemoSample: (sample) => request({ method: "post", url: "/sources/demo", data: { sample } }),
  createPointListSource: (displayName, document) => request({ method: "post", url: "/sources/point-list", data: { displayName, document } }),

  createJob: (projectId, sourceId, parameters) => request({ method: "post", url: "/jobs", data: { projectId, sourceId, parameters } }),
  reprocess: (jobId, baseRevision, parameters) => request({ method: "post", url: `/jobs/${encodeURIComponent(jobId)}/revisions`, data: { baseRevision, parameters } }),
  getRevision: (jobId, revision, signal) => request({ url: rev(jobId, revision), signal }),
  acknowledge: (jobId, revision, codes, operator) => request({ method: "post", url: `${rev(jobId, revision)}/acknowledgements`, data: { codes, operator } }),
  review: (jobId, revision, stage, operator) => request({ method: "post", url: `${rev(jobId, revision)}/review`, data: { stage, operator } }),
  recordEvidence: (jobId, revision, body) => request({ method: "post", url: `${rev(jobId, revision)}/evidence`, data: body }),

  async fetchModule(jobId, revision, outputSha256) {
    const res = await request({ url: `${rev(jobId, revision)}/module?outputSha256=${encodeURIComponent(outputSha256)}`, responseType: "text", transformResponse: (d) => d, fullResponse: true });
    return { text: res.data, sha256: res.headers["x-vd-output-sha256"], fileName: res.headers["x-vd-file-name"] };
  },
  exportModule: (jobId, revision, body) => request({ method: "post", url: `${rev(jobId, revision)}/export`, data: body, timeout: 30000 }),

  async fetchEvidencePackage(jobId, revision, body) {
    const res = await request({ method: "post", url: `${rev(jobId, revision)}/evidence-package`, data: body, responseType: "arraybuffer", fullResponse: true, timeout: 30000 });
    return { bytes: res.data, sha256: res.headers["x-vd-package-sha256"], fileName: res.headers["x-vd-file-name"] };
  },

  robotStudioStatus: () => request({ url: "/robotstudio/status" }),
  calibrationRoutine: () => request({ url: "/calibration/routine" }),
  listCalibrations: () => request({ url: "/calibrations" }),
  getCalibration: (calibrationId) => request({ url: `/calibrations/${encodeURIComponent(calibrationId)}` }),
  importCalibration: (file, companion = null) => {
    const form = new FormData();
    form.append("calibration", file, file.name);
    if (companion) form.append("cfig", companion, companion.name);
    return request({ method: "post", url: "/calibrations", data: form });
  },
};
