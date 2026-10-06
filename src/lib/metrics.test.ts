import { describe, expect, it } from "vitest";
import { computeMetrics, type MetricResult, type MetricsRows } from "./metrics";
import { TRIAL_DAYS } from "./plan";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = new Date("2026-10-01T10:00:00+09:00");
const LATER = new Date("2026-12-31T00:00:00+09:00");

const after = (base: Date, ms: number) => new Date(base.getTime() + ms);

type Profile = MetricsRows["profiles"][number];

// 기본: T0 가입, 1시간 뒤 온보딩
function user(id: string, overrides: Partial<Profile> = {}): Profile {
  return { id, createdAt: T0, onboardedAt: after(T0, HOUR), trialStartedAt: null, ...overrides };
}

function crowd(n: number, prefix: string, overrides: Partial<Profile> = {}): Profile[] {
  return Array.from({ length: n }, (_, i) => user(`${prefix}${i}`, overrides));
}

function rows(partial: Partial<MetricsRows>): MetricsRows {
  return { profiles: [], doneTurns: [], activityDays: [], events: [], ...partial };
}

function sessionTurns(userId: string, sessionId: string, times: Date[]): MetricsRows["doneTurns"] {
  return times.map((createdAt) => ({ userId, sessionId, createdAt }));
}

function limitReached(userId: string, createdAt: Date, props: Record<string, unknown> = {}): MetricsRows["events"][number] {
  return { userId, name: "limit_reached", props: { feature: "words", plan: "free", trial_eligible: true, ...props }, createdAt };
}

function proClicked(userId: string, createdAt: Date): MetricsRows["events"][number] {
  return { userId, name: "pro_clicked", props: {}, createdAt };
}

function compute(
  input: MetricsRows,
  options: { now?: Date; excludedUserIds?: ReadonlySet<string>; launchDate?: string } = {},
): MetricResult[] {
  return computeMetrics(input, { now: LATER, excludedUserIds: new Set(), ...options });
}

function metric(results: MetricResult[], key: string): MetricResult {
  const found = results.find((m) => m.key === key);
  if (!found) throw new Error(`${key} 지표가 없다`);
  return found;
}

const counts = (m: MetricResult) => [m.numerator, m.denominator];

describe("computeMetrics", () => {
  it("지표마다 라벨과 분자/분모를 낸다", () => {
    const keys = compute(rows({})).map((m) => m.key);
    expect(keys).toEqual([
      "onboarding",
      "first_session",
      "d1",
      "d7",
      "limit_to_trial",
      "limit_to_trial_words",
      "limit_to_trial_chat",
      "pro_after_trial",
    ]);
    for (const m of compute(rows({}))) expect(m.label).not.toBe("");
  });

  describe("온보딩 완료율", () => {
    it("가입 후 24시간 안에 온보딩한 사용자만 분자다", () => {
      const result = compute(
        rows({
          profiles: [
            user("a"),
            user("b", { onboardedAt: after(T0, 25 * HOUR) }),
            user("c", { onboardedAt: null }),
          ],
        }),
      );
      expect(counts(metric(result, "onboarding"))).toEqual([1, 3]);
    });

    it("가입 후 24시간이 지나지 않은 사용자는 분모에서 뺀다", () => {
      const result = compute(rows({ profiles: [user("a")] }), { now: after(T0, 23 * HOUR) });
      expect(counts(metric(result, "onboarding"))).toEqual([0, 0]);
    });

    it("온보딩 50명 이상이면 60% 기준으로 판단한다", () => {
      const late = { onboardedAt: after(T0, 30 * HOUR) };
      const pass = compute(rows({ profiles: [...crowd(30, "on"), ...crowd(20, "late", late)] }));
      expect(metric(pass, "onboarding")).toMatchObject({ numerator: 30, denominator: 50, verdict: "pass" });
      const fail = compute(rows({ profiles: [...crowd(29, "on"), ...crowd(21, "late", late)] }));
      expect(metric(fail, "onboarding")).toMatchObject({ numerator: 29, denominator: 50, verdict: "fail" });
    });
  });

  describe("첫 세션 완료율", () => {
    const onboardedAt = after(T0, HOUR);

    it("한 세션에 done 턴이 3개 이상이면 완료다 (2턴, 세션 둘에 나뉜 3턴은 아니다)", () => {
      const result = compute(
        rows({
          profiles: [user("three"), user("two"), user("split")],
          doneTurns: [
            ...sessionTurns("three", "s1", [after(onboardedAt, HOUR), after(onboardedAt, 2 * HOUR), after(onboardedAt, 3 * HOUR)]),
            ...sessionTurns("two", "s2", [after(onboardedAt, HOUR), after(onboardedAt, 2 * HOUR)]),
            ...sessionTurns("split", "s3", [after(onboardedAt, HOUR), after(onboardedAt, 2 * HOUR)]),
            ...sessionTurns("split", "s4", [after(onboardedAt, 3 * HOUR)]),
          ],
        }),
      );
      expect(counts(metric(result, "first_session"))).toEqual([1, 3]);
    });

    it("3번째 턴이 온보딩 후 24시간 뒤면 미완료다", () => {
      const result = compute(
        rows({
          profiles: [user("a")],
          doneTurns: sessionTurns("a", "s1", [after(onboardedAt, HOUR), after(onboardedAt, 2 * HOUR), after(onboardedAt, 25 * HOUR)]),
        }),
      );
      expect(counts(metric(result, "first_session"))).toEqual([0, 1]);
    });

    it("턴이 섞여 들어와도 시각 순으로 3번째 턴을 본다", () => {
      const result = compute(
        rows({
          profiles: [user("a")],
          doneTurns: sessionTurns("a", "s1", [
            after(onboardedAt, 30 * HOUR),
            after(onboardedAt, HOUR),
            after(onboardedAt, 3 * HOUR),
            after(onboardedAt, 2 * HOUR),
          ]),
        }),
      );
      expect(counts(metric(result, "first_session"))).toEqual([1, 1]);
    });

    it("온보딩 후 24시간이 지나지 않은 사용자는 분모에서 뺀다", () => {
      const result = compute(
        rows({
          profiles: [user("a")],
          doneTurns: sessionTurns("a", "s1", [after(onboardedAt, HOUR), after(onboardedAt, 2 * HOUR), after(onboardedAt, 3 * HOUR)]),
        }),
        { now: after(onboardedAt, 23 * HOUR) },
      );
      expect(counts(metric(result, "first_session"))).toEqual([0, 0]);
    });

    it("온보딩 50명 이상이면 50% 기준으로 판단한다", () => {
      const withSessions = (n: number) =>
        Array.from({ length: n }, (_, i) =>
          sessionTurns(`u${i}`, `s${i}`, [after(onboardedAt, HOUR), after(onboardedAt, 2 * HOUR), after(onboardedAt, 3 * HOUR)]),
        ).flat();
      const pass = compute(rows({ profiles: crowd(50, "u"), doneTurns: withSessions(25) }));
      expect(metric(pass, "first_session")).toMatchObject({ numerator: 25, denominator: 50, verdict: "pass" });
      const fail = compute(rows({ profiles: crowd(50, "u"), doneTurns: withSessions(24) }));
      expect(metric(fail, "first_session")).toMatchObject({ numerator: 24, denominator: 50, verdict: "fail" });
    });
  });

  describe("D1 / D7 학습 재참여율", () => {
    // 한국 10월 1일 23시 30분 온보딩: D0 = 10-01, D1 = 10-02, D7 = 10-08
    const lateNight = user("night", { createdAt: new Date("2026-10-01T23:00:00+09:00"), onboardedAt: new Date("2026-10-01T23:30:00+09:00") });
    // 한국 10월 2일 0시 30분 온보딩(UTC로는 10월 1일): D0 = 10-02, D1 = 10-03
    const earlyMorning = user("morning", { createdAt: new Date("2026-10-02T00:10:00+09:00"), onboardedAt: new Date("2026-10-02T00:30:00+09:00") });

    it("D0는 온보딩한 한국 날짜이고, 다음 날/7일 뒤 활동만 센다", () => {
      const result = compute(
        rows({
          profiles: [lateNight, earlyMorning],
          activityDays: [
            { userId: "night", date: "2026-10-01" },
            { userId: "night", date: "2026-10-02" },
            { userId: "night", date: "2026-10-08" },
            { userId: "morning", date: "2026-10-02" },
            { userId: "morning", date: "2026-10-03" },
            { userId: "morning", date: "2026-10-08" },
          ],
        }),
      );
      expect(counts(metric(result, "d1"))).toEqual([2, 2]);
      expect(counts(metric(result, "d7"))).toEqual([1, 2]);
    });

    it("관찰 날짜가 한국 시간으로 끝나지 않은 사용자는 분모에서 뺀다", () => {
      const input = rows({ profiles: [lateNight], activityDays: [{ userId: "night", date: "2026-10-02" }] });
      expect(counts(metric(compute(input, { now: new Date("2026-10-02T23:59:00+09:00") }), "d1"))).toEqual([0, 0]);
      expect(counts(metric(compute(input, { now: new Date("2026-10-03T00:00:00+09:00") }), "d1"))).toEqual([1, 1]);
      expect(counts(metric(compute(input, { now: new Date("2026-10-08T23:59:00+09:00") }), "d7"))).toEqual([0, 0]);
      expect(counts(metric(compute(input, { now: new Date("2026-10-09T00:00:00+09:00") }), "d7"))).toEqual([0, 1]);
    });

    it("온보딩 50명 이상이면 30% / 15% 기준으로 판단한다", () => {
      const profiles = crowd(50, "u");
      const activity = (n: number, date: string) => Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, date }));
      const result = compute(rows({ profiles, activityDays: [...activity(15, "2026-10-02"), ...activity(7, "2026-10-08")] }));
      expect(metric(result, "d1")).toMatchObject({ numerator: 15, denominator: 50, verdict: "pass" });
      expect(metric(result, "d7")).toMatchObject({ numerator: 7, denominator: 50, verdict: "fail" });
    });
  });

  describe("한도 도달 → 체험", () => {
    const onboardedAt = after(T0, HOUR);

    it("첫 도달 후 7일 안에 체험을 시작한 사용자가 분자다", () => {
      const reachA = after(onboardedAt, DAY);
      const reachB = after(onboardedAt, 2 * DAY);
      const result = compute(
        rows({
          profiles: [
            user("a", { trialStartedAt: after(reachA, 6 * DAY) }),
            user("b", { trialStartedAt: after(reachB, 8 * DAY) }),
            user("c", { trialStartedAt: after(onboardedAt, DAY) }),
          ],
          events: [limitReached("a", reachA), limitReached("b", reachB)],
        }),
      );
      expect(counts(metric(result, "limit_to_trial"))).toEqual([1, 2]);
    });

    it("첫 도달이 온보딩 후 7일이 지난 뒤면 분모에서 뺀다", () => {
      const result = compute(rows({ profiles: [user("a")], events: [limitReached("a", after(onboardedAt, 8 * DAY))] }));
      expect(counts(metric(result, "limit_to_trial"))).toEqual([0, 0]);
    });

    it("도달 후 7일이 지나지 않은 사용자는 분모에서 뺀다", () => {
      const reach = after(onboardedAt, DAY);
      const result = compute(rows({ profiles: [user("a")], events: [limitReached("a", reach)] }), {
        now: after(reach, 6 * DAY),
      });
      expect(counts(metric(result, "limit_to_trial"))).toEqual([0, 0]);
    });

    it("Pro 한도 도달과 trial_eligible이 false인 도달은 출발점이 아니다", () => {
      const reach = after(onboardedAt, DAY);
      const result = compute(
        rows({
          profiles: [user("pro"), user("used")],
          events: [limitReached("pro", reach, { plan: "pro", trial_eligible: false }), limitReached("used", reach, { trial_eligible: false })],
        }),
      );
      expect(counts(metric(result, "limit_to_trial"))).toEqual([0, 0]);
    });

    it("첫 도달의 feature별로 나눠 참고로 낸다", () => {
      const result = compute(
        rows({
          profiles: [
            user("words", { trialStartedAt: after(onboardedAt, 2 * DAY) }),
            user("chat"),
            user("both", { trialStartedAt: after(onboardedAt, 3 * DAY) }),
          ],
          events: [
            limitReached("words", after(onboardedAt, DAY)),
            limitReached("chat", after(onboardedAt, DAY), { feature: "chat" }),
            limitReached("both", after(onboardedAt, 2 * DAY), { feature: "chat" }),
            limitReached("both", after(onboardedAt, DAY)),
          ],
        }),
      );
      expect(metric(result, "limit_to_trial_words")).toMatchObject({ numerator: 2, denominator: 2, verdict: "reference" });
      expect(metric(result, "limit_to_trial_chat")).toMatchObject({ numerator: 0, denominator: 1, verdict: "reference" });
      expect(counts(metric(result, "limit_to_trial"))).toEqual([2, 3]);
    });

    it("분모가 20명 미만이면 온보딩이 50명 이상이어도 판단 보류다", () => {
      const reach = after(onboardedAt, DAY);
      const reached = (n: number, trials: number) =>
        Array.from({ length: n }, (_, i) => user(`r${i}`, { trialStartedAt: i < trials ? after(reach, DAY) : null }));
      const events = (n: number) => Array.from({ length: n }, (_, i) => limitReached(`r${i}`, reach));

      const small = compute(rows({ profiles: [...reached(19, 19), ...crowd(31, "u")], events: events(19) }));
      expect(metric(small, "limit_to_trial")).toMatchObject({ numerator: 19, denominator: 19, verdict: "pending" });
      const pass = compute(rows({ profiles: [...reached(20, 4), ...crowd(30, "u")], events: events(20) }));
      expect(metric(pass, "limit_to_trial")).toMatchObject({ numerator: 4, denominator: 20, verdict: "pass" });
      const fail = compute(rows({ profiles: [...reached(20, 3), ...crowd(30, "u")], events: events(20) }));
      expect(metric(fail, "limit_to_trial")).toMatchObject({ numerator: 3, denominator: 20, verdict: "fail" });
    });
  });

  describe("체험 후 Pro 관심", () => {
    const onboardedAt = after(T0, HOUR);
    const trialStartedAt = after(onboardedAt, DAY);
    const trialEnd = after(trialStartedAt, TRIAL_DAYS * DAY);

    it("한도 도달 없이 체험한 사용자도 분모이고, 종료 후 7일 안 클릭이 분자다", () => {
      const result = compute(
        rows({
          profiles: [user("clicked", { trialStartedAt }), user("during", { trialStartedAt }), user("none", { trialStartedAt })],
          events: [proClicked("clicked", after(trialEnd, DAY)), proClicked("during", after(trialStartedAt, DAY))],
        }),
      );
      expect(metric(result, "pro_after_trial")).toMatchObject({ numerator: 1, denominator: 3, verdict: "reference" });
    });

    it("온보딩 후 14일이 지나 체험을 시작한 사용자는 분모에서 뺀다", () => {
      const result = compute(rows({ profiles: [user("a", { trialStartedAt: after(onboardedAt, 15 * DAY) })] }));
      expect(counts(metric(result, "pro_after_trial"))).toEqual([0, 0]);
    });

    it("체험 종료 후 7일이 지나지 않은 사용자는 분모에서 뺀다", () => {
      const result = compute(rows({ profiles: [user("a", { trialStartedAt })] }), { now: after(trialEnd, 6 * DAY) });
      expect(counts(metric(result, "pro_after_trial"))).toEqual([0, 0]);
    });
  });

  describe("판단 보류와 제외", () => {
    it("온보딩 완료 사용자가 50명 미만이면 기준이 있는 지표는 모두 판단 보류다", () => {
      const result = compute(rows({ profiles: crowd(49, "u") }));
      for (const key of ["onboarding", "first_session", "d1", "d7", "limit_to_trial"]) {
        expect(metric(result, key).verdict).toBe("pending");
      }
      expect(metric(result, "pro_after_trial").verdict).toBe("reference");
    });

    it("분모가 0이면 판단 보류다", () => {
      const result = compute(rows({ profiles: crowd(50, "u") }), { now: after(T0, 3 * DAY) });
      expect(metric(result, "d7")).toMatchObject({ numerator: 0, denominator: 0, verdict: "pending" });
    });

    it("제외 계정은 모든 지표와 50명 표본에서 뺀다", () => {
      const onboardedAt = after(T0, HOUR);
      const result = compute(
        rows({
          profiles: [user("ops", { trialStartedAt: after(onboardedAt, 2 * DAY) }), ...crowd(49, "u")],
          doneTurns: sessionTurns("ops", "s1", [after(onboardedAt, HOUR), after(onboardedAt, 2 * HOUR), after(onboardedAt, 3 * HOUR)]),
          activityDays: [{ userId: "ops", date: "2026-10-02" }],
          events: [limitReached("ops", after(onboardedAt, DAY)), proClicked("ops", after(onboardedAt, 10 * DAY))],
        }),
        { excludedUserIds: new Set(["ops"]) },
      );
      expect(metric(result, "onboarding")).toMatchObject({ numerator: 49, denominator: 49, verdict: "pending" });
      expect(counts(metric(result, "first_session"))).toEqual([0, 49]);
      expect(counts(metric(result, "d1"))).toEqual([0, 49]);
      expect(counts(metric(result, "limit_to_trial"))).toEqual([0, 0]);
      expect(counts(metric(result, "pro_after_trial"))).toEqual([0, 0]);
    });
  });

  describe("모집 기간 (launchDate)", () => {
    const launchDate = "2026-11-01";
    const at = (iso: string) => new Date(iso);

    it("온보딩 완료율은 가입 시각이 출시일부터 28일 안인 사용자만 넣는다", () => {
      const created = (id: string, iso: string) => user(id, { createdAt: at(iso), onboardedAt: after(at(iso), HOUR) });
      const result = compute(
        rows({
          profiles: [
            created("before", "2026-10-31T23:59:00+09:00"),
            created("first", "2026-11-01T00:00:00+09:00"),
            created("last", "2026-11-28T23:59:00+09:00"),
            created("after", "2026-11-29T00:00:00+09:00"),
          ],
        }),
        { launchDate },
      );
      expect(counts(metric(result, "onboarding"))).toEqual([2, 2]);
    });

    it("나머지 지표는 온보딩 시각으로 모집 기간을 본다", () => {
      const result = compute(
        rows({
          profiles: [
            user("early", { createdAt: at("2026-10-31T22:00:00+09:00"), onboardedAt: at("2026-11-01T09:00:00+09:00") }),
            user("old", { createdAt: at("2026-10-20T09:00:00+09:00"), onboardedAt: at("2026-10-20T10:00:00+09:00") }),
          ],
          activityDays: [
            { userId: "early", date: "2026-11-02" },
            { userId: "old", date: "2026-10-21" },
          ],
        }),
        { launchDate },
      );
      expect(counts(metric(result, "onboarding"))).toEqual([0, 0]);
      expect(counts(metric(result, "d1"))).toEqual([1, 1]);
    });
  });
});
