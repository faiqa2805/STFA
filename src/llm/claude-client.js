// Minimal client for the Anthropic Messages API, using Node's built-in fetch.
// No SDK dependency, so you can see the whole request and response.
//
// The LLM is OPTIONAL. Without ANTHROPIC_API_KEY, `isEnabled()` is false and
// the agent falls back to simple rules. Nothing in the project requires it.

import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

const API_URL = 'https://api.anthropic.com/v1/messages';

export function isEnabled() {
  return Boolean(config.llm.apiKey);
}

async function callMessages(body) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': config.llm.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: config.llm.model, ...body }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Anthropic API error ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return response.json();
}

/**
 * Structured output: force the model to answer by "calling" a tool whose input
 * schema is the shape we want. The API guarantees a JSON object back; we still
 * validate it ourselves (never trust model output blindly).
 */
export async function getStructured({ system, prompt, name, description, schema, maxTokens = 1024 }) {
  logger.info('LLM structured request', { name });
  const result = await callMessages({
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
    tools: [{ name, description, input_schema: schema }],
    tool_choice: { type: 'tool', name },
  });
  const toolUse = result.content?.find((block) => block.type === 'tool_use' && block.name === name);
  if (!toolUse) throw new Error('The model did not return structured output.');
  return toolUse.input;
}

/** Plain text completion. */
export async function getText({ system, prompt, maxTokens = 1024 }) {
  logger.info('LLM text request');
  const result = await callMessages({
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
  });
  return result.content
    ?.filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}
