// Windows environment inspection: PATH, program lookup, admin status.
//
// The lookup functions take `env` and `exists` as parameters (with real defaults)
// so tests can describe a fake machine without touching the real one.

import fs from 'node:fs';
import path from 'node:path';

export function getPathEntries(env = process.env) {
  return (env.PATH ?? env.Path ?? '')
    .split(';')
    .map((p) => p.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

/**
 * Find a program the same way Windows does: try each PATH folder in order,
 * with each executable extension from PATHEXT. Returns the full path or null.
 */
export function findOnPath(command, { env = process.env, exists = fs.existsSync } = {}) {
  const extensions = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const hasExt = path.extname(command) !== '';
  for (const dir of getPathEntries(env)) {
    for (const ext of hasExt ? [''] : extensions) {
      const candidate = path.join(dir, command + ext.toLowerCase());
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/** Report PATH problems that commonly confuse beginners. */
export function analyzePath({ env = process.env, exists = fs.existsSync } = {}) {
  const entries = getPathEntries(env);
  const seen = new Set();
  const duplicates = [];
  for (const entry of entries) {
    const key = entry.toLowerCase().replace(/\\+$/, '');
    if (seen.has(key)) duplicates.push(entry);
    seen.add(key);
  }
  return {
    entries,
    missingDirs: entries.filter((e) => !exists(e)),
    duplicates,
    // Windows has a ~2047 char limit for PATH edited through some tools.
    length: entries.join(';').length,
  };
}

/** `net session` only succeeds in an elevated (Administrator) process. */
export async function isAdmin(runCommand) {
  const res = await runCommand('net', ['session'], { timeoutMs: 10_000 });
  return res.ok;
}

/**
 * Installers update PATH in the registry, but an already-running process (this
 * one, and the user's terminal) keeps its old copy. Reading the registry lets us
 * see the NEW PATH without asking the user to restart right away.
 */
export async function readPersistedPath(runCommand, env = process.env) {
  const keys = [
    'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', // machine PATH comes first
    'HKCU\\Environment',
  ];
  const parts = [];
  for (const key of keys) {
    const res = await runCommand('reg', ['query', key, '/v', 'Path'], { timeoutMs: 10_000 });
    if (res.ok) {
      const value = parseRegQueryValue(res.stdout);
      if (value) parts.push(expandEnvVars(value, env));
    }
  }
  return parts.join(';');
}

// `reg query` prints:  "    Path    REG_EXPAND_SZ    C:\a;%USERPROFILE%\b"
export function parseRegQueryValue(stdout) {
  const match = stdout.match(/^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im);
  return match ? match[1].trim() : null;
}

export function expandEnvVars(value, env = process.env) {
  return value.replace(/%([^%]+)%/g, (whole, name) => {
    const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? env[key] : whole;
  });
}

/** Append any newly persisted PATH folders to this process's PATH. */
export async function refreshProcessPath(runCommand) {
  const persisted = getPathEntries({ PATH: await readPersistedPath(runCommand) });
  const current = getPathEntries();
  const known = new Set(current.map((p) => p.toLowerCase()));
  const added = persisted.filter((p) => !known.has(p.toLowerCase()));
  if (added.length) process.env.PATH = [...current, ...added].join(';');
  return added;
}
