// Builds the registry with every tool the agent is allowed to use.
// To add a capability: write a tool module, then add it to this list.

import { createToolRegistry } from './tool-registry.js';
import { checkCompiler } from './check-compiler.js';
import { checkCMake } from './check-cmake.js';
import { checkGit } from './check-git.js';
import { checkVSCode } from './check-vscode.js';
import { checkPath } from './check-path.js';
import { installCompiler, installCMake, installGit, installVSCode } from './install-tools.js';
import { verifyCppCompilation } from './verify-cpp.js';

export function createDefaultRegistry() {
  return createToolRegistry([
    checkCompiler,
    checkCMake,
    checkGit,
    checkVSCode,
    checkPath,
    installCompiler,
    installCMake,
    installGit,
    installVSCode,
    verifyCppCompilation,
  ]);
}
