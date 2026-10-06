"use client";

import { Award, ChevronLeft, CircleAlert, Info, ListChecks, Repeat, Target } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import type { BlankQuestion } from "@/lib/blank";
import { LANGUAGE_NAMES, LEVEL_INFO, showsFurigana, type Language, type Level } from "@/lib/levels";
import { LEVEL_TEST_SIZE, PASS_SCORE } from "@/lib/levelTest";
import { api } from "@/services/apiClient";
import type { LevelUpResponse } from "@/types/api";
import { BlankQuiz } from "./BlankQuiz";
import { Furigana } from "./Furigana";
import { WaitingDots } from "./WaitingDots";

// 레벨업 테스트. 정답은 클라이언트에 없다(spec 4장): 문제에는 빈칸 문장·번역·섞은 보기만 있고, 채점은 서버가 한다.
// 정답은 제출 뒤 서버가 준 wrong으로만 보여 준다. 답은 useState에만 두고, [그만하기]면 버린다.
// 합격하면 셸의 레벨 표시도 새로 읽도록 전체 이동(window.location.assign)한다

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const H1 = "text-h1 font-semibold tracking-[-0.02em] text-balance text-brand";
const BUTTON = `inline-flex items-center justify-center gap-2 rounded-full font-semibold transition duration-200 active:scale-95 ${FOCUS_RING}`;
const PRIMARY = `${BUTTON} h-11 px-5 bg-accent text-white hover:bg-brand`;
const OUTLINE = `${BUTTON} h-11 px-5 border border-accent bg-transparent text-accent hover:bg-black/5`;
const OUTLINE_SM = `${BUTTON} h-9 px-4 text-sm border border-accent bg-transparent text-accent hover:bg-black/5`;
const PILL = `inline-flex h-9 items-center gap-1.5 rounded-full border border-line-input bg-card px-3 text-sm font-semibold text-ink hover:bg-hover ${FOCUS_RING}`;
const FOCUS_ROOT = "flex flex-col gap-6 pb-10";

type Props = { language: Language; fromLevel: Level; questions: BlankQuestion[] };

// 레벨이 바뀌었으면 셸(상단 레벨 표시·사이드바)도 서버에서 다시 그리도록 전체 이동한다
function reloadTo(path: "/home" | "/chat") {
  window.location.assign(path);
}
type Phase = "start" | "questions" | "grading" | "result" | "failed";

export function LevelTestRunner({ language, fromLevel, questions }: Props) {
  const router = useRouter();
  const wrongTitleId = useId();
  const [phase, setPhase] = useState<Phase>("start");
  const [answers, setAnswers] = useState<string[]>([]);
  const [result, setResult] = useState<LevelUpResponse | null>(null);
  const [failure, setFailure] = useState<{ conflict: boolean; message: string } | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [phase]);

  const from = LEVEL_INFO[fromLevel].name;
  const to = LEVEL_INFO[(fromLevel + 1) as Level].name;
  const furigana = language === "ja" && showsFurigana(fromLevel);

  function start() {
    setAnswers([]);
    setPhase("questions");
  }

  function choose(choice: string) {
    const next = [...answers, choice];
    setAnswers(next);
    if (next.length === questions.length) void submit(next);
  }

  // 다시 시도도 같은 답을 문제 순서대로 보낸다. 자동으로 다시 보내지 않는다
  async function submit(all: string[]) {
    setPhase("grading");
    const res = await api<LevelUpResponse>("POST", "/api/level-up", {
      language,
      from_level: fromLevel,
      answers: questions.map((q, i) => ({ word_id: q.wordId, answer: all[i] })),
    });
    if (res.ok) {
      setResult(res.data);
      setPhase("result");
    } else {
      setFailure({ conflict: res.code === "CONFLICT", message: res.message });
      setPhase("failed");
    }
  }

  function retake() {
    setPhase("start");
    router.refresh();
  }

  const quitButton = (
    <button type="button" onClick={() => setPhase("start")} className={`self-start ${PILL}`}>
      <ChevronLeft size={16} aria-hidden="true" />
      그만하기
    </button>
  );

  if (phase === "start") {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-ink-muted">{LANGUAGE_NAMES[language]}</p>
          <h1 className={H1}>
            {from} → {to} 레벨업 테스트
          </h1>
        </div>
        <ul className="flex flex-col gap-3 rounded-xl bg-card p-5 shadow-card">
          <li className="flex items-center gap-3">
            <ListChecks size={20} aria-hidden="true" className="shrink-0 text-accent" />
            {from} 단어 빈칸 {LEVEL_TEST_SIZE}문제
          </li>
          <li className="flex items-center gap-3">
            <Target size={20} aria-hidden="true" className="shrink-0 text-accent" />
            {PASS_SCORE}개 이상 맞히면 레벨 +1
          </li>
          <li className="flex items-center gap-3">
            <Repeat size={20} aria-hidden="true" className="shrink-0 text-accent" />
            재응시 제한 없음 · 사용량에 포함되지 않아요
          </li>
        </ul>
        <p className="text-sm text-ink-muted">제출하면 서버가 채점해요</p>
        <button type="button" onClick={start} className={`${PRIMARY} w-full`}>
          테스트 시작
        </button>
      </div>
    );
  }

  if (phase === "questions") {
    const index = answers.length;
    const question = questions[index];
    return (
      <div data-focus-mode className={FOCUS_ROOT}>
        {quitButton}
        <BlankQuiz
          key={question.wordId}
          question={question}
          language={language}
          showFurigana={furigana}
          stepLabel="레벨업 테스트"
          index={index}
          total={questions.length}
          mode="test"
          isLast={index === questions.length - 1}
          onNext={choose}
        />
      </div>
    );
  }

  if (phase === "grading") {
    return (
      <div data-focus-mode className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="font-semibold">채점하고 있어요</p>
        <WaitingDots label="잠시만 기다려 주세요" />
      </div>
    );
  }

  if (phase === "failed" && failure !== null) {
    return (
      <div data-focus-mode className={FOCUS_ROOT}>
        {/* 레벨이 이미 바뀌었으면(409) 이 시험은 끝났다. 셸도 새로 읽도록 전체 이동만 둔다 */}
        {!failure.conflict && quitButton}
        <div role="alert" className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-danger ring-inset">
          <CircleAlert size={20} aria-hidden="true" className="shrink-0 text-danger" />
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm">{failure.message}</p>
            {failure.conflict ? (
              <button type="button" onClick={() => reloadTo("/home")} className={OUTLINE_SM}>
                홈으로
              </button>
            ) : (
              <button type="button" onClick={() => void submit(answers)} className={OUTLINE_SM}>
                다시 시도
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (result === null) return null;
  const { passed, score, wrong } = result;

  return (
    <div data-focus-mode className={`${FOCUS_ROOT} animate-enter`}>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink-muted tabular-nums">
          {LEVEL_TEST_SIZE}문제 중 {score}개 정답 · 기준 {PASS_SCORE}개
        </p>
        <h1 className={H1}>{passed ? "레벨업 테스트에 합격했어요" : "이번엔 아쉽게 통과하지 못했어요"}</h1>
        {/* 불합격도 빨강을 쓰지 않는다 */}
        <div
          role="progressbar"
          aria-label="점수"
          aria-valuemin={0}
          aria-valuemax={LEVEL_TEST_SIZE}
          aria-valuenow={score}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-zone"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-400 ${passed ? "bg-accent" : "bg-ink-muted"}`}
            style={{ width: `${(score / LEVEL_TEST_SIZE) * 100}%` }}
          />
        </div>
      </div>

      {passed ? (
        <div className="flex items-start gap-3 rounded-xl bg-gold-wash p-4 text-on-gold ring-1 ring-gold-light ring-inset">
          <Award size={20} aria-hidden="true" className="shrink-0 text-gold" />
          <div className="flex flex-col gap-1">
            <p className="font-bold">새 상황 4개가 열렸어요</p>
            <p className="text-sm">이제 {LEVEL_INFO[result.level].name} 단어와 상황으로 학습해요.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-xl bg-card p-4 shadow-card">
          <Info size={20} aria-hidden="true" className="shrink-0 text-accent" />
          <div className="flex flex-col gap-1">
            <p className="font-bold">{PASS_SCORE - score}개만 더 맞히면 통과예요</p>
            <p className="text-sm text-ink-muted">재응시 제한이 없어요. 새 문제로 다시 볼 수 있어요.</p>
          </div>
        </div>
      )}

      {wrong.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 id={wrongTitleId} className="text-h3 font-semibold tracking-[-0.02em]">
            틀린 문제 {wrong.length}개
          </h2>
          <ul aria-labelledby={wrongTitleId} className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">
            {wrong.map(({ wordId, answer }) => {
              const question = questions.find((q) => q.wordId === wordId);
              if (question === undefined) return null;
              return (
                <li key={wordId} className="flex flex-col gap-1 px-4 py-3.5">
                  <p lang={language}>
                    <Furigana text={question.before} show={furigana} />
                    <strong className="text-brand">
                      <Furigana text={answer} show={furigana} />
                    </strong>
                    <Furigana text={question.after} show={furigana} />
                  </p>
                  <p className="text-sm text-ink-muted">{question.exampleKo}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {passed ? (
          <>
            <button type="button" onClick={() => reloadTo("/chat")} className={`${PRIMARY} sm:flex-1`}>
              새 상황 보기
            </button>
            <button type="button" onClick={() => reloadTo("/home")} className={`${OUTLINE} sm:flex-1`}>
              홈으로
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={retake} className={`${PRIMARY} sm:flex-1`}>
              다시 보기
            </button>
            <Link href="/home" className={`${OUTLINE} sm:flex-1`}>
              홈으로
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
