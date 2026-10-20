import "server-only";
import type { BreakdownTarget } from "@/lib/breakdown";
import type { Language, Level } from "@/lib/levels";
import { findScenario, isProScenario, isScenarioLocked, type Scenario } from "@/lib/scenarios";
import type { TurnPromptInput } from "@/services/claude/prompts";
import type { ChatBreakdownResponse, ChatEndResponse, ChatMessageResponse, ChatSessionCreated } from "@/types/api";
import type { Deps } from "./deps";
import type { Outcome } from "./http";

// 대화 use-case. 잠금·한도·토큰 만료 복구는 RPC가 하고, 여기서는 RPC 결과에 따라 AI를 부를지 정한다.
// AI 재시도는 createAi가 1번 한다. 확정 RPC가 실패하거나 throw해도 AI와 확정을 다시 부르지 않는다
// (만료 작업은 다음 요청의 RPC가 복구한다)

export const END_RETRY_AFTER_SECONDS = 2;

// 예약된 세션의 상황이 상수에 없으면 상황 상수에서 항목이 빠진 버그다. 예약은 90초 뒤 RPC가 복구한다
function sessionScenario(scenarioId: string): Scenario {
  const scenario = findScenario(scenarioId);
  if (!scenario) throw new Error(`상황이 없습니다 (${scenarioId})`);
  return scenario;
}

export async function startChatSession(
  deps: Deps,
  userId: string,
  input: { language: Language; level: Level; scenarioId: string },
): Promise<Outcome<ChatSessionCreated>> {
  // 위 레벨의 상황은 400이다. 요청 레벨이 실제 레벨과 다른지는 RPC가 잠근 뒤 확인한다(CONFLICT).
  // 세션 레벨은 상황 레벨이 아니라 요청 레벨(지금 레벨)이다. Pro 상황이면 RPC가 플랜을 판정한다(PRO_REQUIRED)
  const scenario = findScenario(input.scenarioId);
  if (!scenario || isScenarioLocked(scenario, input.level)) return { ok: false, code: "INVALID_INPUT" };
  return deps.db.createChatSession(userId, input, isProScenario(scenario));
}

export async function sendChatMessage(
  deps: Deps,
  userId: string,
  sessionId: string,
  text: string,
): Promise<Outcome<ChatMessageResponse>> {
  const userText = text.trim();
  const reserved = await deps.db.beginChatTurn(userId, sessionId, userText);
  if (!reserved.ok) return reserved;

  // 요청이 아니라 세션에 저장된 언어·레벨·상황으로 이어서 대화한다
  const { token, turnNo, session, history, candidates, candidateSource, targets } = reserved.value;
  // 배운 단어: 후보가 있는 첫 턴은 AI가 목표 단어를 고르고, 목표 단어가 있는 턴은 유도한다(spec/chat.md "배운 단어 써 보기")
  const words: TurnPromptInput["words"] = candidates?.length
    ? { kind: "pick", candidates }
    : targets?.length
      ? { kind: "practice", targets }
      : undefined;
  const generated = await deps.ai.generateTurn({
    language: session.language,
    level: session.level,
    scenario: sessionScenario(session.scenarioId),
    history,
    userText,
    words,
  });

  if (!generated.ok) {
    const failed = await deps.db.failChatTurn(userId, sessionId, token, generated.reason);
    return failed.ok ? { ok: false, code: "AI_UNAVAILABLE" } : failed;
  }

  // 만료되거나 교체된 토큰이면 RPC가 거부한다. 그 AI 응답은 저장하지도 보여 주지도 않는다.
  // 단어 id는 reply에서 떼어 확정 RPC에만 넘긴다. 고른 목표 단어는 후보의 출처와 함께 넘긴다
  const { words: wordIds, ...reply } = generated.value;
  const finished = wordIds
    ? await deps.db.finishChatTurn(
        userId,
        sessionId,
        token,
        reply,
        words?.kind === "pick" ? { ...wordIds, targetSource: candidateSource ?? undefined } : wordIds,
      )
    : await deps.db.finishChatTurn(userId, sessionId, token, reply);
  if (!finished.ok) return finished;
  const { turnsLeft, targetWords, targetSource } = finished.value;
  return { ok: true, value: { turnNo, turnsLeft, reply, targetWords, targetSource } };
}

export async function endChatSession(deps: Deps, userId: string, sessionId: string): Promise<Outcome<ChatEndResponse>> {
  const begun = await deps.db.beginEnd(userId, sessionId);
  if (!begun.ok) return begun;

  const state = begun.value;
  if (state.state === "ended") return { ok: true, value: { status: "ended", ...state.result } };
  // 다른 요청이 피드백을 만드는 중이다. 기다리지 않고 클라이언트가 다시 확인하게 한다
  if (state.state === "ending") {
    return { ok: true, status: 202, value: { status: "ending", retryAfterSeconds: END_RETRY_AFTER_SECONDS } };
  }

  // reserved: 예약을 얻은 이 요청만 AI로 피드백을 만든다
  const { token, session, turns } = state;
  const generated = await deps.ai.generateFeedback({
    language: session.language,
    level: session.level,
    scenario: sessionScenario(session.scenarioId),
    turns,
  });
  const ended = generated.ok
    ? await deps.db.finishEnd(userId, sessionId, token, generated.value)
    : await deps.db.failEnd(userId, sessionId, token, generated.reason);
  if (!ended.ok) return ended;
  return { ok: true, value: { status: "ended", ...ended.value } };
}

export const BREAKDOWN_UNAVAILABLE_MESSAGE = "뜯어보기를 만들지 못했어요. 다시 눌러 주세요.";
// 실패 횟수는 대화와 같이 세지만, 공용 문구("대화를 잠시 쉬어요" 등)는 뜯어보기 자리에 맞지 않아 바꾼다
export const BREAKDOWN_FAILURE_LIMIT_MESSAGE = "오늘은 응답 오류가 많아 문장 뜯어보기를 잠시 쉬어요. 내일 다시 시도해 주세요.";
export const BREAKDOWN_IN_PROGRESS_MESSAGE = "뜯어보기를 만드는 중이에요. 잠시 뒤 다시 눌러 주세요.";

// 문장 뜯어보기를 처음 열 때 만들기(spec/chat.md "처음 열 때 만들기"). 문장·언어·레벨은 body가 아니라 시작 RPC가 DB의 턴에서 준다.
// 저장본·실패 10회·만드는 중은 시작 RPC가 계정을 잠근 뒤 판정한다. 활동일·사용량·이벤트는 바꾸지 않는다
export async function openChatBreakdown(
  deps: Deps,
  userId: string,
  sessionId: string,
  input: { turn_no: number; target: BreakdownTarget },
): Promise<Outcome<ChatBreakdownResponse>> {
  const { turn_no: turnNo, target } = input;
  const begun = await deps.db.beginTurnBreakdown(userId, sessionId, turnNo, target);
  if (!begun.ok) {
    if (begun.code === "AI_FAILURE_LIMIT") return { ...begun, message: BREAKDOWN_FAILURE_LIMIT_MESSAGE };
    if (begun.code === "CONFLICT") return { ...begun, message: BREAKDOWN_IN_PROGRESS_MESSAGE };
    return begun;
  }
  if (begun.value.state === "stored") return { ok: true, value: { breakdown: begun.value.breakdown } };

  // until은 이 작업의 "만드는 중" 표시다. 바꾸지 않고 실패·저장 RPC에 넘겨야 그 표시를 지운다
  const { sentence, language, level, until } = begun.value;
  const generated = await deps.ai.generateBreakdown({ language, level, target, sentence });
  if (!generated.ok) {
    const failed = await deps.db.failTurnBreakdown(userId, sessionId, turnNo, target, until, generated.reason);
    return failed.ok ? { ok: false, code: "AI_UNAVAILABLE", message: BREAKDOWN_UNAVAILABLE_MESSAGE } : failed;
  }

  // 저장은 다음에 열 때를 위한 것이라 실패해도 만든 값을 돌려준다. 로그에 문장·조각 내용을 남기지 않는다
  const { breakdown } = generated.value;
  const logSaveFailed = (detail: { code: string } | { error: string }) =>
    console.error(JSON.stringify({ breakdown: "save_failed", sessionId, turnNo, target, ...detail }));
  try {
    const saved = await deps.db.saveTurnBreakdown(userId, sessionId, turnNo, target, until, breakdown);
    if (saved.ok) return { ok: true, value: saved.value };
    logSaveFailed({ code: saved.code });
  } catch (error) {
    logSaveFailed({ error: error instanceof Error ? error.message : String(error) });
  }
  return { ok: true, value: { breakdown } };
}
