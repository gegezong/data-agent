export type ErrorCode =
  | "USER_NOT_FOUND"
  | "MODEL_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "INTERNAL_ERROR";

export class DataAgentError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    readonly statusCode = 500,
  ) {
    super(message);
    this.name = "DataAgentError";
  }
}

export function toApiError(error: unknown, fallback: string): {
  code: ErrorCode;
  statusCode: number;
  message: string;
} {
  if (error instanceof DataAgentError) {
    return { code: error.code, statusCode: error.statusCode, message: error.message };
  }
  return {
    code: "INTERNAL_ERROR",
    statusCode: 500,
    message: error instanceof Error ? error.message : fallback,
  };
}
