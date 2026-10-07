import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { getClaudeEnv } from "@/services/env";
import { buildFeedbackPrompt, buildTurnPrompt, type FeedbackPromptInput, type TurnPromptInput } from "./prompts";
import { feedbackSchema, turnReplySchema, type Feedback, type TurnReply } from "./schemas";

const MAX_TOKENS = 1024;
const TIMEOUT_MS = 20_000;
const IMPROVE_MAX = 3;

// config: env가 없거나 비어 있음(배포 설정 오류). API를 부르지 않는다
export type AiFailureReason = "timeout" | "api_error" | "refusal" | "max_tokens" | "invalid_output" | "config";
export type AiResult<T> = { ok: true; value: T } | { ok: false; reason: AiFailureReason };
export type Ai = {
  generateTurn(input: TurnPromptInput): Promise<AiResult<TurnReply>>;
  generateFeedback(input: FeedbackPromptInput): Promise<AiResult<Feedback>>;
};

// 실제 SDK 클라이언트와 테스트의 가짜가 함께 맞추는 최소 타입
export type AiClient = {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
    ): PromiseLike<{ stop_reason: Anthropic.StopReason | null; content: Anthropic.ContentBlock[] }>;
  };
};

type Prompt = { system: string; messages: Anthropic.MessageParam[] };

// 실패하면 딱 한 번 다시 부른다. 두 번 모두 실패하면 마지막 실패를 돌려준다. 설정 오류는 다시 불러도 같다
async function withRetry<T>(call: () => Promise<AiResult<T>>): Promise<AiResult<T>> {
  const first = await call();
  return first.ok || first.reason === "config" ? first : call();
}

export function createAi(deps: { client?: AiClient; model?: string } = {}): Ai {
  let resolved: { client: AiClient; model: string } | undefined;

  // SDK 클라이언트와 env는 첫 호출 때 만든다. env 없이도 import와 next build가 통과해야 한다
  function resolve() {
    if (!resolved) {
      if (deps.client && deps.model) {
        resolved = { client: deps.client, model: deps.model };
      } else {
        const env = getClaudeEnv();
        resolved = {
          // SDK 자동 재시도는 끄고 withRetry로 1번만 다시 부른다
          client: deps.client ?? new Anthropic({ apiKey: env.apiKey, maxRetries: 0, timeout: TIMEOUT_MS }),
          model: deps.model ?? env.model,
        };
      }
    }
    return resolved;
  }

  // throw하지 않고 언제나 AiResult를 돌려준다. 프롬프트·응답 내용은 로그로 남기지 않는다
  async function attempt<T>(
    schema: z.ZodType<T>,
    buildPrompt: () => Prompt,
    accept: (value: T) => T | null,
  ): Promise<AiResult<T>> {
    let config: { client: AiClient; model: string };
    try {
      config = resolve();
    } catch (error) {
      // env 에러 메시지에는 키 이름만 있고 값은 없다(services/env.ts)
      console.error(JSON.stringify({ ai: "config", error: error instanceof Error ? error.message : String(error) }));
      return { ok: false, reason: "config" };
    }

    try {
      const { system, messages } = buildPrompt();
      const format = zodOutputFormat(schema);
      // messages.parse()는 stop_reason을 보기 전에 파싱하다 throw해서, 잘리거나 거절된 응답이 파싱 실패로 보인다.
      // 그래서 create()로 받아 stop_reason을 먼저 보고 직접 파싱한다
      const message = await config.client.messages.create({
        model: config.model,
        max_tokens: MAX_TOKENS,
        system,
        messages,
        output_config: { format },
      });
      if (message.stop_reason === "refusal") return { ok: false, reason: "refusal" };
      if (message.stop_reason === "max_tokens") return { ok: false, reason: "max_tokens" };
      const text = message.content.find((block) => block.type === "text")?.text;
      const value = text === undefined ? null : parseOutput(format, text);
      const accepted = value === null ? null : accept(value);
      return accepted === null ? { ok: false, reason: "invalid_output" } : { ok: true, value: accepted };
    } catch (error) {
      // 타임아웃 에러는 APIError의 하위 클래스라 먼저 확인한다
      if (error instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, reason: "timeout" };
      if (error instanceof Anthropic.APIError) return { ok: false, reason: "api_error" };
      return { ok: false, reason: "invalid_output" };
    }
  }

  return {
    generateTurn: (input) =>
      withRetry(() =>
        attempt(turnReplySchema, () => buildTurnPrompt(input), (value) => (value.reply.trim() ? value : null)),
      ),
    generateFeedback: (input) =>
      withRetry(() =>
        attempt(feedbackSchema, () => buildFeedbackPrompt(input), (value) => ({
          ...value,
          improve: value.improve.slice(0, IMPROVE_MAX),
        })),
      ),
  };
}

// JSON이 아니거나 스키마에 맞지 않으면 null
function parseOutput<T>(format: { parse(content: string): T }, text: string): T | null {
  try {
    return format.parse(text);
  } catch {
    return null;
  }
}
