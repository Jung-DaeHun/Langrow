import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = { getAll: vi.fn(() => []), set: vi.fn() };

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => cookieStore) }));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getServerSupabase", () => {
  it("env가 없어도 import만으로는 throw하지 않는다", async () => {
    vi.resetModules();
    await expect(import("./server")).resolves.toHaveProperty("getServerSupabase");
  });

  it("env 없이 호출하면 env 에러다", async () => {
    const { getServerSupabase } = await import("./server");
    await expect(getServerSupabase()).rejects.toThrow("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  });

  // 빌드의 정적 렌더링에서 cookies()가 먼저 불려야 보호 페이지가 동적 페이지로 판정된다(env 없는 next build)
  it("env 검증보다 쿠키를 먼저 읽는다", async () => {
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockClear();
    const { getServerSupabase } = await import("./server");

    await expect(getServerSupabase()).rejects.toThrow("NEXT_PUBLIC_SUPABASE_URL");
    expect(cookies).toHaveBeenCalledTimes(1);
  });

  it("env가 있으면 요청 쿠키로 클라이언트를 만든다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    const { getServerSupabase } = await import("./server");
    const client = await getServerSupabase();
    expect(client.auth).toBeDefined();
  });
});
