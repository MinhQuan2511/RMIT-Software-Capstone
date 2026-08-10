"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import StepperProgress from "@/components/StepperProgress";
import RAPIDCodeEditor from "@/components/RAPIDCodeEditor";
import { useToast } from "@/components/ToastContext";
import { useIntegrationMode } from "@/components/IntegrationModeContext";
import { useTestingWorkflow } from "@/components/TestingWorkflowContext";
import { useTcpWorkflow } from "@/components/TcpWorkflowContext";
import { csvToRapid } from "@/services/csvToRapid";
import axiosClient from "@/services/axiosClient";

// ----------------------------------------------------------------------
// 3D Execution Viewport Canvas (Synchronized Realtime Kinematics)
// ----------------------------------------------------------------------
function ExecutionViewportCanvas({ points, isPlaying, progressRatio }) {
  const mountRef = useRef(null);
  const torchRef = useRef(null);
  const waypointsRef = useRef({ approach: null, weldStart: null, weldEnd: null, retract: null });

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 400;

    // 1. Initialize Three.js Scene and Perspective Camera
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#060913");

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
    camera.position.set(130, 95, 150);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // 2. Initialize Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // 3. Scene Lighting & Floor Reference Grid
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0x38bdf8, 2.0);
    dirLight.position.set(150, 300, 150);
    scene.add(dirLight);

    const gridHelper = new THREE.GridHelper(400, 20, 0x1e293b, 0x0f172a);
    gridHelper.position.y = -35;
    scene.add(gridHelper);

    // 4. Parse Waypoint Coordinates & Center Projection Scale
    const rawPoints = points && points.length >= 4 ? points : [
      { name: "p_approach", x: 699.9, y: 1349.6, z: 1283.1 },
      { name: "Target_10", x: 673.9, y: 1349.3, z: 1173.0 },
      { name: "Target_20", x: 552.5, y: 1348.2, z: 1372.8 },
      { name: "p_retract", x: 526.5, y: 1347.9, z: 1402.8 }
    ];

    let avgX = 0, avgY = 0, avgZ = 0;
    rawPoints.forEach(p => { avgX += p.x; avgY += p.y; avgZ += p.z; });
    avgX /= rawPoints.length; avgY /= rawPoints.length; avgZ /= rawPoints.length;

    // Scale Factor: 0.35
    const toVec = (p) => new THREE.Vector3((p.x - avgX) * 0.35, (p.z - avgZ) * 0.35, (p.y - avgY) * 0.35);

    const vecApproach = toVec(rawPoints[0]);
    const vecWeldStart = toVec(rawPoints[1]);
    const vecWeldEnd = toVec(rawPoints[rawPoints.length - 2]);
    const vecRetract = toVec(rawPoints[rawPoints.length - 1]);

    waypointsRef.current = { approach: vecApproach, weldStart: vecWeldStart, weldEnd: vecWeldEnd, retract: vecRetract };

    const centerWeld = new THREE.Vector3().addVectors(vecWeldStart, vecWeldEnd).multiplyScalar(0.5);
    controls.target.copy(centerWeld);

    // A. Air Motion Paths (Dashed Lines)
    const createDashedLine = (p1, p2) => {
      const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const mat = new THREE.LineDashedMaterial({ color: 0x475569, dashSize: 3, gapSize: 2, linewidth: 1.5 });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      return line;
    };
    scene.add(createDashedLine(vecApproach, vecWeldStart));
    scene.add(createDashedLine(vecWeldEnd, vecRetract));

    // B. Weld Seam Trajectory (Cyan Solid Line)
    const weldGeo = new THREE.BufferGeometry().setFromPoints([vecWeldStart, vecWeldEnd]);
    const weldMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 5 });
    const weldLine = new THREE.Line(weldGeo, weldMat);
    scene.add(weldLine);

    // C. Waypoint Robtarget Markers
    const addMarker = (pos, color, emissive, size = 1.2) => {
      const geo = new THREE.SphereGeometry(size, 16, 16);
      const mat = new THREE.MeshStandardMaterial({ color, emissive, metalness: 0.8 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      scene.add(mesh);
    };
    addMarker(vecApproach, 0x64748b, 0x334155, 0.8);
    addMarker(vecWeldStart, 0x10b981, 0x059669, 1.2);
    addMarker(vecWeldEnd, 0xef4444, 0xb91c1c, 1.2);
    addMarker(vecRetract, 0x64748b, 0x334155, 0.8);

    // 5. Proportional Industrial Torch Geometry
    const torchGroup = new THREE.Group();

    // Brass Tip Nozzle (Pointing Downward)
    const nozzleGeo = new THREE.ConeGeometry(1.6, 9, 16);
    const nozzleMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.95, roughness: 0.1 });
    const nozzleMesh = new THREE.Mesh(nozzleGeo, nozzleMat);
    nozzleMesh.rotation.x = Math.PI;
    nozzleMesh.position.y = 4.5;
    torchGroup.add(nozzleMesh);

    // Industrial Orange Main Body
    const bodyGeo = new THREE.CylinderGeometry(2.8, 3.5, 20, 16);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf97316, metalness: 0.7, roughness: 0.2 });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = 19;
    torchGroup.add(bodyMesh);

    // Status Ring
    const ringGeo = new THREE.TorusGeometry(3.6, 0.6, 16, 32);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7 });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.y = 26;
    torchGroup.add(ringMesh);

    scene.add(torchGroup);
    torchRef.current = torchGroup;

    // Animation Loop
    let animationFrameId;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameId);
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [points]);

  // Interpolate Torch Position along Trajectory Segments
  useEffect(() => {
    if (torchRef.current && waypointsRef.current.approach) {
      const { approach, weldStart, weldEnd, retract } = waypointsRef.current;
      const p = Math.min(Math.max(progressRatio, 0), 1);

      let targetPos = new THREE.Vector3();

      if (p < 0.25) {
        targetPos.lerpVectors(approach, weldStart, p / 0.25);
      } else if (p <= 0.75) {
        targetPos.lerpVectors(weldStart, weldEnd, (p - 0.25) / 0.50);
      } else {
        targetPos.lerpVectors(weldEnd, retract, (p - 0.75) / 0.25);
      }

      torchRef.current.position.copy(targetPos);
    }
  }, [progressRatio]);

  return <div ref={mountRef} className="w-full h-full min-h-[420px] relative overflow-hidden rounded-xl" />;
}

// ----------------------------------------------------------------------
// Main Export Page Component
// ----------------------------------------------------------------------
export default function ExportPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { mode } = useIntegrationMode();
  const { csvData } = useTestingWorkflow();
  const { canonicalWeldPath, rawPayload } = useTcpWorkflow();

  const [syncing, setSyncing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const maxTime = 12;
  const [showModal, setShowModal] = useState(false);
  const [backendRapidCode, setBackendRapidCode] = useState(null);

  // Simulation Progress Timer
  useEffect(() => {
    let interval = null;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= maxTime) {
            setIsPlaying(false);
            return 0;
          }
          return prev + 0.1;
        });
      }, 100);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Fetch Compiled RAPID Code Module from Express Backend
  useEffect(() => {
    let isMounted = true;
    async function fetchRapidCode() {
      try {
        const res = await axiosClient.get("/rapid-code");
        if (isMounted && res.data && res.data.rapidCode) {
          setBackendRapidCode(res.data.rapidCode);
        }
      } catch (e) {
        console.warn("Express backend API /rapid-code fallback:", e.message);
      }
    }
    fetchRapidCode();
    return () => { isMounted = false; };
  }, []);

  const activePoints = useMemo(() => {
    if (canonicalWeldPath?.pathPoints && canonicalWeldPath.pathPoints.length > 0) {
      return canonicalWeldPath.pathPoints;
    }
    if (rawPayload?.pathPoints && rawPayload.pathPoints.length > 0) {
      return rawPayload.pathPoints;
    }
    return [
      { name: "p_approach", x: 699.9, y: 1349.6, z: 1283.1 },
      { name: "Target_10", x: 673.9, y: 1349.3, z: 1173.0 },
      { name: "Target_20", x: 552.5, y: 1348.2, z: 1372.8 },
      { name: "p_retract", x: 526.5, y: 1347.9, z: 1402.8 }
    ];
  }, [canonicalWeldPath, rawPayload]);

  const testingRapidCode = useMemo(() => {
    if (mode === "testing" && csvData && csvData.length > 0) {
      return csvToRapid(csvData);
    }
    return null;
  }, [mode, csvData]);

  // Synchronize compiled RAPID output with Generate step
  const activeCode = useMemo(() => {
    if (mode === "testing" && testingRapidCode) return testingRapidCode;
    return canonicalWeldPath?.rapidCode || backendRapidCode || "! Fetching compiled RAPID code...";
  }, [mode, testingRapidCode, canonicalWeldPath, backendRapidCode]);

  const fileName = mode === "testing" ? "Module1.mod" : "WeldModule.mod";

  // Handle Local Export & Native Next.js API Launcher Endpoint Call
  const handleCopyAndDownload = async () => {
    setSyncing(true);
    showToast(
      "📋 Auto-Saving & Copied...",
      `Saving ${fileName} and copying RAPID code to system clipboard...`,
      "info"
    );

    try {
      // 1. Copy RAPID code directly to system Clipboard
      await navigator.clipboard.writeText(activeCode);

      // 2. Trigger native browser file download (.mod)
      const blob = new Blob([activeCode], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // 3. Invoke Next.js server route (Port 3000) to spawn desktop executable
      const res = await fetch("/api/launch-robotstudio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: activeCode, fileName }),
      });
      const data = await res.json();

      if (data && data.success && data.launched) {
        showToast(
          "🚀 RobotStudio Synced!",
          `RobotStudio Desktop app launched with ${fileName}.`,
          "success"
        );
      } else {
        // App not detected on PC -> Show download dialog modal
        setShowModal(true);
      }
    } catch (e) {
      console.error(e);
      setShowModal(true);
    } finally {
      setSyncing(false);
    }
  };

  const handleResetSession = () => {
    showToast(
      "🔄 Session Reset Completed",
      "Cleared local trajectories and returned variables back to system defaults."
    );
    router.push("/acquire");
  };

  const progressRatio = currentTime / maxTime;
  const formattedSec = Math.floor(currentTime) < 10 ? `0${Math.floor(currentTime)}` : Math.floor(currentTime);

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative">
      {/* Left Sidebar Panel (45% - Consistent bg-surface-container-low theme) */}
      <aside className="bg-surface-container-low border-r border-outline-variant shadow-sm flex flex-col w-[45%] h-full pt-6 px-5 gap-4 shrink-0 z-20 overflow-y-auto">
        <div className="px-1 select-none">
          <h2 className="text-xl font-extrabold text-on-surface tracking-tight">
            Export & Controller Sync
          </h2>
          <p className="text-xs text-on-surface-variant font-medium mt-1 leading-relaxed">
            Transfer compiled ABB RAPID module ({fileName}) directly to virtual RobotStudio controller or physical IRC5/OmniCore unit.
          </p>
        </div>

        {/* Dynamic Stepper Navigation */}
        <StepperProgress />

        <div className="h-px w-full bg-outline-variant/60 my-0.5 opacity-50"></div>

        {/* Deployment Instruction Checklist */}
        <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-sm flex flex-col gap-3 select-none">
          <h3 className="font-bold text-xs text-on-surface flex items-center gap-2 uppercase tracking-wide">
            <span className="material-symbols-outlined text-primary text-[18px]">sync_alt</span>
            Desktop Deployment Checklist
          </h3>
          
          <div className="grid grid-cols-1 gap-2 text-xs">
            <div className="flex items-center gap-2.5 p-2 rounded-lg bg-surface-container-lowest border border-outline-variant/40">
              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary font-bold text-[11px] flex items-center justify-center shrink-0">1</span>
              <span className="text-on-surface font-medium text-[11px]">Download <strong>{fileName}</strong> & copy code to clipboard</span>
            </div>
            <div className="flex items-center gap-2.5 p-2 rounded-lg bg-surface-container-lowest border border-outline-variant/40">
              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary font-bold text-[11px] flex items-center justify-center shrink-0">2</span>
              <span className="text-on-surface font-medium text-[11px]">Open <strong>ABB RobotStudio 2025</strong> Program Editor</span>
            </div>
            <div className="flex items-center gap-2.5 p-2 rounded-lg bg-surface-container-lowest border border-outline-variant/40">
              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary font-bold text-[11px] flex items-center justify-center shrink-0">3</span>
              <span className="text-on-surface font-medium text-[11px]">Paste module & Press <strong>Apply / Execute PROC main()</strong></span>
            </div>
          </div>

          <div className="flex gap-2 pt-1 select-none">
            <button 
              onClick={handleCopyAndDownload}
              disabled={syncing}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider py-3 px-3 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              {syncing ? "Exporting File..." : `Download ${fileName}`}
            </button>
            <button 
              onClick={handleResetSession}
              className="bg-surface hover:bg-surface-container-high border border-outline-variant text-on-surface-variant font-bold text-xs uppercase tracking-wider py-3 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              title="Reset session and return to start"
            >
              <span className="material-symbols-outlined text-[18px]">refresh</span>
              Reset
            </button>
          </div>
        </div>

        {/* RAPID Code Editor Panel */}
        <div className="flex-1 flex flex-col min-h-0 pb-4">
          <RAPIDCodeEditor 
            code={activeCode} 
            title={`DYNAMIC ABB RAPID MODULE (${fileName.toUpperCase()})`} 
            status="COMPILED & READY FOR CONTROLLER" 
            onCopySuccess={handleCopyAndDownload}
          />
        </div>
      </aside>

      {/* Right Section: Viewport 3D Simulation Engine (55%) */}
      <div className="flex-1 h-full relative bg-slate-950 flex flex-col overflow-hidden">
        {/* Top Overlay Status Bar */}
        <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
          <div className="flex items-center gap-2 bg-slate-900/90 backdrop-blur-md border border-slate-800 px-3.5 py-2 rounded-xl shadow-lg pointer-events-auto">
            <span className={`w-2.5 h-2.5 rounded-full ${isPlaying ? "bg-emerald-400 animate-ping" : "bg-emerald-500"}`}></span>
            <span className="text-xs font-semibold text-slate-200">
              RobotStudio API: Synced & Ready
            </span>
          </div>

          <div className="flex items-center gap-3 bg-slate-900/90 backdrop-blur-md border border-slate-800 px-4 py-2 rounded-xl shadow-lg pointer-events-auto text-xs">
            <div className="flex items-center gap-1.5 text-slate-300">
              <span className="text-slate-400 font-mono text-[11px]">CONTROLLER:</span>
              <span className="font-mono font-bold text-blue-400">IRC5 / OmniCore</span>
            </div>
            <div className="h-3 w-px bg-slate-700"></div>
            <div className="flex items-center gap-1.5 text-slate-300">
              <span className="text-slate-400 font-mono text-[11px]">TARGETS:</span>
              <span className="font-mono font-bold text-amber-400">{activePoints.length}</span>
            </div>
            <div className="h-3 w-px bg-slate-700"></div>
            <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold px-2 py-0.5 rounded">
              PASSED VERIFICATION
            </span>
          </div>
        </div>

        {/* Realtime 3D Simulation Canvas */}
        <div className="w-full h-full relative flex-1">
          <ExecutionViewportCanvas points={activePoints} isPlaying={isPlaying} progressRatio={progressRatio} />

          {/* Floating Bottom Control Bar */}
          <div className="absolute bottom-6 left-4 right-4 z-10 flex justify-center pointer-events-none">
            <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-full px-6 py-2.5 flex items-center gap-5 shadow-2xl pointer-events-auto select-none">
              <button 
                onClick={() => setIsPlaying(!isPlaying)}
                className="text-slate-200 hover:text-blue-400 transition-colors flex items-center justify-center p-2 rounded-full hover:bg-slate-800 cursor-pointer"
                title={isPlaying ? "Pause Execution" : "Test Execution"}
              >
                <span className="material-symbols-outlined text-[26px]">
                  {isPlaying ? "pause" : "play_arrow"}
                </span>
              </button>

              <div className="w-56 h-1.5 bg-slate-800 rounded-full overflow-hidden relative cursor-pointer">
                <div 
                  className="h-full bg-blue-500 rounded-full transition-all duration-100"
                  style={{ width: `${progressRatio * 100}%` }}
                ></div>
              </div>

              <span className="font-mono text-xs text-slate-300 font-semibold min-w-[85px] text-right">
                00:{formattedSec} / 00:12
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* RobotStudio Software Download Dialog Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-2xl max-w-md w-full p-6 flex flex-col gap-5">
            <div className="flex items-center gap-3 select-none">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 text-primary flex items-center justify-center border border-primary/20">
                <span className="material-symbols-outlined text-2xl font-bold">rocket_launch</span>
              </div>
              <div>
                <h4 className="font-extrabold text-base text-on-surface leading-none">RAPID Module Saved!</h4>
                <p className="text-[10px] text-on-surface-variant font-extrabold uppercase tracking-widest mt-1.5">ABB RobotStudio Controller Bridge</p>
              </div>
            </div>

            <div className="text-xs text-on-surface-variant leading-relaxed flex flex-col gap-3 font-medium">
              <p>
                Successfully copied the RAPID code to your system clipboard and saved <strong>{fileName}</strong> to your Downloads folder.
              </p>
              <div className="bg-surface-container-low border border-outline-variant/60 p-3 rounded-lg text-on-surface text-[11px] leading-relaxed">
                <strong>Notice:</strong> To run simulation on a physical controller, please open ABB RobotStudio and load the exported <code>{fileName}</code>.
              </div>
            </div>

            <div className="flex gap-3 pt-2 select-none">
              <a 
                href="https://new.abb.com/products/robotics/robotstudio/downloads" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider py-3 rounded-lg text-center transition-colors shadow-sm"
              >
                Download RobotStudio
              </a>
              <button 
                onClick={() => setShowModal(false)}
                className="flex-1 bg-surface hover:bg-surface-container-high border border-outline-variant text-on-surface-variant hover:text-on-surface font-bold text-xs uppercase tracking-wider py-3 rounded-lg transition-colors cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}