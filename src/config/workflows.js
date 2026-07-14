/**
 * Centralized workflow configuration for Vertex Dynamics Scan-to-Path Hub.
 *
 * Each workflow defines the steps, their labels, routes, icons, and metadata.
 * The Sidebar and StepperProgress components derive their display from this config.
 */

export const WORKFLOWS = {
  api: {
    label: "TracerStudio: API",
    steps: [
      {
        path: "/projects",
        label: "Project",
        icon: "folder",
      },
      {
        path: "/calibrate",
        label: "Calibrate",
        icon: "tune",
      },
      {
        path: "/configure",
        label: "Configure",
        icon: "sliders",
      },
      {
        path: "/preview",
        label: "Preview",
        icon: "visibility",
      },
      {
        path: "/generate",
        label: "Generate",
        icon: "precision_manufacturing",
      },
      {
        path: "/export",
        label: "Export & Run",
        icon: "rocket_launch",
      },
    ],
  },
  tcp: {
    label: "TracerStudio: TCP",
    steps: [
      {
        path: "/projects",
        label: "Project",
        icon: "folder",
      },
      {
        path: "/bridge-setup",
        label: "Bridge Setup",
        icon: "link",
      },
      {
        path: "/connect",
        label: "Connect",
        icon: "cable",
      },
      {
        path: "/acquire",
        label: "Acquire",
        icon: "center_focus_strong",
      },
      {
        path: "/parse-map",
        label: "Parse & Map",
        icon: "schema",
      },
      {
        path: "/generate",
        label: "Generate",
        icon: "precision_manufacturing",
      },
      {
        path: "/export",
        label: "Export & Run",
        icon: "rocket_launch",
      },
    ],
  },
};

/**
 * Set of routes valid in each mode. Used for route guards.
 */
export const VALID_ROUTES = {
  api: new Set(["/projects", "/calibrate", "/configure", "/preview", "/generate", "/export"]),
  tcp: new Set(["/projects", "/bridge-setup", "/connect", "/acquire", "/parse-map", "/generate", "/export"]),
};

/**
 * Shared routes valid in both modes.
 */
export const SHARED_ROUTES = new Set(["/projects", "/generate", "/export"]);

/**
 * Get the workflow steps for a given mode.
 */
export function getWorkflowSteps(mode) {
  return WORKFLOWS[mode]?.steps || WORKFLOWS.api.steps;
}

/**
 * Get the valid routes for a given mode.
 */
export function getValidRoutes(mode) {
  return VALID_ROUTES[mode] || VALID_ROUTES.api;
}

/**
 * Get the workflow label for a given mode.
 */
export function getWorkflowLabel(mode) {
  return WORKFLOWS[mode]?.label || WORKFLOWS.api.label;
}
