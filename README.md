# Vertex Dynamics: Scan-to-Path Hub
## RMIT University Software Capstone Project 2026

Next-Generation 3D Vision & Industrial Robot Integration. This is a modular, component-driven React & Next.js prototype designed to simulate scanning, parameter configuration, path previewing, and RAPID code generation for ABB robotic arms.

---

## 🚀 Getting Started

Follow these steps to run the application locally on your machine.

### Prerequisites
Make sure you have **Node.js** installed:
*   [Node.js (v18.x or v20.x or v22.x recommended)](https://nodejs.org/)

### 📦 Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/MinhQuan2511/RMIT-Software-Capstone.git
    cd RMIT-Software-Capstone
    ```

2.  **Install the dependencies:**
    ```bash
    npm install
    ```
    *(This downloads Axios, Tailwind, Next.js, and other required modules automatically).*

### 💻 Development Server

1.  **Start the local development server:**
    ```bash
    npm run dev
    ```

2.  **Open the application:**
    Open your browser and navigate to [http://localhost:3000](http://localhost:3000).

---

## 🛠️ Project Layout & Workflow Steps

The repository follows a clean, component-driven directory layout in `/src`:

*   `/src/components` — Contexts (`AuthContext`, `ToastContext`), Global `Navbar`, vertical `Sidebar` navigation, horizontal `StepperProgress`, standard `Active3DViewport` simulation screen, and the `RAPIDCodeEditor`.
*   `/src/services` — Service layer containing an `axiosClient` configured to interact with simulated API endpoints (`tracerStudioApi`, `robotStudioApi`).
*   `/src/app` — File-based route paths (`/`, `/login`, `/projects`, `/calibrate`, `/configure`, `/preview`, `/generate`, `/export`).
*   `tailwind.config.js` — Centrally managed theme styling rules.

---

## 🔐 Mock Credentials (For Local Sign-In)

Any non-empty inputs will bypass mock authentication. You can sign in using:
*   **Role**: Standard Operator
    *   **Operator ID**: `OP-7724`
    *   **Security PIN**: `1234`
*   **Role**: System Engineer
    *   **Engineer Email**: `engineer@vertex.com`
    *   **System Password**: `password`
