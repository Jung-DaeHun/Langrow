import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlankQuestion } from "@/lib/blank";
import { api, type ApiResult } from "@/services/apiClient";
import type { LevelUpResponse } from "@/types/api";
import { LevelTestRunner } from "./LevelTestRunner";

vi.mock("@/services/apiClient", () => ({ api: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const apiMock = vi.mocked(api);
const refresh = vi.fn();
const assign = vi.fn();
const scrollTo = vi.fn();

beforeEach(() => {
  apiMock.mockReset();
  refresh.mockReset();
  assign.mockReset();
  scrollTo.mockReset();
  vi.mocked(useRouter).mockReturnValue({ refresh, push: vi.fn() } as unknown as ReturnType<typeof useRouter>);
  vi.stubGlobal("location", { assign });
  vi.stubGlobal("scrollTo", scrollTo);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function question(n: number): BlankQuestion {
  return {
    wordId: `en-3-${String(n).padStart(3, "0")}`,
    before: `Q${n} `,
    after: ".",
    exampleKo: `번역${n}`,
    options: [`a${n}`, `b${n}`, `c${n}`, `d${n}`],
  };
}

const QUESTIONS = Array.from({ length: 20 }, (_, i) => question(i + 1));
// 문제마다 a를 고른다
const ANSWERS = QUESTIONS.map((q, i) => ({ word_id: q.wordId, answer: `a${i + 1}` }));
const BODY = { language: "en", from_level: 3, answers: ANSWERS };

function setup() {
  const user = userEvent.setup();
  const view = render(<LevelTestRunner language="en" fromLevel={3} questions={QUESTIONS} />);
  return { user, container: view.container };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const result = (data: LevelUpResponse): ApiResult<LevelUpResponse> => ({ ok: true, status: 200, data });
const failure = (status: number | null, code: string, message: string) =>
  ({ ok: false, status, code, message }) as ApiResult<never>;

type User = ReturnType<typeof userEvent.setup>;

const focusRoot = (container: HTMLElement) => container.querySelector("[data-focus-mode]");

async function answer(user: User, from: number, to: number) {
  for (let n = from; n <= to; n++) {
    await user.click(screen.getByText(`a${n}`, { selector: "button span[lang]" }));
  }
}

async function finishTest(user: User) {
  await user.click(screen.getByRole("button", { name: "테스트 시작" }));
  await answer(user, 1, 20);
}

describe("LevelTestRunner 시작", () => {
  it("언어, 제목, 규칙 3줄, 서버 채점 안내, [테스트 시작]을 보여 주고 집중 모드가 아니다", () => {
    const { container } = setup();

    expect(screen.getByText("영어")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "중급 → 상급 레벨업 테스트" })).toBeInTheDocument();
    expect(screen.getByText("중급 단어 빈칸 20문제")).toBeInTheDocument();
    expect(screen.getByText("16개 이상 맞히면 레벨 +1")).toBeInTheDocument();
    expect(screen.getByText("재응시 제한 없음 · 사용량에 포함되지 않아요")).toBeInTheDocument();
    expect(screen.getByText("제출하면 서버가 채점해요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "테스트 시작" })).toBeEnabled();
    expect(focusRoot(container)).toBeNull();
  });
});

describe("LevelTestRunner 문제", () => {
  it("집중 모드로 레벨업 테스트 i / 20을 보여 주고, 고르면 정답 여부 없이 다음 문제로 넘어간다", async () => {
    const { user, container } = setup();
    await user.click(screen.getByRole("button", { name: "테스트 시작" }));

    expect(focusRoot(container)).not.toBeNull();
    expect(screen.getByText("레벨업 테스트")).toBeInTheDocument();
    expect(screen.getByText("1 / 20")).toBeInTheDocument();
    expect(screen.getByText("번역1")).toBeInTheDocument();

    await user.click(screen.getByText("b1", { selector: "button span[lang]" }));

    expect(screen.getByText("2 / 20")).toBeInTheDocument();
    expect(screen.getByText("번역2")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /정답|오답/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/정답이에요|오답이에요/)).not.toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("마지막 답을 고르면 답을 문제 순서대로 담아 한 번 제출한다", async () => {
    apiMock.mockResolvedValue(result({ passed: true, level: 4, score: 20, wrong: [] }));
    const { user } = setup();

    await finishTest(user);

    expect(apiMock).toHaveBeenCalledExactlyOnceWith("POST", "/api/level-up", BODY);
  });

  it("채점 중에는 \"채점하고 있어요\"와 대기 점을 보여 준다", async () => {
    const pending = deferred<ApiResult<LevelUpResponse>>();
    apiMock.mockReturnValue(pending.promise);
    const { user, container } = setup();

    await finishTest(user);

    expect(screen.getByText("채점하고 있어요")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(focusRoot(container)).not.toBeNull();

    pending.resolve(result({ passed: true, level: 4, score: 20, wrong: [] }));
    expect(await screen.findByText("20문제 중 20개 정답 · 기준 16개")).toBeInTheDocument();
  });

  it("[그만하기]는 답을 버리고 시작 화면으로 돌아가며, 다시 시작하면 1번부터다", async () => {
    const { user, container } = setup();
    await user.click(screen.getByRole("button", { name: "테스트 시작" }));
    await answer(user, 1, 5);

    await user.click(screen.getByRole("button", { name: "그만하기" }));

    expect(focusRoot(container)).toBeNull();
    expect(screen.getByRole("button", { name: "테스트 시작" })).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "테스트 시작" }));
    expect(screen.getByText("1 / 20")).toBeInTheDocument();
  });
});

describe("LevelTestRunner 결과", () => {
  it("합격이면 점수·기준, accent 바, 보상 안내를 보여 주고 버튼은 전체 새로고침으로 이동한다", async () => {
    apiMock.mockResolvedValue(result({ passed: true, level: 4, score: 18, wrong: [] }));
    const { user, container } = setup();

    await finishTest(user);

    expect(await screen.findByText("20문제 중 18개 정답 · 기준 16개")).toBeInTheDocument();
    expect(focusRoot(container)).not.toBeNull();
    expect(screen.getByRole("heading", { name: "레벨업 테스트에 합격했어요" })).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "점수" });
    expect(bar).toHaveAttribute("aria-valuenow", "18");
    expect(bar).toHaveAttribute("aria-valuemax", "20");
    expect(bar.firstElementChild).toHaveClass("bg-accent");
    expect(screen.getByText("새 상황 4개가 열렸어요")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "새 상황 보기" }));
    expect(assign).toHaveBeenLastCalledWith("/chat");
    await user.click(screen.getByRole("button", { name: "홈으로" }));
    expect(assign).toHaveBeenLastCalledWith("/home");
  });

  it("불합격이면 빨강 없이 몇 개 더 맞히면 되는지 알려 준다", async () => {
    apiMock.mockResolvedValue(result({ passed: false, level: 3, score: 13, wrong: [] }));
    const { user } = setup();

    await finishTest(user);

    expect(await screen.findByRole("heading", { name: "이번엔 아쉽게 통과하지 못했어요" })).toBeInTheDocument();
    expect(screen.getByText("20문제 중 13개 정답 · 기준 16개")).toBeInTheDocument();
    expect(screen.getByText("3개만 더 맞히면 통과예요")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "점수" });
    expect(bar.firstElementChild).toHaveClass("bg-ink-muted");
    expect(bar.firstElementChild).not.toHaveClass("bg-danger");
    expect(screen.queryByText("새 상황 4개가 열렸어요")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "홈으로" })).toHaveAttribute("href", "/home");
  });

  it("틀린 문제는 서버가 준 정답을 채워 보여 준다", async () => {
    apiMock.mockResolvedValue(
      result({
        passed: false,
        level: 3,
        score: 15,
        wrong: [
          { wordId: "en-3-002", answer: "c2" },
          { wordId: "en-3-007", answer: "d7" },
        ],
      }),
    );
    const { user } = setup();

    await finishTest(user);

    const list = await screen.findByRole("list", { name: "틀린 문제 2개" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Q2 c2.");
    expect(items[0]).toHaveTextContent("번역2");
    expect(items[1]).toHaveTextContent("Q7 d7.");
    expect(within(items[0]).getByText("c2").closest("[lang]")).toHaveAttribute("lang", "en");
  });

  it("[다시 보기]는 시작 화면으로 돌아가고 새 문제를 읽는다", async () => {
    apiMock.mockResolvedValue(result({ passed: false, level: 3, score: 10, wrong: [] }));
    const { user, container } = setup();
    await finishTest(user);

    await user.click(await screen.findByRole("button", { name: "다시 보기" }));

    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "테스트 시작" })).toBeInTheDocument();
    expect(focusRoot(container)).toBeNull();
  });
});

describe("LevelTestRunner 제출 실패", () => {
  it("409 CONFLICT면 서버 문구와 [홈으로]만 두고 다시 제출하지 않는다", async () => {
    apiMock.mockResolvedValue(failure(409, "CONFLICT", "레벨이 이미 바뀌었어요."));
    const { user } = setup();

    await finishTest(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("레벨이 이미 바뀌었어요.");
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "홈으로" }));
    expect(assign).toHaveBeenCalledExactlyOnceWith("/home");
    expect(apiMock).toHaveBeenCalledOnce();
  });

  it("그 밖의 실패는 오류 안내와 [다시 시도]를 두고, 같은 답을 다시 제출한다", async () => {
    apiMock
      .mockResolvedValueOnce(failure(null, "NETWORK", "인터넷 연결을 확인해 주세요."))
      .mockResolvedValueOnce(result({ passed: true, level: 4, score: 17, wrong: [] }));
    const { user } = setup();
    await finishTest(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("인터넷 연결을 확인해 주세요.");
    expect(apiMock).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(apiMock).toHaveBeenNthCalledWith(2, "POST", "/api/level-up", BODY);
    expect(await screen.findByText("20문제 중 17개 정답 · 기준 16개")).toBeInTheDocument();
  });
});
