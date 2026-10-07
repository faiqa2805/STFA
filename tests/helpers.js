// Test helpers: a fake machine.
//
// Tools receive everything through `ctx`, so a test can describe a machine with
// plain data ("g++ prints this", "these files exist") and no real installs.

process.env.CPP_AGENT_NO_LOG_FILE = '1'; // keep tests from writing to the real log

import { createToolContext } from '../src/tools/context.js';

/**
 * Build a fake runCommand.
 * `programs` maps "command arg1 arg2" (or just "command") to a response:
 *   { stdout, stderr, exitCode }   -> program ran
 *   'missing'                      -> COMMAND_NOT_FOUND
 * Unlisted commands are treated as missing. Every call is recorded in `.calls`.
 */
export function fakeRunner(programs = {}) {
  const calls = [];
  const runCommand = async (command, args = [], options = {}) => {
    calls.push({ command, args, options });
    const response = programs[[command, ...args].join(' ')] ?? programs[command] ?? 'missing';
    const base = { command, args, durationMs: 1, stdout: '', stderr: '' };
    if (typeof response === 'function') return { ...base, ...(await response(command, args, options)) };
    if (response === 'missing') {
      return { ...base, ok: false, exitCode: null, error: { code: 'COMMAND_NOT_FOUND', message: `"${command}" was not found on PATH.` } };
    }
    const exitCode = response.exitCode ?? 0;
    return {
      ...base,
      stdout: response.stdout ?? '',
      stderr: response.stderr ?? '',
      ok: exitCode === 0,
      exitCode,
      error: exitCode === 0 ? null : { code: 'COMMAND_FAILED', message: `exited with ${exitCode}` },
    };
  };
  runCommand.calls = calls;
  return runCommand;
}

/** A fake filesystem view: `files` is a list of paths that "exist". */
export function fakeExists(files = []) {
  const set = new Set(files.map((f) => f.toLowerCase()));
  return (p) => set.has(p.toLowerCase());
}

/** A tool context for a fake machine. */
export function fakeContext({ programs = {}, files = [], pathDirs = [], env = {}, ...rest } = {}) {
  return createToolContext({
    runCommand: fakeRunner(programs),
    exists: fakeExists([...files, ...pathDirs]),
    listDir: () => [],
    env: { PATH: pathDirs.join(';'), PATHEXT: '.EXE;.CMD', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', ProgramFiles: 'C:\\Program Files', ...env },
    ...rest,
  });
}
