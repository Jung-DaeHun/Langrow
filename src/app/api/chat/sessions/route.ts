import { z } from "zod";
import { LANGUAGES, LEVELS } from "@/lib/levels";
import { startChatSession } from "@/server/chat";
import { getDeps } from "@/server/deps";
import { route } from "@/server/http";

export const POST = route({
  requirement: "ready",
  body: z.object({
    language: z.enum(LANGUAGES),
    level: z.literal(LEVELS),
    scenario_id: z.string().min(1).max(50),
  }),
  handler: ({ userId, body }) =>
    startChatSession(getDeps(), userId, { language: body.language, level: body.level, scenarioId: body.scenario_id }),
});
