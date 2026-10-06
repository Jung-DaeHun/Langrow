import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountState } from "@/server/db/reads";
import { loadAccount, loadTodayUsage, requireReady, requireUser } from "./page";

const mocks = vi.hoisted(() => {
  // next/navigation의 redirect처럼 throw해서 이후 코드가 돌지 않게 한다
  class Redirect extends Error {
    constructor(readonly path: string) {
      super(`redirect ${path}`);
    }
  }
  return { Redirect, getUser: vi.fn(), readAccount: vi.fn(), readTodayUsage: vi.fn() };
});

const supabase = { auth: { getUser: mocks.getUser } };

vi.mock("@/services/supabase/server", () => ({ getServerSupabase: async () => supabase }));
vi.mock("@/server/db/reads", () => ({ readAccount: mocks.readAccount, readTodayUsage: mocks.readTodayUsage }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new mocks.Redirect(path);
  },
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-06T12:34:56Z");

const READY: AccountState = {
  agreedAt: new Date("2026-10-01T00:00:00Z"),
  currentLanguage: "ja",
  levels: { en: 3, ja: 1 },
  streak: { lastStudyDate: "2026-10-05", streak: 2 },
  proUntil: null,
  trialStartedAt: null,
};

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof mocks.Redirect) return error.path;
    throw error;
  }
  throw new Error("이동하지 않았습니다");
}

function signedIn(email: string | undefined) {
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID, email } }, error: null });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.getUser.mockReset();
  mocks.readAccount.mockReset().mockResolvedValue(READY);
  mocks.readTodayUsage.mockReset();
  signedIn("minji@example.com");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("requireUser", () => {
  it("로그인 사용자의 id·email과 쿠키 client를 돌려준다", async () => {
    await expect(requireUser()).resolves.toEqual({ userId: USER_ID, email: "minji@example.com", supabase });
  });

  it("email이 없으면 null이다", async () => {
    signedIn(undefined);
    await expect(requireUser()).resolves.toMatchObject({ email: null });
  });

  it("비로그인이면 /로 보낸다", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await redirectOf(requireUser())).toBe("/");
  });

  it("getUser가 에러면 /로 보낸다", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthApiError", message: "invalid JWT" } });
    expect(await redirectOf(requireUser())).toBe("/");
  });
});

describe("loadAccount", () => {
  it("미동의여도 이동하지 않고 계정 상태를 돌려준다", async () => {
    const account = { ...READY, agreedAt: null, currentLanguage: null, levels: {} };
    mocks.readAccount.mockResolvedValue(account);

    await expect(loadAccount()).resolves.toEqual({ userId: USER_ID, email: "minji@example.com", supabase, account });
    expect(mocks.readAccount).toHaveBeenCalledWith(supabase, USER_ID);
  });

  it("비로그인이면 /로 보낸다", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await redirectOf(loadAccount())).toBe("/");
    expect(mocks.readAccount).not.toHaveBeenCalled();
  });
});

describe("requireReady", () => {
  it("준비된 사용자의 현재 언어·레벨과 요청 시각을 돌려준다", async () => {
    await expect(requireReady()).resolves.toEqual({
      userId: USER_ID,
      email: "minji@example.com",
      supabase,
      account: READY,
      language: "ja",
      level: 1,
      now: NOW,
    });
  });

  it("비로그인이면 /로 보낸다", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await redirectOf(requireReady())).toBe("/");
  });

  it("미동의면 /onboarding으로 보낸다", async () => {
    mocks.readAccount.mockResolvedValue({ ...READY, agreedAt: null });
    expect(await redirectOf(requireReady())).toBe("/onboarding");
  });

  it("현재 언어의 레벨이 없으면 /onboarding으로 보낸다", async () => {
    mocks.readAccount.mockResolvedValue({ ...READY, levels: { en: 3 } });
    expect(await redirectOf(requireReady())).toBe("/onboarding");
  });
});

describe("loadTodayUsage", () => {
  it("requireReady의 userId와 now로 오늘 사용량을 읽는다", async () => {
    mocks.readTodayUsage.mockResolvedValue({ chatTurns: 4, newWords: 7 });

    await expect(loadTodayUsage()).resolves.toEqual({ chatTurns: 4, newWords: 7 });
    expect(mocks.readTodayUsage).toHaveBeenCalledWith(supabase, USER_ID, NOW);
  });

  it("준비되지 않았으면 읽지 않고 /onboarding으로 보낸다", async () => {
    mocks.readAccount.mockResolvedValue({ ...READY, agreedAt: null });
    expect(await redirectOf(loadTodayUsage())).toBe("/onboarding");
    expect(mocks.readTodayUsage).not.toHaveBeenCalled();
  });
});
