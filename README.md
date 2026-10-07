# cpp-agent: C++ Development Setup Agent for Windows

A small CLI agent that inspects a Windows machine, finds what is missing for C++
development, installs it (only with your permission), and then proves the setup
works by compiling and running a real C++ program.

```text
> cpp-agent setup "Set up my machine for C++ development"

C++ Development Setup
Goal: Set up the full C++ toolchain.  [understood via rules]

[1/6] Checking compiler...
      ✓ g++ 14.2.0 detected (C:\msys64\ucrt64\bin\g++.exe)
[2/6] Checking CMake...
      ✗ CMake was not found.
[3/6] Checking Git...
      ✓ Git 2.55.0 detected
[4/6] Checking VS Code...
      ✓ VS Code 1.140.0 detected
[5/6] Checking PATH...
      ✗ Not found on PATH: cmake.

The following software is missing and can be installed with winget:
  - CMake
      command: winget install --id Kitware.CMake --exact --source winget
Install 1 package(s) now? [y/N]
...
```

## Why this project exists

This is a **reference implementation** for learning AI engineering. It is a
small, complete example of the architecture behind real "agents that do
things": the agent decides, tools act, and a system layer touches the OS. Each
layer can be inspected and tested on its own.

It's deliberately small (about 1,600 lines of source, a large share of them
explanatory comments, plus tests) and has **zero npm dependencies**.

## What it does

1. **Understands** your request: rules by default, or an LLM if you configure one.
2. **Plans** which checks to run.
3. **Checks** the C++ compiler, CMake, Git, VS Code and PATH.
4. **Analyzes** results: missing, installed-but-not-on-PATH, or broken.
5. **Shows an install plan** with the exact commands, and asks before running anything.
6. **Installs** missing tools with `winget` (fixed package IDs only).
7. **Verifies**: creates `main.cpp` + `CMakeLists.txt`, compiles with g++, runs it,
   builds again with CMake, runs that, and checks the output.
8. **Reports** what's ready, what isn't, and what to do next.

## Architecture in one picture

```text
 User ──> CLI (src/cli) ──> Agent (src/agent) ──> Tool Registry ──> Tools ──> System layer ──> Windows
          prints events     understand/plan/      validate input,   checks,   processes,
          asks y/N          decide/report         log, catch errors install,  PATH, files
                            (optional LLM)                          verify
```

Full explanation: [docs/architecture.md](docs/architecture.md).
C++ toolchain background: [docs/cpp-setup.md](docs/cpp-setup.md).

## Available tools

| Tool | Side effects | What it does |
|---|---|---|
| `checkCompiler` | none | Finds g++ (or clang++); detects "installed but not on PATH" and broken installs |
| `checkCMake` | none | Finds CMake and its version |
| `checkGit` | none | Finds Git and its version |
| `checkVSCode` | none | Finds VS Code by its install folder (doesn't execute `code.cmd`) |
| `checkPath` | none | Which tools resolve on PATH, plus missing/duplicate PATH entries |
| `installCompiler` / `installCMake` / `installGit` / `installVSCode` | installs-software | `winget install` of one fixed package; supports `dryRun` |
| `verifyCppCompilation` | writes-files | Builds and runs a test project in the agent workspace |

Run `cpp-agent tools` to list them.

## Installation (fresh Windows machine)

1. **Install Node.js 20.12 or newer** (LTS) from <https://nodejs.org>, or:
   ```bash
   winget install OpenJS.NodeJS.LTS
   ```
   Open a **new** terminal afterwards so `node` is on PATH.
2. **Make sure `winget` exists** (it ships with Windows 10/11 as "App Installer"):
   ```bash
   winget --version
   ```
   If it's missing, install **App Installer** from the Microsoft Store.
3. **Get the project** and enter the folder (clone or copy it), then:
   ```bash
   npm test
   ```
4. Optionally make `cpp-agent` a global command:
   ```bash
   npm link
   ```
   Without `npm link`, use `node src/cli/cli.js` wherever this README says `cpp-agent`.

## Usage

```bash
cpp-agent check
```
Read-only. Never installs anything; still runs the compile test (in the agent workspace).

```bash
cpp-agent setup
```
Check, show the install plan, ask `[y/N]`, install, re-check, verify.

```bash
cpp-agent setup "I only need cmake" --dry-run
```
Show what would be installed without installing.

Other options: `--yes` (install without asking), `--json` (print the final report as JSON).

Exit codes: `0` = environment ready, `2` = not ready, `1` = usage or unexpected error.

## Configuration

Everything is optional. Copy `.env.example` to `.env` to change settings.

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | (empty) | Enables the LLM for request understanding and failure explanations |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model to use |
| `CPP_AGENT_WORKSPACE` | `%USERPROFILE%\.cpp-agent` | Where the test project and log file go |
| `LOG_LEVEL` | `info` | `debug` also prints log lines to the terminal |

### Where the LLM is used (and where it is not)

| Job | Who does it | Why |
|---|---|---|
| Interpret "set up my machine for C++" | LLM if configured, else keyword rules | Language is fuzzy; LLMs are good at it |
| Explain failures in plain words | LLM if configured, else built-in hints | Turning error data into advice is a language task |
| Is g++ installed? What version? | Deterministic code | It's a fact. An LLM would only add cost and risk. |
| Which command to run | Never the LLM | Commands are fixed inside tools |

The LLM returns **structured data** (a goal object), which the code validates.
If the result is invalid, the agent falls back to the rules. The LLM never
produces a shell command.

## Safety

- **No arbitrary commands.** The command runner only starts programs on a fixed
  allowlist (`g++`, `cmake`, `git`, `winget`, ...) plus executables the agent built
  inside its own workspace.
- **No shell.** Processes start with `shell: false` and arguments as an array, so
  `&`, `|` and `;` can't chain extra commands.
- **Plan, then execute.** Installs are first previewed (`dryRun`), shown to you,
  and only run after you answer `y` (or pass `--yes`). `check` mode never installs.
- **Fixed packages.** Each install tool maps to one hard-coded winget package ID.
- **No privilege escalation.** The agent never runs itself elevated. If an installer
  needs admin rights, Windows shows its own UAC prompt and you decide. If that
  fails, the agent explains the options.
- **No license auto-accept.** winget runs in your terminal so you see and answer its prompts.
- **Contained writes, no deletes.** Files are written only in the agent workspace,
  only in folders it created (marked with `.created-by-cpp-agent`). It never deletes anything.
- **Audit log.** Every command and tool call is recorded in `%USERPROFILE%\.cpp-agent\agent.log`.

## Known limitations

- **Windows only**, and only the GCC/MinGW toolchain is used for verification
  (clang++ is accepted if it's all you have; MSVC is detected but not used).
- **PATH is never modified automatically.** If a tool is installed but not on PATH,
  the agent tells you which folder to add. Editing PATH automatically is easy to
  get wrong and hard to undo, so V1 leaves it to you.
- **winget is required for installs.** Without it, the agent explains how to install manually.
- **Installs aren't tested automatically.** They depend on network, winget sources and
  UAC, so the unit tests mock them. The install path was reviewed but not run in CI.
- **Installs need an interactive terminal** (for winget's prompts), unless you pass `--yes`.
- **New terminals.** After an install, the agent refreshes its own PATH, but your
  existing terminals and VS Code must be restarted.
- **WinLibs via winget** puts command shortcuts in `WinGet\Links`. If a compiled
  program then fails with "DLL not found", add the WinLibs `mingw64\bin` folder to
  PATH; the agent detects this case and tells you.
- VS Code's **C/C++ extension** is recommended but not installed or checked.

## Project layout

```text
src/
  cli/cli.js              argument parsing, prompts, printing
  agent/agent.js          the workflow: plan -> check -> install -> verify -> report
  agent/understand.js     request -> structured goal (rules or LLM)
  llm/claude-client.js    tiny Anthropic Messages API client (fetch, no SDK)
  tools/                  one file per capability + registry + shared check logic
  system/                 command runner (allowlist), environment/PATH, filesystem
  config/config.js        env-based config, package IDs, timeouts
  utils/                  result format, error codes, logger
tests/                    node:test suites with a fake machine (no installs needed)
docs/                     architecture and C++ toolchain explanations
```

## Running the tests

```bash
npm test
```

Uses Node's built-in test runner. Tests describe fake machines ("g++ prints this
version", "these files exist"), so they pass whether or not your machine has a
compiler. The command-runner tests start real processes, but only `node` itself.

## Future extensions (course roadmap)

| Week | Topic | Where it plugs in |
|---|---|---|
| 1, Brain | Natural-language conversation | `agent/understand.js` already uses an LLM for intent; add multi-turn chat in the CLI |
| 2, Knowledge | RAG over setup docs | A `searchDocs` tool, or retrieve context in `explainWithLlm` (`agent/agent.js`) |
| 3, Hands | Tool calling + agent loop | Replace the fixed plan in `runAgent` with an LLM loop that calls `registry.callTool`; `listTools()` already emits JSON Schemas |
| 4, Launch | Logging, health checks, deployment | Structured JSON log already exists; add `cpp-agent doctor --json` as a health check; expose the registry over MCP |

Smaller improvements:
- Offer to add an "installed but not on PATH" folder to the user PATH (with confirmation and a backup).
- Install and check the VS Code C/C++ extension.
- Generate `.vscode/tasks.json` / `launch.json` for the test project.
- MSVC support via `vswhere` + `vcvarsall` environment capture.
- Optional Ninja install for faster CMake builds.
