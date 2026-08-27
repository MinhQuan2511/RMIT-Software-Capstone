"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * WeldSimulation3D
 * Industrial 3D Kinematics & T-Joint Workpiece Visualizer
 *
 * Dynamically builds the T-joint CAD mesh directly from Target_40 (P_start)
 * and Target_20_5 (P_end) in authentic millimeter-scale coordinates.
 */
export default function WeldSimulation3D({ points = [], isPlaying = false, progressRatio = 0 }) {
  const mountRef = useRef(null);
  const torchRef = useRef(null);
  const arcLightRef = useRef(null);
  const arcGlowMeshRef = useRef(null);
  const weldedMeshRef = useRef(null);
  const sparkParticlesRef = useRef(null);
  const waypointsRef = useRef({ home: null, approach: null, weldStart: null, weldEnd: null, retract: null });
  const isPlayingRef = useRef(isPlaying);
  const progressRef = useRef(progressRatio);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    progressRef.current = progressRatio;
  }, [progressRatio]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 700;
    const height = container.clientHeight || 450;

    // 1. Scene & Camera Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#060913");

    const camera = new THREE.PerspectiveCamera(45, width / height, 1, 10000);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // 2. Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 + 0.05;

    // 3. Lighting Setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xf0f4ff, 2.2);
    dirLight.position.set(600, 1000, 600);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.6);
    fillLight.position.set(-600, 400, -600);
    scene.add(fillLight);

    // 4. Extract Real Trajectory Waypoints (1 unit = 1 mm)
    if (!points || points.length === 0) return;

    const findTarget = (type, names) => {
      if (!Array.isArray(points)) return null;
      return points.find((p) => p.type === type || (p.name && names.includes(p.name)) || (p.id && names.includes(p.id)));
    };

    const px = (p) => {
      if (!p) return 0;
      if (Array.isArray(p.pos)) return p.pos[0];
      if (p.x !== undefined) return p.x;
      return 0;
    };
    const py = (p) => {
      if (!p) return 0;
      if (Array.isArray(p.pos)) return p.pos[1];
      if (p.y !== undefined) return p.y;
      return 0;
    };
    const pz = (p) => {
      if (!p) return 0;
      if (Array.isArray(p.pos)) return p.pos[2];
      if (p.z !== undefined) return p.z;
      return 0;
    };

    // Map Robot Base Coordinates (X=fwd, Y=side, Z=height) to Three.js (X=X, Y=Z (Up), Z=-Y)
    const toVec = (p) => new THREE.Vector3(px(p), pz(p), -py(p));

    const homeRaw = findTarget("home", ["home"]) || points[0];
    const approachRaw = findTarget("approach", ["Target_30"]) || points[1] || points[0];
    const weldStartRaw = findTarget("weld_start", ["Target_40"]) || points[2] || points[0];
    const weldEndRaw = findTarget("weld_end", ["Target_20_5", "Target_20"]) || points[3] || points[points.length - 1];

    // 1. Orthonormal Basis Calculation
    const P_start = weldStartRaw ? toVec(weldStartRaw) : new THREE.Vector3(0, 0, 0);
    const P_end = weldEndRaw ? toVec(weldEndRaw) : new THREE.Vector3(100, 0, 0);
    const seamVec = new THREE.Vector3().subVectors(P_end, P_start);
    const L = Math.max(P_start.distanceTo(P_end), 10);
    const P_mid = new THREE.Vector3().addVectors(P_start, P_end).multiplyScalar(0.5);

    const uSeam = seamVec.clone().normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);

    // Horizontal perpendicular vector
    let uWidth = new THREE.Vector3().crossVectors(uSeam, worldUp).normalize();
    if (uWidth.lengthSq() < 0.001) uWidth.set(0, 0, 1);

    // True Up vector
    let uTrueUp = new THREE.Vector3().crossVectors(uWidth, uSeam).normalize();
    if (uTrueUp.y < 0) {
      uTrueUp.negate();
      uWidth.crossVectors(uSeam, uTrueUp).normalize();
    }

    // 2. Synthesize Collision-Free 3D Waypoints (Pushed into +uWidth open space)
    const P_approach = P_start.clone()
      .addScaledVector(uSeam, -25)      // 25mm behind start
      .addScaledVector(uTrueUp, 45)     // 45mm height clearance
      .addScaledVector(uWidth, 35);     // +35mm offset into OPEN workspace in front of web

    const P_retract = P_end.clone()
      .addScaledVector(uSeam, 20)       // 20mm past end
      .addScaledVector(uTrueUp, 45)     // 45mm height clearance
      .addScaledVector(uWidth, 35);     // +35mm offset into OPEN workspace

    const P_home = P_mid.clone()
      .addScaledVector(uTrueUp, 320)    // High clearance
      .addScaledVector(uWidth, 80);     // Offset forward into open space

    waypointsRef.current = {
      home: P_home,
      approach: P_approach,
      weldStart: P_start,
      weldEnd: P_end,
      retract: P_retract,
    };

    // 3. Workpiece Table Grid (Grounded just below base flange)
    const plateThickness = 12;
    const gridHelper = new THREE.GridHelper(1200, 24, 0x334155, 0x1e293b);
    gridHelper.position.set(P_mid.x, P_mid.y - plateThickness - 2, P_mid.z);
    scene.add(gridHelper);

    // 4. Symmetrical T-Joint CAD Workpiece Assembly (THREE.Group at P_mid)
    const tJointGroup = new THREE.Group();
    const basisMatrix = new THREE.Matrix4().makeBasis(uSeam, uTrueUp, uWidth);
    tJointGroup.setRotationFromMatrix(basisMatrix);
    tJointGroup.position.copy(P_mid);

    const plateMat = new THREE.MeshStandardMaterial({
      color: 0x334155, // Slate steel
      metalness: 0.6,
      roughness: 0.35,
    });

    const L_plate = L + 30;
    const webHeight = 70;
    const flangeWidth = 140;

    // Base Flange: Centered at origin, top surface at Y = 0
    const flangeGeo = new THREE.BoxGeometry(L_plate, plateThickness, flangeWidth);
    const flangeMesh = new THREE.Mesh(flangeGeo, plateMat);
    flangeMesh.position.set(0, -plateThickness / 2, 0);
    flangeMesh.receiveShadow = true;
    flangeMesh.castShadow = true;
    tJointGroup.add(flangeMesh);

    // Base plate CAD edge outlines
    const flangeEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(flangeGeo),
      new THREE.LineBasicMaterial({ color: 0x475569, linewidth: 1 })
    );
    flangeMesh.add(flangeEdges);

    // Vertical Web: Spans Z in [-12mm, 0mm] strictly behind the seam
    const webGeo = new THREE.BoxGeometry(L_plate, webHeight, plateThickness);
    const webMesh = new THREE.Mesh(webGeo, plateMat);
    webMesh.position.set(0, webHeight / 2, -plateThickness / 2);
    webMesh.receiveShadow = true;
    webMesh.castShadow = true;
    tJointGroup.add(webMesh);

    // Web plate CAD edge outlines
    const webEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(webGeo),
      new THREE.LineBasicMaterial({ color: 0x64748b, linewidth: 1 })
    );
    webMesh.add(webEdges);

    // Active Seam: At (Z = 0, Y = 0)
    const unweldedGeo = new THREE.CylinderGeometry(3.5, 3.5, L, 16);
    const unweldedMat = new THREE.MeshStandardMaterial({
      color: 0x00d2ff,
      emissive: 0x0077aa,
      metalness: 0.8,
      roughness: 0.2,
    });
    const unweldedMesh = new THREE.Mesh(unweldedGeo, unweldedMat);
    unweldedMesh.rotation.z = Math.PI / 2;
    unweldedMesh.position.set(0, 0, 0);
    tJointGroup.add(unweldedMesh);

    scene.add(tJointGroup);

    // 7. Motion Trajectory Dashed Lines
    const createDashedLine = (p1, p2, color = 0x64748b, dashSize = 12, gapSize = 8) => {
      const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const mat = new THREE.LineDashedMaterial({ color, dashSize, gapSize, linewidth: 1.5 });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      return line;
    };
    scene.add(createDashedLine(P_home, P_approach, 0x64748b, 14, 8));
    scene.add(createDashedLine(P_approach, P_start, 0xeab308, 10, 6));
    scene.add(createDashedLine(P_end, P_retract, 0xa855f7, 10, 6));
    scene.add(createDashedLine(P_retract, P_home, 0x64748b, 14, 8));

    // 8. Dynamic Welded Bead Cylinder (Hot molten bead growth in World Space)
    const weldedGeo = new THREE.CylinderGeometry(4.8, 4.8, 1, 16);
    const weldedMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xf1f5f9,
      metalness: 0.95,
      roughness: 0.1,
    });
    const weldedMesh = new THREE.Mesh(weldedGeo, weldedMat);
    weldedMesh.visible = false;
    scene.add(weldedMesh);
    weldedMeshRef.current = weldedMesh;

    // 9. Waypoint Sphere Markers
    const addMarker = (pos, color, emissive, radius = 6) => {
      const geo = new THREE.SphereGeometry(radius, 16, 16);
      const mat = new THREE.MeshStandardMaterial({ color, emissive, metalness: 0.8 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      scene.add(mesh);
    };
    addMarker(P_home, 0x06b6d4, 0x0891b2, 8);      // home: Cyan sphere
    addMarker(P_approach, 0xeab308, 0xca8a04, 5.5); // Target_30: Yellow sphere
    addMarker(P_start, 0x22c55e, 0x16a34a, 6.5);   // Target_40: Green sphere (Weld Start)
    addMarker(P_end, 0xef4444, 0xdc2626, 6.5);     // Target_20_5: Red sphere (Weld End)
    addMarker(P_retract, 0xa855f7, 0x7c3aed, 5.5); // Target_20: Purple sphere (Retract)

    // 10. Scaled Industrial Welding Torch CAD Model
    // Nozzle diameter ~16mm, length ~130mm
    const torchGroup = new THREE.Group();

    // Nozzle Cone (Tip at Y = 0)
    const nozzleGeo = new THREE.ConeGeometry(8.0, 24.0, 16);
    const nozzleMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      metalness: 0.92,
      roughness: 0.18,
    });
    const nozzleMesh = new THREE.Mesh(nozzleGeo, nozzleMat);
    nozzleMesh.rotation.x = Math.PI;
    nozzleMesh.position.y = 12.0; // Tip sits at (0, 0, 0)
    torchGroup.add(nozzleMesh);

    // Gunmetal Barrel (Length ~80mm)
    const barrelGeo = new THREE.CylinderGeometry(9.5, 11.0, 70, 16);
    const barrelMat = new THREE.MeshStandardMaterial({
      color: 0x374151,
      metalness: 0.88,
      roughness: 0.25,
    });
    const barrelMesh = new THREE.Mesh(barrelGeo, barrelMat);
    barrelMesh.position.y = 59.0;
    torchGroup.add(barrelMesh);

    // Handle Grip
    const gripGeo = new THREE.CylinderGeometry(12.0, 12.0, 45, 16);
    const gripMat = new THREE.MeshStandardMaterial({
      color: 0x1f2937,
      metalness: 0.4,
      roughness: 0.6,
    });
    const gripMesh = new THREE.Mesh(gripGeo, gripMat);
    gripMesh.position.y = 100.0;
    torchGroup.add(gripMesh);

    // LED Indicator Ring
    const ringGeo = new THREE.TorusGeometry(12.0, 1.6, 16, 32);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      metalness: 0.5,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.y = 28.0;
    torchGroup.add(ringMesh);

    // Cable Feed
    const cableGeo = new THREE.CylinderGeometry(5.0, 5.0, 40, 12);
    const cableMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.8,
    });
    const cableMesh = new THREE.Mesh(cableGeo, cableMat);
    cableMesh.position.y = 135.0;
    torchGroup.add(cableMesh);

    // Arc Glow Sphere & Point Light
    const arcGlowGeo = new THREE.SphereGeometry(8.0, 16, 16);
    const arcGlowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    const arcGlowMesh = new THREE.Mesh(arcGlowGeo, arcGlowMat);
    arcGlowMesh.position.set(0, 0, 0);
    torchGroup.add(arcGlowMesh);
    arcGlowMeshRef.current = arcGlowMesh;

    const arcLight = new THREE.PointLight(0x38bdf8, 0, 450);
    arcLight.position.set(0, 0, 0);
    torchGroup.add(arcLight);
    arcLightRef.current = arcLight;

    // 11. Arc Welding Spark Particles
    const SPARK_COUNT = 60;
    const sparkPositions = new Float32Array(SPARK_COUNT * 3);
    const sparkVelocities = [];
    const sparkLifetimes = new Float32Array(SPARK_COUNT);
    for (let i = 0; i < SPARK_COUNT; i++) {
      sparkPositions[i * 3] = 0;
      sparkPositions[i * 3 + 1] = 0;
      sparkPositions[i * 3 + 2] = 0;
      sparkVelocities.push(new THREE.Vector3(0, 0, 0));
      sparkLifetimes[i] = 0;
    }
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPositions, 3));
    const sparkMat = new THREE.PointsMaterial({
      color: 0xfef08a,
      size: 4.5,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sparkPoints = new THREE.Points(sparkGeo, sparkMat);
    sparkPoints.visible = false;
    scene.add(sparkPoints);
    sparkParticlesRef.current = { mesh: sparkPoints, positions: sparkPositions, velocities: sparkVelocities, lifetimes: sparkLifetimes, geo: sparkGeo };

    // 12. Torch Quaternions: Standby vs. 45° Fillet Work Angle
    const quatStandby = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, -1, 0)
    );

    // 3. Torch 45-Degree Work Angle from Open Front Workspace (+uWidth, +uTrueUp)
    const torchAimDir = new THREE.Vector3()
      .addScaledVector(uWidth, -0.7071)
      .addScaledVector(uTrueUp, -0.7071)
      .normalize();

    const quatWeld45 = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, -1, 0),
      torchAimDir
    );

    torchGroup.quaternion.copy(quatStandby);
    torchGroup.position.copy(P_home);
    scene.add(torchGroup);
    torchRef.current = torchGroup;

    // 13. Auto-Center Camera at P_mid (Distance ~500mm)
    controls.target.copy(P_mid);
    const camOffset = uWidth.clone().multiplyScalar(420)
      .add(uTrueUp.clone().multiplyScalar(280))
      .add(uSeam.clone().multiplyScalar(150));
    camera.position.copy(P_mid).add(camOffset);
    controls.update();

    // 14. Realtime Kinematics Animation Loop
    let animationFrameId;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();

      const p = Math.min(Math.max(progressRef.current, 0), 1);
      const playing = isPlayingRef.current;
      const isWeldingActive = playing && p >= 0.25 && p <= 0.75;

      // Interpolate Torch Position & Pose
      if (torchRef.current && waypointsRef.current.home) {
        const { home, approach, weldStart, weldEnd, retract } = waypointsRef.current;
        let targetPos = new THREE.Vector3();
        let currentWeldTip = weldStart.clone();
        let targetQuat = new THREE.Quaternion();

        if (p < 0.15) {
          // Phase 1: Home -> Target_30 (Approach)
          const frac = p / 0.15;
          targetPos.lerpVectors(home, approach, frac);
          targetQuat.copy(quatStandby).slerp(quatWeld45, frac * 0.4);
          currentWeldTip.copy(weldStart);
        } else if (p < 0.25) {
          // Phase 2: Target_30 -> Target_40 (Weld Start)
          const frac = (p - 0.15) / 0.10;
          targetPos.lerpVectors(approach, weldStart, frac);
          targetQuat.copy(quatStandby).slerp(quatWeld45, 0.4 + frac * 0.6);
          currentWeldTip.copy(weldStart);
        } else if (p <= 0.75) {
          // Phase 3: Target_40 -> Target_20_5 (Weld Along Root Corner)
          const frac = (p - 0.25) / 0.50;
          targetPos.lerpVectors(weldStart, weldEnd, frac);
          targetQuat.copy(quatWeld45);
          currentWeldTip.copy(targetPos);
        } else if (p < 0.85) {
          // Phase 4: Target_20_5 -> Target_20 (Retract Lift)
          const frac = (p - 0.75) / 0.10;
          targetPos.lerpVectors(weldEnd, retract, frac);
          targetQuat.copy(quatWeld45);
          currentWeldTip.copy(weldEnd);
        } else {
          // Phase 5: Target_20 -> Home
          const frac = (p - 0.85) / 0.15;
          targetPos.lerpVectors(retract, home, frac);
          targetQuat.copy(quatWeld45).slerp(quatStandby, frac);
          currentWeldTip.copy(weldEnd);
        }

        torchRef.current.position.copy(targetPos);
        torchRef.current.quaternion.copy(targetQuat);

        // Dynamic Welded Bead Growth
        if (weldedMeshRef.current) {
          const currentLen = weldStart.distanceTo(currentWeldTip);
          if (currentLen > 1.0 && p >= 0.25) {
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

      // Arc Welding Flame Glow & Flickering Point Light
      if (arcGlowMeshRef.current && arcLightRef.current) {
        if (isWeldingActive) {
          arcLightRef.current.intensity = 25 + Math.random() * 35;
          arcLightRef.current.color.setHex(Math.random() > 0.35 ? 0x38bdf8 : 0xfef08a);
          arcGlowMeshRef.current.material.opacity = 0.85 + Math.random() * 0.15;
          arcGlowMeshRef.current.material.color.setHex(
            Math.random() > 0.5 ? 0xfef08a : 0x38bdf8
          );
        } else {
          arcLightRef.current.intensity = 0;
          arcGlowMeshRef.current.material.opacity = 0;
        }
      }

      // Spark Particles Physics Simulation
      if (sparkParticlesRef.current) {
        const sp = sparkParticlesRef.current;
        sp.mesh.visible = isWeldingActive;

        if (isWeldingActive && torchRef.current) {
          const tipWorldPos = new THREE.Vector3();
          torchRef.current.getWorldPosition(tipWorldPos);

          for (let i = 0; i < SPARK_COUNT; i++) {
            sp.lifetimes[i] -= 0.016;
            if (sp.lifetimes[i] <= 0) {
              sp.positions[i * 3] = tipWorldPos.x + (Math.random() - 0.5) * 6;
              sp.positions[i * 3 + 1] = tipWorldPos.y + (Math.random() - 0.5) * 6;
              sp.positions[i * 3 + 2] = tipWorldPos.z + (Math.random() - 0.5) * 6;
              sp.velocities[i].set(
                (Math.random() - 0.5) * 45,
                Math.random() * 35 + 20,
                (Math.random() - 0.5) * 45
              );
              sp.lifetimes[i] = 0.25 + Math.random() * 0.45;
            } else {
              sp.positions[i * 3] += sp.velocities[i].x * 0.25;
              sp.positions[i * 3 + 1] += sp.velocities[i].y * 0.25 - 1.2;
              sp.positions[i * 3 + 2] += sp.velocities[i].z * 0.25;
            }
          }
          sp.geo.attributes.position.needsUpdate = true;
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

  if (!points || points.length === 0) {
    return (
      <div className="w-full h-full min-h-[420px] flex flex-col items-center justify-center bg-slate-950 text-slate-400 gap-3 select-none rounded-xl">
        <div className="w-8 h-8 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
        <span className="text-xs font-mono tracking-wider text-slate-400">
          Loading 3D Kinematics Trajectory...
        </span>
      </div>
    );
  }

  return <div ref={mountRef} className="w-full h-full min-h-[420px] relative overflow-hidden rounded-xl" />;
}
