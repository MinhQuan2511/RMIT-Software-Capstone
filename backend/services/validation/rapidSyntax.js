/**
 * RAPID lexical rules the generator enforces before serialising.
 *
 * Identifier rule: a letter followed by letters, digits or underscores, at most
 * 32 characters, not a reserved word. Speed and zone names are restricted to
 * predefined `speeddata`/`zonedata` names so the module never references data
 * that would have to be declared elsewhere. These lists are the application's
 * allowlist; acceptance by a particular RobotWare version is established only
 * by importing the module into that controller.
 */

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

const RESERVED_WORDS = new Set([
  'ALIAS', 'AND', 'BACKWARD', 'CASE', 'CONNECT', 'CONST', 'DEFAULT', 'DIV', 'DO', 'ELSE', 'ELSEIF',
  'ENDFOR', 'ENDFUNC', 'ENDIF', 'ENDMODULE', 'ENDPROC', 'ENDRECORD', 'ENDTEST', 'ENDTRAP', 'ENDWHILE',
  'ERROR', 'EXIT', 'FALSE', 'FOR', 'FROM', 'FUNC', 'GOTO', 'IF', 'INOUT', 'LOCAL', 'MOD', 'MODULE',
  'NOSTEPIN', 'NOT', 'NOVIEW', 'OR', 'PERS', 'PROC', 'RAISE', 'READONLY', 'RECORD', 'RETRY', 'RETURN',
  'STEP', 'SYSMODULE', 'TEST', 'THEN', 'TO', 'TRAP', 'TRUE', 'TRYNEXT', 'UNDO', 'VAR', 'VIEWONLY',
  'WHILE', 'WITH', 'XOR',
]);

const SPEEDS = new Set([
  'v5', 'v10', 'v20', 'v30', 'v40', 'v50', 'v60', 'v80', 'v100', 'v150', 'v200', 'v300', 'v400',
  'v500', 'v600', 'v800', 'v1000', 'v1500', 'v2000', 'v2500', 'v3000', 'v4000', 'v5000', 'v6000', 'v7000',
]);

const ZONES = new Set([
  'fine', 'z0', 'z1', 'z5', 'z10', 'z15', 'z20', 'z30', 'z40', 'z50', 'z60', 'z80', 'z100', 'z150', 'z200',
]);

function isValidIdentifier(name) {
  return typeof name === 'string' && IDENTIFIER.test(name) && !RESERVED_WORDS.has(name.toUpperCase());
}

const isAllowedSpeed = (s) => typeof s === 'string' && SPEEDS.has(s);
const isAllowedZone = (z) => typeof z === 'string' && ZONES.has(z);

module.exports = { IDENTIFIER, RESERVED_WORDS, SPEEDS, ZONES, isValidIdentifier, isAllowedSpeed, isAllowedZone };
