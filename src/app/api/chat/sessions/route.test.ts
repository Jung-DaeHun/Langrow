import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERRORS, type ErrorCode } from "@/lib/errors";
import { createFakeDeps } from "@/test/fakes";
import { POST } from "./route";

const getUser = vi.fn();
let deps = createFakeDeps();

vi.mock("@/services/supabase/server", () => ({ getServerSupabase: async () => ({ auth: { getUser } }) }));
vi.mock("@/server/deps", () => ({ getDeps: () => deps }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const VALID = { language: "en", level: 1, scenario_id: "l1-cafe" };

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/chat/sessions", {
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

describe("POST /api/chat/sessions", () => {
  it("비로그인은 401이다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    expect(await read(await post(VALID))).toEqual({ status: 401, json: errorBody("UNAUTHORIZED") });
    expect(deps.db.createChatSession).not.toHaveBeenCalled();
  });

  it.each<[ErrorCode, { agreedAt: Date | null }]>([
    ["CONSENT_REQUIRED", { agreedAt: null }],
    ["ONBOARDING_REQUIRED", { agreedAt: new Date("2026-10-01T00:00:00Z") }],
  ])("준비 상태가 부족하면 403 %s이고 세션을 만들지 않는다", async (code, { agreedAt }) => {
    deps.db.getReadiness.mockResolvedValue({ agreedAt, currentLanguage: null, levels: {} });

    expect(await read(await post(VALID))).toEqual({ status: 403, json: errorBody(code) });
    expect(deps.db.createChatSession).not.toHaveBeenCalled();
  });

  it.each([
    ["없는 언어", { ...VALID, language: "fr" }],
    ["level 0", { ...VALID, level: 0 }],
    ["level 6", { ...VALID, level: 6 }],
    ['level "3"', { ...VALID, level: "3" }],
    ["level 1.5", { ...VALID, level: 1.5 }],
    ["scenario_id 누락", { language: "en", level: 1 }],
    ["빈 scenario_id", { ...VALID, scenario_id: "" }],
  ])("%s는 400이고 세션을 만들지 않는다", async (_label, body) => {
    expect(await read(await post(body))).toEqual({ status: 400, json: errorBody("INVALID_INPUT") });
    expect(deps.db.createChatSession).not.toHaveBeenCalled();
  });

  it("다른 레벨의 상황은 400이다", async () => {
    expect(await read(await post({ ...VALID, scenario_id: "l2-hotel" }))).toEqual({
      status: 400,
      json: errorBody("INVALID_INPUT"),
    });
    expect(deps.db.createChatSession).not.toHaveBeenCalled();
  });

  it("로그인 사용자 ID와 body 값으로 세션을 만들고, body의 userId는 쓰지 않는다", async () => {
    deps.db.createChatSession.mockResolvedValue({ ok: true, value: { sessionId: SESSION_ID } });

    const response = await post({ ...VALID, userId: "99999999-9999-4999-8999-999999999999" });

    expect(await read(response)).toEqual({ status: 200, json: { sessionId: SESSION_ID } });
    expect(deps.db.createChatSession).toHaveBeenCalledWith(USER_ID, { language: "en", level: 1, scenarioId: "l1-cafe" });
  });

  it("RPC가 CONFLICT면 409다", async () => {
    deps.db.createChatSession.mockResolvedValue({ ok: false, code: "CONFLICT" });

    expect(await read(await post(VALID))).toEqual({ status: 409, json: errorBody("CONFLICT") });
  });
});
