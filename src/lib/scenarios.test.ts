import { describe, expect, it } from "vitest";
import { parseFurigana } from "./furigana";
import { LANGUAGES, LEVELS } from "./levels";
import { SCENARIOS, findScenario, scenariosForLevel } from "./scenarios";

describe("SCENARIOS 데이터", () => {
  it("20개이고 레벨마다 4개다", () => {
    expect(SCENARIOS).toHaveLength(20);
    for (const level of LEVELS) expect(SCENARIOS.filter((s) => s.level === level)).toHaveLength(4);
  });

  it("id가 겹치지 않는다", () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(20);
  });

  it("확정한 상황 목록과 순서를 따른다", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual([
      "l1-greeting", "l1-cafe", "l1-checkout", "l1-directions",
      "l2-restaurant", "l2-hotel", "l2-clothes", "l2-train",
      "l3-pharmacy", "l3-weekend", "l3-return", "l3-reservation",
      "l4-interview", "l4-meeting", "l4-repair", "l4-support",
      "l5-salary", "l5-qa", "l5-debate", "l5-apology",
    ]);
  });

  it("id는 레벨 접두어로 시작한다", () => {
    for (const s of SCENARIOS) expect(s.id.startsWith(`l${s.level}-`)).toBe(true);
  });

  it("title과 goal이 비어 있지 않다", () => {
    for (const s of SCENARIOS) {
      expect(s.title.trim()).not.toBe("");
      expect(s.goal.trim()).not.toBe("");
    }
  });

  it.each(LANGUAGES)("모든 상황에 %s 역할·첫 마디·번역이 있다", (language) => {
    for (const s of SCENARIOS) {
      const { role, opening } = s.roles[language];
      expect(role.trim(), s.id).not.toBe("");
      expect(opening.text.trim(), s.id).not.toBe("");
      expect(opening.ko.trim(), s.id).not.toBe("");
    }
  });

  it("일본어 첫 마디의 모든 한자에 읽기가 달려 있다", () => {
    for (const s of SCENARIOS) {
      const plain = parseFurigana(s.roles.ja.opening.text).filter((seg) => seg.reading === undefined);
      for (const seg of plain) {
        expect(seg.text, s.id).not.toMatch(/[[\]|]/);
        expect(seg.text, s.id).not.toMatch(/\p{Script=Han}/u);
      }
    }
  });

  it("영어 첫 마디에는 후리가나 표기가 없다", () => {
    for (const s of SCENARIOS) expect(s.roles.en.opening.text, s.id).not.toMatch(/[[\]|]/);
  });
});

describe("scenariosForLevel", () => {
  it("그 레벨의 상황 4개를 목록 순서대로 돌려준다", () => {
    expect(scenariosForLevel(1).map((s) => s.id)).toEqual(["l1-greeting", "l1-cafe", "l1-checkout", "l1-directions"]);
    expect(scenariosForLevel(5).map((s) => s.id)).toEqual(["l5-salary", "l5-qa", "l5-debate", "l5-apology"]);
  });
});

describe("findScenario", () => {
  it("id로 상황을 찾는다", () => {
    const s = findScenario("l3-pharmacy");
    expect(s?.level).toBe(3);
    expect(s?.title).toBe("약국에서 증상 설명하기");
  });

  it("없는 id면 undefined다", () => {
    expect(findScenario("l9-unknown")).toBeUndefined();
    expect(findScenario("")).toBeUndefined();
  });
});
