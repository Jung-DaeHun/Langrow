"use client";

import { ArrowUp, Check, ChevronDown, ChevronLeft, ChevronUp, CircleAlert, Info, Languages } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { opensTranslationByDefault, showsPronunciation, type Language, type Level } from "@/lib/levels";
import type { Breakdown, BreakdownTarget } from "@/lib/breakdown";
import { stripFurigana } from "@/lib/furigana";
import type { TrialState } from "@/lib/plan";
import type { ScenarioLine } from "@/lib/scenarios";
import { TARGET_SOURCE_NAMES, type TargetSource, type TargetWord } from "@/lib/targetWords";
import { CHAT_INPUT_MAX, countChars, hasHangul, isValidChatInput } from "@/lib/text";
import type { EndResult } from "@/server/db/chat";
import type { ChatRoomData, ChatTurnView } from "@/server/db/reads";
import { api } from "@/services/apiClient";
import type { ChatBreakdownResponse, ChatEndResponse, ChatMessageResponse } from "@/types/api";
import { ChatFeedback } from "./ChatFeedback";
import { Furigana } from "./Furigana";
import { LimitNotice } from "./LimitNotice";
import { SpeakButtons } from "./SpeakButtons";
import { WaitingDots } from "./WaitingDots";

// 대화방(집중 모드). 상태 전이·한도·토큰은 서버가 지키고, 화면은 응답 코드별 동작(spec/backend.md "에러 코드")만 따른다.
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
// 말풍선 아래 메타 줄의 작은 글자 버튼("번역", "문장 뜯어보기"). 재생 버튼(SpeakButtons compact)과 같은 모양이다
const META_BUTTON = `inline-flex h-9 items-center gap-1 px-1 text-xs font-semibold text-accent ${FOCUS_RING}`;
const MY_BUBBLE = "max-w-[84%] self-end whitespace-pre-wrap wrap-anywhere rounded-bubble rounded-br-md px-3.5 py-3";
const ERROR_NOTICE = "flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-danger ring-inset";

type Props = { room: ChatRoomData; scenario: { title: string; opening: ScenarioLine }; trial: TrialState };
type Block = { kind: "limit" } | { kind: "failure-limit"; message: string };
type Target = { words: TargetWord[] | null; source: TargetSource | null };

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
  // 이 화면에서 마지막으로 받은 메시지 응답의 목표 단어 상태와 그 턴에 새로 쓴 단어. room.turns가 그 턴까지 따라오면 room의 값을 쓴다
  const [replyTarget, setReplyTarget] = useState<(Target & { turnNo: number; newlyUsed: TargetWord[] }) | null>(null);
  // 기한이 지나 더 기다리지 않는 room.pendingTurn. 다시 읽으면 새 객체가 오지만 그때는 서버가 이미 null을 준다
  const [expiredPending, setExpiredPending] = useState<ChatRoomData["pendingTurn"]>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const lastTurnNo = room.turns.at(-1)?.turnNo ?? 0;
  // 화면을 열 때 이미 있던 턴은 낭독기에 알리지 않는다
  const [openedTurnNo] = useState(lastTurnNo);
  const addedTurns = added.filter((t) => t.turnNo > lastTurnNo);
  const turns = [...room.turns, ...addedTurns];
  const latest = turns.at(-1);
  const announced = latest !== undefined && latest.turnNo > openedTurnNo ? latest : null;
  const target: Target =
    replyTarget !== null && replyTarget.turnNo > lastTurnNo
      ? replyTarget
      : { words: room.targetWords, source: room.targetSource };
  const announcedWords = announced !== null && announced.turnNo === replyTarget?.turnNo ? replyTarget.newlyUsed : [];
  const showFeedback = room.status !== "active" || end !== null;
  // 다른 탭이나 이전 방문에서 보낸 턴이 처리 중이면 완료를 기다린다(spec/journey.md "대화 도중 이탈했다가 돌아옴")
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
        turns={turns}
        doneTurnsToday={room.doneTurnsToday + addedTurns.length}
        result={end?.result ?? room.result}
        targetWords={target.words}
        targetSource={target.source}
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
      const { turnNo, turnsLeft, reply, targetWords, targetSource } = result.data;
      const usedBefore = new Set(target.words?.filter((w) => w.used).map((w) => w.id));
      setReplyTarget({
        turnNo,
        words: targetWords,
        source: targetSource,
        newlyUsed: (targetWords ?? []).filter((w) => w.used && !usedBefore.has(w.id)),
      });
      setAdded((prev) => [
        ...prev,
        {
          turnNo,
          userText: text,
          reply: reply.reply,
          replyKo: reply.reply_ko,
          replyPronKo: reply.reply_pron_ko ?? null,
          replyBreakdown: reply.reply_breakdown ?? null,
          correction: reply.correction,
        },
      ]);
      // 뒤로 가기는 처음 받은 room을 다시 쓰므로 확정된 턴을 페이지 데이터에 반영한다. 화면은 다시 읽기를 기다리지 않는다
      router.refresh();
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
    // 202면 ChatFeedback이 다시 확인하고, 끝난 결과를 받을 때 다시 읽는다
    if (result.data.status === "ended") router.refresh();
    setEnd({ result: result.data.status === "ended" ? result.data : null });
  }

  const furigana = room.language === "ja";
  const pronunciation = showsPronunciation(room.language, room.level);
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
        {target.words !== null && target.words.length > 0 && target.source !== null && (
          <TargetWordsLine words={target.words} source={target.source} language={room.language} />
        )}
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

      <div className="flex flex-1 flex-col gap-3 py-4">
        {/* 한국어 입력과 번역 보기를 알리는 안내. 닫지 않고 메시지와 함께 스크롤된다 */}
        <div className="flex flex-col items-center gap-2">
          <div className="text-center text-micro text-ink-muted">
            <p>한국어로 말해도 괜찮아요</p>
            {!opensTranslationByDefault(room.level) && <p>누르면 번역이 나와요</p>}
          </div>
          <div className="w-16 border-t border-line" />
        </div>
        <AiBubble line={scenario.opening} language={room.language} level={room.level} />
        {turns.map((t) => (
          <Fragment key={t.turnNo}>
            <p lang={userTextLang(t.userText, room.language)} className={`${MY_BUBBLE} bg-house text-white`}>
              {t.userText}
            </p>
            {t.correction !== null && (
              <div className="flex max-w-[84%] flex-col gap-1 self-end rounded-xl bg-mint p-3">
                <p className="text-micro text-ink-muted">{correctionLabel(t.userText)}</p>
                <p lang={room.language} className="font-bold text-brand">
                  <Furigana text={t.correction.corrected} show={furigana} />
                </p>
                {pronunciation && t.correction.corrected_pron_ko && (
                  <p aria-hidden="true" className="text-sm text-brand">
                    {t.correction.corrected_pron_ko}
                  </p>
                )}
                <SpeakButtons source={{ kind: "speech", text: t.correction.corrected, language: room.language }} variant="compact" />
                <CorrectionBreakdown
                  pieces={t.correction.breakdown}
                  language={room.language}
                  source={{ sessionId: room.id, turnNo: t.turnNo, target: "corrected" }}
                />
                <p className="text-sm">
                  <Furigana text={t.correction.explanation_ko} show={furigana} />
                </p>
              </div>
            )}
            <AiBubble
              line={{ text: t.reply, ko: t.replyKo, pronKo: t.replyPronKo, breakdown: t.replyBreakdown }}
              language={room.language}
              level={room.level}
              source={{ sessionId: room.id, turnNo: t.turnNo, target: "reply" }}
            />
          </Fragment>
        ))}
        {shownPending !== null && (
          <>
            <p lang={userTextLang(shownPending, room.language)} className={`${MY_BUBBLE} bg-house text-white`}>
              {shownPending}
            </p>
            <div className={`self-start ${AI_BUBBLE}`}>
              <WaitingDots label="응답을 기다리고 있어요" />
            </div>
          </>
        )}
        {failed !== null && (
          <>
            <p
              lang={userTextLang(failed.text, room.language)}
              className={`${MY_BUBBLE} bg-card text-ink ring-1 ring-danger ring-inset`}
            >
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

      {/* 목록 전체를 live로 두면 재생 버튼 이름과 음성 목록이 늦게 와서 붙는 버튼까지 읽혀서, 새 턴의 문장만 따로 알린다 */}
      <div aria-live="polite" className="sr-only">
        {announced !== null && (
          <TurnAnnouncement
            key={announced.turnNo}
            turn={announced}
            usedWords={announcedWords}
            language={room.language}
            level={room.level}
          />
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

function correctionLabel(userText: string): string {
  return hasHangul(userText) ? "이렇게 말하면 돼요" : "이렇게 말하면 더 자연스러워요";
}

// 내 말은 한국어일 수 있다. 한글이 있으면 ko로 달아 일본어 줄바꿈(:lang(ja)의 word-break: normal)이 한국어 어절을 자르지 않게 한다
function userTextLang(userText: string, language: Language): string {
  return hasHangul(userText) ? "ko" : language;
}

// 낭독기용 새 턴 알림. 화면의 교정 카드와 AI 말풍선 문장을 버튼 없이 읽히고, 후리가나 표기는 지운다.
// 이번 턴에 새로 쓴 단어는 교정 다음에 알린다. 외국어 단어 뒤의 조사(을/를)를 고를 수 없어 단어를 문장 끝에 둔다
function TurnAnnouncement({
  turn,
  usedWords,
  language,
  level,
}: {
  turn: ChatTurnView;
  usedWords: TargetWord[];
  language: Language;
  level: Level;
}) {
  return (
    <p>
      {turn.correction !== null && (
        <>
          {correctionLabel(turn.userText)} <span lang={language}>{stripFurigana(turn.correction.corrected)}</span>{" "}
          {stripFurigana(turn.correction.explanation_ko)}{" "}
        </>
      )}
      {usedWords.length > 0 && (
        <>
          단어를 썼어요: <span lang={language}>{usedWords.map((w) => w.word).join(", ")}</span>{" "}
        </>
      )}
      <span lang={language}>{stripFurigana(turn.reply)}</span>
      {opensTranslationByDefault(level) && ` ${turn.replyKo}`}
    </p>
  );
}

// 배운 단어 줄(spec/chat.md "배운 단어 써 보기"). 답을 쓰면서 보게 sticky 상단에 두고, 상단이 높아지지 않게
// 감싸지 않고 가로로 밀어 본다. 칩은 버튼이 아니다. 목록의 relative는 칩 안 sr-only(절대 위치)가 목록에 잘리게 하는
// 기준점이다. 없으면 그 글자가 스크롤 영역을 벗어나 페이지가 가로로 넓어진다
function TargetWordsLine({ words, source, language }: { words: TargetWord[]; source: TargetSource; language: Language }) {
  const name = TARGET_SOURCE_NAMES[source];
  return (
    <div className="flex items-center gap-2 pb-2">
      <p className="shrink-0 text-micro font-bold text-ink-muted tabular-nums">
        {name} {words.filter((w) => w.used).length}/{words.length}
      </p>
      <ul aria-label={name} className="relative flex min-w-0 gap-1.5 overflow-x-auto">
        {words.map((w) => (
          <li
            key={w.id}
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 ${w.used ? "bg-mint text-brand" : "bg-zone text-ink"}`}
          >
            {w.used && (
              <>
                <Check size={14} aria-hidden="true" />
                <span className="sr-only">썼음</span>
              </>
            )}
            {/* 한자 읽기는 [단어|읽기] 표기로 넘기고, 가타카나 읽기는 Furigana가 단다(단어 카드 앞면과 같다) */}
            <span lang={language} className="text-sm font-bold">
              <Furigana
                text={w.reading !== null && w.reading !== w.word ? `[${w.word}|${w.reading}]` : w.word}
                show={language === "ja"}
              />
            </span>
            <span className={w.used ? "text-xs" : "text-xs text-ink-muted"}>{w.meaningKo}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// 입문·초보는 번역을 항상 펼치고, 중급 이상은 문장이나 메타 줄 "번역"을 눌러 펼친다. 한글 발음은 번역과 같이 펼친다.
// 버튼 안에 버튼을 넣을 수 없어 번역 버튼은 말풍선의 문장·발음·번역 부분만 감싸고, 뜯어보기 타일과 메타 줄은 그 밖에 둔다.
// 재생 버튼은 메타 줄 아래에 둔다
function AiBubble({
  line,
  language,
  level,
  source,
}: {
  line: { text: string; ko: string; pronKo?: string | null; breakdown?: Breakdown | null };
  language: Language;
  level: Level;
  source?: BreakdownSource; // 턴 말풍선만 넘긴다. 첫 마디는 API를 부르지 않는다
}) {
  const [open, setOpen] = useState(false);
  const breakdown = useBreakdown(line.breakdown, source);
  const alwaysOpen = opensTranslationByDefault(level);
  const body = (
    <span lang={language} className="block whitespace-pre-wrap wrap-anywhere">
      <Furigana text={line.text} show={language === "ja"} />
    </span>
  );
  // 낭독기는 lang="ja" 문장을 읽으므로 발음은 숨긴다
  const pronunciation =
    showsPronunciation(language, level) && line.pronKo ? (
      <span aria-hidden="true" className="mt-1 block text-sm text-brand">
        {line.pronKo}
      </span>
    ) : null;
  const translation = <span className="mt-2 block border-t border-line pt-2 text-sm text-ink-muted">{line.ko}</span>;

  return (
    <div className="flex max-w-[84%] flex-col items-start gap-1 self-start">
      <div className={AI_BUBBLE}>
        {alwaysOpen ? (
          <>
            {body}
            {pronunciation}
            {translation}
          </>
        ) : (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className={`block w-full rounded-lg text-left ${FOCUS_RING}`}
          >
            {body}
            {open && pronunciation}
            {open && translation}
          </button>
        )}
        {breakdown.open && (
          <div className="mt-2 border-t border-line pt-2">
            <BreakdownSlot breakdown={breakdown} language={language} tile="bg-page" />
          </div>
        )}
      </div>
      {(!alwaysOpen || breakdown.shown) && (
        <div className="flex gap-3">
          {!alwaysOpen && (
            <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={META_BUTTON}>
              <Languages size={14} aria-hidden="true" />
              번역
            </button>
          )}
          {breakdown.shown && <BreakdownToggle breakdown={breakdown} />}
        </div>
      )}
      <SpeakButtons source={{ kind: "speech", text: line.text, language }} variant="compact" />
    </div>
  );
}

// 교정 카드의 뜯어보기. 토글 바로 아래에 타일을 펼친다
function CorrectionBreakdown({
  pieces,
  language,
  source,
}: {
  pieces?: Breakdown;
  language: Language;
  source: BreakdownSource;
}) {
  const breakdown = useBreakdown(pieces, source);
  return (
    <div className="flex flex-col items-start gap-1">
      <BreakdownToggle breakdown={breakdown} />
      {breakdown.open && <BreakdownSlot breakdown={breakdown} language={language} tile="bg-card/70" />}
    </div>
  );
}

type BreakdownSource = { sessionId: string; turnNo: number; target: BreakdownTarget };
type Requested =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "done"; pieces: Breakdown }
  | { kind: "error"; message: string }
  | { kind: "failure-limit"; message: string };

// 문장 뜯어보기(spec/chat.md "문장 뜯어보기"). 처음에는 닫혀 있고 열림 상태는 저장하지 않는다.
// 저장본이 없는 턴의 문장은 처음 열 때 만든다("처음 열 때 만들기"). 받은 값은 화면 상태에만 두고, 다시 읽은 턴에 저장본이 오면 그것을 쓴다.
// 첫 마디는 source가 없어 scenarios.ts의 값만 쓰고, 값이 없으면 토글을 두지 않는다.
// 실패해도 대화 입력을 막거나 대화방을 다시 읽지 않는다(404여도 홈으로 가지 않는다)
function useBreakdown(initial: Breakdown | null | undefined, source?: BreakdownSource) {
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState<Requested>({ kind: "idle" });
  const stored = initial?.length ? initial : null;
  const pieces = stored ?? (requested.kind === "done" ? requested.pieces : null);

  async function request() {
    if (source === undefined) return;
    setRequested({ kind: "waiting" });
    const { sessionId, turnNo, target } = source;
    const result = await api<ChatBreakdownResponse>("POST", `/api/chat/sessions/${sessionId}/breakdown`, {
      turn_no: turnNo,
      target,
    });
    if (result.ok) setRequested({ kind: "done", pieces: result.data.breakdown });
    else if (result.code === "AI_FAILURE_LIMIT") setRequested({ kind: "failure-limit", message: result.message });
    else setRequested({ kind: "error", message: result.message });
  }

  function toggle() {
    if (open) {
      setOpen(false);
      // 오류·안내는 지우고 다시 열면 다시 부른다
      if (requested.kind !== "done") setRequested({ kind: "idle" });
      return;
    }
    setOpen(true);
    if (pieces === null) void request();
  }

  return {
    shown: pieces !== null || source !== undefined,
    open,
    toggle,
    retry: () => void request(),
    pieces,
    requested,
    // 처음 열 때 받는 문장은 대기·타일·오류가 읽히도록 타일 자리를 aria-live 영역으로 둔다
    live: stored === null,
  };
}

type BreakdownState = ReturnType<typeof useBreakdown>;

function BreakdownToggle({ breakdown }: { breakdown: BreakdownState }) {
  const Icon = breakdown.open ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      aria-expanded={breakdown.open}
      onClick={breakdown.toggle}
      disabled={breakdown.pieces === null && breakdown.requested.kind === "waiting"}
      className={META_BUTTON}
    >
      문장 뜯어보기
      <Icon size={14} aria-hidden="true" />
    </button>
  );
}

// 열린 토글의 타일 자리. 기다리는 동안 점 3개, 실패면 AI 정답 설명과 같은 오류 Notice와 [다시 시도], 실패 10회면 정보 Notice만 둔다
function BreakdownSlot({ breakdown, language, tile }: { breakdown: BreakdownState; language: Language; tile: string }) {
  const { pieces, requested } = breakdown;
  let content: ReactNode;
  if (pieces !== null) {
    content = <BreakdownTiles pieces={pieces} language={language} tile={tile} />;
  } else if (requested.kind === "failure-limit") {
    content = (
      <div className="flex items-start gap-3 rounded-xl bg-card p-4 shadow-card">
        <Info size={20} aria-hidden="true" className="shrink-0 text-accent" />
        <p className="text-sm">{requested.message}</p>
      </div>
    );
  } else if (requested.kind === "error") {
    content = (
      <div role="alert" className={ERROR_NOTICE}>
        <CircleAlert size={20} aria-hidden="true" className="shrink-0 text-danger" />
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm">{requested.message}</p>
          <button type="button" onClick={breakdown.retry} className={PILL}>
            다시 시도
          </button>
        </div>
      </div>
    );
  } else {
    content = (
      <div className="flex h-9 items-center">
        <WaitingDots label="뜯어보기를 만드는 중" />
      </div>
    );
  }
  return breakdown.live ? <div aria-live="polite">{content}</div> : content;
}

// 조각 타일을 문장 순서대로 잇는다. 위는 조각(학습 언어), 아래는 뜻이고 한글 발음은 넣지 않는다
function BreakdownTiles({ pieces, language, tile }: { pieces: Breakdown; language: Language; tile: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {pieces.map((piece, i) => (
        <div key={i} className={`rounded-lg ${tile} px-2 py-1 text-center`}>
          <p lang={language} className="text-sm font-semibold text-brand">
            <Furigana text={piece.text} show={language === "ja"} />
          </p>
          <p className="text-xs text-ink-muted">{piece.meaning_ko}</p>
        </div>
      ))}
    </div>
  );
}
