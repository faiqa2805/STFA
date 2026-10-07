// checkVSCode: is Visual Studio Code installed?
//
// Unlike the other checks, this one does NOT run `code --version`. On Windows
// `code` is a .cmd batch file, and running batch files requires a shell, which
// our command runner deliberately refuses to use. Instead we find the install
// folder and read the version from VS Code's own package.json. Safer and faster.

import path from 'node:path';
import fs from 'node:fs';
import { ErrorCode } from '../utils/errors.js';
import { ok, fail } from '../utils/result.js';
import { findOnPath } from '../system/environment.js';

function readVersion(ctx, installDir, readFile) {
  // Classic layout: <install>\resources\app\package.json
  // Newer builds may nest it one level deeper: <install>\<id>\resources\app\package.json
  const candidates = [
    path.join(installDir, 'resources', 'app', 'package.json'),
    ...ctx.listDir(installDir).map((sub) => path.join(installDir, sub, 'resources', 'app', 'package.json')),
  ];
  for (const file of candidates) {
    if (!ctx.exists(file)) continue;
    try {
      return JSON.parse(readFile(file)).version ?? null;
    } catch {
      // keep looking
    }
  }
  return null;
}

export const checkVSCode = {
  name: 'checkVSCode',
  description: 'Detect Visual Studio Code, its version, and whether the `code` command is on PATH.',
  inputSchema: { type: 'object', properties: {} },
  sideEffects: 'none',

  async run(_input, ctx) {
    const readFile = ctx.readFile ?? ((f) => fs.readFileSync(f, 'utf8'));
    const codeCmd = findOnPath('code', { env: ctx.env, exists: ctx.exists });

    // `...\Microsoft VS Code\bin\code.cmd` -> install dir is the parent of `bin`.
    const fromPath = codeCmd ? path.dirname(path.dirname(codeCmd)) : null;
    const knownDirs = [
      path.join(ctx.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code'),
      path.join(ctx.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft VS Code'),
    ];
    const installDir = [fromPath, ...knownDirs].find((dir) => dir && ctx.exists(path.join(dir, 'Code.exe')));

    if (!installDir) {
      return fail('checkVSCode', ErrorCode.NOT_INSTALLED, 'Visual Studio Code was not found.', {
        data: { installed: false, inPath: Boolean(codeCmd) },
      });
    }

    const warnings = [];
    if (!codeCmd) warnings.push('The `code` command is not on PATH, so `code .` will not work in a terminal.');
    warnings.push('Install the "C/C++" extension (ms-vscode.cpptools) inside VS Code for IntelliSense and debugging.');

    return ok('checkVSCode', {
      installed: true,
      inPath: Boolean(codeCmd),
      version: readVersion(ctx, installDir, readFile),
      path: path.join(installDir, 'Code.exe'),
      warnings,
    });
  },
};
