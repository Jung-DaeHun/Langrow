import { ChevronRight, Sprout } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { ProButton } from "@/components/ProButton";
import { TrialButton } from "@/components/TrialButton";
import { PLAN_LIMITS, PRO_PRICE_KRW, TRIAL_DAYS, trialState } from "@/lib/plan";
import { requireReady } from "@/server/page";
import { SITE } from "@/site.config";

export const metadata: Metadata = { title: "계정 · Langrow" };

// 체험 상태는 표시용으로만 계산한다. 시작 가능 여부와 실제 플랜은 서버가 DB 시각으로 판정한다

const TAG = "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold";
const MINT_TAG = `${TAG} bg-mint text-brand`;
const GOLD_TAG = `${TAG} bg-gold-wash text-on-gold ring-1 ring-gold-light ring-inset`;
const GRAY_TAG = `${TAG} bg-zone text-ink-muted`;
const ROW =
  "flex w-full items-center gap-3.5 px-4 py-3.5 text-left hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent";
const NOTE = "text-center text-micro text-ink-muted";

export default async function AccountPage() {
  const { email, account, now } = await requireReady();
  const trial = trialState(account.trialStartedAt, account.proUntil, now);
  const trialActive = trial.kind === "active";
  const { free, pro } = PLAN_LIMITS;
  const price = `월 ${PRO_PRICE_KRW.toLocaleString("ko-KR")}원`;

  return (
    <div className="flex flex-col gap-8 pt-6 animate-enter">
      <div className="flex flex-col gap-1">
        <h1 className="text-h1 font-semibold tracking-[-0.02em] text-balance text-brand">계정</h1>
        {email !== null && <p className="text-sm text-ink-muted">{email}</p>}
      </div>

      <section aria-labelledby="plan-title" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="plan-title" className="text-h3 font-semibold">
            플랜
          </h2>
          {trialActive ? <span className={GOLD_TAG}>체험 중</span> : <span className={GRAY_TAG}>Free</span>}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-xl bg-card p-5 shadow-card">
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold">Free</p>
              {!trialActive && <span className={MINT_TAG}>현재</span>}
            </div>
            <p className="text-sm text-ink-muted">
              대화 하루 {free.chatTurns}턴 · 새 단어 하루 {free.newWords}개
            </p>
            <p className="text-h1 font-bold">무료</p>
          </div>
          <div className="flex flex-col gap-2 rounded-xl bg-gold-wash p-5 text-on-gold shadow-card">
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold">Pro</p>
              {trialActive && <span className={GOLD_TAG}>체험 중</span>}
            </div>
            <p className="text-sm text-ink-muted">
              대화 하루 {pro.chatTurns}턴 · 새 단어 하루 {pro.newWords}개
            </p>
            <p className="text-h1 font-bold">{price}</p>
          </div>
        </div>

        {trial.kind === "available" && (
          <div className="flex flex-col gap-2">
            <TrialButton label={`${TRIAL_DAYS}일 무료 체험 시작`} size="lg" fullWidth />
            <p className={NOTE}>계정당 한 번 · 결제 정보 없이 시작해요</p>
          </div>
        )}
        {trial.kind === "active" && (
          <div className="flex items-start gap-3 rounded-xl bg-gold-wash p-4 text-on-gold ring-1 ring-gold-light ring-inset">
            <Sprout size={20} aria-hidden="true" className="shrink-0 text-gold" />
            <div className="flex flex-col gap-1">
              <p className="font-bold">Pro 체험 중 · {trial.daysLeft}일 남음</p>
              <p className="text-sm">체험이 끝나면 Free로 돌아가요. 자동 결제는 없어요.</p>
            </div>
          </div>
        )}
        {trial.kind === "ended" && (
          <div className="flex flex-col gap-2">
            <ProButton label={`Pro 시작하기 · ${price}`} size="lg" fullWidth />
            <p className={NOTE}>무료 체험은 이미 사용했어요.</p>
          </div>
        )}
      </section>

      <div className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">
        <Link href="/terms" className={ROW}>
          <span className="flex-1 font-bold">이용약관</span>
          <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-ink-muted" />
        </Link>
        <Link href="/privacy" className={ROW}>
          <span className="flex-1 font-bold">개인정보처리방침</span>
          <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-ink-muted" />
        </Link>
        <div className="flex flex-col gap-0.5 px-4 py-3.5">
          <p className="font-bold">회원 탈퇴</p>
          <p className="text-sm text-ink-muted">
            회원 탈퇴는 {SITE.contactEmail}로 요청해 주세요. 학습 기록이 모두 삭제돼요.
          </p>
        </div>
      </div>

      <LogoutButton />
    </div>
  );
}
