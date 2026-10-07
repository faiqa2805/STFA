// Install tools: installCompiler, installCMake, installGit, installVSCode.
//
// These are the only tools that change the machine, so they are deliberately
// boring and conservative:
//   - They install exactly one package each, by a fixed winget ID from config.
//     There is no input that lets a caller pick a different package or command.
//   - `dryRun: true` returns the exact command without running it ("plan" mode).
//   - winget runs attached to the user's terminal, so the user sees (and answers)
//     its license prompts themselves. We never pass --accept-* flags on their behalf.
//   - We never try to elevate privileges. If an installer needs Administrator
//     rights, Windows itself shows the UAC prompt and the user decides; if that's
//     refused or impossible, we report it and explain the options.
//   - Asking the user for permission is NOT done here; that's the agent's job
//     (see agent.js). Tools do things; the agent decides whether to.

import { ErrorCode } from '../utils/errors.js';
import { ok, fail } from '../utils/result.js';
import { isAdmin, refreshProcessPath } from '../system/environment.js';

// Selected winget exit codes (HRESULTs, compared as unsigned 32-bit numbers).
const WINGET = {
  ALREADY_INSTALLED: 0x8a150061,
  NO_UPDATE_APPLICABLE: 0x8a15002b,
  NO_PACKAGE_FOUND: 0x8a150014,
};
const ERROR_ELEVATION_REQUIRED = 740;
const MSI_USER_CANCELLED = 1602;

export function wingetInstallArgs(packageId) {
  return ['install', '--id', packageId, '--exact', '--source', 'winget'];
}

// Map a winget exit code to an outcome. Exported for unit tests.
export function interpretWingetExit(exitCode) {
  const code = exitCode === null ? null : exitCode >>> 0;
  if (code === 0 || code === WINGET.ALREADY_INSTALLED || code === WINGET.NO_UPDATE_APPLICABLE) return { ok: true };
  if (code === ERROR_ELEVATION_REQUIRED) {
    return {
      ok: false,
      code: ErrorCode.PERMISSION_DENIED,
      message: 'The installer requires Administrator rights.',
      hint: 'Open a terminal with "Run as administrator" and run `cpp-agent setup` again, or install this tool manually.',
    };
  }
  if (code === MSI_USER_CANCELLED) {
    return { ok: false, code: ErrorCode.INSTALL_FAILED, message: 'The installation was cancelled.', hint: 'Run setup again when ready.' };
  }
  if (code === WINGET.NO_PACKAGE_FOUND) {
    return { ok: false, code: ErrorCode.INSTALL_FAILED, message: 'winget could not find the package.', hint: 'Run `winget source update` and retry.' };
  }
  const hex = code === null ? 'none' : `0x${code.toString(16).toUpperCase()}`;
  return {
    ok: false,
    code: ErrorCode.INSTALL_FAILED,
    message: `winget failed with exit code ${hex}.`,
    hint: 'Scroll up to read winget\'s own message. You can also install the tool manually (see docs/cpp-setup.md).',
  };
}

function makeInstallTool(name, component) {
  return {
    name,
    description: `Install ${component} using winget with a fixed, pre-approved package ID. Use dryRun to preview the command.`,
    inputSchema: {
      type: 'object',
      properties: { dryRun: { type: 'boolean', description: 'Only describe the command; do not run it.' } },
    },
    sideEffects: 'installs-software',

    async run({ dryRun = false }, ctx) {
      const pkg = ctx.packages[component];
      const args = wingetInstallArgs(pkg.wingetId);
      const planned = { component, package: pkg.label, packageId: pkg.wingetId, command: `winget ${args.join(' ')}` };

      if (dryRun) return ok(name, { ...planned, dryRun: true, installed: false });

      const winget = await ctx.runCommand('winget', ['--version'], { timeoutMs: 20_000 });
      if (!winget.ok) {
        return fail(name, ErrorCode.INSTALLER_UNAVAILABLE, 'winget (Windows Package Manager) is not available.', {
          details: winget.error?.message,
          data: planned,
        });
      }

      const admin = await isAdmin(ctx.runCommand);
      const res = await ctx.runCommand('winget', args, { timeoutMs: ctx.timeouts.install, interactive: true });

      if (res.error?.code === ErrorCode.TIMEOUT) {
        return fail(name, ErrorCode.TIMEOUT, `Installing ${pkg.label} timed out.`, { data: planned });
      }
      const outcome = interpretWingetExit(res.exitCode);
      if (!outcome.ok) {
        return fail(name, outcome.code, `Could not install ${pkg.label}: ${outcome.message}`, {
          hint: outcome.hint,
          details: `Ran as ${admin ? 'Administrator' : 'a normal user'}.`,
          data: planned,
        });
      }

      // The installer updated PATH in the registry; pull those changes into THIS
      // process so the verification step can find the new tool immediately.
      const pathAdded = await refreshProcessPath(ctx.runCommand);
      return ok(name, { ...planned, dryRun: false, installed: true, ranAsAdmin: admin, pathAdded });
    },
  };
}

export const installCompiler = makeInstallTool('installCompiler', 'compiler');
export const installCMake = makeInstallTool('installCMake', 'cmake');
export const installGit = makeInstallTool('installGit', 'git');
export const installVSCode = makeInstallTool('installVSCode', 'vscode');
