import type { Metadata } from "next";
import { KanaDeck } from "@/components/KanaDeck";
import { requireReady } from "@/server/page";

export const metadata: Metadata = { title: "가나 익히기 · Langrow" };

// 가나 익히기(spec 3-1). 상수만 쓰고 DB를 읽지 않는다. 기록(kana_studied)은 KanaDeck이 회차를 마칠 때 보낸다

export default async function KanaPage() {
  await requireReady();

  return (
    <div className="flex flex-col gap-6 pt-6 animate-enter">
      {/* 제목은 카드(data-focus-mode) 동안 셸처럼 숨긴다(globals.css의 data-app-chrome 규칙) */}
      <div data-app-chrome className="flex flex-col gap-1">
        <h1 className="text-h1 font-semibold tracking-[-0.02em] text-balance text-brand">가나 익히기</h1>
        <p className="text-sm text-ink-muted">사용량에 포함되지 않아요</p>
      </div>
      <KanaDeck />
    </div>
  );
}
