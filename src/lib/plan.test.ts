import { describe, expect, it } from "vitest";
import { PLAN_LIMITS, PRO_PRICE_KRW, TRIAL_DAYS, planAt, trialState } from "./plan";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-05T03:00:00Z");
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);

describe("plan 상수", () => {
  it("Free는 대화 20·단어 10, Pro는 대화 150·단어 30이다", () => {
    expect(PLAN_LIMITS).toEqual({
      free: { chatTurns: 20, newWords: 10 },
      pro: { chatTurns: 150, newWords: 30 },
    });
  });

  it("Pro 표시 가격은 9,900원, 체험은 7일이다", () => {
    expect(PRO_PRICE_KRW).toBe(9900);
    expect(TRIAL_DAYS).toBe(7);
  });
});

describe("planAt", () => {
  it("pro_until이 없으면 free다", () => {
    expect(planAt(null, now)).toBe("free");
  });

  it("pro_until이 지금보다 뒤면 pro다", () => {
    expect(planAt(at(1), now)).toBe("pro");
  });

  it("pro_until이 지금과 같거나 지났으면 free다", () => {
    expect(planAt(now, now)).toBe("free");
    expect(planAt(at(-1), now)).toBe("free");
  });
});

describe("trialState", () => {
  it("체험을 시작하지 않았으면 available이다", () => {
    expect(trialState(null, null, now)).toEqual({ kind: "available" });
  });

  it("체험 중이면 남은 일수를 올림해서 돌려준다", () => {
    const startedAt = at(-DAY_MS);
    expect(trialState(startedAt, at(7 * DAY_MS), now)).toEqual({ kind: "active", daysLeft: 7 });
    expect(trialState(startedAt, at(6 * DAY_MS), now)).toEqual({ kind: "active", daysLeft: 6 });
    expect(trialState(startedAt, at(6 * DAY_MS + 1), now)).toEqual({ kind: "active", daysLeft: 7 });
    expect(trialState(startedAt, at(1), now)).toEqual({ kind: "active", daysLeft: 1 });
  });

  it("pro_until이 지났거나 지금이면 ended다", () => {
    const startedAt = at(-7 * DAY_MS);
    expect(trialState(startedAt, now, now)).toEqual({ kind: "ended" });
    expect(trialState(startedAt, at(-1), now)).toEqual({ kind: "ended" });
  });
});
