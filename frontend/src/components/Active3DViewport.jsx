"use client";

import React from "react";
import { Icon } from "./StatusPanels";

/**
 * Viewport shell: title and optional badge around a visualisation. The previous
 * toolbar buttons (top/front/reset, wireframe/solid, point cloud) had no
 * effect and were removed rather than left as dead controls.
 */
export default function Active3DViewport({ title, badge = null, children }) {
  return (
    <section className="flex-1 relative flex flex-col min-w-0 bg-3d-viewport w-full h-full overflow-hidden" aria-label={title}>
      <div className="absolute inset-0 viewport-grid pointer-events-none" aria-hidden="true"></div>
      <div className="relative z-10 flex justify-between items-start gap-3 p-4">
        <div className="bg-surface/90 backdrop-blur-md border border-outline-variant rounded-lg p-2 shadow-lg flex items-center gap-3 min-w-0">
          <Icon name="view_in_ar" className="text-primary" />
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] text-on-surface-variant uppercase tracking-widest font-bold">Viewport</span>
            <span className="text-[13px] text-on-surface font-semibold truncate">{title}</span>
          </div>
        </div>
        {badge}
      </div>
      <div className="relative z-10 flex-1 w-full overflow-y-auto px-6 pb-6">{children}</div>
    </section>
  );
}
