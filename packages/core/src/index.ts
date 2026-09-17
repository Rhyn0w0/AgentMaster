export { discoverAgents } from "./agents.js";
export type { ConfigFile, InitializeOptions } from "./config.js";
export {
  defaultConfig,
  ensureStorageDirectories,
  initializeConfig,
  loadConfig,
  resolveConfig,
  setConfigValue,
  writeConfig,
} from "./config.js";
export { doctor } from "./doctor.js";
export type { ErrorCode } from "./errors.js";
export { AgentMasterError, asAgentMasterError } from "./errors.js";
export { expandPath, getConfigPath, resolveConfiguredPath, resolveFrom } from "./paths.js";
export { addSkill, inspectSkill, linkSkill, listSkills, removeSkill } from "./skills.js";
export type {
  AddedSkill,
  AgentFile,
  AgentScope,
  Config,
  DoctorIssue,
  DoctorResult,
  LinkAction,
  LinkMode,
  ManagedSkillLink,
  RemovedSkill,
  ResolvedConfig,
  SkillLinkResult,
  SkillMetadata,
  SkillSummary,
  TargetConfig,
} from "./types.js";
