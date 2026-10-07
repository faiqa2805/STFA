// The tool registry is the agent's "menu" of things it is allowed to do.
//
// A tool is a plain object:
//   {
//     name:        'checkGit',
//     description: 'what it does, written so an LLM could read it',
//     inputSchema: { type: 'object', properties: {...}, required: [...] },  // JSON Schema subset
//     sideEffects: 'none' | 'writes-files' | 'installs-software',
//     run:         async (input, ctx) => toolResult,
//   }
//
// The agent never calls `tool.run` directly. It calls `callTool(name, input)`,
// which is the single choke point where we:
//   1. reject unknown tool names
//   2. validate the input against the schema
//   3. log the call
//   4. catch crashes and turn them into normal failure results
//
// Why JSON Schema? It's exactly the format LLM tool-calling APIs expect. When the
// agent loop is added (Week 3), `listTools()` can be handed straight to the model.

import { ErrorCode } from '../utils/errors.js';
import { fail, isToolResult } from '../utils/result.js';
import { logger } from '../utils/logger.js';

export function createToolRegistry(tools = []) {
  const byName = new Map();

  function register(tool) {
    if (!tool?.name || typeof tool.run !== 'function') throw new Error('A tool needs a name and a run() function.');
    if (byName.has(tool.name)) throw new Error(`Tool "${tool.name}" is already registered.`);
    byName.set(tool.name, tool);
  }

  tools.forEach(register);

  async function callTool(name, input = {}, ctx = {}) {
    const tool = byName.get(name);
    if (!tool) return fail(name, ErrorCode.UNKNOWN_TOOL, `There is no tool named "${name}".`);

    const problems = validateInput(input, tool.inputSchema);
    if (problems.length) {
      return fail(name, ErrorCode.INVALID_INPUT, `Invalid input for ${name}: ${problems.join('; ')}`);
    }

    logger.info('Tool call', { tool: name, input });
    try {
      const result = await tool.run(input, ctx);
      if (!isToolResult(result)) {
        return fail(name, ErrorCode.UNEXPECTED_OUTPUT, `Tool ${name} returned a malformed result.`);
      }
      logger.info('Tool result', { tool: name, success: result.success, error: result.error?.code });
      return result;
    } catch (err) {
      // A bug inside a tool becomes an ordinary failure the agent can report,
      // instead of crashing the whole run.
      logger.error('Tool crashed', { tool: name, message: err.message, stack: err.stack });
      return fail(name, ErrorCode.INTERNAL_ERROR, `Tool ${name} crashed: ${err.message}`);
    }
  }

  return {
    register,
    callTool,
    getTool: (name) => byName.get(name) ?? null,
    listTools: () =>
      [...byName.values()].map(({ name, description, inputSchema, sideEffects }) => ({
        name,
        description,
        inputSchema,
        sideEffects,
      })),
  };
}

// A deliberately small JSON-Schema validator: object inputs whose properties are
// string / boolean / number, optionally with an enum. That's all our tools need.
// (A real project might use `ajv`; we avoid the dependency to keep things readable.)
export function validateInput(input, schema = { type: 'object', properties: {} }) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return ['input must be an object'];

  const problems = [];
  const props = schema.properties ?? {};

  for (const key of schema.required ?? []) {
    if (!(key in input)) problems.push(`"${key}" is required`);
  }
  for (const [key, value] of Object.entries(input)) {
    const spec = props[key];
    if (!spec) {
      problems.push(`unknown field "${key}"`);
      continue;
    }
    if (spec.type && typeof value !== spec.type) problems.push(`"${key}" must be a ${spec.type}`);
    else if (spec.enum && !spec.enum.includes(value)) problems.push(`"${key}" must be one of: ${spec.enum.join(', ')}`);
  }
  return problems;
}
