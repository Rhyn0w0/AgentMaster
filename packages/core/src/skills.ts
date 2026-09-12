import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { execa } from "execa";
import { ensureStorageDirectories, resolveConfig } from "./config.js";
import { AgentMasterError } from "./errors.js";
import {
  copyDirectory,
  createDirectorySymlink,
  ensureDirectory,
  exists,
  isDirectory,
  readDirectoryEntries,
  removePath,
  resolveSymlink,
  writeJson,
} from "./filesystem.js";
import { expandPath, resolveFrom } from "./paths.js";
import type {
  AddedSkill,
  Config,
  LinkAction,
  RemovedSkill,
  ResolvedConfig,
  SkillLinkResult,
  SkillSummary,
} from "./types.js";

export interface AddSkillOptions {
  name?: string;
  cwd?: string;
}

export async function listSkills(config: Config, configPath?: string): Promise<SkillSummary[]> {
  const resolved = resolveConfig(config, configPath);
  const entries = await readDirectoryEntries(join(resolved.storage.root, "skills"));
  const skills: SkillSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const path = join(resolved.storage.root, "skills", entry.name);
    skills.push({
      name: entry.name,
      path,
      hasSkillFile: await exists(join(path, "SKILL.md")),
    });
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

export async function inspectSkill(
  config: Config,
  name: string,
  configPath?: string,
): Promise<SkillSummary & { content: string }> {
  const skill = await getSkill(config, name, configPath);
  const { readFile } = await import("node:fs/promises");
  const content = await readFile(join(skill.path, "SKILL.md"), "utf8");
  return { ...skill, content };
}

export async function addSkill(
  config: Config,
  source: string,
  options: AddSkillOptions = {},
): Promise<AddedSkill> {
  const resolved = await ensureStorageDirectories(config);
  const sourceResult = await prepareSource(source, options.cwd ?? process.cwd());
  const name = validateSkillName(options.name ?? deriveSkillName(sourceResult.directory));
  const destination = join(resolved.storage.root, "skills", name);

  try {
    if (await exists(destination)) {
      throw new AgentMasterError("SKILL_EXISTS", `A skill named ${name} already exists.`);
    }

    if (!(await exists(join(sourceResult.directory, "SKILL.md")))) {
      throw new AgentMasterError(
        "MISSING_SKILL",
        `The source does not contain a SKILL.md file: ${sourceResult.directory}`,
      );
    }

    await copyDirectory(sourceResult.directory, destination);
    const added: AddedSkill = {
      name,
      path: destination,
      hasSkillFile: true,
      source,
      ...(sourceResult.revision ? { revision: sourceResult.revision } : {}),
    };
    await writeJson(join(resolved.storage.root, "metadata", "skills", `${name}.json`), added);
    return added;
  } finally {
    await sourceResult.cleanup();
  }
}

export async function linkSkill(
  config: Config,
  name: string,
  targetName = "codex",
  options: { dryRun?: boolean } = {},
  configPath?: string,
): Promise<SkillLinkResult> {
  const resolved = resolveConfig(config, configPath);
  const skill = await getSkill(config, name, configPath);
  const target = getTarget(resolved, targetName);
  const targetPath = join(target.skills, name);
  const existingTarget = await inspectTarget(targetPath, skill.path);

  if (existingTarget === "same-link") {
    return {
      action: "already-linked",
      name,
      source: skill.path,
      target: targetPath,
      targetName,
      dryRun: Boolean(options.dryRun),
    };
  }

  if (existingTarget !== "missing") {
    throw new AgentMasterError(
      "TARGET_CONFLICT",
      `Refusing to replace the existing target: ${targetPath}`,
    );
  }

  const action: LinkAction = config.storage.linkMode === "symlink" ? "create-symlink" : "copy";
  if (!options.dryRun) {
    await ensureDirectory(target.skills);
    if (action === "create-symlink") {
      await createDirectorySymlink(skill.path, targetPath);
    } else {
      await copyDirectory(skill.path, targetPath);
    }
  }

  return {
    action,
    name,
    source: skill.path,
    target: targetPath,
    targetName,
    dryRun: Boolean(options.dryRun),
  };
}

export async function removeSkill(
  config: Config,
  name: string,
  options: { dryRun?: boolean; confirm?: boolean } = {},
  configPath?: string,
): Promise<RemovedSkill> {
  const resolved = resolveConfig(config, configPath);
  const skill = await getSkill(config, name, configPath);
  const linkedTargets: string[] = [];

  for (const target of Object.values(resolved.targets)) {
    const targetPath = join(target.skills, name);
    const targetType = await inspectTarget(targetPath, skill.path);
    if (targetType === "same-link") {
      linkedTargets.push(targetPath);
    }
  }

  const result: RemovedSkill = {
    name,
    canonicalPath: skill.path,
    linkedTargets,
    dryRun: Boolean(options.dryRun),
  };

  if (options.dryRun) {
    return result;
  }

  if (!options.confirm) {
    throw new AgentMasterError(
      "CONFIRMATION_REQUIRED",
      "Removing a skill changes managed files. Re-run with --yes or use --dry-run.",
    );
  }

  for (const targetPath of linkedTargets) {
    await removePath(targetPath);
  }
  await removePath(skill.path);

  const metadataPath = join(resolved.storage.root, "metadata", "skills", `${name}.json`);
  if (await exists(metadataPath)) {
    await removePath(metadataPath);
  }

  return result;
}

async function getSkill(config: Config, name: string, configPath?: string): Promise<SkillSummary> {
  const resolved = resolveConfig(config, configPath);
  const validName = validateSkillName(name);
  const path = join(resolved.storage.root, "skills", validName);

  if (!(await isDirectory(path))) {
    throw new AgentMasterError("SKILL_NOT_FOUND", `No managed skill named ${validName} exists.`);
  }

  return {
    name: validName,
    path,
    hasSkillFile: await exists(join(path, "SKILL.md")),
  };
}

function getTarget(resolved: ResolvedConfig, targetName: string) {
  const target = resolved.targets[targetName];
  if (!target) {
    throw new AgentMasterError("TARGET_NOT_FOUND", `No target named ${targetName} is configured.`);
  }
  return target;
}

async function inspectTarget(
  path: string,
  expectedSource?: string,
): Promise<"missing" | "same-link" | "other"> {
  if (!(await exists(path))) {
    return "missing";
  }

  const resolvedLink = await resolveSymlink(path);
  if (resolvedLink && expectedSource && resolvedLink === expandPath(expectedSource)) {
    return "same-link";
  }
  return "other";
}

function validateSkillName(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name === "." || name === "..") {
    throw new AgentMasterError(
      "INVALID_NAME",
      `Invalid skill name ${JSON.stringify(name)}. Use letters, numbers, dots, underscores, and hyphens.`,
    );
  }
  return name;
}

function deriveSkillName(directory: string): string {
  const name = basename(directory).replace(/\.git$/, "");
  return name || basename(dirname(directory));
}

async function prepareSource(
  source: string,
  cwd: string,
): Promise<{
  directory: string;
  revision?: string;
  cleanup: () => Promise<void>;
}> {
  const localPath = resolveFrom(cwd, source);
  if (await isDirectory(localPath)) {
    return { directory: localPath, cleanup: async () => undefined };
  }

  if (!isGitSource(source)) {
    throw new AgentMasterError("INVALID_SOURCE", `Source directory does not exist: ${localPath}`);
  }

  const temporaryParent = await mkdtemp(join(tmpdir(), "agentmaster-source-"));
  const checkout = join(temporaryParent, "checkout");
  try {
    await execa("git", ["clone", "--depth", "1", source, checkout]);
    const revisionResult = await execa("git", ["rev-parse", "HEAD"], { cwd: checkout });
    return {
      directory: checkout,
      revision: revisionResult.stdout.trim(),
      cleanup: async () => removePath(temporaryParent),
    };
  } catch (error) {
    await removePath(temporaryParent).catch(() => undefined);
    throw new AgentMasterError("INVALID_SOURCE", `Could not clone skill source ${source}.`, error);
  }
}

function isGitSource(source: string): boolean {
  return /^(?:git@|git\+ssh:\/\/|ssh:\/\/|git:\/\/|https?:\/\/)/.test(source);
}
