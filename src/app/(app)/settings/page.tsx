import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireReady } from "@/server/page";

export const metadata: Metadata = { title: "설정 · Langrow" };

// 설정(spec/ui.md "/settings"). 지금은 고를 수 있는 음성이 여성 하나라 저장하지 않는 정적 화면이다.
// 남성 음성을 넣을 때 남성 타일을 켜고 계정에 저장한다(spec/audio.md "나중에: 남성 음성")

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const PILL = `inline-flex h-9 items-center gap-1.5 self-start rounded-full border border-line-input bg-card px-3 text-sm font-semibold text-ink hover:bg-hover ${FOCUS_RING}`;
const TILE = `flex w-full items-center gap-3.5 rounded-xl p-4 text-left shadow-card transition disabled:cursor-not-allowed ${FOCUS_RING}`;
const TILE_IDLE = "bg-card";
const TILE_SELECTED = "bg-ok-wash ring-2 ring-accent";

export default async function SettingsPage() {
  await requireReady();

  return (
    <div className="flex flex-col gap-6 pt-6 animate-enter">
      <Link href="/account" className={PILL}>
        <ChevronLeft size={16} aria-hidden="true" />
        계정
      </Link>
      <h1 className="text-h1 font-semibold tracking-[-0.02em] text-balance text-brand">설정</h1>

      <section aria-labelledby="voice-title" className="flex flex-col gap-3">
        <h2 id="voice-title" className="text-h3 font-semibold">
          음성
        </h2>
        <div role="radiogroup" aria-labelledby="voice-title" className="flex flex-col gap-2">
          <button type="button" role="radio" aria-checked="true" className={`${TILE} ${TILE_SELECTED}`}>
            <span className="flex flex-col gap-0.5">
              <span className="font-bold">여성</span>
              <span className="text-sm text-ink-muted">영어 Ava · 일본어 Nanami</span>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked="false"
            aria-disabled="true"
            disabled
            className={`${TILE} ${TILE_IDLE} opacity-50`}
          >
            <span className="flex flex-col gap-0.5">
              <span className="font-bold">남성</span>
              <span className="text-sm text-ink-muted">준비 중이에요</span>
            </span>
          </button>
        </div>
        <p className="text-sm text-ink-muted">대화 문장은 기기의 음성으로 읽어요.</p>
      </section>
    </div>
  );
}
