// Filesystem helpers with one safety rule: the agent only WRITES inside
// directories it owns. It never deletes anything.
//
// "Owns" means: the directory is new, or it contains our marker file from a
// previous run. This stops the agent from scribbling into an unrelated folder
// that happens to have the same name.

import fs from 'node:fs';
import path from 'node:path';

export const MARKER_FILE = '.created-by-cpp-agent';

export function exists(p) {
  return fs.existsSync(p);
}

export function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

export function listDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

export function isInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Make sure `dir` exists and belongs to the agent.
 * Returns { ok: true, created } or { ok: false, reason }.
 */
export function claimDirectory(dir) {
  if (fs.existsSync(dir)) {
    const entries = fs.readdirSync(dir);
    const ours = entries.includes(MARKER_FILE);
    if (!ours && entries.length > 0) {
      return { ok: false, reason: `"${dir}" already exists and was not created by cpp-agent; refusing to write into it.` };
    }
    if (!ours) fs.writeFileSync(path.join(dir, MARKER_FILE), 'This folder is managed by cpp-agent.\n');
    return { ok: true, created: false };
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, MARKER_FILE), 'This folder is managed by cpp-agent.\n');
  return { ok: true, created: true };
}

/** Write a file, but only if it lands inside `root`. */
export function writeFileInside(root, relativePath, content) {
  const target = path.resolve(root, relativePath);
  if (!isInside(root, target)) {
    throw new Error(`Refusing to write outside ${root}: ${target}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}
