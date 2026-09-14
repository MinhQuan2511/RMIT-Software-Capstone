# VertexDynamics: Scan-to-Path Hub

RMIT University Capstone 2026 — *3D Vision for Automated Structural Welding*.

A **local, single-operator** application that imports seam descriptor files exported by the vision software,
validates them, plans a fixed clearance path, and generates a **candidate motion-only ABB RAPID module** for
**manual validation in RobotStudio**.

> **What this application does not do.** It has no camera, TracerStudio or robot-controller connection. It does not
> solve inverse kinematics, check reachability, singularities, joint limits or collisions, generate welding process
> instructions, transfer code to a controller, or start robot motion. A downloaded module is not approval for physical
> execution.

Detailed documents: [API contract](docs/API_CONTRACT.md) · [Validation guide](docs/VALIDATION_GUIDE.md) ·
[Test results](docs/TEST_RESULTS.md) · [Performance](docs/PERFORMANCE_METHOD.md) ·
[Remediation matrix](docs/REMEDIATION_MATRIX.md) · [Report claim alignment](docs/REPORT_CLAIM_ALIGNMENT.md) ·
[Handoff](docs/IMPLEMENTATION_HANDOFF.md) · [Original audit](docs/TECHNICAL_AUDIT.md)

---

## 1. Requirements and installation

- Windows 10/11 (RobotStudio launch is Windows-only; everything else also runs on macOS/Linux)
- Node.js ≥ 22.12 (developed and tested on 24.16.0; see `.nvmrc`)
- Optional: ABB RobotStudio for manual validation

```bash
git clone https://github.com/MinhQuan2511/RMIT-Software-Capstone.git
cd RMIT-Software-Capstone
npm run setup        # npm ci in backend/ and frontend/ from the lockfiles
npm run dev          # backend http://127.0.0.1:5000/api + frontend http://127.0.0.1:3000
```

`npm run dev` refuses to start if port 3000 or 5000 is already in use; it never stops other processes.
Run the services separately with `npm run backend` and `npm run frontend`.

Checks: `npm test` · `npm run lint` · `npm run build` · `npm run check` (all) · `npm run bench`.

Configuration is optional: copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to
`frontend/.env.local`. Fonts and icons are bundled locally, so the UI works without internet access.

## 2. Local-only assumptions

- Both services bind to `127.0.0.1`. The backend accepts requests only with a loopback `Host`, an allowed `Origin`
  and a per-process request token; it refuses a non-loopback bind unless explicitly overridden.
- The operator name entered at start-up is **attribution only**, not authentication.
- Data are stored in `backend/data/` (projects, immutable sources, jobs and revisions). Nothing is deleted
  automatically; to start afresh, stop the backend and move that folder aside.
- If you deploy the backend on another machine, "Save and open RobotStudio" would start RobotStudio on *that* machine.
  Do not expose this service publicly.

## 3. Workflow (File import mode)

1. **Project** — create or select a local project; reopen any earlier job revision.
2. **Acquire** — watched folder (polled every 3 s while the page is open) or manual `.txt` upload. Select exactly
   one stored source. Invalid input shows diagnostics and cannot be processed. Demo samples are available behind
   explicit *Load sample* buttons and are marked **inspection only** everywhere.
3. **Parse & Map** — the stored revision: 2.5D projection (arcs drawn from the fitted circle), geometry metrics,
   target table, diagnostics, required acknowledgements and the supported motion-profile parameters. Changing a
   parameter creates a new revision; reviews never carry over.
4. **Generate** — read-only module text with its SHA-256, application precheck results, stated assumptions, and an
   illustrative 3D preview driven by the stored targets and orientations. Record the module review.
5. **Download / Open RobotStudio** — download, copy, save to the export folder, or save and start RobotStudio; each has
   its own outcome. Follow the manual validation checklist and record RobotStudio results as operator-reported evidence.

**Testing mode** (top bar): upload CSV/XLSX, map columns explicitly (orientation convention and configuration policy
are required choices), store the point list, create a job, then continue from Generate. The same generator is used.

**Calibration routine** (tool): facts read from the archived station `auto_calib.rspag` (16 poses, 17 robtargets,
19 motion statements, 18 × 3 s dwell) and an operator checklist. No image capture, pose readback, hand-eye solving or
error calculation is performed by this application.

The *Configure* and *Preview* pages of the former API mode explain why those features are unavailable.

## 4. Input formats

Coordinates are **millimetres in the robot base frame, assumed pre-calibrated**. No camera-to-robot transform exists.

Straight seam:

```text
units: mm
curve: x1, y1, z1, x2, y2, z2, width
```

Three-point arc (all points on the arc):

```text
type: arc
units: mm
arc_start: x, y, z
arc_via:   x, y, z
arc_end:   x, y, z
seam_width: w
```

Rules: one seam per file; whole-line `#` comments only; exact token counts; finite numbers; `units` other than `mm`
and `frame` other than `robot_base` are rejected; a missing `units` line must be acknowledged; width must be > 0
(display-only); coincident/collinear arc points and near-vertical seams are rejected; nearly straight arcs are rejected
unless the explicit conversion option is chosen. Full list of checks and limits: [API contract §5–6](docs/API_CONTRACT.md).

Samples: `samples/Feature_Straight_Sample.txt`, `samples/Feature_Arc_Sample.txt`. Files ingested from the `samples/`
folder are demo sources. To run your own test, copy a file into `watch-inbox/` (create the folder) and set the watch
folder to `watch-inbox` on the Acquire page.

## 5. Generated module and required controller data

Profile `fixed-base-quaternion@1` (defaults reproduce the earlier template):

| Move | Target | Speed / zone |
|---|---|---|
| MoveJ | `home` (standby) | v100 / z100 |
| MoveL | `Target_30` (approach) | v60 / z10 |
| MoveL | `Target_40` (weld start) | v100 / fine |
| MoveL or MoveC via `Target_45` | `Target_20_5` (weld end) | v100 / fine |
| MoveL | `Target_20` (retract) | v80 / z10 |
| MoveL | `home` | v100 / fine |

Offsets (heuristic, not collision-checked): approach −25 mm along the horizontal travel direction, +35 mm lateral,
+45 mm up; retract +20 / +35 / +45 mm; standby at the chord midpoint +60 mm lateral, Z = highest weld point + 350 mm.

- Orientation: the recorded template weld quaternion normalised to unit length (`[0.383667588, 0.149822324,
  0.889291982, -0.198776819]`), rotated about the arc normal for arcs; standby upright. It is a fixed base-frame
  orientation, not a computed work/travel angle.
- Robot configuration `[0,0,0,0]` for every target — **not solved**; validate in RobotStudio.
- Tool `tWeldGun` and work object `wobj0` are referenced by name. **They must already exist on the controller** with
  the correct calibrated definitions; the module never declares them. Note that project documents quote different
  tool definitions (archive `tWeldGun` TCP [125.80, 0, 391.27] mm; report [0, 0, 200] mm; earlier README
  [0, 0, 380] mm) — confirm which is correct for your station.
- The header records the source SHA-256, profile and generator version, and states that the module has only passed
  application prechecks.

## 6. Error recovery

| Situation | What you see | What to do |
|---|---|---|
| Backend not running | "Backend: disconnected"; no data shown in its place | Start the backend; press Retry |
| Invalid descriptor | Diagnostics with line numbers; Process disabled | Fix the file (a changed file becomes a new source) |
| Stage locked | Explanation and a link to the required step | Complete that step |
| "Revision changed" (409) | Another tab created a newer revision | Reload the current revision |
| Export blocked | List of reasons (demo, superseded, acknowledgements, reviews) | Resolve each reason |
| Save failed / RobotStudio not found | Separate outcome lines | Create the export folder or set `VD_EXPORT_DIR`; set `VD_ROBOTSTUDIO_EXE`; download still works |
| Corrupt saved session | Notice that the session was reset | Reopen the project from Projects (stored jobs are unaffected) |

## 7. Repository map

```
backend/
  app.js, server.js            Express app factory and loopback server
  routes/apiRoutes.js          HTTP API v2
  services/parsers/            curveParser (Feature.txt), pointListAdapter (Testing mode)
  services/kinematics/         arcFitter, pathPlanner, profiles
  services/compiler/           rapidCompiler, rapidPrecheck
  services/jobs/               jobStore (filesystem), jobService (pipeline + gates)
  services/ingest/             watchFolder
  services/robotstudio/        exportWriter, launcher
  services/security/           requestGuard (Host/Origin/CSRF, rate limits)
  services/calibration/        rspagReader (archive facts)
  scripts/benchmark.js         timing benchmark
  test/                        node:test suites
frontend/
  src/app/                     pages (dashboard route group), layouts, error/loading boundaries
  src/components/              session context, navigation, panels, Toolpath25D, WeldSimulation3D, weldScene
  src/lib/                     pure logic: stages, session, playback, sparks, projection, view transform, mapping
  src/services/apiClient.js    API client (CSRF token, normalised errors)
  public/stations/             archived calibration station (contains licence/backup files; do not redistribute)
  test/                        node:test suites + fixtures generated from the backend
scripts/browser-evidence.mjs   screenshot run against the real app (optional tooling)
samples/                       demo seam descriptors
docs/                          audit, plan, matrix, contract, validation, results, performance, claims, handoff
stitch_vertex_dynamics_scan_to_path_hub/   original static design mockups (not used at runtime)
```

## 8. Limitations

- Motion only; no welding process data or I/O.
- No reachability, IK, configuration, singularity, joint-limit or collision analysis.
- Fixed base-frame weld orientation; seam-relative torch planning needs joint-frame input that the descriptor lacks.
- Browser preview interpolation does not reproduce MoveJ joint motion, zone blending or controller orientation
  interpolation; the 12 s duration is not a cycle time.
- Watched folder is polled only while the Acquire page is open.
- RobotStudio launch only starts a process; importing the module was not verified from the command line.
- Single local operator; no authentication; not for network deployment.

Developed by the VertexDynamics software team as part of the RMIT University Engineering Capstone (2026).
