/**
 * Motion profiles.
 *
 * A profile collects every literal that shapes the generated motion — tool and
 * work-object names, clearance offsets, speeds, zones and the fixed robot
 * configuration — so each job revision records exactly what produced it. The
 * default values reproduce the previous hard-coded template.
 *
 * The clearance offsets are a fixed geometric heuristic. They are not collision
 * checked against any robot, fixture or workpiece model.
 */

const { diagnostic } = require('../util/errors');
const { canonicalJson, sha256 } = require('../util/hash');
const { isValidIdentifier, isAllowedSpeed, isAllowedZone } = require('../validation/rapidSyntax');
const { validateJointSpec, validateAngles, LIMITS: ORIENTATION_LIMITS, TEMPLATES: JOINT_TEMPLATES, PLANNER_VERSION } = require('./jointOrientation');
const { resolveStation, listStationProfiles } = require('./stationProfiles');
const { validateWorkpieceDefinition } = require('../geometry/workpiece');
const { validateToolEnvelope } = require('../geometry/toolEnvelope');

const TRAVERSALS = ['as_measured', 'reversed'];

const CALIBRATION_ID = /^cal_[a-f0-9]{24}$/;

const FIXED_BASE_QUATERNION = Object.freeze({
  id: 'fixed-base-quaternion',
  version: 1,
  label: 'Fixed base-frame weld quaternion (legacy template)',
  description:
    'One constant weld orientation expressed in the robot base frame, rotated about the arc-plane normal ' +
    'for curved seams. The torch attitude relative to the seam therefore changes with seam direction. ' +
    'No work angle or travel angle is computed.',
  frameConvention:
    'Positions in millimetres in the robot base frame used through wobj0. Quaternions in ABB order ' +
    '[q1,q2,q3,q4] = [w,x,y,z]. Coordinates are assumed pre-calibrated; no camera transform is applied.',
  toolName: 'tWeldGun',
  wobjName: 'wobj0',
  toolDeclaration:
    'Referenced by name only. The tooldata and wobjdata must already exist on the target controller; ' +
    'this application never emits or guesses a tooldata declaration.',
  // Source constants as recorded in the previous template. WELD is not unit
  // length (|q| = 0.997434867) and is normalised by the planner at use.
  weldQuaternionSource: [0.38268343, 0.14943801, 0.88701083, -0.19826693],
  homeQuaternionSource: [0, 0.38268343, 0.92387953, 0],
  configuration: [0, 0, 0, 0],
  configurationNote:
    'Fixed [0,0,0,0] for every target. Not solved by inverse kinematics and not relaxed with ConfL/ConfJ; ' +
    'external validation in RobotStudio is required.',
  clearances: {
    approachBackoffMm: 25,
    approachLateralMm: 35,
    approachLiftMm: 45,
    retractForwardMm: 20,
    retractLateralMm: 35,
    retractLiftMm: 45,
    homeLateralMm: 60,
    homeLiftMm: 350,
  },
  motion: {
    home: { speed: 'v100', zone: 'z100' },
    approach: { speed: 'v60', zone: 'z10' },
    weldStart: { speed: 'v100', zone: 'fine' },
    weld: { speed: 'v100', zone: 'fine' },
    retract: { speed: 'v80', zone: 'z10' },
    returnHome: { speed: 'v100', zone: 'fine' },
  },
  nearStraightArcPolicy: 'reject',
  geometryLimits: {
    minSeamLengthMm: 1,
    maxSlopeDeg: 75,
    maxArcRadiusMm: 5000,
    maxArcSweepDeg: 240,
    minArcPointAngleDeg: 1,
    nearStraightDeviationMm: 0.1,
    maxArcPlaneTiltDeg: 5,
    arcSampleSegments: 48,
  },
});

const JOINT_RELATIVE_FILLET = Object.freeze({
  id: 'joint-relative-fillet',
  version: 1,
  label: 'Joint-relative straight fillet (experimental)',
  description:
    'Torch orientation computed from an operator-declared 90° fillet joint (template or explicit frame) and a declared ' +
    'tool-axis convention, for requested work and push angles relative to the joint. Straight seams only. Approach, ' +
    'retract and standby lie along the planned torch-body direction.',
  experimental: true,
  plannerVersion: PLANNER_VERSION,
  frameConvention:
    'Positions in millimetres in the robot base frame used through the station work object. Quaternions in ABB order ' +
    '[q1,q2,q3,q4] = [w,x,y,z]. The joint frame and tool convention are declarations, not measurements.',
  toolName: null,
  wobjName: null,
  toolDeclaration: FIXED_BASE_QUATERNION.toolDeclaration,
  configuration: [0, 0, 0, 0],
  configurationNote: FIXED_BASE_QUATERNION.configurationNote,
  clearances: {
    approachStandoffMm: 60,
    retractStandoffMm: 60,
    homeStandoffMm: 350,
  },
  motion: FIXED_BASE_QUATERNION.motion,
  orientationDefaults: { workAngleDeg: 45, pushAngleDeg: 10 },
  orientationLimits: { workAngleDeg: ORIENTATION_LIMITS.workAngleDeg, pushAngleDeg: ORIENTATION_LIMITS.pushAngleDeg },
  jointTemplates: Object.fromEntries(Object.entries(JOINT_TEMPLATES).map(([k, v]) => [k, v.label])),
  supportedSeamTypes: ['straight'],
  geometryLimits: FIXED_BASE_QUATERNION.geometryLimits,
});

const POINT_LIST_LINEAR = Object.freeze({
  id: 'point-list-linear',
  version: 1,
  label: 'Testing mode: linear moves through an operator-supplied point list',
  description:
    'Each spreadsheet row becomes a robtarget visited with MoveL in row order. A row named home, if present, ' +
    'is the standby target. Orientation and configuration come from explicit operator choices.',
  frameConvention: FIXED_BASE_QUATERNION.frameConvention,
  toolName: 'tWeldGun',
  wobjName: 'wobj0',
  toolDeclaration: FIXED_BASE_QUATERNION.toolDeclaration,
  motion: {
    home: { speed: 'v100', zone: 'z100' },
    firstTarget: { speed: 'v80', zone: 'fine' },
    target: { speed: 'v100', zone: 'fine' },
    returnHome: { speed: 'v100', zone: 'fine' },
  },
  maxRows: 2000,
});

const PROFILES = {
  [FIXED_BASE_QUATERNION.id]: FIXED_BASE_QUATERNION,
  [JOINT_RELATIVE_FILLET.id]: JOINT_RELATIVE_FILLET,
  [POINT_LIST_LINEAR.id]: POINT_LIST_LINEAR,
};

const CLEARANCE_LIMIT_MM = 1000;

const deepCopy = (o) => JSON.parse(JSON.stringify(o));

/**
 * Validates operator parameters and merges them over the base profile.
 *
 * @param {object} parameters  Request `parameters`; unknown keys are rejected
 * @param {string} defaultProfileId
 * @returns {{ok: boolean, profile?: object, parameters?: object, parametersSha256?: string, diagnostics: object[]}}
 */
function resolveProfile(parameters = {}, defaultProfileId = FIXED_BASE_QUATERNION.id) {
  const diagnostics = [];
  if (parameters === null || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return { ok: false, diagnostics: [diagnostic('PARAM_INVALID', 'error', 'parameters must be an object.')] };
  }

  const profileId = parameters.profileId ?? defaultProfileId;
  const base = PROFILES[profileId];
  const isJoint = profileId === JOINT_RELATIVE_FILLET.id;
  // Seam-descriptor profiles can carry a workpiece, a tool envelope and a traversal choice; point lists cannot.
  const isFeature = profileId !== POINT_LIST_LINEAR.id;
  // Joint-relative revisions take tool and work-object names from the station profile only.
  const allowedTop = new Set([
    ...(isJoint
      ? ['profileId', 'station', 'joint', 'orientation', 'clearances', 'motion', 'calibrationReference']
      : ['profileId', 'toolName', 'wobjName', 'clearances', 'motion', 'nearStraightArcPolicy', 'calibrationReference']),
    ...(isFeature ? ['workpiece', 'toolEnvelope', 'traversal'] : []),
  ]);
  for (const key of Object.keys(parameters)) {
    if (!allowedTop.has(key)) diagnostics.push(diagnostic('PARAM_UNKNOWN', 'error', `Unknown parameter '${key}'${base ? ` for profile '${profileId}'` : ''}.`, { field: key }));
  }

  if (!base) {
    diagnostics.push(diagnostic('PARAM_UNKNOWN_PROFILE', 'error', `Unknown profile '${profileId}'.`, { field: 'profileId' }));
    return { ok: false, diagnostics };
  }
  const profile = deepCopy(base);

  for (const key of isJoint ? [] : ['toolName', 'wobjName']) {
    if (parameters[key] !== undefined) {
      if (!isValidIdentifier(parameters[key])) {
        diagnostics.push(diagnostic('PARAM_INVALID_IDENTIFIER', 'error',
          `${key} must be a RAPID identifier (letter first, letters/digits/underscore, ≤ 32 characters, not reserved).`, { field: key }));
      } else {
        profile[key] = parameters[key];
      }
    }
  }

  if (parameters.clearances !== undefined) {
    if (!base.clearances || typeof parameters.clearances !== 'object' || Array.isArray(parameters.clearances)) {
      diagnostics.push(diagnostic('PARAM_INVALID', 'error', 'clearances are not supported for this profile.', { field: 'clearances' }));
    } else {
      for (const [k, v] of Object.entries(parameters.clearances)) {
        if (!(k in base.clearances)) {
          diagnostics.push(diagnostic('PARAM_UNKNOWN', 'error', `Unknown clearance '${k}'.`, { field: `clearances.${k}` }));
        } else if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > CLEARANCE_LIMIT_MM) {
          diagnostics.push(diagnostic('PARAM_OUT_OF_RANGE', 'error',
            `clearances.${k} must be a number from 0 to ${CLEARANCE_LIMIT_MM} mm.`, { field: `clearances.${k}` }));
        } else {
          profile.clearances[k] = v;
        }
      }
    }
  }

  if (parameters.motion !== undefined) {
    if (typeof parameters.motion !== 'object' || Array.isArray(parameters.motion)) {
      diagnostics.push(diagnostic('PARAM_INVALID', 'error', 'motion must be an object.', { field: 'motion' }));
    } else {
      for (const [k, v] of Object.entries(parameters.motion)) {
        if (!(k in base.motion)) {
          diagnostics.push(diagnostic('PARAM_UNKNOWN', 'error', `Unknown motion segment '${k}'.`, { field: `motion.${k}` }));
          continue;
        }
        if (!v || typeof v !== 'object') {
          diagnostics.push(diagnostic('PARAM_INVALID', 'error', `motion.${k} must be an object.`, { field: `motion.${k}` }));
          continue;
        }
        for (const field of Object.keys(v)) {
          if (field !== 'speed' && field !== 'zone') {
            diagnostics.push(diagnostic('PARAM_UNKNOWN', 'error', `Unknown field motion.${k}.${field}.`, { field: `motion.${k}.${field}` }));
          }
        }
        if (v.speed !== undefined) {
          if (!isAllowedSpeed(v.speed)) diagnostics.push(diagnostic('PARAM_INVALID_SPEED', 'error', `motion.${k}.speed '${v.speed}' is not an allowed predefined speeddata.`, { field: `motion.${k}.speed` }));
          else profile.motion[k].speed = v.speed;
        }
        if (v.zone !== undefined) {
          if (!isAllowedZone(v.zone)) diagnostics.push(diagnostic('PARAM_INVALID_ZONE', 'error', `motion.${k}.zone '${v.zone}' is not an allowed predefined zonedata.`, { field: `motion.${k}.zone` }));
          else profile.motion[k].zone = v.zone;
        }
      }
    }
  }

  if (parameters.nearStraightArcPolicy !== undefined) {
    if (!('nearStraightArcPolicy' in base)) {
      diagnostics.push(diagnostic('PARAM_INVALID', 'error', 'nearStraightArcPolicy is not supported for this profile.', { field: 'nearStraightArcPolicy' }));
    } else if (parameters.nearStraightArcPolicy !== 'reject' && parameters.nearStraightArcPolicy !== 'convert_to_line') {
      diagnostics.push(diagnostic('PARAM_INVALID', 'error', "nearStraightArcPolicy must be 'reject' or 'convert_to_line'.", { field: 'nearStraightArcPolicy' }));
    } else {
      profile.nearStraightArcPolicy = parameters.nearStraightArcPolicy;
    }
  }

  if (parameters.calibrationReference !== undefined) {
    const ref = parameters.calibrationReference;
    if (!ref || typeof ref !== 'object' || Array.isArray(ref) || Object.keys(ref).length !== 1 || !CALIBRATION_ID.test(ref.calibrationId)) {
      diagnostics.push(diagnostic('PARAM_INVALID', 'error', "calibrationReference must be { calibrationId: 'cal_…' } naming an imported calibration file.", { field: 'calibrationReference' }));
    } else {
      profile.calibrationReference = { calibrationId: ref.calibrationId };
    }
  }

  if (isFeature && base.id !== POINT_LIST_LINEAR.id) {
    const wp = validateWorkpieceDefinition(parameters.workpiece);
    diagnostics.push(...wp.diagnostics);
    if (wp.ok) profile.workpiece = wp.definition;
    const env = validateToolEnvelope(parameters.toolEnvelope);
    diagnostics.push(...env.diagnostics.filter((d) => d.severity === 'error'));
    if (env.ok) {
      profile.toolEnvelope = env.definition;
      profile.parameterWarnings = env.diagnostics.filter((d) => d.severity !== 'error');
    }
    const traversal = parameters.traversal === undefined ? 'as_measured' : parameters.traversal;
    if (!TRAVERSALS.includes(traversal)) {
      diagnostics.push(diagnostic('PARAM_INVALID', 'error', "traversal must be 'as_measured' or 'reversed'.", { field: 'traversal' }));
    } else {
      profile.traversal = traversal;
    }
  }

  if (isJoint) {
    const station = resolveStation(parameters.station);
    diagnostics.push(...station.diagnostics);
    if (station.ok) {
      profile.station = station.station;
      profile.toolName = station.station.toolName;
      profile.wobjName = station.station.wobjName;
    }
    if (parameters.joint === undefined) {
      diagnostics.push(diagnostic('PARAM_JOINT_REQUIRED', 'error',
        'A joint template or explicit joint frame is required (parameters.joint). The seam descriptor carries no joint geometry, so none is assumed.', { field: 'joint' }));
    } else {
      const joint = validateJointSpec(parameters.joint);
      diagnostics.push(...joint.diagnostics);
      if (joint.ok) profile.joint = joint.spec;
      if (joint.ok && joint.spec.kind === 'workpiece' && !(profile.workpiece && profile.workpiece.kind === 'fillet90_plates')) {
        diagnostics.push(diagnostic('JOINT_WORKPIECE_REQUIRED', 'error',
          "joint.kind 'workpiece' takes the plate normals from the declared workpiece, but no fillet workpiece is declared (parameters.workpiece).", { field: 'joint' }));
      }
    }
    const o = parameters.orientation === undefined ? {} : parameters.orientation;
    if (!o || typeof o !== 'object' || Array.isArray(o)) {
      diagnostics.push(diagnostic('PARAM_INVALID', 'error', 'orientation must be an object.', { field: 'orientation' }));
    } else {
      for (const k of Object.keys(o)) {
        if (k !== 'workAngleDeg' && k !== 'pushAngleDeg') diagnostics.push(diagnostic('PARAM_UNKNOWN', 'error', `Unknown field orientation.${k}.`, { field: `orientation.${k}` }));
      }
      const request = {
        workAngleDeg: o.workAngleDeg ?? base.orientationDefaults.workAngleDeg,
        pushAngleDeg: o.pushAngleDeg ?? base.orientationDefaults.pushAngleDeg,
      };
      const bad = validateAngles(request);
      diagnostics.push(...bad);
      if (!bad.length) profile.orientationRequest = request;
    }
  }

  if (diagnostics.some((d) => d.severity === 'error')) return { ok: false, diagnostics };

  // The effective parameters, normalised, identify the configuration of a
  // revision: two requests that resolve to the same profile hash identically.
  // For joint-relative revisions this includes the complete station snapshot,
  // so a metadata-only change (provenance, declaration note, evidence
  // reference) creates a new identity even if the module bytes do not change.
  const effective = isJoint ? {
    profileId: profile.id,
    profileVersion: profile.version,
    toolName: profile.toolName,
    wobjName: profile.wobjName,
    station: profile.station,
    joint: profile.joint,
    orientation: profile.orientationRequest,
    clearances: profile.clearances,
    motion: profile.motion,
    calibrationReference: profile.calibrationReference,
    workpiece: profile.workpiece,
    toolEnvelope: profile.toolEnvelope,
    traversal: profile.traversal,
  } : {
    profileId: profile.id,
    profileVersion: profile.version,
    toolName: profile.toolName,
    wobjName: profile.wobjName,
    clearances: profile.clearances,
    motion: profile.motion,
    nearStraightArcPolicy: profile.nearStraightArcPolicy,
    calibrationReference: profile.calibrationReference,
    // undefined (and therefore omitted from the digest) for point lists.
    workpiece: profile.workpiece,
    toolEnvelope: profile.toolEnvelope,
    traversal: profile.traversal,
  };
  return { ok: true, profile, parameters: effective, parametersSha256: sha256(canonicalJson(effective)), diagnostics };
}

function listProfiles() {
  return Object.values(PROFILES).map((p) => deepCopy(p));
}

module.exports = { PROFILES, FIXED_BASE_QUATERNION, JOINT_RELATIVE_FILLET, POINT_LIST_LINEAR, resolveProfile, listProfiles, listStationProfiles };
