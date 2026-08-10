import { NextResponse } from "next/server";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// Candidate installation paths for ABB RobotStudio executable on Windows OS
const ROBOTSTUDIO_PATHS = [
  `C:\\Program Files (x86)\\ABB\\RobotStudio 2025\\Bin\\RobotStudio.exe`,
  `C:\\Program Files (x86)\\ABB\\RobotStudio 2026\\Bin\\RobotStudio.exe`,
  `C:\\Program Files\\ABB\\RobotStudio 2025\\Bin\\RobotStudio.exe`,
  `C:\\Program Files\\ABB\\RobotStudio 2024\\Bin\\RobotStudio.exe`,
  `C:\\Program Files (x86)\\ABB\\RobotStudio\\Bin\\RobotStudio.exe`,
];

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { code, fileName } = body;

    // 1. Persist compiled RAPID module file directly to host Downloads directory
    let fileToOpen = "";
    if (code) {
      const targetDir = path.join(os.homedir(), "Downloads");
      const targetPath = path.join(targetDir, fileName || "WeldModule.mod");
      fs.writeFileSync(targetPath, code, "utf-8");
      fileToOpen = `"${targetPath}"`;
    }

    // 2. Scan host file system for installed RobotStudio executable
    let exePath = ROBOTSTUDIO_PATHS.find((p) => fs.existsSync(p));

    if (exePath) {
      const command = fileToOpen ? `"${exePath}" ${fileToOpen}` : `"${exePath}"`;
      exec(command, (err) => {
        if (err) console.error("Failed to spawn RobotStudio executable:", err);
      });

      return NextResponse.json({
        success: true,
        launched: true,
        exePath,
        message: "RobotStudio launched successfully.",
      });
    }

    // 3. Fallback: Application binary not found on local host PC -> Trigger UI download modal
    return NextResponse.json({
      success: true,
      launched: false,
      message: "RobotStudio executable not detected on this host machine.",
    });
  } catch (error) {
    console.error("Launch RobotStudio API handler error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}