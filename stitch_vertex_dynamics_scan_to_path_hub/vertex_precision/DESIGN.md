---
name: Vertex Precision
colors:
  surface: '#f9f9ff'
  surface-dim: '#d8d9e3'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3fd'
  surface-container: '#ecedf7'
  surface-container-high: '#e6e8f2'
  surface-container-highest: '#e0e2ec'
  on-surface: '#191c23'
  on-surface-variant: '#414754'
  inverse-surface: '#2d3038'
  inverse-on-surface: '#eff0fa'
  outline: '#727785'
  outline-variant: '#c1c6d6'
  surface-tint: '#005bc0'
  primary: '#005bbf'
  on-primary: '#ffffff'
  primary-container: '#1a73e8'
  on-primary-container: '#ffffff'
  inverse-primary: '#adc7ff'
  secondary: '#5e5e62'
  on-secondary: '#ffffff'
  secondary-container: '#e3e2e6'
  on-secondary-container: '#646468'
  tertiary: '#9e4300'
  on-tertiary: '#ffffff'
  tertiary-container: '#c55500'
  on-tertiary-container: '#0e0200'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc7ff'
  on-primary-fixed: '#001a41'
  on-primary-fixed-variant: '#004493'
  secondary-fixed: '#e3e2e6'
  secondary-fixed-dim: '#c7c6ca'
  on-secondary-fixed: '#1a1b1e'
  on-secondary-fixed-variant: '#46474a'
  tertiary-fixed: '#ffdbcb'
  tertiary-fixed-dim: '#ffb691'
  on-tertiary-fixed: '#341100'
  on-tertiary-fixed-variant: '#783100'
  background: '#f9f9ff'
  on-background: '#191c23'
  surface-variant: '#e0e2ec'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 24px
  max-content-width: 1600px
---

## Brand & Style

This design system is engineered for industrial precision and operational clarity. It targets a technical demographic of automation engineers and plant managers who require high data density without cognitive fatigue. 

The design style is **Corporate / Modern** with a strong emphasis on **Precision Minimalism**. It leverages a "high-tech utility" aesthetic—clean, structured, and unapologetically functional. The interface prioritizes clarity through generous whitespace within data-heavy contexts and utilizes subtle structural lines to separate complex workstreams. The emotional response is one of reliability, stability, and absolute control.

## Colors

The palette is anchored by **Industrial Blue**, a color that signifies trust and technological sophistication. 

- **Primary:** Used for high-priority actions, active states, and path indicators.
- **Surface & Background:** A clean, multi-layered approach using white surfaces on a light-gray background to create a distinct hierarchy of workspaces.
- **Typography:** Dark charcoal is used for high-readability text, ensuring contrast ratios exceed WCAG AA standards.
- **Accents:** Semantic colors (Success Green, Warning Amber, Error Red) are used sparingly to highlight machine status and API health, ensuring they stand out against the neutral base.

## Typography

**Inter** is the primary typeface, chosen for its exceptional legibility in digital interfaces and technical environments. 

- **Hierarchy:** We use a tight scale to maintain data density. Headlines use a semi-bold weight with slight negative letter spacing for a compact, professional look.
- **Labels:** Small caps or uppercase labels are used for metadata and table headers to distinguish them from actionable content.
- **Monospace:** For coordinate data, scan paths, and API logs, a monospaced font (JetBrains Mono) is introduced to ensure vertical alignment of numerical strings.

## Layout & Spacing

The layout utilizes a **12-column fluid grid** for the main dashboard area, transitioning to a fixed-width sidebar for navigation. 

- **Grid:** 16px gutters provide breathing room while maintaining high density. 
- **Modular Panels:** Content is organized into "Surfaces" (cards) that reflow based on screen size. On desktop, complex 3D viewports occupy larger column spans (8-9 columns), while telemetry sidebars occupy 3 columns.
- **Responsive:** Mobile views collapse sidebars into bottom sheets or "hamburger" menus, prioritizing the 3D scan viewport and essential "Stop/Start" controls.

## Elevation & Depth

This design system uses **Tonal Layers** combined with **Low-Contrast Outlines** to define depth.

- **Level 0 (Background):** #f8f9fa - The canvas for all elements.
- **Level 1 (Surfaces):** #ffffff - Main cards and panels. These feature a 1px border of #e0e0e0 and a very soft 4px blur shadow to indicate they are separate from the background.
- **Level 2 (Popovers/Modals):** Elevated with a more pronounced 12px blur shadow and a subtle 1px border. 
- **Interaction:** Hover states on interactive elements use a slight tonal shift (e.g., #f1f3f4) rather than a change in elevation, keeping the interface feeling "grounded" and stable.

## Shapes

The shape language is **Soft (0.25rem)**. This subtle rounding removes the harshness of a purely industrial tool while maintaining a professional, engineered feel. 

- **Elements:** Buttons, input fields, and status badges use the standard 0.25rem radius.
- **Containers:** Larger dashboard panels use `rounded-lg` (0.5rem) to soften the overall layout.
- **Data Points:** In graphs and path visualizations, use sharp or very small 2px radii to emphasize precision.

## Components

- **Buttons:** Primary buttons are solid Industrial Blue. Secondary buttons are outlined with #e0e0e0 borders. Icons should be used within buttons to speed up recognition of technical tasks (e.g., "Scan," "Export").
- **Status Chips:** Small, pill-shaped indicators. Use a light background tint of the status color with high-contrast text (e.g., Light green background with dark green text for "Active").
- **Data Tables:** Highly condensed with 8px vertical padding. Use "Zebra striping" sparingly; instead, use 1px horizontal dividers.
- **Input Fields:** Clear, bordered fields with 12px horizontal padding. Focus states use a 2px Industrial Blue outline.
- **Path Cards:** Specialized components showing 3D scan metadata. They should include a thumbnail of the point cloud, path length, and a "Run" action button.
- **Monitors:** Large, bold numerical displays for real-time telemetry, using a medium weight and slightly larger font size to be readable from a distance in a factory setting.