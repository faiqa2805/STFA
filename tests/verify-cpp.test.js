// verifyCppCompilation with a fake compiler. Files are written to a real temp
// folder (so the "only write where we own" logic is exercised), but no real
// compiler is needed.

import { fakeContext } from './helpers.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyCppCompilation, EXPECTED_OUTPUT, chooseGenerator } from '../src/tools/verify-cpp.js';
import { MARKER_FILE } from '../src/system/filesystem.js';

let projectDir;
beforeEach(() => {
  projectDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-agent-test-')), 'cpp-test');
});

// A fake machine where g++ "compiles" and the resulting exe "prints" `programOutput`.
function machine({ compileExit = 0, runResult, withCMake = true } = {}) {
  const bin = 'C:\\mingw\\bin';
  const run = runResult ?? { stdout: EXPECTED_OUTPUT + '\n' };
  return fakeContext({
    testProjectDir: projectDir,
    pathDirs: [bin],
    files: withCMake ? [`${bin}\\cmake.exe`, `${bin}\\mingw32-make.exe`] : [],
    programs: {
      'g++': { exitCode: compileExit, stderr: compileExit ? "main.cpp:1: error: 'cout' was not declared" : '' },
      [path.join(projectDir, 'hello-direct.exe')]: run,
      cmake: { stdout: 'ok' },
      [path.join(projectDir, 'build-mingw', 'hello.exe')]: run,
    },
  });
}

test('creates the project, compiles, runs, and builds with CMake', async () => {
  const ctx = machine();
  const result = await verifyCppCompilation.run({}, ctx);

  assert.equal(result.success, true, JSON.stringify(result.error));
  assert.equal(result.data.programOutput, EXPECTED_OUTPUT);
  assert.equal(result.data.directCompileVerified, true);
  assert.equal(result.data.cmakeVerified, true);
  assert.ok(fs.existsSync(path.join(projectDir, 'main.cpp')));
  assert.ok(fs.existsSync(path.join(projectDir, 'CMakeLists.txt')));
  assert.ok(fs.existsSync(path.join(projectDir, MARKER_FILE)));

  const cmakeConfigure = ctx.runCommand.calls.find((c) => c.command === 'cmake' && c.args.includes('-G'));
  assert.ok(cmakeConfigure.args.includes('MinGW Makefiles'));
});

test('skips the CMake stage with a warning when CMake is unavailable', async () => {
  const result = await verifyCppCompilation.run({}, machine({ withCMake: false }));
  assert.equal(result.success, true);
  assert.equal(result.data.cmakeVerified, false);
  assert.ok(result.data.warnings.some((w) => /CMake/.test(w)));
});

test('reports COMPILE_FAILED with compiler output', async () => {
  const result = await verifyCppCompilation.run({}, machine({ compileExit: 1 }));
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'COMPILE_FAILED');
  assert.match(result.error.details, /cout/);
  assert.equal(result.data.steps.at(-1).ok, false);
});

test('explains the classic "DLL not found" failure', async () => {
  const result = await verifyCppCompilation.run({}, machine({ runResult: { exitCode: 0xc0000135 } }));
  assert.equal(result.error.code, 'RUN_FAILED');
  assert.match(result.error.message, /DLL/);
  assert.match(result.error.hint, /PATH/);
});

test('detects unexpected program output', async () => {
  const result = await verifyCppCompilation.run({}, machine({ runResult: { stdout: 'something else' } }));
  assert.equal(result.error.code, 'UNEXPECTED_OUTPUT');
});

test('refuses to write into an existing folder it does not own', async () => {
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'my-important-file.txt'), 'do not touch');

  const ctx = machine();
  const result = await verifyCppCompilation.run({}, ctx);
  assert.equal(result.error.code, 'UNSAFE_PATH');
  assert.equal(ctx.runCommand.calls.length, 0);
  assert.deepEqual(fs.readdirSync(projectDir), ['my-important-file.txt']);
});

test('chooseGenerator prefers MinGW Makefiles, then Ninja, else null', () => {
  const ctx = (files) => fakeContext({ pathDirs: ['C:\\b'], files });
  assert.equal(chooseGenerator(ctx(['C:\\b\\mingw32-make.exe', 'C:\\b\\ninja.exe'])).generator, 'MinGW Makefiles');
  assert.equal(chooseGenerator(ctx(['C:\\b\\ninja.exe'])).generator, 'Ninja');
  assert.equal(chooseGenerator(ctx([])), null);
});
