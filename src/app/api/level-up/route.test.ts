import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERRORS, type ErrorCode } from "@/lib/errors";
import { LEVEL_TEST_SIZE } from "@/lib/levelTest";
import { createFakeDeps } from "@/test/fakes";
import { POST } from "./route";

const getUser = vi.fn();
let deps = createFakeDeps();

vi.mock("@/services/supabase/server", () => ({ getServerSupabase: async () => ({ auth: { getUser } }) }));
vi.mock("@/server/deps", () => ({ getDeps: () => deps }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
// 가짜 db의 기본 단어는 en 레벨 1, 예문 "This is a {{pen}}."라 정답은 모두 pen이다
const ids = (n: number) => Array.from({ length: n }, (_, i) => `en-1-${String(i + 1).padStart(3, "0")}`);
const answers = (n: number, answer = "pen") => ids(n).map((id) => ({ word_id: id, answer }));
const VALID = { language: "en", from_level: 1, answers: answers(LEVEL_TEST_SIZE) };

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/level-up", {
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

describe("POST /api/level-up", () => {
  it("비로그인은 401이다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    expect(await read(await post(VALID))).toEqual({ status: 401, json: errorBody("UNAUTHORIZED") });
    expect(deps.db.submitLevelTest).not.toHaveBeenCalled();
  });

  it.each<[ErrorCode, { agreedAt: Date | null }]>([
    ["CONSENT_REQUIRED", { agreedAt: null }],
    ["ONBOARDING_REQUIRED", { agreedAt: new Date("2026-10-01T00:00:00Z") }],
  ])("준비 상태가 부족하면 403 %s이고 결과를 저장하지 않는다", async (code, { agreedAt }) => {
    deps.db.getReadiness.mockResolvedValue({ agreedAt, currentLanguage: null, levels: {} });

    expect(await read(await post(VALID))).toEqual({ status: 403, json: errorBody(code) });
    expect(deps.db.submitLevelTest).not.toHaveBeenCalled();
  });

  it.each([
    ["답안 19개", { ...VALID, answers: answers(LEVEL_TEST_SIZE - 1) }],
    ["답안 21개", { ...VALID, answers: answers(LEVEL_TEST_SIZE + 1) }],
    ["중복 word_id", { ...VALID, answers: [...answers(LEVEL_TEST_SIZE - 1), answers(1)[0]] }],
    ["51자 답안", { ...VALID, answers: answers(LEVEL_TEST_SIZE, "x".repeat(51)) }],
    ["answer 누락", { ...VALID, answers: ids(LEVEL_TEST_SIZE).map((id) => ({ word_id: id })) }],
    ["빈 word_id", { ...VALID, answers: [...answers(LEVEL_TEST_SIZE - 1), { word_id: "", answer: "pen" }] }],
    ["from_level 5", { ...VALID, from_level: 5 }],
    ["from_level 0", { ...VALID, from_level: 0 }],
    ['from_level "2"', { ...VALID, from_level: "2" }],
    ["없는 언어", { ...VALID, language: "fr" }],
  ])("%s는 400이고 결과를 저장하지 않는다", async (_label, body) => {
    expect(await read(await post(body))).toEqual({ status: 400, json: errorBody("INVALID_INPUT") });
    expect(deps.db.submitLevelTest).not.toHaveBeenCalled();
  });

  it("서버가 채점해 로그인 사용자 ID로 저장하고, 틀린 문제의 정답을 돌려준다. body의 점수·userId는 쓰지 않는다", async () => {
    deps.db.submitLevelTest.mockResolvedValue({ ok: true, value: { passed: true, level: 2 } });
    const submitted = ids(LEVEL_TEST_SIZE).map((id, i) => ({ word_id: id, answer: i < 16 ? "pen" : "cup" }));

    const response = await post({
      ...VALID,
      answers: submitted,
      userId: "99999999-9999-4999-8999-999999999999",
      score: 20,
      passed: true,
    });

    expect(await read(response)).toEqual({
      status: 200,
      json: {
        passed: true,
        level: 2,
        score: 16,
        wrong: ids(LEVEL_TEST_SIZE).slice(16).map((id) => ({ wordId: id, answer: "pen" })),
      },
    });
    expect(deps.db.submitLevelTest).toHaveBeenCalledWith(USER_ID, {
      language: "en",
      fromLevel: 1,
      score: 16,
      passed: true,
    });
  });

  it("50자 답안은 받는다", async () => {
    expect((await post({ ...VALID, answers: answers(LEVEL_TEST_SIZE, "x".repeat(50)) })).status).toBe(200);
  });

  it("다른 레벨의 단어로 낸 시험은 400이다", async () => {
    expect(await read(await post({ ...VALID, from_level: 2 }))).toEqual({
      status: 400,
      json: errorBody("INVALID_INPUT"),
    });
    expect(deps.db.submitLevelTest).not.toHaveBeenCalled();
  });

  it("실제 레벨이 다르거나 같은 시험을 다시 내면(CONFLICT) 409다", async () => {
    deps.db.submitLevelTest.mockResolvedValue({ ok: false, code: "CONFLICT" });

    expect(await read(await post(VALID))).toEqual({ status: 409, json: errorBody("CONFLICT") });
  });
});
