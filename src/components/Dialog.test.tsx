import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

// 여는 버튼과 Dialog를 함께 둔 하네스. 닫힌 횟수를 센다
function Harness({ variant, onClose }: { variant: "modal" | "sheet"; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        열기
      </button>
      <Dialog
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="레벨을 내릴까요?"
        variant={variant}
      >
        <p>다시 올리려면 레벨업 테스트를 통과해야 해요.</p>
        <button type="button">취소</button>
        <button type="button">내리기</button>
      </Dialog>
    </>
  );
}

async function openHarness(variant: "modal" | "sheet" = "modal") {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<Harness variant={variant} onClose={onClose} />);
  const opener = screen.getByRole("button", { name: "열기" });
  await user.click(opener);
  return { user, onClose, opener };
}

describe("Dialog", () => {
  it("닫혀 있으면 아무것도 그리지 않는다", () => {
    render(<Harness variant="modal" />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("열리면 role=dialog, aria-modal, 제목으로 이름을 단다", async () => {
    await openHarness();

    const dialog = screen.getByRole("dialog", { name: "레벨을 내릴까요?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("열리면 안의 첫 포커스 가능 요소(닫기)로 포커스를 옮긴다", async () => {
    await openHarness();

    expect(screen.getByRole("button", { name: "닫기" })).toHaveFocus();
  });

  it("Tab과 Shift+Tab이 안에서 돈다", async () => {
    const { user } = await openHarness();
    const close = screen.getByRole("button", { name: "닫기" });
    const cancel = screen.getByRole("button", { name: "취소" });
    const confirm = screen.getByRole("button", { name: "내리기" });

    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
  });

  it("Esc는 onClose를 부르고 닫히면 연 버튼으로 포커스를 돌려준다", async () => {
    const { user, onClose, opener } = await openHarness();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("배경을 누르면 onClose를 부른다", async () => {
    const { user, onClose } = await openHarness();

    await user.click(document.querySelector(".bg-black\\/50")!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("안쪽을 눌러도 닫히지 않는다", async () => {
    const { user, onClose } = await openHarness();

    await user.click(screen.getByText("다시 올리려면 레벨업 테스트를 통과해야 해요."));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("닫기 버튼은 onClose를 부른다", async () => {
    const { user, onClose } = await openHarness("sheet");

    await user.click(screen.getByRole("button", { name: "닫기" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("modal은 가운데 카드, 제목은 text-h1 text-brand다", async () => {
    await openHarness("modal");

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("max-w-[500px]", "rounded-xl", "bg-card", "p-6", "shadow-overlay");
    expect(screen.getByText("레벨을 내릴까요?")).toHaveClass("text-h1", "text-brand");
  });

  it("sheet는 아래에서 올라오는 시트, 제목은 text-lead font-bold다", async () => {
    await openHarness("sheet");

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("max-w-[560px]", "rounded-t-xl", "bg-card", "animate-sheet");
    expect(screen.getByText("레벨을 내릴까요?")).toHaveClass("text-lead", "font-bold");
  });
});
