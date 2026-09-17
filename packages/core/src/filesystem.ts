import {
  cp,
  lstat,
  mkdir,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function isDirectoryFollowingSymlinks(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function isFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function readDirectoryEntries(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function resolveSymlink(path: string): Promise<string | undefined> {
  try {
    const link = await readlink(path);
    return resolve(dirname(path), link);
  } catch (error) {
    if (isNodeError(error) && (error.code === "ENOENT" || error.code === "EINVAL")) {
      return undefined;
    }
    throw error;
  }
}

export async function removePath(path: string): Promise<void> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || stats.isFile()) {
    await unlink(path);
    return;
  }

  await rm(path, { recursive: true, force: false });
}

export async function copyDirectory(source: string, destination: string): Promise<void> {
  await rejectSymbolicLinks(source);
  await cp(source, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: async (currentSource) => {
      const stats = await lstat(currentSource);
      if (stats.isSymbolicLink()) {
        throw new Error(
          `Refusing to copy a symbolic link from an untrusted skill: ${currentSource}`,
        );
      }
      return true;
    },
  });
}

async function rejectSymbolicLinks(path: string): Promise<void> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to copy a symbolic link from an untrusted skill: ${path}`);
  }
  if (!stats.isDirectory()) {
    return;
  }

  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    await rejectSymbolicLinks(join(path, entry.name));
  }
}

export async function createDirectorySymlink(source: string, destination: string): Promise<void> {
  await symlink(source, destination, "dir");
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await ensureDirectory(dirname(path));
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
