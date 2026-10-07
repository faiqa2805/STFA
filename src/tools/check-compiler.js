// checkCompiler: is there a working C++ compiler?
//
// V1 default is GCC (g++) from MinGW-w64. We also accept clang++ if that's what
// the user has. MSVC (cl.exe) is only *noticed*, not used: it needs a special
// "Developer Command Prompt" environment, which is out of scope for V1.
// See docs/cpp-setup.md for the reasoning.

import path from 'node:path';
import { ok } from '../utils/result.js';
import { checkProgram } from './check-program.js';

// Folders where MinGW-w64 commonly lives even when it isn't on PATH.
export function knownCompilerDirs(ctx) {
  const env = ctx.env;
  const localAppData = env.LOCALAPPDATA ?? '';
  const wingetPackages = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  const winlibsDirs = ctx
    .listDir(wingetPackages)
    .filter((name) => name.startsWith('BrechtSanders.WinLibs'))
    .map((name) => path.join(wingetPackages, name, 'mingw64', 'bin'));

  return [
    ...winlibsDirs,
    'C:\\msys64\\ucrt64\\bin',
    'C:\\msys64\\mingw64\\bin',
    'C:\\mingw64\\bin',
    'C:\\MinGW\\bin',
    'C:\\TDM-GCC-64\\bin',
  ];
}

export const checkCompiler = {
  name: 'checkCompiler',
  description:
    'Detect a working C++ compiler (g++ preferred, clang++ accepted). Reports compiler name, version and location, ' +
    'or whether a compiler is installed but missing from PATH.',
  inputSchema: { type: 'object', properties: {} },
  sideEffects: 'none',

  async run(_input, ctx) {
    const gcc = await checkProgram(ctx, {
      tool: 'checkCompiler',
      command: 'g++',
      displayName: 'GCC (g++)',
      knownDirs: knownCompilerDirs(ctx),
    });
    if (gcc.success) return ok('checkCompiler', { ...gcc.data, compiler: 'g++', family: 'gcc' });

    // g++ isn't usable; is clang++ available instead?
    const clang = await checkProgram(ctx, { tool: 'checkCompiler', command: 'clang++', displayName: 'Clang (clang++)' });
    if (clang.success) return ok('checkCompiler', { ...clang.data, compiler: 'clang++', family: 'clang' });

    // Neither works. The g++ result is the more useful one to report
    // (it may say "installed but not on PATH" or "broken").
    const vswhere = path.join(ctx.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (ctx.exists(vswhere)) {
      gcc.error.details = [gcc.error.details, 'Note: Visual Studio is installed (MSVC may be available), but V1 uses GCC.']
        .filter(Boolean)
        .join('\n');
    }
    return gcc;
  },
};
