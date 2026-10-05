import { describe, expect, it } from "vitest";
import { LEVEL_TEST_SIZE, PASS_SCORE, hasValidTestIds, isPassed, scoreAnswers } from "./levelTest";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `en-2-${String(i + 1).padStart(3, "0")}`);

describe("hasValidTestIds", () => {
  it("서로 다른 20개만 허용한다", () => {
    expect(LEVEL_TEST_SIZE).toBe(20);
    expect(hasValidTestIds(ids(20))).toBe(true);
  });

  it("19개나 21개는 거부한다", () => {
    expect(hasValidTestIds(ids(19))).toBe(false);
    expect(hasValidTestIds(ids(21))).toBe(false);
  });

  it("20개여도 중복이 있으면 거부한다", () => {
    expect(hasValidTestIds([...ids(19), "en-2-001"])).toBe(false);
  });
});

describe("scoreAnswers", () => {
  const correctById = new Map([
    ["en-2-001", "went"],
    ["en-2-002", "eaten"],
    ["ja-1-001", "[行|い]った"],
  ]);

  it("맞힌 개수와 틀린 단어를 제출 순서대로 돌려준다", () => {
    const result = scoreAnswers(
      [
        { word_id: "en-2-001", answer: "went" },
        { word_id: "en-2-002", answer: "ate" },
        { word_id: "ja-1-001", answer: "[行|い]った" },
      ],
      correctById,
    );
    expect(result).toEqual({ score: 2, wrongIds: ["en-2-002"] });
  });

  it("대소문자·공백을 정규화하지 않고 그대로 비교한다", () => {
    const result = scoreAnswers(
      [
        { word_id: "en-2-001", answer: "Went" },
        { word_id: "en-2-002", answer: " eaten" },
      ],
      correctById,
    );
    expect(result).toEqual({ score: 0, wrongIds: ["en-2-001", "en-2-002"] });
  });

  it("정답을 모르는 단어는 오답이다", () => {
    expect(scoreAnswers([{ word_id: "en-2-999", answer: "went" }], correctById)).toEqual({
      score: 0,
      wrongIds: ["en-2-999"],
    });
  });
});

describe("isPassed", () => {
  it("16개 이상이면 합격이다", () => {
    expect(PASS_SCORE).toBe(16);
    expect(isPassed(15)).toBe(false);
    expect(isPassed(16)).toBe(true);
    expect(isPassed(20)).toBe(true);
  });
});
