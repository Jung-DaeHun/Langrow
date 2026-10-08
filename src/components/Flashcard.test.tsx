import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Flashcard } from "./Flashcard";

function setup() {
  const user = userEvent.setup();
  const onAnswer = vi.fn();
  render(<Flashcard front={<span>앞면 단어</span>} back={<span>뒷면 뜻</span>} onAnswer={onAnswer} />);
  return { user, onAnswer };
}

// 보이지 않는 면은 aria-hidden이라 카드 버튼의 이름은 보이는 면의 글자다
const card = () => screen.getAllByRole("button")[0];

describe("Flashcard", () => {
  it("앞면부터 보여 준다", () => {
    setup();

    expect(card()).toHaveAccessibleName("앞면 단어");
  });

  it("카드를 누르면 뒷면으로, 다시 누르면 앞면으로 뒤집힌다", async () => {
    const { user } = setup();

    await user.click(card());
    expect(card()).toHaveAccessibleName("뒷면 뜻");

    await user.click(card());
    expect(card()).toHaveAccessibleName("앞면 단어");
  });

  it("카드는 버튼이라 Enter와 Space로 뒤집힌다", async () => {
    const { user } = setup();

    card().focus();
    await user.keyboard("{Enter}");
    expect(card()).toHaveAccessibleName("뒷면 뜻");

    await user.keyboard(" ");
    expect(card()).toHaveAccessibleName("앞면 단어");
  });

  it("[모르겠어요]는 false, [알아요]는 true로 onAnswer를 부른다", async () => {
    const { user, onAnswer } = setup();

    await user.click(screen.getByRole("button", { name: "모르겠어요" }));
    expect(onAnswer).toHaveBeenLastCalledWith(false);

    await user.click(screen.getByRole("button", { name: "알아요" }));
    expect(onAnswer).toHaveBeenLastCalledWith(true);
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });

  it("[알아요]는 primary, [모르겠어요]는 outline이다", () => {
    setup();

    expect(screen.getByRole("button", { name: "알아요" })).toHaveClass("bg-accent");
    expect(screen.getByRole("button", { name: "모르겠어요" })).toHaveClass("border-accent");
  });
});

describe("Flashcard revealed", () => {
  // 앞면으로 돌렸다 와도 상태가 남는지 보려고 누른 횟수를 들고 있는 자식을 쓴다
  function Counter() {
    const [n, setN] = useState(0);
    return (
      <button type="button" onClick={() => setN(n + 1)}>
        눌림 {n}
      </button>
    );
  }

  function setupRevealed() {
    const user = userEvent.setup();
    render(<Flashcard front={<span>앞면 단어</span>} back={<span>뒷면 뜻</span>} revealed={<Counter />} onAnswer={vi.fn()} />);
    return user;
  }

  const following = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it("revealed는 뒷면을 볼 때만 카드와 버튼 사이에 보인다", async () => {
    const user = setupRevealed();
    expect(screen.queryByRole("button", { name: "눌림 0" })).not.toBeInTheDocument();

    await user.click(card());

    const revealed = screen.getByRole("button", { name: "눌림 0" });
    expect(following(card(), revealed)).toBe(true);
    expect(following(revealed, screen.getByRole("button", { name: "알아요" }))).toBe(true);
  });

  it("앞면으로 돌리면 숨기기만 하고 상태는 그대로다", async () => {
    const user = setupRevealed();
    await user.click(card());
    await user.click(screen.getByRole("button", { name: "눌림 0" }));

    await user.click(card());
    expect(screen.queryByRole("button", { name: "눌림 1" })).not.toBeInTheDocument();

    await user.click(card());
    expect(screen.getByRole("button", { name: "눌림 1" })).toBeInTheDocument();
  });
});
