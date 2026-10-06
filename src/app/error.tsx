"use client";

import Link from "next/link";

// 셸 밖의 오류((app) 레이아웃 자체의 읽기 실패 등). retry는 서버에서 다시 읽고 다시 그린다
const BUTTON =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 font-semibold transition duration-200 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export default function RootError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-app flex-col gap-6 px-4 py-16 animate-enter lg:px-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-h1 font-semibold tracking-[-0.02em] text-balance text-brand">화면을 불러오지 못했어요</h1>
        <p className="text-ink-muted">잠시 후 다시 시도해 보세요.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/home" className={`${BUTTON} bg-accent text-white hover:bg-brand`}>
          홈으로
        </Link>
        <button
          type="button"
          onClick={() => retry()}
          className={`${BUTTON} border border-accent bg-transparent text-accent hover:bg-black/5`}
        >
          다시 시도
        </button>
      </div>
    </main>
  );
}
