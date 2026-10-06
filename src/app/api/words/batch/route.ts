import { z } from "zod";
import { LANGUAGES } from "@/lib/levels";
import { hasValidBatchIds } from "@/lib/wordBatch";
import { getDeps } from "@/server/deps";
import { route } from "@/server/http";
import { saveWords } from "@/server/learning";

export const POST = route({
  requirement: "ready",
  body: z.object({
    language: z.enum(LANGUAGES),
    items: z
      .array(z.object({ word_id: z.string().min(1).max(50), knew: z.boolean(), correct: z.boolean() }))
      .refine((items) => hasValidBatchIds(items.map((item) => item.word_id))),
  }),
  handler: ({ userId, body }) => saveWords(getDeps(), userId, body),
});
