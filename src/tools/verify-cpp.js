// verifyCppCompilation: the real proof that the environment works.
//
// Checking versions only proves programs exist. This tool proves they work
// together, by doing what a developer would do:
//
//   1. Create a tiny project (main.cpp + CMakeLists.txt) in the agent workspace
//   2. Compile it directly:        g++ main.cpp -o hello-direct.exe
//   3. Run it and check its output
//   4. Build it with CMake:        cmake -S . -B build-... -G "MinGW Makefiles"
//                                  cmake --build build-...
//   5. Run the CMake-built program and check its output
//
// Each step is recorded so the final report can show exactly where it failed.

import path from 'node:path';
import { ErrorCode } from '../utils/errors.js';
import { ok, fail } from '../utils/result.js';
import { claimDirectory, writeFileInside } from '../system/filesystem.js';
import { findOnPath } from '../system/environment.js';

export const EXPECTED_OUTPUT = 'C++ environment is working!';

export const MAIN_CPP = `#include <iostream>

int main() {
    std::cout << "${EXPECTED_OUTPUT}" << std::endl;
    return 0;
}
`;

export const CMAKE_LISTS = `cmake_minimum_required(VERSION 3.16)
project(CppAgentTest CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(hello main.cpp)
`;

// Windows status code when a program can't find a DLL it needs. With MinGW this
// almost always means libstdc++-6.dll etc. (in the compiler's bin folder) is not on PATH.
const STATUS_DLL_NOT_FOUND = 0xc0000135;

// Pick a CMake generator that works with GCC. "MinGW Makefiles" needs mingw32-make;
// "Ninja" needs ninja. Without either, CMake cannot build with GCC.
export function chooseGenerator(ctx) {
  const lookup = (cmd) => findOnPath(cmd, { env: ctx.env, exists: ctx.exists });
  if (lookup('mingw32-make')) return { generator: 'MinGW Makefiles', buildDir: 'build-mingw' };
  if (lookup('ninja')) return { generator: 'Ninja', buildDir: 'build-ninja' };
  return null;
}

function describeRunFailure(res) {
  if ((res.exitCode ?? 0) >>> 0 === STATUS_DLL_NOT_FOUND) {
    return {
      code: ErrorCode.RUN_FAILED,
      message: 'The program compiled but could not start: a required DLL was not found.',
      hint: "Add the compiler's bin folder (the one containing libstdc++-6.dll) to PATH, then open a new terminal.",
    };
  }
  return { code: ErrorCode.RUN_FAILED, message: `The compiled program failed (exit code ${res.exitCode}).`, hint: null };
}

export const verifyCppCompilation = {
  name: 'verifyCppCompilation',
  description:
    'Create a tiny C++ test project in the agent workspace, compile it directly and with CMake, run it, ' +
    'and check its output. Writes files only inside the agent workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      compiler: { type: 'string', enum: ['g++', 'clang++'], description: 'Compiler to use (default g++).' },
      useCMake: { type: 'boolean', description: 'Also build with CMake (default true).' },
    },
  },
  sideEffects: 'writes-files',

  async run({ compiler = 'g++', useCMake = true }, ctx) {
    const dir = ctx.testProjectDir;
    const steps = [];
    const warnings = [];
    const step = (name, res, extra = {}) => {
      const entry = {
        name,
        ok: res.ok,
        command: [res.command, ...(res.args ?? [])].join(' '),
        output: `${res.stdout ?? ''}${res.stderr ?? ''}`.trim(),
        ...extra,
      };
      steps.push(entry);
      return entry;
    };
    const failed = (code, message, opts = {}) =>
      fail('verifyCppCompilation', code, message, { ...opts, data: { projectDir: dir, steps, warnings } });

    // 1. Create the project (only inside a directory the agent owns).
    const claim = claimDirectory(dir);
    if (!claim.ok) return failed(ErrorCode.UNSAFE_PATH, claim.reason, { hint: 'Set CPP_AGENT_WORKSPACE to another folder.' });
    writeFileInside(dir, 'main.cpp', MAIN_CPP);
    writeFileInside(dir, 'CMakeLists.txt', CMAKE_LISTS);
    steps.push({ name: 'Create test project', ok: true, command: null, output: dir });

    // 2. Compile directly.
    const directExe = path.join(dir, 'hello-direct.exe');
    const compile = await ctx.runCommand(compiler, ['-std=c++17', 'main.cpp', '-o', directExe], {
      cwd: dir,
      timeoutMs: ctx.timeouts.compile,
    });
    step(`Compile with ${compiler}`, compile);
    if (!compile.ok) {
      return failed(
        compile.error?.code === ErrorCode.COMMAND_NOT_FOUND ? ErrorCode.NOT_INSTALLED : ErrorCode.COMPILE_FAILED,
        `Compiling the test program with ${compiler} failed.`,
        { details: compile.stderr || compile.error?.message },
      );
    }

    // 3. Run it.
    const run = await ctx.runCommand(directExe, [], { cwd: dir, timeoutMs: 10_000 });
    const runStep = step('Run compiled program', run);
    if (!run.ok) {
      const why = describeRunFailure(run);
      return failed(why.code, why.message, { hint: why.hint, details: runStep.output || run.error?.message });
    }
    if (!run.stdout.includes(EXPECTED_OUTPUT)) {
      return failed(ErrorCode.UNEXPECTED_OUTPUT, 'The test program ran but printed something unexpected.', {
        details: `Expected "${EXPECTED_OUTPUT}", got "${run.stdout.trim()}"`,
      });
    }

    // 4-5. Build and run with CMake.
    let cmakeVerified = false;
    if (!useCMake) {
      warnings.push('CMake build was skipped by request.');
    } else if (!findOnPath('cmake', { env: ctx.env, exists: ctx.exists })) {
      warnings.push('CMake is not available, so the CMake build was skipped.');
    } else {
      const gen = chooseGenerator(ctx);
      if (!gen) {
        warnings.push('CMake build skipped: neither mingw32-make nor ninja is on PATH.');
      } else {
        const buildDir = path.join(dir, gen.buildDir);
        const configure = await ctx.runCommand(
          'cmake',
          ['-S', dir, '-B', buildDir, '-G', gen.generator, `-DCMAKE_CXX_COMPILER=${compiler}`],
          { cwd: dir, timeoutMs: ctx.timeouts.compile },
        );
        step(`CMake configure (${gen.generator})`, configure);
        if (!configure.ok) {
          return failed(ErrorCode.CMAKE_CONFIGURE_FAILED, 'CMake could not configure the test project.', {
            details: configure.stderr || configure.stdout,
          });
        }

        const build = await ctx.runCommand('cmake', ['--build', buildDir], { cwd: dir, timeoutMs: ctx.timeouts.compile });
        step('CMake build', build);
        if (!build.ok) {
          return failed(ErrorCode.CMAKE_BUILD_FAILED, 'CMake configured the project but the build failed.', {
            details: build.stderr || build.stdout,
          });
        }

        const cmakeRun = await ctx.runCommand(path.join(buildDir, 'hello.exe'), [], { cwd: dir, timeoutMs: 10_000 });
        const cmakeRunStep = step('Run CMake-built program', cmakeRun);
        if (!cmakeRun.ok || !cmakeRun.stdout.includes(EXPECTED_OUTPUT)) {
          const why = cmakeRun.ok
            ? { code: ErrorCode.UNEXPECTED_OUTPUT, message: 'The CMake-built program printed something unexpected.', hint: null }
            : describeRunFailure(cmakeRun);
          return failed(why.code, why.message, { hint: why.hint, details: cmakeRunStep.output });
        }
        cmakeVerified = true;
      }
    }

    return ok('verifyCppCompilation', {
      projectDir: dir,
      compiler,
      programOutput: run.stdout.trim(),
      directCompileVerified: true,
      cmakeVerified,
      steps,
      warnings,
    });
  },
};
