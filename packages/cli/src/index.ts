#!/usr/bin/env node
import {
  AgentMasterError,
  addSkill,
  asAgentMasterError,
  discoverAgents,
  doctor,
  type ErrorCode,
  initializeConfig,
  inspectSkill,
  linkSkill,
  listSkills,
  loadConfig,
  removeSkill,
  resolveConfig,
  setConfigValue,
  writeConfig,
} from "@agentmaster/core";
import { Command } from "commander";

interface CommandOptions {
  config?: string;
  cwd?: string;
  dryRun?: boolean;
  force?: boolean;
  json?: boolean;
  linkMode?: "symlink" | "copy";
  name?: string;
  storageRoot?: string;
  target?: string;
  yes?: boolean;
}

const program = new Command();

program
  .name("agentmaster")
  .description("Manage agent skills and AGENTS.md files from canonical local storage.")
  .version("0.1.0")
  .option("--config <path>", "configuration file path");

program
  .command("init")
  .description("create the configuration file and canonical storage directories")
  .option("--storage-root <path>", "canonical storage root")
  .option("--link-mode <mode>", "symlink or copy", "symlink")
  .option("--force", "replace an existing configuration file")
  .option("--json", "print JSON output")
  .action(async (_options: unknown, command: Command) => {
    const options = getOptions(command);
    const linkMode = parseLinkMode(options.linkMode);
    const result = await initializeConfig({
      configPath: options.config,
      force: options.force,
      linkMode,
      storageRoot: options.storageRoot,
    });
    const resolved = resolveConfig(result.config, result.path);
    print(
      {
        configPath: result.path,
        storageRoot: resolved.storage.root,
        linkMode: result.config.storage.linkMode,
      },
      options.json,
      `Initialized AgentMaster at ${result.path}\nCanonical storage: ${resolved.storage.root}`,
    );
  });

const configCommand = program.command("config").description("inspect or update configuration");

configCommand
  .command("show")
  .description("show the current configuration")
  .option("--json", "print JSON output")
  .action(async (_options: unknown, command: Command) => {
    const options = getOptions(command);
    const file = await loadConfig(options.config);
    const resolved = resolveConfig(file.config, file.path);
    print(
      { configPath: file.path, config: file.config, resolved },
      options.json,
      renderConfig(file.path, file.config, resolved),
    );
  });

configCommand
  .command("set <key> <value>")
  .description("set storage.root, storage.linkMode, or a target path")
  .option("--json", "print JSON output")
  .action(async (key: string, value: string, _options: unknown, command: Command) => {
    const options = getOptions(command);
    const file = await loadConfig(options.config);
    const config = setConfigValue(file.config, key, value);
    const updated = await writeConfig(config, file.path);
    const resolved = resolveConfig(updated.config, updated.path);
    print(
      { configPath: updated.path, config: updated.config, resolved },
      options.json,
      `Updated ${key}.\n${renderConfig(updated.path, updated.config, resolved)}`,
    );
  });

const skillCommand = program.command("skill").description("manage canonical skills");

skillCommand
  .command("add <source>")
  .description("copy a local skill directory or clone a Git skill source")
  .option("--name <name>", "managed skill name")
  .option("--json", "print JSON output")
  .action(async (source: string, _options: unknown, command: Command) => {
    const options = getOptions(command);
    const file = await loadConfig(options.config);
    const added = await addSkill(file.config, source, {
      configPath: file.path,
      name: options.name,
    });
    print(
      added,
      options.json,
      `Added ${added.name}.\nCanonical path: ${added.path}\nSource: ${added.source}`,
    );
  });

skillCommand
  .command("list")
  .description("list skills in canonical storage")
  .option("--json", "print JSON output")
  .action(async (_options: unknown, command: Command) => {
    const options = getOptions(command);
    const file = await loadConfig(options.config);
    const skills = await listSkills(file.config, file.path);
    print(
      skills,
      options.json,
      skills.length === 0
        ? "No managed skills found."
        : skills
            .map(
              (skill) =>
                `${skill.name}\t${skill.hasSkillFile ? "valid" : "missing SKILL.md"}\t${skill.path}`,
            )
            .join("\n"),
    );
  });

skillCommand
  .command("inspect <name>")
  .description("print a managed skill's SKILL.md")
  .option("--json", "print JSON output")
  .action(async (name: string, _options: unknown, command: Command) => {
    const options = getOptions(command);
    const file = await loadConfig(options.config);
    const skill = await inspectSkill(file.config, name, file.path);
    print(skill, options.json, `${skill.path}/SKILL.md\n\n${skill.content}`);
  });

skillCommand
  .command("link <name>")
  .description("link or copy a canonical skill into a configured target")
  .option("--target <name>", "target adapter", "codex")
  .option("--dry-run", "show the planned change without changing files")
  .option("--json", "print JSON output")
  .action(async (name: string, _options: unknown, command: Command) => {
    const options = getOptions(command);
    const file = await loadConfig(options.config);
    const result = await linkSkill(
      file.config,
      name,
      options.target ?? "codex",
      { dryRun: options.dryRun },
      file.path,
    );
    print(
      result,
      options.json,
      `${result.dryRun ? "Would" : "Did"} ${result.action} ${result.source} -> ${result.target}`,
    );
  });

skillCommand
  .command("remove <name>")
  .description("remove a canonical skill and links managed by AgentMaster")
  .option("--dry-run", "show the planned removal without changing files")
  .option("--yes", "confirm removal")
  .option("--json", "print JSON output")
  .action(async (name: string, _options: unknown, command: Command) => {
    const options = getOptions(command);
    const file = await loadConfig(options.config);
    const result = await removeSkill(
      file.config,
      name,
      { confirm: options.yes, dryRun: options.dryRun },
      file.path,
    );
    print(result, options.json, renderRemoval(result));
  });

const agentsCommand = program.command("agents").description("discover applicable AGENTS.md files");

agentsCommand
  .command("list")
  .description("list global, project, and nested AGENTS.md files")
  .option("--cwd <path>", "project directory")
  .option("--target <name>", "limit global discovery to one configured target")
  .option("--json", "print JSON output")
  .action(async (_options: unknown, command: Command) => {
    const options = getOptions(command);
    const file = await loadConfig(options.config);
    const agents = await discoverAgents(file.config, {
      configPath: file.path,
      cwd: options.cwd,
      targetName: options.target,
    });
    print(
      agents,
      options.json,
      agents
        .map(
          (agent) =>
            `${agent.scope}${agent.targetName ? ` (${agent.targetName})` : ""}\t${agent.exists ? "present" : "missing"}\t${agent.path}`,
        )
        .join("\n"),
    );
  });

program
  .command("doctor")
  .description("check storage directories and managed links")
  .option("--json", "print JSON output")
  .action(async (_options: unknown, command: Command) => {
    const options = getOptions(command);
    const file = await loadConfig(options.config);
    const result = await doctor(file.config, file.path);
    print(
      result,
      options.json,
      result.issues.length === 0
        ? `No issues found.\nStorage: ${result.storageRoot}`
        : result.issues
            .map((issue) => `${issue.code}: ${issue.message}\n  ${issue.path}`)
            .join("\n"),
    );
    if (result.issues.length > 0) {
      process.exitCode = 1;
    }
  });

program
  .command("gui")
  .description("open the optional desktop app")
  .action(() => {
    throw new AgentMasterError(
      "OPERATION_FAILED",
      "The desktop app is not installed yet. Use the CLI commands or build apps/desktop first.",
    );
  });

function getOptions(command: Command): CommandOptions {
  return command.optsWithGlobals() as CommandOptions;
}

function parseLinkMode(value: string | undefined): "symlink" | "copy" {
  if (value === "symlink" || value === "copy") {
    return value;
  }
  throw new AgentMasterError(
    "INVALID_CONFIG",
    `Link mode must be symlink or copy, received ${value}.`,
  );
}

function print(value: unknown, json: boolean | undefined, humanOutput: string): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${humanOutput}\n`);
}

function renderRemoval(result: Awaited<ReturnType<typeof removeSkill>>): string {
  const targets = [...result.linkedTargets, ...result.copiedTargets];
  const targetSummary = targets.length > 0 ? `\nRemoved targets:\n${targets.join("\n")}` : "";
  return `${result.dryRun ? "Would remove" : "Removed"} ${result.canonicalPath}${targetSummary}`;
}

function renderConfig(
  path: string,
  config: Awaited<ReturnType<typeof loadConfig>>["config"],
  resolved: ReturnType<typeof resolveConfig>,
): string {
  const targets = Object.entries(resolved.targets)
    .map(
      ([name, target]) => `  ${name}:\n    skills: ${target.skills}\n    agents: ${target.agents}`,
    )
    .join("\n");
  return `Config: ${path}\nStorage: ${resolved.storage.root} (${config.storage.linkMode})\nTargets:\n${targets}`;
}

async function main(): Promise<void> {
  try {
    if (process.argv.length === 2) {
      program.outputHelp();
      return;
    }
    await program.parseAsync(process.argv);
  } catch (error) {
    const normalized = asAgentMasterError(error);
    if (process.argv.includes("--json")) {
      process.stderr.write(
        `${JSON.stringify(
          {
            error: {
              code: normalized.code,
              message: normalized.message,
              details: normalized.details ?? null,
            },
          },
          null,
          2,
        )}\n`,
      );
    } else {
      process.stderr.write(`agentmaster: ${normalized.message}\n`);
    }
    process.exitCode = getExitCode(normalized.code);
  }
}

const exitCodes = {
  CONFIG_EXISTS: 4,
  CONFIG_NOT_FOUND: 2,
  INVALID_CONFIG: 3,
  INVALID_NAME: 3,
  INVALID_SOURCE: 3,
  MISSING_SKILL: 3,
  SKILL_EXISTS: 4,
  SKILL_NOT_FOUND: 2,
  TARGET_NOT_FOUND: 2,
  TARGET_CONFLICT: 4,
  CONFIRMATION_REQUIRED: 5,
  OPERATION_FAILED: 1,
} satisfies Record<ErrorCode, number>;

function getExitCode(code: ErrorCode): number {
  return exitCodes[code];
}

void main();
