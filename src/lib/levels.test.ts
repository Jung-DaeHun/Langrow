import { describe, expect, it } from "vitest";
import {
  LANGUAGE_NAMES,
  LEVEL_INFO,
  LEVELS,
  allowsKoreanInput,
  canTakeLevelTest,
  isLevel,
  opensTranslationByDefault,
  showsFurigana,
  showsKana,
} from "./levels";

describe("levels", () => {
  it("언어 이름은 영어·일본어다", () => {
    expect(LANGUAGE_NAMES).toEqual({ en: "영어", ja: "일본어" });
  });

  it("레벨 이름은 입문부터 고수까지다", () => {
    expect(LEVELS.map((level) => LEVEL_INFO[level].name)).toEqual(["입문", "초보", "중급", "상급", "고수"]);
    expect(LEVEL_INFO[1].description).toBe("인사와 아주 쉬운 표현부터 시작해요");
    expect(LEVEL_INFO[5].description).toBe("원어민처럼 관용구와 격식을 자유롭게 써요");
  });

  it("1~5 정수만 레벨이다", () => {
    expect([1, 2, 3, 4, 5].every(isLevel)).toBe(true);
    expect([0, 6, -1, 2.5, NaN].some(isLevel)).toBe(false);
  });

  it("후리가나는 입문~중급(1~3)만 보여 준다", () => {
    expect(LEVELS.map(showsFurigana)).toEqual([true, true, true, false, false]);
  });

  it("번역은 입문·초보(1~2)만 기본으로 펼친다", () => {
    expect(LEVELS.map(opensTranslationByDefault)).toEqual([true, true, false, false, false]);
  });

  it("한국어 입력은 입문·초보(1~2)만 허용한다", () => {
    expect(LEVELS.map(allowsKoreanInput)).toEqual([true, true, false, false, false]);
  });

  it("레벨업 테스트는 1~4만 볼 수 있다", () => {
    expect(LEVELS.map(canTakeLevelTest)).toEqual([true, true, true, true, false]);
  });

  it("가나 익히기는 일본어 입문·초보만 보여 준다", () => {
    expect(LEVELS.map((level) => showsKana("ja", level))).toEqual([true, true, false, false, false]);
    expect(LEVELS.map((level) => showsKana("en", level))).toEqual([false, false, false, false, false]);
  });
});
