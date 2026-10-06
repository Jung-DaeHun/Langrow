import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Language, Level } from "@/lib/levels";
import { addDays, kstDate, kstDayStart } from "@/lib/usage";
import type { Feedback, TurnReply } from "@/services/claude/schemas";
import { getAdminSupabase } from "@/services/supabase/admin";
import { createReadyUser, createTestUser, deleteTestUsers, signedInClient } from "@/test/db";
import type { Database } from "@/types/database";
import { setFirstLevel, startTrial } from "./account";
import { beginChatTurn, beginEnd, createChatSession, finishChatTurn, finishEnd } from "./chat";
import {
  readAccount,
  readBestSessionTurnsToday,
  readChatRoom,
  readEndedScenarioIds,
  readLevelWords,
  readOpenSessions,
  readReviewWords,
  readTodayUsage,
  readUnseenWords,
  type Word,
} from "./reads";
import type { DbResult } from "./types";

type WordRow = Database["public"]["Tables"]["words"]["Row"];

// 테스트 단어는 seed와 겹치지 않게 rank 9201+를 쓴다 (security.test.ts는 9001~, learning.test.ts는 9101~)
function testWord(language: Language, level: Level, rank: number): WordRow {
  return {
    id: `${language}-${level}-${rank}`,
    language,
    level,
    rank,
    word: `word${rank}`,
    reading: language === "ja" ? `よみ${rank}` : null,
    meaning_ko: `뜻${rank}`,
    example: `This is {{word${rank}}}.`,
    example_ko: `예문${rank}`,
    distractors: ["alpha", "beta", "gamma"],
  };
}

const EN1 = Array.from({ length: 6 }, (_, i) => testWord("en", 1, 9201 + i));
const EN2 = testWord("en", 2, 9201);
const JA1 = testWord("ja", 1, 9201);
const ALL_WORDS = [...EN1, EN2, JA1];
const TEST_IDS = new Set(ALL_WORDS.map((word) => word.id));

const PLAIN: TurnReply = { reply: "Anything else?", reply_ko: "더 필요한 거 있으세요?", correction: null };
const CORRECTED: TurnReply = {
  reply: "One latte, coming up!",
  reply_ko: "라테 한 잔 나갑니다!",
  correction: { corrected: "Can I get a latte?", explanation_ko: "주문할 때는 Can I get ...?이 자연스러워요." },
};
const FEEDBACK: Feedback = { good: "주문을 끝까지 마쳤어요.", improve: ["관사 a를 빠뜨리지 않게 해 보세요."] };

const EMPTY_ACCOUNT = {
  agreedAt: null,
  currentLanguage: null,
  levels: {},
  streak: { lastStudyDate: null, streak: 0 },
  proUntil: null,
  trialStartedAt: null,
};

// 물리 순서가 rank 순서와 반대가 되게 넣어서, 정렬하지 않는 구현이 테스트를 통과하지 못하게 한다
beforeAll(async () => {
  must(await getAdminSupabase().from("words").upsert([...ALL_WORDS].reverse()));
});

afterEach(deleteTestUsers);

afterAll(async () => {
  must(await getAdminSupabase().from("words").delete().in("id", [...TEST_IDS]));
});

function must<T>(result: { data: T; error: unknown }): NonNullable<T> {
  if (result.error) throw result.error;
  return result.data as NonNullable<T>;
}

function valueOf<T>(result: DbResult<T>): T {
  if (!result.ok) throw new Error(`예상하지 못한 거부: ${result.code}`);
  return result.value;
}

function asWord(row: WordRow): Word {
  return {
    id: row.id,
    language: row.language as Language,
    level: row.level as Level,
    rank: row.rank,
    word: row.word,
    reading: row.reading,
    meaningKo: row.meaning_ko,
    example: row.example,
    exampleKo: row.example_ko,
    distractors: row.distractors,
  };
}

// 로컬 DB에 seed된 실제 단어가 있어도 통과하도록 테스트 단어 id만 남긴다
function testIdsOf(words: Word[]): string[] {
  return words.map((word) => word.id).filter((id) => TEST_IDS.has(id));
}

// 그 언어·레벨에서 테스트 단어가 아닌 단어 수. 모두 rank가 9201보다 작아서 테스트 단어보다 앞에 온다
async function otherWordCount(language: Language, level: Level): Promise<number> {
  const { count, error } = await getAdminSupabase()
    .from("words")
    .select("*", { count: "exact", head: true })
    .eq("language", language)
    .eq("level", level);
  if (error) throw error;
  return (count ?? 0) - ALL_WORDS.filter((word) => word.language === language && word.level === level).length;
}

async function insertUserWords(
  userId: string,
  ids: string[],
  { status = "known", at }: { status?: "known" | "review"; at?: Date } = {},
): Promise<void> {
  const rows = ids.map((word_id) => ({
    user_id: userId,
    word_id,
    status,
    ...(at ? { first_seen_at: at.toISOString(), updated_at: at.toISOString() } : {}),
  }));
  must(await getAdminSupabase().from("user_words").insert(rows));
}

// 레벨 1 세션 (상황 id는 언어와 무관하다)
async function newSession(userId: string, language: Language = "en", scenarioId = "l1-cafe"): Promise<string> {
  return valueOf(await createChatSession(userId, { language, level: 1, scenarioId })).sessionId;
}

async function doneTurn(userId: string, sessionId: string, reply: TurnReply = PLAIN, userText = "hi"): Promise<void> {
  const { token } = valueOf(await beginChatTurn(userId, sessionId, userText));
  valueOf(await finishChatTurn(userId, sessionId, token, reply));
}

async function pendingTurn(userId: string, sessionId: string): Promise<void> {
  valueOf(await beginChatTurn(userId, sessionId, "still waiting"));
}

// active → ending (턴이 1개 이상인 세션)
async function startEnd(userId: string, sessionId: string): Promise<string> {
  const value = valueOf(await beginEnd(userId, sessionId));
  if (value.state !== "reserved") throw new Error(`종료 예약이 아님: ${value.state}`);
  return value.token;
}

// 0턴 세션은 AI 없이 skipped로 끝난다
async function endSkipped(userId: string, sessionId: string): Promise<void> {
  const value = valueOf(await beginEnd(userId, sessionId));
  if (value.state !== "ended") throw new Error(`skipped 종료가 아님: ${value.state}`);
}

async function moveTurn(sessionId: string, turnNo: number, at: Date): Promise<void> {
  must(
    await getAdminSupabase()
      .from("chat_turns")
      .update({ created_at: at.toISOString() })
      .eq("session_id", sessionId)
      .eq("turn_no", turnNo),
  );
}

async function sessionCreatedAt(sessionId: string): Promise<Date> {
  const row = must(await getAdminSupabase().from("chat_sessions").select("created_at").eq("id", sessionId).single());
  return new Date(row.created_at);
}

// now가 속한 한국 날짜의 경계
function dayBounds(now: Date) {
  const today = kstDate(now);
  const start = kstDayStart(today);
  return { start, yesterdayLast: new Date(start.getTime() - 1000), tomorrowStart: kstDayStart(addDays(today, 1)) };
}

describe("readAccount", () => {
  it("profiles 행이 없으면 빈 상태다", async () => {
    const user = await createTestUser();
    expect(await readAccount(await signedInClient(user), user.id)).toEqual(EMPTY_ACCOUNT);
  });

  it("동의·현재 언어·언어별 레벨·연속일·체험 값을 돌려준다", async () => {
    const user = await createReadyUser("en", 2);
    valueOf(await setFirstLevel(user.id, "ja", 1));
    valueOf(await startTrial(user.id));
    const admin = getAdminSupabase();
    must(await admin.from("profiles").update({ last_study_date: "2026-10-05", streak: 3 }).eq("id", user.id));
    const row = must(
      await admin.from("profiles").select("agreed_at, pro_until, trial_started_at").eq("id", user.id).single(),
    );

    expect(await readAccount(await signedInClient(user), user.id)).toEqual({
      agreedAt: new Date(row.agreed_at!),
      currentLanguage: "ja",
      levels: { en: 2, ja: 1 },
      streak: { lastStudyDate: "2026-10-05", streak: 3 },
      proUntil: new Date(row.pro_until!),
      trialStartedAt: new Date(row.trial_started_at!),
    });
  });

  it("A의 client로 B의 id를 읽으면 빈 상태다 (RLS)", async () => {
    const me = await createReadyUser("en", 1);
    const other = await createReadyUser("ja", 3);
    expect(await readAccount(await signedInClient(me), other.id)).toEqual(EMPTY_ACCOUNT);
  });
});

describe("readTodayUsage", () => {
  it("오늘 대화 턴(pending 포함)과 새 단어를 두 언어 합산으로 센다", async () => {
    const user = await createReadyUser("en", 1);
    valueOf(await setFirstLevel(user.id, "ja", 1));
    const en = await newSession(user.id, "en");
    await doneTurn(user.id, en);
    await pendingTurn(user.id, en);
    await doneTurn(user.id, await newSession(user.id, "ja"));
    await insertUserWords(user.id, [EN1[0].id, EN2.id]);
    await insertUserWords(user.id, [JA1.id], { status: "review" });

    expect(await readTodayUsage(await signedInClient(user), user.id, new Date())).toEqual({
      chatTurns: 3,
      newWords: 3,
    });
  });

  it("한국 날짜 [오늘 0시, 내일 0시) 구간만 센다", async () => {
    const now = new Date();
    const { start, yesterdayLast, tomorrowStart } = dayBounds(now);
    const user = await createReadyUser("en", 1);
    const session = await newSession(user.id);
    for (let i = 0; i < 3; i++) await doneTurn(user.id, session);
    await moveTurn(session, 1, yesterdayLast);
    await moveTurn(session, 2, start);
    await moveTurn(session, 3, tomorrowStart);
    await insertUserWords(user.id, [EN1[0].id], { at: yesterdayLast });
    await insertUserWords(user.id, [EN1[1].id], { at: start });
    await insertUserWords(user.id, [EN1[2].id], { at: tomorrowStart });

    expect(await readTodayUsage(await signedInClient(user), user.id, now)).toEqual({ chatTurns: 1, newWords: 1 });
  });

  it("남의 행은 세지 않는다", async () => {
    const me = await createReadyUser("en", 1);
    const other = await createReadyUser("en", 1);
    await doneTurn(other.id, await newSession(other.id));
    await insertUserWords(other.id, [EN1[0].id]);

    expect(await readTodayUsage(await signedInClient(me), me.id, new Date())).toEqual({ chatTurns: 0, newWords: 0 });
  });
});

describe("readBestSessionTurnsToday", () => {
  it("오늘 done 턴을 세션별로 셌을 때 가장 큰 값이다 (언어 합산)", async () => {
    const user = await createReadyUser("en", 1);
    valueOf(await setFirstLevel(user.id, "ja", 1));
    const en = await newSession(user.id, "en");
    for (let i = 0; i < 2; i++) await doneTurn(user.id, en);
    const ja = await newSession(user.id, "ja");
    for (let i = 0; i < 3; i++) await doneTurn(user.id, ja);

    expect(await readBestSessionTurnsToday(await signedInClient(user), user.id, new Date())).toBe(3);
  });

  it("pending 턴과 어제 턴은 세지 않는다", async () => {
    const now = new Date();
    const user = await createReadyUser("en", 1);
    const session = await newSession(user.id);
    for (let i = 0; i < 3; i++) await doneTurn(user.id, session);
    await moveTurn(session, 1, dayBounds(now).yesterdayLast);
    await pendingTurn(user.id, session);

    expect(await readBestSessionTurnsToday(await signedInClient(user), user.id, now)).toBe(2);
  });

  it("오늘 done 턴이 없으면 0이다 (남의 턴 제외)", async () => {
    const me = await createReadyUser("en", 1);
    const other = await createReadyUser("en", 1);
    const session = await newSession(other.id);
    for (let i = 0; i < 3; i++) await doneTurn(other.id, session);

    expect(await readBestSessionTurnsToday(await signedInClient(me), me.id, new Date())).toBe(0);
  });
});

describe("readUnseenWords", () => {
  it("이 사용자가 학습한 단어(known·review)를 빼고 rank 순서로 limit개와 전체 개수를 돌려준다", async () => {
    const user = await createReadyUser("en", 1);
    const other = await createReadyUser("en", 1);
    await insertUserWords(user.id, [EN1[0].id], { status: "known" });
    await insertUserWords(user.id, [EN1[2].id], { status: "review" });
    // 남이 학습한 단어는 빼지 않는다
    await insertUserWords(other.id, [EN1[1].id, EN1[3].id]);
    const sb = await signedInClient(user);
    const others = await otherWordCount("en", 1);

    const all = await readUnseenWords(sb, user.id, "en", 1, others + 100);
    expect(testIdsOf(all.words)).toEqual([EN1[1].id, EN1[3].id, EN1[4].id, EN1[5].id]);
    expect(all.total).toBe(others + 4);

    const limited = await readUnseenWords(sb, user.id, "en", 1, others + 2);
    expect(limited.words).toHaveLength(others + 2);
    expect(testIdsOf(limited.words)).toEqual([EN1[1].id, EN1[3].id]);
    expect(limited.total).toBe(others + 4);
    expect(limited.words.find((word) => word.id === EN1[1].id)).toEqual(asWord(EN1[1]));
  });

  it("limit이 0이면 단어 없이 전체 개수만 돌려준다", async () => {
    const user = await createReadyUser("en", 1);
    await insertUserWords(user.id, [EN1[0].id]);
    const others = await otherWordCount("en", 1);

    expect(await readUnseenWords(await signedInClient(user), user.id, "en", 1, 0)).toEqual({
      total: others + EN1.length - 1,
      words: [],
    });
  });
});

describe("readReviewWords", () => {
  it("그 언어의 review 단어를 first_seen_at·word_id 순서로 limit개와 전체 개수를 돌려준다", async () => {
    const user = await createReadyUser("en", 1);
    const later = new Date(Date.now() - 60_000);
    const earlier = new Date(later.getTime() - 60 * 60_000);
    // 같은 시각이면 word_id 순서다. 물리 순서가 반대가 되게 넣는다
    await insertUserWords(user.id, [EN2.id, EN1[1].id, EN1[0].id], { status: "review", at: later });
    await insertUserWords(user.id, [EN1[2].id, JA1.id], { status: "review", at: earlier });
    await insertUserWords(user.id, [EN1[3].id], { status: "known", at: earlier });
    const sb = await signedInClient(user);

    expect(await readReviewWords(sb, user.id, "en", 10)).toEqual({
      total: 4,
      words: [EN1[2], EN1[0], EN1[1], EN2].map(asWord),
    });
    expect(await readReviewWords(sb, user.id, "en", 2)).toEqual({ total: 4, words: [EN1[2], EN1[0]].map(asWord) });
    expect(await readReviewWords(sb, user.id, "ja", 10)).toEqual({ total: 1, words: [asWord(JA1)] });
  });
});

describe("readLevelWords", () => {
  it("그 언어·레벨의 단어를 rank 순서로 모두 돌려준다", async () => {
    const user = await createReadyUser("en", 1);
    const words = await readLevelWords(await signedInClient(user), "en", 1);

    expect(words.filter((word) => TEST_IDS.has(word.id))).toEqual(EN1.map(asWord));
    expect(words).toHaveLength((await otherWordCount("en", 1)) + EN1.length);
    const ranks = words.map((word) => word.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe("readOpenSessions", () => {
  it("그 언어의 active·ending 세션을 최신순으로, done 턴 수와 마지막 done 턴의 reply와 함께 돌려준다", async () => {
    const user = await createReadyUser("en", 1);
    valueOf(await setFirstLevel(user.id, "ja", 1));
    const active = await newSession(user.id, "en", "l1-cafe");
    await doneTurn(user.id, active, { ...PLAIN, reply: "First reply" });
    await doneTurn(user.id, active, { ...PLAIN, reply: "[駅|えき]はどこですか" });
    await pendingTurn(user.id, active);
    const ending = await newSession(user.id, "en", "l1-greeting");
    await doneTurn(user.id, ending, { ...PLAIN, reply: "Bye" });
    await startEnd(user.id, ending);
    const empty = await newSession(user.id, "en", "l1-checkout");
    await endSkipped(user.id, await newSession(user.id, "en", "l1-directions"));
    await newSession(user.id, "ja", "l1-cafe");

    expect(await readOpenSessions(await signedInClient(user), user.id, "en")).toEqual([
      {
        id: empty,
        scenarioId: "l1-checkout",
        level: 1,
        status: "active",
        doneTurns: 0,
        lastReply: null,
        createdAt: await sessionCreatedAt(empty),
      },
      {
        id: ending,
        scenarioId: "l1-greeting",
        level: 1,
        status: "ending",
        doneTurns: 1,
        lastReply: "Bye",
        createdAt: await sessionCreatedAt(ending),
      },
      {
        id: active,
        scenarioId: "l1-cafe",
        level: 1,
        status: "active",
        doneTurns: 2,
        lastReply: "[駅|えき]はどこですか",
        createdAt: await sessionCreatedAt(active),
      },
    ]);
  });
});

describe("readEndedScenarioIds", () => {
  it("그 언어에서 ended 세션이 있는 상황 id를 중복 없이 돌려준다", async () => {
    const user = await createReadyUser("en", 1);
    valueOf(await setFirstLevel(user.id, "ja", 1));
    await endSkipped(user.id, await newSession(user.id, "en", "l1-cafe"));
    await endSkipped(user.id, await newSession(user.id, "en", "l1-cafe"));
    await endSkipped(user.id, await newSession(user.id, "en", "l1-greeting"));
    await newSession(user.id, "en", "l1-checkout");
    await endSkipped(user.id, await newSession(user.id, "ja", "l1-directions"));

    const ids = await readEndedScenarioIds(await signedInClient(user), user.id, "en");
    expect([...ids].sort()).toEqual(["l1-cafe", "l1-greeting"]);
  });
});

describe("readChatRoom", () => {
  it("내 세션의 done 턴만 turn_no 순서로 돌려준다", async () => {
    const user = await createReadyUser("en", 1);
    const session = await newSession(user.id);
    await doneTurn(user.id, session, CORRECTED, "Can I have latte?");
    await doneTurn(user.id, session, PLAIN, "No, thanks.");
    await pendingTurn(user.id, session);

    expect(await readChatRoom(await signedInClient(user), user.id, session)).toEqual({
      id: session,
      language: "en",
      level: 1,
      scenarioId: "l1-cafe",
      status: "active",
      result: null,
      turns: [
        {
          turnNo: 1,
          userText: "Can I have latte?",
          reply: CORRECTED.reply,
          replyKo: CORRECTED.reply_ko,
          correction: CORRECTED.correction,
        },
        { turnNo: 2, userText: "No, thanks.", reply: PLAIN.reply, replyKo: PLAIN.reply_ko, correction: null },
      ],
    });
  });

  it("result는 ended일 때만 있다 (skipped, ready)", async () => {
    const user = await createReadyUser("en", 1);
    const sb = await signedInClient(user);
    const skipped = await newSession(user.id);
    await endSkipped(user.id, skipped);
    expect(await readChatRoom(sb, user.id, skipped)).toMatchObject({
      status: "ended",
      result: { feedbackStatus: "skipped", feedback: null },
      turns: [],
    });

    const session = await newSession(user.id);
    await doneTurn(user.id, session);
    const token = await startEnd(user.id, session);
    expect(await readChatRoom(sb, user.id, session)).toMatchObject({ status: "ending", result: null });

    valueOf(await finishEnd(user.id, session, token, FEEDBACK));
    const room = await readChatRoom(sb, user.id, session);
    expect(room).toMatchObject({ status: "ended", result: { feedbackStatus: "ready", feedback: FEEDBACK } });
    expect(room?.turns).toHaveLength(1);
  });

  it("남의 세션, 없는 uuid, uuid가 아닌 문자열은 null이다", async () => {
    const me = await createReadyUser("en", 1);
    const other = await createReadyUser("en", 1);
    const othersSession = await newSession(other.id);
    const sb = await signedInClient(me);

    expect(await readChatRoom(sb, me.id, othersSession)).toBeNull();
    expect(await readChatRoom(sb, other.id, othersSession)).toBeNull();
    expect(await readChatRoom(sb, me.id, randomUUID())).toBeNull();
    expect(await readChatRoom(sb, me.id, "not-a-uuid")).toBeNull();
  });
});
