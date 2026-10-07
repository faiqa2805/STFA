# C++ Development on Windows: what each piece does

This page explains the toolchain the agent sets up, for readers who have never
set up C++ on Windows before.

## The pieces at a glance

| Piece | What it is | Example command |
|---|---|---|
| **Compiler** | Turns `.cpp` source code into a `.exe` | `g++ main.cpp -o hello.exe` |
| **Build tool** | Runs the compiler for you, only on files that changed | `mingw32-make`, `ninja` |
| **CMake** | Describes a project once and generates build files for any build tool | `cmake -S . -B build` |
| **Git** | Version control for your source code | `git init`, `git commit` |
| **VS Code** | Editor; with the C/C++ extension it gives autocomplete and debugging | `code .` |
| **PATH** | The list of folders Windows searches when you type a command | `echo %PATH%` |

## The compiler

A C++ compiler reads your source code and produces machine code. On Windows the
main options are:

| Option | Pros | Cons |
|---|---|---|
| **GCC via MinGW-w64** (`g++`) | Single folder of `.exe` files; works from any terminal once on PATH; same compiler as Linux tutorials; small | Not the "native" Microsoft toolchain |
| MSVC (`cl.exe`) | Official Microsoft compiler, best Windows SDK integration | Needs Visual Studio Build Tools (several GB, admin install); only works inside a special "Developer Command Prompt" that sets many environment variables |
| Clang (`clang++`) | Great error messages | On Windows it still needs either MinGW or MSVC headers and libraries underneath |

**V1 default: GCC (MinGW-w64).** It's the simplest toolchain to install,
detect and verify from a plain terminal, which suits a first version. The agent
installs the **WinLibs** build via winget (`BrechtSanders.WinLibs.POSIX.UCRT`): a
standalone MinGW-w64 GCC that includes `g++`, `gdb` and `mingw32-make`. If you
already use **MSYS2** (`C:\msys64\ucrt64\bin`), the agent detects and uses that.

**UCRT vs MSVCRT:** UCRT is the modern Windows C runtime (Windows 10+). Choose
UCRT builds unless you have a reason not to.

## PATH: the #1 source of problems

When you type `g++`, Windows looks through every folder listed in the `PATH`
environment variable, in order, for `g++.exe` (trying each extension in `PATHEXT`).
If the compiler's folder isn't listed, you get:

```text
'g++' is not recognized as an internal or external command
```

…even though g++ is installed. That's why the agent separates **not installed**
from **installed but not on PATH**.

Two more PATH facts that confuse everyone:

1. **PATH changes don't reach already-open programs.** Installers save the new
   PATH in the registry; every terminal (and VS Code) opened *before* that keeps the
   old one. Fix: close and reopen them. (The agent reads the registry to refresh
   its *own* PATH, but it can't refresh your other windows.)
2. **Programs built by MinGW need its DLLs.** A program compiled with g++ uses
   `libstdc++-6.dll` and friends from the compiler's `bin` folder. If that folder
   isn't on PATH, the `.exe` builds fine but fails to start ("DLL not found",
   exit code `0xC0000135`). The agent recognises this exit code and tells you.

To add a folder to PATH manually: Start → "Edit environment variables for your
account" → `Path` → Edit → New → paste the folder (e.g. `C:\msys64\ucrt64\bin`) → OK.
Then open a new terminal.

## How compilation works

```text
main.cpp ──(preprocess: #include)──> (compile) ──> main.o ──(link + libraries)──> hello.exe
```

The single command `g++ -std=c++17 main.cpp -o hello.exe` does all of it. The
agent's first verification step is exactly this, followed by running
`hello.exe` and checking that it prints:

```text
C++ environment is working!
```

## How CMake fits in

Typing `g++` commands by hand stops scaling when a project has many files,
libraries and build options. CMake lets you **describe** the project once:

```cmake
cmake_minimum_required(VERSION 3.16)
project(CppAgentTest CXX)
set(CMAKE_CXX_STANDARD 17)
add_executable(hello main.cpp)
```

Building is then two steps:

```bash
cmake -S . -B build -G "MinGW Makefiles"
```
**Configure**: CMake finds the compiler, checks it works, and generates build
files (Makefiles) in `build/`.

```bash
cmake --build build
```
**Build**: runs the build tool (`mingw32-make`), which runs `g++`.

The `-G` ("generator") choice matters on Windows. CMake's default is Visual
Studio/MSVC, so with GCC you must pick a generator whose build tool exists:

- `MinGW Makefiles` needs `mingw32-make` (included in WinLibs and MSYS2's `mingw-w64-ucrt-x86_64-make`).
- `Ninja` needs `ninja`.

The agent picks whichever is available and passes `-DCMAKE_CXX_COMPILER=g++` so
CMake doesn't pick a different compiler by accident.

## Git

Git tracks changes to your code. It isn't needed to compile, but practically
every C++ project, tutorial and package manager (vcpkg, CMake `FetchContent`)
expects it. The agent installs **Git for Windows** (`Git.Git`), which also gives
you Git Bash.

## VS Code

VS Code is an editor, not a compiler. For C++ you'll want:

1. The **C/C++** extension (`ms-vscode.cpptools`) for IntelliSense and debugging.
2. Optionally **CMake Tools** (`ms-vscode.cmake-tools`) to configure and build CMake projects from the editor.

VS Code finds `g++` through PATH, so restart VS Code after changing PATH.

## Manual setup (if the agent can't install for you)

```bash
winget install --id BrechtSanders.WinLibs.POSIX.UCRT --exact
```

```bash
winget install --id Kitware.CMake --exact
```

```bash
winget install --id Git.Git --exact
```

```bash
winget install --id Microsoft.VisualStudioCode --exact
```

Without winget, download from the official sites: <https://winlibs.com>,
<https://cmake.org/download/>, <https://git-scm.com>, <https://code.visualstudio.com>.
Then open a new terminal and run `cpp-agent check`.
