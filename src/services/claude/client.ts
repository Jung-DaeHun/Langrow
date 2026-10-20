import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { alignBreakdown, type Breakdown, type BreakdownTarget } from "@/lib/breakdown";
import { showsPronunciation, type Language, type Level } from "@/lib/levels";
import { cleanPron } from "@/lib/pronunciation";
import { pickTargetIds, pickUsedIds } from "@/lib/targetWords";
import { getClaudeEnv } from "@/services/env";
import {
  buildBreakdownPrompt,
  buildExplanationPrompt,
  buildFeedbackPrompt,
  buildTurnPrompt,
  type ExplanationPromptInput,
  type FeedbackPromptInput,
  type TurnPromptInput,
} from "./prompts";
import {
  breakdownReplySchema,
  explanationSchema,
  feedbackSchema,
  pronFeedbackSchema,
  pronTurnReplySchema,
  turnReplySchema,
  withWordFields,
  type Explanation,
  type Feedback,
  type PronTurnReply,
  type TurnReply,
  type WordNumbers,
} from "./schemas";

// Sonnet 5.5는 adaptive thinking이 기본이고 thinking도 max_tokens에 들어간다. 응답(약 500토큰 이하)에 여유를 둔다
const MAX_TOKENS = 4096;
// 대화는 low: 쉬운 턴은 thinking을 건너뛰고 까다로운 턴만 짧게 생각한다
const EFFORT = "low";
const TIMEOUT_MS = 20_000;
const IMPROVE_MAX = 3;

// config: env가 없거나 비어 있음(배포 설정 오류). API를 부르지 않는다
export type AiFailureReason = "timeout" | "api_error" | "refusal" | "max_tokens" | "invalid_output" | "config";
export type AiResult<T> = { ok: true; value: T } | { ok: false; reason: AiFailureReason };
// 배운 단어가 있는 턴(input.words)이면 AI가 준 번호를 단어 id로 바꿔 words로 붙인다. 고르는 첫 턴만 targetWordIds가 있다.
// 저장·API의 reply에는 넣지 않는다(use-case가 떼어 낸다)
export type TurnWordIds = { targetWordIds?: string[]; usedWordIds: string[] };
export type GeneratedTurn = TurnReply & { words?: TurnWordIds };
// 문장 하나의 뜯어보기(spec/chat.md "처음 열 때 만들기"). target·level은 검사 실패 로그에만 쓰고 프롬프트에는 넣지 않는다
// situation은 세션 상황의 이름이다. 뜻을 상황에 맞게 정하려고 넣는다(없으면 상황 줄 없이 부른다)
export type BreakdownInput = { language: Language; level: Level; target: BreakdownTarget; situation?: string; sentence: string };
export type Ai = {
  generateTurn(input: TurnPromptInput): Promise<AiResult<GeneratedTurn>>;
  generateFeedback(input: FeedbackPromptInput): Promise<AiResult<Feedback>>;
  generateExplanation(input: ExplanationPromptInput): Promise<AiResult<Explanation>>;
  generateBreakdown(input: BreakdownInput): Promise<AiResult<{ breakdown: Breakdown }>>;
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

  // throw하지 않고 언제나 AiResult를 돌려준다. 프롬프트·응답 내용은 로그로 남기지 않는다.
  // cache: 캐시(5분)를 건다. 다음 요청이 같은 앞부분을 다시 보낼 때만 이득이다.
  // request는 요청 단위 자동 캐싱으로 대화 턴이 쓴다(ADR-026). system은 시스템 블록에만 표시를 달아,
  // 마지막 블록이 호출마다 다른 문장 뜯어보기가 언어마다 같은 시스템 프롬프트를 다시 읽게 한다(ADR-027)
  async function attempt<S, T>(
    schema: z.ZodType<S>,
    buildPrompt: () => Prompt,
    accept: (value: S) => T | null,
    cache: "none" | "request" | "system" = "none",
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
        system: cache === "system" ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : system,
        messages,
        output_config: { format, effort: EFFORT },
        ...(cache === "request" ? { cache_control: { type: "ephemeral" } as const } : {}),
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
      if (error instanceof Anthropic.APIError) {
        // 원인(지출 한도 초과 등)을 알 수 있게 Anthropic이 돌려준 값만 남긴다(ADR-017).
        // 연결 오류처럼 응답이 없어 없는 값은 JSON.stringify가 뺀다
        console.error(
          JSON.stringify({
            ai: "api_error",
            status: error.status,
            type: error.type ?? undefined,
            requestId: error.requestID ?? undefined,
            message: error.message.slice(0, 300),
          }),
        );
        return { ok: false, reason: "api_error" };
      }
      return { ok: false, reason: "invalid_output" };
    }
  }

  return {
    generateTurn: (input) =>
      withRetry(() =>
        showsPronunciation(input.language, input.level)
          ? attempt(
              withWordFields(pronTurnReplySchema, input.words?.kind),
              () => buildTurnPrompt(input),
              (value) => acceptTurn(input, cleanTurnPron(value)),
              "request",
            )
          : attempt(
              withWordFields(turnReplySchema, input.words?.kind),
              () => buildTurnPrompt(input),
              (value) => acceptTurn(input, value),
              "request",
            ),
      ),
    generateFeedback: (input) =>
      withRetry(() =>
        showsPronunciation(input.language, input.level)
          ? attempt(pronFeedbackSchema, () => buildFeedbackPrompt(input), (value) =>
              acceptFeedback(cleanFeedbackPron(value)),
            )
          : attempt(feedbackSchema, () => buildFeedbackPrompt(input), acceptFeedback),
      ),
    generateExplanation: (input) =>
      withRetry(() =>
        attempt(explanationSchema, () => buildExplanationPrompt(input), (value) =>
          value.explanation.trim() ? value : null,
        ),
      ),
    generateBreakdown: ({ language, level, target, situation, sentence }) =>
      withRetry(() =>
        attempt(
          breakdownReplySchema,
          () => buildBreakdownPrompt({ language, situation, sentence }),
          (value) => {
            const breakdown = alignBreakdown(sentence, value.breakdown);
            // 통과율을 운영 로그로 보기 위해 남긴다. 문장·조각 내용은 남기지 않는다
            if (!breakdown) console.warn(JSON.stringify({ ai: "breakdown_invalid", target, language, level }));
            return breakdown && { breakdown };
          },
          "system",
        ),
      ),
  };
}

// 발음이 비었거나 검사에 맞지 않으면 턴은 성공으로 두고 그 발음만 null로 숨긴다 (spec/chat.md "한글 발음")
function cleanTurnPron<T extends PronTurnReply>(value: T) {
  return {
    ...value,
    reply_pron_ko: cleanPron(value.reply_pron_ko),
    correction: value.correction && {
      ...value.correction,
      corrected_pron_ko: cleanPron(value.correction.corrected_pron_ko),
    },
  };
}

// 예문 발음도 턴과 같다. 맞지 않는 발음만 null로 숨기고 피드백은 성공이다 (spec/chat.md "피드백 형식" "검사")
function cleanFeedbackPron(value: z.infer<typeof pronFeedbackSchema>): Feedback {
  return { ...value, improve: value.improve.map((item) => ({ ...item, example_pron_ko: cleanPron(item.example_pron_ko) })) };
}

// point가 공백뿐인 항목을 버린 뒤 앞에서 3개까지 남긴다(빈 항목 때문에 맞는 항목이 잘리지 않게).
// 공백뿐인 example은 빈 문자열로 둔다
function acceptFeedback(value: Feedback): Feedback {
  return {
    ...value,
    improve: value.improve
      .filter((item) => item.point.trim())
      .slice(0, IMPROVE_MAX)
      .map((item) => (item.example.trim() ? item : { ...item, example: "" })),
  };
}

// reply가 공백뿐이면 null(invalid_output)
function acceptTurn({ words }: TurnPromptInput, output: TurnReply & WordNumbers): GeneratedTurn | null {
  const { target_words, used_words, ...turn } = output;
  if (!turn.reply.trim()) return null;
  return words ? { ...turn, words: wordIds(words, target_words ?? [], used_words ?? []) } : turn;
}

// 번호를 단어 id로 바꾼다. 맞지 않는 번호는 버리고 턴은 성공으로 둔다 (spec/chat.md "배운 단어 써 보기" "검사")
function wordIds(words: NonNullable<TurnPromptInput["words"]>, targetNumbers: number[], usedNumbers: number[]): TurnWordIds {
  if (words.kind === "pick") {
    const ids = words.candidates.map((word) => word.id);
    const targetWordIds = pickTargetIds(ids, targetNumbers);
    return { targetWordIds, usedWordIds: pickUsedIds(ids, usedNumbers, targetWordIds) };
  }
  const ids = words.targets.map((word) => word.id);
  return { usedWordIds: pickUsedIds(ids, usedNumbers, ids) };
}

// JSON이 아니거나 스키마에 맞지 않으면 null
function parseOutput<T>(format: { parse(content: string): T }, text: string): T | null {
  try {
    return format.parse(text);
  } catch {
    return null;
  }
}
