import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERRORS, type ErrorCode } from "@/lib/errors";
import { createFakeDeps } from "@/test/fakes";
import { PUT } from "./route";

const getUser = vi.fn();
let deps = createFakeDeps();

vi.mock("@/services/supabase/server", () => ({ getServerSupabase: async () => ({ auth: { getUser } }) }));
vi.mock("@/server/deps", () => ({ getDeps: () => deps }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const AGREED_AT = new Date("2026-10-01T00:00:00Z");

function put(body: unknown) {
  return PUT(
    new Request("http://localhost/api/me/language", {
      method: "PUT",
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

describe("PUT /api/me/language", () => {
  it("비로그인은 401이다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    expect(await read(await put({ language: "ja" }))).toEqual({ status: 401, json: errorBody("UNAUTHORIZED") });
    expect(deps.db.switchLanguage).not.toHaveBeenCalled();
  });

  it("미동의는 403 CONSENT_REQUIRED이고 언어를 바꾸지 않는다", async () => {
    deps.db.getReadiness.mockResolvedValue({ agreedAt: null, currentLanguage: null, levels: {} });

    expect(await read(await put({ language: "ja" }))).toEqual({ status: 403, json: errorBody("CONSENT_REQUIRED") });
    expect(deps.db.switchLanguage).not.toHaveBeenCalled();
  });

  it("동의만 하고 현재 언어가 없는 사용자도 로그인 사용자 ID로 전환하고 200 {}를 돌려준다", async () => {
    deps.db.getReadiness.mockResolvedValue({ agreedAt: AGREED_AT, currentLanguage: null, levels: { ja: 2 } });

    const response = await put({ language: "ja", userId: "99999999-9999-4999-8999-999999999999" });

    expect(await read(response)).toEqual({ status: 200, json: {} });
    expect(deps.db.switchLanguage).toHaveBeenCalledWith(USER_ID, "ja");
  });

  it.each([
    ["없는 언어", { language: "fr" }],
    ["language 누락", {}],
  ])("%s는 400이고 언어를 바꾸지 않는다", async (_label, body) => {
    expect(await read(await put(body))).toEqual({ status: 400, json: errorBody("INVALID_INPUT") });
    expect(deps.db.switchLanguage).not.toHaveBeenCalled();
  });

  it("대상 언어의 레벨이 없으면(RPC ONBOARDING_REQUIRED) 403이다", async () => {
    deps.db.switchLanguage.mockResolvedValue({ ok: false, code: "ONBOARDING_REQUIRED" });

    expect(await read(await put({ language: "ja" }))).toEqual({
      status: 403,
      json: errorBody("ONBOARDING_REQUIRED"),
    });
  });
});
