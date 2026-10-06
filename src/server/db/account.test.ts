import { afterEach, describe, expect, it } from "vitest";
import { TRIAL_DAYS } from "@/lib/plan";
import { getAdminSupabase } from "@/services/supabase/admin";
import { createReadyUser, createTestUser, deleteTestUsers } from "@/test/db";
import {
  agreeTerms,
  ensureProfile,
  getReadiness,
  lowerLevel,
  setFirstLevel,
  startTrial,
  switchLanguage,
} from "./account";

const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(deleteTestUsers);

async function profileOf(userId: string) {
  const { data, error } = await getAdminSupabase().from("profiles").select("*").eq("id", userId);
  if (error) throw error;
  return data;
}

async function levelOf(userId: string, language: string) {
  const { data, error } = await getAdminSupabase()
    .from("user_levels")
    .select("level")
    .eq("user_id", userId)
    .eq("language", language)
    .maybeSingle();
  if (error) throw error;
  return data?.level ?? null;
}

describe("ensureProfile", () => {
  it("두 번 불러도 행은 1개이고 created_at을 유지한다", async () => {
    const user = await createTestUser();
    await ensureProfile(user.id);
    const [first] = await profileOf(user.id);
    await ensureProfile(user.id);
    const rows = await profileOf(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].created_at).toBe(first.created_at);
  });
});

describe("agreeTerms", () => {
  it("profiles 행이 없어도 만들고 동의 시각을 저장한다", async () => {
    const user = await createTestUser();
    await agreeTerms(user.id);
    const rows = await profileOf(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].agreed_at).not.toBeNull();
  });

  it("두 번째 호출은 최초 동의 시각을 바꾸지 않는다", async () => {
    const user = await createTestUser();
    await ensureProfile(user.id);
    await agreeTerms(user.id);
    const [first] = await profileOf(user.id);
    await agreeTerms(user.id);
    const [second] = await profileOf(user.id);
    expect(second.agreed_at).toBe(first.agreed_at);
  });
});

describe("setFirstLevel", () => {
  it("동의하지 않았으면 CONSENT_REQUIRED이고 레벨을 만들지 않는다", async () => {
    const user = await createTestUser();
    await ensureProfile(user.id);
    await expect(setFirstLevel(user.id, "en", 2)).resolves.toEqual({ ok: false, code: "CONSENT_REQUIRED" });
    expect(await levelOf(user.id, "en")).toBeNull();
  });

  it("레벨, 현재 언어, 온보딩 완료 시각을 함께 저장한다", async () => {
    const user = await createTestUser();
    await agreeTerms(user.id);
    await expect(setFirstLevel(user.id, "en", 2)).resolves.toEqual({ ok: true, value: null });
    const [profile] = await profileOf(user.id);
    expect(await levelOf(user.id, "en")).toBe(2);
    expect(profile.current_language).toBe("en");
    expect(profile.onboarded_at).not.toBeNull();
  });

  it("같은 언어의 두 번째 호출은 CONFLICT이고 레벨을 바꾸지 않는다", async () => {
    const user = await createReadyUser("en", 2);
    await expect(setFirstLevel(user.id, "en", 5)).resolves.toEqual({ ok: false, code: "CONFLICT" });
    expect(await levelOf(user.id, "en")).toBe(2);
  });

  it("다른 언어 추가는 허용하고 최초 온보딩 시각을 유지한다", async () => {
    const user = await createReadyUser("en", 2);
    const [before] = await profileOf(user.id);
    await expect(setFirstLevel(user.id, "ja", 1)).resolves.toEqual({ ok: true, value: null });
    const [after] = await profileOf(user.id);
    expect(await levelOf(user.id, "ja")).toBe(1);
    expect(after.current_language).toBe("ja");
    expect(after.onboarded_at).toBe(before.onboarded_at);
  });
});

describe("switchLanguage", () => {
  it("레벨이 없는 언어로는 ONBOARDING_REQUIRED다", async () => {
    const user = await createReadyUser("en", 2);
    await expect(switchLanguage(user.id, "ja")).resolves.toEqual({ ok: false, code: "ONBOARDING_REQUIRED" });
    const [profile] = await profileOf(user.id);
    expect(profile.current_language).toBe("en");
  });

  it("레벨이 있는 언어로 전환한다", async () => {
    const user = await createReadyUser("en", 2);
    await setFirstLevel(user.id, "ja", 1);
    await expect(switchLanguage(user.id, "en")).resolves.toEqual({ ok: true, value: null });
    const [profile] = await profileOf(user.id);
    expect(profile.current_language).toBe("en");
  });
});

describe("lowerLevel", () => {
  it("낮은 레벨로 내리고 새 레벨을 돌려준다", async () => {
    const user = await createReadyUser("en", 3);
    await expect(lowerLevel(user.id, "en", 1)).resolves.toEqual({ ok: true, value: { level: 1 } });
    expect(await levelOf(user.id, "en")).toBe(1);
  });

  it("같거나 높은 레벨은 CONFLICT이고 레벨을 바꾸지 않는다", async () => {
    const user = await createReadyUser("en", 3);
    await expect(lowerLevel(user.id, "en", 3)).resolves.toEqual({ ok: false, code: "CONFLICT" });
    await expect(lowerLevel(user.id, "en", 4)).resolves.toEqual({ ok: false, code: "CONFLICT" });
    expect(await levelOf(user.id, "en")).toBe(3);
  });

  it("레벨이 없는 언어는 ONBOARDING_REQUIRED다", async () => {
    const user = await createReadyUser("en", 3);
    await expect(lowerLevel(user.id, "ja", 1)).resolves.toEqual({ ok: false, code: "ONBOARDING_REQUIRED" });
  });
});

describe("startTrial", () => {
  it("체험을 시작하고 TRIAL_DAYS일 뒤의 pro_until을 돌려준다", async () => {
    const user = await createReadyUser();
    const result = await startTrial(user.id);
    if (!result.ok) throw new Error(result.code);
    expect(Math.abs(result.value.proUntil.getTime() - (Date.now() + TRIAL_DAYS * DAY_MS))).toBeLessThan(60_000);

    const [profile] = await profileOf(user.id);
    const startedAt = new Date(profile.trial_started_at!).getTime();
    expect(new Date(profile.pro_until!).getTime() - startedAt).toBe(TRIAL_DAYS * DAY_MS);
    expect(new Date(profile.pro_until!).getTime()).toBe(result.value.proUntil.getTime());
  });

  it("두 번째 호출은 CONFLICT이고 체험 기간을 바꾸지 않는다", async () => {
    const user = await createReadyUser();
    await startTrial(user.id);
    const [before] = await profileOf(user.id);
    await expect(startTrial(user.id)).resolves.toEqual({ ok: false, code: "CONFLICT" });
    const [after] = await profileOf(user.id);
    expect(after.pro_until).toBe(before.pro_until);
  });

  it("동시에 두 번 불러도 정확히 하나만 성공한다", async () => {
    const user = await createReadyUser();
    const results = await Promise.all([startTrial(user.id), startTrial(user.id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, code: "CONFLICT" }]);
  });

  it("profiles 행이 없으면 CONSENT_REQUIRED다", async () => {
    const user = await createTestUser();
    await expect(startTrial(user.id)).resolves.toEqual({ ok: false, code: "CONSENT_REQUIRED" });
  });

  it("현재 언어의 레벨이 없으면 ONBOARDING_REQUIRED다", async () => {
    const user = await createTestUser();
    await agreeTerms(user.id);
    await expect(startTrial(user.id)).resolves.toEqual({ ok: false, code: "ONBOARDING_REQUIRED" });
  });
});

describe("getReadiness", () => {
  it("profiles 행이 없으면 빈 상태다", async () => {
    const user = await createTestUser();
    await expect(getReadiness(user.id)).resolves.toEqual({ agreedAt: null, currentLanguage: null, levels: {} });
  });

  it("동의만 했으면 동의 시각만 있다", async () => {
    const user = await createTestUser();
    await agreeTerms(user.id);
    const state = await getReadiness(user.id);
    expect(state.agreedAt).toBeInstanceOf(Date);
    expect(state.currentLanguage).toBeNull();
    expect(state.levels).toEqual({});
  });

  it("동의와 레벨이 있으면 현재 언어와 언어별 레벨이 있다", async () => {
    const user = await createReadyUser("en", 2);
    await setFirstLevel(user.id, "ja", 1);
    const state = await getReadiness(user.id);
    const [profile] = await profileOf(user.id);
    expect(state).toEqual({
      agreedAt: new Date(profile.agreed_at!),
      currentLanguage: "ja",
      levels: { en: 2, ja: 1 },
    });
  });

  it("다른 사용자의 상태를 섞지 않는다", async () => {
    await createReadyUser("ja", 4);
    const user = await createTestUser();
    await agreeTerms(user.id);
    expect((await getReadiness(user.id)).levels).toEqual({});
  });
});
