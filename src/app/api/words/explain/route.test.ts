import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERRORS, type ErrorCode } from "@/lib/errors";
import { EXPLAIN_FAILURE_LIMIT_MESSAGE, EXPLAIN_UNAVAILABLE_MESSAGE } from "@/server/learning";
import { createFakeDeps } from "@/test/fakes";
import { maxDuration, POST } from "./route";

const getUser = vi.fn();
let deps = createFakeDeps();

vi.mock("@/services/supabase/server", () => ({ getServerSupabase: async () => ({ auth: { getUser } }) }));
vi.mock("@/server/deps", () => ({ getDeps: () => deps }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
// 기본 가짜 단어의 정답은 went, 보기는 goes·gone·going (src/test/fakes.ts)
const VALID = { word_id: "en-1-001", choice: "goes" };

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/words/explain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  );
}

async function read(response: Response) {
  return { status: response.status, json: await response.json() };
}

function errorBody(code: ErrorCode) {
  return { code, message: ERRORS[code].message };
}

beforeEach(() => {
  deps = createFakeDeps();
  getUser.mockReset().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/words/explain", () => {
  it("AI 호출 예산보다 긴 maxDuration 60초를 둔다", () => {
    expect(maxDuration).toBe(60);
  });

  it("비로그인은 401이고 단어를 읽지 않는다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    expect(await read(await post(VALID))).toEqual({ status: 401, json: errorBody("UNAUTHORIZED") });
    expect(deps.db.getWord).not.toHaveBeenCalled();
  });

  it.each<[ErrorCode, { agreedAt: Date | null }]>([
    ["CONSENT_REQUIRED", { agreedAt: null }],
    ["ONBOARDING_REQUIRED", { agreedAt: new Date("2026-10-01T00:00:00Z") }],
  ])("준비 상태가 부족하면 403 %s이고 단어를 읽거나 AI를 부르지 않는다", async (code, { agreedAt }) => {
    deps.db.getReadiness.mockResolvedValue({ agreedAt, currentLanguage: null, levels: {} });

    expect(await read(await post(VALID))).toEqual({ status: 403, json: errorBody(code) });
    expect(deps.db.getWord).not.toHaveBeenCalled();
    expect(deps.ai.generateExplanation).not.toHaveBeenCalled();
  });

  it.each([
    ["word_id 누락", { choice: "goes" }],
    ["빈 word_id", { word_id: "" }],
    ["너무 긴 word_id", { word_id: "x".repeat(51) }],
    ["빈 choice", { word_id: "en-1-001", choice: "" }],
    ["51자 choice", { word_id: "en-1-001", choice: "x".repeat(51) }],
    ["문자열이 아닌 choice", { word_id: "en-1-001", choice: 1 }],
  ])("%s는 400이고 단어를 읽지 않는다", async (_label, body) => {
    expect(await read(await post(body))).toEqual({ status: 400, json: errorBody("INVALID_INPUT") });
    expect(deps.db.getWord).not.toHaveBeenCalled();
  });

  it("로그인 사용자 ID로 설명하고 { explanation }을 돌려준다. body의 userId는 쓰지 않는다", async () => {
    const response = await post({ ...VALID, userId: "99999999-9999-4999-8999-999999999999" });

    expect(await read(response)).toEqual({ status: 200, json: { explanation: "과거의 일이라 went를 써요." } });
    expect(deps.db.beginWordExplanation).toHaveBeenCalledWith(USER_ID, "en-1-001", "goes");
  });

  it("복습 요청(choice 없음)도 받는다", async () => {
    expect((await post({ word_id: "en-1-001" })).status).toBe(200);
    expect(deps.db.beginWordExplanation).toHaveBeenCalledWith(USER_ID, "en-1-001", "");
  });

  it("AI 실패는 503이고 설명 실패 문구다", async () => {
    deps.ai.generateExplanation.mockResolvedValue({ ok: false, reason: "timeout" });

    expect(await read(await post(VALID))).toEqual({
      status: 503,
      json: { code: "AI_UNAVAILABLE", message: EXPLAIN_UNAVAILABLE_MESSAGE },
    });
  });

  it("설명 한도(LIMIT_REACHED)는 429다", async () => {
    deps.db.beginWordExplanation.mockResolvedValue({ ok: false, code: "LIMIT_REACHED" });

    expect(await read(await post(VALID))).toEqual({ status: 429, json: errorBody("LIMIT_REACHED") });
  });

  it("실패 10회(AI_FAILURE_LIMIT)는 429이고 설명용 문구다", async () => {
    deps.db.beginWordExplanation.mockResolvedValue({ ok: false, code: "AI_FAILURE_LIMIT" });

    expect(await read(await post(VALID))).toEqual({
      status: 429,
      json: { code: "AI_FAILURE_LIMIT", message: EXPLAIN_FAILURE_LIMIT_MESSAGE },
    });
  });
});
