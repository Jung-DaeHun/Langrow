import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { computeMetrics, type MetricResult, type MetricsRows } from "@/lib/metrics";
import { getAdminEnv } from "@/services/env";
import type { Database } from "@/types/database";

export type MetricsReportDeps = {
  args: string[];
  now: Date;
  excludedUserIds: string | undefined; // METRICS_EXCLUDED_USER_IDS (쉼표 구분)
  fetchRows: () => Promise<MetricsRows>;
  log: (line: string) => void;
};

const USAGE = "사용법: npm run metrics [-- --launch YYYY-MM-DD] (출시일, 한국 날짜)";

const VERDICT_TEXT: Record<MetricResult["verdict"], string> = {
  pass: "통과",
  fail: "미달",
  pending: "판단 보류",
  reference: "참고",
};

// 출시일이 없으면 { launchDate: undefined }, 인자가 틀리면 null
function parseCliArgs(args: string[]): { launchDate: string | undefined } | null {
  try {
    const { values } = parseArgs({ args, options: { launch: { type: "string" } } });
    const launchDate = values.launch;
    if (launchDate === undefined) return { launchDate };
    const date = new Date(`${launchDate}T00:00:00Z`);
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(launchDate) && !Number.isNaN(date.getTime()) && date.toISOString().startsWith(launchDate);
    return valid ? { launchDate } : null;
  } catch {
    return null; // 모르는 옵션, 값이 없는 옵션
  }
}

function formatLine(m: MetricResult): string {
  const ratio = m.denominator === 0 ? "-" : `${((m.numerator / m.denominator) * 100).toFixed(1)}%`;
  return `${m.label}: ${m.numerator}/${m.denominator} (${ratio}) ${VERDICT_TEXT[m.verdict]}`;
}

export async function main(deps: MetricsReportDeps): Promise<number> {
  const parsed = parseCliArgs(deps.args);
  if (!parsed) {
    deps.log(USAGE);
    return 1;
  }
  const excludedUserIds = new Set(
    (deps.excludedUserIds ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== ""),
  );
  const rows = await deps.fetchRows();
  const results = computeMetrics(rows, { now: deps.now, excludedUserIds, launchDate: parsed.launchDate });

  deps.log(
    `기준 시각 ${deps.now.toISOString()} · 모집 시작 ${parsed.launchDate ?? "지정 안 함"} · 제외 계정 ${excludedUserIds.size}개`,
  );
  results.forEach((m) => deps.log(formatLine(m)));
  return 0;
}

// ---- 실제 deps (Supabase). 테스트는 가짜 deps만 쓴다 ----

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

// PostgREST는 요청당 최대 1000행(max-rows)만 돌려준다. 빈 페이지가 나올 때까지 .range()로 넘긴다
async function fetchAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await page(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return rows;
    rows.push(...data);
  }
}

const toDate = (value: string | null) => (value === null ? null : new Date(value));

async function fetchRows(): Promise<MetricsRows> {
  const { supabaseUrl, supabaseSecretKey } = getAdminEnv();
  const db = createClient<Database>(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // 페이지가 겹치거나 빠지지 않도록 유일한 키로 정렬한다
  const [profiles, turns, days, events] = await Promise.all([
    fetchAll((from, to) =>
      db.from("profiles").select("id, created_at, onboarded_at, trial_started_at").order("id").range(from, to),
    ),
    fetchAll((from, to) =>
      db.from("chat_turns").select("user_id, session_id, created_at").eq("status", "done").order("id").range(from, to),
    ),
    fetchAll((from, to) =>
      db.from("user_activity_days").select("user_id, activity_date").order("user_id").order("activity_date").range(from, to),
    ),
    fetchAll((from, to) =>
      db
        .from("events")
        .select("user_id, name, props, created_at")
        .in("name", ["limit_reached", "pro_clicked"])
        .order("id")
        .range(from, to),
    ),
  ]);
  return {
    profiles: profiles.map((p) => ({
      id: p.id,
      createdAt: new Date(p.created_at),
      onboardedAt: toDate(p.onboarded_at),
      trialStartedAt: toDate(p.trial_started_at),
    })),
    doneTurns: turns.map((t) => ({ userId: t.user_id, sessionId: t.session_id, createdAt: new Date(t.created_at) })),
    activityDays: days.map((d) => ({ userId: d.user_id, date: d.activity_date })),
    events: events.map((e) => ({
      userId: e.user_id,
      name: e.name as "limit_reached" | "pro_clicked",
      props: typeof e.props === "object" && e.props !== null && !Array.isArray(e.props) ? e.props : {},
      createdAt: new Date(e.created_at),
    })),
  };
}

function realDeps(): MetricsReportDeps {
  return {
    args: process.argv.slice(2),
    now: new Date(),
    excludedUserIds: process.env.METRICS_EXCLUDED_USER_IDS,
    fetchRows,
    log: (line) => console.log(line),
  };
}

// import만 해서는 실행하지 않는다 (테스트가 import한다)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(realDeps()).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
