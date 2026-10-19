import { act, render, screen, within } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TargetWord } from "@/lib/targetWords";
import type { ChatTurnView } from "@/server/db/reads";
import { api, type ApiResult } from "@/services/apiClient";
import type { ChatEndResponse } from "@/types/api";
import { ChatFeedback } from "./ChatFeedback";

vi.mock("@/services/apiClient", () => ({ api: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const apiMock = vi.mocked(api);
const push = vi.fn();
let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  apiMock.mockReset();
  push.mockReset();
  vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>);
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});

afterEach(() => {
  vi.useRealTimers();
});

function turn(turnNo: number, correction: ChatTurnView["correction"] = null): ChatTurnView {
  return { turnNo, userText: `내 문장 ${turnNo}`, reply: `reply ${turnNo}`, replyKo: `답 ${turnNo}`, replyPronKo: null, replyBreakdown: null, correction };
}

const THREE_TURNS = [turn(1), turn(2), turn(3)];
const FALLBACK_MESSAGE = "대화 기록은 저장됐어요. 종합 피드백을 만들지 못했으니 대화 아래의 교정을 확인해 주세요.";
const END_PATH = "/api/chat/sessions/s-1/end";

type Props = Parameters<typeof ChatFeedback>[0];

function renderFeedback(overrides: Partial<Props> = {}) {
  const props: Props = {
    sessionId: "s-1",
    scenarioTitle: "카페에서 주문하기",
    language: "en",
    turns: THREE_TURNS,
    doneTurnsToday: 3,
    result: { feedbackStatus: "ready", feedback: { good: "잘했어요", improve: ["관사를 챙겨요"] } },
    targetWords: null,
    targetSource: null,
    ...overrides,
  };
  return render(<ChatFeedback {...props} />);
}

const ending: ApiResult<ChatEndResponse> = { ok: true, status: 202, data: { status: "ending", retryAfterSeconds: 3 } };
const ended: ApiResult<ChatEndResponse> = {
  ok: true,
  status: 200,
  data: { status: "ended", feedbackStatus: "ready", feedback: { good: "자연스러웠어요", improve: [] } },
};

async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("ChatFeedback 공통", () => {
  it("집중 모드이고, [상황 목록]·머리·제목·버튼 2개를 둔다", () => {
    const { container } = renderFeedback();

    expect(container.querySelector("[data-focus-mode]")).not.toBeNull();
    expect(screen.getByRole("link", { name: "상황 목록" })).toHaveAttribute("href", "/chat");
    expect(screen.getByText("카페에서 주문하기 · 3턴")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "대화 피드백" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "다른 상황 고르기" })).toHaveAttribute("href", "/chat");
    expect(screen.getByRole("link", { name: "홈으로" })).toHaveAttribute("href", "/home");
  });
});

describe("ChatFeedback ready", () => {
  it("3턴 이상이면 목표 완료 안내와 잘한 점·고칠 점을 보여 준다", () => {
    renderFeedback();

    expect(screen.getByText("오늘 대화 목표를 채웠어요")).toBeInTheDocument();
    expect(screen.getByText("잘한 점")).toBeInTheDocument();
    expect(screen.getByText("잘했어요")).toBeInTheDocument();
    expect(screen.getByText("고칠 점")).toBeInTheDocument();
    expect(screen.getByText("관사를 챙겨요")).toBeInTheDocument();
  });

  it("3턴 미만이면 목표 안내를 하고, 고칠 점이 비면 그 카드를 생략한다", () => {
    renderFeedback({
      turns: [turn(1), turn(2)],
      doneTurnsToday: 2,
      result: { feedbackStatus: "ready", feedback: { good: "좋아요", improve: [] } },
    });

    expect(screen.getByText("3턴 이상 대화하면 오늘 목표가 채워져요")).toBeInTheDocument();
    expect(screen.queryByText("오늘 대화 목표를 채웠어요")).toBeNull();
    expect(screen.queryByText("고칠 점")).toBeNull();
  });

  it("세션의 턴이 3개여도 오늘 확정된 턴이 3개 미만이면 목표 안내를 한다 (홈과 같은 기준)", () => {
    renderFeedback({ turns: THREE_TURNS, doneTurnsToday: 2 });

    expect(screen.getByText("카페에서 주문하기 · 3턴")).toBeInTheDocument();
    expect(screen.getByText("3턴 이상 대화하면 오늘 목표가 채워져요")).toBeInTheDocument();
    expect(screen.queryByText("오늘 대화 목표를 채웠어요")).toBeNull();
  });

  it("고칠 점은 최대 3개만 보여 준다", () => {
    renderFeedback({
      result: { feedbackStatus: "ready", feedback: { good: "좋아요", improve: ["하나", "둘", "셋", "넷"] } },
    });

    expect(screen.getByText("셋")).toBeInTheDocument();
    expect(screen.queryByText("넷")).toBeNull();
  });

  it("일본어 피드백의 표기를 ruby로 그린다", () => {
    const { container } = renderFeedback({
      language: "ja",
      result: {
        feedbackStatus: "ready",
        feedback: { good: "[注文|ちゅうもん]을 잘 했어요", improve: ["[水|みず]をください가 더 자연스러워요"] },
      },
    });

    const rubies = [...container.querySelectorAll("ruby")];
    expect(rubies.map((r) => r.querySelector("rt")?.textContent)).toEqual(["ちゅうもん", "みず"]);
    expect(container.textContent).not.toMatch(/[[\]|]/);
  });

  it("깨진 표기는 기호를 지운 일반 텍스트로 그린다", () => {
    renderFeedback({
      language: "ja",
      result: { feedbackStatus: "ready", feedback: { good: "좋아요", improve: ["[水|みず をください"] } },
    });

    expect(screen.getByText("水みず をください")).toBeInTheDocument();
  });

  it("영어 피드백에는 ruby를 그리지 않는다", () => {
    const { container } = renderFeedback({
      result: { feedbackStatus: "ready", feedback: { good: "[注文|ちゅうもん]을 잘 했어요", improve: ["コーヒー"] } },
    });

    expect(container.querySelector("ruby")).toBeNull();
  });
});

describe("ChatFeedback fallback", () => {
  it("저장된 고정 문구와 교정이 있는 턴만 교정 목록으로 보여 준다", () => {
    const { container } = renderFeedback({
      language: "ja",
      turns: [
        turn(1, { corrected: "[水|みず]をください", explanation_ko: "물은 水예요" }),
        turn(2),
        turn(3, { corrected: "ありがとう", explanation_ko: "감사 표현이에요" }),
      ],
      result: { feedbackStatus: "fallback", feedback: { message: FALLBACK_MESSAGE } },
    });

    expect(screen.getByText(FALLBACK_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText("오늘 대화 목표를 채웠어요")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "교정" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("내 문장 1")).toBeInTheDocument();
    expect(within(list).queryByText("내 문장 2")).toBeNull();
    expect(within(list).getByText("물은 水예요")).toBeInTheDocument();
    const ruby = container.querySelector("ruby");
    expect(ruby).not.toBeNull();
    expect(ruby?.closest("[lang]")).toHaveAttribute("lang", "ja");
    expect(screen.queryByText("잘한 점")).toBeNull();
  });

  it("교정 목록의 설명도 후리가나 표기를 ruby로 그린다", () => {
    const { container } = renderFeedback({
      language: "ja",
      turns: [turn(1, { corrected: "[来|き]ました。", explanation_ko: "'왔어요'는 '[来|き]ました'예요" })],
      result: { feedbackStatus: "fallback", feedback: { message: FALLBACK_MESSAGE } },
    });

    expect(container.textContent).not.toContain("[来|き]");
    expect(container.querySelectorAll("rt")).toHaveLength(2);
  });

  it("교정이 하나도 없으면 교정할 문장이 없었다고 알린다", () => {
    renderFeedback({ result: { feedbackStatus: "fallback", feedback: { message: FALLBACK_MESSAGE } } });

    expect(screen.getByText("교정할 문장이 없었어요")).toBeInTheDocument();
  });
});

describe("ChatFeedback skipped", () => {
  it("피드백 카드와 안내 없이 버튼만 둔다", () => {
    renderFeedback({ turns: [], result: { feedbackStatus: "skipped", feedback: null } });

    expect(screen.getByText("카페에서 주문하기 · 0턴")).toBeInTheDocument();
    expect(screen.queryByText("잘한 점")).toBeNull();
    expect(screen.queryByText(/오늘 목표/)).toBeNull();
    expect(screen.queryByText(/대화 목표/)).toBeNull();
    expect(screen.getByRole("link", { name: "다른 상황 고르기" })).toBeInTheDocument();
  });
});

describe("ChatFeedback 배운 단어", () => {
  const target = (word: string, meaningKo: string, used: boolean, reading: string | null = null): TargetWord => ({
    id: `id-${word}`,
    word,
    reading,
    meaningKo,
    used,
  });
  const WORDS = [target("decide", "결정하다", true), target("borrow", "빌리다", false), target("menu", "메뉴", true)];
  const card = (name: string) => screen.getByRole("list", { name });

  function isBefore(a: HTMLElement, b: HTMLElement) {
    return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }

  it("ready면 목표 Notice 다음·잘한 점 앞에 결과 카드를 두고, 목표 단어 순서의 행마다 썼음/아직을 보여 준다", () => {
    renderFeedback({ targetWords: WORDS, targetSource: "today" });

    const heading = screen.getByRole("heading", { name: "오늘 단어 3개 중 2개를 썼어요" });
    expect(isBefore(screen.getByText("오늘 대화 목표를 채웠어요"), heading)).toBe(true);
    expect(isBefore(heading, screen.getByText("잘한 점"))).toBe(true);
    const rows = within(card("오늘 단어 3개 중 2개를 썼어요")).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual(["썼음decide결정하다", "아직borrow빌리다", "썼음menu메뉴"]);
    expect(within(rows[0]).getByText("decide")).toHaveAttribute("lang", "en");
    rows.forEach((row) => expect(row.querySelector("svg")).toHaveAttribute("aria-hidden", "true"));
  });

  it("fallback도 고정 안내 다음·교정 목록 앞에 두고, 출처가 recent면 최근 단어다", () => {
    renderFeedback({
      targetWords: WORDS,
      targetSource: "recent",
      turns: [turn(1, { corrected: "I'll decide.", explanation_ko: "미래형이에요" })],
      result: { feedbackStatus: "fallback", feedback: { message: FALLBACK_MESSAGE } },
    });

    const heading = screen.getByRole("heading", { name: "최근 단어 3개 중 2개를 썼어요" });
    expect(isBefore(screen.getByText(FALLBACK_MESSAGE), heading)).toBe(true);
    expect(isBefore(heading, screen.getByRole("list", { name: "교정" }))).toBe(true);
  });

  it("일본어 단어는 읽기가 단어와 다를 때만 ruby로 단다", () => {
    renderFeedback({
      language: "ja",
      targetWords: [target("少し", "조금", true, "すこし"), target("とても", "아주", false, "とても")],
      targetSource: "today",
    });

    const [sukoshi, totemo] = within(card("오늘 단어 2개 중 1개를 썼어요")).getAllByRole("listitem");
    expect(sukoshi.querySelector("rt")).toHaveTextContent("すこし");
    expect(sukoshi.querySelector("ruby")?.closest("[lang]")).toHaveAttribute("lang", "ja");
    expect(totemo.querySelector("rt")).toBeNull();
  });

  it("목표 단어가 없으면(null·빈 배열) 카드가 없다", () => {
    const { unmount } = renderFeedback();
    expect(screen.queryByText(/단어 \d+개 중/)).toBeNull();
    unmount();

    renderFeedback({ targetWords: [], targetSource: "today" });
    expect(screen.queryByText(/단어 \d+개 중/)).toBeNull();
  });

  it("0턴(skipped)과 피드백을 만드는 중(202)에는 카드가 없다", () => {
    const { unmount } = renderFeedback({
      turns: [],
      result: { feedbackStatus: "skipped", feedback: null },
      targetWords: WORDS,
      targetSource: "today",
    });
    expect(screen.queryByText(/단어 \d+개 중/)).toBeNull();
    unmount();

    renderFeedback({ result: null, targetWords: WORDS, targetSource: "today" });
    expect(screen.getByText("피드백을 만들고 있어요")).toBeInTheDocument();
    expect(screen.queryByText(/단어 \d+개 중/)).toBeNull();
  });
});

describe("ChatFeedback 처리 중", () => {
  it("처리 중 안내와 대기 점을 보여 주고, 2초 뒤 /end를 다시 확인한다", async () => {
    vi.useFakeTimers();
    apiMock.mockResolvedValue(ended);
    renderFeedback({ result: null });

    expect(screen.getByText("피드백을 만들고 있어요")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();

    await advance(1999);
    expect(apiMock).not.toHaveBeenCalled();

    await advance(1);
    expect(apiMock).toHaveBeenCalledWith("POST", END_PATH);
    expect(screen.getByText("자연스러웠어요")).toBeInTheDocument();
    expect(screen.queryByText("피드백을 만들고 있어요")).toBeNull();
  });

  it("202면 retryAfterSeconds 뒤 다시 확인하고, 200이면 결과를 그린 뒤 멈춘다", async () => {
    vi.useFakeTimers();
    apiMock.mockResolvedValueOnce(ending).mockResolvedValueOnce(ended);
    renderFeedback({ result: null });

    await advance(2000);
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("피드백을 만들고 있어요")).toBeInTheDocument();

    await advance(2999);
    expect(apiMock).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("자연스러웠어요")).toBeInTheDocument();

    await advance(10_000);
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it("다시 확인한 /end가 404면 홈으로 이동한다", async () => {
    vi.useFakeTimers();
    apiMock.mockResolvedValueOnce({ ok: false, status: 404, code: "NOT_FOUND", message: "찾을 수 없어요." });
    renderFeedback({ result: null });

    await advance(2000);

    expect(push).toHaveBeenCalledWith("/home");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("실패하면 오류와 [다시 시도]를 보여 주고 자동으로 반복하지 않는다", async () => {
    vi.useFakeTimers();
    apiMock.mockResolvedValueOnce({ ok: false, status: null, code: "NETWORK", message: "연결이 끊겼어요." });
    renderFeedback({ result: null });

    await advance(2000);
    expect(screen.getByRole("alert")).toHaveTextContent("연결이 끊겼어요.");
    await advance(10_000);
    expect(apiMock).toHaveBeenCalledTimes(1);

    apiMock.mockResolvedValueOnce(ended);
    act(() => {
      screen.getByRole("button", { name: "다시 시도" }).click();
    });
    await advance(0);

    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("자연스러웠어요")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("화면이 숨겨져 있으면 확인하지 않고, 다시 보이면 바로 확인한다", async () => {
    vi.useFakeTimers();
    visibility = "hidden";
    apiMock.mockResolvedValue(ended);
    renderFeedback({ result: null });

    await advance(10_000);
    expect(apiMock).not.toHaveBeenCalled();

    setVisibility("visible");
    await advance(0);

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("자연스러웠어요")).toBeInTheDocument();
  });

  it("기다리는 중에 숨겨지면 예약한 확인을 멈춘다", async () => {
    vi.useFakeTimers();
    apiMock.mockResolvedValue(ended);
    renderFeedback({ result: null });

    await advance(1000);
    setVisibility("hidden");
    await advance(10_000);

    expect(apiMock).not.toHaveBeenCalled();
  });

  it("언마운트되면 예약한 확인을 지운다", async () => {
    vi.useFakeTimers();
    apiMock.mockResolvedValue(ended);
    const { unmount } = renderFeedback({ result: null });

    unmount();
    await advance(10_000);
    setVisibility("visible");

    expect(apiMock).not.toHaveBeenCalled();
  });
});
