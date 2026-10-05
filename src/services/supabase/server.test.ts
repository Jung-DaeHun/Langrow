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

  it("env가 있으면 요청 쿠키로 클라이언트를 만든다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    const { getServerSupabase } = await import("./server");
    const client = await getServerSupabase();
    expect(client.auth).toBeDefined();
  });
});
