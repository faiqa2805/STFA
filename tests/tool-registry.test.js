import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createToolRegistry, validateInput } from '../src/tools/tool-registry.js';
import { createDefaultRegistry } from '../src/tools/index.js';
import { ok } from '../src/utils/result.js';

const echoTool = {
  name: 'echo',
  description: 'Echo the input',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' }, mode: { type: 'string', enum: ['a', 'b'] } },
    required: ['text'],
  },
  sideEffects: 'none',
  run: async (input) => ok('echo', { echoed: input.text }),
};

test('calls a registered tool and returns its result', async () => {
  const registry = createToolRegistry([echoTool]);
  const result = await registry.callTool('echo', { text: 'hi' });
  assert.deepEqual(result, { success: true, tool: 'echo', data: { echoed: 'hi' }, error: null });
});

test('unknown tool returns UNKNOWN_TOOL instead of throwing', async () => {
  const result = await createToolRegistry([]).callTool('rm -rf', {});
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'UNKNOWN_TOOL');
});

test('rejects malformed input before the tool runs', async () => {
  let ran = false;
  const registry = createToolRegistry([{ ...echoTool, run: async () => ((ran = true), ok('echo', {})) }]);

  for (const bad of [{}, { text: 5 }, { text: 'x', extra: 1 }, { text: 'x', mode: 'c' }, null, []]) {
    const result = await registry.callTool('echo', bad);
    assert.equal(result.error.code, 'INVALID_INPUT', `input ${JSON.stringify(bad)} should be invalid`);
  }
  assert.equal(ran, false);
});

test('a crashing tool becomes an INTERNAL_ERROR result', async () => {
  const registry = createToolRegistry([{ ...echoTool, run: async () => { throw new Error('boom'); } }]);
  const result = await registry.callTool('echo', { text: 'x' });
  assert.equal(result.error.code, 'INTERNAL_ERROR');
  assert.match(result.error.message, /boom/);
});

test('a tool returning a malformed result is caught', async () => {
  const registry = createToolRegistry([{ ...echoTool, run: async () => ({ hello: 'world' }) }]);
  const result = await registry.callTool('echo', { text: 'x' });
  assert.equal(result.error.code, 'UNEXPECTED_OUTPUT');
});

test('duplicate registration is an error', () => {
  assert.throws(() => createToolRegistry([echoTool, echoTool]), /already registered/);
});

test('validateInput accepts valid input', () => {
  assert.deepEqual(validateInput({ text: 'a', mode: 'b' }, echoTool.inputSchema), []);
});

test('default registry exposes every tool with schema and side-effect label', () => {
  const tools = createDefaultRegistry().listTools();
  const names = tools.map((t) => t.name);
  for (const expected of ['checkCompiler', 'checkCMake', 'checkGit', 'checkVSCode', 'checkPath', 'installCompiler', 'verifyCppCompilation']) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
  for (const t of tools) {
    assert.equal(t.inputSchema.type, 'object');
    assert.ok(['none', 'writes-files', 'installs-software'].includes(t.sideEffects));
  }
});
