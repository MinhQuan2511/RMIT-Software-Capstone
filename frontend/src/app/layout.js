import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "material-symbols/outlined.css";
import "./globals.css";
import { ToastProvider } from "@/components/ToastContext";
import { WorkflowSessionProvider } from "@/components/WorkflowSessionContext";
import Navbar from "@/components/Navbar";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Vertex Dynamics: Scan-to-Path Hub",
  description:
    "Local single-operator tool: seam descriptor import, validation, and candidate motion-only ABB RAPID generation for manual RobotStudio validation. RMIT University Capstone 2026.",
};

// Fonts and icons are bundled from npm packages and served locally, so the
// interface works without internet access.
export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="bg-background text-on-background antialiased overflow-hidden h-screen w-screen flex flex-col" suppressHydrationWarning>
        <WorkflowSessionProvider>
          <ToastProvider>
            <Navbar />
            <div className="flex-1 flex overflow-hidden w-full h-full relative">{children}</div>
          </ToastProvider>
        </WorkflowSessionProvider>
      </body>
    </html>
  );
}
