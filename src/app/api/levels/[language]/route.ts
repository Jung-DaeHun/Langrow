import { z } from "zod";
import { LANGUAGES, LEVELS } from "@/lib/levels";
import { getDeps } from "@/server/deps";
import { route } from "@/server/http";

// 내리기만 한다. 같거나 높은 레벨은 RPC가 CONFLICT다 (올리기는 레벨업 테스트로만)
export const PATCH = route({
  requirement: "ready",
  params: z.object({ language: z.enum(LANGUAGES) }),
  body: z.object({ level: z.literal(LEVELS) }),
  handler: ({ userId, params, body }) => getDeps().db.lowerLevel(userId, params.language, body.level),
});
