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
    new Request("http://localhost/api/me/consent", {
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

describe("POST /api/me/consent", () => {
  it("비로그인은 401이다", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    expect(await read(await post())).toEqual({ status: 401, json: errorBody("UNAUTHORIZED") });
    expect(deps.db.agreeTerms).not.toHaveBeenCalled();
  });

  it("미동의·미온보딩 사용자도 로그인 사용자 ID로 동의하고 200 {}를 돌려준다. body의 userId는 쓰지 않는다", async () => {
    deps.db.getReadiness.mockResolvedValue({ agreedAt: null, currentLanguage: null, levels: {} });

    const response = await post(JSON.stringify({ userId: "99999999-9999-4999-8999-999999999999" }));

    expect(await read(response)).toEqual({ status: 200, json: {} });
    expect(deps.db.agreeTerms).toHaveBeenCalledWith(USER_ID);
  });
});
