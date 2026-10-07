import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrialState } from "@/lib/plan";
import type { ChatRoomData, ChatTurnView } from "@/server/db/reads";
import { api, type ApiResult } from "@/services/apiClient";
import type { ChatEndResponse, ChatMessageResponse } from "@/types/api";
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
    data: { turnNo, turnsLeft, reply: { reply: `AI ${turnNo}`, reply_ko: `AI 번역 ${turnNo}`, correction: null, ...overrides } },
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
    expect(screen.queryByRole("button", { expanded: false })).toBeNull();
  });

  it("레벨 3은 말풍선을 눌러 번역을 펼친다", async () => {
    const { user } = setup(room({ level: 3, turns: [turn(1)] }));

    expect(screen.queryByText(SCENARIO.opening.ko)).toBeNull();
    expect(screen.queryByText("번역 1")).toBeNull();
    const toggles = screen.getAllByRole("button", { expanded: false });
    expect(toggles).toHaveLength(2);

    await user.click(toggles[1]);

    expect(screen.getByText("번역 1")).toBeInTheDocument();
    expect(toggles[1]).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText(SCENARIO.opening.ko)).toBeNull();
  });

  it("일본어 레벨 3은 후리가나 ruby를 그리고 레벨 4는 그리지 않는다", () => {
    const ja = { title: "편의점", opening: { text: "お[弁当|べんとう]、[温|あたた]めますか？", ko: "도시락 데워 드릴까요?" } };
    const { container } = setup(room({ language: "ja", level: 3 }), { kind: "available" }, ja);
    expect(container.querySelector("ruby")).not.toBeNull();
    expect(container.querySelector("rt")).toHaveTextContent("べんとう");
  });

  it("교정 설명의 후리가나 표기도 말풍선과 같은 규칙으로 그린다", () => {
    const ja = { title: "인사", opening: { text: "はじめまして！", ko: "처음 뵙겠습니다!" } };
    const correction = { corrected: "[来|き]ました。", explanation_ko: "'왔어요'는 '[来|き]ました'예요" };
    const shown = setup(room({ language: "ja", level: 1, turns: [turn(1, { correction })] }), { kind: "available" }, ja);

    expect(shown.container.textContent).not.toContain("[来|き]");
    expect(shown.container.querySelectorAll("rt")).toHaveLength(2);

    shown.rerender(room({ language: "ja", level: 4, turns: [turn(1, { correction })] }));
    expect(screen.getByText("'왔어요'는 '来ました'예요")).toBeInTheDocument();
  });

  it("일본어 레벨 4는 후리가나 없이 본문만 그린다", () => {
    const ja = { title: "편의점", opening: { text: "お[弁当|べんとう]、[温|あたた]めますか？", ko: "도시락 데워 드릴까요?" } };
    const { container } = setup(room({ language: "ja", level: 4 }), { kind: "available" }, ja);

    expect(container.querySelector("ruby")).toBeNull();
    expect(screen.getByText("お弁当、温めますか？")).toBeInTheDocument();
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

  it("placeholder는 입문·초보면 한국어도 괜찮다고 알린다", () => {
    setup(room({ level: 2 }));
    expect(textbox()).toHaveAttribute("placeholder", "영어로 답해 보세요. 한국어도 괜찮아요");
  });

  it("placeholder는 중급 이상이면 학습 언어만 적는다", () => {
    const ja = { title: "편의점", opening: { text: "こんにちは", ko: "안녕하세요" } };
    setup(room({ language: "ja", level: 3 }), { kind: "available" }, ja);
    expect(textbox()).toHaveAttribute("placeholder", "일본어로 답해 보세요");
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

    expect(screen.getByText("AI 2")).toBeInTheDocument();
    expect(screen.getByText("Fixed.")).toBeInTheDocument();
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
    expect(screen.getByText("AI 1")).toBeInTheDocument();
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

    expect(screen.getByText("other reply")).toBeInTheDocument();
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

    expect(screen.getByText("AI 20")).toBeInTheDocument();
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

    expect(screen.getByText("AI 2")).toBeInTheDocument();
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
