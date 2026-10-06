import { z } from "zod";
import { getDeps } from "@/server/deps";
import { route } from "@/server/http";

// 클라이언트만 아는 두 이벤트만 받는다. 나머지 이벤트는 서버가 기록한다
export const POST = route({
  requirement: "ready",
  body: z.object({ name: z.enum(["pro_clicked", "kana_studied"]) }),
  handler: ({ userId, body }) => getDeps().db.recordEvent(userId, body.name),
});
