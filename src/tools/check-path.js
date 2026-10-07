// checkPath: can Windows find the C++ toolchain by name?
//
// The other checks answer "does g++ work?". This one answers "WHY might it not?"
// by looking at PATH itself: which tools resolve, which PATH folders don't exist,
// and which entries are duplicated.

import { ErrorCode } from '../utils/errors.js';
import { ok, fail } from '../utils/result.js';
import { analyzePath, findOnPath } from '../system/environment.js';

const COMPILERS = ['g++', 'clang++']; // either one is fine
const REQUIRED = ['cmake', 'git'];
// Build tools CMake needs to drive the compiler. One of them is enough.
const BUILD_TOOLS = ['mingw32-make', 'ninja'];

export const checkPath = {
  name: 'checkPath',
  description:
    'Inspect the PATH environment variable: which C++ tools (g++, cmake, git, mingw32-make/ninja) resolve, ' +
    'plus PATH folders that do not exist and duplicate entries.',
  inputSchema: { type: 'object', properties: {} },
  sideEffects: 'none',

  async run(_input, ctx) {
    const lookup = (cmd) => findOnPath(cmd, { env: ctx.env, exists: ctx.exists });
    const resolved = Object.fromEntries([...COMPILERS, ...REQUIRED, ...BUILD_TOOLS].map((cmd) => [cmd, lookup(cmd)]));
    const analysis = analyzePath({ env: ctx.env, exists: ctx.exists });

    const warnings = [];
    if (!BUILD_TOOLS.some((t) => resolved[t])) {
      warnings.push('Neither mingw32-make nor ninja is on PATH; CMake will not be able to build with GCC.');
    }
    if (analysis.missingDirs.length) warnings.push(`${analysis.missingDirs.length} PATH folder(s) do not exist.`);
    if (analysis.duplicates.length) warnings.push(`${analysis.duplicates.length} duplicate PATH entr(ies).`);

    const data = {
      resolved,
      entryCount: analysis.entries.length,
      missingDirs: analysis.missingDirs,
      duplicates: analysis.duplicates,
      warnings,
    };

    const missing = REQUIRED.filter((cmd) => !resolved[cmd]);
    if (!COMPILERS.some((cmd) => resolved[cmd])) missing.unshift('g++');
    if (missing.length) {
      return fail('checkPath', ErrorCode.NOT_IN_PATH, `Not found on PATH: ${missing.join(', ')}.`, {
        hint: 'If these are installed, add their folders to PATH and open a new terminal; otherwise install them.',
        data: { ...data, missing },
      });
    }
    return ok('checkPath', data);
  },
};
