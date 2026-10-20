import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Level } from "@/lib/levels";
import type { TrialState } from "@/lib/plan";
import type { TargetSource, TargetWord } from "@/lib/targetWords";
import type { ChatRoomData, ChatTurnView } from "@/server/db/reads";
import { api, type ApiResult } from "@/services/apiClient";
import type { ChatBreakdownResponse, ChatEndResponse, ChatMessageResponse } from "@/types/api";
import { ChatRoom } from "./ChatRoom";

vi.mock("@/services/apiClient", () => ({ api: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const apiMock = vi.mocked(api);
const push = vi.fn();
const refresh = vi.fn();
const scrollTo = vi.fn();
const PAGE_HEIGHT = 5000;

beforeEach(() => {
  apiMock.mockReset();
  push.mockReset();
  refresh.mockReset();
  scrollTo.mockReset();
  vi.mocked(useRouter).mockReturnValue({ push, refresh } as unknown as ReturnType<typeof useRouter>);
  vi.stubGlobal("scrollTo", scrollTo);
  // jsdom은 레이아웃이 없어 scrollHeight가 0이다
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: PAGE_HEIGHT });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const MESSAGES_PATH = "/api/chat/sessions/s-1/messages";
const END_PATH = "/api/chat/sessions/s-1/end";
const SCENARIO = { title: "카페에서 주문하기", opening: { text: "Hi! What can I get for you?", ko: "안녕하세요! 뭘 드릴까요?" } };
const UNAVAILABLE = "응답을 받지 못했어요. 턴은 차감되지 않았어요.";

function turn(turnNo: number, overrides: Partial<ChatTurnView> = {}): ChatTurnView {
  return {
    turnNo,
    userText: `user ${turnNo}`,
    reply: `reply ${turnNo}`,
    replyKo: `번역 ${turnNo}`,
    replyPronKo: null,
    replyBreakdown: null,
    correction: null,
    ...overrides,
  };
}

function room(overrides: Partial<ChatRoomData> = {}): ChatRoomData {
  return {
    id: "s-1",
    language: "en",
    level: 3,
    scenarioId: "l3-cafe",
    status: "active",
    result: null,
    turns: [],
    doneTurnsToday: 0,
    pendingTurn: null,
    targetWords: null,
    targetSource: null,
    ...overrides,
  };
}

function setup(data: ChatRoomData = room(), trial: TrialState = { kind: "available" }, scenario = SCENARIO) {
  const user = userEvent.setup();
  const view = render(<ChatRoom room={data} scenario={scenario} trial={trial} />);
  const rerender = (next: ChatRoomData) => view.rerender(<ChatRoom room={next} scenario={scenario} trial={trial} />);
  return { user, rerender, container: view.container };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function replied(turnNo: number, turnsLeft: number, overrides: Partial<ChatMessageResponse["reply"]> = {}) {
  return {
    ok: true,
    status: 200,
    data: {
      turnNo,
      turnsLeft,
      reply: { reply: `AI ${turnNo}`, reply_ko: `AI 번역 ${turnNo}`, correction: null, ...overrides },
      targetWords: null,
      targetSource: null,
    },
  } satisfies ApiResult<ChatMessageResponse>;
}

function failure(status: number | null, code: string, message: string) {
  return { ok: false, status, code, message } as ApiResult<never>;
}

const endedReady: ApiResult<ChatEndResponse> = {
  ok: true,
  status: 200,
  data: { status: "ended", feedbackStatus: "ready", feedback: { good: "잘 주문했어요", improve: [] } },
};

const textbox = () => screen.getByRole("textbox");
const sendButton = () => screen.getByRole("button", { name: "보내기" });
const endButton = () => screen.getByRole("button", { name: "대화 끝내기" });
// 새 턴은 낭독기 알림(sr-only)에도 같은 문장이 있어 화면의 말풍선만 찾는다
const ON_SCREEN = { ignore: "[aria-live] *, script, style" };

async function typeAndSend(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(textbox(), text);
  await user.click(sendButton());
}

function isBefore(a: HTMLElement, b: HTMLElement) {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe("ChatRoom 표시", () => {
  it("집중 모드이고 상단에 [상황 목록]·상황 제목·성공 턴 수·[대화 끝내기]를 둔다", () => {
    const { container } = setup(room({ turns: [turn(1), turn(2)] }));

    expect(container.querySelector("[data-focus-mode]")).not.toBeNull();
    expect(screen.getByRole("link", { name: "상황 목록" })).toHaveAttribute("href", "/chat");
    expect(screen.getByText("카페에서 주문하기")).toBeInTheDocument();
    expect(screen.getByText("2 / 20턴")).toBeInTheDocument();
    expect(endButton()).toBeEnabled();
  });

  it("첫 마디 → 내 말풍선 → 교정 → AI 말풍선 순서로 그린다", () => {
    setup(
      room({
        turns: [
          turn(1, { correction: { corrected: "I'd like a latte.", explanation_ko: "정중한 표현이에요" } }),
          turn(2),
        ],
      }),
    );

    const order = [
      screen.getByText(SCENARIO.opening.text),
      screen.getByText("user 1"),
      screen.getByText("I'd like a latte."),
      screen.getByText("reply 1"),
      screen.getByText("user 2"),
      screen.getByText("reply 2"),
    ];
    order.slice(1).forEach((el, i) => expect(isBefore(order[i], el)).toBe(true));
  });

  it("말풍선과 교정 문장에 학습 언어 lang을 단다", () => {
    setup(room({ turns: [turn(1, { correction: { corrected: "Fixed.", explanation_ko: "설명" } })] }));

    expect(screen.getByText(SCENARIO.opening.text).closest("[lang]")).toHaveAttribute("lang", "en");
    expect(screen.getByText("user 1").closest("[lang]")).toHaveAttribute("lang", "en");
    expect(screen.getByText("Fixed.").closest("[lang]")).toHaveAttribute("lang", "en");
  });

  it("내 말풍선에 한글이 있으면 lang을 ko로 단다 (일본어 줄바꿈이 한국어 어절을 음절 사이에서 자르지 않게)", async () => {
    apiMock.mockResolvedValueOnce(failure(503, "AI_UNAVAILABLE", UNAVAILABLE));
    const { user } = setup(
      room({
        language: "ja",
        turns: [turn(1, { userText: "노래방에 가고 싶어요" }), turn(2, { userText: "はい" })],
      }),
    );
    expect(screen.getByText("노래방에 가고 싶어요")).toHaveAttribute("lang", "ko");
    expect(screen.getByText("はい")).toHaveAttribute("lang", "ja");

    await typeAndSend(user, "커피 주세요");
    expect(await screen.findByText("커피 주세요")).toHaveAttribute("lang", "ko");
  });

  it("다른 곳에서 보낸 처리 중인 한국어 말풍선도 lang이 ko다", () => {
    setup(room({ language: "ja", pendingTurn: { userText: "잠깐만요", msLeft: 1000 } }));
    expect(screen.getByText("잠깐만요")).toHaveAttribute("lang", "ko");
  });

  it("correction이 null이면 교정 카드를 그리지 않는다", () => {
    setup(room({ turns: [turn(1)] }));

    expect(screen.queryByText(/이렇게 말하면/)).toBeNull();
  });

  it("교정 라벨은 영어 입력이면 더 자연스러워요, 한글 입력이면 돼요다", () => {
    setup(
      room({
        level: 1,
        turns: [
          turn(1, { userText: "I want coffee", correction: { corrected: "I'd like coffee.", explanation_ko: "부드러운 표현" } }),
          turn(2, { userText: "라떼 주세요", correction: { corrected: "A latte, please.", explanation_ko: "이렇게 말해요" } }),
        ],
      }),
    );

    expect(screen.getByText("이렇게 말하면 더 자연스러워요")).toBeInTheDocument();
    expect(screen.getByText("이렇게 말하면 돼요")).toBeInTheDocument();
    expect(screen.getByText("부드러운 표현")).toBeInTheDocument();
  });

  it.each([1, 2] as const)("레벨 %i은 번역을 항상 펼친다", (level) => {
    setup(room({ level, turns: [turn(1)] }));

    expect(screen.getByText(SCENARIO.opening.ko)).toBeInTheDocument();
    expect(screen.getByText("번역 1")).toBeInTheDocument();
    // 접히는 버튼은 턴 말풍선의 뜯어보기 토글뿐이다(번역 토글 없음)
    expect(screen.getAllByRole("button", { expanded: false }).map((b) => b.textContent)).toEqual(["문장 뜯어보기"]);
  });

  it("레벨 3은 말풍선 문장을 눌러 번역을 펼친다", async () => {
    const { user } = setup(room({ level: 3, turns: [turn(1)] }));

    expect(screen.queryByText(SCENARIO.opening.ko)).toBeNull();
    expect(screen.queryByText("번역 1")).toBeNull();
    const bubble = screen.getByRole("button", { name: "reply 1" });
    expect(bubble).toHaveAttribute("aria-expanded", "false");

    await user.click(bubble);

    expect(screen.getByText("번역 1")).toBeInTheDocument();
    expect(bubble).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText(SCENARIO.opening.ko)).toBeNull();
  });

  it("레벨 3은 말풍선 아래 [번역]으로도 같은 번역을 여닫는다", async () => {
    const { user } = setup(room({ level: 3, turns: [turn(1)] }));
    const metas = screen.getAllByRole("button", { name: "번역" });
    expect(metas).toHaveLength(2);

    await user.click(metas[1]);

    expect(screen.getByText("번역 1")).toBeInTheDocument();
    expect(metas[1]).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /^reply 1/ })).toHaveAttribute("aria-expanded", "true");

    await user.click(metas[1]);

    expect(screen.queryByText("번역 1")).toBeNull();
    expect(metas[1]).toHaveAttribute("aria-expanded", "false");
  });

  it.each([1, 4, 5] as const)("일본어 레벨 %i은 첫 마디·말풍선·교정에 후리가나 ruby를 그린다", (level) => {
    const ja = { title: "편의점", opening: { text: "お[弁当|べんとう]、[温|あたた]めますか？", ko: "도시락 데워 드릴까요?" } };
    const correction = { corrected: "[来|き]ました。", explanation_ko: "'왔어요'는 '[来|き]ました'예요" };
    const reply = "コーヒーを[飲|の]みますか？";
    const { container } = setup(room({ language: "ja", level, turns: [turn(1, { correction, reply })] }), { kind: "available" }, ja);

    const readings = [...container.querySelectorAll("rt")].map((rt) => rt.textContent);
    expect(readings).toEqual(["べんとう", "あたた", "き", "き", "こーひー", "の"]);
    expect(container.textContent).not.toMatch(/[[\]|]/);
  });

  it("영어 대화에는 ruby를 그리지 않는다", () => {
    const correction = { corrected: "I want コーヒー.", explanation_ko: "[水|みず]" };
    const { container } = setup(room({ language: "en", level: 1, turns: [turn(1, { correction })] }));

    expect(container.querySelector("ruby")).toBeNull();
  });
});

describe("ChatRoom 입력", () => {
  it("처음 렌더에서 입력창이 막혀 있지 않다", async () => {
    const { user } = setup(room({ turns: Array.from({ length: 5 }, (_, i) => turn(i + 1)) }));

    expect(textbox()).toBeEnabled();
    expect(sendButton()).toBeDisabled();
    await user.type(textbox(), "hello");
    expect(sendButton()).toBeEnabled();
  });

  it("입력창에는 placeholder 없이 이름만 단다", () => {
    setup(room({ level: 1 }));
    expect(screen.getByRole("textbox", { name: "메시지 입력" })).not.toHaveAttribute("placeholder");
  });

  it("IME 조합 중 Enter는 전송하지 않는다", async () => {
    const { user } = setup();
    await user.type(textbox(), "안녕");

    fireEvent.keyDown(textbox(), { key: "Enter", isComposing: true });

    expect(apiMock).not.toHaveBeenCalled();
    expect(textbox()).toHaveValue("안녕");
  });

  it("Enter는 전송하고 Shift+Enter는 전송하지 않는다", async () => {
    apiMock.mockResolvedValue(replied(1, 19));
    const { user } = setup();
    await user.type(textbox(), "hello");

    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(apiMock).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(apiMock).toHaveBeenCalledWith("POST", MESSAGES_PATH, { text: "hello" });
  });

  it("250자까지는 글자 수를 숨기고 251자부터 n / 300을 보여 준다", () => {
    setup();

    fireEvent.change(textbox(), { target: { value: "a".repeat(250) } });
    expect(screen.queryByText("250 / 300")).toBeNull();

    fireEvent.change(textbox(), { target: { value: "a".repeat(251) } });
    expect(screen.getByText("251 / 300")).not.toHaveClass("text-danger");
    expect(sendButton()).toBeEnabled();
  });

  it("301자면 글자 수를 danger 굵게 바꾸고 전송을 막는다", () => {
    setup();

    fireEvent.change(textbox(), { target: { value: "a".repeat(301) } });

    expect(screen.getByText("301 / 300")).toHaveClass("text-danger", "font-bold");
    expect(sendButton()).toBeDisabled();
  });
});

describe("ChatRoom 전송", () => {
  it("전송 중에는 입력창을 비우고 내 말풍선과 대기 점을 보여 주며, 200이면 턴을 추가한다", async () => {
    const pending = deferred<ApiResult<ChatMessageResponse>>();
    apiMock.mockReturnValue(pending.promise);
    const { user } = setup(room({ turns: [turn(1)] }));

    await typeAndSend(user, "  I'd like a latte  ");

    expect(apiMock).toHaveBeenCalledWith("POST", MESSAGES_PATH, { text: "I'd like a latte" });
    expect(textbox()).toHaveValue("");
    expect(screen.getByText("I'd like a latte")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("응답을 기다리고 있어요");
    expect(endButton()).toBeDisabled();
    await user.type(textbox(), "next");
    expect(sendButton()).toBeDisabled();

    await act(async () => pending.resolve(replied(2, 18, { correction: { corrected: "Fixed.", explanation_ko: "설명" } })));

    expect(screen.getByText("AI 2", ON_SCREEN)).toBeInTheDocument();
    expect(screen.getByText("Fixed.", ON_SCREEN)).toBeInTheDocument();
    expect(screen.getByText("2 / 20턴")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(endButton()).toBeEnabled();
    expect(sendButton()).toBeEnabled();
  });

  it("503이면 문장을 실패 말풍선으로 남기고 [다시 보내기]가 같은 문장을 보낸다", async () => {
    apiMock.mockResolvedValueOnce(failure(503, "AI_UNAVAILABLE", UNAVAILABLE)).mockResolvedValueOnce(replied(1, 19));
    const { user } = setup();

    await typeAndSend(user, "hello there");

    expect(screen.getByText("hello there")).toHaveClass("ring-danger");
    expect(screen.getByRole("alert")).toHaveTextContent(UNAVAILABLE);

    await user.click(screen.getByRole("button", { name: "다시 보내기" }));

    expect(apiMock).toHaveBeenLastCalledWith("POST", MESSAGES_PATH, { text: "hello there" });
    expect(screen.getByText("AI 1", ON_SCREEN)).toBeInTheDocument();
    expect(screen.getByText("hello there")).not.toHaveClass("ring-danger");
    expect(screen.queryByRole("button", { name: "다시 보내기" })).toBeNull();
  });

  it("네트워크 오류면 api가 준 연결 문구를 보여 준다", async () => {
    apiMock.mockResolvedValue(failure(null, "NETWORK", "연결이 끊겼어요."));
    const { user } = setup();

    await typeAndSend(user, "hello");

    expect(screen.getByRole("alert")).toHaveTextContent("연결이 끊겼어요.");
    expect(screen.getByRole("button", { name: "다시 보내기" })).toBeEnabled();
  });

  it("새 문장을 보내면 이전 실패 말풍선을 없앤다", async () => {
    apiMock.mockResolvedValueOnce(failure(503, "AI_UNAVAILABLE", UNAVAILABLE)).mockResolvedValueOnce(replied(1, 19));
    const { user } = setup();

    await typeAndSend(user, "first try");
    await typeAndSend(user, "second try");

    expect(screen.queryByText("first try")).toBeNull();
    expect(screen.getByText("second try")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("409 CONFLICT면 실패 말풍선과 함께 다시 읽고, 자동으로 다시 보내지 않으며, 새 턴을 반영한다", async () => {
    apiMock.mockResolvedValue(failure(409, "CONFLICT", "다른 요청과 겹쳤어요."));
    const { user, rerender } = setup(room({ turns: [turn(1)] }));

    await typeAndSend(user, "hello");

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("다른 요청과 겹쳤어요.");
    expect(apiMock).toHaveBeenCalledTimes(1);

    rerender(room({ turns: [turn(1), turn(2, { userText: "from other tab", reply: "other reply" })] }));

    expect(screen.getByText("other reply", ON_SCREEN)).toBeInTheDocument();
    expect(screen.getByText("2 / 20턴")).toBeInTheDocument();
    expect(screen.getByText("hello")).toHaveClass("ring-danger");
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("429 LIMIT_REACHED면 입력창 자리에 한도 안내를 두고 [대화 끝내기]는 계속 쓸 수 있다", async () => {
    apiMock.mockResolvedValue(failure(429, "LIMIT_REACHED", "오늘 사용량을 모두 썼어요."));
    const { user } = setup();

    await typeAndSend(user, "hello");

    expect(screen.getByText("오늘 AI 대화 턴을 모두 썼어요")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "다시 보내기" })).toBeDisabled();
    expect(endButton()).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "내일 할게요" }));
    expect(push).toHaveBeenCalledWith("/home");
  });

  it("한도 안내에서 체험을 시작하면 입력창과 [다시 보내기]를 되살린다", async () => {
    apiMock
      .mockResolvedValueOnce(failure(429, "LIMIT_REACHED", "오늘 사용량을 모두 썼어요."))
      .mockResolvedValueOnce({ ok: true, status: 200, data: { proUntil: "2026-10-13T00:00:00.000Z" } });
    const { user } = setup();

    await typeAndSend(user, "hello");
    await user.click(screen.getByRole("button", { name: "7일 무료 체험" }));

    expect(apiMock).toHaveBeenLastCalledWith("POST", "/api/trial");
    expect(textbox()).toBeEnabled();
    expect(screen.queryByText("오늘 AI 대화 턴을 모두 썼어요")).toBeNull();
    expect(screen.getByRole("button", { name: "다시 보내기" })).toBeEnabled();
  });

  it("429 AI_FAILURE_LIMIT면 입력창을 막고 서버 문구를 안내한다", async () => {
    const message = "오늘은 응답 오류가 많아 대화를 잠시 쉬어요. 내일 다시 시도해 주세요.";
    apiMock.mockResolvedValue(failure(429, "AI_FAILURE_LIMIT", message));
    const { user } = setup();

    await typeAndSend(user, "hello");

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(textbox()).toBeDisabled();
    expect(sendButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "다시 보내기" })).toBeDisabled();
    expect(endButton()).toBeEnabled();
  });

  it("turnsLeft가 0이면 이어서 /end를 부르고 입력창을 막는다", async () => {
    const pendingEnd = deferred<ApiResult<ChatEndResponse>>();
    apiMock.mockResolvedValueOnce(replied(20, 0)).mockReturnValueOnce(pendingEnd.promise);
    const { user } = setup(room({ turns: Array.from({ length: 19 }, (_, i) => turn(i + 1)) }));

    await typeAndSend(user, "bye");

    expect(screen.getByText("AI 20", ON_SCREEN)).toBeInTheDocument();
    expect(apiMock).toHaveBeenLastCalledWith("POST", END_PATH);
    expect(textbox()).toBeDisabled();

    await act(async () => pendingEnd.resolve(endedReady));
    expect(screen.getByRole("heading", { name: "대화 피드백" })).toBeInTheDocument();
  });

  it("409 SESSION_FULL이면 /end를 부른다", async () => {
    apiMock.mockResolvedValueOnce(failure(409, "SESSION_FULL", "이 대화는 20턴을 모두 채웠어요.")).mockResolvedValueOnce(endedReady);
    const { user } = setup();

    await typeAndSend(user, "hello");

    expect(apiMock).toHaveBeenLastCalledWith("POST", END_PATH);
    expect(screen.getByText("잘 주문했어요")).toBeInTheDocument();
  });

  it("404면 홈으로 이동한다", async () => {
    apiMock.mockResolvedValue(failure(404, "NOT_FOUND", "찾을 수 없어요."));
    const { user } = setup();

    await typeAndSend(user, "hello");

    expect(push).toHaveBeenCalledWith("/home");
  });
});

describe("ChatRoom 종료", () => {
  it("[대화 끝내기] 200이면 저장된 결과로 피드백을 보여 준다", async () => {
    apiMock.mockResolvedValue(endedReady);
    const { user } = setup(room({ turns: [turn(1)] }));

    await user.click(endButton());

    expect(apiMock).toHaveBeenCalledWith("POST", END_PATH);
    expect(screen.getByRole("heading", { name: "대화 피드백" })).toBeInTheDocument();
    expect(screen.getByText("잘 주문했어요")).toBeInTheDocument();
  });

  it("/end 202면 처리 중 화면으로 바꾼다", async () => {
    apiMock.mockResolvedValue({ ok: true, status: 202, data: { status: "ending", retryAfterSeconds: 2 } });
    const { user } = setup(room({ turns: [turn(1)] }));

    await user.click(endButton());

    expect(screen.getByText("피드백을 만들고 있어요")).toBeInTheDocument();
  });

  it("/end 409면 오류와 [다시 시도]를 보여 주고 자동으로 다시 부르지 않는다", async () => {
    apiMock
      .mockResolvedValueOnce(failure(409, "CONFLICT", "다른 요청과 겹쳤어요."))
      .mockResolvedValueOnce(endedReady);
    const { user } = setup(room({ turns: [turn(1)] }));

    await user.click(endButton());

    expect(screen.getByRole("alert")).toHaveTextContent("다른 요청과 겹쳤어요.");
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(textbox()).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("잘 주문했어요")).toBeInTheDocument();
  });

  it("/end 404면 홈으로 이동한다", async () => {
    apiMock.mockResolvedValue(failure(404, "NOT_FOUND", "찾을 수 없어요."));
    const { user } = setup(room({ turns: [turn(1)] }));

    await user.click(endButton());

    expect(push).toHaveBeenCalledWith("/home");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("오늘 확정된 턴에 이 화면에서 확정한 턴을 더해 피드백의 오늘 목표를 정한다", async () => {
    apiMock.mockResolvedValueOnce(replied(3, 17)).mockResolvedValueOnce(endedReady);
    const { user } = setup(room({ turns: [turn(1), turn(2)], doneTurnsToday: 2 }));

    await typeAndSend(user, "hello");
    await user.click(endButton());

    expect(screen.getByText("오늘 대화 목표를 채웠어요")).toBeInTheDocument();
  });

  it("종료 요청 중에는 [대화 끝내기]와 전송을 막는다", async () => {
    apiMock.mockReturnValue(deferred<ApiResult<ChatEndResponse>>().promise);
    const { user } = setup(room({ turns: [turn(1)] }));
    await user.type(textbox(), "hello");

    await user.click(endButton());

    expect(endButton()).toBeDisabled();
    expect(sendButton()).toBeDisabled();
  });
});

describe("ChatRoom 처리 중인 턴", () => {
  const waiting = { userText: "still waiting", msLeft: 60_000 };

  it("다른 곳에서 보낸 턴이 처리 중이면 그 문장과 대기 점을 보여 주고 전송과 [대화 끝내기]를 막는다", () => {
    setup(room({ turns: [turn(1)], pendingTurn: waiting }));
    fireEvent.change(textbox(), { target: { value: "hello" } });

    expect(screen.getByText("still waiting")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("응답을 기다리고 있어요");
    expect(sendButton()).toBeDisabled();
    expect(endButton()).toBeDisabled();
  });

  it("처리 중이면 3초 뒤 다시 읽고, 다시 읽은 room에서 확정됐으면 새 턴을 보여 주고 전송을 연다", () => {
    vi.useFakeTimers();
    const { rerender } = setup(room({ turns: [turn(1)], pendingTurn: waiting }));

    act(() => vi.advanceTimersByTime(2999));
    expect(refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(refresh).toHaveBeenCalledTimes(1);

    rerender(room({ turns: [turn(1), turn(2, { userText: "still waiting", reply: "AI 2" })], pendingTurn: null }));
    fireEvent.change(textbox(), { target: { value: "hello" } });

    expect(screen.getByText("AI 2", ON_SCREEN)).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(sendButton()).toBeEnabled();
    act(() => vi.advanceTimersByTime(10_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("기한이 지나면 기다리기를 멈추고 전송을 연다 (다음 전송 때 서버가 복구한다)", () => {
    vi.useFakeTimers();
    setup(room({ turns: [turn(1)], pendingTurn: { userText: "still waiting", msLeft: 1000 } }));

    act(() => vi.advanceTimersByTime(1000));
    fireEvent.change(textbox(), { target: { value: "hello" } });

    expect(screen.queryByText("still waiting")).toBeNull();
    expect(sendButton()).toBeEnabled();
  });
});

describe("ChatRoom 상태 동기화", () => {
  it("ending 세션은 바로 처리 중 피드백 화면을 그린다", () => {
    setup(room({ status: "ending", turns: [turn(1)] }));

    expect(screen.getByText("피드백을 만들고 있어요")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("ended 세션은 저장된 결과를 그린다", () => {
    setup(room({ status: "ended", result: { feedbackStatus: "skipped", feedback: null } }));

    expect(screen.getByRole("heading", { name: "대화 피드백" })).toBeInTheDocument();
    expect(screen.getByText("카페에서 주문하기 · 0턴")).toBeInTheDocument();
  });

  it("다시 읽은 room이 다른 탭에서 끝났으면 피드백으로 바꾼다", () => {
    const { rerender } = setup(room({ turns: [turn(1)] }));

    rerender(
      room({ status: "ended", turns: [turn(1)], result: { feedbackStatus: "ready", feedback: { good: "다른 탭 결과", improve: [] } } }),
    );

    expect(screen.getByText("다른 탭 결과")).toBeInTheDocument();
  });
});

// 브라우저 뒤로 가기는 처음 받은 room을 다시 쓴다(spec/journey.md "예외 흐름"). 턴이나 끝난 결과를 받으면 다시 읽어 그 room을 바꾼다
describe("ChatRoom 뒤로 가기 대비 다시 읽기", () => {
  const word = (id: string, text: string, meaningKo: string, used: boolean): TargetWord => ({
    id,
    word: text,
    reading: null,
    meaningKo,
    used,
  });

  it("뒤로 가기로 돌아온 처음 화면(턴 0)에서 끝내면 다시 읽고, 다시 읽은 room의 턴 수와 단어 결과로 피드백을 그린다", async () => {
    apiMock.mockResolvedValue(endedReady);
    const { user, rerender } = setup(room());

    await user.click(endButton());

    // 다시 읽기를 기다리지 않고 저장된 결과를 바로 그린다
    expect(screen.getByText("잘 주문했어요")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);

    rerender(
      room({
        status: "ended",
        turns: [turn(1), turn(2), turn(3)],
        doneTurnsToday: 3,
        targetWords: [word("en-3-001", "decide", "결정하다", true), word("en-3-002", "borrow", "빌리다", false)],
        targetSource: "today",
        result: { feedbackStatus: "ready", feedback: { good: "잘 주문했어요", improve: [] } },
      }),
    );

    expect(screen.getByText("카페에서 주문하기 · 3턴")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "오늘 단어 2개 중 1개를 썼어요" })).toBeInTheDocument();
  });

  it("메시지 응답이 성공할 때마다 한 번씩 다시 읽고, 실패 응답에는 다시 읽지 않는다", async () => {
    apiMock
      .mockResolvedValueOnce(replied(1, 19))
      .mockResolvedValueOnce(failure(503, "AI_UNAVAILABLE", UNAVAILABLE))
      .mockResolvedValueOnce(replied(2, 18));
    const { user } = setup();

    await typeAndSend(user, "first");
    expect(refresh).toHaveBeenCalledTimes(1);

    await typeAndSend(user, "second");
    expect(screen.getByRole("alert")).toHaveTextContent(UNAVAILABLE);
    expect(refresh).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "다시 보내기" }));
    expect(screen.getByText("AI 2", ON_SCREEN)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("마지막 턴(turnsLeft 0)에도 다시 읽고, 이어 부른 /end가 끝난 결과를 주면 한 번 더 읽는다", async () => {
    const pendingEnd = deferred<ApiResult<ChatEndResponse>>();
    apiMock.mockResolvedValueOnce(replied(20, 0)).mockReturnValueOnce(pendingEnd.promise);
    const { user } = setup(room({ turns: Array.from({ length: 19 }, (_, i) => turn(i + 1)) }));

    await typeAndSend(user, "bye");
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => pendingEnd.resolve(endedReady));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("/end 202면 다시 읽지 않는다 (피드백 화면이 기다리다 끝난 결과를 받을 때 읽는다)", async () => {
    apiMock.mockResolvedValue({ ok: true, status: 202, data: { status: "ending", retryAfterSeconds: 2 } });
    const { user } = setup(room({ turns: [turn(1)] }));

    await user.click(endButton());

    expect(screen.getByText("피드백을 만들고 있어요")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("ChatRoom 스크롤", () => {
  it("새 메시지가 오면 맨 아래로 스크롤한다", async () => {
    apiMock.mockResolvedValue(replied(1, 19));
    const { user } = setup();
    scrollTo.mockClear();

    await typeAndSend(user, "hello");

    expect(scrollTo).toHaveBeenLastCalledWith(0, PAGE_HEIGHT);
  });

  it("피드백으로 바뀌면 맨 위로 스크롤한다", async () => {
    apiMock.mockResolvedValue(endedReady);
    const { user } = setup(room({ turns: [turn(1)] }));

    await user.click(endButton());

    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
  });

  it("끝난 세션을 열면 아래로 스크롤하지 않는다", () => {
    setup(room({ status: "ended", turns: [turn(1)], result: { feedbackStatus: "skipped", feedback: null } }));

    expect(scrollTo).not.toHaveBeenCalledWith(0, PAGE_HEIGHT);
  });
});

describe("ChatRoom 음성", () => {
  class FakeUtterance {
    voice: unknown = null;
    lang = "";
    rate = 1;
    onerror: ((event: { error: string }) => void) | null = null;
    constructor(public text: string) {}
  }

  function stubVoices(voices: { lang: string; voiceURI: string }[]) {
    const synth = {
      getVoices: () => voices,
      speak: vi.fn(),
      cancel: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("speechSynthesis", synth);
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    return synth;
  }

  const listenButtons = () => screen.getAllByRole("button", { name: "듣기" });

  it("첫 마디·교정 문장·AI 말풍선 아래에 [듣기]를 두고 그 문장을 읽는다", async () => {
    const synth = stubVoices([{ lang: "en-US", voiceURI: "en" }]);
    const { user } = setup(room({ turns: [turn(1, { correction: { corrected: "I'd like a latte.", explanation_ko: "정중해요" } })] }));

    expect(listenButtons()).toHaveLength(3);
    // 교정 카드는 고친 문장 → 재생 버튼 → 설명 순서다
    expect(isBefore(screen.getByText("I'd like a latte."), listenButtons()[1])).toBe(true);
    expect(isBefore(listenButtons()[1], screen.getByText("정중해요"))).toBe(true);
    const texts: string[] = [];
    for (const button of listenButtons()) {
      await user.click(button);
      texts.push((synth.speak.mock.calls.at(-1)?.[0] as FakeUtterance).text);
    }
    expect(texts).toEqual([SCENARIO.opening.text, "I'd like a latte.", "reply 1"]);
  });

  it("레벨 3의 말풍선(번역 버튼) 밖에 [듣기]를 둔다", () => {
    stubVoices([{ lang: "en-US", voiceURI: "en" }]);
    setup(room({ level: 3 }));

    const bubble = screen.getByRole("button", { name: /Hi! What can I get for you\?/ });
    expect(bubble).not.toContainElement(listenButtons()[0]);
  });

  it("일본어는 후리가나 표기를 지우고 읽는다", async () => {
    const synth = stubVoices([{ lang: "ja-JP", voiceURI: "ja" }]);
    const { user } = setup(room({ language: "ja", turns: [turn(1, { reply: "[今日|きょう]は[暑|あつ]いですね。" })] }));

    await user.click(listenButtons()[1]);

    expect((synth.speak.mock.calls.at(-1)?.[0] as FakeUtterance).text).toBe("今日は暑いですね。");
  });

  it("학습 언어 음성이 없는 기기에서는 [듣기]가 없다", () => {
    stubVoices([{ lang: "ko-KR", voiceURI: "ko" }]);
    setup(room({ turns: [turn(1)] }));

    expect(screen.queryByRole("button", { name: "듣기" })).toBeNull();
  });

  it("낭독기에는 새 턴의 교정·AI 응답 문장만 알리고 재생 버튼 이름은 알리지 않는다", async () => {
    stubVoices([{ lang: "en-US", voiceURI: "en" }]);
    apiMock.mockResolvedValue(replied(2, 18, { correction: { corrected: "Fixed.", explanation_ko: "설명" } }));
    const { user } = setup(room({ turns: [turn(1)] }));
    const region = () => document.querySelector("[aria-live]");

    // 처음 연 화면의 지난 턴은 알리지 않는다
    expect(region()).toHaveTextContent(/^$/);

    await typeAndSend(user, "hello");

    expect(region()).toHaveTextContent("이렇게 말하면 더 자연스러워요 Fixed. 설명 AI 2");
    expect(region()).not.toHaveTextContent("듣기");
    for (const button of listenButtons()) expect(button.closest("[aria-live]")).toBeNull();
  });

  it("다시 읽은 room의 새 턴도 알리고, 후리가나 표기는 지우고 학습 언어 lang을 단다", () => {
    stubVoices([{ lang: "ja-JP", voiceURI: "ja" }]);
    const { rerender } = setup(room({ language: "ja", level: 1, turns: [turn(1)] }));

    rerender(room({ language: "ja", level: 1, turns: [turn(1), turn(2, { reply: "[今日|きょう]は[暑|あつ]いですね。", replyKo: "오늘 덥네요." })] }));

    const region = document.querySelector("[aria-live]");
    expect(region).toHaveTextContent("今日は暑いですね。 오늘 덥네요.");
    expect(within(region as HTMLElement).getByText("今日は暑いですね。")).toHaveAttribute("lang", "ja");
  });
});

describe("ChatRoom 한글 발음", () => {
  const JA_SCENARIO = { title: "인사", opening: { text: "はじめまして！", ko: "처음 뵙겠습니다!", pronKo: "하지메마시테!" } };
  const pronTurn = turn(1, {
    reply: "[今日|きょう]は[暑|あつ]いですね。",
    replyKo: "오늘 덥네요.",
    replyPronKo: "쿄-와 아츠이데스네.",
    correction: { corrected: "[暑|あつ]いです。", explanation_ko: "설명", corrected_pron_ko: "아츠이데스." },
  });
  const jaRoom = (level: Level, turns: ChatTurnView[] = [pronTurn]) => room({ language: "ja", level, turns });

  it("입문·초보는 첫 마디·AI 말풍선의 문장 아래, 번역 위에 발음을 늘 보여 준다", () => {
    setup(jaRoom(1), { kind: "available" }, JA_SCENARIO);

    const opening = screen.getByText("하지메마시테!", ON_SCREEN);
    expect(opening.previousElementSibling).toHaveAttribute("lang", "ja");
    expect(isBefore(opening, screen.getByText("처음 뵙겠습니다!", ON_SCREEN))).toBe(true);
    const reply = screen.getByText("쿄-와 아츠이데스네.", ON_SCREEN);
    expect(isBefore(reply, screen.getByText("오늘 덥네요.", ON_SCREEN))).toBe(true);
  });

  it("교정 카드는 고친 문장 바로 아래에 발음을 둔다", () => {
    setup(jaRoom(2), { kind: "available" }, JA_SCENARIO);

    const pron = screen.getByText("아츠이데스.", ON_SCREEN);
    expect(pron.previousElementSibling).toHaveAttribute("lang", "ja");
    expect(pron.previousElementSibling).toHaveTextContent("いです。");
  });

  it("중급은 말풍선을 펼쳐야 발음이 번역과 함께 보인다 (교정 카드는 늘 펼쳐 둔다)", async () => {
    const { user } = setup(jaRoom(3), { kind: "available" }, JA_SCENARIO);

    expect(screen.queryByText("하지메마시테!")).toBeNull();
    expect(screen.queryByText("쿄-와 아츠이데스네.")).toBeNull();
    expect(screen.getByText("아츠이데스.")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "번역" })[1]);

    expect(screen.getByText("쿄-와 아츠이데스네.")).toBeInTheDocument();
    expect(screen.getByText("오늘 덥네요.")).toBeInTheDocument();
  });

  it("상급과 영어 방은 첫 마디 pronKo나 저장된 발음이 있어도 그리지 않는다", async () => {
    const { user, rerender } = setup(jaRoom(4), { kind: "available" }, JA_SCENARIO);

    expect(screen.queryByText("아츠이데스.")).toBeNull();
    for (const toggle of screen.getAllByRole("button", { name: "번역" })) await user.click(toggle);
    expect(screen.queryByText("하지메마시테!")).toBeNull();
    expect(screen.queryByText("쿄-와 아츠이데스네.")).toBeNull();

    rerender(room({ language: "en", level: 1, turns: [pronTurn] }));
    expect(screen.queryByText("하지메마시테!")).toBeNull();
    expect(screen.queryByText("쿄-와 아츠이데스네.")).toBeNull();
    expect(screen.queryByText("아츠이데스.")).toBeNull();
  });

  it("발음이 없는 턴(기능 전 턴, 검사에 맞지 않아 숨긴 발음)은 발음 줄 없이 그린다", () => {
    const old = turn(1, { reply: "はい。", replyKo: "네.", replyPronKo: null, correction: { corrected: "はい。", explanation_ko: "설명" } });
    const { container } = setup(jaRoom(1, [old]), { kind: "available" }, { title: "인사", opening: { text: "はい。", ko: "네." } });

    const hiddenTexts = [...container.querySelectorAll("[aria-hidden='true']")].map((el) => el.textContent).filter(Boolean);
    expect(hiddenTexts).toEqual([]);
  });

  it("발음은 낭독기에서 숨기고 새 턴 알림에도 넣지 않는다", async () => {
    apiMock.mockResolvedValue(replied(2, 18, { reply: "はい。", reply_ko: "네.", reply_pron_ko: "하이." }));
    const { user } = setup(jaRoom(1), { kind: "available" }, JA_SCENARIO);

    expect(screen.getByText("쿄-와 아츠이데스네.", ON_SCREEN)).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("아츠이데스.", ON_SCREEN)).toHaveAttribute("aria-hidden", "true");

    await typeAndSend(user, "はい");

    expect(screen.getByText("하이.", ON_SCREEN)).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelector("[aria-live]")).toHaveTextContent("はい。");
    expect(document.querySelector("[aria-live]")).not.toHaveTextContent("하이.");
  });
});

describe("ChatRoom 대화 안내", () => {
  const JA = { title: "편의점", opening: { text: "いらっしゃいませ。", ko: "어서 오세요." } };

  it.each([
    ["en", 1],
    ["ja", 2],
  ] as const)("%s 레벨 %i은 첫 마디 위에 한국어 입력 안내 한 줄만 둔다", (language, level) => {
    setup(room({ language, level }), { kind: "available" }, language === "ja" ? JA : SCENARIO);

    const opening = language === "ja" ? JA.opening.text : SCENARIO.opening.text;
    expect(isBefore(screen.getByText("한국어로 말해도 괜찮아요"), screen.getByText(opening))).toBe(true);
    expect(screen.queryByText("누르면 번역이 나와요")).toBeNull();
  });

  it.each([
    ["en", 3],
    ["ja", 4],
    ["en", 5],
  ] as const)("%s 레벨 %i은 번역 보기 안내까지 두 줄을 둔다", (language, level) => {
    setup(room({ language, level }), { kind: "available" }, language === "ja" ? JA : SCENARIO);

    const korean = screen.getByText("한국어로 말해도 괜찮아요");
    const translation = screen.getByText("누르면 번역이 나와요");
    const opening = screen.getByText(language === "ja" ? JA.opening.text : SCENARIO.opening.text);
    expect(isBefore(korean, translation)).toBe(true);
    expect(isBefore(translation, opening)).toBe(true);
  });
});

describe("ChatRoom 문장 뜯어보기", () => {
  const WITH_OPENING = {
    ...SCENARIO,
    opening: {
      ...SCENARIO.opening,
      breakdown: [
        { text: "Hi! ", meaning_ko: "인사" },
        { text: "What can I get ", meaning_ko: "무엇을 드릴까요" },
        { text: "for you?", meaning_ko: "당신에게" },
      ],
    },
  };
  const REPLY_PIECES = [
    { text: "Sure, ", meaning_ko: "물론이죠" },
    { text: "one latte.", meaning_ko: "라떼 하나" },
  ];
  const CORRECTION = {
    corrected: "A latte, please.",
    explanation_ko: "부탁할 때 please를 붙여요",
    breakdown: [
      { text: "A latte, ", meaning_ko: "라떼 한 잔" },
      { text: "please.", meaning_ko: "주세요" },
    ],
  };
  const pieceTurn = turn(1, { reply: "Sure, one latte.", replyBreakdown: REPLY_PIECES, correction: CORRECTION });
  const toggles = () => screen.getAllByRole("button", { name: "문장 뜯어보기" });

  it("첫 마디·저장된 턴의 말풍선과 교정 카드는 처음 닫혀 있고 눌러 열고 닫는다", async () => {
    const { user } = setup(room({ level: 1, turns: [pieceTurn] }), { kind: "available" }, WITH_OPENING);

    expect(toggles()).toHaveLength(3);
    // 첫 마디 → 교정 카드 → AI 말풍선 순서다
    for (const [i, meaning] of ["인사", "주세요", "물론이죠"].entries()) {
      expect(toggles()[i]).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText(meaning)).toBeNull();

      await user.click(toggles()[i]);
      expect(toggles()[i]).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText(meaning)).toBeInTheDocument();

      await user.click(toggles()[i]);
      expect(toggles()[i]).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText(meaning)).toBeNull();
    }
  });

  it("이 화면에서 받은 턴도 열 수 있고, 새 턴 알림에는 조각 뜻을 넣지 않는다", async () => {
    apiMock.mockResolvedValue(
      replied(1, 19, { reply: "Sure, one latte.", reply_ko: "네, 라떼 한 잔이요.", reply_breakdown: REPLY_PIECES, correction: CORRECTION }),
    );
    const { user } = setup(room({ level: 1 }));

    await typeAndSend(user, "latte please");

    expect(toggles()).toHaveLength(2);
    for (const toggle of toggles()) {
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      await user.click(toggle);
    }
    expect(screen.getByText("물론이죠")).toBeInTheDocument();
    expect(screen.getByText("주세요")).toBeInTheDocument();
    const region = document.querySelector("[aria-live]");
    expect(region).toHaveTextContent("Sure, one latte.");
    for (const text of ["물론이죠", "라떼 하나", "주세요", "문장 뜯어보기"]) expect(region).not.toHaveTextContent(text);
  });

  it("입문·초보는 타일을 말풍선 안 번역 아래에 조각(학습 언어)·뜻 순서로 문장 순서대로 둔다", async () => {
    const { user } = setup(room({ level: 2, turns: [pieceTurn] }));

    await user.click(toggles().at(-1) as HTMLElement);

    const first = screen.getByText("물론이죠");
    const second = screen.getByText("라떼 하나");
    expect(isBefore(screen.getByText("번역 1"), first)).toBe(true);
    expect(isBefore(first, second)).toBe(true);
    const piece = screen.getByText("Sure,");
    expect(piece).toHaveAttribute("lang", "en");
    expect(isBefore(piece, first)).toBe(true);
  });

  it("중급 이상은 타일을 눌러도 번역이 바뀌지 않고, 문장이나 [번역]을 누르면 번역이 열린다", async () => {
    const { user } = setup(room({ level: 3, turns: [pieceTurn] }));
    const bubble = screen.getByRole("button", { name: "Sure, one latte." });

    await user.click(toggles().at(-1) as HTMLElement);

    const tile = screen.getByText("물론이죠");
    expect(tile.closest("button")).toBeNull();
    await user.click(tile);
    expect(screen.queryByText("번역 1")).toBeNull();
    expect(bubble).toHaveAttribute("aria-expanded", "false");

    await user.click(bubble);
    expect(screen.getByText("번역 1")).toBeInTheDocument();
    expect(isBefore(screen.getByText("번역 1"), screen.getByText("물론이죠"))).toBe(true);
    await user.click(screen.getByText("물론이죠"));
    expect(screen.getByText("번역 1")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "번역" })[1]);
    expect(screen.queryByText("번역 1")).toBeNull();
    expect(screen.getByText("물론이죠")).toBeInTheDocument();
  });

  it("일본어 타일은 조각에 후리가나를 달고 한글 발음은 넣지 않는다", async () => {
    const jaTurn = turn(1, {
      reply: "[今日|きょう]は[暑|あつ]いですね。",
      replyKo: "오늘 덥네요.",
      replyPronKo: "쿄-와 아츠이데스네.",
      replyBreakdown: [
        { text: "[今日|きょう]は", meaning_ko: "오늘은" },
        { text: "[暑|あつ]いですね。", meaning_ko: "덥네요" },
      ],
    });
    const { user } = setup(room({ language: "ja", level: 1, turns: [jaTurn] }), { kind: "available" }, { title: "인사", opening: { text: "はい。", ko: "네." } });

    await user.click(toggles()[0]);

    const tile = screen.getByText("오늘은").parentElement as HTMLElement;
    expect(tile.querySelector("[lang='ja'] rt")).toHaveTextContent("きょう");
    expect(tile).not.toHaveTextContent("쿄");
    expect(isBefore(screen.getByText("오늘은"), screen.getByText("덥네요"))).toBe(true);
  });

  it("첫 마디는 값이 없으면 토글을 두지 않고, 값이 있어도 API를 부르지 않는다", async () => {
    const { unmount } = render(<ChatRoom room={room({ level: 1 })} scenario={SCENARIO} trial={{ kind: "available" }} />);
    expect(screen.queryByRole("button", { name: "문장 뜯어보기" })).toBeNull();
    unmount();

    const { user } = setup(room({ level: 1 }), { kind: "available" }, WITH_OPENING);
    await user.click(toggles()[0]);
    expect(screen.getByText("인사")).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("저장된 값이 있으면 열고 닫아도 API를 부르지 않는다", async () => {
    const { user } = setup(room({ level: 1, turns: [pieceTurn] }));

    for (const toggle of toggles()) {
      await user.click(toggle);
      await user.click(toggle);
      await user.click(toggle);
    }
    expect(screen.getByText("주세요")).toBeInTheDocument();
    expect(screen.getByText("물론이죠")).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  describe("저장본이 없는 문장은 처음 열 때 만든다", () => {
    const BREAKDOWN_PATH = "/api/chat/sessions/s-1/breakdown";
    const UNAVAILABLE_BREAKDOWN = "뜯어보기를 만들지 못했어요. 다시 눌러 주세요.";
    const FAILURE_LIMIT = "오늘은 응답 오류가 많아 문장 뜯어보기를 잠시 쉬어요. 내일 다시 시도해 주세요.";
    const bare = (turnNo: number) => turn(turnNo, { correction: { corrected: CORRECTION.corrected, explanation_ko: CORRECTION.explanation_ko } });
    const fetched = (pieces = REPLY_PIECES) =>
      ({ ok: true, status: 200, data: { breakdown: pieces } }) satisfies ApiResult<ChatBreakdownResponse>;
    const waiting = () => screen.queryByText("뜯어보기를 만드는 중");
    const retryButton = () => screen.queryByRole("button", { name: "다시 시도" });

    function expectInputOpen() {
      expect(textbox()).toBeEnabled();
      expect(refresh).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
    }

    it("턴 말풍선·교정 카드는 값이 없어도(null·빈 배열·키 없음) 토글을 두고 처음에는 닫혀 있다", () => {
      setup(
        room({
          level: 1,
          turns: [
            turn(1, { replyBreakdown: null, correction: { corrected: "Fixed.", explanation_ko: "설명" } }),
            turn(2, { replyBreakdown: [], correction: { corrected: "Fixed again.", explanation_ko: "설명 2", breakdown: [] } }),
            turn(3),
          ],
        }),
      );

      // 교정 2개 + 말풍선 3개. 첫 마디는 값이 없어 토글이 없다
      expect(toggles()).toHaveLength(5);
      for (const toggle of toggles()) expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(apiMock).not.toHaveBeenCalled();
    });

    it("처음 누르면 그 턴의 turn_no·reply로 API를 부르고, 기다리는 동안 점 3개와 disabled 토글을 둔 뒤 받으면 펼친다", async () => {
      const d = deferred<ApiResult<ChatBreakdownResponse>>();
      apiMock.mockReturnValueOnce(d.promise);
      const { user } = setup(room({ level: 1, turns: [turn(1), turn(2, { reply: "Sure, one latte." })] }));

      await user.click(toggles()[1]);

      expect(apiMock).toHaveBeenCalledWith("POST", BREAKDOWN_PATH, { turn_no: 2, target: "reply" });
      expect(toggles()[1]).toHaveAttribute("aria-expanded", "true");
      expect(toggles()[1]).toBeDisabled();
      expect(toggles()[0]).toBeEnabled();
      expect(waiting()?.closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
      // 점은 말풍선 안 번역 아래, 타일 자리에 둔다
      expect(isBefore(screen.getByText("번역 2"), waiting() as HTMLElement)).toBe(true);
      expectInputOpen();

      await act(async () => d.resolve(fetched()));

      expect(waiting()).toBeNull();
      expect(toggles()[1]).toBeEnabled();
      expect(toggles()[1]).toHaveAttribute("aria-expanded", "true");
      expect(isBefore(screen.getByText("번역 2"), screen.getByText("물론이죠"))).toBe(true);
      expect(screen.getByText("라떼 하나")).toBeInTheDocument();
    });

    it("교정 카드는 target corrected로 부르고 토글 바로 아래·설명 위에 펼친다", async () => {
      apiMock.mockResolvedValueOnce(fetched(CORRECTION.breakdown));
      const { user } = setup(room({ level: 1, turns: [bare(3)] }));

      await user.click(toggles()[0]);

      expect(apiMock).toHaveBeenCalledWith("POST", BREAKDOWN_PATH, { turn_no: 3, target: "corrected" });
      const meaning = screen.getByText("주세요");
      expect(isBefore(toggles()[0], meaning)).toBe(true);
      expect(isBefore(meaning, screen.getByText(CORRECTION.explanation_ko))).toBe(true);
    });

    it("받은 뒤 닫았다 다시 열면 API를 다시 부르지 않는다", async () => {
      apiMock.mockResolvedValueOnce(fetched());
      const { user } = setup(room({ level: 1, turns: [turn(1)] }));

      await user.click(toggles()[0]);
      expect(screen.getByText("물론이죠")).toBeInTheDocument();
      await user.click(toggles()[0]);
      expect(screen.queryByText("물론이죠")).toBeNull();
      await user.click(toggles()[0]);

      expect(screen.getByText("물론이죠")).toBeInTheDocument();
      expect(apiMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["503", failure(503, "AI_UNAVAILABLE", UNAVAILABLE_BREAKDOWN)],
      ["만드는 중 409", failure(409, "CONFLICT", "뜯어보기를 만드는 중이에요. 잠시 뒤 다시 눌러 주세요.")],
      ["404", failure(404, "NOT_FOUND", "찾을 수 없어요.")],
      ["네트워크", failure(null, "NETWORK", "연결이 끊겼어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.")],
      ["500", failure(500, "INTERNAL", "잠시 문제가 생겼어요.")],
    ])("%s 실패면 타일 자리에 서버 문구와 [다시 시도]를 두고, 누르면 다시 부른다", async (_, result) => {
      apiMock.mockResolvedValueOnce(result).mockResolvedValueOnce(fetched());
      const { user } = setup(room({ level: 1, turns: [turn(1)] }));

      await user.click(toggles()[0]);

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(result.ok ? "" : result.message);
      expect(isBefore(screen.getByText("번역 1"), alert)).toBe(true);
      expect(toggles()[0]).toBeEnabled();
      expectInputOpen();

      await user.click(retryButton() as HTMLElement);

      expect(apiMock).toHaveBeenCalledTimes(2);
      expect(apiMock).toHaveBeenLastCalledWith("POST", BREAKDOWN_PATH, { turn_no: 1, target: "reply" });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("물론이죠")).toBeInTheDocument();
      expectInputOpen();
    });

    it("실패한 뒤 토글을 닫으면 오류를 지우고, 다시 열면 다시 부른다", async () => {
      apiMock
        .mockResolvedValueOnce(failure(409, "CONFLICT", "뜯어보기를 만드는 중이에요. 잠시 뒤 다시 눌러 주세요."))
        .mockResolvedValueOnce(fetched());
      const { user } = setup(room({ level: 1, turns: [turn(1)] }));

      await user.click(toggles()[0]);
      expect(screen.getByRole("alert")).toBeInTheDocument();

      await user.click(toggles()[0]);
      expect(toggles()[0]).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(retryButton()).toBeNull();

      await user.click(toggles()[0]);
      expect(apiMock).toHaveBeenCalledTimes(2);
      expect(screen.getByText("물론이죠")).toBeInTheDocument();
    });

    it("AI_FAILURE_LIMIT이면 서버 문구만 보여 주고 버튼이 없으며, 대화 입력은 막지 않는다", async () => {
      apiMock.mockResolvedValueOnce(failure(429, "AI_FAILURE_LIMIT", FAILURE_LIMIT));
      const { user } = setup(room({ level: 1, turns: [turn(1)] }));

      await user.click(toggles()[0]);

      expect(screen.getByText(FAILURE_LIMIT)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(retryButton()).toBeNull();
      expectInputOpen();
      await user.type(textbox(), "hello");
      expect(sendButton()).toBeEnabled();
    });

    it("기다리는 중에 메시지를 보내고 대화방을 다시 읽어도 진행 중인 상태와 받은 값을 잃지 않는다", async () => {
      const d = deferred<ApiResult<ChatBreakdownResponse>>();
      apiMock.mockImplementation((_method, path) =>
        path === BREAKDOWN_PATH ? d.promise : Promise.resolve(replied(2, 18)),
      );
      const { user, rerender } = setup(room({ level: 1, turns: [turn(1)] }));

      await user.click(toggles()[0]);
      await typeAndSend(user, "one latte");
      expect(screen.getByText("AI 2", ON_SCREEN)).toBeInTheDocument();
      rerender(room({ level: 1, turns: [turn(1), turn(2, { reply: "AI 2" })] }));

      expect(toggles()[0]).toBeDisabled();
      expect(waiting()).toBeInTheDocument();
      await act(async () => d.resolve(fetched()));
      expect(screen.getByText("물론이죠")).toBeInTheDocument();

      rerender(room({ level: 1, turns: [turn(1), turn(2, { reply: "AI 2" })] }));
      expect(screen.getByText("물론이죠")).toBeInTheDocument();
      expect(apiMock.mock.calls.filter(([, path]) => path === BREAKDOWN_PATH)).toHaveLength(1);
    });
  });

  it("교정 카드는 고친 문장 아래에서 열고 설명 위에 타일을 펼친다", async () => {
    const { user } = setup(room({ level: 1, turns: [pieceTurn] }));

    const toggle = toggles()[0];
    expect(isBefore(screen.getByText("A latte, please."), toggle)).toBe(true);
    await user.click(toggle);

    const meaning = screen.getByText("주세요");
    expect(isBefore(toggle, meaning)).toBe(true);
    expect(isBefore(meaning, screen.getByText(CORRECTION.explanation_ko))).toBe(true);
  });
});

describe("ChatRoom 배운 단어", () => {
  const target = (id: string, word: string, meaningKo: string, used = false, reading: string | null = null): TargetWord => ({
    id,
    word,
    reading,
    meaningKo,
    used,
  });
  const SUKOSHI = target("ja-1-005", "少し", "조금", false, "すこし");
  const ISSHONI = target("ja-1-006", "一緒に", "함께", false, "いっしょに");
  const TOTEMO = target("ja-1-004", "とても", "아주", false, "とても");
  const used = (w: TargetWord): TargetWord => ({ ...w, used: true });
  const jaRoom = (overrides: Partial<ChatRoomData> = {}) => room({ language: "ja", level: 1, ...overrides });
  const wordsLine = (name = "오늘 단어") => screen.getByRole("list", { name });
  const region = () => document.querySelector("[aria-live]") as HTMLElement;

  function repliedWith(
    turnNo: number,
    targetWords: TargetWord[] | null,
    targetSource: TargetSource | null = "today",
    overrides: Partial<ChatMessageResponse["reply"]> = {},
  ) {
    const result = replied(turnNo, 20 - turnNo, overrides);
    return { ...result, data: { ...result.data, targetWords, targetSource } } satisfies ApiResult<ChatMessageResponse>;
  }

  it("목표 단어가 없으면(null·빈 배열) 줄이 없다", () => {
    const { rerender } = setup(jaRoom({ turns: [turn(1)] }));
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText(/단어 \d+\/\d+/)).toBeNull();

    rerender(jaRoom({ turns: [turn(1)], targetWords: [], targetSource: "today" }));
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText(/단어 \d+\/\d+/)).toBeNull();
  });

  it("줄은 sticky 상단의 제목 줄 아래에 한 줄로 두고, 라벨은 출처 이름과 쓴 수/전체다", () => {
    const { container } = setup(
      jaRoom({ turns: [turn(1)], targetWords: [used(ISSHONI), SUKOSHI, TOTEMO], targetSource: "today" }),
    );

    const list = wordsLine();
    expect(container.querySelector("header")).toContainElement(list);
    expect(isBefore(endButton(), list)).toBe(true);
    expect(screen.getByText("오늘 단어 1/3")).toBeInTheDocument();
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    // 키보드가 열린 화면에서 상단이 높아지지 않게 감싸지 않고 가로로 밀어 본다
    expect(list).toHaveClass("overflow-x-auto");
    expect(list).not.toHaveClass("flex-wrap");
    // 칩 안의 sr-only(절대 위치)가 목록에 잘리게 기준점을 둔다. 없으면 390px에서 페이지가 435px로 넓어졌다(2026-10-20)
    expect(list).toHaveClass("relative");
  });

  it("출처가 recent면 최근 단어다", () => {
    setup(jaRoom({ turns: [turn(1)], targetWords: [SUKOSHI, TOTEMO], targetSource: "recent" }));

    expect(screen.getByText("최근 단어 0/2")).toBeInTheDocument();
    expect(wordsLine("최근 단어")).toBeInTheDocument();
  });

  it("칩은 단어(학습 언어 lang)와 뜻이고 버튼이 아니며, 쓴 칩만 Check와 썼음을 단다", () => {
    setup(jaRoom({ turns: [turn(1)], targetWords: [used(ISSHONI), SUKOSHI], targetSource: "today" }));

    const [usedChip, notYetChip] = within(wordsLine()).getAllByRole("listitem");
    expect(within(wordsLine()).queryByRole("button")).toBeNull();
    expect(usedChip).toHaveTextContent("썼음");
    expect(usedChip.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(within(usedChip).getByText("함께")).toBeInTheDocument();
    expect(notYetChip).not.toHaveTextContent("썼음");
    expect(notYetChip.querySelector("svg")).toBeNull();
    expect(within(notYetChip).getByText("少し", { selector: "ruby span" }).closest("[lang]")).toHaveAttribute("lang", "ja");
  });

  it("일본어 칩은 읽기가 단어와 다를 때만 루비를 단다", () => {
    setup(jaRoom({ turns: [turn(1)], targetWords: [SUKOSHI, TOTEMO], targetSource: "today" }));

    const [sukoshi, totemo] = within(wordsLine()).getAllByRole("listitem");
    expect(sukoshi.querySelector("rt")).toHaveTextContent("すこし");
    expect(totemo.querySelector("rt")).toBeNull();
  });

  it("영어 칩은 루비 없이 단어에 en을 단다", () => {
    setup(room({ turns: [turn(1)], targetWords: [target("en-3-001", "decide", "결정하다")], targetSource: "today" }));

    expect(within(wordsLine()).getByText("decide")).toHaveAttribute("lang", "en");
    expect(wordsLine().querySelector("ruby")).toBeNull();
  });

  it("첫 턴의 메시지 응답으로 줄이 생기고 다음 응답으로 갱신되며, 다시 읽은 room을 기다리지 않는다", async () => {
    apiMock
      .mockResolvedValueOnce(repliedWith(1, [SUKOSHI, ISSHONI]))
      .mockResolvedValueOnce(repliedWith(2, [used(SUKOSHI), ISSHONI]));
    const { user } = setup(jaRoom());
    expect(screen.queryByRole("list")).toBeNull();

    await typeAndSend(user, "コーヒーをください");
    expect(screen.getByText("오늘 단어 0/2")).toBeInTheDocument();
    expect(region()).not.toHaveTextContent("단어를 썼어요");

    await typeAndSend(user, "少しください");
    expect(screen.getByText("오늘 단어 1/2")).toBeInTheDocument();
    expect(region()).toHaveTextContent("단어를 썼어요: 少し");
    // 턴마다 다시 읽기를 부르지만(뒤로 가기 대비), 줄은 다시 읽은 room(rerender) 없이 응답만으로 갱신됐다
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("다시 읽은 room이 응답받은 턴까지 따라오면 room의 값을 쓴다", async () => {
    apiMock.mockResolvedValueOnce(repliedWith(1, [SUKOSHI, ISSHONI]));
    const { user, rerender } = setup(jaRoom());
    await typeAndSend(user, "コーヒーをください");

    // 응답받은 턴이 아직 없는 room은 응답의 값을 덮지 않는다
    rerender(jaRoom());
    expect(screen.getByText("오늘 단어 0/2")).toBeInTheDocument();

    rerender(jaRoom({ turns: [turn(1), turn(2)], targetWords: [used(SUKOSHI), used(ISSHONI)], targetSource: "today" }));
    expect(screen.getByText("오늘 단어 2/2")).toBeInTheDocument();
  });

  it("새로 쓴 단어만 알림 영역의 교정 다음·AI 응답 앞에 학습 언어 lang으로 알린다", async () => {
    const correction = { corrected: "[少|すこ]しと[一緒|いっしょ]に。", explanation_ko: "설명" };
    apiMock
      .mockResolvedValueOnce(repliedWith(2, [used(TOTEMO), used(SUKOSHI), used(ISSHONI)], "today", { correction }))
      .mockResolvedValueOnce(repliedWith(3, [used(TOTEMO), used(SUKOSHI), used(ISSHONI)]));
    const { user } = setup(
      jaRoom({ turns: [turn(1)], targetWords: [used(TOTEMO), SUKOSHI, ISSHONI], targetSource: "today" }),
    );
    // 화면을 열 때 이미 있던 턴은 알리지 않는다
    expect(region()).toHaveTextContent(/^$/);

    await typeAndSend(user, "少し一緒に");

    expect(region()).toHaveTextContent("이렇게 말하면 더 자연스러워요 少しと一緒に。 설명 단어를 썼어요: 少し, 一緒に AI 2");
    expect(within(region()).getByText("少し, 一緒に")).toHaveAttribute("lang", "ja");

    await typeAndSend(user, "はい");
    expect(region()).toHaveTextContent("AI 3");
    expect(region()).not.toHaveTextContent("단어를 썼어요");
  });

  it("종료 피드백에 지금 보이는 목표 단어 상태를 넘긴다", async () => {
    apiMock.mockResolvedValueOnce(repliedWith(1, [used(SUKOSHI), ISSHONI])).mockResolvedValueOnce(endedReady);
    const { user } = setup(jaRoom());
    await typeAndSend(user, "少しください");

    await user.click(endButton());

    expect(screen.getByRole("heading", { name: "오늘 단어 2개 중 1개를 썼어요" })).toBeInTheDocument();
  });
});
