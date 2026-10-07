// These tests start real processes, but only `node` itself, which is guaranteed
// to exist wherever the tests run. No compiler or installer needed.

import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createCommandRunner, runCommand } from '../src/system/command-runner.js';

const run = createCommandRunner({ allowedCommands: ['node', 'definitely-not-a-real-program-xyz'] });

test('runs an allowed command and captures stdout', async () => {
  const res = await run('node', ['-e', 'console.log("hello")']);
  assert.equal(res.ok, true);
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout.trim(), 'hello');
  assert.equal(res.error, null);
});

test('captures stderr and non-zero exit codes', async () => {
  const res = await run('node', ['-e', 'console.error("bad"); process.exit(3)']);
  assert.equal(res.ok, false);
  assert.equal(res.exitCode, 3);
  assert.equal(res.stderr.trim(), 'bad');
  assert.equal(res.error.code, 'COMMAND_FAILED');
});

test('blocks commands that are not on the allowlist', async () => {
  for (const cmd of ['powershell', 'cmd', 'del', 'C:\\Windows\\System32\\cmd.exe', '', '..\\node']) {
    const res = await run(cmd, ['/c', 'echo hi']);
    assert.equal(res.error.code, 'COMMAND_NOT_ALLOWED', `${cmd} should be blocked`);
  }
});

test('the default runner does not allow node, shells or arbitrary programs', async () => {
  for (const cmd of ['node', 'powershell', 'cmd', 'curl']) {
    const res = await runCommand(cmd, []);
    assert.equal(res.error.code, 'COMMAND_NOT_ALLOWED');
  }
});

test('missing program returns COMMAND_NOT_FOUND', async () => {
  const res = await run('definitely-not-a-real-program-xyz', []);
  assert.equal(res.error.code, 'COMMAND_NOT_FOUND');
});

test('shell metacharacters in arguments are passed as plain text', async () => {
  const res = await run('node', ['-e', 'console.log(process.argv[1])', 'a & echo INJECTED | more']);
  assert.equal(res.stdout.trim(), 'a & echo INJECTED | more');
});

test('kills commands that exceed the timeout', async () => {
  const res = await run('node', ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 300 });
  assert.equal(res.error.code, 'TIMEOUT');
});

test('rejects non-string arguments', async () => {
  const res = await run('node', [42]);
  assert.equal(res.error.code, 'INVALID_INPUT');
});

test('programs are allowed only inside allowed directories', async () => {
  const workspace = path.join(os.tmpdir(), 'cpp-agent-ws');
  const runner = createCommandRunner({ allowedCommands: [], allowedProgramDirs: [workspace] });

  const inside = await runner(path.join(workspace, 'hello.exe'), []);
  assert.notEqual(inside.error?.code, 'COMMAND_NOT_ALLOWED'); // allowed (it just doesn't exist)

  for (const p of [path.join(workspace, '..', 'evil.exe'), 'C:\\Windows\\notepad.exe', 'relative\\hello.exe']) {
    const res = await runner(p, []);
    assert.equal(res.error.code, 'COMMAND_NOT_ALLOWED', `${p} should be blocked`);
  }
});
