import type { Metadata } from "next";
import { ScenarioPicker } from "@/components/ScenarioPicker";
import { LANGUAGE_NAMES, LEVEL_INFO } from "@/lib/levels";
import { PLAN_LIMITS, planAt, trialState } from "@/lib/plan";
import { scenarioGroups } from "@/lib/scenarios";
import { remaining } from "@/lib/usage";
import { readEndedScenarioIds, readOpenSessions } from "@/server/db/reads";
import { loadTodayUsage, requireReady } from "@/server/page";

export const metadata: Metadata = { title: "대화 · Langrow" };

// 레벨 묶음 5개의 상황 목록. 남은 턴은 안내만 하고 세션 생성을 막지 않는다(입력은 서버의 429 뒤에만 막는다)

const SESSION_MAX_TURNS = 20;

export default async function ChatPage() {
  const { supabase, userId, account, language, level, now } = await requireReady();
  const [usage, openSessions, endedIds] = await Promise.all([
    loadTodayUsage(),
    readOpenSessions(supabase, userId, language),
    readEndedScenarioIds(supabase, userId, language),
  ]);

  const plan = planAt(account.proUntil, now);
  const left = remaining(usage.chatTurns, PLAN_LIMITS[plan].chatTurns);
  // 표시용이다. Pro 상황의 실제 판정은 세션 생성 RPC가 DB 시각으로 한다
  const trial = trialState(account.trialStartedAt, account.proUntil, now);
  const access = plan === "pro" ? "pro" : trial.kind === "available" ? "trial-available" : "trial-ended";

  return (
    <div className="flex flex-col gap-6 pt-6 animate-enter">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-ink-muted">
          {LANGUAGE_NAMES[language]} · 지금 레벨 {LEVEL_INFO[level].name}
        </p>
        <h1 className="text-h1 font-semibold tracking-[-0.02em] text-balance text-brand">어떤 상황에서 말해 볼까요?</h1>
        <p className="text-sm text-ink-muted tabular-nums">
          오늘 대화 턴 {left}개 남음 · 한 세션은 최대 {SESSION_MAX_TURNS}턴
        </p>
      </div>
      <ScenarioPicker
        language={language}
        level={level}
        groups={scenarioGroups(level, openSessions, endedIds)}
        access={access}
      />
    </div>
  );
}
