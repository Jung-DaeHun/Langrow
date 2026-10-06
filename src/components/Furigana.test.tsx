import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Furigana } from "./Furigana";

describe("Furigana", () => {
  it("show면 읽기를 <ruby>와 <rt>로 그리고 <rp>로 괄호를 둔다", () => {
    const { container } = render(<Furigana text="[漢字|かんじ]を[読|よ]む" show />);

    const rubies = container.querySelectorAll("ruby");
    expect(rubies).toHaveLength(2);
    expect(rubies[0].querySelector("rt")).toHaveTextContent("かんじ");
    expect(rubies[0].querySelectorAll("rp")[0]).toHaveTextContent("(");
    expect(rubies[0].querySelectorAll("rp")[1]).toHaveTextContent(")");
    expect(container).toHaveTextContent("漢字(かんじ)を読(よ)む");
  });

  it("show가 아니면 본문만 그린다", () => {
    const { container } = render(<Furigana text="[漢字|かんじ]を[読|よ]む" show={false} />);

    expect(container.querySelector("ruby")).toBeNull();
    expect(container.textContent).toBe("漢字を読む");
  });

  it("깨진 표기는 기호를 지운 일반 텍스트로 그린다", () => {
    const { container } = render(<Furigana text="[漢字|かんじを読む" show />);

    expect(container.querySelector("ruby")).toBeNull();
    expect(container.textContent).toBe("漢字かんじを読む");
  });

  it("HTML처럼 보이는 문자열도 텍스트로만 그린다", () => {
    const { container } = render(<Furigana text="<b>x</b>[字|じ]" show />);

    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toBe("<b>x</b>字(じ)");
  });
});
