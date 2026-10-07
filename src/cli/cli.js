#!/usr/bin/env node
// The CLI: parses arguments, asks the user questions, prints progress.
// It contains no setup logic; it just renders the agent's events.

import { parseArgs } from 'node:util';
import readline from 'node:readline/promises';
import { config } from '../config/config.js';
import { runAgent } from '../agent/agent.js';
import { createDefaultRegistry } from '../tools/index.js';
import { createToolContext } from '../tools/context.js';
import * as llm from '../llm/claude-client.js';

const HELP = `cpp-agent: set up and verify a C++ development environment on Windows

Usage:
  cpp-agent check  ["request"]            Inspect only. Never installs anything.
  cpp-agent setup  ["request"] [options]  Inspect, offer to install what's missing, verify.
  cpp-agent tools                         List the tools the agent can use.

Options:
  --yes        Install missing tools without asking (setup only)
  --dry-run    Show what would be installed, but don't install
  --json       Print the final report as JSON
  -h, --help   Show this help

Examples:
  cpp-agent check
  cpp-agent setup "Set up my machine for C++ development"
  cpp-agent setup "I only need cmake" --dry-run
`;

const OK = '✓'; // ✓
const BAD = '✗'; // ✗
const WARN = '!';
const pad = '      ';

function successLine(result) {
  const d = result.data ?? {};
  switch (result.tool) {
    case 'checkCompiler':
      return `${d.compiler} ${d.version ?? ''} detected (${d.path ?? 'on PATH'})`;
    case 'checkCMake':
      return `CMake ${d.version ?? ''} detected`;
    case 'checkGit':
      return `Git ${d.version ?? ''} detected`;
    case 'checkVSCode':
      return `VS Code ${d.version ?? ''} detected`;
    case 'checkPath':
      return 'Compiler, CMake and Git are available on PATH';
    default:
      return 'OK';
  }
}

function printResult(result) {
  if (result.tool === 'verifyCppCompilation' && result.data?.steps) {
    for (const s of result.data.steps.slice(1)) console.log(`${pad}${s.ok ? OK : BAD} ${s.name}`);
  } else if (result.success) {
    console.log(`${pad}${OK} ${successLine(result)}`);
  }
  if (!result.success) {
    console.log(`${pad}${BAD} ${result.error.message}`);
    if (result.error.details) console.log(indent(result.error.details, pad + '  '));
    if (result.error.hint) console.log(`${pad}  -> ${result.error.hint}`);
  }
  for (const w of result.data?.warnings ?? []) console.log(`${pad}${WARN} ${w}`);
}

function indent(text, prefix) {
  const lines = String(text).trim().split(/\r?\n/);
  const shown = lines.slice(0, 12);
  if (lines.length > shown.length) shown.push(`... (${lines.length - shown.length} more lines, see ${config.logFile})`);
  return shown.map((l) => prefix + l).join('\n');
}

function render(event, { json }) {
  if (json && event.type !== 'install-plan') return;
  switch (event.type) {
    case 'goal':
      console.log(`\nC++ Development Setup`);
      console.log(`Goal: ${event.goal.summary}  [understood via ${event.goal.source}]`);
      if (event.goal.llmError) console.log(`${WARN} LLM unavailable (${event.goal.llmError}); used built-in rules.`);
      console.log('');
      break;
    case 'step-start':
      console.log(`${event.phase === 'recheck' ? 'Re-check ' : ''}[${event.index}/${event.total}] ${event.step.label}...`);
      break;
    case 'step-result':
      printResult(event.result);
      break;
    case 'install-plan':
      console.log('\nThe following software is missing and can be installed with winget:');
      for (const { preview } of event.installPlan) {
        console.log(`  - ${preview.package}`);
        console.log(`      command: ${preview.command}`);
      }
      console.log('Installers may show their own license prompts or a Windows admin (UAC) prompt.');
      break;
    case 'install-start':
      console.log(`\nInstalling ${event.item.preview.package}...`);
      break;
    case 'install-result':
      printResult(event.result);
      if (event.result.success) console.log(`${pad}${OK} Installed ${event.item.preview.package}`);
      console.log('');
      break;
    case 'install-declined':
      console.log('Nothing was installed.\n');
      break;
    case 'install-skipped':
      console.log(`\n${WARN} Missing: ${event.components.join(', ')} (not installing: ${event.reason}). Run \`cpp-agent setup\` to install.\n`);
      break;
    case 'report':
      printReport(event.report);
      break;
  }
}

function printReport(report) {
  console.log('');
  if (report.unsupported) {
    console.log('Sorry, this agent only handles C++ development setup on Windows (compiler, CMake, Git, VS Code).');
    return;
  }
  if (report.ready) {
    console.log('C++ development environment is ready.');
    if (report.results.verify?.data) console.log(`Test project: ${report.results.verify.data.projectDir}`);
  } else {
    console.log('C++ development environment is NOT ready yet.\n');
    console.log('Problems:');
    for (const p of report.problems) console.log(`  ${BAD} [${p.component}] ${p.message}`);
    if (report.nextSteps.length) {
      console.log('\nWhat to do next:');
      report.nextSteps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
    }
  }
  if (report.explanation) console.log(`\nExplanation (AI):\n${report.explanation}`);
  console.log(`\nFull log: ${config.logFile}`);
}

async function askToInstall(installPlan, { yes, dryRun }) {
  if (dryRun) {
    console.log('(dry run: nothing will be installed)');
    return false;
  }
  if (yes) return true;
  if (!process.stdin.isTTY) {
    console.log('Not an interactive terminal, so not installing. Re-run with --yes to allow installs.');
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Install ${installPlan.length} package(s) now? [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      yes: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, ...rest] = positionals;

  if (values.help || !command || command === 'help') {
    console.log(HELP);
    return 0;
  }
  if (process.platform !== 'win32') {
    console.error('cpp-agent V1 supports Windows only.');
    return 1;
  }

  const registry = createDefaultRegistry();

  if (command === 'tools') {
    for (const t of registry.listTools()) console.log(`${t.name.padEnd(22)} [${t.sideEffects}]  ${t.description}`);
    return 0;
  }
  if (command !== 'check' && command !== 'setup') {
    console.error(`Unknown command "${command}".\n\n${HELP}`);
    return 1;
  }

  const report = await runAgent({
    request: rest.join(' '),
    mode: command,
    registry,
    ctx: createToolContext(),
    llm,
    onEvent: (event) => render(event, { json: values.json }),
    confirm: (plan) => askToInstall(plan, { yes: values.yes, dryRun: values['dry-run'] }),
  });

  if (values.json) console.log(JSON.stringify(report, null, 2));
  return report.ready ? 0 : 2;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`Unexpected error: ${err.message}`);
    console.error(err.stack);
    process.exitCode = 1;
  },
);
