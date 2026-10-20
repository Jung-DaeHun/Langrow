import { z } from "zod";
import { BREAKDOWN_TARGETS } from "@/lib/breakdown";
import { openChatBreakdown } from "@/server/chat";
import { getDeps } from "@/server/deps";
import { route } from "@/server/http";

// AI 호출 예산(재시도 포함 약 40초)보다 길게 둔다
export const maxDuration = 60;

// 문장·언어·레벨은 받지 않는다. 시작 RPC가 DB의 턴에서 꺼내고, 세션 언어의 레벨도 다시 확인한다(403)
export const POST = route({
  requirement: "ready",
  params: z.object({ id: z.uuid() }),
  body: z.object({ turn_no: z.number().int().min(1).max(20), target: z.enum(BREAKDOWN_TARGETS) }),
  handler: ({ userId, params, body }) => openChatBreakdown(getDeps(), userId, params.id, body),
});
