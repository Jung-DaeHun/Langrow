import type { Metadata } from "next";
import { ScenarioPicker } from "@/components/ScenarioPicker";
import { LANGUAGE_NAMES, LEVEL_INFO } from "@/lib/levels";
import { PLAN_LIMITS, planAt } from "@/lib/plan";
import { scenariosForLevel } from "@/lib/scenarios";
import { remaining } from "@/lib/usage";
import { readEndedScenarioIds, readOpenSessions } from "@/server/db/reads";
import { loadTodayUsage, requireReady } from "@/server/page";

export const metadata: Metadata = { title: "대화 · Langrow" };

// 현재 레벨의 상황 목록. 남은 턴은 안내만 하고 세션 생성을 막지 않는다(입력은 서버의 429 뒤에만 막는다)

const SESSION_MAX_TURNS = 20;

export default async function ChatPage() {
  const { supabase, userId, account, language, level, now } = await requireReady();
  const [usage, openSessions, endedIds] = await Promise.all([
    loadTodayUsage(),
    readOpenSessions(supabase, userId, language),
    readEndedScenarioIds(supabase, userId, language),
  ]);

  const left = remaining(usage.chatTurns, PLAN_LIMITS[planAt(account.proUntil, now)].chatTurns);
  // openSessions는 최신순이라 find가 그 상황의 가장 최근 열린 세션을 고른다
  const items = scenariosForLevel(level).map((scenario, i) => {
    const open = openSessions.find((s) => s.scenarioId === scenario.id);
    return {
      scenarioId: scenario.id,
      index: i + 1,
      title: scenario.title,
      goal: scenario.goal,
      open: open === undefined ? null : { id: open.id, status: open.status, doneTurns: open.doneTurns },
      completed: endedIds.includes(scenario.id),
    };
  });

  return (
    <div className="flex flex-col gap-6 pt-6 animate-enter">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-ink-muted">
          {LANGUAGE_NAMES[language]} · {LEVEL_INFO[level].name} 상황
        </p>
        <h1 className="text-h1 font-semibold tracking-[-0.02em] text-balance text-brand">어떤 상황에서 말해 볼까요?</h1>
        <p className="text-sm text-ink-muted tabular-nums">
          오늘 대화 턴 {left}개 남음 · 한 세션은 최대 {SESSION_MAX_TURNS}턴
        </p>
      </div>
      <ScenarioPicker language={language} level={level} items={items} />
    </div>
  );
}
