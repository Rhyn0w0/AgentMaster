# AgentMaster

AgentMaster is a local-first tool for managing agent skills and `AGENTS.md` files.

It gives you one place to store the real files, inspect and edit them, and link them into the agent tools you use. The command-line interface is the primary product. An optional Electron desktop app will provide the same operations in a graphical interface.

> AgentMaster is an early prototype. The repository now contains a runnable CLI and shared core package. The desktop client remains optional and is not wired into the bootstrap yet.

## Product

### The problem

Agent skills and instruction files tend to spread across tool-specific directories and project folders. It becomes difficult to answer simple questions:

- Which skills are installed?
- Which version is the real one?
- Which agent tools can see it?
- What will change if a link is repaired or removed?
- Which `AGENTS.md` file applies to this project?

AgentMaster will keep a canonical copy of each managed file in a location chosen by the user. It will then create links, or copies when needed, in the target locations used by supported agent tools.

### Prototype scope

The first working version will focus on:

- macOS and Linux;
- individual developers;
- Codex as the first agent integration;
- skills from local folders and Git URLs;
- global, project-scoped, and nested `AGENTS.md` files;
- user-selected storage locations;
- symlinks by default, with copy mode when a target needs it;
- dry runs, collision checks, backups, and a `doctor` command before broad automation;
- an optional desktop app that can be opened with `agentmaster gui` when installed.

Support for other agent tools will come after the Codex workflow is reliable. Windows will be added if the support cost stays small. Otherwise, it will be tracked separately.

### How it works

```text
skill source
    ↓
canonical AgentMaster storage
    ↓
planned file changes
    ↓
Codex targets and AGENTS.md locations
```

The CLI and GUI will use the same shared core package. The CLI will handle command parsing and terminal output. The GUI will call the shared operations through a typed Electron preload bridge.

AgentMaster will treat downloaded skills as untrusted text. Installing a skill will never execute scripts from that skill.

### Planned installation model

The CLI and GUI will be released separately:

```text
CLI:  npm package with the `agentmaster` command
GUI:  optional macOS and Linux desktop installer
```

The GUI will not require a globally installed CLI. Once the desktop app exists, `agentmaster gui` will open it when it can find the installation and will explain how to install it when it cannot.

### Roadmap

1. Define the core data model for sources, canonical storage, targets, links, and file scopes.
2. Build the Codex adapter and safe filesystem operations.
3. Add the first CLI commands and JSON output.
4. Add global, project, and nested `AGENTS.md` discovery and editing.
5. Build the optional Electron interface on top of the shared core.
6. Add adapters for other agent tools.
7. Decide whether archive sources, a skill registry, sync, or Windows support belong in the next release.

The implementation notes and technology decisions live in [techstack.md](./techstack.md).

## CLI usage

The CLI is available from the workspace with `pnpm dev` or after building with `pnpm build`.

### Initialize AgentMaster

```sh
agentmaster init
agentmaster config show
agentmaster config set storage.root ~/Documents/AgentMaster
```

`agentmaster init` creates the configuration file and the canonical storage directories. The storage root contains the real managed skills and `AGENTS.md` files. Target paths remain configurable, so the canonical files do not need to live inside a tool's directory. Pass `--config <path>` before a command to use a different configuration file.

### Manage skills

```sh
agentmaster skill add <local-folder-or-git-url>
agentmaster skill list
agentmaster skill inspect <name>
agentmaster skill link <name> --target codex
agentmaster skill remove <name> --yes
```

A link operation shows the canonical path, target path, and action. It refuses to overwrite an existing unmanaged target. AgentMaster records symlink and copy targets so a confirmed removal can clean up both. Use `--dry-run` before a link or removal, and `--yes` to confirm a removal.

### Manage `AGENTS.md` files

```sh
agentmaster agents list
```

`agentmaster agents list` reports global paths for every configured target, plus project and nested files. Editing and linking scoped `AGENTS.md` files remain part of the next implementation pass.

### Preview and diagnose changes

Link and removal operations support a dry run:

```sh
agentmaster skill link <name> --target codex --dry-run
agentmaster doctor
agentmaster skill list --json
```

The CLI also provides JSON output for scripts and editor integrations, stable exit codes for common failures, and path diagnostics through `doctor`.

Common failure exit codes are stable: `1` for unexpected operation failures, `2` for missing resources, `3` for invalid input or configuration, `4` for existing/conflicting resources, and `5` when confirmation is required.

### Open the desktop app

```sh
agentmaster gui
```

The command currently explains that the optional desktop app is not installed. It will open the desktop app after the Electron package is bootstrapped.

## Contributor setup

The repository is at the design and bootstrap stage. The shared core package and CLI are scaffolded; the desktop client is still optional.

### Prerequisites

- Node.js 24, as pinned in `.node-version`;
- pnpm;
- Git;
- macOS or Linux for the first supported development environments.

### Clone and install

```sh
git clone https://github.com/Rhyn0w0/AgentMaster.git
cd AgentMaster
pnpm install
```

The repository uses a pnpm workspace with this shape:

```text
apps/desktop/       # optional Electron application slot
packages/core/      # shared domain and filesystem operations
packages/cli/       # agentmaster command
tests/              # integration tests
```

### Development commands

The root commands are:

```sh
pnpm dev
pnpm test
pnpm check
pnpm build
```

Run `pnpm install` once after cloning. `pnpm dev` runs the CLI directly from TypeScript. The built executable is `packages/cli/dist/index.js` until the CLI is published.

Keep file-changing behavior in `packages/core`. The CLI and desktop app should remain adapters around that package. Test symlinks, path resolution, source downloads, collision handling, and `AGENTS.md` discovery in temporary directories rather than in a contributor's home directory.

### Contribution guidelines

- Keep Electron out of the CLI dependency tree.
- Do not execute code from downloaded skills.
- Show a dry-run plan before changing user files.
- Preserve unmanaged files unless the user explicitly chooses to replace them.
- Add a fixture and an integration test for every new target or file-scope rule.
- Update the README or `techstack.md` when a product or architecture decision changes.

## License status

AgentMaster does not have a `LICENSE` file yet. This is intentional while the project remains a prototype. Revisit the decision before inviting outside contributions or distributing the CLI or desktop app. Third-party skills and other downloaded content remain subject to their own licenses.
