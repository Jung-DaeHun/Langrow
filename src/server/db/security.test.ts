import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { addDays, kstDate } from "@/lib/usage";
import { getAdminSupabase } from "@/services/supabase/admin";
import {
  anonClient,
  createReadyUser,
  createTestUser,
  deleteTestUser,
  deleteTestUsers,
  signedInClient,
} from "@/test/db";
import { agreeTerms, setFirstLevel, switchLanguage } from "./account";
import { beginChatTurn, beginEnd, createChatSession, finishChatTurn } from "./chat";
import type { DbResult } from "./types";

// 구현 파일이 없는 보안·스키마·SQL helper 테스트 (spec/testing.md, spec/backend.md 보안 체크리스트 5·11·13)

const USER_TABLES = [
  "profiles",
  "user_levels",
  "chat_sessions",
  "chat_turns",
  "user_words",
  "events",
  "user_activity_days",
] as const;
const TABLES = [...USER_TABLES, "words"] as const;
type Table = (typeof TABLES)[number];

const PERMISSION_DENIED = "42501";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

// 테스트 단어는 rank 9000+를 쓴다
const WORD = {
  id: "en-1-9001",
  language: "en",
  level: 1,
  rank: 9001,
  word: "apple",
  reading: null,
  meaning_ko: "사과",
  example: "I ate an {{apple}}.",
  example_ko: "나는 사과를 먹었다.",
  distractors: ["chair", "river", "music"],
};

function ownerColumn(table: Table): string {
  if (table === "profiles" || table === "words") return "id";
  return "user_id";
}

// 테이블·함수 이름을 반복문으로 넘기기 위해 타입 없는 클라이언트로 본다
function untyped(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

// RLS와 함수 안의 테이블 권한도 42501을 내므로, 어느 권한에서 막혔는지 메시지로 확인한다
function expectDenied(error: { code: string; message: string } | null, target: string, label: string) {
  expect(error?.code, label).toBe(PERMISSION_DENIED);
  expect(error?.message, label).toContain(`permission denied for ${target}`);
}

function must<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data as T;
}

// 권한 검사는 값보다 먼저 거부하므로 열 하나만 넣는다
function rowOf(column: string, value: string): Record<string, unknown> {
  return { [column]: value };
}

// 사용자 테이블마다 1행 이상 만든다 (profiles·user_levels는 createReadyUser가 만든다)
async function seedRows(userId: string): Promise<void> {
  const admin = getAdminSupabase();
  const session = must<{ id: string }>(
    await admin
      .from("chat_sessions")
      .insert({ user_id: userId, language: "en", level: 1, scenario_id: "l1-cafe" })
      .select("id")
      .single(),
  );
  must(await admin.from("chat_turns").insert({ session_id: session.id, user_id: userId, turn_no: 1, user_text: "hi" }));
  must(await admin.from("user_words").insert({ user_id: userId, word_id: WORD.id, status: "known" }));
  must(await admin.from("events").insert({ user_id: userId, name: "pro_clicked" }));
  must(await admin.from("user_activity_days").insert({ user_id: userId, activity_date: "2026-10-01" }));
}

// 사용자들의 모든 행. 순서와 무관하게 비교한다
async function snapshot(userIds: string[]): Promise<Record<string, string[]>> {
  const admin = untyped(getAdminSupabase());
  const result: Record<string, string[]> = {};
  for (const table of USER_TABLES) {
    const rows = must(await admin.from(table).select("*").in(ownerColumn(table), userIds)) as unknown[];
    result[table] = rows.map((row) => JSON.stringify(row)).sort();
  }
  return result;
}

async function countRows(userId: string): Promise<Record<string, number>> {
  const admin = untyped(getAdminSupabase());
  const result: Record<string, number> = {};
  for (const table of USER_TABLES) {
    const { count, error } = await admin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq(ownerColumn(table), userId);
    if (error) throw error;
    result[table] = count ?? -1;
  }
  return result;
}

beforeAll(async () => {
  must(await getAdminSupabase().from("words").upsert(WORD));
});

afterEach(deleteTestUsers);

afterAll(async () => {
  must(await getAdminSupabase().from("words").delete().eq("id", WORD.id));
});

describe("테이블 권한과 RLS", () => {
  it("anon은 모든 테이블을 읽거나 쓰지 못한다", async () => {
    const client = untyped(anonClient());
    for (const table of TABLES) {
      const read = await client.from(table).select("*");
      expectDenied(read.error, `table ${table}`, `select ${table}`);
      const write = await client.from(table).insert(rowOf(ownerColumn(table), randomUUID()));
      expectDenied(write.error, `table ${table}`, `insert ${table}`);
    }
  });

  it("authenticated는 자기 행만 읽고 다른 사용자 행은 0건이다", async () => {
    const me = await createReadyUser();
    const other = await createReadyUser();
    await seedRows(me.id);
    await seedRows(other.id);
    const client = untyped(await signedInClient(me));

    for (const table of USER_TABLES) {
      const owner = ownerColumn(table);
      const mine = must(await client.from(table).select("*")) as Record<string, unknown>[];
      expect(mine.length, `${table} 자기 행`).toBeGreaterThan(0);
      expect(mine.every((row) => row[owner] === me.id), `${table} 자기 행만`).toBe(true);
      const others = must(await client.from(table).select("*").eq(owner, other.id)) as unknown[];
      expect(others, `${table} 다른 사용자 행`).toHaveLength(0);
    }
  });

  it("authenticated는 words를 읽을 수 있다", async () => {
    const me = await createReadyUser();
    const client = await signedInClient(me);
    const rows = must(await client.from("words").select("id").eq("id", WORD.id));
    expect(rows).toEqual([{ id: WORD.id }]);
  });

  it("authenticated는 모든 테이블에 INSERT·UPDATE·DELETE를 하지 못한다", async () => {
    const me = await createReadyUser();
    await seedRows(me.id);
    const before = await snapshot([me.id]);
    const client = untyped(await signedInClient(me));

    for (const table of TABLES) {
      const owner = ownerColumn(table);
      const id = table === "words" ? WORD.id : me.id;
      const insert = await client.from(table).insert(rowOf(owner, id));
      expectDenied(insert.error, `table ${table}`, `insert ${table}`);
      const update = await client.from(table).update(rowOf(owner, id)).eq(owner, id);
      expectDenied(update.error, `table ${table}`, `update ${table}`);
      const remove = await client.from(table).delete().eq(owner, id);
      expectDenied(remove.error, `table ${table}`, `delete ${table}`);
    }

    expect(await snapshot([me.id])).toEqual(before);
    const words = must(await getAdminSupabase().from("words").select("id").eq("id", WORD.id));
    expect(words).toHaveLength(1);
  });
});

describe("함수 실행 권한", () => {
  it("anon·authenticated는 이 step의 함수를 부르지 못하고 상태도 바뀌지 않는다", async () => {
    const fresh = await createTestUser(); // profiles 없음
    const consented = await createTestUser();
    await agreeTerms(consented.id); // 레벨 없음
    const ready = await createReadyUser("en", 3);
    await setFirstLevel(ready.id, "ja", 1);
    await switchLanguage(ready.id, "en");

    // service_role이면 모두 상태를 바꾸는 호출이다
    const calls: [string, Record<string, unknown>][] = [
      ["kst_today", {}],
      ["check_readiness", { p_user_id: ready.id, p_requirement: "ready" }],
      ["record_activity", { p_user_id: ready.id }],
      ["ensure_profile", { p_user_id: fresh.id }],
      ["agree_terms", { p_user_id: fresh.id }],
      ["set_first_level", { p_user_id: consented.id, p_language: "en", p_level: 1 }],
      ["switch_language", { p_user_id: ready.id, p_language: "ja" }],
      ["lower_level", { p_user_id: ready.id, p_language: "en", p_level: 1 }],
      ["start_trial", { p_user_id: ready.id }],
    ];
    const ids = [fresh.id, consented.id, ready.id];
    const before = await snapshot(ids);
    const clients: [string, SupabaseClient][] = [
      ["anon", untyped(anonClient())],
      ["authenticated", untyped(await signedInClient(ready))],
    ];

    for (const [role, client] of clients) {
      for (const [fn, args] of calls) {
        const { error } = await client.rpc(fn, args);
        expectDenied(error, `function ${fn}`, `${role} ${fn}`);
      }
    }
    expect(await snapshot(ids)).toEqual(before);
  });

  it("anon·authenticated는 대화 함수와 helper를 부르지 못하고 상태도 바뀌지 않는다", async () => {
    const valueOf = <T>(result: DbResult<T>): T => {
      if (!result.ok) throw new Error(result.code);
      return result.value;
    };
    const user = await createReadyUser("en", 1);
    const newSession = async () =>
      valueOf(await createChatSession(user.id, { language: "en", level: 1, scenarioId: "l1-cafe" })).sessionId;

    const idle = await newSession(); // 예약 없음
    const turning = await newSession(); // 턴 예약 중
    const turn = valueOf(await beginChatTurn(user.id, turning, "hi"));
    const ending = await newSession(); // 종료 예약 중
    const done = valueOf(await beginChatTurn(user.id, ending, "hi"));
    valueOf(await finishChatTurn(user.id, ending, done.token, { reply: "hello", reply_ko: "안녕하세요", correction: null }));
    const end = valueOf(await beginEnd(user.id, ending));
    if (end.state !== "reserved") throw new Error(end.state);
    const expired = await newSession(); // 기한이 지난 턴 예약
    await beginChatTurn(user.id, expired, "hi");
    must(
      await getAdminSupabase()
        .from("chat_sessions")
        .update({ operation_expires_at: new Date(Date.now() - 60 * 60_000).toISOString() })
        .eq("id", expired),
    );

    const calls: [string, Record<string, unknown>][] = [
      ["kst_today_start", {}],
      ["current_plan", { p_user_id: user.id }],
      ["chat_turn_limit", { p_user_id: user.id }],
      ["chat_failure_limit_reached", { p_user_id: user.id }],
      ["record_limit_reached", { p_user_id: user.id, p_feature: "chat" }],
      [
        "record_chat_failed",
        { p_user_id: user.id, p_operation_token: turn.token, p_kind: "turn", p_reason: "timeout" },
      ],
      ["end_chat_with_fallback", { p_user_id: user.id, p_session_id: idle }],
      ["recover_expired_operations", { p_user_id: user.id }],
      ["create_chat_session", { p_user_id: user.id, p_language: "en", p_level: 1, p_scenario_id: "l1-cafe" }],
      ["begin_chat_turn", { p_user_id: user.id, p_session_id: idle, p_user_text: "hi" }],
      [
        "finish_chat_turn",
        {
          p_user_id: user.id,
          p_session_id: turning,
          p_token: turn.token,
          p_reply: "hello",
          p_reply_ko: "안녕하세요",
          p_correction: null,
        },
      ],
      ["fail_chat_turn", { p_user_id: user.id, p_session_id: turning, p_token: turn.token, p_reason: "timeout" }],
      ["begin_end", { p_user_id: user.id, p_session_id: idle }],
      [
        "finish_end",
        { p_user_id: user.id, p_session_id: ending, p_token: end.token, p_feedback: { good: "", improve: [] } },
      ],
      ["fail_end", { p_user_id: user.id, p_session_id: ending, p_token: end.token, p_reason: "timeout" }],
    ];
    const before = await snapshot([user.id]);
    const clients: [string, SupabaseClient][] = [
      ["anon", untyped(anonClient())],
      ["authenticated", untyped(await signedInClient(user))],
    ];

    for (const [role, client] of clients) {
      for (const [fn, args] of calls) {
        const { error } = await client.rpc(fn, args);
        expectDenied(error, `function ${fn}`, `${role} ${fn}`);
      }
    }
    expect(await snapshot([user.id])).toEqual(before);
  });

  it("anon·authenticated는 학습 함수와 helper를 부르지 못하고 상태도 바뀌지 않는다", async () => {
    const user = await createReadyUser("en", 1); // 학습 기록 없음
    const reviewer = await createReadyUser("en", 1); // 복습할 단어가 있음
    must(await getAdminSupabase().from("user_words").insert({ user_id: reviewer.id, word_id: WORD.id, status: "review" }));

    // service_role이면 모두 상태를 바꾸는 호출이다
    const calls: [string, Record<string, unknown>][] = [
      ["new_word_limit", { p_user_id: user.id }],
      ["save_word_batch", { p_user_id: user.id, p_language: "en", p_items: [{ word_id: WORD.id, status: "known" }] }],
      ["save_review", { p_user_id: reviewer.id, p_language: "en", p_items: [{ word_id: WORD.id, knew: true }] }],
      [
        "submit_level_test",
        { p_user_id: user.id, p_language: "en", p_from_level: 1, p_score: 20, p_passed: true },
      ],
      ["record_event", { p_user_id: user.id, p_name: "kana_studied" }],
    ];
    const ids = [user.id, reviewer.id];
    const before = await snapshot(ids);
    const clients: [string, SupabaseClient][] = [
      ["anon", untyped(anonClient())],
      ["authenticated", untyped(await signedInClient(user))],
    ];

    for (const [role, client] of clients) {
      for (const [fn, args] of calls) {
        const { error } = await client.rpc(fn, args);
        expectDenied(error, `function ${fn}`, `${role} ${fn}`);
      }
    }
    expect(await snapshot(ids)).toEqual(before);
  });
});

describe("계정 삭제", () => {
  it("auth 사용자를 지우면 모든 테이블에서 그 사용자의 행이 사라진다", async () => {
    const user = await createReadyUser();
    await seedRows(user.id);
    const before = await countRows(user.id);
    for (const table of USER_TABLES) expect(before[table], table).toBeGreaterThan(0);

    await deleteTestUser(user.id);

    const after = await countRows(user.id);
    for (const table of USER_TABLES) expect(after[table], table).toBe(0);
  });
});

describe("스키마 제약 (admin 직접 insert)", () => {
  async function newSession(userId: string, values: Record<string, unknown> = {}) {
    return untyped(getAdminSupabase())
      .from("chat_sessions")
      .insert({ user_id: userId, language: "en", level: 1, scenario_id: "l1-cafe", ...values })
      .select("id")
      .single();
  }

  it("같은 세션에 pending 턴을 2개 만들 수 없다", async () => {
    const user = await createReadyUser();
    const session = must(await newSession(user.id)) as { id: string };
    const admin = getAdminSupabase();
    const turn = { session_id: session.id, user_id: user.id, user_text: "hi", status: "pending" };
    must(await admin.from("chat_turns").insert({ ...turn, turn_no: 1 }));
    const second = await admin.from("chat_turns").insert({ ...turn, turn_no: 2 });
    expect(second.error?.code).toBe(UNIQUE_VIOLATION);
    expect(second.error?.message).toContain("chat_turns_one_pending");
  });

  it("작업 토큰만 있고 기한이 없으면 실패한다", async () => {
    const user = await createReadyUser();
    const token = randomUUID();
    must(await newSession(user.id, { operation_token: token, operation_expires_at: new Date().toISOString() }));
    const { error } = await newSession(user.id, { operation_token: token });
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("ended인데 ended_at이 없으면 실패한다", async () => {
    const user = await createReadyUser();
    const ended = { status: "ended", feedback_status: "skipped" };
    must(await newSession(user.id, { ...ended, ended_at: new Date().toISOString() }));
    const { error } = await newSession(user.id, ended);
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("skipped인데 feedback이 있으면 실패한다", async () => {
    const user = await createReadyUser();
    const { error } = await newSession(user.id, {
      status: "ended",
      feedback_status: "skipped",
      ended_at: new Date().toISOString(),
      feedback: { good: [] },
    });
    expect(error?.code).toBe(CHECK_VIOLATION);
  });

  it("distractors가 3개가 아니면 실패한다", async () => {
    const { error } = await getAdminSupabase()
      .from("words")
      .insert({ ...WORD, id: "en-1-9002", rank: 9002, distractors: ["chair", "river"] });
    expect(error?.code).toBe(CHECK_VIOLATION);
  });
});

describe("helper (service_role 직접 호출)", () => {
  async function kstToday(): Promise<string> {
    return must(await getAdminSupabase().rpc("kst_today"));
  }

  async function recordActivity(userId: string): Promise<void> {
    must(await getAdminSupabase().rpc("record_activity", { p_user_id: userId }));
  }

  async function streakOf(userId: string) {
    return must(
      await getAdminSupabase().from("profiles").select("last_study_date, streak").eq("id", userId).single(),
    );
  }

  async function setStreak(userId: string, lastStudyDate: string, streak: number) {
    must(
      await getAdminSupabase()
        .from("profiles")
        .update({ last_study_date: lastStudyDate, streak })
        .eq("id", userId),
    );
  }

  async function activityDays(userId: string): Promise<string[]> {
    const rows = must(
      await getAdminSupabase().from("user_activity_days").select("activity_date").eq("user_id", userId),
    );
    return rows.map((row) => row.activity_date);
  }

  it("kst_today는 src/lib/usage의 한국 날짜와 같다", async () => {
    expect(await kstToday()).toBe(kstDate(new Date()));
  });

  it("record_activity: 처음 1, 같은 날 그대로, 어제였으면 +1, 그 전이면 1", async () => {
    const user = await createReadyUser();
    const today = await kstToday();

    await recordActivity(user.id);
    expect(await streakOf(user.id)).toEqual({ last_study_date: today, streak: 1 });

    await recordActivity(user.id);
    expect(await streakOf(user.id)).toEqual({ last_study_date: today, streak: 1 });

    await setStreak(user.id, addDays(today, -1), 5);
    await recordActivity(user.id);
    expect(await streakOf(user.id)).toEqual({ last_study_date: today, streak: 6 });

    await setStreak(user.id, addDays(today, -2), 5);
    await recordActivity(user.id);
    expect(await streakOf(user.id)).toEqual({ last_study_date: today, streak: 1 });

    expect(await activityDays(user.id)).toEqual([today]);
  });

  it("record_activity를 동시에 불러도 오늘 활동일 행은 1개이고 연속일은 1이다", async () => {
    const user = await createReadyUser();
    const today = await kstToday();
    await Promise.all(Array.from({ length: 5 }, () => recordActivity(user.id)));
    expect(await activityDays(user.id)).toEqual([today]);
    expect(await streakOf(user.id)).toEqual({ last_study_date: today, streak: 1 });
  });
});
