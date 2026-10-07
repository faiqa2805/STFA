// checkCMake: is CMake installed and runnable?

import path from 'node:path';
import { checkProgram } from './check-program.js';

export const checkCMake = {
  name: 'checkCMake',
  description: 'Detect CMake and report its version, or whether it is installed but missing from PATH.',
  inputSchema: { type: 'object', properties: {} },
  sideEffects: 'none',

  run(_input, ctx) {
    const programFiles = ctx.env.ProgramFiles ?? 'C:\\Program Files';
    return checkProgram(ctx, {
      tool: 'checkCMake',
      command: 'cmake',
      displayName: 'CMake',
      knownDirs: [path.join(programFiles, 'CMake', 'bin'), 'C:\\msys64\\ucrt64\\bin'],
    });
  },
};
