"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTcpWorkflow } from "@/components/TcpWorkflowContext";

export default function ProjectsPage() {
  const router = useRouter();
  const { resetWorkflowSession } = useTcpWorkflow();

  // Reset workflow session as soon as user enters Workspace (Step 1)
  useEffect(() => {
    resetWorkflowSession();
  }, [resetWorkflowSession]);

  const handleSelectProject = () => {
    resetWorkflowSession();
    router.push("/bridge-setup");
  };

  return (
    <main className="flex-1 bg-background overflow-y-auto p-margin-desktop w-full h-full">
      <div className="max-w-[1600px] mx-auto w-full">
        {/* Header Title */}
        <header className="mb-8 flex justify-between items-end select-none">
          <div>
            <h1 className="text-3xl font-extrabold text-on-surface mb-2 tracking-tight">Workspace</h1>
            <p className="text-base text-on-surface-variant font-medium">
              Select an active project to continue or create a new scan configuration.
            </p>
          </div>
        </header>

        {/* Project Grid Layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-gutter">
          {/* Create New Action Card */}
          <button
            type="button"
            onClick={handleSelectProject}
            className="flex flex-col items-center justify-center min-h-[280px] bg-surface-container-lowest border-2 border-dashed border-outline hover:border-primary hover:bg-surface-container-low transition-all duration-200 rounded-xl group p-6 cursor-pointer text-left w-full"
          >
            <div className="w-16 h-16 rounded-full bg-primary-fixed flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <span className="material-symbols-outlined text-on-primary-fixed text-3xl">add</span>
            </div>
            <span className="text-lg text-on-surface font-extrabold tracking-tight">
              Create New Scan Project
            </span>
            <span className="text-sm text-on-surface-variant mt-2 text-center max-w-[85%] font-medium">
              Start a new workflow from a fresh scan or imported point cloud data.
            </span>
          </button>

          {/* Project Card 1: Part_A_Fillet_Weld */}
          <button
            type="button"
            onClick={handleSelectProject}
            className="flex flex-col bg-surface-container-lowest border border-outline-variant shadow-sm hover:shadow-md transition-shadow rounded-xl overflow-hidden cursor-pointer group text-left w-full"
          >
            <div 
              className="h-48 w-full relative bg-surface-container-high overflow-hidden" 
              style={{
                backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuAA6JmPnfOlEYR3Ha604Ac5N0ItXcPxazqiTt2jzHTbsYlAOZBUkTpW7-GOWNOZ5K9lXZYiwjMOo_dFyTfvQGATWjavgsgleM68Wsv_SKz_E-Lx6Fa_iI2FDv___nfMk0a-5p49QZ8UE1kKVzNYD8SsdjlgoBJr7gPeuI0ej9VXRR4qbtyQVYbZ1kOud6vD5wmEFWllsLr2KYbBf_3yiFHkDbYPcrOJbWggtOFye7cOzefSWlDvBtdtJsndL6HBxRbZZDdwfF8kESo')",
                backgroundSize: "cover",
                backgroundPosition: "center"
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"></div>
              <div className="absolute top-3 right-3 bg-surface text-on-surface px-2.5 py-1 rounded-DEFAULT text-xs font-bold flex items-center gap-1.5 shadow-sm">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 block"></span>
                <span>Ready</span>
              </div>
            </div>
            <div className="p-5 flex-1 flex flex-col justify-between w-full">
              <div>
                <h3 className="text-lg text-on-surface font-extrabold mb-1 group-hover:text-primary transition-colors tracking-tight">
                  Part_A_Fillet_Weld
                </h3>
                <p className="font-mono text-xs text-on-surface-variant flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px] text-primary">folder</span>
                  <span>/project/robotic_cell_1/</span>
                </p>
              </div>
              <div className="mt-6 flex justify-between items-center pt-4 border-t border-outline-variant select-none">
                <span className="text-xs text-on-surface-variant font-semibold">Modified: Today, 10:42 AM</span>
                <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-on-primary transition-colors">
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </div>
              </div>
            </div>
          </button>

          {/* Project Card 2: Bracket_B_Lap_Joint */}
          <button
            type="button"
            onClick={handleSelectProject}
            className="flex flex-col bg-surface-container-lowest border border-outline-variant shadow-sm hover:shadow-md transition-shadow rounded-xl overflow-hidden cursor-pointer group text-left w-full"
          >
            <div 
              className="h-48 w-full relative bg-surface-container-high overflow-hidden" 
              style={{
                backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuCMKIJZXUbYnty4g1bPA9LVSREF3xOd9fifXZ-MYHWcQjzlT0Lqw1Wy8cKXK6xi6UZp1yFnH_QcVisFORiFk1t_Ea4VCIjrfIpJKovUZTW4YaWAgAocbMeap-thfkrOYKrCZrbdivSyoEoCC6v-9Pqn-UWwrpfs2LtfaoxOkGTL21-WFf4hFMc_g60A4aQELwfxfc4vq8RjNDaQh4l_27w4HDniWbX0-kq_m7DSk9ovto32_6_M8GbnP7v2PnEhg6T95vHls876QSg')",
                backgroundSize: "cover",
                backgroundPosition: "center"
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"></div>
              <div className="absolute top-3 right-3 bg-surface text-on-surface px-2.5 py-1 rounded-DEFAULT text-xs font-bold flex items-center gap-1.5 shadow-sm">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 block"></span>
                <span>Draft</span>
              </div>
            </div>
            <div className="p-5 flex-1 flex flex-col justify-between w-full">
              <div>
                <h3 className="text-lg text-on-surface font-extrabold mb-1 group-hover:text-primary transition-colors tracking-tight">
                  Bracket_B_Lap_Joint
                </h3>
                <p className="font-mono text-xs text-on-surface-variant flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px] text-primary">folder</span>
                  <span>/project/assembly_line_3/</span>
                </p>
              </div>
              <div className="mt-6 flex justify-between items-center pt-4 border-t border-outline-variant select-none">
                <span className="text-xs text-on-surface-variant font-semibold">Modified: Oct 24, 2:15 PM</span>
                <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-on-primary transition-colors">
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </div>
              </div>
            </div>
          </button>
        </div>
      </div>
    </main>
  );
}