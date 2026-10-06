import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UsageCard } from "./UsageCard";

describe("UsageCard", () => {
  it("항목마다 남은 양을 'n / max 남음'으로 보여 주고 바는 사용한 양으로 채운다", () => {
    render(<UsageCard usage={{ chatTurns: 5, newWords: 4 }} plan="free" />);

    const chat = screen.getByRole("progressbar", { name: "AI 대화 턴" });
    expect(chat).toHaveAttribute("aria-valuenow", "5");
    expect(chat).toHaveAttribute("aria-valuemin", "0");
    expect(chat).toHaveAttribute("aria-valuemax", "20");
    expect((chat.firstElementChild as HTMLElement).style.width).toBe("25%");
    expect(screen.getByText("AI 대화 턴").parentElement).toHaveTextContent("15 / 20 남음");

    const words = screen.getByRole("progressbar", { name: "새 단어" });
    expect(words).toHaveAttribute("aria-valuemax", "10");
    expect(screen.getByText("새 단어").parentElement).toHaveTextContent("6 / 10 남음");
  });

  it("Pro면 Pro 한도를 쓴다", () => {
    render(<UsageCard usage={{ chatTurns: 30, newWords: 0 }} plan="pro" />);

    expect(screen.getByText("AI 대화 턴").parentElement).toHaveTextContent("120 / 150 남음");
    expect(screen.getByText("새 단어").parentElement).toHaveTextContent("30 / 30 남음");
  });

  it("남은 양이 0이면 숫자와 채움을 danger로 바꾼다", () => {
    render(<UsageCard usage={{ chatTurns: 3, newWords: 10 }} plan="free" />);

    const words = screen.getByRole("progressbar", { name: "새 단어" });
    expect(words.firstElementChild).toHaveClass("bg-danger");
    expect(within(screen.getByText("새 단어").parentElement!).getByText("0")).toHaveClass("text-danger");

    const chat = screen.getByRole("progressbar", { name: "AI 대화 턴" });
    expect(chat.firstElementChild).toHaveClass("bg-accent");
    expect(within(screen.getByText("AI 대화 턴").parentElement!).getByText("17")).not.toHaveClass("text-danger");
  });

  it("체험이 끝나 한도보다 많이 썼으면 남은 양 0, 바는 가득 채운다", () => {
    render(<UsageCard usage={{ chatTurns: 40, newWords: 0 }} plan="free" />);

    const chat = screen.getByRole("progressbar", { name: "AI 대화 턴" });
    expect(chat).toHaveAttribute("aria-valuenow", "20");
    expect((chat.firstElementChild as HTMLElement).style.width).toBe("100%");
    expect(screen.getByText("AI 대화 턴").parentElement).toHaveTextContent("0 / 20 남음");
  });

  it("compact면 p-4, 아니면 p-5다", () => {
    const { container, rerender } = render(<UsageCard usage={{ chatTurns: 0, newWords: 0 }} plan="free" />);
    expect(container.firstElementChild).toHaveClass("p-5");

    rerender(<UsageCard usage={{ chatTurns: 0, newWords: 0 }} plan="free" compact />);
    expect(container.firstElementChild).toHaveClass("p-4");
  });

  it("showNote일 때만 초기화·합산 안내를 붙인다", () => {
    const note = "한국 시간 자정에 다시 채워져요. 영어·일본어 사용량을 합산해요.";
    const { rerender } = render(<UsageCard usage={{ chatTurns: 0, newWords: 0 }} plan="free" />);
    expect(screen.queryByText(note)).toBeNull();

    rerender(<UsageCard usage={{ chatTurns: 0, newWords: 0 }} plan="free" showNote />);
    expect(screen.getByText(note)).toHaveClass("text-micro");
  });
});
