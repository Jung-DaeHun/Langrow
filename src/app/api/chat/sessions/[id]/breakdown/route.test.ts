import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERRORS, type ErrorCode } from "@/lib/errors";
import {
  BREAKDOWN_FAILURE_LIMIT_MESSAGE,
  BREAKDOWN_IN_PROGRESS_MESSAGE,
  BREAKDOWN_UNAVAILABLE_MESSAGE,
} from "@/server/chat";
import type { DbErrorCode } from "@/server/db/types";
import { createFakeDeps } from "@/test/fakes";
import { maxDuration, POST } from "./route";

const getUser = vi.fn();
let deps = createFakeDeps();

vi.mock("@/services/supabase/server", () => ({ getServerSupabase: async () => ({ auth: { getUser } }) }));
vi.mock("@/server/deps", () => ({ getDeps: () => deps }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const VALID = { turn_no: 3, target: "reply" };
// 기본 가짜 ai의 뜯어보기 (src/test/fakes.ts)
const GENERATED = [
  { text: "Nice", meaning_ko: "반가워요" },
  { text: "to meet you!", meaning_ko: "만나서" },
];

function post(body: unknown, id = SESSION_ID) {
  return POST(
    new Request(`http://localhost/api/chat/sessions/${id}/breakdown`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function read(response: Response) {
  return { status: response.status, json: await response.json() };
}

function errorBody(code: ErrorCode) {
  return { code, message: ERRORS[code].message };
}

function expectNoBreakdownWork() {
  expect(deps.db.beginTurnBreakdown).not.toHaveBeenCalled();
  expect(deps.ai.generateBreakdown).not.toHaveBeenCalled();
  expect(deps.db.saveTurnBreakdown).not.toHaveBeenCalled();
  expect(deps.db.failTurnBreakdown).not.toHaveBeenCalled();
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

describe("POST /api/chat/sessions/[id]/breakdown", () => {
  it("AI 호출 예산보다 긴 maxDuration 60초를 둔다", () => {
    expect(maxDuration).toBe(60);
  });

  it("비로그인은 401이고 시작 RPC·AI를 부르지 않는다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    expect(await read(await post(VALID))).toEqual({ status: 401, json: errorBody("UNAUTHORIZED") });
    expectNoBreakdownWork();
  });

  it.each<[ErrorCode, { agreedAt: Date | null }]>([
    ["CONSENT_REQUIRED", { agreedAt: null }],
    ["ONBOARDING_REQUIRED", { agreedAt: new Date("2026-10-01T00:00:00Z") }],
  ])("준비 상태가 부족하면 403 %s이고 시작 RPC·AI를 부르지 않는다", async (code, { agreedAt }) => {
    deps.db.getReadiness.mockResolvedValue({ agreedAt, currentLanguage: null, levels: {} });

    expect(await read(await post(VALID))).toEqual({ status: 403, json: errorBody(code) });
    expectNoBreakdownWork();
  });

  it.each([
    ["turn_no 0", { turn_no: 0, target: "reply" }],
    ["turn_no 21", { turn_no: 21, target: "reply" }],
    ["소수 turn_no", { turn_no: 1.5, target: "reply" }],
    ["문자열 turn_no", { turn_no: "3", target: "reply" }],
    ["그 밖의 target", { turn_no: 3, target: "user" }],
    ["turn_no 누락", { target: "reply" }],
    ["target 누락", { turn_no: 3 }],
  ])("%s는 400이고 시작 RPC·AI를 부르지 않는다", async (_label, body) => {
    expect(await read(await post(body))).toEqual({ status: 400, json: errorBody("INVALID_INPUT") });
    expectNoBreakdownWork();
  });

  it.each([
    [1, "reply"],
    [20, "corrected"],
  ])("turn_no %i·target %s는 통과한다", async (turnNo, target) => {
    expect((await post({ turn_no: turnNo, target })).status).toBe(200);
    expect(deps.db.beginTurnBreakdown).toHaveBeenCalledWith(USER_ID, SESSION_ID, turnNo, target);
  });

  it("uuid가 아닌 id는 404이고 시작 RPC를 부르지 않는다", async () => {
    expect(await read(await post(VALID, "not-a-uuid"))).toEqual({ status: 404, json: errorBody("NOT_FOUND") });
    expectNoBreakdownWork();
  });

  it("로그인 사용자 ID·경로 id·body로 뜯어보기를 만들고 { breakdown }을 돌려준다. body의 userId는 쓰지 않는다", async () => {
    const response = await post({ ...VALID, userId: "99999999-9999-4999-8999-999999999999" });

    expect(await read(response)).toEqual({ status: 200, json: { breakdown: GENERATED } });
    expect(deps.db.beginTurnBreakdown).toHaveBeenCalledWith(USER_ID, SESSION_ID, 3, "reply");
    expect(deps.db.saveTurnBreakdown).toHaveBeenCalledWith(USER_ID, SESSION_ID, 3, "reply", expect.any(String), GENERATED);
  });

  it.each<[DbErrorCode, number]>([
    ["NOT_FOUND", 404],
    ["ONBOARDING_REQUIRED", 403],
  ])("시작 RPC가 %s면 %i이고 AI를 부르지 않는다", async (code, status) => {
    deps.db.beginTurnBreakdown.mockResolvedValue({ ok: false, code });

    expect(await read(await post(VALID))).toEqual({ status, json: errorBody(code) });
    expect(deps.ai.generateBreakdown).not.toHaveBeenCalled();
  });

  it.each<[DbErrorCode, number, string]>([
    ["AI_FAILURE_LIMIT", 429, BREAKDOWN_FAILURE_LIMIT_MESSAGE],
    ["CONFLICT", 409, BREAKDOWN_IN_PROGRESS_MESSAGE],
  ])("시작 RPC가 %s면 %i이고 뜯어보기용 문구다", async (code, status, message) => {
    deps.db.beginTurnBreakdown.mockResolvedValue({ ok: false, code });

    expect(await read(await post(VALID))).toEqual({ status, json: { code, message } });
    expect(deps.ai.generateBreakdown).not.toHaveBeenCalled();
  });

  it("AI 실패는 503이고 뜯어보기 실패 문구다", async () => {
    deps.ai.generateBreakdown.mockResolvedValue({ ok: false, reason: "timeout" });

    expect(await read(await post(VALID))).toEqual({
      status: 503,
      json: { code: "AI_UNAVAILABLE", message: BREAKDOWN_UNAVAILABLE_MESSAGE },
    });
  });
});
