// The agent with a fake tool registry: we test DECISIONS (what gets called,
// when installs happen, how results are reported), not real system behaviour.

import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent, createPlan, buildReport } from '../src/agent/agent.js';
import { understandWithRules, understandRequest } from '../src/agent/understand.js';
import { createToolRegistry } from '../src/tools/tool-registry.js';
import { ok, fail } from '../src/utils/result.js';

// --- understanding ------------------------------------------------------------

test('rules understand common requests', () => {
  const full = understandWithRules('Set up my machine for C++ development.');
  assert.equal(full.intent, 'setup');
  assert.deepEqual(full.components, ['compiler', 'cmake', 'git', 'vscode']);

  assert.deepEqual(understandWithRules('please install cmake').components, ['cmake']);
  assert.equal(understandWithRules('check if my compiler works').intent, 'check');
  assert.equal(understandWithRules('set up python for me').intent, 'unsupported');
  assert.deepEqual(understandWithRules('clone from github').components.length, 4, '"github" is not "git"');
});

test('LLM output is validated; invalid output falls back to rules', async () => {
  const goodLlm = { isEnabled: () => true, getStructured: async () => ({ intent: 'check', components: ['git'], summary: 'Check git.' }) };
  const good = await understandRequest('is git ok?', goodLlm);
  assert.equal(good.source, 'llm');
  assert.deepEqual(good.components, ['git']);

  const badLlm = { isEnabled: () => true, getStructured: async () => ({ intent: 'format_disk', components: ['C:'] }) };
  const fallback = await understandRequest('install cmake', badLlm);
  assert.equal(fallback.source, 'rules');
  assert.deepEqual(fallback.components, ['cmake']);
  assert.ok(fallback.llmError);

  const offline = await understandRequest('install cmake', { isEnabled: () => false });
  assert.equal(offline.source, 'rules');
});

test('createPlan builds ordered steps; compile test only when the compiler is in scope', () => {
  const full = createPlan({ intent: 'setup', components: ['compiler', 'cmake', 'git', 'vscode'] });
  assert.deepEqual(full.map((s) => s.tool), ['checkCompiler', 'checkCMake', 'checkGit', 'checkVSCode', 'checkPath', 'verifyCppCompilation']);
  assert.deepEqual(createPlan({ intent: 'check', components: ['git'] }).map((s) => s.tool), ['checkGit']);
  assert.deepEqual(createPlan({ intent: 'unsupported', components: [] }), []);
});

// --- the workflow -------------------------------------------------------------

// A fake registry where CMake starts missing and becomes present after install.
function fakeRegistry() {
  let cmakeInstalled = false;
  const calls = [];
  const tool = (name, run) => ({ name, description: name, inputSchema: { type: 'object', properties: { dryRun: { type: 'boolean' }, compiler: { type: 'string' } } }, sideEffects: 'none', run: async (input) => (calls.push({ name, input }), run(input)) });
  const registry = createToolRegistry([
    tool('checkCompiler', () => ok('checkCompiler', { compiler: 'g++', version: '14.2.0' })),
    tool('checkCMake', () => (cmakeInstalled ? ok('checkCMake', { version: '3.30.0' }) : fail('checkCMake', 'NOT_INSTALLED', 'CMake was not found.'))),
    tool('checkGit', () => ok('checkGit', { version: '2.45.1' })),
    tool('checkVSCode', () => ok('checkVSCode', { version: '1.95.0' })),
    tool('checkPath', () => (cmakeInstalled ? ok('checkPath', {}) : fail('checkPath', 'NOT_IN_PATH', 'Not found on PATH: cmake.', { data: { missing: ['cmake'] } }))),
    tool('installCMake', ({ dryRun }) => {
      if (!dryRun) cmakeInstalled = true;
      return ok('installCMake', { package: 'CMake', command: 'winget install --id Kitware.CMake', dryRun: Boolean(dryRun) });
    }),
    tool('verifyCppCompilation', () => ok('verifyCppCompilation', { steps: [], warnings: [] })),
  ]);
  return { registry, calls };
}

test('setup + user confirms: installs missing CMake, re-checks, verifies, reports ready', async () => {
  const { registry, calls } = fakeRegistry();
  const events = [];
  const report = await runAgent({ request: 'set up C++', mode: 'setup', registry, confirm: async () => true, onEvent: (e) => events.push(e.type) });

  assert.equal(report.ready, true);
  assert.deepEqual(calls.filter((c) => c.name === 'installCMake').map((c) => c.input), [{ dryRun: true }, {}]);
  assert.ok(events.includes('install-plan'));
  assert.equal(calls.filter((c) => c.name === 'checkCMake').length, 2, 'CMake re-checked after install');
  assert.deepEqual(calls.find((c) => c.name === 'verifyCppCompilation').input, { compiler: 'g++' });
});

test('setup + user declines: nothing is installed, report explains the problem once', async () => {
  const { registry, calls } = fakeRegistry();
  const report = await runAgent({ request: '', mode: 'setup', registry, confirm: async () => false });

  assert.equal(report.ready, false);
  assert.ok(!calls.some((c) => c.name === 'installCMake' && !c.input.dryRun));
  assert.deepEqual(report.problems.map((p) => p.component), ['cmake'], 'PATH problem is the same root cause, not repeated');
  assert.ok(report.nextSteps.length > 0);
});

test('check mode never installs and never even asks', async () => {
  const { registry, calls } = fakeRegistry();
  let asked = false;
  await runAgent({ request: '', mode: 'check', registry, confirm: async () => (asked = true) });
  assert.equal(asked, false);
  assert.ok(!calls.some((c) => c.name.startsWith('install')));
});

test('unsupported requests run no tools', async () => {
  const { registry, calls } = fakeRegistry();
  const report = await runAgent({ request: 'set up rust on linux', registry });
  assert.equal(report.unsupported, true);
  assert.equal(calls.length, 0);
});

test('verification is skipped (not faked) when there is no compiler', async () => {
  const registry = createToolRegistry([
    { name: 'checkCompiler', description: '', inputSchema: { type: 'object', properties: {} }, sideEffects: 'none', run: async () => fail('checkCompiler', 'NOT_INSTALLED', 'No compiler.') },
    { name: 'checkPath', description: '', inputSchema: { type: 'object', properties: {} }, sideEffects: 'none', run: async () => ok('checkPath', {}) },
    { name: 'verifyCppCompilation', description: '', inputSchema: { type: 'object', properties: {} }, sideEffects: 'none', run: async () => { throw new Error('must not run'); } },
  ]);
  const report = await runAgent({ request: 'check my compiler', mode: 'check', registry });
  assert.equal(report.ready, false);
  assert.equal(report.results.verify.skipped, true);
});

test('buildReport surfaces warnings and restart advice after installs', () => {
  const report = buildReport(
    { intent: 'setup', components: ['git'] },
    { git: ok('checkGit', { warnings: ['heads up'] }) },
    [ok('installGit', {})],
  );
  assert.equal(report.ready, true);
  assert.deepEqual(report.warnings, ['heads up']);
  assert.ok(report.nextSteps.some((s) => /reopen your terminal/.test(s)));
});
