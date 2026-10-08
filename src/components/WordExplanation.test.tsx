import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ApiResult } from "@/services/apiClient";
import type { WordExplainResponse } from "@/types/api";
import { WordExplanation } from "./WordExplanation";

vi.mock("@/services/apiClient", () => ({ api: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const apiMock = vi.mocked(api);

beforeEach(() => {
  apiMock.mockReset();
  vi.mocked(useRouter).mockReturnValue({ refresh: vi.fn() } as unknown as ReturnType<typeof useRouter>);
});

type Props = ComponentProps<typeof WordExplanation>;

function setup(overrides: Partial<Props> = {}) {
  const user = userEvent.setup();
  const onBlock = vi.fn();
  const onTrialStarted = vi.fn();
  const props: Props = {
    wordId: "ja-1-010",
    choice: "[食|た]べる",
    label: "AI 해설",
    showFurigana: true,
    trial: { kind: "available" },
    block: null,
    onBlock,
    onTrialStarted,
    ...overrides,
  };
  const view = render(<WordExplanation {...props} />);
  const rerender = (next: Partial<Props>) => view.rerender(<WordExplanation {...props} {...next} />);
  return { user, onBlock, onTrialStarted, rerender, unmount: view.unmount };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const explained = (explanation: string): ApiResult<WordExplainResponse> => ({
  ok: true,
  status: 200,
  data: { explanation },
});
const failure = (status: number | null, code: string, message: string) =>
  ({ ok: false, status, code, message }) as ApiResult<never>;
const button = () => screen.getByRole("button", { name: "AI 해설" });
const LIMIT_TITLE = "오늘 AI 해설 10회를 모두 썼어요";

describe("WordExplanation 요청", () => {
  it("처음에는 라벨 버튼만 보여 준다", () => {
    setup();

    expect(button()).toBeInTheDocument();
    expect(screen.queryByText("AI 해설", { selector: "p" })).not.toBeInTheDocument();
  });

  it("누르면 점 3개로 기다리고, 받으면 버튼 없이 'AI 해설' 이름표와 설명을 보여 준다", async () => {
    const pending = deferred<ApiResult<WordExplainResponse>>();
    apiMock.mockReturnValue(pending.promise);
    const { user } = setup();

    await user.click(button());
    expect(screen.getByRole("status")).toHaveTextContent("설명을 만드는 중");
    expect(screen.queryByRole("button", { name: "AI 해설" })).not.toBeInTheDocument();

    pending.resolve(explained("이미 먹은 일이라 과거형을 써요."));
    expect(await screen.findByText("이미 먹은 일이라 과거형을 써요.")).toBeInTheDocument();
    expect(screen.getByText("AI 해설", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("빈칸은 word_id와 choice를, 복습은 word_id만 보낸다", async () => {
    apiMock.mockResolvedValue(explained("설명"));
    const quiz = setup();
    await quiz.user.click(button());
    expect(apiMock).toHaveBeenLastCalledWith("POST", "/api/words/explain", { word_id: "ja-1-010", choice: "[食|た]べる" });
    quiz.unmount();

    const review = setup({ choice: undefined, label: "예문 설명" });
    await review.user.click(screen.getByRole("button", { name: "예문 설명" }));
    expect(apiMock).toHaveBeenLastCalledWith("POST", "/api/words/explain", { word_id: "ja-1-010" });
  });

  it("두 번 빠르게 눌러도 한 번만 요청한다", async () => {
    apiMock.mockReturnValue(deferred<ApiResult<never>>().promise);
    const { user } = setup();

    await user.dblClick(button());

    expect(apiMock).toHaveBeenCalledOnce();
  });

  it("키보드로 누르면 버튼이 사라져도 포커스는 설명 영역에 남는다 ([다시 시도]도 같다)", async () => {
    apiMock
      .mockResolvedValueOnce(failure(503, "AI_UNAVAILABLE", "설명을 만들지 못했어요. 횟수는 차감되지 않았어요."))
      .mockResolvedValueOnce(explained("다시 만든 설명"));
    const { user } = setup();
    const region = () => document.querySelector("[aria-live]");

    await user.tab();
    await user.keyboard("{Enter}");
    await screen.findByRole("alert");
    expect(region()).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "다시 시도" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await screen.findByText("다시 만든 설명");
    expect(region()).toHaveFocus();
  });

  it.each([
    [true, 1, "食(た)べました는 과거형이에요."],
    [false, 0, "食べました는 과거형이에요."],
  ])("일본어 표기는 showFurigana=%s이면 루비 %i개로 그린다", async (showFurigana, rubies, text) => {
    apiMock.mockResolvedValue(explained("[食|た]べました는 과거형이에요."));
    const { user } = setup({ showFurigana });

    await user.click(button());

    expect(await screen.findByText(/과거형이에요/)).toHaveTextContent(text);
    expect(document.querySelectorAll("ruby")).toHaveLength(rubies);
  });
});

describe("WordExplanation 실패", () => {
  it("503이면 서버 문구와 [다시 시도]를 보여 주고, 다시 시도하면 같은 body로 요청한다", async () => {
    apiMock
      .mockResolvedValueOnce(failure(503, "AI_UNAVAILABLE", "설명을 만들지 못했어요. 횟수는 차감되지 않았어요."))
      .mockResolvedValueOnce(explained("다시 만든 설명"));
    const { user } = setup();

    await user.click(button());
    expect(await screen.findByRole("alert")).toHaveTextContent("설명을 만들지 못했어요. 횟수는 차감되지 않았어요.");
    await user.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(await screen.findByText("다시 만든 설명")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(apiMock.mock.calls[1]).toEqual(apiMock.mock.calls[0]);
  });

  it.each([
    ["네트워크", null, "NETWORK", "연결이 끊겼어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."],
    ["404", 404, "NOT_FOUND", "찾을 수 없어요."],
    ["500", 500, "INTERNAL", "잠시 후 다시 시도해 주세요."],
  ])("%s 실패도 그 자리의 오류 안내와 [다시 시도]다", async (_, status, code, message) => {
    apiMock.mockResolvedValue(failure(status, code, message));
    const { user, onBlock } = setup();

    await user.click(button());

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    expect(onBlock).not.toHaveBeenCalled();
  });

  it("429 LIMIT_REACHED면 onBlock({ kind: limit })으로 회차에 알린다", async () => {
    apiMock.mockResolvedValue(failure(429, "LIMIT_REACHED", "오늘 사용량을 모두 썼어요."));
    const { user, onBlock } = setup();

    await user.click(button());

    await vi.waitFor(() => expect(onBlock).toHaveBeenCalledWith({ kind: "limit" }));
  });

  it("429 AI_FAILURE_LIMIT면 서버 문구와 함께 onBlock한다", async () => {
    const message = "오늘은 응답 오류가 많아 AI 해설을 잠시 쉬어요. 내일 다시 시도해 주세요.";
    apiMock.mockResolvedValue(failure(429, "AI_FAILURE_LIMIT", message));
    const { user, onBlock } = setup();

    await user.click(button());

    await vi.waitFor(() => expect(onBlock).toHaveBeenCalledWith({ kind: "failure-limit", message }));
  });

  it("문제를 넘겨 사라진 뒤 도착한 응답은 버린다 (429여도 onBlock을 부르지 않는다)", async () => {
    const pending = deferred<ApiResult<never>>();
    apiMock.mockReturnValue(pending.promise);
    const { user, onBlock, unmount } = setup();

    await user.click(button());
    unmount();
    pending.resolve(failure(429, "LIMIT_REACHED", "오늘 사용량을 모두 썼어요."));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onBlock).not.toHaveBeenCalled();
  });
});

describe("WordExplanation 회차 안내 (block)", () => {
  it("limit이고 체험 가능하면 설명 한도 안내와 outline [7일 무료 체험]이고, 요청 버튼·[내일 할게요]는 없다", () => {
    setup({ block: { kind: "limit" } });

    expect(screen.getByText(LIMIT_TITLE)).toBeInTheDocument();
    expect(screen.getByText("Pro는 AI 해설을 제한 없이 볼 수 있어요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "7일 무료 체험" })).toHaveClass("border-accent");
    expect(screen.queryByRole("button", { name: "AI 해설" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "내일 할게요" })).not.toBeInTheDocument();
  });

  it("limit이고 체험을 썼으면 outline [Pro 시작하기]다", () => {
    setup({ block: { kind: "limit" }, trial: { kind: "ended" } });

    expect(screen.getByRole("button", { name: "Pro 시작하기" })).toHaveClass("border-accent");
    expect(screen.queryByRole("button", { name: "7일 무료 체험" })).not.toBeInTheDocument();
  });

  it("한도 안내에서 체험을 시작하면 onTrialStarted를 부른다", async () => {
    apiMock.mockResolvedValue({ ok: true, status: 200, data: { proUntil: "2026-10-15T00:00:00Z" } });
    const { user, onTrialStarted } = setup({ block: { kind: "limit" } });

    await user.click(screen.getByRole("button", { name: "7일 무료 체험" }));

    expect(apiMock).toHaveBeenCalledWith("POST", "/api/trial");
    expect(onTrialStarted).toHaveBeenCalledOnce();
  });

  it("failure-limit이면 서버 문구를 정보 안내로 보여 주고 버튼이 없다", () => {
    setup({ block: { kind: "failure-limit", message: "오늘은 응답 오류가 많아 잠시 쉬어요." } });

    expect(screen.getByText("오늘은 응답 오류가 많아 잠시 쉬어요.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("이미 받은 설명은 뒤에 block이 생겨도 그대로 둔다", async () => {
    apiMock.mockResolvedValue(explained("받은 설명"));
    const { user, rerender } = setup();
    await user.click(button());
    await screen.findByText("받은 설명");

    rerender({ block: { kind: "limit" } });

    expect(screen.getByText("받은 설명")).toBeInTheDocument();
    expect(screen.queryByText(LIMIT_TITLE)).not.toBeInTheDocument();
  });
});
