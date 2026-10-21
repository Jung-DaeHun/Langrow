import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackButton } from "./BackButton";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const back = vi.fn();

function historyLength(length: number) {
  vi.spyOn(History.prototype, "length", "get").mockReturnValue(length);
}

beforeEach(() => {
  back.mockReset();
  vi.mocked(useRouter).mockReturnValue({ back } as unknown as ReturnType<typeof useRouter>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BackButton", () => {
  it("앱 안에서 왔으면(앞 기록 있음) 앞 화면으로 돌아간다", async () => {
    historyLength(2);
    render(<BackButton />);
    await userEvent.click(screen.getByRole("link", { name: "돌아가기" }));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("Ctrl·Cmd·Shift를 누른 클릭은 뒤로 가지 않고 링크 기본 동작(새 탭·새 창)에 맡긴다", async () => {
    historyLength(2);
    render(<BackButton />);
    const link = screen.getByRole("link", { name: "돌아가기" });
    link.addEventListener("click", (event) => event.preventDefault()); // jsdom은 실제 이동을 못 한다
    const user = userEvent.setup();
    for (const key of ["Control", "Meta", "Shift"]) {
      await user.keyboard(`{${key}>}`);
      await user.click(link);
      await user.keyboard(`{/${key}}`);
    }
    expect(back).not.toHaveBeenCalled();
  });

  it("새 탭이나 바로 들어온 경우(앞 기록 없음)는 랜딩으로 가는 링크를 따른다", async () => {
    historyLength(1);
    render(<BackButton />);
    const link = screen.getByRole("link", { name: "돌아가기" });
    expect(link).toHaveAttribute("href", "/");
    link.addEventListener("click", (event) => event.preventDefault()); // jsdom은 실제 이동을 못 한다
    await userEvent.click(link);
    expect(back).not.toHaveBeenCalled();
  });
});
