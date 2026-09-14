"use client";

import UnavailableFeature from "@/components/UnavailableFeature";

export default function PreviewPage() {
  return (
    <UnavailableFeature
      title="Inverse kinematics, reachability and singularity preview"
      summary="This page previously showed fixed pass results for inverse-kinematics and singularity checks, and fixed point-count and distance figures, as static text. No robot model, inverse-kinematics solver or singularity analysis exists in this application, so those results were removed."
      reasons={[
        "No kinematic model (joint limits, link geometry) of the target robot is included.",
        "Robot configuration is emitted as a fixed value, not solved.",
        "No collision geometry of robot, tool, fixture or workpiece is available.",
      ]}
      prerequisites={[
        "The exact robot variant, tool and load data, work object and joint limits.",
        "A validated IK/reachability solver compared against the target RobotWare controller.",
        "Until then, validate reachability, configuration and singularities in RobotStudio (see the export checklist).",
      ]}
    />
  );
}
