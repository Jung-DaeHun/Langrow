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
  correction: { corrected: "I'd like a latte.", explanation_ko: "I'd like가 더 공손해요." },
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
    expect(Object.keys(format.schema.properties).sort()).toEqual(["correction", "reply", "reply_ko"]);
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
