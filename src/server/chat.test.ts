import { describe, expect, it } from "vitest";
import { findScenario } from "@/lib/scenarios";
import type { BeginEndResult, EndResult } from "@/server/db/chat";
import type { DbErrorCode } from "@/server/db/types";
import type { Feedback, TurnReply } from "@/services/claude/schemas";
import { createFakeDeps } from "@/test/fakes";
import { endChatSession, sendChatMessage, startChatSession } from "./chat";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "33333333-3333-4333-8333-333333333333";
// 기본 계정(en 1)과 다른 값이라, AI 입력이 요청이 아니라 예약 결과의 세션에서 오는지 구분된다
const SESSION = { language: "ja", level: 3, scenarioId: "l3-pharmacy" } as const;
const HISTORY = [
  { userText: "頭が痛いです。", reply: "いつからですか？" },
  { userText: "昨日からです。", reply: "熱はありますか？" },
];
const TURNS = [{ userText: "頭が痛いです。", reply: "いつからですか？", correction: null }];

const REPLY: TurnReply = {
  reply: "では、この薬をどうぞ。",
  reply_ko: "그럼 이 약을 드릴게요.",
  correction: { corrected: "熱はありません。", explanation_ko: "없다고 할 때는 ありません을 써요." },
};
const FEEDBACK: Feedback = { good: "증상을 끝까지 설명했어요.", improve: ["から를 붙여 이유를 말해 보세요."] };
const FALLBACK: EndResult = {
  feedbackStatus: "fallback",
  feedback: { message: "대화 기록은 저장됐어요. 종합 피드백을 만들지 못했으니 대화 아래의 교정을 확인해 주세요." },
};

function reservedTurn() {
  return createFakeDeps({
    db: {
      beginChatTurn: async () => ({ ok: true, value: { token: TOKEN, turnNo: 3, session: SESSION, history: HISTORY } }),
      finishChatTurn: async () => ({ ok: true, value: { turnsLeft: 17 } }),
    },
    ai: { generateTurn: async () => ({ ok: true, value: REPLY }) },
  });
}

function reservedEnd() {
  return createFakeDeps({
    db: { beginEnd: async () => ({ ok: true, value: { state: "reserved", token: TOKEN, session: SESSION, turns: TURNS } }) },
    ai: { generateFeedback: async () => ({ ok: true, value: FEEDBACK }) },
  });
}

describe("startChatSession", () => {
  it.each([
    ["없는 상황", "l9-unknown"],
    ["다른 레벨의 상황", "l2-hotel"],
  ])("%s이면 INVALID_INPUT이고 세션을 만들지 않는다", async (_label, scenarioId) => {
    const deps = createFakeDeps();

    const result = await startChatSession(deps, USER_ID, { language: "en", level: 1, scenarioId });

    expect(result).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(deps.db.createChatSession).not.toHaveBeenCalled();
  });

  it("그 레벨의 상황이면 세션을 만들고 sessionId를 돌려준다", async () => {
    const deps = createFakeDeps({ db: { createChatSession: async () => ({ ok: true, value: { sessionId: SESSION_ID } }) } });
    const input = { language: "ja", level: 3, scenarioId: "l3-pharmacy" } as const;

    const result = await startChatSession(deps, USER_ID, input);

    expect(result).toEqual({ ok: true, value: { sessionId: SESSION_ID } });
    expect(deps.db.createChatSession).toHaveBeenCalledWith(USER_ID, input);
  });

  it("RPC가 CONFLICT(실제 레벨과 다름)면 그대로 돌려준다", async () => {
    const deps = createFakeDeps({ db: { createChatSession: async () => ({ ok: false, code: "CONFLICT" }) } });

    const result = await startChatSession(deps, USER_ID, { language: "en", level: 1, scenarioId: "l1-cafe" });

    expect(result).toEqual({ ok: false, code: "CONFLICT" });
  });
});

describe("sendChatMessage", () => {
  it.each<DbErrorCode>([
    "NOT_FOUND",
    "CONSENT_REQUIRED",
    "ONBOARDING_REQUIRED",
    "CONFLICT",
    "AI_FAILURE_LIMIT",
    "SESSION_FULL",
    "LIMIT_REACHED",
  ])("예약이 %s로 거부되면 같은 코드를 돌려주고 AI와 확정 RPC를 부르지 않는다", async (code) => {
    const deps = createFakeDeps({ db: { beginChatTurn: async () => ({ ok: false, code }) } });

    const result = await sendChatMessage(deps, USER_ID, SESSION_ID, "hi");

    expect(result).toEqual({ ok: false, code });
    expect(deps.ai.generateTurn).not.toHaveBeenCalled();
    expect(deps.db.finishChatTurn).not.toHaveBeenCalled();
    expect(deps.db.failChatTurn).not.toHaveBeenCalled();
  });

  it("앞뒤 공백을 지운 입력으로 예약하고 AI를 부른다", async () => {
    const deps = reservedTurn();

    await sendChatMessage(deps, USER_ID, SESSION_ID, "  hi  ");

    expect(deps.db.beginChatTurn).toHaveBeenCalledWith(USER_ID, SESSION_ID, "hi");
    expect(deps.ai.generateTurn).toHaveBeenCalledWith(expect.objectContaining({ userText: "hi" }));
  });

  it("AI 입력의 언어·레벨·상황·history는 예약 결과의 세션 값이다", async () => {
    const deps = reservedTurn();

    await sendChatMessage(deps, USER_ID, SESSION_ID, "熱はないです。");

    expect(deps.ai.generateTurn).toHaveBeenCalledWith({
      language: "ja",
      level: 3,
      scenario: findScenario("l3-pharmacy"),
      history: HISTORY,
      userText: "熱はないです。",
    });
  });

  it("예약 → AI → 성공 확정 순서로 부르고 { turnNo, turnsLeft, reply }를 돌려준다", async () => {
    const deps = reservedTurn();

    const result = await sendChatMessage(deps, USER_ID, SESSION_ID, "熱はないです。");

    expect(result).toEqual({ ok: true, value: { turnNo: 3, turnsLeft: 17, reply: REPLY } });
    expect(deps.db.finishChatTurn).toHaveBeenCalledWith(USER_ID, SESSION_ID, TOKEN, REPLY);
    const [begin] = deps.db.beginChatTurn.mock.invocationCallOrder;
    const [generate] = deps.ai.generateTurn.mock.invocationCallOrder;
    const [finish] = deps.db.finishChatTurn.mock.invocationCallOrder;
    expect(begin).toBeLessThan(generate);
    expect(generate).toBeLessThan(finish);
    expect(deps.db.failChatTurn).not.toHaveBeenCalled();
  });

  it("성공 확정이 CONFLICT(만료·교체된 토큰)면 CONFLICT만 돌려주고 AI 응답은 버린다", async () => {
    const deps = reservedTurn();
    deps.db.finishChatTurn.mockResolvedValue({ ok: false, code: "CONFLICT" });

    const result = await sendChatMessage(deps, USER_ID, SESSION_ID, "hi");

    expect(result).toEqual({ ok: false, code: "CONFLICT" });
    expect(deps.db.failChatTurn).not.toHaveBeenCalled();
  });

  it("AI가 실패하면 실패 확정 RPC 뒤 AI_UNAVAILABLE이고 성공 확정은 부르지 않는다", async () => {
    const deps = reservedTurn();
    deps.ai.generateTurn.mockResolvedValue({ ok: false, reason: "timeout" });

    const result = await sendChatMessage(deps, USER_ID, SESSION_ID, "hi");

    expect(result).toEqual({ ok: false, code: "AI_UNAVAILABLE" });
    expect(deps.db.failChatTurn).toHaveBeenCalledWith(USER_ID, SESSION_ID, TOKEN, "timeout");
    expect(deps.ai.generateTurn).toHaveBeenCalledTimes(1);
    expect(deps.db.finishChatTurn).not.toHaveBeenCalled();
  });

  it("실패 확정이 CONFLICT면 CONFLICT다", async () => {
    const deps = reservedTurn();
    deps.ai.generateTurn.mockResolvedValue({ ok: false, reason: "api_error" });
    deps.db.failChatTurn.mockResolvedValue({ ok: false, code: "CONFLICT" });

    const result = await sendChatMessage(deps, USER_ID, SESSION_ID, "hi");

    expect(result).toEqual({ ok: false, code: "CONFLICT" });
  });

  it("예약 세션의 상황이 상수에 없으면 throw하고 AI를 부르지 않는다", async () => {
    const deps = reservedTurn();
    deps.db.beginChatTurn.mockResolvedValue({
      ok: true,
      value: { token: TOKEN, turnNo: 1, session: { ...SESSION, scenarioId: "l3-removed" }, history: [] },
    });

    await expect(sendChatMessage(deps, USER_ID, SESSION_ID, "hi")).rejects.toThrow();
    expect(deps.ai.generateTurn).not.toHaveBeenCalled();
  });
});

describe("endChatSession", () => {
  it.each<DbErrorCode>(["NOT_FOUND", "CONSENT_REQUIRED", "ONBOARDING_REQUIRED", "CONFLICT"])(
    "시작 RPC가 %s로 거부되면 같은 코드를 돌려주고 AI를 부르지 않는다",
    async (code) => {
      const deps = createFakeDeps({ db: { beginEnd: async () => ({ ok: false, code }) } });

      const result = await endChatSession(deps, USER_ID, SESSION_ID);

      expect(result).toEqual({ ok: false, code });
      expect(deps.ai.generateFeedback).not.toHaveBeenCalled();
      expect(deps.db.finishEnd).not.toHaveBeenCalled();
      expect(deps.db.failEnd).not.toHaveBeenCalled();
    },
  );

  it.each<EndResult>([
    { feedbackStatus: "ready", feedback: FEEDBACK },
    FALLBACK,
    { feedbackStatus: "skipped", feedback: null },
  ])("이미 ended($feedbackStatus)면 저장된 결과를 200으로 돌려주고 AI를 부르지 않는다", async (saved) => {
    const begin: BeginEndResult = { state: "ended", result: saved };
    const deps = createFakeDeps({ db: { beginEnd: async () => ({ ok: true, value: begin }) } });

    const result = await endChatSession(deps, USER_ID, SESSION_ID);

    expect(result).toEqual({ ok: true, value: { status: "ended", ...saved } });
    expect(deps.ai.generateFeedback).not.toHaveBeenCalled();
    expect(deps.db.finishEnd).not.toHaveBeenCalled();
    expect(deps.db.failEnd).not.toHaveBeenCalled();
  });

  it("ending이면 202와 retryAfterSeconds 2를 돌려주고 AI를 부르지 않는다", async () => {
    const deps = createFakeDeps({ db: { beginEnd: async () => ({ ok: true, value: { state: "ending" } }) } });

    const result = await endChatSession(deps, USER_ID, SESSION_ID);

    expect(result).toEqual({ ok: true, status: 202, value: { status: "ending", retryAfterSeconds: 2 } });
    expect(deps.ai.generateFeedback).not.toHaveBeenCalled();
  });

  it("reserved이고 AI가 성공하면 세션 값으로 피드백을 만들고 finishEnd로 ready를 돌려준다", async () => {
    const deps = reservedEnd();

    const result = await endChatSession(deps, USER_ID, SESSION_ID);

    expect(deps.ai.generateFeedback).toHaveBeenCalledWith({
      language: "ja",
      level: 3,
      scenario: findScenario("l3-pharmacy"),
      turns: TURNS,
    });
    expect(deps.db.finishEnd).toHaveBeenCalledWith(USER_ID, SESSION_ID, TOKEN, FEEDBACK);
    expect(result).toEqual({ ok: true, value: { status: "ended", feedbackStatus: "ready", feedback: FEEDBACK } });
    const [begin] = deps.db.beginEnd.mock.invocationCallOrder;
    const [generate] = deps.ai.generateFeedback.mock.invocationCallOrder;
    const [finish] = deps.db.finishEnd.mock.invocationCallOrder;
    expect(begin).toBeLessThan(generate);
    expect(generate).toBeLessThan(finish);
    expect(deps.db.failEnd).not.toHaveBeenCalled();
  });

  it("reserved이고 AI가 실패하면 failEnd로 fallback을 200으로 돌려준다", async () => {
    const deps = reservedEnd();
    deps.ai.generateFeedback.mockResolvedValue({ ok: false, reason: "refusal" });
    deps.db.failEnd.mockResolvedValue({ ok: true, value: FALLBACK });

    const result = await endChatSession(deps, USER_ID, SESSION_ID);

    expect(deps.db.failEnd).toHaveBeenCalledWith(USER_ID, SESSION_ID, TOKEN, "refusal");
    expect(result).toEqual({ ok: true, value: { status: "ended", ...FALLBACK } });
    expect(deps.db.finishEnd).not.toHaveBeenCalled();
  });

  it("finishEnd가 CONFLICT면 CONFLICT다", async () => {
    const deps = reservedEnd();
    deps.db.finishEnd.mockResolvedValue({ ok: false, code: "CONFLICT" });

    expect(await endChatSession(deps, USER_ID, SESSION_ID)).toEqual({ ok: false, code: "CONFLICT" });
  });

  it("failEnd가 CONFLICT면 CONFLICT다", async () => {
    const deps = reservedEnd();
    deps.ai.generateFeedback.mockResolvedValue({ ok: false, reason: "timeout" });
    deps.db.failEnd.mockResolvedValue({ ok: false, code: "CONFLICT" });

    expect(await endChatSession(deps, USER_ID, SESSION_ID)).toEqual({ ok: false, code: "CONFLICT" });
  });

  it("finishEnd가 throw하면 reject되고 AI를 다시 부르거나 failEnd로 넘기지 않는다", async () => {
    const deps = reservedEnd();
    deps.db.finishEnd.mockRejectedValue(new Error("connection reset"));

    await expect(endChatSession(deps, USER_ID, SESSION_ID)).rejects.toThrow("connection reset");
    expect(deps.ai.generateFeedback).toHaveBeenCalledTimes(1);
    expect(deps.db.finishEnd).toHaveBeenCalledTimes(1);
    expect(deps.db.failEnd).not.toHaveBeenCalled();
  });

  it("failEnd가 throw하면 reject되고 AI와 failEnd를 다시 부르지 않는다", async () => {
    const deps = reservedEnd();
    deps.ai.generateFeedback.mockResolvedValue({ ok: false, reason: "timeout" });
    deps.db.failEnd.mockRejectedValue(new Error("connection reset"));

    await expect(endChatSession(deps, USER_ID, SESSION_ID)).rejects.toThrow("connection reset");
    expect(deps.ai.generateFeedback).toHaveBeenCalledTimes(1);
    expect(deps.db.failEnd).toHaveBeenCalledTimes(1);
  });

  it("reserved 세션의 상황이 상수에 없으면 throw하고 AI를 부르지 않는다", async () => {
    const deps = reservedEnd();
    deps.db.beginEnd.mockResolvedValue({
      ok: true,
      value: { state: "reserved", token: TOKEN, session: { ...SESSION, scenarioId: "l3-removed" }, turns: TURNS },
    });

    await expect(endChatSession(deps, USER_ID, SESSION_ID)).rejects.toThrow();
    expect(deps.ai.generateFeedback).not.toHaveBeenCalled();
  });
});
