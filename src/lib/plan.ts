export type Plan = "free" | "pro";

export const PLAN_LIMITS: Record<Plan, { chatTurns: number; newWords: number }> = {
  free: { chatTurns: 20, newWords: 10 },
  pro: { chatTurns: 150, newWords: 30 },
};

export const PRO_PRICE_KRW = 9900;
export const TRIAL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export function planAt(proUntil: Date | null, now: Date): Plan {
  return proUntil !== null && proUntil.getTime() > now.getTime() ? "pro" : "free";
}

export type TrialState =
  | { kind: "available" }
  | { kind: "active"; daysLeft: number }
  | { kind: "ended" };

export function trialState(trialStartedAt: Date | null, proUntil: Date | null, now: Date): TrialState {
  if (trialStartedAt === null) return { kind: "available" };
  if (proUntil === null || proUntil.getTime() <= now.getTime()) return { kind: "ended" };
  return { kind: "active", daysLeft: Math.ceil((proUntil.getTime() - now.getTime()) / DAY_MS) };
}
