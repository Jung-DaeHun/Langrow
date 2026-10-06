import type { ErrorCode } from "@/lib/errors";

// RPC가 예상된 거부로 돌려줄 수 있는 코드
export type DbErrorCode = Extract<
  ErrorCode,
  | "CONSENT_REQUIRED"
  | "ONBOARDING_REQUIRED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "LIMIT_REACHED"
  | "AI_FAILURE_LIMIT"
  | "SESSION_FULL"
  | "CONFLICT"
>;

export type DbResult<T> = { ok: true; value: T } | { ok: false; code: DbErrorCode };
