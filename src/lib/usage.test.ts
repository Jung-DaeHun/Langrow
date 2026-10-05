import { describe, expect, it } from "vitest";
import { addDays, kstDate, kstDayStart, remaining } from "./usage";

describe("kstDate", () => {
  it("UTC 15시가 한국 자정이다", () => {
    expect(kstDate(new Date("2026-10-04T14:59:59Z"))).toBe("2026-10-04");
    expect(kstDate(new Date("2026-10-04T15:00:00Z"))).toBe("2026-10-05");
  });

  it("연말 경계에서 해가 바뀐다", () => {
    expect(kstDate(new Date("2026-12-31T14:59:59Z"))).toBe("2026-12-31");
    expect(kstDate(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
  });
});

describe("kstDayStart", () => {
  it("한국 날짜 00:00(KST)의 시각을 돌려준다", () => {
    expect(kstDayStart("2026-10-05").toISOString()).toBe("2026-10-04T15:00:00.000Z");
  });

  it("kstDate와 왕복한다", () => {
    expect(kstDate(kstDayStart("2026-10-05"))).toBe("2026-10-05");
  });
});

describe("턴의 날짜", () => {
  it("23:59:50에 예약하고 다음 날 00:00:10에 성공한 턴은 예약한 날에 속한다", () => {
    const createdAt = new Date("2026-10-04T14:59:50Z"); // KST 10-04 23:59:50
    const doneAt = new Date("2026-10-04T15:00:10Z"); // KST 10-05 00:00:10
    const day = kstDate(createdAt);

    expect(day).toBe("2026-10-04");
    expect(kstDate(doneAt)).toBe("2026-10-05");
    // 그날 사용량 범위 [00:00, 다음 날 00:00)에 예약 시각이 들어간다
    expect(createdAt.getTime()).toBeGreaterThanOrEqual(kstDayStart(day).getTime());
    expect(createdAt.getTime()).toBeLessThan(kstDayStart(addDays(day, 1)).getTime());
  });
});

describe("addDays", () => {
  it("월말·연말을 넘긴다", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("음수면 이전 날짜로 간다", () => {
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("윤년 2월 29일을 지난다", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("0이면 그대로다", () => {
    expect(addDays("2026-10-05", 0)).toBe("2026-10-05");
  });
});

describe("remaining", () => {
  it("한도에서 사용량을 뺀다", () => {
    expect(remaining(3, 10)).toBe(7);
  });

  it("음수가 되지 않는다", () => {
    expect(remaining(10, 10)).toBe(0);
    expect(remaining(12, 10)).toBe(0);
  });
});
