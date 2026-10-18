import { describe, expect, it } from "vitest";
import { alignBreakdown } from "./breakdown";
import { parseFurigana } from "./furigana";
import { LANGUAGES, LEVELS, showsPronunciation } from "./levels";
import { cleanPron } from "./pronunciation";
import {
  FREE_SCENARIOS_PER_LEVEL,
  SCENARIOS,
  SCENARIOS_PER_LEVEL,
  findScenario,
  isProScenario,
  isScenarioLocked,
  scenarioGroups,
  scenarioOrder,
  scenariosForLevel,
  type Scenario,
} from "./scenarios";

function scenario(id: string): Scenario {
  const found = findScenario(id);
  if (!found) throw new Error(`${id} 상황이 없다`);
  return found;
}

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

describe("scenarioOrder", () => {
  it("레벨 안 순번(1~7)을 목록 순서대로 돌려준다", () => {
    expect(SCENARIOS_PER_LEVEL).toBe(7);
    for (const level of LEVELS) {
      expect(scenariosForLevel(level).map((s) => scenarioOrder(s)), `레벨 ${level}`).toEqual([1, 2, 3, 4, 5, 6, 7]);
    }
  });
});

// 레벨 안 순서로 정한다. 앞 3개가 Free 상황이다(spec/usage.md "Pro 상황")
describe("isProScenario", () => {
  it("레벨마다 앞 3개만 Free이고 4~7번째는 Pro 상황이다", () => {
    expect(FREE_SCENARIOS_PER_LEVEL).toBe(3);
    for (const level of LEVELS) {
      expect(scenariosForLevel(level).map((s) => isProScenario(s)), `레벨 ${level}`).toEqual([
        false, false, false, true, true, true, true,
      ]);
    }
  });

  it("Free 상황은 기존 4개 중 앞 3개다", () => {
    expect(SCENARIOS.filter((s) => !isProScenario(s)).map((s) => s.id)).toEqual([
      "l1-greeting", "l1-cafe", "l1-checkout",
      "l2-restaurant", "l2-hotel", "l2-clothes",
      "l3-pharmacy", "l3-weekend", "l3-return",
      "l4-interview", "l4-meeting", "l4-repair",
      "l5-salary", "l5-qa", "l5-debate",
    ]);
  });
});

describe("isScenarioLocked", () => {
  it("상황 레벨이 지금 레벨보다 위일 때만 잠긴다", () => {
    expect(isScenarioLocked(scenario("l3-pharmacy"), 2)).toBe(true);
    expect(isScenarioLocked(scenario("l5-culture"), 4)).toBe(true);
    expect(isScenarioLocked(scenario("l2-hotel"), 1)).toBe(true);
  });

  it("같은 레벨과 아래 레벨의 상황은 열린다", () => {
    expect(isScenarioLocked(scenario("l3-pharmacy"), 3)).toBe(false);
    expect(isScenarioLocked(scenario("l3-lost-item"), 3)).toBe(false);
    expect(isScenarioLocked(scenario("l3-pharmacy"), 4)).toBe(false);
    expect(isScenarioLocked(scenario("l1-greeting"), 5)).toBe(false);
  });
});

describe("scenarioGroups", () => {
  it("입문 → 고수 묶음 5개에 레벨 이름과 상황 7개를 순서대로 담고, 지금 레벨보다 위 묶음만 잠근다", () => {
    const groups = scenarioGroups(3, [], []);

    expect(groups.map((g) => [g.level, g.name, g.locked])).toEqual([
      [1, "입문", false],
      [2, "초보", false],
      [3, "중급", false],
      [4, "상급", true],
      [5, "고수", true],
    ]);
    for (const group of groups) {
      expect(group.items.map((item) => item.scenarioId)).toEqual(scenariosForLevel(group.level).map((s) => s.id));
      expect(group.items.map((item) => item.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it("상황마다 제목·목표와 Pro 상황(4~7번째)·잠김(위 레벨) 여부를 담는다", () => {
    const groups = scenarioGroups(2, [], []);
    const items = groups.flatMap((g) => g.items);
    const byId = (id: string) => items.find((item) => item.scenarioId === id);

    expect(byId("l2-hotel")).toEqual({
      scenarioId: "l2-hotel",
      index: 2,
      title: scenario("l2-hotel").title,
      goal: scenario("l2-hotel").goal,
      pro: false,
      locked: false,
      open: null,
      completed: false,
    });
    expect(byId("l1-taxi")).toMatchObject({ index: 5, pro: true, locked: false });
    expect(byId("l3-pharmacy")).toMatchObject({ index: 1, pro: false, locked: true });
    expect(byId("l5-culture")).toMatchObject({ index: 7, pro: true, locked: true });
  });

  it("열린 세션·끝낸 세션은 레벨과 상관없이 상황 id로 맞추고, 같은 상황이면 앞(최신) 세션을 고른다", () => {
    const groups = scenarioGroups(
      3,
      [
        { id: "s-new", scenarioId: "l1-cafe", status: "ending", doneTurns: 6 },
        { id: "s-old", scenarioId: "l1-cafe", status: "active", doneTurns: 2 },
        { id: "s-upper", scenarioId: "l4-interview", status: "active", doneTurns: 1 },
      ],
      ["l1-cafe", "l3-return"],
    );
    const items = groups.flatMap((g) => g.items);
    const byId = (id: string) => items.find((item) => item.scenarioId === id);

    // 아래 레벨 상황의 열린 세션은 만들 때의 레벨로 이어 가므로 그 세션을 연다(spec/chat.md "대화 진행")
    expect(byId("l1-cafe")).toMatchObject({ open: { id: "s-new", status: "ending", doneTurns: 6 }, completed: true });
    // 레벨을 내린 뒤 남은 위 레벨 상황의 세션도 연다
    expect(byId("l4-interview")).toMatchObject({ open: { id: "s-upper", status: "active", doneTurns: 1 }, locked: true });
    expect(byId("l3-return")).toMatchObject({ open: null, completed: true });
    expect(byId("l3-pharmacy")).toMatchObject({ open: null, completed: false });
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
