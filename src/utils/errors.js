// Every failure in the project is described by one of these codes.
// Codes are for programs (tests, the agent's decision logic, a future LLM);
// messages and hints are for humans.

export const ErrorCode = {
  NOT_INSTALLED: 'NOT_INSTALLED',
  NOT_IN_PATH: 'NOT_IN_PATH',
  COMMAND_NOT_FOUND: 'COMMAND_NOT_FOUND',
  COMMAND_NOT_ALLOWED: 'COMMAND_NOT_ALLOWED',
  COMMAND_FAILED: 'COMMAND_FAILED',
  TIMEOUT: 'TIMEOUT',
  UNEXPECTED_OUTPUT: 'UNEXPECTED_OUTPUT',
  INVALID_INPUT: 'INVALID_INPUT',
  UNKNOWN_TOOL: 'UNKNOWN_TOOL',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INSTALL_FAILED: 'INSTALL_FAILED',
  INSTALLER_UNAVAILABLE: 'INSTALLER_UNAVAILABLE',
  COMPILE_FAILED: 'COMPILE_FAILED',
  CMAKE_CONFIGURE_FAILED: 'CMAKE_CONFIGURE_FAILED',
  CMAKE_BUILD_FAILED: 'CMAKE_BUILD_FAILED',
  RUN_FAILED: 'RUN_FAILED',
  UNSAFE_PATH: 'UNSAFE_PATH',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

// Default "what can I do next?" advice per code. Tools can override with a more
// specific hint when they know more.
const defaultHints = {
  NOT_INSTALLED: 'Run `cpp-agent setup` to install it, or install it manually (see docs/cpp-setup.md).',
  NOT_IN_PATH:
    'The program exists but Windows cannot find it by name. Add its folder to PATH, then open a NEW terminal.',
  COMMAND_NOT_ALLOWED: 'This is a safety block. The agent only runs a fixed list of known programs.',
  TIMEOUT: 'The command took too long. Try again; if it keeps happening, run it manually to see what it is waiting for.',
  PERMISSION_DENIED: 'Try running the terminal as Administrator, or install the tool for your user only.',
  INSTALLER_UNAVAILABLE:
    'winget (Windows Package Manager) is missing. Install "App Installer" from the Microsoft Store, then retry.',
  COMPILE_FAILED: 'Read the compiler output above. A broken or partial compiler install is the usual cause.',
  CMAKE_CONFIGURE_FAILED: 'CMake could not find a working compiler or build tool. Check that g++ and mingw32-make are on PATH.',
};

export function hintFor(code) {
  return defaultHints[code] ?? null;
}
