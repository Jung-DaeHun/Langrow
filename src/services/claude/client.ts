import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { AutoParseableOutputFormat } from "@anthropic-ai/sdk/lib/parser";
import type { z } from "zod";
import { getClaudeEnv } from "@/services/env";
import { buildFeedbackPrompt, buildTurnPrompt, type FeedbackPromptInput, type TurnPromptInput } from "./prompts";
import { feedbackSchema, turnReplySchema, type Feedback, type TurnReply } from "./schemas";

const MAX_TOKENS = 1024;
const TIMEOUT_MS = 20_000;
const IMPROVE_MAX = 3;

export type AiFailureReason = "timeout" | "api_error" | "refusal" | "max_tokens" | "invalid_output";
export type AiResult<T> = { ok: true; value: T } | { ok: false; reason: AiFailureReason };
export type Ai = {
  generateTurn(input: TurnPromptInput): Promise<AiResult<TurnReply>>;
  generateFeedback(input: FeedbackPromptInput): Promise<AiResult<Feedback>>;
};

// 실제 SDK 클라이언트와 테스트의 가짜가 함께 맞추는 최소 타입
export type AiClient = {
  messages: {
    parse<T>(
      params: Anthropic.MessageCreateParamsNonStreaming & { output_config: { format: AutoParseableOutputFormat<T> } },
    ): PromiseLike<{ stop_reason: Anthropic.StopReason | null; parsed_output: T | null }>;
  };
};

type Prompt = { system: string; messages: Anthropic.MessageParam[] };

// 실패하면 딱 한 번 다시 부른다. 두 번 모두 실패하면 마지막 실패를 돌려준다
async function withRetry<T>(call: () => Promise<AiResult<T>>): Promise<AiResult<T>> {
  const first = await call();
  return first.ok ? first : call();
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
    try {
      const { client, model } = resolve();
      const { system, messages } = buildPrompt();
      const message = await client.messages.parse({
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages,
        output_config: { format: zodOutputFormat(schema) },
      });
      // 거절되거나 잘린 응답은 parsed_output이 있어도 실패다
      if (message.stop_reason === "refusal") return { ok: false, reason: "refusal" };
      if (message.stop_reason === "max_tokens") return { ok: false, reason: "max_tokens" };
      const value = message.parsed_output === null ? null : accept(message.parsed_output);
      return value === null ? { ok: false, reason: "invalid_output" } : { ok: true, value };
    } catch (error) {
      // 타임아웃 에러는 APIError의 하위 클래스라 먼저 확인한다
      if (error instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, reason: "timeout" };
      if (error instanceof Anthropic.APIError) return { ok: false, reason: "api_error" };
      // SDK는 JSON 파싱·zod 검증 실패를 APIError가 아닌 AnthropicError로 throw한다
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
