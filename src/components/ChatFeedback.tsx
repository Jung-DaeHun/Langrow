"use client";

import { BookOpen, ChevronLeft, Circle, CircleAlert, CircleCheck, Info, Pencil, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Language } from "@/lib/levels";
import { TARGET_SOURCE_NAMES, type TargetSource, type TargetWord } from "@/lib/targetWords";
import { VALID_SESSION_TURNS, isValidSession } from "@/lib/today";
import type { EndResult } from "@/server/db/chat";
import type { ChatTurnView } from "@/server/db/reads";
import { api } from "@/services/apiClient";
import type { ChatEndResponse } from "@/types/api";
import { Furigana } from "./Furigana";
import { WaitingDots } from "./WaitingDots";

// 종료 피드백(집중 모드). result가 null이면 다른 요청이 피드백을 만드는 중(202)이라 화면이 보이는 동안 /end를 다시 확인한다.
// 확인 실패는 자동으로 반복하지 않는다. 피드백 문장은 후리가나 표기를 요청하지 않지만, 모델이 대화 기록의 표기를 따라 쓸 수 있어서
// 대화 말풍선과 같은 규칙으로 그린다(일본어는 ruby, 깨진 표기는 기호를 지움)

// server/chat.ts의 END_RETRY_AFTER_SECONDS와 같은 값이다(server-only라 가져오지 못한다)
const FIRST_CHECK_SECONDS = 2;
const IMPROVE_MAX = 3;

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const H1 = "text-h1 font-semibold tracking-[-0.02em] text-balance text-brand";
const PILL = `inline-flex h-9 items-center gap-1.5 rounded-full border border-line-input bg-card px-3 text-sm font-semibold text-ink hover:bg-hover ${FOCUS_RING}`;
const BUTTON = `inline-flex items-center justify-center gap-2 rounded-full font-semibold transition duration-200 active:scale-95 ${FOCUS_RING}`;
const PRIMARY = `${BUTTON} h-11 px-5 bg-accent text-white hover:bg-brand`;
const OUTLINE = `${BUTTON} h-11 px-5 border border-accent bg-transparent text-accent hover:bg-black/5`;
const OUTLINE_SM = `${BUTTON} h-9 px-4 text-sm border border-accent bg-transparent text-accent hover:bg-black/5`;
const NOTICE = "flex items-start gap-3 rounded-xl p-4";
const CARD = "flex flex-col gap-2 rounded-xl bg-card p-5 shadow-card";

type Props = {
  sessionId: string;
  scenarioTitle: string;
  language: Language;
  turns: ChatTurnView[];
  // 오늘(한국 날짜) 확정된 턴 수. 날짜를 넘겨 이어 한 세션도 홈의 오늘 목표와 같은 기준으로 판정한다
  doneTurnsToday: number;
  result: EndResult | null;
  // 대화방에 보이던 목표 단어 상태. 목표 단어가 없는 세션은 둘 다 null이다
  targetWords: TargetWord[] | null;
  targetSource: TargetSource | null;
};

export function ChatFeedback({
  sessionId,
  scenarioTitle,
  language,
  turns,
  doneTurnsToday,
  result,
  targetWords,
  targetSource,
}: Props) {
  const router = useRouter();
  const [polled, setPolled] = useState<EndResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [firstWait, setFirstWait] = useState(FIRST_CHECK_SECONDS);
  const shown = result ?? polled;
  const waiting = shown === null;
  const furigana = language === "ja";

  useEffect(() => {
    if (!waiting || error !== null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let stopped = false;

    async function check() {
      timer = undefined;
      inFlight = true;
      const res = await api<ChatEndResponse>("POST", `/api/chat/sessions/${sessionId}/end`);
      inFlight = false;
      if (stopped) return;
      if (!res.ok && res.code === "NOT_FOUND") router.push("/home");
      else if (!res.ok) setError(res.message);
      else if (res.data.status === "ended") {
        setPolled(res.data);
        // 뒤로 가기로 돌아와도 끝난 대화가 보이게 페이지 데이터를 다시 읽는다(spec/journey.md "예외 흐름")
        router.refresh();
      } else wait(res.data.retryAfterSeconds);
    }

    // 숨겨져 있으면 예약하지 않는다. 다시 보이면 onVisibility가 바로 확인한다
    function wait(seconds: number) {
      if (document.visibilityState === "visible") timer = setTimeout(check, seconds * 1000);
    }

    function onVisibility() {
      if (document.visibilityState !== "visible") {
        clearTimeout(timer);
        timer = undefined;
      } else if (timer === undefined && !inFlight) {
        void check();
      }
    }

    wait(firstWait);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [waiting, error, firstWait, sessionId, router]);

  function retry() {
    setError(null);
    setFirstWait(0);
  }

  const goal =
    shown === null || shown.feedbackStatus === "skipped" ? null : isValidSession(doneTurnsToday) ? (
      <div className={`${NOTICE} bg-mint`}>
        <CircleCheck size={20} aria-hidden="true" className="shrink-0 text-accent" />
        <p className="font-bold">오늘 대화 목표를 채웠어요</p>
      </div>
    ) : (
      <div className={`${NOTICE} bg-card shadow-card`}>
        <Info size={20} aria-hidden="true" className="shrink-0 text-accent" />
        <p className="font-bold">{VALID_SESSION_TURNS}턴 이상 대화하면 오늘 목표가 채워져요</p>
      </div>
    );
  const wordsCard =
    targetWords !== null && targetWords.length > 0 && targetSource !== null ? (
      <TargetWordsCard words={targetWords} source={targetSource} language={language} />
    ) : null;

  return (
    <div data-focus-mode className="flex flex-col gap-6 pt-4 pb-10 animate-enter">
      <div className="flex h-9 items-center">
        <Link href="/chat" className={PILL}>
          <ChevronLeft size={16} aria-hidden="true" />
          상황 목록
        </Link>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm text-ink-muted tabular-nums">
          {scenarioTitle} · {turns.length}턴
        </p>
        <h1 className={H1}>대화 피드백</h1>
      </div>

      {shown === null &&
        (error === null ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="font-semibold">피드백을 만들고 있어요</p>
            <WaitingDots label="잠시만 기다려 주세요" />
          </div>
        ) : (
          <div role="alert" className={`${NOTICE} bg-card ring-1 ring-danger ring-inset`}>
            <CircleAlert size={20} aria-hidden="true" className="shrink-0 text-danger" />
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm">{error}</p>
              <button type="button" onClick={retry} className={OUTLINE_SM}>
                다시 시도
              </button>
            </div>
          </div>
        ))}

      {goal}

      {shown?.feedbackStatus === "ready" && (
        <>
          {wordsCard}
          <div className={CARD}>
            <div className="flex items-center gap-2">
              <ThumbsUp size={20} aria-hidden="true" className="shrink-0 text-accent" />
              <h2 className="font-bold">잘한 점</h2>
            </div>
            <p>
              <Furigana text={shown.feedback.good} show={furigana} />
            </p>
          </div>
          {shown.feedback.improve.length > 0 && (
            <div className={CARD}>
              <div className="flex items-center gap-2">
                <Pencil size={20} aria-hidden="true" className="shrink-0 text-accent" />
                <h2 className="font-bold">고칠 점</h2>
              </div>
              <ul className="divide-y divide-line">
                {shown.feedback.improve.slice(0, IMPROVE_MAX).map((item, i) => (
                  <li key={i} className="py-2 first:pt-0 last:pb-0">
                    {/* 옛 형식의 문자열 항목은 설명과 예문이 섞인 한 줄이다(spec/chat.md "피드백 형식" "옛 형식") */}
                    {typeof item === "string" ? (
                      <Furigana text={item} show={furigana} />
                    ) : (
                      <>
                        <p>
                          <Furigana text={item.point} show={furigana} />
                        </p>
                        {item.example.trim() !== "" && (
                          <>
                            <p lang={language} className="mt-1 font-bold text-brand">
                              <Furigana text={item.example} show={furigana} />
                            </p>
                            {/* 만들 때 일본어 입문~중급만 요청했다. 피드백에는 번역 토글이 없어 중급도 항상 보인다 */}
                            {item.example_pron_ko && (
                              <p aria-hidden="true" className="text-sm text-brand">
                                {item.example_pron_ko}
                              </p>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {shown?.feedbackStatus === "fallback" && (
        <>
          <div className={`${NOTICE} bg-card shadow-card`}>
            <Info size={20} aria-hidden="true" className="shrink-0 text-accent" />
            <p className="text-sm">{shown.feedback.message}</p>
          </div>
          {wordsCard}
          <Corrections turns={turns} language={language} />
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <Link href="/chat" className={PRIMARY}>
          다른 상황 고르기
        </Link>
        <Link href="/home" className={OUTLINE}>
          홈으로
        </Link>
      </div>
    </div>
  );
}

// 배운 단어 결과(spec/chat.md "세션 종료 피드백"). 저장된 목표 단어와 쓴 단어로 그리고 Claude에 요청하지 않는다
function TargetWordsCard({ words, source, language }: { words: TargetWord[]; source: TargetSource; language: Language }) {
  return (
    <div className={CARD}>
      <div className="flex items-center gap-2">
        <BookOpen size={20} aria-hidden="true" className="shrink-0 text-accent" />
        <h2 id="feedback-target-words" className="font-bold tabular-nums">
          {TARGET_SOURCE_NAMES[source]} {words.length}개 중 {words.filter((w) => w.used).length}개를 썼어요
        </h2>
      </div>
      <ul aria-labelledby="feedback-target-words" className="divide-y divide-line">
        {words.map((w) => (
          <li key={w.id} className="flex items-center gap-3 py-2.5">
            {w.used ? (
              <CircleCheck size={20} aria-hidden="true" className="shrink-0 text-accent" />
            ) : (
              <Circle size={20} aria-hidden="true" className="shrink-0 text-ink-muted" />
            )}
            <span className="sr-only">{w.used ? "썼음" : "아직"}</span>
            {/* 한자 읽기는 [단어|읽기] 표기로 넘기고, 가타카나 읽기는 Furigana가 단다(단어 카드 앞면과 같다) */}
            <span lang={language} className="font-bold">
              <Furigana
                text={w.reading !== null && w.reading !== w.word ? `[${w.word}|${w.reading}]` : w.word}
                show={language === "ja"}
              />
            </span>
            <span className="text-sm text-ink-muted">{w.meaningKo}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// 대체 결과일 때 이미 저장된 턴별 교정을 다시 보여 준다
function Corrections({ turns, language }: { turns: ChatTurnView[]; language: Language }) {
  const corrected = turns.filter((t) => t.correction !== null);
  const furigana = language === "ja";
  return (
    <section className="flex flex-col gap-3">
      <h2 id="feedback-corrections" className="text-h3 font-semibold">
        교정
      </h2>
      {corrected.length === 0 ? (
        <p className="text-sm text-ink-muted">교정할 문장이 없었어요</p>
      ) : (
        <ul
          aria-labelledby="feedback-corrections"
          className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card"
        >
          {corrected.map((t) => (
            <li key={t.turnNo} className="flex flex-col gap-1 px-4 py-3.5">
              <p className="text-sm text-ink-muted">{t.userText}</p>
              <p lang={language} className="font-bold text-brand">
                <Furigana text={t.correction?.corrected ?? ""} show={furigana} />
              </p>
              <p className="text-sm">
                <Furigana text={t.correction?.explanation_ko ?? ""} show={furigana} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
