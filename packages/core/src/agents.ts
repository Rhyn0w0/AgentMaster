import { join, relative } from "node:path";
import { resolveConfig } from "./config.js";
import { exists, readDirectoryEntries } from "./filesystem.js";
import type { AgentFile, Config } from "./types.js";

const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage"]);

export async function discoverAgents(
  config: Config,
  options: { cwd?: string; configPath?: string } = {},
): Promise<AgentFile[]> {
  const cwd = options.cwd ?? process.cwd();
  const resolved = resolveConfig(config, options.configPath);
  const globalPath = resolved.targets.codex?.agents;
  const projectPath = join(cwd, "AGENTS.md");
  const files: AgentFile[] = [];

  if (globalPath) {
    files.push({ scope: "global", path: globalPath, exists: await exists(globalPath) });
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
