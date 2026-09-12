import { mkdir, mkdtemp, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "../../packages/core/src/index.js";
import {
  addSkill,
  doctor,
  initializeConfig,
  linkSkill,
  listSkills,
  loadConfig,
  removeSkill,
} from "../../packages/core/src/index.js";

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

    const brokenPath = join(targetRoot, "broken");
    await symlink(join(root, "missing"), brokenPath, "dir");
    const result = await doctor(config);
    expect(result.issues.some((issue) => issue.code === "BROKEN_LINK")).toBe(true);

    const removal = await removeSkill(config, added.name, { dryRun: true });
    expect(removal.canonicalPath).toBe(added.path);
    expect(removal.dryRun).toBe(true);
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
