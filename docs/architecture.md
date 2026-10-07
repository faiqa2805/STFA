# Architecture

This document explains how the project is put together and, more importantly,
**why**. No prior knowledge of agent architectures is assumed.

## The big idea: separate deciding from doing

An "AI agent" that changes your computer has two very different jobs:

1. **Deciding** what should happen ("CMake is missing, so it should be installed").
2. **Doing** it (running `winget install --id Kitware.CMake ...`).

Deciding can be fuzzy. It may involve an LLM that sometimes makes mistakes.
Doing must be precise and safe. So we split them into separate layers, and the
fuzzy layer can **only** act through a fixed menu of safe, well-tested tools.

```text
                    ┌───────────────┐
                    │     User      │
                    └───────┬───────┘
                            │  "Set up my machine for C++"
                            ▼
                    ┌───────────────┐
                    │      CLI      │  src/cli/cli.js
                    │ parse args,   │  - prints progress events
                    │ ask y/N       │  - asks permission to install
                    └───────┬───────┘
                            │  runAgent({ request, confirm, onEvent })
                            ▼
                    ┌───────────────┐       ┌───────────────┐
                    │     Agent     │──────>│  LLM (opt.)   │  src/llm/claude-client.js
                    │  understand   │<──────│ structured    │
                    │  plan, decide │       │ goal / explain│
                    │  report       │       └───────────────┘
                    └───────┬───────┘  src/agent/
                            │  registry.callTool('checkCMake', {})
                    ┌───────▼────────┐
                    │ Tool Registry  │  src/tools/tool-registry.js
                    │ validate input │  - unknown tool?   -> UNKNOWN_TOOL
                    │ log, catch     │  - bad input?      -> INVALID_INPUT
                    └───────┬────────┘  - tool crashed?   -> INTERNAL_ERROR
                            │
       ┌──────────┬─────────┼─────────┬──────────┬─────────────┐
       ▼          ▼         ▼         ▼          ▼             ▼
   checkCompiler checkCMake checkGit checkVSCode checkPath  install* / verifyCpp
       │          │         │         │          │             │
       └──────────┴─────────┼─────────┴──────────┴─────────────┘
                            │  ctx.runCommand('cmake', ['--version'])
                            ▼
                    ┌───────────────┐
                    │ System Layer  │  src/system/
                    │ command-runner│  - allowlist, no shell, timeouts
                    │ environment   │  - PATH lookup, registry PATH, admin check
                    │ filesystem    │  - write only inside owned folders
                    └───────┬───────┘
                            ▼
                       ┌─────────┐
                       │ Windows │
                       └─────────┘
```

## The layers, one by one

### 1. CLI (`src/cli/cli.js`)
The user interface, and nothing more. It turns command-line arguments into a call
to `runAgent`, prints the events the agent emits, and asks `[y/N]` when the agent
wants permission.

**Why it has no logic:** tomorrow the UI could be a web page, a VS Code extension
or an MCP server. If the logic lived in the CLI, we'd have to rewrite it. The
agent talks to the UI only through two callbacks: `onEvent` (progress) and
`confirm` (permission).

### 2. Agent (`src/agent/`)
The "brain". It runs this workflow:

```text
understand ─> plan ─> check ─> analyze ─┬─> (nothing missing) ───────────────┐
                                        └─> show install plan ─> confirm? ─┐ │
                                              no: skip   yes: install ─> re-check
                                                                           │ │
                                          verify (compile + run) <─────────┴─┘
                                                     │
                                                  report
```

- `understand.js` turns text into a **goal**: `{ intent, components, summary }`.
- `createPlan(goal)` turns the goal into a list of tool calls. It is a pure
  function, so it's easy to test and print.
- `runAgent` executes the plan, decides whether installs are needed and allowed,
  and builds the report.

**The agent never touches the system.** It has no `child_process`, no `fs`. If
you want to know everything it can possibly do, read the tool list.

### 3. Tools (`src/tools/`)
Each tool is a plain object:

```js
{
  name: 'checkCMake',
  description: 'Detect CMake and report its version...',
  inputSchema: { type: 'object', properties: {} },   // JSON Schema
  sideEffects: 'none',                                // or 'writes-files' / 'installs-software'
  run: async (input, ctx) => toolResult,
}
```

**Why tools?** A tool is a capability with a clear contract: known input, known
output, known side effects. That makes it testable, auditable and safe to put
behind an LLM. `inputSchema` uses JSON Schema because that's exactly what LLM
tool-calling APIs expect. `registry.listTools()` is ready to hand to a model.

**The registry** (`tool-registry.js`) is the single entry point: `callTool(name, input, ctx)`.
Every call is validated, logged and protected by try/catch. A buggy tool
produces an `INTERNAL_ERROR` result instead of crashing the agent.

### 4. System layer (`src/system/`)
The only code that talks to Windows.

- `command-runner.js` is the only place that starts processes. It enforces the
  allowlist, uses `shell: false`, applies timeouts and caps output size.
- `environment.js` handles PATH parsing, finding programs the way Windows does
  (PATH + PATHEXT), reading the persisted PATH from the registry, and the admin check.
- `filesystem.js` writes only inside folders the agent owns (marked with a
  `.created-by-cpp-agent` file) and never deletes.

**Why isolate it?** All the dangerous code sits in about 250 lines that
are easy to review. If you want to know "can this agent run `del`?", you
read one allowlist, not the whole codebase.

## How a tool call flows (with errors)

Follow `checkCMake` on a machine where CMake is missing:

```text
agent         registry.callTool('checkCMake', {}, ctx)
registry        validateInput({}, schema)               OK
                logger.info('Tool call', ...)
tool            checkProgram(ctx, { command: 'cmake', knownDirs: [...] })
system            runCommand('cmake', ['--version'])
                    allowlist? yes  ->  spawn  ->  ENOENT
                    returns { ok: false, error: { code: 'COMMAND_NOT_FOUND' } }   <- process result
tool              not found on PATH -> look in C:\Program Files\CMake\bin -> not there
                  returns fail('checkCMake', 'NOT_INSTALLED', 'CMake was not found.', { hint })  <- tool result
registry        isToolResult? yes -> log -> return
agent         findInstallable(results) -> ['cmake'] -> install plan -> confirm(...)
```

Notice the two result levels:

- **Process result** (system layer): low-level facts like exit code, stdout,
  `COMMAND_NOT_FOUND`.
- **Tool result** (tools layer): what those facts *mean*, like `NOT_INSTALLED`
  plus a hint.

Errors are never thrown across layers for expected situations. They are
**values** that flow upward. Only programming bugs throw, and the registry
catches those too.

### The tool result format

```js
{ success: true,  tool: 'checkGit', data: { installed: true, version: '2.45.1', ... }, error: null }
{ success: false, tool: 'checkCMake', data: null,
  error: { code: 'NOT_INSTALLED', message: 'CMake was not found.',
           hint: 'Run `cpp-agent setup` ...', details: null } }
```

- `code` is for programs: the agent branches on it, and tests assert it.
- `message` is what failed. `hint` is what to do next. `details` is raw output
  (compiler errors, for example).
- A failure can still carry `data`: "installed at X but not on PATH" is a failure
  with useful facts.

## Why `ctx` (the tool context)?

Tools receive `ctx` instead of importing the system layer directly:

```js
run(input, ctx) { const res = await ctx.runCommand('git', ['--version']); ... }
```

In the real app, `ctx.runCommand` is the real runner. In tests it's a fake that
pretends `git --version` printed `git version 2.45.1`. That's how the test suite
checks detection logic on any machine, with nothing installed. It's the only form
of "dependency injection" in the project: one plain object.

## Where the LLM fits

```text
"pls get me ready for c++"  ->  LLM (forced tool call: submit_goal)  ->  { intent, components, summary }
                                                                            │
                                                                validateGoal()  -- invalid? -> rules fallback
                                                                            │
                                                                      createPlan()  (code, not LLM)
```

The LLM produces **data**, never commands. Its output is validated against the
same enums the code uses, and anything else is rejected. The second LLM use,
explaining failures, only produces text for the human.

## Where the real agent loop will go (Week 3)

Today `runAgent` executes a **fixed** plan. A tool-calling agent replaces that
part with a loop:

```js
const history = [];
while (true) {
  const action = await llm.nextAction({ goal, history, tools: registry.listTools() });
  if (action.type === 'finish') break;
  if (tool(action.name).sideEffects !== 'none' && !(await confirm(action))) { history.push(declined); continue; }
  history.push(await registry.callTool(action.name, action.input, ctx));   // same call as today
}
```

Everything else stays: the registry still validates, tools still run only known
commands, `confirm` still gates side effects, and the result format is already
what the LLM reads. That's the payoff of the layering.

## Other future extension points

- **RAG (Week 2):** add a `searchDocs` tool, or retrieve relevant snippets from
  `docs/` before `explainWithLlm`.
- **MCP:** an MCP server is a thin adapter that exposes `registry.listTools()` and
  forwards calls to `registry.callTool()`.
- **Web UI:** implement `onEvent` and `confirm` over WebSocket/HTTP. The agent doesn't change.
- **Observability (Week 4):** the logger already writes JSON lines; route them to
  a log collector and add timings per tool.
