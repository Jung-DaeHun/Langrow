import { z } from "zod";
import { LANGUAGES } from "@/lib/levels";
import { hasValidBatchIds } from "@/lib/wordBatch";
import { getDeps } from "@/server/deps";
import { route } from "@/server/http";

export const POST = route({
  requirement: "ready",
  body: z.object({
    language: z.enum(LANGUAGES),
    items: z
      .array(z.object({ word_id: z.string().min(1).max(50), knew: z.boolean() }))
      .refine((items) => hasValidBatchIds(items.map((item) => item.word_id))),
  }),
  handler: ({ userId, body }) =>
    getDeps().db.saveReview(
      userId,
      body.language,
      body.items.map((item) => ({ wordId: item.word_id, knew: item.knew })),
    ),
});
