import { z } from "zod";
import type { Breakdown } from "@/lib/breakdown";

// 길이·개수 제약(.min, .max)은 넣지 않는다. 구조화 출력이 지원하지 않는 제약은 SDK가 요청에서 빼고
// 응답 뒤에 검증해서, 사소한 초과도 AI 실패가 된다. 빈 reply와 improve 개수는 client.ts가 처리한다
// 문장 뜯어보기 조각(spec/chat.md "문장 뜯어보기"). 검사(lib/breakdown)와 정리는 client.ts가 한다
const breakdownSchema = z.array(z.object({ text: z.string(), meaning_ko: z.string() }));
export const turnReplySchema = z.object({
  reply: z.string(),
  reply_ko: z.string(),
  reply_breakdown: breakdownSchema,
  correction: z.object({ corrected: z.string(), explanation_ko: z.string(), breakdown: breakdownSchema }).nullable(),
});
// 일본어 입문~중급 턴(spec/chat.md "한글 발음"). 발음 검사와 정리는 client.ts가 한다
export const pronTurnReplySchema = z.object({
  reply: z.string(),
  reply_ko: z.string(),
  reply_pron_ko: z.string(),
  reply_breakdown: breakdownSchema,
  correction: z
    .object({ corrected: z.string(), explanation_ko: z.string(), corrected_pron_ko: z.string(), breakdown: breakdownSchema })
    .nullable(),
});
export type PronTurnReply = z.infer<typeof pronTurnReplySchema>;
// 저장·API·화면이 쓰는 턴 응답. 한글 발음은 일본어 입문~중급 턴에만 있다(spec/chat.md "한글 발음").
// 영어·상급 이상 턴과 기능을 넣기 전의 턴은 발음이 없거나 null이다.
// 문장 뜯어보기는 검사(lib/breakdown)를 통과한 것만 있고, 맞지 않았거나 기능을 넣기 전의 턴은 null·키 없음이다(spec/chat.md "문장 뜯어보기")
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
  improve: z.array(z.string()),
});
export type Feedback = z.infer<typeof feedbackSchema>;

// AI 정답 설명. 빈 설명은 client.ts가 invalid_output으로 처리한다
export const explanationSchema = z.object({ explanation: z.string() });
export type Explanation = z.infer<typeof explanationSchema>;
