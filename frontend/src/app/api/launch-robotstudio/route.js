import { NextResponse } from "next/server";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const ROBOTSTUDIO_PATHS = [
  `C:\\Program Files (x86)\\ABB\\RobotStudio 2025\\Bin\\RobotStudio.exe`,
  `C:\\Program Files (x86)\\ABB\\RobotStudio 2026\\Bin\\RobotStudio.exe`,
  `C:\\Program Files\\ABB\\RobotStudio 2025\\Bin\\RobotStudio.exe`,
  `C:\\Program Files (x86)\\ABB\\RobotStudio\\Bin\\RobotStudio.exe`,
];

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { code, fileName } = body;

    // Find valid installed executable path
    let exePath = ROBOTSTUDIO_PATHS.find((p) => fs.existsSync(p));

    let fileToOpen = "";
    if (code) {
      const targetDir = path.join(os.homedir(), "Downloads");
      const targetPath = path.join(targetDir, fileName || "Module1.mod");
      fs.writeFileSync(targetPath, code, "utf-8");
      fileToOpen = `"${targetPath}"`;
    }

    if (exePath) {
      const command = fileToOpen ? `"${exePath}" ${fileToOpen}` : `"${exePath}"`;
      exec(command, (err) => {
        if (err) console.error("Failed to spawn RobotStudio:", err);
      });
      return NextResponse.json({
        success: true,
        launched: true,
        exePath,
        message: "RobotStudio 2025 launched successfully.",
      });
    }

    // Fallback: try Windows 'start' command for RobotStudio
    exec(`start "" "RobotStudio" ${fileToOpen}`, (err) => {
      if (err) console.error("Fallback start failed:", err);
    });

    return NextResponse.json({
      success: true,
      launched: true,
      message: "Attempted to launch RobotStudio via system command.",
    });
  } catch (error) {
    console.error("Launch RobotStudio error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
