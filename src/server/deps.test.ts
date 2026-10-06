import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as account from "./db/account";
import * as chat from "./db/chat";
import * as learning from "./db/learning";
import { getDeps, type Db } from "./deps";

beforeEach(() => {
  for (const key of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "ANTHROPIC_API_KEY",
    "CLAUDE_MODEL",
  ]) {
    vi.stubEnv(key, undefined);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getDeps", () => {
  it("env가 없어도 throw하지 않는다", () => {
    expect(() => getDeps()).not.toThrow();
  });

  it("env는 첫 DB 호출 때 검증된다", async () => {
    await expect(getDeps().db.getReadiness("user-1")).rejects.toThrow("SUPABASE_SECRET_KEY");
  });

  it("두 번 호출해도 같은 ai를 쓴다", () => {
    expect(getDeps().ai).toBe(getDeps().ai);
  });

  it("db에 account·chat·learning 모듈의 함수가 모두 있다", () => {
    const { db } = getDeps();
    for (const dbModule of [account, chat, learning]) {
      for (const [name, fn] of Object.entries(dbModule)) {
        expect(db[name as keyof Db], name).toBe(fn);
      }
    }
  });
});
