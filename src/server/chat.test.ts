import { afterEach, describe, expect, it, vi } from "vitest";
import type { Breakdown } from "@/lib/breakdown";
import { findScenario } from "@/lib/scenarios";
import type { TargetSource, TargetWord, WordCandidate } from "@/lib/targetWords";
import type { BeginEndResult, EndResult } from "@/server/db/chat";
import type { DbErrorCode } from "@/server/db/types";
import type { Feedback, TurnReply } from "@/services/claude/schemas";
import { createFakeDeps } from "@/test/fakes";
import {
  BREAKDOWN_FAILURE_LIMIT_MESSAGE,
  BREAKDOWN_IN_PROGRESS_MESSAGE,
  BREAKDOWN_UNAVAILABLE_MESSAGE,
  endChatSession,
  openChatBreakdown,
  sendChatMessage,
  startChatSession,
} from "./chat";
import type { Db } from "./deps";

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
const FEEDBACK: Feedback = {
  good: "증상을 끝까지 설명했어요.",
  improve: [
    {
      point: "から를 붙여 이유를 말해 보세요.",
      example: "[熱|ねつ]があるから、[休|やす]みたいです。",
      example_pron_ko: "네츠가 아루카라, 야스미타이데스.",
    },
  ],
};
const FALLBACK: EndResult = {
  feedbackStatus: "fallback",
  feedback: { message: "대화 기록은 저장됐어요. 종합 피드백을 만들지 못했으니 대화 아래의 교정을 확인해 주세요." },
};

function reservedTurn() {
  return createFakeDeps({
    db: {
      beginChatTurn: async () => ({
        ok: true,
        value: {
          token: TOKEN,
          turnNo: 3,
          session: SESSION,
          history: HISTORY,
          candidates: null,
          candidateSource: null,
          targets: null,
        },
      }),
      finishChatTurn: async () => ({ ok: true, value: { turnsLeft: 17, targetWords: null, targetSource: null } }),
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
    ["위 레벨의 상황", "l3-pharmacy"],
  ])("%s이면 INVALID_INPUT이고 세션을 만들지 않는다", async (_label, scenarioId) => {
    const deps = createFakeDeps();

    const result = await startChatSession(deps, USER_ID, { language: "en", level: 2, scenarioId });

    expect(result).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(deps.db.createChatSession).not.toHaveBeenCalled();
  });

  it("그 레벨의 상황이면 세션을 만들고 sessionId를 돌려준다", async () => {
    const deps = createFakeDeps({ db: { createChatSession: async () => ({ ok: true, value: { sessionId: SESSION_ID } }) } });
    const input = { language: "ja", level: 3, scenarioId: "l3-pharmacy" } as const;

    const result = await startChatSession(deps, USER_ID, input);

    expect(result).toEqual({ ok: true, value: { sessionId: SESSION_ID } });
    expect(deps.db.createChatSession).toHaveBeenCalledWith(USER_ID, input, false);
  });

  // 세션 레벨은 상황 레벨이 아니라 지금 레벨이다(spec/chat.md "대화 진행")
  it("아래 레벨의 상황이면 요청 레벨을 그대로 넘긴다", async () => {
    const deps = createFakeDeps();
    const input = { language: "ja", level: 3, scenarioId: "l1-cafe" } as const;

    expect((await startChatSession(deps, USER_ID, input)).ok).toBe(true);
    expect(deps.db.createChatSession).toHaveBeenCalledWith(USER_ID, input, false);
  });

  it.each([
    ["l2-restaurant", false],
    ["l2-clothes", false],
    ["l2-train", true],
    ["l2-hair-salon", true],
    ["l1-plans", true],
  ])("%s는 Pro 상황 인자를 %s로 넘긴다", async (scenarioId, proOnly) => {
    const deps = createFakeDeps();
    const input = { language: "en", level: 2, scenarioId } as const;

    await startChatSession(deps, USER_ID, input);

    expect(deps.db.createChatSession).toHaveBeenCalledWith(USER_ID, input, proOnly);
  });

  it("RPC가 PRO_REQUIRED(Free의 Pro 상황)면 그대로 돌려준다", async () => {
    const deps = createFakeDeps({ db: { createChatSession: async () => ({ ok: false, code: "PRO_REQUIRED" }) } });

    const result = await startChatSession(deps, USER_ID, { language: "en", level: 1, scenarioId: "l1-taxi" });

    expect(result).toEqual({ ok: false, code: "PRO_REQUIRED" });
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

  it("예약 → AI → 성공 확정 순서로 부르고 { turnNo, turnsLeft, reply, targetWords, targetSource }를 돌려준다", async () => {
    const deps = reservedTurn();

    const result = await sendChatMessage(deps, USER_ID, SESSION_ID, "熱はないです。");

    expect(result).toEqual({ ok: true, value: { turnNo: 3, turnsLeft: 17, reply: REPLY, targetWords: null, targetSource: null } });
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
      value: {
        token: TOKEN,
        turnNo: 1,
        session: { ...SESSION, scenarioId: "l3-removed" },
        history: [],
        candidates: null,
        candidateSource: null,
        targets: null,
      },
    });

    await expect(sendChatMessage(deps, USER_ID, SESSION_ID, "hi")).rejects.toThrow();
    expect(deps.ai.generateTurn).not.toHaveBeenCalled();
  });
});

describe("sendChatMessage 배운 단어", () => {
  const CANDIDATES: WordCandidate[] = [
    { id: "ja-1-101", word: "美味しい", reading: "おいしい", meaningKo: "맛있다", usedToday: false },
    { id: "ja-1-102", word: "一緒に", reading: "いっしょに", meaningKo: "함께", usedToday: true },
    { id: "ja-1-103", word: "犬", reading: "いぬ", meaningKo: "개", usedToday: false },
  ];
  const TARGETS: TargetWord[] = [
    { id: "ja-1-101", word: "美味しい", reading: "おいしい", meaningKo: "맛있다", used: false },
    { id: "ja-1-102", word: "一緒に", reading: "いっしょに", meaningKo: "함께", used: true },
  ];

  function reserved(words: { candidates: WordCandidate[] | null; candidateSource: TargetSource | null; targets: TargetWord[] | null }) {
    return createFakeDeps({
      db: {
        beginChatTurn: async () => ({
          ok: true,
          value: { token: TOKEN, turnNo: 1, session: SESSION, history: [], ...words },
        }),
      },
      ai: { generateTurn: async () => ({ ok: true, value: REPLY }) },
    });
  }

  it("후보가 있으면 AI에 pick으로 넘긴다", async () => {
    const deps = reserved({ candidates: CANDIDATES, candidateSource: "today", targets: null });

    await sendChatMessage(deps, USER_ID, SESSION_ID, "ケーキをください。");

    expect(deps.ai.generateTurn).toHaveBeenCalledWith(
      expect.objectContaining({ words: { kind: "pick", candidates: CANDIDATES } }),
    );
  });

  it("고른 단어·쓴 단어 id를 출처와 함께 확정 RPC에 넘기고, 확정 RPC가 돌려준 목표 단어 상태를 응답에 담는다", async () => {
    const deps = reserved({ candidates: CANDIDATES, candidateSource: "today", targets: null });
    const words = { targetWordIds: ["ja-1-101", "ja-1-102"], usedWordIds: ["ja-1-102"] };
    deps.ai.generateTurn.mockResolvedValue({ ok: true, value: { ...REPLY, words } });
    deps.db.finishChatTurn.mockResolvedValue({ ok: true, value: { turnsLeft: 19, targetWords: TARGETS, targetSource: "today" } });

    const result = await sendChatMessage(deps, USER_ID, SESSION_ID, "ケーキも一緒にください。");

    expect(deps.db.finishChatTurn).toHaveBeenCalledWith(USER_ID, SESSION_ID, TOKEN, REPLY, {
      targetWordIds: ["ja-1-101", "ja-1-102"],
      targetSource: "today",
      usedWordIds: ["ja-1-102"],
    });
    expect(result).toEqual({
      ok: true,
      value: { turnNo: 1, turnsLeft: 19, reply: REPLY, targetWords: TARGETS, targetSource: "today" },
    });
    expect(result.ok && result.value.reply).not.toHaveProperty("words");
  });

  it("AI가 하나도 고르지 않아도 빈 배열과 출처를 넘긴다", async () => {
    const deps = reserved({ candidates: CANDIDATES, candidateSource: "recent", targets: null });
    deps.ai.generateTurn.mockResolvedValue({ ok: true, value: { ...REPLY, words: { targetWordIds: [], usedWordIds: [] } } });

    const result = await sendChatMessage(deps, USER_ID, SESSION_ID, "ケーキをください。");

    expect(deps.db.finishChatTurn).toHaveBeenCalledWith(USER_ID, SESSION_ID, TOKEN, REPLY, {
      targetWordIds: [],
      targetSource: "recent",
      usedWordIds: [],
    });
    expect(result).toEqual({ ok: true, value: { turnNo: 1, turnsLeft: 19, reply: REPLY, targetWords: null, targetSource: null } });
  });

  it("목표 단어가 있는 턴은 AI에 practice로 넘기고 확정 RPC에는 쓴 단어 id만 넘긴다", async () => {
    const deps = reserved({ candidates: null, candidateSource: null, targets: TARGETS });
    deps.ai.generateTurn.mockResolvedValue({ ok: true, value: { ...REPLY, words: { usedWordIds: ["ja-1-101"] } } });

    await sendChatMessage(deps, USER_ID, SESSION_ID, "とても美味しいです。");

    expect(deps.ai.generateTurn).toHaveBeenCalledWith(expect.objectContaining({ words: { kind: "practice", targets: TARGETS } }));
    expect(deps.db.finishChatTurn).toHaveBeenCalledWith(USER_ID, SESSION_ID, TOKEN, REPLY, { usedWordIds: ["ja-1-101"] });
  });

  it.each<[string, { candidates: WordCandidate[] | null; candidateSource: TargetSource | null; targets: TargetWord[] | null }]>([
    ["후보가 빈 배열", { candidates: [], candidateSource: null, targets: null }],
    ["목표 단어가 빈 배열", { candidates: null, candidateSource: null, targets: [] }],
    ["둘 다 null", { candidates: null, candidateSource: null, targets: null }],
  ])("%s이면 AI에 단어를 넘기지 않고 확정 RPC에도 넘기지 않는다", async (_, words) => {
    const deps = reserved(words);

    await sendChatMessage(deps, USER_ID, SESSION_ID, "hi");

    expect(deps.ai.generateTurn.mock.calls[0][0].words).toBeUndefined();
    expect(deps.db.finishChatTurn.mock.calls[0]).toEqual([USER_ID, SESSION_ID, TOKEN, REPLY]);
    expect(deps.db.finishChatTurn.mock.calls[0]).toHaveLength(4);
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

describe("openChatBreakdown", () => {
  // 기본 가짜(en 1, "Nice to meet you!")와 다른 값이라, AI 입력이 요청이 아니라 시작 RPC 결과에서 오는지 구분된다
  const INPUT = { turn_no: 3, target: "corrected" } as const;
  const SENTENCE = "[熱|ねつ]はありません。";
  const UNTIL = "2026-10-20T03:01:30.123456+00:00";
  const GENERATED: Breakdown = [
    { text: "[熱|ねつ]は", meaning_ko: "열은" },
    { text: "ありません。", meaning_ko: "없어요" },
  ];
  const STORED: Breakdown = [{ text: "[熱|ねつ]はありません。", meaning_ko: "열은 없어요" }];

  function started() {
    return createFakeDeps({
      db: {
        beginTurnBreakdown: async () => ({
          ok: true,
          value: { state: "started", sentence: SENTENCE, language: "ja", level: 3, scenarioId: "l3-pharmacy", until: UNTIL },
        }),
      },
      ai: { generateBreakdown: async () => ({ ok: true, value: { breakdown: GENERATED } }) },
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("저장본이면 그대로 돌려주고 AI·저장·실패 RPC를 부르지 않는다", async () => {
    const deps = createFakeDeps({
      db: { beginTurnBreakdown: async () => ({ ok: true, value: { state: "stored", breakdown: STORED } }) },
    });

    expect(await openChatBreakdown(deps, USER_ID, SESSION_ID, INPUT)).toEqual({ ok: true, value: { breakdown: STORED } });
    expect(deps.db.beginTurnBreakdown).toHaveBeenCalledWith(USER_ID, SESSION_ID, 3, "corrected");
    expect(deps.ai.generateBreakdown).not.toHaveBeenCalled();
    expect(deps.db.saveTurnBreakdown).not.toHaveBeenCalled();
    expect(deps.db.failTurnBreakdown).not.toHaveBeenCalled();
  });

  it("저장본이 없으면 시작 RPC의 문장·언어·레벨·상황 이름과 대상으로 AI를 부르고, 같은 기한 값으로 저장한 뒤 저장 RPC가 돌려준 값을 응답한다", async () => {
    const deps = started();

    expect(await openChatBreakdown(deps, USER_ID, SESSION_ID, INPUT)).toEqual({ ok: true, value: { breakdown: GENERATED } });
    expect(deps.ai.generateBreakdown).toHaveBeenCalledWith({
      language: "ja",
      level: 3,
      target: "corrected",
      situation: findScenario("l3-pharmacy")?.title,
      sentence: SENTENCE,
    });
    expect(findScenario("l3-pharmacy")?.title).toBeTruthy();
    expect(deps.db.saveTurnBreakdown).toHaveBeenCalledWith(USER_ID, SESSION_ID, 3, "corrected", UNTIL, GENERATED);
    expect(deps.db.failTurnBreakdown).not.toHaveBeenCalled();
    const order = [deps.db.beginTurnBreakdown, deps.ai.generateBreakdown, deps.db.saveTurnBreakdown].map(
      (fn) => fn.mock.invocationCallOrder[0],
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("상황 id를 찾지 못하면 상황 이름 없이 AI를 부른다", async () => {
    const deps = started();
    deps.db.beginTurnBreakdown.mockResolvedValueOnce({
      ok: true,
      value: { state: "started", sentence: SENTENCE, language: "ja", level: 3, scenarioId: "removed-scenario", until: UNTIL },
    });

    expect((await openChatBreakdown(deps, USER_ID, SESSION_ID, INPUT)).ok).toBe(true);
    expect(deps.ai.generateBreakdown).toHaveBeenCalledWith({ language: "ja", level: 3, target: "corrected", situation: undefined, sentence: SENTENCE });
  });

  it("저장 RPC가 먼저 저장된 값을 돌려주면 그 값을 응답한다", async () => {
    const deps = started();
    deps.db.saveTurnBreakdown.mockResolvedValue({ ok: true, value: { breakdown: STORED } });

    expect(await openChatBreakdown(deps, USER_ID, SESSION_ID, INPUT)).toEqual({ ok: true, value: { breakdown: STORED } });
  });

  // next build가 테스트 파일도 타입 검사하므로 케이스 타입을 명시한다
  it.each<[string, Db["saveTurnBreakdown"]]>([
    ["거부돼도(NOT_FOUND)", async () => ({ ok: false, code: "NOT_FOUND" })],
    [
      "throw해도",
      async () => {
        throw new Error("RPC save_turn_breakdown 실패: 08006 connection");
      },
    ],
  ])("저장이 %s 만든 값을 돌려주고, 문장·조각 내용 없이 로그만 남긴다", async (_, saveTurnBreakdown) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = started();
    deps.db.saveTurnBreakdown.mockImplementation(saveTurnBreakdown);

    expect(await openChatBreakdown(deps, USER_ID, SESSION_ID, INPUT)).toEqual({ ok: true, value: { breakdown: GENERATED } });
    expect(error).toHaveBeenCalledOnce();
    const line = JSON.parse(String(error.mock.calls[0][0]));
    expect(line).toMatchObject({ breakdown: "save_failed", sessionId: SESSION_ID, turnNo: 3, target: "corrected" });
    expect(line.code ?? line.error).toBeTruthy();
    const text = String(error.mock.calls[0][0]);
    expect(text).not.toContain("熱");
    expect(text).not.toContain("없어요");
  });

  it.each<DbErrorCode>(["NOT_FOUND", "CONSENT_REQUIRED", "ONBOARDING_REQUIRED", "INVALID_INPUT"])(
    "시작 RPC가 %s로 거부하면 그대로 돌려주고 AI를 부르지 않는다",
    async (code) => {
      const deps = createFakeDeps({ db: { beginTurnBreakdown: async () => ({ ok: false, code }) } });

      expect(await openChatBreakdown(deps, USER_ID, SESSION_ID, INPUT)).toEqual({ ok: false, code });
      expect(deps.ai.generateBreakdown).not.toHaveBeenCalled();
      expect(deps.db.saveTurnBreakdown).not.toHaveBeenCalled();
      expect(deps.db.failTurnBreakdown).not.toHaveBeenCalled();
    },
  );

  it.each<[DbErrorCode, string]>([
    ["AI_FAILURE_LIMIT", BREAKDOWN_FAILURE_LIMIT_MESSAGE],
    ["CONFLICT", BREAKDOWN_IN_PROGRESS_MESSAGE],
  ])("시작 RPC가 %s로 거부하면 뜯어보기용 문구로 돌려주고 AI를 부르지 않는다", async (code, message) => {
    const deps = createFakeDeps({ db: { beginTurnBreakdown: async () => ({ ok: false, code }) } });

    expect(await openChatBreakdown(deps, USER_ID, SESSION_ID, INPUT)).toEqual({ ok: false, code, message });
    expect(deps.ai.generateBreakdown).not.toHaveBeenCalled();
  });

  it("AI가 실패하면 같은 기한 값과 실패 사유로 실패 RPC를 부른 뒤 503 문구를 돌려주고 저장하지 않는다", async () => {
    const deps = started();
    deps.ai.generateBreakdown.mockResolvedValue({ ok: false, reason: "invalid_output" });

    expect(await openChatBreakdown(deps, USER_ID, SESSION_ID, INPUT)).toEqual({
      ok: false,
      code: "AI_UNAVAILABLE",
      message: BREAKDOWN_UNAVAILABLE_MESSAGE,
    });
    expect(deps.db.failTurnBreakdown).toHaveBeenCalledWith(USER_ID, SESSION_ID, 3, "corrected", UNTIL, "invalid_output");
    expect(deps.db.failTurnBreakdown.mock.invocationCallOrder[0]).toBeGreaterThan(
      deps.ai.generateBreakdown.mock.invocationCallOrder[0],
    );
    expect(deps.db.saveTurnBreakdown).not.toHaveBeenCalled();
  });

  it("실패 RPC가 거부하면 그 결과를 돌려준다", async () => {
    const deps = started();
    deps.ai.generateBreakdown.mockResolvedValue({ ok: false, reason: "timeout" });
    deps.db.failTurnBreakdown.mockResolvedValue({ ok: false, code: "NOT_FOUND" });

    expect(await openChatBreakdown(deps, USER_ID, SESSION_ID, INPUT)).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});
