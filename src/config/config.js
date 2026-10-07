// Central configuration. Everything comes from environment variables
// (optionally loaded from a .env file) with sensible defaults, so the agent
// works out of the box with zero setup.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Node >= 20.12 can read .env files natively, so we don't need the `dotenv` package.
const envFile = path.join(projectRoot, '.env');
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const workspaceDir = process.env.CPP_AGENT_WORKSPACE || path.join(os.homedir(), '.cpp-agent');

export const config = {
  projectRoot,

  // All files the agent creates live under this one directory. Keeping writes in
  // one place is a safety property: the agent never touches anything else on disk.
  workspaceDir,
  testProjectDir: path.join(workspaceDir, 'cpp-test'),
  logFile: path.join(workspaceDir, 'agent.log'),
  logLevel: process.env.LOG_LEVEL || 'info',

  llm: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  },

  // Fixed winget package IDs. The agent can only install these four packages.
  // WinLibs is a standalone MinGW-w64 (GCC) build; see docs/cpp-setup.md for why
  // GCC/MinGW is the V1 default instead of MSVC.
  packages: {
    compiler: { wingetId: 'BrechtSanders.WinLibs.POSIX.UCRT', label: 'GCC (MinGW-w64, WinLibs build)' },
    cmake: { wingetId: 'Kitware.CMake', label: 'CMake' },
    git: { wingetId: 'Git.Git', label: 'Git for Windows' },
    vscode: { wingetId: 'Microsoft.VisualStudioCode', label: 'Visual Studio Code' },
  },

  // Generous timeouts: winget installs can take minutes; checks should be quick.
  timeouts: {
    check: 15_000,
    compile: 120_000,
    install: 15 * 60_000,
  },
};
