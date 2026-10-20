"use client";

import { useId, useState } from "react";
import { LANGUAGE_NAMES, LANGUAGES, type Language } from "@/lib/levels";
import type { ScenarioLine } from "@/lib/scenarios";
import { Furigana } from "./Furigana";

// 랜딩 히어로의 대화 미리보기(spec/ui.md "랜딩"). 대화방의 입문 레벨 모양을 그리고, 상태는 지금 탭 하나다.
// 첫 마디만 page.tsx가 상황 데이터에서 골라 넘기고(상황 데이터 전체를 번들에 넣지 않는다) 나머지는 고정 문구다.
// 로그인 전 화면이라 탭 전환은 이벤트로 남기지 않는다. 듣기·번역·뜯어보기 버튼은 두지 않는다

// 세그먼트는 KanaDeck, 말풍선은 ChatRoom의 클래스를 복사해 둔다
const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const SEGMENT_ITEM = `rounded-full px-4 py-2 text-sm font-semibold ${FOCUS_RING}`;
const AI_BUBBLE = "rounded-bubble rounded-bl-md bg-card px-3.5 py-3 shadow-card";
const MY_BUBBLE = "max-w-[84%] self-end whitespace-pre-wrap wrap-anywhere rounded-bubble rounded-br-md px-3.5 py-3";

type PreviewLine = Pick<ScenarioLine, "text" | "ko" | "pronKo">;

// 2026-10-19 운영자가 검수해 확정한 문구다. 바꾸면 다시 검수한다(ADR-022). 영어에는 한글 발음이 없다
const LINES: Record<
  Language,
  { mine: string; corrected: string; correctedPronKo?: string; explanation: string; reply: PreviewLine }
> = {
  en: {
    mine: "아이스 아메리카노 주세요",
    corrected: "Can I get an iced americano?",
    explanation: "Can I get ~?은 주문할 때 많이 써요.",
    reply: { text: "Sure! What size would you like?", ko: "물론이죠! 어떤 사이즈로 드릴까요?" },
  },
  ja: {
    mine: "아이스 커피 하나 주세요",
    corrected: "アイスコーヒーを[一|ひと]つください。",
    correctedPronKo: "아이스코-히-오 히토츠 쿠다사이.",
    explanation: "~をください는 물건을 달라고 할 때 써요.",
    reply: { text: "はい、サイズはどうしますか？", ko: "네, 사이즈는 어떻게 하시겠어요?", pronKo: "하이, 사이즈와 도-시마스카?" },
  },
};

export function LandingPreview({ title, openings }: { title: string; openings: Record<Language, PreviewLine> }) {
  const id = useId();
  const [language, setLanguage] = useState<Language>("en");
  const lines = LINES[language];

  return (
    <div className="rounded-xl bg-page p-4 shadow-raised md:p-5">
      <div role="tablist" aria-label="언어" className="inline-flex gap-0.5 rounded-full bg-zone p-1">
        {LANGUAGES.map((l) => (
          <button
            key={l}
            id={`${id}-${l}`}
            type="button"
            role="tab"
            aria-selected={l === language}
            onClick={() => setLanguage(l)}
            className={`${SEGMENT_ITEM} ${l === language ? "bg-card text-brand shadow-card" : "text-ink-muted"}`}
          >
            {LANGUAGE_NAMES[l]}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-labelledby={`${id}-${language}`} className="mt-4 flex flex-col gap-3">
        <p className="text-micro text-ink-muted">상황 · {title}</p>
        <AiBubble line={openings[language]} language={language} />
        <p lang="ko" className={`${MY_BUBBLE} bg-house text-white`}>
          {lines.mine}
        </p>
        <div className="flex max-w-[84%] flex-col gap-1 self-end rounded-xl bg-mint p-3">
          <p className="text-micro text-ink-muted">이렇게 말하면 돼요</p>
          <p lang={language} className="font-bold text-brand">
            <Furigana text={lines.corrected} show={language === "ja"} />
          </p>
          {lines.correctedPronKo && (
            <p aria-hidden="true" className="text-sm text-brand">
              {lines.correctedPronKo}
            </p>
          )}
          <p lang="ko" className="text-sm">
            {lines.explanation}
          </p>
        </div>
        <AiBubble line={lines.reply} language={language} />
      </div>
    </div>
  );
}

// 대화방 AiBubble의 입문 레벨 모양: 번역을 늘 펼치고, 한글 발음은 값이 있을 때만 문장 아래에 둔다
function AiBubble({ line, language }: { line: PreviewLine; language: Language }) {
  return (
    <div className="flex max-w-[84%] flex-col items-start gap-1 self-start">
      <div className={AI_BUBBLE}>
        <span lang={language} className="block whitespace-pre-wrap wrap-anywhere">
          <Furigana text={line.text} show={language === "ja"} />
        </span>
        {line.pronKo && (
          <span aria-hidden="true" className="mt-1 block text-sm text-brand">
            {line.pronKo}
          </span>
        )}
        <span lang="ko" className="mt-2 block border-t border-line pt-2 text-sm text-ink-muted">
          {line.ko}
        </span>
      </div>
    </div>
  );
}
