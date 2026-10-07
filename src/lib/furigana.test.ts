import { describe, expect, it } from "vitest";
import { parseBlank } from "./blank";
import { parseFurigana, stripFurigana } from "./furigana";

describe("parseFurigana", () => {
  it("[本文|읽기]를 읽기가 달린 segment로 만든다", () => {
    expect(parseFurigana("[漢字|かんじ]")).toEqual([{ text: "漢字", reading: "かんじ" }]);
  });

  it("나머지 글자는 일반 텍스트 segment이고 이웃한 일반 텍스트는 합친다", () => {
    expect(parseFurigana("[学校|がっこう]に[行|い]った。")).toEqual([
      { text: "学校", reading: "がっこう" },
      { text: "に" },
      { text: "行", reading: "い" },
      { text: "った。" },
    ]);
  });

  it("표기가 없으면 전체가 일반 텍스트 segment 1개다", () => {
    expect(parseFurigana("こんにちは")).toEqual([{ text: "こんにちは" }]);
  });

  it("빈 문자열이면 segment가 없다", () => {
    expect(parseFurigana("")).toEqual([]);
  });

  it("본문에 한자가 없으면 읽기를 버리고 이웃한 일반 텍스트와 합친다", () => {
    expect(parseFurigana("[コーヒー|こーひー]が[好|す]き")).toEqual([
      { text: "コーヒーが" },
      { text: "好", reading: "す" },
      { text: "き" },
    ]);
    expect(parseFurigana("[私|わたし]は[チョン|ちょん]・デフン")).toEqual([
      { text: "私", reading: "わたし" },
      { text: "はチョン・デフン" },
    ]);
    expect(parseFurigana("[정대훈|ていだいくん]さん")).toEqual([{ text: "정대훈さん" }]);
  });

  it("々가 든 본문은 한자로 보고 읽기를 단다", () => {
    expect(parseFurigana("[人々|ひとびと]")).toEqual([{ text: "人々", reading: "ひとびと" }]);
  });

  it("읽기가 달린 segment끼리 붙어 있으면 따로 둔다", () => {
    expect(parseFurigana("[今日|きょう][学校|がっこう]")).toEqual([
      { text: "今日", reading: "きょう" },
      { text: "学校", reading: "がっこう" },
    ]);
  });

  describe("깨진 표기는 [, ], |만 지우고 일반 텍스트로 둔다", () => {
    it("닫히지 않은 [", () => {
      expect(parseFurigana("[漢字|かんじ です")).toEqual([{ text: "漢字かんじ です" }]);
    });

    it("|가 없는 […]", () => {
      expect(parseFurigana("これは[漢字]です")).toEqual([{ text: "これは漢字です" }]);
    });

    it("빈 본문", () => {
      expect(parseFurigana("a[|かんじ]b")).toEqual([{ text: "aかんじb" }]);
    });

    it("빈 읽기", () => {
      expect(parseFurigana("a[漢字|]b")).toEqual([{ text: "a漢字b" }]);
    });

    it("|가 두 개", () => {
      expect(parseFurigana("[漢字|かん|じ]")).toEqual([{ text: "漢字かんじ" }]);
    });

    it("중첩된 [는 바깥 표기를 깨진 것으로 보고 안쪽의 온전한 표기만 살린다", () => {
      expect(parseFurigana("[漢[字|じ]|かんじ]")).toEqual([
        { text: "漢" },
        { text: "字", reading: "じ" },
        { text: "かんじ" },
      ]);
    });

    it("짝 없는 ]와 |", () => {
      expect(parseFurigana("a]b|c")).toEqual([{ text: "abc" }]);
    });

    it("깨진 표기 옆의 온전한 표기는 그대로 살린다", () => {
      expect(parseFurigana("[学校]に[行|い]く")).toEqual([
        { text: "学校に" },
        { text: "行", reading: "い" },
        { text: "く" },
      ]);
    });

    it("기호만 있으면 segment가 없다", () => {
      expect(parseFurigana("[|]")).toEqual([]);
    });
  });

  it("어떤 입력에도 throw하지 않고 일반 텍스트에 [, ], |를 남기지 않는다", () => {
    const inputs = ["[", "]", "|", "[[", "]]", "[[a|b]]", "[a|b", "a|b]", "[a|[b|c]", "||[]|", "[]"];
    for (const input of inputs) {
      const plain = parseFurigana(input).filter((s) => s.reading === undefined);
      for (const s of plain) expect(s.text).not.toMatch(/[[\]|]/);
    }
  });
});

describe("stripFurigana", () => {
  it("읽기를 버리고 본문만 잇는다", () => {
    expect(stripFurigana("[学校|がっこう]に[行|い]った。")).toBe("学校に行った。");
  });

  it("깨진 표기도 기호만 지운다", () => {
    expect(stripFurigana("[漢字]と[仮名|かな")).toBe("漢字と仮名かな");
  });
});

describe("빈칸 예문과 함께 쓰기", () => {
  it("parseBlank로 먼저 나눈 뒤 각 부분에 parseFurigana를 적용한다", () => {
    const parts = parseBlank("[学校|がっこう]に{{[行|い]った}}。");
    expect(parts).not.toBeNull();
    expect(parseFurigana(parts!.before)).toEqual([{ text: "学校", reading: "がっこう" }, { text: "に" }]);
    expect(parseFurigana(parts!.answer)).toEqual([{ text: "行", reading: "い" }, { text: "った" }]);
    expect(parseFurigana(parts!.after)).toEqual([{ text: "。" }]);
  });
});
