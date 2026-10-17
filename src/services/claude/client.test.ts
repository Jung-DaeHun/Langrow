import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scenariosForLevel } from "@/lib/scenarios";
import { createAi, type AiClient } from "./client";
import {
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
  reply_breakdown: [
    { text: "Sure!", meaning_ko: "그럼요!" },
    { text: "What size?", meaning_ko: "어떤 크기로요?" },
  ],
  correction: {
    corrected: "I'd like a latte.",
    explanation_ko: "I'd like가 더 공손해요.",
    breakdown: [
      { text: "I'd like", meaning_ko: "주세요" },
      { text: "a latte.", meaning_ko: "라테 하나" },
    ],
  },
};
const feedback: Feedback = { good: "주문을 끝까지 해냈어요.", improve: ["I want → I'd like"] };

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

  it("요청에 주입한 model, max_tokens 4096, effort low, 구조화 출력 형식, 대화 프롬프트만 넣는다", async () => {
    const { ai, requests } = setup(done(reply));
    await ai.generateTurn(turnInput);
    const request = requests[0];
    const prompt = buildTurnPrompt(turnInput);
    expect(Object.keys(request).sort()).toEqual(["max_tokens", "messages", "model", "output_config", "system"]);
    expect(request).toMatchObject({ model: MODEL, max_tokens: 4096, system: prompt.system, messages: prompt.messages });
    const { format, effort } = request.output_config as { format: { type: string; schema: { properties: object } }; effort: string };
    expect(effort).toBe("low");
    expect(format.type).toBe("json_schema");
    expect(Object.keys(format.schema.properties).sort()).toEqual(["correction", "reply", "reply_breakdown", "reply_ko"]);
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
    expect(await ai.generateFeedback(feedbackInput)).toEqual({ ok: true, value: feedback });
    const prompt = buildFeedbackPrompt(feedbackInput);
    expect(requests[0]).toMatchObject({ model: MODEL, max_tokens: 4096, system: prompt.system, messages: prompt.messages });
    const { format, effort } = requests[0].output_config as { format: { schema: { properties: object } }; effort: string };
    expect(effort).toBe("low");
    expect(Object.keys(format.schema.properties).sort()).toEqual(["good", "improve"]);
  });

  it("improve가 3개를 넘으면 앞의 3개만 남긴다", async () => {
    const { ai } = setup(done({ good: "좋아요", improve: ["a", "b", "c", "d"] }));
    expect(await ai.generateFeedback(feedbackInput)).toEqual({ ok: true, value: { good: "좋아요", improve: ["a", "b", "c"] } });
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
    reply_breakdown: [
      { text: "はい、", meaning_ko: "네," },
      { text: "どうぞ。", meaning_ko: "여기요." },
    ],
    correction: {
      corrected: "コーヒーをください。",
      explanation_ko: "を를 넣어요.",
      corrected_pron_ko: "코-히-오 쿠다사이.",
      breakdown: [
        { text: "コーヒーを", meaning_ko: "커피를" },
        { text: "ください。", meaning_ko: "주세요." },
      ],
    },
  };
  const propertiesOf = (request: Record<string, unknown>) =>
    Object.keys((request.output_config as { format: { schema: { properties: object } } }).format.schema.properties).sort();

  it("일본어 입문~중급은 발음 필드가 있는 형식으로 요청하고, 발음은 앞뒤 공백을 지워 돌려준다", async () => {
    const { ai, requests } = setup(done(jaReply));
    expect(await ai.generateTurn(jaInput)).toEqual({ ok: true, value: { ...jaReply, reply_pron_ko: "하이, 도-조." } });
    expect(propertiesOf(requests[0])).toEqual(["correction", "reply", "reply_breakdown", "reply_ko", "reply_pron_ko"]);
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
    expect(propertiesOf(requests[0])).toEqual(["correction", "reply", "reply_breakdown", "reply_ko"]);
  });
});

describe("generateTurn 문장 뜯어보기", () => {
  const jaInput: TurnPromptInput = { language: "ja", level: 4, scenario: scenariosForLevel(4)[0], history: [], userText: "家で休みました" };
  const jaReply = {
    reply: "[家|いえ]で[休|やす]んでいました。",
    reply_ko: "집에서 쉬고 있었어요.",
    reply_breakdown: [
      { text: "家で", meaning_ko: "집에서" },
      { text: "休んでいました", meaning_ko: "쉬고 있었어요" },
    ],
    correction: {
      corrected: "[家|いえ]で[休|やす]みました。",
      explanation_ko: "자연스러워요.",
      breakdown: [
        { text: "家で", meaning_ko: "집에서" },
        { text: "休みました", meaning_ko: "쉬었어요" },
      ],
    },
  };
  const warnings = () => vi.spyOn(console, "warn").mockImplementation(() => {});

  it("통과한 뜯어보기는 원래 문장의 표기가 붙은 조각으로 돌아오고 로그가 없다", async () => {
    const warn = warnings();
    const { ai } = setup(done(jaReply));
    expect(await ai.generateTurn(jaInput)).toEqual({
      ok: true,
      value: {
        ...jaReply,
        reply_breakdown: [
          { text: "[家|いえ]で", meaning_ko: "집에서" },
          { text: "[休|やす]んでいました。", meaning_ko: "쉬고 있었어요" },
        ],
        correction: {
          ...jaReply.correction,
          breakdown: [
            { text: "[家|いえ]で", meaning_ko: "집에서" },
            { text: "[休|やす]みました。", meaning_ko: "쉬었어요" },
          ],
        },
      },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("reply 뜯어보기가 맞지 않으면 턴은 성공하고 reply_breakdown만 null이며, 내용 없이 warn 한 줄을 남긴다 (다시 부르지 않는다)", async () => {
    const warn = warnings();
    const bad = { ...jaReply, reply_breakdown: [{ text: "家で", meaning_ko: "집에서" }, { text: "休む", meaning_ko: "쉬다" }] };
    const { ai, requests } = setup(done(bad));
    const result = await ai.generateTurn(jaInput);

    expect(result.ok && result.value.reply_breakdown).toBeNull();
    expect(result.ok && result.value.correction?.breakdown).toEqual([
      { text: "[家|いえ]で", meaning_ko: "집에서" },
      { text: "[休|やす]みました。", meaning_ko: "쉬었어요" },
    ]);
    expect(requests).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(JSON.parse(line)).toEqual({ ai: "breakdown_invalid", target: "reply", language: "ja", level: 4 });
    for (const content of ["家", "休", "집에서", "쉬다"]) expect(line).not.toContain(content);
  });

  it("교정 뜯어보기가 맞지 않으면 턴은 성공하고 breakdown 키가 없으며, target corrected 로그를 남긴다 (다시 부르지 않는다)", async () => {
    const warn = warnings();
    const bad = { ...jaReply, correction: { ...jaReply.correction, breakdown: [{ text: "家で", meaning_ko: "집에서" }] } };
    const { ai, requests } = setup(done(bad));
    const result = await ai.generateTurn(jaInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.correction).toEqual({ corrected: jaReply.correction.corrected, explanation_ko: jaReply.correction.explanation_ko });
    expect(result.value.correction).not.toHaveProperty("breakdown");
    expect(result.value.reply_breakdown).toHaveLength(2);
    expect(requests).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toEqual({ ai: "breakdown_invalid", target: "corrected", language: "ja", level: 4 });
  });

  it("일본어 입문 턴도 발음과 함께 뜯어보기를 검사한다", async () => {
    const warn = warnings();
    const input: TurnPromptInput = { ...jaInput, level: 1, scenario: scenariosForLevel(1)[0] };
    const pronReply = {
      ...jaReply,
      reply_breakdown: [{ text: "家", meaning_ko: "집" }],
      reply_pron_ko: "이에데 야슨데이마시타.",
      correction: { ...jaReply.correction, corrected_pron_ko: "이에데 야스미마시타." },
    };
    const { ai } = setup(done(pronReply));
    const result = await ai.generateTurn(input);

    expect(result.ok && result.value).toMatchObject({ reply_breakdown: null, reply_pron_ko: "이에데 야슨데이마시타." });
    expect(result.ok && result.value.correction).toMatchObject({ corrected_pron_ko: "이에데 야스미마시타.", breakdown: [{ text: "[家|いえ]で" }, { text: "[休|やす]みました。" }] });
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toEqual({ ai: "breakdown_invalid", target: "reply", language: "ja", level: 1 });
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
