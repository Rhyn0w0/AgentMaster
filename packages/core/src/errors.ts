export type ErrorCode =
  | "CONFIG_EXISTS"
  | "CONFIG_NOT_FOUND"
  | "INVALID_CONFIG"
  | "INVALID_NAME"
  | "INVALID_SOURCE"
  | "MISSING_SKILL"
  | "SKILL_EXISTS"
  | "SKILL_NOT_FOUND"
  | "TARGET_NOT_FOUND"
  | "TARGET_CONFLICT"
  | "CONFIRMATION_REQUIRED"
  | "OPERATION_FAILED";

export class AgentMasterError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AgentMasterError";
    this.code = code;
    this.details = details;
  }
}

export function asAgentMasterError(error: unknown): AgentMasterError {
  if (error instanceof AgentMasterError) {
    return error;
  }

  if (error instanceof Error) {
    return new AgentMasterError("OPERATION_FAILED", error.message, error);
  }

  return new AgentMasterError("OPERATION_FAILED", String(error));
}
