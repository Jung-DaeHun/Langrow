import { getRedirectUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "./proxy";

type CookieToSet = { name: string; value: string; options: Record<string, unknown> };
type CookieMethods = {
  getAll(): { name: string; value: string }[];
  setAll(cookies: CookieToSet[], headers: Record<string, string>): void;
};

// createServerClient 대신: getUser 결과를 정하고, 세션이 갱신되면 setAll을 부른다
const fake = vi.hoisted(() => ({
  user: null as { id: string } | null,
  refreshed: [] as CookieToSet[],
  cacheHeaders: {} as Record<string, string>,
  seenCookies: [] as { name: string; value: string }[],
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: CookieMethods }) => ({
    auth: {
      async getUser() {
        fake.seenCookies = options.cookies.getAll();
        if (fake.refreshed.length > 0) options.cookies.setAll(fake.refreshed, fake.cacheHeaders);
        return fake.user
          ? { data: { user: fake.user }, error: null }
          : { data: { user: null }, error: { message: "Auth session missing!" } };
      },
    },
  }),
}));

const REFRESHED: CookieToSet = {
  name: "sb-127-auth-token",
  value: "refreshed-token",
  options: { path: "/", sameSite: "lax", maxAge: 400 },
};
const CACHE_HEADERS = { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0", Expires: "0" };

function pageRequest(path: string) {
  return new NextRequest(`http://localhost:3000${path}`, { headers: { cookie: "sb-127-auth-token=old-token" } });
}

function passesThrough(response: NextResponse) {
  return getRedirectUrl(response) === null && response.headers.get("x-middleware-next") === "1";
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
  fake.user = null;
  fake.refreshed = [];
  fake.cacheHeaders = {};
  fake.seenCookies = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy", () => {
  it.each(["/home", "/chat/x"])("비로그인이면 보호 페이지 %s에서 /로 보낸다", async (path) => {
    const response = await proxy(pageRequest(path));
    expect(getRedirectUrl(response)).toBe("http://localhost:3000/");
  });

  it.each(["/", "/privacy", "/terms", "/auth/callback", "/homework"])(
    "비로그인이어도 %s는 통과한다",
    async (path) => {
      expect(passesThrough(await proxy(pageRequest(path)))).toBe(true);
    },
  );

  it("로그인 상태의 /home은 통과한다", async () => {
    fake.user = { id: "11111111-1111-4111-8111-111111111111" };
    expect(passesThrough(await proxy(pageRequest("/home")))).toBe(true);
  });

  it("요청 쿠키로 세션을 읽는다", async () => {
    await proxy(pageRequest("/home"));
    expect(fake.seenCookies).toEqual([{ name: "sb-127-auth-token", value: "old-token" }]);
  });

  it("갱신된 쿠키와 캐시 금지 헤더를 통과 응답과 다음 요청에 싣는다", async () => {
    fake.user = { id: "11111111-1111-4111-8111-111111111111" };
    fake.refreshed = [REFRESHED];
    fake.cacheHeaders = CACHE_HEADERS;

    const response = await proxy(pageRequest("/home"));

    expect(passesThrough(response)).toBe(true);
    expect(response.cookies.get(REFRESHED.name)).toMatchObject({ value: "refreshed-token", path: "/", maxAge: 400 });
    expect(response.headers.get("cache-control")).toBe(CACHE_HEADERS["Cache-Control"]);
    // Server Component가 갱신된 쿠키를 읽도록 요청 쪽 쿠키도 바꾼다
    expect(response.headers.get("x-middleware-request-cookie")).toBe("sb-127-auth-token=refreshed-token");
  });

  it("갱신된 쿠키와 캐시 금지 헤더를 redirect 응답에도 싣는다", async () => {
    fake.refreshed = [{ ...REFRESHED, value: "", options: { path: "/", maxAge: 0 } }];
    fake.cacheHeaders = CACHE_HEADERS;

    const response = await proxy(pageRequest("/home"));

    expect(getRedirectUrl(response)).toBe("http://localhost:3000/");
    expect(response.cookies.get(REFRESHED.name)).toMatchObject({ value: "", maxAge: 0 });
    expect(response.headers.get("cache-control")).toBe(CACHE_HEADERS["Cache-Control"]);
  });
});

describe("proxy matcher", () => {
  it.each(["/api/chat/sessions", "/api/me/consent", "/_next/static/x.js", "/_next/image", "/favicon.ico", "/og.png"])(
    "%s에서는 돌지 않는다",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
    },
  );

  it.each(["/home", "/", "/auth/callback", "/chat/abc", "/privacy"])("%s에서는 돈다", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });
});
