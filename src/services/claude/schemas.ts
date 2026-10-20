import { z } from "zod";
import type { Breakdown } from "@/lib/breakdown";

// 길이·개수 제약(.min, .max)은 넣지 않는다. 구조화 출력이 지원하지 않는 제약은 SDK가 요청에서 빼고
// 응답 뒤에 검증해서, 사소한 초과도 AI 실패가 된다. 빈 reply와 improve 개수는 client.ts가 처리한다
// 문장 뜯어보기는 턴에서 받지 않고 처음 열 때 따로 만든다(spec/chat.md "처음 열 때 만들기", ADR-027)
export const turnReplySchema = z.object({
  reply: z.string(),
  reply_ko: z.string(),
  correction: z.object({ corrected: z.string(), explanation_ko: z.string() }).nullable(),
});
// 일본어 입문~중급 턴(spec/chat.md "한글 발음"). 발음 검사와 정리는 client.ts가 한다
export const pronTurnReplySchema = z.object({
  reply: z.string(),
  reply_ko: z.string(),
  reply_pron_ko: z.string(),
  correction: z.object({ corrected: z.string(), explanation_ko: z.string(), corrected_pron_ko: z.string() }).nullable(),
});
export type PronTurnReply = z.infer<typeof pronTurnReplySchema>;
// 배운 단어(spec/chat.md "배운 단어 써 보기"). 후보를 고르는 첫 턴(pick)은 target_words·used_words, 목표 단어가 있는 턴(practice)은
// used_words를 더 받는다. 번호는 1부터 붙인 목록 번호이고, 정수·범위 검사는 lib/targetWords가 한다
const WORD_FIELDS = {
  pick: { target_words: z.array(z.number()), used_words: z.array(z.number()) },
  practice: { used_words: z.array(z.number()) },
};
export type WordNumbers = { target_words?: number[]; used_words?: number[] };
// 단어가 없는 턴(kind 없음)은 받은 스키마 그대로다
export function withWordFields<T extends z.ZodRawShape>(schema: z.ZodObject<T>, kind: keyof typeof WORD_FIELDS | undefined) {
  return (kind ? schema.extend(WORD_FIELDS[kind]) : schema) as unknown as z.ZodType<z.infer<z.ZodObject<T>> & WordNumbers>;
}
// 저장·API·화면이 쓰는 턴 응답. 한글 발음은 일본어 입문~중급 턴에만 있다(spec/chat.md "한글 발음").
// 영어·상급 이상 턴과 기능을 넣기 전의 턴은 발음이 없거나 null이다.
// 문장 뜯어보기는 처음 열 때 만들었거나 2026-10-17~10-20에 턴과 함께 만든, 검사(lib/breakdown)를 통과한 것만 있다.
// 아직 열지 않았거나 맞지 않았거나 기능을 넣기 전의 턴은 null·키 없음이다(spec/chat.md "문장 뜯어보기")
export type TurnReply = {
  reply: string;
  reply_ko: string;
  reply_pron_ko?: string | null;
  reply_breakdown?: Breakdown | null;
  correction: {
    corrected: string;
    explanation_ko: string;
    corrected_pron_ko?: string | null;
    breakdown?: Breakdown;
  } | null;
};

export const feedbackSchema = z.object({
  good: z.string(),
  improve: z.array(z.object({ point: z.string(), example: z.string() })),
});
// 일본어 입문~중급 피드백(spec/chat.md "피드백 형식"). 발음 검사와 정리는 client.ts가 한다
export const pronFeedbackSchema = z.object({
  good: z.string(),
  improve: z.array(z.object({ point: z.string(), example: z.string(), example_pron_ko: z.string() })),
});
// 새로 만드는 피드백. example_pron_ko는 일본어 입문~중급만 있고, 검사에 맞지 않으면 null이다. 그 밖에는 키가 없다
export type FeedbackItem = { point: string; example: string; example_pron_ko?: string | null };
export type Feedback = { good: string; improve: FeedbackItem[] };
// 읽은 피드백. 2026-10-20 전에 만든 피드백은 improve가 문자열 배열이다(spec/chat.md "옛 형식")
export type StoredFeedback = { good: string; improve: (FeedbackItem | string)[] };

// AI 정답 설명. 빈 설명은 client.ts가 invalid_output으로 처리한다
export const explanationSchema = z.object({ explanation: z.string() });
export type Explanation = z.infer<typeof explanationSchema>;

// 문장 하나의 뜯어보기(spec/chat.md "처음 열 때 만들기"). 검사(lib/breakdown)와 정리는 client.ts가 한다
const breakdownSchema = z.array(z.object({ text: z.string(), meaning_ko: z.string() }));
export const breakdownReplySchema = z.object({ breakdown: breakdownSchema });
