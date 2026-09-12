import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AgentMasterError } from "./errors.js";
import { expandPath, getConfigPath } from "./paths.js";
import { type Config, configSchema, type LinkMode, type ResolvedConfig } from "./types.js";

export interface InitializeOptions {
  configPath?: string;
  storageRoot?: string;
  linkMode?: LinkMode;
  force?: boolean;
}

export interface ConfigFile {
  path: string;
  config: Config;
}

export function defaultConfig(): Config {
  return {
    version: 1,
    storage: {
      root: "~/Documents/AgentMaster",
      linkMode: "symlink",
    },
    targets: {
      codex: {
        skills: "~/.codex/skills",
        agents: "~/.codex/AGENTS.md",
      },
    },
  };
}

export async function loadConfig(configPath = getConfigPath()): Promise<ConfigFile> {
  const path = expandPath(configPath);

  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      throw new AgentMasterError("CONFIG_NOT_FOUND", `AgentMaster is not initialized at ${path}.`);
    }
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(contents) as unknown;
  } catch (error) {
    throw new AgentMasterError(
      "INVALID_CONFIG",
      `The configuration file is not valid JSON: ${path}`,
      error,
    );
  }

  const parsed = configSchema.safeParse(value);
  if (!parsed.success) {
    throw new AgentMasterError(
      "INVALID_CONFIG",
      `The configuration file does not match the AgentMaster schema: ${path}`,
      parsed.error.issues,
    );
  }

  return { path, config: parsed.data };
}

export async function writeConfig(
  config: Config,
  configPath = getConfigPath(),
): Promise<ConfigFile> {
  const parsed = configSchema.safeParse(config);
  if (!parsed.success) {
    throw new AgentMasterError(
      "INVALID_CONFIG",
      "Cannot write a configuration that does not match the AgentMaster schema.",
      parsed.error.issues,
    );
  }

  const path = expandPath(configPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(parsed.data, null, 2)}\n`, "utf8");
  return { path, config: parsed.data };
}

export async function initializeConfig(options: InitializeOptions = {}): Promise<ConfigFile> {
  const path = expandPath(options.configPath ?? getConfigPath());
  if (!options.force && (await fileExists(path))) {
    throw new AgentMasterError("CONFIG_EXISTS", `AgentMaster is already initialized at ${path}.`);
  }

  const config = defaultConfig();
  if (options.storageRoot) {
    config.storage.root = options.storageRoot;
  }
  if (options.linkMode) {
    config.storage.linkMode = options.linkMode;
  }

  const result = await writeConfig(config, path);
  await ensureStorageDirectories(result.config);
  return result;
}

export async function ensureStorageDirectories(config: Config): Promise<ResolvedConfig> {
  const resolved = resolveConfig(config, getConfigPath());
  await mkdir(join(resolved.storage.root, "skills"), { recursive: true });
  await mkdir(join(resolved.storage.root, "agents"), { recursive: true });
  await mkdir(join(resolved.storage.root, "metadata", "skills"), { recursive: true });
  return resolved;
}

export function resolveConfig(config: Config, configPath = getConfigPath()): ResolvedConfig {
  const resolvedTargets = Object.fromEntries(
    Object.entries(config.targets).map(([name, target]) => [
      name,
      {
        skills: expandPath(target.skills),
        agents: expandPath(target.agents),
      },
    ]),
  );

  return {
    ...config,
    configPath: expandPath(configPath),
    storage: {
      ...config.storage,
      root: expandPath(config.storage.root),
    },
    targets: resolvedTargets,
  };
}

export function setConfigValue(config: Config, key: string, value: string): Config {
  const next = structuredClone(config);
  const segments = key.split(".");

  if (key === "storage.root") {
    next.storage.root = value;
  } else if (key === "storage.linkMode") {
    if (value !== "symlink" && value !== "copy") {
      throw new AgentMasterError("INVALID_CONFIG", `storage.linkMode must be symlink or copy.`);
    }
    next.storage.linkMode = value;
  } else if (segments.length === 3 && segments[0] === "targets") {
    const targetName = segments[1];
    const field = segments[2];
    if (!targetName || (field !== "skills" && field !== "agents")) {
      throw new AgentMasterError("INVALID_CONFIG", `Unsupported configuration key: ${key}`);
    }
    const existing = next.targets[targetName] ?? {
      skills: "~/.codex/skills",
      agents: "~/.codex/AGENTS.md",
    };
    existing[field] = value;
    next.targets[targetName] = existing;
  } else {
    throw new AgentMasterError("INVALID_CONFIG", `Unsupported configuration key: ${key}`);
  }

  return configSchema.parse(next);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (isMissingFile(error)) {
      return false;
    }
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
