"use client";

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildWeldScene } from "./weldScene";
import { buildTimeline, sampleTimeline } from "@/lib/playback";

let webglSupport = null;
function detectWebGL() {
  if (webglSupport !== null) return webglSupport;
  try {
    const canvas = document.createElement("canvas");
    webglSupport = !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}
const noopSubscribe = () => () => {};

/**
 * Browser preview of a canonical revision. The torch follows the playback
 * clock through exact backend targets with the robtarget orientations. This
 * is an illustrative animation, not a kinematic or controller simulation.
 *
 * `fallback` is rendered instead when WebGL is unavailable or the context is
 * lost, so the same data stays visible as a table.
 */
export default function WeldSimulation3D({ record, clock, showToolAxes = false, fallback = null }) {
  const mountRef = useRef(null);
  const recordRef = useRef(record);
  const axesRef = useRef(showToolAxes);
  const [runtimeError, setRuntimeError] = useState(null);
  const supported = useSyncExternalStore(noopSubscribe, detectWebGL, () => null);

  const recordKey = record ? `${record.jobId || "fixture"}#${record.revision || 0}#${record.output ? record.output.sha256 : ""}` : null;

  useEffect(() => { recordRef.current = record; });
  useEffect(() => { axesRef.current = showToolAxes; }, [showToolAxes]);

  useEffect(() => {
    const container = mountRef.current;
    const rec = recordRef.current;
    if (!container || !rec || !clock || supported !== true) return undefined;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      queueMicrotask(() => setRuntimeError("The 3D renderer could not start in this browser. The target table shows the same data."));
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);

    const built = buildWeldScene({ record: rec });
    const timeline = buildTimeline(rec.path, rec.geometry.arc, clock.snapshot().durationS);
    const controls = new OrbitControls(built.camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.copy(built.target);
    controls.update();

    const resize = () => {
      const w = Math.max(container.clientWidth, 1);
      const h = Math.max(container.clientHeight, 1);
      renderer.setSize(w, h);
      built.camera.aspect = w / h;
      built.camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const onContextLost = (event) => {
      event.preventDefault();
      queueMicrotask(() => setRuntimeError("The WebGL context was lost. Reload the page to restore the 3D preview; the target table shows the same data."));
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);

    // Pause when the tab is hidden so the preview does not jump on return.
    const onVisibility = () => { if (document.hidden) clock.pause(); };
    document.addEventListener("visibilitychange", onVisibility);

    let raf = 0;
    let last = performance.now();
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = (now - last) / 1000;
      last = now;
      const snap = clock.snapshot();
      built.setToolAxesVisible(axesRef.current);
      built.update(sampleTimeline(timeline, snap.time), { playing: snap.playing, dt });
      controls.update();
      renderer.render(built.scene, built.camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      controls.dispose();
      built.dispose();
      renderer.dispose();
      // Release the context promptly (React development remounts effects);
      // this follows full disposal and does not replace it.
      renderer.forceContextLoss();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, [recordKey, clock, supported]);

  if (!record) {
    return <div className="w-full h-full min-h-[360px] flex items-center justify-center text-xs text-slate-400 bg-slate-950 rounded-xl">No revision selected.</div>;
  }
  if (supported === false || runtimeError) {
    return (
      <div className="w-full h-full min-h-[360px] bg-slate-50 rounded-xl p-4 overflow-auto" role="region" aria-label="3D preview unavailable">
        <p className="text-xs font-bold text-amber-900 bg-amber-100 border border-amber-300 rounded px-2 py-1 mb-3">
          {runtimeError || "WebGL is not available in this browser. The table below shows the same targets."}
        </p>
        {fallback}
      </div>
    );
  }
  return <div ref={mountRef} className="w-full h-full min-h-[360px] relative overflow-hidden rounded-xl bg-[#060913]" aria-label="3D toolpath preview (illustrative animation)" role="img" />;
}
