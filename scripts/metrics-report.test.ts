import { describe, expect, it } from "vitest";
import type { MetricsRows } from "@/lib/metrics";
import { main, type MetricsReportDeps } from "./metrics-report";

const NOW = new Date("2026-12-31T00:00:00+09:00");
const LINE = /^.+: \d+\/\d+ \((\d+\.\d%|-)\) (통과|미달|판단 보류|참고)$/;

// createdAt에 가입하고 1시간 뒤 온보딩한 사용자
function user(id: string, createdAt = new Date("2026-11-02T10:00:00+09:00")): MetricsRows["profiles"][number] {
  return { id, createdAt, onboardedAt: new Date(createdAt.getTime() + 60 * 60 * 1000), trialStartedAt: null };
}

function fakeDeps(options: { args?: string[]; excludedUserIds?: string; rows?: Partial<MetricsRows> } = {}) {
  const logs: string[] = [];
  let fetched = 0;
  const deps: MetricsReportDeps = {
    args: options.args ?? [],
    now: NOW,
    excludedUserIds: options.excludedUserIds,
    fetchRows: async () => {
      fetched++;
      return { profiles: [], doneTurns: [], activityDays: [], events: [], ...options.rows };
    },
    log: (line) => logs.push(line),
  };
  return { deps, logs, fetchCount: () => fetched };
}

const lineOf = (logs: string[], label: string) => logs.find((line) => line.startsWith(label)) ?? "";

describe("metrics-report main", () => {
  it("지표마다 `라벨: 분자/분모 (비율%) 판단`을 한 줄씩 출력한다", async () => {
    const onboarded = user("a");
    const notOnboarded = { ...user("b"), onboardedAt: null };
    const { deps, logs } = fakeDeps({ rows: { profiles: [onboarded, notOnboarded] } });

    expect(await main(deps)).toBe(0);

    expect(logs.filter((line) => LINE.test(line))).toHaveLength(8);
    expect(lineOf(logs, "온보딩 완료율")).toMatch(/: 1\/2 \(50\.0%\) 판단 보류$/);
  });

  it("분모가 0이면 비율 대신 -를 출력한다", async () => {
    const { deps, logs } = fakeDeps();

    expect(await main(deps)).toBe(0);

    expect(lineOf(logs, "온보딩 완료율")).toMatch(/: 0\/0 \(-\) 판단 보류$/);
  });

  it("제외 목록은 쉼표로 나누고 공백과 빈 값은 무시한다", async () => {
    const { deps, logs } = fakeDeps({
      excludedUserIds: " a , ,b,",
      rows: { profiles: [user("a"), user("b"), user("c")] },
    });

    expect(await main(deps)).toBe(0);

    expect(lineOf(logs, "온보딩 완료율")).toContain(": 1/1 (100.0%)");
  });

  it("--launch를 모집 기간 계산에 넘긴다", async () => {
    const rows = { profiles: [user("before", new Date("2026-10-20T10:00:00+09:00")), user("in")] };

    const all = fakeDeps({ rows });
    await main(all.deps);
    expect(lineOf(all.logs, "온보딩 완료율")).toContain(": 2/2");

    const launched = fakeDeps({ args: ["--launch", "2026-11-01"], rows });
    expect(await main(launched.deps)).toBe(0);
    expect(lineOf(launched.logs, "온보딩 완료율")).toContain(": 1/1");
  });

  it.each([[["--launch", "2026/11/01"]], [["--launch", "2026-13-01"]], [["--launch"]], [["--since", "2026-11-01"]]])(
    "인자가 %j이면 사용법을 출력하고 조회하지 않는다",
    async (args) => {
      const { deps, logs, fetchCount } = fakeDeps({ args });

      expect(await main(deps)).toBe(1);

      expect(fetchCount()).toBe(0);
      expect(logs.join("\n")).toContain("사용법");
    },
  );
});
