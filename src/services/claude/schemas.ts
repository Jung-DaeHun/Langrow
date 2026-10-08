import { z } from "zod";

// 길이·개수 제약(.min, .max)은 넣지 않는다. 구조화 출력이 지원하지 않는 제약은 SDK가 요청에서 빼고
// 응답 뒤에 검증해서, 사소한 초과도 AI 실패가 된다. 빈 reply와 improve 개수는 client.ts가 처리한다
export const turnReplySchema = z.object({
  reply: z.string(),
  reply_ko: z.string(),
  correction: z.object({ corrected: z.string(), explanation_ko: z.string() }).nullable(),
});
export type TurnReply = z.infer<typeof turnReplySchema>;

export const feedbackSchema = z.object({
  good: z.string(),
  improve: z.array(z.string()),
});
export type Feedback = z.infer<typeof feedbackSchema>;

// AI 정답 설명. 빈 설명은 client.ts가 invalid_output으로 처리한다
export const explanationSchema = z.object({ explanation: z.string() });
export type Explanation = z.infer<typeof explanationSchema>;
