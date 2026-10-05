import { describe, expect, it } from "vitest";
import { displayStreak, nextStreak } from "./streak";

const today = "2026-10-05";

describe("nextStreak", () => {
  it("처음 학습하면 1이다", () => {
    expect(nextStreak({ lastStudyDate: null, streak: 0 }, today)).toEqual({ lastStudyDate: today, streak: 1 });
  });

  it("오늘 이미 학습했으면 그대로다", () => {
    expect(nextStreak({ lastStudyDate: today, streak: 4 }, today)).toEqual({ lastStudyDate: today, streak: 4 });
  });

  it("어제 학습했으면 1 올린다", () => {
    expect(nextStreak({ lastStudyDate: "2026-10-04", streak: 4 }, today)).toEqual({ lastStudyDate: today, streak: 5 });
  });

  it("하루 이상 비었으면 1부터 다시 시작한다", () => {
    expect(nextStreak({ lastStudyDate: "2026-10-03", streak: 4 }, today)).toEqual({ lastStudyDate: today, streak: 1 });
  });

  it("월말·연말을 넘겨도 어제로 판단한다", () => {
    expect(nextStreak({ lastStudyDate: "2026-09-30", streak: 2 }, "2026-10-01")).toEqual({
      lastStudyDate: "2026-10-01",
      streak: 3,
    });
    expect(nextStreak({ lastStudyDate: "2026-12-31", streak: 2 }, "2027-01-01")).toEqual({
      lastStudyDate: "2027-01-01",
      streak: 3,
    });
  });
});

describe("displayStreak", () => {
  it("오늘이나 어제 학습했으면 streak를 보여 준다", () => {
    expect(displayStreak({ lastStudyDate: today, streak: 4 }, today)).toBe(4);
    expect(displayStreak({ lastStudyDate: "2026-10-04", streak: 4 }, today)).toBe(4);
  });

  it("그 밖에는 0이다", () => {
    expect(displayStreak({ lastStudyDate: "2026-10-03", streak: 4 }, today)).toBe(0);
    expect(displayStreak({ lastStudyDate: null, streak: 0 }, today)).toBe(0);
  });
});
