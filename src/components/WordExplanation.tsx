"use client";

import { CircleAlert, Info, Sprout } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FREE_DAILY_EXPLANATIONS, type TrialState } from "@/lib/plan";
import { api } from "@/services/apiClient";
import type { WordExplainResponse } from "@/types/api";
import { Furigana } from "./Furigana";
import { ProButton } from "./ProButton";
import { TrialButton } from "./TrialButton";
import { WaitingDots } from "./WaitingDots";

// AI 정답 설명(ui.md "AI 정답 설명"). 빈칸 퀴즈(choice 있음)와 오답 복습 카드(choice 없음)가 같이 쓴다.
// 문제·카드마다 부모의 key로 새로 만들어지므로 요청은 문제마다 한 번이다. 429 안내는 회차 전체에 걸리므로
// block은 부모(WordSession)가 들고, 여기서는 429를 받으면 onBlock으로 알린다. 사라진 뒤 도착한 응답은 버린다

export type ExplanationBlock = { kind: "limit" } | { kind: "failure-limit"; message: string };

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const OUTLINE_SM = `inline-flex h-9 w-full items-center justify-center gap-2 rounded-full border border-accent bg-transparent px-4 text-sm font-semibold text-accent transition duration-200 hover:bg-black/5 active:scale-95 ${FOCUS_RING}`;
const PILL = `inline-flex h-9 items-center gap-1.5 rounded-full border border-line-input bg-card px-3 text-sm font-semibold text-ink hover:bg-hover ${FOCUS_RING}`;
const NOTICE = "flex items-start gap-3 rounded-xl p-4";

type Props = {
  wordId: string;
  choice?: string; // 빈칸에서 고른 보기. 복습 카드는 넘기지 않는다
  label: string; // [AI 해설] 또는 [예문 설명]
  showFurigana: boolean;
  trial: TrialState;
  block: ExplanationBlock | null;
  onBlock: (block: ExplanationBlock) => void;
  onTrialStarted: () => void;
};

type State =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "done"; explanation: string }
  | { kind: "error"; message: string };

export function WordExplanation({ wordId, choice, label, showFurigana, trial, block, onBlock, onTrialStarted }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function request() {
    setState({ kind: "waiting" });
    const body = choice === undefined ? { word_id: wordId } : { word_id: wordId, choice };
    const result = await api<WordExplainResponse>("POST", "/api/words/explain", body);
    if (!mounted.current) return;
    if (result.ok) {
      setState({ kind: "done", explanation: result.data.explanation });
    } else if (result.code === "LIMIT_REACHED") {
      setState({ kind: "idle" });
      onBlock({ kind: "limit" });
    } else if (result.code === "AI_FAILURE_LIMIT") {
      setState({ kind: "idle" });
      onBlock({ kind: "failure-limit", message: result.message });
    } else {
      // 503·네트워크·400·404·500. 홈으로 이동하지 않고 그 자리에서 다시 시도한다
      setState({ kind: "error", message: result.message });
    }
  }

  let content: ReactNode;
  if (state.kind === "done") {
    // 받은 설명은 뒤에 회차 안내가 생겨도 그대로 둔다
    content = (
      <div className="flex flex-col gap-1 rounded-xl bg-mint p-3">
        <p className="text-micro text-ink-muted">AI 설명</p>
        <p className="text-sm">
          <Furigana text={state.explanation} show={showFurigana} />
        </p>
      </div>
    );
  } else if (block?.kind === "limit") {
    // Free만 받는다. 회차의 primary는 [다음 문제]라 체험·Pro 버튼은 outline이고 [내일 할게요]는 두지 않는다
    content = (
      <div className={`${NOTICE} bg-gold-wash text-on-gold ring-1 ring-gold-light ring-inset`}>
        <Sprout size={20} aria-hidden="true" className="shrink-0 text-gold" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-bold">오늘 AI 설명 {FREE_DAILY_EXPLANATIONS}회를 모두 썼어요</p>
          <p className="text-sm">Pro는 AI 설명을 제한 없이 볼 수 있어요.</p>
          <div className="mt-2 flex flex-wrap items-start gap-2">
            {trial.kind === "available" ? (
              <TrialButton label="7일 무료 체험" size="sm" tone="outline" onStarted={onTrialStarted} />
            ) : (
              <ProButton label="Pro 시작하기" size="sm" tone="outline" />
            )}
          </div>
        </div>
      </div>
    );
  } else if (block?.kind === "failure-limit") {
    content = (
      <div className={`${NOTICE} bg-card shadow-card`}>
        <Info size={20} aria-hidden="true" className="shrink-0 text-accent" />
        <p className="text-sm">{block.message}</p>
      </div>
    );
  } else if (state.kind === "waiting") {
    content = (
      <div className="flex h-9 items-center justify-center">
        <WaitingDots label="설명을 만드는 중" />
      </div>
    );
  } else if (state.kind === "error") {
    content = (
      <div role="alert" className={`${NOTICE} bg-card ring-1 ring-danger ring-inset`}>
        <CircleAlert size={20} aria-hidden="true" className="shrink-0 text-danger" />
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm">{state.message}</p>
          <button type="button" onClick={request} className={PILL}>
            다시 시도
          </button>
        </div>
      </div>
    );
  } else {
    content = (
      <button type="button" onClick={request} className={OUTLINE_SM}>
        {label}
      </button>
    );
  }

  // 대기·설명이 읽히도록 live region은 처음부터 둔다
  return <div aria-live="polite">{content}</div>;
}
