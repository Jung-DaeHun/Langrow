export type ErrorCode =
  | "UNAUTHORIZED"
  | "CONSENT_REQUIRED"
  | "ONBOARDING_REQUIRED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "LIMIT_REACHED"
  | "AI_FAILURE_LIMIT"
  | "AI_UNAVAILABLE"
  | "SESSION_FULL"
  | "CONFLICT"
  | "INTERNAL";

// message는 사용자에게 그대로 보인다
export const ERRORS: Record<ErrorCode, { status: number; message: string }> = {
  UNAUTHORIZED: { status: 401, message: "로그인이 필요해요." },
  CONSENT_REQUIRED: { status: 403, message: "약관에 동의한 뒤 이용할 수 있어요." },
  ONBOARDING_REQUIRED: { status: 403, message: "학습할 언어와 레벨을 먼저 골라 주세요." },
  INVALID_INPUT: { status: 400, message: "입력한 내용을 다시 확인해 주세요." },
  NOT_FOUND: { status: 404, message: "찾을 수 없어요." },
  LIMIT_REACHED: { status: 429, message: "오늘 사용량을 모두 썼어요." },
  AI_FAILURE_LIMIT: { status: 429, message: "오늘은 응답 오류가 많아 대화를 잠시 쉬어요. 내일 다시 시도해 주세요." },
  AI_UNAVAILABLE: { status: 503, message: "응답을 받지 못했어요. 턴은 차감되지 않았어요." },
  SESSION_FULL: { status: 409, message: "이 대화는 20턴을 모두 채웠어요." },
  CONFLICT: { status: 409, message: "다른 요청과 겹쳤어요. 화면을 새로 고친 뒤 다시 시도해 주세요." },
  INTERNAL: { status: 500, message: "잠시 후 다시 시도해 주세요." },
};

export function isErrorCode(x: unknown): x is ErrorCode {
  return typeof x === "string" && Object.hasOwn(ERRORS, x);
}
