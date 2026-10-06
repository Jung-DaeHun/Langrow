"use client";

import { Check, ChevronLeft, ChevronRight, CircleAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LANGUAGE_NAMES, LANGUAGES, LEVEL_INFO, LEVELS, showsKana, type Language, type Level } from "@/lib/levels";
import type { OnboardingStart } from "@/lib/onboarding";
import { api } from "@/services/apiClient";

// 동의 → 언어 → 레벨. 시작 단계는 페이지가 onboardingStart로 정한다. 날짜·userId는 서버가 정하므로 보내지 않는다

type Step = "consent" | "language" | "level";
const STEP_NO: Record<Step, number> = { consent: 1, language: 2, level: 3 };
const STEP_COUNT = 3;

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const H1 = "text-h1 font-semibold tracking-[-0.02em] text-balance text-brand";
const PILL = `inline-flex h-9 items-center gap-1.5 rounded-full border border-line-input bg-card px-3 text-sm font-semibold text-ink hover:bg-hover ${FOCUS_RING}`;
const PRIMARY = `inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-accent px-5 font-semibold text-white transition duration-200 hover:bg-brand active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`;
const TILE = `flex w-full items-center gap-3.5 rounded-xl p-4 text-left shadow-card transition disabled:cursor-not-allowed ${FOCUS_RING}`;
const TILE_IDLE = "bg-card hover:ring-1 hover:ring-line-input";
const TILE_SELECTED = "bg-ok-wash ring-2 ring-accent";
const NUMBER = "grid size-9 shrink-0 place-items-center rounded-full font-bold";
const TAG = "inline-flex items-center gap-1 rounded-full bg-mint px-2.5 py-0.5 text-xs font-bold text-brand";
const LINK = `font-semibold text-accent underline underline-offset-2 ${FOCUS_RING}`;

type Props = { start: Exclude<OnboardingStart, { kind: "home" }> };

export function OnboardingFlow({ start }: Props) {
  const router = useRouter();
  const mode = start.kind === "level" ? start.mode : "first";
  const [step, setStep] = useState<Step>(start.kind);
  const [language, setLanguage] = useState<Language | null>(start.kind === "language" ? null : (start.language ?? null));
  const [agreed, setAgreed] = useState(false);
  const [level, setLevel] = useState<Level | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function go(next: Step) {
    setError(null);
    setStep(next);
    window.scrollTo(0, 0);
  }

  async function agree() {
    setBusy(true);
    setError(null);
    const result = await api("POST", "/api/me/consent");
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    go(language === null ? "language" : "level");
  }

  function chooseLanguage(target: Language) {
    if (target !== language) setLevel(null);
    setLanguage(target);
    go("level");
  }

  async function startLearning(target: Language, chosen: Level) {
    setBusy(true);
    setError(null);
    const result = await api("POST", "/api/levels", { language: target, level: chosen });
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }
    // 이동하는 동안 다시 누르지 못하게 비활성화를 유지한다
    router.replace("/home");
  }

  const showProgress = mode === "first";
  const stepNo = STEP_NO[step];

  let back;
  if (step === "level" && mode === "add") {
    back = (
      <Link href="/home" className={PILL}>
        <X size={16} aria-hidden="true" />
        취소
      </Link>
    );
  } else if (step === "level") {
    back = (
      <button type="button" onClick={() => go("language")} className={PILL}>
        <ChevronLeft size={16} aria-hidden="true" />
        이전
      </button>
    );
  } else {
    back = <p className="text-h3 font-extrabold tracking-[-0.03em] text-brand">Langrow</p>;
  }

  const errorNotice = error !== null && (
    <div role="alert" className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-danger ring-inset">
      <CircleAlert size={20} aria-hidden="true" className="shrink-0 text-danger" />
      <p className="text-sm">{error}</p>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-form flex-col gap-8 px-4 pt-4 pb-10">
      <div className="flex flex-col gap-3">
        <div className="flex h-9 items-center justify-between gap-3">
          {back}
          {showProgress && (
            <span className="text-sm text-ink-muted tabular-nums">
              {stepNo} / {STEP_COUNT}
            </span>
          )}
        </div>
        {showProgress && (
          <div
            role="progressbar"
            aria-label="온보딩 진행"
            aria-valuemin={0}
            aria-valuemax={STEP_COUNT}
            aria-valuenow={stepNo}
            className="h-1.5 overflow-hidden rounded-full bg-zone"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-400"
              style={{ width: `${(stepNo / STEP_COUNT) * 100}%` }}
            />
          </div>
        )}
      </div>

      {step === "consent" && (
        <div key="consent" className="flex flex-col gap-6 animate-enter">
          <div className="flex flex-col gap-2">
            <h1 className={H1}>시작하기 전에 동의해 주세요</h1>
            <p className="text-sm text-ink-muted">
              대화 내용은 응답을 만들기 위해 Anthropic(미국)으로 전송돼요. 자세한 내용은 개인정보처리방침의 국외 이전
              항목에서 볼 수 있어요.
            </p>
          </div>
          <div className="rounded-xl bg-card p-5 shadow-card">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-sm border-2 border-ink-muted transition peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
              >
                <Check
                  size={16}
                  strokeWidth={3}
                  className={`text-white transition-transform duration-300 ease-spring ${agreed ? "scale-100" : "scale-0"}`}
                />
              </span>
              <span>
                [필수] 만 14세 이상이며,{" "}
                <Link href="/terms" target="_blank" className={LINK}>
                  이용약관
                </Link>
                과{" "}
                <Link href="/privacy" target="_blank" className={LINK}>
                  개인정보처리방침
                </Link>
                (국외 이전 포함)에 동의합니다
              </span>
            </label>
          </div>
          {errorNotice}
          <button type="button" onClick={agree} disabled={!agreed || busy} className={PRIMARY}>
            동의하고 계속
          </button>
        </div>
      )}

      {step === "language" && (
        <div key="language" className="flex flex-col gap-6 animate-enter">
          <h1 id="onboarding-language" className={H1}>
            어떤 언어를 배울까요?
          </h1>
          <div role="radiogroup" aria-labelledby="onboarding-language" className="flex flex-col gap-3">
            {LANGUAGES.map((lang) => {
              const selected = lang === language;
              return (
                <button
                  key={lang}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => chooseLanguage(lang)}
                  className={`${TILE} ${selected ? TILE_SELECTED : TILE_IDLE}`}
                >
                  <span aria-hidden="true" className={`${NUMBER} ${selected ? "bg-accent text-white" : "bg-zone"}`}>
                    {lang.toUpperCase()}
                  </span>
                  <span className="flex-1 font-bold">{LANGUAGE_NAMES[lang]}</span>
                  <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-ink-muted" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === "level" && language !== null && (
        <div key="level" className="flex flex-col gap-6 animate-enter">
          <h1 id="onboarding-level" className={H1}>
            {LANGUAGE_NAMES[language]} 레벨을 골라 주세요
          </h1>
          <div role="radiogroup" aria-labelledby="onboarding-level" className="flex flex-col gap-3">
            {LEVELS.map((lv) => {
              const selected = lv === level;
              return (
                <button
                  key={lv}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={busy}
                  onClick={() => setLevel(lv)}
                  className={`${TILE} ${selected ? TILE_SELECTED : TILE_IDLE}`}
                >
                  <span aria-hidden="true" className={`${NUMBER} ${selected ? "bg-accent text-white" : "bg-zone"}`}>
                    {lv}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{LEVEL_INFO[lv].name}</span>
                      {showsKana(language, lv) && <span className={TAG}>가나 익히기 포함</span>}
                    </span>
                    <span className="text-sm text-ink-muted">{LEVEL_INFO[lv].description}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-sm text-ink-muted">이후 올리기는 레벨업 테스트로, 내리기는 상단 언어 메뉴에서 할 수 있어요.</p>
          {errorNotice}
          <button
            type="button"
            onClick={level === null ? undefined : () => startLearning(language, level)}
            disabled={level === null || busy}
            className={PRIMARY}
          >
            학습 시작
          </button>
        </div>
      )}
    </div>
  );
}
