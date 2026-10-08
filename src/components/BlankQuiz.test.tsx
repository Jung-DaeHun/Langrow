import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { BlankQuestion } from "@/lib/blank";
import { BlankQuiz } from "./BlankQuiz";

const QUESTION: BlankQuestion = {
  wordId: "en-1-001",
  before: "I ",
  after: " to school.",
  exampleKo: "나는 학교에 갔다.",
  options: ["goes", "went", "gone", "going"],
};

type Props = ComponentProps<typeof BlankQuiz>;

function setup(overrides: Partial<Props> = {}) {
  const user = userEvent.setup();
  const onNext = vi.fn();
  const props: Props = {
    question: QUESTION,
    language: "en",
    showFurigana: false,
    stepLabel: "빈칸 채우기",
    index: 2,
    total: 10,
    mode: "learn",
    answer: "went",
    meaningKo: "가다",
    isLast: false,
    onNext,
    ...overrides,
  };
  const view = render(<BlankQuiz {...props} />);
  return { user, onNext, container: view.container };
}

const option = (text: string) => screen.getByText(text, { selector: "span[lang]" }).closest("button") as HTMLElement;

describe("BlankQuiz 표시", () => {
  it("단계 이름과 i / n, 진행 바를 보여 준다 (index는 0부터)", () => {
    setup();

    expect(screen.getByText("빈칸 채우기")).toBeInTheDocument();
    expect(screen.getByText("3 / 10")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "빈칸 채우기" });
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemax", "10");
  });

  it("빈칸 문장에 학습 언어 lang을 달고, 아래에 번역을 둔다", () => {
    setup();

    const sentence = screen.getByText("빈칸").closest("[lang]");
    expect(sentence).toHaveAttribute("lang", "en");
    expect(sentence).toHaveTextContent("I 빈칸 to school.");
    expect(screen.getByText("나는 학교에 갔다.")).toBeInTheDocument();
  });

  it("보기 4개를 받은 순서대로 버튼으로 그리고 lang을 단다", () => {
    setup();

    const labels = QUESTION.options.map((text) => option(text));
    expect(labels).toHaveLength(4);
    labels.forEach((button) => expect(button).toBeEnabled());
    expect(screen.getByText("goes", { selector: "span[lang]" })).toHaveAttribute("lang", "en");
  });

  it("일본어 보기와 문장은 showFurigana면 <ruby>로, 아니면 글자만 그린다", () => {
    const ja: BlankQuestion = {
      wordId: "ja-1-001",
      before: "[学校|がっこう]に",
      after: "。",
      exampleKo: "학교에 갔다.",
      options: ["[行|い]った", "[行|い]く", "[行|い]って", "[行|い]かない"],
    };
    const shown = setup({ question: ja, language: "ja", showFurigana: true, answer: "[行|い]った" });
    expect(shown.container.querySelectorAll("rt")).toHaveLength(5);
    expect(screen.getAllByText("行", { selector: "ruby" })).toHaveLength(4);
    shown.container.remove();

    const hidden = setup({ question: ja, language: "ja", showFurigana: false, answer: "[行|い]った" });
    expect(hidden.container.querySelectorAll("rt")).toHaveLength(0);
    expect(screen.getByText("行った", { selector: "span[lang]" })).toBeInTheDocument();
  });
});

describe("BlankQuiz 학습(learn)", () => {
  it("정답을 고르면 정답 아이콘과 \"정답이에요.\"를 보여 주고 보기를 잠근다", async () => {
    const { user, onNext } = setup();

    await user.click(option("went"));

    expect(within(option("went")).getByRole("img", { name: "정답" })).toBeInTheDocument();
    expect(option("went")).toHaveClass("ring-accent", "bg-ok-wash");
    expect(screen.getByText("정답이에요.")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "오답" })).not.toBeInTheDocument();
    QUESTION.options.forEach((text) => expect(option(text)).toBeDisabled());
    expect(onNext).not.toHaveBeenCalled();
  });

  it("오답을 고르면 고른 보기에 오답, 정답 보기에 정답 아이콘을 달고 정답과 뜻을 알려 준다", async () => {
    const { user } = setup();

    await user.click(option("goes"));

    expect(within(option("goes")).getByRole("img", { name: "오답" })).toBeInTheDocument();
    expect(option("goes")).toHaveClass("ring-danger", "bg-danger-wash");
    expect(within(option("went")).getByRole("img", { name: "정답" })).toBeInTheDocument();
    expect(screen.getByText(/오답이에요/)).toHaveTextContent("오답이에요. 정답은 went (가다)");
    expect(screen.queryByText("정답이에요.")).not.toBeInTheDocument();
  });

  it("고른 뒤에는 다른 보기를 눌러도 바뀌지 않는다", async () => {
    const { user } = setup();

    await user.click(option("goes"));
    await user.click(option("went"));

    expect(within(option("goes")).getByRole("img", { name: "오답" })).toBeInTheDocument();
  });

  it("고르기 전에는 다음 버튼이 없고, 고른 뒤 [다음 문제]가 고른 보기로 onNext를 부른다", async () => {
    const { user, onNext } = setup();
    expect(screen.queryByRole("button", { name: "다음 문제" })).not.toBeInTheDocument();

    await user.click(option("goes"));
    await user.click(screen.getByRole("button", { name: "다음 문제" }));

    expect(onNext).toHaveBeenCalledExactlyOnceWith("goes");
  });

  it("마지막 문제면 [결과 보기]다", async () => {
    const { user, onNext } = setup({ isLast: true });

    await user.click(option("went"));
    await user.click(screen.getByRole("button", { name: "결과 보기" }));

    expect(onNext).toHaveBeenCalledExactlyOnceWith("went");
  });
});

describe("BlankQuiz 테스트(test)", () => {
  it("고르면 정답 여부를 보여 주지 않고 바로 onNext를 부른다", async () => {
    const { user, onNext } = setup({ mode: "test", answer: undefined, meaningKo: undefined, stepLabel: "레벨업 테스트" });

    await user.click(option("goes"));

    expect(onNext).toHaveBeenCalledExactlyOnceWith("goes");
    expect(screen.queryByRole("img", { name: "정답" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "오답" })).not.toBeInTheDocument();
    expect(screen.queryByText(/정답이에요|오답이에요/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /다음 문제|결과 보기/ })).not.toBeInTheDocument();
  });
});

describe("BlankQuiz 설명 자리", () => {
  const following = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it("learn은 채점 뒤에만, 결과 문구와 [다음 문제] 사이에 explanation(고른 보기)을 그린다", async () => {
    const explanation = vi.fn((choice: string) => <p>설명 자리 {choice}</p>);
    const { user } = setup({ explanation });
    expect(explanation).not.toHaveBeenCalled();

    await user.click(option("goes"));

    const slot = screen.getByText("설명 자리 goes");
    expect(following(screen.getByText(/오답이에요/), slot)).toBe(true);
    expect(following(slot, screen.getByRole("button", { name: "다음 문제" }))).toBe(true);
  });

  it("test 모드(레벨업 테스트)는 explanation을 그리지 않는다", async () => {
    const explanation = vi.fn(() => <p>설명 자리</p>);
    const { user } = setup({ mode: "test", answer: undefined, meaningKo: undefined, explanation });

    await user.click(option("goes"));

    expect(explanation).not.toHaveBeenCalled();
    expect(screen.queryByText("설명 자리")).not.toBeInTheDocument();
  });
});
