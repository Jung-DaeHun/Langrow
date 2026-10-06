"use client";

import { CircleCheck, CircleX } from "lucide-react";
import { useState } from "react";
import { isCorrectChoice, type BlankQuestion } from "@/lib/blank";
import type { Language } from "@/lib/levels";
import { Furigana } from "./Furigana";

// 빈칸 퀴즈(ui.md "빈칸 퀴즈"). 단어 학습(learn)은 고르면 바로 채점을 보여 주고, 레벨업 테스트(test)는 정답을 모르므로
// 정답 여부 없이 바로 onNext를 부른다. 고른 뒤에는 잠기므로 다음 문제는 부모가 key로 새로 만든다.
// index는 0부터이고 화면에는 index + 1을 보여 준다

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const PRIMARY = `inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-accent px-5 font-semibold text-white transition duration-200 hover:bg-brand active:scale-95 ${FOCUS_RING}`;
const OPTION = `flex w-full items-center gap-3 rounded-xl px-4.5 py-4 text-left text-lead font-semibold shadow-card transition disabled:cursor-default ${FOCUS_RING}`;

type Props = {
  question: BlankQuestion;
  language: Language;
  showFurigana: boolean;
  stepLabel: string;
  index: number;
  total: number;
  mode: "learn" | "test";
  answer?: string;
  meaningKo?: string;
  isLast: boolean;
  onNext: (choice: string) => void;
};

export function BlankQuiz({
  question,
  language,
  showFurigana,
  stepLabel,
  index,
  total,
  mode,
  answer,
  meaningKo,
  isLast,
  onNext,
}: Props) {
  const [choice, setChoice] = useState<string | null>(null);
  const graded = mode === "learn" && choice !== null;

  function choose(option: string) {
    if (choice !== null) return;
    setChoice(option);
    if (mode === "test") onNext(option);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-semibold">{stepLabel}</span>
          <span className="text-ink-muted tabular-nums">
            {index + 1} / {total}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={stepLabel}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={index + 1}
          className="h-1 overflow-hidden rounded-full bg-zone"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-400"
            style={{ width: `${((index + 1) / total) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl bg-card p-6 shadow-card">
        <p lang={language} className="text-quiz font-semibold">
          <Furigana text={question.before} show={showFurigana} />
          <span className="inline-block min-w-18 border-b-2 border-accent">
            <span className="sr-only">빈칸</span>
          </span>
          <Furigana text={question.after} show={showFurigana} />
        </p>
        <p className="text-sm text-ink-muted">{question.exampleKo}</p>
      </div>

      <div className="flex flex-col gap-2">
        {question.options.map((option) => {
          const mark = !graded ? null : option === answer ? "correct" : option === choice ? "wrong" : null;
          const tone =
            mark === "correct"
              ? "bg-ok-wash ring-2 ring-accent"
              : mark === "wrong"
                ? "bg-danger-wash ring-2 ring-danger"
                : "bg-card enabled:hover:ring-1 enabled:hover:ring-line-input";
          return (
            <button
              key={option}
              type="button"
              onClick={() => choose(option)}
              disabled={choice !== null}
              className={`${OPTION} ${tone}`}
            >
              <span lang={language} className="flex-1">
                <Furigana text={option} show={showFurigana} />
              </span>
              {/* 색만으로 알리지 않는다. 아이콘에 이름을 달고 아래 문구로도 알린다 */}
              {mark === "correct" && <CircleCheck size={20} role="img" aria-label="정답" className="shrink-0 text-accent" />}
              {mark === "wrong" && <CircleX size={20} role="img" aria-label="오답" className="shrink-0 text-danger" />}
            </button>
          );
        })}
      </div>

      {/* live region은 처음부터 두어야 채점 문구가 읽힌다. 비어 있으면 숨긴다 */}
      <p aria-live="polite" className="font-semibold empty:hidden">
        {graded &&
          (isCorrectChoice(choice, answer ?? "") ? (
            "정답이에요."
          ) : (
            <>
              오답이에요. 정답은{" "}
              <strong lang={language} className="text-brand">
                <Furigana text={answer ?? ""} show={showFurigana} />
              </strong>{" "}
              ({meaningKo})
            </>
          ))}
      </p>
      {graded && (
        <button type="button" onClick={() => onNext(choice)} className={PRIMARY}>
          {isLast ? "결과 보기" : "다음 문제"}
        </button>
      )}
    </div>
  );
}
