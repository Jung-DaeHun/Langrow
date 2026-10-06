import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERRORS, type ErrorCode } from "@/lib/errors";
import { createFakeDeps } from "@/test/fakes";
import { POST } from "./route";

const getUser = vi.fn();
let deps = createFakeDeps();

vi.mock("@/services/supabase/server", () => ({ getServerSupabase: async () => ({ auth: { getUser } }) }));
vi.mock("@/server/deps", () => ({ getDeps: () => deps }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NAMES = ["pro_clicked", "kana_studied"] as const;

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/events", {
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

describe("POST /api/events", () => {
  it("비로그인은 401이다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    expect(await read(await post({ name: "pro_clicked" }))).toEqual({ status: 401, json: errorBody("UNAUTHORIZED") });
    expect(deps.db.recordEvent).not.toHaveBeenCalled();
  });

  // 이벤트 이름에 따라 준비 상태 검사를 생략하지 않는다
  it.each(NAMES.flatMap((name) => [
    [name, "CONSENT_REQUIRED", null],
    [name, "ONBOARDING_REQUIRED", new Date("2026-10-01T00:00:00Z")],
  ] as const))("%s도 준비 상태가 부족하면 403 %s이고 기록하지 않는다", async (name, code, agreedAt) => {
    deps.db.getReadiness.mockResolvedValue({ agreedAt, currentLanguage: null, levels: {} });

    expect(await read(await post({ name }))).toEqual({ status: 403, json: errorBody(code) });
    expect(deps.db.recordEvent).not.toHaveBeenCalled();
  });

  it.each(NAMES)("%s를 로그인 사용자 ID로 기록하고 200 {}를 돌려준다. body의 userId는 쓰지 않는다", async (name) => {
    const response = await post({ name, userId: "99999999-9999-4999-8999-999999999999" });

    expect(await read(response)).toEqual({ status: 200, json: {} });
    expect(deps.db.recordEvent).toHaveBeenCalledWith(USER_ID, name);
  });

  it.each([
    ["limit_reached", { name: "limit_reached" }],
    ["chat_failed", { name: "chat_failed" }],
    ["level_test_submitted", { name: "level_test_submitted" }],
    ["없는 이름", { name: "visited" }],
    ["name 누락", {}],
  ])("%s는 400이고 기록하지 않는다", async (_label, body) => {
    expect(await read(await post(body))).toEqual({ status: 400, json: errorBody("INVALID_INPUT") });
    expect(deps.db.recordEvent).not.toHaveBeenCalled();
  });
});
