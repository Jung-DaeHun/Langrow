import { z } from "zod";
import { getDeps } from "@/server/deps";
import { route } from "@/server/http";
import { explainWord } from "@/server/learning";

// AI 호출 예산(재시도 포함 약 40초)보다 길게 둔다
export const maxDuration = 60;

export const POST = route({
  requirement: "ready",
  body: z.object({
    word_id: z.string().min(1).max(50),
    // 빈칸에서 고른 보기. 복습은 보내지 않는다. 그 단어의 보기인지는 use-case가 DB 단어로 확인한다
    choice: z.string().min(1).max(50).optional(),
  }),
  handler: ({ userId, body }) => explainWord(getDeps(), userId, body),
});
