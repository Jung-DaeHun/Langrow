import { PLAN_LIMITS, type Plan } from "@/lib/plan";
import { remaining } from "@/lib/usage";
import type { TodayUsage } from "@/server/db/reads";

type Props = { usage: TodayUsage; plan: Plan; compact?: boolean; showNote?: boolean };

// 홈과 사이드바가 같은 사용량 표시를 쓴다. 숫자는 남은 양, 바는 사용한 비율이다
export function UsageCard({ usage, plan, compact = false, showNote = false }: Props) {
  const limits = PLAN_LIMITS[plan];
  const items = [
    { label: "AI 대화 턴", used: usage.chatTurns, max: limits.chatTurns },
    { label: "새 단어", used: usage.newWords, max: limits.newWords },
  ];

  return (
    <div className={`flex flex-col gap-4 rounded-xl bg-card shadow-card ${compact ? "p-4" : "p-5"}`}>
      {items.map(({ label, used, max }) => {
        const left = remaining(used, max);
        const filled = Math.min(used, max);
        const empty = left === 0;
        return (
          <div key={label} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-semibold">{label}</span>
              <span className="text-ink-muted">
                <strong className={`tabular-nums ${empty ? "text-danger" : "text-ink"}`}>{left}</strong>
                <span className="tabular-nums"> / {max}</span> 남음
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={label}
              aria-valuemin={0}
              aria-valuemax={max}
              aria-valuenow={filled}
              className="h-1.5 overflow-hidden rounded-full bg-zone"
            >
              <div
                className={`h-full rounded-full transition-[width] duration-400 ${empty ? "bg-danger" : "bg-accent"}`}
                style={{ width: `${(filled / max) * 100}%` }}
              />
            </div>
          </div>
        );
      })}
      {showNote && (
        <p className="text-micro text-ink-muted">한국 시간 자정에 다시 채워져요. 영어·일본어 사용량을 합산해요.</p>
      )}
    </div>
  );
}
