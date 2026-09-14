# AgentMaster tech stack

Status: draft

This document records the starting technical choices for AgentMaster. It is intentionally separate from the product README so the implementation can change without making the README noisy.

## Product assumptions

AgentMaster will start as a local-first tool for individual developers. The command-line interface is the primary product. The Electron application is an optional desktop client that uses the same underlying code.

The first supported platforms are macOS and Linux. Windows support can be added when it does not create a large maintenance burden. Otherwise, track it as a separate issue instead of making the first release wait for it.

The first version should manage:

- skills downloaded from local paths and Git-based sources;
- a user-selected canonical directory for the real skill files;
- links from that directory into the agent tools the user selects;
- user-selected `AGENTS.md` locations;
- creating, editing, listing, validating, removing, and linking skills and `AGENTS.md` files;
- safe previews, collision checks, backups, and a dry-run mode before files change.

## Confirmed product decisions

- The GUI will use the shared core package directly rather than depending on a globally installed CLI.
- The CLI will include an `agentmaster gui` command that opens the separately installed desktop app.
- Codex is the first target integration. Other agent tools can be added through target adapters after the prototype works.
- Global, project-scoped, and nested `AGENTS.md` files are all in scope.
- The prototype will accept local folders and Git URLs. Archive URLs and a skill registry can come later.
- Vite+ is not part of the starting toolchain.
- No `LICENSE` file will be added during the prototype phase.

## Recommended starting stack

| Area | Recommendation | Reason |
| --- | --- | --- |
| Repository | A pnpm workspace | Keeps the CLI, shared code, and desktop app in one repository without making Electron a CLI dependency. |
| Runtime | Node.js 24 LTS | One runtime for the CLI, shared code, build scripts, and Electron main process. The repository pins Node.js 24.21.0 in `.node-version`. |
| Language | TypeScript | Shared types can describe configuration, skill sources, targets, plans, and command results. |
| CLI | `commander` | Small, familiar, and sufficient for the first command tree. |
| Shared logic | A package named `@agentmaster/core` | The CLI and GUI should call the same file-management and configuration code. |
| Config validation | `zod` | Parse and validate configuration at the boundary, then use typed values internally. |
| Default app paths | Node's `os` and `path` modules, with a small platform path module | Keeps the default paths explicit and makes the user's configured storage path independent from application metadata. |
| Git and external commands | `execa` with argument arrays | Gives the CLI clear errors and avoids building shell command strings. |
| Desktop app | Electron + React + TypeScript | A practical UI stack for file browsers, editors, settings, and cross-platform desktop packaging. |
| Desktop build | Vite through Electron Forge | Provides a standard Electron development and packaging workflow. Recheck the Vite plugin status when bootstrapping. |
| Markdown editor | CodeMirror 6 | Lighter than Monaco and well suited to editing Markdown and frontmatter. |
| Tests | Vitest plus temporary-directory integration tests | Most risk sits in path handling, file writes, symlinks, and source downloads. Those should run without starting Electron. |
| Formatting and linting | Biome at first | One fast tool for formatting and common JavaScript/TypeScript checks. Move to ESLint plus Prettier only if the project needs their wider plugin ecosystem. |
| CI | GitHub Actions | Test the CLI on macOS and Linux, then build desktop artifacts on the target platforms. |
| Release artifacts | npm package for the CLI and platform installers for the GUI | Keeps the GUI optional and prevents Electron from bloating CLI installs. |

pnpm has built-in workspace support and a `workspace:` protocol for requiring local packages. Electron Forge also has a TypeScript/Vite template and handles packaging, makers, and publishing. Forge's current documentation says its Vite integration is experimental, so the first scaffold should verify that it works for this repository before we depend on it heavily.

## Repository layout

Start with a small number of packages. Add another package only when it has a separate build or release boundary.

```text
AgentMaster/
├── apps/
│   └── desktop/             # Optional Electron application
├── packages/
│   ├── core/                # Domain logic and public service interfaces
│   └── cli/                 # `agentmaster` command and terminal output
├── tests/
│   ├── fixtures/            # Small skills, AGENTS.md files, and target layouts
│   └── integration/         # Cross-package and filesystem scenarios
├── docs/                    # Design notes and future guides
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.json
└── README.md
```

The desktop app may eventually need a `packages/ui` package. Do not create it until more than one UI surface needs the same components.

## How the pieces should connect

The shared package should expose application operations rather than raw filesystem helpers. For example:

```text
CLI command ─┐
             ├── @agentmaster/core ── config and path resolution
GUI bridge ──┘                       ├─ source download and inspection
                                     ├─ canonical storage
                                     ├─ target adapters
                                     ├─ link/copy planning
                                     └─ validation and safe file changes
```

The CLI should be a thin adapter that turns arguments into core operations and renders results as human-readable text or JSON. The GUI should call the same operations through a narrow, typed preload bridge.

Avoid making the GUI depend on a globally installed `agentmaster` executable. That creates path, version, quoting, and installation problems. If the GUI needs to run a command, it should call the shared service layer. A subprocess adapter can be added later if compatibility with an independently installed CLI becomes a requirement.

## CLI options

### Command framework

| Option | Strengths | Costs | Recommendation |
| --- | --- | --- | --- |
| `commander` | Small API, good help output, easy to understand | We must decide our own conventions for command modules and errors | Use for v1 |
| `yargs` | Strong option parsing and mature conventions | More framework behavior to learn | Use if commands become heavily option-driven |
| `oclif` | Structured command plugins, generators, and a larger CLI architecture | More files and conventions for a small first release | Keep as a future option if third-party CLI plugins become central |

Add these CLI behaviors from the beginning:

- `--json` for scripts and editor integrations;
- `--dry-run` for link and removal operations, with the same preview contract applied to future file-changing commands;
- `--verbose` for source and path diagnostics;
- stable exit codes for validation, conflicts, missing sources, and permission errors;
- clear output showing the canonical path, target path, and whether a target is a symlink, copy, or unmanaged file;
- an interactive prompt only when the user did not supply enough information for a safe non-interactive operation.

An initial command shape could be:

```text
agentmaster init
agentmaster config show
agentmaster config set storage.root <path>
agentmaster skill add <source>
agentmaster skill list
agentmaster skill inspect <name>
agentmaster skill link <name> --target <agent>
agentmaster skill remove <name>
agentmaster agents list
agentmaster agents edit <scope>
agentmaster agents link <scope> --target <agent>
agentmaster doctor
agentmaster gui
```

The exact names can change. The important boundary is that commands describe intent and `@agentmaster/core` owns the rules.

### CLI distribution

Use a public npm package for the CLI, with an installed command named `agentmaster`. Keep Electron out of that package.

Possible installation paths:

```text
npm install --global @agentmaster/cli
pnpm add --global @agentmaster/cli
```

Later, add Homebrew or standalone binaries if installation friction becomes a real problem. Do not build those release paths before the command and configuration formats have settled.

## GUI options

### Renderer framework

| Option | Strengths | Costs | Recommendation |
| --- | --- | --- | --- |
| React + Vite | Large ecosystem, easy hiring and maintenance, good fit for a settings-heavy app | More dependencies than a minimal DOM app | Use for v1 |
| Svelte + Vite | Small, direct components and less runtime code | Smaller desktop-specific ecosystem and a different component model | Good alternative if the team already prefers Svelte |
| Vue + Vite | Mature component model and strong tooling | Adds a framework choice without a clear need here | Use only if there is existing Vue experience |

The first UI does not need a large component library. Use React, a small set of local components, and ordinary CSS or CSS Modules. Add a library such as Radix UI only when the application needs accessible menus, dialogs, popovers, or command palettes that are tedious to maintain by hand.

### Electron architecture

Use a normal Electron main process, a preload script, and a React renderer:

```text
Electron main process
  ├── creates windows
  ├── owns privileged filesystem operations through @agentmaster/core
  └── exposes a narrow typed API through preload

Preload script
  └── exposes explicit IPC methods

React renderer
  └── renders state and sends user actions through the preload API
```

Keep `contextIsolation` enabled, keep Node integration disabled in the renderer, and load only local packaged UI code. The renderer should never receive arbitrary shell access. These are especially important because AgentMaster displays content downloaded from sources that the user may not control.

### Editing experience

Start with CodeMirror 6 for Markdown editing and file previews.

Use Monaco instead if the main goal becomes a full VS Code-like editing experience with language services, multiple cursors, and a larger editor surface. Monaco is more capable, but it brings more weight and more integration work than the first release needs.

### Desktop packaging

Use Electron Forge for local development, packaging, and release configuration. Target these artifacts first:

- macOS: signed `.dmg` when signing credentials are available, plus a zip for testing;
- Linux: `.deb` and a portable archive first;
- Windows: add a Forge maker and CI job only after deciding whether the support cost is acceptable.

Signing, notarization, update delivery, and package repositories should be tracked as release work. They are not prerequisites for the first local development build.

## Optional GUI installation models

There are three practical models.

### Separate packages and installers, recommended

The repository contains the CLI, core package, and desktop app, but users install the products separately:

```text
CLI:  npm or pnpm package
GUI:  macOS or Linux desktop installer
```

The GUI depends on the shared core package, not on a separate CLI executable.

This keeps CLI installs small and makes the GUI genuinely optional. The tradeoff is that the CLI and GUI need a release policy so their versions remain compatible.

### Optional `agentmaster gui` command

The CLI can expose an `agentmaster gui` command that opens the desktop app when it is installed, or prints an installation message when it is not.

This gives users one familiar command without placing Electron in the CLI package. It needs a platform-aware way to find the installed app, so it should be added after the separate installers work.

### One npm package with an optional Electron dependency

The CLI package could declare Electron as an optional dependency. This gives one package name, but it can make installs much larger, complicate platform-specific dependencies, and make npm's optional-dependency behavior part of the user experience.

Do not use this model for v1 unless a single-package install is more important than a small, predictable CLI install.

## Vite+ decision

AgentMaster will use the conventional pnpm, Vite, and Electron Forge toolchain. It will not add Vite+ or a `vp` configuration during the prototype phase.

Vite+ may be worth reconsidering after the CLI and desktop build work, but it would not replace Electron or Electron Forge and is not needed to validate the product.

## Skill storage and links

Use two kinds of paths:

1. A canonical storage root chosen by the user. This contains the real skill directories and any managed `AGENTS.md` files.
2. Per-tool target paths. These are the locations used by Codex, Claude Code, Cursor, and other supported tools.

The configuration should map a named target to its skill and `AGENTS.md` locations. Do not hard-code every tool's path into the core logic. Store each integration as an adapter with detection, validation, and link rules.

The link planner should support:

- symlink mode, the default when the target tool follows symlinks;
- copy mode for tools or filesystems where symlinks are inconvenient;
- dry-run output before making changes;
- collision detection when a target already exists;
- an explicit backup or replace choice;
- a record of which targets AgentMaster manages;
- a repair or doctor command for broken links and manually changed targets.

Store managed-link records with each canonical skill. The records must include the target path and whether AgentMaster created a symlink or a copy, so removal can clean up both modes without guessing.

Use absolute paths after expanding `~`, environment variables, and platform defaults. Keep the user's configured canonical path separate from application metadata such as logs, cache, and downloaded archives.

For downloads, start with local directories and Git URLs. Record the source URL, selected revision, resolved commit when available, and a content hash. Treat downloaded skill content as untrusted text. Never execute scripts from a downloaded skill as part of installation.

## Configuration and metadata

Start with a JSON configuration file validated by `zod`. Keep the file machine-readable and let the CLI and GUI edit it. Add a documented JSON Schema if users will edit it by hand.

Example shape:

```json
{
  "storage": {
    "root": "~/Documents/AgentMaster",
    "linkMode": "symlink"
  },
  "targets": {
    "codex": {
      "skills": "~/.codex/skills",
      "agents": "~/.codex/AGENTS.md"
    }
  }
}
```

This is only a shape, not a final schema. The target paths and the treatment of scoped `AGENTS.md` files need product decisions first.

Do not add a database in v1. JSON configuration plus small local metadata files should cover the initial feature set. Consider SQLite later if the app needs full-text search, history, sync state, or a large source catalog.

## Testing and quality

Prioritize tests around the parts that can damage a user's setup:

- path expansion and platform defaults;
- source normalization and download failures;
- skill name collisions;
- symlink creation and repair;
- copy fallback behavior;
- refusal to overwrite unmanaged files;
- `AGENTS.md` scope discovery;
- `--dry-run` output;
- JSON output and exit codes.

Use temporary directories for filesystem tests. Add a small fixture for every supported agent target. Run the core and CLI test suites on macOS and Linux in GitHub Actions.

For the desktop app, begin with component tests and a small number of end-to-end tests for opening a workspace, changing storage settings, previewing a plan, and applying a safe link operation. Keep most behavior tests in `@agentmaster/core` so they do not require Electron.

## Release and maintenance choices

- Use GitHub Actions for tests and desktop builds.
- Use Changesets once the CLI and shared packages are published independently or need coordinated versioning.
- Keep the CLI and GUI versioned together until there is a reason to split their release schedules.
- Add code signing and notarization before public macOS distribution.
- Add a `SECURITY.md` before accepting downloads from arbitrary sources or enabling automatic updates.
- Do not add telemetry by default. If usage data becomes useful, make it opt-in and document exactly what leaves the machine.

## Decisions still needed

1. What are the exact default Codex skill and `AGENTS.md` paths? The user must be able to override them.
2. Should the repository publish npm packages under an `@agentmaster` scope, or should package names stay undecided until publication is closer?
3. Should Windows support be added to the first release or tracked as a separate issue after the macOS and Linux build is working?

## License status

No `LICENSE` file is included yet. This is intentional while AgentMaster remains a prototype. Revisit the decision before accepting outside contributions or distributing the CLI and desktop installers. Downloaded skills and other third-party content keep their own licenses.

## References

- [pnpm workspaces](https://pnpm.io/workspaces)
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron distribution overview](https://www.electronjs.org/docs/latest/tutorial/distribution-overview)
- [Electron Forge getting started](https://www.electronforge.io/)
- [Electron Forge Vite and TypeScript template](https://www.electronforge.io/templates/vite-+-typescript)
