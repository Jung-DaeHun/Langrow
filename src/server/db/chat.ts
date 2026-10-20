import "server-only";
import type { Language, Level } from "@/lib/levels";
import type { TargetSource, TargetWord, WordCandidate } from "@/lib/targetWords";
import type { AiFailureReason } from "@/services/claude/client";
import type { Feedback, StoredFeedback, TurnReply } from "@/services/claude/schemas";
import { callRpc, type RpcValue } from "./rpc";
import type { DbResult } from "./types";

// 대화 RPC (chat 마이그레이션). 예약 → (잠금 밖에서) Claude → 확정/실패 순서는 2-api use-case가 지킨다

export type ChatSessionInfo = { language: Language; level: Level; scenarioId: string };
// 저장된 피드백은 옛 형식(고칠 점이 문자열)일 수 있다. 저장은 새 형식(Feedback)만 한다
export type EndResult =
  | { feedbackStatus: "ready"; feedback: StoredFeedback }
  | { feedbackStatus: "fallback"; feedback: { message: string } }
  | { feedbackStatus: "skipped"; feedback: null };
export type BeginEndResult =
  | { state: "ended"; result: EndResult }
  | { state: "ending" }
  | {
      state: "reserved";
      token: string;
      session: ChatSessionInfo;
      turns: { userText: string; reply: string; correction: TurnReply["correction"] }[];
    };

type HistoryRow = { user_text: string; reply: string };
type EndTurnRow = HistoryRow & { correction: TurnReply["correction"] };
type WordRow = { id: string; word: string; reading: string | null; meaning_ko: string };
type CandidateRow = WordRow & { used_today: boolean };
type TargetRow = WordRow & { used: boolean };

function sessionInfo(value: RpcValue): ChatSessionInfo {
  return { language: value.language as Language, level: value.level as Level, scenarioId: value.scenario_id as string };
}

function targetWords(rows: unknown): TargetWord[] | null {
  if (rows === null) return null;
  return (rows as TargetRow[]).map((row) => ({
    id: row.id,
    word: row.word,
    reading: row.reading,
    meaningKo: row.meaning_ko,
    used: row.used,
  }));
}

function endResult(value: RpcValue): EndResult {
  return { feedbackStatus: value.feedback_status, feedback: value.feedback } as EndResult;
}

// CONSENT_REQUIRED, ONBOARDING_REQUIRED, CONFLICT(실제 레벨과 다름), PRO_REQUIRED(proOnly인데 Free).
// 상황이 열린 레벨의 것인지와 Pro 상황인지는 use-case가 lib/scenarios로 정한다. 플랜은 RPC가 판정한다
export async function createChatSession(
  userId: string,
  input: ChatSessionInfo,
  proOnly: boolean,
): Promise<DbResult<{ sessionId: string }>> {
  const result = await callRpc("create_chat_session", {
    p_user_id: userId,
    p_language: input.language,
    p_level: input.level,
    p_scenario_id: input.scenarioId,
    p_pro_only: proOnly,
  });
  return result.ok ? { ok: true, value: { sessionId: result.value.session_id as string } } : result;
}

// NOT_FOUND, CONSENT_REQUIRED, ONBOARDING_REQUIRED, CONFLICT, AI_FAILURE_LIMIT, SESSION_FULL, LIMIT_REACHED
export async function beginChatTurn(
  userId: string,
  sessionId: string,
  userText: string,
): Promise<
  DbResult<{
    token: string;
    turnNo: number;
    session: ChatSessionInfo;
    history: { userText: string; reply: string }[];
    // 배운 단어(spec/chat.md "배운 단어 써 보기"). 후보는 첫 턴이고 목표 단어가 없을 때만 배열이다(빈 배열 가능)
    candidates: WordCandidate[] | null;
    candidateSource: TargetSource | null;
    targets: TargetWord[] | null;
  }>
> {
  const result = await callRpc("begin_chat_turn", {
    p_user_id: userId,
    p_session_id: sessionId,
    p_user_text: userText,
  });
  if (!result.ok) return result;
  const { value } = result;
  return {
    ok: true,
    value: {
      token: value.token as string,
      turnNo: value.turn_no as number,
      session: sessionInfo(value),
      history: (value.history as HistoryRow[]).map((row) => ({ userText: row.user_text, reply: row.reply })),
      candidates:
        value.candidates === null
          ? null
          : (value.candidates as CandidateRow[]).map((row) => ({
              id: row.id,
              word: row.word,
              reading: row.reading,
              meaningKo: row.meaning_ko,
              usedToday: row.used_today,
            })),
      candidateSource: value.candidate_source as TargetSource | null,
      targets: targetWords(value.targets),
    },
  };
}

// NOT_FOUND, CONFLICT(토큰 불일치·만료). 목표 단어는 세션의 첫 턴에서만 저장되고, 맞지 않는 id는 RPC가 버린다
export async function finishChatTurn(
  userId: string,
  sessionId: string,
  token: string,
  reply: TurnReply,
  words?: { targetWordIds?: string[]; targetSource?: TargetSource; usedWordIds?: string[] },
): Promise<DbResult<{ turnsLeft: number; targetWords: TargetWord[] | null; targetSource: TargetSource | null }>> {
  const result = await callRpc("finish_chat_turn", {
    p_user_id: userId,
    p_session_id: sessionId,
    p_token: token,
    p_reply: reply.reply,
    p_reply_ko: reply.reply_ko,
    p_correction: reply.correction,
    // 발음이 없으면 인자를 빼서 기본값 null로 저장한다 (undefined 키는 요청 JSON에서 빠진다)
    p_reply_pron_ko: reply.reply_pron_ko ?? undefined,
    p_reply_breakdown: reply.reply_breakdown ?? undefined,
    // 배운 단어도 값이 없으면 인자를 빼서 기본값 null로 둔다
    p_target_word_ids: words?.targetWordIds,
    p_target_source: words?.targetSource,
    p_used_word_ids: words?.usedWordIds,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    value: {
      turnsLeft: result.value.turns_left as number,
      targetWords: targetWords(result.value.target_words),
      targetSource: result.value.target_source as TargetSource | null,
    },
  };
}

// NOT_FOUND, CONFLICT(토큰 불일치·만료)
export async function failChatTurn(
  userId: string,
  sessionId: string,
  token: string,
  reason: AiFailureReason,
): Promise<DbResult<null>> {
  const result = await callRpc("fail_chat_turn", {
    p_user_id: userId,
    p_session_id: sessionId,
    p_token: token,
    p_reason: reason,
  });
  return result.ok ? { ok: true, value: null } : result;
}

// NOT_FOUND, CONSENT_REQUIRED, ONBOARDING_REQUIRED, CONFLICT(턴 처리 중)
export async function beginEnd(userId: string, sessionId: string): Promise<DbResult<BeginEndResult>> {
  const result = await callRpc("begin_end", { p_user_id: userId, p_session_id: sessionId });
  if (!result.ok) return result;
  const { value } = result;
  switch (value.state) {
    case "ended":
      return { ok: true, value: { state: "ended", result: endResult(value) } };
    case "ending":
      return { ok: true, value: { state: "ending" } };
    case "reserved":
      return {
        ok: true,
        value: {
          state: "reserved",
          token: value.token as string,
          session: sessionInfo(value),
          turns: (value.turns as EndTurnRow[]).map((row) => ({
            userText: row.user_text,
            reply: row.reply,
            correction: row.correction,
          })),
        },
      };
    default:
      throw new Error(`RPC begin_end: 알 수 없는 state입니다 (${String(value.state)})`);
  }
}

// NOT_FOUND, CONFLICT(토큰 불일치·만료)
export async function finishEnd(
  userId: string,
  sessionId: string,
  token: string,
  feedback: Feedback,
): Promise<DbResult<EndResult>> {
  const result = await callRpc("finish_end", {
    p_user_id: userId,
    p_session_id: sessionId,
    p_token: token,
    p_feedback: feedback,
  });
  return result.ok ? { ok: true, value: endResult(result.value) } : result;
}

// NOT_FOUND, CONFLICT(토큰 불일치·만료)
export async function failEnd(
  userId: string,
  sessionId: string,
  token: string,
  reason: AiFailureReason,
): Promise<DbResult<EndResult>> {
  const result = await callRpc("fail_end", {
    p_user_id: userId,
    p_session_id: sessionId,
    p_token: token,
    p_reason: reason,
  });
  return result.ok ? { ok: true, value: endResult(result.value) } : result;
}
