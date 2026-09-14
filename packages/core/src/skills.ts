import { mkdtemp, readFile } from "node:fs/promises";
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
  ManagedSkillLink,
  RemovedSkill,
  ResolvedConfig,
  SkillLinkResult,
  SkillMetadata,
  SkillSummary,
} from "./types.js";

export interface AddSkillOptions {
  name?: string;
  cwd?: string;
  configPath?: string;
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
  const content = await readFile(join(skill.path, "SKILL.md"), "utf8");
  return { ...skill, content };
}

export async function addSkill(
  config: Config,
  source: string,
  options: AddSkillOptions = {},
): Promise<AddedSkill> {
  const cwd = options.cwd ?? process.cwd();
  const resolved = await ensureStorageDirectories(config, options.configPath);
  const sourceResult = await prepareSource(source, cwd);

  try {
    const name = validateSkillName(options.name ?? deriveSourceName(source, cwd));
    const destination = join(resolved.storage.root, "skills", name);
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
    await writeSkillMetadata(resolved, { ...added, links: [] });
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
  const metadata = await readSkillMetadata(resolved, name);
  const managedLink = metadata?.links.find((link) => link.target === targetPath);
  const existingTarget = await inspectTarget(targetPath, skill.path, managedLink?.mode);

  if (existingTarget === "same-link" || existingTarget === "managed-copy") {
    if (!options.dryRun) {
      await recordManagedLink(resolved, skill, targetPath, managedLink?.mode ?? "symlink");
    }
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
    await recordManagedLink(resolved, skill, targetPath, config.storage.linkMode);
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
  const copiedTargets: string[] = [];
  const metadata = await readSkillMetadata(resolved, name);

  for (const link of metadata?.links ?? []) {
    if (link.mode === "copy") {
      if (await isDirectory(link.target)) {
        copiedTargets.push(link.target);
      }
    } else if ((await inspectTarget(link.target, skill.path)) === "same-link") {
      linkedTargets.push(link.target);
    }
  }

  for (const target of Object.values(resolved.targets)) {
    const targetPath = join(target.skills, name);
    const targetType = await inspectTarget(targetPath, skill.path);
    if (
      targetType === "same-link" &&
      !linkedTargets.includes(targetPath) &&
      !copiedTargets.includes(targetPath)
    ) {
      linkedTargets.push(targetPath);
    }
  }

  const result: RemovedSkill = {
    name,
    canonicalPath: skill.path,
    linkedTargets: [...new Set(linkedTargets)],
    copiedTargets: [...new Set(copiedTargets)],
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

  for (const targetPath of result.linkedTargets) {
    await removePath(targetPath);
  }
  for (const targetPath of result.copiedTargets) {
    await removePath(targetPath);
  }
  await removePath(skill.path);

  const metadataPath = getSkillMetadataPath(resolved, name);
  if (await exists(metadataPath)) {
    await removePath(metadataPath);
  }

  return result;
}

async function readSkillMetadata(
  resolved: ResolvedConfig,
  name: string,
): Promise<SkillMetadata | undefined> {
  try {
    const value = JSON.parse(
      await readFile(getSkillMetadataPath(resolved, name), "utf8"),
    ) as unknown;
    if (!isRecord(value) || typeof value.name !== "string" || typeof value.path !== "string") {
      return undefined;
    }

    const links = Array.isArray(value.links) ? value.links.filter(isManagedSkillLink) : [];
    return {
      name: value.name,
      path: value.path,
      hasSkillFile: value.hasSkillFile === true,
      source: typeof value.source === "string" ? value.source : "unknown",
      ...(typeof value.revision === "string" ? { revision: value.revision } : {}),
      links,
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    return undefined;
  }
}

async function writeSkillMetadata(
  resolved: ResolvedConfig,
  metadata: SkillMetadata,
): Promise<void> {
  await writeJson(getSkillMetadataPath(resolved, metadata.name), metadata);
}

async function recordManagedLink(
  resolved: ResolvedConfig,
  skill: SkillSummary,
  target: string,
  mode: ManagedSkillLink["mode"],
): Promise<void> {
  const existing = await readSkillMetadata(resolved, skill.name);
  const metadata: SkillMetadata = existing ?? {
    name: skill.name,
    path: skill.path,
    hasSkillFile: skill.hasSkillFile,
    source: "unknown",
    links: [],
  };
  const links = metadata.links.filter((link) => link.target !== target);
  links.push({ target, mode });
  await writeSkillMetadata(resolved, { ...metadata, links });
}

function getSkillMetadataPath(resolved: ResolvedConfig, name: string): string {
  return join(resolved.storage.root, "metadata", "skills", `${name}.json`);
}

function isManagedSkillLink(value: unknown): value is ManagedSkillLink {
  return (
    isRecord(value) &&
    typeof value.target === "string" &&
    (value.mode === "symlink" || value.mode === "copy")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
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
  if (!Object.hasOwn(resolved.targets, targetName) || !target) {
    throw new AgentMasterError("TARGET_NOT_FOUND", `No target named ${targetName} is configured.`);
  }
  return target;
}

async function inspectTarget(
  path: string,
  expectedSource?: string,
  managedMode?: ManagedSkillLink["mode"],
): Promise<"missing" | "same-link" | "managed-copy" | "other"> {
  if (!(await exists(path))) {
    return "missing";
  }

  if (managedMode === "copy" && (await isDirectory(path))) {
    return "managed-copy";
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

function deriveSourceName(source: string, cwd: string): string {
  return isGitSource(source)
    ? deriveGitSkillName(source)
    : deriveSkillName(resolveFrom(cwd, source));
}

function deriveGitSkillName(source: string): string {
  const withoutQuery = source.split(/[?#]/, 1)[0] ?? source;
  const withoutTrailingSlashes = withoutQuery.replace(/\/+$/, "");
  const repositoryPath = withoutTrailingSlashes.includes("://")
    ? withoutTrailingSlashes.slice(withoutTrailingSlashes.lastIndexOf("/") + 1)
    : withoutTrailingSlashes
        .slice(withoutTrailingSlashes.lastIndexOf(":") + 1)
        .split("/")
        .pop();
  return (repositoryPath ?? "skill").replace(/\.git$/, "") || "skill";
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
  return /^(?:file:\/\/|git@|git\+ssh:\/\/|ssh:\/\/|git:\/\/|https?:\/\/)/.test(source);
}
