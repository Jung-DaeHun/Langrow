import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 모듈 안 싱글턴이 테스트 사이에 남지 않게 매번 새로 import한다
async function load() {
  vi.resetModules();
  return import("./browser");
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getBrowserSupabase", () => {
  it("env가 없어도 import만으로는 throw하지 않는다", async () => {
    await expect(load()).resolves.toHaveProperty("getBrowserSupabase");
  });

  it("env 없이 호출하면 env 에러다", async () => {
    const { getBrowserSupabase } = await load();
    expect(() => getBrowserSupabase()).toThrow("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("env가 있으면 클라이언트를 만들고 다시 호출해도 같은 인스턴스다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    const { getBrowserSupabase } = await load();
    const client = getBrowserSupabase();
    expect(client.auth).toBeDefined();
    expect(getBrowserSupabase()).toBe(client);
  });
});
