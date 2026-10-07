"use client";

import { ChevronLeft, CircleAlert, CircleCheck, Info, Pencil, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { showsFurigana, type Language, type Level } from "@/lib/levels";
import { VALID_SESSION_TURNS, isValidSession } from "@/lib/today";
import type { EndResult } from "@/server/db/chat";
import type { ChatTurnView } from "@/server/db/reads";
import { api } from "@/services/apiClient";
import type { ChatEndResponse } from "@/types/api";
import { Furigana } from "./Furigana";
import { WaitingDots } from "./WaitingDots";

// 종료 피드백(집중 모드). result가 null이면 다른 요청이 피드백을 만드는 중(202)이라 화면이 보이는 동안 /end를 다시 확인한다.
// 확인 실패는 자동으로 반복하지 않는다. 피드백 문장은 후리가나 표기를 요청하지 않지만, 모델이 대화 기록의 표기를 따라 쓸 수 있어서
// 대화 말풍선과 같은 규칙으로 그린다(보이는 레벨은 ruby, 숨기는 레벨과 깨진 표기는 기호를 지움)

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
  level: Level;
  turns: ChatTurnView[];
  // 오늘(한국 날짜) 확정된 턴 수. 날짜를 넘겨 이어 한 세션도 홈의 오늘 목표와 같은 기준으로 판정한다
  doneTurnsToday: number;
  result: EndResult | null;
};

export function ChatFeedback({ sessionId, scenarioTitle, language, level, turns, doneTurnsToday, result }: Props) {
  const router = useRouter();
  const [polled, setPolled] = useState<EndResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [firstWait, setFirstWait] = useState(FIRST_CHECK_SECONDS);
  const shown = result ?? polled;
  const waiting = shown === null;
  const furigana = language === "ja" && showsFurigana(level);

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
      else if (res.data.status === "ended") setPolled(res.data);
      else wait(res.data.retryAfterSeconds);
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
                    <Furigana text={item} show={furigana} />
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
          <Corrections turns={turns} language={language} level={level} />
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

// 대체 결과일 때 이미 저장된 턴별 교정을 다시 보여 준다
function Corrections({ turns, language, level }: { turns: ChatTurnView[]; language: Language; level: Level }) {
  const corrected = turns.filter((t) => t.correction !== null);
  const furigana = language === "ja" && showsFurigana(level);
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
