/**
 * Offline evidence package: one ZIP that lets a reviewer check, without this
 * application, exactly which input, configuration and module a revision
 * contains.
 *
 * Hash roles are kept separate and none is embedded in the bytes it hashes:
 *   source SHA-256         input/source.*               (the imported bytes)
 *   output SHA-256         module/Module1.mod           (the candidate RAPID bytes)
 *   configuration SHA-256  configuration/configuration.json → "configuration" (canonical JSON)
 *   per-file SHA-256       manifest.json and SHA256SUMS (neither lists itself)
 *   package SHA-256        the ZIP bytes; returned in an HTTP header only
 *
 * Validation identity is (output SHA-256, configuration SHA-256): a module hash
 * alone does not change when a referenced tool or work object definition does.
 * External validation statuses are NOT RUN unless operator-reported evidence
 * bound to both hashes exists, and such evidence stays labelled operator-reported.
 */

const { sha256 } = require('../util/hash');
const { createZip } = require('./zipWriter');

const PACKAGE_FORMAT = 'vd-offline-evidence-package@1';

const json = (o) => `${JSON.stringify(o, null, 2)}\n`;

function validationSheet({ record, identity, synthetic }) {
  const c = identity.configuration;
  const o = record.orientation || {};
  const station = c.station ? `${c.station.id}@${c.station.version} (${c.station.provenance})` : 'not applicable (legacy fixed-orientation profile)';
  const tc = c.station && c.station.toolConvention ? `approach ${c.station.toolConvention.approachAxis}, roll ${c.station.toolConvention.rollAxis} ${c.station.toolConvention.rollReference}` : 'not applicable';
  const joint = o.jointFrame ? `${o.jointFrame.source} (operator declaration)` : 'not applicable';
  const angles = o.requested ? `${o.requested.workAngleDeg}° / ${o.requested.pushAngleDeg}°` : 'not applicable';
  const check = o.recovered ? `${o.recovered.status} (mathematical check only)` : 'not applicable';
  const rows = [
    ['Job / revision', `${record.jobId} / r${record.revision}`],
    ['Source SHA-256', record.source.sha256],
    ['Source provenance at revision', record.source.provenance ? record.source.provenance.value : 'not recorded'],
    ['Parameters SHA-256', record.parametersSha256],
    ['Configuration SHA-256', identity.sha256],
    ['Output SHA-256 (module/Module1.mod)', record.output.sha256],
    ['Motion profile', `${record.profile.id}@${record.profile.version}`],
    ['Station profile', station],
    ['Tool / work object referenced by the module', `${record.profile.toolName} / ${record.profile.wobjName}`],
    ['Declared tool-axis convention', tc],
    ['Joint declaration', joint],
    ['Requested work / push angle', angles],
    ['Application orientation check', check],
    ['Date / reviewer', ''],
    ['RobotStudio version', ''],
    ['RobotWare version / virtual controller', ''],
    ['Robot variant (exact model)', ''],
    ['Station file used', ''],
    ['Tool actually used (tooldata TCP and orientation)', ''],
    ['Work object actually used (name and frame)', ''],
    ['Module import result (Load Module)', 'NOT RUN'],
    ['Syntax check result', 'NOT RUN'],
    ['Configuration errors', 'NOT RUN'],
    ['Reachability errors', 'NOT RUN'],
    ['Singularity / joint-limit warnings', 'NOT RUN'],
    ['Collision check (model used, result)', 'NOT RUN'],
    ['Torch attitude relative to the joint measured in RobotStudio', 'NOT RUN'],
    ['Screenshots / logs attached', ''],
    ['Reviewer notes', ''],
    ['**Result**', '**NOT RUN**'],
  ];
  return [
    '# Manual RobotStudio validation sheet: NOT RUN',
    '',
    ...(synthetic.source || synthetic.configuration ? [
      '> **SYNTHETIC.** This package was produced from a synthetic fixture and/or a synthetic station profile. The tool and',
      '> work-object names are invented. Do not load this module on any controller; use it only to check the application offline.',
      '',
    ] : []),
    'Every result below is NOT RUN until a person performs the check in RobotStudio and records it. Application tests,',
    'prechecks and the mathematical orientation check do not fill in this sheet.',
    '',
    '| Field | Value |',
    '|---|---|',
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    '',
    'Validity: this sheet applies only to the output SHA-256 **and** the configuration SHA-256 above. A different module, tool,',
    'work object, station profile or joint declaration needs a new sheet. Physical dry runs and welding need separate authorisation.',
    '',
  ].join('\n');
}

/**
 * @param {object} input
 * @returns {{buffer: Buffer, packageSha256: string, fileName: string, manifest: object}}
 */
function buildEvidencePackage({ job, record, review, gates, sourceMeta, sourceContent, provenanceNow, moduleCode, calibration, identity, generator, operator, generatedAt }) {
  if (sha256(moduleCode) !== record.output.sha256) throw new Error('package: module bytes do not match the recorded output hash');
  if (sha256(sourceContent) !== record.source.sha256) throw new Error('package: source bytes do not match the recorded source hash');

  const synthetic = {
    source: !!(record.source.provenance && record.source.provenance.value === 'synthetic_fixture'),
    configuration: !!(identity.configuration.station && identity.configuration.station.provenance === 'synthetic_fixture'),
  };
  const evidence = review.externalEvidence.filter((e) => e.kind === 'robotstudio_manual' && e.outputSha256 === record.output.sha256
    && (e.configurationSha256 === identity.sha256 || (identity.derived && e.configurationSha256 === undefined)));

  const files = [];
  const put = (name, data) => files.push({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8') });

  put('README.txt', [
    'VertexDynamics offline evidence package',
    '',
    'Purpose: lets a reviewer check exactly which input, configuration and candidate module one job revision contains.',
    'It is NOT a validation result. RobotStudio, controller and physical validation are NOT RUN unless',
    'validation/external-evidence.json lists operator-reported records bound to both hashes below.',
    '',
    `Job ${record.jobId}, revision ${record.revision}`,
    `Output SHA-256:        ${record.output.sha256}`,
    `Configuration SHA-256: ${identity.sha256}`,
    `Source SHA-256:        ${record.source.sha256}`,
    synthetic.source || synthetic.configuration ? 'SYNTHETIC: contains a synthetic fixture and/or synthetic station profile. Not for any controller.' : '',
    '',
    'Verify independently:',
    '  1. sha256sum -c SHA256SUMS      (every file except SHA256SUMS itself, including manifest.json)',
    '  2. Compare module/Module1.mod with identity.outputSha256 in manifest.json.',
    '  3. Recompute the SHA-256 of the canonical JSON of configuration/configuration.json → "configuration"',
    '     (object keys sorted recursively, no whitespace) and compare with configurationSha256.',
    '  Or run: node scripts/verify-evidence-package.mjs <package.zip>',
    '',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n'));

  put(`input/source.${record.source.contentType === 'point-list' ? 'json' : 'txt'}`, sourceContent);
  put('input/source.json', json({
    sourceId: sourceMeta.id,
    sha256: sourceMeta.sha256,
    sizeBytes: sourceMeta.sizeBytes,
    contentType: sourceMeta.contentType,
    displayName: sourceMeta.displayName,
    importedAt: sourceMeta.importedAt,
    transport: sourceMeta.sourceKind,
    transportNote: 'How the bytes reached the application (watched folder, manual upload, demo button, point list). It does not say where they came from.',
    provenanceAtRevision: record.source.provenance || { value: 'not_recorded', note: 'This revision predates provenance records.' },
    provenanceDeclarationsNow: provenanceNow ? provenanceNow.declarations : [],
    demoSample: sourceMeta.channelDetail && sourceMeta.channelDetail.sample ? sourceMeta.channelDetail.sample : null,
  }));
  put('input/calibration-reference.json', json(calibration ? {
    referenced: true,
    calibrationId: calibration.meta.id,
    sha256: calibration.meta.sha256,
    sizeBytes: calibration.meta.sizeBytes,
    displayName: calibration.meta.displayName,
    importedAt: calibration.meta.importedAt,
    fileBytesIncluded: false,
    applied: false,
    inspection: calibration.inspection,
  } : {
    referenced: false,
    note: 'No calibration file is referenced. Coordinates are read as robot-base millimetres; no transform is applied.',
  }));
  put('configuration/configuration.json', json({
    configurationSha256: identity.sha256,
    derived: identity.derived,
    digestMethod: 'SHA-256 of the canonical JSON of "configuration": object keys sorted recursively, undefined values omitted, no whitespace.',
    configuration: identity.configuration,
  }));
  put('path/targets.json', json({
    units: 'mm',
    frame: 'robot_base',
    note: 'The same stored waypoints and segments drive the tables, 2.5D view, 3D preview and the module.',
    waypoints: record.path.waypoints,
    segments: record.path.segments,
    geometry: record.geometry,
  }));
  put('orientation/orientation.json', json({ label: 'mathematical check, not robot verified', orientation: record.orientation || null }));
  put('checks/diagnostics.json', json({
    diagnostics: record.diagnostics,
    requiredAcknowledgements: record.requiredAcknowledgements,
    prechecks: record.prechecks,
    prechecksNote: 'Application prechecks re-read the module text for the structure this application emits. They are not a RAPID compiler.',
  }));
  put('checks/operator-review.json', json({
    attribution: 'Operator names are attribution only, not authentication.',
    acknowledgements: review.acknowledgements,
    geometryReview: review.geometryReview,
    moduleReview: review.moduleReview,
    gatesAtPackageTime: { isLatest: gates.isLatest, validation: gates.validation, export: gates.export, package: gates.package },
  }));
  put('module/Module1.mod', moduleCode);
  put('environment/generator.json', json({
    generatorVersion: record.output.generatorVersion,
    plannerVersion: identity.configuration.plannerVersion || null,
    ...generator,
  }));
  put('validation/robotstudio-validation-sheet.md', validationSheet({ record, identity, synthetic }));
  put('validation/external-evidence.json', json({
    status: evidence.length ? 'operator_reported_records_present' : 'NOT RUN',
    note: 'Records are operator-reported and bound to this output and configuration hash. The application does not verify them.',
    records: evidence,
  }));

  const manifest = {
    format: PACKAGE_FORMAT,
    generatedAt: generatedAt.toISOString(),
    generatedBy: { operator, note: 'Attribution only.' },
    purpose: 'Offline evidence for manual review. Not a validation result.',
    identity: {
      jobId: record.jobId,
      projectId: record.projectId,
      revision: record.revision,
      latestRevisionAtPackageTime: job.latestRevision,
      sourceId: record.source.id,
      sourceSha256: record.source.sha256,
      parametersSha256: record.parametersSha256,
      configurationSha256: identity.sha256,
      configurationDerived: identity.derived,
      outputSha256: record.output.sha256,
      moduleFile: 'module/Module1.mod',
    },
    hashDefinitions: {
      sourceSha256: 'SHA-256 of input/source.* (the imported bytes)',
      outputSha256: 'SHA-256 of module/Module1.mod (never written inside the module)',
      configurationSha256: 'SHA-256 of canonical JSON of configuration/configuration.json → configuration',
      files: 'SHA-256 of each file listed below; SHA256SUMS additionally covers manifest.json',
      packageSha256: 'SHA-256 of the ZIP; reported by the application outside the archive',
    },
    statuses: {
      applicationPrechecks: gates.validation.applicationPrechecks,
      orientation: record.orientation && record.orientation.recovered ? `${record.orientation.recovered.status} (mathematical check)` : 'not_applicable',
      robotStudio: evidence.length ? 'operator_reported (see validation/external-evidence.json)' : 'NOT RUN',
      physicalDryRun: 'NOT RUN',
      controllerConnection: 'not_integrated',
      calibration: calibration ? 'referenced for provenance; not applied; physical calibration not validated' : 'not referenced; not applied',
    },
    synthetic,
    files: files.map((f) => ({ path: f.name, bytes: f.data.length, sha256: sha256(f.data) })),
    excluded: [
      'The archived calibration station (auto_calib.rspag), its licence and controller backup files',
      'Calibration file bytes (hash and inspection only)',
      'Secrets, environment files and absolute filesystem paths',
    ],
  };
  put('manifest.json', json(manifest));
  put('SHA256SUMS', `${files.map((f) => `${sha256(f.data)}  ${f.name}`).join('\n')}\n`);

  const buffer = createZip(files, { date: generatedAt });
  return {
    buffer,
    packageSha256: sha256(buffer),
    fileName: `VD_evidence_${record.jobId.slice(4, 12)}_r${record.revision}_${identity.sha256.slice(0, 8)}.zip`,
    manifest,
  };
}

module.exports = { buildEvidencePackage, PACKAGE_FORMAT };
