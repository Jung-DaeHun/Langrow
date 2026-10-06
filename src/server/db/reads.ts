import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Language, Level } from "@/lib/levels";
import type { ReadinessState } from "@/lib/readiness";
import type { StreakState } from "@/lib/streak";
import { addDays, kstDate, kstDayStart } from "@/lib/usage";
import type { TurnReply } from "@/services/claude/schemas";
import type { Database } from "@/types/database";
import type { EndResult } from "./chat";

// 페이지(Server Component) 읽기. 페이지는 쿠키 기반 server client를, test:db는 signedInClient를 넘긴다.
// RLS(자기 행 읽기)가 걸려 있어도 범위를 명시하려고 사용자 행 쿼리마다 user_id를 건다.
// now는 표시용이다. 한도·저장의 실제 판정은 RPC가 DB 시각으로 한다

type Sb = SupabaseClient<Database>;

export type AccountState = ReadinessState & {
  streak: StreakState;
  proUntil: Date | null;
  trialStartedAt: Date | null;
};
export type TodayUsage = { chatTurns: number; newWords: number };
export type Word = {
  id: string;
  language: Language;
  level: Level;
  rank: number;
  word: string;
  reading: string | null;
  meaningKo: string;
  example: string;
  exampleKo: string;
  distractors: string[];
};
export type OpenSession = {
  id: string;
  scenarioId: string;
  level: Level;
  status: "active" | "ending";
  doneTurns: number;
  lastReply: string | null;
  createdAt: Date;
};
export type ChatTurnView = {
  turnNo: number;
  userText: string;
  reply: string;
  replyKo: string;
  correction: TurnReply["correction"];
};
export type ChatRoomData = {
  id: string;
  language: Language;
  level: Level;
  scenarioId: string;
  status: "active" | "ending" | "ended";
  result: EndResult | null;
  turns: ChatTurnView[];
};

const WORD_COLUMNS = "id, language, level, rank, word, reading, meaning_ko, example, example_ko, distractors";
type WordRow = Database["public"]["Tables"]["words"]["Row"];

const SESSION_ID = z.uuid();

function readError(table: string, error: PostgrestError): Error {
  return new Error(`${table} 조회 실패: ${error.code} ${error.message}`);
}

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function toWord(row: WordRow): Word {
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

// [오늘 한국 0시, 내일 한국 0시)
function todayRange(now: Date): { from: string; to: string } {
  const today = kstDate(now);
  return { from: kstDayStart(today).toISOString(), to: kstDayStart(addDays(today, 1)).toISOString() };
}

// profiles 행이 없으면 빈 상태다. checkReadiness에 그대로 넘길 수 있다
export async function readAccount(sb: Sb, userId: string): Promise<AccountState> {
  const [profile, levels] = await Promise.all([
    sb
      .from("profiles")
      .select("agreed_at, current_language, last_study_date, streak, pro_until, trial_started_at")
      .eq("id", userId)
      .maybeSingle(),
    sb.from("user_levels").select("language, level").eq("user_id", userId),
  ]);
  if (profile.error) throw readError("profiles", profile.error);
  if (levels.error) throw readError("user_levels", levels.error);
  if (!profile.data) {
    return {
      agreedAt: null,
      currentLanguage: null,
      levels: {},
      streak: { lastStudyDate: null, streak: 0 },
      proUntil: null,
      trialStartedAt: null,
    };
  }

  const row = profile.data;
  return {
    agreedAt: toDate(row.agreed_at),
    currentLanguage: row.current_language as Language | null,
    levels: Object.fromEntries(levels.data.map((level) => [level.language, level.level])) as ReadinessState["levels"],
    streak: { lastStudyDate: row.last_study_date, streak: row.streak },
    proUntil: toDate(row.pro_until),
    trialStartedAt: toDate(row.trial_started_at),
  };
}

// 대화 턴은 pending 포함, 둘 다 언어 합산
export async function readTodayUsage(sb: Sb, userId: string, now: Date): Promise<TodayUsage> {
  const { from, to } = todayRange(now);
  const [turns, words] = await Promise.all([
    sb
      .from("chat_turns")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", from)
      .lt("created_at", to),
    sb
      .from("user_words")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("first_seen_at", from)
      .lt("first_seen_at", to),
  ]);
  if (turns.error) throw readError("chat_turns", turns.error);
  if (words.error) throw readError("user_words", words.error);
  return { chatTurns: turns.count ?? 0, newWords: words.count ?? 0 };
}

// 홈의 대화 목표(best / 3, isValidSession)용. 오늘 생성된 done 턴을 세션별로 센 최댓값
export async function readBestSessionTurnsToday(sb: Sb, userId: string, now: Date): Promise<number> {
  const { from, to } = todayRange(now);
  const { data, error } = await sb
    .from("chat_turns")
    .select("session_id")
    .eq("user_id", userId)
    .eq("status", "done")
    .gte("created_at", from)
    .lt("created_at", to);
  if (error) throw readError("chat_turns", error);

  const counts = new Map<string, number>();
  for (const row of data) counts.set(row.session_id, (counts.get(row.session_id) ?? 0) + 1);
  return Math.max(0, ...counts.values());
}

// 이 사용자의 user_words에 없는 단어(상태 무관). user_words=is.null은 PostgREST의 anti-join이다
export async function readUnseenWords(
  sb: Sb,
  userId: string,
  language: Language,
  level: Level,
  limit: number,
): Promise<{ total: number; words: Word[] }> {
  const { data, count, error } = await sb
    .from("words")
    .select(`${WORD_COLUMNS}, user_words(word_id)`, { count: "exact" })
    .eq("language", language)
    .eq("level", level)
    .eq("user_words.user_id", userId)
    .is("user_words", null)
    .order("rank")
    .limit(limit);
  if (error) throw readError("words", error);
  return { total: count ?? 0, words: data.map(toWord) };
}

// 레벨과 무관하게 그 언어의 review 단어
export async function readReviewWords(
  sb: Sb,
  userId: string,
  language: Language,
  limit: number,
): Promise<{ total: number; words: Word[] }> {
  const { data, count, error } = await sb
    .from("user_words")
    .select(`word_id, words!inner(${WORD_COLUMNS})`, { count: "exact" })
    .eq("user_id", userId)
    .eq("status", "review")
    .eq("words.language", language)
    .order("first_seen_at")
    .order("word_id")
    .limit(limit);
  if (error) throw readError("user_words", error);
  return { total: count ?? 0, words: data.map((row) => toWord(row.words)) };
}

// 레벨업 출제용. words는 공용 카탈로그라 user_id 조건이 없다
export async function readLevelWords(sb: Sb, language: Language, level: Level): Promise<Word[]> {
  const { data, error } = await sb
    .from("words")
    .select(WORD_COLUMNS)
    .eq("language", language)
    .eq("level", level)
    .order("rank");
  if (error) throw readError("words", error);
  return data.map(toWord);
}

// 최신순. lastReply는 후리가나 표기를 포함한 원문이다
export async function readOpenSessions(sb: Sb, userId: string, language: Language): Promise<OpenSession[]> {
  const { data, error } = await sb
    .from("chat_sessions")
    .select("id, scenario_id, level, status, created_at, chat_turns(turn_no, reply)")
    .eq("user_id", userId)
    .eq("language", language)
    .in("status", ["active", "ending"])
    .eq("chat_turns.status", "done")
    .order("created_at", { ascending: false })
    .order("turn_no", { referencedTable: "chat_turns", ascending: false });
  if (error) throw readError("chat_sessions", error);
  return data.map((row) => ({
    id: row.id,
    scenarioId: row.scenario_id,
    level: row.level as Level,
    status: row.status as OpenSession["status"],
    doneTurns: row.chat_turns.length,
    lastReply: row.chat_turns[0]?.reply ?? null,
    createdAt: new Date(row.created_at),
  }));
}

export async function readEndedScenarioIds(sb: Sb, userId: string, language: Language): Promise<string[]> {
  const { data, error } = await sb
    .from("chat_sessions")
    .select("scenario_id")
    .eq("user_id", userId)
    .eq("language", language)
    .eq("status", "ended");
  if (error) throw readError("chat_sessions", error);
  return [...new Set(data.map((row) => row.scenario_id))];
}

// 남의 세션·없는 세션은 null. uuid가 아니면 Postgres 캐스트 오류(500)가 나지 않게 쿼리하지 않는다
export async function readChatRoom(sb: Sb, userId: string, sessionId: string): Promise<ChatRoomData | null> {
  if (!SESSION_ID.safeParse(sessionId).success) return null;
  const { data, error } = await sb
    .from("chat_sessions")
    .select(
      "id, language, level, scenario_id, status, feedback_status, feedback, chat_turns(turn_no, user_text, reply, reply_ko, correction)",
    )
    .eq("id", sessionId)
    .eq("user_id", userId)
    .eq("chat_turns.status", "done")
    .order("turn_no", { referencedTable: "chat_turns" })
    .maybeSingle();
  if (error) throw readError("chat_sessions", error);
  if (!data) return null;

  const status = data.status as ChatRoomData["status"];
  return {
    id: data.id,
    language: data.language as Language,
    level: data.level as Level,
    scenarioId: data.scenario_id,
    status,
    result: status === "ended" ? ({ feedbackStatus: data.feedback_status, feedback: data.feedback } as EndResult) : null,
    // done 턴은 reply·reply_ko가 null이 아니다 (chat_turns_done_has_reply)
    turns: data.chat_turns.map((turn) => ({
      turnNo: turn.turn_no,
      userText: turn.user_text,
      reply: turn.reply as string,
      replyKo: turn.reply_ko as string,
      correction: turn.correction as TurnReply["correction"],
    })),
  };
}
