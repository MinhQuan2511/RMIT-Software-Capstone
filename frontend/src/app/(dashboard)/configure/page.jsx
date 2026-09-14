"use client";

import UnavailableFeature from "@/components/UnavailableFeature";

export default function ConfigurePage() {
  return (
    <UnavailableFeature
      title="Weld process parameters"
      summary="This page previously showed weld speed, laser power, shield gas and smoothing inputs whose Apply button only displayed a message; none of the values reached planning or the module. The supported motion parameters (tool and work-object names, clearance offsets, speeds, zones, near-straight arc handling) are edited on Parse & Map and create a new job revision."
      reasons={[
        "The generated module is motion-only; no welding process instructions are emitted.",
        "Laser power does not apply to the GMAW torch used in this project.",
        "Point-cloud smoothing does not apply: the application imports already-extracted seam descriptors.",
      ]}
      prerequisites={[
        "Confirmed ArcWare options and validated process data (welddata, seamdata) for the target controller.",
        "I/O, tool and load definitions reviewed by a qualified welding/robot engineer.",
        "A controlled commissioning procedure and explicit authorisation before any process instruction is generated.",
      ]}
    />
  );
}
