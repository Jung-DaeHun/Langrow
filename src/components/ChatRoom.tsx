"use client";

import { ArrowUp, ChevronLeft, CircleAlert, Info, Languages } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  LANGUAGE_NAMES,
  allowsKoreanInput,
  opensTranslationByDefault,
  showsFurigana,
  type Language,
  type Level,
} from "@/lib/levels";
import type { TrialState } from "@/lib/plan";
import type { ScenarioLine } from "@/lib/scenarios";
import { CHAT_INPUT_MAX, countChars, hasHangul, isValidChatInput } from "@/lib/text";
import type { EndResult } from "@/server/db/chat";
import type { ChatRoomData, ChatTurnView } from "@/server/db/reads";
import { api } from "@/services/apiClient";
import type { ChatEndResponse, ChatMessageResponse } from "@/types/api";
import { ChatFeedback } from "./ChatFeedback";
import { Furigana } from "./Furigana";
import { LimitNotice } from "./LimitNotice";
import { WaitingDots } from "./WaitingDots";

// 대화방(집중 모드). 상태 전이·한도·토큰은 서버가 지키고, 화면은 응답 코드별 동작(spec 6-10)만 따른다.
// 표시된 남은 사용량으로 막지 않고 서버의 429 뒤에만 막는다. 실패한 전송·종료는 자동으로 다시 보내지 않는다.
// 세션의 언어·레벨은 현재 학습 언어가 아니라 세션에 저장된 값이다

const SESSION_MAX_TURNS = 20;
const COUNTER_FROM = 250;
// 다른 곳에서 보낸 턴이 처리 중일 때 다시 읽는 간격. 기한(최대 90초)까지만 기다린다
const PENDING_REFRESH_MS = 3000;

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const PILL = `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line-input bg-card px-3 text-sm font-semibold text-ink hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`;
const OUTLINE_SM = `inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-full border border-accent bg-transparent px-4 text-sm font-semibold text-accent transition duration-200 hover:bg-black/5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`;
const AI_BUBBLE = "rounded-bubble rounded-bl-md bg-card px-3.5 py-3 shadow-card";
const MY_BUBBLE = "max-w-[84%] self-end whitespace-pre-wrap wrap-break-word rounded-bubble rounded-br-md px-3.5 py-3";
const ERROR_NOTICE = "flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-danger ring-inset";

type Props = { room: ChatRoomData; scenario: { title: string; opening: ScenarioLine }; trial: TrialState };
type Block = { kind: "limit" } | { kind: "failure-limit"; message: string };

export function ChatRoom({ room, scenario, trial }: Props) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  // message가 null이면 이유는 입력창 자리의 안내가 보여 준다(429)
  const [failed, setFailed] = useState<{ text: string; message: string | null } | null>(null);
  const [block, setBlock] = useState<Block | null>(null);
  const [full, setFull] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const [end, setEnd] = useState<{ result: EndResult | null } | null>(null);
  // 이 화면에서 확정된 턴. router.refresh()로 room.turns가 새로 오면 그쪽에 이미 있는 턴은 room.turns를 쓴다
  const [added, setAdded] = useState<ChatTurnView[]>([]);
  // 기한이 지나 더 기다리지 않는 room.pendingTurn. 다시 읽으면 새 객체가 오지만 그때는 서버가 이미 null을 준다
  const [expiredPending, setExpiredPending] = useState<ChatRoomData["pendingTurn"]>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const lastTurnNo = room.turns.at(-1)?.turnNo ?? 0;
  const addedTurns = added.filter((t) => t.turnNo > lastTurnNo);
  const turns = [...room.turns, ...addedTurns];
  const showFeedback = room.status !== "active" || end !== null;
  // 다른 탭이나 이전 방문에서 보낸 턴이 처리 중이면 완료를 기다린다(spec 1장 "대화 도중 이탈했다가 돌아옴")
  const otherPending = room.pendingTurn !== expiredPending ? room.pendingTurn : null;
  const shownPending = pending ?? otherPending?.userText ?? null;

  useEffect(() => {
    const waiting = room.pendingTurn;
    if (waiting === null || showFeedback) return;
    const refreshTimer = setTimeout(() => router.refresh(), PENDING_REFRESH_MS);
    const expireTimer = setTimeout(() => setExpiredPending(waiting), waiting.msLeft);
    return () => {
      clearTimeout(refreshTimer);
      clearTimeout(expireTimer);
    };
  }, [room.pendingTurn, showFeedback, router]);

  // 대화는 새 메시지가 보이게 맨 아래로, 피드백으로 바뀌면 화면 전환이라 맨 위로 올린다
  useEffect(() => {
    window.scrollTo(0, showFeedback ? 0 : document.documentElement.scrollHeight);
  }, [showFeedback, turns.length, shownPending, failed]);

  useEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  if (showFeedback) {
    return (
      <ChatFeedback
        sessionId={room.id}
        scenarioTitle={scenario.title}
        language={room.language}
        level={room.level}
        turns={turns}
        doneTurnsToday={room.doneTurnsToday + addedTurns.length}
        result={end?.result ?? room.result}
      />
    );
  }

  const inputLocked = full || block?.kind === "failure-limit";
  const canSend = isValidChatInput(input) && shownPending === null && block === null && !full && !ending;
  const chars = countChars(input);

  async function send(text: string) {
    setFailed(null);
    setPending(text);
    const result = await api<ChatMessageResponse>("POST", `/api/chat/sessions/${room.id}/messages`, { text });
    setPending(null);
    if (result.ok) {
      const { turnNo, turnsLeft, reply } = result.data;
      setAdded((prev) => [
        ...prev,
        { turnNo, userText: text, reply: reply.reply, replyKo: reply.reply_ko, correction: reply.correction },
      ]);
      if (turnsLeft === 0) {
        setFull(true);
        void endSession();
      }
      return;
    }
    switch (result.code) {
      case "SESSION_FULL":
        setFull(true);
        void endSession();
        return;
      case "NOT_FOUND":
        router.push("/home");
        return;
      case "LIMIT_REACHED":
        setFailed({ text, message: null });
        setBlock({ kind: "limit" });
        return;
      case "AI_FAILURE_LIMIT":
        setFailed({ text, message: null });
        setBlock({ kind: "failure-limit", message: result.message });
        return;
      case "CONFLICT":
        // 다른 탭의 턴이나 종료를 반영한다. 보낸 문장은 실패 말풍선으로 남기고 다시 보내지 않는다
        router.refresh();
        break;
    }
    setFailed({ text, message: result.message });
  }

  function submit() {
    if (!canSend) return;
    const text = input.trim();
    setInput("");
    void send(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // 조합 중 Enter는 한글·일본어 조합을 끝내는 키다. Safari는 조합을 끝낸 Enter를 isComposing false + keyCode 229로 보낸다
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submit();
  }

  async function endSession() {
    setEnding(true);
    setEndError(null);
    const result = await api<ChatEndResponse>("POST", `/api/chat/sessions/${room.id}/end`);
    setEnding(false);
    if (!result.ok && result.code === "NOT_FOUND") {
      router.push("/home");
      return;
    }
    if (!result.ok) {
      setEndError(result.message);
      return;
    }
    // 202면 ChatFeedback이 다시 확인한다
    setEnd({ result: result.data.status === "ended" ? result.data : null });
  }

  const furigana = room.language === "ja" && showsFurigana(room.level);
  const busy = shownPending !== null || ending;

  return (
    <div data-focus-mode className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 bg-page">
        <div className="grid h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
          <Link href="/chat" className={PILL}>
            <ChevronLeft size={16} aria-hidden="true" />
            상황 목록
          </Link>
          <div className="flex min-w-0 flex-col items-center text-center">
            <p className="w-full truncate font-bold">{scenario.title}</p>
            <p className="text-micro text-ink-muted tabular-nums">
              {turns.length} / {SESSION_MAX_TURNS}턴
            </p>
          </div>
          <button type="button" onClick={() => void endSession()} disabled={busy} className={OUTLINE_SM}>
            대화 끝내기
          </button>
        </div>
        {endError !== null && (
          <div role="alert" className={`mb-2 ${ERROR_NOTICE}`}>
            <CircleAlert size={20} aria-hidden="true" className="shrink-0 text-danger" />
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm">{endError}</p>
              <button type="button" onClick={() => void endSession()} disabled={busy} className={OUTLINE_SM}>
                다시 시도
              </button>
            </div>
          </div>
        )}
      </header>

      <div aria-live="polite" className="flex flex-1 flex-col gap-3 py-4">
        <AiBubble line={{ text: scenario.opening.text, ko: scenario.opening.ko }} language={room.language} level={room.level} />
        {turns.map((t) => (
          <Fragment key={t.turnNo}>
            <p lang={room.language} className={`${MY_BUBBLE} bg-house text-white`}>
              {t.userText}
            </p>
            {t.correction !== null && (
              <div className="flex max-w-[84%] flex-col gap-1 self-end rounded-xl bg-mint p-3">
                <p className="text-micro text-ink-muted">
                  {hasHangul(t.userText) ? "이렇게 말하면 돼요" : "이렇게 말하면 더 자연스러워요"}
                </p>
                <p lang={room.language} className="font-bold text-brand">
                  <Furigana text={t.correction.corrected} show={furigana} />
                </p>
                <p className="text-sm">
                  <Furigana text={t.correction.explanation_ko} show={furigana} />
                </p>
              </div>
            )}
            <AiBubble line={{ text: t.reply, ko: t.replyKo }} language={room.language} level={room.level} />
          </Fragment>
        ))}
        {shownPending !== null && (
          <>
            <p lang={room.language} className={`${MY_BUBBLE} bg-house text-white`}>
              {shownPending}
            </p>
            <div className={`self-start ${AI_BUBBLE}`}>
              <WaitingDots label="응답을 기다리고 있어요" />
            </div>
          </>
        )}
        {failed !== null && (
          <>
            <p lang={room.language} className={`${MY_BUBBLE} bg-card text-ink ring-1 ring-danger ring-inset`}>
              {failed.text}
            </p>
            <div className="flex max-w-[84%] flex-wrap items-center justify-end gap-2 self-end">
              {failed.message !== null && (
                <p role="alert" className="flex items-center gap-1.5 text-sm">
                  <CircleAlert size={16} aria-hidden="true" className="shrink-0 text-danger" />
                  {failed.message}
                </p>
              )}
              <button
                type="button"
                onClick={() => void send(failed.text)}
                disabled={busy || block !== null || full}
                className={PILL}
              >
                다시 보내기
              </button>
            </div>
          </>
        )}
      </div>

      <div className="sticky bottom-0 bg-page pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {block?.kind === "limit" ? (
          <LimitNotice
            feature="chat"
            trial={trial}
            onLater={() => router.push("/home")}
            onTrialStarted={() => setBlock(null)}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {block?.kind === "failure-limit" && (
              <div className="flex items-start gap-3 rounded-xl bg-card p-4 shadow-card">
                <Info size={20} aria-hidden="true" className="shrink-0 text-accent" />
                <p className="text-sm">{block.message}</p>
              </div>
            )}
            <div className="flex items-end gap-2 rounded-3xl bg-card p-1.5 pl-4 shadow-card">
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={inputLocked}
                aria-label="메시지 입력"
                placeholder={
                  allowsKoreanInput(room.level)
                    ? `${LANGUAGE_NAMES[room.language]}로 답해 보세요. 한국어도 괜찮아요`
                    : `${LANGUAGE_NAMES[room.language]}로 답해 보세요`
                }
                className="max-h-30 flex-1 resize-none bg-transparent py-2 text-base outline-none disabled:cursor-not-allowed"
              />
              <button
                type="button"
                onClick={submit}
                disabled={!canSend}
                aria-label="보내기"
                className={`grid size-11 shrink-0 place-items-center rounded-full bg-accent text-white transition duration-200 active:scale-95 disabled:cursor-not-allowed disabled:bg-zone disabled:text-ink-muted ${FOCUS_RING}`}
              >
                <ArrowUp size={20} aria-hidden="true" />
              </button>
            </div>
            {chars > COUNTER_FROM && (
              <p
                className={`self-end px-2 text-micro tabular-nums ${chars > CHAT_INPUT_MAX ? "font-bold text-danger" : "text-ink-muted"}`}
              >
                {chars} / {CHAT_INPUT_MAX}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// 입문·초보는 번역을 항상 펼치고, 중급 이상은 말풍선 전체를 눌러 펼친다
function AiBubble({ line, language, level }: { line: ScenarioLine; language: Language; level: Level }) {
  const [open, setOpen] = useState(false);
  const body = (
    <span lang={language} className="block whitespace-pre-wrap wrap-break-word">
      <Furigana text={line.text} show={language === "ja" && showsFurigana(level)} />
    </span>
  );
  const translation = <span className="mt-2 block border-t border-line pt-2 text-sm text-ink-muted">{line.ko}</span>;

  if (opensTranslationByDefault(level)) {
    return (
      <div className={`max-w-[84%] self-start ${AI_BUBBLE}`}>
        {body}
        {translation}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
      className={`flex max-w-[84%] flex-col items-start gap-1 self-start rounded-bubble text-left ${FOCUS_RING}`}
    >
      <span className={`block ${AI_BUBBLE}`}>
        {body}
        {open && translation}
      </span>
      <span className="inline-flex items-center gap-1 px-1 text-xs font-semibold text-accent">
        <Languages size={14} aria-hidden="true" />
        번역
      </span>
    </button>
  );
}
