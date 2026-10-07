// The agent: decides WHAT to do. It never touches the system itself; every
// action goes through `registry.callTool(...)`.
//
// V1 is a deterministic workflow:
//
//   understand -> plan -> check -> analyze -> (confirm -> install -> re-check) -> verify -> report
//
// It talks to the outside world only through three callbacks, which makes it
// usable from a CLI today and from a web UI / MCP server / test later:
//   onEvent(event)        progress updates (the CLI prints them)
//   confirm(installPlan)  ask the human before changing the machine -> true/false
//   llm                   optional language model (see llm/claude-client.js)
//
// WHERE A REAL AGENT LOOP GOES (Week 3):
// `executeSteps` walks a FIXED plan. An LLM-driven agent would replace it with:
//   while (!done) {
//     action = await llm.chooseNextTool(goal, history, registry.listTools())
//     result = await registry.callTool(action.name, action.input, ctx)   // same call as today
//     history.push(result)
//   }
// Tools, results, the registry and the confirmation gate stay exactly as they are.

import { understandRequest } from './understand.js';
import { ErrorCode } from '../utils/errors.js';

const CHECKS = {
  compiler: { tool: 'checkCompiler', label: 'Checking compiler', install: 'installCompiler' },
  cmake: { tool: 'checkCMake', label: 'Checking CMake', install: 'installCMake' },
  git: { tool: 'checkGit', label: 'Checking Git', install: 'installGit' },
  vscode: { tool: 'checkVSCode', label: 'Checking VS Code', install: 'installVSCode' },
};

/** Turn a goal into an ordered list of tool calls. Pure function: easy to test and to print. */
export function createPlan(goal) {
  if (goal.intent === 'unsupported') return [];
  const steps = goal.components.map((c) => ({ component: c, tool: CHECKS[c].tool, input: {}, label: CHECKS[c].label }));
  // PATH and the compile test are about the whole toolchain, so they only run
  // when the compiler is in scope (e.g. not for "do I have git?").
  if (goal.components.includes('compiler')) {
    steps.push({ component: 'path', tool: 'checkPath', input: {}, label: 'Checking PATH' });
    steps.push({ component: 'verify', tool: 'verifyCppCompilation', input: {}, label: 'Verifying C++ compilation' });
  }
  return steps;
}

/** Which failed checks can the agent fix by installing something? */
export function findInstallable(results) {
  return Object.entries(results)
    .filter(([component, r]) => CHECKS[component] && !r.success && r.error.code === ErrorCode.NOT_INSTALLED)
    .map(([component]) => component);
}

export async function runAgent({ request, mode = 'setup', registry, ctx, confirm = async () => false, onEvent = () => {}, llm = null }) {
  // 1. Understand
  const goal = await understandRequest(request, llm);
  onEvent({ type: 'goal', goal });
  if (goal.intent === 'unsupported') {
    const report = { ready: false, goal, results: {}, installs: [], problems: [], unsupported: true };
    onEvent({ type: 'report', report });
    return report;
  }
  const allowInstall = mode === 'setup' && goal.intent === 'setup';

  // 2. Plan
  const plan = createPlan(goal);
  onEvent({ type: 'plan', plan });
  const checkSteps = plan.filter((s) => s.tool !== 'verifyCppCompilation');
  const verifyStep = plan.find((s) => s.tool === 'verifyCppCompilation');

  // 3. Check
  const results = {};
  const executeSteps = async (steps, phase) => {
    for (const [i, step] of steps.entries()) {
      onEvent({ type: 'step-start', phase, index: i + 1, total: steps.length + (phase === 'check' && verifyStep ? 1 : 0), step });
      results[step.component] = await registry.callTool(step.tool, step.input, ctx);
      onEvent({ type: 'step-result', phase, step, result: results[step.component] });
    }
  };
  await executeSteps(checkSteps, 'check');

  // 4. Analyze + install (only with permission)
  const installs = [];
  const installable = findInstallable(results);
  if (installable.length && allowInstall) {
    // Plan: ask each install tool for a dry run so the user sees the exact commands.
    const installPlan = [];
    for (const component of installable) {
      const preview = await registry.callTool(CHECKS[component].install, { dryRun: true }, ctx);
      installPlan.push({ component, tool: CHECKS[component].install, preview: preview.data });
    }
    onEvent({ type: 'install-plan', installPlan });

    if (await confirm(installPlan)) {
      for (const item of installPlan) {
        onEvent({ type: 'install-start', item });
        const result = await registry.callTool(item.tool, {}, ctx);
        installs.push(result);
        onEvent({ type: 'install-result', item, result });
      }
      // Re-check everything that was touched, plus PATH.
      const recheck = checkSteps.filter((s) => installable.includes(s.component) || s.component === 'path');
      await executeSteps(recheck, 'recheck');
    } else {
      onEvent({ type: 'install-declined', installPlan });
    }
  } else if (installable.length) {
    onEvent({ type: 'install-skipped', components: installable, reason: mode === 'check' ? 'check mode' : 'request was check-only' });
  }

  // 5. Verify: only meaningful when a compiler is actually usable.
  if (verifyStep) {
    const total = checkSteps.length + 1;
    onEvent({ type: 'step-start', phase: 'check', index: total, total, step: verifyStep });
    if (results.compiler?.success) {
      results.verify = await registry.callTool('verifyCppCompilation', { compiler: results.compiler.data.compiler }, ctx);
    } else {
      results.verify = { success: false, tool: 'verifyCppCompilation', data: null, skipped: true, error: { code: 'SKIPPED', message: 'Skipped: no working compiler.', hint: null, details: null } };
    }
    onEvent({ type: 'step-result', phase: 'check', step: verifyStep, result: results.verify });
  }

  // 6. Report
  const report = buildReport(goal, results, installs);
  if (llm?.isEnabled() && report.problems.length) {
    report.explanation = await explainWithLlm(llm, report);
  }
  onEvent({ type: 'report', report });
  return report;
}

// checkPath reports commands by name; map them back to components.
const COMMAND_COMPONENT = { 'g++': 'compiler', cmake: 'cmake', git: 'git' };

export function buildReport(goal, results, installs) {
  // If checkPath only complains about tools whose own check already failed
  // (e.g. "cmake not on PATH" because CMake isn't installed), it's the same root
  // cause; report it once, with the more specific message.
  const pathIsRedundant =
    results.path?.error?.code === ErrorCode.NOT_IN_PATH &&
    results.path.data.missing.every((cmd) => results[COMMAND_COMPONENT[cmd]]?.success === false);

  const problems = Object.entries(results)
    .filter(([, r]) => !r.success && !r.skipped)
    .filter(([component]) => !(component === 'path' && pathIsRedundant))
    .map(([component, r]) => ({ component, tool: r.tool, ...r.error }));
  const warnings = Object.values(results).flatMap((r) => r.data?.warnings ?? []);

  const nextSteps = problems.map((p) => p.hint).filter(Boolean);
  if (installs.some((r) => r.success)) {
    nextSteps.push('Close and reopen your terminal (and VS Code) so they pick up the updated PATH.');
  }

  return {
    ready: problems.length === 0 && !results.verify?.skipped,
    goal,
    results,
    installs,
    problems,
    warnings,
    nextSteps: [...new Set(nextSteps)],
  };
}

async function explainWithLlm(llm, report) {
  try {
    return await llm.getText({
      system:
        'You help beginners fix their Windows C++ development environment. Be concise and concrete. ' +
        'Explain what failed, the likely cause, and the next steps. Do not invent tools or commands not implied by the data.',
      prompt: `Tool results from the setup agent:\n${JSON.stringify(report.problems, null, 2)}`,
      maxTokens: 600,
    });
  } catch (err) {
    return null; // explanation is a bonus; the rule-based hints are already in the report
  }
}
