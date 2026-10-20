import { describe, expect, it } from "vitest";
import { parseBlank } from "./blank";
import { parseFurigana, rubySegments, stripFurigana } from "./furigana";

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

  describe("여는 괄호만 빠진 표기는 | 바로 앞의 한자 묶음에 읽기를 단다", () => {
    it("온전한 표기 바로 뒤", () => {
      expect(parseFurigana("[風邪|かぜ]気味|ぎみ]")).toEqual([
        { text: "風邪", reading: "かぜ" },
        { text: "気味", reading: "ぎみ" },
      ]);
    });

    it("앞에 가나가 이어져도 한자 묶음만 본문이다", () => {
      expect(parseFurigana("少し疲れ気味|ぎみ]です")).toEqual([
        { text: "少し疲れ" },
        { text: "気味", reading: "ぎみ" },
        { text: "です" },
      ]);
    });

    it("々가 든 한자 묶음도 본문이다", () => {
      expect(parseFurigana("人々|ひとびと]が")).toEqual([{ text: "人々", reading: "ひとびと" }, { text: "が" }]);
    });

    it("| 바로 앞이 한자가 아니면 |부터 ]까지의 읽기를 버린다", () => {
      expect(parseFurigana("コーヒー|こーひー]")).toEqual([{ text: "コーヒー" }]);
      expect(parseFurigana("[好|す]きなコーヒー|こーひー]です")).toEqual([
        { text: "好", reading: "す" },
        { text: "きなコーヒーです" },
      ]);
    });

    it("stripFurigana도 복구를 따른다", () => {
      expect(stripFurigana("[風邪|かぜ]気味|ぎみ]です")).toBe("風邪気味です");
    });
  });

  // 2026-10-20 종료 피드백 예문에서 나왔다
  describe("|가 빠진 漢字[かな] 표기는 [ 바로 앞의 한자 묶음에 괄호 안 히라가나를 읽기로 단다", () => {
    it("앞뒤에 가나가 이어져도 한자 묶음만 본문이다", () => {
      expect(parseFurigana("お願[ねが]いします")).toEqual([
        { text: "お" },
        { text: "願", reading: "ねが" },
        { text: "いします" },
      ]);
    });

    it("온전한 표기 바로 뒤", () => {
      expect(parseFurigana("[何回|なんかい]飲[の]めば")).toEqual([
        { text: "何回", reading: "なんかい" },
        { text: "飲", reading: "の" },
        { text: "めば" },
      ]);
    });

    it("[ 앞이 한자가 아니거나 괄호 안이 히라가나만이 아니면 깨진 표기로 둔다", () => {
      expect(parseFurigana("お[ねが]い")).toEqual([{ text: "おねがい" }]);
      expect(parseFurigana("飲[ノ]む")).toEqual([{ text: "飲ノむ" }]);
    });

    it("stripFurigana도 복구를 따른다", () => {
      expect(stripFurigana("お願[ねが]いします")).toBe("お願いします");
    });
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

describe("rubySegments", () => {
  it("가타카나 묶음(장음 포함)에 같은 소리의 히라가나 읽기를 단다", () => {
    expect(rubySegments("コーヒー")).toEqual([{ text: "コーヒー", reading: "こーひー" }]);
    expect(rubySegments("ヴァイオリン")).toEqual([{ text: "ヴァイオリン", reading: "ゔぁいおりん" }]);
  });

  it("한자 표기와 가타카나 읽기를 함께 달고, 이웃한 일반 텍스트는 합친다", () => {
    expect(rubySegments("[熱|あつ]いコーヒーをください。")).toEqual([
      { text: "熱", reading: "あつ" },
      { text: "い" },
      { text: "コーヒー", reading: "こーひー" },
      { text: "をください。" },
    ]);
  });

  it("・는 묶음을 끊고 일반 텍스트로 둔다", () => {
    expect(rubySegments("チョン・デフンです")).toEqual([
      { text: "チョン", reading: "ちょん" },
      { text: "・" },
      { text: "デフン", reading: "でふん" },
      { text: "です" },
    ]);
  });

  it("가타카나 글자 없이 ー만 있으면 읽기를 달지 않는다", () => {
    expect(rubySegments("えー、そうですね")).toEqual([{ text: "えー、そうですね" }]);
    expect(rubySegments("えーコーラ")).toEqual([{ text: "えー" }, { text: "コーラ", reading: "こーら" }]);
  });

  it("한자 표기의 본문·읽기 안의 가타카나는 건드리지 않는다", () => {
    expect(rubySegments("[ヶ月|かげつ]")).toEqual([{ text: "ヶ月", reading: "かげつ" }]);
    expect(rubySegments("[漢字|カンジ]")).toEqual([{ text: "漢字", reading: "カンジ" }]);
    expect(rubySegments("[山田・太郎|やまだ・たろう]")).toEqual([{ text: "山田・太郎", reading: "やまだ・たろう" }]);
  });

  it("따로 쓰인 ヶ·ヵ는 か·が·こ로 읽어 같은 소리 히라가나가 아니므로 읽기를 달지 않는다", () => {
    expect(rubySegments("3ヶ[月|げつ]")).toEqual([{ text: "3ヶ" }, { text: "月", reading: "げつ" }]);
    expect(rubySegments("1ヵ所")).toEqual([{ text: "1ヵ所" }]);
  });

  it("본문에 한자가 없는 표기는 AI 읽기를 버리고 본문 가타카나에 코드가 읽기를 단다", () => {
    expect(rubySegments("[コーヒー|こうひい]が[好|す]き")).toEqual([
      { text: "コーヒー", reading: "こーひー" },
      { text: "が" },
      { text: "好", reading: "す" },
      { text: "き" },
    ]);
  });

  it("가타카나가 없으면 parseFurigana와 같다", () => {
    const input = "[学校|がっこう]に[行|い]った。";
    expect(rubySegments(input)).toEqual(parseFurigana(input));
    expect(rubySegments("")).toEqual([]);
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
