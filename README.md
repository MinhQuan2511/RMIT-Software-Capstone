# Vertex Dynamics: Scan-to-Path Hub

RMIT University Software Engineering Capstone Project, 2026.

A modular, full-stack web application that bridges 3D vision scanning with industrial ABB robotic arm path generation. The system takes scanned point cloud data from TracerStudio (via REST API, live TCP socket, or manual file upload), processes it through a kinematic pipeline, and compiles executable ABB RAPID code for welding trajectories.

Built with Next.js 16 on the frontend, Express on the backend, and Three.js for realtime 3D simulation.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Running the Application](#running-the-application)
- [Project Structure](#project-structure)
- [How the Application Works](#how-the-application-works)
  - [Authentication and Sign-In](#authentication-and-sign-in)
  - [Integration Modes](#integration-modes)
  - [TracerStudio API Workflow](#tracerstudio-api-workflow)
  - [TracerStudio TCP Workflow](#tracerstudio-tcp-workflow)
  - [Testing Workflow](#testing-workflow)
- [Backend API Reference](#backend-api-reference)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

You need **Node.js** installed on your machine. Any of these versions will work:

- Node.js v18.x
- Node.js v20.x
- Node.js v22.x

Download it from [https://nodejs.org/](https://nodejs.org/) if you don't have it. You can verify your installation by running:

```bash
node --version
npm --version
```

Both commands should print a version number without errors.

---

## Installation

1. Clone the repository:

```bash
git clone https://github.com/MinhQuan2511/RMIT-Software-Capstone.git
cd RMIT-Software-Capstone
```

2. Install all dependencies (root, backend, and frontend) in one command:

```bash
npm run setup
```

This runs `npm install` at the root level, then separately installs packages inside `backend/` and `frontend/`. It will pull down everything the project needs — Express, Next.js, Axios, Three.js, Tailwind CSS, mathjs, multer, and so on.

If `npm run setup` doesn't work for some reason, you can install each part manually:

```bash
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

---

## Running the Application

The project is set up as a monorepo. A single command starts both the backend and frontend at the same time:

```bash
npm run dev
```

This runs `run-all.js`, which does the following:

1. Clears any processes already occupying ports 3000, 5000, and 7001 (Windows only — it uses `netstat` and `taskkill` under the hood).
2. Starts the **Express backend** on `http://localhost:5000` with `node --watch` for auto-reloading.
3. Starts the **Next.js frontend** on `http://localhost:3000`.

Once both servers are up, open your browser and go to:

```
http://localhost:3000
```

You should see the welcome landing page.

If you want to start only one part:

```bash
# Backend only (port 5000)
npm run backend

# Frontend only (port 3000)
npm run frontend
```

To stop everything, press `Ctrl+C` in the terminal. The cleanup handler will kill the child processes and free the ports.

---

## Project Structure

```
RMIT-Software-Capstone/
├── backend/                         # Express server
│   ├── server.js                    # Main entry point — HTTP on port 5000, TCP bridge on port 7001
│   ├── routes/
│   │   └── apiRoutes.js             # All REST endpoints (ingest-files, process-pipeline, rapid-code, launch-robotstudio)
│   ├── services/
│   │   ├── compiler/
│   │   │   └── rapidCompiler.js     # ABB RAPID code compilation logic
│   │   ├── kinematics/
│   │   │   ├── matrixTransform.js   # 4x4 homogeneous matrix transformations (camera-to-robot frame)
│   │   │   ├── pathPlanner.js       # Trajectory planning with approach/retract waypoints
│   │   │   └── quaternionMath.js    # Quaternion computation for tool orientation
│   │   ├── network/
│   │   │   └── tcpBridge.js         # TCP socket bridge server for live TracerStudio connections
│   │   └── parsers/
│   │       ├── configParser.js      # Configuration file parsing
│   │       ├── curveParser.js       # 3D curve coordinate extraction from text files
│   │       ├── depthParser.js       # Depth data parsing
│   │       └── yamlParser.js        # YAML hand-eye calibration matrix parsing
│   └── uploads/                     # Staging directory for uploaded scan files (gitignored)
│
├── frontend/                        # Next.js 16 application
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.js              # Welcome/landing page
│   │   │   ├── layout.js            # Root layout — loads fonts, wraps providers
│   │   │   ├── globals.css          # Global styles and Tailwind directives
│   │   │   ├── login/
│   │   │   │   └── page.jsx         # Authentication page (role-based: Operator / Engineer)
│   │   │   ├── api/
│   │   │   │   └── launch-robotstudio/  # Next.js server-side route for launching RobotStudio desktop app
│   │   │   └── (dashboard)/         # Route group for all authenticated pages
│   │   │       ├── layout.jsx       # Dashboard shell — sidebar + main content area
│   │   │       ├── projects/        # Step 1: Workspace / project selection
│   │   │       ├── calibrate/       # API mode: Hand-eye calibration wizard
│   │   │       ├── configure/       # API mode: Weld parameter configuration
│   │   │       ├── preview/         # API mode: Trajectory & IK preview
│   │   │       ├── bridge-setup/    # TCP mode: TCP socket bridge configuration
│   │   │       ├── connect/         # TCP mode: Connection testing & handshake
│   │   │       ├── acquire/         # TCP mode: Data acquisition (live or file import)
│   │   │       ├── parse-map/       # TCP mode: Parse and map point cloud data
│   │   │       ├── testing-upload/  # Testing mode: Upload CSV/Excel coordinate files
│   │   │       ├── testing-preview/ # Testing mode: Preview parsed paths
│   │   │       ├── generate/        # Shared: RAPID code compiler + 3D welding simulation
│   │   │       └── export/          # Shared: Export .mod file + RobotStudio sync
│   │   ├── components/
│   │   │   ├── AuthContext.jsx          # Authentication state management
│   │   │   ├── IntegrationModeContext.jsx  # Tracks which workflow mode is active (api/tcp/testing)
│   │   │   ├── IntegrationModeSwitch.jsx   # UI toggle for switching modes
│   │   │   ├── TcpWorkflowContext.jsx      # State for the TCP workflow pipeline
│   │   │   ├── TestingWorkflowContext.jsx  # State for the testing workflow pipeline
│   │   │   ├── ToastContext.jsx         # Toast notification provider
│   │   │   ├── ToastNotification.jsx    # Toast UI component
│   │   │   ├── Navbar.jsx               # Top navigation bar (shown when authenticated)
│   │   │   ├── Sidebar.jsx              # Left sidebar navigation (step-based, changes per mode)
│   │   │   ├── StepperProgress.jsx      # Horizontal stepper showing workflow progress
│   │   │   ├── Active3DViewport.jsx     # Reusable 3D viewport container with controls
│   │   │   └── RAPIDCodeEditor.jsx      # Syntax-highlighted RAPID code display panel
│   │   ├── services/
│   │   │   ├── axiosClient.js           # Axios instance pointing at the Express backend (port 5000)
│   │   │   ├── tracerStudioApi.js       # Frontend API calls for the API workflow
│   │   │   ├── tracerStudioTcpBridge.js # Frontend helpers for the TCP workflow
│   │   │   ├── robotStudioApi.js        # Frontend calls for RobotStudio integration
│   │   │   └── csvToRapid.js            # Client-side CSV-to-RAPID code converter (testing mode)
│   │   └── config/
│   │       └── workflows.js             # Workflow step definitions for all three modes
│   ├── tailwind.config.js           # Tailwind theme with custom design tokens
│   └── next.config.mjs              # Next.js configuration
│
├── run-all.js                       # Monorepo launcher script — starts both backend and frontend
└── package.json                     # Root package with setup/dev/backend/frontend scripts
```

---

## How the Application Works

### Authentication and Sign-In

When you first open `http://localhost:3000`, you land on the welcome page. Click **"Enter Control System"** to go to the login screen.

The login page has two roles you can sign in as:

**Standard Operator**
- Operator ID: any non-empty value works (example: `OP-7724`)
- Security PIN: any non-empty value works (example: `1234`)

**System Engineer**
- Engineer Email: any non-empty value works (example: `engineer@vertex.com`)
- System Password: any non-empty value works (example: `password`)

This is mock authentication — any non-empty credentials will let you in. The role selection itself (Operator vs Engineer) is stored but does not restrict functionality in this prototype. After signing in, you are redirected to the Projects (Workspace) page.

To log out, click the user icon area in the top-right corner of the navbar.

---

### Integration Modes

Once logged in, you can switch between three integration modes using the mode switcher in the navbar. Each mode presents a different set of steps in the sidebar, because each one represents a different way of getting scan data into the system.

The three modes are:

1. **TracerStudio: API** — Simulates integration through TracerStudio's REST API. This is the traditional workflow: calibrate, configure parameters, preview the path, then generate code.

2. **TracerStudio: TCP** — Uses a live TCP socket bridge to stream data from TracerStudio or RobotStudio. You configure the bridge endpoint, establish a connection, acquire data (either via live stream or file import), then parse and map it before generating code.

3. **Testing** — A simplified path for quick testing. Upload a CSV or Excel file containing XYZ coordinates, preview the parsed path, and jump straight to code generation.

All three modes share the same **Generate** and **Export & Run** steps at the end.

---

### TracerStudio API Workflow

This is the 6-step flow you get in API mode:

**Step 1 — Project (Workspace)**
Select an existing project or create a new one. The page shows project cards with thumbnails and status. Clicking any card or the "Create New" button moves you forward. This also resets any previous workflow session data.

**Step 2 — Calibrate**
The hand-eye calibration wizard. You configure:
- Calibration target type (ChArUco Board, Checkerboard, or Circle Grid)
- Square size in millimeters
- Tool Center Point (TCP) offset values (X, Y, Z position and Rx, Ry, Rz rotation in degrees)

Click "Generate Calibration Routine" to run the calibration. The right side of the screen shows a 3D viewport that visualizes the calibration trajectory once generated. You need to complete calibration before the "Next Step" button becomes active.

**Step 3 — Configure**
Set the welding and scanning parameters:
- Weld type (Fillet Weld, Lap Joint, Butt Weld)
- Segment ID
- Travel speed, laser power, shield gas flow, travel angle
- Gaussian filter size and step resolution for point cloud smoothing

Click "Apply Parameter Configurations" to save. The viewport on the right visualizes the weld seam path with start and end points. You can then navigate forward to Preview.

**Step 4 — Preview**
Shows trajectory metrics in the left panel:
- Total points count
- Total path distance
- IK (Inverse Kinematics) solver check result
- Singularity check result

Toggle options let you turn on/off laser profile visualization and tool normal orientation vectors in the 3D viewport. The viewport renders the point cloud path with interactive controls.

**Step 5 — Generate**
This is where the RAPID code gets compiled. The left panel shows a syntax-highlighted ABB RAPID code editor displaying the compiled module. The code is fetched from the Express backend's `/api/rapid-code` endpoint.

The right panel is a full 3D simulation environment built with Three.js. It renders:
- An industrial welding torch (orange with a brass tip)
- Weld seam geometry (blue cylinder for unwelded, white cylinder that grows as welding progresses)
- Waypoint markers (green for weld start, red for weld end, grey for approach/retract)
- Dashed lines for air motion paths

Use the play/pause button at the bottom to run the 12-second welding simulation. You can orbit, zoom, and pan the 3D view with your mouse.

**Step 6 — Export & Run**
The final step. Here you can:
1. Download the compiled `.mod` file to your machine
2. Copy the RAPID code to your clipboard
3. Attempt to launch ABB RobotStudio on your PC (it searches for the executable at common installation paths)

If RobotStudio is not installed, a dialog appears with a link to download it from ABB's website.

The deployment checklist in the left panel walks you through the manual steps: download the file, open RobotStudio's Program Editor, paste the module, and execute `PROC main()`.

The 3D viewport on the right side also has its own playback controls so you can preview the trajectory one more time before exporting.

---

### TracerStudio TCP Workflow

This is the 7-step flow for TCP socket integration:

**Step 1 — Project**
Same as API mode. Select or create a project.

**Step 2 — Bridge Setup**
When you enter this step for the first time, a modal asks you to choose between two data ingestion approaches:

- **Live TCP Socket Stream** — Keeps you on the full TCP path (Steps 2, 3, 4, 5, 6, 7). You configure the socket endpoint below.
- **File / Manual Import** — Bypasses the Connect step entirely and routes you directly to Acquire (Step 4). Use this when you already have scan output files on disk.

If you choose the TCP path, configure the bridge endpoint:
- Host / IP address (default: `127.0.0.1`)
- Port (default: `7001` — matches the backend's TCP bridge server)
- Transport protocol (TCP String, TCP Raw Data, or Modbus TCP)
- Timeout, auto-reconnect, protocol preset, message delimiter, encoding, heartbeat interval
- Session routing options (TracerStudio mode, auto-launch, session folder, diagnostic logs)

Click "Save Bridge Configuration" to store settings and move to Connect.

**Step 3 — Connect**
This page validates the TCP bridge connection. The left panel shows:
- Live connection status for the bridge endpoint, TracerStudio service, RobotStudio session, and heartbeat
- Session ID
- Handshake & test action buttons: Ping Endpoint, Start/Stop Service, Test Request (command 011), Capabilities query, Clear Session
- A session event log that records every action with timestamps
- A response inspector showing the last response code, protocol, round-trip time, and status

The right viewport shows a network topology diagram of the architecture: RobotStudio Add-in, TCP Bridge, and TracerStudio nodes with live status indicators and a packet console.

Click "Confirm Connection & Continue" to lock in the connection and move to Acquire.

(If you selected File/Manual Import at Step 2, you skip this page entirely — the route guard automatically redirects you to Acquire.)

**Step 4 — Acquire**
Data acquisition step. If you came from a live TCP connection, this page receives point cloud data from the stream. If you chose file import, you can upload scan files directly (`.txt` feature files and `.yaml` hand-eye calibration matrices).

**Step 5 — Parse & Map**
Parses the acquired data and maps camera-frame coordinates to robot-frame coordinates using the 4x4 hand-eye calibration matrix. The backend services handle the actual math — `matrixTransform.js` applies the homogeneous transformation, and `quaternionMath.js` computes the tool orientation quaternions.

**Step 6 — Generate**
Same as API mode Step 5. Compiles RAPID code and provides the 3D welding simulation.

**Step 7 — Export & Run**
Same as API mode Step 6. Download, copy, and optionally launch RobotStudio.

---

### Testing Workflow

A shorter 4-step flow for quick validation:

**Step 1 — Upload**
Upload a CSV or Excel file containing 3D coordinates. The file should have columns for X, Y, Z values. The `csvToRapid.js` service on the frontend parses the data and converts it to RAPID robtargets client-side, without needing the Express backend.

**Step 2 — Preview Path**
Visualize the uploaded path data before generating code.

**Step 3 — Generate**
Compiles RAPID code from the uploaded coordinates. In testing mode, the code is generated entirely on the frontend using `csvToRapid.js`. The 3D simulation viewport is the same as the other modes.

**Step 4 — Export & Run**
Same export functionality. The output file is named `Module1.mod` instead of `WeldModule.mod` when in testing mode.

---

## Backend API Reference

The Express backend runs on port 5000 and exposes these endpoints under `/api`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Health check. Returns service status, version, available endpoints, and TCP bridge port. |
| POST | `/api/ingest-files` | Upload scan files (multipart form data). Files are saved to `backend/uploads/`. |
| GET | `/api/ingest-files` | Returns a list of files currently in the uploads staging directory. |
| POST | `/api/process-pipeline` | Runs the full processing pipeline: finds the latest `.txt` feature file and `.yaml` calibration matrix, transforms camera points to robot frame, plans the trajectory, computes quaternions, and generates RAPID code. |
| GET | `/api/process-pipeline` | Same as POST — runs the pipeline and returns results. |
| GET | `/api/rapid-code` | Returns the most recently compiled RAPID code. If no code exists on disk, triggers the pipeline first. |
| POST | `/api/launch-robotstudio` | Accepts `{ code, fileName }` in the body. Writes the RAPID code to a `.mod` file and attempts to launch ABB RobotStudio with it. |

The backend also starts a **TCP socket bridge server** on port 7001 (configurable via `TCP_PORT` env var). This is what the frontend's TCP workflow connects to.

---

## Environment Variables

The project works out of the box without any `.env` file. If you need to customize ports or the API URL, create a `.env` file in the `backend/` directory:

```
PORT=5000
TCP_PORT=7001
```

For the frontend, the Axios client reads `NEXT_PUBLIC_API_URL`. If not set, it defaults to `http://localhost:5000/api`. To override, create a `.env.local` file in the `frontend/` directory:

```
NEXT_PUBLIC_API_URL=http://localhost:5000/api
```

---

## Troubleshooting

**Port already in use**
The `run-all.js` script tries to automatically free ports 3000, 5000, and 7001 on Windows before starting. If you still get port conflicts, manually kill the processes:

```bash
# Windows
netstat -ano | findstr :3000
taskkill /pid <PID> /F

# macOS / Linux
lsof -i :3000
kill -9 <PID>
```

**Backend can't find uploaded files**
Files are uploaded to `backend/uploads/`. This directory is created automatically when the backend starts. If it doesn't exist, the backend creates it on first request. The directory is gitignored, so it won't appear in a fresh clone until the server runs.

**"Cannot find module" errors**
Run `npm run setup` again from the root directory. This reinstalls dependencies for all three package.json files (root, backend, frontend).

**Frontend shows "Fetching backend RAPID code..."**
This means the frontend is trying to reach the Express backend at `http://localhost:5000/api/rapid-code` and hasn't gotten a response yet. Make sure the backend is running. If you started only the frontend with `npm run frontend`, start the backend too with `npm run backend` in a separate terminal, or use `npm run dev` to start both.

**3D viewport is blank or not rendering**
The Generate and Export pages use Three.js with WebGL. Make sure you're using a browser that supports WebGL (Chrome, Firefox, Edge all work). Hardware acceleration should be enabled in your browser settings.

**RobotStudio not launching**
The backend searches for the RobotStudio executable at standard ABB installation paths. If it's installed in a custom location, the auto-launch will fail, but your RAPID code is still saved and copied to clipboard. You can open RobotStudio manually and paste the code in.
