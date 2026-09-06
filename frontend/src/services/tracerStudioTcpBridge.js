/**
 * TracerStudio Ingestion Service
 * Connects the frontend client to the Express backend REST API.
 *
 * The TCP bridge surface (config, ping, service control, trajectory request)
 * was removed with the Bridge Setup and Connect pages.
 */

import axiosClient from "./axiosClient";

const STORAGE_KEY_PROGRESS = "vd_tcp_workflow_progress";
const STORAGE_KEY_PAYLOAD = "vd_tcp_last_payload";

function delay(ms = 300) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Acquisition ---

export async function acquireFromFile(filePath) {
  try {
    const res = await axiosClient.post("/ingest-files");
    if (res.data && res.data.success) {
      const data = res.data.data;
      const points = data.rawCurvePoints.length > 0 ? data.rawCurvePoints : generateMockPathPoints(98);
      const payload = {
        source: "file",
        responseCode: "002",
        filePath: filePath || "C:\\TracerBridge\\Sessions\\scan.txt",
        weldType: "Lap Joint",
        pathCount: 1,
        totalPoints: points.length,
        plateThicknessMm: 4.5,
        weldGapMm: 1.2,
        pathPoints: points,
        timestamp: new Date().toISOString(),
      };

      try {
        localStorage.setItem(STORAGE_KEY_PAYLOAD, JSON.stringify(payload));
      } catch {
        // ignore
      }

      return { success: true, responseCode: "002", payload };
    }
  } catch (e) {
    console.warn("Backend file ingestion error, falling back to local simulation:", e.message);
  }

  await delay(600);
  const payload = {
    source: "file",
    responseCode: "002",
    filePath,
    weldType: "Lap Joint",
    pathCount: 2,
    totalPoints: 98,
    plateThicknessMm: 4.5,
    weldGapMm: 1.2,
    pathPoints: generateMockPathPoints(98),
    timestamp: new Date().toISOString(),
  };

  try {
    localStorage.setItem(STORAGE_KEY_PAYLOAD, JSON.stringify(payload));
  } catch {
    // ignore
  }

  return { success: true, responseCode: "002", payload };
}

// --- Payload Parsing & Mapping ---

export async function parsePayload(rawPayload) {
  await delay(300);
  return {
    success: true,
    decoded: {
      source: rawPayload?.source || "tcp",
      responseCode: rawPayload?.responseCode || "002",
      weldType: rawPayload?.weldType || "Fillet Weld",
      pathCount: rawPayload?.pathCount || 1,
      totalPoints: rawPayload?.totalPoints || 142,
      plateThicknessMm: rawPayload?.plateThicknessMm || 3.0,
      weldGapMm: rawPayload?.weldGapMm || 0.8,
      pathPoints: rawPayload?.pathPoints || generateMockPathPoints(142),
    },
  };
}

export async function mapToCanonicalWeldPath(decoded) {
  try {
    const res = await axiosClient.post("/process-pipeline", {
      curvePointsOverride: decoded.pathPoints && decoded.pathPoints.length > 0 ? decoded.pathPoints : null,
      torchAngle: 45,
    });

    if (res.data && res.data.success) {
      const pipeline = res.data.pipeline;
      const waypoints = pipeline.waypoints || [];
      const canonical = {
        id: generateUUID(),
        source: decoded.source,
        responseCode: decoded.responseCode,
        weldType: decoded.weldType,
        coordinateFrame: "Robot Base Workspace (Direct)",
        approachPoint: waypoints.find((w) => w.type === "approach") || waypoints[0],
        waypoints,
        retractPoint: waypoints.find((w) => w.type === "retract") || waypoints[waypoints.length - 1],
        rapidCode: pipeline.rapidCode,
        plateThicknessMm: decoded.plateThicknessMm,
        weldGapMm: decoded.weldGapMm,
        validationStatus: "valid",
        metadata: {
          model: "WeldPath v1.0 (Direct Feature Extraction — Path_10)",
          generatedAt: new Date().toISOString(),
        },
      };

      try {
        localStorage.setItem(STORAGE_KEY_PAYLOAD, JSON.stringify({ ...decoded, canonical }));
      } catch {
        // ignore
      }

      return { success: true, canonical };
    }
  } catch (e) {
    console.warn("Backend process-pipeline error in mapping, using local fallback:", e.message);
  }

  await delay(400);
  const canonical = {
    id: generateUUID(),
    source: decoded.source,
    responseCode: decoded.responseCode,
    weldType: decoded.weldType,
    coordinateFrame: "WorkObject",
    approachPoint: { x: 520.12, y: 10.5, z: 480.9 },
    pathPoints: decoded.pathPoints,
    retractPoint: { x: 560.81, y: 35.6, z: 440.7 },
    toolOrientations: [
      { rx: 0.98, ry: 0.1, rz: -0.05 },
      { rx: 0.96, ry: 0.15, rz: -0.1 },
      { rx: 0.94, ry: 0.2, rz: -0.15 },
    ],
    plateThicknessMm: decoded.plateThicknessMm,
    weldGapMm: decoded.weldGapMm,
    validationStatus: "valid",
    metadata: {
      model: "WeldPath v1.0",
      generatedAt: new Date().toISOString(),
    },
  };

  try {
    localStorage.setItem(STORAGE_KEY_PAYLOAD, JSON.stringify({ ...decoded, canonical }));
  } catch {
    // ignore
  }

  return { success: true, canonical };
}

// --- Workflow Progress ---

export function getWorkflowProgress() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_PROGRESS);
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore
  }
  return {
    acquisitionComplete: false,
    parseComplete: false,
    generateComplete: false,
    currentStep: 0,
  };
}

export function saveWorkflowProgress(progress) {
  try {
    localStorage.setItem(STORAGE_KEY_PROGRESS, JSON.stringify(progress));
  } catch {
    // ignore
  }
  return { success: true };
}

function generateMockPathPoints(count) {
  const points = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    points.push({
      x: 500 + t * 60 + Math.sin(t * Math.PI * 2) * 10,
      y: t * 40,
      z: 500 - t * 60 + Math.cos(t * Math.PI * 2) * 5,
      rx: 0.98 - t * 0.04,
      ry: 0.1 + t * 0.1,
      rz: -0.05 - t * 0.1,
    });
  }
  return points;
}

function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
