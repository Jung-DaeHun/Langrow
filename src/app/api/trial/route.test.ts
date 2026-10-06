import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERRORS, type ErrorCode } from "@/lib/errors";
import { createFakeDeps } from "@/test/fakes";
import { POST } from "./route";

const getUser = vi.fn();
let deps = createFakeDeps();

vi.mock("@/services/supabase/server", () => ({ getServerSupabase: async () => ({ auth: { getUser } }) }));
vi.mock("@/server/deps", () => ({ getDeps: () => deps }));

const USER_ID = "11111111-1111-4111-8111-111111111111";

// body가 없는 API도 JSON Content-Type은 보낸다
function post(body?: string) {
  return POST(
    new Request("http://localhost/api/trial", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
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

describe("POST /api/trial", () => {
  it("비로그인은 401이다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    expect(await read(await post())).toEqual({ status: 401, json: errorBody("UNAUTHORIZED") });
    expect(deps.db.startTrial).not.toHaveBeenCalled();
  });

  it.each<[ErrorCode, { agreedAt: Date | null }]>([
    ["CONSENT_REQUIRED", { agreedAt: null }],
    ["ONBOARDING_REQUIRED", { agreedAt: new Date("2026-10-01T00:00:00Z") }],
  ])("준비 상태가 부족하면 403 %s이고 체험을 시작하지 않는다", async (code, { agreedAt }) => {
    deps.db.getReadiness.mockResolvedValue({ agreedAt, currentLanguage: null, levels: {} });

    expect(await read(await post())).toEqual({ status: 403, json: errorBody(code) });
    expect(deps.db.startTrial).not.toHaveBeenCalled();
  });

  it("로그인 사용자 ID로 체험을 시작하고 proUntil을 ISO 문자열로 돌려준다. body의 userId는 쓰지 않는다", async () => {
    deps.db.startTrial.mockResolvedValue({ ok: true, value: { proUntil: new Date("2026-10-13T03:04:05.678Z") } });

    const response = await post(JSON.stringify({ userId: "99999999-9999-4999-8999-999999999999" }));

    expect(await read(response)).toEqual({ status: 200, json: { proUntil: "2026-10-13T03:04:05.678Z" } });
    expect(deps.db.startTrial).toHaveBeenCalledWith(USER_ID);
  });

  it("두 번째 요청(CONFLICT)은 409다", async () => {
    deps.db.startTrial.mockResolvedValue({ ok: false, code: "CONFLICT" });

    expect(await read(await post())).toEqual({ status: 409, json: errorBody("CONFLICT") });
  });
});
