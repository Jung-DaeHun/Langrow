import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERRORS, type ErrorCode } from "@/lib/errors";
import { createFakeDeps } from "@/test/fakes";
import { maxDuration, POST } from "./route";

const getUser = vi.fn();
let deps = createFakeDeps();

vi.mock("@/services/supabase/server", () => ({ getServerSupabase: async () => ({ auth: { getUser } }) }));
vi.mock("@/server/deps", () => ({ getDeps: () => deps }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const FEEDBACK = { good: "자기소개를 끝까지 이어 갔어요.", improve: ["I'm으로 문장을 시작해 보세요."] };

// body가 없는 API도 JSON Content-Type은 보낸다
function post(id = SESSION_ID, body?: string) {
  return POST(
    new Request(`http://localhost/api/chat/sessions/${id}/end`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
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

function expectNoEndWork() {
  expect(deps.db.beginEnd).not.toHaveBeenCalled();
  expect(deps.ai.generateFeedback).not.toHaveBeenCalled();
  expect(deps.db.finishEnd).not.toHaveBeenCalled();
  expect(deps.db.failEnd).not.toHaveBeenCalled();
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

describe("POST /api/chat/sessions/[id]/end", () => {
  it("maxDuration은 60초다", () => {
    expect(maxDuration).toBe(60);
  });

  it("비로그인은 401이다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    expect(await read(await post())).toEqual({ status: 401, json: errorBody("UNAUTHORIZED") });
    expectNoEndWork();
  });

  it.each<[ErrorCode, { agreedAt: Date | null }]>([
    ["CONSENT_REQUIRED", { agreedAt: null }],
    ["ONBOARDING_REQUIRED", { agreedAt: new Date("2026-10-01T00:00:00Z") }],
  ])("준비 상태가 부족하면 403 %s이고 종료 RPC·AI를 부르지 않는다", async (code, { agreedAt }) => {
    deps.db.getReadiness.mockResolvedValue({ agreedAt, currentLanguage: null, levels: {} });

    expect(await read(await post())).toEqual({ status: 403, json: errorBody(code) });
    expectNoEndWork();
  });

  it("uuid가 아닌 id는 404다", async () => {
    expect(await read(await post("not-a-uuid"))).toEqual({ status: 404, json: errorBody("NOT_FOUND") });
    expectNoEndWork();
  });

  it("로그인 사용자 ID와 경로 id로 종료하고 피드백을 200으로 돌려준다. body의 userId는 쓰지 않는다", async () => {
    deps.ai.generateFeedback.mockResolvedValue({ ok: true, value: FEEDBACK });

    const response = await post(SESSION_ID, JSON.stringify({ userId: "99999999-9999-4999-8999-999999999999" }));

    expect(await read(response)).toEqual({
      status: 200,
      json: { status: "ended", feedbackStatus: "ready", feedback: FEEDBACK },
    });
    expect(deps.db.beginEnd).toHaveBeenCalledWith(USER_ID, SESSION_ID);
    expect(deps.db.finishEnd).toHaveBeenCalledWith(USER_ID, SESSION_ID, expect.any(String), FEEDBACK);
  });

  it("ending이면 202와 retryAfterSeconds를 돌려준다", async () => {
    deps.db.beginEnd.mockResolvedValue({ ok: true, value: { state: "ending" } });

    expect(await read(await post())).toEqual({ status: 202, json: { status: "ending", retryAfterSeconds: 2 } });
    expect(deps.ai.generateFeedback).not.toHaveBeenCalled();
  });

  it("턴 처리 중(CONFLICT)이면 409다", async () => {
    deps.db.beginEnd.mockResolvedValue({ ok: false, code: "CONFLICT" });

    expect(await read(await post())).toEqual({ status: 409, json: errorBody("CONFLICT") });
    expect(deps.ai.generateFeedback).not.toHaveBeenCalled();
  });
});
