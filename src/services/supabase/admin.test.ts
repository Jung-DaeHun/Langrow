import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 지연 싱글턴이 테스트 사이에 남지 않게 매번 새로 import한다
async function load() {
  vi.resetModules();
  return import("./admin");
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
  vi.stubEnv("SUPABASE_SECRET_KEY", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getAdminSupabase", () => {
  it("env가 없어도 import만으로는 throw하지 않는다", async () => {
    await expect(load()).resolves.toHaveProperty("getAdminSupabase");
  });

  it("env 없이 호출하면 env 에러다", async () => {
    const { getAdminSupabase } = await load();
    expect(() => getAdminSupabase()).toThrow("SUPABASE_SECRET_KEY");
  });

  it("env가 있으면 클라이언트를 만들고 다시 호출해도 같은 인스턴스다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
    const { getAdminSupabase } = await load();
    const client = getAdminSupabase();
    expect(client.auth).toBeDefined();
    expect(getAdminSupabase()).toBe(client);
  });

  it("env 에러 뒤에도 env가 생기면 클라이언트를 만든다", async () => {
    const { getAdminSupabase } = await load();
    expect(() => getAdminSupabase()).toThrow();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
    expect(getAdminSupabase().auth).toBeDefined();
  });
});
