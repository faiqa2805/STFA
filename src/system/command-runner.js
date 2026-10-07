// The ONLY place in the project that starts processes.
//
// Safety rules enforced here (not in the agent, not in the tools):
//   1. Allowlist: only known program names can run, e.g. "g++" or "cmake".
//      Anything else is refused before a process is ever created.
//   2. No shell: we call spawn() with shell:false and pass arguments as an
//      array, so characters like `&`, `|` or `;` are just text, never commands.
//   3. Programs built by the agent itself (the test .exe) may run only if they
//      live inside an explicitly allowed directory (the agent workspace).
//   4. Every process gets a timeout.
//
// It returns a plain "process result" (not a tool result). Tools turn these
// low-level facts into meaningful answers like "CMake is not installed".

import { spawn } from 'node:child_process';
import path from 'node:path';
import { config } from '../config/config.js';
import { ErrorCode } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const DEFAULT_ALLOWED_COMMANDS = [
  'g++',
  'gcc',
  'clang++',
  'cmake',
  'git',
  'mingw32-make',
  'ninja',
  'winget', // installer, only called with fixed package IDs from config
  'net', // `net session` = admin check
  'reg', // `reg query` = read persisted PATH
];

const MAX_OUTPUT = 200_000; // characters; protects memory if a program floods output

function normalizeName(command) {
  return command.toLowerCase().replace(/\.exe$/, '');
}

function isInside(dir, file) {
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// A factory so tests can build a runner with their own allowlist. The rest of the
// app uses the default `runCommand` exported below.
export function createCommandRunner({ allowedCommands = DEFAULT_ALLOWED_COMMANDS, allowedProgramDirs = [] } = {}) {
  const allowed = new Set(allowedCommands.map(normalizeName));

  function checkAllowed(command) {
    if (typeof command !== 'string' || command.trim() === '') return false;
    const looksLikePath = command.includes('/') || command.includes('\\');
    if (!looksLikePath) return allowed.has(normalizeName(command));
    return path.isAbsolute(command) && allowedProgramDirs.some((dir) => isInside(dir, command));
  }

  /**
   * @param {string} command  program name from the allowlist, or an absolute path inside an allowed dir
   * @param {string[]} args   arguments, passed verbatim (never through a shell)
   * @param {{cwd?: string, timeoutMs?: number, interactive?: boolean}} options
   *        interactive: connect the child to this terminal (used for installers so the
   *        user can see and answer their prompts). Output is then not captured.
   */
  return function runCommand(command, args = [], { cwd, timeoutMs = 15_000, interactive = false } = {}) {
    const started = Date.now();
    const result = (fields) => ({ command, args, durationMs: Date.now() - started, ...fields });

    if (!checkAllowed(command)) {
      logger.warn('Blocked command', { command, args });
      return Promise.resolve(
        result({
          ok: false,
          exitCode: null,
          stdout: '',
          stderr: '',
          error: { code: ErrorCode.COMMAND_NOT_ALLOWED, message: `"${command}" is not on the allowlist.` },
        }),
      );
    }
    if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
      return Promise.resolve(
        result({
          ok: false,
          exitCode: null,
          stdout: '',
          stderr: '',
          error: { code: ErrorCode.INVALID_INPUT, message: 'Arguments must be an array of strings.' },
        }),
      );
    }

    logger.info('Running command', { command, args, cwd });

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      const finish = (fields) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const res = result({ stdout, stderr, ...fields });
        logger.info('Command finished', { command, exitCode: res.exitCode, ok: res.ok, durationMs: res.durationMs });
        resolve(res);
      };

      let child;
      try {
        child = spawn(command, args, {
          cwd,
          shell: false,
          windowsHide: !interactive,
          stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        // spawn() can throw synchronously, e.g. for an invalid cwd.
        return finish({ ok: false, exitCode: null, error: { code: ErrorCode.COMMAND_FAILED, message: err.message } });
      }

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout?.on('data', (chunk) => {
        if (stdout.length < MAX_OUTPUT) stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk) => {
        if (stderr.length < MAX_OUTPUT) stderr += chunk.toString();
      });

      child.on('error', (err) => {
        const code =
          err.code === 'ENOENT'
            ? ErrorCode.COMMAND_NOT_FOUND
            : err.code === 'EACCES' || err.code === 'EPERM'
              ? ErrorCode.PERMISSION_DENIED
              : ErrorCode.COMMAND_FAILED;
        const message = code === ErrorCode.COMMAND_NOT_FOUND ? `"${command}" was not found on PATH.` : err.message;
        finish({ ok: false, exitCode: null, error: { code, message } });
      });

      child.on('close', (exitCode) => {
        if (timedOut) {
          return finish({
            ok: false,
            exitCode,
            error: { code: ErrorCode.TIMEOUT, message: `"${command}" did not finish within ${timeoutMs / 1000}s.` },
          });
        }
        finish({
          ok: exitCode === 0,
          exitCode,
          error: exitCode === 0 ? null : { code: ErrorCode.COMMAND_FAILED, message: `"${command}" exited with code ${exitCode}.` },
        });
      });
    });
  };
}

// The runner the real app uses: default allowlist, plus programs the agent
// itself compiled inside its workspace.
export const runCommand = createCommandRunner({ allowedProgramDirs: [config.workspaceDir] });
