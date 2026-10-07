// The single result shape used by EVERY tool:
//
//   { success: true,  tool, data: {...}, error: null }
//   { success: false, tool, data: {...} | null, error: { code, message, hint, details } }
//
// Why one shape? The agent (and, later, an LLM) can handle any tool's output the
// same way: check `success`, read `data`, or explain `error`. No special cases.

import { hintFor } from './errors.js';

export function ok(tool, data) {
  return { success: true, tool, data, error: null };
}

// `data` is allowed on failure too: e.g. "g++ is installed at X but is not on PATH"
// is a failure that still carries useful facts.
export function fail(tool, code, message, { hint, details, data = null } = {}) {
  return {
    success: false,
    tool,
    data,
    error: { code, message, hint: hint ?? hintFor(code), details: details ?? null },
  };
}

export function isToolResult(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.success === 'boolean' &&
    typeof value.tool === 'string' &&
    'data' in value &&
    'error' in value &&
    (value.success ? value.error === null : typeof value.error?.code === 'string')
  );
}
