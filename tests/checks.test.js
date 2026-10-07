// Detection tools against fake machines.

import { fakeContext } from './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCompiler } from '../src/tools/check-compiler.js';
import { checkCMake } from '../src/tools/check-cmake.js';
import { checkGit } from '../src/tools/check-git.js';
import { checkVSCode } from '../src/tools/check-vscode.js';
import { checkPath } from '../src/tools/check-path.js';
import { parseVersion } from '../src/tools/check-program.js';

const GXX_OUTPUT = 'g++.exe (Rev2, Built by MSYS2 project) 14.2.0\nCopyright (C) 2024 Free Software Foundation, Inc.';
const MINGW_BIN = 'C:\\msys64\\ucrt64\\bin';

test('parseVersion handles real-world version strings', () => {
  assert.equal(parseVersion(GXX_OUTPUT), '14.2.0');
  assert.equal(parseVersion('g++.exe (MinGW-W64 x86_64-ucrt-posix-seh, built by Brecht Sanders, r1) 14.2.0'), '14.2.0');
  assert.equal(parseVersion('cmake version 3.29.2\n\nCMake suite maintained by Kitware'), '3.29.2');
  assert.equal(parseVersion('git version 2.45.1.windows.1'), '2.45.1');
  assert.equal(parseVersion('clang version 18.1'), '18.1');
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion('no digits here'), null);
});

// --- compiler ---------------------------------------------------------------

test('checkCompiler detects g++ with version and path', async () => {
  const ctx = fakeContext({
    programs: { 'g++ --version': { stdout: GXX_OUTPUT } },
    pathDirs: [MINGW_BIN],
    files: [`${MINGW_BIN}\\g++.exe`],
  });
  const result = await checkCompiler.run({}, ctx);
  assert.equal(result.success, true);
  assert.equal(result.data.compiler, 'g++');
  assert.equal(result.data.version, '14.2.0');
  assert.equal(result.data.path, `${MINGW_BIN}\\g++.exe`);
  assert.equal(result.error, null);
});

test('checkCompiler falls back to clang++ when g++ is missing', async () => {
  const ctx = fakeContext({ programs: { 'clang++ --version': { stdout: 'clang version 18.1.8' } } });
  const result = await checkCompiler.run({}, ctx);
  assert.equal(result.success, true);
  assert.equal(result.data.compiler, 'clang++');
  assert.equal(result.data.family, 'clang');
});

test('checkCompiler reports NOT_IN_PATH when MinGW exists in a known folder', async () => {
  const ctx = fakeContext({ files: [`${MINGW_BIN}\\g++.exe`] }); // installed, PATH empty
  const result = await checkCompiler.run({}, ctx);
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'NOT_IN_PATH');
  assert.equal(result.data.location, `${MINGW_BIN}\\g++.exe`);
  assert.match(result.error.hint, /ucrt64\\bin/);
});

test('checkCompiler reports NOT_INSTALLED with a hint when nothing exists', async () => {
  const result = await checkCompiler.run({}, fakeContext());
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'NOT_INSTALLED');
  assert.ok(result.error.hint);
});

test('checkCompiler reports a broken g++ that exists but fails to run', async () => {
  const ctx = fakeContext({ programs: { 'g++ --version': { exitCode: 1, stderr: 'missing cc1plus' } } });
  const result = await checkCompiler.run({}, ctx);
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'COMMAND_FAILED');
  assert.match(result.error.details, /cc1plus/);
});

// --- cmake / git --------------------------------------------------------------

test('checkCMake detects CMake', async () => {
  const ctx = fakeContext({ programs: { 'cmake --version': { stdout: 'cmake version 3.29.2' } } });
  const result = await checkCMake.run({}, ctx);
  assert.equal(result.success, true);
  assert.equal(result.data.version, '3.29.2');
});

test('checkCMake: missing vs installed-but-not-on-PATH', async () => {
  assert.equal((await checkCMake.run({}, fakeContext())).error.code, 'NOT_INSTALLED');

  const ctx = fakeContext({ files: ['C:\\Program Files\\CMake\\bin\\cmake.exe'] });
  const result = await checkCMake.run({}, ctx);
  assert.equal(result.error.code, 'NOT_IN_PATH');
  assert.equal(result.data.installed, true);
});

test('checkGit detects Git and reports when missing', async () => {
  const found = await checkGit.run({}, fakeContext({ programs: { 'git --version': { stdout: 'git version 2.45.1.windows.1' } } }));
  assert.equal(found.success, true);
  assert.equal(found.data.version, '2.45.1');

  const missing = await checkGit.run({}, fakeContext());
  assert.equal(missing.error.code, 'NOT_INSTALLED');
});

// --- vscode -------------------------------------------------------------------

test('checkVSCode finds the install via PATH and reads the version from package.json', async () => {
  const dir = 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code';
  const ctx = fakeContext({
    pathDirs: [`${dir}\\bin`],
    files: [`${dir}\\bin\\code.cmd`, `${dir}\\Code.exe`, `${dir}\\resources\\app\\package.json`],
    readFile: () => JSON.stringify({ version: '1.95.0' }),
  });
  const result = await checkVSCode.run({}, ctx);
  assert.equal(result.success, true);
  assert.equal(result.data.version, '1.95.0');
  assert.equal(result.data.inPath, true);
  assert.equal(ctx.runCommand.calls.length, 0, 'must not execute code.cmd');
});

test('checkVSCode reports NOT_INSTALLED', async () => {
  const result = await checkVSCode.run({}, fakeContext());
  assert.equal(result.error.code, 'NOT_INSTALLED');
});

// --- PATH -----------------------------------------------------------------------

test('checkPath succeeds when the toolchain resolves, and flags PATH problems', async () => {
  const ctx = fakeContext({
    pathDirs: [MINGW_BIN, 'C:\\cmake\\bin', 'C:\\git\\cmd', 'C:\\git\\cmd\\'],
    files: [`${MINGW_BIN}\\g++.exe`, `${MINGW_BIN}\\mingw32-make.exe`, 'C:\\cmake\\bin\\cmake.exe', 'C:\\git\\cmd\\git.exe'],
    env: { PATH: [MINGW_BIN, 'C:\\cmake\\bin', 'C:\\git\\cmd', 'C:\\git\\cmd\\', 'C:\\gone'].join(';') },
  });
  const result = await checkPath.run({}, ctx);
  assert.equal(result.success, true);
  assert.equal(result.data.resolved['g++'], `${MINGW_BIN}\\g++.exe`);
  assert.deepEqual(result.data.missingDirs, ['C:\\gone']);
  assert.equal(result.data.duplicates.length, 1);
});

test('checkPath fails with NOT_IN_PATH listing what is missing', async () => {
  const ctx = fakeContext({ pathDirs: ['C:\\git\\cmd'], files: ['C:\\git\\cmd\\git.exe'] });
  const result = await checkPath.run({}, ctx);
  assert.equal(result.error.code, 'NOT_IN_PATH');
  assert.deepEqual(result.data.missing, ['g++', 'cmake']);
  assert.ok(result.data.warnings.some((w) => /mingw32-make/.test(w)));
});
