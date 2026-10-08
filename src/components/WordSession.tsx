"use client";

import { ChevronLeft, CircleAlert, CircleCheck, RotateCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { isCorrectChoice, parseBlank, toBlankQuestion, type BlankParts, type BlankQuestion } from "@/lib/blank";
import { LANGUAGE_NAMES, LEVEL_INFO, showsFurigana, type Language, type Level } from "@/lib/levels";
import type { TrialState } from "@/lib/plan";
import { DAILY_WORD_GOAL } from "@/lib/today";
import { wordStatus } from "@/lib/wordBatch";
import type { Word } from "@/server/db/reads";
import { api } from "@/services/apiClient";
import type { WordBatchResponse, WordReviewResponse } from "@/types/api";
import { BlankQuiz } from "./BlankQuiz";
import { Flashcard } from "./Flashcard";
import { Furigana } from "./Furigana";
import { LimitNotice } from "./LimitNotice";
import { WordExplanation, type ExplanationBlock } from "./WordExplanation";

// 단어 회차: 오늘의 학습(플래시카드 → 빈칸) / 오답 복습(플래시카드만). 시작 카드 밖은 집중 모드다.
// 답은 useState에만 두고 회차 끝에 한 번 저장한다. 중간에 나가면 버린다(spec/words.md "오늘의 학습"). 실패는 자동으로 다시 보내지 않는다.
// 회차 크기·한도는 서버가 정한다. 페이지가 넘긴 단어를 그대로 쓰고, body에 날짜·플랜·사용량을 넣지 않는다

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const H1 = "text-h1 font-semibold tracking-[-0.02em] text-balance text-brand";
const BUTTON = `inline-flex items-center justify-center gap-2 rounded-full font-semibold transition duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`;
const PRIMARY = `${BUTTON} h-11 px-5 bg-accent text-white hover:bg-brand`;
const OUTLINE = `${BUTTON} h-11 px-5 border border-accent bg-transparent text-accent hover:bg-black/5`;
const OUTLINE_SM = `${BUTTON} h-9 px-4 text-sm border border-accent bg-transparent text-accent hover:bg-black/5`;
const PILL = `inline-flex h-9 items-center gap-1.5 rounded-full border border-line-input bg-card px-3 text-sm font-semibold text-ink hover:bg-hover ${FOCUS_RING}`;
const GRAY_TAG = "inline-flex items-center rounded-full bg-zone px-2.5 py-0.5 text-xs font-bold text-ink-muted";
const FOCUS_ROOT = "flex flex-col gap-6 pb-10";

type Props = {
  mode: "learn" | "review";
  language: Language;
  level: Level;
  words: Word[];
  todayCount?: number;
  remainingToday?: number; // 오늘 남은 새 단어 한도. 목표를 넘겨 더 할 수 있는 Pro에게 알린다
  trial: TrialState;
};
type Phase = "start" | "cards" | "quiz" | "result";
type SaveBody = { language: Language; items: { word_id: string; knew: boolean; correct?: boolean }[] };
type Save =
  | { kind: "saving" }
  | { kind: "saved"; insertedCount: number }
  | { kind: "limit" }
  | { kind: "error"; message: string };

// seed 검증(예문마다 {{ }} 정확히 1개)을 통과한 단어라 빈칸을 못 찾으면 데이터 버그다
function blankOf(word: Word): BlankParts {
  const blank = parseBlank(word.example);
  if (blank === null) throw new Error(`예문에 빈칸이 없습니다 (${word.id})`);
  return blank;
}

export function WordSession({ mode, language, level, words, todayCount = 0, remainingToday = 0, trial }: Props) {
  const router = useRouter();
  const startTitleId = useId();
  const reviewTitleId = useId();
  const [phase, setPhase] = useState<Phase>("start");
  // 회차의 언어와 단어는 시작할 때 고정한다. 진행 중에 페이지를 새로 읽어 props가 바뀌어도 회차는 그대로다
  const [runLanguage, setRunLanguage] = useState(language);
  const [runWords, setRunWords] = useState(words);
  const [index, setIndex] = useState(0);
  const [knew, setKnew] = useState<boolean[]>([]);
  const [questions, setQuestions] = useState<BlankQuestion[]>([]);
  const [correct, setCorrect] = useState<boolean[]>([]);
  const [body, setBody] = useState<SaveBody | null>(null);
  const [save, setSave] = useState<Save>({ kind: "saving" });
  const [trialStarted, setTrialStarted] = useState(false);
  // AI 설명의 429 안내는 회차 전체에 건다. 새 회차를 시작하거나 체험을 시작하면 푼다
  const [explainBlock, setExplainBlock] = useState<ExplanationBlock | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [phase]);

  const furigana = runLanguage === "ja" && showsFurigana(level);

  function start() {
    setRunLanguage(language);
    setRunWords(words);
    setIndex(0);
    setKnew([]);
    setCorrect([]);
    setBody(null);
    setTrialStarted(false);
    setExplainBlock(null);
    setPhase("cards");
  }

  function answerCard(k: boolean) {
    const nextKnew = [...knew, k];
    setKnew(nextKnew);
    if (index + 1 < runWords.length) {
      setIndex(index + 1);
    } else if (mode === "review") {
      finish(nextKnew, []);
    } else {
      // 보기는 퀴즈에 들어갈 때 한 번 섞어 고정한다. 예문은 플래시카드 뒷면에서 blankOf가 이미 확인했다
      setQuestions(runWords.map((w) => toBlankQuestion(w) as BlankQuestion));
      setIndex(0);
      setPhase("quiz");
    }
  }

  function answerQuiz(choice: string) {
    const nextCorrect = [...correct, isCorrectChoice(choice, blankOf(runWords[index]).answer)];
    setCorrect(nextCorrect);
    if (index + 1 < runWords.length) setIndex(index + 1);
    else finish(knew, nextCorrect);
  }

  function finish(knewAll: boolean[], correctAll: boolean[]) {
    const items = runWords.map((w, i) =>
      mode === "learn" ? { word_id: w.id, knew: knewAll[i], correct: correctAll[i] } : { word_id: w.id, knew: knewAll[i] },
    );
    const next = { language: runLanguage, items };
    setBody(next);
    setPhase("result");
    void submit(next);
  }

  // 다시 시도도 같은 body를 보낸다. 중복 저장은 서버가 200·insertedCount 0으로 처리한다
  async function submit(next: SaveBody) {
    setSave({ kind: "saving" });
    const path = mode === "learn" ? "/api/words/batch" : "/api/words/review";
    const result = await api<WordBatchResponse | WordReviewResponse>("POST", path, next);
    if (result.ok) {
      setSave({ kind: "saved", insertedCount: "insertedCount" in result.data ? result.data.insertedCount : 0 });
    } else if (result.code === "LIMIT_REACHED") {
      setSave({ kind: "limit" });
    } else {
      setSave({ kind: "error", message: result.message });
    }
  }

  function backToStart() {
    router.refresh();
    setPhase("start");
  }

  // 문제·카드마다 새로 만들어진다(BlankQuiz·Flashcard의 key). 429 안내는 explainBlock이라 다음 문제에도 이어진다
  function explanationFor(w: Word, label: string, choice?: string) {
    return (
      <WordExplanation
        wordId={w.id}
        choice={choice}
        label={label}
        showFurigana={furigana}
        trial={trial}
        block={explainBlock}
        onBlock={setExplainBlock}
        onTrialStarted={() => setExplainBlock(null)}
      />
    );
  }

  if (phase === "start") {
    if (mode === "review") {
      return (
        <section className="flex flex-col gap-4 rounded-xl bg-card p-6 shadow-card">
          <ul aria-label="복습할 단어" className="flex flex-wrap gap-2">
            {words.map((w) => (
              <li key={w.id} lang={language} className={GRAY_TAG}>
                {w.word}
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-muted">복습은 하루 사용량에 포함되지 않아요.</p>
          <button type="button" onClick={start} className={`${PRIMARY} w-full`}>
            복습 시작
          </button>
        </section>
      );
    }
    return (
      <section aria-labelledby={startTitleId} className="flex flex-col gap-4 rounded-xl bg-card p-6 shadow-card">
        <div className="flex items-center justify-between gap-3">
          <p className="text-micro font-bold text-ink-muted">
            {LANGUAGE_NAMES[language]} · {LEVEL_INFO[level].name}
          </p>
          <p className="text-micro text-ink-muted tabular-nums">
            {todayCount >= DAILY_WORD_GOAL && remainingToday > 0
              ? `오늘 목표 완료 · ${remainingToday}개 더 할 수 있어요`
              : `오늘 ${Math.min(todayCount, DAILY_WORD_GOAL)} / ${DAILY_WORD_GOAL}`}
          </p>
        </div>
        <h2 id={startTitleId} className="text-[28px] leading-tight font-bold tracking-[-0.02em]">
          새 단어 {words.length}개
        </h2>
        <p className="text-sm text-ink-muted">끝까지 풀면 한 번에 저장돼요. 중간에 나가면 저장되지 않아요.</p>
        <button type="button" onClick={start} className={`${PRIMARY} w-full`}>
          시작하기
        </button>
      </section>
    );
  }

  const quitButton = (
    <button type="button" onClick={() => setPhase("start")} className={`self-start ${PILL}`}>
      <ChevronLeft size={16} aria-hidden="true" />
      그만하기
    </button>
  );

  if (phase === "cards") {
    const w = runWords[index];
    const ruby = furigana && w.reading !== null && w.reading !== w.word;
    const blank = blankOf(w);
    return (
      <div data-focus-mode className={FOCUS_ROOT}>
        {quitButton}
        <Progress label={mode === "learn" ? "플래시카드" : "오답 복습"} index={index} total={runWords.length} />
        <Flashcard
          key={w.id}
          front={
            <>
              <span lang={runLanguage} className="text-word font-bold text-brand">
                {ruby ? <Furigana text={`[${w.word}|${w.reading}]`} show /> : w.word}
              </span>
              <span className="inline-flex items-center gap-1 text-micro text-ink-muted">
                <RotateCw size={13} aria-hidden="true" />
                탭해서 뜻 보기
              </span>
            </>
          }
          back={
            <>
              <span className="text-[28px] leading-tight font-bold">{w.meaningKo}</span>
              <span lang={runLanguage}>
                <Furigana text={blank.before + blank.answer + blank.after} show={furigana} />
              </span>
              <span className="text-sm text-ink-muted">{w.exampleKo}</span>
            </>
          }
          revealed={mode === "review" ? explanationFor(w, "예문 설명") : undefined}
          onAnswer={answerCard}
        />
      </div>
    );
  }

  if (phase === "quiz") {
    const w = runWords[index];
    return (
      <div data-focus-mode className={FOCUS_ROOT}>
        {quitButton}
        <BlankQuiz
          key={w.id}
          question={questions[index]}
          language={runLanguage}
          showFurigana={furigana}
          stepLabel="빈칸 채우기"
          index={index}
          total={runWords.length}
          mode="learn"
          answer={blankOf(w).answer}
          meaningKo={w.meaningKo}
          isLast={index === runWords.length - 1}
          onNext={answerQuiz}
          explanation={(choice) => explanationFor(w, "AI 해설", choice)}
        />
      </div>
    );
  }

  const score = (mode === "learn" ? correct : knew).filter(Boolean).length;
  const reviewWords = mode === "learn" ? runWords.filter((_, i) => wordStatus(knew[i], correct[i]) === "review") : [];
  const saving = save.kind === "saving";
  const retry = () => {
    if (body !== null) void submit(body);
  };

  return (
    <div data-focus-mode className={`${FOCUS_ROOT} animate-enter`}>
      <h1 className={H1}>
        {runWords.length}개 중 {score}개 {mode === "learn" ? "맞혔어요" : "알았어요"}
      </h1>

      {save.kind === "saved" && (
        <div className="flex items-start gap-3 rounded-xl bg-mint p-4">
          <CircleCheck size={20} aria-hidden="true" className="shrink-0 text-accent" />
          <p className="font-bold">
            {mode === "review"
              ? "복습 결과를 저장했어요"
              : save.insertedCount > 0
                ? `새 단어 ${save.insertedCount}개를 저장했어요`
                : "이미 저장한 단어예요. 사용량은 늘지 않았어요"}
          </p>
        </div>
      )}
      {save.kind === "limit" && (
        <div className="flex flex-col items-start gap-3">
          {!trialStarted && <LimitNotice feature="words" trial={trial} onTrialStarted={() => setTrialStarted(true)} />}
          <button type="button" onClick={retry} className={OUTLINE_SM}>
            다시 시도
          </button>
        </div>
      )}
      {save.kind === "error" && (
        <div role="alert" className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-danger ring-inset">
          <CircleAlert size={20} aria-hidden="true" className="shrink-0 text-danger" />
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm">{save.message}</p>
            <button type="button" onClick={retry} className={OUTLINE_SM}>
              다시 시도
            </button>
          </div>
        </div>
      )}

      {reviewWords.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 id={reviewTitleId} className="text-h3 font-semibold tracking-[-0.02em]">
            다시 볼 단어 {reviewWords.length}개
          </h2>
          <ul aria-labelledby={reviewTitleId} className="divide-y divide-line overflow-hidden rounded-xl bg-card shadow-card">
            {reviewWords.map((w) => (
              <li key={w.id} className="flex flex-col px-4 py-3.5">
                <span lang={runLanguage} className="font-bold">
                  {w.word}
                </span>
                <span className="text-sm text-ink-muted">{w.meaningKo}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {saving ? (
          <button type="button" disabled className={`${PRIMARY} sm:flex-1`}>
            저장 중…
          </button>
        ) : (
          <Link href="/home" className={`${PRIMARY} sm:flex-1`}>
            홈으로
          </Link>
        )}
        <button type="button" onClick={backToStart} disabled={saving} className={`${OUTLINE} sm:flex-1`}>
          단어 화면으로
        </button>
      </div>
    </div>
  );
}

// 회차 진행(ui.md "진행 표시"): 단계 이름 + i / n + h-1 바. index는 0부터다
function Progress({ label, index, total }: { label: string; index: number; total: number }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold">{label}</span>
        <span className="text-ink-muted tabular-nums">
          {index + 1} / {total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
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
  );
}
