"use client";

import { useState, type ReactNode } from "react";

// 플래시카드(ui.md "플래시카드"). 단어 학습·오답 복습·가나가 같이 쓴다. 다음 카드는 부모가 key로 새로 만들어 앞면부터 시작한다.
// 카드 전체가 <button>이라 Space·Enter로 뒤집힌다. 면은 버튼 안이라 front·back은 phrasing 요소(span 등)로 넘긴다

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const BUTTON = `inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 font-semibold transition duration-200 active:scale-95 ${FOCUS_RING}`;
const PRIMARY = `${BUTTON} bg-accent text-white hover:bg-brand`;
const OUTLINE = `${BUTTON} border border-accent bg-transparent text-accent hover:bg-black/5`;
const FACE =
  "absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-card p-6 text-center shadow-raised backface-hidden";

type Props = { front: ReactNode; back: ReactNode; revealed?: ReactNode; onAnswer: (knew: boolean) => void };

export function Flashcard({ front, back, revealed, onAnswer }: Props) {
  const [flipped, setFlipped] = useState(false);
  // revealed(오답 복습의 AI 설명)는 뒷면을 처음 본 뒤부터 둔다. 앞면으로 돌리면 숨기기만 해서
  // 기다리던 요청이나 받은 설명을 잃지 않는다(다시 누르면 또 차감된다)
  const [seenBack, setSeenBack] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-[440px] flex-col gap-4">
      <button
        type="button"
        onClick={() => {
          setFlipped((v) => !v);
          setSeenBack(true);
        }}
        className={`block aspect-[4/3.4] w-full rounded-xl perspective-distant ${FOCUS_RING}`}
      >
        {/* reduced motion이면 globals.css가 transition을 0으로 만들어 회전 없이 면만 바뀐다 */}
        <span
          className={`relative block size-full transition-transform duration-450 ease-soft transform-3d motion-reduce:transition-none ${flipped ? "rotate-y-180" : ""}`}
        >
          {/* 보이지 않는 면은 aria-hidden이라 카드 버튼의 이름은 보이는 면의 글자다 */}
          <span aria-hidden={flipped} className={FACE}>
            {front}
          </span>
          <span aria-hidden={!flipped} className={`${FACE} rotate-y-180`}>
            {back}
          </span>
        </span>
      </button>
      {revealed !== undefined && seenBack && <div hidden={!flipped}>{revealed}</div>}
      <div className="flex gap-2">
        <button type="button" onClick={() => onAnswer(false)} className={`${OUTLINE} flex-1`}>
          모르겠어요
        </button>
        <button type="button" onClick={() => onAnswer(true)} className={`${PRIMARY} flex-1`}>
          알아요
        </button>
      </div>
    </div>
  );
}
