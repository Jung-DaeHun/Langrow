import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDeps } from "@/test/fakes";
import { GET } from "./route";

const exchangeCodeForSession = vi.fn();
let deps = createFakeDeps();

vi.mock("@/services/supabase/server", () => ({
  getServerSupabase: async () => ({ auth: { exchangeCodeForSession } }),
}));
vi.mock("@/server/deps", () => ({ getDeps: () => deps }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORIGIN = "http://localhost:3000";

function callback(query: string) {
  return GET(new NextRequest(`${ORIGIN}/auth/callback${query}`));
}

beforeEach(() => {
  deps = createFakeDeps();
  exchangeCodeForSession.mockReset().mockResolvedValue({ data: { user: { id: USER_ID }, session: {} }, error: null });
});

describe("GET /auth/callback", () => {
  it("code가 없으면(구글에서 취소) /?login=failed로 보낸다", async () => {
    const response = await callback("?error=access_denied&error_description=cancelled");

    expect(response.headers.get("location")).toBe(`${ORIGIN}/?login=failed`);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(deps.db.ensureProfile).not.toHaveBeenCalled();
  });

  it("코드 교환이 에러면 /?login=failed로 보내고 profile을 만들지 않는다", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "invalid flow state" },
    });

    const response = await callback("?code=bad");

    expect(exchangeCodeForSession).toHaveBeenCalledWith("bad");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/?login=failed`);
    expect(deps.db.ensureProfile).not.toHaveBeenCalled();
  });

  it("성공하면 ensureProfile(userId)를 부른 뒤 /home으로 보낸다", async () => {
    const response = await callback("?code=ok");

    expect(exchangeCodeForSession).toHaveBeenCalledWith("ok");
    expect(deps.db.ensureProfile).toHaveBeenCalledWith(USER_ID);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/home`);
  });

  it.each(["next=https://evil.example", "redirect_to=https://evil.example", "next=//evil.example/home"])(
    "%s가 붙어도 /home으로 보낸다",
    async (param) => {
      const response = await callback(`?code=ok&${param}`);
      expect(response.headers.get("location")).toBe(`${ORIGIN}/home`);
    },
  );
});
