/**
 * Structured errors and diagnostics shared by every backend service.
 *
 * A diagnostic is data returned to the client; an AppError is thrown inside a
 * request and converted to an HTTP response by the error middleware. Neither
 * carries absolute filesystem paths or stack traces to the browser.
 */

const crypto = require('crypto');

/**
 * @typedef {Object} Diagnostic
 * @property {string}  code                     Stable machine-readable code
 * @property {'error'|'warning'|'info'} severity
 * @property {string}  message                  Operator-facing sentence
 * @property {string}  [field]                  Affected input field, if any
 * @property {number}  [line]                   1-based source line, if any
 * @property {boolean} [requiresAcknowledgement] Export is blocked until acknowledged
 * @property {Object}  [details]                Numbers backing the message
 */

function diagnostic(code, severity, message, extra = {}) {
  const d = { code, severity, message };
  if (extra.field !== undefined) d.field = extra.field;
  if (extra.line !== undefined) d.line = extra.line;
  if (extra.requiresAcknowledgement) d.requiresAcknowledgement = true;
  if (extra.details !== undefined) d.details = extra.details;
  return d;
}

const hasErrors = (diagnostics) => diagnostics.some((d) => d.severity === 'error');

class AppError extends Error {
  /**
   * @param {number} status   HTTP status
   * @param {string} code     Stable error code
   * @param {string} message  Client-safe message
   * @param {Object} [extra]  { diagnostics, details }
   */
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.diagnostics = extra.diagnostics;
    this.details = extra.details;
  }
}

const newDiagnosticId = () => `diag_${crypto.randomBytes(6).toString('hex')}`;

module.exports = { diagnostic, hasErrors, AppError, newDiagnosticId };
