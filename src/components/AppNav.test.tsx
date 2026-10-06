import { render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppNav } from "./AppNav";

vi.mock("next/navigation", () => ({ usePathname: vi.fn() }));

const pathname = vi.mocked(usePathname);

function links() {
  return screen.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
}

beforeEach(() => {
  pathname.mockReturnValue("/home");
});

describe("AppNav tabs", () => {
  it("탭 4개: 홈·대화·단어·계정", () => {
    render(<AppNav variant="tabs" language="ja" />);

    expect(links()).toEqual([
      ["홈", "/home"],
      ["대화", "/chat"],
      ["단어", "/words"],
      ["계정", "/account"],
    ]);
  });

  it("탭 높이는 48px 이상이다", () => {
    render(<AppNav variant="tabs" language="en" />);

    for (const link of screen.getAllByRole("link")) expect(link).toHaveClass("min-h-12");
  });

  it("하위 경로도 현재 위치로 표시한다", () => {
    pathname.mockReturnValue("/chat/7f1c");
    render(<AppNav variant="tabs" language="en" />);

    expect(screen.getByRole("link", { name: "대화" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "대화" })).toHaveClass("text-accent");
    expect(screen.getByRole("link", { name: "홈" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "홈" })).not.toHaveClass("text-accent");
  });

  it("접두어만 같은 경로는 현재 위치가 아니다", () => {
    pathname.mockReturnValue("/homework");
    render(<AppNav variant="tabs" language="en" />);

    expect(screen.getByRole("link", { name: "홈" })).not.toHaveAttribute("aria-current");
  });
});

describe("AppNav sidebar", () => {
  it("일본어면 가나 익히기를 포함한다", () => {
    render(<AppNav variant="sidebar" language="ja" />);

    expect(links()).toEqual([
      ["홈", "/home"],
      ["대화", "/chat"],
      ["단어", "/words"],
      ["레벨업 테스트", "/level-up"],
      ["가나 익히기", "/kana"],
      ["계정", "/account"],
    ]);
  });

  it("영어면 가나 익히기가 없다", () => {
    render(<AppNav variant="sidebar" language="en" />);

    expect(screen.queryByRole("link", { name: "가나 익히기" })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(5);
  });

  it("현재 경로에 aria-current를 단다", () => {
    pathname.mockReturnValue("/level-up");
    render(<AppNav variant="sidebar" language="en" />);

    expect(screen.getByRole("link", { name: "레벨업 테스트" })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("link").filter((a) => a.hasAttribute("aria-current"))).toHaveLength(1);
  });
});
