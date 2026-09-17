import { execFile as execFileCallback } from "node:child_process";
import { lstat, mkdir, mkdtemp, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "../../packages/core/src/index.js";
import {
  addSkill,
  discoverAgents,
  doctor,
  initializeConfig,
  linkSkill,
  listSkills,
  loadConfig,
  removeSkill,
  resolveConfig,
  setConfigValue,
} from "../../packages/core/src/index.js";

const execFile = promisify(execFileCallback);

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("AgentMaster core", () => {
  it("initializes canonical storage and refuses an accidental overwrite", async () => {
    const root = await createTemporaryDirectory();
    const configPath = join(root, "config.json");
    const storageRoot = join(root, "storage");

    const initialized = await initializeConfig({ configPath, storageRoot });
    expect(initialized.path).toBe(configPath);
    expect((await loadConfig(configPath)).config.storage.root).toBe(storageRoot);

    await expect(initializeConfig({ configPath, storageRoot })).rejects.toMatchObject({
      code: "CONFIG_EXISTS",
    });
  });

  it("resolves relative persisted paths from the configuration directory", async () => {
    const root = await createTemporaryDirectory();
    const configPath = join(root, "config", "config.json");
    const initialized = await initializeConfig({ configPath, storageRoot: "./storage" });

    const resolved = resolveConfig(
      {
        ...initialized.config,
        targets: {
          codex: {
            skills: "./targets/skills",
            agents: "./targets/AGENTS.md",
          },
        },
      },
      configPath,
    );

    expect(resolved.storage.root).toBe(join(root, "config", "storage"));
    expect(resolved.targets.codex.skills).toBe(join(root, "config", "targets", "skills"));
    expect(resolved.targets.codex.agents).toBe(join(root, "config", "targets", "AGENTS.md"));
  });

  it("adds a local skill and plans then applies a symlink", async () => {
    const root = await createTemporaryDirectory();
    const source = join(root, "example-skill");
    const storageRoot = join(root, "storage");
    const targetRoot = join(root, "codex-skills");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "SKILL.md"), "# Example skill\n", "utf8");

    const config = testConfig(storageRoot, targetRoot);
    const added = await addSkill(config, source);
    expect(added.name).toBe("example-skill");
    expect((await listSkills(config))[0]?.hasSkillFile).toBe(true);

    const dryRun = await linkSkill(config, added.name, "codex", { dryRun: true });
    expect(dryRun.action).toBe("create-symlink");
    expect(dryRun.dryRun).toBe(true);

    const linked = await linkSkill(config, added.name);
    expect(linked.action).toBe("create-symlink");
    expect(await readlink(linked.target)).toBe(added.path);

    await expect(linkSkill(config, added.name)).resolves.toMatchObject({
      action: "already-linked",
    });
  });

  it("uses copy mode and reports broken links", async () => {
    const root = await createTemporaryDirectory();
    const source = join(root, "copy-skill");
    const storageRoot = join(root, "storage");
    const targetRoot = join(root, "codex-skills");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "SKILL.md"), "# Copy skill\n", "utf8");

    const config = testConfig(storageRoot, targetRoot, "copy");
    const added = await addSkill(config, source);
    const linked = await linkSkill(config, added.name);
    expect(linked.action).toBe("copy");
    expect(await readlink(linked.target).catch(() => undefined)).toBeUndefined();
    await expect(linkSkill(config, added.name)).resolves.toMatchObject({
      action: "already-linked",
    });

    const brokenPath = join(targetRoot, "broken");
    await symlink(join(root, "missing"), brokenPath, "dir");
    const result = await doctor(config);
    expect(result.issues.some((issue) => issue.code === "BROKEN_LINK")).toBe(true);

    const removal = await removeSkill(config, added.name, { dryRun: true });
    expect(removal.canonicalPath).toBe(added.path);
    expect(removal.copiedTargets).toContain(linked.target);
    expect(removal.dryRun).toBe(true);

    const removed = await removeSkill(config, added.name, { confirm: true });
    expect(removed.copiedTargets).toContain(linked.target);
    await expect(lstat(linked.target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("discovers the global AGENTS.md path for every configured target", async () => {
    const root = await createTemporaryDirectory();
    const config = testConfig(join(root, "storage"), join(root, "codex-skills"));
    config.targets.other = {
      skills: join(root, "other-skills"),
      agents: join(root, "other-global.md"),
    };
    await mkdir(join(root, "codex-skills"), { recursive: true });
    await writeFile(config.targets.codex.agents, "# Codex\n", "utf8");
    await writeFile(config.targets.other.agents, "# Other\n", "utf8");

    const agents = await discoverAgents(config, { cwd: root });
    expect(
      agents.filter((agent) => agent.scope === "global").map((agent) => agent.targetName),
    ).toEqual(["codex", "other"]);
  });

  it("reports regular files and dangling symlinks as missing target directories", async () => {
    const root = await createTemporaryDirectory();
    const config = testConfig(join(root, "storage"), join(root, "file-target"));
    await writeFile(config.targets.codex.skills, "not a directory", "utf8");

    const regularFileResult = await doctor(config);
    expect(regularFileResult.issues).toContainEqual(
      expect.objectContaining({ code: "MISSING_TARGET_DIRECTORY" }),
    );

    await rm(config.targets.codex.skills);
    await symlink(join(root, "missing-target"), config.targets.codex.skills, "dir");
    const danglingLinkResult = await doctor(config);
    expect(danglingLinkResult.issues).toContainEqual(
      expect.objectContaining({ code: "MISSING_TARGET_DIRECTORY" }),
    );
  });

  it("rejects symbolic links inside imported skill sources", async () => {
    const root = await createTemporaryDirectory();
    const source = join(root, "unsafe-skill");
    const outside = join(root, "outside.md");
    const config = testConfig(join(root, "storage"), join(root, "codex-skills"));
    await mkdir(source, { recursive: true });
    await writeFile(outside, "private content\n", "utf8");
    await symlink(outside, join(source, "SKILL.md"));

    await expect(addSkill(config, source)).rejects.toThrow("symbolic link");
    await expect(lstat(join(root, "storage", "skills", "unsafe-skill"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("derives a Git skill name from the source URL", async () => {
    const root = await createTemporaryDirectory();
    const repository = join(root, "repository");
    const config = testConfig(join(root, "storage"), join(root, "codex-skills"));
    await mkdir(repository, { recursive: true });
    await writeFile(join(repository, "SKILL.md"), "# Git skill\n", "utf8");
    await execFile("git", ["init", "--quiet", repository]);
    await execFile("git", ["-C", repository, "config", "user.email", "agentmaster@example.com"]);
    await execFile("git", ["-C", repository, "config", "user.name", "AgentMaster Tests"]);
    await execFile("git", ["-C", repository, "add", "SKILL.md"]);
    await execFile("git", ["-C", repository, "commit", "--quiet", "-m", "initial"]);

    const added = await addSkill(config, `file://${repository}`);
    expect(added.name).toBe("repository");
  });

  it("rejects prototype-polluting target configuration keys", () => {
    const config = testConfig("/tmp/agentmaster-storage", "/tmp/agentmaster-skills");

    expect(() => setConfigValue(config, "targets.__proto__.skills", "/tmp/unsafe")).toThrow(
      "Unsupported configuration key",
    );
    expect(Object.hasOwn(config.targets, "__proto__")).toBe(false);
    expect(Object.hasOwn(Object.prototype, "skills")).toBe(false);
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agentmaster-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function testConfig(
  storageRoot: string,
  targetRoot: string,
  linkMode: Config["storage"]["linkMode"] = "symlink",
): Config {
  return {
    version: 1,
    storage: { root: storageRoot, linkMode },
    targets: {
      codex: {
        skills: targetRoot,
        agents: join(targetRoot, "AGENTS.md"),
      },
    },
  };
}
