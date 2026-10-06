import { describe, expect, it } from "vitest";
import {
  DAILY_WORD_GOAL,
  VALID_SESSION_TURNS,
  exhaustedActions,
  isValidSession,
  remainingGoalCount,
  wordGoal,
} from "./today";

describe("isValidSession", () => {
  it("성공한 턴이 3개 이상이면 유효하다", () => {
    expect(VALID_SESSION_TURNS).toBe(3);
    expect(isValidSession(0)).toBe(false);
    expect(isValidSession(2)).toBe(false);
    expect(isValidSession(3)).toBe(true);
    expect(isValidSession(20)).toBe(true);
  });
});

describe("wordGoal", () => {
  it("목표는 10개다", () => {
    expect(DAILY_WORD_GOAL).toBe(10);
  });

  it("오늘 학습한 수를 진행률로 보여 준다", () => {
    expect(wordGoal(0, 200)).toEqual({ progress: 0, done: false, exhausted: false });
    expect(wordGoal(4, 196)).toEqual({ progress: 4, done: false, exhausted: false });
  });

  it("10개를 채우면 완료다", () => {
    expect(wordGoal(10, 190)).toEqual({ progress: 10, done: true, exhausted: false });
  });

  it("Pro가 10개를 넘겨도 진행률은 10이다", () => {
    expect(wordGoal(25, 175)).toEqual({ progress: 10, done: true, exhausted: false });
  });

  it("미학습 단어가 없으면 소진이다", () => {
    expect(wordGoal(3, 0)).toEqual({ progress: 3, done: false, exhausted: true });
  });

  it("10개를 채운 뒤 소진돼도 완료는 유지한다", () => {
    expect(wordGoal(10, 0)).toEqual({ progress: 10, done: true, exhausted: true });
  });
});

describe("remainingGoalCount", () => {
  it("아무것도 안 했으면 2개다", () => {
    expect(remainingGoalCount(wordGoal(0, 200), false)).toBe(2);
  });

  it("단어를 진행 중이면 단어 목표가 남는다", () => {
    expect(remainingGoalCount(wordGoal(4, 196), true)).toBe(1);
  });

  it("단어를 채웠으면 대화 목표만 남는다", () => {
    expect(remainingGoalCount(wordGoal(10, 190), false)).toBe(1);
    expect(remainingGoalCount(wordGoal(10, 190), true)).toBe(0);
  });

  it("소진된 단어 목표는 남은 할 일로 세지 않는다", () => {
    expect(remainingGoalCount(wordGoal(3, 0), false)).toBe(1);
    expect(remainingGoalCount(wordGoal(3, 0), true)).toBe(0);
  });
});

describe("exhaustedActions", () => {
  it("레벨 1~4는 레벨업 테스트와 오답 복습으로 안내한다", () => {
    for (const level of [1, 2, 3, 4] as const) {
      expect(exhaustedActions(level, 5)).toEqual(["level-up", "review"]);
    }
  });

  it("레벨 1~4에서 오답이 없으면 복습 대신 대화로 안내한다", () => {
    expect(exhaustedActions(1, 0)).toEqual(["level-up", "chat"]);
    expect(exhaustedActions(4, 0)).toEqual(["level-up", "chat"]);
  });

  it("레벨 5는 레벨업 없이 오답 복습과 대화로 안내한다", () => {
    expect(exhaustedActions(5, 1)).toEqual(["review", "chat"]);
  });

  it("레벨 5에서 오답이 없으면 대화만 안내한다", () => {
    expect(exhaustedActions(5, 0)).toEqual(["chat"]);
  });
});
