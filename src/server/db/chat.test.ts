import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PLAN_LIMITS } from "@/lib/plan";
import type { TargetWord, WordCandidate } from "@/lib/targetWords";
import { kstDate, kstDayStart } from "@/lib/usage";
import type { Feedback, TurnReply } from "@/services/claude/schemas";
import { getAdminSupabase } from "@/services/supabase/admin";
import { createReadyUser, createTestUser, deleteTestUsers } from "@/test/db";
import type { Database } from "@/types/database";
import { ensureProfile, startTrial } from "./account";
import {
  beginChatTurn,
  beginEnd,
  createChatSession,
  failChatTurn,
  failEnd,
  finishChatTurn,
  finishEnd,
  type BeginEndResult,
} from "./chat";
import { callRpc } from "./rpc";
import type { DbResult } from "./types";

// chat 마이그레이션의 SQL 상수와 같은 값 (lib에 상수가 없는 규칙)
const SESSION_MAX_TURNS = 20;
const DAILY_AI_FAILURE_LIMIT = 10;
const OPERATION_MS = 90_000;
const FALLBACK = {
  message: "대화 기록은 저장됐어요. 종합 피드백을 만들지 못했으니 대화 아래의 교정을 확인해 주세요.",
};

const FREE_LIMIT = PLAN_LIMITS.free.chatTurns;
const PRO_LIMIT = PLAN_LIMITS.pro.chatTurns;

const SESSION = { language: "en", level: 1, scenarioId: "l1-cafe" } as const;
// 입문 5번째 상황 (Pro 상황)
const PRO_SESSION = { language: "en", level: 1, scenarioId: "l1-taxi" } as const;
const REPLY: TurnReply = {
  reply: "One latte, coming up!",
  reply_ko: "라테 한 잔 나갑니다!",
  correction: { corrected: "Can I get a latte?", explanation_ko: "주문할 때는 Can I get ...?이 자연스러워요." },
};
const PLAIN_REPLY: TurnReply = { reply: "Anything else?", reply_ko: "더 필요한 거 있으세요?", correction: null };
const FEEDBACK: Feedback = {
  good: "주문을 끝까지 마쳤어요.",
  improve: [{ point: "관사 a를 빠뜨리지 않게 해 보세요.", example: "I'd like a latte." }],
};
const NOT_FOUND = { ok: false, code: "NOT_FOUND" };
const CONFLICT = { ok: false, code: "CONFLICT" };

type TurnInsert = Database["public"]["Tables"]["chat_turns"]["Insert"];
type WordRow = Database["public"]["Tables"]["words"]["Row"];

// 배운 단어 테스트 단어. seed와 겹치지 않게 rank 9301+를 쓴다 (security 9001~, learning 9101~, reads 9201~)
function testWord(language: "en" | "ja", level: number, rank: number): WordRow {
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
    pron_ko: null,
    example_pron_ko: null,
  };
}

// 후보 20개 제한을 보려고 20개보다 많이 둔다
const EN = Array.from({ length: 22 }, (_, i) => testWord("en", 1, 9301 + i));
const EN2 = testWord("en", 2, 9301);
const JA = testWord("ja", 1, 9301);
const TEST_WORDS = [...EN, EN2, JA];

beforeAll(async () => {
  must(await getAdminSupabase().from("words").upsert(TEST_WORDS));
});

afterEach(deleteTestUsers);

afterAll(async () => {
  must(await getAdminSupabase().from("words").delete().in("id", TEST_WORDS.map((word) => word.id)));
});

function must<T>(result: { data: T; error: unknown }): NonNullable<T> {
  if (result.error) throw result.error;
  return result.data as NonNullable<T>;
}

function valueOf<T>(result: DbResult<T>): T {
  if (!result.ok) throw new Error(`예상하지 못한 거부: ${result.code}`);
  return result.value;
}

function reserved(result: DbResult<BeginEndResult>) {
  const value = valueOf(result);
  if (value.state !== "reserved") throw new Error(`종료 예약이 아님: ${value.state}`);
  return value;
}

const today = () => kstDate(new Date());
// 어제(한국 날짜)의 마지막 1분 안
const yesterday = () => new Date(kstDayStart(today()).getTime() - 60_000).toISOString();

async function newSession(userId: string): Promise<string> {
  return valueOf(await createChatSession(userId, SESSION, false)).sessionId;
}

// 예약 → 확정으로 성공한 턴 하나
async function doneTurn(userId: string, sessionId: string) {
  const { token } = valueOf(await beginChatTurn(userId, sessionId, "Can I have latte?"));
  return valueOf(await finishChatTurn(userId, sessionId, token, REPLY));
}

async function sessionRow(sessionId: string) {
  return must(await getAdminSupabase().from("chat_sessions").select("*").eq("id", sessionId).single());
}

async function sessionsOf(userId: string) {
  return must(await getAdminSupabase().from("chat_sessions").select("id").eq("user_id", userId));
}

async function turnsOf(sessionId: string) {
  return must(
    await getAdminSupabase().from("chat_turns").select("*").eq("session_id", sessionId).order("turn_no"),
  );
}

async function eventsOf(userId: string, name: "limit_reached" | "chat_failed") {
  const rows = must(
    await getAdminSupabase().from("events").select("props").eq("user_id", userId).eq("name", name).order("id"),
  );
  return rows.map((row) => row.props);
}

async function todayTurnCount(userId: string): Promise<number> {
  const { count, error } = await getAdminSupabase()
    .from("chat_turns")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", kstDayStart(today()).toISOString());
  if (error) throw error;
  return count ?? -1;
}

async function activityOf(userId: string) {
  const admin = getAdminSupabase();
  const days = must(await admin.from("user_activity_days").select("activity_date").eq("user_id", userId));
  const profile = must(await admin.from("profiles").select("last_study_date, streak").eq("id", userId).single());
  return { days: days.map((row) => row.activity_date), ...profile };
}

// admin으로 done 턴을 넣는다. 세션마다 최대 20턴이라 새 세션을 필요한 만큼 만들고 그 id를 돌려준다
async function insertDoneTurns(userId: string, count: number, createdAt?: string): Promise<string[]> {
  const admin = getAdminSupabase();
  const sessionIds: string[] = [];
  const rows: TurnInsert[] = [];
  for (let start = 0; start < count; start += SESSION_MAX_TURNS) {
    const session = must(
      await admin
        .from("chat_sessions")
        .insert({ user_id: userId, language: "en", level: 1, scenario_id: SESSION.scenarioId })
        .select("id")
        .single(),
    );
    sessionIds.push(session.id);
    for (let turnNo = 1; turnNo <= Math.min(SESSION_MAX_TURNS, count - start); turnNo++) {
      rows.push({
        session_id: session.id,
        user_id: userId,
        turn_no: turnNo,
        status: "done",
        user_text: "hi",
        reply: "hello",
        reply_ko: "안녕하세요",
        ...(createdAt ? { created_at: createdAt } : {}),
      });
    }
  }
  must(await admin.from("chat_turns").insert(rows));
  return sessionIds;
}

async function insertFailures(userId: string, count: number, createdAt?: string): Promise<void> {
  const rows = Array.from({ length: count }, () => ({
    user_id: userId,
    name: "chat_failed",
    props: { operation_token: randomUUID(), kind: "turn", reason: "api_error" },
    ...(createdAt ? { created_at: createdAt } : {}),
  }));
  must(await getAdminSupabase().from("events").insert(rows));
}

// 작업 기한이 지난 것으로 만든다 (작업 토큰이 있는 세션만)
async function expire(sessionId: string): Promise<void> {
  const past = new Date(Date.now() - 60 * 60_000).toISOString();
  must(await getAdminSupabase().from("chat_sessions").update({ operation_expires_at: past }).eq("id", sessionId));
}

function expectExpiresInOperationWindow(expiresAt: string | null) {
  expect(expiresAt).not.toBeNull();
  expect(Math.abs(new Date(expiresAt!).getTime() - (Date.now() + OPERATION_MS))).toBeLessThan(10_000);
}

describe("createChatSession", () => {
  it("현재 레벨의 active 세션을 만든다", async () => {
    const user = await createReadyUser("en", 1);
    const sessionId = await newSession(user.id);
    expect(await sessionRow(sessionId)).toMatchObject({
      user_id: user.id,
      language: "en",
      level: 1,
      scenario_id: "l1-cafe",
      status: "active",
      operation_token: null,
      operation_expires_at: null,
      feedback_status: "none",
      feedback: null,
      ended_at: null,
    });
  });

  it("실제 레벨과 다른 레벨이면 Pro 상황 여부와 상관없이 CONFLICT이고 세션을 만들지 않는다", async () => {
    const user = await createReadyUser("en", 2);
    await expect(createChatSession(user.id, SESSION, false)).resolves.toEqual(CONFLICT);
    await expect(createChatSession(user.id, PRO_SESSION, true)).resolves.toEqual(CONFLICT);
    expect(await sessionsOf(user.id)).toEqual([]);
  });

  it("미동의는 CONSENT_REQUIRED, 레벨이 없는 언어는 ONBOARDING_REQUIRED이고 세션을 만들지 않는다", async () => {
    const fresh = await createTestUser();
    await ensureProfile(fresh.id);
    await expect(createChatSession(fresh.id, SESSION, false)).resolves.toEqual({ ok: false, code: "CONSENT_REQUIRED" });
    expect(await sessionsOf(fresh.id)).toEqual([]);

    const user = await createReadyUser("en", 1);
    await expect(createChatSession(user.id, { ...SESSION, language: "ja" }, false)).resolves.toEqual({
      ok: false,
      code: "ONBOARDING_REQUIRED",
    });
    expect(await sessionsOf(user.id)).toEqual([]);
  });

  it("Free(체험 안 함)가 Pro 상황이면 PRO_REQUIRED이고 세션도 limit_reached도 남기지 않는다", async () => {
    const user = await createReadyUser("en", 1);
    await expect(createChatSession(user.id, PRO_SESSION, true)).resolves.toEqual({ ok: false, code: "PRO_REQUIRED" });
    expect(await sessionsOf(user.id)).toEqual([]);
    expect(await eventsOf(user.id, "limit_reached")).toEqual([]);
  });

  it("체험 중이면 Pro 상황 세션을 만들고, 체험이 끝난 뒤에도 그 세션의 턴 예약과 종료가 된다", async () => {
    const user = await createReadyUser("en", 1);
    valueOf(await startTrial(user.id));
    const { sessionId } = valueOf(await createChatSession(user.id, PRO_SESSION, true));
    expect(await sessionRow(sessionId)).toMatchObject({ scenario_id: PRO_SESSION.scenarioId, level: 1, status: "active" });

    // 체험 종료: 새 Pro 상황 세션은 막히고, 이미 만든 세션은 이어서 하고 끝낼 수 있다
    must(await getAdminSupabase().from("profiles").update({ pro_until: new Date(Date.now() - 60_000).toISOString() }).eq("id", user.id));
    await expect(createChatSession(user.id, PRO_SESSION, true)).resolves.toEqual({ ok: false, code: "PRO_REQUIRED" });
    await doneTurn(user.id, sessionId);
    expect(reserved(await beginEnd(user.id, sessionId)).session).toEqual(PRO_SESSION);
  });

  // 지금 운영 코드는 p_pro_only 없이 인자 4개로 부른다. 마이그레이션을 먼저 적용해도 깨지지 않아야 한다
  it("p_pro_only를 빼고 부르면 기존처럼 세션을 만든다", async () => {
    const user = await createReadyUser("en", 1);
    const result = await callRpc("create_chat_session", {
      p_user_id: user.id,
      p_language: "en",
      p_level: 1,
      p_scenario_id: PRO_SESSION.scenarioId,
    });
    expect(result.ok).toBe(true);
    expect(await sessionsOf(user.id)).toHaveLength(1);
  });
});

describe("대화 1턴", () => {
  it("예약 → 확정: turn_no가 늘고, 토큰을 풀고, 활동일·연속일을 갱신하고, history에는 done 턴만 순서대로 담긴다", async () => {
    const user = await createReadyUser();
    const sessionId = await newSession(user.id);

    const first = valueOf(await beginChatTurn(user.id, sessionId, "Can I have latte?"));
    expect(first).toEqual({
      token: expect.any(String),
      turnNo: 1,
      session: SESSION,
      history: [],
      candidates: [],
      candidateSource: null,
      targets: null,
    });
    const reservedRow = await sessionRow(sessionId);
    expect(reservedRow.operation_token).toBe(first.token);
    expectExpiresInOperationWindow(reservedRow.operation_expires_at);
    expect(await turnsOf(sessionId)).toMatchObject([
      { id: first.token, turn_no: 1, status: "pending", user_text: "Can I have latte?", reply: null },
    ]);

    await expect(finishChatTurn(user.id, sessionId, first.token, REPLY)).resolves.toEqual({
      ok: true,
      value: { turnsLeft: SESSION_MAX_TURNS - 1, targetWords: null, targetSource: null },
    });
    expect(await sessionRow(sessionId)).toMatchObject({
      status: "active",
      operation_token: null,
      operation_expires_at: null,
    });
    expect(await turnsOf(sessionId)).toMatchObject([
      { turn_no: 1, status: "done", reply: REPLY.reply, reply_ko: REPLY.reply_ko, correction: REPLY.correction },
    ]);
    expect(await activityOf(user.id)).toEqual({ days: [today()], last_study_date: today(), streak: 1 });

    // 이미 확정한 토큰으로 다시 확정하면 덮어쓰지 않는다
    await expect(finishChatTurn(user.id, sessionId, first.token, PLAIN_REPLY)).resolves.toEqual(CONFLICT);
    expect((await turnsOf(sessionId))[0].reply).toBe(REPLY.reply);

    const second = valueOf(await beginChatTurn(user.id, sessionId, "Thanks"));
    expect(second.turnNo).toBe(2);
    expect(second.history).toEqual([{ userText: "Can I have latte?", reply: REPLY.reply }]);
    await expect(finishChatTurn(user.id, sessionId, second.token, PLAIN_REPLY)).resolves.toEqual({
      ok: true,
      value: { turnsLeft: SESSION_MAX_TURNS - 2, targetWords: null, targetSource: null },
    });
    expect((await turnsOf(sessionId))[1].correction).toBeNull();

    const third = valueOf(await beginChatTurn(user.id, sessionId, "Bye"));
    expect(third.turnNo).toBe(3);
    expect(third.history).toEqual([
      { userText: "Can I have latte?", reply: REPLY.reply },
      { userText: "Thanks", reply: PLAIN_REPLY.reply },
    ]);
    expect(await eventsOf(user.id, "limit_reached")).toEqual([]);
  });

  it("예약이 남은 세션에 다시 예약하면 예외가 아니라 CONFLICT이고 pending은 1개다", async () => {
    const user = await createReadyUser();
    const sessionId = await newSession(user.id);
    await doneTurn(user.id, sessionId);

    const a = valueOf(await beginChatTurn(user.id, sessionId, "first"));
    await expect(beginChatTurn(user.id, sessionId, "second")).resolves.toEqual(CONFLICT);

    const pending = (await turnsOf(sessionId)).filter((turn) => turn.status === "pending");
    expect(pending).toMatchObject([{ id: a.token, turn_no: 2, user_text: "first" }]);
    expect((await sessionRow(sessionId)).operation_token).toBe(a.token);
  });

  it("done 턴이 20개인 세션은 플랜 한도보다 먼저 SESSION_FULL이다", async () => {
    const user = await createReadyUser();
    const [sessionId] = await insertDoneTurns(user.id, SESSION_MAX_TURNS);
    await expect(beginChatTurn(user.id, sessionId, "hi")).resolves.toEqual({ ok: false, code: "SESSION_FULL" });
    expect(await turnsOf(sessionId)).toHaveLength(SESSION_MAX_TURNS);
    expect(await eventsOf(user.id, "limit_reached")).toEqual([]);
  });

  it("오늘 chat_failed가 10개가 되면 AI_FAILURE_LIMIT다 (어제 실패는 세지 않는다)", async () => {
    const user = await createReadyUser();
    await insertFailures(user.id, DAILY_AI_FAILURE_LIMIT, yesterday());
    await insertFailures(user.id, DAILY_AI_FAILURE_LIMIT - 1);
    const sessionId = await newSession(user.id);

    const { token } = valueOf(await beginChatTurn(user.id, sessionId, "hi"));
    valueOf(await failChatTurn(user.id, sessionId, token, "timeout")); // 오늘 10번째 실패

    await expect(beginChatTurn(user.id, sessionId, "hi")).resolves.toEqual({ ok: false, code: "AI_FAILURE_LIMIT" });
    expect(await turnsOf(sessionId)).toEqual([]);
  });

  it("확정은 한글 발음을 저장한다: reply_pron_ko는 컬럼에, 교정 발음은 correction 안에. 없으면 null이다", async () => {
    const user = await createReadyUser("ja", 1);
    const { sessionId } = valueOf(await createChatSession(user.id, { language: "ja", level: 1, scenarioId: "l1-cafe" }, false));
    const withPron: TurnReply = {
      reply: "はい、どうぞ。",
      reply_ko: "네, 여기요.",
      reply_pron_ko: "하이, 도-조.",
      correction: { corrected: "コーヒーをください。", explanation_ko: "を를 넣어요.", corrected_pron_ko: "코-히-오 쿠다사이." },
    };
    const first = valueOf(await beginChatTurn(user.id, sessionId, "コーヒーください"));
    valueOf(await finishChatTurn(user.id, sessionId, first.token, withPron));
    const second = valueOf(await beginChatTurn(user.id, sessionId, "ありがとう"));
    valueOf(await finishChatTurn(user.id, sessionId, second.token, PLAIN_REPLY));

    expect(await turnsOf(sessionId)).toMatchObject([
      { turn_no: 1, reply_pron_ko: "하이, 도-조.", correction: withPron.correction },
      { turn_no: 2, reply_pron_ko: null, correction: null },
    ]);
  });

  it("확정은 문장 뜯어보기를 저장한다: reply_breakdown은 컬럼에, 교정 뜯어보기는 correction 안에. 없으면 null이다", async () => {
    const user = await createReadyUser();
    const sessionId = await newSession(user.id);
    const withBreakdown: TurnReply = {
      ...REPLY,
      reply_breakdown: [
        { text: "One latte,", meaning_ko: "라테 한 잔" },
        { text: "coming up!", meaning_ko: "나갑니다" },
      ],
      correction: {
        ...REPLY.correction!,
        breakdown: [
          { text: "Can I get", meaning_ko: "주시겠어요" },
          { text: "a latte?", meaning_ko: "라테 한 잔" },
        ],
      },
    };
    const first = valueOf(await beginChatTurn(user.id, sessionId, "Can I have latte?"));
    valueOf(await finishChatTurn(user.id, sessionId, first.token, withBreakdown));
    // 뜯어보기가 없으면 인자를 빼고 부르고, 기존처럼 확정된다
    const second = valueOf(await beginChatTurn(user.id, sessionId, "No, thanks."));
    await expect(finishChatTurn(user.id, sessionId, second.token, PLAIN_REPLY)).resolves.toEqual({
      ok: true,
      value: { turnsLeft: SESSION_MAX_TURNS - 2, targetWords: null, targetSource: null },
    });

    expect(await turnsOf(sessionId)).toMatchObject([
      { turn_no: 1, status: "done", reply_breakdown: withBreakdown.reply_breakdown, correction: withBreakdown.correction },
      { turn_no: 2, status: "done", reply_breakdown: null, correction: null },
    ]);
  });
});

describe("failChatTurn", () => {
  it("pending을 지우고 예약을 돌려주며 chat_failed를 1개 남긴다", async () => {
    const user = await createReadyUser();
    const sessionId = await newSession(user.id);
    await doneTurn(user.id, sessionId);
    const { token, turnNo } = valueOf(await beginChatTurn(user.id, sessionId, "hi"));

    await expect(failChatTurn(user.id, sessionId, token, "timeout")).resolves.toEqual({ ok: true, value: null });
    expect(await turnsOf(sessionId)).toMatchObject([{ turn_no: 1, status: "done" }]);
    expect(await sessionRow(sessionId)).toMatchObject({
      status: "active",
      operation_token: null,
      operation_expires_at: null,
    });
    expect(await eventsOf(user.id, "chat_failed")).toEqual([
      { operation_token: token, kind: "turn", reason: "timeout" },
    ]);
    expect(await todayTurnCount(user.id)).toBe(1);

    const again = valueOf(await beginChatTurn(user.id, sessionId, "hi"));
    expect(again.turnNo).toBe(turnNo);
  });

  it("토큰이 다르면 확정·실패 모두 CONFLICT이고 아무것도 바꾸지 않는다", async () => {
    const user = await createReadyUser();
    const sessionId = await newSession(user.id);
    const { token } = valueOf(await beginChatTurn(user.id, sessionId, "hi"));
    const wrong = randomUUID();

    await expect(finishChatTurn(user.id, sessionId, wrong, REPLY)).resolves.toEqual(CONFLICT);
    await expect(failChatTurn(user.id, sessionId, wrong, "timeout")).resolves.toEqual(CONFLICT);
    expect(await turnsOf(sessionId)).toMatchObject([{ id: token, status: "pending", reply: null }]);
    expect((await sessionRow(sessionId)).operation_token).toBe(token);
    expect(await eventsOf(user.id, "chat_failed")).toEqual([]);
  });
});

describe("하루 대화 한도", () => {
  it("한도에 닿으면 pending 없이 LIMIT_REACHED이고 limit_reached를 props와 함께 남긴다", async () => {
    const user = await createReadyUser();
    await insertDoneTurns(user.id, FREE_LIMIT);
    const sessionId = await newSession(user.id);

    await expect(beginChatTurn(user.id, sessionId, "hi")).resolves.toEqual({ ok: false, code: "LIMIT_REACHED" });
    expect(await turnsOf(sessionId)).toEqual([]);
    expect((await sessionRow(sessionId)).operation_token).toBeNull();
    expect(await eventsOf(user.id, "limit_reached")).toEqual([{ feature: "chat", plan: "free", trial_eligible: true }]);
    expect(await todayTurnCount(user.id)).toBe(FREE_LIMIT);
  });

  it("Pro(pro_until 미래)는 Pro 한도를 쓴다", async () => {
    const user = await createReadyUser();
    valueOf(await startTrial(user.id));
    await insertDoneTurns(user.id, PRO_LIMIT - 1);
    const a = await newSession(user.id);
    const b = await newSession(user.id);

    expect((await beginChatTurn(user.id, a, "hi")).ok).toBe(true);
    await expect(beginChatTurn(user.id, b, "hi")).resolves.toEqual({ ok: false, code: "LIMIT_REACHED" });
    expect(await eventsOf(user.id, "limit_reached")).toEqual([{ feature: "chat", plan: "pro", trial_eligible: false }]);
  });

  it("어제(한국 날짜) 턴은 오늘 사용량에 세지 않는다", async () => {
    const user = await createReadyUser();
    await insertDoneTurns(user.id, FREE_LIMIT, yesterday());
    const sessionId = await newSession(user.id);
    expect((await beginChatTurn(user.id, sessionId, "hi")).ok).toBe(true);
  });

  it("같은 계정의 두 세션에서 마지막 1회를 동시에 예약하면 하나만 성공한다", async () => {
    const user = await createReadyUser();
    await insertDoneTurns(user.id, FREE_LIMIT - 1);
    const a = await newSession(user.id);
    const b = await newSession(user.id);

    const results = await Promise.all([beginChatTurn(user.id, a, "hi"), beginChatTurn(user.id, b, "hi")]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, code: "LIMIT_REACHED" }]);
    expect(await todayTurnCount(user.id)).toBe(FREE_LIMIT);
  });

  it("한도를 채우는 마지막 확정에서 limit_reached를 남긴다", async () => {
    const user = await createReadyUser();
    await insertDoneTurns(user.id, FREE_LIMIT - 1);
    const sessionId = await newSession(user.id);

    const { token } = valueOf(await beginChatTurn(user.id, sessionId, "hi"));
    expect(await eventsOf(user.id, "limit_reached")).toEqual([]);
    valueOf(await finishChatTurn(user.id, sessionId, token, REPLY));
    expect(await eventsOf(user.id, "limit_reached")).toEqual([{ feature: "chat", plan: "free", trial_eligible: true }]);
  });
});

describe("턴 예약과 종료 경합", () => {
  it("턴 예약과 종료 시작을 동시에 하면 하나만 예약되고 다른 쪽은 CONFLICT다", async () => {
    const user = await createReadyUser();
    const sessionId = await newSession(user.id);
    await doneTurn(user.id, sessionId);

    const [turn, end] = await Promise.all([beginChatTurn(user.id, sessionId, "hi"), beginEnd(user.id, sessionId)]);
    const endReserved = end.ok && end.value.state === "reserved";
    expect(turn.ok !== endReserved).toBe(true);

    const row = await sessionRow(sessionId);
    const pending = (await turnsOf(sessionId)).filter((t) => t.status === "pending");
    if (turn.ok) {
      expect(end).toEqual(CONFLICT);
      expect(row).toMatchObject({ status: "active", operation_token: turn.value.token });
      expect(pending).toHaveLength(1);
    } else {
      expect(turn).toEqual(CONFLICT);
      expect(row.status).toBe("ending");
      expect(pending).toHaveLength(0);
    }
  });

  it("종료 시작을 동시에 두 번 하면 하나는 reserved, 다른 하나는 ending이다", async () => {
    const user = await createReadyUser();
    const sessionId = await newSession(user.id);
    await doneTurn(user.id, sessionId);

    const results = await Promise.all([beginEnd(user.id, sessionId), beginEnd(user.id, sessionId)]);
    expect(results.map((result) => (result.ok ? result.value.state : result.code)).sort()).toEqual([
      "ending",
      "reserved",
    ]);
  });
});

describe("세션 종료", () => {
  it("성공한 턴이 없으면 skipped로 끝내고 활동일을 남기지 않는다", async () => {
    const user = await createReadyUser();
    const sessionId = await newSession(user.id);
    const skipped = { ok: true, value: { state: "ended", result: { feedbackStatus: "skipped", feedback: null } } };

    await expect(beginEnd(user.id, sessionId)).resolves.toEqual(skipped);
    const row = await sessionRow(sessionId);
    expect(row).toMatchObject({ status: "ended", feedback_status: "skipped", feedback: null, operation_token: null });
    expect(row.ended_at).not.toBeNull();
    await expect(beginEnd(user.id, sessionId)).resolves.toEqual(skipped);
    expect(await activityOf(user.id)).toEqual({ days: [], last_study_date: null, streak: 0 });
  });

  it("예약 → 완료: ready 피드백을 저장하고, 다시 부르면 같은 결과를 돌려준다", async () => {
    const user = await createReadyUser();
    const sessionId = await newSession(user.id);
    const t1 = valueOf(await beginChatTurn(user.id, sessionId, "Can I have latte?"));
    valueOf(await finishChatTurn(user.id, sessionId, t1.token, REPLY));

    // 턴 처리 중 종료는 CONFLICT
    const t2 = valueOf(await beginChatTurn(user.id, sessionId, "Thanks"));
    await expect(beginEnd(user.id, sessionId)).resolves.toEqual(CONFLICT);
    valueOf(await finishChatTurn(user.id, sessionId, t2.token, PLAIN_REPLY));

    const begun = reserved(await beginEnd(user.id, sessionId));
    expect(begun).toEqual({
      state: "reserved",
      token: expect.any(String),
      session: SESSION,
      turns: [
        { userText: "Can I have latte?", reply: REPLY.reply, correction: REPLY.correction },
        { userText: "Thanks", reply: PLAIN_REPLY.reply, correction: null },
      ],
    });
    const endingRow = await sessionRow(sessionId);
    expect(endingRow).toMatchObject({ status: "ending", feedback_status: "pending", operation_token: begun.token });
    expectExpiresInOperationWindow(endingRow.operation_expires_at);

    // 처리 중에는 다시 예약하지 않고, 메시지도 받지 않는다
    await expect(beginEnd(user.id, sessionId)).resolves.toEqual({ ok: true, value: { state: "ending" } });
    await expect(beginChatTurn(user.id, sessionId, "more")).resolves.toEqual(CONFLICT);

    const ready = { feedbackStatus: "ready", feedback: FEEDBACK };
    await expect(finishEnd(user.id, sessionId, begun.token, FEEDBACK)).resolves.toEqual({ ok: true, value: ready });
    const endedRow = await sessionRow(sessionId);
    expect(endedRow).toMatchObject({
      status: "ended",
      feedback_status: "ready",
      feedback: FEEDBACK,
      operation_token: null,
      operation_expires_at: null,
    });
    expect(endedRow.ended_at).not.toBeNull();

    await expect(beginEnd(user.id, sessionId)).resolves.toEqual({ ok: true, value: { state: "ended", result: ready } });
    await expect(finishEnd(user.id, sessionId, begun.token, FEEDBACK)).resolves.toEqual(CONFLICT);
    await expect(beginChatTurn(user.id, sessionId, "more")).resolves.toEqual(CONFLICT);
  });

  it("피드백 생성 실패는 대체 피드백으로 끝내고 chat_failed를 1개만 남긴다", async () => {
    const user = await createReadyUser();
    const sessionId = await newSession(user.id);
    await doneTurn(user.id, sessionId);
    const begun = reserved(await beginEnd(user.id, sessionId));
    const fallback = { feedbackStatus: "fallback", feedback: FALLBACK };

    await expect(failEnd(user.id, sessionId, begun.token, "invalid_output")).resolves.toEqual({
      ok: true,
      value: fallback,
    });
    expect(await sessionRow(sessionId)).toMatchObject({
      status: "ended",
      feedback_status: "fallback",
      feedback: FALLBACK,
      operation_token: null,
    });
    expect(await eventsOf(user.id, "chat_failed")).toEqual([
      { operation_token: begun.token, kind: "feedback", reason: "invalid_output" },
    ]);

    await expect(beginEnd(user.id, sessionId)).resolves.toEqual({
      ok: true,
      value: { state: "ended", result: fallback },
    });
    await expect(failEnd(user.id, sessionId, begun.token, "invalid_output")).resolves.toEqual(CONFLICT);
    expect(await eventsOf(user.id, "chat_failed")).toHaveLength(1);
  });

  it("오늘 실패가 10회면 AI 없이 대체 피드백으로 끝내고 chat_failed를 늘리지 않는다", async () => {
    const user = await createReadyUser();
    const sessionId = await newSession(user.id);
    await doneTurn(user.id, sessionId);
    await insertFailures(user.id, DAILY_AI_FAILURE_LIMIT);

    await expect(beginEnd(user.id, sessionId)).resolves.toEqual({
      ok: true,
      value: { state: "ended", result: { feedbackStatus: "fallback", feedback: FALLBACK } },
    });
    expect(await sessionRow(sessionId)).toMatchObject({
      status: "ended",
      feedback_status: "fallback",
      feedback: FALLBACK,
    });
    expect(await eventsOf(user.id, "chat_failed")).toHaveLength(DAILY_AI_FAILURE_LIMIT);
  });
});

describe("만료 작업 복구", () => {
  it("만료된 pending은 다음 요청에서 지우고, 늦게 온 확정·실패는 CONFLICT이며 새 작업을 바꾸지 않는다", async () => {
    const user = await createReadyUser();
    const sessionId = await newSession(user.id);
    const old = valueOf(await beginChatTurn(user.id, sessionId, "hi"));
    await expire(sessionId);

    const next = valueOf(await beginChatTurn(user.id, sessionId, "hi again"));
    expect(next.turnNo).toBe(old.turnNo);
    expect(await turnsOf(sessionId)).toMatchObject([{ id: next.token, status: "pending", user_text: "hi again" }]);
    expect(await eventsOf(user.id, "chat_failed")).toEqual([
      { operation_token: old.token, kind: "turn", reason: "expired" },
    ]);

    await expect(finishChatTurn(user.id, sessionId, old.token, REPLY)).resolves.toEqual(CONFLICT);
    await expect(failChatTurn(user.id, sessionId, old.token, "timeout")).resolves.toEqual(CONFLICT);
    expect(await turnsOf(sessionId)).toMatchObject([{ id: next.token, status: "pending", reply: null }]);
    expect((await sessionRow(sessionId)).operation_token).toBe(next.token);
    expect(await eventsOf(user.id, "chat_failed")).toHaveLength(1);
  });

  it("만료된 작업의 확정 요청은 먼저 복구한 뒤 CONFLICT다", async () => {
    const user = await createReadyUser();
    const sessionId = await newSession(user.id);
    const old = valueOf(await beginChatTurn(user.id, sessionId, "hi"));
    await expire(sessionId);

    await expect(finishChatTurn(user.id, sessionId, old.token, REPLY)).resolves.toEqual(CONFLICT);
    expect(await turnsOf(sessionId)).toEqual([]);
    expect(await sessionRow(sessionId)).toMatchObject({ operation_token: null, operation_expires_at: null });
    expect(await eventsOf(user.id, "chat_failed")).toEqual([
      { operation_token: old.token, kind: "turn", reason: "expired" },
    ]);
  });

  it("세션 생성도 만료 작업을 복구한다", async () => {
    const user = await createReadyUser();
    const sessionId = await newSession(user.id);
    const old = valueOf(await beginChatTurn(user.id, sessionId, "hi"));
    await expire(sessionId);

    await newSession(user.id);
    expect(await turnsOf(sessionId)).toEqual([]);
    expect(await eventsOf(user.id, "chat_failed")).toEqual([
      { operation_token: old.token, kind: "turn", reason: "expired" },
    ]);
  });

  it("만료된 ending은 대체 피드백으로 끝내고, 늦게 온 완료·실패는 결과를 바꾸지 않는다", async () => {
    const user = await createReadyUser();
    const sessionId = await newSession(user.id);
    await doneTurn(user.id, sessionId);
    const begun = reserved(await beginEnd(user.id, sessionId));
    await expire(sessionId);
    const fallback = { feedbackStatus: "fallback", feedback: FALLBACK };

    await expect(beginEnd(user.id, sessionId)).resolves.toEqual({
      ok: true,
      value: { state: "ended", result: fallback },
    });
    expect(await eventsOf(user.id, "chat_failed")).toEqual([
      { operation_token: begun.token, kind: "feedback", reason: "expired" },
    ]);

    await expect(finishEnd(user.id, sessionId, begun.token, FEEDBACK)).resolves.toEqual(CONFLICT);
    await expect(failEnd(user.id, sessionId, begun.token, "timeout")).resolves.toEqual(CONFLICT);
    expect(await sessionRow(sessionId)).toMatchObject({
      status: "ended",
      feedback_status: "fallback",
      feedback: FALLBACK,
      operation_token: null,
    });
    expect(await eventsOf(user.id, "chat_failed")).toHaveLength(1);
  });

  it("만료된 작업의 실패 확정과 다른 세션의 복구가 동시에 와도 pending 삭제와 chat_failed는 한 번이다", async () => {
    const user = await createReadyUser();
    const a = await newSession(user.id);
    const b = await newSession(user.id);
    const old = valueOf(await beginChatTurn(user.id, a, "hi"));
    await expire(a);

    const [failed, other] = await Promise.all([
      failChatTurn(user.id, a, old.token, "timeout"),
      beginChatTurn(user.id, b, "hi"),
    ]);
    expect(failed).toEqual(CONFLICT);
    expect(other.ok).toBe(true);
    expect(await turnsOf(a)).toEqual([]);
    expect(await eventsOf(user.id, "chat_failed")).toEqual([
      { operation_token: old.token, kind: "turn", reason: "expired" },
    ]);
  });
});

describe("남의 세션", () => {
  async function snapshotOf(userId: string) {
    const admin = getAdminSupabase();
    return {
      sessions: must(await admin.from("chat_sessions").select("*").eq("user_id", userId).order("id")),
      turns: must(await admin.from("chat_turns").select("*").eq("user_id", userId).order("id")),
      events: must(await admin.from("events").select("*").eq("user_id", userId).order("id")),
      profile: must(await admin.from("profiles").select("*").eq("id", userId).single()),
    };
  }

  it("service_role로 불러도 모든 세션 RPC가 NOT_FOUND이고 아무것도 바꾸지 않는다", async () => {
    const me = await createReadyUser();
    const owner = await createReadyUser();
    const turnSession = await newSession(owner.id);
    const turn = valueOf(await beginChatTurn(owner.id, turnSession, "hi"));
    const endSession = await newSession(owner.id);
    await doneTurn(owner.id, endSession);
    const end = reserved(await beginEnd(owner.id, endSession));
    const before = { owner: await snapshotOf(owner.id), me: await snapshotOf(me.id) };

    await expect(beginChatTurn(me.id, turnSession, "hi")).resolves.toEqual(NOT_FOUND);
    await expect(finishChatTurn(me.id, turnSession, turn.token, REPLY)).resolves.toEqual(NOT_FOUND);
    await expect(failChatTurn(me.id, turnSession, turn.token, "timeout")).resolves.toEqual(NOT_FOUND);
    await expect(beginEnd(me.id, turnSession)).resolves.toEqual(NOT_FOUND);
    await expect(beginEnd(me.id, endSession)).resolves.toEqual(NOT_FOUND);
    await expect(finishEnd(me.id, endSession, end.token, FEEDBACK)).resolves.toEqual(NOT_FOUND);
    await expect(failEnd(me.id, endSession, end.token, "timeout")).resolves.toEqual(NOT_FOUND);
    await expect(beginChatTurn(me.id, randomUUID(), "hi")).resolves.toEqual(NOT_FOUND);

    expect({ owner: await snapshotOf(owner.id), me: await snapshotOf(me.id) }).toEqual(before);
  });
});

describe("배운 단어", () => {
  const SECOND = 1000;
  const DAY = 24 * 60 * 60 * SECOND;
  const shift = (at: Date, ms: number) => new Date(at.getTime() + ms);

  // 한국 날짜 경계는 DB 시각(kst_today_start)으로 정한다
  async function dbTodayStart(): Promise<Date> {
    return new Date(must(await getAdminSupabase().rpc("kst_today_start")));
  }

  // 이 사용자가 그 시각에 처음 본 단어로 넣는다
  async function learnWords(userId: string, words: [WordRow, Date][]): Promise<void> {
    const rows = words.map(([word, at]) => ({
      user_id: userId,
      word_id: word.id,
      status: "known",
      first_seen_at: at.toISOString(),
      updated_at: at.toISOString(),
    }));
    must(await getAdminSupabase().from("user_words").insert(rows));
  }

  function candidate(word: WordRow, usedToday = false): WordCandidate {
    return { id: word.id, word: word.word, reading: word.reading, meaningKo: word.meaning_ko, usedToday };
  }

  function target(word: WordRow, used = false): TargetWord {
    return { id: word.id, word: word.word, reading: word.reading, meaningKo: word.meaning_ko, used };
  }

  function wordsOf(value: { candidates: unknown; candidateSource: unknown; targets: unknown }) {
    return { candidates: value.candidates, candidateSource: value.candidateSource, targets: value.targets };
  }

  // 예약 → 확정 (배운 단어 인자와 함께)
  async function wordTurn(userId: string, sessionId: string, words?: Parameters<typeof finishChatTurn>[4]) {
    const { token } = valueOf(await beginChatTurn(userId, sessionId, "hi"));
    return valueOf(await finishChatTurn(userId, sessionId, token, PLAIN_REPLY, words));
  }

  describe("예약 RPC의 후보", () => {
    it("첫 턴에만 세션 언어로 오늘 배운 이 사용자의 단어를 최근 것부터 준다 (레벨·상태 무관, 출처 today)", async () => {
      const start = await dbTodayStart();
      const user = await createReadyUser();
      const other = await createReadyUser();
      await learnWords(user.id, [
        [EN[0], shift(start, SECOND)],
        [EN[1], shift(start, 3 * SECOND)],
        [EN[2], shift(start, 3 * SECOND)], // 같은 시각이면 id 순
        [EN2, shift(start, 2 * SECOND)], // 다른 레벨
        [JA, shift(start, 4 * SECOND)], // 다른 언어
        [EN[3], shift(start, -SECOND)], // 어제
      ]);
      must(await getAdminSupabase().from("user_words").update({ status: "review" }).eq("user_id", user.id).eq("word_id", EN2.id));
      await learnWords(other.id, [[EN[4], shift(start, 5 * SECOND)]]);
      const sessionId = await newSession(user.id);

      const first = valueOf(await beginChatTurn(user.id, sessionId, "hi"));
      expect(wordsOf(first)).toEqual({
        candidates: [candidate(EN[1]), candidate(EN[2]), candidate(EN2), candidate(EN[0])],
        candidateSource: "today",
        targets: null,
      });

      // 목표 단어 없이 첫 턴이 끝난 세션: 두 번째 턴부터는 후보가 없다
      valueOf(await finishChatTurn(user.id, sessionId, first.token, PLAIN_REPLY));
      expect(wordsOf(valueOf(await beginChatTurn(user.id, sessionId, "hi")))).toEqual({
        candidates: null,
        candidateSource: null,
        targets: null,
      });
    });

    it("오늘 배운 단어가 없으면 한국 날짜로 6일 전까지의 단어를 준다 (7일 전은 빼고, 출처 recent)", async () => {
      const start = await dbTodayStart();
      const user = await createReadyUser();
      await learnWords(user.id, [
        [EN[0], shift(start, -SECOND)], // 어제 마지막
        [EN[1], shift(start, -6 * DAY)], // 6일 전 0시
        [EN[2], shift(start, -6 * DAY - SECOND)], // 7일 전 마지막
        [JA, shift(start, SECOND)], // 오늘이지만 다른 언어
      ]);

      const first = valueOf(await beginChatTurn(user.id, await newSession(user.id), "hi"));
      expect(wordsOf(first)).toEqual({
        candidates: [candidate(EN[0]), candidate(EN[1])],
        candidateSource: "recent",
        targets: null,
      });
    });

    it("7일 안에 배운 세션 언어 단어가 없으면 빈 후보이고 출처는 null이다", async () => {
      const start = await dbTodayStart();
      const user = await createReadyUser();
      await learnWords(user.id, [
        [EN[0], shift(start, -6 * DAY - SECOND)],
        [JA, shift(start, SECOND)],
      ]);

      const first = valueOf(await beginChatTurn(user.id, await newSession(user.id), "hi"));
      expect(wordsOf(first)).toEqual({ candidates: [], candidateSource: null, targets: null });
    });

    it("오늘 대화에서 쓴 단어(다른 세션 포함)는 뒤로 가고 usedToday가 참이다 (어제 쓴 것은 세지 않는다)", async () => {
      const start = await dbTodayStart();
      const user = await createReadyUser();
      await learnWords(user.id, [
        [EN[0], shift(start, SECOND)],
        [EN[1], shift(start, 2 * SECOND)],
        [EN[2], shift(start, 3 * SECOND)],
      ]);
      // 다른 세션에서 오늘 EN[2]를 썼다
      await wordTurn(user.id, await newSession(user.id), {
        targetWordIds: [EN[2].id, EN[1].id],
        targetSource: "today",
        usedWordIds: [EN[2].id],
      });
      // 어제 EN[1]을 쓴 턴
      const [yesterdaySession] = await insertDoneTurns(user.id, 1, shift(start, -SECOND).toISOString());
      must(
        await getAdminSupabase()
          .from("chat_turns")
          .update({ used_word_ids: [EN[1].id] })
          .eq("session_id", yesterdaySession),
      );

      const first = valueOf(await beginChatTurn(user.id, await newSession(user.id), "hi"));
      expect(wordsOf(first)).toEqual({
        candidates: [candidate(EN[1]), candidate(EN[0]), candidate(EN[2], true)],
        candidateSource: "today",
        targets: null,
      });
    });

    it("후보는 앞에서 20개까지다", async () => {
      const start = await dbTodayStart();
      const user = await createReadyUser();
      await learnWords(
        user.id,
        EN.map((word, i): [WordRow, Date] => [word, shift(start, (i + 1) * SECOND)]),
      );

      const first = valueOf(await beginChatTurn(user.id, await newSession(user.id), "hi"));
      expect(first.candidates).toEqual(
        [...EN]
          .reverse()
          .slice(0, 20)
          .map((word) => candidate(word)),
      );
    });

    it("목표 단어가 있는 세션은 후보 대신 목표 단어를 고른 순서와 이 세션에서 쓴 여부로 준다", async () => {
      const start = await dbTodayStart();
      const user = await createReadyUser();
      await learnWords(user.id, [
        [EN[0], shift(start, SECOND)],
        [EN[1], shift(start, 2 * SECOND)],
        [EN[2], shift(start, 3 * SECOND)],
      ]);
      const sessionId = await newSession(user.id);
      await wordTurn(user.id, sessionId, {
        targetWordIds: [EN[2].id, EN[0].id],
        targetSource: "today",
        usedWordIds: [EN[0].id],
      });
      // 다른 세션에서 쓴 것은 이 세션의 used가 아니다
      await wordTurn(user.id, await newSession(user.id), {
        targetWordIds: [EN[2].id],
        targetSource: "today",
        usedWordIds: [EN[2].id],
      });

      const second = valueOf(await beginChatTurn(user.id, sessionId, "hi"));
      expect(wordsOf(second)).toEqual({
        candidates: null,
        candidateSource: null,
        targets: [target(EN[2]), target(EN[0], true)],
      });
    });

    it("턴이 없어도 목표 단어가 있는 세션이면 첫 턴에 후보를 주지 않는다", async () => {
      const start = await dbTodayStart();
      const user = await createReadyUser();
      await learnWords(user.id, [[EN[0], shift(start, SECOND)]]);
      const sessionId = await newSession(user.id);
      must(
        await getAdminSupabase()
          .from("chat_sessions")
          .update({ target_word_ids: [EN[0].id], target_source: "recent" })
          .eq("id", sessionId),
      );

      const first = valueOf(await beginChatTurn(user.id, sessionId, "hi"));
      expect(wordsOf(first)).toEqual({ candidates: null, candidateSource: null, targets: [target(EN[0])] });
    });

    it("첫 턴이 실패하거나 기한이 지나면 다음 첫 턴 예약에서 후보를 다시 준다", async () => {
      const start = await dbTodayStart();
      const user = await createReadyUser();
      await learnWords(user.id, [[EN[0], shift(start, SECOND)]]);
      const sessionId = await newSession(user.id);
      const expected = { candidates: [candidate(EN[0])], candidateSource: "today", targets: null };

      const failed = valueOf(await beginChatTurn(user.id, sessionId, "hi"));
      expect(wordsOf(failed)).toEqual(expected);
      valueOf(await failChatTurn(user.id, sessionId, failed.token, "timeout"));

      const expired = valueOf(await beginChatTurn(user.id, sessionId, "hi"));
      expect(wordsOf(expired)).toEqual(expected);
      await expire(sessionId);

      const again = valueOf(await beginChatTurn(user.id, sessionId, "hi"));
      expect(again.turnNo).toBe(1);
      expect(wordsOf(again)).toEqual(expected);
    });
  });

  describe("확정 RPC의 목표 단어와 쓴 단어", () => {
    it("첫 턴에 받은 순서대로 목표 단어를 저장하고, 그 뒤에는 바꾸지 않으며, 쓴 단어는 목표 단어 안의 것만 저장한다", async () => {
      const start = await dbTodayStart();
      const user = await createReadyUser();
      await learnWords(
        user.id,
        EN.slice(0, 4).map((word, i): [WordRow, Date] => [word, shift(start, (i + 1) * SECOND)]),
      );
      const sessionId = await newSession(user.id);
      const targetIds = [EN[2].id, EN[0].id, EN[1].id];

      const first = await wordTurn(user.id, sessionId, {
        targetWordIds: [EN[2].id, EN[0].id, EN[2].id, EN[1].id],
        targetSource: "today",
        usedWordIds: [EN[0].id, EN[3].id, EN[0].id],
      });
      expect(first).toEqual({
        turnsLeft: SESSION_MAX_TURNS - 1,
        targetWords: [target(EN[2]), target(EN[0], true), target(EN[1])],
        targetSource: "today",
      });
      expect(await sessionRow(sessionId)).toMatchObject({ target_word_ids: targetIds, target_source: "today" });

      // 그 뒤 턴: 새 목표 단어를 줘도 바꾸지 않고, 쓴 여부는 이번 턴까지 합친다
      const second = await wordTurn(user.id, sessionId, {
        targetWordIds: [EN[3].id],
        targetSource: "recent",
        usedWordIds: [EN[3].id, EN[1].id],
      });
      expect(second).toEqual({
        turnsLeft: SESSION_MAX_TURNS - 2,
        targetWords: [target(EN[2]), target(EN[0], true), target(EN[1], true)],
        targetSource: "today",
      });
      // 쓴 단어가 없는 턴은 빈 배열이다
      const third = await wordTurn(user.id, sessionId);
      expect(third.targetWords).toEqual(second.targetWords);

      expect(await sessionRow(sessionId)).toMatchObject({ target_word_ids: targetIds, target_source: "today" });
      expect((await turnsOf(sessionId)).map((turn) => turn.used_word_ids)).toEqual([[EN[0].id], [EN[1].id], []]);
    });

    it("이 사용자의 user_words에 없거나 세션 언어가 아닌 단어는 버리고 앞에서 5개까지 저장한다", async () => {
      const start = await dbTodayStart();
      const user = await createReadyUser();
      const other = await createReadyUser();
      await learnWords(user.id, [
        ...EN.slice(0, 6).map((word, i): [WordRow, Date] => [word, shift(start, (i + 1) * SECOND)]),
        [JA, shift(start, SECOND)],
      ]);
      await learnWords(other.id, [[EN[6], shift(start, SECOND)]]);
      const sessionId = await newSession(user.id);

      const first = await wordTurn(user.id, sessionId, {
        targetWordIds: [JA.id, EN[6].id, EN[0].id, "en-1-missing", ...EN.slice(1, 6).map((word) => word.id)],
        targetSource: "today",
      });
      expect(first.targetWords).toEqual(EN.slice(0, 5).map((word) => target(word)));
      expect((await sessionRow(sessionId)).target_word_ids).toEqual(EN.slice(0, 5).map((word) => word.id));
      expect((await turnsOf(sessionId))[0].used_word_ids).toEqual([]);
    });

    it("남는 단어가 없거나 출처가 없으면 목표 단어를 저장하지 않고, 그 세션은 뒤 턴에도 저장하지 않는다", async () => {
      const start = await dbTodayStart();
      const user = await createReadyUser();
      const other = await createReadyUser();
      await learnWords(user.id, [
        [EN[0], shift(start, SECOND)],
        [JA, shift(start, SECOND)],
      ]);
      await learnWords(other.id, [[EN[1], shift(start, SECOND)]]);
      const none = { turnsLeft: SESSION_MAX_TURNS - 1, targetWords: null, targetSource: null };

      const filtered = await newSession(user.id);
      await expect(
        wordTurn(user.id, filtered, { targetWordIds: [JA.id, EN[1].id], targetSource: "today", usedWordIds: [JA.id] }),
      ).resolves.toEqual(none);
      const noSource = await newSession(user.id);
      await expect(wordTurn(user.id, noSource, { targetWordIds: [EN[0].id], usedWordIds: [EN[0].id] })).resolves.toEqual(
        none,
      );
      const empty = await newSession(user.id);
      await expect(wordTurn(user.id, empty, { targetWordIds: [], targetSource: "today" })).resolves.toEqual(none);
      await expect(
        wordTurn(user.id, empty, { targetWordIds: [EN[0].id], targetSource: "today", usedWordIds: [EN[0].id] }),
      ).resolves.toEqual({ ...none, turnsLeft: SESSION_MAX_TURNS - 2 });

      for (const sessionId of [filtered, noSource, empty]) {
        expect(await sessionRow(sessionId)).toMatchObject({ target_word_ids: null, target_source: null });
        expect((await turnsOf(sessionId)).every((turn) => turn.used_word_ids === null)).toBe(true);
      }
    });

    // 지금 운영 코드는 새 인자 없이 부른다. 마이그레이션을 먼저 적용해도 깨지지 않아야 한다
    it("새 인자를 빼고 부르면 기존처럼 확정하고 목표 단어는 없다", async () => {
      const start = await dbTodayStart();
      const user = await createReadyUser();
      await learnWords(user.id, [[EN[0], shift(start, SECOND)]]);
      const sessionId = await newSession(user.id);
      const { token } = valueOf(await beginChatTurn(user.id, sessionId, "hi"));

      const result = await callRpc("finish_chat_turn", {
        p_user_id: user.id,
        p_session_id: sessionId,
        p_token: token,
        p_reply: PLAIN_REPLY.reply,
        p_reply_ko: PLAIN_REPLY.reply_ko,
        p_correction: null,
      });
      expect(result).toEqual({
        ok: true,
        value: { turns_left: SESSION_MAX_TURNS - 1, target_words: null, target_source: null },
      });
      expect(await sessionRow(sessionId)).toMatchObject({ target_word_ids: null, target_source: null });
      expect(await turnsOf(sessionId)).toMatchObject([{ status: "done", used_word_ids: null }]);
    });
  });
});
