import { describe, expect, it } from "vitest";
import { ERRORS, type ErrorCode, isErrorCode } from "./errors";

const TABLE: [ErrorCode, number, string][] = [
  ["UNAUTHORIZED", 401, "로그인이 필요해요."],
  ["CONSENT_REQUIRED", 403, "약관에 동의한 뒤 이용할 수 있어요."],
  ["ONBOARDING_REQUIRED", 403, "학습할 언어와 레벨을 먼저 골라 주세요."],
  ["INVALID_INPUT", 400, "입력한 내용을 다시 확인해 주세요."],
  ["NOT_FOUND", 404, "찾을 수 없어요."],
  ["LIMIT_REACHED", 429, "오늘 사용량을 모두 썼어요."],
  ["AI_FAILURE_LIMIT", 429, "오늘은 응답 오류가 많아 대화를 잠시 쉬어요. 내일 다시 시도해 주세요."],
  ["AI_UNAVAILABLE", 503, "응답을 받지 못했어요. 턴은 차감되지 않았어요."],
  ["SESSION_FULL", 409, "이 대화는 20턴을 모두 채웠어요."],
  ["CONFLICT", 409, "다른 요청과 겹쳤어요. 화면을 새로 고친 뒤 다시 시도해 주세요."],
  ["INTERNAL", 500, "잠시 후 다시 시도해 주세요."],
];

describe("ERRORS", () => {
  it.each(TABLE)("%s는 %i과 문구를 가진다", (code, status, message) => {
    expect(ERRORS[code]).toEqual({ status, message });
  });

  it("표에 없는 코드는 없다", () => {
    expect(Object.keys(ERRORS).sort()).toEqual(TABLE.map(([code]) => code).sort());
  });
});

describe("isErrorCode", () => {
  it("에러 코드 문자열만 true다", () => {
    expect(isErrorCode("CONFLICT")).toBe(true);
    expect(isErrorCode("conflict")).toBe(false);
    expect(isErrorCode("toString")).toBe(false);
    expect(isErrorCode(409)).toBe(false);
    expect(isErrorCode(null)).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
  });
});
