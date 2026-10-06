import { Flame } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppNav } from "@/components/AppNav";
import { LanguageSheet } from "@/components/LanguageSheet";
import { ToastHost } from "@/components/Toast";
import { UsageCard } from "@/components/UsageCard";
import { planAt } from "@/lib/plan";
import { displayStreak } from "@/lib/streak";
import { kstDate } from "@/lib/usage";
import { loadTodayUsage, requireReady } from "@/server/page";

// 로그인 후 학습 페이지의 셸. 준비되지 않았으면 requireReady가 / 또는 /onboarding으로 보낸다.
// data-app-chrome 요소는 집중 화면(data-focus-mode)에서 globals.css가 숨긴다

const WORDMARK =
  "text-h3 font-extrabold tracking-[-0.03em] text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const page = await requireReady();
  const usage = await loadTodayUsage();
  const streak = displayStreak(page.account.streak, kstDate(page.now));
  const plan = planAt(page.account.proUntil, page.now);

  return (
    <div className="lg:flex">
      <aside
        data-app-chrome
        className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-62 lg:shrink-0 lg:flex-col lg:gap-8 lg:px-4 lg:py-6"
      >
        <Link href="/home" className={`px-4 ${WORDMARK}`}>
          Langrow
        </Link>
        <AppNav variant="sidebar" language={page.language} />
        <div className="mt-auto">
          <UsageCard usage={usage} plan={plan} compact />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header data-app-chrome className="sticky top-0 z-10 bg-page">
          <div className="mx-auto flex h-14 max-w-app items-center justify-between gap-3 px-4 lg:justify-end lg:px-10">
            <Link href="/home" className={`lg:hidden ${WORDMARK}`}>
              Langrow
            </Link>
            <div className="flex items-center gap-2">
              <LanguageSheet language={page.language} levels={page.account.levels} />
              <span
                role="img"
                aria-label={`연속 학습일 ${streak}일`}
                className="inline-flex items-center gap-1.5 rounded-full bg-gold-wash px-3 py-1.5 text-sm font-bold text-on-gold tabular-nums ring-1 ring-gold-light ring-inset"
              >
                <Flame size={16} aria-hidden="true" className="text-gold" />
                {streak}일
              </span>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-app px-4 pb-24 lg:px-10 lg:pb-16">{children}</main>
      </div>

      <div
        data-app-chrome
        className="fixed inset-x-0 bottom-0 z-10 bg-card pb-[env(safe-area-inset-bottom)] shadow-nav lg:hidden"
      >
        <AppNav variant="tabs" language={page.language} />
      </div>

      <ToastHost />
    </div>
  );
}
