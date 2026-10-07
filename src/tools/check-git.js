// checkGit: is Git installed and runnable?

import path from 'node:path';
import { checkProgram } from './check-program.js';

export const checkGit = {
  name: 'checkGit',
  description: 'Detect Git and report its version, or whether it is installed but missing from PATH.',
  inputSchema: { type: 'object', properties: {} },
  sideEffects: 'none',

  run(_input, ctx) {
    const programFiles = ctx.env.ProgramFiles ?? 'C:\\Program Files';
    const localAppData = ctx.env.LOCALAPPDATA ?? '';
    return checkProgram(ctx, {
      tool: 'checkGit',
      command: 'git',
      displayName: 'Git',
      knownDirs: [path.join(programFiles, 'Git', 'cmd'), path.join(localAppData, 'Programs', 'Git', 'cmd')],
    });
  },
};
