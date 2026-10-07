"use client";

import { Moon, Sprout } from "lucide-react";
import { useState } from "react";
import { PLAN_LIMITS, type TrialState } from "@/lib/plan";
import { ProButton } from "./ProButton";
import { TrialButton } from "./TrialButton";

// 한도 도달 안내 3상태(ui.md "한도 도달 안내"). 홈·대화방·단어 화면이 같이 쓴다. trial은 페이지가 서버 시각으로 계산한 값이다

// both: 홈에서 두 한도에 모두 닿았을 때 안내를 하나로 합친다(primary는 화면에 하나)
const TITLES = {
  chat: "오늘 AI 대화 턴을 모두 썼어요",
  words: "오늘 새 단어를 모두 썼어요",
  both: "오늘 AI 대화 턴과 새 단어를 모두 썼어요",
};
const NOTICE = "flex items-start gap-3 rounded-xl p-4";
const OUTLINE_SM =
  "inline-flex h-9 items-center justify-center gap-2 rounded-full border border-accent bg-transparent px-4 text-sm font-semibold text-accent transition duration-200 hover:bg-black/5 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

type Props = {
  feature: keyof typeof TITLES;
  trial: TrialState;
  onLater?: () => void;
  onTrialStarted?: () => void;
};

export function LimitNotice({ feature, trial, onLater, onTrialStarted }: Props) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  if (trial.kind === "active") {
    return (
      <div className={`${NOTICE} bg-card shadow-card`}>
        <Moon size={20} aria-hidden="true" className="shrink-0 text-accent" />
        <div className="flex flex-col gap-1">
          <p className="font-bold">오늘 사용량을 모두 썼어요</p>
          <p className="text-sm text-ink-muted">한국 시간 자정에 다시 채워져요. 복습과 레벨업 테스트는 계속할 수 있어요.</p>
        </div>
      </div>
    );
  }

  const pro = PLAN_LIMITS.pro;
  return (
    <div className={`${NOTICE} bg-gold-wash text-on-gold ring-1 ring-gold-light ring-inset`}>
      <Sprout size={20} aria-hidden="true" className="shrink-0 text-gold" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-bold">{TITLES[feature]}</p>
        <p className="text-sm">
          Pro는 하루 대화 {pro.chatTurns}턴, 새 단어 {pro.newWords}개까지 할 수 있어요. 결제 정보는 받지 않아요.
        </p>
        <div className="mt-2 flex flex-wrap items-start gap-2">
          {trial.kind === "available" ? (
            <>
              <TrialButton label="7일 무료 체험" size="sm" onStarted={onTrialStarted} />
              <button type="button" onClick={onLater ?? (() => setHidden(true))} className={OUTLINE_SM}>
                내일 할게요
              </button>
            </>
          ) : (
            <ProButton label="Pro 시작하기" size="sm" />
          )}
        </div>
      </div>
    </div>
  );
}
