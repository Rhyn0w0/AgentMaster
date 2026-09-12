import { z } from "zod";

export const linkModeSchema = z.enum(["symlink", "copy"]);

export const targetConfigSchema = z.object({
  skills: z.string().min(1),
  agents: z.string().min(1),
});

export const configSchema = z.object({
  version: z.literal(1),
  storage: z.object({
    root: z.string().min(1),
    linkMode: linkModeSchema,
  }),
  targets: z.record(z.string(), targetConfigSchema),
});

export type LinkMode = z.infer<typeof linkModeSchema>;
export type TargetConfig = z.infer<typeof targetConfigSchema>;
export type Config = z.infer<typeof configSchema>;

export interface ResolvedTargetConfig extends TargetConfig {
  skills: string;
  agents: string;
}

export interface ResolvedConfig extends Omit<Config, "storage" | "targets"> {
  configPath: string;
  storage: Config["storage"] & {
    root: string;
  };
  targets: Record<string, ResolvedTargetConfig>;
}

export interface SkillSummary {
  name: string;
  path: string;
  hasSkillFile: boolean;
}

export interface AddedSkill extends SkillSummary {
  source: string;
  revision?: string;
}

export type LinkAction = "create-symlink" | "copy" | "already-linked";

export interface SkillLinkResult {
  action: LinkAction;
  name: string;
  source: string;
  target: string;
  targetName: string;
  dryRun: boolean;
}

export interface RemovedSkill {
  name: string;
  canonicalPath: string;
  linkedTargets: string[];
  dryRun: boolean;
}

export type AgentScope = "global" | "project" | "nested";

export interface AgentFile {
  scope: AgentScope;
  path: string;
  exists: boolean;
}

export interface DoctorIssue {
  code: "MISSING_STORAGE_DIRECTORY" | "MISSING_TARGET_DIRECTORY" | "BROKEN_LINK";
  path: string;
  message: string;
}

export interface DoctorResult {
  configPath: string;
  storageRoot: string;
  issues: DoctorIssue[];
}
