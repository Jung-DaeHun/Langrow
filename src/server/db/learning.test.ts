import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { LEVEL_TEST_SIZE, PASS_SCORE } from "@/lib/levelTest";
import type { Language } from "@/lib/levels";
import { PLAN_LIMITS } from "@/lib/plan";
import { addDays, kstDate, kstDayStart } from "@/lib/usage";
import { BATCH_MAX } from "@/lib/wordBatch";
import { getAdminSupabase } from "@/services/supabase/admin";
import { createReadyUser, createTestUser, deleteTestUsers } from "@/test/db";
import type { Database } from "@/types/database";
import { ensureProfile, setFirstLevel, startTrial } from "./account";
import { getWordsByIds, recordEvent, saveReview, saveWordBatch, submitLevelTest } from "./learning";
import type { DbResult } from "./types";

type WordInsert = Database["public"]["Tables"]["words"]["Insert"];
type WordStatus = "known" | "review";

// 테스트 단어는 seed와 겹치지 않게 rank 9100+를 쓴다 (security.test.ts는 9001~9002)
function testWord(language: Language, level: number, rank: number): WordInsert {
  return {
    id: `${language}-${level}-${rank}`,
    language,
    level,
    rank,
    word: `word${rank}`,
    reading: null,
    meaning_ko: "뜻",
    example: `This is {{word${rank}}}.`,
    example_ko: "예문이에요.",
    distractors: ["alpha", "beta", "gamma"],
  };
}

const FREE_LIMIT = PLAN_LIMITS.free.newWords;
const PRO_LIMIT = PLAN_LIMITS.pro.newWords;

const EN_WORDS = Array.from({ length: PRO_LIMIT + BATCH_MAX }, (_, i) => testWord("en", 1, 9101 + i));
const JA_WORDS = Array.from({ length: BATCH_MAX }, (_, i) => testWord("ja", 1, 9101 + i));
const EN_LEVEL_2 = testWord("en", 2, 9101);
const ALL_WORDS = [...EN_WORDS, ...JA_WORDS, EN_LEVEL_2];
const EN = EN_WORDS.map((word) => word.id);
const JA = JA_WORDS.map((word) => word.id);
const MISSING_ID = "en-1-9999";

const INVALID = { ok: false, code: "INVALID_INPUT" };
const CONFLICT = { ok: false, code: "CONFLICT" };
const LIMIT_REACHED = { ok: false, code: "LIMIT_REACHED" };
const FREE_EVENT = { feature: "words", plan: "free", trial_eligible: true };
const PRO_EVENT = { feature: "words", plan: "pro", trial_eligible: false };

beforeAll(async () => {
  must(await getAdminSupabase().from("words").upsert(ALL_WORDS));
});

afterEach(deleteTestUsers);

afterAll(async () => {
  must(
    await getAdminSupabase()
      .from("words")
      .delete()
      .in(
        "id",
        ALL_WORDS.map((word) => word.id),
      ),
  );
});

function must<T>(result: { data: T; error: unknown }): NonNullable<T> {
  if (result.error) throw result.error;
  return result.data as NonNullable<T>;
}

function valueOf<T>(result: DbResult<T>): T {
  if (!result.ok) throw new Error(`예상하지 못한 거부: ${result.code}`);
  return result.value;
}

const today = () => kstDate(new Date());
// 어제(한국 날짜)의 마지막 1분 안
const yesterdayAt = () => new Date(kstDayStart(today()).getTime() - 60_000).toISOString();

function batchOf(ids: string[], status: WordStatus = "known") {
  return ids.map((wordId) => ({ wordId, status }));
}

function reviewOf(ids: string[], knew: boolean) {
  return ids.map((wordId) => ({ wordId, knew }));
}

// admin으로 학습 기록을 넣는다 (오늘 사용량·복습 대상 준비)
async function insertUserWords(
  userId: string,
  ids: string[],
  { status = "review", at }: { status?: WordStatus; at?: string } = {},
): Promise<void> {
  const rows = ids.map((word_id) => ({
    user_id: userId,
    word_id,
    status,
    ...(at ? { first_seen_at: at, updated_at: at } : {}),
  }));
  must(await getAdminSupabase().from("user_words").insert(rows));
}

async function userWordsOf(userId: string) {
  return must(
    await getAdminSupabase()
      .from("user_words")
      .select("word_id, status, first_seen_at, updated_at")
      .eq("user_id", userId)
      .order("word_id"),
  );
}

async function statusesOf(userId: string): Promise<Record<string, string>> {
  return Object.fromEntries((await userWordsOf(userId)).map((row) => [row.word_id, row.status]));
}

async function todayNewWordCount(userId: string): Promise<number> {
  const { count, error } = await getAdminSupabase()
    .from("user_words")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("first_seen_at", kstDayStart(today()).toISOString());
  if (error) throw error;
  return count ?? -1;
}

async function eventsOf(
  userId: string,
  name: "limit_reached" | "level_test_submitted" | "pro_clicked" | "kana_studied",
) {
  const rows = must(
    await getAdminSupabase().from("events").select("props").eq("user_id", userId).eq("name", name).order("id"),
  );
  return rows.map((row) => row.props);
}

async function activityOf(userId: string) {
  const admin = getAdminSupabase();
  const days = must(await admin.from("user_activity_days").select("activity_date").eq("user_id", userId));
  const profile = must(await admin.from("profiles").select("last_study_date, streak").eq("id", userId).single());
  return { days: days.map((row) => row.activity_date), ...profile };
}

const NO_ACTIVITY = { days: [], last_study_date: null, streak: 0 };
const todayActivity = (streak = 1) => ({ days: [today()], last_study_date: today(), streak });

// 다음 날이 된 것처럼 오늘 활동일 행을 지우고 마지막 학습일을 어제로 돌린다
async function moveActivityToYesterday(userId: string, streak: number): Promise<void> {
  const admin = getAdminSupabase();
  must(await admin.from("user_activity_days").delete().eq("user_id", userId));
  must(await admin.from("profiles").update({ last_study_date: addDays(today(), -1), streak }).eq("id", userId));
}

async function levelOf(userId: string, language: Language): Promise<number> {
  const row = must(
    await getAdminSupabase()
      .from("user_levels")
      .select("level")
      .eq("user_id", userId)
      .eq("language", language)
      .single(),
  );
  return row.level;
}

function expectNow(timestamp: string) {
  expect(Math.abs(new Date(timestamp).getTime() - Date.now())).toBeLessThan(10_000);
}

describe("saveWordBatch", () => {
  it("신규 단어를 status대로 저장하고 활동일·연속일을 갱신한다 (단어 레벨은 검사하지 않는다)", async () => {
    const user = await createReadyUser("en", 1);
    const items = [
      { wordId: EN[0], status: "known" as const },
      { wordId: EN[1], status: "review" as const },
      { wordId: EN_LEVEL_2.id, status: "known" as const },
    ];

    await expect(saveWordBatch(user.id, "en", items)).resolves.toEqual({ ok: true, value: { insertedCount: 3 } });
    const rows = await userWordsOf(user.id);
    expect(rows.map((row) => [row.word_id, row.status])).toEqual([
      [EN[0], "known"],
      [EN[1], "review"],
      [EN_LEVEL_2.id, "known"],
    ]);
    for (const row of rows) {
      expectNow(row.first_seen_at);
      expect(row.updated_at).toBe(row.first_seen_at);
    }
    expect(await activityOf(user.id)).toEqual(todayActivity());
    expect(await eventsOf(user.id, "limit_reached")).toEqual([]);
  });

  it("오늘 한도를 다 쓴 뒤 기존 단어 10개를 다시 보내도 성공하고 상태·이벤트를 바꾸지 않는다", async () => {
    const user = await createReadyUser();
    const ids = EN.slice(0, FREE_LIMIT);
    valueOf(await saveWordBatch(user.id, "en", batchOf(ids, "review")));
    const rowsBefore = await userWordsOf(user.id);
    const eventsBefore = await eventsOf(user.id, "limit_reached");
    expect(eventsBefore).toEqual([FREE_EVENT]);

    await expect(saveWordBatch(user.id, "en", batchOf(ids, "known"))).resolves.toEqual({
      ok: true,
      value: { insertedCount: 0 },
    });
    expect(await userWordsOf(user.id)).toEqual(rowsBefore);
    expect(await eventsOf(user.id, "limit_reached")).toEqual(eventsBefore);
  });

  it("전부 기존 단어면 다음 날에도 활동일·연속일이 바뀌지 않는다", async () => {
    const user = await createReadyUser();
    const ids = EN.slice(0, 3);
    valueOf(await saveWordBatch(user.id, "en", batchOf(ids)));
    await moveActivityToYesterday(user.id, 3);

    await expect(saveWordBatch(user.id, "en", batchOf(ids))).resolves.toEqual({
      ok: true,
      value: { insertedCount: 0 },
    });
    expect(await activityOf(user.id)).toEqual({ days: [], last_study_date: addDays(today(), -1), streak: 3 });
  });

  it("기존 + 신규 혼합은 신규분만 한도를 검사하고 기존 단어의 상태·날짜는 그대로다", async () => {
    const user = await createReadyUser();
    const existing = EN.slice(0, FREE_LIMIT - 3);
    await insertUserWords(user.id, existing, { status: "review" });
    const existingBefore = await userWordsOf(user.id);

    const fresh = EN.slice(FREE_LIMIT - 3, FREE_LIMIT - 1);
    await expect(saveWordBatch(user.id, "en", batchOf([...existing, ...fresh], "known"))).resolves.toEqual({
      ok: true,
      value: { insertedCount: fresh.length },
    });
    const rows = await userWordsOf(user.id);
    expect(rows.filter((row) => existing.includes(row.word_id))).toEqual(existingBefore);
    expect(rows.filter((row) => fresh.includes(row.word_id)).map((row) => row.status)).toEqual(["known", "known"]);
    expect(await todayNewWordCount(user.id)).toBe(FREE_LIMIT - 1);
    expect(await eventsOf(user.id, "limit_reached")).toEqual([]);
  });

  it("신규분이 남은 한도를 넘으면 하나도 저장하지 않고 LIMIT_REACHED이며 limit_reached를 남긴다", async () => {
    const user = await createReadyUser();
    await insertUserWords(user.id, EN.slice(0, FREE_LIMIT - 2));
    const before = await userWordsOf(user.id);

    await expect(saveWordBatch(user.id, "en", batchOf(EN.slice(FREE_LIMIT - 2, FREE_LIMIT + 1)))).resolves.toEqual(
      LIMIT_REACHED,
    );
    expect(await userWordsOf(user.id)).toEqual(before);
    expect(await eventsOf(user.id, "limit_reached")).toEqual([FREE_EVENT]);
    expect(await activityOf(user.id)).toEqual(NO_ACTIVITY);
  });

  it("한도를 정확히 채우는 저장은 성공하고 limit_reached를 남긴다", async () => {
    const user = await createReadyUser();
    await insertUserWords(user.id, EN.slice(0, FREE_LIMIT - 3));

    await expect(saveWordBatch(user.id, "en", batchOf(EN.slice(FREE_LIMIT - 3, FREE_LIMIT)))).resolves.toEqual({
      ok: true,
      value: { insertedCount: 3 },
    });
    expect(await todayNewWordCount(user.id)).toBe(FREE_LIMIT);
    expect(await eventsOf(user.id, "limit_reached")).toEqual([FREE_EVENT]);
  });

  it("Pro(pro_until 미래)는 Pro 한도를 쓴다", async () => {
    const user = await createReadyUser();
    valueOf(await startTrial(user.id));
    await insertUserWords(user.id, EN.slice(0, PRO_LIMIT - 1));

    await expect(saveWordBatch(user.id, "en", batchOf(EN.slice(PRO_LIMIT - 1, PRO_LIMIT + 1)))).resolves.toEqual(
      LIMIT_REACHED,
    );
    expect(await eventsOf(user.id, "limit_reached")).toEqual([PRO_EVENT]);

    await expect(saveWordBatch(user.id, "en", batchOf([EN[PRO_LIMIT - 1]]))).resolves.toEqual({
      ok: true,
      value: { insertedCount: 1 },
    });
    expect(await todayNewWordCount(user.id)).toBe(PRO_LIMIT);
    expect(await eventsOf(user.id, "limit_reached")).toEqual([PRO_EVENT, PRO_EVENT]);
  });

  it("어제(한국 날짜) first_seen_at은 오늘 사용량에 세지 않는다", async () => {
    const user = await createReadyUser();
    await insertUserWords(user.id, EN.slice(0, FREE_LIMIT), { at: yesterdayAt() });

    await expect(saveWordBatch(user.id, "en", batchOf(EN.slice(FREE_LIMIT, FREE_LIMIT * 2)))).resolves.toEqual({
      ok: true,
      value: { insertedCount: FREE_LIMIT },
    });
  });

  it("다른 언어 단어, 없는 단어, 중복 word_id, 11개, 빈 배열, 잘못된 status는 INVALID_INPUT이고 아무것도 저장하지 않는다", async () => {
    const user = await createReadyUser("en", 1);
    valueOf(await setFirstLevel(user.id, "ja", 1)); // ja 단어도 그 언어로는 저장할 수 있는 사용자

    const cases = [
      batchOf([EN[0], JA[0]]),
      batchOf([EN[0], MISSING_ID]),
      batchOf([EN[0], EN[0]]),
      batchOf(EN.slice(0, BATCH_MAX + 1)),
      [],
      [{ wordId: EN[0], status: "unknown" as WordStatus }],
    ];
    for (const items of cases) {
      await expect(saveWordBatch(user.id, "en", items), JSON.stringify(items)).resolves.toEqual(INVALID);
    }
    expect(await userWordsOf(user.id)).toEqual([]);
    expect(await activityOf(user.id)).toEqual(NO_ACTIVITY);
  });
});

describe("준비 상태", () => {
  it("미동의는 CONSENT_REQUIRED, 레벨이 없는 언어는 ONBOARDING_REQUIRED이고 아무것도 바꾸지 않는다", async () => {
    const fresh = await createTestUser();
    await ensureProfile(fresh.id);
    const consent = { ok: false, code: "CONSENT_REQUIRED" };
    await expect(saveWordBatch(fresh.id, "en", batchOf([EN[0]]))).resolves.toEqual(consent);
    await expect(saveReview(fresh.id, "en", reviewOf([EN[0]], true))).resolves.toEqual(consent);
    await expect(
      submitLevelTest(fresh.id, { language: "en", fromLevel: 1, score: PASS_SCORE, passed: true }),
    ).resolves.toEqual(consent);
    await expect(recordEvent(fresh.id, "kana_studied")).resolves.toEqual(consent);
    expect(await eventsOf(fresh.id, "kana_studied")).toEqual([]);

    const user = await createReadyUser("en", 1);
    await insertUserWords(user.id, [JA[0]]);
    const onboarding = { ok: false, code: "ONBOARDING_REQUIRED" };
    await expect(saveWordBatch(user.id, "ja", batchOf([JA[1]]))).resolves.toEqual(onboarding);
    await expect(saveReview(user.id, "ja", reviewOf([JA[0]], true))).resolves.toEqual(onboarding);
    await expect(
      submitLevelTest(user.id, { language: "ja", fromLevel: 1, score: PASS_SCORE, passed: true }),
    ).resolves.toEqual(onboarding);
    expect(await statusesOf(user.id)).toEqual({ [JA[0]]: "review" });
    expect(await eventsOf(user.id, "level_test_submitted")).toEqual([]);
    expect(await activityOf(user.id)).toEqual(NO_ACTIVITY);
  });
});

describe("동시성", () => {
  it("남은 한도 10에서 서로 다른 신규 6개 묶음 2개를 동시에 저장하면 합계가 한도를 넘지 않는다", async () => {
    const user = await createReadyUser();
    const results = await Promise.all([
      saveWordBatch(user.id, "en", batchOf(EN.slice(0, 6))),
      saveWordBatch(user.id, "en", batchOf(EN.slice(6, 12))),
    ]);
    expect(results.filter((result) => result.ok)).toEqual([{ ok: true, value: { insertedCount: 6 } }]);
    expect(results.filter((result) => !result.ok)).toEqual([LIMIT_REACHED]);
    expect(await todayNewWordCount(user.id)).toBe(6);
  });

  it("영어·일본어 회차를 동시에 저장해도 계정 합산 한도를 넘지 않는다", async () => {
    const user = await createReadyUser("en", 1);
    valueOf(await setFirstLevel(user.id, "ja", 1));
    const results = await Promise.all([
      saveWordBatch(user.id, "en", batchOf(EN.slice(0, 6))),
      saveWordBatch(user.id, "ja", batchOf(JA.slice(0, 6))),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([LIMIT_REACHED]);
    expect(await todayNewWordCount(user.id)).toBe(6);
  });

  it("같은 회차를 동시에 재전송하면 한 번만 삽입한다", async () => {
    const user = await createReadyUser();
    const items = batchOf(EN.slice(0, 5));
    const results = await Promise.all([saveWordBatch(user.id, "en", items), saveWordBatch(user.id, "en", items)]);
    const counts = results.map((result) => valueOf(result).insertedCount).sort();
    expect(counts).toEqual([0, 5]);
    expect(await userWordsOf(user.id)).toHaveLength(5);
  });

  it("같은 날 단어 저장과 복습을 동시에 해도 활동일 행은 1개이고 연속일은 한 번만 오른다", async () => {
    const user = await createReadyUser();
    await insertUserWords(user.id, EN.slice(0, 3), { at: yesterdayAt() });
    await moveActivityToYesterday(user.id, 2);

    const [batch, review] = await Promise.all([
      saveWordBatch(user.id, "en", batchOf(EN.slice(5, 8))),
      saveReview(user.id, "en", reviewOf(EN.slice(0, 3), true)),
    ]);
    expect(batch).toEqual({ ok: true, value: { insertedCount: 3 } });
    expect(review).toEqual({ ok: true, value: { reviewedCount: 3 } });
    expect(await activityOf(user.id)).toEqual(todayActivity(3));
  });
});

describe("saveReview", () => {
  it("knew는 known으로 바꾸고 나머지는 review로 두며, 복습만 한 날도 활동일을 남긴다", async () => {
    const user = await createReadyUser();
    await insertUserWords(user.id, EN.slice(0, 3), { status: "review", at: yesterdayAt() });
    await insertUserWords(user.id, [EN[3]], { status: "known", at: yesterdayAt() });
    const before = await userWordsOf(user.id);

    const items = [
      { wordId: EN[0], knew: true },
      { wordId: EN[1], knew: false },
      { wordId: EN[2], knew: true },
      { wordId: EN[3], knew: false }, // 이미 known이라 유효하지 않다
    ];
    await expect(saveReview(user.id, "en", items)).resolves.toEqual({ ok: true, value: { reviewedCount: 3 } });

    const after = await userWordsOf(user.id);
    expect(after.map((row) => [row.word_id, row.status])).toEqual([
      [EN[0], "known"],
      [EN[1], "review"],
      [EN[2], "known"],
      [EN[3], "known"],
    ]);
    expectNow(after[0].updated_at);
    expectNow(after[2].updated_at);
    expect(after[1]).toEqual(before[1]);
    expect(after[3]).toEqual(before[3]);
    expect(after.map((row) => row.first_seen_at)).toEqual(before.map((row) => row.first_seen_at));
    expect(await todayNewWordCount(user.id)).toBe(0);
    expect(await activityOf(user.id)).toEqual(todayActivity());
  });

  it("전부 이미 known이면 변경 없이 성공하고 활동일을 남기지 않는다", async () => {
    const user = await createReadyUser();
    await insertUserWords(user.id, EN.slice(0, 2), { status: "known", at: yesterdayAt() });
    const before = await userWordsOf(user.id);

    await expect(saveReview(user.id, "en", reviewOf(EN.slice(0, 2), true))).resolves.toEqual({
      ok: true,
      value: { reviewedCount: 0 },
    });
    expect(await userWordsOf(user.id)).toEqual(before);
    expect(await activityOf(user.id)).toEqual(NO_ACTIVITY);
  });

  it("남의 단어, 다른 언어 단어, 학습 기록이 없는 단어, 중복, 빈 배열, 11개는 INVALID_INPUT이고 아무것도 바꾸지 않는다", async () => {
    const me = await createReadyUser("en", 1);
    valueOf(await setFirstLevel(me.id, "ja", 1));
    const other = await createReadyUser("en", 1);
    await insertUserWords(me.id, [...EN.slice(0, BATCH_MAX + 1), JA[0]]);
    await insertUserWords(other.id, [EN[BATCH_MAX + 1]]);
    const before = { me: await userWordsOf(me.id), other: await userWordsOf(other.id) };

    const cases = [
      reviewOf([EN[0], EN[BATCH_MAX + 1]], true),
      reviewOf([EN[0], JA[0]], true),
      reviewOf([EN[0], EN[BATCH_MAX + 2]], true),
      reviewOf([EN[0], EN[0]], true),
      [],
      reviewOf(EN.slice(0, BATCH_MAX + 1), true),
    ];
    for (const items of cases) {
      await expect(saveReview(me.id, "en", items), JSON.stringify(items)).resolves.toEqual(INVALID);
    }
    expect({ me: await userWordsOf(me.id), other: await userWordsOf(other.id) }).toEqual(before);
    expect(await activityOf(me.id)).toEqual(NO_ACTIVITY);
  });
});

describe("submitLevelTest", () => {
  const pass = { language: "en", fromLevel: 1, score: PASS_SCORE, passed: true } as const;

  it("합격하면 레벨이 1 오르고 이벤트·활동일을 남기며, 같은 시험을 다시 제출하면 CONFLICT이고 레벨은 그대로다", async () => {
    const user = await createReadyUser("en", 1);

    await expect(submitLevelTest(user.id, pass)).resolves.toEqual({ ok: true, value: { passed: true, level: 2 } });
    expect(await levelOf(user.id, "en")).toBe(2);
    expect(await eventsOf(user.id, "level_test_submitted")).toEqual([
      { language: "en", from_level: 1, score: PASS_SCORE, passed: true },
    ]);
    expect(await activityOf(user.id)).toEqual(todayActivity());
    expect(await userWordsOf(user.id)).toEqual([]);

    await expect(submitLevelTest(user.id, pass)).resolves.toEqual(CONFLICT);
    expect(await levelOf(user.id, "en")).toBe(2);
    expect(await eventsOf(user.id, "level_test_submitted")).toHaveLength(1);
  });

  it("합격 제출을 동시에 두 번 하면 한 번만 오른다", async () => {
    const user = await createReadyUser("en", 1);
    const results = await Promise.all([submitLevelTest(user.id, pass), submitLevelTest(user.id, pass)]);
    expect(results.filter((result) => result.ok)).toEqual([{ ok: true, value: { passed: true, level: 2 } }]);
    expect(results.filter((result) => !result.ok)).toEqual([CONFLICT]);
    expect(await levelOf(user.id, "en")).toBe(2);
    expect(await eventsOf(user.id, "level_test_submitted")).toHaveLength(1);
  });

  it("불합격이면 레벨은 그대로이고, 테스트만 한 날도 이벤트·활동일을 남긴다", async () => {
    const user = await createReadyUser("en", 1);
    const fail = { ...pass, score: PASS_SCORE - 1, passed: false };

    await expect(submitLevelTest(user.id, fail)).resolves.toEqual({ ok: true, value: { passed: false, level: 1 } });
    expect(await levelOf(user.id, "en")).toBe(1);
    expect(await eventsOf(user.id, "level_test_submitted")).toEqual([
      { language: "en", from_level: 1, score: PASS_SCORE - 1, passed: false },
    ]);
    expect(await activityOf(user.id)).toEqual(todayActivity());
  });

  it("from_level이 실제 레벨과 다르면 CONFLICT이고 이벤트·활동일을 남기지 않는다", async () => {
    const user = await createReadyUser("en", 2);
    await expect(submitLevelTest(user.id, pass)).resolves.toEqual(CONFLICT);
    expect(await levelOf(user.id, "en")).toBe(2);
    expect(await eventsOf(user.id, "level_test_submitted")).toEqual([]);
    expect(await activityOf(user.id)).toEqual(NO_ACTIVITY);
  });

  it("from_level 5나 0~20 밖의 점수는 INVALID_INPUT이다", async () => {
    const top = await createReadyUser("en", 5);
    await expect(submitLevelTest(top.id, { ...pass, fromLevel: 5 })).resolves.toEqual(INVALID);
    expect(await levelOf(top.id, "en")).toBe(5);

    const user = await createReadyUser("en", 1);
    await expect(submitLevelTest(user.id, { ...pass, score: LEVEL_TEST_SIZE + 1 })).resolves.toEqual(INVALID);
    await expect(submitLevelTest(user.id, { ...pass, score: -1, passed: false })).resolves.toEqual(INVALID);
    expect(await levelOf(user.id, "en")).toBe(1);
    for (const id of [top.id, user.id]) {
      expect(await eventsOf(id, "level_test_submitted")).toEqual([]);
      expect(await activityOf(id)).toEqual(NO_ACTIVITY);
    }
  });
});

describe("recordEvent", () => {
  it("pro_clicked는 이벤트만 남긴다", async () => {
    const user = await createReadyUser();
    await expect(recordEvent(user.id, "pro_clicked")).resolves.toEqual({ ok: true, value: null });
    expect(await eventsOf(user.id, "pro_clicked")).toEqual([{}]);
    expect(await activityOf(user.id)).toEqual(NO_ACTIVITY);
  });

  it("kana_studied는 이벤트와 활동일을 남긴다", async () => {
    const user = await createReadyUser();
    await expect(recordEvent(user.id, "kana_studied")).resolves.toEqual({ ok: true, value: null });
    expect(await eventsOf(user.id, "kana_studied")).toEqual([{}]);
    expect(await activityOf(user.id)).toEqual(todayActivity());
  });

  it("다른 이름은 INVALID_INPUT이고 기록하지 않는다", async () => {
    const user = await createReadyUser();
    await expect(recordEvent(user.id, "limit_reached" as "pro_clicked")).resolves.toEqual(INVALID);
    expect(await eventsOf(user.id, "limit_reached")).toEqual([]);
  });
});

describe("getWordsByIds", () => {
  it("넣은 단어를 돌려주고 없는 id는 빠진다", async () => {
    const words = await getWordsByIds([EN[0], MISSING_ID, EN_LEVEL_2.id, JA[0]]);
    const expected = [EN_WORDS[0], EN_LEVEL_2, JA_WORDS[0]].map(({ id, language, level, example }) => ({
      id,
      language,
      level,
      example,
    }));
    expect([...words].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      expected.sort((a, b) => a.id.localeCompare(b.id)),
    );
  });
});
