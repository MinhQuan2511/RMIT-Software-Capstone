# VertexDynamics: Scan-to-Path Hub

RMIT University Capstone 2026 — *3D Vision for Automated Structural Welding*.

A **local, single-operator** application that imports seam descriptor files exported by the vision software,
validates them, plans a clearance path, and generates a **candidate motion-only ABB RAPID module** for
**manual validation in RobotStudio**.

> **What this application does not do.** It has no camera, TracerStudio or robot-controller connection. It does not
> solve inverse kinematics, check reachability, singularities, joint limits or collisions, generate welding process
> instructions, transfer code to a controller, or start robot motion. It does not solve or apply a camera calibration.
> A downloaded module or evidence package is not approval for physical execution.

Detailed developer documents (API contract, validation guide, test results, performance method, orientation method,
calibration import, handoffs), developer tools (browser evidence runs, timing benchmark, fixture generator, review
bundle), their outputs and the original design mock-ups are kept under `LocalUse/`, which is excluded from version
control. They are not part of a fresh clone.

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

A clone contains **committed** work only. Features developed in a working copy but not yet committed and pushed
(including anything described here that your clone does not show) are not available from the repository until they are.

`npm run dev` refuses to start if its ports are in use and never stops other processes. To run a second copy, choose
other ports: `PORT=5100 VD_FRONTEND_PORT=3100 npm run dev` (the frontend's API URL and the backend's allowed origins
follow). Run the services separately with `npm run backend` and `npm run frontend`.

Checks: `npm test` · `npm run lint` · `npm run build` · `npm run check` (all).

Configuration is optional: copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to
`frontend/.env.local`. Fonts and icons are bundled locally, so the UI does not need internet access.

## 2. Local-only assumptions

- Both services bind to `127.0.0.1`. The backend accepts requests only with a loopback `Host`, an allowed `Origin`
  and a per-process request token; it refuses a non-loopback bind unless explicitly overridden.
- The operator name entered at start-up is **attribution only**, not authentication.
- Data are stored in `backend/data/` (projects, immutable sources, jobs and revisions, imported calibration files).
  Nothing is deleted automatically; to start afresh, stop the backend and move that folder aside.
- If you deploy the backend on another machine, "Save and open RobotStudio" would start RobotStudio on *that* machine.
  Do not expose this service publicly.

## 3. Workflow (File import mode)

1. **Project** — create or select a local project; reopen any earlier job revision. An optional, off-by-default
   workflow timing capture for evaluation sessions is here (no names, files or coordinates are recorded).
2. **Acquire** — watched folder (polled every 3 s while the page is open) or manual `.txt` upload. Optionally declare
   where the bytes come from (*recorded export*, *not verified* (default), *synthetic fixture*); how a file arrived is
   recorded separately and never implies a device capture. Demo samples are behind explicit *Load sample* buttons and are
   marked **inspection only** everywhere.
3. **Parse & Map** — the stored revision: 2.5D projection, geometry, target table, diagnostics, required
   acknowledgements, the **torch orientation mode** and the supported motion parameters. Any change creates a new
   revision; reviews and evidence never carry over.
4. **Generate** — read-only module text with its SHA-256, application prechecks, assumptions, and an illustrative 3D
   preview driven by the stored targets and orientations. Record the module review.
5. **Download / Open RobotStudio** — download, copy (with a download fallback if the browser denies clipboard access),
   save to the export folder, or save and start RobotStudio; each has its own outcome. Download the **offline evidence
   package**, follow the manual checklist, and record RobotStudio results as operator-reported evidence bound to the
   output **and** configuration hash.

**Testing mode** (top bar): upload CSV/XLSX, map columns explicitly (orientation convention and configuration policy
are required choices), store the point list, create a job, then continue from Generate. The same generator is used.

**Calibration** (tool page): facts read from the archived station `auto_calib.rspag`, and **import of OpenCV YAML
calibration files for inspection only** — shape, type, bottom row, rotation orthogonality and determinant are checked
and the exact bytes are stored; frames, direction and units are reported as unknown and the transform is never applied.

## 4. Input formats

Coordinates are **millimetres in the robot base frame, assumed pre-calibrated**. No camera-to-robot transform is applied.

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
unless the explicit conversion option is chosen. The descriptor carries **no joint geometry or surface normals**.

Samples: `samples/Feature_Straight_Sample.txt`, `samples/Feature_Arc_Sample.txt`. Files ingested from the `samples/`
folder are demo sources. To run your own test, copy a file into `watch-inbox/` (create the folder) and set the watch
folder to `watch-inbox` on the Acquire page. Copying a file there does not make it a device capture.

## 5. Generated module and required controller data

Motion instructions (both profiles):

| Move | Target | Default speed / zone |
|---|---|---|
| MoveJ | `home` (standby) | v100 / z100 |
| MoveL | `Target_30` (approach) | v60 / z10 |
| MoveL | `Target_40` (weld start) | v100 / fine |
| MoveL or MoveC via `Target_45` | `Target_20_5` (weld end) | v100 / fine |
| MoveL | `Target_20` (retract) | v80 / z10 |
| MoveL | `home` | v100 / fine |

### Profile `fixed-base-quaternion@1` (default; straight seams and arcs)

- Offsets (heuristic, not collision-checked): approach −25 mm along the horizontal travel direction, +35 mm lateral,
  +45 mm up; retract +20 / +35 / +45 mm; standby at the chord midpoint +60 mm lateral, Z = highest weld point + 350 mm.
- Orientation: the recorded template weld quaternion normalised to unit length (`[0.383667588, 0.149822324,
  0.889291982, -0.198776819]`), rotated about the arc normal for arcs; standby upright. It is a fixed base-frame
  orientation, not a computed work/travel angle.

### Profile `joint-relative-fillet@1` (experimental; straight seams only)

- The operator declares the joint: a 90° fillet template relative to the seam (floor reference normal, wall left or
  right of travel), explicit plate normals pointing into the open weld side, or a right-handed joint frame.
- A **station/tool profile** declares which tool axis is the torch axis and how roll is referenced. Built-in profiles
  are either synthetic test fixtures or the real station marked *unresolved* (its tool convention and TCP are unknown,
  so joint-relative planning is refused for it). An operator-declared convention requires a note and an acknowledgement.
- The orientation is computed for a requested work angle (default 45°) and push angle (default 10°) and checked by an
  independent recovery from the stored quaternion — a **mathematical check, not robot verification**.
- Approach, retract and standby lie along the planned torch-body direction.
- **Synthetic** station profiles and synthetic sources cannot be downloaded, saved or sent to RobotStudio; only the
  offline evidence package is available for them.

### Both profiles

- Robot configuration `[0,0,0,0]` for every target — **not solved**; validate in RobotStudio.
- Tool and work object are referenced by name (default `tWeldGun` / `wobj0`). **They must already exist on the
  controller** with the correct calibrated definitions; the module never declares them. Project documents quote different
  tool definitions (archive `tWeldGun` TCP [125.80, 0, 391.27] mm; report [0, 0, 200] mm; earlier README
  [0, 0, 380] mm) — none has been confirmed.
- The header records the source SHA-256, profile and generator version (and, for the joint profile, the joint source,
  requested angles, tool convention and station provenance). It states that the module has only passed application
  prechecks. It never contains its own hash.

### Offline evidence package

A ZIP per reviewed revision: source bytes, provenance, configuration (with its SHA-256), stored targets and segments,
requested and recovered angles, diagnostics and prechecks, the exact module, generator identity, a manifest and
`SHA256SUMS`, and a RobotStudio validation sheet marked **NOT RUN**. Check it without the application:
`node scripts/verify-evidence-package.mjs <package.zip>`.

### Workpiece geometry and clearance diagnostics

- Parse & Map → *Workpiece geometry and torch envelope* declares a finite straight 90° fillet workpiece (tee or corner,
  wall left or right, dimensions) or leaves it *Workpiece geometry unavailable* (seam-only). Butt, lap, non-90°, curved
  joints and imported CAD are not implemented. The same card holds a tool-frame torch envelope and **Reverse travel**
  (plates stay put).
- The backend stores the plates and runs clearance diagnostics against them. It checks target positions, linear TCP paths
  and torch capsules with exact distances. MoveJ, MoveC, fly-by corner zones and reorienting moves are reported as
  *Not assessed*. Statuses are only *Intersection detected*, *No intersection detected in assessed geometry*,
  *Inconclusive* and *Not assessed*.
- A definite intersection with **operator-defined** plates blocks download, save and RobotStudio launch
  (`WORKPIECE_INTERSECTION_DETECTED`); the evidence package keeps the failure. Illustrative plates never assess the real part.
- The 3D preview draws only the stored plates, targets, segments (dashed = schematic MoveJ), zones, findings and envelope.
  Method: `LocalUse/4/GEOMETRY_CLEARANCE_METHOD.md` (local working document).

## 6. Error recovery

| Situation | What you see | What to do |
|---|---|---|
| Backend not running | "Backend: disconnected"; no data shown in its place | Start the backend; press Retry |
| Invalid descriptor | Diagnostics with line numbers; Process disabled | Fix the file (a changed file becomes a new source) |
| Stage locked | Explanation and a link to the required step | Complete that step |
| "Revision changed" (409) | Another tab created a newer revision | Reload the current revision |
| Export blocked | List of reasons (demo, synthetic, superseded, acknowledgements, reviews) | Resolve each reason; synthetic revisions use the evidence package |
| Joint-relative orientation rejected | Diagnostic (for example seam not on the declared joint, left-handed frame, unresolved station) | Correct the declaration; nothing is adjusted automatically |
| Workpiece rejected or intersection detected | `WORKPIECE_*` diagnostics; export blocked with `WORKPIECE_INTERSECTION_DETECTED` | Correct dimensions, welding side, traversal or stand-offs as a new revision; the evidence package stays available |
| Save failed / RobotStudio not found | Separate outcome lines (including permission denied) | Create or fix the export folder or set `VD_EXPORT_DIR`; set `VD_ROBOTSTUDIO_EXE`; download still works |
| Corrupt saved session | Notice that the session was reset | Reopen the project from Projects (stored jobs are unaffected) |

## 7. Repository map

```
backend/
  app.js, server.js            Express app factory and loopback server
  routes/apiRoutes.js          HTTP API v2
  services/parsers/            curveParser (Feature.txt), pointListAdapter (Testing mode)
  services/kinematics/         arcFitter, pathPlanner, profiles, jointOrientation, orientationCheck, stationProfiles
  services/geometry/           workpiece model, tool envelope, exact distance primitives, clearance diagnostics
  services/compiler/           rapidCompiler, rapidPrecheck
  services/jobs/               jobStore (filesystem), jobService (pipeline, gates, evidence packages)
  services/packages/           evidencePackage, zipWriter
  services/ingest/             watchFolder
  services/robotstudio/        exportWriter, launcher
  services/security/           requestGuard (Host/Origin/CSRF, rate limits)
  services/calibration/        rspagReader (archive facts), opencvYaml, calibrationInspector, rigidTransform
  test/                        node:test suites
frontend/
  src/app/                     pages (dashboard route group), layouts, error/loading boundaries
  src/components/              session context, navigation, panels, orientation, calibration import, 3D scene
  src/lib/                     pure logic: stages, session, playback, projection, view transform, orientation check, joint input, workpiece input, clearance view, usability log
  src/services/apiClient.js    API client (CSRF token, normalised errors)
  public/stations/             archived calibration station (contains licence/backup files; do not redistribute)
  test/                        node:test suites + fixtures generated from the backend
scripts/
  verify-evidence-package.mjs  independent package verifier
samples/                       demo seam descriptors (default watch folder)
```

## 8. Limitations

- Motion only; no welding process data or I/O.
- No reachability, IK, configuration, singularity, joint-limit or robot/cell collision analysis. Workpiece clearance
  diagnostics cover only declared, idealised plates and the assessed motion portions; they are not a collision check.
- Joint-relative orientation is experimental, straight seams and idealised 90° fillets only, and depends on declared
  joint and tool conventions; the real station's convention is unresolved. Curved joint-relative planning is not
  implemented.
- Calibration files are inspected, never applied; no calibration is captured or solved.
- Browser preview interpolation does not reproduce MoveJ joint motion (MoveJ is drawn as a schematic connector and not
  animated), zone blending or controller orientation interpolation; the 12 s duration is not a cycle time.
- Watched folder is polled only while the Acquire page is open.
- RobotStudio launch only starts a process; importing the module was not verified from the command line.
- No generated module has been validated in RobotStudio or on hardware as part of this software work.
- Single local operator; no authentication; not for network deployment.

Developed by the VertexDynamics software team as part of the RMIT University Engineering Capstone (2026).
