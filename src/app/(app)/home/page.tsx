import {
  BookOpen,
  Check,
  ChevronRight,
  Languages,
  MessagesSquare,
  RotateCcw,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { LimitNotice } from "@/components/LimitNotice";
import { UsageCard } from "@/components/UsageCard";
import { stripFurigana } from "@/lib/furigana";
import { KANA } from "@/lib/kana";
import { LANGUAGE_NAMES, LEVEL_INFO, canTakeLevelTest, showsKana, type Level } from "@/lib/levels";
import { LEVEL_TEST_SIZE, PASS_SCORE } from "@/lib/levelTest";
import { PLAN_LIMITS, planAt, trialState } from "@/lib/plan";
import { findScenario } from "@/lib/scenarios";
import {
  DAILY_WORD_GOAL,
  VALID_SESSION_TURNS,
  exhaustedActions,
  isValidSession,
  remainingGoalCount,
  wordGoal,
  type ExhaustedAction,
} from "@/lib/today";
import { remaining } from "@/lib/usage";
import { readBestSessionTurnsToday, readOpenSessions, readReviewWords, readUnseenWords } from "@/server/db/reads";
import { loadTodayUsage, requireReady } from "@/server/page";

export const metadata: Metadata = { title: "홈 · Langrow" };

// 홈은 "오늘 할 일"과 진행률부터 보여 준다(spec/journey.md "홈 구조"). 플랜·체험·목표는 표시용으로만 계산한다.
// 한도는 안내만 하고 버튼을 막지 않는다. 입력은 서버의 429 뒤에만 막는다(ADR-007)

const SESSION_MAX_TURNS = 20;

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const H1 = "text-h1 font-semibold tracking-[-0.02em] text-balance text-brand";
const H2 = "text-h3 font-semibold tracking-[-0.02em]";
const BUTTON = `inline-flex items-center justify-center gap-2 rounded-full font-semibold transition duration-200 active:scale-95 ${FOCUS_RING}`;
const PRIMARY = `${BUTTON} h-11 px-5 bg-accent text-white hover:bg-brand`;
const OUTLINE = `${BUTTON} h-11 px-5 border border-accent bg-transparent text-accent hover:bg-black/5`;
const OUTLINE_SM = `${BUTTON} h-9 px-4 text-sm border border-accent bg-transparent text-accent hover:bg-black/5`;
const TAG = "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold";
const MINT_TAG = `${TAG} bg-mint text-brand`;
const GOLD_TAG = `${TAG} bg-gold-wash text-on-gold ring-1 ring-gold-light ring-inset`;
const GRAY_TAG = `${TAG} bg-zone text-ink-muted`;
const TILE = `flex w-full items-center gap-3.5 rounded-xl bg-card p-4 text-left shadow-card transition hover:ring-1 hover:ring-line-input ${FOCUS_RING}`;
const ROW_BASE = "flex w-full items-center gap-3.5 px-4 py-3.5 text-left";
const ROW = `${ROW_BASE} hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent`;
const ICON_CIRCLE = "grid size-10 shrink-0 place-items-center rounded-full bg-mint";

const EXHAUSTED_LINKS: Record<ExhaustedAction, { href: string; label: string }> = {
  "level-up": { href: "/level-up", label: "레벨업 테스트 보기" },
  review: { href: "/words?tab=review", label: "오답 복습하기" },
  chat: { href: "/chat", label: "대화하기" },
};

export default async function HomePage() {
  const { supabase, userId, account, language, level, now } = await requireReady();
  const [usage, best, unseen, review, sessions] = await Promise.all([
    loadTodayUsage(),
    readBestSessionTurnsToday(supabase, userId, now),
    readUnseenWords(supabase, userId, language, level, 0),
    readReviewWords(supabase, userId, language, 0),
    readOpenSessions(supabase, userId, language),
  ]);

  const plan = planAt(account.proUntil, now);
  const trial = trialState(account.trialStartedAt, account.proUntil, now);
  const goal = wordGoal(usage.newWords, unseen.total);
  const chatDone = isValidSession(best);
  const left = remainingGoalCount(goal, chatDone);
  const firstDay = account.streak.lastStudyDate === null;
  // primary는 화면에 하나: 첫날이면 대화, 아니면 아직 안 끝난 첫 카드
  const wordOpen = !goal.done && !goal.exhausted;
  const focus = firstDay ? "chat" : wordOpen ? "words" : chatDone ? null : "chat";

  const chatLimit = remaining(usage.chatTurns, PLAN_LIMITS[plan].chatTurns) === 0;
  // 소진이면 새 단어를 약속하는 체험 안내를 하지 않는다(spec/words.md "새 단어 소진")
  const wordsLimit = remaining(usage.newWords, PLAN_LIMITS[plan].newWords) === 0 && !goal.exhausted;
  // 두 한도에 모두 닿아도 안내는 하나다(primary는 화면에 하나)
  const limitFeature = chatLimit && wordsLimit ? "both" : chatLimit ? "chat" : wordsLimit ? "words" : null;

  const active = sessions.find((s) => s.status === "active");
  const ending = sessions.find((s) => s.status === "ending");
  const activeScenario = active === undefined ? undefined : findScenario(active.scenarioId);
  const endingScenario = ending === undefined ? undefined : findScenario(ending.scenarioId);

  return (
    <div className="flex flex-col gap-8 pt-6 animate-enter">
      <section aria-labelledby="today-title" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-ink-muted">
              {LANGUAGE_NAMES[language]} · {LEVEL_INFO[level].name}
            </p>
            {trial.kind === "active" && <span className={GOLD_TAG}>체험 {trial.daysLeft}일 남음</span>}
            {trial.kind === "ended" && <span className={GRAY_TAG}>체험이 끝났어요</span>}
          </div>
          <h1 id="today-title" className={H1}>
            {left > 0 ? `오늘 할 일 ${left}개 남았어요` : "오늘 목표를 끝냈어요"}
          </h1>
        </div>

        {firstDay && (
          <div className="flex items-start gap-3 rounded-xl bg-mint p-4">
            <MessagesSquare size={20} aria-hidden="true" className="shrink-0 text-accent" />
            <div className="flex flex-col gap-1">
              <p className="font-bold">첫날이에요</p>
              <p className="text-sm">
                대화부터 해 보세요. 상황을 골라 {VALID_SESSION_TURNS}턴만 주고받으면 오늘 대화 목표를 채워요.
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {goal.exhausted ? (
            <TodoCard
              icon={BookOpen}
              title="오늘의 단어"
              sub={level === 5 ? "고수 단계의 새 단어를 모두 학습했어요" : "이 레벨의 새 단어를 모두 학습했어요"}
              ring={goal.done ? <Ring label="오늘의 단어" value={goal.progress} max={DAILY_WORD_GOAL} /> : null}
            >
              {goal.done && <DoneTag />}
              {review.total === 0 && <p className="w-full text-sm text-ink-muted">복습할 오답이 없어요</p>}
              {exhaustedActions(level, review.total).map((action) => (
                <Link key={action} href={EXHAUSTED_LINKS[action].href} className={OUTLINE_SM}>
                  {EXHAUSTED_LINKS[action].label}
                </Link>
              ))}
            </TodoCard>
          ) : (
            <TodoCard
              icon={BookOpen}
              title="오늘의 단어"
              sub={`새 단어 ${DAILY_WORD_GOAL}개`}
              ring={<Ring label="오늘의 단어" value={goal.progress} max={DAILY_WORD_GOAL} />}
            >
              {goal.done ? (
                <DoneTag />
              ) : (
                <Link href="/words" className={focus === "words" ? PRIMARY : OUTLINE}>
                  {goal.progress === 0 ? "시작하기" : "계속하기"}
                </Link>
              )}
            </TodoCard>
          )}

          <TodoCard
            icon={MessagesSquare}
            title="대화 1세션"
            sub={`${VALID_SESSION_TURNS}턴 이상 대화하기`}
            ring={<Ring label="대화 1세션" value={Math.min(best, VALID_SESSION_TURNS)} max={VALID_SESSION_TURNS} />}
            highlight={firstDay}
          >
            {chatDone ? (
              <DoneTag />
            ) : (
              <Link
                href={active === undefined ? "/chat" : `/chat/${active.id}`}
                className={focus === "chat" ? PRIMARY : OUTLINE}
              >
                {active === undefined ? "시작하기" : "계속하기"}
              </Link>
            )}
          </TodoCard>
        </div>

        {limitFeature !== null && <LimitNotice feature={limitFeature} trial={trial} />}
      </section>

      {(activeScenario !== undefined || endingScenario !== undefined) && (
        <section aria-labelledby="continue-title" className="flex flex-col gap-4">
          <h2 id="continue-title" className={H2}>
            이어서 대화하기
          </h2>
          {active !== undefined && activeScenario !== undefined && (
            <Link href={`/chat/${active.id}`} className={TILE}>
              <span className={ICON_CIRCLE}>
                <MessagesSquare size={20} aria-hidden="true" className="text-accent" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-bold">{activeScenario.title}</span>
                <span className="truncate text-sm text-ink-muted">
                  <span className="tabular-nums">
                    {active.doneTurns} / {SESSION_MAX_TURNS}턴
                  </span>{" "}
                  · “<span lang={language}>{stripFurigana(active.lastReply ?? activeScenario.roles[language].opening.text)}</span>”
                </span>
              </span>
              <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-ink-muted" />
            </Link>
          )}
          {ending !== undefined && endingScenario !== undefined && (
            <Link href={`/chat/${ending.id}`} className={TILE}>
              <span className={ICON_CIRCLE}>
                <MessagesSquare size={20} aria-hidden="true" className="text-accent" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-bold">{endingScenario.title}</span>
                <span className="text-sm text-ink-muted">피드백 확인</span>
              </span>
              <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-ink-muted" />
            </Link>
          )}
        </section>
      )}

      <section aria-labelledby="more-title" className="flex flex-col gap-4">
        <h2 id="more-title" className={H2}>
          더 학습하기
        </h2>
        <div className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">
          {review.total > 0 ? (
            <Link href="/words?tab=review" className={ROW}>
              <RowBody icon={RotateCcw} title={`오답 복습 ${review.total}개`} sub="틀린 단어를 카드로 다시 봐요" />
              <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-ink-muted" />
            </Link>
          ) : (
            <div aria-disabled="true" className={`${ROW_BASE} opacity-50`}>
              <RowBody icon={RotateCcw} title="오답 복습 0개" sub="아직 틀린 단어가 없어요" />
            </div>
          )}
          {canTakeLevelTest(level) && (
            <Link href="/level-up" className={ROW}>
              <RowBody
                icon={TrendingUp}
                title="레벨업 테스트"
                sub={`${LEVEL_INFO[level].name} → ${LEVEL_INFO[(level + 1) as Level].name} · ${LEVEL_TEST_SIZE}문제 중 ${PASS_SCORE}개`}
              />
              <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-ink-muted" />
            </Link>
          )}
          {showsKana(language, level) && (
            <Link href="/kana" className={ROW}>
              <RowBody icon={Languages} title="가나 익히기" sub={`히라가나·가타카나 각 ${KANA.hiragana.length}자`} />
              <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-ink-muted" />
            </Link>
          )}
        </div>
      </section>

      <section aria-labelledby="usage-title" className="flex flex-col gap-4">
        <h2 id="usage-title" className={H2}>
          오늘 남은 사용량
        </h2>
        <UsageCard usage={usage} plan={plan} showNote />
      </section>
    </div>
  );
}

type TodoCardProps = {
  icon: LucideIcon;
  title: string;
  sub: string;
  ring: ReactNode;
  highlight?: boolean;
  children: ReactNode;
};

function TodoCard({ icon: Icon, title, sub, ring, highlight = false, children }: TodoCardProps) {
  return (
    <div className={`flex flex-col gap-4 rounded-xl bg-card p-5 shadow-card ${highlight ? "ring-2 ring-accent" : ""}`}>
      {highlight && <span className={`self-start ${MINT_TAG}`}>여기서 시작하세요</span>}
      <div className="flex items-center gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Icon size={20} aria-hidden="true" className="text-accent" />
          <h2 className="text-lead font-bold">{title}</h2>
          <p className="text-sm text-ink-muted">{sub}</p>
        </div>
        {ring}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

// 진행 링(ui.md "진행 표시"). conic-gradient는 데이터 표시라 허용된 유일한 그라데이션이다
function Ring({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="grid size-16 shrink-0 place-items-center rounded-full"
      style={{ background: `conic-gradient(var(--color-accent) ${(value / max) * 100}%, var(--color-zone) 0)` }}
    >
      <span className="grid size-12.5 place-items-center rounded-full bg-card text-sm font-bold tabular-nums">
        {value >= max ? <Check size={24} aria-hidden="true" className="text-accent" /> : `${value}/${max}`}
      </span>
    </div>
  );
}

function DoneTag() {
  return (
    <span className={MINT_TAG}>
      <Check size={14} aria-hidden="true" />
      완료
    </span>
  );
}

function RowBody({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub: string }) {
  return (
    <>
      <span className={ICON_CIRCLE}>
        <Icon size={20} aria-hidden="true" className="text-accent" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-bold">{title}</span>
        <span className="text-sm text-ink-muted">{sub}</span>
      </span>
    </>
  );
}
