import { getDeps } from "@/server/deps";
import { route } from "@/server/http";

// 최초 동의를 받아야 하므로 로그인만 확인한다
export const POST = route({
  requirement: "login",
  handler: async ({ userId }) => {
    await getDeps().db.agreeTerms(userId);
    return { ok: true, value: null };
  },
});
