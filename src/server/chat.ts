import "server-only";
import type { Language, Level } from "@/lib/levels";
import { findScenario, type Scenario } from "@/lib/scenarios";
import type { ChatEndResponse, ChatMessageResponse, ChatSessionCreated } from "@/types/api";
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
  // 다른 레벨의 상황은 400이다. 요청 레벨이 실제 레벨과 다른지는 RPC가 잠근 뒤 확인한다(CONFLICT)
  if (findScenario(input.scenarioId)?.level !== input.level) return { ok: false, code: "INVALID_INPUT" };
  return deps.db.createChatSession(userId, input);
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
  const { token, turnNo, session, history } = reserved.value;
  const generated = await deps.ai.generateTurn({
    language: session.language,
    level: session.level,
    scenario: sessionScenario(session.scenarioId),
    history,
    userText,
  });

  if (!generated.ok) {
    const failed = await deps.db.failChatTurn(userId, sessionId, token, generated.reason);
    return failed.ok ? { ok: false, code: "AI_UNAVAILABLE" } : failed;
  }

  // 만료되거나 교체된 토큰이면 RPC가 거부한다. 그 AI 응답은 저장하지도 보여 주지도 않는다
  const finished = await deps.db.finishChatTurn(userId, sessionId, token, generated.value);
  if (!finished.ok) return finished;
  return { ok: true, value: { turnNo, turnsLeft: finished.value.turnsLeft, reply: generated.value } };
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
