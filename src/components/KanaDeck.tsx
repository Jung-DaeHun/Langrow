"use client";

import { ChevronLeft, CircleAlert, CircleCheck } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { KANA, KANA_ROWS, type Kana, type KanaScript } from "@/lib/kana";
import { api } from "@/services/apiClient";
import { Flashcard } from "./Flashcard";

// 가나 익히기(spec 3-1). 상수만 쓰고 진행도는 저장하지 않는다. [모르겠어요]를 누른 글자는 회차 끝에 다시 넣는다.
// 회차를 마칠 때마다 kana_studied를 한 번 보낸다. 활동일·연속일은 서버가 갱신하고, 실패는 [다시 시도]로만 다시 보낸다

const SCRIPT_NAMES: Record<KanaScript, string> = { hiragana: "히라가나", katakana: "가타카나" };
const SCRIPTS = Object.keys(SCRIPT_NAMES) as KanaScript[];
const GROUPS = [
  { key: "basic", title: "기본" },
  { key: "voiced", title: "탁음·반탁음" },
] as const;

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const H1 = "text-h1 font-semibold tracking-[-0.02em] text-balance text-brand";
const H2 = "text-h3 font-semibold tracking-[-0.02em]";
const BUTTON = `inline-flex items-center justify-center gap-2 rounded-full font-semibold transition duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`;
const PRIMARY = `${BUTTON} h-11 px-5 bg-accent text-white hover:bg-brand`;
const OUTLINE = `${BUTTON} h-11 px-5 border border-accent bg-transparent text-accent hover:bg-black/5`;
const OUTLINE_SM = `${BUTTON} h-9 px-4 text-sm border border-accent bg-transparent text-accent hover:bg-black/5`;
const PILL = `inline-flex h-9 items-center gap-1.5 self-start rounded-full border border-line-input bg-card px-3 text-sm font-semibold text-ink hover:bg-hover ${FOCUS_RING}`;
const SEGMENT_ITEM = `rounded-full px-4 py-2 text-sm font-semibold ${FOCUS_RING}`;
const TILE = `flex w-full flex-col items-start gap-1 rounded-xl bg-card p-4 text-left shadow-card transition hover:ring-1 hover:ring-line-input ${FOCUS_RING}`;
const FOCUS_ROOT = "flex flex-col gap-6 pb-10";

// first는 행의 첫 글자다. 71자 전체면 null이고 문자 이름으로 부른다
type Deck = { script: KanaScript; first: string | null; chars: readonly Kana[] };
type Phase = "select" | "cards" | "done";
type Sent = { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

// "あ행"의 가나만 lang="ja"로 단다
function deckLabel(deck: Deck): ReactNode {
  if (deck.first === null) return SCRIPT_NAMES[deck.script];
  return (
    <>
      <span lang="ja">{deck.first}</span>행
    </>
  );
}

export function KanaDeck() {
  const id = useId();
  const [script, setScript] = useState<KanaScript>("hiragana");
  const [phase, setPhase] = useState<Phase>("select");
  const [deck, setDeck] = useState<Deck>({ script: "hiragana", first: null, chars: [] });
  const [queue, setQueue] = useState<readonly Kana[]>([]);
  const [known, setKnown] = useState(0);
  // 같은 글자가 다시 나와도 카드를 새로 만들어 앞면부터 보이게 한다
  const [turn, setTurn] = useState(0);
  const [record, setRecord] = useState<Sent>({ kind: "sending" });

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [phase]);

  function begin(next: Deck) {
    setDeck(next);
    setQueue(next.chars);
    setKnown(0);
    setTurn((t) => t + 1);
    setPhase("cards");
  }

  function answer(knew: boolean) {
    const [current, ...rest] = queue;
    const next = knew ? rest : [...rest, current];
    setQueue(next);
    setTurn((t) => t + 1);
    if (knew) setKnown((k) => k + 1);
    if (next.length === 0) {
      setPhase("done");
      void sendRecord();
    }
  }

  async function sendRecord() {
    setRecord({ kind: "sending" });
    const result = await api("POST", "/api/events", { name: "kana_studied" });
    setRecord(result.ok ? { kind: "sent" } : { kind: "error", message: result.message });
  }

  if (phase === "cards") {
    const current = queue[0];
    return (
      <div data-focus-mode className={FOCUS_ROOT}>
        <button type="button" onClick={() => setPhase("select")} className={PILL}>
          <ChevronLeft size={16} aria-hidden="true" />행 선택
        </button>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-semibold">{deckLabel(deck)}</span>
            <span className="text-ink-muted tabular-nums">
              {known} / {deck.chars.length}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="아는 글자"
            aria-valuemin={0}
            aria-valuemax={deck.chars.length}
            aria-valuenow={known}
            className="h-1 overflow-hidden rounded-full bg-zone"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-400"
              style={{ width: `${(known / deck.chars.length) * 100}%` }}
            />
          </div>
        </div>
        <Flashcard
          key={turn}
          front={
            <span lang="ja" className="text-kana font-medium text-house">
              {current.char}
            </span>
          }
          back={
            <>
              <span lang="ja" className="text-[56px] leading-none font-medium text-house">
                {current.char}
              </span>
              <span className="text-[32px] leading-tight font-bold text-brand">
                {current.romaji} · {current.ko}
              </span>
            </>
          }
          onAnswer={answer}
        />
      </div>
    );
  }

  if (phase === "done") {
    const sending = record.kind === "sending";
    return (
      <div data-focus-mode className={`${FOCUS_ROOT} animate-enter`}>
        <h1 className={H1}>
          {deckLabel(deck)} {deck.chars.length}자 완료
        </h1>
        <div className="flex items-start gap-3 rounded-xl bg-mint p-4">
          <CircleCheck size={20} aria-hidden="true" className="shrink-0 text-accent" />
          <div className="flex flex-col gap-1">
            <p className="font-bold">{deck.chars.length}자를 모두 익혔어요</p>
            <p className="text-sm">헷갈리는 글자는 [한 번 더]로 다시 볼 수 있어요.</p>
          </div>
        </div>
        {record.kind === "error" && (
          <div role="alert" className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-danger ring-inset">
            <CircleAlert size={20} aria-hidden="true" className="shrink-0 text-danger" />
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm">{record.message}</p>
              <button type="button" onClick={() => void sendRecord()} className={OUTLINE_SM}>
                다시 시도
              </button>
            </div>
          </div>
        )}
        <ul aria-label="익힌 글자" className="grid grid-cols-5 gap-2">
          {deck.chars.map((k) => (
            <li key={k.char} className="flex flex-col items-center rounded-xl bg-card py-3 shadow-card">
              <span lang="ja" className="text-2xl font-medium text-house">
                {k.char}
              </span>
              <span className="text-micro text-ink-muted">{k.romaji}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={() => begin(deck)} disabled={sending} className={`${PRIMARY} sm:flex-1`}>
            한 번 더
          </button>
          <button type="button" onClick={() => setPhase("select")} disabled={sending} className={`${OUTLINE} sm:flex-1`}>
            다른 행
          </button>
        </div>
      </div>
    );
  }

  const all = KANA[script];
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="문자" className="inline-flex gap-0.5 rounded-full bg-zone p-1">
          {SCRIPTS.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={s === script}
              onClick={() => setScript(s)}
              className={`${SEGMENT_ITEM} ${s === script ? "bg-card text-brand shadow-card" : "text-ink-muted"}`}
            >
              {SCRIPT_NAMES[s]}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => begin({ script, first: null, chars: all })} className={OUTLINE_SM}>
          {all.length}자 전체
        </button>
      </div>

      {GROUPS.map((group) => {
        const rows = KANA_ROWS.filter((row) => row.group === group.key).map((row) =>
          all.filter((k) => k.row === row.key),
        );
        const titleId = `${id}-${group.key}`;
        return (
          <section key={group.key} aria-labelledby={titleId} className="flex flex-col gap-4">
            <h2 id={titleId} className={H2}>
              {group.title} {rows.flat().length}자
            </h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {rows.map((chars) => {
                const deckOfRow: Deck = { script, first: chars[0].char, chars };
                return (
                  <li key={chars[0].row}>
                    <button type="button" onClick={() => begin(deckOfRow)} className={TILE}>
                      <span lang="ja" className="text-[22px] font-medium text-house">
                        {chars.map((k) => k.char).join(" ")}
                      </span>
                      <span className="text-sm text-ink-muted">
                        {deckLabel(deckOfRow)} · {chars.length}자
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
