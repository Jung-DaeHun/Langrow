import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LandingPreview } from "./LandingPreview";

// l1-cafe의 언어별 첫 마디와 같은 값(page.tsx가 scenarios.ts에서 골라 넘긴다)
const OPENINGS = {
  en: { text: "Hi! What can I get for you?", ko: "안녕하세요! 뭘 드릴까요?" },
  ja: {
    text: "いらっしゃいませ。ご[注文|ちゅうもん]はお[決|き]まりですか？",
    ko: "어서 오세요. 주문하시겠어요?",
    pronKo: "이랏샤이마세. 고츄-몬와 오키마리데스카?",
  },
};

function renderPreview() {
  render(<LandingPreview title="카페에서 음료 주문하기" openings={OPENINGS} />);
  return { user: userEvent.setup(), panel: () => screen.getByRole("tabpanel") };
}

const rubyReading = (panel: HTMLElement, base: string) =>
  within(panel).getByText(base, { selector: "ruby span" }).closest("ruby")?.querySelector("rt");

describe("LandingPreview", () => {
  it("처음에는 영어 탭을 고르고 첫 마디·번역과 고정 문구를 위에서부터 그린다", () => {
    const { panel } = renderPreview();

    expect(screen.getByRole("tablist", { name: "언어" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "영어" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "일본어" })).toHaveAttribute("aria-selected", "false");
    expect(panel()).toHaveAccessibleName("영어");
    const texts = [
      "상황 · 카페에서 음료 주문하기",
      "Hi! What can I get for you?",
      "안녕하세요! 뭘 드릴까요?",
      "아이스 아메리카노 주세요",
      "이렇게 말하면 돼요",
      "Can I get an iced americano?",
      "Can I get ~?은 주문할 때 많이 써요.",
      "Sure! What size would you like?",
      "물론이죠! 어떤 사이즈로 드릴까요?",
    ];
    for (const text of texts) expect(within(panel()).getByText(text)).toBeInTheDocument();
    const content = panel().textContent ?? "";
    const positions = texts.map((text) => content.indexOf(text));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("영어 탭에는 한글 발음 줄과 후리가나가 없다", () => {
    const { panel } = renderPreview();

    expect(panel().querySelector("[aria-hidden='true']")).toBeNull();
    expect(panel().querySelector("ruby")).toBeNull();
  });

  it("일본어 탭을 누르면 첫 마디·교정 문장에 후리가나를 달고 한글 발음은 aria-hidden으로 둔다", async () => {
    const { user, panel } = renderPreview();

    await user.click(screen.getByRole("tab", { name: "일본어" }));

    expect(screen.getByRole("tab", { name: "일본어" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "영어" })).toHaveAttribute("aria-selected", "false");
    expect(panel()).toHaveAccessibleName("일본어");
    expect(rubyReading(panel(), "注文")).toHaveTextContent("ちゅうもん");
    expect(rubyReading(panel(), "一")).toHaveTextContent("ひと");
    const hidden = [...panel().querySelectorAll("[aria-hidden='true']")].map((el) => el.textContent);
    expect(hidden).toEqual([
      "이랏샤이마세. 고츄-몬와 오키마리데스카?",
      "아이스코-히-오 히토츠 쿠다사이.",
      "하이, 사이즈와 도-시마스카?",
    ]);
    for (const text of [
      "어서 오세요. 주문하시겠어요?",
      "아이스 커피 하나 주세요",
      "~をください는 물건을 달라고 할 때 써요.",
      "네, 사이즈는 어떻게 하시겠어요?",
    ]) {
      expect(within(panel()).getByText(text)).toBeInTheDocument();
    }
    expect(within(panel()).queryByText("Can I get an iced americano?")).toBeNull();
  });

  it.each([
    ["영어", "en"],
    ["일본어", "ja"],
  ] as const)("%s 탭의 문장마다 lang을 단다(내 말풍선·번역·교정 설명은 ko)", async (name, language) => {
    const { user, panel } = renderPreview();

    await user.click(screen.getByRole("tab", { name }));

    // 첫 마디 → 번역 → 내 말풍선 → 교정 문장 → 교정 설명 → AI 답 → 번역
    const langs = [...panel().querySelectorAll("[lang]")].map((el) => el.getAttribute("lang"));
    expect(langs).toEqual([language, "ko", "ko", language, "ko", language, "ko"]);
  });

  it("탭 말고는 버튼이 없다(듣기·번역·뜯어보기 없음)", async () => {
    const { user } = renderPreview();

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.queryAllByRole("button")).toEqual([]);
    await user.click(screen.getByRole("tab", { name: "일본어" }));
    expect(screen.queryAllByRole("button")).toEqual([]);
  });
});
