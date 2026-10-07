// Shared logic for "is program X installed and usable?" checks.
// checkCMake, checkGit and checkCompiler all follow the same recipe:
//
//   1. Run `X --version`.
//        works          -> installed, report the version
//        not found      -> go to step 2
//        runs but fails -> installed but broken
//   2. Look in the usual install folders.
//        found there    -> installed but NOT on PATH (very common on Windows!)
//        not found      -> not installed

import path from 'node:path';
import { ErrorCode } from '../utils/errors.js';
import { ok, fail } from '../utils/result.js';
import { findOnPath } from '../system/environment.js';

// Pull "14.2.0" out of lines like:
//   "g++.exe (MinGW-W64 x86_64-ucrt-posix-seh, built by Brecht Sanders, r1) 14.2.0"
//   "cmake version 3.29.2"
//   "git version 2.45.1.windows.1"
export function parseVersion(output) {
  const firstLine = (output ?? '').split(/\r?\n/).find((l) => l.trim()) ?? '';
  const full = firstLine.match(/\d+\.\d+\.\d+/g);
  if (full) return full[full.length - 1];
  const short = firstLine.match(/\d+\.\d+/);
  return short ? short[0] : null;
}

/**
 * Run `command --version` and describe what happened. Not a tool by itself;
 * tools call this and decide what it means.
 * Returns { found, works, version, path, output, processResult }.
 */
export async function probeProgram(ctx, command, args = ['--version']) {
  const res = await ctx.runCommand(command, args, { timeoutMs: ctx.timeouts?.check ?? 15_000 });
  const output = `${res.stdout}\n${res.stderr}`.trim();
  if (res.error?.code === ErrorCode.COMMAND_NOT_FOUND) {
    return { found: false, works: false, version: null, path: null, output, processResult: res };
  }
  return {
    found: true,
    works: res.ok,
    version: res.ok ? parseVersion(output) : null,
    path: findOnPath(command, { env: ctx.env, exists: ctx.exists }),
    output,
    processResult: res,
  };
}

/** Find `exeName` in any of `dirs`. Returns the full path or null. */
export function findInDirs(ctx, exeName, dirs) {
  for (const dir of dirs) {
    const candidate = path.join(dir, exeName);
    if (ctx.exists(candidate)) return candidate;
  }
  return null;
}

/**
 * The full check recipe for a single program. Returns a tool result.
 * @param {object} spec { tool, command, displayName, knownDirs }
 */
export async function checkProgram(ctx, { tool, command, displayName, knownDirs = [] }) {
  const probe = await probeProgram(ctx, command);

  if (probe.found && probe.works) {
    return ok(tool, { installed: true, inPath: true, command, version: probe.version, path: probe.path });
  }

  if (probe.found && !probe.works) {
    return fail(tool, probe.processResult.error?.code ?? ErrorCode.COMMAND_FAILED, `${displayName} was found but \`${command} --version\` failed.`, {
      hint: 'The installation may be damaged. Reinstalling usually fixes this.',
      details: probe.output || probe.processResult.error?.message,
      data: { installed: true, inPath: true, command, path: probe.path },
    });
  }

  const location = findInDirs(ctx, `${command}.exe`, knownDirs);
  if (location) {
    return fail(tool, ErrorCode.NOT_IN_PATH, `${displayName} is installed at ${location} but is not on PATH.`, {
      hint: `Add "${path.dirname(location)}" to your PATH, then open a new terminal.`,
      data: { installed: true, inPath: false, command, location },
    });
  }

  return fail(tool, ErrorCode.NOT_INSTALLED, `${displayName} was not found.`, {
    data: { installed: false, inPath: false, command },
  });
}
