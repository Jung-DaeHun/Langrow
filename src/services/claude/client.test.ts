import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scenariosForLevel } from "@/lib/scenarios";
import type { TargetWord, WordCandidate } from "@/lib/targetWords";
import { createAi, type AiClient, type BreakdownInput } from "./client";
import {
  buildBreakdownPrompt,
  buildExplanationPrompt,
  buildFeedbackPrompt,
  buildTurnPrompt,
  type ExplanationPromptInput,
  type FeedbackPromptInput,
  type TurnPromptInput,
} from "./prompts";
import type { Feedback, TurnReply } from "./schemas";

type FakeResponse = { stop_reason: Anthropic.StopReason | null; content: { type: string; text?: string }[] };

// 준비한 응답을 순서대로 돌려주고, 받은 요청을 기록한다
function fakeClient(...responses: (FakeResponse | Error)[]) {
  const requests: Record<string, unknown>[] = [];
  const client = {
    messages: {
      async create(params: Record<string, unknown>) {
        requests.push(params);
        const next = responses.shift();
        if (next === undefined) throw new Error("준비한 응답이 없다");
        if (next instanceof Error) throw next;
        return next;
      },
    },
  } as unknown as AiClient;
  return { client, requests };
}

const text = (stop_reason: Anthropic.StopReason, body: string): FakeResponse => ({
  stop_reason,
  content: [{ type: "text", text: body }],
});
const done = (value: unknown): FakeResponse => text("end_turn", JSON.stringify(value));

const scenario = scenariosForLevel(1)[1];
const turnInput: TurnPromptInput = { language: "en", level: 1, scenario, history: [], userText: "I want latte." };
const feedbackInput: FeedbackPromptInput = {
  language: "en",
  level: 1,
  scenario,
  turns: [{ userText: "I want latte.", reply: "Sure!", correction: null }],
};
const reply: TurnReply = {
  reply: "Sure! What size?",
  reply_ko: "네! 어떤 크기로 드릴까요?",
  correction: { corrected: "I'd like a latte.", explanation_ko: "I'd like가 더 공손해요." },
};
const feedback: Feedback = {
  good: "주문을 끝까지 해냈어요.",
  improve: [{ point: "I want보다 I'd like가 더 공손해요.", example: "I'd like a latte." }],
};
// 구조화 출력 형식에서 고칠 점 항목의 속성 이름
const improvePropertiesOf = (request: Record<string, unknown>) =>
  Object.keys(
    (request.output_config as { format: { schema: { properties: { improve: { items: { properties: object } } } } } }).format.schema
      .properties.improve.items.properties,
  ).sort();

const MODEL = "claude-test-model";

function setup(...responses: (FakeResponse | Error)[]) {
  const fake = fakeClient(...responses);
  return { ai: createAi({ client: fake.client, model: MODEL }), requests: fake.requests };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("createAi", () => {
  it("env가 없어도 만들 때는 throw하지 않는다 (SDK 클라이언트는 첫 호출 때 만든다)", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    expect(() => createAi()).not.toThrow();
  });
});

describe("generateTurn", () => {
  it("성공하면 파싱된 응답을 돌려주고 한 번만 부른다", async () => {
    const { ai, requests } = setup(done(reply));
    expect(await ai.generateTurn(turnInput)).toEqual({ ok: true, value: reply });
    expect(requests).toHaveLength(1);
  });

  it("요청에 주입한 model, max_tokens 4096, effort low, 구조화 출력 형식, 대화 프롬프트, 자동 캐싱만 넣는다", async () => {
    const { ai, requests } = setup(done(reply));
    await ai.generateTurn(turnInput);
    const request = requests[0];
    const prompt = buildTurnPrompt(turnInput);
    expect(Object.keys(request).sort()).toEqual(["cache_control", "max_tokens", "messages", "model", "output_config", "system"]);
    expect(request).toMatchObject({ model: MODEL, max_tokens: 4096, system: prompt.system, messages: prompt.messages });
    // 5분 TTL(기본값) 자동 캐싱: 마지막 블록(이번 사용자의 말)에 표시가 붙어 다음 턴이 여기까지를 캐시로 읽는다
    expect(request.cache_control).toEqual({ type: "ephemeral" });
    const { format, effort } = request.output_config as { format: { type: string; schema: { properties: object } }; effort: string };
    expect(effort).toBe("low");
    expect(format.type).toBe("json_schema");
    expect(Object.keys(format.schema.properties).sort()).toEqual(["correction", "reply", "reply_ko"]);
    // 뜯어보기는 처음 열 때 따로 만든다 (ADR-027)
    expect(JSON.stringify(format.schema)).not.toContain("breakdown");
  });

  it("첫 호출이 실패하면 한 번 더 불러 성공을 돌려준다", async () => {
    const { ai, requests } = setup(new Anthropic.APIConnectionError({ message: "connection failed" }), done(reply));
    expect(await ai.generateTurn(turnInput)).toEqual({ ok: true, value: reply });
    expect(requests).toHaveLength(2);
  });

  it("두 번 모두 실패하면 정확히 두 번 부르고 마지막 실패를 돌려준다", async () => {
    const { ai, requests } = setup(new Anthropic.APIConnectionTimeoutError(), text("refusal", "I can't help with that."));
    expect(await ai.generateTurn(turnInput)).toEqual({ ok: false, reason: "refusal" });
    expect(requests).toHaveLength(2);
  });

  it.each([
    ["거절 응답은 JSON이 아니어도 refusal", text("refusal", "I can't help with that."), "refusal"],
    ["잘린 JSON은 max_tokens", text("max_tokens", '{"reply": "Sure! What'), "max_tokens"],
    ["JSON이 아니면 invalid_output", text("end_turn", "Sure! What size?"), "invalid_output"],
    ["스키마에 맞지 않으면 invalid_output", done({ reply: "Sure!" }), "invalid_output"],
    ["text 블록이 없으면 invalid_output", { stop_reason: "end_turn", content: [] } as FakeResponse, "invalid_output"],
  ] as const)("%s", async (_, response, reason) => {
    const { ai, requests } = setup(response, response);
    expect(await ai.generateTurn(turnInput)).toEqual({ ok: false, reason });
    expect(requests).toHaveLength(2);
  });

  it("stop_reason을 응답 내용보다 먼저 본다", async () => {
    const truncated = text("max_tokens", JSON.stringify(reply));
    const { ai } = setup(truncated, truncated);
    expect(await ai.generateTurn(turnInput)).toEqual({ ok: false, reason: "max_tokens" });
  });

  it("reply가 공백뿐이면 invalid_output이다", async () => {
    const blank = done({ ...reply, reply: "  \n" });
    const { ai } = setup(blank, blank);
    expect(await ai.generateTurn(turnInput)).toEqual({ ok: false, reason: "invalid_output" });
  });

  it.each([
    ["타임아웃 에러는 timeout", new Anthropic.APIConnectionTimeoutError(), "timeout"],
    ["연결 오류는 api_error", new Anthropic.APIConnectionError({ message: "connection failed" }), "api_error"],
    ["HTTP 상태 오류는 api_error", new Anthropic.InternalServerError(529, undefined, "overloaded", new Headers()), "api_error"],
    ["그 밖의 예외는 invalid_output", new TypeError("unexpected"), "invalid_output"],
  ] as const)("%s", async (_, error, reason) => {
    const { ai, requests } = setup(error, error);
    expect(await ai.generateTurn(turnInput)).toEqual({ ok: false, reason });
    expect(requests).toHaveLength(2);
  });

  it("env가 없으면 API를 부르지 않고 다시 시도하지 않으며, 키 이름만 로그로 남기고 config로 실패한다", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = fakeClient(done(reply));
    const ai = createAi({ client: fake.client });
    expect(await ai.generateTurn(turnInput)).toEqual({ ok: false, reason: "config" });
    expect(fake.requests).toHaveLength(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("ANTHROPIC_API_KEY");
  });
});

describe("generateFeedback", () => {
  it("성공하면 피드백을 돌려주고 피드백 프롬프트와 스키마로 요청한다", async () => {
    const { ai, requests } = setup(done(feedback));
    const result = await ai.generateFeedback(feedbackInput);
    expect(result).toEqual({ ok: true, value: feedback });
    const prompt = buildFeedbackPrompt(feedbackInput);
    expect(requests[0]).toMatchObject({ model: MODEL, max_tokens: 4096, system: prompt.system, messages: prompt.messages });
    const { format, effort } = requests[0].output_config as { format: { schema: { properties: object } }; effort: string };
    expect(effort).toBe("low");
    expect(Object.keys(format.schema.properties).sort()).toEqual(["good", "improve"]);
    expect(improvePropertiesOf(requests[0])).toEqual(["example", "point"]);
    // 세션마다 한 번이라 다시 읽을 일이 없어 캐시를 쓰면 쓰기 할증(1.25배)만 낸다
    expect(requests[0]).not.toHaveProperty("cache_control");
    // 발음을 요청하지 않은 피드백의 항목에는 example_pron_ko 키가 없다
    expect(result.ok && result.value.improve[0]).not.toHaveProperty("example_pron_ko");
  });

  const item = (point: string, example = "I'd like a latte.") => ({ point, example });

  it.each([
    ["3개를 넘으면 앞의 3개만 남긴다", [item("a"), item("b"), item("c"), item("d")], [item("a"), item("b"), item("c")]],
    ["point가 공백뿐인 항목을 버린 뒤 3개까지 남긴다", [item("a"), item(" \n"), item("c"), item("d")], [item("a"), item("c"), item("d")]],
    ["point가 빈 항목만 있으면 빈 배열이다", [item("")], []],
  ])("고칠 점이 %s", async (_, improve, expected) => {
    const { ai, requests } = setup(done({ good: "좋아요", improve }));
    expect(await ai.generateFeedback(feedbackInput)).toEqual({ ok: true, value: { good: "좋아요", improve: expected } });
    expect(requests).toHaveLength(1);
  });

  it("example이 공백뿐이면 빈 문자열로 두고 피드백은 성공이다", async () => {
    const { ai } = setup(done({ good: "좋아요", improve: [item("a", "  \n"), item("b")] }));
    expect(await ai.generateFeedback(feedbackInput)).toEqual({
      ok: true,
      value: { good: "좋아요", improve: [item("a", ""), item("b")] },
    });
  });

  it("첫 호출이 실패하면 한 번 더 부르고, 두 번 실패하면 실패를 돌려준다", async () => {
    const { ai, requests } = setup(new Anthropic.APIConnectionTimeoutError(), new Anthropic.APIConnectionTimeoutError());
    expect(await ai.generateFeedback(feedbackInput)).toEqual({ ok: false, reason: "timeout" });
    expect(requests).toHaveLength(2);
  });
});

describe("generateExplanation", () => {
  const explanationInput: ExplanationPromptInput = {
    language: "ja",
    level: 1,
    sentence: "[朝|あさ]ごはんを[食|た]べました。",
    exampleKo: "아침밥을 먹었어요.",
    answer: "[食|た]べました",
    meaningKo: "먹다",
    choice: "[食|た]べる",
  };

  it("성공하면 설명을 돌려주고, 같은 model·effort와 { explanation } 형식·설명 프롬프트로 한 번 부른다", async () => {
    const { ai, requests } = setup(done({ explanation: "이미 먹은 일이라 과거형을 써요." }));

    expect(await ai.generateExplanation(explanationInput)).toEqual({
      ok: true,
      value: { explanation: "이미 먹은 일이라 과거형을 써요." },
    });
    expect(requests).toHaveLength(1);
    const prompt = buildExplanationPrompt(explanationInput);
    expect(requests[0]).toMatchObject({ model: MODEL, max_tokens: 4096, system: prompt.system, messages: prompt.messages });
    const { format, effort } = requests[0].output_config as { format: { schema: { properties: object } }; effort: string };
    expect(effort).toBe("low");
    expect(Object.keys(format.schema.properties)).toEqual(["explanation"]);
    // 시스템 프롬프트가 캐시 최소 길이(512토큰)보다 짧다
    expect(requests[0]).not.toHaveProperty("cache_control");
  });

  it("설명이 공백뿐이면 다시 부르고, 두 번 다 그러면 invalid_output이다", async () => {
    const blank = done({ explanation: " \n" });
    const { ai, requests } = setup(blank, blank);

    expect(await ai.generateExplanation(explanationInput)).toEqual({ ok: false, reason: "invalid_output" });
    expect(requests).toHaveLength(2);
  });
});

describe("generateTurn 한글 발음", () => {
  const jaInput: TurnPromptInput = { language: "ja", level: 1, scenario, history: [], userText: "コーヒーください" };
  const jaReply = {
    reply: "はい、どうぞ。",
    reply_ko: "네, 여기요.",
    reply_pron_ko: " 하이, 도-조. ",
    correction: { corrected: "コーヒーをください。", explanation_ko: "を를 넣어요.", corrected_pron_ko: "코-히-오 쿠다사이." },
  };
  const propertiesOf = (request: Record<string, unknown>) =>
    Object.keys((request.output_config as { format: { schema: { properties: object } } }).format.schema.properties).sort();

  it("일본어 입문~중급은 발음 필드가 있는 형식으로 요청하고, 발음은 앞뒤 공백을 지워 돌려준다", async () => {
    const { ai, requests } = setup(done(jaReply));
    expect(await ai.generateTurn(jaInput)).toEqual({ ok: true, value: { ...jaReply, reply_pron_ko: "하이, 도-조." } });
    expect(propertiesOf(requests[0])).toEqual(["correction", "reply", "reply_ko", "reply_pron_ko"]);
    expect(JSON.stringify(requests[0].output_config)).not.toContain("breakdown");
  });

  it("발음이 비었거나 가나·한자가 섞이면 턴은 성공하고 그 발음만 null이다 (다시 부르지 않는다)", async () => {
    const bad = { ...jaReply, reply_pron_ko: "", correction: { ...jaReply.correction, corrected_pron_ko: "코-히-を 쿠다사이." } };
    const { ai, requests } = setup(done(bad));
    expect(await ai.generateTurn(jaInput)).toEqual({
      ok: true,
      value: { ...bad, reply_pron_ko: null, correction: { ...bad.correction, corrected_pron_ko: null } },
    });
    expect(requests).toHaveLength(1);
  });

  it("교정이 없으면 correction은 null 그대로다", async () => {
    const { ai } = setup(done({ ...jaReply, correction: null }));
    expect(await ai.generateTurn(jaInput)).toEqual({
      ok: true,
      value: { ...jaReply, reply_pron_ko: "하이, 도-조.", correction: null },
    });
  });

  it("일본어 상급은 발음 없는 형식으로 요청하고 받은 값을 그대로 돌려준다", async () => {
    const { ai, requests } = setup(done(reply));
    expect(await ai.generateTurn({ ...jaInput, level: 4, scenario: scenariosForLevel(4)[0] })).toEqual({ ok: true, value: reply });
    expect(propertiesOf(requests[0])).toEqual(["correction", "reply", "reply_ko"]);
  });
});

describe("generateFeedback 한글 발음", () => {
  const jaInput = (level: 1 | 2 | 3 | 4 | 5): FeedbackPromptInput => ({
    ...feedbackInput,
    language: "ja",
    level,
    scenario: scenariosForLevel(level)[0],
  });
  const jaItem = {
    point: "[水|みず]에는 を를 붙여요.",
    example: "[水|みず]をください。",
    example_pron_ko: " 미즈오 쿠다사이. ",
  };

  it.each([1, 2, 3] as const)("일본어 레벨 %i: 발음 필드가 있는 형식으로 요청하고, 발음은 검사해 정리한 값으로 돌려준다", async (level) => {
    const { ai, requests } = setup(done({ good: "좋아요", improve: [jaItem] }));
    expect(await ai.generateFeedback(jaInput(level))).toEqual({
      ok: true,
      value: { good: "좋아요", improve: [{ ...jaItem, example_pron_ko: "미즈오 쿠다사이." }] },
    });
    expect(improvePropertiesOf(requests[0])).toEqual(["example", "example_pron_ko", "point"]);
  });

  it("발음이 비었거나 가나가 섞이면 피드백은 성공하고 그 항목의 발음만 null이다 (다시 부르지 않는다)", async () => {
    const improve = [
      { ...jaItem, example_pron_ko: "미즈を 쿠다사이." },
      { ...jaItem, example_pron_ko: "" },
      { ...jaItem, example_pron_ko: "타쿠상" },
    ];
    const { ai, requests } = setup(done({ good: "좋아요", improve }));
    expect(await ai.generateFeedback(jaInput(1))).toEqual({
      ok: true,
      value: {
        good: "좋아요",
        improve: [
          { ...jaItem, example_pron_ko: null },
          { ...jaItem, example_pron_ko: null },
          { ...jaItem, example_pron_ko: "타쿠산" },
        ],
      },
    });
    expect(requests).toHaveLength(1);
  });

  it("point가 빈 항목은 발음이 있어도 버린다", async () => {
    const { ai } = setup(done({ good: "좋아요", improve: [{ ...jaItem, point: " " }, jaItem] }));
    const result = await ai.generateFeedback(jaInput(2));
    expect(result.ok && result.value.improve).toEqual([{ ...jaItem, example_pron_ko: "미즈오 쿠다사이." }]);
  });

  it.each([4, 5] as const)("일본어 레벨 %i: 발음 없는 형식으로 요청하고 항목에 example_pron_ko 키가 없다", async (level) => {
    const { point, example } = jaItem;
    const { ai, requests } = setup(done({ good: "좋아요", improve: [{ point, example }] }));
    const result = await ai.generateFeedback(jaInput(level));
    expect(result).toEqual({ ok: true, value: { good: "좋아요", improve: [{ point, example }] } });
    expect(result.ok && result.value.improve[0]).not.toHaveProperty("example_pron_ko");
    expect(improvePropertiesOf(requests[0])).toEqual(["example", "point"]);
  });
});

describe("generateBreakdown", () => {
  const jaInput: BreakdownInput = { language: "ja", level: 4, target: "reply", sentence: "[家|いえ]で[休|やす]んでいました。" };
  const jaPieces = [
    { text: "家で", meaning_ko: "집에서" },
    { text: "休んでいました", meaning_ko: "쉬고 있었어요" },
  ];
  const badPieces = [
    { text: "家で", meaning_ko: "집에서" },
    { text: "休む", meaning_ko: "쉬다" },
  ];
  const warnings = () => vi.spyOn(console, "warn").mockImplementation(() => {});

  it("통과하면 원래 문장을 조각 경계에서 자른 조각을 돌려주고 로그가 없다", async () => {
    const warn = warnings();
    const { ai, requests } = setup(done({ breakdown: jaPieces }));
    expect(await ai.generateBreakdown(jaInput)).toEqual({
      ok: true,
      value: {
        breakdown: [
          { text: "[家|いえ]で", meaning_ko: "집에서" },
          { text: "[休|やす]んでいました。", meaning_ko: "쉬고 있었어요" },
        ],
      },
    });
    expect(requests).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("영어도 대소문자·문장부호를 원래 문장대로 돌려준다", async () => {
    const input: BreakdownInput = { language: "en", level: 1, target: "corrected", sentence: "I was resting at home." };
    const pieces = [
      { text: "i", meaning_ko: "나는" },
      { text: "was resting", meaning_ko: "쉬고 있었어요" },
      { text: "at home", meaning_ko: "집에서" },
    ];
    const { ai } = setup(done({ breakdown: pieces }));
    expect(await ai.generateBreakdown(input)).toEqual({
      ok: true,
      value: {
        breakdown: [
          { text: "I", meaning_ko: "나는" },
          { text: "was resting", meaning_ko: "쉬고 있었어요" },
          { text: "at home.", meaning_ko: "집에서" },
        ],
      },
    });
  });

  it("대화 턴과 같은 model·max_tokens 4096·effort low로, { breakdown } 형식과 뜯어보기 프롬프트를 넣고 시스템 블록에만 캐시를 건다", async () => {
    const { ai, requests } = setup(done({ breakdown: jaPieces }));
    await ai.generateBreakdown({ ...jaInput, situation: "카페에서 음료 주문하기" });
    const request = requests[0];
    const prompt = buildBreakdownPrompt({ language: "ja", situation: "카페에서 음료 주문하기", sentence: jaInput.sentence });
    // 문장(마지막 블록)이 호출마다 달라 요청 단위 자동 캐싱은 읽히지 않는다. 언어마다 같은 시스템 블록만 캐시한다
    expect(Object.keys(request).sort()).toEqual(["max_tokens", "messages", "model", "output_config", "system"]);
    expect(request).toMatchObject({
      model: MODEL,
      max_tokens: 4096,
      system: [{ type: "text", text: prompt.system, cache_control: { type: "ephemeral" } }],
      messages: prompt.messages,
    });
    const { format, effort } = request.output_config as { format: { type: string; schema: { properties: object } }; effort: string };
    expect(effort).toBe("low");
    expect(format.type).toBe("json_schema");
    expect(Object.keys(format.schema.properties)).toEqual(["breakdown"]);
  });

  it("검사에 맞지 않으면 내용 없이 breakdown_invalid 로그를 남기고 한 번 다시 부른 뒤 invalid_output이다", async () => {
    const warn = warnings();
    const bad = done({ breakdown: badPieces });
    const { ai, requests } = setup(bad, bad);

    expect(await ai.generateBreakdown(jaInput)).toEqual({ ok: false, reason: "invalid_output" });
    expect(requests).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(2);
    for (const [line] of warn.mock.calls) {
      expect(JSON.parse(String(line))).toEqual({ ai: "breakdown_invalid", target: "reply", language: "ja", level: 4 });
      for (const content of ["家", "休", "집에서", "쉬다"]) expect(String(line)).not.toContain(content);
    }
  });

  it("다시 불러 통과하면 성공이고 로그는 첫 실패의 한 줄이다", async () => {
    const warn = warnings();
    const input: BreakdownInput = { ...jaInput, level: 1, target: "corrected" };
    const { ai, requests } = setup(done({ breakdown: badPieces }), done({ breakdown: jaPieces }));

    expect((await ai.generateBreakdown(input)).ok).toBe(true);
    expect(requests).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toEqual({ ai: "breakdown_invalid", target: "corrected", language: "ja", level: 1 });
  });

  it.each([
    ["거절 응답은 refusal", text("refusal", "I can't help with that."), "refusal"],
    ["잘린 JSON은 max_tokens", text("max_tokens", '{"breakdown": [{"text": "家'), "max_tokens"],
    ["스키마에 맞지 않으면 invalid_output", done({ pieces: jaPieces }), "invalid_output"],
    ["타임아웃 에러는 timeout", new Anthropic.APIConnectionTimeoutError(), "timeout"],
    ["HTTP 상태 오류는 api_error", new Anthropic.InternalServerError(529, undefined, "overloaded", new Headers()), "api_error"],
  ] as const)("%s이고 한 번 다시 부른다", async (_, response, reason) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ai, requests } = setup(response, response);
    expect(await ai.generateBreakdown(jaInput)).toEqual({ ok: false, reason });
    expect(requests).toHaveLength(2);
  });
});

describe("API 오류 로그", () => {
  const errors = () => vi.spyOn(console, "error").mockImplementation(() => {});
  const logged = (log: ReturnType<typeof errors>) => log.mock.calls.map((call) => JSON.parse(String(call[0])));

  it("시도마다 상태·종류·요청 ID·300자에서 자른 문장을 남기고, 프롬프트·입력은 남기지 않는다", async () => {
    const log = errors();
    const body = { type: "error", error: { type: "invalid_request_error", message: `Your credit balance is too low. ${"x".repeat(400)}` } };
    const error = Anthropic.APIError.generate(400, body, undefined, new Headers({ "request-id": "req_abc" }));
    const { ai } = setup(error, error);

    expect(await ai.generateTurn(turnInput)).toEqual({ ok: false, reason: "api_error" });
    expect(logged(log)).toEqual([
      { ai: "api_error", status: 400, type: "invalid_request_error", requestId: "req_abc", message: error.message.slice(0, 300) },
      { ai: "api_error", status: 400, type: "invalid_request_error", requestId: "req_abc", message: error.message.slice(0, 300) },
    ]);
    expect(logged(log)[0].message).toHaveLength(300);
    const lines = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(lines).not.toContain(turnInput.userText);
    expect(lines).not.toContain(turnInput.scenario.roles.en.role);
  });

  it("연결 오류는 응답이 없어 없는 값(status·type·requestId)을 뺀다", async () => {
    const log = errors();
    const { ai } = setup(new Anthropic.APIConnectionError({ message: "connection failed" }), done(reply));

    expect(await ai.generateTurn(turnInput)).toEqual({ ok: true, value: reply });
    expect(logged(log)).toEqual([{ ai: "api_error", message: "connection failed" }]);
  });

  it("종료 피드백·AI 정답 설명의 API 오류도 남긴다", async () => {
    const log = errors();
    const overloaded = new Anthropic.InternalServerError(529, undefined, "overloaded", new Headers());
    const { ai } = setup(overloaded, done(feedback));

    expect(await ai.generateFeedback(feedbackInput)).toEqual({ ok: true, value: feedback });
    expect(logged(log)).toEqual([{ ai: "api_error", status: 529, message: overloaded.message }]);
  });

  it("타임아웃은 api_error 로그를 남기지 않는다", async () => {
    const log = errors();
    const { ai } = setup(new Anthropic.APIConnectionTimeoutError(), new Anthropic.APIConnectionTimeoutError());

    expect(await ai.generateTurn(turnInput)).toEqual({ ok: false, reason: "timeout" });
    expect(log).not.toHaveBeenCalled();
  });
});

describe("generateTurn 배운 단어", () => {
  const word = (id: string, text: string) => ({ id, word: text, reading: null, meaningKo: "뜻" });
  const candidates: WordCandidate[] = ["latte", "hot", "small", "large", "please", "cake", "dog"].map((text, i) => ({
    ...word(`en-1-10${i + 1}`, text),
    usedToday: false,
  }));
  const targets: TargetWord[] = [
    { ...word("en-1-102", "hot"), used: true },
    { ...word("en-1-104", "large"), used: false },
    { ...word("en-1-106", "cake"), used: false },
  ];
  const pickInput: TurnPromptInput = { ...turnInput, words: { kind: "pick", candidates } };
  const practiceInput: TurnPromptInput = { ...turnInput, words: { kind: "practice", targets } };
  const propertiesOf = (request: Record<string, unknown>) =>
    Object.keys((request.output_config as { format: { schema: { properties: object } } }).format.schema.properties).sort();
  const TURN_KEYS = ["correction", "reply", "reply_ko"];

  it("단어가 없는 턴은 단어 필드 없이 요청하고 결과에 words가 없다", async () => {
    const { ai, requests } = setup(done(reply));
    const result = await ai.generateTurn(turnInput);
    expect(propertiesOf(requests[0])).toEqual(TURN_KEYS);
    expect(result.ok && result.value).not.toHaveProperty("words");
  });

  it("후보를 고르는 턴은 target_words·used_words를 요청하고, 번호를 후보 id로 바꿔 reply와 따로 돌려준다", async () => {
    const { ai, requests } = setup(done({ ...reply, target_words: [3, 4, 1], used_words: [1] }));
    expect(await ai.generateTurn(pickInput)).toEqual({
      ok: true,
      value: { ...reply, words: { targetWordIds: ["en-1-103", "en-1-104", "en-1-101"], usedWordIds: ["en-1-101"] } },
    });
    expect(propertiesOf(requests[0])).toEqual([...TURN_KEYS, "target_words", "used_words"].sort());
    expect(requests[0].system).toBe(buildTurnPrompt(pickInput).system);
  });

  it("목표 단어가 있는 턴은 used_words만 요청하고, 번호를 목표 단어 id로 바꾼다", async () => {
    const { ai, requests } = setup(done({ ...reply, used_words: [2, 3] }));
    const result = await ai.generateTurn(practiceInput);
    expect(result).toEqual({ ok: true, value: { ...reply, words: { usedWordIds: ["en-1-104", "en-1-106"] } } });
    expect(result.ok && result.value.words).not.toHaveProperty("targetWordIds");
    expect(propertiesOf(requests[0])).toEqual([...TURN_KEYS, "used_words"].sort());
    expect(requests[0].system).toBe(buildTurnPrompt(practiceInput).system);
  });

  it("범위 밖·소수·중복 번호와 고르지 않은 쓴 번호는 버리고 턴은 성공한다 (다시 부르지 않는다)", async () => {
    const { ai, requests } = setup(done({ ...reply, target_words: [0, 2, 2, 8, 1.5, -1], used_words: [2, 5, 9, 2] }));
    expect(await ai.generateTurn(pickInput)).toEqual({
      ok: true,
      value: { ...reply, words: { targetWordIds: ["en-1-102"], usedWordIds: ["en-1-102"] } },
    });
    expect(requests).toHaveLength(1);
  });

  it("6개 이상 고르면 앞의 5개만 남기고, 잘린 단어의 쓴 번호도 버린다", async () => {
    const { ai, requests } = setup(done({ ...reply, target_words: [1, 2, 3, 4, 5, 6, 7], used_words: [6, 1] }));
    expect(await ai.generateTurn(pickInput)).toEqual({
      ok: true,
      value: {
        ...reply,
        words: { targetWordIds: ["en-1-101", "en-1-102", "en-1-103", "en-1-104", "en-1-105"], usedWordIds: ["en-1-101"] },
      },
    });
    expect(requests).toHaveLength(1);
  });

  it("목표 단어 밖의 쓴 번호는 버리고 턴은 성공한다", async () => {
    const { ai, requests } = setup(done({ ...reply, used_words: [0, 4, 1, 1] }));
    expect(await ai.generateTurn(practiceInput)).toEqual({ ok: true, value: { ...reply, words: { usedWordIds: ["en-1-102"] } } });
    expect(requests).toHaveLength(1);
  });

  it("아무것도 고르지 않으면 빈 배열이다", async () => {
    const { ai } = setup(done({ ...reply, target_words: [], used_words: [] }));
    expect(await ai.generateTurn(pickInput)).toEqual({ ok: true, value: { ...reply, words: { targetWordIds: [], usedWordIds: [] } } });
  });

  it("번호가 숫자가 아니면 스키마에 맞지 않아 다시 부른다", async () => {
    const bad = done({ ...reply, target_words: ["latte"], used_words: [] });
    const { ai, requests } = setup(bad, done({ ...reply, target_words: [1], used_words: [] }));
    expect(await ai.generateTurn(pickInput)).toEqual({
      ok: true,
      value: { ...reply, words: { targetWordIds: ["en-1-101"], usedWordIds: [] } },
    });
    expect(requests).toHaveLength(2);
  });

  it("일본어 발음 턴도 발음 필드와 함께 단어 필드를 요청하고 둘 다 처리한다", async () => {
    const jaCandidates: WordCandidate[] = [
      { id: "ja-1-101", word: "美味しい", reading: "おいしい", meaningKo: "맛있다", usedToday: false },
      { id: "ja-1-102", word: "一緒に", reading: "いっしょに", meaningKo: "함께", usedToday: false },
    ];
    const jaInput: TurnPromptInput = {
      language: "ja",
      level: 1,
      scenario,
      history: [],
      userText: "ケーキも一緒にください",
      words: { kind: "pick", candidates: jaCandidates },
    };
    const jaReply = {
      reply: "はい、どうぞ。",
      reply_ko: "네, 여기요.",
      reply_pron_ko: " 하이, 도-조. ",
      correction: null,
    };
    const { ai, requests } = setup(done({ ...jaReply, target_words: [1, 2], used_words: [2] }));
    expect(await ai.generateTurn(jaInput)).toEqual({
      ok: true,
      value: { ...jaReply, reply_pron_ko: "하이, 도-조.", words: { targetWordIds: ["ja-1-101", "ja-1-102"], usedWordIds: ["ja-1-102"] } },
    });
    expect(propertiesOf(requests[0])).toEqual([...TURN_KEYS, "reply_pron_ko", "target_words", "used_words"].sort());
  });

  it("단어 턴은 로그를 남기지 않는다", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const { ai } = setup(done({ ...reply, target_words: [9, 1], used_words: [3] }));
    expect((await ai.generateTurn(pickInput)).ok).toBe(true);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
