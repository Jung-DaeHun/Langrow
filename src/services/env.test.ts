import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAdminEnv, getClaudeEnv, getPublicEnv } from "./env";

const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "ANTHROPIC_API_KEY",
  "CLAUDE_MODEL",
] as const;

beforeEach(() => {
  for (const key of KEYS) vi.stubEnv(key, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function errorOf(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error("throw하지 않았다");
}

describe("env", () => {
  it("env가 없어도 import만으로는 throw하지 않는다", async () => {
    vi.resetModules();
    await expect(import("./env")).resolves.toHaveProperty("getPublicEnv");
  });

  describe("getPublicEnv", () => {
    it("공개 Supabase 값을 돌려준다", () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
      expect(getPublicEnv()).toEqual({
        supabaseUrl: "http://127.0.0.1:54321",
        supabasePublishableKey: "sb_publishable_x",
      });
    });

    it("빠진 키 이름을 에러에 담고 값은 담지 않는다", () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://secret-host.example");
      const error = errorOf(getPublicEnv);
      expect(error.message).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
      expect(error.message).not.toContain("NEXT_PUBLIC_SUPABASE_URL");
      expect(error.message).not.toContain("secret-host");
    });

    it("빈 문자열은 없는 값으로 본다", () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "  ");
      const error = errorOf(getPublicEnv);
      expect(error.message).toContain("NEXT_PUBLIC_SUPABASE_URL");
      expect(error.message).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    });
  });

  describe("getAdminEnv", () => {
    it("URL과 secret key를 돌려준다", () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
      vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
      expect(getAdminEnv()).toEqual({ supabaseUrl: "http://127.0.0.1:54321", supabaseSecretKey: "sb_secret_x" });
    });

    it("secret key가 비어 있으면 키 이름만 담긴 에러다", () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
      vi.stubEnv("SUPABASE_SECRET_KEY", "");
      const error = errorOf(getAdminEnv);
      expect(error.message).toContain("SUPABASE_SECRET_KEY");
      expect(error.message).not.toContain("127.0.0.1");
    });
  });

  describe("getClaudeEnv", () => {
    it("API 키와 모델을 돌려준다", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-x");
      vi.stubEnv("CLAUDE_MODEL", "claude-opus-5-5");
      expect(getClaudeEnv()).toEqual({ apiKey: "sk-ant-x", model: "claude-opus-5-5" });
    });

    it("CLAUDE_MODEL이 없거나 비면 기본 모델을 쓴다", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-x");
      expect(getClaudeEnv().model).toBe("claude-sonnet-5-5");
      vi.stubEnv("CLAUDE_MODEL", "");
      expect(getClaudeEnv().model).toBe("claude-sonnet-5-5");
    });

    it("API 키가 없으면 키 이름이 담긴 에러다", () => {
      expect(errorOf(getClaudeEnv).message).toContain("ANTHROPIC_API_KEY");
    });
  });
});
