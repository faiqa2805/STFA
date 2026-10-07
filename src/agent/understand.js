// Step 1 of the agent: turn a free-text request into a structured GOAL.
//
//   "Set up my machine for C++"  ->  { intent: 'setup', components: [all four] }
//   "do I have cmake?"           ->  { intent: 'check', components: ['cmake'] }
//   "install python"             ->  { intent: 'unsupported', ... }
//
// Two implementations with the SAME output shape:
//   - rules:  keyword matching. Offline, free, predictable. Always available.
//   - LLM:    understands any phrasing. Used only when an API key is configured.
// Whatever the LLM returns is validated; if it's malformed we fall back to rules.
// This "LLM proposes, code validates" pattern is the core safety idea for
// putting an LLM in front of real actions.

export const COMPONENTS = ['compiler', 'cmake', 'git', 'vscode'];
export const INTENTS = ['setup', 'check', 'unsupported'];

const GOAL_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: INTENTS,
      description:
        'setup = check and install missing C++ tools; check = inspect only, never install; ' +
        'unsupported = anything outside C++ development setup on Windows.',
    },
    components: {
      type: 'array',
      items: { type: 'string', enum: COMPONENTS },
      description: 'Which tools the user cares about. Use all four for a general C++ setup request.',
    },
    summary: { type: 'string', description: 'One sentence restating the goal for the user.' },
  },
  required: ['intent', 'components', 'summary'],
};

const SYSTEM_PROMPT = `You classify requests for a Windows C++ development setup assistant.
The assistant can only check/install: a C++ compiler (GCC/MinGW), CMake, Git and VS Code, and verify that C++ code compiles.
Anything else (other languages, Linux/macOS, unrelated tasks) is "unsupported".`;

const KEYWORDS = {
  compiler: ['compiler', 'gcc', 'g++', 'mingw', 'clang'],
  cmake: ['cmake'],
  git: ['git'],
  vscode: ['vs code', 'vscode', 'visual studio code', 'editor'],
};
const CHECK_WORDS = ['check', 'verify', 'inspect', 'status', 'do i have', 'is my', 'is there', 'what is installed', 'detect'];
const UNSUPPORTED_WORDS = ['python', 'java ', 'rust', 'linux', 'macos', 'mac os', 'ubuntu', 'docker', 'node.js'];

export function understandWithRules(request) {
  const text = ` ${(request ?? '').toLowerCase()} `;

  if (UNSUPPORTED_WORDS.some((w) => text.includes(w)) && !text.includes('c++')) {
    return { intent: 'unsupported', components: [], summary: 'This request is outside C++ setup on Windows.', source: 'rules' };
  }

  // `\bgit\b` so that "github" or "digit" don't count as Git.
  const mentioned = COMPONENTS.filter((c) =>
    KEYWORDS[c].some((k) => (k === 'git' ? /\bgit\b/.test(text) : text.includes(k))),
  );
  const components = mentioned.length ? mentioned : [...COMPONENTS];
  const intent = CHECK_WORDS.some((w) => text.includes(w)) ? 'check' : 'setup';

  return {
    intent,
    components,
    summary: `${intent === 'check' ? 'Check' : 'Set up'} ${components.length === COMPONENTS.length ? 'the full C++ toolchain' : components.join(', ')}.`,
    source: 'rules',
  };
}

export function validateGoal(goal) {
  return (
    goal !== null &&
    typeof goal === 'object' &&
    INTENTS.includes(goal.intent) &&
    Array.isArray(goal.components) &&
    goal.components.every((c) => COMPONENTS.includes(c)) &&
    typeof goal.summary === 'string'
  );
}

/**
 * @param {string} request  what the user typed
 * @param {object} llm      the claude-client module (or a fake in tests)
 */
export async function understandRequest(request, llm) {
  if (!request?.trim()) {
    return { intent: 'setup', components: [...COMPONENTS], summary: 'Set up the full C++ toolchain.', source: 'default' };
  }
  if (!llm?.isEnabled()) return understandWithRules(request);

  try {
    const goal = await llm.getStructured({
      system: SYSTEM_PROMPT,
      prompt: request,
      name: 'submit_goal',
      description: 'Submit the structured interpretation of the user request.',
      schema: GOAL_SCHEMA,
    });
    if (!validateGoal(goal)) throw new Error('LLM returned an invalid goal');
    if (goal.intent !== 'unsupported' && goal.components.length === 0) goal.components = [...COMPONENTS];
    return { ...goal, components: [...new Set(goal.components)], source: 'llm' };
  } catch (err) {
    const goal = understandWithRules(request);
    return { ...goal, llmError: err.message };
  }
}
