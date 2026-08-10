"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
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
// 3D Realtime Simulation Canvas (Solid 3D Mesh Seam Engine)
// ----------------------------------------------------------------------
function RobotSimulationCanvas({ points, isPlaying, progressRatio }) {
  const mountRef = useRef(null);
  const torchRef = useRef(null);
  const arcLightRef = useRef(null);
  const arcGlowMeshRef = useRef(null);
  const weldedMeshRef = useRef(null);
  const waypointsRef = useRef({ approach: null, weldStart: null, weldEnd: null, retract: null });

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 400;

    // 1. Scene & Camera Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#060913");

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
    camera.position.set(130, 95, 150);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // 2. Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // 3. Lighting & Floor Grid
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0x38bdf8, 2.0);
    dirLight.position.set(150, 300, 150);
    scene.add(dirLight);

    const gridHelper = new THREE.GridHelper(400, 20, 0x1e293b, 0x0f172a);
    gridHelper.position.y = -35;
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(25);
    axesHelper.position.set(-140, -34, -140);
    scene.add(axesHelper);

    // 4. Parse Coordinates & Scaling
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

    // A. Air Motion Lines (Dashed Lines - Grey)
    const createDashedLine = (p1, p2) => {
      const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const mat = new THREE.LineDashedMaterial({ color: 0x475569, dashSize: 3, gapSize: 2, linewidth: 1.5 });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      return line;
    };
    scene.add(createDashedLine(vecApproach, vecWeldStart));
    scene.add(createDashedLine(vecWeldEnd, vecRetract));

    // B. Base Unwelded Seam Cylinder
    const weldVec = new THREE.Vector3().subVectors(vecWeldEnd, vecWeldStart);
    const totalWeldLen = weldVec.length();
    const weldDir = weldVec.clone().normalize();

    const unweldedGeo = new THREE.CylinderGeometry(1.0, 1.0, totalWeldLen, 16);
    const unweldedMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: 0x0369a1,
      metalness: 0.8,
      roughness: 0.2
    });
    const unweldedMesh = new THREE.Mesh(unweldedGeo, unweldedMat);
    unweldedMesh.position.copy(centerWeld);
    unweldedMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), weldDir);
    scene.add(unweldedMesh);

    // C. Dynamic Welded Seam Cylinder 
    const weldedGeo = new THREE.CylinderGeometry(1.25, 1.25, 1, 16);
    const weldedMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xe2e8f0,
      metalness: 0.9,
      roughness: 0.1
    });
    const weldedMesh = new THREE.Mesh(weldedGeo, weldedMat);
    weldedMesh.visible = false;
    scene.add(weldedMesh);
    weldedMeshRef.current = weldedMesh;

    // D. Small Robtarget Markers 
    const addMarker = (pos, color, emissive, size = 1.2) => {
      const geo = new THREE.SphereGeometry(size, 16, 16);
      const mat = new THREE.MeshStandardMaterial({ color, emissive, metalness: 0.8 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      scene.add(mesh);
    };
    addMarker(vecApproach, 0x64748b, 0x334155, 0.8);
    addMarker(vecWeldStart, 0x10b981, 0x059669, 1.2); // Start (Green - Thu nhỏ)
    addMarker(vecWeldEnd, 0xef4444, 0xb91c1c, 1.2);   // End (Red - Thu nhỏ)
    addMarker(vecRetract, 0x64748b, 0x334155, 0.8);

    // 5. INDUSTRIAL ORANGE TORCH WITH SHARP TIP 
    const torchGroup = new THREE.Group();

    // Sharp Brass Tip at (0,0,0)
    const nozzleGeo = new THREE.ConeGeometry(1.6, 9, 16);
    const nozzleMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.95, roughness: 0.1 });
    const nozzleMesh = new THREE.Mesh(nozzleGeo, nozzleMat);
    nozzleMesh.rotation.x = Math.PI; // Chĩa đầu nhọn xuống
    nozzleMesh.position.y = 4.5;
    torchGroup.add(nozzleMesh);

    // Main Torch Body 
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

    // White Arc Glow Core Sphere at Tip (0,0,0)
    const arcGlowGeo = new THREE.SphereGeometry(2, 16, 16);
    const arcGlowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    const arcGlowMesh = new THREE.Mesh(arcGlowGeo, arcGlowMat);
    arcGlowMesh.position.set(0, 0, 0);
    torchGroup.add(arcGlowMesh);
    arcGlowMeshRef.current = arcGlowMesh;

    // Arc Spotlight
    const arcLight = new THREE.PointLight(0x38bdf8, 0, 100);
    arcLight.position.set(0, 0, 0);
    torchGroup.add(arcLight);
    arcLightRef.current = arcLight;

    scene.add(torchGroup);
    torchRef.current = torchGroup;

    // Animation Loop
    let animationFrameId;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();

      // Welding Phase Glow (0.25 -> 0.75)
      const isWeldingActive = isPlaying && progressRatio >= 0.22 && progressRatio <= 0.78;

      if (arcGlowMeshRef.current && arcLightRef.current) {
        if (isWeldingActive) {
          arcLightRef.current.intensity = 15 + Math.random() * 20;
          arcLightRef.current.color.setHex(Math.random() > 0.3 ? 0x38bdf8 : 0xfef08a);
          arcGlowMeshRef.current.material.opacity = 0.85 + Math.random() * 0.15;
        } else {
          arcLightRef.current.intensity = 0;
          arcGlowMeshRef.current.material.opacity = 0;
        }
      }

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

  // Torch Motion & Seamless "Color Transition to White" Logic
  useEffect(() => {
    if (torchRef.current && waypointsRef.current.approach) {
      const { approach, weldStart, weldEnd, retract } = waypointsRef.current;
      const p = Math.min(Math.max(progressRatio, 0), 1);

      let targetPos = new THREE.Vector3();
      let currentWeldTip = weldStart.clone();

      if (p < 0.25) {
        // Phase 1: Approach -> WeldStart
        targetPos.lerpVectors(approach, weldStart, p / 0.25);
        currentWeldTip.copy(weldStart);
      } else if (p <= 0.75) {
        // Phase 2: WELDING ALONG STRAIGHT SEAM
        const weldProgress = (p - 0.25) / 0.50;
        targetPos.lerpVectors(weldStart, weldEnd, weldProgress);
        currentWeldTip.copy(targetPos);
      } else {
        // Phase 3: WeldEnd -> Retract
        targetPos.lerpVectors(weldEnd, retract, (p - 0.75) / 0.25);
        currentWeldTip.copy(weldEnd);
      }

      torchRef.current.position.copy(targetPos);

      //(3D Cylinder Extension)
      if (weldedMeshRef.current) {
        const currentLen = weldStart.distanceTo(currentWeldTip);
        if (currentLen > 0.1 && p >= 0.22) {
          weldedMeshRef.current.visible = true;
          weldedMeshRef.current.scale.set(1, currentLen, 1);
          
          const midPos = new THREE.Vector3().addVectors(weldStart, currentWeldTip).multiplyScalar(0.5);
          weldedMeshRef.current.position.copy(midPos);
          
          const dir = new THREE.Vector3().subVectors(currentWeldTip, weldStart).normalize();
          weldedMeshRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        } else {
          weldedMeshRef.current.visible = false;
        }
      }
    }
  }, [progressRatio]);

  return <div ref={mountRef} className="w-full h-full min-h-[420px] relative overflow-hidden rounded-xl" />;
}

// ----------------------------------------------------------------------
// Main Page Component
// ----------------------------------------------------------------------
export default function GeneratePage() {
  const { showToast } = useToast();
  const { mode } = useIntegrationMode();
  const { csvData } = useTestingWorkflow();
  const { canonicalWeldPath, rawPayload } = useTcpWorkflow();

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const maxTime = 12;
  const [backendRapidCode, setBackendRapidCode] = useState(null);

  // Simulation Timer
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

  // Fetch RAPID Code from Express Backend
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

  const displayCode = mode === "testing" && testingRapidCode
    ? testingRapidCode
    : canonicalWeldPath?.rapidCode || backendRapidCode || "! Fetching backend RAPID code...";

  const handleTogglePlay = () => {
    const nextState = !isPlaying;
    setIsPlaying(nextState);
    if (nextState) {
      showToast("▶ Realtime 3D Simulation Started", "Executing RAPID motion on 3D Welding Kinematics engine...", "info");
    }
  };

  const progressRatio = currentTime / maxTime;
  const formattedSec = Math.floor(currentTime) < 10 ? `0${Math.floor(currentTime)}` : Math.floor(currentTime);

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative">
      {/* Left Sidebar Panel (45%) */}
      <aside className="bg-surface-container-low border-r border-outline-variant shadow-sm flex flex-col w-[45%] h-full pt-6 px-5 gap-4 shrink-0 z-20 overflow-y-auto">
        <div className="px-1 select-none">
          <h2 className="text-xl font-extrabold text-on-surface tracking-tight">
            RAPID Code Compiler
          </h2>
          <p className="text-xs text-on-surface-variant font-medium mt-1 leading-relaxed">
            Compile validated canonical weld path into industrial-standard ABB RAPID module.
          </p>
        </div>

        <StepperProgress />

        <div className="h-px w-full bg-outline-variant/60 my-0.5 opacity-50"></div>

        <div className="flex-1 flex flex-col gap-4 min-h-0">
          <RAPIDCodeEditor 
            code={displayCode} 
            title="ABB RAPID MODULE (EXPRESS BACKEND)" 
            status={`COMPILED OK — ${activePoints.length} TARGETS`} 
          />
          
          <div className="flex gap-3 select-none pb-4">
            <Link
              href="/parse-map"
              className="flex-1 bg-surface border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              Back to Parse & Map
            </Link>
            
            <Link
              href="/export"
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all select-none cursor-pointer"
            >
              Next Step
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </Link>
          </div>
        </div>
      </aside>

      {/* Right Viewport (55% Realtime 3D Kinematics) */}
      <div className="flex-1 h-full relative bg-slate-950 flex flex-col overflow-hidden">
        {/* Top Overlay Status Bar */}
        <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
          <div className="flex items-center gap-2 bg-slate-900/90 backdrop-blur-md border border-slate-800 px-3.5 py-2 rounded-xl shadow-lg pointer-events-auto">
            <span className={`w-2.5 h-2.5 rounded-full ${isPlaying ? "bg-emerald-400 animate-ping" : "bg-blue-400"}`}></span>
            <span className="text-xs font-semibold text-slate-200">
              {isPlaying ? "3D Kinematics Running..." : "3D Simulation Ready"}
            </span>
          </div>

          <div className="flex items-center gap-3 bg-slate-900/90 backdrop-blur-md border border-slate-800 px-4 py-2 rounded-xl shadow-lg pointer-events-auto text-xs">
            <div className="flex items-center gap-1.5 text-slate-300">
              <span className="text-slate-400 font-mono text-[11px]">CYCLE:</span>
              <span className="font-mono font-bold text-blue-400">12.0s</span>
            </div>
            <div className="h-3 w-px bg-slate-700"></div>
            <div className="flex items-center gap-1.5 text-slate-300">
              <span className="text-slate-400 font-mono text-[11px]">TOOL:</span>
              <span className="font-mono font-bold text-amber-400">tWeldGun</span>
            </div>
            <div className="h-3 w-px bg-slate-700"></div>
            <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold px-2 py-0.5 rounded">
              REACHABILITY: 100%
            </span>
          </div>
        </div>

        {/* Realtime 3D Simulation Canvas */}
        <div className="w-full h-full relative flex-1">
          <RobotSimulationCanvas points={activePoints} isPlaying={isPlaying} progressRatio={progressRatio} />

          {/* Floating Bottom Control Bar */}
          <div className="absolute bottom-6 left-4 right-4 z-10 flex justify-center pointer-events-none">
            <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-full px-6 py-2.5 flex items-center gap-5 shadow-2xl pointer-events-auto select-none">
              <button 
                onClick={handleTogglePlay}
                className="text-slate-200 hover:text-blue-400 transition-colors flex items-center justify-center p-2 rounded-full hover:bg-slate-800 cursor-pointer"
                title={isPlaying ? "Pause Simulation" : "Play Simulation"}
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
    </div>
  );
}