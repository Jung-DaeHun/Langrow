import { TRIAL_DAYS } from "./plan";
import { VALID_SESSION_TURNS } from "./today";
import { addDays, kstDate, kstDayStart } from "./usage";

export type MetricsRows = {
  profiles: { id: string; createdAt: Date; onboardedAt: Date | null; trialStartedAt: Date | null }[];
  doneTurns: { userId: string; sessionId: string; createdAt: Date }[]; // status = done만
  activityDays: { userId: string; date: string }[]; // 한국 날짜 'YYYY-MM-DD'
  events: { userId: string; name: "limit_reached" | "pro_clicked"; props: Record<string, unknown>; createdAt: Date }[];
};

export type MetricResult = {
  key: string;
  label: string;
  numerator: number;
  denominator: number;
  verdict: "pass" | "fail" | "pending" | "reference"; // pending = 표본 부족으로 판단 보류
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// spec 1장 "수요 검증 기준"의 가설값. 관찰 전에 고정하고 결과를 보고 바꾸지 않는다
const RECRUIT_DAYS = 28;
const MIN_ONBOARDED_USERS = 50;
const MIN_LIMIT_TO_TRIAL_USERS = 20;
const ONBOARDING_WINDOW_MS = 24 * HOUR_MS;
const FIRST_SESSION_WINDOW_MS = 24 * HOUR_MS;
const FIRST_LIMIT_WINDOW_MS = 7 * DAY_MS; // 온보딩 후 첫 한도 도달
const TRIAL_AFTER_LIMIT_MS = 7 * DAY_MS;
const TRIAL_START_WINDOW_MS = 14 * DAY_MS; // Pro 관심: 온보딩 후 체험 시작
const PRO_CLICK_WINDOW_MS = 7 * DAY_MS; // Pro 관심: 체험 종료 후 클릭
const THRESHOLDS = { onboarding: 0.6, firstSession: 0.5, d1: 0.3, d7: 0.15, limitToTrial: 0.2 };

type Profile = MetricsRows["profiles"][number];
type OnboardedProfile = Profile & { onboardedAt: Date };
type Count = { numerator: number; denominator: number };

// start부터 windowMs 안이다 (경계 포함)
function within(start: Date, at: Date | null, windowMs: number): boolean {
  if (at === null) return false;
  const diff = at.getTime() - start.getTime();
  return diff >= 0 && diff <= windowMs;
}

// start부터 windowMs가 지나서 관찰 구간이 끝났다
function elapsed(start: Date, windowMs: number, now: Date): boolean {
  return now.getTime() - start.getTime() >= windowMs;
}

// 분모 = 관찰이 끝난 사용자, 분자 = 그중 성공. 사용자 행이 하나씩이라 distinct 사용자 수다
function tally<T>(observed: readonly T[], success: (item: T) => boolean): Count {
  return { numerator: observed.filter(success).length, denominator: observed.length };
}

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

export function computeMetrics(
  rows: MetricsRows,
  options: { now: Date; excludedUserIds: ReadonlySet<string>; launchDate?: string },
): MetricResult[] {
  const { now, excludedUserIds, launchDate } = options;

  // 모집 기간: 출시일(한국 날짜) 0시부터 28일
  const inRecruitment = (at: Date) =>
    launchDate === undefined ||
    (at.getTime() >= kstDayStart(launchDate).getTime() &&
      at.getTime() < kstDayStart(addDays(launchDate, RECRUIT_DAYS)).getTime());

  const profiles = rows.profiles.filter((p) => !excludedUserIds.has(p.id));
  const signups = profiles.filter((p) => inRecruitment(p.createdAt));
  const onboarded = profiles.filter(
    (p): p is OnboardedProfile => p.onboardedAt !== null && inRecruitment(p.onboardedAt),
  );
  const enoughUsers = onboarded.length >= MIN_ONBOARDED_USERS;

  // 사용자별로 세션이 유효해진 시각(세션의 VALID_SESSION_TURNS번째 done 턴). 세션 종료 여부는 보지 않는다
  const sessionTurns = new Map<string, { userId: string; times: number[] }>();
  for (const turn of rows.doneTurns) {
    const session = sessionTurns.get(turn.sessionId) ?? { userId: turn.userId, times: [] };
    session.times.push(turn.createdAt.getTime());
    sessionTurns.set(turn.sessionId, session);
  }
  const validSessionTimes = new Map<string, Date[]>();
  for (const { userId, times } of sessionTurns.values()) {
    if (times.length < VALID_SESSION_TURNS) continue;
    times.sort((a, b) => a - b);
    validSessionTimes.set(userId, [...(validSessionTimes.get(userId) ?? []), new Date(times[VALID_SESSION_TURNS - 1])]);
  }

  const activity = new Set(rows.activityDays.map((d) => `${d.userId}|${d.date}`));

  // 체험이 남은 Free 사용자의 첫 한도 도달만 체험 전환의 출발점이다
  const firstLimit = new Map<string, MetricsRows["events"][number]>();
  const proClicks = new Map<string, Date[]>();
  for (const event of rows.events) {
    if (event.name === "pro_clicked") {
      proClicks.set(event.userId, [...(proClicks.get(event.userId) ?? []), event.createdAt]);
    } else if (event.props.plan === "free" && event.props.trial_eligible === true) {
      const first = firstLimit.get(event.userId);
      if (!first || event.createdAt.getTime() < first.createdAt.getTime()) firstLimit.set(event.userId, event);
    }
  }

  const onboardingRate = tally(
    signups.filter((p) => elapsed(p.createdAt, ONBOARDING_WINDOW_MS, now)),
    (p) => within(p.createdAt, p.onboardedAt, ONBOARDING_WINDOW_MS),
  );

  const firstSessionRate = tally(
    onboarded.filter((p) => elapsed(p.onboardedAt, FIRST_SESSION_WINDOW_MS, now)),
    (p) => (validSessionTimes.get(p.id) ?? []).some((at) => within(p.onboardedAt, at, FIRST_SESSION_WINDOW_MS)),
  );

  // D0 = 온보딩한 한국 날짜. Dn 날짜가 한국 시간으로 끝난 사용자만 분모다
  const returnRate = (days: number) => {
    const dayOf = (p: OnboardedProfile) => addDays(kstDate(p.onboardedAt), days);
    return tally(
      onboarded.filter((p) => now.getTime() >= kstDayStart(addDays(dayOf(p), 1)).getTime()),
      (p) => activity.has(`${p.id}|${dayOf(p)}`),
    );
  };

  const reachers = onboarded.flatMap((p) => {
    const reach = firstLimit.get(p.id);
    return reach &&
      within(p.onboardedAt, reach.createdAt, FIRST_LIMIT_WINDOW_MS) &&
      elapsed(reach.createdAt, TRIAL_AFTER_LIMIT_MS, now)
      ? [{ profile: p, reach }]
      : [];
  });
  const startedTrial = ({ profile, reach }: (typeof reachers)[number]) =>
    within(reach.createdAt, profile.trialStartedAt, TRIAL_AFTER_LIMIT_MS);
  const reachersOf = (feature: string) => reachers.filter((r) => r.reach.props.feature === feature);

  // 경로와 무관하게 온보딩 후 14일 안에 체험을 시작했고 체험 종료 후 7일이 지난 사용자
  const trialEnders = onboarded.flatMap((p) => {
    const start = p.trialStartedAt;
    if (start === null || !within(p.onboardedAt, start, TRIAL_START_WINDOW_MS)) return [];
    const trialEnd = new Date(start.getTime() + TRIAL_DAYS * DAY_MS);
    return elapsed(trialEnd, PRO_CLICK_WINDOW_MS, now) ? [{ profile: p, trialEnd }] : [];
  });
  const proInterest = tally(trialEnders, ({ profile, trialEnd }) =>
    (proClicks.get(profile.id) ?? []).some((at) => within(trialEnd, at, PRO_CLICK_WINDOW_MS)),
  );

  const judged = (key: string, label: string, count: Count, threshold: number, minDenominator = 1): MetricResult => {
    const verdict =
      !enoughUsers || count.denominator < minDenominator
        ? "pending"
        : count.numerator / count.denominator >= threshold
          ? "pass"
          : "fail";
    return { key, label: `${label} (기준 ${percent(threshold)} 이상)`, ...count, verdict };
  };
  const reference = (key: string, label: string, count: Count): MetricResult => ({
    key,
    label: `${label} (참고)`,
    ...count,
    verdict: "reference",
  });

  return [
    judged("onboarding", "온보딩 완료율: 가입 후 24시간 안", onboardingRate, THRESHOLDS.onboarding),
    judged("first_session", "첫 세션 완료율: 온보딩 후 24시간 안", firstSessionRate, THRESHOLDS.firstSession),
    judged("d1", "D1 학습 재참여율", returnRate(1), THRESHOLDS.d1),
    judged("d7", "D7 학습 재참여율", returnRate(7), THRESHOLDS.d7),
    judged(
      "limit_to_trial",
      `목표 완료·한도 도달 → 7일 안 체험: 분모 ${MIN_LIMIT_TO_TRIAL_USERS}명 이상`,
      tally(reachers, startedTrial),
      THRESHOLDS.limitToTrial,
      MIN_LIMIT_TO_TRIAL_USERS,
    ),
    reference("limit_to_trial_words", "단어 한도(목표 완료) → 체험", tally(reachersOf("words"), startedTrial)),
    reference("limit_to_trial_chat", "대화 한도(목표 이상 사용) → 체험", tally(reachersOf("chat"), startedTrial)),
    reference("pro_after_trial", "체험 후 7일 안 Pro 클릭", proInterest),
  ];
}
