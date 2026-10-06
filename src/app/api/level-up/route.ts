import { z } from "zod";
import { hasValidTestIds } from "@/lib/levelTest";
import { canTakeLevelTest, LANGUAGES, LEVELS } from "@/lib/levels";
import { getDeps } from "@/server/deps";
import { route } from "@/server/http";
import { submitLevelUp } from "@/server/learning";

export const POST = route({
  requirement: "ready",
  body: z.object({
    language: z.enum(LANGUAGES),
    from_level: z.literal(LEVELS).refine(canTakeLevelTest),
    answers: z
      .array(z.object({ word_id: z.string().min(1).max(50), answer: z.string().max(50) }))
      .refine((answers) => hasValidTestIds(answers.map((a) => a.word_id))),
  }),
  handler: ({ userId, body }) => submitLevelUp(getDeps(), userId, body),
});
