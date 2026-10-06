import { z } from "zod";
import { endChatSession } from "@/server/chat";
import { getDeps } from "@/server/deps";
import { route } from "@/server/http";

// AI 호출 예산(재시도 포함 약 40초)보다 길게 둔다
export const maxDuration = 60;

export const POST = route({
  requirement: "ready",
  params: z.object({ id: z.uuid() }),
  handler: ({ userId, params }) => endChatSession(getDeps(), userId, params.id),
});
