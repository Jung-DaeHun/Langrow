import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WaitingDots } from "./WaitingDots";

describe("WaitingDots", () => {
  it("role=status에 화면에 안 보이는 label을 둔다", () => {
    render(<WaitingDots label="응답을 기다리고 있어요" />);

    expect(screen.getByRole("status")).toHaveTextContent("응답을 기다리고 있어요");
    expect(screen.getByText("응답을 기다리고 있어요")).toHaveClass("sr-only");
  });

  it("점 3개를 0.15초씩 늦춰 animate-dot으로 반복한다", () => {
    render(<WaitingDots label="채점하고 있어요" />);

    const dots = screen.getByRole("status").querySelectorAll(".animate-dot");
    expect(dots).toHaveLength(3);
    expect([...dots].map((d) => (d as HTMLElement).style.animationDelay)).toEqual(["0s", "0.15s", "0.3s"]);
    for (const dot of dots) expect(dot).toHaveAttribute("aria-hidden", "true");
  });
});
