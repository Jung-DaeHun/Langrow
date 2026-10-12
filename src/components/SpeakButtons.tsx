"use client";

import { CircleAlert, Snail, Volume2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SLOW_RATE, pickVoice } from "@/lib/audio";
import { stripFurigana } from "@/lib/furigana";
import type { Language } from "@/lib/levels";

// [듣기]·[천천히 듣기](spec/audio.md "재생 규칙", ui.md "음성 재생"). 누를 때만 재생하고 페이지에서 소리는 하나만 낸다.
// 파일(단어·예문·가나)은 Audio로, 대화 문장은 브라우저 음성으로 읽는다. 학습 언어 음성이 없으면 대화 버튼을 그리지 않는다

export type SpeakSource = { kind: "file"; src: string } | { kind: "speech"; text: string; language: Language };
type Variant = "pill" | "compact";
type Align = "start" | "center";
type Props = { source: SpeakSource; variant?: Variant; align?: Align };
// 재생을 시작하고 멈추는 함수를 돌려준다. 실패는 onError로 알린다
type Play = (rate: number, onError: () => void) => () => void;

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const PILL = `inline-flex h-9 items-center gap-1.5 rounded-full border border-line-input bg-card px-3 text-sm font-semibold text-ink hover:bg-hover ${FOCUS_RING}`;
const COMPACT = `inline-flex h-9 items-center gap-1 px-1 text-xs font-semibold text-accent ${FOCUS_RING}`;
const FAILED = "소리를 재생하지 못했어요. 다시 눌러 보세요.";

// 지금 나는 소리를 멈추는 함수. 다른 버튼을 누르면 먼저 부른다
let stopCurrent: (() => void) | null = null;

export function SpeakButtons({ source, variant = "pill", align = "start" }: Props) {
  if (source.kind === "speech") {
    return <SpeechButtons text={source.text} language={source.language} variant={variant} align={align} />;
  }
  const { src } = source;
  return <Buttons play={(rate, onError) => playFile(src, rate, onError)} variant={variant} align={align} />;
}

function playFile(src: string, rate: number, onError: () => void): () => void {
  let stopped = false;
  const audio = new Audio(src);
  audio.playbackRate = rate;
  // 우리가 멈춰서 거부된 play()(AbortError)는 오류가 아니다
  const fail = () => {
    if (!stopped) onError();
  };
  audio.addEventListener("error", fail);
  audio.play().catch(fail);
  return () => {
    stopped = true;
    audio.pause();
  };
}

function subscribeVoices(onChange: () => void): () => void {
  if (!("speechSynthesis" in window)) return () => {};
  const synth = window.speechSynthesis;
  synth.addEventListener("voiceschanged", onChange);
  return () => synth.removeEventListener("voiceschanged", onChange);
}

function SpeechButtons({ text, language, variant, align }: { text: string; language: Language; variant: Variant; align: Align }) {
  // 음성 목록은 늦게 올 수 있다(voiceschanged). 서버 렌더링 때는 그리지 않는다
  const voiceURI = useSyncExternalStore(
    subscribeVoices,
    () => ("speechSynthesis" in window ? (pickVoice(window.speechSynthesis.getVoices(), language)?.voiceURI ?? null) : null),
    () => null,
  );
  if (voiceURI === null) return null;

  const play: Play = (rate, onError) => {
    const synth = window.speechSynthesis;
    const voice = synth.getVoices().find((v) => v.voiceURI === voiceURI);
    if (voice === undefined) {
      onError();
      return () => {};
    }
    const utterance = new SpeechSynthesisUtterance(stripFurigana(text));
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = rate;
    // 우리가 멈춰서 생긴 중단은 오류가 아니다
    utterance.onerror = (event) => {
      if (event.error !== "interrupted" && event.error !== "canceled") onError();
    };
    synth.cancel();
    synth.speak(utterance);
    return () => synth.cancel();
  };
  return <Buttons play={play} variant={variant} align={align} />;
}

function Buttons({ play, variant, align }: { play: Play; variant: Variant; align: Align }) {
  const [failed, setFailed] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  // 버튼이 사라지면(카드를 뒤집거나 넘김, 화면 이동) 이 버튼의 소리를 멈춘다
  useEffect(
    () => () => {
      const stop = stopRef.current;
      if (stop !== null && stopCurrent === stop) {
        stop();
        stopCurrent = null;
      }
    },
    [],
  );

  function start(rate: number) {
    stopCurrent?.();
    setFailed(false);
    const stop = play(rate, () => setFailed(true));
    stopRef.current = stop;
    stopCurrent = stop;
  }

  const compact = variant === "compact";
  const button = compact ? COMPACT : PILL;
  const iconSize = compact ? 14 : 16;
  return (
    <div className={`flex flex-col gap-1 ${align === "center" ? "items-center" : "items-start"}`}>
      <div className={`flex ${compact ? "gap-3" : "gap-2"}`}>
        <button type="button" onClick={() => start(1)} className={button}>
          <Volume2 size={iconSize} aria-hidden="true" className="text-accent" />
          듣기
        </button>
        <button type="button" onClick={() => start(SLOW_RATE)} className={button}>
          <Snail size={iconSize} aria-hidden="true" className="text-accent" />
          천천히 듣기
        </button>
      </div>
      {failed && (
        <p role="alert" className="flex items-center gap-1 text-sm text-danger">
          <CircleAlert size={16} aria-hidden="true" className="shrink-0" />
          {FAILED}
        </p>
      )}
    </div>
  );
}
