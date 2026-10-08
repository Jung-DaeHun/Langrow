import { CircleCheck, Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { LimitNotice } from "@/components/LimitNotice";
import { WordSession } from "@/components/WordSession";
import { PLAN_LIMITS, planAt, trialState } from "@/lib/plan";
import { exhaustedActions, type ExhaustedAction } from "@/lib/today";
import { remaining } from "@/lib/usage";
import { BATCH_MAX, batchSize } from "@/lib/wordBatch";
import { readReviewWords, readUnseenWords } from "@/server/db/reads";
import { loadTodayUsage, requireReady } from "@/server/page";

export const metadata: Metadata = { title: "단어 · Langrow" };

// 오늘의 학습 / 오답 복습. 회차 크기는 표시용 계산이고, 한도의 실제 판정은 저장 RPC가 DB 시각으로 한다.
// 소진(학습할 단어 없음)을 한도 도달보다 먼저 판단한다. 소진에서는 새 단어를 약속하는 체험 안내를 두지 않는다(spec/words.md "새 단어 소진")

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const H1 = "text-h1 font-semibold tracking-[-0.02em] text-balance text-brand";
const BUTTON = `inline-flex items-center justify-center gap-2 rounded-full font-semibold transition duration-200 active:scale-95 ${FOCUS_RING}`;
const PRIMARY = `${BUTTON} h-11 px-5 bg-accent text-white hover:bg-brand`;
const OUTLINE = `${BUTTON} h-11 px-5 border border-accent bg-transparent text-accent hover:bg-black/5`;
const OUTLINE_SM = `${BUTTON} h-9 px-4 text-sm border border-accent bg-transparent text-accent hover:bg-black/5`;
const SEGMENT_ITEM = `rounded-full px-4 py-2 text-sm font-semibold ${FOCUS_RING}`;

const EXHAUSTED_LINKS: Record<ExhaustedAction, { href: string; label: string }> = {
  "level-up": { href: "/level-up", label: "레벨업 테스트 보기" },
  review: { href: "/words?tab=review", label: "오답 복습하기" },
  chat: { href: "/chat", label: "대화하기" },
};

export default async function WordsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { tab } = await searchParams;
  const isReview = tab === "review";
  const { supabase, userId, account, language, level, now } = await requireReady();
  const [usage, unseen, review] = await Promise.all([
    loadTodayUsage(),
    readUnseenWords(supabase, userId, language, level, BATCH_MAX),
    readReviewWords(supabase, userId, language, BATCH_MAX),
  ]);

  const trial = trialState(account.trialStartedAt, account.proUntil, now);
  const rem = remaining(usage.newWords, PLAN_LIMITS[planAt(account.proUntil, now)].newWords);
  const size = batchSize(rem, unseen.total);

  let content: ReactNode;
  if (isReview) {
    content =
      review.total === 0 ? (
        <div className="flex items-start gap-3 rounded-xl bg-card p-4 shadow-card">
          <Inbox size={20} aria-hidden="true" className="shrink-0 text-accent" />
          <div className="flex flex-col gap-1">
            <p className="font-bold">아직 틀린 단어가 없어요</p>
            <p className="text-sm text-ink-muted">오늘의 학습에서 틀린 단어가 여기에 모여요</p>
          </div>
        </div>
      ) : (
        <WordSession key={`review-${language}`} mode="review" language={language} level={level} words={review.words} trial={trial} />
      );
  } else if (unseen.total === 0) {
    content = (
      <section className="flex flex-col gap-4 rounded-xl bg-card p-6 shadow-card">
        <div className="flex flex-col gap-1">
          <h2 className="text-lead font-bold">
            {level === 5 ? "고수 단계의 새 단어를 모두 학습했어요" : "이 레벨의 새 단어를 모두 학습했어요"}
          </h2>
          {review.total === 0 && <p className="text-sm text-ink-muted">복습할 오답이 없어요</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {exhaustedActions(level, review.total).map((action, i) => (
            <Link key={action} href={EXHAUSTED_LINKS[action].href} className={i === 0 ? PRIMARY : OUTLINE}>
              {EXHAUSTED_LINKS[action].label}
            </Link>
          ))}
        </div>
      </section>
    );
  } else if (rem === 0) {
    content = (
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-xl bg-mint p-4">
          <CircleCheck size={20} aria-hidden="true" className="shrink-0 text-accent" />
          <div className="flex flex-col items-start gap-1">
            <p className="font-bold">오늘 단어 완료</p>
            <p className="text-sm">오늘 배운 단어를 대화에서 써 보세요.</p>
            <Link href="/chat" className={`mt-2 ${OUTLINE_SM}`}>
              대화하러 가기
            </Link>
          </div>
        </div>
        <LimitNotice feature="words" trial={trial} />
      </div>
    );
  } else {
    content = (
      <WordSession
        key={`learn-${language}`}
        mode="learn"
        language={language}
        level={level}
        words={unseen.words.slice(0, size)}
        todayCount={usage.newWords}
        remainingToday={rem}
        trial={trial}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 pt-6 animate-enter">
      {/* 제목과 탭은 회차(data-focus-mode) 동안 셸처럼 숨긴다(globals.css의 data-app-chrome 규칙) */}
      <div data-app-chrome className="flex flex-col gap-4">
        <h1 className={H1}>단어</h1>
        <div role="tablist" aria-label="단어 학습" className="inline-flex gap-0.5 self-start rounded-full bg-zone p-1">
          <Link
            href="/words"
            role="tab"
            aria-selected={!isReview}
            className={`${SEGMENT_ITEM} ${isReview ? "text-ink-muted" : "bg-card text-brand shadow-card"}`}
          >
            오늘의 학습
          </Link>
          <Link
            href="/words?tab=review"
            role="tab"
            aria-selected={isReview}
            className={`${SEGMENT_ITEM} ${isReview ? "bg-card text-brand shadow-card" : "text-ink-muted"}`}
          >
            오답 복습 <span className="tabular-nums">{review.total}</span>
          </Link>
        </div>
      </div>
      {content}
    </div>
  );
}
