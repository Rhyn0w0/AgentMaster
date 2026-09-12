import { join } from "node:path";
import { resolveConfig } from "./config.js";
import { exists, readDirectoryEntries, resolveSymlink } from "./filesystem.js";
import type { Config, DoctorIssue, DoctorResult } from "./types.js";

export async function doctor(config: Config, configPath?: string): Promise<DoctorResult> {
  const resolved = resolveConfig(config, configPath);
  const issues: DoctorIssue[] = [];
  const skillsDirectory = join(resolved.storage.root, "skills");

  if (!(await exists(skillsDirectory))) {
    issues.push({
      code: "MISSING_STORAGE_DIRECTORY",
      path: skillsDirectory,
      message: "The canonical skills directory does not exist. Run agentmaster init.",
    });
  }

  for (const [targetName, target] of Object.entries(resolved.targets)) {
    if (!(await exists(target.skills))) {
      issues.push({
        code: "MISSING_TARGET_DIRECTORY",
        path: target.skills,
        message: `The ${targetName} skills target directory does not exist yet.`,
      });
      continue;
    }

    const entries = await readDirectoryEntries(target.skills);
    for (const entry of entries) {
      if (!entry.isSymbolicLink()) {
        continue;
      }

      const path = join(target.skills, entry.name);
      const destination = await resolveSymlink(path);
      if (destination && !(await exists(destination))) {
        issues.push({
          code: "BROKEN_LINK",
          path,
          message: `The ${targetName} skill link points to a missing path: ${destination}`,
        });
      }
    }
  }

  return {
    configPath: resolved.configPath,
    storageRoot: resolved.storage.root,
    issues,
  };
}
