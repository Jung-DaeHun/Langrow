import { getDeps } from "@/server/deps";
import { route, type Outcome } from "@/server/http";
import type { TrialResponse } from "@/types/api";

// 계정당 1번. 이미 시작했으면 RPC가 CONFLICT다
export const POST = route({
  requirement: "ready",
  handler: async ({ userId }): Promise<Outcome<TrialResponse>> => {
    const result = await getDeps().db.startTrial(userId);
    return result.ok ? { ok: true, value: { proUntil: result.value.proUntil.toISOString() } } : result;
  },
});
