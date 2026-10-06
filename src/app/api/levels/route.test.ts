import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERRORS, type ErrorCode } from "@/lib/errors";
import { createFakeDeps } from "@/test/fakes";
import { POST } from "./route";

const getUser = vi.fn();
let deps = createFakeDeps();

vi.mock("@/services/supabase/server", () => ({ getServerSupabase: async () => ({ auth: { getUser } }) }));
vi.mock("@/server/deps", () => ({ getDeps: () => deps }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const AGREED_AT = new Date("2026-10-01T00:00:00Z");
const VALID = { language: "ja", level: 3 };

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/levels", {
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

describe("POST /api/levels", () => {
  it("비로그인은 401이다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    expect(await read(await post(VALID))).toEqual({ status: 401, json: errorBody("UNAUTHORIZED") });
    expect(deps.db.setFirstLevel).not.toHaveBeenCalled();
  });

  it("미동의는 403 CONSENT_REQUIRED이고 레벨을 만들지 않는다", async () => {
    deps.db.getReadiness.mockResolvedValue({ agreedAt: null, currentLanguage: null, levels: {} });

    expect(await read(await post(VALID))).toEqual({ status: 403, json: errorBody("CONSENT_REQUIRED") });
    expect(deps.db.setFirstLevel).not.toHaveBeenCalled();
  });

  it("동의만 하고 레벨이 없는 사용자는 로그인 사용자 ID로 첫 레벨을 만들고 200 {}를 돌려준다", async () => {
    deps.db.getReadiness.mockResolvedValue({ agreedAt: AGREED_AT, currentLanguage: null, levels: {} });

    const response = await post({ ...VALID, userId: "99999999-9999-4999-8999-999999999999" });

    expect(await read(response)).toEqual({ status: 200, json: {} });
    expect(deps.db.setFirstLevel).toHaveBeenCalledWith(USER_ID, "ja", 3);
  });

  it.each([
    ["없는 언어", { ...VALID, language: "fr" }],
    ["level 0", { ...VALID, level: 0 }],
    ["level 6", { ...VALID, level: 6 }],
    ['level "3"', { ...VALID, level: "3" }],
    ["level 1.5", { ...VALID, level: 1.5 }],
  ])("%s는 400이고 레벨을 만들지 않는다", async (_label, body) => {
    expect(await read(await post(body))).toEqual({ status: 400, json: errorBody("INVALID_INPUT") });
    expect(deps.db.setFirstLevel).not.toHaveBeenCalled();
  });

  it("이미 그 언어의 레벨이 있으면(CONFLICT) 409다. 첫 레벨 API로 레벨을 올릴 수 없다", async () => {
    deps.db.setFirstLevel.mockResolvedValue({ ok: false, code: "CONFLICT" });

    expect(await read(await post({ language: "en", level: 5 }))).toEqual({
      status: 409,
      json: errorBody("CONFLICT"),
    });
  });
});
