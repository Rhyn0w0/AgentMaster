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
export { AgentMasterError, asAgentMasterError } from "./errors.js";
export { expandPath, getConfigPath, resolveFrom } from "./paths.js";
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
  RemovedSkill,
  ResolvedConfig,
  SkillLinkResult,
  SkillSummary,
  TargetConfig,
} from "./types.js";
