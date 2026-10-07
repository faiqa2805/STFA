import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ok, fail, isToolResult } from '../src/utils/result.js';
import { interpretWingetExit, wingetInstallArgs, installCMake } from '../src/tools/install-tools.js';
import { fakeContext } from './helpers.js';

test('ok() and fail() produce the standard shape', () => {
  assert.deepEqual(ok('checkGit', { installed: true }), { success: true, tool: 'checkGit', data: { installed: true }, error: null });

  const f = fail('checkCMake', 'NOT_INSTALLED', 'CMake was not found.');
  assert.equal(f.success, false);
  assert.equal(f.data, null);
  assert.deepEqual(Object.keys(f.error).sort(), ['code', 'details', 'hint', 'message']);
  assert.ok(f.error.hint, 'known codes get a default hint');
});

test('fail() lets a tool override the hint and attach data', () => {
  const f = fail('x', 'NOT_IN_PATH', 'msg', { hint: 'custom', data: { location: 'C:\\a' } });
  assert.equal(f.error.hint, 'custom');
  assert.equal(f.data.location, 'C:\\a');
});

test('isToolResult recognises valid and invalid results', () => {
  assert.equal(isToolResult(ok('t', {})), true);
  assert.equal(isToolResult(fail('t', 'X', 'm')), true);
  assert.equal(isToolResult({ success: true, tool: 't' }), false);
  assert.equal(isToolResult({ success: false, tool: 't', data: null, error: null }), false);
  assert.equal(isToolResult(null), false);
});

test('winget exit codes are interpreted (including "already installed")', () => {
  assert.equal(interpretWingetExit(0).ok, true);
  assert.equal(interpretWingetExit(0x8a150061).ok, true); // already installed
  assert.equal(interpretWingetExit(-1978335135).ok, true); // same code, signed
  assert.equal(interpretWingetExit(740).code, 'PERMISSION_DENIED');
  assert.equal(interpretWingetExit(1).code, 'INSTALL_FAILED');
  assert.match(interpretWingetExit(0x8a150099).message, /0x8A150099/);
});

test('install tools only ever build fixed winget commands', () => {
  assert.deepEqual(wingetInstallArgs('Kitware.CMake'), ['install', '--id', 'Kitware.CMake', '--exact', '--source', 'winget']);
});

test('install dry run plans without running anything', async () => {
  const ctx = fakeContext();
  const result = await installCMake.run({ dryRun: true }, ctx);
  assert.equal(result.success, true);
  assert.equal(result.data.dryRun, true);
  assert.match(result.data.command, /winget install --id Kitware\.CMake/);
  assert.equal(ctx.runCommand.calls.length, 0);
});

test('install reports INSTALLER_UNAVAILABLE without winget', async () => {
  const result = await installCMake.run({}, fakeContext());
  assert.equal(result.error.code, 'INSTALLER_UNAVAILABLE');
});
