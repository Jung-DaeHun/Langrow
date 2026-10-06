import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
