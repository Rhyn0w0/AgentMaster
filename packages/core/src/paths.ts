import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

const environmentVariablePattern = /\$(?:\{([^}]+)\}|([A-Za-z_][A-Za-z0-9_]*))/g;

export function expandPath(
  input: string,
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
): string {
  const withHome = input.replace(/^~(?=\/|$)/, homeDirectory);
  const withEnvironment = withHome.replace(
    environmentVariablePattern,
    (match: string, bracedName?: string, plainName?: string) => {
      const name = bracedName ?? plainName;
      const value = name ? environment[name] : undefined;

      if (value === undefined) {
        throw new Error(`Environment variable ${name ?? match} is not set`);
      }

      return value;
    },
  );

  return resolve(withEnvironment);
}

export function getConfigPath(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
): string {
  if (environment.AGENTMASTER_CONFIG) {
    return expandPath(environment.AGENTMASTER_CONFIG, environment, homeDirectory);
  }

  if (platform === "darwin") {
    return join(homeDirectory, "Library", "Application Support", "AgentMaster", "config.json");
  }

  if (platform === "win32") {
    const appData = environment.APPDATA
      ? expandPath(environment.APPDATA, environment, homeDirectory)
      : join(homeDirectory, "AppData", "Roaming");
    return join(appData, "AgentMaster", "config.json");
  }

  const configHome = environment.XDG_CONFIG_HOME
    ? expandPath(environment.XDG_CONFIG_HOME, environment, homeDirectory)
    : join(homeDirectory, ".config");
  return join(configHome, "agentmaster", "config.json");
}

export function resolveFrom(baseDirectory: string, input: string): string {
  return isAbsolute(input) ? resolve(input) : resolve(baseDirectory, input);
}

export function parentDirectory(filePath: string): string {
  return dirname(filePath);
}
