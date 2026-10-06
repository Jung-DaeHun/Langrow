import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERRORS, type ErrorCode } from "@/lib/errors";
import { createFakeDeps } from "@/test/fakes";
import { PATCH } from "./route";

const getUser = vi.fn();
let deps = createFakeDeps();

vi.mock("@/services/supabase/server", () => ({ getServerSupabase: async () => ({ auth: { getUser } }) }));
vi.mock("@/server/deps", () => ({ getDeps: () => deps }));

const USER_ID = "11111111-1111-4111-8111-111111111111";

function patch(language: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/levels/${language}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ language }) },
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

describe("PATCH /api/levels/[language]", () => {
  it("비로그인은 401이다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    expect(await read(await patch("en", { level: 1 }))).toEqual({ status: 401, json: errorBody("UNAUTHORIZED") });
    expect(deps.db.lowerLevel).not.toHaveBeenCalled();
  });

  it.each<[ErrorCode, { agreedAt: Date | null }]>([
    ["CONSENT_REQUIRED", { agreedAt: null }],
    ["ONBOARDING_REQUIRED", { agreedAt: new Date("2026-10-01T00:00:00Z") }],
  ])("준비 상태가 부족하면 403 %s이고 레벨을 바꾸지 않는다", async (code, { agreedAt }) => {
    deps.db.getReadiness.mockResolvedValue({ agreedAt, currentLanguage: null, levels: {} });

    expect(await read(await patch("en", { level: 1 }))).toEqual({ status: 403, json: errorBody(code) });
    expect(deps.db.lowerLevel).not.toHaveBeenCalled();
  });

  it("없는 언어 경로(/api/levels/fr)는 404다", async () => {
    expect(await read(await patch("fr", { level: 1 }))).toEqual({ status: 404, json: errorBody("NOT_FOUND") });
    expect(deps.db.lowerLevel).not.toHaveBeenCalled();
  });

  it.each([
    ["level 0", { level: 0 }],
    ["level 6", { level: 6 }],
    ['level "1"', { level: "1" }],
    ["level 누락", {}],
  ])("%s는 400이고 레벨을 바꾸지 않는다", async (_label, body) => {
    expect(await read(await patch("en", body))).toEqual({ status: 400, json: errorBody("INVALID_INPUT") });
    expect(deps.db.lowerLevel).not.toHaveBeenCalled();
  });

  it("로그인 사용자 ID와 경로 언어로 레벨을 내리고 { level }을 돌려준다. body의 userId는 쓰지 않는다", async () => {
    const response = await patch("ja", { level: 1, userId: "99999999-9999-4999-8999-999999999999" });

    expect(await read(response)).toEqual({ status: 200, json: { level: 1 } });
    expect(deps.db.lowerLevel).toHaveBeenCalledWith(USER_ID, "ja", 1);
  });

  it("같거나 높은 레벨로 올리려 하면(CONFLICT) 409다", async () => {
    deps.db.lowerLevel.mockResolvedValue({ ok: false, code: "CONFLICT" });

    expect(await read(await patch("en", { level: 5 }))).toEqual({ status: 409, json: errorBody("CONFLICT") });
  });
});
