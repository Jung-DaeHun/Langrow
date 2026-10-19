import { describe, expect, it } from "vitest";
import { pickTargetIds, pickUsedIds, TARGET_WORDS_MAX } from "./targetWords";

const CANDIDATES = ["ja-1-001", "ja-1-002", "ja-1-003", "ja-1-004", "ja-1-005", "ja-1-006", "ja-1-007"];

describe("pickTargetIds", () => {
  it("1부터 붙인 번호를 후보 id로 바꾸고 AI가 준 순서를 지킨다", () => {
    expect(pickTargetIds(CANDIDATES, [3, 1, 6])).toEqual(["ja-1-003", "ja-1-001", "ja-1-006"]);
  });

  it("정수가 아닌 번호, 0, 음수, 범위 밖 번호는 버린다", () => {
    expect(pickTargetIds(CANDIDATES, [1.5, 0, -1, 8, Number.NaN, Number.POSITIVE_INFINITY, 2])).toEqual(["ja-1-002"]);
  });

  it("같은 번호가 두 번 오면 처음 것만 남긴다", () => {
    expect(pickTargetIds(CANDIDATES, [2, 4, 2])).toEqual(["ja-1-002", "ja-1-004"]);
  });

  it("버린 뒤 앞에서 5개까지만 남긴다", () => {
    expect(TARGET_WORDS_MAX).toBe(5);
    expect(pickTargetIds(CANDIDATES, [9, 7, 6, 6, 5, 4, 3, 2, 1])).toEqual([
      "ja-1-007",
      "ja-1-006",
      "ja-1-005",
      "ja-1-004",
      "ja-1-003",
    ]);
  });

  it("빈 배열은 빈 결과다", () => {
    expect(pickTargetIds(CANDIDATES, [])).toEqual([]);
    expect(pickTargetIds([], [1, 2])).toEqual([]);
  });
});

describe("pickUsedIds", () => {
  it("그 뒤 턴: 목표 단어 번호를 id로 바꾼다 (버림 규칙은 같다)", () => {
    const targets = ["ja-1-004", "ja-1-002", "ja-1-007"];
    expect(pickUsedIds(targets, [3, 0, 1.5, 4, 3, 1], targets)).toEqual(["ja-1-007", "ja-1-004"]);
  });

  it("첫 턴: 후보 번호 중 고른 목표 단어 안의 것만 남긴다", () => {
    const targets = pickTargetIds(CANDIDATES, [2, 5]);
    expect(pickUsedIds(CANDIDATES, [1, 5, 2, 7], targets)).toEqual(["ja-1-005", "ja-1-002"]);
  });

  it("빈 배열은 빈 결과다", () => {
    expect(pickUsedIds(CANDIDATES, [], CANDIDATES)).toEqual([]);
    expect(pickUsedIds(CANDIDATES, [1, 2], [])).toEqual([]);
  });
});
