import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Word } from "@/server/db/reads";
import { api, type ApiResult } from "@/services/apiClient";
import type { WordBatchResponse, WordReviewResponse } from "@/types/api";
import { WordSession } from "./WordSession";

vi.mock("@/services/apiClient", () => ({ api: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const apiMock = vi.mocked(api);
const refresh = vi.fn();
const scrollTo = vi.fn();

beforeEach(() => {
  apiMock.mockReset();
  refresh.mockReset();
  scrollTo.mockReset();
  vi.mocked(useRouter).mockReturnValue({ refresh, push: vi.fn() } as unknown as ReturnType<typeof useRouter>);
  vi.stubGlobal("scrollTo", scrollTo);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function word(n: number, overrides: Partial<Word> = {}): Word {
  return {
    id: `en-3-00${n}`,
    language: "en",
    level: 3,
    rank: n,
    word: `word${n}`,
    reading: null,
    meaningKo: `뜻${n}`,
    example: `I {{word${n}}} it.`,
    exampleKo: `번역${n}`,
    distractors: [`x${n}a`, `x${n}b`, `x${n}c`],
    ...overrides,
  };
}

const WORDS = [word(1), word(2), word(3)];

type Props = ComponentProps<typeof WordSession>;

function setup(overrides: Partial<Props> = {}) {
  const user = userEvent.setup();
  const props: Props = {
    mode: "learn",
    language: "en",
    level: 3,
    words: WORDS,
    todayCount: 0,
    trial: { kind: "available" },
    ...overrides,
  };
  const view = render(<WordSession {...props} />);
  const rerender = (next: Partial<Props>) => view.rerender(<WordSession {...props} {...next} />);
  return { user, rerender, container: view.container };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const saved = (insertedCount: number): ApiResult<WordBatchResponse> => ({ ok: true, status: 200, data: { insertedCount } });
const reviewed: ApiResult<WordReviewResponse> = { ok: true, status: 200, data: { reviewedCount: 2 } };
const failure = (status: number | null, code: string, message: string) =>
  ({ ok: false, status, code, message }) as ApiResult<never>;

type User = ReturnType<typeof userEvent.setup>;

const flashcard = () => screen.getByRole("button", { name: /탭해서 뜻 보기/ });
const focusRoot = (container: HTMLElement) => container.querySelector("[data-focus-mode]");

async function answerCards(user: User, answers: boolean[]) {
  for (const knew of answers) {
    await user.click(screen.getByRole("button", { name: knew ? "알아요" : "모르겠어요" }));
  }
}

async function answerQuiz(user: User, choices: string[]) {
  for (const [i, choice] of choices.entries()) {
    await user.click(screen.getByText(choice, { selector: "button span[lang]" }));
    await user.click(screen.getByRole("button", { name: i === choices.length - 1 ? "결과 보기" : "다음 문제" }));
  }
}

// 1번은 알아요+정답(known), 2번은 모르겠어요+정답, 3번은 알아요+오답
async function finishLearn(user: User) {
  await user.click(screen.getByRole("button", { name: "시작하기" }));
  await answerCards(user, [true, false, true]);
  await answerQuiz(user, ["word1", "word2", "x3a"]);
}

const LEARN_ITEMS = [
  { word_id: "en-3-001", knew: true, correct: true },
  { word_id: "en-3-002", knew: false, correct: true },
  { word_id: "en-3-003", knew: true, correct: false },
];

describe("WordSession 오늘의 학습 시작 카드", () => {
  it("언어·레벨, 오늘 진행, 새 단어 수, 저장 안내, [시작하기]를 보여 주고 집중 모드가 아니다", () => {
    const { container } = setup({ todayCount: 3 });

    expect(screen.getByText("영어 · 중급")).toBeInTheDocument();
    expect(screen.getByText("오늘 3 / 10")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "새 단어 3개" })).toBeInTheDocument();
    expect(screen.getByText("끝까지 풀면 한 번에 저장돼요. 중간에 나가면 저장되지 않아요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "시작하기" })).toBeEnabled();
    expect(focusRoot(container)).toBeNull();
  });

  it("오늘 진행은 목표 10을 넘겨 보여 주지 않는다", () => {
    setup({ todayCount: 14 });

    expect(screen.getByText("오늘 10 / 10")).toBeInTheDocument();
  });
});

describe("WordSession 오늘의 학습 회차", () => {
  it("플래시카드는 집중 모드이고 단계 이름·i / n과 단어 앞면을 보여 준다", async () => {
    const { user, container } = setup();

    await user.click(screen.getByRole("button", { name: "시작하기" }));

    expect(focusRoot(container)).not.toBeNull();
    expect(screen.getByText("플래시카드")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(flashcard()).toHaveAccessibleName(/^word1/);
    expect(screen.getByText("word1").closest("[lang]")).toHaveAttribute("lang", "en");
  });

  it("뒤집으면 뜻, 정답을 채운 예문, 예문 번역을 보여 준다", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "시작하기" }));

    await user.click(flashcard());

    const card = screen.getAllByRole("button")[1];
    expect(card).toHaveAccessibleName(/^뜻1.*I word1 it\..*번역1$/);
    expect(screen.getByText("I word1 it.").closest("[lang]")).toHaveAttribute("lang", "en");
  });

  it("플래시카드를 모두 넘기면 같은 단어들로 빈칸 퀴즈를 낸다", async () => {
    const { user, container } = setup();
    await user.click(screen.getByRole("button", { name: "시작하기" }));

    await answerCards(user, [true, true, true]);

    expect(focusRoot(container)).not.toBeNull();
    expect(screen.getByText("빈칸 채우기")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(screen.getByText("번역1")).toBeInTheDocument();
    ["word1", "x1a", "x1b", "x1c"].forEach((option) =>
      expect(screen.getByText(option, { selector: "button span[lang]" })).toBeInTheDocument(),
    );
  });

  it("퀴즈를 마치면 knew·correct를 담아 /api/words/batch에 한 번 저장한다", async () => {
    apiMock.mockResolvedValue(saved(3));
    const { user } = setup();

    await finishLearn(user);

    expect(apiMock).toHaveBeenCalledExactlyOnceWith("POST", "/api/words/batch", { language: "en", items: LEARN_ITEMS });
  });

  it("언어와 단어는 시작할 때 고정한다", async () => {
    apiMock.mockResolvedValue(saved(3));
    const { user, rerender } = setup();
    await user.click(screen.getByRole("button", { name: "시작하기" }));

    rerender({ language: "ja", words: [word(7)] });
    await answerCards(user, [true, false, true]);
    await answerQuiz(user, ["word1", "word2", "x3a"]);

    expect(apiMock).toHaveBeenCalledExactlyOnceWith("POST", "/api/words/batch", { language: "en", items: LEARN_ITEMS });
  });

  it("결과에 맞힌 수, 저장 결과, 다시 볼 단어를 보여 준다", async () => {
    apiMock.mockResolvedValue(saved(3));
    const { user, container } = setup();

    await finishLearn(user);

    expect(focusRoot(container)).not.toBeNull();
    expect(screen.getByRole("heading", { name: "3개 중 2개 맞혔어요" })).toBeInTheDocument();
    expect(await screen.findByText("새 단어 3개를 저장했어요")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "다시 볼 단어 2개" });
    expect(within(list).getByText("word2")).toBeInTheDocument();
    expect(within(list).getByText("word3")).toBeInTheDocument();
    expect(within(list).queryByText("word1")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "홈으로" })).toHaveAttribute("href", "/home");
  });

  it("insertedCount가 0이면 이미 저장한 단어라고 알린다", async () => {
    apiMock.mockResolvedValue(saved(0));
    const { user } = setup();

    await finishLearn(user);

    expect(await screen.findByText("이미 저장한 단어예요. 사용량은 늘지 않았어요")).toBeInTheDocument();
  });

  it("저장 중에는 \"저장 중…\" 버튼을 비활성화하고 다른 버튼도 막는다", async () => {
    const pending = deferred<ApiResult<WordBatchResponse>>();
    apiMock.mockReturnValue(pending.promise);
    const { user } = setup();

    await finishLearn(user);

    expect(screen.getByRole("button", { name: "저장 중…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "단어 화면으로" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "홈으로" })).not.toBeInTheDocument();

    pending.resolve(saved(3));
    expect(await screen.findByRole("link", { name: "홈으로" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "단어 화면으로" })).toBeEnabled();
  });

  it("[단어 화면으로]는 화면을 새로 읽고 시작 카드로 돌아간다", async () => {
    apiMock.mockResolvedValue(saved(3));
    const { user, container } = setup();
    await finishLearn(user);

    await user.click(await screen.findByRole("button", { name: "단어 화면으로" }));

    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "시작하기" })).toBeInTheDocument();
    expect(focusRoot(container)).toBeNull();
  });
});

describe("WordSession 저장 실패", () => {
  it("429 LIMIT_REACHED면 결과를 그대로 두고 한도 안내와 [다시 시도]를 보여 준다", async () => {
    apiMock.mockResolvedValue(failure(429, "LIMIT_REACHED", "오늘 사용량을 모두 썼어요."));
    const { user } = setup();

    await finishLearn(user);

    expect(await screen.findByText("오늘 새 단어를 모두 썼어요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "7일 무료 체험" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "3개 중 2개 맞혔어요" })).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledOnce();
  });

  it("한도 안내에서 체험을 시작하면 안내를 거두고, 다시 보내지는 않는다", async () => {
    apiMock
      .mockResolvedValueOnce(failure(429, "LIMIT_REACHED", "오늘 사용량을 모두 썼어요."))
      .mockResolvedValueOnce({ ok: true, status: 200, data: { proUntil: "2026-10-13T00:00:00Z" } });
    const { user } = setup();
    await finishLearn(user);

    await user.click(await screen.findByRole("button", { name: "7일 무료 체험" }));

    expect(screen.queryByText("오늘 새 단어를 모두 썼어요")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeEnabled();
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(apiMock).toHaveBeenLastCalledWith("POST", "/api/trial");
  });

  it("429 뒤 [다시 시도]는 같은 items로 다시 보낸다", async () => {
    apiMock.mockResolvedValueOnce(failure(429, "LIMIT_REACHED", "오늘 사용량을 모두 썼어요.")).mockResolvedValueOnce(saved(3));
    const { user } = setup();
    await finishLearn(user);

    await user.click(await screen.findByRole("button", { name: "다시 시도" }));

    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(apiMock).toHaveBeenLastCalledWith("POST", "/api/words/batch", { language: "en", items: LEARN_ITEMS });
    expect(await screen.findByText("새 단어 3개를 저장했어요")).toBeInTheDocument();
  });

  it("네트워크 실패면 오류 안내를 보여 주고 [다시 시도]가 같은 items로 다시 보낸다", async () => {
    apiMock.mockResolvedValueOnce(failure(null, "NETWORK", "인터넷 연결을 확인해 주세요.")).mockResolvedValueOnce(saved(0));
    const { user } = setup();
    await finishLearn(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("인터넷 연결을 확인해 주세요.");
    expect(apiMock).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(apiMock).toHaveBeenNthCalledWith(2, "POST", "/api/words/batch", { language: "en", items: LEARN_ITEMS });
    expect(await screen.findByText("이미 저장한 단어예요. 사용량은 늘지 않았어요")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("WordSession [그만하기]", () => {
  it("플래시카드 도중에 누르면 저장 없이 시작 카드로 돌아간다", async () => {
    const { user, container } = setup();
    await user.click(screen.getByRole("button", { name: "시작하기" }));
    await answerCards(user, [true]);

    await user.click(screen.getByRole("button", { name: "그만하기" }));

    expect(screen.getByRole("button", { name: "시작하기" })).toBeInTheDocument();
    expect(focusRoot(container)).toBeNull();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("퀴즈 도중에 누르면 저장 없이 시작 카드로 돌아가고, 다시 시작하면 처음부터다", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "시작하기" }));
    await answerCards(user, [true, true, true]);
    await user.click(screen.getByText("word1", { selector: "button span[lang]" }));
    await user.click(screen.getByRole("button", { name: "다음 문제" }));

    await user.click(screen.getByRole("button", { name: "그만하기" }));
    await user.click(screen.getByRole("button", { name: "시작하기" }));

    expect(apiMock).not.toHaveBeenCalled();
    expect(screen.getByText("플래시카드")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });
});

describe("WordSession 오답 복습", () => {
  it("시작 카드에 단어 태그 목록, 사용량 안내, [복습 시작]을 둔다", () => {
    const { container } = setup({ mode: "review", todayCount: undefined });

    const list = screen.getByRole("list", { name: "복습할 단어" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText("word1")).toHaveAttribute("lang", "en");
    expect(screen.getByText("복습은 하루 사용량에 포함되지 않아요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "복습 시작" })).toBeInTheDocument();
    expect(focusRoot(container)).toBeNull();
  });

  it("플래시카드만 하고 퀴즈 없이 /api/words/review에 knew만 저장한다", async () => {
    apiMock.mockResolvedValue(reviewed);
    const { user, container } = setup({ mode: "review", todayCount: undefined });

    await user.click(screen.getByRole("button", { name: "복습 시작" }));
    expect(screen.getByText("오답 복습")).toBeInTheDocument();
    await answerCards(user, [true, false, true]);

    expect(screen.queryByText("빈칸 채우기")).not.toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledExactlyOnceWith("POST", "/api/words/review", {
      language: "en",
      items: [
        { word_id: "en-3-001", knew: true },
        { word_id: "en-3-002", knew: false },
        { word_id: "en-3-003", knew: true },
      ],
    });
    expect(focusRoot(container)).not.toBeNull();
    expect(screen.getByRole("heading", { name: "3개 중 2개 알았어요" })).toBeInTheDocument();
    expect(await screen.findByText("복습 결과를 저장했어요")).toBeInTheDocument();
  });
});

describe("WordSession 일본어 후리가나", () => {
  const ja = (overrides: Partial<Word>) =>
    word(1, {
      id: "ja-1-001",
      language: "ja",
      level: 1,
      word: "行く",
      reading: "いく",
      example: "[学校|がっこう]に{{[行|い]く}}。",
      ...overrides,
    });

  it("후리가나 레벨이고 읽기가 단어와 다르면 단어 위에 읽기를 단다", async () => {
    const { user } = setup({ language: "ja", level: 1, words: [ja({})] });
    await user.click(screen.getByRole("button", { name: "시작하기" }));

    expect(screen.getByText("行く", { selector: "ruby" })).toHaveTextContent("行く(いく)");
    expect(screen.getByText("行く", { selector: "ruby" }).closest("[lang]")).toHaveAttribute("lang", "ja");
  });

  it("읽기가 단어와 같으면 읽기를 달지 않는다", async () => {
    const { user } = setup({ language: "ja", level: 1, words: [ja({ word: "これ", reading: "これ" })] });
    await user.click(screen.getByRole("button", { name: "시작하기" }));

    expect(screen.queryByText("これ", { selector: "ruby" })).not.toBeInTheDocument();
    expect(screen.getByText("これ")).toBeInTheDocument();
  });

  it("후리가나를 보이지 않는 레벨이면 앞면·예문 모두 읽기를 달지 않는다", async () => {
    const { user, container } = setup({ language: "ja", level: 4, words: [ja({})] });
    await user.click(screen.getByRole("button", { name: "시작하기" }));

    expect(container.querySelectorAll("rt")).toHaveLength(0);
  });
});
