import { z } from "zod";
import { LANGUAGES } from "@/lib/levels";
import { getDeps } from "@/server/deps";
import { route } from "@/server/http";

// 현재 언어가 없어도 이미 레벨이 있는 언어로 복구할 수 있게 동의만 확인한다. 대상 언어의 레벨은 RPC가 확인한다
export const PUT = route({
  requirement: "consent",
  body: z.object({ language: z.enum(LANGUAGES) }),
  handler: ({ userId, body }) => getDeps().db.switchLanguage(userId, body.language),
});
