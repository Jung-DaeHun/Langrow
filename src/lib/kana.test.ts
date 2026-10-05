import { describe, expect, it } from "vitest";
import { KANA, KANA_ROWS, type KanaScript } from "./kana";

const SCRIPTS: KanaScript[] = ["hiragana", "katakana"];
const groupOf = (row: string) => KANA_ROWS.find((r) => r.key === row)?.group;

describe("KANA_ROWS", () => {
  it("청음 10행 다음에 탁음·반탁음 5행이 온다", () => {
    expect(KANA_ROWS).toEqual([
      ...["a", "ka", "sa", "ta", "na", "ha", "ma", "ya", "ra", "wa"].map((key) => ({ key, group: "basic" })),
      ...["ga", "za", "da", "ba", "pa"].map((key) => ({ key, group: "voiced" })),
    ]);
  });
});

describe.each(SCRIPTS)("KANA.%s", (script) => {
  const kana = KANA[script];

  it("71자다", () => {
    expect(kana).toHaveLength(71);
  });

  it("글자가 겹치지 않는다", () => {
    expect(new Set(kana.map((k) => k.char)).size).toBe(71);
  });

  it("청음 46자, 탁음·반탁음 25자다", () => {
    expect(kana.filter((k) => groupOf(k.row) === "basic")).toHaveLength(46);
    expect(kana.filter((k) => groupOf(k.row) === "voiced")).toHaveLength(25);
  });

  it("모든 글자의 행이 KANA_ROWS에 있다", () => {
    for (const k of kana) expect(groupOf(k.row)).toBeDefined();
  });

  it("모든 글자에 romaji와 한국어 발음이 있다", () => {
    for (const k of kana) {
      expect(k.romaji).toMatch(/^[a-z]+$/);
      expect(k.ko).not.toBe("");
    }
  });

  it("わ행은 わ·を·ん이고 요음은 없다", () => {
    expect(kana.filter((k) => k.row === "wa").map((k) => k.romaji)).toEqual(["wa", "wo", "n"]);
    // 요음(きゃ 등)은 두 글자라 한 글자짜리만 있으면 요음이 없다
    for (const k of kana) expect([...k.char]).toHaveLength(1);
  });
});

describe("KANA 히라가나·가타카나", () => {
  it("romaji·한국어 발음·행 순서가 같다", () => {
    const strip = (script: KanaScript) => KANA[script].map(({ romaji, ko, row }) => ({ romaji, ko, row }));
    expect(strip("katakana")).toEqual(strip("hiragana"));
  });

  it("헷갈리는 글자는 헵번식 romaji와 정해진 한국어 발음을 쓴다", () => {
    const pick = (char: string) => {
      const k = [...KANA.hiragana, ...KANA.katakana].find((x) => x.char === char);
      return k && `${k.romaji} ${k.ko}`;
    };
    expect(pick("し")).toBe("shi 시");
    expect(pick("ち")).toBe("chi 치");
    expect(pick("つ")).toBe("tsu 츠");
    expect(pick("ふ")).toBe("fu 후");
    expect(pick("を")).toBe("wo 오");
    expect(pick("ん")).toBe("n 응");
    expect(pick("じ")).toBe("ji 지");
    expect(pick("ぢ")).toBe("ji 지");
    expect(pick("ず")).toBe("zu 즈");
    expect(pick("づ")).toBe("zu 즈");
    expect(pick("ツ")).toBe("tsu 츠");
    expect(pick("ヲ")).toBe("wo 오");
  });

  it("첫 글자와 마지막 글자", () => {
    expect(KANA.hiragana[0]).toEqual({ char: "あ", romaji: "a", ko: "아", row: "a" });
    expect(KANA.hiragana[70]).toEqual({ char: "ぽ", romaji: "po", ko: "포", row: "pa" });
    expect(KANA.katakana[0]).toEqual({ char: "ア", romaji: "a", ko: "아", row: "a" });
    expect(KANA.katakana[70]).toEqual({ char: "ポ", romaji: "po", ko: "포", row: "pa" });
  });
});
