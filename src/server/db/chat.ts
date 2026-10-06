import "server-only";
import type { Language, Level } from "@/lib/levels";
import type { AiFailureReason } from "@/services/claude/client";
import type { Feedback, TurnReply } from "@/services/claude/schemas";
import { callRpc, type RpcValue } from "./rpc";
import type { DbResult } from "./types";

// 대화 RPC (chat 마이그레이션). 예약 → (잠금 밖에서) Claude → 확정/실패 순서는 2-api use-case가 지킨다

export type ChatSessionInfo = { language: Language; level: Level; scenarioId: string };
export type EndResult =
  | { feedbackStatus: "ready"; feedback: Feedback }
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

function sessionInfo(value: RpcValue): ChatSessionInfo {
  return { language: value.language as Language, level: value.level as Level, scenarioId: value.scenario_id as string };
}

function endResult(value: RpcValue): EndResult {
  return { feedbackStatus: value.feedback_status, feedback: value.feedback } as EndResult;
}

// CONSENT_REQUIRED, ONBOARDING_REQUIRED, CONFLICT(실제 레벨과 다름).
// 상황이 그 레벨의 것인지는 use-case가 lib/scenarios로 검사한다
export async function createChatSession(
  userId: string,
  input: ChatSessionInfo,
): Promise<DbResult<{ sessionId: string }>> {
  const result = await callRpc("create_chat_session", {
    p_user_id: userId,
    p_language: input.language,
    p_level: input.level,
    p_scenario_id: input.scenarioId,
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
    },
  };
}

// NOT_FOUND, CONFLICT(토큰 불일치·만료)
export async function finishChatTurn(
  userId: string,
  sessionId: string,
  token: string,
  reply: TurnReply,
): Promise<DbResult<{ turnsLeft: number }>> {
  const result = await callRpc("finish_chat_turn", {
    p_user_id: userId,
    p_session_id: sessionId,
    p_token: token,
    p_reply: reply.reply,
    p_reply_ko: reply.reply_ko,
    p_correction: reply.correction,
  });
  return result.ok ? { ok: true, value: { turnsLeft: result.value.turns_left as number } } : result;
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
