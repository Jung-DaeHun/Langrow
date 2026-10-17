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

  it("본문은 요소 하나로 묶어 읽기가 넓어도 글자 사이가 벌어지지 않게 한다", () => {
    const { container } = render(<Furigana text="[週末|しゅうまつ]" show />);

    const base = container.querySelector("ruby")?.firstChild;
    expect(base).toBeInstanceOf(HTMLSpanElement);
    expect(base).toHaveTextContent(/^週末$/);
  });

  it("show면 가타카나 묶음에 같은 소리의 히라가나 읽기를 단다", () => {
    const { container } = render(<Furigana text="コーヒーを[飲|の]む" show />);

    const rubies = [...container.querySelectorAll("ruby")];
    expect(rubies.map((r) => r.querySelector("rt")?.textContent)).toEqual(["こーひー", "の"]);
    expect(container).toHaveTextContent("コーヒー(こーひー)を飲(の)む");
  });

  it("한자 표기 안의 가타카나는 그 표기의 읽기만 단다", () => {
    const { container } = render(<Furigana text="[ガス代|がすだい]" show />);

    const rubies = container.querySelectorAll("ruby");
    expect(rubies).toHaveLength(1);
    expect(rubies[0]).toHaveTextContent("ガス代(がすだい)");
  });

  it("show가 아니면 본문만 그린다", () => {
    const { container } = render(<Furigana text="[漢字|かんじ]を[読|よ]む" show={false} />);

    expect(container.querySelector("ruby")).toBeNull();
    expect(container.textContent).toBe("漢字を読む");
  });

  it("show가 아니면 가타카나에도 읽기를 달지 않는다", () => {
    const { container } = render(<Furigana text="コーヒーを[飲|の]む" show={false} />);

    expect(container.querySelector("ruby")).toBeNull();
    expect(container.textContent).toBe("コーヒーを飲む");
  });

  it("여는 괄호만 빠진 표기는 | 앞의 한자 묶음에 읽기를 단다", () => {
    const { container } = render(<Furigana text="[風邪|かぜ]気味|ぎみ]です" show />);

    const rubies = [...container.querySelectorAll("ruby")];
    expect(rubies.map((r) => r.textContent)).toEqual(["風邪(かぜ)", "気味(ぎみ)"]);
    expect(container.textContent).toBe("風邪(かぜ)気味(ぎみ)です");
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
