import { z } from "zod";
import { LANGUAGES, LEVELS } from "@/lib/levels";
import { getDeps } from "@/server/deps";
import { route } from "@/server/http";

// 첫 레벨이나 새 언어의 레벨을 만들 수 있게 동의만 확인한다. 이미 그 언어의 레벨이 있으면 RPC가 CONFLICT다
export const POST = route({
  requirement: "consent",
  body: z.object({ language: z.enum(LANGUAGES), level: z.literal(LEVELS) }),
  handler: ({ userId, body }) => getDeps().db.setFirstLevel(userId, body.language, body.level),
});
