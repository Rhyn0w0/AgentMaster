import { join, relative } from "node:path";
import { resolveConfig } from "./config.js";
import { AgentMasterError } from "./errors.js";
import { exists, readDirectoryEntries } from "./filesystem.js";
import type { AgentFile, Config } from "./types.js";

const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage"]);

export async function discoverAgents(
  config: Config,
  options: { cwd?: string; configPath?: string; targetName?: string } = {},
): Promise<AgentFile[]> {
  const cwd = options.cwd ?? process.cwd();
  const resolved = resolveConfig(config, options.configPath);
  const projectPath = join(cwd, "AGENTS.md");
  const files: AgentFile[] = [];
  const hasRequestedTarget =
    options.targetName !== undefined && Object.hasOwn(resolved.targets, options.targetName);

  const targets = options.targetName
    ? [
        [
          options.targetName,
          hasRequestedTarget ? resolved.targets[options.targetName] : undefined,
        ] as const,
      ]
    : Object.entries(resolved.targets);
  if (options.targetName && !hasRequestedTarget) {
    throw new AgentMasterError(
      "TARGET_NOT_FOUND",
      `No target named ${options.targetName} is configured.`,
    );
  }

  for (const [targetName, target] of targets) {
    if (target) {
      files.push({
        scope: "global",
        path: target.agents,
        exists: await exists(target.agents),
        targetName,
      });
    }
  }
  files.push({ scope: "project", path: projectPath, exists: await exists(projectPath) });

  const nestedPaths = await findNestedAgents(cwd, projectPath);
  files.push(...nestedPaths.map((path) => ({ scope: "nested" as const, path, exists: true })));

  return files;
}

async function findNestedAgents(root: string, projectPath: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readDirectoryEntries(root);

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".codex") {
      continue;
    }
    if (!entry.isDirectory() || ignoredDirectories.has(entry.name)) {
      continue;
    }

    const directory = join(root, entry.name);
    const agentsPath = join(directory, "AGENTS.md");
    if (agentsPath !== projectPath && (await exists(agentsPath))) {
      found.push(agentsPath);
    }
    found.push(...(await findNestedAgents(directory, projectPath)));
  }

  return found.sort((left, right) => relative(root, left).localeCompare(relative(root, right)));
}
