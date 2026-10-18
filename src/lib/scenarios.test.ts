import { describe, expect, it } from "vitest";
import { alignBreakdown } from "./breakdown";
import { parseFurigana } from "./furigana";
import { LANGUAGES, LEVELS, showsPronunciation } from "./levels";
import { cleanPron } from "./pronunciation";
import { SCENARIOS, findScenario, scenariosForLevel } from "./scenarios";

describe("SCENARIOS 데이터", () => {
  it("35개이고 레벨마다 7개다", () => {
    expect(SCENARIOS).toHaveLength(35);
    for (const level of LEVELS) expect(SCENARIOS.filter((s) => s.level === level)).toHaveLength(7);
  });

  it("id가 겹치지 않는다", () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(35);
  });

  // 레벨마다 기존 4개 뒤에 2026-10-18에 더한 3개가 온다. 앞 3개가 Free 상황이라 순서를 바꾸지 않는다(spec/chat.md "상황 목록")
  it("확정한 상황 목록과 순서를 따른다", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual([
      "l1-greeting", "l1-cafe", "l1-checkout", "l1-directions", "l1-taxi", "l1-favorites", "l1-plans",
      "l2-restaurant", "l2-hotel", "l2-clothes", "l2-train", "l2-airport", "l2-tourist-info", "l2-hair-salon",
      "l3-pharmacy", "l3-weekend", "l3-return", "l3-reservation", "l3-clinic", "l3-package", "l3-lost-item",
      "l4-interview", "l4-meeting", "l4-repair", "l4-support", "l4-lease", "l4-schedule", "l4-noise",
      "l5-salary", "l5-qa", "l5-debate", "l5-apology", "l5-resignation", "l5-angry-customer", "l5-culture",
    ]);
  });

  it("2026-10-18에 더한 상황의 제목은 승인한 제목이다", () => {
    const titles = Object.fromEntries(SCENARIOS.map((s) => [s.id, s.title]));
    expect(titles).toMatchObject({
      "l1-taxi": "택시에서 목적지 말하기",
      "l1-favorites": "좋아하는 것 이야기하기",
      "l1-plans": "친구와 약속 시간 정하기",
      "l2-airport": "공항에서 체크인하기",
      "l2-tourist-info": "관광 안내소에서 추천 받기",
      "l2-hair-salon": "미용실에서 원하는 스타일 말하기",
      "l3-clinic": "병원 접수하기",
      "l3-package": "이웃에게 택배 맡아 달라고 부탁하기",
      "l3-lost-item": "분실물 신고하기",
      "l4-lease": "부동산에서 계약 조건 확인하기",
      "l4-schedule": "동료와 업무 일정 조율하기",
      "l4-noise": "이웃에게 소음 문제 정중하게 말하기",
      "l5-resignation": "상사에게 퇴사 의사 전하기",
      "l5-angry-customer": "화난 고객 응대하기",
      "l5-culture": "문화 차이를 주제로 깊이 대화하기",
    });
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

  it("레벨 1~3 상황의 일본어 첫 마디에는 검사에 맞는 한글 발음이 있다", () => {
    for (const s of SCENARIOS.filter((s) => showsPronunciation("ja", s.level))) {
      const { pronKo } = s.roles.ja.opening;
      expect(cleanPron(pronKo), s.id).toBe(pronKo);
    }
  });

  it.each(LANGUAGES)("모든 %s 첫 마디에 검사를 통과한 문장 뜯어보기가 있다", (language) => {
    for (const s of SCENARIOS) {
      const { opening } = s.roles[language];
      expect(opening.breakdown, s.id).toBeDefined();
      expect(alignBreakdown(opening.text, opening.breakdown ?? []), s.id).toEqual(opening.breakdown);
    }
  });

  it("영어 첫 마디와 상급·고수 첫 마디에는 한글 발음을 두지 않는다", () => {
    for (const s of SCENARIOS) {
      expect(s.roles.en.opening.pronKo, s.id).toBeUndefined();
      if (!showsPronunciation("ja", s.level)) expect(s.roles.ja.opening.pronKo, s.id).toBeUndefined();
    }
  });
});

describe("scenariosForLevel", () => {
  it("그 레벨의 상황 7개를 목록 순서대로 돌려준다", () => {
    expect(scenariosForLevel(1).map((s) => s.id)).toEqual([
      "l1-greeting", "l1-cafe", "l1-checkout", "l1-directions", "l1-taxi", "l1-favorites", "l1-plans",
    ]);
    expect(scenariosForLevel(5).map((s) => s.id)).toEqual([
      "l5-salary", "l5-qa", "l5-debate", "l5-apology", "l5-resignation", "l5-angry-customer", "l5-culture",
    ]);
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
