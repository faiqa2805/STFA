// The "context" is everything a tool needs from the outside world, bundled into
// one plain object and passed to `tool.run(input, ctx)`.
//
// Why not just import the system modules inside each tool? Because then tests
// would have to run real programs. With a context object, a test can pass a fake
// `runCommand` that pretends g++ is installed (or missing) on any machine.
// That's the whole "dependency injection" story here: one object, no framework.

import fs from 'node:fs';
import { config } from '../config/config.js';
import { runCommand } from '../system/command-runner.js';
import { listDir } from '../system/filesystem.js';

export function createToolContext(overrides = {}) {
  return {
    runCommand,
    env: process.env, // read live so PATH refreshes after installs are visible
    exists: fs.existsSync,
    listDir,
    workspaceDir: config.workspaceDir,
    testProjectDir: config.testProjectDir,
    packages: config.packages,
    timeouts: config.timeouts,
    ...overrides,
  };
}
