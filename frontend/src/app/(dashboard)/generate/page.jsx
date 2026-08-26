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
// 3D Realtime Simulation Canvas (Industrial Welding Engine)
// ----------------------------------------------------------------------
function RobotSimulationCanvas({ points, isPlaying, progressRatio }) {
  const mountRef = useRef(null);
  const torchRef = useRef(null);
  const arcLightRef = useRef(null);
  const arcGlowMeshRef = useRef(null);
  const weldedMeshRef = useRef(null);
  const waypointsRef = useRef({ home: null, approach: null, weldStart: null, weldEnd: null, retract: null });
  const weldDirRef = useRef(new THREE.Vector3(1, 0, 0));

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 400;

    // 1. Scene & Camera Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#060913");

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 4000);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // 2. Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // 3. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xf0f4ff, 2.5);
    dirLight.position.set(200, 400, 200);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.6);
    fillLight.position.set(-100, 50, -100);
    scene.add(fillLight);

    const gridHelper = new THREE.GridHelper(400, 20, 0x1e293b, 0x0f172a);
    gridHelper.position.y = -50;
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(30);
    axesHelper.position.set(-160, -49, -160);
    scene.add(axesHelper);

    // 4. Parse Coordinates & Scaling
    const findByType = (type) => points.find((p) => p.type === type);
    const homeRaw = findByType("home");
    const approachRaw = findByType("approach");
    const weldStartRaw = findByType("weld_start");
    const weldEndRaw = findByType("weld_end");
    const retractRaw = findByType("retract");

    const px = (p) => (p?.pos ? p.pos[0] : p?.x ?? 0);
    const py = (p) => (p?.pos ? p.pos[1] : p?.y ?? 0);
    const pz = (p) => (p?.pos ? p.pos[2] : p?.z ?? 0);

    const allRaw = [homeRaw, approachRaw, weldStartRaw, weldEndRaw, retractRaw].filter(Boolean);
    const rawPoints = allRaw.length >= 4 ? allRaw : [
      { x: 226.61, y: 1023.25, z: 722.07 },
      { x: 427.75, y: 1074.86, z: 350.34 },
      { x: 414.69, y: 1112.75, z: 320.34 },
      { x: 338.53, y: 1333.74, z: 322.07 },
      { x: 338.53, y: 1333.74, z: 362.07 },
    ];

    // Center on weld seam only (exclude home for better framing)
    const seamPts = rawPoints.filter((_, idx) => idx > 0 || allRaw.length < 4);
    let avgX = 0, avgY = 0, avgZ = 0;
    seamPts.forEach((p) => { avgX += px(p); avgY += py(p); avgZ += pz(p); });
    avgX /= seamPts.length; avgY /= seamPts.length; avgZ /= seamPts.length;

    const SCALE = 0.3;
    const toVec = (p) => new THREE.Vector3(
      (px(p) - avgX) * SCALE,
      (pz(p) - avgZ) * SCALE,
      (py(p) - avgY) * SCALE
    );

    const vecHome = homeRaw ? toVec(homeRaw) : toVec(rawPoints[0]);
    const vecApproach = approachRaw ? toVec(approachRaw) : toVec(rawPoints[1]);
    const vecWeldStart = weldStartRaw ? toVec(weldStartRaw) : toVec(rawPoints[2]);
    const vecWeldEnd = weldEndRaw ? toVec(weldEndRaw) : toVec(rawPoints[3]);
    const vecRetract = retractRaw ? toVec(retractRaw) : toVec(rawPoints[4]);

    waypointsRef.current = {
      home: vecHome,
      approach: vecApproach,
      weldStart: vecWeldStart,
      weldEnd: vecWeldEnd,
      retract: vecRetract,
    };

    const centerWeld = new THREE.Vector3().addVectors(vecWeldStart, vecWeldEnd).multiplyScalar(0.5);
    const weldVec = new THREE.Vector3().subVectors(vecWeldEnd, vecWeldStart);
    const totalWeldLen = weldVec.length();
    const weldDir = weldVec.clone().normalize();
    weldDirRef.current = weldDir.clone();

    // ── Auto-fit camera to seam bounding sphere ──
    const seamCenter = centerWeld.clone();
    const seamRadius = Math.max(totalWeldLen * 0.8, 30);
    const fov = camera.fov * (Math.PI / 180);
    const camDist = seamRadius / Math.sin(fov / 2);

    // Position camera at 45° elevation, 30° azimuth from seam
    const camOffset = new THREE.Vector3(
      camDist * 0.6,
      camDist * 0.5,
      camDist * 0.7
    );
    camera.position.copy(seamCenter).add(camOffset);
    controls.target.copy(seamCenter);
    controls.update();

    // ── A. Workpiece Plate (Fillet Joint Base) ──
    const plateLenPad = totalWeldLen + 20;
    const plateWidth = 40;
    const plateThickness = 4;

    // Bottom plate (horizontal)
    const bottomPlateGeo = new THREE.BoxGeometry(plateWidth, plateThickness, plateLenPad);
    const plateMat = new THREE.MeshStandardMaterial({
      color: 0x3a3f47,
      metalness: 0.85,
      roughness: 0.35,
    });
    const bottomPlate = new THREE.Mesh(bottomPlateGeo, plateMat);
    bottomPlate.position.copy(centerWeld);
    bottomPlate.position.y -= plateThickness / 2 + 1;
    bottomPlate.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), weldDir);
    bottomPlate.receiveShadow = true;
    scene.add(bottomPlate);

    // Vertical plate (fillet joint upright)
    const vertPlateGeo = new THREE.BoxGeometry(plateThickness, plateWidth * 0.6, plateLenPad);
    const vertPlateMat = new THREE.MeshStandardMaterial({
      color: 0x4a4f57,
      metalness: 0.85,
      roughness: 0.35,
    });
    const vertPlate = new THREE.Mesh(vertPlateGeo, vertPlateMat);
    vertPlate.position.copy(centerWeld);
    vertPlate.position.y += plateWidth * 0.3 - plateThickness;
    vertPlate.position.x -= plateWidth / 2;
    vertPlate.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), weldDir);
    vertPlate.receiveShadow = true;
    scene.add(vertPlate);

    // Chamfered edge highlight strip at joint intersection
    const chamferGeo = new THREE.CylinderGeometry(0.8, 0.8, plateLenPad, 8);
    const chamferMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.7, roughness: 0.3 });
    const chamferMesh = new THREE.Mesh(chamferGeo, chamferMat);
    chamferMesh.position.copy(centerWeld);
    chamferMesh.position.x -= plateWidth / 2 + 1;
    chamferMesh.position.y -= 1;
    chamferMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), weldDir);
    scene.add(chamferMesh);

    // ── B. Air Motion Lines (Dashed) ──
    const createDashedLine = (p1, p2) => {
      const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const mat = new THREE.LineDashedMaterial({ color: 0x475569, dashSize: 3, gapSize: 2, linewidth: 1.5 });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      return line;
    };
    scene.add(createDashedLine(vecHome, vecApproach));
    scene.add(createDashedLine(vecApproach, vecWeldStart));
    scene.add(createDashedLine(vecWeldEnd, vecRetract));
    scene.add(createDashedLine(vecRetract, vecHome));

    // ── C. Base Unwelded Seam Cylinder ──
    const unweldedGeo = new THREE.CylinderGeometry(1.0, 1.0, totalWeldLen, 16);
    const unweldedMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7, emissive: 0x0369a1, metalness: 0.8, roughness: 0.2
    });
    const unweldedMesh = new THREE.Mesh(unweldedGeo, unweldedMat);
    unweldedMesh.position.copy(centerWeld);
    unweldedMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), weldDir);
    scene.add(unweldedMesh);

    // ── D. Dynamic Welded Seam Cylinder ──
    const weldedGeo = new THREE.CylinderGeometry(1.25, 1.25, 1, 16);
    const weldedMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xe2e8f0, metalness: 0.9, roughness: 0.1
    });
    const weldedMesh = new THREE.Mesh(weldedGeo, weldedMat);
    weldedMesh.visible = false;
    scene.add(weldedMesh);
    weldedMeshRef.current = weldedMesh;

    // ── E. Robtarget Markers ──
    const addMarker = (pos, color, emissive, size = 1.2) => {
      const geo = new THREE.SphereGeometry(size, 16, 16);
      const mat = new THREE.MeshStandardMaterial({ color, emissive, metalness: 0.8 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      scene.add(mesh);
    };
    addMarker(vecHome, 0x10b981, 0x059669, 1.8);
    addMarker(vecApproach, 0x3b82f6, 0x2563eb, 1.0);
    addMarker(vecWeldStart, 0x22c55e, 0x16a34a, 1.4);
    addMarker(vecWeldEnd, 0xef4444, 0xb91c1c, 1.4);
    addMarker(vecRetract, 0xa855f7, 0x7c3aed, 1.0);

    // ── F. Industrial Torch (45° work angle along seam tangent) ──
    const torchGroup = new THREE.Group();

    // Sharp nozzle tip — pointing down (toward workpiece)
    const nozzleGeo = new THREE.ConeGeometry(1.6, 9, 16);
    const nozzleMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.95, roughness: 0.1 });
    const nozzleMesh = new THREE.Mesh(nozzleGeo, nozzleMat);
    nozzleMesh.rotation.x = Math.PI;
    nozzleMesh.position.y = 4.5;
    torchGroup.add(nozzleMesh);

    // Main body
    const bodyGeo = new THREE.CylinderGeometry(2.8, 3.5, 20, 16);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf97316, metalness: 0.7, roughness: 0.2 });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = 19;
    torchGroup.add(bodyMesh);

    // Status ring
    const ringGeo = new THREE.TorusGeometry(3.6, 0.6, 16, 32);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7 });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.y = 26;
    torchGroup.add(ringMesh);

    // Arc glow sphere at tip
    const arcGlowGeo = new THREE.SphereGeometry(2, 16, 16);
    const arcGlowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    const arcGlowMesh = new THREE.Mesh(arcGlowGeo, arcGlowMat);
    arcGlowMesh.position.set(0, 0, 0);
    torchGroup.add(arcGlowMesh);
    arcGlowMeshRef.current = arcGlowMesh;

    // Arc point light
    const arcLight = new THREE.PointLight(0x38bdf8, 0, 100);
    arcLight.position.set(0, 0, 0);
    torchGroup.add(arcLight);
    arcLightRef.current = arcLight;

    // Apply 45° tilt along the seam tangent direction
    // The torch body points along +Y, we want it tilted 45° toward the seam direction
    const upVec = new THREE.Vector3(0, 1, 0);
    const tiltAxis = new THREE.Vector3().crossVectors(upVec, weldDir).normalize();
    if (tiltAxis.length() > 0.01) {
      const tiltQuat = new THREE.Quaternion().setFromAxisAngle(tiltAxis, Math.PI / 4); // 45°
      torchGroup.quaternion.copy(tiltQuat);
    }

    scene.add(torchGroup);
    torchRef.current = torchGroup;

    // Animation Loop
    let animationFrameId;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();

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

  // 5-Phase Torch Motion
  useEffect(() => {
    if (torchRef.current && waypointsRef.current.home) {
      const { home, approach, weldStart, weldEnd, retract } = waypointsRef.current;
      const p = Math.min(Math.max(progressRatio, 0), 1);

      let targetPos = new THREE.Vector3();
      let currentWeldTip = weldStart.clone();

      if (p < 0.15) {
        targetPos.lerpVectors(home, approach, p / 0.15);
        currentWeldTip.copy(weldStart);
      } else if (p < 0.25) {
        targetPos.lerpVectors(approach, weldStart, (p - 0.15) / 0.10);
        currentWeldTip.copy(weldStart);
      } else if (p <= 0.75) {
        const weldProgress = (p - 0.25) / 0.50;
        targetPos.lerpVectors(weldStart, weldEnd, weldProgress);
        currentWeldTip.copy(targetPos);
      } else if (p < 0.85) {
        targetPos.lerpVectors(weldEnd, retract, (p - 0.75) / 0.10);
        currentWeldTip.copy(weldEnd);
      } else {
        targetPos.lerpVectors(retract, home, (p - 0.85) / 0.15);
        currentWeldTip.copy(weldEnd);
      }

      torchRef.current.position.copy(targetPos);

      // Maintain 45° tilt orientation along seam
      const upVec = new THREE.Vector3(0, 1, 0);
      const dir = weldDirRef.current;
      const tiltAxis = new THREE.Vector3().crossVectors(upVec, dir).normalize();
      if (tiltAxis.length() > 0.01) {
        const tiltQuat = new THREE.Quaternion().setFromAxisAngle(tiltAxis, Math.PI / 4);
        torchRef.current.quaternion.copy(tiltQuat);
      }

      // Dynamic Welded Cylinder Extension
      if (weldedMeshRef.current) {
        const currentLen = weldStart.distanceTo(currentWeldTip);
        if (currentLen > 0.1 && p >= 0.22) {
          weldedMeshRef.current.visible = true;
          weldedMeshRef.current.scale.set(1, currentLen, 1);

          const midPos = new THREE.Vector3().addVectors(weldStart, currentWeldTip).multiplyScalar(0.5);
          weldedMeshRef.current.position.copy(midPos);

          const cylDir = new THREE.Vector3().subVectors(currentWeldTip, weldStart).normalize();
          weldedMeshRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), cylDir);
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
  const { canonicalWeldPath, rawPayload, updateProgress } = useTcpWorkflow();

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const maxTime = 12;
  const [backendRapidCode, setBackendRapidCode] = useState(null);

  useEffect(() => {
    updateProgress({ generateComplete: true, step6Complete: true });
  }, [updateProgress]);

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
    if (canonicalWeldPath?.waypoints && canonicalWeldPath.waypoints.length > 0) {
      return canonicalWeldPath.waypoints.map((wp) => ({
        name: wp.name || wp.id,
        x: wp.pos ? wp.pos[0] : wp.x,
        y: wp.pos ? wp.pos[1] : wp.y,
        z: wp.pos ? wp.pos[2] : wp.z,
        type: wp.type,
        pos: wp.pos,
      }));
    }
    if (canonicalWeldPath?.pathPoints && canonicalWeldPath.pathPoints.length > 0) {
      return canonicalWeldPath.pathPoints;
    }
    if (rawPayload?.pathPoints && rawPayload.pathPoints.length > 0) {
      return rawPayload.pathPoints;
    }
    return [
      { name: "home", x: 226.61, y: 1023.25, z: 722.07, type: "home" },
      { name: "Target_30", x: 427.75, y: 1074.86, z: 350.34, type: "approach" },
      { name: "Target_40", x: 414.69, y: 1112.75, z: 320.34, type: "weld_start" },
      { name: "Target_20_5", x: 338.53, y: 1333.74, z: 322.07, type: "weld_end" },
      { name: "Target_20", x: 338.53, y: 1333.74, z: 362.07, type: "retract" },
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

  const phaseLabel = useMemo(() => {
    if (!isPlaying) return "IDLE";
    if (progressRatio < 0.15) return "HOME → APPROACH";
    if (progressRatio < 0.25) return "APPROACH → WELD START";
    if (progressRatio <= 0.75) return "WELDING";
    if (progressRatio < 0.85) return "WELD END → RETRACT";
    return "RETRACT → HOME";
  }, [isPlaying, progressRatio]);

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
            {isPlaying && (
              <span className="ml-2 text-[10px] font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                {phaseLabel}
              </span>
            )}
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
            <div className="flex items-center gap-1.5 text-slate-300">
              <span className="text-slate-400 font-mono text-[11px]">POINTS:</span>
              <span className="font-mono font-bold text-emerald-400">{activePoints.length}</span>
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